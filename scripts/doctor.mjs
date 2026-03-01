#!/usr/bin/env node

/**
 * Reblock Doctor - 健康检查工具
 *
 * 检查 Block 健康状况，发现以下问题：
 * 1. LinkCount 错误 - linkCount 与实际引用的 resource 数量不符
 * 2. 孤立 Block - linkCount=0 但未软删除
 * 3. 文件缺失 - block 对应的物理文件不存在
 * 4. 重复 SHA256 - 多个 block 记录指向相同 SHA256
 *
 * Usage:
 *   node scripts/doctor.mjs                    # 检查所有 blocks
 *   node scripts/doctor.mjs --issues-only      # 只显示有问题的
 *   node scripts/doctor.mjs --block-id <id>    # 检查特定 block
 *   node scripts/doctor.mjs --json             # JSON 输出
 *   node scripts/doctor.mjs --limit 100        # 限制检查数量
 */

import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import { access } from 'fs/promises';
import { resolve, join } from 'path';
import { createHmac } from 'crypto';

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
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

// Issue types
const IssueType = {
  LINKCOUNT_MISMATCH: 'linkcount_mismatch',
  ORPHANED: 'orphaned',
  MISSING_FILE: 'missing_file',
  DUPLICATE_SHA256: 'duplicate_sha256',
};

// Severity levels
const Severity = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const blockIdIndex = args.indexOf('--block-id');
  const limitIndex = args.indexOf('--limit');
  
  return {
    issuesOnly: args.includes('--issues-only'),
    json: args.includes('--json'),
    limit: limitIndex >= 0 ? parseInt(args[limitIndex + 1]) || undefined : undefined,
    blockId: blockIdIndex >= 0 ? args[blockIdIndex + 1] : undefined,
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

// Truncate string
function truncate(str, len = 16) {
  if (!str) return 'N/A';
  if (str.length <= len * 2) return str;
  return str.substring(0, len) + '...' + str.substring(str.length - len);
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

// Check if file exists
async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Check a single block
async function checkBlock(block, options = {}) {
  const issues = [];
  const details = {
    blockId: block._id.toString(),
    sha256: block.sha256,
    size: block.size,
    linkCount: block.linkCount,
    isInvalid: block.isInvalid,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    issues: [],
  };

  // 1. Count actual resource references
  const actualCount = await Resource.countDocuments({
    block: block._id,
    isInvalid: { $ne: true },
  });
  details.actualLinkCount = actualCount;

  // 2. Check linkCount mismatch
  if (block.linkCount !== actualCount) {
    const diff = actualCount - block.linkCount;
    issues.push({
      type: IssueType.LINKCOUNT_MISMATCH,
      severity: Severity.WARNING,
      message: `LinkCount 不匹配`,
      details: {
        current: block.linkCount,
        actual: actualCount,
        diff,
      },
    });
  }

  // 3. Check orphaned block
  if (block.linkCount === 0 && !block.isInvalid) {
    issues.push({
      type: IssueType.ORPHANED,
      severity: Severity.INFO,
      message: `孤立 Block（无任何 resource 引用）`,
      details: {
        reason: 'linkCount=0 但未软删除',
      },
    });
  }

  // 4. Check file existence
  if (!options.skipFileCheck) {
    try {
      const storagePath = getStoragePath(block.sha256);
      const exists = await fileExists(storagePath);
      details.filePath = storagePath;
      details.fileExists = exists;

      if (!exists) {
        issues.push({
          type: IssueType.MISSING_FILE,
          severity: Severity.CRITICAL,
          message: `物理文件缺失`,
          details: {
            path: storagePath,
            impact: `${actualCount} 个 resource 无法正常下载`,
          },
        });
      }
    } catch (error) {
      issues.push({
        type: 'error',
        severity: Severity.CRITICAL,
        message: `检查文件时出错: ${error.message}`,
      });
    }
  }

  details.issues = issues;
  details.hasIssues = issues.length > 0;

  return details;
}

// Check for duplicate SHA256
async function checkDuplicateSha256() {
  const duplicates = await Block.aggregate([
    { $match: { isInvalid: { $ne: true } } },
    { $group: { _id: '$sha256', count: { $sum: 1 }, blocks: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  return duplicates.map(dup => ({
    type: IssueType.DUPLICATE_SHA256,
    severity: Severity.WARNING,
    sha256: dup._id,
    count: dup.count,
    blockIds: dup.blocks.map(id => id.toString()),
    message: `发现 ${dup.count} 个 block 记录具有相同 SHA256`,
  }));
}

// Get resources referencing a block
async function getReferencingResources(blockId) {
  const resources = await Resource.find({
    block: blockId,
    isInvalid: { $ne: true },
  }).limit(10).lean();

  return resources.map(r => ({
    id: r._id.toString(),
    name: r.name || '(unnamed)',
    mime: r.mime || 'unknown',
    createdAt: r.createdAt,
  }));
}

// Print text report
function printTextReport(report, _options) {
  const { summary, blocks, duplicates } = report;

  console.log(`${colors.cyan}🔍 Reblock Doctor - 健康检查报告${colors.reset}`);
  console.log(`${colors.gray}检查时间: ${formatDate(Date.now())}${colors.reset}`);
  console.log(`${'='.repeat(60)}\n`);

  // Summary
  console.log(`${colors.bold}📊 统计摘要${colors.reset}`);
  console.log(`${'-'.repeat(40)}`);
  console.log(`总 Block 数:     ${summary.totalBlocks.toLocaleString()}`);
  console.log(`健康:            ${colors.green}${summary.healthyBlocks.toLocaleString()}${colors.reset} (${summary.healthyPercentage}%)`);
  console.log(`问题:            ${summary.hasIssues ? colors.red : colors.green}${summary.issueBlocks.toLocaleString()}${colors.reset} (${summary.issuePercentage}%)`);
  
  if (summary.issueBreakdown.length > 0) {
    console.log(`\n问题分布:`);
    summary.issueBreakdown.forEach(item => {
      const color = item.severity === Severity.CRITICAL ? colors.red :
                   item.severity === Severity.WARNING ? colors.yellow : colors.blue;
      console.log(`  ${color}●${colors.reset} ${item.label}: ${item.count}`);
    });
  }

  if (duplicates.length > 0) {
    console.log(`\n${colors.yellow}⚠️  发现 ${duplicates.length} 组重复 SHA256${colors.reset}`);
  }

  console.log(`\n${'='.repeat(60)}`);

  // Issues detail
  if (summary.issueBlocks > 0) {
    console.log(`\n${colors.bold}❌ 问题详情 ${colors.gray}(按严重程度排序)${colors.reset}\n`);

    const blocksWithIssues = blocks.filter(b => b.hasIssues);
    
    for (let i = 0; i < blocksWithIssues.length; i++) {
      const block = blocksWithIssues[i];
      const issueNum = i + 1;

      console.log(`${colors.gray}┌─${'─'.repeat(58)}┐${colors.reset}`);
      console.log(`${colors.gray}│${colors.reset} ${colors.bold}问题 #${issueNum}${colors.reset}${' '.repeat(50 - String(issueNum).length)}${colors.gray}│${colors.reset}`);
      console.log(`${colors.gray}├─${'─'.repeat(58)}┤${colors.reset}`);

      block.issues.forEach((issue, idx) => {
        const severityColor = issue.severity === Severity.CRITICAL ? colors.red :
                             issue.severity === Severity.WARNING ? colors.yellow : colors.blue;
        const severityIcon = issue.severity === Severity.CRITICAL ? '🔴' :
                            issue.severity === Severity.WARNING ? '🟡' : '🔵';

        if (idx > 0) {
          console.log(`${colors.gray}│${' '.repeat(58)}│${colors.reset}`);
        }

        console.log(`${colors.gray}│${colors.reset} ${severityIcon} ${severityColor}${issue.message}${colors.reset}`);
        
        if (issue.details) {
          if (issue.type === IssueType.LINKCOUNT_MISMATCH) {
            console.log(`${colors.gray}│${colors.reset}   当前值: ${issue.details.current}`);
            console.log(`${colors.gray}│${colors.reset}   实际值: ${colors.green}${issue.details.actual}${colors.reset}`);
            console.log(`${colors.gray}│${colors.reset}   差异: ${issue.details.diff > 0 ? colors.green : colors.red}${issue.details.diff > 0 ? '+' : ''}${issue.details.diff}${colors.reset}`);
          } else if (issue.type === IssueType.MISSING_FILE) {
            console.log(`${colors.gray}│${colors.reset}   路径: ${colors.gray}${truncate(issue.details.path, 25)}${colors.reset}`);
            console.log(`${colors.gray}│${colors.reset}   影响: ${colors.red}${issue.details.impact}${colors.reset}`);
          } else if (issue.type === IssueType.ORPHANED) {
            console.log(`${colors.gray}│${colors.reset}   原因: ${issue.details.reason}`);
          }
        }
      });

      // Block info
      console.log(`${colors.gray}│${' '.repeat(58)}│${colors.reset}`);
      console.log(`${colors.gray}│${colors.reset} ${colors.gray}Block ID:${colors.reset} ${truncate(block.blockId, 20)}`);
      console.log(`${colors.gray}│${colors.reset} ${colors.gray}SHA256:${colors.reset}   ${truncate(block.sha256, 20)}`);
      console.log(`${colors.gray}│${colors.reset} ${colors.gray}文件大小:${colors.reset} ${formatBytes(block.size)}`);
      
      if (block.fileExists !== undefined) {
        const fileStatus = block.fileExists
          ? `${colors.green}存在${colors.reset}`
          : `${colors.red}缺失${colors.reset}`;
        console.log(`${colors.gray}│${colors.reset} ${colors.gray}文件状态:${colors.reset} ${fileStatus}`);
      }

      // Show referencing resources for linkcount issues
      if (block.actualLinkCount > 0) {
        console.log(`${colors.gray}│${' '.repeat(58)}│${colors.reset}`);
        console.log(`${colors.gray}│${colors.reset} ${colors.gray}引用的 Resources (${block.actualLinkCount} 个):${colors.reset}`);
        if (block.referencingResources) {
          block.referencingResources.slice(0, 3).forEach((res, idx) => {
            console.log(`${colors.gray}│${colors.reset}   ${idx + 1}. ${truncate(res.name, 20)} ${colors.gray}(${truncate(res.id, 10)})${colors.reset}`);
          });
          if (block.referencingResources.length > 3) {
            console.log(`${colors.gray}│${colors.reset}   ... 还有 ${block.referencingResources.length - 3} 个`);
          }
        }
      }

      console.log(`${colors.gray}└─${'─'.repeat(58)}┘${colors.reset}\n`);
    }
  }

  // Duplicate SHA256 section
  if (duplicates.length > 0) {
    console.log(`${'='.repeat(60)}`);
    console.log(`\n${colors.bold}🔄 重复 SHA256 详情${colors.reset}\n`);

    duplicates.forEach((dup, idx) => {
      console.log(`${colors.yellow}重复 #${idx + 1}${colors.reset}`);
      console.log(`  SHA256: ${truncate(dup.sha256, 30)}`);
      console.log(`  重复数: ${dup.count} 个 block 记录`);
      console.log(`  Block IDs:`);
      dup.blockIds.forEach(id => {
        console.log(`    - ${id}`);
      });
      console.log();
    });
  }

  // Footer
  console.log(`${'='.repeat(60)}`);
  if (summary.hasIssues) {
    console.log(`\n${colors.yellow}💡 提示: 发现 ${summary.totalIssues} 个问题，建议检查数据一致性${colors.reset}`);
    console.log(`${colors.gray}   退出码: 1${colors.reset}\n`);
  } else {
    console.log(`\n${colors.green}✓ 所有检查通过，数据健康${colors.reset}`);
    console.log(`${colors.gray}   退出码: 0${colors.reset}\n`);
  }
}

// Print JSON report
function printJsonReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

// Log issues to the logging system
async function logDetectedIssues(results, duplicates) {
  try {
    const service = await initLogService();
    const scriptVersion = '1.0.0';
    const environment = process.env.NODE_ENV || 'development';

    // Log block-level issues
    for (const result of results) {
      if (!result.hasIssues) continue;

      for (const issue of result.issues) {
        // Map internal issue types to LogCategory
        let category;
        let level;
        let recoverable = true;
        let dataLossRisk = 'none';
        let recoverySteps = [];

        switch (issue.type) {
          case IssueType.LINKCOUNT_MISMATCH:
            category = 'LINKCOUNT_MISMATCH';
            level = 'WARNING';
            recoverable = true;
            dataLossRisk = 'none';
            recoverySteps = ['Run cleanup to fix linkCount'];
            break;
          case IssueType.ORPHANED:
            category = 'ORPHANED_BLOCK';
            level = 'INFO';
            recoverable = true;
            dataLossRisk = 'none';
            recoverySteps = ['Run cleanup to soft delete orphaned blocks'];
            break;
          case IssueType.MISSING_FILE:
            category = 'MISSING_FILE';
            level = 'CRITICAL';
            recoverable = false;
            dataLossRisk = 'high';
            recoverySteps = [
              'Check backup storage',
              'Restore file from backup if available',
              'Or mark resources as invalid'
            ];
            break;
          case IssueType.DUPLICATE_SHA256:
            category = 'DUPLICATE_SHA256';
            level = 'ERROR';
            recoverable = true;
            dataLossRisk = 'low';
            recoverySteps = ['Review duplicate blocks', 'Merge if safe'];
            break;
          default:
            category = 'RUNTIME_ERROR';
            level = 'ERROR';
            recoverable = false;
            dataLossRisk = 'medium';
        }

        // Check for duplicates within 24 hours
        const isDuplicate = await service.checkDuplicate(category, result.blockId, 24);
        if (isDuplicate) {
          console.log(`Skipping duplicate log for ${category} on block ${result.blockId}`);
          continue;
        }

        // Build context
        const context = {
          detectedBy: 'doctor',
          scriptVersion,
          environment,
          originalCreatedAt: result.createdAt,
          daysSinceCreation: Math.floor((Date.now() - result.createdAt) / (24 * 60 * 60 * 1000)),
        };

        // Build details
        const details = {
          ...issue.details,
          sha256: result.sha256,
          size: result.size,
        };

        // Log the issue
        await service.logIssue({
          level,
          category,
          blockId: result.blockId,
          resourceIds: result.referencingResources?.map(r => r.id) || [],
          details,
          suggestedAction: issue.type === IssueType.MISSING_FILE
            ? 'Mark block as invalid and restore from backup if available'
            : issue.type === IssueType.ORPHANED
            ? 'Soft delete this block using cleanup tool'
            : issue.type === IssueType.LINKCOUNT_MISMATCH
            ? 'Fix linkCount to match actual resource count'
            : 'Review and take appropriate action',
          recoverable,
          dataLossRisk,
          recoverySteps,
          context,
        });

        console.log(`Logged ${category} for block ${result.blockId}`);
      }
    }

    // Log duplicate SHA256 issues
    for (const dup of duplicates) {
      const isDuplicate = await service.checkDuplicate('DUPLICATE_SHA256', dup.blockIds[0], 24);
      if (isDuplicate) continue;

      await service.logIssue({
        level: 'ERROR',
        category: 'DUPLICATE_SHA256',
        details: {
          sha256: dup.sha256,
          duplicateCount: dup.count,
          blockIds: dup.blockIds,
        },
        suggestedAction: 'Review duplicate blocks and merge if safe',
        recoverable: true,
        dataLossRisk: 'low',
        recoverySteps: ['Review each duplicate block', 'Ensure data integrity before merging'],
        context: {
          detectedBy: 'doctor',
          scriptVersion,
          environment,
        },
      });
    }

    console.log('All issues logged successfully');
  } catch (error) {
    console.error('Failed to log issues:', error);
    // Don't fail the doctor run if logging fails
  }
}

// Main function
async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${colors.cyan}Reblock Doctor - 健康检查工具${colors.reset}

Usage:
  node scripts/doctor.mjs [options]

Options:
  --issues-only     只显示有问题的 blocks
  --block-id <id>   检查特定 block ID
  --limit <n>       限制检查数量
  --json            以 JSON 格式输出
  --help, -h        显示帮助信息

Examples:
  node scripts/doctor.mjs                    # 检查所有 blocks
  node scripts/doctor.mjs --issues-only      # 只显示有问题的
  node scripts/doctor.mjs --block-id abc123  # 检查特定 block
  node scripts/doctor.mjs --json > report.json
`);
    process.exit(0);
  }

  try {
    await connectDB();

    // Build query
    const query = { isInvalid: { $ne: true } };
    if (options.blockId && options.blockId !== 'undefined') {
      try {
        query._id = new mongoose.Types.ObjectId(options.blockId);
      } catch {
        console.error(`${colors.red}✗ 无效的 Block ID 格式: ${options.blockId}${colors.reset}`);
        console.error(`${colors.gray}Block ID 必须是 24 字符的十六进制字符串${colors.reset}`);
        process.exit(2);
      }
    }

    // Get blocks
    let blocksQuery = Block.find(query).sort({ createdAt: -1 });
    if (options.limit) {
      blocksQuery = blocksQuery.limit(options.limit);
    }
    const blocks = await blocksQuery.lean();

    if (blocks.length === 0) {
      console.log(`${colors.yellow}未找到符合条件的 block${colors.reset}`);
      process.exit(0);
    }

    // Check each block
    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const result = await checkBlock(block);
      
      // Get referencing resources if there are issues
      if (result.hasIssues && result.actualLinkCount > 0) {
        result.referencingResources = await getReferencingResources(block._id);
      }
      
      results.push(result);

      // Progress bar
      if (!options.json && blocks.length > 10) {
        const progress = ((i + 1) / blocks.length * 100).toFixed(1);
        process.stdout.write(`\r${colors.gray}检查进度: ${progress}% (${i + 1}/${blocks.length})${colors.reset}`);
      }
    }

    if (!options.json && blocks.length > 10) {
      process.stdout.write('\n\n');
    }

    const duration = Date.now() - startTime;

    // Check duplicates
    const duplicates = await checkDuplicateSha256();

    // Build report
    const issueBlocks = results.filter(r => r.hasIssues);
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
    
    // Count issues by type
    const issueCounts = {};
    results.forEach(r => {
      r.issues.forEach(issue => {
        issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
      });
    });

    const issueBreakdown = [
      issueCounts[IssueType.MISSING_FILE] && { 
        type: IssueType.MISSING_FILE, 
        label: '文件缺失', 
        count: issueCounts[IssueType.MISSING_FILE],
        severity: Severity.CRITICAL 
      },
      issueCounts[IssueType.LINKCOUNT_MISMATCH] && { 
        type: IssueType.LINKCOUNT_MISMATCH, 
        label: 'LinkCount 错误', 
        count: issueCounts[IssueType.LINKCOUNT_MISMATCH],
        severity: Severity.WARNING 
      },
      issueCounts[IssueType.ORPHANED] && { 
        type: IssueType.ORPHANED, 
        label: '孤立 Block', 
        count: issueCounts[IssueType.ORPHANED],
        severity: Severity.INFO 
      },
    ].filter(Boolean);

    const report = {
      summary: {
        totalBlocks: blocks.length,
        healthyBlocks: blocks.length - issueBlocks.length,
        issueBlocks: issueBlocks.length,
        healthyPercentage: ((blocks.length - issueBlocks.length) / blocks.length * 100).toFixed(1),
        issuePercentage: (issueBlocks.length / blocks.length * 100).toFixed(1),
        totalIssues,
        hasIssues: totalIssues > 0 || duplicates.length > 0,
        duplicateGroups: duplicates.length,
        duration: `${duration}ms`,
        checkedAt: new Date().toISOString(),
        issueBreakdown,
      },
      blocks: options.issuesOnly ? issueBlocks : results,
      duplicates,
    };

    // Output
    if (options.json) {
      printJsonReport(report);
    } else {
      printTextReport(report, options);
    }

    // Log detected issues to the logging system
    if (report.summary.hasIssues) {
      console.log('\nLogging issues to database...');
      await logDetectedIssues(results, duplicates);
    }

    // Exit code
    process.exit(report.summary.hasIssues ? 1 : 0);

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
