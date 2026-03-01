#!/usr/bin/env node

/**
 * Resource Analysis Report
 * 
 * Generates a comprehensive analysis report for a Resource including:
 * - Basic information and metadata
 * - Upload details (time, duration, client info)
 * - Block association and health checks
 * - Anomaly detection
 * - Recent activity logs
 * 
 * Usage:
 *   node scripts/resource-report.mjs --resource-id <id>
 *   node scripts/resource-report.mjs --resource-id <id> --json
 *   node scripts/resource-report.mjs --resource-id <id> --days 7
 * 
 * Options:
 *   --resource-id <id>     Resource ID to analyze (required)
 *   --json                Output as JSON
 *   --days <n>            Days of history to analyze (default: 30)
 *   --verbose             Show detailed information
 *   --help                Show this help
 */

import { readFileSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import mongoose from 'mongoose';
import { createHash } from 'crypto';

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
  MONGO_URI: '',
  DAYS: 30,
};

function initializeConfig() {
  const mongoHost = process.env.MONGO_HOSTNAME || 'localhost';
  const mongoPort = process.env.MONGO_PORT || '27017';
  const mongoDb = process.env.MONGO_DATABASE || 'reblock';
  const mongoUser = process.env.MONGO_USERNAME;
  const mongoPass = process.env.MONGO_PASSWORD;
  
  const auth = mongoUser && mongoPass ? `${mongoUser}:${mongoPass}@` : '';
  const authSource = auth ? '?authSource=admin' : '';
  CONFIG.MONGO_URI = `mongodb://${auth}${mongoHost}:${mongoPort}/${mongoDb}${authSource}`;
  
  // Get storage directory from env or use default
  const blockDir = process.env.STORAGE_BLOCK_DIR || './storage/blocks';
  CONFIG.BLOCKS_DIR = resolve(process.cwd(), blockDir);
}

initializeConfig();

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

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  const resourceIdIndex = args.indexOf('--resource-id');
  const daysIndex = args.indexOf('--days');
  
  return {
    resourceId: resourceIdIndex >= 0 ? args[resourceIdIndex + 1] : null,
    json: args.includes('--json'),
    verbose: args.includes('--verbose'),
    days: daysIndex >= 0 ? parseInt(args[daysIndex + 1]) || 30 : 30,
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Print helpers
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function warn(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function info(message) {
  console.log(`${colors.gray}  ${message}${colors.reset}`);
}

function section(title) {
  console.log(`\n${colors.cyan}${colors.bold}${title}${colors.reset}`);
  console.log(`${colors.gray}${'━'.repeat(50)}${colors.reset}`);
}

// Connect to MongoDB
async function connectDB() {
  await mongoose.connect(CONFIG.MONGO_URI);
}

async function disconnectDB() {
  await mongoose.disconnect();
}

// Define schemas directly (avoid ES module import issues)
function loadModels() {
  const resourceSchema = new mongoose.Schema({
    block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block' },
    entry: { type: mongoose.Schema.Types.ObjectId, ref: 'Entry' },
    mime: String,
    category: String,
    description: { type: String, default: '' },
    name: { type: String, default: '' },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
    lastAccessedAt: { type: Number, default: Date.now },
    isInvalid: { type: Boolean, default: false },
    invalidatedAt: Number,
    clientIp: String,
    userAgent: String,
    uploadDuration: Number,
  });

  const blockSchema = new mongoose.Schema({
    sha256: { type: String, required: true, unique: true },
    size: { type: Number, required: true },
    linkCount: { type: Number, default: 1 },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
    isInvalid: { type: Boolean, default: false },
    invalidatedAt: Number,
  });

  const entrySchema = new mongoose.Schema({
    name: { type: String, required: true },
    alias: { type: String, unique: true, sparse: true },
    order: { type: Number, default: 0 },
    description: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    uploadConfig: {
      readOnly: Boolean,
      maxFileSize: Number,
      allowedMimeTypes: [String],
    },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
    isInvalid: { type: Boolean, default: false },
    invalidatedAt: Number,
  });

  const logEntrySchema = new mongoose.Schema({
    timestamp: { type: Number, required: true },
    level: { type: String, enum: ['CRITICAL', 'ERROR', 'WARNING', 'INFO'], required: true },
    category: { type: String, required: true },
    blockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Block' },
    resourceIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Resource' }],
    entryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Entry' }],
    details: mongoose.Schema.Types.Mixed,
    context: mongoose.Schema.Types.Mixed,
    expiresAt: Date,
  });

  const Resource = mongoose.models.Resource || mongoose.model('Resource', resourceSchema);
  const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);
  const Entry = mongoose.models.Entry || mongoose.model('Entry', entrySchema);
  const LogEntry = mongoose.models.LogEntry || mongoose.model('LogEntry', logEntrySchema);

  return { Resource, Block, Entry, LogEntry };
}

// Get storage path for block
function getStoragePath(sha256) {
  const prefix = sha256.substring(0, 2);
  return join(CONFIG.BLOCKS_DIR, prefix, sha256);
}

// Format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format date
function formatDate(timestamp) {
  return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
}

// Format duration
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

// Compute SHA256 of file
async function computeSHA256(filePath) {
  const crypto = await import('crypto');
  const fs = await import('fs');
  
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Main analysis function
async function analyzeResource(resourceId, models, options) {
  const { Resource, Block, Entry, LogEntry } = models;
  const { days } = options;
  
  const report = {
    timestamp: Date.now(),
    resourceId,
    resource: null,
    entry: null,
    block: null,
    health: {},
    anomalies: [],
    logs: [],
    summary: {},
  };
  
  // 1. Get resource
  const resource = await Resource.findById(resourceId)
    .populate('block')
    .populate('entry', 'name alias isDefault')
    .lean();
  
  if (!resource) {
    throw new Error(`Resource ${resourceId} not found`);
  }
  
  report.resource = resource;
  report.entry = resource.entry;
  report.block = resource.block;
  
  // 2. Health checks
  const health = {
    resourceExists: true,
    blockExists: !!resource.block,
    fileExists: false,
    linkCountMatch: false,
    sizeMatch: false,
    sha256Match: false,
    blockValid: resource.block && !resource.block.isInvalid,
    metadataConsistent: true,
  };
  
  if (resource.block) {
    const block = resource.block;
    const storagePath = getStoragePath(block.sha256);
    
    // Check physical file
    health.fileExists = existsSync(storagePath);
    
    // Check linkCount
    const actualRefCount = await Resource.countDocuments({
      block: block._id,
      isInvalid: { $ne: true },
    });
    health.linkCountMatch = block.linkCount === actualRefCount;
    health.actualRefCount = actualRefCount;
    
    // Check file size
    if (health.fileExists) {
      try {
        const stats = statSync(storagePath);
        health.actualFileSize = stats.size;
        health.sizeMatch = stats.size === block.size;
        
        // Check SHA256 (expensive, only do if file is small)
        if (stats.size < 10 * 1024 * 1024) { // Only for files < 10MB
          const actualSha256 = await computeSHA256(storagePath);
          health.actualSha256 = actualSha256;
          health.sha256Match = actualSha256 === block.sha256;
        } else {
          health.sha256Match = null; // Skipped for large files
        }
      } catch (err) {
        health.fileReadError = err.message;
      }
    }
    
    // Check metadata consistency
    if (block.isInvalid && block.linkCount > 0) {
      health.metadataConsistent = false;
    }
  }
  
  report.health = health;
  
  // 3. Detect anomalies
  const anomalies = [];
  
  if (!health.blockExists) {
    anomalies.push({
      type: 'ORPHANED_RESOURCE',
      severity: 'CRITICAL',
      description: 'Resource references non-existent block',
      details: { blockId: resource.block?._id },
    });
  }
  
  if (health.blockExists && !health.fileExists) {
    anomalies.push({
      type: 'MISSING_FILE',
      severity: 'CRITICAL',
      description: 'Physical file missing from storage',
      details: { expectedPath: getStoragePath(resource.block.sha256) },
    });
  }
  
  if (!health.linkCountMatch) {
    anomalies.push({
      type: 'LINKCOUNT_MISMATCH',
      severity: 'WARNING',
      description: `Block linkCount (${resource.block.linkCount}) doesn't match actual references (${health.actualRefCount})`,
      details: {
        expected: resource.block.linkCount,
        actual: health.actualRefCount,
      },
    });
  }
  
  if (health.actualFileSize && !health.sizeMatch) {
    anomalies.push({
      type: 'FILE_SIZE_MISMATCH',
      severity: 'WARNING',
      description: `File size mismatch: DB=${resource.block.size}, Actual=${health.actualFileSize}`,
      details: {
        dbSize: resource.block.size,
        actualSize: health.actualFileSize,
      },
    });
  }
  
  if (health.sha256Match === false) {
    anomalies.push({
      type: 'SHA256_MISMATCH',
      severity: 'CRITICAL',
      description: 'File SHA256 hash mismatch - file may be corrupted',
      details: {
        dbSha256: resource.block.sha256,
        actualSha256: health.actualSha256,
      },
    });
  }
  
  if (!health.blockValid) {
    anomalies.push({
      type: 'INVALID_BLOCK',
      severity: 'WARNING',
      description: 'Resource references a soft-deleted block',
      details: { blockId: resource.block._id },
    });
  }
  
  if (!health.metadataConsistent) {
    anomalies.push({
      type: 'METADATA_INCONSISTENCY',
      severity: 'WARNING',
      description: 'Block is marked invalid but still has references',
      details: { linkCount: resource.block.linkCount },
    });
  }
  
  report.anomalies = anomalies;
  
  // 4. Query logs
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);
  
  const logs = await LogEntry.find({
    $or: [
      { resourceIds: new mongoose.Types.ObjectId(resourceId) },
      { blockId: resource.block?._id },
    ],
    timestamp: { $gte: since },
  })
    .sort({ timestamp: -1 })
    .limit(50)
    .lean();
  
  report.logs = logs;
  
  // 5. Generate summary
  const criticalCount = anomalies.filter(a => a.severity === 'CRITICAL').length;
  const warningCount = anomalies.filter(a => a.severity === 'WARNING').length;
  
  let healthScore = 100;
  healthScore -= criticalCount * 30;
  healthScore -= warningCount * 10;
  healthScore = Math.max(0, healthScore);
  
  report.summary = {
    totalAnomalies: anomalies.length,
    criticalCount,
    warningCount,
    healthScore,
    status: criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'HEALTHY',
    logsFound: logs.length,
    analysisDate: new Date().toISOString(),
    daysAnalyzed: days,
  };
  
  return report;
}

// Print text report
function printTextReport(report) {
  const { resource, entry, block, health, anomalies, logs, summary } = report;
  
  console.log(`\n${colors.cyan}${colors.bold}📊 Resource Analysis Report${colors.reset}`);
  console.log(`${colors.gray}${'━'.repeat(50)}${colors.reset}\n`);
  
  // Resource Information
  section('🔍 Resource Information');
  info(`ID:            ${resource._id}`);
  info(`Name:          ${resource.name || '(empty)'}`);
  info(`MIME Type:     ${resource.mime || '(unknown)'}`);
  info(`Category:      ${resource.category || '(none)'}`);
  info(`Status:        ${resource.isInvalid ? colors.red + '✗ Deleted' : colors.green + '✓ Active'}`);
  info(`Description:   ${resource.description || '(none)'}`);
  
  // Entry Information
  if (entry) {
    section('📁 Entry Information');
    info(`ID:            ${entry._id}`);
    info(`Name:          ${entry.name}`);
    info(`Alias:         ${entry.alias}`);
    info(`Is Default:    ${entry.isDefault ? 'Yes' : 'No'}`);
  }
  
  // Upload Information
  section('⏱️  Upload Information');
  info(`Upload Time:   ${formatDate(resource.createdAt)}`);
  if (resource.uploadDuration) {
    info(`Duration:      ${formatDuration(resource.uploadDuration)}`);
    const speed = resource.block ? (resource.block.size / (resource.uploadDuration / 1000)) : 0;
    info(`Transfer Speed: ${formatBytes(speed)}/s`);
  }
  if (resource.clientIp) {
    info(`Client IP:     ${resource.clientIp}`);
  }
  if (resource.userAgent) {
    info(`User Agent:    ${resource.userAgent.substring(0, 60)}${resource.userAgent.length > 60 ? '...' : ''}`);
  }
  
  // Block Association
  if (block) {
    section('📦 Block Association');
    info(`Block ID:      ${block._id}`);
    info(`SHA256:        ${block.sha256.substring(0, 32)}...`);
    info(`Size:          ${formatBytes(block.size)} (${block.size} bytes)`);
    info(`Link Count:    ${block.linkCount}`);
    info(`Created:       ${formatDate(block.createdAt)}`);
    info(`Storage Path:  ${getStoragePath(block.sha256)}`);
  }
  
  // Health Check Results
  section('⚠️  Health Check Results');
  
  if (health.resourceExists) {
    success('Resource exists in database');
  } else {
    error('Resource not found');
  }
  
  if (health.blockExists) {
    success('Block association valid');
  } else {
    error('Block association broken - resource is orphaned');
  }
  
  if (health.fileExists) {
    success('Physical file exists');
  } else {
    error('Physical file missing');
  }
  
  if (health.linkCountMatch) {
    success(`Link count correct (${block.linkCount}/${health.actualRefCount})`);
  } else {
    warn(`Link count mismatch: expected ${block.linkCount}, actual ${health.actualRefCount}`);
  }
  
  if (health.sizeMatch) {
    success('File size matches');
  } else if (health.actualFileSize) {
    warn(`File size mismatch: DB=${formatBytes(block.size)}, File=${formatBytes(health.actualFileSize)}`);
  }
  
  if (health.sha256Match === true) {
    success('SHA256 hash verified');
  } else if (health.sha256Match === false) {
    error('SHA256 hash mismatch - file corrupted!');
  } else {
    info('SHA256 check skipped (large file)');
  }
  
  if (health.blockValid) {
    success('Block is valid (not deleted)');
  } else {
    warn('Block is soft-deleted');
  }
  
  // Anomalies
  section('🔍 Anomaly Detection');
  if (anomalies.length === 0) {
    console.log(`${colors.green}${colors.bold}  ✓ No anomalies detected${colors.reset}`);
  } else {
    console.log(`${colors.yellow}  Status: ${summary.criticalCount > 0 ? colors.red + 'CRITICAL' : colors.yellow + 'WARNING'} (${anomalies.length} issues)${colors.reset}\n`);
    
    anomalies.forEach((anomaly, i) => {
      const color = anomaly.severity === 'CRITICAL' ? colors.red : colors.yellow;
      console.log(`  ${color}[${anomaly.severity}]${colors.reset} ${anomaly.type}`);
      console.log(`    ${colors.gray}${anomaly.description}${colors.reset}`);
      if (anomaly.details) {
        Object.entries(anomaly.details).forEach(([key, value]) => {
          console.log(`    ${colors.gray}  ${key}: ${value}${colors.reset}`);
        });
      }
      console.log();
    });
  }
  
  // Recent Logs
  section(`📜 Recent Activity (Last ${report.summary.daysAnalyzed} Days)`);
  if (logs.length === 0) {
    info('No logs found for this resource');
  } else {
    logs.slice(0, 10).forEach(log => {
      const date = new Date(log.timestamp).toISOString().substring(0, 19);
      const level = log.level || 'INFO';
      const color = level === 'CRITICAL' || level === 'ERROR' ? colors.red : 
                    level === 'WARNING' ? colors.yellow : colors.gray;
      console.log(`  ${colors.gray}[${date}]${colors.reset} ${color}[${level}]${colors.reset} ${log.category}`);
      if (log.details?.reason) {
        console.log(`    ${colors.gray}${log.details.reason}${colors.reset}`);
      }
    });
    
    if (logs.length > 10) {
      info(`... and ${logs.length - 10} more entries`);
    }
  }
  
  // Statistics
  section('📈 Statistics');
  info(`Total Anomalies:   ${summary.totalAnomalies}`);
  info(`Critical Issues:   ${summary.criticalCount}`);
  info(`Warnings:          ${summary.warningCount}`);
  info(`Health Score:      ${summary.healthScore}/100`);
  info(`Status:            ${summary.status}`);
  info(`Logs Found:        ${summary.logsFound}`);
  
  console.log(`\n${colors.gray}Report generated at: ${new Date().toISOString()}${colors.reset}\n`);
}

// Main function
async function main() {
  const args = parseArgs();
  
  if (args.help) {
    console.log(`
${colors.cyan}Resource Analysis Report${colors.reset}

Usage:
  node scripts/resource-report.mjs --resource-id <id> [options]

Options:
  --resource-id <id>     Resource ID to analyze (required)
  --json                Output as JSON
  --days <n>            Days of history to analyze (default: 30)
  --verbose             Show detailed information
  --help                Show this help

Examples:
  node scripts/resource-report.mjs --resource-id abc123
  node scripts/resource-report.mjs --resource-id abc123 --json
  node scripts/resource-report.mjs --resource-id abc123 --days 7
`);
    process.exit(0);
  }
  
  if (!args.resourceId) {
    error('Resource ID is required. Use --resource-id <id>');
    process.exit(1);
  }
  
  // Only print headers in text mode
  if (!args.json) {
    console.log(`${colors.cyan}${colors.bold}📊 Resource Analysis Report${colors.reset}`);
    console.log(`${colors.gray}${'━'.repeat(50)}${colors.reset}\n`);
    info(`Analyzing Resource: ${args.resourceId}`);
    info(`History Range: Last ${args.days} days\n`);
  }
  
  await connectDB();
  const models = loadModels();
  
  try {
    const report = await analyzeResource(args.resourceId, models, { days: args.days });
    
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }
    
    // Exit code based on health
    const exitCode = report.summary.criticalCount > 0 ? 1 : 
                     report.summary.warningCount > 0 ? 2 : 0;
    process.exit(exitCode);
    
  } catch (err) {
    error(`Error: ${err.message}`);
    console.error(err);
    process.exit(3);
  } finally {
    await disconnectDB();
  }
}

main().catch(err => {
  console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
  process.exit(1);
});
