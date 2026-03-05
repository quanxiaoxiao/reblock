#!/usr/bin/env node
/**
 * Resource Verification and Migration Script
 *
 * Verify resources from resources.json and migrate missing ones with resumable retries.
 *
 * Usage:
 *   node verify-and-migrate.mjs --resources=./resources.json --images=./images.json --entry-alias=<alias> [options]
 */

import fetch from 'node-fetch';
import { Jimp } from 'jimp';
import pLimit from 'p-limit';
import minimist from 'minimist';
import {
  existsSync,
  readFileSync,
  createReadStream,
  appendFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

// =============================================================================
// Load .env configuration
// =============================================================================

let API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || process.env.MIGRATION_API_TOKEN || process.env.ERRORS_API_TOKEN;
let SERVER_PORT = '3000';

const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  const unifiedTokenMatch = envContent.match(/API_AUTH_TOKEN=(.+)/);
  const migrationTokenMatch = envContent.match(/MIGRATION_API_TOKEN=(.+)/);
  const errorsTokenMatch = envContent.match(/ERRORS_API_TOKEN=(.+)/);
  API_AUTH_TOKEN = (
    unifiedTokenMatch?.[1]
    || migrationTokenMatch?.[1]
    || errorsTokenMatch?.[1]
    || API_AUTH_TOKEN
    || ''
  ).trim();
  const portMatch = envContent.match(/SERVER_PORT=(\d+)/);
  if (portMatch) SERVER_PORT = portMatch[1];
}

// =============================================================================
// Configuration
// =============================================================================

const argv = minimist(process.argv.slice(2), {
  default: {
    concurrency: 5,
    'compress-concurrency': 1,
    'old-url': 'http://resources2:3000',
    'new-url': `http://localhost:${SERVER_PORT}`,
    'image-size': 38 * 1024,
    'max-retries': 4,
    'retry-base-ms': 1000,
    'retry-max-ms': 20000,
    'request-timeout-ms': 45000,
    'retry-rounds': 8,
    'resume': true,
    'retry-permanent': false,
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

const RESOURCES_FILE = argv.resources;
const IMAGES_FILE = argv.images;
const ENTRY_ALIAS = argv['entry-alias'];
const CONCURRENCY = parseInt(argv.concurrency, 10);
const COMPRESS_CONCURRENCY = Math.max(1, parseInt(argv['compress-concurrency'], 10));
const OLD_SYSTEM_URL = argv['old-url'];
const NEW_SYSTEM_URL = argv['new-url'];
const IMAGE_SIZE_THRESHOLD = argv['image-size'];
const MAX_RETRIES = Math.max(1, parseInt(argv['max-retries'], 10));
const RETRY_BASE_MS = Math.max(100, parseInt(argv['retry-base-ms'], 10));
const RETRY_MAX_MS = Math.max(RETRY_BASE_MS, parseInt(argv['retry-max-ms'], 10));
const REQUEST_TIMEOUT_MS = Math.max(1000, parseInt(argv['request-timeout-ms'], 10));
const RETRY_ROUNDS = Math.max(1, parseInt(argv['retry-rounds'], 10));
const RESUME_ENABLED = String(argv.resume) !== 'false';
const RETRY_PERMANENT = String(argv['retry-permanent']) === 'true';
const LOG_DIR = argv['log-dir'];

const CHECKPOINT_FILE = join(LOG_DIR, `verify-migrate-checkpoint-${ENTRY_ALIAS || 'unknown'}.json`);

const TRANSIENT_UPLOAD_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// =============================================================================
// Runtime state
// =============================================================================

const stats = {
  total: 0,
  scanned: 0,
  skippedByCheckpoint: 0,
  exists: 0,
  missingInOld: 0,
  migrated: 0,
  failedPermanent: 0,
  failedRetryable: 0,
};

const roundStats = {
  index: 0,
  scanned: 0,
  migrated: 0,
  exists: 0,
  failedPermanent: 0,
  failedRetryable: 0,
};

const errorLog = [];
let imageIds = new Set();
let defaultEntryAlias = '';
let fatalError = false;
let logFilePath = '';

const checkpoint = {
  done: new Set(),
  permanentFailed: new Map(),
  retryableFailed: new Map(),
};

const compressLimit = pLimit(COMPRESS_CONCURRENCY);

// =============================================================================
// Utility Functions
// =============================================================================

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function formatDateForFilename() {
  return new Date().toISOString().split('T')[0];
}

const log = (msg) => console.log(`[${timestamp()}] ${msg}`);
const error = (msg) => log(`❌ ${msg}`);
const success = (msg) => log(`✅ ${msg}`);
const warning = (msg) => log(`⚠️  ${msg}`);
const info = (msg) => log(`ℹ️  ${msg}`);

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms) {
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(RETRY_MAX_MS, ms + jitter);
}

function computeBackoff(attempt) {
  const base = RETRY_BASE_MS * Math.pow(2, attempt - 1);
  return withJitter(Math.min(RETRY_MAX_MS, base));
}

function sanitizeErr(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err;
  return err.message || String(err);
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
  writeFileSync(logFilePath, `[${timestamp()}] checkpoint: ${CHECKPOINT_FILE}\n`, { flag: 'a' });
  writeFileSync(logFilePath, '========================================\n\n', { flag: 'a' });

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

function loadCheckpoint() {
  if (!RESUME_ENABLED || !existsSync(CHECKPOINT_FILE)) return;

  try {
    const raw = JSON.parse(readFileSync(CHECKPOINT_FILE, 'utf8'));
    for (const id of raw.done || []) checkpoint.done.add(id);
    for (const [id, val] of Object.entries(raw.permanentFailed || {})) checkpoint.permanentFailed.set(id, val);
    for (const [id, val] of Object.entries(raw.retryableFailed || {})) checkpoint.retryableFailed.set(id, val);

    log(`♻️  已加载 checkpoint: done=${checkpoint.done.size}, permanent=${checkpoint.permanentFailed.size}, retryable=${checkpoint.retryableFailed.size}`);
  } catch (err) {
    warning(`checkpoint 读取失败，将忽略旧状态: ${sanitizeErr(err)}`);
  }
}

function saveCheckpoint() {
  const payload = {
    updatedAt: Date.now(),
    done: Array.from(checkpoint.done),
    permanentFailed: Object.fromEntries(checkpoint.permanentFailed),
    retryableFailed: Object.fromEntries(checkpoint.retryableFailed),
  };

  writeFileSync(CHECKPOINT_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function markDone(resourceId) {
  checkpoint.done.add(resourceId);
  checkpoint.retryableFailed.delete(resourceId);
  checkpoint.permanentFailed.delete(resourceId);
}

function markRetryable(resourceId, reason, details = {}) {
  checkpoint.retryableFailed.set(resourceId, {
    updatedAt: Date.now(),
    reason,
    ...details,
  });
}

function markPermanent(resourceId, reason, details = {}) {
  checkpoint.permanentFailed.set(resourceId, {
    updatedAt: Date.now(),
    reason,
    ...details,
  });
  checkpoint.retryableFailed.delete(resourceId);
}

function shouldSkipByCheckpoint(resourceId) {
  if (checkpoint.done.has(resourceId)) return true;
  if (!RETRY_PERMANENT && checkpoint.permanentFailed.has(resourceId)) return true;
  return false;
}

function classifyUploadStatus(status) {
  if (status === 200 || status === 201) return { ok: true, retryable: false, fatal: false };
  if (status === 401 || status === 403) return { ok: false, retryable: false, fatal: true };
  if (status === 400 || status === 404 || status === 409) return { ok: false, retryable: false, fatal: false };
  if (TRANSIENT_UPLOAD_STATUS.has(status)) return { ok: false, retryable: true, fatal: false };
  if (status >= 500) return { ok: false, retryable: true, fatal: false };
  return { ok: false, retryable: true, fatal: false };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// =============================================================================
// Streaming JSON parser
// =============================================================================

async function* streamJsonObjects(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let depth = 0;
  let inArray = false;
  let arrayDepth = 0;
  let buf = '';

  for await (const line of rl) {
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];

      if (!inArray) {
        if (ch === '[') {
          arrayDepth++;
          if (arrayDepth === 1) inArray = true;
        } else if (ch === ']') {
          arrayDepth--;
        }
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
          try {
            obj = JSON.parse(buf);
          } catch {
            obj = undefined;
          }
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
    if (!Array.isArray(list)) {
      error('Images file must contain an array of IDs');
      return false;
    }
    imageIds = new Set(list);
    return true;
  } catch (err) {
    error(`加载 images 文件失败: ${sanitizeErr(err)}`);
    return false;
  }
}

async function countResources() {
  let count = 0;
  for await (const resource of streamJsonObjects(RESOURCES_FILE)) {
    if (resource) count++;
  }
  return count;
}

// =============================================================================
// API helpers
// =============================================================================

async function getDefaultEntry() {
  log('🔍 获取默认 entry...');
  try {
    const res = await fetchWithTimeout(`${NEW_SYSTEM_URL}/entries?limit=100`);
    if (!res.ok) {
      error(`获取 entry 列表失败 (HTTP ${res.status})`);
      return false;
    }
    const data = await res.json();
    const entry = data.items?.find((e) => e.isDefault === true);
    if (!entry) {
      error('未找到 isDefault=true 的 entry');
      return false;
    }
    defaultEntryAlias = entry.alias;
    success(`默认 entry: ${defaultEntryAlias}`);
    return true;
  } catch (err) {
    error(`获取默认 entry 失败: ${sanitizeErr(err)}`);
    return false;
  }
}

async function checkTargetEntry() {
  log(`🔍 检查目标 entry: ${ENTRY_ALIAS}`);
  try {
    const res = await fetchWithTimeout(`${NEW_SYSTEM_URL}/entries/${ENTRY_ALIAS}`);
    if (res.status === 200) {
      success(`Entry '${ENTRY_ALIAS}' 存在`);
      return true;
    }
    if (res.status === 404) {
      error(`Entry '${ENTRY_ALIAS}' 不存在`);
      return false;
    }
    error(`检查 entry 失败 (HTTP ${res.status})`);
    return false;
  } catch (err) {
    error(`检查 entry 时发生错误: ${sanitizeErr(err)}`);
    return false;
  }
}

// =============================================================================
// Verification & Download
// =============================================================================

async function checkNewSystem(resourceId) {
  try {
    const res = await fetchWithTimeout(`${NEW_SYSTEM_URL}/resources/${resourceId}`, { method: 'HEAD' });
    if (res.status === 405) {
      const fallback = await fetchWithTimeout(`${NEW_SYSTEM_URL}/resources/${resourceId}`, { method: 'GET' });
      return { exists: fallback.status === 200, status: fallback.status };
    }
    return { exists: res.status === 200, status: res.status };
  } catch (err) {
    return { exists: false, status: 0, error: sanitizeErr(err) };
  }
}

async function downloadFromOldSystem(resourceId, attempt = 1) {
  try {
    const res = await fetchWithTimeout(`${OLD_SYSTEM_URL}/resource/${resourceId}`);
    if (!res.ok) {
      if (res.status === 404) return { buffer: null, status: 404 };
      throw new Error(`HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, status: 200 };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      const waitMs = computeBackoff(attempt);
      warning(`  下载失败(${resourceId})，${waitMs}ms 后重试 (${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
      return downloadFromOldSystem(resourceId, attempt + 1);
    }
    return { buffer: null, status: 0, error: sanitizeErr(err) };
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

    let lo = 10;
    let hi = 90;
    let bestBuffer = null;
    let bestQuality = lo;

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

    return {
      buffer: bestBuffer,
      compressed: true,
      originalSize,
      newSize: bestBuffer.length,
      quality: bestQuality,
    };
  } catch (err) {
    return { buffer: null, compressed: false, originalSize, error: sanitizeErr(err) };
  }
}

// =============================================================================
// Upload
// =============================================================================

async function uploadResourceOnce({ resourceId, name, mime, buffer, entryAlias, timeCreate, timeUpdate }) {
  const payload = {
    entryAlias,
    name: name || resourceId,
    contentBase64: buffer.toString('base64'),
    createdAt: timeCreate,
    updatedAt: timeUpdate,
    ...(mime ? { mime } : {}),
  };

  return fetchWithTimeout(`${NEW_SYSTEM_URL}/migration/resources/${resourceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_AUTH_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
}

async function uploadResourceWithRetry(input) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await uploadResourceOnce(input);
      const responseText = await response.text();
      const result = classifyUploadStatus(response.status);

      if (result.ok) {
        return {
          ok: true,
          status: response.status,
          responseText,
        };
      }

      if (result.fatal) {
        fatalError = true;
        return {
          ok: false,
          retryable: false,
          fatal: true,
          status: response.status,
          responseText,
        };
      }

      if (!result.retryable || attempt === MAX_RETRIES) {
        return {
          ok: false,
          retryable: result.retryable,
          fatal: false,
          status: response.status,
          responseText,
        };
      }

      const waitMs = computeBackoff(attempt);
      warning(`  上传返回 HTTP ${response.status}，${waitMs}ms 后重试 (${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return {
          ok: false,
          retryable: true,
          fatal: false,
          status: 0,
          responseText: sanitizeErr(err),
        };
      }
      const waitMs = computeBackoff(attempt);
      warning(`  上传网络异常(${sanitizeErr(err)})，${waitMs}ms 后重试 (${attempt}/${MAX_RETRIES})`);
      await sleep(waitMs);
    }
  }

  return {
    ok: false,
    retryable: true,
    fatal: false,
    status: 0,
    responseText: 'unknown upload failure',
  };
}

// =============================================================================
// Per-resource pipeline
// =============================================================================

async function processResource(resource, pendingSet) {
  if (fatalError) return;

  const resourceId = resource._id;
  const name = resource.name || '';
  const mime = resource.mime;
  const timeCreate = resource.timeCreate;
  const timeUpdate = resource.timeUpdate;
  const size = Number(resource.size || 0);
  const isImage = imageIds.has(resourceId);

  roundStats.scanned++;
  stats.scanned++;

  const label = `${resourceId} (${name || 'unnamed'})`;
  info(`[Round ${roundStats.index}] 处理 ${label}${isImage ? ` [image ${formatBytes(size)}]` : ''}`);

  try {
    const checkResult = await checkNewSystem(resourceId);

    if (checkResult.exists) {
      stats.exists++;
      roundStats.exists++;
      markDone(resourceId);
      pendingSet.delete(resourceId);
      return;
    }

    if (checkResult.status !== 404) {
      stats.failedRetryable++;
      roundStats.failedRetryable++;
      markRetryable(resourceId, 'check_new_system_failed', {
        httpStatus: checkResult.status,
        error: checkResult.error,
      });
      recordError(resourceId, '检查新服务器失败', {
        httpStatus: checkResult.status,
        error: checkResult.error,
      });
      return;
    }

    const downloadResult = await downloadFromOldSystem(resourceId);

    if (downloadResult.status === 404) {
      stats.missingInOld++;
      stats.failedPermanent++;
      roundStats.failedPermanent++;
      markPermanent(resourceId, 'missing_in_both', {
        newSystemStatus: 404,
        oldSystemStatus: 404,
      });
      recordError(resourceId, '新旧服务器都不存在', {
        newSystemStatus: 404,
        oldSystemStatus: 404,
      });
      pendingSet.delete(resourceId);
      return;
    }

    if (!downloadResult.buffer) {
      stats.failedRetryable++;
      roundStats.failedRetryable++;
      markRetryable(resourceId, 'download_failed', {
        status: downloadResult.status,
        error: downloadResult.error,
      });
      recordError(resourceId, '从旧服务器下载失败', {
        status: downloadResult.status,
        error: downloadResult.error,
      });
      return;
    }

    let content = downloadResult.buffer;

    if (isImage && content.length > IMAGE_SIZE_THRESHOLD) {
      const compressed = await compressLimit(() => compressImage(content));

      if (compressed.buffer) {
        if (compressed.compressed) {
          info(`  📉 压缩: ${formatBytes(compressed.originalSize)} -> ${formatBytes(compressed.newSize)} (quality=${compressed.quality})`);
        }
        content = compressed.buffer;
      } else {
        warning(`  压缩失败，回退原图上传: ${compressed.error}`);
        const redownload = await downloadFromOldSystem(resourceId);
        if (!redownload.buffer) {
          stats.failedRetryable++;
          roundStats.failedRetryable++;
          markRetryable(resourceId, 'compress_redownload_failed', {
            error: compressed.error,
            redownloadStatus: redownload.status,
          });
          recordError(resourceId, '压缩失败后重新下载失败', {
            error: compressed.error,
            redownloadStatus: redownload.status,
          });
          return;
        }
        content = redownload.buffer;
      }
    }

    const targetEntryAlias = isImage ? ENTRY_ALIAS : defaultEntryAlias;

    const upload = await uploadResourceWithRetry({
      resourceId,
      name,
      mime,
      buffer: content,
      entryAlias: targetEntryAlias,
      timeCreate,
      timeUpdate,
    });

    if (upload.ok) {
      stats.migrated++;
      roundStats.migrated++;
      markDone(resourceId);
      pendingSet.delete(resourceId);
      if (upload.status === 201) {
        success(`  ✅ 创建成功: ${label}`);
      } else {
        info(`  ⏭️  已存在(幂等): ${label}`);
      }
      return;
    }

    // Fatal auth/config error: stop later rounds
    if (upload.fatal) {
      stats.failedPermanent++;
      roundStats.failedPermanent++;
      markPermanent(resourceId, 'upload_fatal', {
        status: upload.status,
        response: String(upload.responseText || '').substring(0, 200),
      });
      recordError(resourceId, '迁移接口认证/配置错误', {
        status: upload.status,
      });
      pendingSet.delete(resourceId);
      return;
    }

    // Non-retryable upload errors
    if (!upload.retryable) {
      stats.failedPermanent++;
      roundStats.failedPermanent++;
      markPermanent(resourceId, 'upload_non_retryable', {
        status: upload.status,
        response: String(upload.responseText || '').substring(0, 200),
      });

      let reason = '迁移失败';
      if (upload.status === 400) reason = '参数错误';
      if (upload.status === 404) reason = 'Entry 不存在';
      if (upload.status === 409) reason = '冲突(ID已存在且内容不同)';
      recordError(resourceId, reason, {
        status: upload.status,
        entryAlias: targetEntryAlias,
      });
      pendingSet.delete(resourceId);
      return;
    }

    // Retryable failure
    stats.failedRetryable++;
    roundStats.failedRetryable++;
    markRetryable(resourceId, 'upload_retryable', {
      status: upload.status,
      response: String(upload.responseText || '').substring(0, 200),
      entryAlias: targetEntryAlias,
    });
    recordError(resourceId, '迁移失败(可重试)', {
      status: upload.status,
      entryAlias: targetEntryAlias,
    });
  } catch (err) {
    stats.failedRetryable++;
    roundStats.failedRetryable++;
    markRetryable(resourceId, 'process_exception', { error: sanitizeErr(err) });
    recordError(resourceId, '处理资源时发生异常', { error: sanitizeErr(err) });
  }
}

async function runRound(round, pendingSet) {
  roundStats.index = round;
  roundStats.scanned = 0;
  roundStats.migrated = 0;
  roundStats.exists = 0;
  roundStats.failedPermanent = 0;
  roundStats.failedRetryable = 0;

  log('');
  log(`🔁 第 ${round}/${RETRY_ROUNDS} 轮开始，待处理: ${pendingSet.size}`);

  const limit = pLimit(CONCURRENCY);
  const pendingTasks = [];

  for await (const resource of streamJsonObjects(RESOURCES_FILE)) {
    if (fatalError) break;

    const resourceId = resource._id;
    if (!pendingSet.has(resourceId)) {
      if (shouldSkipByCheckpoint(resourceId)) {
        stats.skippedByCheckpoint++;
      }
      continue;
    }

    pendingTasks.push(limit(() => processResource(resource, pendingSet)));

    if (pendingTasks.length % 500 === 0) {
      await Promise.allSettled(pendingTasks.splice(0, 500));
      saveCheckpoint();
    }
  }

  if (pendingTasks.length > 0) {
    await Promise.allSettled(pendingTasks);
  }

  saveCheckpoint();

  const retryableLeft = Array.from(pendingSet).filter((id) => checkpoint.retryableFailed.has(id)).length;

  log(`📌 第 ${round} 轮结束: scanned=${roundStats.scanned}, migrated=${roundStats.migrated}, exists=${roundStats.exists}, permanentFail=${roundStats.failedPermanent}, retryableFail=${roundStats.failedRetryable}, retryableLeft=${retryableLeft}`);

  return retryableLeft;
}

// =============================================================================
// Report
// =============================================================================

function generateReport() {
  const sep = '='.repeat(70);
  log('');
  log(sep);
  log('📊 验证迁移报告');
  log(sep);
  log(`旧服务器: ${OLD_SYSTEM_URL}`);
  log(`新服务器: ${NEW_SYSTEM_URL}`);
  log(`目标 Entry (图片): ${ENTRY_ALIAS}`);
  log(`默认 Entry (非图片): ${defaultEntryAlias}`);
  log(`并发数: ${CONCURRENCY}`);
  log(`压缩并发: ${COMPRESS_CONCURRENCY}`);
  log(`图片大小阈值: ${formatBytes(IMAGE_SIZE_THRESHOLD)}`);
  log(`最大重试: ${MAX_RETRIES}`);
  log(`重试轮次上限: ${RETRY_ROUNDS}`);
  log('');
  log(`总资源数: ${stats.total}`);
  log(`扫描处理数: ${stats.scanned}`);
  log(`checkpoint 跳过: ${stats.skippedByCheckpoint}`);
  log('');
  log(`✅ 新服务器已存在(跳过): ${stats.exists}`);
  log(`📦 成功迁移: ${stats.migrated}`);
  log(`❌ 新旧服务器都不存在: ${stats.missingInOld}`);
  log(`❌ 永久失败: ${stats.failedPermanent}`);
  log(`❌ 可重试失败: ${stats.failedRetryable}`);
  log('');
  log(`checkpoint done: ${checkpoint.done.size}`);
  log(`checkpoint permanentFailed: ${checkpoint.permanentFailed.size}`);
  log(`checkpoint retryableFailed: ${checkpoint.retryableFailed.size}`);

  if (errorLog.length > 0) {
    log('');
    log(`📋 错误详情 (共 ${errorLog.length} 条):`);

    const grouped = errorLog.reduce((acc, entry) => {
      const key = entry.reason;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    }, {});

    Object.entries(grouped).forEach(([reason, entries]) => {
      log(`  ${reason}: ${entries.length} 个`);
      entries.slice(0, 5).forEach((e) => log(`    - ${e.resourceId}`));
      if (entries.length > 5) {
        log(`    ... 还有 ${entries.length - 5} 个`);
      }
    });

    const errorJsonPath = join(LOG_DIR, `verify-errors-${formatDateForFilename()}.json`);
    writeFileSync(errorJsonPath, JSON.stringify(errorLog, null, 2), 'utf8');
    log(`📄 详细错误日志 JSON: ${errorJsonPath}`);
  }

  log(sep);
  log(`📝 完整日志: ${logFilePath}`);
  log(`📝 checkpoint: ${CHECKPOINT_FILE}`);
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
  log(`压缩并发: ${COMPRESS_CONCURRENCY}`);
  log(`请求超时: ${REQUEST_TIMEOUT_MS}ms`);
  log(`最大重试: ${MAX_RETRIES}`);
  log(`重试轮次上限: ${RETRY_ROUNDS}`);
  log(`恢复模式: ${RESUME_ENABLED ? 'on' : 'off'}`);

  const required = [
    [API_AUTH_TOKEN, '未找到 API_AUTH_TOKEN，请检查 .env 文件'],
    [RESOURCES_FILE, '请指定 resources JSON 文件: --resources=./resources.json'],
    [IMAGES_FILE, '请指定 images JSON 文件: --images=./images.json'],
    [ENTRY_ALIAS, '请指定目标 entry alias: --entry-alias=<alias>'],
  ];

  for (const [value, message] of required) {
    if (!value) {
      error(message);
      process.exit(1);
    }
  }

  if (!existsSync(RESOURCES_FILE)) {
    error(`Resources file not found: ${RESOURCES_FILE}`);
    process.exit(1);
  }

  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  initLogFile();
  loadCheckpoint();

  console.log('');
  log('📂 加载图片 ID 列表...');
  if (!loadImageIds()) process.exit(1);

  log('🔢 统计资源数量...');
  stats.total = await countResources();
  if (stats.total === 0) {
    warning('没有找到需要验证的资源');
    process.exit(0);
  }

  success(`共 ${stats.total} 个资源需要验证, ${imageIds.size} 个图片`);

  if (!(await getDefaultEntry()) || !(await checkTargetEntry())) {
    process.exit(1);
  }

  const pendingSet = new Set();
  for await (const resource of streamJsonObjects(RESOURCES_FILE)) {
    const id = resource._id;
    if (!id) continue;
    if (shouldSkipByCheckpoint(id)) continue;
    pendingSet.add(id);
  }

  log(`📌 初始待处理资源: ${pendingSet.size}`);

  let round = 1;
  while (round <= RETRY_ROUNDS && pendingSet.size > 0 && !fatalError) {
    const retryableLeft = await runRound(round, pendingSet);

    if (retryableLeft === 0) {
      break;
    }

    const waitMs = Math.min(10_000, RETRY_BASE_MS * round);
    warning(`第 ${round} 轮后仍有 ${retryableLeft} 个可重试失败，${waitMs}ms 后进入下一轮`);
    await sleep(waitMs);
    round++;
  }

  generateReport();

  if (fatalError) {
    error('因认证/权限等致命错误终止，请先修复配置后重试');
    process.exit(1);
  }

  if (checkpoint.retryableFailed.size > 0) {
    error(`仍有 ${checkpoint.retryableFailed.size} 个可重试失败，请稍后重跑脚本（支持 checkpoint 续跑）`);
    process.exit(1);
  }

  success('所有可同步资源已完成同步（或判定为永久不可同步）');
  process.exit(0);
}

main().catch((err) => {
  error(`程序执行错误: ${sanitizeErr(err)}`);
  console.error(err);
  process.exit(1);
});
