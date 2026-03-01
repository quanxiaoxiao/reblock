#!/usr/bin/env node

/**
 * Create Entry Script
 *
 * 快速创建 Entry 的脚本
 *
 * Usage:
 *   node scripts/create-entry.mjs
 *   node scripts/create-entry.mjs --name "My Album"
 *   node scripts/create-entry.mjs --name "Test" --alias "test-entry" --description "Test entry"
 *   node scripts/create-entry.mjs --name "Images Only" --allowed-mime-types "image/*"
 *   node scripts/create-entry.mjs --name "Large Files" --max-file-size 104857600
 *   node scripts/create-entry.mjs --name "Restricted" --allowed-mime-types "image/png,image/jpeg" --max-file-size 5242880 --read-only
 *
 * Options:
 *   -n, --name <name>              Entry name (required)
 *   -a, --alias <alias>            Entry alias (optional, auto-generated if not provided)
 *   -d, --description <desc>      Entry description (optional)
 *       --default                  Set as default entry (optional)
 *   -o, --order <number>          Sort order (optional)
 *   -m, --max-file-size <bytes>   Max file size in bytes (optional)
 *   -t, --allowed-mime-types <types>  Allowed MIME types (comma-separated, optional)
 *       --read-only               Set entry as read-only (optional)
 *   -u, --url <url>               API base URL (optional, default: http://127.0.0.1:4362)
 *   -h, --help                    Show this help message
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

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

const CONFIG = {
  BASE_URL: process.env.API_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4362',
};

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

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    name: null,
    alias: null,
    description: null,
    isDefault: false,
    order: null,
    url: CONFIG.BASE_URL,
    help: false,
    maxSize: null,
    allowedMimeTypes: null,
    readOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--name':
      case '-n':
        if (i + 1 < args.length) result.name = args[++i];
        break;
      case '--alias':
      case '-a':
        if (i + 1 < args.length) result.alias = args[++i];
        break;
      case '--description':
      case '-d':
        if (i + 1 < args.length) result.description = args[++i];
        break;
      case '--default':
      case '--is-default':
        result.isDefault = true;
        break;
      case '--order':
      case '-o':
        if (i + 1 < args.length) result.order = parseInt(args[++i], 10);
        break;
      case '--max-file-size':
      case '-m':
        if (i + 1 < args.length) result.maxSize = parseInt(args[++i], 10);
        break;
      case '--allowed-mime-types':
      case '-t':
        if (i + 1 < args.length) result.allowedMimeTypes = args[++i].split(',').map(s => s.trim());
        break;
      case '--read-only':
        result.readOnly = true;
        break;
      case '--url':
      case '-u':
        if (i + 1 < args.length) result.url = args[++i];
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
${colors.bold}Create Entry Script${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node scripts/create-entry.mjs [options]

${colors.cyan}Options:${colors.reset}
  -n, --name <name>          Entry name (required)
  -a, --alias <alias>        Entry alias (optional, auto-generated if not provided)
  -d, --description <desc>  Entry description (optional)
      --default              Set as default entry (optional)
  -o, --order <number>      Sort order (optional)
  -m, --max-file-size <bytes>  Max file size in bytes (optional)
  -t, --allowed-mime-types <types>  Allowed MIME types (comma-separated, optional)
      --read-only           Set entry as read-only (optional)
  -u, --url <url>           API base URL (optional, default: http://127.0.0.1:4362)
  -h, --help                Show this help message

${colors.cyan}Examples:${colors.reset}
  node scripts/create-entry.mjs --name "My Album"
  node scripts/create-entry.mjs --name "Test" --alias "test-entry" --description "Test entry"
  node scripts/create-entry.mjs --name "Images Only" --allowed-mime-types "image/*"
  node scripts/create-entry.mjs --name "Large Files" --max-file-size 104857600
  node scripts/create-entry.mjs -n "ReadOnly" --read-only
  node scripts/create-entry.mjs -n "Restricted" -t "image/png,image/jpeg" -m 5242880
`);
}

async function api(method, path, body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const url = path.startsWith('http') ? path : `${CONFIG.BASE_URL}${path}`;
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function createEntry(data) {
  const result = await api('POST', '/entries', data);

  if (!result.ok) {
    console.log(`${colors.red}✗ Failed to create entry${colors.reset}`);
    console.log(`${colors.gray}  Status: ${result.status}${colors.reset}`);
    console.log(`${colors.gray}  Error: ${JSON.stringify(result.data)}${colors.reset}`);
    process.exit(1);
  }

  return result.data;
}

function printEntry(entry) {
  console.log();
  console.log(`${colors.green}✓ Entry created successfully!${colors.reset}`);
  console.log();
  console.log(`  ${colors.bold}ID:${colors.reset}       ${entry._id}`);
  console.log(`  ${colors.bold}Name:${colors.reset}     ${entry.name}`);
  console.log(`  ${colors.bold}Alias:${colors.reset}    ${entry.alias || '(none)'}`);
  console.log(`  ${colors.bold}Description:${colors.reset} ${entry.description || '(none)'}`);
  console.log(`  ${colors.bold}Default:${colors.reset}  ${entry.isDefault ? 'Yes' : 'No'}`);
  console.log(`  ${colors.bold}Order:${colors.reset}     ${entry.order ?? '(none)'}`);
  
  if (entry.uploadConfig) {
    console.log(`  ${colors.bold}Upload Config:${colors.reset}`);
    if (entry.uploadConfig.maxFileSize) {
      console.log(`    ${colors.gray}Max File Size: ${formatBytes(entry.uploadConfig.maxFileSize)}${colors.reset}`);
    }
    if (entry.uploadConfig.allowedMimeTypes && entry.uploadConfig.allowedMimeTypes.length > 0) {
      console.log(`    ${colors.gray}Allowed MIME Types: ${entry.uploadConfig.allowedMimeTypes.join(', ')}${colors.reset}`);
    }
    if (entry.uploadConfig.readOnly) {
      console.log(`    ${colors.gray}Read Only: Yes${colors.reset}`);
    }
  }
  
  console.log(`  ${colors.bold}Created:${colors.reset}  ${new Date(entry.createdAt).toLocaleString()}`);
  console.log();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  if (!args.name) {
    console.log(`${colors.red}✗ Entry name is required${colors.reset}`);
    console.log(`${colors.gray}  Use --name or -n to specify the entry name${colors.reset}`);
    console.log(`${colors.gray}  Or run with --help to see usage${colors.reset}`);
    process.exit(1);
  }

  // Generate alias if not provided
  if (!args.alias) {
    const timestamp = Date.now().toString(36);
    args.alias = `entry-${timestamp}`;
  }

  const entryData = {
    name: args.name,
    alias: args.alias,
    ...(args.description && { description: args.description }),
    ...(args.isDefault && { isDefault: args.isDefault }),
    ...(args.order !== null && { order: args.order }),
    ...((args.maxSize || args.allowedMimeTypes || args.readOnly) && {
      uploadConfig: {
        ...(args.maxSize && { maxFileSize: args.maxSize }),
        ...(args.allowedMimeTypes && { allowedMimeTypes: args.allowedMimeTypes }),
        ...(args.readOnly && { readOnly: args.readOnly }),
      },
    }),
  };

  console.log(`${colors.cyan}Creating entry...${colors.reset}`);
  console.log(`${colors.gray}  Name: ${args.name}${colors.reset}`);
  console.log(`${colors.gray}  Alias: ${args.alias}${colors.reset}`);
  if (args.description) console.log(`${colors.gray}  Description: ${args.description}${colors.reset}`);
  if (args.isDefault) console.log(`${colors.gray}  Default: Yes${colors.reset}`);
  if (args.order) console.log(`${colors.gray}  Order: ${args.order}${colors.reset}`);
  if (args.maxSize) console.log(`${colors.gray}  Max Size: ${formatBytes(args.maxSize)}${colors.reset}`);
  if (args.allowedMimeTypes) console.log(`${colors.gray}  Allowed MIME Types: ${args.allowedMimeTypes.join(', ')}${colors.reset}`);
  if (args.readOnly) console.log(`${colors.gray}  Read Only: Yes${colors.reset}`);
  console.log(`${colors.gray}  URL: ${args.url}${colors.reset}`);

  CONFIG.BASE_URL = args.url;

  const entry = await createEntry(entryData);
  printEntry(entry);
}

main().catch(err => {
  console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
  process.exit(1);
});
