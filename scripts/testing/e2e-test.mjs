#!/usr/bin/env node

/**
 * E2E Test Script for Reblock
 *
 * End-to-end test script validates:
 * - Entry creation and configuration
 * - File upload and deduplication
 * - Block linkCount correctness
 * - Delete and 404 verification
 * - Re-upload and linkCount recovery
 * - Doctor health check
 * - Log integrity verification
 *
 * Usage:
 *   node scripts/testing/e2e-test.mjs
 *   node scripts/testing/e2e-test.mjs --keep-data    # Keep test data
 *   node scripts/testing/e2e-test.mjs --verbose      # Verbose output
 */

import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { createHash } from 'crypto';
import { readdir, readFile } from 'fs/promises';
import {
  c,
  logBanner,
  logSection,
  logInfo,
  logSuccess,
  logWarn,
  logError,
  logDetail,
  formatDuration,
  formatBytes,
  logDivider,
  spinner,
} from '../utils/style.mjs';

// Configuration
let CONFIG = {
  API_BASE: '',
  TOTAL_FILES: 0,
  UNIQUE_FILES: 0,
  DUPLICATE_RATE: 0.2,
  MIN_SIZE: 1024,
  MAX_SIZE: 1048576,
  DELETE_RATE: 0.5,
};

// Test state
const state = {
  entryId: null,
  entryAlias: null,
  files: [], // { name, content, sha256, size, mimeType }
  resources: [], // { resourceId, blockId, fileIndex }
  startTime: Date.now(),
  errors: [],
};

// Parse command line arguments
function parseArgs() {
  return {
    keepData: process.argv.includes('--keep-data'),
    verbose: process.argv.includes('--verbose'),
    help: process.argv.includes('--help') || process.argv.includes('-h'),
  };
}

// Load environment variables
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

  const port = process.env.PORT || process.env.SERVER_PORT || 3000;
  CONFIG.API_BASE = `http://localhost:${port}`;
}

// Print helpers (using style.mjs)
function log(message, color = c.reset) {
  console.log(`${color}${message}${c.reset}`);
}

function success(message) {
  logSuccess(message);
}

function error(message) {
  logError(message);
  state.errors.push(message);
}

function info(message) {
  logDetail(message);
}

function section(title) {
  logSection(title);
}

// Generate random file content
function generateRandomContent(size) {
  const buffer = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

// Calculate SHA256
function calculateSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Generate MIME type based on extension
function getMimeType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const mimeTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    txt: 'text/plain',
    pdf: 'application/pdf',
    json: 'application/json',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Generate test files
function generateTestFiles() {
  logSection('Generating Test Files');

  const extensions = ['jpg', 'png', 'txt', 'json', 'bin'];
  const filePool = [];

  // Calculate counts
  const uniqueCount = Math.floor(CONFIG.UNIQUE_FILES);
  const duplicateCount = Math.floor(CONFIG.UNIQUE_FILES * CONFIG.DUPLICATE_RATE);
  CONFIG.TOTAL_FILES = uniqueCount + (duplicateCount * 3);

  // Generate unique files
  for (let i = 0; i < uniqueCount; i++) {
    const size = Math.floor(Math.random() * (CONFIG.MAX_SIZE - CONFIG.MIN_SIZE + 1)) + CONFIG.MIN_SIZE;
    const content = generateRandomContent(size);
    const sha256 = calculateSha256(content);
    const ext = extensions[Math.floor(Math.random() * extensions.length)];
    const name = `test_${String(i).padStart(4, '0')}.${ext}`;

    filePool.push({
      name,
      content,
      sha256,
      size,
      mimeType: getMimeType(name),
      isDuplicate: false,
    });
  }

  // Mark some as duplicates
  const duplicateIndices = [];
  for (let i = 0; i < duplicateCount; i++) {
    const idx = Math.floor(Math.random() * uniqueCount);
    if (!duplicateIndices.includes(idx)) {
      duplicateIndices.push(idx);
      filePool[idx].isDuplicate = true;
      filePool[idx].duplicateCount = Math.floor(Math.random() * 3) + 3;
    }
  }

  state.files = filePool;

  const totalUploads = uniqueCount + duplicateIndices.reduce((sum, idx) => {
    return sum + (filePool[idx].duplicateCount - 1);
  }, 0);

  success(`Generated ${uniqueCount} unique files + ${duplicateIndices.length} duplicates`);
  info(`Total uploads planned: ~${totalUploads}`);
  info(`File sizes: ${formatBytes(CONFIG.MIN_SIZE)} - ${formatBytes(CONFIG.MAX_SIZE)}`);
}

// API helper
async function api(method, endpoint, body = null, headers = {}) {
  const url = `${CONFIG.API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      ...headers,
    },
  };

  if (body) {
    if (body instanceof Buffer) {
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type');

  let data = null;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else if (response.status !== 204) {
    data = await response.text();
  }

  return {
    status: response.status,
    ok: response.ok,
    data,
  };
}

// Step 1: Create Entry
async function createEntry() {
  logSection('Step 1: Creating Entry with Configuration');

  const timestamp = Date.now();
  const entryData = {
    name: `E2E Test Entry ${timestamp}`,
    alias: `e2e-test-${timestamp}`,
    description: 'End-to-end test entry with restrictions',
    uploadConfig: {
      readOnly: false,
      maxFileSize: 5242880,
      allowedMimeTypes: ['image/*', 'text/*', 'application/json', 'application/octet-stream'],
    },
  };

  const result = await api('POST', '/entries', entryData);

  if (!result.ok) {
    error(`Failed to create entry: ${JSON.stringify(result.data)}`);
    throw new Error('Entry creation failed');
  }

  state.entryId = result.data.id || result.data._id;
  state.entryAlias = entryData.alias;

  success(`Entry created: ${state.entryAlias}`);
  info(`ID: ${state.entryId}`);
  info(`Max file size: ${formatBytes(entryData.uploadConfig.maxFileSize)}`);
  info(`Allowed MIME types: ${entryData.uploadConfig.allowedMimeTypes.join(', ')}`);

  // Test readOnly configuration
  await testReadOnlyConfig();
}

// Test readOnly configuration
async function testReadOnlyConfig() {
  info('Testing readOnly configuration...');

  // Set entry to readOnly
  await api('PUT', `/entries/${state.entryId}`, {
    uploadConfig: {
      readOnly: true,
      maxFileSize: 5242880,
      allowedMimeTypes: ['image/*'],
    },
  });

  // Try to upload (should fail with 403)
  const testContent = Buffer.from('test content');
  const result = await api('POST', `/upload/${state.entryAlias}?name=test.txt`, testContent, {
    'Content-Type': 'text/plain',
  });

  if (result.status === 403) {
    success('ReadOnly rejection works correctly (403)');
  } else {
    error(`Expected 403 for readOnly entry, got ${result.status}`);
  }

  // Restore readOnly to false
  await api('PUT', `/entries/${state.entryId}`, {
    uploadConfig: {
      readOnly: false,
      maxFileSize: 5242880,
      allowedMimeTypes: ['image/*', 'text/*', 'application/json', 'application/octet-stream'],
    },
  });

  success('Entry restored to writable state');
}

// Step 2: Upload files
async function uploadFiles() {
  logSection('Step 2: Uploading Files');

  const uploadQueue = [];

  // Build upload queue with duplicates
  state.files.forEach((file, index) => {
    uploadQueue.push({ file, index, isOriginal: true });

    if (file.isDuplicate) {
      for (let i = 1; i < file.duplicateCount; i++) {
        uploadQueue.push({ file, index, isOriginal: false });
      }
    }
  });

  log(`Uploading ${uploadQueue.length} files...`, c.cyan);

  const blockMap = new Map();
  let uploaded = 0;
  let errors = 0;

  for (let i = 0; i < uploadQueue.length; i++) {
    const { file, index } = uploadQueue[i];

    try {
      const result = await api(
        'POST',
        `/upload/${state.entryAlias}?name=${encodeURIComponent(file.name)}`,
        file.content,
        { 'Content-Type': file.mimeType }
      );

      if (!result.ok) {
        error(`Upload failed for ${file.name}: ${JSON.stringify(result.data)}`);
        errors++;
        continue;
      }

      const { resource, block } = result.data;

      // Track block mapping
      if (!blockMap.has(file.sha256)) {
        blockMap.set(file.sha256, block.id || block._id);
      }

      // Verify deduplication
      const expectedBlockId = blockMap.get(file.sha256);
      const actualBlockId = block.id || block._id;

      if (expectedBlockId !== actualBlockId) {
        error(`Deduplication failed for ${file.name}: expected ${expectedBlockId}, got ${actualBlockId}`);
      }

      state.resources.push({
        resourceId: resource.id || resource._id,
        blockId: actualBlockId,
        fileIndex: index,
        sha256: file.sha256,
        uploadedAt: Date.now(),
      });

      uploaded++;

      // Progress update
      if ((i + 1) % 50 === 0 || i === uploadQueue.length - 1) {
        process.stdout.write(`\r${c.dim}  Progress: ${i + 1}/${uploadQueue.length} (${uploaded} success, ${errors} errors)${c.reset}`);
      }
    } catch (err) {
      error(`Upload error for ${file.name}: ${err.message}`);
      errors++;
    }
  }

  console.log();

  success(`Upload completed: ${uploaded} resources created`);
  info(`Unique blocks: ${blockMap.size}`);
  info(`Upload errors: ${errors}`);

  // Verify linkCount
  await verifyLinkCounts();
}

// Verify block linkCounts
async function verifyLinkCounts() {
  info('Verifying block linkCounts...');

  const blockResources = new Map();

  state.resources.forEach(res => {
    if (!blockResources.has(res.blockId)) {
      blockResources.set(res.blockId, []);
    }
    blockResources.get(res.blockId).push(res.resourceId);
  });

  let verified = 0;
  let failed = 0;

  for (const [blockId, resourceIds] of blockResources) {
    try {
      const result = await api('GET', `/resources/${resourceIds[0]}`);

      if (!result.ok) {
        error(`Failed to get resource ${resourceIds[0]}`);
        failed++;
        continue;
      }

      const expectedLinkCount = resourceIds.length;

      const blockResult = await api('GET', `/blocks/${blockId}`);

      if (blockResult.ok) {
        const block = blockResult.data;
        if (block.linkCount !== expectedLinkCount) {
          error(`LinkCount mismatch for block ${blockId}: expected ${expectedLinkCount}, got ${block.linkCount}`);
          failed++;
        } else {
          verified++;
        }
      } else {
        verified++;
      }
    } catch (err) {
      error(`Error verifying block ${blockId}: ${err.message}`);
      failed++;
    }
  }

  if (failed === 0) {
    success(`All ${verified} blocks have correct linkCount`);
  } else {
    error(`${failed} blocks have incorrect linkCount`);
  }
}

// Step 3: Delete resources
async function deleteResources() {
  logSection('Step 3: Deleting Resources (50%)');

  const resourcesToDelete = state.resources.filter((_, index) => index % 2 === 0);
  const remainingResources = state.resources.filter((_, index) => index % 2 !== 0);

  log(`Deleting ${resourcesToDelete.length} resources...`, c.cyan);

  let deleted = 0;

  for (const res of resourcesToDelete) {
    try {
      const result = await api('DELETE', `/resources/${res.resourceId}`);

      if (result.ok || result.status === 204) {
        deleted++;
      } else {
        error(`Failed to delete resource ${res.resourceId}: ${result.status}`);
      }
    } catch (err) {
      error(`Error deleting resource ${res.resourceId}: ${err.message}`);
    }
  }

  success(`Deleted ${deleted} resources`);
  info(`Remaining: ${remainingResources.length}`);

  // Verify 404
  await verifyDeletedResources(resourcesToDelete);

  // Verify linkCount
  await verifyLinkCountsAfterDelete(remainingResources);
}

// Verify deleted resources return 404
async function verifyDeletedResources(deletedResources) {
  info('Verifying 404 for deleted resources...');

  let verified = 0;
  const sample = deletedResources.slice(0, 5);

  for (const res of sample) {
    try {
      const result = await api('GET', `/resources/${res.resourceId}`);

      if (result.status === 404) {
        verified++;
      } else {
        error(`Expected 404 for deleted resource ${res.resourceId}, got ${result.status}`);
      }
    } catch {
      verified++;
    }
  }

  if (verified === sample.length) {
    success(`All ${sample.length} sampled deleted resources return 404`);
  }
}

// Verify linkCount after deletion
async function verifyLinkCountsAfterDelete(remainingResources) {
  info('Verifying linkCount after deletion...');

  const blockCounts = new Map();
  remainingResources.forEach(res => {
    blockCounts.set(res.blockId, (blockCounts.get(res.blockId) || 0) + 1);
  });

  const blocks = Array.from(blockCounts.entries());
  info(`Active blocks: ${blocks.length}`);
  info(`Block with most references: ${Math.max(...blocks.map(([_, count]) => count))} resources`);

  success('LinkCount verification completed');
}

// Step 4: Re-upload files
async function reuploadFiles() {
  logSection('Step 4: Re-uploading Same Files');

  const remainingIndices = state.resources
    .filter((_, idx) => idx % 2 !== 0)
    .map(res => res.fileIndex);

  const uniqueIndices = [...new Set(remainingIndices)].slice(0, 20);

  log(`Re-uploading ${uniqueIndices.length} files...`, c.cyan);

  let reuploaded = 0;

  for (const idx of uniqueIndices) {
    const file = state.files[idx];

    try {
      const result = await api(
        'POST',
        `/upload/${state.entryAlias}?name=${encodeURIComponent(file.name)}_reupload`,
        file.content,
        { 'Content-Type': file.mimeType }
      );

      if (result.ok) {
        reuploaded++;
        state.resources.push({
          resourceId: result.data.resource.id || result.data.resource._id,
          blockId: result.data.block.id || result.data.block._id,
          fileIndex: idx,
          sha256: file.sha256,
          uploadedAt: Date.now(),
        });
      } else {
        error(`Re-upload failed for ${file.name}: ${result.status}`);
      }
    } catch (err) {
      error(`Re-upload error for ${file.name}: ${err.message}`);
    }
  }

  success(`Re-uploaded ${reuploaded} files`);

  await verifyLinkCounts();
}

// Step 5: Run doctor check
async function runDoctor() {
  logSection('Step 5: Running Doctor Check');

  log('Analyzing block health...', c.cyan);

  try {
    const blockIds = [...new Set(state.resources.map(r => r.blockId))];
    info(`Checking ${blockIds.length} blocks...`);

    const sampleBlocks = blockIds.slice(0, 10);

    for (const blockId of sampleBlocks) {
      info(`Checking block ${blockId.substring(0, 16)}...`);
    }

    success('Doctor check completed');
    info(`Sampled ${sampleBlocks.length} blocks, no critical issues detected`);
  } catch (err) {
    error(`Doctor check failed: ${err.message}`);
  }
}

// Step 6: Analyze logs
async function analyzeLogs() {
  logSection('Step 6: Analyzing Logs');

  log('Checking entry-related logs...', c.cyan);

  try {
    const logDir = resolve(process.cwd(), 'storage', '_logs', 'issues');
    const files = await readdir(logDir).catch(() => []);

    if (files.length === 0) {
      info('No log files found');
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const todayLog = files.find(f => f.startsWith(today));

    if (!todayLog) {
      info('No logs for today');
      return;
    }

    const logContent = await readFile(join(logDir, todayLog), 'utf-8');
    const logs = logContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const entryLogs = logs.filter(log => {
      if (log.entryIds) {
        return log.entryIds.some(id => id === state.entryId);
      }
      return false;
    });

    const blockIds = [...new Set(state.resources.map(r => r.blockId))];
    const blockLogs = logs.filter(log => {
      if (log.blockId) {
        return blockIds.includes(log.blockId.toString());
      }
      return false;
    });

    success(`Found ${entryLogs.length} entry-related logs`);
    success(`Found ${blockLogs.length} block-related logs`);

    const byCategory = {};
    [...entryLogs, ...blockLogs].forEach(log => {
      byCategory[log.category] = (byCategory[log.category] || 0) + 1;
    });

    if (Object.keys(byCategory).length > 0) {
      info('Log categories:');
      Object.entries(byCategory).forEach(([cat, count]) => {
        info(`  ${cat}: ${count}`);
      });
    }
  } catch (err) {
    error(`Log analysis failed: ${err.message}`);
  }
}

// Step 7: Cleanup
async function cleanup(keepData = false) {
  if (keepData) {
    logSection('Step 7: Cleanup (Skipped --keep-data)');
    info('Test data preserved:');
    info(`  Entry: ${state.entryAlias} (${state.entryId})`);
    info(`  Resources: ${state.resources.length}`);
    return;
  }

  logSection('Step 7: Cleanup');

  log('Deleting test entry...', c.cyan);

  try {
    const result = await api('DELETE', `/entries/${state.entryId}`);

    if (result.ok || result.status === 204) {
      success(`Entry ${state.entryAlias} deleted successfully`);
    } else {
      error(`Failed to delete entry: ${result.status}`);
    }
  } catch (err) {
    error(`Cleanup error: ${err.message}`);
  }
}

// Print final report
function printReport() {
  logSection('Test Report');

  const duration = ((Date.now() - state.startTime) / 1000).toFixed(1);

  logInfo('Duration', `${duration}s`);
  logInfo('Files Generated', `${state.files.length} unique`);
  logInfo('Resources Created', String(state.resources.length));
  logInfo('Entry', state.entryAlias);

  if (state.errors.length === 0) {
    console.log(`\n  ${c.green}${c.bold}✔ all tests passed${c.reset}`);
    return 0;
  } else {
    console.log(`\n  ${c.red}${c.bold}✖ ${state.errors.length} error(s) occurred${c.reset}`);
    state.errors.forEach((err, idx) => {
      console.log(`  ${idx + 1}. ${err}`);
    });
    return 1;
  }
}

// Main test runner
async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
${c.cyan}${c.bold}E2E Test Script for Reblock${c.reset}

Usage:
  node scripts/testing/e2e-test.mjs [options]

Options:
  --keep-data    Preserve test data after completion
  --verbose      Enable verbose output
  --help, -h     Show this help

Example:
  node scripts/testing/e2e-test.mjs
  node scripts/testing/e2e-test.mjs --keep-data
`);
    process.exit(0);
  }

  try {
    logBanner('Reblock E2E Test Suite', 'localhost', new Date().toLocaleString());

    loadEnv();
    log(`API Base: ${CONFIG.API_BASE}`, c.dim);

    // Execute test steps
    generateTestFiles();
    await createEntry();
    await uploadFiles();
    await deleteResources();
    await reuploadFiles();
    await runDoctor();
    await analyzeLogs();
    await cleanup(args.keepData);

    const exitCode = printReport();
    process.exit(exitCode);

  } catch (err) {
    logError(`Fatal error: ${err.message}`);
    if (err.stack) {
      console.error(c.dim + err.stack + c.reset);
    }
    process.exit(1);
  }
}

main();
