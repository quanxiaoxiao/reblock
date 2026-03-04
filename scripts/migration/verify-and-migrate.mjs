#!/usr/bin/env node
/**
 * Resource Verification and Migration Script
 *
 * Verify resources from resources.json and migrate missing ones
 * Usage: node verify-and-migrate.mjs --resources=./resources.json --images=./images.json --entry-alias=<alias> [options]
 */

import fetch from 'node-fetch';
import { Jimp } from 'jimp';
import pLimit from 'p-limit';
import minimist from 'minimist';
import { existsSync, readFileSync, createReadStream, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// Load .env configuration
// =============================================================================

let MIGRATION_TOKEN = process.env.MIGRATION_API_TOKEN;
let SERVER_PORT = '3000';

const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  const tokenMatch = envContent.match(/MIGRATION_API_TOKEN=(.+)/);
  if (tokenMatch) MIGRATION_TOKEN = tokenMatch[1].trim();
  const portMatch = envContent.match(/SERVER_PORT=(\d+)/);
  if (portMatch) SERVER_PORT = portMatch[1];
}

// =============================================================================
// Configuration
// =============================================================================

const argv = minimist(process.argv.slice(2), {
  default: {
    concurrency: 5,
    'old-url': 'http://resources2:3000',
    'new-url': `http://localhost:${SERVER_PORT}`,
    'image-size': 38 * 1024,
    'max-retries': 3,
    'log-dir': './logs',
  },
  alias: {
    c: 'concurrency',
    o: 'old-url',
    n: 'new-url',
    r: 'resources',
    i: 'images',
    e: 'entry-alias',
    l: 'log-dir',
  },
});

const RESOURCES_FILE       = argv.resources;
const IMAGES_FILE          = argv.images;
const ENTRY_ALIAS          = argv['entry-alias'];
const CONCURRENCY          = parseInt(argv.concurrency, 10);
const OLD_SYSTEM_URL       = argv['old-url'];
const NEW_SYSTEM_URL       = argv['new-url'];
const IMAGE_SIZE_THRESHOLD = argv['image-size'];
const MAX_RETRIES          = argv['max-retries'];
const LOG_DIR              = argv['log-dir'];

// Statistics
const stats = {
  total: 0,
  exists: 0,
  missingInOld: 0,
  migrated: 0,
  failed: 0,
};

const errorLog = [];

let processedCount    = 0;
let imageIds          = new Set();
let defaultEntryAlias = '';
let fatalError        = false;
let logFilePath       = '';

// =============================================================================
// Utility Functions
// =============================================================================

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function formatDateForFilename() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

const log     = (msg) => console.log(`[${timestamp()}] ${msg}`);
const error   = (msg) => log(`❌ ${msg}`);
const success = (msg) => log(`✅ ${msg}`);
const warning = (msg) => log(`⚠️  ${msg}`);
const info    = (msg) => log(`ℹ️  ${msg}`);

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function initLogFile() {
  const logFileName = `verify-migrate-${formatDateForFilename()}.log`;
  logFilePath = join(LOG_DIR, logFileName);
  
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  
  writeFileSync(logFilePath, `[${timestamp()}] 资源验证迁移日志\n`, 'utf8');
  writeFileSync(logFilePath, `[${timestamp()}] 旧服务器: ${OLD_SYSTEM_URL}\n`, { flag: 'a' });
  writeFileSync(logFilePath, `[${timestamp()}] 新服务器: ${NEW_SYSTEM_URL}\n`, { flag: 'a' });
  writeFileSync(logFilePath, `[${timestamp()}] 目标 Entry (图片): ${ENTRY_ALIAS}\n`, { flag: 'a' });
  writeFileSync(logFilePath, `========================================\n\n`, { flag: 'a' });
  
  log(`📄 日志文件: ${logFilePath}`);
}

function writeLog(message) {
  if (logFilePath) {
    appendFileSync(logFilePath, `[${timestamp()}] ${message}\n`, 'utf8');
  }
}

function recordError(resourceId, reason, details = {}) {
  const entry = {
    timestamp: Date.now(),
    resourceId,
    reason,
    ...details,
  };
  errorLog.push(entry);
  
  const detailStr = Object.entries(details)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  
  const logMessage = `资源 ${resourceId}: ${reason}${detailStr ? ` (${detailStr})` : ''}`;
  error(logMessage);
  writeLog(logMessage);
}

// =============================================================================
// Streaming JSON parser
// =============================================================================

async function* streamJsonObjects(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let depth = 0, inArray = false, arrayDepth = 0, buf = '';

  for await (const line of rl) {
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];

      if (!inArray) {
        if (ch === '[') { arrayDepth++; if (arrayDepth === 1) inArray = true; }
        else if (ch === ']') arrayDepth--;
        continue;
      }

      if (ch === '{') {
        depth++;
        buf += ch;
      } else if (ch === '}') {
        depth--;
        buf += ch;
        if (depth === 0 && buf.trim().length > 0) {
          let obj;
          try { obj = JSON.parse(buf); } catch {}
          buf = '';
          if (obj !== undefined) yield obj;
        }
      } else if (depth > 0) {
        buf += ch;
      } else if (ch === ']') {
        inArray = false;
        arrayDepth--;
      }
    }
    if (depth > 0) buf += ' ';
  }
}

function loadImageIds() {
  if (!existsSync(IMAGES_FILE)) {
    error(`Images file not found: ${IMAGES_FILE}`);
    return false;
  }
  try {
    const list = JSON.parse(readFileSync(IMAGES_FILE, 'utf8'));
    if (!Array.isArray(list)) { error('Images file must contain an array of IDs'); return false; }
    imageIds = new Set(list);
    return true;
  } catch (err) {
    error(`加载 images 文件失败: ${err.message}`);
    return false;
  }
}

async function countResources() {
  let count = 0;
  for await (const _ of streamJsonObjects(RESOURCES_FILE)) count++;
  return count;
}

// =============================================================================
// API helpers
// =============================================================================

async function getDefaultEntry() {
  log('🔍 获取默认 entry...');
  try {
    const res = await fetch(`${NEW_SYSTEM_URL}/entries?limit=100`);
    if (!res.ok) { error(`获取 entry 列表失败 (HTTP ${res.status})`); return false; }
    const data = await res.json();
    const entry = data.items?.find((e) => e.isDefault === true);
    if (!entry) { error('未找到 isDefault=true 的 entry'); return false; }
    defaultEntryAlias = entry.alias;
    success(`默认 entry: ${defaultEntryAlias}`);
    return true;
  } catch (err) {
    error(`获取默认 entry 失败: ${err.message}`);
    return false;
  }
}

async function checkTargetEntry() {
  log(`🔍 检查目标 entry: ${ENTRY_ALIAS}`);
  try {
    const res = await fetch(`${NEW_SYSTEM_URL}/entries/${ENTRY_ALIAS}`);
    if (res.status === 200) { success(`Entry '${ENTRY_ALIAS}' 存在`); return true; }
    if (res.status === 404) { error(`Entry '${ENTRY_ALIAS}' 不存在`); return false; }
    error(`检查 entry 失败 (HTTP ${res.status})`);
    return false;
  } catch (err) {
    error(`检查 entry 时发生错误: ${err.message}`);
    return false;
  }
}

// =============================================================================
// Verification & Download
// =============================================================================

async function checkNewSystem(resourceId) {
  try {
    const res = await fetch(`${NEW_SYSTEM_URL}/resources/${resourceId}`, { method: 'HEAD' });
    return { exists: res.status === 200, status: res.status };
  } catch (err) {
    return { exists: false, status: 0, error: err.message };
  }
}

async function downloadFromOldSystem(resourceId, attempt = 0) {
  try {
    const res = await fetch(`${OLD_SYSTEM_URL}/resource/${resourceId}`);
    if (!res.ok) {
      if (res.status === 404) return { buffer: null, status: 404 };
      throw new Error(`HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, status: 200 };
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      await sleep(1000 * (attempt + 1));
      return downloadFromOldSystem(resourceId, attempt + 1);
    }
    return { buffer: null, status: 0, error: err.message };
  }
}

// =============================================================================
// Image compression
// =============================================================================

async function compressImage(inputBuffer) {
  const originalSize = inputBuffer.length;
  if (originalSize <= IMAGE_SIZE_THRESHOLD) {
    return { buffer: inputBuffer, compressed: false, originalSize };
  }

  try {
    const image = await Jimp.read(inputBuffer);
    inputBuffer = null;

    let lo = 10, hi = 90, bestBuffer = null, bestQuality = lo;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = await image.getBuffer('image/jpeg', { quality: mid });

      if (candidate.length <= IMAGE_SIZE_THRESHOLD) {
        bestBuffer = candidate;
        bestQuality = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (!bestBuffer) {
      bestBuffer = await image.getBuffer('image/jpeg', { quality: 10 });
      bestQuality = 10;
    }

    return { buffer: bestBuffer, compressed: true, originalSize, newSize: bestBuffer.length, quality: bestQuality };
  } catch (err) {
    return { buffer: null, compressed: false, originalSize, error: err.message };
  }
}

// =============================================================================
// Upload
// =============================================================================

async function uploadResource({ resourceId, name, mime, buffer, entryAlias, timeCreate, timeUpdate }) {
  const payload = {
    entryAlias,
    name: name || resourceId,
    contentBase64: buffer.toString('base64'),
    createdAt: timeCreate,
    updatedAt: timeUpdate,
    ...(mime && { mime }),
  };

  return fetch(`${NEW_SYSTEM_URL}/migration/resources/${resourceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-migration-token': MIGRATION_TOKEN },
    body: JSON.stringify(payload),
  });
}

function handleUploadResponse(status, responseText, resourceId, label, entryAlias) {
  switch (status) {
    case 200:
      info(`  ⏭️  已存在 (幂等): ${label}`);
      return { success: true, status: 'exists' };
    case 201:
      success(`  ✅ 创建成功: ${label}`);
      return { success: true, status: 'created' };
    case 400:
      recordError(resourceId, '参数错误', { httpStatus: 400, label });
      return { success: false, status: 'bad_request' };
    case 401:
      recordError(resourceId, '认证失败', { httpStatus: 401 });
      fatalError = true;
      return { success: false, status: 'unauthorized' };
    case 403:
      recordError(resourceId, '迁移接口未启用', { httpStatus: 403 });
      fatalError = true;
      return { success: false, status: 'forbidden' };
    case 404:
      recordError(resourceId, 'Entry不存在', { httpStatus: 404, entryAlias });
      return { success: false, status: 'entry_not_found' };
    case 409:
      recordError(resourceId, '冲突 (ID存在但内容不同)', { httpStatus: 409, label });
      return { success: false, status: 'conflict' };
    default:
      recordError(resourceId, '迁移失败', { httpStatus: status, response: responseText.substring(0, 100) });
      return { success: false, status: `http_${status}` };
  }
}

// =============================================================================
// Per-resource verification and migration pipeline
// =============================================================================

async function processResource(resource) {
  if (fatalError) return;

  const { _id: resourceId, name = '', mime, timeCreate, timeUpdate, size = 0 } = resource;
  const isImage = imageIds.has(resourceId);

  processedCount++;

  const label = `${resourceId} (${name || 'unnamed'})`;

  if (isImage) {
    log(`[${processedCount}/${stats.total}] 检查图片: ${label} (${formatBytes(size)})`);
  } else {
    log(`[${processedCount}/${stats.total}] 检查资源: ${label}`);
  }

  try {
    // Step 1: Check if exists in new system
    const checkResult = await checkNewSystem(resourceId);

    if (checkResult.exists) {
      stats.exists++;
      info(`  ✅ 新服务器已存在，跳过`);
      return;
    }

    if (checkResult.status !== 404) {
      recordError(resourceId, '检查新服务器失败', {
        httpStatus: checkResult.status,
        error: checkResult.error
      });
      return;
    }

    info(`  ⚠️  新服务器不存在 (404)，检查旧服务器...`);

    // Step 2: Try to download from old system
    const downloadResult = await downloadFromOldSystem(resourceId);

    if (downloadResult.status === 404) {
      stats.missingInOld++;
      recordError(resourceId, '新旧服务器都不存在', {
        reason: 'resource_not_found_in_both_systems',
        newSystemStatus: 404,
        oldSystemStatus: 404
      });
      return;
    }

    if (!downloadResult.buffer) {
      recordError(resourceId, '从旧服务器下载失败', {
        status: downloadResult.status,
        error: downloadResult.error
      });
      return;
    }

    info(`  📥 从旧服务器下载成功 (${formatBytes(downloadResult.buffer.length)})`);

    // Step 3: Process content (compress if image)
    let content = downloadResult.buffer;
    let compressionInfo = null;

    if (isImage && content.length > IMAGE_SIZE_THRESHOLD) {
      const result = await compressImage(content);
      content = null;

      if (result.buffer) {
        compressionInfo = result;
        if (result.compressed) {
          info(`  📉 压缩: ${formatBytes(result.originalSize)} → ${formatBytes(result.newSize)} (quality: ${result.quality})`);
        }
        content = result.buffer;
      } else {
        warning(`  ⚠️  图片压缩失败 (${result.error})，使用原图上传`);
        writeLog(`资源 ${resourceId}: 图片压缩失败 (${result.error})，使用原图上传`);

        const redownload = await downloadFromOldSystem(resourceId);
        if (!redownload.buffer) {
          recordError(resourceId, '压缩失败后重新下载失败', {
            originalError: result.error,
            redownloadStatus: redownload.status
          });
          return;
        }
        content = redownload.buffer;
      }
    }

    // Step 4: Upload to new system
    const targetEntryAlias = isImage ? ENTRY_ALIAS : defaultEntryAlias;

    const response = await uploadResource({
      resourceId, name, mime,
      buffer: content,
      entryAlias: targetEntryAlias,
      timeCreate, timeUpdate,
    });

    content = null;

    const responseText = await response.text();
    const uploadResult = handleUploadResponse(response.status, responseText, resourceId, label, targetEntryAlias);

    if (uploadResult.success) {
      stats.migrated++;
    } else {
      stats.failed++;
    }

  } catch (err) {
    recordError(resourceId, '处理资源时发生异常', { error: err.message });
    stats.failed++;
  }
}

// =============================================================================
// Report
// =============================================================================

function generateReport() {
  const sep = '='.repeat(70);
  log(''); log(sep); log('📊 验证迁移报告'); log(sep);
  log(`旧服务器: ${OLD_SYSTEM_URL}`);
  log(`新服务器: ${NEW_SYSTEM_URL}`);
  log(`目标 Entry (图片): ${ENTRY_ALIAS}`);
  log(`默认 Entry (非图片): ${defaultEntryAlias}`);
  log(`并发数: ${CONCURRENCY}`);
  log(`图片大小阈值: ${formatBytes(IMAGE_SIZE_THRESHOLD)}`);
  log('');
  log(`总资源数: ${stats.total}`);
  log('');
  log(`✅ 新服务器已存在 (跳过): ${stats.exists}`);
  log(`📦 成功迁移: ${stats.migrated}`);
  log(`❌ 新旧服务器都不存在: ${stats.missingInOld}`);
  log(`❌ 迁移失败: ${stats.failed}`);
  log('');

  if (errorLog.length > 0) {
    log(`📋 错误详情 (共 ${errorLog.length} 条):`);
    log('');

    const grouped = errorLog.reduce((acc, entry) => {
      const key = entry.reason;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([reason, entries]) => {
      log(`  ${reason}: ${entries.length} 个`);
      entries.slice(0, 5).forEach(e => {
        log(`    - ${e.resourceId}`);
      });
      if (entries.length > 5) {
        log(`    ... 还有 ${entries.length - 5} 个`);
      }
    });

    const errorJsonPath = join(LOG_DIR, `verify-errors-${formatDateForFilename()}.json`);
    writeFileSync(errorJsonPath, JSON.stringify(errorLog, null, 2), 'utf8');
    log('');
    log(`📄 详细错误日志 JSON: ${errorJsonPath}`);
  }

  log(sep);
  log(`📝 完整日志: ${logFilePath}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('');
  log('🚀 开始资源验证与迁移');
  log(`旧服务器: ${OLD_SYSTEM_URL}`);
  log(`新服务器: ${NEW_SYSTEM_URL}`);
  log(`图片阈值: ${formatBytes(IMAGE_SIZE_THRESHOLD)}`);
  log(`并发数: ${CONCURRENCY}`);
  log(`最大重试: ${MAX_RETRIES}`);

  const required = [
    [MIGRATION_TOKEN, '未找到 MIGRATION_API_TOKEN，请检查 .env 文件'],
    [RESOURCES_FILE, '请指定 resources JSON 文件: --resources=./resources.json'],
    [IMAGES_FILE, '请指定 images JSON 文件: --images=./images.json'],
    [ENTRY_ALIAS, '请指定目标 entry alias: --entry-alias=<alias>'],
  ];
  for (const [value, message] of required) {
    if (!value) { error(message); process.exit(1); }
  }
  if (!existsSync(RESOURCES_FILE)) {
    error(`Resources file not found: ${RESOURCES_FILE}`); process.exit(1);
  }

  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  initLogFile();

  console.log('');

  log('📂 加载图片 ID 列表...');
  if (!loadImageIds()) process.exit(1);

  log('🔢 统计资源数量...');
  stats.total = await countResources();
  if (stats.total === 0) { warning('没有找到需要验证的资源'); process.exit(0); }
  success(`共 ${stats.total} 个资源需要验证, ${imageIds.size} 个图片`);

  if (!(await getDefaultEntry()) || !(await checkTargetEntry())) process.exit(1);

  console.log('');
  log(`🔍 开始验证 ${stats.total} 个资源`);
  log(`   图片: ${imageIds.size} 个 → 如缺失将迁移到 '${ENTRY_ALIAS}'`);
  log(`   非图片: ${stats.total - imageIds.size} 个 → 如缺失将迁移到 '${defaultEntryAlias}'`);
  console.log('');

  const limit = pLimit(CONCURRENCY);
  const pending = [];

  for await (const resource of streamJsonObjects(RESOURCES_FILE)) {
    if (fatalError) break;
    pending.push(limit(() => processResource(resource)));

    if (pending.length % 500 === 0) {
      await Promise.allSettled(pending.splice(0, 500));
    }
  }

  if (pending.length > 0) await Promise.allSettled(pending);

  generateReport();

  const hasErrors = stats.missingInOld > 0 || stats.failed > 0;
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  error(`程序执行错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
