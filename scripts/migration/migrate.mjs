#!/usr/bin/env node
import fetch from 'node-fetch';

/**
 * Resource Migration Script
 * 
 * Migrate resources from old system to new system
 * Usage: node migrate.js <entry-alias> [--concurrency=5] [--old-url=<url>] [--new-url=<url>]
 * 
 * Example:
 *   node migrate.js notes --concurrency=5
 *   node migrate.js notes --concurrency=10 --old-url=http://localhost:3329/rsapi
 */

import pLimit from 'p-limit';
import minimist from 'minimist';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// 69a4191c61539f8ca4a92e8e

// =============================================================================
// Load .env configuration first (before argv)
// =============================================================================

let API_AUTH_TOKEN = '';
let SERVER_PORT = '3000'; // default port
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  
  // Load unified API token (fallback to deprecated tokens)
  const unifiedTokenMatch = envContent.match(/API_AUTH_TOKEN=(.+)/);
  const migrationTokenMatch = envContent.match(/MIGRATION_API_TOKEN=(.+)/);
  const errorsTokenMatch = envContent.match(/ERRORS_API_TOKEN=(.+)/);
  API_AUTH_TOKEN = (
    unifiedTokenMatch?.[1]
    || migrationTokenMatch?.[1]
    || errorsTokenMatch?.[1]
    || ''
  ).trim();
  
  // Load server port
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
    'old-url': 'http://localhost:3329/rsapi',
    'new-url': `http://localhost:${SERVER_PORT}`,
  },
  alias: {
    c: 'concurrency',
    o: 'old-url',
    n: 'new-url',
  }
});

const ENTRY_ALIAS = argv._[0];
const CONCURRENCY = parseInt(argv.concurrency);
const OLD_SYSTEM_URL = argv['old-url'];
const NEW_SYSTEM_URL = argv['new-url'];

// Statistics
const stats = {
  total: 0,
  success: 0,
  existing: 0,
  failed: 0,
  failedIds: [],
};

let processedCount = 0;

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

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Check if target entry exists
 */
async function checkEntry() {
  log(`🔍 检查目标 entry: ${ENTRY_ALIAS}`);
  
  try {
    const response = await fetch(`${NEW_SYSTEM_URL}/entries/${ENTRY_ALIAS}`);
    
    if (response.status === 200) {
      success(`Entry '${ENTRY_ALIAS}' 存在`);
      return true;
    } else if (response.status === 404) {
      error(`Entry '${ENTRY_ALIAS}' 不存在`);
      info(`创建命令: curl -X POST '${NEW_SYSTEM_URL}/entries' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"alias":"${ENTRY_ALIAS}","name":"${ENTRY_ALIAS}"}'`);
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
 * Fetch resource list from old system
 */
async function fetchResourceList() {
  log('📥 获取资源列表...');
  
  try {
    const url = `${OLD_SYSTEM_URL}/entry/${ENTRY_ALIAS}/resources?limit=9999999&skip=0`;
    const response = await fetch(url);
    
    if (!response.ok) {
      error(`获取资源列表失败 (HTTP ${response.status})`);
      return null;
    }
    
    const data = await response.json();
    
    if (!data || !Array.isArray(data.list)) {
      error('无法解析资源列表响应格式');
      info(`响应内容: ${JSON.stringify(data).substring(0, 200)}...`);
      return null;
    }
    
    return data;
  } catch (err) {
    error(`获取资源列表时发生错误: ${err.message}`);
    return null;
  }
}

/**
 * Fetch resource metadata
 */
async function fetchResourceMetadata(resourceId) {
  try {
    const response = await fetch(`${OLD_SYSTEM_URL}/resource/${resourceId}`);
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Download resource binary content
 */
async function downloadResource(resourceId) {
  try {
    const response = await fetch(`${OLD_SYSTEM_URL}/resource/${resourceId}`);
    
    if (!response.ok) {
      return null;
    }
    
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer);
  } catch {
    return null;
  }
}

/**
 * Migrate a single resource
 */
async function migrateResource(resource) {
  const resourceId = resource._id;
  processedCount++;
  
  log(`[${processedCount}/${stats.total}] 处理资源: ${resourceId}`);
  
  try {
    // 1. Get resource metadata
    const metadata = await fetchResourceMetadata(resourceId);
    
    if (!metadata) {
      error(`  资源 ${resourceId} 元数据获取失败`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(metadata_error)`);
      return;
    }
    
    const name = metadata.name || resourceId;
    const mime = metadata.mime || '';
    
    // 2. Download binary content
    const content = await downloadResource(resourceId);
    
    if (!content || content.length === 0) {
      error(`  资源 ${resourceId} (${name}) 下载失败或内容为空`);
      stats.failed++;
      stats.failedIds.push(`${resourceId}(download_error)`);
      return;
    }
    
    // 3. Convert to Base64
    const contentBase64 = content.toString('base64');
    
    // 4. Call migration API
    const payload = {
      entryAlias: ENTRY_ALIAS,
      name: name,
      mime: mime,
      contentBase64: contentBase64
    };
    
    const response = await fetch(`${NEW_SYSTEM_URL}/migration/resources/${resourceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_AUTH_TOKEN}`,
      },
      body: JSON.stringify(payload)
    });
    
    // 5. Handle response
    switch (response.status) {
      case 200:
        log(`  ⏭️  已存在 (幂等): ${name}`);
        stats.existing++;
        break;
        
      case 201:
        log(`  ✅ 创建成功: ${name} (${formatBytes(content.length)})`);
        stats.success++;
        break;
        
      case 400:
        error(`  参数错误: ${name}`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(bad_request)`);
        break;
        
      case 401:
        error('  认证失败，请检查 API_AUTH_TOKEN');
        stats.failed++;
        stats.failedIds.push(`${resourceId}(unauthorized)`);
        break;
        
      case 403:
        error(`  迁移接口未启用 (MIGRATION_API_ENABLED=false)`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(forbidden)`);
        break;
        
      case 404:
        error(`  Entry '${ENTRY_ALIAS}' 不存在`);
        stats.failed++;
        stats.failedIds.push(`${resourceId}(entry_not_found)`);
        break;
        
      case 409:
        warning(`  冲突 (ID 存在但内容不同): ${name}`);
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
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Generate migration report
 */
function generateReport() {
  log('');
  log('='.repeat(50));
  log('📊 迁移报告');
  log('='.repeat(50));
  log(`目标 Entry: ${ENTRY_ALIAS}`);
  log(`旧系统: ${OLD_SYSTEM_URL}`);
  log(`新系统: ${NEW_SYSTEM_URL}`);
  log(`并发数: ${CONCURRENCY}`);
  log('');
  log(`总资源数: ${stats.total}`);
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
  
  log('='.repeat(50));
}

// =============================================================================
// Main Entry
// =============================================================================

async function main() {
  console.log('');
  log('🚀 开始资源迁移');
  log(`旧系统: ${OLD_SYSTEM_URL}`);
  log(`新系统: ${NEW_SYSTEM_URL}`);
  log(`目标 Entry: ${ENTRY_ALIAS}`);
  log(`并发数: ${CONCURRENCY}`);
  
  if (!API_AUTH_TOKEN) {
    error('未找到 API_AUTH_TOKEN，请检查 .env 文件');
    process.exit(1);
  }
  
  console.log('');
  
  // 1. Check entry
  const entryExists = await checkEntry();
  if (!entryExists) {
    process.exit(1);
  }
  
  console.log('');
  
  // 2. Fetch resource list
  const data = await fetchResourceList();
  if (!data) {
    process.exit(1);
  }
  
  stats.total = data.count || data.list.length;
  
  if (stats.total === 0) {
    warning('没有找到需要迁移的资源');
    process.exit(0);
  }
  
  log(`📦 找到 ${stats.total} 个资源待迁移`);
  console.log('');
  
  // 3. Process with concurrency limit
  const limit = pLimit(CONCURRENCY);
  const promises = data.list.map(resource => 
    limit(() => migrateResource(resource))
  );
  
  await Promise.all(promises);
  
  // 4. Generate report
  generateReport();
  
  // 5. Exit with appropriate code
  if (stats.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Validate arguments
if (!ENTRY_ALIAS) {
  console.error('用法: node migrate.js <entry-alias> [--concurrency=5]');
  console.error('');
  console.error('示例:');
  console.error('  node migrate.js notes');
  console.error('  node migrate.js notes --concurrency=10');
  console.error('  node migrate.js notes -c 5 --old-url=http://localhost:3329/rsapi');
  process.exit(1);
}

// Run
main().catch(err => {
  error(`程序执行错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
