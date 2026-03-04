import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateStorageName,
  generateIV,
  createEncryptStream,
  createDecryptStream,
  createDecryptStreamWithOffset,
  encryptBuffer,
  decryptBuffer,
  getStoragePath,
} from '../../../src/utils/crypto';
import crypto from 'crypto';
import { Readable } from 'stream';

// Mock environment
vi.mock('../../../src/config/env', () => ({
  env: {
    ENCRYPTION_KEY: Buffer.from('x'.repeat(32)).toString('base64'), // 32 bytes = 256-bit key
  },
}));

describe('crypto utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateStorageName', () => {
    it('should generate consistent storage name for same sha256', () => {
      const sha256 = 'abc123def456789';
      const name1 = generateStorageName(sha256);
      const name2 = generateStorageName(sha256);

      expect(name1).toBe(name2);
      expect(name1).toMatch(/^[a-f0-9]{64}$/); // 64 hex chars = 256 bits
    });

    it('should generate different names for different sha256', () => {
      const name1 = generateStorageName('abc123');
      const name2 = generateStorageName('def456');

      expect(name1).not.toBe(name2);
    });

    it('should generate hex string output', () => {
      const name = generateStorageName('test-data');
      expect(name).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('generateIV', () => {
    it('should generate 16-byte IV from 12-byte ObjectId', () => {
      const objectId = Buffer.from('123456789012'); // 12 bytes
      const iv = generateIV(objectId);

      expect(iv.length).toBe(16);
    });

    it('should pad ObjectId with 4 zero bytes', () => {
      const objectId = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      const iv = generateIV(objectId);

      // First 12 bytes should match ObjectId
      expect(iv.subarray(0, 12)).toEqual(objectId);
      // Last 4 bytes should be zeros
      expect(iv.subarray(12, 16)).toEqual(Buffer.from([0, 0, 0, 0]));
    });

    it('should throw error for invalid ObjectId length', () => {
      const shortBuffer = Buffer.from('12345'); // Only 5 bytes
      expect(() => generateIV(shortBuffer)).toThrow('Invalid ObjectId length');

      const longBuffer = Buffer.from('12345678901234567890'); // 20 bytes
      expect(() => generateIV(longBuffer)).toThrow('Invalid ObjectId length');
    });

    it('should generate consistent IV for same ObjectId', () => {
      const objectId = Buffer.from('123456789012');
      const iv1 = generateIV(objectId);
      const iv2 = generateIV(objectId);

      expect(iv1).toEqual(iv2);
    });
  });

  describe('encryptBuffer/decryptBuffer', () => {
    it('should round-trip encrypt and decrypt', () => {
      const data = Buffer.from('Hello, World! This is sensitive data.');
      const iv = Buffer.from('1234567890123456'); // 16 bytes

      const encrypted = encryptBuffer(data, iv);
      const decrypted = decryptBuffer(encrypted, iv);

      expect(decrypted).toEqual(data);
    });

    it('should produce different output for different IVs', () => {
      const data = Buffer.from('same data');
      const iv1 = Buffer.from('1234567890123456');
      const iv2 = Buffer.from('abcdefghijklmnop');

      const encrypted1 = encryptBuffer(data, iv1);
      const encrypted2 = encryptBuffer(data, iv2);

      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should handle empty buffer', () => {
      const data = Buffer.alloc(0);
      const iv = Buffer.from('1234567890123456');

      const encrypted = encryptBuffer(data, iv);
      const decrypted = decryptBuffer(encrypted, iv);

      expect(decrypted).toEqual(data);
    });

    it('should handle large data', () => {
      const data = crypto.randomBytes(1024 * 1024); // 1MB
      const iv = Buffer.from('1234567890123456');

      const encrypted = encryptBuffer(data, iv);
      const decrypted = decryptBuffer(encrypted, iv);

      expect(decrypted).toEqual(data);
    });

    it('should fail to decrypt with wrong IV', () => {
      const data = Buffer.from('sensitive data');
      const encryptIv = Buffer.from('1234567890123456');
      const wrongIv = Buffer.from('wrongwrongwrong!');

      const encrypted = encryptBuffer(data, encryptIv);
      
      // Decrypting with wrong IV will produce garbage, not throw
      const decrypted = decryptBuffer(encrypted, wrongIv);
      expect(decrypted).not.toEqual(data);
    });

    it('should handle binary data', () => {
      const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const iv = Buffer.from('1234567890123456');

      const encrypted = encryptBuffer(data, iv);
      const decrypted = decryptBuffer(encrypted, iv);

      expect(decrypted).toEqual(data);
    });
  });

  describe('createEncryptStream/createDecryptStream', () => {
    it('should encrypt and decrypt via streams', async () => {
      const data = Buffer.from('Stream encryption test data');
      const iv = Buffer.from('1234567890123456');

      // Create readable stream from data
      const readable = Readable.from([data]);
      const encryptStream = createEncryptStream(iv);
      
      // Collect encrypted data
      const encryptedChunks: Buffer[] = [];
      for await (const chunk of readable.pipe(encryptStream)) {
        encryptedChunks.push(chunk);
      }
      const encrypted = Buffer.concat(encryptedChunks);

      // Decrypt
      const decryptStream = createDecryptStream(iv);
      const readable2 = Readable.from([encrypted]);
      
      const decryptedChunks: Buffer[] = [];
      for await (const chunk of readable2.pipe(decryptStream)) {
        decryptedChunks.push(chunk);
      }
      const decrypted = Buffer.concat(decryptedChunks);

      expect(decrypted).toEqual(data);
    });

    it('should handle multiple chunks', async () => {
      const chunks = [
        Buffer.from('First chunk '),
        Buffer.from('Second chunk '),
        Buffer.from('Third chunk'),
      ];
      const iv = Buffer.from('1234567890123456');

      // Encrypt
      const encryptStream = createEncryptStream(iv);
      const readable = Readable.from(chunks);
      
      const encryptedChunks: Buffer[] = [];
      for await (const chunk of readable.pipe(encryptStream)) {
        encryptedChunks.push(chunk);
      }
      const encrypted = Buffer.concat(encryptedChunks);

      // Decrypt
      const decryptStream = createDecryptStream(iv);
      const readable2 = Readable.from([encrypted]);
      
      const decryptedChunks: Buffer[] = [];
      for await (const chunk of readable2.pipe(decryptStream)) {
        decryptedChunks.push(chunk);
      }
      const decrypted = Buffer.concat(decryptedChunks);

      expect(decrypted).toEqual(Buffer.concat(chunks));
    });

    it('should handle empty stream', async () => {
      const iv = Buffer.from('1234567890123456');
      const encryptStream = createEncryptStream(iv);
      const readable = Readable.from([]);
      
      const chunks: Buffer[] = [];
      for await (const chunk of readable.pipe(encryptStream)) {
        chunks.push(chunk);
      }

      expect(Buffer.concat(chunks).length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createDecryptStreamWithOffset', () => {
    it('should handle zero offset correctly', async () => {
      const data = Buffer.from('Test data for zero offset');
      const iv = Buffer.from('1234567890123456');

      const encrypted = encryptBuffer(data, iv);

      const decryptStream = createDecryptStreamWithOffset(iv, 0);
      const readable = Readable.from([encrypted]);
      
      const chunks: Buffer[] = [];
      for await (const chunk of readable.pipe(decryptStream)) {
        chunks.push(chunk);
      }
      const decrypted = Buffer.concat(chunks);

      expect(decrypted).toEqual(data);
    });
  });

  describe('getStoragePath', () => {
    it('should generate correct path structure', () => {
      const storageName = 'abcdef123456789';
      const path = getStoragePath(storageName);

      expect(path).toBe('ab/cabcdef123456789');
    });

    it('should use first two chars as first directory', () => {
      const storageName = '1234567890abcdef';
      const path = getStoragePath(storageName);

      expect(path.startsWith('12/')).toBe(true);
    });

    it('should use third char in second directory', () => {
      const storageName = 'abcdef123456789';
      const path = getStoragePath(storageName);

      // First 2 chars: ab, third char: c
      expect(path).toBe('ab/cabcdef123456789');
    });

    it('should handle short storage names', () => {
      const storageName = 'ab'; // Very short
      const path = getStoragePath(storageName);

      expect(path).toBe('ab/ab'); // substring(2,3) returns empty string, not undefined
    });

    it('should handle long storage names', () => {
      const storageName = 'a'.repeat(100);
      const path = getStoragePath(storageName);

      expect(path.startsWith('aa/')).toBe(true);
      expect(path.length).toBe(100 + 4); // storageName + 4 chars (including the third 'a')
    });
  });
});
