#!/usr/bin/env node

/**
 * Cleanup All Data Script
 * 
 * 清空所有数据：
 * - 数据库: Block, Entry, Resource, LogEntry 集合
 * - storage/blocks: 所有加密文件块
 * - storage/_temp: 所有临时文件
 * - storage/_logs: 所有日志文件
 * 
 * Usage: 
 *   node scripts/cleanup-all.mjs          # 交互式确认
 *   node scripts/cleanup-all.mjs --yes    # 直接执行
 */

import { readFileSync, readdirSync, statSync, unlinkSync, rmdirSync } from 'fs';
import { resolve, join } from 'path';
import { createInterface } from 'readline';

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
  MONGO_HOSTNAME: process.env.MONGO_HOSTNAME || 'localhost',
  MONGO_PORT: process.env.MONGO_PORT || '27017',
  MONGO_DATABASE: process.env.MONGO_DATABASE || 'reblock',
  MONGO_USERNAME: process.env.MONGO_USERNAME || '',
  MONGO_PASSWORD: process.env.MONGO_PASSWORD || '',
  BLOCKS_DIR: process.env.STORAGE_BLOCK_DIR || './storage/blocks',
  TEMP_DIR: process.env.STORAGE_TEMP_DIR || './storage/_temp',
  LOG_DIR: process.env.STORAGE_LOG_DIR || './storage/_logs',
  SKIP_CONFIRM: process.argv.includes('--yes'),
};

// MongoDB connection string
const getMongoUri = () => {
  const auth = CONFIG.MONGO_USERNAME 
    ? `${CONFIG.MONGO_USERNAME}:${CONFIG.MONGO_PASSWORD}@` 
    : '';
  const authSource = CONFIG.MONGO_USERNAME ? '?authSource=admin' : '';
  return `mongodb://${auth}${CONFIG.MONGO_HOSTNAME}:${CONFIG.MONGO_PORT}/${CONFIG.MONGO_DATABASE}${authSource}`;
};

// Connect to MongoDB
const connectDB = async () => {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(getMongoUri());
  await client.connect();
  return { client, db: client.db(CONFIG.MONGO_DATABASE) };
};

// Count documents in collection
const countCollection = async (db, name) => {
  try {
    const count = await db.collection(name).countDocuments();
    return count;
  } catch {
    return 0;
  }
};

// Get directory stats
const getDirStats = (dirPath) => {
  try {
    const items = readdirSync(dirPath);
    let fileCount = 0;
    let totalSize = 0;

    const scanDir = (currentPath) => {
      const entries = readdirSync(currentPath);
      for (const entry of entries) {
        const fullPath = join(currentPath, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scanDir(fullPath);
        } else {
          fileCount++;
          totalSize += stat.size;
        }
      }
    };

    scanDir(dirPath);
    return { fileCount, totalSize };
  } catch {
    return { fileCount: 0, totalSize: 0 };
  }
};

// Format bytes
const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${'BKMGTP'.split('')[i]}B`.replace('BB', 'B');
};

// Confirm action
const confirm = (message) => {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
};

// Delete directory contents recursively
const deleteDirContents = (dirPath) => {
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        deleteDirContents(fullPath);
        rmdirSync(fullPath);
      } else {
        unlinkSync(fullPath);
      }
    }
    return entries.length;
  } catch (error) {
    console.error(`   ❌ Error cleaning ${dirPath}: ${error.message}`);
    return 0;
  }
};

// Main
async function cleanupAll() {
  console.log('🧹 Cleanup All Data');
  console.log('===================\n');

  // Connect to database
  console.log('🔌 Connecting to database...');
  const { client, db } = await connectDB();
  console.log(`   ✅ Connected to ${CONFIG.MONGO_DATABASE}\n`);

  // Get statistics
  console.log('📊 Current Data:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const stats = {
    blocks: await countCollection(db, 'blocks'),
    entries: await countCollection(db, 'entries'),
    resources: await countCollection(db, 'resources'),
    logentries: await countCollection(db, 'logentries'),
  };

  console.log(`Database: ${CONFIG.MONGO_DATABASE}`);
  console.log(`  - Blocks: ${stats.blocks.toLocaleString()} documents`);
  console.log(`  - Entries: ${stats.entries.toLocaleString()} documents`);
  console.log(`  - Resources: ${stats.resources.toLocaleString()} documents`);
  console.log(`  - LogEntries: ${stats.logentries.toLocaleString()} documents`);

  const blocksStats = getDirStats(CONFIG.BLOCKS_DIR);
  const tempStats = getDirStats(CONFIG.TEMP_DIR);
  const logStats = getDirStats(CONFIG.LOG_DIR);

  console.log(`\nStorage:`);
  console.log(`  - blocks/: ${blocksStats.fileCount.toLocaleString()} files (${formatBytes(blocksStats.totalSize)})`);
  console.log(`  - _temp/: ${tempStats.fileCount.toLocaleString()} files (${formatBytes(tempStats.totalSize)})`);
  console.log(`  - _logs/: ${logStats.fileCount.toLocaleString()} files (${formatBytes(logStats.totalSize)})`);

  const totalItems = stats.blocks + stats.entries + stats.resources + stats.logentries + 
                     blocksStats.fileCount + tempStats.fileCount + logStats.fileCount;

  if (totalItems === 0) {
    console.log('\n✅ Nothing to clean up - everything is already empty!');
    await client.close();
    return;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  WARNING: This will permanently delete ALL data!');
  console.log('   This action cannot be undone!\n');

  // Confirm
  if (!CONFIG.SKIP_CONFIRM) {
    const confirmed = await confirm("Type 'yes' to proceed: ");
    if (!confirmed) {
      console.log('\n❌ Cancelled. No data was deleted.');
      await client.close();
      return;
    }
  }

  console.log('\n🗑️  Cleaning database...');

  // Drop collections
  const collections = ['blocks', 'entries', 'resources', 'logentries'];
  let droppedCount = 0;

  for (const name of collections) {
    try {
      await db.collection(name).drop();
      droppedCount++;
      console.log(`   ✅ Dropped collection: ${name}`);
    } catch (error) {
      if (error.codeName === 'NamespaceNotFound') {
        console.log(`   ℹ️  Collection not found: ${name}`);
      } else {
        console.log(`   ❌ Failed to drop ${name}: ${error.message}`);
      }
    }
  }

  console.log(`   ✅ Dropped ${droppedCount} collections`);

  console.log('\n🗑️  Cleaning storage...');

  // Clean blocks directory
  const blocksDeleted = deleteDirContents(CONFIG.BLOCKS_DIR);
  console.log(`   ✅ Deleted ${blocksDeleted} files from blocks/`);

  // Clean temp directory
  const tempDeleted = deleteDirContents(CONFIG.TEMP_DIR);
  console.log(`   ✅ Deleted ${tempDeleted} files from _temp/`);

  // Clean logs directory
  const logsDeleted = deleteDirContents(CONFIG.LOG_DIR);
  console.log(`   ✅ Deleted ${logsDeleted} files from _logs/`);

  // Close database connection
  await client.close();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Cleanup complete! All data has been removed.');
  console.log('\nThe system is now in a clean state.');
}

cleanupAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
