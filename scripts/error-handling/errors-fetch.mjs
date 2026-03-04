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
import {
  c,
  logBanner,
  logSection,
  logInfo,
  logSuccess,
  logError,
  spinner,
} from '../utils/style.mjs';

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
const ERROR_API_TOKEN = process.env.ERRORS_API_TOKEN || process.env.MIGRATION_API_TOKEN || '';

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

function getAuthHeaders() {
  return ERROR_API_TOKEN ? { 'x-errors-token': ERROR_API_TOKEN } : {};
}

async function fetchErrors(options) {
  const baseUrl = getBaseUrl(options);
  const url = new URL(`${baseUrl}/errors`);
  url.searchParams.set('days', options.days.toString());
  url.searchParams.set('status', options.status);
  url.searchParams.set('limit', options.limit.toString());
  url.searchParams.set('offset', options.offset.toString());

  const spin = spinner(`Fetching errors from ${options.server}...`).start();

  const response = await fetch(url.toString(), {
    headers: getAuthHeaders(),
  });

  spin.stop(true, `Fetched ${options.limit} errors`);

  if (!response.ok) {
    throw new Error(`Failed to fetch errors: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchErrorExport(errorId, options) {
  const baseUrl = getBaseUrl(options);
  const url = `${baseUrl}/errors/${errorId}/export`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });

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

  logBanner('Error List', `${options.server}:${options.port}`);
  logInfo('Total', String(data.total));

  for (const error of data.errors) {
    const details = error.details || {};
    console.log();
    logInfo('ID', error._id);
    logInfo('Status', error.status);
    logInfo('Level', error.level);
    logInfo('Time', new Date(error.timestamp).toISOString());
    logInfo('Path', details.path || 'N/A');
    logInfo('Method', details.method || 'N/A');
    logInfo('Error', details.errorMessage || details.errorName || 'Unknown');
    if (error.resolvedAt) {
      logInfo('Resolved', new Date(error.resolvedAt).toISOString());
      logInfo('Resolution', error.resolution);
    }
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

  logBanner('AI-Friendly Error Exports', `${options.server}:${options.port}`);
  logInfo('Total', String(data.total));

  let successCount = 0;
  let failCount = 0;

  for (const error of data.errors) {
    try {
      const exp = await fetchErrorExport(error._id, options);
      console.log();
      console.log(JSON.stringify(exp, null, 2));
      console.log(`${c.dim}---${c.reset}`);
      successCount++;
    } catch (err) {
      logError(`Failed to fetch export for ${error._id}: ${err.message}`);
      failCount++;
    }
  }

  console.log();
  if (successCount > 0) {
    logSuccess(`Exported ${successCount} errors`);
  }
  if (failCount > 0) {
    logError(`Failed to export ${failCount} errors`);
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
    logError(err.message);
    process.exit(1);
  }
}

main();
