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
// Load .env configuration first (before argv)
// =============================================================================

let MIGRATION_TOKEN = process.env.MIGRATION_API_TOKEN;
let SERVER_PORT = '3000';
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  
  const tokenMatch = envContent.match(/MIGRATION_API_TOKEN=(.+)/);
  if (tokenMatch) {
    MIGRATION_TOKEN = tokenMatch[1].trim();
  }
  
  const portMatch = envContent.match(/SERVER_PORT=(\d+)/);
  if (portMatch) {
    SERVER_PORT = portMatch[1];
  }
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
  }
});

const RESOURCES_FILE = argv.resources;
const IMAGES_FILE = argv.images;
const ENTRY_ALIAS = argv['entry-alias'];
const CONCURRENCY = parseInt(argv.concurrency);
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

// Image IDs set
let imageIds = new Set();

// Default entry alias for non-images
let defaultEntryAlias = '';

// =============================================================================
// Utility Functions
// =============================================================================

function log(message) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[${timestamp}] ${message}`);
}

function error(message) {
  log(`❌ ${message}`);
}

function success(message) {
  log(`✅ ${message}`);
}

function warning(message) {
  log(`⚠️  ${message}`);
}

function info(message) {
  log(`ℹ️  ${message}`);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Load JSON files
 */
async function loadJsonFiles() {
  log('📂 加载 JSON 文件...');
  
  if (!existsSync(RESOURCES_FILE)) {
    error(`Resources file not found: ${RESOURCES_FILE}`);
    return false;
  }
  
  if (!existsSync(IMAGES_FILE)) {
    error(`Images file not found: ${IMAGES_FILE}`);
    return false;
  }
  
  try {
    const resourcesContent = readFileSync(RESOURCES_FILE, 'utf8');
    const resourcesData = JSON.parse(resourcesContent);
    
    const imagesContent = readFileSync(IMAGES_FILE, 'utf8');
    const imagesList = JSON.parse(imagesContent);
    
    if (!Array.isArray(imagesList)) {
      error('Images file must contain an array of IDs');
      return false;
    }
    
    imageIds = new Set(imagesList);
    
    log(`✅ 加载完成: ${resourcesData.count || resourcesData.list?.length || 0} 个资源, ${imageIds.size} 个图片`);
    
    return resourcesData;
  } catch (err) {
    error(`加载 JSON 文件失败: ${err.message}`);
    return false;
  }
}

/**
 * Get default entry (isDefault=true)
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
    
    if (!data.items || !Array.isArray(data.items)) {
      error('无法解析 entry 列表响应');
      return false;
    }
    
    const defaultEntry = data.items.find(e => e.isDefault === true);
    
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
 * Check if target entry exists
 */
async function checkTargetEntry() {
  log(`🔍 检查目标 entry: ${ENTRY_ALIAS}`);
  
  try {
    const response = await fetch(`${NEW_SYSTEM_URL}/entries/${ENTRY_ALIAS}`);
    
    if (response.status === 200) {
      success(`Entry '${ENTRY_ALIAS}' 存在`);
      return true;
    } else if (response.status === 404) {
      error(`Entry '${ENTRY_ALIAS}' 不存在`);
      return false;
    } else {
      error(`检查 entry 失败 (HTTP ${response.status})`);
      return false;
    }
  } catch (err) {
    error(`检查 entry 时发生错误: ${err.message}`);
    return false;
  }
}

/**
 * Download resource binary content with retries
 */
async function downloadResource(resourceId, retries = 0) {
  try {
    const response = await fetch(`${OLD_SYSTEM_URL}/resource/${resourceId}`);
    
    if (!response.ok) {
      if (retries < MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
        return downloadResource(resourceId, retries + 1);
      }
      return null;
    }
    
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch (err) {
    if (retries < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
      return downloadResource(resourceId, retries + 1);
    }
    return null;
  }
}

/**
 * Compress image using Jimp until size < threshold
 */
async function compressImage(buffer) {
  const originalSize = buffer.length;
  
  if (originalSize <= IMAGE_SIZE_THRESHOLD) {
    return { buffer, compressed: false, originalSize };
  }
  
  try {
    const image = await Jimp.read(buffer);
    let quality = 90;
    let compressedBuffer;
    
    // Try different quality levels until size < threshold
    while (quality >= 10) {
      compressedBuffer = await image.getBuffer('image/jpeg', { quality });
      
      if (compressedBuffer.length <= IMAGE_SIZE_THRESHOLD) {
        return { 
          buffer: compressedBuffer, 
          compressed: true, 
          originalSize,
          newSize: compressedBuffer.length,
          quality
        };
      }
      
      quality -= 10;
    }
    
    // If still too large, return the lowest quality version
    return { 
      buffer: compressedBuffer, 
      compressed: true, 
      originalSize,
      newSize: compressedBuffer.length,
      quality
    };
  } catch (err) {
    error(`  图片压缩失败: ${err.message}`);
    return { buffer, compressed: false, originalSize, error: err.message };
  }
}

/**
 * Upload resource to migration API
 */
async function uploadResource(resourceId, name, mime, contentBase64, entryAlias, timeCreate, timeUpdate, isImage) {
  const payload = {
    entryAlias: entryAlias,
    name: name || resourceId,
    contentBase64: contentBase64,
    createdAt: timeCreate,
    updatedAt: timeUpdate
  };
  
  if (mime) {
    payload.mime = mime;
  }
  
  const response = await fetch(`${NEW_SYSTEM_URL}/migration/resources/${resourceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-migration-token': MIGRATION_TOKEN
    },
    body: JSON.stringify(payload)
  });
  
  return response;
}

/**
 * Process a single resource
 */
async function processResource(resource) {
  const resourceId = resource._id;
  const name = resource.name || '';
  const mime = resource.mime;
  const timeCreate = resource.timeCreate;
  const timeUpdate = resource.timeUpdate;
  const size = resource.size || 0;
  
  processedCount++;
  
  // Determine if this is an image
  const isImage = imageIds.has(resourceId);
  
  if (isImage) {
    log(`[${processedCount}/${stats.total}] 处理图片: ${resourceId} (${formatBytes(size)})`);
    stats.images.total++;
  } else {
    log(`[${processedCount}/${stats.total}] 处理资源: ${resourceId}`);
    stats.nonImages.total++;
  }
  
  try {
    // 1. Download binary content
    const content = await downloadResource(resourceId);
    
    if (!content || content.length === 0) {
      error(`  资源 ${resourceId} 下载失败或内容为空`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(download_error)`);
      return;
    }
    
    let finalContent = content;
    let compressionInfo = null;
    
    // 2. Compress if image and size > threshold
    if (isImage && content.length > IMAGE_SIZE_THRESHOLD) {
      compressionInfo = await compressImage(content);
      finalContent = compressionInfo.buffer;
      
      if (compressionInfo.compressed) {
        stats.images.compressed++;
        log(`  📉 压缩: ${formatBytes(compressionInfo.originalSize)} → ${formatBytes(compressionInfo.newSize)} (quality: ${compressionInfo.quality})`);
      } else {
        stats.images.uncompressed++;
        if (compressionInfo.error) {
          warning(`  压缩失败，使用原图`);
        }
      }
    } else if (isImage) {
      stats.images.uncompressed++;
    }
    
    // 3. Convert to Base64
    const contentBase64 = finalContent.toString('base64');
    
    // 4. Determine entry alias
    const targetEntryAlias = isImage ? ENTRY_ALIAS : defaultEntryAlias;
    
    // 5. Upload to migration API
    const response = await uploadResource(
      resourceId,
      name,
      mime,
      contentBase64,
      targetEntryAlias,
      timeCreate,
      timeUpdate,
      isImage
    );
    
    // 6. Handle response
    switch (response.status) {
      case 200:
        log(`  ⏭️  已存在 (幂等): ${name || resourceId}`);
        stats.existing++;
        break;
        
      case 201:
        if (isImage && compressionInfo?.compressed) {
          log(`  ✅ 创建成功 (已压缩): ${name || resourceId}`);
        } else {
          log(`  ✅ 创建成功: ${name || resourceId}`);
        }
        stats.success++;
        break;
        
      case 400:
        error(`  参数错误: ${name || resourceId}`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(bad_request)`);
        break;
        
      case 401:
        error(`  认证失败，请检查 MIGRATION_API_TOKEN`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(unauthorized)`);
        break;
        
      case 403:
        error(`  迁移接口未启用 (MIGRATION_API_ENABLED=false)`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(forbidden)`);
        break;
        
      case 404:
        error(`  Entry '${targetEntryAlias}' 不存在`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(entry_not_found)`);
        break;
        
      case 409:
        warning(`  冲突 (ID 存在但内容不同): ${name || resourceId}`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(conflict)`);
        break;
        
      default: {
        const body = await response.text();
        error(`  迁移失败 (HTTP ${response.status}): ${body.substring(0, 100)}`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(http_${response.status})`);
      }
    }
    
  } catch (err) {
    error(`  处理资源时发生错误: ${err.message}`);
    stats.failed++;
    stats.failedIds.push(`${resourceId}(error: ${err.message})`);
  }
}

/**
 * Generate migration report
 */
function generateReport() {
  log('');
  log('='.repeat(60));
  log('📊 迁移报告');
  log('='.repeat(60));
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
  
  if (stats.failed > 0) {
    log('');
    log('失败资源:');
    stats.failedIds.forEach(id => {
      log(`  - ${id}`);
    });
  }
  
  log('='.repeat(60));
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
  
  if (!MIGRATION_TOKEN) {
    error('未找到 MIGRATION_API_TOKEN，请检查 .env 文件');
    process.exit(1);
  }
  
  if (!RESOURCES_FILE) {
    error('请指定 resources JSON 文件: --resources=./resources.json');
    process.exit(1);
  }
  
  if (!IMAGES_FILE) {
    error('请指定 images JSON 文件: --images=./images.json');
    process.exit(1);
  }
  
  if (!ENTRY_ALIAS) {
    error('请指定目标 entry alias: --entry-alias=<alias>');
    process.exit(1);
  }
  
  console.log('');
  
  // 1. Load JSON files
  const resourcesData = await loadJsonFiles();
  if (!resourcesData) {
    process.exit(1);
  }
  
  const resourcesList = resourcesData.list || [];
  stats.total = resourcesData.count || resourcesList.length;
  
  if (stats.total === 0) {
    warning('没有找到需要迁移的资源');
    process.exit(0);
  }
  
  // 2. Get default entry
  const defaultEntryOk = await getDefaultEntry();
  if (!defaultEntryOk) {
    process.exit(1);
  }
  
  // 3. Check target entry
  const targetEntryOk = await checkTargetEntry();
  if (!targetEntryOk) {
    process.exit(1);
  }
  
  console.log('');
  log(`📦 找到 ${stats.total} 个资源待迁移`);
  log(`   图片: ${imageIds.size} 个将上传到 '${ENTRY_ALIAS}'`);
  log(`   非图片: ${stats.total - imageIds.size} 个将上传到 '${defaultEntryAlias}'`);
  console.log('');
  
  // 4. Process with concurrency limit
  const limit = pLimit(CONCURRENCY);
  const promises = resourcesList.map(resource => 
    limit(() => processResource(resource))
  );
  
  await Promise.all(promises);
  
  // 5. Generate report
  generateReport();
  
  // 6. Exit with appropriate code
  if (stats.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Run
main().catch(err => {
  error(`程序执行错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
