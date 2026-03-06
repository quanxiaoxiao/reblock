import crypto from 'crypto';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Types } from 'mongoose';
import { Block, Entry, Resource } from '../models';
import type { IBlock, IEntry, IResource } from '../models';
import { env } from '../config/env';
import { logService } from './logService';
import { LogLevel, LogCategory, DataLossRisk } from '../models/logEntry';
import {
  generateStorageName,
  generateIV,
  createEncryptStream,
  getStoragePath
} from '../utils/crypto';

export interface MigrationResourceData {
  legacyId: string;
  entryAlias: string;
  name: string;
  mime?: string | undefined;
  categoryKey?: string | undefined;
  description?: string | undefined;
  contentBase64: string;
  createdAt?: number | undefined;
  updatedAt?: number | undefined;
}

export interface MigrationResult {
  resource: IResource;
  isNew: boolean;
  block: IBlock;
}

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export class MigrationService {
  private readonly tempDir = env.STORAGE_TEMP_DIR;
  private readonly blocksDir = env.STORAGE_BLOCK_DIR;

  async importResource(data: MigrationResourceData, signal?: AbortSignal): Promise<MigrationResult> {
    const { legacyId, entryAlias, name, mime, categoryKey, description, contentBase64, createdAt, updatedAt } = data;
    this.throwIfAborted(signal);

    // Step 1: Validate legacyId format
    if (!Types.ObjectId.isValid(legacyId)) {
      throw new MigrationError(`Invalid legacyId format: ${legacyId}`, 400, 'INVALID_ID');
    }

    // Step 2: Validate entry exists
    const entry = await this.validateEntry(entryAlias);
    this.throwIfAborted(signal);

    // Step 3: Decode base64 content to temp file
    const tempFilePath = await this.decodeBase64ToTemp(contentBase64);
    this.throwIfAborted(signal);

    try {
      // Step 4: Compute SHA256 and get size
      const sha256 = await this.computeSHA256(tempFilePath, signal);
      const stats = await fs.stat(tempFilePath);
      const size = stats.size;
      this.throwIfAborted(signal);

      // Step 5: Validate file size against entry config
      this.validateFileSize(size, entry.uploadConfig);

      // Step 6: Check existing resource for idempotency/conflict
      const existingCheck = await this.checkExistingResource(legacyId, sha256, name, entry._id.toString());
      if (existingCheck.existingResource) {
        // Idempotent - resource already exists with same content
        await fs.unlink(tempFilePath).catch(() => {});
        return {
          resource: existingCheck.existingResource,
          isNew: false,
          block: existingCheck.block!
        };
      }
      if (existingCheck.conflict) {
        // Conflict - same ID but different content
        await fs.unlink(tempFilePath).catch(() => {});
        throw new MigrationError(
          `Resource with ID ${legacyId} already exists but with different content`,
          409,
          'CONFLICT'
        );
      }

      // Step 7: Handle block deduplication with custom timestamps
      const block = await this.handleBlockDeduplication(sha256, size, tempFilePath, createdAt, updatedAt, signal);
      this.throwIfAborted(signal);

      // Step 8: Create resource with custom _id and timestamps
      const resource = await this.createResourceWithLegacyId({
        legacyId,
        entry,
        block,
        name,
        mime,
        categoryKey,
        description,
        createdAt,
        updatedAt
      });

      // Step 9: Log success
      await this.logMigrationAction({
        legacyId,
        entryAlias,
        sha256,
        size,
        result: 'created',
        isNew: true
      });

      return { resource, isNew: true, block };

    } catch (error) {
      // Clean up temp file on error
      await fs.unlink(tempFilePath).catch(() => {});

      // Log failure
      if (!(error instanceof MigrationError)) {
        await this.logMigrationAction({
          legacyId,
          entryAlias,
          result: 'failed',
          error: (error as Error).message
        });
      }

      throw error;
    }
  }

  private async validateEntry(alias: string): Promise<IEntry> {
    const entry = await Entry.findOne({
      alias,
      isInvalid: { $ne: true }
    });

    if (!entry) {
      throw new MigrationError(`Entry not found: ${alias}`, 404, 'ENTRY_NOT_FOUND');
    }

    return entry;
  }

  private async decodeBase64ToTemp(base64Content: string): Promise<string> {
    try {
      const buffer = Buffer.from(base64Content, 'base64');
      const tempFileName = `migration-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      const tempFilePath = path.join(this.tempDir, tempFileName);

      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.writeFile(tempFilePath, buffer);

      return tempFilePath;
    } catch {
      throw new MigrationError('Invalid base64 content', 400, 'INVALID_BASE64');
    }
  }

  private async computeSHA256(filePath: string, signal?: AbortSignal): Promise<string> {
    const hash = crypto.createHash('sha256');
    const fileHandle = await fs.open(filePath, 'r');

    try {
      const buffer = Buffer.alloc(65536);
      let bytesRead: number;

      do {
        this.throwIfAborted(signal);
        bytesRead = await fileHandle.read(buffer, 0, buffer.length, null)
          .then(result => result.bytesRead);
        if (bytesRead > 0) {
          hash.update(buffer.subarray(0, bytesRead));
        }
      } while (bytesRead > 0);

      this.throwIfAborted(signal);
      return hash.digest('hex');
    } finally {
      await fileHandle.close();
    }
  }

  private validateFileSize(size: number, uploadConfig?: { maxFileSize?: number }): void {
    if (uploadConfig?.maxFileSize && size > uploadConfig.maxFileSize) {
      throw new MigrationError(
        `File size ${size} exceeds limit: ${uploadConfig.maxFileSize}`,
        400,
        'FILE_TOO_LARGE'
      );
    }
  }

  private async checkExistingResource(
    legacyId: string,
    expectedSha256: string,
    expectedName: string,
    expectedEntryId: string
  ): Promise<{ existingResource?: IResource; block?: IBlock; conflict: boolean }> {
    const existingResource = await Resource.findById(legacyId);

    if (!existingResource) {
      return { conflict: false };
    }

    // Resource exists - check if it's the same content
    const block = await Block.findById(existingResource.block);
    if (!block) {
      return { conflict: true };
    }

    const isSameContent = block.sha256 === expectedSha256;
    const isSameName = existingResource.name === expectedName;
    const isSameEntry = existingResource.entry.toString() === expectedEntryId;

    if (isSameContent && isSameName && isSameEntry) {
      // Idempotent - same resource
      return { existingResource, block, conflict: false };
    }

    // Conflict - different content
    return { conflict: true };
  }

  private async handleBlockDeduplication(
    sha256: string,
    size: number,
    tempFilePath: string,
    createdAt?: number,
    updatedAt?: number,
    signal?: AbortSignal
  ): Promise<IBlock> {
    const now = Date.now();
    const blockCreatedAt = createdAt || now;
    const blockUpdatedAt = updatedAt || now;
    const storageName = generateStorageName(sha256);
    const blockPath = this.getStoragePath(storageName);

    let block: IBlock | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (!block && retryCount < maxRetries) {
      this.throwIfAborted(signal);
      try {
        // Try to create new block
        block = await Block.create({
          sha256,
          size,
          linkCount: 1,
          isInvalid: false,
          createdAt: blockCreatedAt,
          updatedAt: blockUpdatedAt,
        });

        // Write file for new block
        const objectIdBuffer = (block._id as any).id || Buffer.from(block._id.toString(), 'hex');
        const iv = generateIV(objectIdBuffer);

        await this.ensureDirectoryExists(path.dirname(blockPath));

        let fileExists = false;
        try {
          await fs.access(blockPath);
          fileExists = true;
        } catch {
          // File doesn't exist
        }

        if (!fileExists) {
          await this.encryptAndMoveFile(tempFilePath, blockPath, iv, signal);
        } else {
          await fs.unlink(tempFilePath).catch(() => {});
        }

        return block;

      } catch (error: any) {
        // Duplicate key error - block already exists
        if (error.code === 11000 && error.message?.includes('sha256')) {
          const updated = await Block.findOneAndUpdate(
            { sha256, isInvalid: { $ne: true } },
            { $inc: { linkCount: 1 }, $set: { updatedAt: now } },
            { returnDocument: 'after' }
          );

          if (updated) {
            await fs.unlink(tempFilePath).catch(() => {});
            return updated;
          }

          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 10 * retryCount));
          }
        } else {
          throw error;
        }
      }
    }

    throw new MigrationError(
      `Failed to deduplicate block after ${maxRetries} retries`,
      500,
      'BLOCK_DEDUP_FAILED'
    );
  }

  private async encryptAndMoveFile(
    tempFilePath: string,
    blockPath: string,
    iv: Buffer,
    signal?: AbortSignal
  ): Promise<void> {
    this.throwIfAborted(signal);
    const encryptStream = createEncryptStream(iv);
    const readStream = createReadStream(tempFilePath);
    const writeStream = createWriteStream(blockPath);

    try {
      await pipeline(readStream, encryptStream, writeStream);
      this.throwIfAborted(signal);
    } catch (error) {
      try {
        await fs.unlink(blockPath);
      } catch {
        // Ignore cleanup error
      }
      throw error;
    } finally {
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore cleanup error
      }
    }
  }

  private async createResourceWithLegacyId(params: {
    legacyId: string;
    entry: IEntry;
    block: IBlock;
    name: string;
    mime?: string | undefined;
    categoryKey?: string | undefined;
    description?: string | undefined;
    createdAt?: number | undefined;
    updatedAt?: number | undefined;
  }): Promise<IResource> {
    const { legacyId, entry, block, name, mime, categoryKey, description, createdAt, updatedAt } = params;
    const now = Date.now();
    const resourceCreatedAt = createdAt || now;
    const resourceUpdatedAt = updatedAt || now;

    const resource = new Resource({
      _id: new Types.ObjectId(legacyId),
      entry: entry._id,
      block: block._id,
      name: name || '',
      description: description || '',
      mime: mime || undefined,
      categoryKey: categoryKey || undefined,
      createdAt: resourceCreatedAt,
      updatedAt: resourceUpdatedAt,
      lastAccessedAt: resourceCreatedAt,
    });

    try {
      return await resource.save();
    } catch (error: any) {
      // Rollback block linkCount if resource creation fails
      await Block.findByIdAndUpdate(block._id, {
        $inc: { linkCount: -1 }
      });

      if (error.code === 11000) {
        throw new MigrationError(
          `Resource with ID ${legacyId} already exists`,
          409,
          'DUPLICATE_ID'
        );
      }

      throw error;
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private getStoragePath(storageName: string): string {
    const relativePath = getStoragePath(storageName);
    return path.join(this.blocksDir, relativePath);
  }

  private async logMigrationAction(params: {
    legacyId: string;
    entryAlias: string;
    sha256?: string;
    size?: number;
    result: 'created' | 'idempotent' | 'failed';
    isNew?: boolean;
    error?: string;
  }): Promise<void> {
    const { legacyId, entryAlias, sha256, size, result, isNew, error } = params;

    try {
      await logService.logIssue({
        level: result === 'failed' ? LogLevel.ERROR : LogLevel.INFO,
        category: result === 'failed' ? LogCategory.RUNTIME_ERROR : LogCategory.CLEANUP_ACTION,
        details: {
          action: 'migration_import',
          legacyId,
          entryAlias,
          sha256,
          size,
          result,
          isNew,
          error,
        },
        suggestedAction: result === 'failed'
          ? 'Check error details and retry'
          : 'Migration completed successfully',
        recoverable: result === 'failed',
        dataLossRisk: result === 'failed' ? DataLossRisk.LOW : DataLossRisk.NONE,
        context: {
          detectedBy: 'migrationService',
          detectedAt: Date.now(),
          environment: env.NODE_ENV as 'development' | 'production' | 'test',
        },
      });
    } catch (logError) {
      // Don't fail the migration if logging fails
      console.error('Failed to log migration action:', logError);
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const abortError = new Error('Request aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
  }
}

// Export singleton instance
export const migrationService = new MigrationService();
