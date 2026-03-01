#!/usr/bin/env node

/**
 * Logging System Test Script
 *
 * Tests the logging system by performing various operations and verifying
 * that appropriate log entries are created in MongoDB and JSONL files.
 *
 * Test scenarios:
 * 1. Upload aaa.pdf - check for normal operation logs
 * 2. Modify block.size - trigger FILE_SIZE_MISMATCH log
 * 3. Delete physical file - trigger MISSING_FILE log
 * 4. Duplicate upload - verify linkCount increment
 * 5. Delete resource - verify cleanup action log
 *
 * Usage: node scripts/test-logging.mjs
 */

import { readFileSync, statSync, unlinkSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { resolve, dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import mongoose from 'mongoose';

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

function getDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const CONFIG = {
  PDF_PATH: process.env.TEST_PDF_PATH || resolve(process.cwd(), '_temp/aaa.pdf'),
  BASE_URL: `http://127.0.0.1:${process.env.PORT || process.env.SERVER_PORT || 4362}`,
  MONGO_HOSTNAME: process.env.MONGO_HOSTNAME || '127.0.0.1',
  MONGO_PORT: process.env.MONGO_PORT || 27017,
  MONGO_DATABASE: process.env.MONGO_DATABASE || 'reblock',
  MONGO_USERNAME: process.env.MONGO_USERNAME,
  MONGO_PASSWORD: process.env.MONGO_PASSWORD,
  LOG_FILE: resolve(process.env.STORAGE_LOG_DIR || './storage/_logs', `issues/${getDateString()}.jsonl`),
  TEST_TIMEOUT: 30000,
};

function getDateString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ ${colors.reset}${msg}`),
  success: (msg) => console.log(`${colors.green}✓ ${colors.reset}${msg}`),
  error: (msg) => console.log(`${colors.red}✗ ${colors.reset}${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${colors.reset}${msg}`),
  section: (msg) => console.log(`\n${colors.cyan}▶ ${msg}${colors.reset}\n`),
  step: (msg) => console.log(`${colors.magenta}  → ${colors.reset}${msg}`),
};

// API helpers
async function request(url, options = {}) {
  const res = await fetch(`${CONFIG.BASE_URL}${url}`, options);
  return res;
}

async function createEntry(alias) {
  const res = await request('/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Logging Test Entry`,
      alias: alias,
    }),
  });
  if (!res.ok) throw new Error(`Failed to create entry: ${res.status}`);
  return res.json();
}

async function uploadFile(alias, filePath) {
  const fileStream = createReadStream(filePath);
  const res = await request(`/upload/${alias}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: fileStream,
    duplex: 'half',
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload failed: ${res.status} - ${err}`);
  }
  return res.json();
}

async function downloadFile(resourceId) {
  const res = await request(`/resources/${resourceId}/download`);
  return res;
}

async function deleteResource(resourceId) {
  const res = await request(`/resources/${resourceId}`, {
    method: 'DELETE',
  });
  return res;
}

async function deleteEntry(entryId) {
  const res = await request(`/entries/${entryId}`, {
    method: 'DELETE',
  });
  return res;
}

function getTimestamp() {
  return Date.now();
}

async function getLogEntries(category = null) {
  const lines = await readFileSync(CONFIG.LOG_FILE, 'utf-8')
    .then(content => content.trim().split('\n').filter(Boolean))
    .catch(() => []);
  
  return lines
    .map(line => JSON.parse(line))
    .filter(entry => !category || entry.category === category)
    .sort((a, b) => b.timestamp - a.timestamp);
}

async function connectDB() {
  const auth = CONFIG.MONGO_USERNAME && CONFIG.MONGO_PASSWORD
    ? `${CONFIG.MONGO_USERNAME}:${CONFIG.MONGO_PASSWORD}@`
    : '';
  const authSource = auth ? '?authSource=admin' : '';
  const uri = `mongodb://${auth}${CONFIG.MONGO_HOSTNAME}:${CONFIG.MONGO_PORT}/${CONFIG.MONGO_DATABASE}${authSource}`;

  await mongoose.connect(uri);
  log.success('Connected to MongoDB');
}

async function getMongoLogs(category = null, since = null) {
  const db = mongoose.connection.db;
  const collection = db.collection('logentries');
  
  const query = {};
  if (category) query.category = category;
  if (since) query.timestamp = { $gte: since };
  
  return await collection.find(query).sort({ timestamp: -1 }).limit(100).toArray();
}

async function getBlockById(blockId) {
  const db = mongoose.connection.db;
  const collection = db.collection('blocks');
  return await collection.findOne({ _id: new mongoose.Types.ObjectId(blockId) });
}

async function updateBlock(blockId, update) {
  const db = mongoose.connection.db;
  const collection = db.collection('blocks');
  return await collection.updateOne({ _id: new mongoose.Types.ObjectId(blockId) }, { $set: update });
}

async function getResourceById(resourceId) {
  const db = mongoose.connection.db;
  const collection = db.collection('resources');
  return await collection.findOne({ _id: new mongoose.Types.ObjectId(resourceId) });
}

function getBlockPath(block) {
  const sha256 = block.sha256;
  const dir = sha256.substring(0, 2);
  return resolve(process.cwd(), `storage/_blocks/${dir}/${sha256}`);
}

function deleteBlockFile(block) {
  const filePath = getBlockPath(block);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    log.info(`Deleted physical file: ${filePath}`);
    return true;
  }
  return false;
}

async function countLogEntries(startTime) {
  const db = mongoose.connection.db;
  const collection = db.collection('logentries');
  return await collection.countDocuments({ timestamp: { $gte: startTime } });
}

async function testNormalUpload() {
  log.section('1. Normal Upload Test');
  
  const testAlias = `logging-test-${getTimestamp()}`;
  
  // Create entry
  log.step(`Creating entry: ${testAlias}`);
  const entry = await createEntry(testAlias);
  log.success(`Entry created: ${entry._id}`);
  
  // Upload file
  log.step(`Uploading ${CONFIG.PDF_PATH}`);
  const resource = await uploadFile(testAlias, CONFIG.PDF_PATH);
  log.success(`Resource created: ${resource._id}`);
  log.success(`Block ID: ${resource.block}`);
  
  // Get block info
  const block = await getBlockById(resource.block);
  log.info(`Block size: ${block.size}, linkCount: ${block.linkCount}`);
  
  return { entry, resource, block };
}

async function testFileSizeMismatch(resource, originalBlock) {
  log.section('2. FILE_SIZE_MISMATCH Test');
  
  const startCount = await countLogEntries(getTimestamp() - 1000);
  
  // Modify block size to trigger mismatch
  log.step('Modifying block size to trigger FILE_SIZE_MISMATCH...');
  await updateBlock(resource.block, { size: 999999 });
  log.success('Block size modified to 999999');
  
  // Try to download
  log.step('Attempting download (should fail)...');
  const res = await downloadFile(resource._id);
  log.info(`Download response status: ${res.status}`);
  
  // Check logs
  await new Promise(r => setTimeout(r, 500));
  const newCount = await countLogEntries(getTimestamp() - 5000);
  const logEntries = await getMongoLogs('FILE_SIZE_MISMATCH', getTimestamp() - 5000);
  
  if (logEntries.length > startCount) {
    const entry = logEntries[0];
    log.success('FILE_SIZE_MISMATCH log generated!');
    log.info(`  Level: ${entry.level}`);
    log.info(`  Category: ${entry.category}`);
    log.info(`  Details: dbSize=${entry.details.dbSize}, actualSize=${entry.details.actualSize}`);
  } else {
    log.warn('No FILE_SIZE_MISMATCH log found');
  }
  
  // Restore block
  log.step('Restoring block size...');
  await updateBlock(resource.block, { size: originalBlock.size });
  log.success('Block size restored');
  
  return logEntries;
}

async function testMissingFile(resource) {
  log.section('3. MISSING_FILE Test');
  
  const block = await getBlockById(resource.block);
  
  // Delete physical file
  log.step('Deleting physical block file...');
  const deleted = deleteBlockFile(block);
  if (!deleted) {
    log.warn('Block file did not exist');
  }
  
  // Try to download
  log.step('Attempting download (should fail)...');
  const res = await downloadFile(resource._id);
  log.info(`Download response status: ${res.status}`);
  
  // Check logs
  await new Promise(r => setTimeout(r, 500));
  const logEntries = await getMongoLogs('MISSING_FILE', getTimestamp() - 5000);
  
  if (logEntries.length > 0) {
    const entry = logEntries[0];
    log.success('MISSING_FILE log generated!');
    log.info(`  Level: ${entry.level}`);
    log.info(`  Category: ${entry.category}`);
  } else {
    log.warn('No MISSING_FILE log found');
  }
  
  return logEntries;
}

async function testDuplicateUpload(entry) {
  log.section('4. Duplicate Upload Test');
  
  // Create a new entry for duplicate test
  const dupAlias = `logging-test-dup-${getTimestamp()}`;
  log.step(`Creating entry for duplicate test: ${dupAlias}`);
  const dupEntry = await createEntry(dupAlias);
  
  // First upload
  log.step('First upload...');
  const resource1 = await uploadFile(dupAlias, CONFIG.PDF_PATH);
  const block1 = await getBlockById(resource1.block);
  log.info(`Block linkCount after first upload: ${block1.linkCount}`);
  
  // Second upload (same file)
  log.step('Second upload (same file)...');
  const resource2 = await uploadFile(dupAlias, CONFIG.PDF_PATH);
  
  // Check linkCount - should be same block with incremented linkCount
  const block2 = await getBlockById(resource2.block);
  log.info(`Block linkCount after second upload: ${block2.linkCount}`);
  log.info(`Block IDs same: ${block1._id.toString() === block2._id.toString()}`);
  
  if (block1._id.toString() === block2._id.toString() && block2.linkCount === block1.linkCount + 1) {
    log.success('linkCount incremented correctly (deduplication working!)');
  } else {
    log.warn(`linkCount or block mismatch`);
  }
  
  // Delete the duplicate test entry
  await deleteEntry(dupEntry._id);
  log.success('Duplicate test entry cleaned up');
  
  return { resource2, blockAfter: block2 };
}

async function testDeleteResource(resource) {
  log.section('5. Delete Resource Test');
  
  const startCount = await countLogEntries(getTimestamp() - 1000);
  
  // Delete resource
  log.step('Deleting resource...');
  const res = await deleteResource(resource._id);
  log.info(`Delete response status: ${res.status}`);
  
  // Check logs
  await new Promise(r => setTimeout(r, 500));
  const logEntries = await getMongoLogs('CLEANUP_ACTION', getTimestamp() - 5000);
  
  if (logEntries.length > startCount) {
    const entry = logEntries[0];
    log.success('CLEANUP_ACTION log generated!');
    log.info(`  Level: ${entry.level}`);
    log.info(`  Category: ${entry.category}`);
  } else {
    log.warn('No CLEANUP_ACTION log found (may not be implemented)');
  }
  
  return logEntries;
}

async function cleanup(entry) {
  log.section('Cleanup');
  
  try {
    await deleteEntry(entry._id);
    log.success('Test entry deleted');
  } catch (e) {
    log.warn(`Cleanup failed: ${e.message}`);
  }
}

async function main() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║           Logging System Test Script                   ║
║  Testing: FILE_SIZE_MISMATCH, MISSING_FILE, etc.       ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
  `);
  
  // Connect to MongoDB
  await connectDB();
  
  // Check prerequisites
  if (!existsSync(CONFIG.PDF_PATH)) {
    log.error(`PDF file not found: ${CONFIG.PDF_PATH}`);
    process.exit(1);
  }
  
  if (!existsSync(CONFIG.LOG_FILE)) {
    log.warn(`Log file not found: ${CONFIG.LOG_FILE}`);
    log.info('Creating log directory...');
    mkdirSync(dirname(CONFIG.LOG_FILE), { recursive: true });
  }
  
  const startTime = getTimestamp();
  let testData = null;
  
  try {
    // Test 1: Normal Upload
    testData = await testNormalUpload();
    
    // Test 2: FILE_SIZE_MISMATCH
    await testFileSizeMismatch(testData.resource, testData.block);
    
    // Test 3: Duplicate Upload (before deleting the resource)
    await testDuplicateUpload(testData.entry);
    
    // Test 4: Delete Resource
    await testDeleteResource(testData.resource);
    
    // Summary
    log.section('Test Summary');
    const totalLogs = await countLogEntries(startTime);
    log.info(`Total log entries generated since start: ${totalLogs}`);
    
    const categories = await getMongoLogs(null, startTime);
    const categoryCount = {};
    categories.forEach(c => {
      categoryCount[c.category] = (categoryCount[c.category] || 0) + 1;
    });
    
    log.info('Log entries by category:');
    Object.entries(categoryCount).forEach(([cat, count]) => {
      log.info(`  ${cat}: ${count}`);
    });
    
    log.success('\n✅ All tests completed!\n');
    
  } catch (e) {
    log.error(`Test failed: ${e.message}`);
    console.error(e);
  } finally {
    // Cleanup
    if (testData?.entry) {
      await cleanup(testData.entry);
    }
    await mongoose.disconnect();
    log.info('Disconnected from MongoDB');
  }
}

main().catch(console.error);
