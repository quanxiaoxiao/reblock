import crypto from 'crypto';
import { Transform } from 'stream';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-ctr';

/**
 * Cached encryption key to avoid repeated base64 parsing on every operation.
 * Parsed lazily on first use.
 */
let _cachedKey: Buffer | null = null;

/**
 * Get encryption key from environment variable (cached after first call).
 * Key must be base64 encoded 32 bytes.
 */
function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error(`Invalid encryption key length: ${key.length} bytes, expected 32 bytes`);
  }
  _cachedKey = key;
  return _cachedKey;
}

/**
 * Generate storage name from sha256 using HMAC-SHA256
 * This creates the actual filename for encrypted storage
 * @param sha256 - Original file sha256 hash
 * @returns Hex string storage name
 */
export function generateStorageName(sha256: string): string {
  const key = getEncryptionKey();
  return crypto.createHmac('sha256', key).update(sha256).digest('hex');
}

/**
 * Generate IV from MongoDB ObjectId (12 bytes) padded to 16 bytes
 * @param objectId - MongoDB ObjectId buffer (12 bytes)
 * @returns 16 byte IV buffer
 */
export function generateIV(objectId: Buffer): Buffer {
  if (objectId.length !== 12) {
    throw new Error(`Invalid ObjectId length: ${objectId.length} bytes, expected 12 bytes`);
  }
  // Pad with 4 zero bytes to reach 16 bytes
  return Buffer.concat([objectId, Buffer.from([0, 0, 0, 0])]);
}

/**
 * Create encrypt transform stream
 * @param iv - 16 byte initialization vector
 * @returns Transform stream for encryption
 */
export function createEncryptStream(iv: Buffer): Transform {
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const encrypted = cipher.update(chunk);
        callback(null, encrypted);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        const final = cipher.final();
        callback(null, final);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/**
 * Create decrypt transform stream
 * @param iv - 16 byte initialization vector
 * @returns Transform stream for decryption
 */
export function createDecryptStream(iv: Buffer): Transform {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        const decrypted = decipher.update(chunk);
        callback(null, decrypted);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        const final = decipher.final();
        callback(null, final);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/**
 * Create decrypt transform stream with byte offset (for range requests)
 * AES-CTR mode requires adjusting the counter based on the offset
 * @param iv - 16 byte initialization vector
 * @param offset - Byte offset to start decryption from
 * @returns Transform stream for decryption
 */
export function createDecryptStreamWithOffset(iv: Buffer, offset: number): Transform {
  const key = getEncryptionKey();

  // For AES-CTR, we need to adjust the IV/counter based on the offset
  // Each block is 16 bytes, so we calculate which block we're starting from
  const blockSize = 16;
  const blockIndex = Math.floor(offset / blockSize);

  // Create a new IV with adjusted counter
  // The last 4 bytes of IV are the counter in big-endian format
  // We need to ADD the block index to the counter (not XOR)
  const adjustedIv = Buffer.from(iv);
  const currentCounter = adjustedIv.readUInt32BE(12);
  const newCounter = (currentCounter + blockIndex) >>> 0; // Use >>> 0 to ensure uint32
  adjustedIv.writeUInt32BE(newCounter, 12);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, adjustedIv);

  // Track bytes processed to handle partial first block
  let bytesProcessed = 0;
  const skipBytes = offset % blockSize;

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let decrypted = decipher.update(chunk);

        // If this is the first chunk and we need to skip bytes
        if (bytesProcessed === 0 && skipBytes > 0 && decrypted.length > skipBytes) {
          decrypted = decrypted.subarray(skipBytes);
        }

        bytesProcessed += chunk.length;
        callback(null, decrypted);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        const final = decipher.final();
        callback(null, final);
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/**
 * Encrypt buffer (for small data)
 * @param data - Buffer to encrypt
 * @param iv - 16 byte initialization vector
 * @returns Encrypted buffer
 */
export function encryptBuffer(data: Buffer, iv: Buffer): Buffer {
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * Decrypt buffer (for small data)
 * @param encryptedData - Encrypted buffer
 * @param iv - 16 byte initialization vector
 * @returns Decrypted buffer
 */
export function decryptBuffer(encryptedData: Buffer, iv: Buffer): Buffer {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

/**
 * Get storage path for a block
 * @param storageName - HMAC generated storage name
 * @returns Full path to storage location
 */
export function getStoragePath(storageName: string): string {
  const prefix1 = storageName.substring(0, 2);
  const secondChar = storageName.substring(2, 3);
  return `${prefix1}/${secondChar}${storageName}`;
}
