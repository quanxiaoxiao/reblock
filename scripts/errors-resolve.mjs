#!/usr/bin/env node

/**
 * Reblock Errors Resolve - Mark error as resolved on remote server
 *
 * Mark a 500 error as resolved via API
 *
 * Usage:
 *   npm run errors:resolve -- --id <error_id> --resolution "Fixed by..."
 *   npm run errors:resolve -- --id 69a3ae38c96536b31e708f3e --resolution "Added alias support"
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
const ERROR_API_TOKEN = process.env.ERRORS_API_TOKEN || process.env.MIGRATION_API_TOKEN || '';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    id: null,
    resolution: null,
    server: DEFAULT_SERVER,
    port: DEFAULT_PORT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--id' && args[i + 1]) {
      options.id = args[++i];
    } else if (arg === '--resolution' && args[i + 1]) {
      options.resolution = args[++i];
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

async function resolveError(options) {
  if (!options.id) {
    throw new Error('Error ID is required. Use --id <error_id>');
  }

  if (!options.resolution) {
    throw new Error('Resolution is required. Use --resolution "Fixed description"');
  }

  const baseUrl = getBaseUrl(options);
  const url = `${baseUrl}/errors/${options.id}/resolve`;

  console.error(`Resolving error ${options.id}...`);
  console.error(`URL: ${url}`);
  console.error(`Resolution: ${options.resolution}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ERROR_API_TOKEN ? { 'x-errors-token': ERROR_API_TOKEN } : {}),
    },
    body: JSON.stringify({
      resolution: options.resolution,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to resolve error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

async function main() {
  const options = parseArgs();

  try {
    const result = await resolveError(options);
    
    console.log('\n=== Error Resolved ===');
    console.log(JSON.stringify(result, null, 2));
    console.log(`\nError ${options.id} has been marked as resolved.`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
