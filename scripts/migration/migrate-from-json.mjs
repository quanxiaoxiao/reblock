#!/usr/bin/env node
/**
 * Resource Migration Script from JSON
 *
 * Migrate resources from old system using resources.json file
 * Usage: node migrate-from-json.mjs --resources=./resources.json --images=./images.json --entry-alias=<alias> [options]
 *
 * Example:
 *   node migrate-from-json.mjs --resources=./resources.json --images=./images.json --entry-alias=notes
 *   node migrate-from-json.mjs --resources=./resources.json --images=./images.json --entry-alias=notes --concurrency=10
 */

import fetch from 'node-fetch';
import { Jimp } from 'jimp';
import pLimit from 'p-limit';
import minimist from 'minimist';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

// =============================================================================
// Load .env configuration (before argv)
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
    'image-size': 38 * 1024, // 38KB
    'max-retries': 3,
  },
  alias: {
    c: 'concurrency',
    o: 'old-url',
    n: 'new-url',
    r: 'resources',
    i: 'images',
    e: 'entry-alias',
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

// Statistics — only primitives/small arrays, never accumulate buffers
const stats = {
  total: 0,
  images: { total: 0, compressed: 0, uncompressed: 0 },
  nonImages: { total: 0 },
  success: 0,
  existing: 0,
  failed: 0,
  failedIds: [],
};

let processedCount    = 0;
let imageIds          = new Set();
let defaultEntryAlias = '';
let fatalError        = false;

// =============================================================================
// Utility Functions
// =============================================================================

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

const log     = (msg) => console.log(`[${timestamp()}] ${msg}`);
const error   = (msg) => log(`❌ ${msg}`);
const success = (msg) => log(`✅ ${msg}`);
const warning = (msg) => log(`⚠️  ${msg}`);

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

// =============================================================================
// Streaming JSON parser
// =============================================================================

/**
 * Stream-parse a JSON file that is either:
 *   - A top-level array  [ {...}, {...}, ... ]
 *   - An object          { "list": [ {...}, {...}, ... ], "count": N }
 *
 * Yields one parsed object at a time; the rest of the file stays on disk.
 * Peak memory = O(one object) regardless of file size.
 *
 * @param {string} filePath
 * @returns {AsyncGenerator<object>}
 */
async function* streamJsonObjects(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let depth      = 0;     // brace depth of the object being accumulated
  let inArray    = false; // are we inside the target array?
  let arrayDepth = 0;     // bracket depth for entering the array
  let buf        = '';    // chars of the current object

  for await (const line of rl) {
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];

      if (!inArray) {
        if (ch === '[') { arrayDepth++; if (arrayDepth === 1) inArray = true; }
        else if (ch === ']') arrayDepth--;
        continue;
      }

      // Inside the target array
      if (ch === '{') {
        depth++;
        buf += ch;
      } else if (ch === '}') {
        depth--;
        buf += ch;
        if (depth === 0 && buf.trim().length > 0) {
          let obj;
          try { obj = JSON.parse(buf); } catch { /* malformed — skip */ }
          buf = ''; // free immediately
          if (obj !== undefined) yield obj;
        }
      } else if (depth > 0) {
        buf += ch;
      } else if (ch === ']') {
        inArray = false;
        arrayDepth--;
      }
    }
    if (depth > 0) buf += ' '; // preserve token separation across lines
  }
}

/**
 * Load image IDs into a Set (strings only — small).
 * The raw parsed array is discarded after population.
 */
function loadImageIds() {
  if (!existsSync(IMAGES_FILE)) {
    error(`Images file not found: ${IMAGES_FILE}`);
    return false;
  }
  try {
    const list = JSON.parse(readFileSync(IMAGES_FILE, 'utf8'));
    if (!Array.isArray(list)) { error('Images file must contain an array of IDs'); return false; }
    imageIds = new Set(list); // raw array immediately eligible for GC
    return true;
  } catch (err) {
    error(`加载 images 文件失败: ${err.message}`);
    return false;
  }
}

/**
 * Count resources via streaming — O(1) memory, reads file once.
 */
async function countResources() {
  let count = 0;
  // eslint-disable-next-line no-unused-vars
  for await (const _unused of streamJsonObjects(RESOURCES_FILE)) count++;
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
    const data  = await res.json();
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
// Download
// =============================================================================

async function downloadResource(resourceId, attempt = 0) {
  try {
    const res = await fetch(`${OLD_SYSTEM_URL}/resource/${resourceId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      await sleep(1000 * (attempt + 1));
      return downloadResource(resourceId, attempt + 1);
    }
    error(`  下载失败 (${resourceId}): ${err.message}`);
    return null;
  }
}

// =============================================================================
// Image compression  (binary search over quality levels)
// =============================================================================

/**
 * @param {Buffer} inputBuffer  — pass by reference; nulled internally after decode
 * @returns {{ buffer: Buffer|null, compressed: boolean, originalSize: number, ... }}
 */
async function compressImage(inputBuffer) {
  const originalSize = inputBuffer.length;

  if (originalSize <= IMAGE_SIZE_THRESHOLD) {
    return { buffer: inputBuffer, compressed: false, originalSize };
  }

  try {
    const image  = await Jimp.read(inputBuffer);
    inputBuffer  = null; // release original after decode; Jimp holds its own copy

    let lo = 10, hi = 90, bestBuffer = null, bestQuality = lo;

    while (lo <= hi) {
      const mid       = Math.floor((lo + hi) / 2);
      const candidate = await image.getBuffer('image/jpeg', { quality: mid });

      if (candidate.length <= IMAGE_SIZE_THRESHOLD) {
        bestBuffer  = candidate;
        bestQuality = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (!bestBuffer) {
      bestBuffer  = await image.getBuffer('image/jpeg', { quality: 10 });
      bestQuality = 10;
    }

    return { buffer: bestBuffer, compressed: true, originalSize, newSize: bestBuffer.length, quality: bestQuality };
  } catch (err) {
    error(`  图片压缩失败: ${err.message}`);
    return { buffer: null, compressed: false, originalSize, error: err.message };
  }
}

// =============================================================================
// Upload  — converts buffer→base64 just-in-time inside the function
// =============================================================================

async function uploadResource({ resourceId, name, mime, buffer, entryAlias, timeCreate, timeUpdate }) {
  // Both buffer and base64 string briefly coexist here; buffer can be GC'd
  // once fetch has serialised the body string.
  const payload = {
    entryAlias,
    name: name || resourceId,
    contentBase64: buffer.toString('base64'),
    createdAt:  timeCreate,
    updatedAt:  timeUpdate,
    ...(mime && { mime }),
  };

  return fetch(`${NEW_SYSTEM_URL}/migration/resources/${resourceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-migration-token': MIGRATION_TOKEN },
    body: JSON.stringify(payload),
  });
}

// =============================================================================
// Response handling
// =============================================================================

function handleUploadResponse(status, responseText, resourceId, label, entryAlias) {
  switch (status) {
    case 200: log(`  ⏭️  已存在 (幂等): ${label}`);  stats.existing++; return true;
    case 201: log(`  ✅ 创建成功: ${label}`);         stats.success++;  return true;
    case 400: error(`  参数错误: ${label}`);           stats.failed++; stats.failedIds.push(`${resourceId}(bad_request)`);     return true;
    case 401: error('  认证失败，请检查 MIGRATION_API_TOKEN'); stats.failed++; stats.failedIds.push(`${resourceId}(unauthorized)`); fatalError = true; return false;
    case 403: error('  迁移接口未启用 (MIGRATION_API_ENABLED=false)'); stats.failed++; stats.failedIds.push(`${resourceId}(forbidden)`); fatalError = true; return false;
    case 404: error(`  Entry '${entryAlias}' 不存在`); stats.failed++; stats.failedIds.push(`${resourceId}(entry_not_found)`); return true;
    case 409: warning(`  冲突 (ID 存在但内容不同): ${label}`); stats.failed++; stats.failedIds.push(`${resourceId}(conflict)`); return true;
    default:  error(`  迁移失败 (HTTP ${status}): ${responseText.substring(0, 100)}`); stats.failed++; stats.failedIds.push(`${resourceId}(http_${status})`); return true;
  }
}

// =============================================================================
// Per-resource pipeline
// =============================================================================

async function processResource(resource) {
  if (fatalError) return;

  const { _id: resourceId, name = '', mime, timeCreate, timeUpdate, size = 0 } = resource;
  const isImage = imageIds.has(resourceId);

  processedCount++;

  if (isImage) {
    log(`[${processedCount}/${stats.total}] 处理图片: ${resourceId} (${formatBytes(size)})`);
    stats.images.total++;
  } else {
    log(`[${processedCount}/${stats.total}] 处理资源: ${resourceId}`);
    stats.nonImages.total++;
  }

  try {
    // 1. Download
    let content = await downloadResource(resourceId);
    if (!content?.length) {
      error(`  资源 ${resourceId} 下载失败或内容为空`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(download_error)`);
      return;
    }

    // 2. Compress if needed — releases original buffer inside compressImage
    if (isImage && content.length > IMAGE_SIZE_THRESHOLD) {
      const result = await compressImage(content);
      content = null; // original ref released; compressImage already nulled its copy

      if (result.buffer) {
        if (result.compressed) {
          stats.images.compressed++;
          log(`  📉 压缩: ${formatBytes(result.originalSize)} → ${formatBytes(result.newSize)} (quality: ${result.quality})`);
        } else {
          stats.images.uncompressed++;
        }
        content = result.buffer;
      } else {
        // Jimp failed to decode — re-download and upload the original
        warning('  压缩失败，重新下载原图上传');
        content = await downloadResource(resourceId);
        if (!content?.length) {
          stats.failed++;
          stats.failedIds.push(`${resourceId}(compress_and_redownload_failed)`);
          return;
        }
        stats.images.uncompressed++;
      }
    } else if (isImage) {
      stats.images.uncompressed++;
    }

    // 3. Upload — buffer→base64 happens inside uploadResource
    const targetEntryAlias = isImage ? ENTRY_ALIAS : defaultEntryAlias;

    const response = await uploadResource({
      resourceId, name, mime,
      buffer: content,
      entryAlias: targetEntryAlias,
      timeCreate, timeUpdate,
    });

    // 4. Drop buffer reference — fetch body already serialised
    content = null;

    const responseText = await response.text();
    handleUploadResponse(response.status, responseText, resourceId, name || resourceId, targetEntryAlias);

  } catch (err) {
    error(`  处理资源时发生错误: ${err.message}`);
    stats.failed++;
    stats.failedIds.push(`${resourceId}(error: ${err.message})`);
  }
}

// =============================================================================
// Report
// =============================================================================

function generateReport() {
  const sep = '='.repeat(60);
  log(''); log(sep); log('📊 迁移报告'); log(sep);
  log(`旧系统: ${OLD_SYSTEM_URL}`);
  log(`新系统: ${NEW_SYSTEM_URL}`);
  log(`目标 Entry (图片): ${ENTRY_ALIAS}`);
  log(`默认 Entry (非图片): ${defaultEntryAlias}`);
  log(`并发数: ${CONCURRENCY}`);
  log(`图片大小阈值: ${formatBytes(IMAGE_SIZE_THRESHOLD)}`);
  log('');
  log(`总资源数: ${stats.total}`);
  log('');
  log('📷 图片统计:');
  log(`   总数: ${stats.images.total}`);
  log(`   已压缩: ${stats.images.compressed}`);
  log(`   未压缩: ${stats.images.uncompressed}`);
  log('');
  log(`📄 非图片资源: ${stats.nonImages.total}`);
  log('');
  log(`✅ 成功创建: ${stats.success}`);
  log(`⏭️  已存在: ${stats.existing}`);
  log(`❌ 失败: ${stats.failed}`);
  if (stats.failedIds.length > 0) {
    log(''); log('失败资源:');
    stats.failedIds.forEach((id) => log(`  - ${id}`));
  }
  log(sep);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('');
  log('🚀 开始资源迁移');
  log(`旧系统: ${OLD_SYSTEM_URL}`);
  log(`新系统: ${NEW_SYSTEM_URL}`);
  log(`图片阈值: ${formatBytes(IMAGE_SIZE_THRESHOLD)}`);
  log(`并发数: ${CONCURRENCY}`);
  log(`最大重试: ${MAX_RETRIES}`);

  const required = [
    [MIGRATION_TOKEN, '未找到 MIGRATION_API_TOKEN，请检查 .env 文件'],
    [RESOURCES_FILE,  '请指定 resources JSON 文件: --resources=./resources.json'],
    [IMAGES_FILE,     '请指定 images JSON 文件: --images=./images.json'],
    [ENTRY_ALIAS,     '请指定目标 entry alias: --entry-alias=<alias>'],
  ];
  for (const [value, message] of required) {
    if (!value) { error(message); process.exit(1); }
  }
  if (!existsSync(RESOURCES_FILE)) {
    error(`Resources file not found: ${RESOURCES_FILE}`); process.exit(1);
  }

  console.log('');

  // 1. Load image IDs (strings only)
  log('📂 加载图片 ID 列表...');
  if (!loadImageIds()) process.exit(1);

  // 2. Count resources via streaming — O(1) memory
  log('🔢 统计资源数量...');
  stats.total = await countResources();
  if (stats.total === 0) { warning('没有找到需要迁移的资源'); process.exit(0); }
  success(`共 ${stats.total} 个资源, ${imageIds.size} 个图片`);

  // 3. Validate entries
  if (!(await getDefaultEntry()) || !(await checkTargetEntry())) process.exit(1);

  console.log('');
  log(`📦 开始迁移 ${stats.total} 个资源`);
  log(`   图片: ${imageIds.size} 个 → '${ENTRY_ALIAS}'`);
  log(`   非图片: ${stats.total - imageIds.size} 个 → '${defaultEntryAlias}'`);
  console.log('');

  // 4. Stream resources through pLimit — at most CONCURRENCY objects live at once.
  //    Drain the pending array every 500 items to allow GC of resolved promises.
  const limit   = pLimit(CONCURRENCY);
  const pending = [];

  for await (const resource of streamJsonObjects(RESOURCES_FILE)) {
    if (fatalError) break;
    pending.push(limit(() => processResource(resource)));

    if (pending.length % 500 === 0) {
      await Promise.allSettled(pending.splice(0, 500));
    }
  }

  if (pending.length > 0) await Promise.allSettled(pending);

  // 5. Report & exit
  generateReport();
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  error(`程序执行错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});

