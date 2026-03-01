#!/usr/bin/env node

/**
 * Import Images Script
 * 
 * 导入项目中的 imgs 目录到 Reblock
 * - 创建 Entry，设置 mime: image/*, maxSize: 500KB
 * - 并发上传所有图片文件（Entry 会做决策是否拒绝）
 * - 验证上传结果：文件数量、SHA256、文件名、文件大小
 * 
 * Usage: node scripts/import-imgs.mjs [imgs_dir]
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

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
  IMGS_DIR: process.argv[2] || './imgs',
  MAX_FILE_SIZE: 500 * 1024, // 500KB
  ALLOWED_MIME_TYPES: ['image/*'],
  ENTRY_NAME: 'Imported Images',
  BASE_URL: `http://127.0.0.1:${process.env.PORT || process.env.SERVER_PORT || 4362}`,
  CONCURRENCY: 10, // 并发数
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

// API helpers
const request = async (url, options = {}) => {
  const res = await fetch(`${CONFIG.BASE_URL}${url}`, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(`${options.method || 'GET'} ${url} → ${res.status} ${res.statusText}`);
    error.status = res.status;
    error.response = data;
    throw error;
  }
  return data;
};

const createEntry = async () => {
  const ts = Date.now();
  const alias = `imported-imgs-${ts}`;
  return request('/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `${CONFIG.ENTRY_NAME} ${new Date().toISOString()}`,
      alias,
      description: `Imported from ${CONFIG.IMGS_DIR} with image/* mime type and 500KB size limit`,
      uploadConfig: {
        maxFileSize: CONFIG.MAX_FILE_SIZE,
        allowedMimeTypes: CONFIG.ALLOWED_MIME_TYPES,
      },
    }),
  });
};

const uploadFile = async (alias, filePath, fileName) => {
  const buffer = readFileSync(filePath);
  const res = await fetch(`${CONFIG.BASE_URL}/upload/${alias}?name=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
  
  if (!res.ok) {
    const error = new Error(`Upload failed: ${res.status} ${res.statusText}`);
    error.status = res.status;
    error.fileName = fileName;
    try {
      error.response = await res.json();
    } catch {
      error.response = null;
    }
    throw error;
  }
  
  return res.json();
};

const getResources = async (entryAlias) => {
  const res = await fetch(`${CONFIG.BASE_URL}/resources?entryAlias=${entryAlias}`);
  if (!res.ok) throw new Error(`Query failed: ${res.status}`);
  return res.json();
};

const deleteEntry = (id) => request(`/entries/${id}`, { method: 'DELETE' });

// File helpers
const computeSha256 = (buffer) => {
  return createHash('sha256').update(buffer).digest('hex');
};

const scanDirectory = (dir) => {
  const files = [];
  const items = readdirSync(dir);
  
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    
    if (stat.isFile()) {
      const buffer = readFileSync(fullPath);
      files.push({
        path: fullPath,
        name: item,
        size: stat.size,
        sha256: computeSha256(buffer),
      });
    }
  }
  
  return files;
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${'BKMGTP'.split('')[i]}B`.replace('BB', 'B');
};

// Concurrent upload function
const uploadConcurrent = async (files, alias) => {
  const sem = new Semaphore(CONFIG.CONCURRENCY);
  const results = { success: [], failed: [] };

  await Promise.all(
    files.map(async (file, index) => {
      await sem.acquire();
      try {
        const resource = await uploadFile(alias, file.path, file.name);
        results.success.push({ local: file, remote: resource });
        console.log(`  ✅ [${index + 1}/${files.length}] ${file.name} (${formatBytes(file.size)})`);
      } catch (error) {
        results.failed.push({ file, error: error.message, status: error.status });
        console.log(`  ❌ [${index + 1}/${files.length}] ${file.name} - ${error.message}`);
      } finally {
        sem.release();
      }
    })
  );

  return results;
};

// Main
async function importImages() {
  console.log('📁 Image Import Script');
  console.log('======================');
  console.log(`  Source: ${CONFIG.IMGS_DIR}`);
  console.log(`  Max Size: ${formatBytes(CONFIG.MAX_FILE_SIZE)}`);
  console.log(`  Allowed MIME: ${CONFIG.ALLOWED_MIME_TYPES.join(', ')}`);
  console.log(`  Concurrency: ${CONFIG.CONCURRENCY}`);
  console.log(`  Base URL: ${CONFIG.BASE_URL}\n`);

  // Step 1: Scan directory
  console.log('🔍 Step 1: Scanning directory...');
  const imgDir = resolve(CONFIG.IMGS_DIR);
  let localFiles;
  try {
    localFiles = scanDirectory(imgDir);
  } catch (error) {
    console.error(`❌ Failed to scan directory: ${error.message}`);
    process.exit(1);
  }
  
  console.log(`✅ Found ${localFiles.length} files`);
  
  // Show file size distribution
  const oversizedFiles = localFiles.filter(f => f.size > CONFIG.MAX_FILE_SIZE);
  const validFiles = localFiles.filter(f => f.size <= CONFIG.MAX_FILE_SIZE);
  
  console.log(`   - Valid size (≤500KB): ${validFiles.length}`);
  console.log(`   - Oversized (>500KB): ${oversizedFiles.length}`);
  
  if (oversizedFiles.length > 0) {
    console.log(`   ⚠️  ${oversizedFiles.length} files will be rejected due to size limit`);
  }
  console.log();

  let entry = null;
  
  try {
    // Step 2: Create entry
    console.log('📂 Step 2: Creating entry...');
    entry = await createEntry();
    console.log(`✅ Entry created: ${entry._id}`);
    console.log(`   Alias: ${entry.alias}`);
    console.log(`   Upload config:`, JSON.stringify(entry.uploadConfig, null, 2));
    console.log();

    // Step 3: Upload files (concurrent)
    console.log(`📤 Step 3: Uploading files (${CONFIG.CONCURRENCY} concurrent)...`);
    const uploadStart = Date.now();
    
    const results = await uploadConcurrent(localFiles, entry.alias);

    const uploadSecs = (Date.now() - uploadStart) / 1000;
    console.log();
    console.log(`✅ Upload complete`);
    console.log(`   Success: ${results.success.length}`);
    console.log(`   Failed: ${results.failed.length}`);
    console.log(`   Duration: ${uploadSecs.toFixed(2)}s`);
    console.log();

    // Step 4: Query uploaded resources
    console.log('🔍 Step 4: Querying uploaded resources...');
    const remoteResources = await getResources(entry.alias);
    console.log(`✅ Found ${remoteResources.total} resources in entry`);
    console.log();

    // Step 5: Verification
    console.log('🔍 Step 5: Verification...');
    const verification = {
      fileCount: {
        expected: localFiles.length,
        uploaded: results.success.length,
        remoteTotal: remoteResources.total,
        passed: results.success.length === remoteResources.total,
      },
      sha256: { passed: 0, failed: 0, details: [] },
      fileName: { passed: 0, failed: 0, details: [] },
      fileSize: { passed: 0, failed: 0, details: [] },
    };

    // Create a map of remote resources by name for quick lookup
    const remoteMap = new Map(remoteResources.items.map(r => [r.name, r]));

    // Verify each successful upload
    for (const { local, remote } of results.success) {
      // Get the latest resource data from query (it has sha256 and size populated)
      const latestRemote = remoteMap.get(local.name);
      
      // Verify SHA256
      if (local.sha256 === latestRemote?.sha256) {
        verification.sha256.passed++;
      } else {
        verification.sha256.failed++;
        verification.sha256.details.push({
          file: local.name,
          expected: local.sha256,
          actual: latestRemote?.sha256,
        });
      }

      // Verify file name
      if (local.name === remote.name) {
        verification.fileName.passed++;
      } else {
        verification.fileName.failed++;
        verification.fileName.details.push({
          file: local.name,
          expected: local.name,
          actual: remote.name,
        });
      }

      // Verify file size
      if (local.size === latestRemote?.size) {
        verification.fileSize.passed++;
      } else {
        verification.fileSize.failed++;
        verification.fileSize.details.push({
          file: local.name,
          expected: local.size,
          actual: latestRemote?.size,
        });
      }
    }

    // Display verification results
    console.log('   File Count Check:');
    console.log(`     - Expected: ${verification.fileCount.expected}`);
    console.log(`     - Successfully uploaded: ${verification.fileCount.uploaded}`);
    console.log(`     - Remote total: ${verification.fileCount.remoteTotal}`);
    console.log(`     - Status: ${verification.fileCount.passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log();

    console.log('   SHA256 Check:');
    console.log(`     - Passed: ${verification.sha256.passed}`);
    console.log(`     - Failed: ${verification.sha256.failed}`);
    console.log();

    console.log('   File Name Check:');
    console.log(`     - Passed: ${verification.fileName.passed}`);
    console.log(`     - Failed: ${verification.fileName.failed}`);
    console.log();

    console.log('   File Size Check:');
    console.log(`     - Passed: ${verification.fileSize.passed}`);
    console.log(`     - Failed: ${verification.fileSize.failed}`);
    console.log();

    // Summary
    const allPassed = 
      verification.fileCount.passed &&
      verification.sha256.failed === 0 &&
      verification.fileName.failed === 0 &&
      verification.fileSize.failed === 0;

    console.log('📊 Summary');
    console.log('==========');
    console.log(`Total files scanned: ${localFiles.length}`);
    console.log(`Successfully uploaded: ${results.success.length}`);
    console.log(`Failed uploads: ${results.failed.length}`);
    console.log(`Remote resources: ${remoteResources.total}`);
    console.log();
    
    if (results.failed.length > 0) {
      console.log('Failed uploads (expected if >500KB or not image):');
      for (const { file, error, status } of results.failed) {
        console.log(`  - ${file.name} (${formatBytes(file.size)}): ${error}`);
      }
      console.log();
    }

    if (allPassed) {
      console.log('✅ All verification checks PASSED!');
    } else {
      console.log('❌ Some verification checks FAILED!');
    }

    console.log();
    console.log(`Entry ID: ${entry._id}`);
    console.log(`Entry Alias: ${entry.alias}`);
    console.log(`Entry URL: ${CONFIG.BASE_URL}/entries/${entry.alias}`);

  } catch (error) {
    console.error(`\n❌ Import failed: ${error.message}`);
    
    if (entry) {
      console.error('\nCleaning up...');
      try {
        await deleteEntry(entry._id);
        console.error('✅ Entry cleaned up');
      } catch (e) {
        console.error(`⚠️  Cleanup failed: ${e.message}`);
      }
    }

    process.exit(1);
  }
}

importImages().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
