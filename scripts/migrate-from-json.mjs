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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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

const RESOURCES_FILE = argv.resources;
const IMAGES_FILE = argv.images;
const ENTRY_ALIAS = argv['entry-alias'];
const CONCURRENCY = parseInt(argv.concurrency, 10);
const OLD_SYSTEM_URL = argv['old-url'];
const NEW_SYSTEM_URL = argv['new-url'];
const IMAGE_SIZE_THRESHOLD = argv['image-size'];
const MAX_RETRIES = argv['max-retries'];

// Statistics
const stats = {
  total: 0,
  images: { total: 0, compressed: 0, uncompressed: 0 },
  nonImages: { total: 0 },
  success: 0,
  existing: 0,
  failed: 0,
  failedIds: [],
};

let processedCount = 0;
let imageIds = new Set();
let defaultEntryAlias = '';

// Flag to abort on fatal auth errors
let fatalError = false;

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

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Load and validate JSON input files.
 * @returns {object|false} resourcesData or false on failure
 */
async function loadJsonFiles() {
  log('📂 加载 JSON 文件...');

  for (const [label, file] of [['Resources', RESOURCES_FILE], ['Images', IMAGES_FILE]]) {
    if (!existsSync(file)) {
      error(`${label} file not found: ${file}`);
      return false;
    }
  }

  try {
    const resourcesData = JSON.parse(readFileSync(RESOURCES_FILE, 'utf8'));
    const imagesList    = JSON.parse(readFileSync(IMAGES_FILE, 'utf8'));

    if (!Array.isArray(imagesList)) {
      error('Images file must contain an array of IDs');
      return false;
    }

    imageIds = new Set(imagesList);

    const count = resourcesData.list?.length ?? 0;
    log(`✅ 加载完成: ${count} 个资源, ${imageIds.size} 个图片`);
    return resourcesData;
  } catch (err) {
    error(`加载 JSON 文件失败: ${err.message}`);
    return false;
  }
}

/**
 * Fetch the entry marked as default (isDefault=true) from the new system.
 */
async function getDefaultEntry() {
  log('🔍 获取默认 entry...');

  try {
    const response = await fetch(`${NEW_SYSTEM_URL}/entries?limit=100`);
    if (!response.ok) {
      error(`获取 entry 列表失败 (HTTP ${response.status})`);
      return false;
    }

    const data = await response.json();
    const defaultEntry = data.items?.find((e) => e.isDefault === true);

    if (!defaultEntry) {
      error('未找到 isDefault=true 的 entry');
      return false;
    }

    defaultEntryAlias = defaultEntry.alias;
    success(`默认 entry: ${defaultEntryAlias}`);
    return true;
  } catch (err) {
    error(`获取默认 entry 失败: ${err.message}`);
    return false;
  }
}

/**
 * Verify that the target entry alias exists in the new system.
 */
async function checkTargetEntry() {
  log(`🔍 检查目标 entry: ${ENTRY_ALIAS}`);

  try {
    const response = await fetch(`${NEW_SYSTEM_URL}/entries/${ENTRY_ALIAS}`);

    if (response.status === 200) {
      success(`Entry '${ENTRY_ALIAS}' 存在`);
      return true;
    }
    if (response.status === 404) {
      error(`Entry '${ENTRY_ALIAS}' 不存在`);
      return false;
    }

    error(`检查 entry 失败 (HTTP ${response.status})`);
    return false;
  } catch (err) {
    error(`检查 entry 时发生错误: ${err.message}`);
    return false;
  }
}

/**
 * Download a resource's binary content with exponential-backoff retries.
 * @returns {Buffer|null}
 */
async function downloadResource(resourceId, attempt = 0) {
  try {
    const response = await fetch(`${OLD_SYSTEM_URL}/resource/${resourceId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      await sleep(1000 * (attempt + 1));
      return downloadResource(resourceId, attempt + 1);
    }
    error(`  下载失败 (${resourceId}): ${err.message}`);
    return null;
  }
}

/**
 * Compress an image buffer to below IMAGE_SIZE_THRESHOLD using binary search
 * over JPEG quality levels (10–90), minimising encode iterations.
 *
 * @returns {{ buffer: Buffer, compressed: boolean, originalSize: number, newSize?: number, quality?: number }}
 */
async function compressImage(buffer) {
  const originalSize = buffer.length;

  if (originalSize <= IMAGE_SIZE_THRESHOLD) {
    return { buffer, compressed: false, originalSize };
  }

  try {
    const image = await Jimp.read(buffer);

    let lo = 10, hi = 90;
    let bestBuffer = null;
    let bestQuality = lo;

    // Binary search: find the highest quality that fits under the threshold
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = await image.getBuffer('image/jpeg', { quality: mid });

      if (candidate.length <= IMAGE_SIZE_THRESHOLD) {
        bestBuffer  = candidate;
        bestQuality = mid;
        lo = mid + 1; // try higher quality
      } else {
        hi = mid - 1; // need lower quality
      }
    }

    // If nothing fits (even quality=10 is too large) use quality=10 result
    if (!bestBuffer) {
      bestBuffer  = await image.getBuffer('image/jpeg', { quality: 10 });
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
    error(`  图片压缩失败: ${err.message}`);
    return { buffer, compressed: false, originalSize, error: err.message };
  }
}

/**
 * Upload a resource to the migration API.
 */
async function uploadResource({ resourceId, name, mime, contentBase64, entryAlias, timeCreate, timeUpdate }) {
  const payload = {
    entryAlias,
    name: name || resourceId,
    contentBase64,
    createdAt: timeCreate,
    updatedAt: timeUpdate,
    ...(mime && { mime }),
  };

  return fetch(`${NEW_SYSTEM_URL}/migration/resources/${resourceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-migration-token': MIGRATION_TOKEN,
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Interpret the HTTP response from the migration API and update stats.
 * Returns true if migration should continue, false on fatal errors.
 */
function handleUploadResponse(status, responseText, resourceId, label, entryAlias) {
  switch (status) {
    case 200:
      log(`  ⏭️  已存在 (幂等): ${label}`);
      stats.existing++;
      return true;

    case 201:
      log(`  ✅ 创建成功: ${label}`);
      stats.success++;
      return true;

    case 400:
      error(`  参数错误: ${label}`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(bad_request)`);
      return true;

    case 401:
      error(`  认证失败，请检查 MIGRATION_API_TOKEN`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(unauthorized)`);
      fatalError = true; // abort further processing
      return false;

    case 403:
      error(`  迁移接口未启用 (MIGRATION_API_ENABLED=false)`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(forbidden)`);
      fatalError = true;
      return false;

    case 404:
      error(`  Entry '${entryAlias}' 不存在`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(entry_not_found)`);
      return true;

    case 409:
      warning(`  冲突 (ID 存在但内容不同): ${label}`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(conflict)`);
      return true;

    default:
      error(`  迁移失败 (HTTP ${status}): ${responseText.substring(0, 100)}`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(http_${status})`);
      return true;
  }
}

/**
 * Full pipeline for a single resource: download → (compress) → upload.
 */
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
    const content = await downloadResource(resourceId);
    if (!content?.length) {
      error(`  资源 ${resourceId} 下载失败或内容为空`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(download_error)`);
      return;
    }

    // 2. Optionally compress images
    let finalContent = content;
    if (isImage && content.length > IMAGE_SIZE_THRESHOLD) {
      const result = await compressImage(content);
      finalContent = result.buffer;

      if (result.compressed) {
        stats.images.compressed++;
        log(`  📉 压缩: ${formatBytes(result.originalSize)} → ${formatBytes(result.newSize)} (quality: ${result.quality})`);
      } else {
        stats.images.uncompressed++;
        if (result.error) warning('  压缩失败，使用原图');
      }
    } else if (isImage) {
      stats.images.uncompressed++;
    }

    // 3. Upload
    const targetEntryAlias = isImage ? ENTRY_ALIAS : defaultEntryAlias;
    const label = name || resourceId;

    const response = await uploadResource({
      resourceId,
      name,
      mime,
      contentBase64: finalContent.toString('base64'),
      entryAlias: targetEntryAlias,
      timeCreate,
      timeUpdate,
    });

    const responseText = await response.text();
    handleUploadResponse(response.status, responseText, resourceId, label, targetEntryAlias);

  } catch (err) {
    error(`  处理资源时发生错误: ${err.message}`);
    stats.failed++;
    stats.failedIds.push(`${resourceId}(error: ${err.message})`);
  }
}

/**
 * Print a summary report to stdout.
 */
function generateReport() {
  const sep = '='.repeat(60);
  log('');
  log(sep);
  log('📊 迁移报告');
  log(sep);
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
    log('');
    log('失败资源:');
    stats.failedIds.forEach((id) => log(`  - ${id}`));
  }

  log(sep);
}

// =============================================================================
// Main Entry
// =============================================================================

async function main() {
  console.log('');
  log('🚀 开始资源迁移');
  log(`旧系统: ${OLD_SYSTEM_URL}`);
  log(`新系统: ${NEW_SYSTEM_URL}`);
  log(`图片阈值: ${formatBytes(IMAGE_SIZE_THRESHOLD)}`);
  log(`并发数: ${CONCURRENCY}`);
  log(`最大重试: ${MAX_RETRIES}`);

  // Validate required arguments
  const required = [
    [MIGRATION_TOKEN,  '未找到 MIGRATION_API_TOKEN，请检查 .env 文件'],
    [RESOURCES_FILE,   '请指定 resources JSON 文件: --resources=./resources.json'],
    [IMAGES_FILE,      '请指定 images JSON 文件: --images=./images.json'],
    [ENTRY_ALIAS,      '请指定目标 entry alias: --entry-alias=<alias>'],
  ];

  for (const [value, message] of required) {
    if (!value) {
      error(message);
      process.exit(1);
    }
  }

  console.log('');

  // 1. Load JSON files
  const resourcesData = await loadJsonFiles();
  if (!resourcesData) process.exit(1);

  const resourcesList = resourcesData.list ?? [];
  stats.total = resourcesList.length;

  if (stats.total === 0) {
    warning('没有找到需要迁移的资源');
    process.exit(0);
  }

  // 2. Validate entries
  if (!(await getDefaultEntry()) || !(await checkTargetEntry())) {
    process.exit(1);
  }

  console.log('');
  log(`📦 找到 ${stats.total} 个资源待迁移`);
  log(`   图片: ${imageIds.size} 个将上传到 '${ENTRY_ALIAS}'`);
  log(`   非图片: ${stats.total - imageIds.size} 个将上传到 '${defaultEntryAlias}'`);
  console.log('');

  // 3. Process resources with concurrency limit
  const limit = pLimit(CONCURRENCY);
  await Promise.all(resourcesList.map((resource) => limit(() => processResource(resource))));

  // 4. Report & exit
  generateReport();
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  error(`程序执行错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});

