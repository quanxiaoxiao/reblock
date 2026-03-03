import crypto from 'crypto';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileTypeFromFile } from 'file-type';
import { Block, Entry, Resource } from '../models';
import type { IBlock, IEntry, IResource, IUploadConfig } from '../models';
import { env } from '../config/env';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
import { 
  generateStorageName, 
  generateIV, 
  createEncryptStream,
  getStoragePath 
} from '../utils/crypto';

export class UploadBusinessError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = 'UploadBusinessError';
  }
}

export interface IUploadService {
  processUpload(
    alias: string,
    tempFilePath: string,
    name?: string,
    mime?: string,
    startTime?: number,
    clientIp?: string,
    userAgent?: string
  ): Promise<IResource>;
}

export class UploadService implements IUploadService {
  private readonly tempDir = env.STORAGE_TEMP_DIR;
  private readonly blocksDir = env.STORAGE_BLOCK_DIR;

  async processUpload(
    alias: string,
    tempFilePath: string,
    name?: string,
    mime?: string,
    startTime?: number,
    clientIp?: string,
    userAgent?: string
  ): Promise<IResource> {
    // Step 1: Validate Entry and check upload config
    const entry = await this.validateEntryWithConfig(alias);

    // Step 2: Compute SHA256 of temp file
    const sha256 = await this.computeSHA256(tempFilePath);

    // Step 3: Get file size
    const stats = await fs.stat(tempFilePath);
    const size = stats.size;

    // Step 4: Validate file size against upload config
    this.validateFileSize(size, entry.uploadConfig);

    // Step 5: Detect MIME type using file-type library
    const detectedMime = await this.detectMimeType(tempFilePath);

    // Step 6: Validate MIME type against upload config
    this.validateMimeType(detectedMime, entry.uploadConfig);

    // Step 7: Block Deduplication
    const block = await this.handleBlockDeduplication(sha256, size, tempFilePath);

    // Step 8: Calculate upload duration
    const uploadDuration = startTime ? Date.now() - startTime : undefined;

    // Step 9: Create Resource with client info
    const resource = await this.createResource(
      entry,
      block,
      name,
      detectedMime,
      uploadDuration,
      clientIp,
      userAgent
    );

    return resource;
  }

  private async validateEntryWithConfig(alias: string): Promise<IEntry> {
    const entry = await Entry.findOne({
      alias,
      isInvalid: { $ne: true }
    });

    if (!entry) {
      throw new UploadBusinessError('Entry not found', 404);
    }

    // Check if entry is read-only
    if (entry.uploadConfig?.readOnly) {
      throw new UploadBusinessError('Entry is read-only', 403);
    }

    return entry;
  }

  private validateFileSize(size: number, uploadConfig?: IUploadConfig): void {
    if (uploadConfig?.maxFileSize && size > uploadConfig.maxFileSize) {
      throw new UploadBusinessError(
        `File size exceeds limit: ${uploadConfig.maxFileSize} bytes`,
        400
      );
    }
  }

  private async detectMimeType(filePath: string): Promise<string> {
    const result = await fileTypeFromFile(filePath);
    return result?.mime || 'application/octet-stream';
  }

  private validateMimeType(detectedMime: string, uploadConfig?: IUploadConfig): void {
    if (!uploadConfig?.allowedMimeTypes || uploadConfig.allowedMimeTypes.length === 0) {
      return; // No restriction
    }

    const isAllowed = uploadConfig.allowedMimeTypes.some((allowed) => {
      if (allowed.endsWith('/*')) {
        // Wildcard match: image/* matches image/png, image/jpeg, etc.
        const prefix = allowed.slice(0, -2);
        return detectedMime.startsWith(prefix);
      }
      // Exact match
      return detectedMime === allowed;
    });

    if (!isAllowed) {
      throw new UploadBusinessError(
        `MIME type not allowed: ${detectedMime}, allowed: ${uploadConfig.allowedMimeTypes.join(', ')}`,
        400
      );
    }
  }

  private async computeSHA256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const fileHandle = await fs.open(filePath, 'r');
    
    try {
      const buffer = Buffer.alloc(65536); // 64KB chunks
      let bytesRead: number;
      
      do {
        bytesRead = await fileHandle.read(buffer, 0, buffer.length, null)
          .then(result => result.bytesRead);
        if (bytesRead > 0) {
          hash.update(buffer.subarray(0, bytesRead));
        }
      } while (bytesRead > 0);
      
      return hash.digest('hex');
    } finally {
      await fileHandle.close();
    }
  }

  private async handleBlockDeduplication(
    sha256: string,
    size: number,
    tempFilePath: string
  ): Promise<IBlock> {
    const now = Date.now();
    const storageName = generateStorageName(sha256);
    const blockPath = this.getStoragePath(storageName);

    // Ensure unique index exists (handles collection recreation by external tools)
    await Block.syncIndexes({ background: false });

    let block: IBlock | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (!block && retryCount < maxRetries) {
      try {
        // Step 1: Try to create a new block atomically
        // Unique index on sha256 (for non-invalid blocks) prevents duplicates
        block = await Block.create({
          sha256,
          size,
          linkCount: 1,  // New block starts with linkCount=1
          isInvalid: false,
          createdAt: now,
          updatedAt: now,
        });

        // Creation successful → this is a new block, write the file
        const objectIdBuffer = (block._id as any).id || Buffer.from(block._id.toString(), 'hex');
        const iv = generateIV(objectIdBuffer);

        await this.ensureDirectoryExists(path.dirname(blockPath));

        let fileExists = false;
        try {
          await fs.access(blockPath);
          fileExists = true;
        } catch {
          // File doesn't exist, we'll create it
        }

        if (!fileExists) {
          await this.encryptAndMoveFile(tempFilePath, blockPath, iv, sha256, size);
        } else {
          await fs.unlink(tempFilePath).catch(() => {});
        }

        return block;

      } catch (error: any) {
        // Check if this is a duplicate key error (code 11000)
        if (error.code === 11000 && error.message?.includes('sha256')) {
          // Step 2: Block already exists, atomically increment linkCount
          const updated = await Block.findOneAndUpdate(
            { sha256, isInvalid: { $ne: true } },
            { $inc: { linkCount: 1 }, $set: { updatedAt: now } },
            { returnDocument: 'after' }
          );

          if (updated) {
            // Clean up temp file since we're referencing existing block
            await fs.unlink(tempFilePath).catch(() => {});
            return updated;
          }

          // Block not found (might have been deleted), retry
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 10 * retryCount));
          }
        } else {
          // Other errors, rethrow
          throw error;
        }
      }
    }

    // Log the deduplication failure
    await logService.logIssue({
      level: LogLevel.ERROR,
      category: LogCategory.DATA_INCONSISTENCY,
      details: {
        error: `Failed to deduplicate block after ${maxRetries} retries`,
        sha256,
        size,
        maxRetries,
      },
      suggestedAction: 'Check database consistency and retry upload',
      recoverable: true,
      dataLossRisk: DataLossRisk.LOW,
      context: {
        detectedBy: 'uploadService',
        detectedAt: Date.now(),
        environment: env.NODE_ENV,
      },
    });

    throw new Error(`Failed to deduplicate block after ${maxRetries} retries`);
  }

  private async encryptAndMoveFile(
    tempFilePath: string, 
    blockPath: string, 
    iv: Buffer,
    sha256?: string,
    size?: number
  ): Promise<void> {
    // Create encrypt stream
    const encryptStream = createEncryptStream(iv);
    
    // Create read and write streams
    const readStream = createReadStream(tempFilePath);
    const writeStream = createWriteStream(blockPath);

    try {
      // Pipeline: read → encrypt → write
      await pipeline(readStream, encryptStream, writeStream);
    } catch (error) {
      // Log the encryption failure
      await logService.logIssue({
        level: LogLevel.ERROR,
        category: LogCategory.RUNTIME_ERROR,
        details: {
          error: `Failed to encrypt and move file: ${(error as Error).message}`,
          tempFilePath,
          blockPath,
          sha256,
          size,
        },
        suggestedAction: 'Check storage permissions and disk space',
        recoverable: true,
        dataLossRisk: DataLossRisk.LOW,
        context: {
          detectedBy: 'uploadService',
          detectedAt: Date.now(),
          environment: env.NODE_ENV,
          stackTrace: (error as Error).stack,
        },
      });

      // Clean up on error
      try {
        await fs.unlink(blockPath);
      } catch {
        // Ignore cleanup error
      }
      throw error;
    } finally {
      // Delete temp file regardless of success or failure
      try {
        await fs.unlink(tempFilePath);
      } catch (cleanupError) {
        // Log temp file cleanup failure (warning level)
        await logService.logIssue({
          level: LogLevel.WARNING,
          category: LogCategory.RUNTIME_ERROR,
          details: {
            error: `Failed to clean up temp file: ${(cleanupError as Error).message}`,
            tempFilePath,
            sha256,
          },
          suggestedAction: 'Manually clean up temp files to free disk space',
          recoverable: true,
          dataLossRisk: DataLossRisk.NONE,
          context: {
            detectedBy: 'uploadService',
            detectedAt: Date.now(),
            environment: env.NODE_ENV,
          },
        });
      }
    }
  }

  private getStoragePath(storageName: string): string {
    const relativePath = getStoragePath(storageName);
    return path.join(this.blocksDir, relativePath);
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      // Directory might already exist, which is fine
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private async createResource(
    entry: IEntry,
    block: IBlock,
    name?: string,
    mime?: string,
    uploadDuration?: number,
    clientIp?: string,
    userAgent?: string
  ): Promise<IResource> {
    const now = Date.now();
    
    const resource = new Resource({
      entry: entry._id,
      block: block._id,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      name: name || '',
      description: '',
      mime: mime || undefined,
      clientIp: clientIp,
      userAgent: userAgent,
      uploadDuration: uploadDuration
    });

    try {
      const savedResource = await resource.save();
      return savedResource;
    } catch (error) {
      // Log database save failure
      await logService.logIssue({
        level: LogLevel.ERROR,
        category: LogCategory.RUNTIME_ERROR,
        details: {
          error: `Failed to save resource to database: ${(error as Error).message}`,
          entryId: entry._id.toString(),
          blockId: block._id.toString(),
          name,
          mime,
        },
        suggestedAction: 'Check database connection and retry upload',
        recoverable: true,
        dataLossRisk: DataLossRisk.MEDIUM,
        context: {
          detectedBy: 'uploadService',
          detectedAt: Date.now(),
          environment: env.NODE_ENV,
          stackTrace: (error as Error).stack,
        },
      });
      throw error;
    }
  }
}

export const uploadService = new UploadService();
