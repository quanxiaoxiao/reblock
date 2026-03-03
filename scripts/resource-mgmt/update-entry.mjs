#!/usr/bin/env node

/**
 * Update Entry Script
 * 
 * Update entry properties including uploadConfig and default status
 * Usage: node update-entry.mjs --alias=<alias> | --entry=<id> [options]
 * 
 * Options:
 *   --default                    Set as default entry
 *   --max-file-size=<bytes>    Set max file size limit
 *   --allowed-mime-types=<list> Set allowed MIME types (comma-separated)
 *   --read-only=<true|false>   Set read-only status
 * 
 * Examples:
 *   node update-entry.mjs --alias=notes --default
 *   node update-entry.mjs --entry=6906d8085481cd13472265cd --max-file-size=10485760
 *   node update-entry.mjs --alias=notes --allowed-mime-types=image/jpeg,image/png
 *   node update-entry.mjs --alias=notes --default --max-file-size=10485760 --allowed-mime-types=image/jpeg,image/png --read-only=false
 */

import fetch from 'node-fetch';
import minimist from 'minimist';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// =============================================================================
// Load .env configuration
// =============================================================================

let SERVER_PORT = '3000';
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  const portMatch = envContent.match(/SERVER_PORT=(\d+)/);
  if (portMatch) {
    SERVER_PORT = portMatch[1];
  }
}

// =============================================================================
// Configuration
// =============================================================================

const argv = minimist(process.argv.slice(2), {
  string: ['alias', 'entry', 'allowed-mime-types', 'read-only'],
  boolean: ['help'],
  default: {
    help: false,
    default: undefined,  // Explicitly set to undefined when not provided
  },
  alias: {
    h: 'help',
  }
});

const BASE_URL = `http://localhost:${SERVER_PORT}`;

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

function info(message) {
  log(`ℹ️  ${message}`);
}

function showHelp() {
  console.log(`
Update Entry Script

Usage:
  node update-entry.mjs --alias=<alias> [options]
  node update-entry.mjs --entry=<id> [options]

Required (one of):
  --alias=<alias>              Entry alias to locate
  --entry=<id>                Entry _id to locate

Options:
  --default                    Set as default entry
  --max-file-size=<bytes>    Maximum file size in bytes
  --allowed-mime-types=<list> Comma-separated list of MIME types
  --read-only=<true|false>   Set read-only status
  --help, -h                   Show this help message

Examples:
  # Set entry as default
  node update-entry.mjs --alias=notes --default

  # Update max file size
  node update-entry.mjs --alias=notes --max-file-size=10485760

  # Update allowed MIME types
  node update-entry.mjs --alias=notes --allowed-mime-types=image/jpeg,image/png

  # Update read-only status
  node update-entry.mjs --alias=notes --read-only=true

  # Combined update
  node update-entry.mjs --alias=notes \\
    --default \\
    --max-file-size=10485760 \\
    --allowed-mime-types=image/jpeg,image/png,application/pdf \\
    --read-only=false
`);
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Locate entry by alias or id
 */
async function locateEntry() {
  const alias = argv.alias;
  const entryId = argv.entry;
  
  if (!alias && !entryId) {
    error('请提供 --alias 或 --entry 参数');
    return null;
  }
  
  if (alias && entryId) {
    error('请只提供 --alias 或 --entry 中的一个，不要同时提供');
    return null;
  }
  
  try {
    let url;
    let identifier;
    
    if (alias) {
      url = `${BASE_URL}/entries/${alias}`;
      identifier = `alias: ${alias}`;
    } else {
      url = `${BASE_URL}/entries/${entryId}`;
      identifier = `id: ${entryId}`;
    }
    
    log(`🔍 查找 entry (${identifier})...`);
    
    const response = await fetch(url);
    
    if (response.status === 404) {
      error(`Entry 不存在: ${identifier}`);
      return null;
    }
    
    if (!response.ok) {
      error(`查找 entry 失败 (HTTP ${response.status})`);
      return null;
    }
    
    const entry = await response.json();
    success(`找到 entry: ${entry.name} (${entry._id})`);
    return entry;
    
  } catch (err) {
    error(`查找 entry 时发生错误: ${err.message}`);
    return null;
  }
}

/**
 * Build update data from command line arguments
 */
async function buildUpdateData(entry) {
  const updateData = {};
  
  // Handle isDefault
  if (argv.default !== undefined) {
    updateData.isDefault = argv.default;
    info(`将设置 isDefault: ${argv.default}`);
  }
  
  // Handle uploadConfig
  const hasMaxFileSize = argv['max-file-size'] !== undefined;
  const hasAllowedMimeTypes = argv['allowed-mime-types'] !== undefined;
  const hasReadOnly = argv['read-only'] !== undefined;
  
  if (hasMaxFileSize || hasAllowedMimeTypes || hasReadOnly) {
    // Get existing uploadConfig
    const existingConfig = entry.uploadConfig || {};
    
    updateData.uploadConfig = {
      ...existingConfig,  // Keep existing values
    };
    
    if (hasMaxFileSize) {
      const size = parseInt(argv['max-file-size']);
      if (isNaN(size) || size <= 0) {
        error(`无效的 max-file-size: ${argv['max-file-size']}`);
        return null;
      }
      updateData.uploadConfig.maxFileSize = size;
      info(`将设置 maxFileSize: ${size} bytes (${formatBytes(size)})`);
    }
    
    if (hasAllowedMimeTypes) {
      const mimeTypes = argv['allowed-mime-types']
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0);
      
      if (mimeTypes.length === 0) {
        error(`无效的 allowed-mime-types: ${argv['allowed-mime-types']}`);
        return null;
      }
      
      updateData.uploadConfig.allowedMimeTypes = mimeTypes;
      info(`将设置 allowedMimeTypes: ${mimeTypes.join(', ')}`);
    }
    
    if (hasReadOnly) {
      const readOnly = argv['read-only'].toLowerCase() === 'true';
      updateData.uploadConfig.readOnly = readOnly;
      info(`将设置 readOnly: ${readOnly}`);
    }
  }
  
  return updateData;
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
 * Update entry via API
 */
async function updateEntry(entryId, updateData) {
  log(`📝 更新 entry...`);
  
  try {
    const response = await fetch(`${BASE_URL}/entries/${entryId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updateData),
    });
    
    if (!response.ok) {
      const body = await response.text();
      error(`更新失败 (HTTP ${response.status}): ${body}`);
      return null;
    }
    
    const updatedEntry = await response.json();
    return updatedEntry;
    
  } catch (err) {
    error(`更新时发生错误: ${err.message}`);
    return null;
  }
}

/**
 * Display update summary
 */
function displaySummary(originalEntry, updatedEntry, updateData) {
  log('');
  log('='.repeat(60));
  log('📊 更新摘要');
  log('='.repeat(60));
  log(`Entry ID: ${updatedEntry._id}`);
  log(`Entry Name: ${updatedEntry.name}`);
  log(`Entry Alias: ${updatedEntry.alias || '(无)'}`);
  log('');
  
  if (updateData.isDefault !== undefined) {
    const status = updatedEntry.isDefault ? '✅ 是' : '❌ 否';
    log(`Default: ${status}`);
  }
  
  if (updateData.uploadConfig) {
    log('Upload Config:');
    const config = updatedEntry.uploadConfig || {};
    
    if (config.maxFileSize !== undefined) {
      log(`  maxFileSize: ${config.maxFileSize} bytes (${formatBytes(config.maxFileSize)})`);
    }
    
    if (config.allowedMimeTypes !== undefined) {
      log(`  allowedMimeTypes: ${config.allowedMimeTypes.join(', ')}`);
    }
    
    if (config.readOnly !== undefined) {
      log(`  readOnly: ${config.readOnly}`);
    }
  }
  
  log('='.repeat(60));
  success('更新完成！');
}

// =============================================================================
// Main Entry
// =============================================================================

async function main() {
  // Show help
  if (argv.help) {
    showHelp();
    process.exit(0);
  }
  
  console.log('');
  log('🚀 开始更新 Entry');
  log(`服务器: ${BASE_URL}`);
  console.log('');
  
  // 1. Locate entry
  const entry = await locateEntry();
  if (!entry) {
    process.exit(1);
  }
  
  console.log('');
  
  // 2. Build update data
  const updateData = await buildUpdateData(entry);
  if (!updateData) {
    process.exit(1);
  }
  
  if (Object.keys(updateData).length === 0) {
    info('没有提供需要更新的字段');
    showHelp();
    process.exit(0);
  }
  
  console.log('');
  
  // 3. Update entry
  const updatedEntry = await updateEntry(entry._id, updateData);
  if (!updatedEntry) {
    process.exit(1);
  }
  
  // 4. Display summary
  displaySummary(entry, updatedEntry, updateData);
  
  process.exit(0);
}

// Run
main().catch(err => {
  error(`程序执行错误: ${err.message}`);
  console.error(err);
  process.exit(1);
});
