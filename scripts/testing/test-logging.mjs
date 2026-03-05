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
 * 3. Duplicate upload - verify linkCount increment
 * 4. Delete resource - verify cleanup action log
 *
 * Usage: node scripts/testing/test-logging.mjs
 */

import { readFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { createReadStream } from 'fs';
import { resolve, dirname } from 'path';
import mongoose from 'mongoose';
import {
  logBanner,
  logSection,
  logInfo,
  logSuccess,
  logWarn,
  logError,
  logDetail,
  spinner,
} from '../utils/style.mjs';

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

// eslint-disable-next-line no-unused-vars
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

  const spin = spinner('Connecting to MongoDB...').start();
  await mongoose.connect(uri);
  spin.succeed('Connected to MongoDB');
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

// eslint-disable-next-line no-unused-vars
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
    logDetail(`Deleted physical file: ${filePath}`);
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
  logSection('1. Normal Upload Test');

  const testAlias = `logging-test-${getTimestamp()}`;

  logDetail(`Creating entry: ${testAlias}`);
  const entry = await createEntry(testAlias);
  logSuccess(`Entry created: ${entry._id}`);

  logDetail(`Uploading ${CONFIG.PDF_PATH}`);
  const resource = await uploadFile(testAlias, CONFIG.PDF_PATH);
  logSuccess(`Resource created: ${resource._id}`);
  logSuccess(`Block ID: ${resource.block}`);

  const block = await getBlockById(resource.block);
  logInfo('Block size', String(block.size));
  logInfo('linkCount', String(block.linkCount));

  return { entry, resource, block };
}

async function testFileSizeMismatch(resource, originalBlock) {
  logSection('2. FILE_SIZE_MISMATCH Test');

  const startCount = await countLogEntries(getTimestamp() - 1000);

  logDetail('Modifying block size to trigger FILE_SIZE_MISMATCH...');
  await updateBlock(resource.block, { size: 999999 });
  logSuccess('Block size modified to 999999');

  logDetail('Attempting download (should fail)...');
  const res = await downloadFile(resource._id);
  logInfo('Download response status', String(res.status));

  await new Promise(r => setTimeout(r, 500));
  await countLogEntries(getTimestamp() - 5000);
  const logEntries = await getMongoLogs('FILE_SIZE_MISMATCH', getTimestamp() - 5000);

  if (logEntries.length > startCount) {
    const entry = logEntries[0];
    logSuccess('FILE_SIZE_MISMATCH log generated!');
    logInfo('Level', entry.level);
    logInfo('Category', entry.category);
    logDetail(`dbSize=${entry.details.dbSize}, actualSize=${entry.details.actualSize}`);
  } else {
    logWarn('No FILE_SIZE_MISMATCH log found');
  }

  logDetail('Restoring block size...');
  await updateBlock(resource.block, { size: originalBlock.size });
  logSuccess('Block size restored');

  return logEntries;
}

// eslint-disable-next-line no-unused-vars
async function testMissingFile(resource) {
  logSection('3. MISSING_FILE Test');

  const block = await getBlockById(resource.block);

  logDetail('Deleting physical block file...');
  const deleted = deleteBlockFile(block);
  if (!deleted) {
    logWarn('Block file did not exist');
  }

  logDetail('Attempting download (should fail)...');
  const res = await downloadFile(resource._id);
  logInfo('Download response status', String(res.status));

  await new Promise(r => setTimeout(r, 500));
  const logEntries = await getMongoLogs('MISSING_FILE', getTimestamp() - 5000);

  if (logEntries.length > 0) {
    const entry = logEntries[0];
    logSuccess('MISSING_FILE log generated!');
    logInfo('Level', entry.level);
    logInfo('Category', entry.category);
  } else {
    logWarn('No MISSING_FILE log found');
  }

  return logEntries;
}

async function testDuplicateUpload(_entry) {
  logSection('4. Duplicate Upload Test');

  const dupAlias = `logging-test-dup-${getTimestamp()}`;
  logDetail(`Creating entry for duplicate test: ${dupAlias}`);
  const dupEntry = await createEntry(dupAlias);

  logDetail('First upload...');
  const resource1 = await uploadFile(dupAlias, CONFIG.PDF_PATH);
  const block1 = await getBlockById(resource1.block);
  logInfo('Block linkCount after first upload', String(block1.linkCount));

  logDetail('Second upload (same file)...');
  const resource2 = await uploadFile(dupAlias, CONFIG.PDF_PATH);

  const block2 = await getBlockById(resource2.block);
  logInfo('Block linkCount after second upload', String(block2.linkCount));
  logInfo('Block IDs same', String(block1._id.toString() === block2._id.toString()));

  if (block1._id.toString() === block2._id.toString() && block2.linkCount === block1.linkCount + 1) {
    logSuccess('linkCount incremented correctly (deduplication working!)');
  } else {
    logWarn('linkCount or block mismatch');
  }

  await deleteEntry(dupEntry._id);
  logSuccess('Duplicate test entry cleaned up');

  return { resource2, blockAfter: block2 };
}

async function testDeleteResource(resource) {
  logSection('5. Delete Resource Test');

  const startCount = await countLogEntries(getTimestamp() - 1000);

  logDetail('Deleting resource...');
  const res = await deleteResource(resource._id);
  logInfo('Delete response status', String(res.status));

  await new Promise(r => setTimeout(r, 500));
  const logEntries = await getMongoLogs('CLEANUP_ACTION', getTimestamp() - 5000);

  if (logEntries.length > startCount) {
    const entry = logEntries[0];
    logSuccess('CLEANUP_ACTION log generated!');
    logInfo('Level', entry.level);
    logInfo('Category', entry.category);
  } else {
    logWarn('No CLEANUP_ACTION log found (may not be implemented)');
  }

  return logEntries;
}

async function cleanup(entry) {
  logSection('Cleanup');

  try {
    await deleteEntry(entry._id);
    logSuccess('Test entry deleted');
  } catch (e) {
    logWarn(`Cleanup failed: ${e.message}`);
  }
}

async function main() {
  logBanner('Logging System Test', 'localhost', 'Testing: FILE_SIZE_MISMATCH, MISSING_FILE, etc.');

  await connectDB();

  if (!existsSync(CONFIG.PDF_PATH)) {
    logError(`PDF file not found: ${CONFIG.PDF_PATH}`);
    process.exit(1);
  }

  if (!existsSync(CONFIG.LOG_FILE)) {
    logWarn(`Log file not found: ${CONFIG.LOG_FILE}`);
    logDetail('Creating log directory...');
    mkdirSync(dirname(CONFIG.LOG_FILE), { recursive: true });
  }

  const startTime = getTimestamp();
  let testData = null;

  try {
    testData = await testNormalUpload();
    await testFileSizeMismatch(testData.resource, testData.block);
    await testDuplicateUpload(testData.entry);
    await testDeleteResource(testData.resource);

    logSection('Test Summary');
    const totalLogs = await countLogEntries(startTime);
    logInfo('Total log entries generated since start', String(totalLogs));

    const categories = await getMongoLogs(null, startTime);
    const categoryCount = {};
    categories.forEach(c => {
      categoryCount[c.category] = (categoryCount[c.category] || 0) + 1;
    });

    logInfo('Log entries by category', '');
    Object.entries(categoryCount).forEach(([cat, count]) => {
      logDetail(`${cat}: ${count}`);
    });

    console.log();
    logSuccess('All tests completed!');

  } catch (e) {
    logError(`Test failed: ${e.message}`);
    console.error(e);
  } finally {
    if (testData?.entry) {
      await cleanup(testData.entry);
    }
    await mongoose.disconnect();
    logDetail('Disconnected from MongoDB');
  }
}

main().catch(console.error);
