#!/usr/bin/env node

/**
 * Resource Analysis Report
 *
 * Usage:
 *   node scripts/resource-report.mjs --resource-id <id>
 *   node scripts/resource-report.mjs --resource-id <id> --json
 *   node scripts/resource-report.mjs --resource-id <id> --days 7
 *
 * Options:
 *   --resource-id <id>   Resource ID to analyze (required)
 *   --json               Output as JSON
 *   --days <n>           Days of history to analyze (default: 30)
 *   --verbose            Show detailed information
 *   --help               Show this help
 */

import { readFileSync, statSync, existsSync, createReadStream } from 'fs';
import { resolve, join } from 'path';
import { createHmac, createDecipheriv, createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import mongoose from 'mongoose';

// ─── Environment ─────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        const [, key, val] = m;
        process.env[key.trim()] ??= val.trim();
      }
    }
  } catch {
    // .env 不存在时忽略
  }
}

loadEnv();

// ─── Config ───────────────────────────────────────────────────────────────────

function buildConfig() {
  const host   = process.env.MONGO_HOSTNAME || 'localhost';
  const port   = process.env.MONGO_PORT     || '27017';
  const db     = process.env.MONGO_DATABASE || 'reblock';
  const user   = process.env.MONGO_USERNAME;
  const pass   = process.env.MONGO_PASSWORD;
  const auth   = user && pass ? `${user}:${pass}@` : '';
  const qs     = auth ? '?authSource=admin' : '';

  return {
    MONGO_URI:      `mongodb://${auth}${host}:${port}/${db}${qs}`,
    BLOCKS_DIR:     resolve(process.cwd(), process.env.STORAGE_BLOCK_DIR || './storage/blocks'),
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    SHA256_SIZE_LIMIT: 10 * 1024 * 1024, // 10 MB
  };
}

const CONFIG = buildConfig();

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

  return {
    resourceId: get('--resource-id'),
    json:       args.includes('--json'),
    verbose:    args.includes('--verbose'),
    days:       parseInt(get('--days') ?? '30', 10) || 30,
    help:       args.includes('--help') || args.includes('-h'),
  };
}

// ─── Terminal helpers ─────────────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
};

const ok   = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const fail = (msg) => console.log(`${c.red}✗${c.reset} ${msg}`);
const warn = (msg) => console.log(`${c.yellow}⚠${c.reset} ${msg}`);
const info = (msg) => console.log(`${c.gray}  ${msg}${c.reset}`);

function section(title) {
  console.log(`\n${c.cyan}${c.bold}${title}${c.reset}`);
  console.log(`${c.gray}${'━'.repeat(50)}${c.reset}`);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

const formatDate     = (ts) => new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const formatDuration = (ms) =>
  ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 60_000).toFixed(2)}m`;

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getEncryptionKey() {
  if (!CONFIG.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY not configured');
  return Buffer.from(CONFIG.ENCRYPTION_KEY, 'base64');
}

function getStoragePath(sha256) {
  const name    = createHmac('sha256', getEncryptionKey()).update(sha256).digest('hex');
  const prefix1 = name.slice(0, 2);
  const prefix2 = name.slice(2, 3);
  return join(CONFIG.BLOCKS_DIR, prefix1, `${prefix2}${name}`);
}

function generateIV(objectId) {
  const buf = Buffer.isBuffer(objectId) ? objectId : Buffer.from(objectId.toString(), 'hex');
  return Buffer.concat([buf, Buffer.alloc(4)]);
}

async function computeSHA256(filePath, iv) {
  const hash         = createHash('sha256');
  const decryptStream = createDecipheriv('aes-256-ctr', getEncryptionKey(), iv);
  await pipeline(createReadStream(filePath), decryptStream, hash);
  return hash.digest('hex');
}

// ─── MongoDB ──────────────────────────────────────────────────────────────────

const connectDB    = () => mongoose.connect(CONFIG.MONGO_URI);
const disconnectDB = () => mongoose.disconnect();

function loadModels() {
  const mk = (name, def) =>
    mongoose.models[name] || mongoose.model(name, new mongoose.Schema(def));

  const ObjectId = mongoose.Schema.Types.ObjectId;

  const Resource = mk('Resource', {
    block:          { type: ObjectId, ref: 'Block' },
    entry:          { type: ObjectId, ref: 'Entry' },
    mime:           String,
    category:       String,
    description:    { type: String, default: '' },
    name:           { type: String, default: '' },
    createdAt:      { type: Number, default: Date.now },
    updatedAt:      { type: Number, default: Date.now },
    lastAccessedAt: { type: Number, default: Date.now },
    isInvalid:      { type: Boolean, default: false },
    invalidatedAt:  Number,
    clientIp:       String,
    userAgent:      String,
    uploadDuration: Number,
  });

  const Block = mk('Block', {
    sha256:       { type: String, required: true, unique: true },
    size:         { type: Number, required: true },
    linkCount:    { type: Number, default: 1 },
    createdAt:    { type: Number, default: Date.now },
    updatedAt:    { type: Number, default: Date.now },
    isInvalid:    { type: Boolean, default: false },
    invalidatedAt: Number,
  });

  const Entry = mk('Entry', {
    name:         { type: String, required: true },
    alias:        { type: String, unique: true, sparse: true },
    order:        { type: Number, default: 0 },
    description:  { type: String, default: '' },
    isDefault:    { type: Boolean, default: false },
    uploadConfig: { readOnly: Boolean, maxFileSize: Number, allowedMimeTypes: [String] },
    createdAt:    { type: Number, default: Date.now },
    updatedAt:    { type: Number, default: Date.now },
    isInvalid:    { type: Boolean, default: false },
    invalidatedAt: Number,
  });

  const LogEntry = mk('LogEntry', {
    timestamp:   { type: Number, required: true },
    level:       { type: String, enum: ['CRITICAL', 'ERROR', 'WARNING', 'INFO'], required: true },
    category:    { type: String, required: true },
    blockId:     { type: ObjectId, ref: 'Block' },
    resourceIds: [{ type: ObjectId, ref: 'Resource' }],
    entryIds:    [{ type: ObjectId, ref: 'Entry' }],
    details:     mongoose.Schema.Types.Mixed,
    context:     mongoose.Schema.Types.Mixed,
    expiresAt:   Date,
  });

  return { Resource, Block, Entry, LogEntry };
}

// ─── Anomaly builders ─────────────────────────────────────────────────────────

function buildAnomalies(health, resource) {
  const block     = resource.block;
  const anomalies = [];

  const add = (type, severity, description, details) =>
    anomalies.push({ type, severity, description, details });

  if (!health.blockExists) {
    add('ORPHANED_RESOURCE', 'CRITICAL',
      'Resource references non-existent block',
      { blockId: block?._id });
  }

  if (health.blockExists && !health.fileExists) {
    add('MISSING_FILE', 'CRITICAL',
      'Physical file missing from storage',
      { expectedPath: getStoragePath(block.sha256) });
  }

  if (!health.linkCountMatch) {
    add('LINKCOUNT_MISMATCH', 'WARNING',
      `Block linkCount (${block.linkCount}) doesn't match actual references (${health.actualRefCount})`,
      { expected: block.linkCount, actual: health.actualRefCount });
  }

  if (health.actualFileSize !== undefined && !health.sizeMatch) {
    add('FILE_SIZE_MISMATCH', 'WARNING',
      `File size mismatch: DB=${block.size}, Actual=${health.actualFileSize}`,
      { dbSize: block.size, actualSize: health.actualFileSize });
  }

  if (health.sha256Match === false) {
    add('SHA256_MISMATCH', 'CRITICAL',
      'File SHA256 hash mismatch - file may be corrupted',
      { dbSha256: block.sha256, actualSha256: health.actualSha256 });
  }

  if (!health.blockValid) {
    add('INVALID_BLOCK', 'WARNING',
      'Resource references a soft-deleted block',
      { blockId: block._id });
  }

  if (!health.metadataConsistent) {
    add('METADATA_INCONSISTENCY', 'WARNING',
      'Block is marked invalid but still has references',
      { linkCount: block.linkCount });
  }

  return anomalies;
}

// ─── Core analysis ────────────────────────────────────────────────────────────

async function analyzeResource(resourceId, { Resource, LogEntry }, { days }) {
  const resource = await Resource
    .findById(resourceId)
    .populate('block')
    .populate('entry', 'name alias isDefault')
    .lean();

  if (!resource) throw new Error(`Resource ${resourceId} not found`);

  const block = resource.block;

  // ── Health checks ──────────────────────────────────────────────────────────
  const health = {
    resourceExists:      true,
    blockExists:         !!block,
    fileExists:          false,
    linkCountMatch:      false,
    sizeMatch:           false,
    sha256Match:         false,
    blockValid:          block && !block.isInvalid,
    metadataConsistent:  true,
  };

  if (block) {
    const storagePath = getStoragePath(block.sha256);
    health.fileExists = existsSync(storagePath);

    const actualRefCount = await Resource.countDocuments({ block: block._id, isInvalid: { $ne: true } });
    health.linkCountMatch = block.linkCount === actualRefCount;
    health.actualRefCount = actualRefCount;

    if (health.fileExists) {
      try {
        const { size } = statSync(storagePath);
        health.actualFileSize = size;
        health.sizeMatch      = size === block.size;

        if (size < CONFIG.SHA256_SIZE_LIMIT) {
          const actual = await computeSHA256(storagePath, generateIV(block._id));
          health.actualSha256  = actual;
          health.sha256Match   = actual === block.sha256;
        } else {
          health.sha256Match = null; // skipped for large files
        }
      } catch (err) {
        health.fileReadError = err.message;
      }
    }

    if (block.isInvalid && block.linkCount > 0) {
      health.metadataConsistent = false;
    }
  }

  // ── Anomalies ──────────────────────────────────────────────────────────────
  const anomalies = buildAnomalies(health, resource);

  // ── Logs ───────────────────────────────────────────────────────────────────
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const logs  = await LogEntry.find({
    $or: [
      { resourceIds: new mongoose.Types.ObjectId(resourceId) },
      { blockId: block?._id },
    ],
    timestamp: { $gte: since },
  }).sort({ timestamp: -1 }).limit(50).lean();

  // ── Summary ────────────────────────────────────────────────────────────────
  const criticalCount = anomalies.filter(a => a.severity === 'CRITICAL').length;
  const warningCount  = anomalies.filter(a => a.severity === 'WARNING').length;
  const healthScore   = Math.max(0, 100 - criticalCount * 30 - warningCount * 10);

  return {
    timestamp:  Date.now(),
    resourceId,
    resource,
    entry:      resource.entry,
    block,
    health,
    anomalies,
    logs,
    summary: {
      totalAnomalies: anomalies.length,
      criticalCount,
      warningCount,
      healthScore,
      status:       criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'HEALTHY',
      logsFound:    logs.length,
      analysisDate: new Date().toISOString(),
      daysAnalyzed: days,
    },
  };
}

// ─── Text reporter ────────────────────────────────────────────────────────────

function printTextReport({ resource, entry, block, health, anomalies, logs, summary }) {
  console.log(`\n${c.cyan}${c.bold}📊 Resource Analysis Report${c.reset}`);
  console.log(`${c.gray}${'━'.repeat(50)}${c.reset}\n`);

  section('🔍 Resource Information');
  info(`ID:            ${resource._id}`);
  info(`Name:          ${resource.name || '(empty)'}`);
  info(`MIME Type:     ${resource.mime || '(unknown)'}`);
  info(`Category:      ${resource.category || '(none)'}`);
  info(`Status:        ${resource.isInvalid ? c.red + '✗ Deleted' : c.green + '✓ Active'}`);
  info(`Description:   ${resource.description || '(none)'}`);

  if (entry) {
    section('📁 Entry Information');
    info(`ID:            ${entry._id}`);
    info(`Name:          ${entry.name}`);
    info(`Alias:         ${entry.alias}`);
    info(`Is Default:    ${entry.isDefault ? 'Yes' : 'No'}`);
  }

  section('⏱️  Upload Information');
  info(`Upload Time:   ${formatDate(resource.createdAt)}`);
  if (resource.uploadDuration) {
    info(`Duration:      ${formatDuration(resource.uploadDuration)}`);
    const speed = block ? block.size / (resource.uploadDuration / 1000) : 0;
    info(`Transfer Speed: ${formatBytes(speed)}/s`);
  }
  if (resource.clientIp) info(`Client IP:     ${resource.clientIp}`);
  if (resource.userAgent) {
    const ua = resource.userAgent;
    info(`User Agent:    ${ua.length > 60 ? ua.slice(0, 60) + '...' : ua}`);
  }

  if (block) {
    section('📦 Block Association');
    info(`Block ID:      ${block._id}`);
    info(`SHA256:        ${block.sha256.slice(0, 32)}...`);
    info(`Size:          ${formatBytes(block.size)} (${block.size} bytes)`);
    info(`Link Count:    ${block.linkCount}`);
    info(`Created:       ${formatDate(block.createdAt)}`);
    info(`Storage Path:  ${getStoragePath(block.sha256)}`);
  }

  section('⚠️  Health Check Results');
  health.resourceExists ? ok('Resource exists in database') : fail('Resource not found');
  health.blockExists    ? ok('Block association valid')     : fail('Block association broken - resource is orphaned');
  health.fileExists     ? ok('Physical file exists')        : fail('Physical file missing');

  health.linkCountMatch
    ? ok(`Link count correct (${block.linkCount}/${health.actualRefCount})`)
    : warn(`Link count mismatch: expected ${block.linkCount}, actual ${health.actualRefCount}`);

  if (health.sizeMatch) {
    ok('File size matches');
  } else if (health.actualFileSize !== undefined) {
    warn(`File size mismatch: DB=${formatBytes(block.size)}, File=${formatBytes(health.actualFileSize)}`);
  }

  if      (health.sha256Match === true)  ok('SHA256 hash verified');
  else if (health.sha256Match === false) fail('SHA256 hash mismatch - file corrupted!');
  else                                   info('SHA256 check skipped (large file)');

  health.blockValid ? ok('Block is valid (not deleted)') : warn('Block is soft-deleted');

  section('🔍 Anomaly Detection');
  if (anomalies.length === 0) {
    console.log(`${c.green}${c.bold}  ✓ No anomalies detected${c.reset}`);
  } else {
    const badge = summary.criticalCount > 0 ? c.red + 'CRITICAL' : c.yellow + 'WARNING';
    console.log(`${c.yellow}  Status: ${badge}${c.reset} (${anomalies.length} issues)\n`);
    for (const a of anomalies) {
      const col = a.severity === 'CRITICAL' ? c.red : c.yellow;
      console.log(`  ${col}[${a.severity}]${c.reset} ${a.type}`);
      console.log(`    ${c.gray}${a.description}${c.reset}`);
      for (const [k, v] of Object.entries(a.details ?? {})) {
        console.log(`    ${c.gray}  ${k}: ${v}${c.reset}`);
      }
      console.log();
    }
  }

  section(`📜 Recent Activity (Last ${summary.daysAnalyzed} Days)`);
  if (logs.length === 0) {
    info('No logs found for this resource');
  } else {
    for (const log of logs.slice(0, 10)) {
      const date  = new Date(log.timestamp).toISOString().slice(0, 19);
      const level = log.level || 'INFO';
      const col   = ['CRITICAL', 'ERROR'].includes(level) ? c.red : level === 'WARNING' ? c.yellow : c.gray;
      console.log(`  ${c.gray}[${date}]${c.reset} ${col}[${level}]${c.reset} ${log.category}`);
      if (log.details?.reason) console.log(`    ${c.gray}${log.details.reason}${c.reset}`);
    }
    if (logs.length > 10) info(`... and ${logs.length - 10} more entries`);
  }

  section('📈 Statistics');
  info(`Total Anomalies:   ${summary.totalAnomalies}`);
  info(`Critical Issues:   ${summary.criticalCount}`);
  info(`Warnings:          ${summary.warningCount}`);
  info(`Health Score:      ${summary.healthScore}/100`);
  info(`Status:            ${summary.status}`);
  info(`Logs Found:        ${summary.logsFound}`);

  console.log(`\n${c.gray}Report generated at: ${new Date().toISOString()}${c.reset}\n`);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

const HELP = `
${c.cyan}Resource Analysis Report${c.reset}

Usage:
  node scripts/resource-report.mjs --resource-id <id> [options]

Options:
  --resource-id <id>   Resource ID to analyze (required)
  --json               Output as JSON
  --days <n>           Days of history to analyze (default: 30)
  --verbose            Show detailed information
  --help               Show this help

Examples:
  node scripts/resource-report.mjs --resource-id abc123
  node scripts/resource-report.mjs --resource-id abc123 --json
  node scripts/resource-report.mjs --resource-id abc123 --days 7
`;

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) { console.log(HELP); process.exit(0); }

  if (!args.resourceId) {
    fail('Resource ID is required. Use --resource-id <id>');
    process.exit(1);
  }

  if (!args.json) {
    console.log(`${c.cyan}${c.bold}📊 Resource Analysis Report${c.reset}`);
    console.log(`${c.gray}${'━'.repeat(50)}${c.reset}\n`);
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

    process.exit(report.summary.criticalCount > 0 ? 1 : report.summary.warningCount > 0 ? 2 : 0);

  } catch (err) {
    fail(`Error: ${err.message}`);
    console.error(err);
    process.exit(3);
  } finally {
    await disconnectDB();
  }
}

main().catch(err => {
  console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});
