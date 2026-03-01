#!/usr/bin/env node

/**
 * Resource Block - Concurrent Upload Stress Test
 *
 * Test specifications:
 * - Files: 5000
 * - Concurrency: 20
 * - File size: 1KB - 10MB (random)
 * - Strategy: Stop on first error
 *
 * Usage: node scripts/stress-test.mjs
 */

import { randomBytes, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load environment variables from .env file
 */
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Ignore if .env doesn't exist
  }
}

loadEnv();

const CONFIG = {
  FILE_COUNT: 5000,
  CONCURRENCY: 20,
  MIN_SIZE: 1024,
  MAX_SIZE: 10 * 1024 * 1024,
  BASE_URL: `http://127.0.0.1:${process.env.PORT || process.env.SERVER_PORT || 4362}`,
};

// Semaphore for concurrency control
class Semaphore {
  #capacity;
  #current = 0;
  #queue = [];

  constructor(capacity) {
    this.#capacity = capacity;
  }

  acquire() {
    if (this.#current < this.#capacity) {
      this.#current++;
      return Promise.resolve();
    }
    return new Promise(resolve => this.#queue.push(resolve));
  }

  release() {
    const next = this.#queue.shift();
    if (next) {
      next();
    } else {
      this.#current--;
    }
  }
}

// Helpers
const getRandomSize = () =>
  Math.floor(Math.random() * (CONFIG.MAX_SIZE - CONFIG.MIN_SIZE + 1)) + CONFIG.MIN_SIZE;

const formatBytes = bytes => {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${'BKMG'.split('')[i]}B`.replace('BB', 'B');
};

// API helpers
const request = async (url, options = {}) => {
  const res = await fetch(`${CONFIG.BASE_URL}${url}`, options);
  if (!res.ok && res.status !== 404)
    throw new Error(`${options.method || 'GET'} ${url} → ${res.status} ${res.statusText}`);
  return res;
};

const createEntry = async () => {
  const ts = Date.now();
  const res = await request('/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Stress Test Entry ${ts}`, alias: `stress-test-${ts}` }),
  });
  return res.json();
};

const uploadFile = async (alias, buffer) => {
  const res = await request(`/upload/${alias}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
  return res.json();
};

const deleteResource = id => request(`/resources/${id}`, { method: 'DELETE' });
const deleteEntry = id => request(`/entries/${id}`, { method: 'DELETE' });

// SHA256 helpers
const computeSha256 = (buffer) => {
  const hash = createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
};

const downloadResource = async (id) => {
  const res = await fetch(`${CONFIG.BASE_URL}/resources/${id}/download`);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

// Run tasks with bounded concurrency, abort on first error
const runConcurrent = async (items, concurrency, task, onProgress) => {
  const sem = new Semaphore(concurrency);
  const results = [];
  await Promise.all(
    items.map(async (item, i) => {
      await sem.acquire();
      try {
        const result = await task(item, i);
        results.push(result);
        onProgress?.(results.length, items.length);
      } finally {
        sem.release();
      }
    })
  );
  return results;
};

const progressLogger = (label, total, step = 500) => (count) => {
  if (count % step === 0)
    console.log(`  ${label}: ${count}/${total} (${((count / total) * 100).toFixed(1)}%)`);
};

// Main
async function runStressTest() {
  console.log('🚀 Resource Block Stress Test');
  console.log('=============================');
  console.log(`  Files: ${CONFIG.FILE_COUNT.toLocaleString()}`);
  console.log(`  Concurrency: ${CONFIG.CONCURRENCY}`);
  console.log(`  File size: ${formatBytes(CONFIG.MIN_SIZE)} – ${formatBytes(CONFIG.MAX_SIZE)}`);
  console.log(`  Base URL: ${CONFIG.BASE_URL}\n`);

  const start = Date.now();
  let entry = null;

  try {
    // Step 1: Create entry
    console.log('📁 Step 1: Creating test entry...');
    entry = await createEntry();
    console.log(`✅ Entry created: ${entry._id} (alias: ${entry.alias})\n`);

    // Step 2: Upload
    console.log(`📤 Step 2: Uploading ${CONFIG.FILE_COUNT} files...`);
    const uploadStart = Date.now();
    let totalBytes = 0;

    const resources = await runConcurrent(
      Array.from({ length: CONFIG.FILE_COUNT }),
      CONFIG.CONCURRENCY,
      async () => {
        const size = getRandomSize();
        const buf = randomBytes(size);
        const sha256 = computeSha256(buf);
        const result = await uploadFile(entry.alias, buf);
        totalBytes += size;
        return { ...result, originalSha256: sha256 };
      },
      progressLogger('Progress', CONFIG.FILE_COUNT)
    );

    const uploadSecs = (Date.now() - uploadStart) / 1000;
    const uploadSpeed = (totalBytes / uploadSecs / 1024 / 1024).toFixed(2);
    console.log(`✅ Upload complete: ${resources.length} files`);
    console.log(`   Total size: ${formatBytes(totalBytes)}`);
    console.log(`   Duration: ${uploadSecs.toFixed(2)}s`);
    console.log(`   Speed: ${uploadSpeed} MB/s\n`);

    // Step 3: Query by entryAlias
    console.log(`🔍 Step 3: Querying resources by entryAlias (${entry.alias})...`);
    const queryStart = Date.now();
    const QUERY_COUNT = 100;

    const queryResults = await runConcurrent(
      Array.from({ length: QUERY_COUNT }),
      CONFIG.CONCURRENCY,
      async () => {
        const res = await fetch(`${CONFIG.BASE_URL}/resources?entryAlias=${entry.alias}`);
        if (!res.ok) throw new Error(`Query failed: ${res.status}`);
        return res.json();
      },
      progressLogger('Query', QUERY_COUNT, 10)
    );

    const querySecs = (Date.now() - queryStart) / 1000;
    console.log(`✅ Query complete: ${QUERY_COUNT} queries`);
    console.log(`   Duration: ${querySecs.toFixed(2)}s`);
    console.log(`   Avg query time: ${(querySecs / QUERY_COUNT * 1000).toFixed(2)}ms`);
    // Verify result count
    const sampleResult = queryResults[0];
    console.log(`   Resources found: ${sampleResult.total} (expected: ${resources.length})`);
    if (sampleResult.total !== resources.length) {
      throw new Error(`Query result mismatch: expected ${resources.length}, got ${sampleResult.total}`);
    }
    console.log();

    // Step 3.5: Download and verify sha256
    console.log('🔐 Step 3.5: Verifying sha256 checksums...');
    const SAMPLE_SIZE = 10;
    const sampleResources = resources.slice(0, SAMPLE_SIZE);
    const verifyStart = Date.now();

    await runConcurrent(
      sampleResources,
      CONFIG.CONCURRENCY,
      async (resource) => {
        const downloadedBuffer = await downloadResource(resource._id);
        const downloadedSha256 = computeSha256(downloadedBuffer);

        if (downloadedSha256 !== resource.originalSha256) {
          throw new Error(
            `SHA256 mismatch for resource ${resource._id}: ` +
            `expected ${resource.originalSha256}, got ${downloadedSha256}`
          );
        }
      }
    );

    const verifySecs = (Date.now() - verifyStart) / 1000;
    console.log(`✅ SHA256 verification passed for ${SAMPLE_SIZE} files`);
    console.log(`   Duration: ${verifySecs.toFixed(2)}s`);
    console.log(`   Avg verify time: ${(verifySecs / SAMPLE_SIZE * 1000).toFixed(2)}ms per file\n`);

    // Step 4: Delete resources
    console.log(`🗑️  Step 4: Deleting ${resources.length} resources...`);
    const deleteStart = Date.now();

    await runConcurrent(
      resources,
      CONFIG.CONCURRENCY,
      r => deleteResource(r._id),
      progressLogger('Progress', resources.length)
    );

    const deleteSecs = (Date.now() - deleteStart) / 1000;
    console.log(`✅ Deletion complete: ${resources.length} resources`);
    console.log(`   Duration: ${deleteSecs.toFixed(2)}s\n`);

    // Step 5: Cleanup entry
    console.log('📁 Step 5: Cleaning up entry...');
    await deleteEntry(entry._id);
    console.log(`✅ Entry deleted: ${entry._id}\n`);

    const totalSecs = (Date.now() - start) / 1000;
    console.log('📊 Test Summary');
    console.log('===============');
    console.log(`Total duration: ${totalSecs.toFixed(2)}s`);
    console.log(`Files uploaded: ${resources.length}`);
    console.log(`Total data: ${formatBytes(totalBytes)}`);
    console.log(`Average upload speed: ${uploadSpeed} MB/s`);
    console.log(`Query tests: ${QUERY_COUNT} queries, avg ${(querySecs / QUERY_COUNT * 1000).toFixed(2)}ms each`);
    console.log(`SHA256 verify: ${SAMPLE_SIZE} files, avg ${(verifySecs / SAMPLE_SIZE * 1000).toFixed(2)}ms per file\n`);
    console.log('✅ All tests passed successfully!');

  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);

    if (entry) {
      console.error('\nAttempting cleanup...');
      try {
        // Best-effort cleanup without full resource list (partial uploads)
        await deleteEntry(entry._id);
        console.error('✅ Entry cleanup completed');
      } catch (e) {
        console.error(`⚠️  Cleanup failed: ${e.message}`);
      }
    }

    process.exit(1);
  }
}

runStressTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
