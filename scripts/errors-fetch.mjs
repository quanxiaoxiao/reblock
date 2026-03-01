#!/usr/bin/env node

/**
 * Reblock Errors Fetch - Fetch errors from remote server
 *
 * Fetch 500 errors from a remote server for analysis
 *
 * Usage:
 *   npm run errors:fetch                      # Fetch last 7 days open errors
 *   npm run errors:fetch -- --days 30         # Fetch last 30 days
 *   npm run errors:fetch -- --status resolved # Fetch resolved errors
 *   npm run errors:fetch -- --json             # JSON output
 *   npm run errors:fetch -- --export           # AI-friendly export format
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

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

const DEFAULT_SERVER = process.env.SERVER_HOST || 'localhost';
const DEFAULT_PORT = process.env.SERVER_PORT || '4362';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    days: 7,
    status: 'open',
    limit: 100,
    offset: 0,
    json: false,
    export: false,
    server: DEFAULT_SERVER,
    port: DEFAULT_PORT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--days' && args[i + 1]) {
      options.days = parseInt(args[++i]);
    } else if (arg === '--status' && args[i + 1]) {
      options.status = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i]);
    } else if (arg === '--offset' && args[i + 1]) {
      options.offset = parseInt(args[++i]);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--export') {
      options.export = true;
    } else if (arg === '--server' && args[i + 1]) {
      options.server = args[++i];
    } else if (arg === '--port' && args[i + 1]) {
      options.port = args[++i];
    }
  }

  return options;
}

function getBaseUrl(options) {
  return `http://${options.server}:${options.port}`;
}

async function fetchErrors(options) {
  const baseUrl = getBaseUrl(options);
  const url = new URL(`${baseUrl}/errors`);
  url.searchParams.set('days', options.days.toString());
  url.searchParams.set('status', options.status);
  url.searchParams.set('limit', options.limit.toString());
  url.searchParams.set('offset', options.offset.toString());

  console.error(`Fetching errors from ${url.toString()}...`);

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`Failed to fetch errors: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchErrorExport(errorId, options) {
  const baseUrl = getBaseUrl(options);
  const url = `${baseUrl}/errors/${errorId}/export`;

  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch error export: ${response.status}`);
  }

  return response.json();
}

function printErrors(data, options) {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('\n=== Error List ===');
  console.log(`Total: ${data.total}`);
  console.log('');

  for (const error of data.errors) {
    const details = error.details || {};
    console.log(`ID: ${error._id}`);
    console.log(`  Status: ${error.status}`);
    console.log(`  Level: ${error.level}`);
    console.log(`  Time: ${new Date(error.timestamp).toISOString()}`);
    console.log(`  Path: ${details.path || 'N/A'}`);
    console.log(`  Method: ${details.method || 'N/A'}`);
    console.log(`  Error: ${details.errorMessage || details.errorName || 'Unknown'}`);
    if (error.resolvedAt) {
      console.log(`  Resolved: ${new Date(error.resolvedAt).toISOString()}`);
      console.log(`  Resolution: ${error.resolution}`);
    }
    console.log('');
  }
}

async function printExports(data, options) {
  if (options.json) {
    const exports = [];
    for (const error of data.errors) {
      const exp = await fetchErrorExport(error._id, options);
      exports.push(exp);
    }
    console.log(JSON.stringify(exports, null, 2));
    return;
  }

  console.log('\n=== AI-Friendly Error Exports ===');
  console.log(`Total: ${data.total}\n`);

  for (const error of data.errors) {
    try {
      const exp = await fetchErrorExport(error._id, options);
      console.log(JSON.stringify(exp, null, 2));
      console.log('---');
    } catch (err) {
      console.error(`Failed to fetch export for ${error._id}:`, err.message);
    }
  }
}

async function main() {
  const options = parseArgs();

  try {
    const data = await fetchErrors(options);

    if (options.export) {
      await printExports(data, options);
    } else {
      printErrors(data, options);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
