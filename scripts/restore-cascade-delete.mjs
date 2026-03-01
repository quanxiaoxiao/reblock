#!/usr/bin/env node

/**
 * Reblock Restore Cascade Delete - 恢复级联删除操作
 *
 * 从日志中恢复因级联删除而软删除的 Entry、Resource 和 Block
 *
 * Usage:
 *   node scripts/restore-cascade-delete.mjs --preview              # 预览可恢复的内容
 *   node scripts/restore-cascade-delete.mjs --execute              # 执行恢复（带确认）
 *   node scripts/restore-cascade-delete.mjs --days 30              # 覆盖默认时间（30天）
 *   node scripts/restore-cascade-delete.mjs --execute --yes         # 跳过确认（危险！）
 *   node scripts/restore-cascade-delete.mjs --entry <alias>          # 恢复指定 alias 的 entry
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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
  MONGO_PORT: parseInt(process.env.MONGO_PORT || '27017'),
  MONGO_DATABASE: process.env.MONGO_DATABASE || 'reblock',
  MONGO_USERNAME: process.env.MONGO_USERNAME,
  MONGO_PASSWORD: process.env.MONGO_PASSWORD,
  CASCADE_DELETE_LOG_DAYS: parseInt(process.env.CASCADE_DELETE_LOG_DAYS || '30'),
};

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

function parseArgs() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  const entryIndex = args.indexOf('--entry');
  
  return {
    preview: args.includes('--preview'),
    execute: args.includes('--execute'),
    days: daysIndex >= 0 ? parseInt(args[daysIndex + 1]) || CONFIG.CASCADE_DELETE_LOG_DAYS : CONFIG.CASCADE_DELETE_LOG_DAYS,
    targetAlias: entryIndex >= 0 ? args[entryIndex + 1] : null,
    yes: args.includes('--yes'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function connectDB() {
  const auth = CONFIG.MONGO_USERNAME && CONFIG.MONGO_PASSWORD
    ? `${CONFIG.MONGO_USERNAME}:${CONFIG.MONGO_PASSWORD}@`
    : '';
  const authSource = auth ? '?authSource=admin' : '';
  const uri = `mongodb://${auth}${CONFIG.MONGO_HOSTNAME}:${CONFIG.MONGO_PORT}/${CONFIG.MONGO_DATABASE}${authSource}`;

  await mongoose.connect(uri);
  console.log(`${colors.green}✓${colors.reset} Connected to MongoDB: ${CONFIG.MONGO_DATABASE}\n`);
}

const logEntrySchema = new mongoose.Schema({
  timestamp: { type: Number },
  level: { type: String },
  category: { type: String },
  entryIds: [{ type: String }],
  resourceIds: [{ type: String }],
  details: { type: mongoose.Schema.Types.Mixed },
  suggestedAction: { type: String },
  recoverable: { type: Boolean },
  dataLossRisk: { type: String },
  recoverySteps: [{ type: String }],
  status: { type: String },
  statusHistory: [{ type: mongoose.Schema.Types.Mixed }],
  resolvedAt: { type: Number },
  resolution: { type: String },
  resolvedBy: { type: String },
  createdAt: { type: Date, expires: '90d' },
});

const blockSchema = new mongoose.Schema({
  sha256: { type: String, required: true },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  linkCount: { type: Number, default: 1 },
  size: { type: Number },
  isInvalid: { type: Boolean, default: false },
  invalidatedAt: { type: Number },
});

const resourceSchema = new mongoose.Schema({
  block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block', required: true },
  mime: { type: String },
  entry: { type: mongoose.Schema.Types.ObjectId, ref: 'Entry', required: true },
  name: { type: String, default: '' },
  description: { type: String, default: '' },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  isInvalid: { type: Boolean, default: false },
  invalidatedAt: { type: Number },
});

const entrySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  alias: { type: String, default: '', trim: true, index: true },
  isDefault: { type: Boolean, default: false },
  order: { type: Number },
  createdAt: { type: Number, default: Date.now },
  updatedAt: { type: Number, default: Date.now },
  description: { type: String, default: '' },
  isInvalid: { type: Boolean, default: false },
  invalidatedAt: { type: Number },
});

const LogEntry = mongoose.model('LogEntry', logEntrySchema);
const Block = mongoose.model('Block', blockSchema);
const Resource = mongoose.model('Resource', resourceSchema);
const Entry = mongoose.model('Entry', entrySchema);

function askQuestion(query) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function confirm(message) {
  const answer = await askQuestion(`${message} `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

async function findCascadeDeleteLogs(cutoffDate, targetAlias = null) {
  const filter = {
    category: 'CLEANUP_ACTION',
    'details.operation': 'cascade_soft_delete_entry',
    timestamp: { $gte: cutoffDate.getTime() },
  };

  const logs = await LogEntry.find(filter).lean();

  if (targetAlias) {
    return logs.filter(log => {
      const entry = log.details?.deletedEntry;
      return entry?.alias === targetAlias;
    });
  }

  return logs;
}

async function restoreFromLog(log) {
  const { deletedEntry, deletedResources, blockLinkCountChanges } = log.details;
  const results = {
    entry: { success: false, error: null },
    resources: { success: 0, failed: 0 },
    blocks: { success: 0, failed: 0 },
  };

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Restore Entry
    const entryUpdate = await Entry.findByIdAndUpdate(
      deletedEntry._id,
      {
        isInvalid: false,
        $unset: { invalidatedAt: '' },
        updatedAt: Date.now(),
      },
      { session }
    );

    if (entryUpdate) {
      results.entry.success = true;
    } else {
      results.entry.error = 'Entry not found';
    }

    // Restore Resources
    for (const resource of deletedResources) {
      try {
        const resourceUpdate = await Resource.findByIdAndUpdate(
          resource._id,
          {
            isInvalid: false,
            $unset: { invalidatedAt: '' },
            updatedAt: Date.now(),
          },
          { session }
        );

        if (resourceUpdate) {
          results.resources.success++;
        } else {
          results.resources.failed++;
        }
      } catch (e) {
        results.resources.failed++;
      }
    }

    // Restore Block linkCount
    for (const change of blockLinkCountChanges) {
      try {
        await Block.findByIdAndUpdate(
          change.blockId,
          { linkCount: change.oldLinkCount },
          { session }
        );
        results.blocks.success++;
      } catch (e) {
        results.blocks.failed++;
      }
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    results.entry.error = error.message;
  } finally {
    session.endSession();
  }

  return results;
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${colors.bold}Reblock Restore Cascade Delete${colors.reset}

恢复因级联删除而软删除的 Entry、Resource 和 Block

${colors.bold}Usage:${colors.reset}
  node scripts/restore-cascade-delete.mjs [options]

${colors.bold}Options:${colors.reset}
  --preview              预览可恢复的内容
  --execute              执行恢复（带确认）
  --days <n>            覆盖默认时间（默认: ${CONFIG.CASCADE_DELETE_LOG_DAYS} 天）
  --entry <alias>       恢复指定 alias 的 entry
  --yes                 跳过确认（危险！）
  --help, -h            显示帮助

${colors.bold}Examples:${colors.reset}
  node scripts/restore-cascade-delete.mjs --preview
  node scripts/restore-cascade-delete.mjs --execute
  node scripts/restore-cascade-delete.mjs --days 7 --execute
  node scripts/restore-cascade-delete.mjs --entry my-alias --execute
`);
    process.exit(0);
  }

  console.log(`${colors.bold}Reblock Restore Cascade Delete${colors.reset}\n`);
  console.log(`Configuration:`);
  console.log(`  Time window: ${options.days} days`);
  if (options.targetAlias) {
    console.log(`  Target alias: ${options.targetAlias}`);
  }
  console.log();

  try {
    await connectDB();

    const cutoffDate = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);
    const logs = await findCascadeDeleteLogs(cutoffDate, options.targetAlias);

    if (logs.length === 0) {
      console.log(`${colors.yellow}没有找到可恢复的级联删除记录${colors.reset}\n`);
      console.log(`提示: 时间窗口为 ${options.days} 天，可使用 --days 参数调整\n`);
      process.exit(0);
    }

    console.log(`${colors.cyan}找到 ${logs.length} 条可恢复的记录:${colors.reset}\n`);

    for (const log of logs) {
      const entry = log.details?.deletedEntry;
      const resources = log.details?.deletedResources || [];
      const blocks = log.details?.blockLinkCountChanges || [];

      console.log(`  ${colors.bold}Entry:${colors.reset} ${entry?.name} (${entry?.alias})`);
      console.log(`    ID: ${entry?._id}`);
      console.log(`    Resources: ${resources.length}`);
      console.log(`    Block linkCount changes: ${blocks.length}`);
      console.log(`    Deleted at: ${new Date(log.timestamp).toLocaleString('zh-CN')}`);
      console.log();
    }

    if (options.preview) {
      console.log(`${colors.yellow}预览模式 - 未执行任何操作${colors.reset}\n`);
      process.exit(0);
    }

    // Confirmation
    if (!options.yes) {
      console.log(`${colors.red}⚠️  即将恢复 ${logs.length} 条记录！${colors.reset}`);
      console.log(`   这将恢复 Entry、Resource 和 Block 的 linkCount\n`);

      const confirmed = await confirm('确定要继续吗？(y/N): ');
      if (!confirmed) {
        console.log(`\n${colors.gray}已取消操作${colors.reset}\n`);
        process.exit(0);
      }
      console.log();
    }

    // Execute restore
    const startTime = Date.now();
    let totalResources = 0;
    let totalBlocks = 0;
    let failed = 0;

    for (const log of logs) {
      const entry = log.details?.deletedEntry;
      console.log(`${colors.cyan}恢复: ${entry?.name} (${entry?.alias})${colors.reset}`);

      const results = await restoreFromLog(log);

      if (results.entry.success) {
        console.log(`  ${colors.green}✓${colors.reset} Entry 恢复成功`);
      } else {
        console.log(`  ${colors.red}✗${colors.reset} Entry 恢复失败: ${results.entry.error}`);
        failed++;
      }

      console.log(`  ${colors.green}✓${colors.reset} Resources 恢复: ${results.resources.success}/${results.resources.success + results.resources.failed}`);
      console.log(`  ${colors.green}✓${colors.reset} Block linkCount 恢复: ${results.blocks.success}/${results.blocks.success + results.blocks.failed}`);

      totalResources += results.resources.success;
      totalBlocks += results.blocks.success;
    }

    const duration = Date.now() - startTime;

    console.log(`\n${'='.repeat(50)}`);
    console.log(`${colors.green}✅ 恢复完成！${colors.reset}`);
    console.log(`   处理: ${logs.length} 个 entries`);
    console.log(`   Resources 恢复: ${totalResources}`);
    console.log(`   Block linkCount 恢复: ${totalBlocks}`);
    console.log(`   失败: ${failed}`);
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
