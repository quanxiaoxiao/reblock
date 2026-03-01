#!/usr/bin/env node

/**
 * Reblock Cleanup - Block 数据清理工具
 *
 * 清理超过指定时间的 Block 数据：
 * 1. 孤立 Block - linkCount=0 但未软删除的 block
 * 2. LinkCount 错误 - linkCount 与实际引用数量不符
 *
 * Usage:
 *   npm run cleanup -- --preview              # 预览将要清理的内容
 *   npm run cleanup -- --execute              # 执行清理（带确认）
 *   npm run cleanup -- --days 7               # 覆盖默认时间（7天）
 *   npm run cleanup -- --execute --yes        # 跳过确认（危险！）
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import { createHmac } from 'crypto';
import readline from 'readline';

// Dynamically import LogService (ESM compatibility)
let logService;
async function initLogService() {
  if (!logService) {
    const { logService: service } = await import('../dist/services/logService.js');
    logService = service;
  }
  return logService;
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
}

loadEnv();

// Configuration
const CONFIG = {
  MONGO_HOSTNAME: process.env.MONGO_HOSTNAME || 'localhost',
  MONGO_PORT: parseInt(process.env.MONGO_PORT || '27017'),
  MONGO_DATABASE: process.env.MONGO_DATABASE || 'reblock',
  MONGO_USERNAME: process.env.MONGO_USERNAME,
  MONGO_PASSWORD: process.env.MONGO_PASSWORD,
  STORAGE_BLOCK_DIR: process.env.STORAGE_BLOCK_DIR || './storage/blocks',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  CLEANUP_DEFAULT_DAYS: parseInt(process.env.CLEANUP_DEFAULT_DAYS || '30'),
  CLEANUP_BACKUP_REMINDER: process.env.CLEANUP_BACKUP_REMINDER !== 'false',
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  
  return {
    preview: args.includes('--preview'),
    execute: args.includes('--execute'),
    days: daysIndex >= 0 ? parseInt(args[daysIndex + 1]) || CONFIG.CLEANUP_DEFAULT_DAYS : CONFIG.CLEANUP_DEFAULT_DAYS,
    yes: args.includes('--yes'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Generate storage name from sha256
function generateStorageName(sha256) {
  if (!CONFIG.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  const key = Buffer.from(CONFIG.ENCRYPTION_KEY, 'base64');
  return createHmac('sha256', key).update(sha256).digest('hex');
}

// Get full storage path
function getStoragePath(sha256) {
  const storageName = generateStorageName(sha256);
  const prefix1 = storageName.substring(0, 2);
  const secondChar = storageName.substring(2, 3);
  const relativePath = `${prefix1}/${secondChar}${storageName}`;
  return join(CONFIG.STORAGE_BLOCK_DIR, relativePath);
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
}

// Format date
function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString('zh-CN');
}

// Connect to MongoDB
async function connectDB() {
  const auth = CONFIG.MONGO_USERNAME && CONFIG.MONGO_PASSWORD
    ? `${CONFIG.MONGO_USERNAME}:${CONFIG.MONGO_PASSWORD}@`
    : '';
  const authSource = auth ? '?authSource=admin' : '';
  const uri = `mongodb://${auth}${CONFIG.MONGO_HOSTNAME}:${CONFIG.MONGO_PORT}/${CONFIG.MONGO_DATABASE}${authSource}`;

  await mongoose.connect(uri);
  console.log(`${colors.green}✓${colors.reset} Connected to MongoDB: ${CONFIG.MONGO_DATABASE}\n`);
}

// Define Block schema
const blockSchema = new mongoose.Schema({
  sha256: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  linkCount: { type: Number, default: 1 },
  size: { type: Number },
  isInvalid: { type: Boolean, default: false },
  invalidatedAt: { type: Number },
});

// Define Resource schema
const resourceSchema = new mongoose.Schema({
  block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', required: true },
  mime: { type: String },
  entry: { type: mongoose.Schema.Types.ObjectId, ref: 'Entry', required: true },
  name: { type: String, default: '' },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  isInvalid: { type: Boolean, default: false },
});

const Block = mongoose.model('Block', blockSchema);
const Resource = mongoose.model('Resource', resourceSchema);

// Find blocks to cleanup
async function findBlocksToCleanup(cutoffDate) {
  const blocks = await Block.find({
    isInvalid: { $ne: true },
    createdAt: { $lt: cutoffDate },
  }).sort({ createdAt: 1 }).lean();

  const orphaned = [];
  const linkcountIssues = [];

  for (const block of blocks) {
    // Count actual resource references
    const actualCount = await Resource.countDocuments({
      block: block._id,
      isInvalid: { $ne: true },
    });

    if (block.linkCount === 0 && actualCount === 0) {
      orphaned.push({
        blockId: block._id.toString(),
        sha256: block.sha256,
        size: block.size,
        createdAt: block.createdAt,
        type: 'orphaned',
      });
    } else if (block.linkCount !== actualCount) {
      linkcountIssues.push({
        blockId: block._id.toString(),
        sha256: block.sha256,
        size: block.size,
        createdAt: block.createdAt,
        type: 'linkcount',
        currentLinkCount: block.linkCount,
        actualLinkCount: actualCount,
        diff: actualCount - block.linkCount,
      });
    }
  }

  return { orphaned, linkcountIssues };
}

// Prompt for confirmation
function confirm(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// Execute cleanup with logging
async function executeCleanup(items) {
  const results = {
    orphaned: { success: 0, failed: 0 },
    linkcount: { success: 0, failed: 0 },
  };

  // Initialize log service
  const service = await initLogService();

  console.log(`\n${colors.cyan}📝 Executing cleanup...${colors.reset}\n`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const num = i + 1;
    const total = items.length;

    try {
      if (item.type === 'orphaned') {
        // Soft delete orphaned block
        await Block.updateOne(
          { _id: item.blockId },
          { $set: { isInvalid: true, invalidatedAt: Date.now(), updatedAt: Date.now() } }
        );
        results.orphaned.success++;
        console.log(`   [${num}/${total}] ${colors.green}✓${colors.reset} Block ${item.blockId.substring(0, 8)}... Soft deleted (orphaned)`);

        // Log the cleanup action
        await service.logCleanupAction({
          action: 'soft_delete',
          targetBlockId: item.blockId,
          previousState: {
            isInvalid: false,
            linkCount: item.linkCount,
            sha256: item.sha256,
          },
          newState: {
            isInvalid: true,
            invalidatedAt: Date.now(),
          },
          success: true,
        });

      } else if (item.type === 'linkcount') {
        // Fix linkcount
        await Block.updateOne(
          { _id: item.blockId },
          { $set: { linkCount: item.actualLinkCount, updatedAt: Date.now() } }
        );
        results.linkcount.success++;
        console.log(`   [${num}/${total}] ${colors.green}✓${colors.reset} Block ${item.blockId.substring(0, 8)}... LinkCount fixed: ${item.currentLinkCount} → ${item.actualLinkCount}`);

        // Log the cleanup action
        await service.logCleanupAction({
          action: 'fix_linkcount',
          targetBlockId: item.blockId,
          previousState: {
            linkCount: item.currentLinkCount,
            sha256: item.sha256,
          },
          newState: {
            linkCount: item.actualLinkCount,
          },
          success: true,
        });
      }
    } catch (error) {
      if (item.type === 'orphaned') {
        results.orphaned.failed++;
      } else {
        results.linkcount.failed++;
      }
      console.log(`   [${num}/${total}] ${colors.red}✗${colors.reset} Block ${item.blockId.substring(0, 8)}... Failed`);

      // Log the failed cleanup action
      try {
        await service.logCleanupAction({
          action: item.type === 'orphaned' ? 'soft_delete' : 'fix_linkcount',
          targetBlockId: item.blockId,
          previousState: item,
          newState: {},
          success: false,
          error: error.message,
        });
      } catch (logError) {
        console.error(`Failed to log cleanup error: ${logError.message}`);
      }
    }
  }

  return results;
}

// Print preview report
function printPreviewReport(items, cutoffDate, days) {
  const orphaned = items.filter(i => i.type === 'orphaned');
  const linkcountIssues = items.filter(i => i.type === 'linkcount');

  console.log(`${colors.cyan}🔧 Reblock Cleanup - 数据清理工具${colors.reset}`);
  console.log(`${'='.repeat(50)}\n`);

  // Configuration
  console.log(`${colors.bold}⚙️  配置信息:${colors.reset}`);
  console.log(`   时间阈值: ${days} 天`);
  console.log(`   当前时间: ${formatDate(Date.now())}`);
  console.log(`   清理截止日期: ${formatDate(cutoffDate)}\n`);

  // Statistics
  console.log(`${colors.bold}📊 扫描结果:${colors.reset}`);
  console.log(`   孤立 blocks: ${colors.yellow}${orphaned.length}${colors.reset} 个`);
  console.log(`   LinkCount 错误: ${colors.yellow}${linkcountIssues.length}${colors.reset} 个`);
  console.log(`   ${colors.gray}${'─'.repeat(30)}${colors.reset}`);
  console.log(`   总计: ${items.length > 0 ? colors.red : colors.green}${items.length}${colors.reset} 个 blocks\n`);

  if (items.length === 0) {
    console.log(`${colors.green}✅ 没有发现需要清理的数据！${colors.reset}\n`);
    return;
  }

  // Oldest and newest
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  console.log(`${colors.gray}最早创建: ${formatDate(sorted[0].createdAt)}${colors.reset}`);
  console.log(`${colors.gray}最晚创建: ${formatDate(sorted[sorted.length - 1].createdAt)}${colors.reset}\n`);
}

// Main function
async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${colors.cyan}Reblock Cleanup - 数据清理工具${colors.reset}

Usage:
  npm run cleanup -- [options]

Options:
  --preview         预览将要清理的内容（默认）
  --execute         执行清理操作
  --days <n>        覆盖默认时间阈值（默认: ${CONFIG.CLEANUP_DEFAULT_DAYS} 天）
  --yes             跳过确认提示（危险！）
  --help, -h        显示帮助信息

Examples:
  npm run cleanup -- --preview              # 预览
  npm run cleanup -- --execute              # 执行清理
  npm run cleanup -- --days 7 --execute     # 清理 7 天前的数据
  npm run cleanup -- --execute --yes        # 跳过确认
`);
    process.exit(0);
  }

  // Default to preview mode
  if (!options.execute) {
    options.preview = true;
  }

  try {
    await connectDB();

    const cutoffDate = Date.now() - options.days * 24 * 60 * 60 * 1000;
    const { orphaned, linkcountIssues } = await findBlocksToCleanup(cutoffDate);
    const allItems = [...orphaned, ...linkcountIssues];

    printPreviewReport(allItems, cutoffDate, options.days);

    if (options.preview || allItems.length === 0) {
      if (allItems.length > 0) {
        console.log(`${colors.gray}💡 提示: 使用 --execute 执行清理${colors.reset}\n`);
      }
      process.exit(0);
    }

    // Backup reminder
    if (CONFIG.CLEANUP_BACKUP_REMINDER) {
      console.log(`${colors.yellow}💾 备份提示:${colors.reset}`);
      console.log(`   建议先备份数据库再执行清理！`);
      console.log(`   ${colors.gray}备份命令:${colors.reset}`);
      console.log(`   mongodump --db=${CONFIG.MONGO_DATABASE} --out=backup-${new Date().toISOString().split('T')[0].replace(/-/g, '')}\n`);
    }

    // Confirmation
    if (!options.yes) {
      console.log(`${colors.red}⚠️  即将清理 ${allItems.length} 个 blocks！${colors.reset}`);
      console.log(`   - ${orphaned.length} 个孤立 block 将被软删除`);
      console.log(`   - ${linkcountIssues.length} 个 linkcount 将被修正\n`);

      const confirmed = await confirm('确定要继续吗？(y/N): ');
      if (!confirmed) {
        console.log(`\n${colors.gray}已取消操作${colors.reset}\n`);
        process.exit(0);
      }
      console.log();
    }

    // Execute cleanup
    const startTime = Date.now();
    const results = await executeCleanup(allItems);
    const duration = Date.now() - startTime;

    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`${colors.green}✅ 清理完成！${colors.reset}`);
    console.log(`   处理: ${allItems.length} 个 blocks`);
    console.log(`   孤立 blocks: ${results.orphaned.success} 成功, ${results.orphaned.failed} 失败`);
    console.log(`   LinkCount 修正: ${results.linkcount.success} 成功, ${results.linkcount.failed} 失败`);
    console.log(`   耗时: ${duration}ms\n`);

    process.exit(0);

  } catch (error) {
    console.error(`\n${colors.red}✗ 错误: ${error.message}${colors.reset}`);
    if (error.stack) {
      console.error(colors.gray + error.stack + colors.reset);
    }
    process.exit(2);
  } finally {
    await mongoose.disconnect();
  }
}

main();
