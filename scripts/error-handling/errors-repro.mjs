#!/usr/bin/env node
/**
 * Reblock Errors Repro - Generate and optionally run hurl reproduction case from /errors
 *
 * Workflow:
 * 1. Fetch latest/open 500 error from /errors (or use --id)
 * 2. Fetch /errors/:id/export
 * 3. Generate hurl testcase
 * 4. Optionally run hurl against current server
 *
 * Usage:
 *   npm run errors:repro
 *   npm run errors:repro -- --id <error_id>
 *   npm run errors:repro -- --run
 *   npm run errors:repro -- --output tests/hurl/errors/generated/my.hurl
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { spawn } from 'child_process';
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
    id: null,
    days: 7,
    status: 'open',
    expectStatus: null,
    output: null,
    run: false,
    server: DEFAULT_SERVER,
    port: DEFAULT_PORT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--id' && args[i + 1]) {
      options.id = args[++i];
    } else if (arg === '--days' && args[i + 1]) {
      options.days = Number.parseInt(args[++i], 10);
    } else if (arg === '--status' && args[i + 1]) {
      options.status = args[++i];
    } else if (arg === '--expect-status' && args[i + 1]) {
      options.expectStatus = Number.parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--run') {
      options.run = true;
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

function buildPathWithQuery(path, query) {
  if (!query || typeof query !== 'object' || Object.keys(query).length === 0) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }

  const q = params.toString();
  if (!q) return path;

  return `${path}?${q}`;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'transfer-encoding',
  ]);

  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!v) continue;
    const lower = k.toLowerCase();
    if (blocked.has(lower)) continue;
    out[k] = String(v);
  }

  return out;
}

async function fetchErrors(options) {
  const baseUrl = getBaseUrl(options);
  const url = new URL(`${baseUrl}/errors`);
  url.searchParams.set('days', String(options.days));
  url.searchParams.set('status', options.status);
  url.searchParams.set('limit', '1');
  url.searchParams.set('offset', '0');

  const spin = spinner(`Fetching errors from ${options.server}...`).start();

  const response = await fetch(url.toString(), {
    headers: getAuthHeaders(),
  });

  spin.stop(response.ok, response.ok ? 'Errors fetched' : 'Failed to fetch');

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
    throw new Error(`Failed to fetch error export: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function generateHurl(errorId, exported, options) {
  const repro = exported.reproduction || {};
  const method = String(repro.method || 'GET').toUpperCase();
  const path = buildPathWithQuery(repro.path || '/', repro.query);
  const headers = sanitizeHeaders(repro.headers);
  const hasBody = repro.body !== undefined && repro.body !== null;

  const lines = [];
  lines.push(`# Auto generated from /errors/${errorId}/export`);
  lines.push(`# Summary: ${(exported.summary || 'Unknown').toString().replace(/\n/g, ' ')}`);
  lines.push(`${method} {{BASE_URL}}${path}`);
  if (ERROR_API_TOKEN) {
    lines.push('x-errors-token: {{ERRORS_TOKEN}}');
  }

  const headerEntries = Object.entries(headers);
  if (hasBody && !headerEntries.some(([k]) => k.toLowerCase() === 'content-type')) {
    headerEntries.unshift(['Content-Type', 'application/json']);
  }

  for (const [k, v] of headerEntries) {
    lines.push(`${k}: ${v}`);
  }

  if (hasBody) {
    lines.push(JSON.stringify(repro.body, null, 2));
  }

  const expectedStatus = Number.isInteger(options.expectStatus)
    ? options.expectStatus
    : Number.isInteger(repro.expectedStatus)
      ? repro.expectedStatus
      : 500;
  lines.push(`HTTP ${expectedStatus}`);

  return lines.join('\n') + '\n';
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function writeHurlFile(content, filePath) {
  ensureParentDir(filePath);
  writeFileSync(filePath, content, 'utf-8');
}

function runHurl(filePath, options) {
  return new Promise((resolveRun, rejectRun) => {
    const args = [filePath, '--variable', `BASE_URL=${getBaseUrl(options)}`];
    if (ERROR_API_TOKEN) {
      args.push('--variable', `ERRORS_TOKEN=${ERROR_API_TOKEN}`);
    }
    const child = spawn('hurl', args, {
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      rejectRun(new Error(`Failed to start hurl: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`hurl exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const options = parseArgs();

  logBanner('Error Reproduction Generator', `${options.server}:${options.port}`);

  try {
    let errorId = options.id;

    if (!errorId) {
      const list = await fetchErrors(options);
      if (!list?.errors?.length) {
        logError('No matching errors found');
        process.exit(1);
      }
      errorId = list.errors[0]._id;
      logSuccess(`Selected error: ${errorId}`);
    }

    const spin = spinner('Fetching error export...').start();
    const exported = await fetchErrorExport(errorId, options);
    spin.stop(true, 'Export fetched');

    const outputPath = options.output || `tests/hurl/errors/generated/repro-${errorId}.hurl`;
    const absOutputPath = resolve(process.cwd(), outputPath);
    const content = generateHurl(errorId, exported, options);

    writeHurlFile(content, absOutputPath);
    logSuccess(`Generated hurl file: ${absOutputPath}`);

    if (options.run) {
      logSection('Running Hurl');
      await runHurl(absOutputPath, options);
      logSuccess('Hurl execution passed');
    }
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

main();
