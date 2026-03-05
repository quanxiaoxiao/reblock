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

import {
  logBanner,
  logInfo,
  logSuccess,
  logError,
  spinner,
} from '../utils/style.mjs';
import {
  loadDotEnvIfExists,
  resolveApiAuthToken,
  resolveBaseUrl,
} from '../utils/env-resolver.mjs';

loadDotEnvIfExists();

const ERROR_API_TOKEN = resolveApiAuthToken();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    id: null,
    resolution: null,
    server: null,
    port: null,
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

  const resolvedTarget = resolveBaseUrl({
    serverArg: options.server,
    portArg: options.port,
  });
  options.server = resolvedTarget.server;
  options.port = resolvedTarget.port;
  options.baseUrl = resolvedTarget.baseUrl;

  return options;
}

function getBaseUrl(options) {
  return options.baseUrl;
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

  logInfo('Error ID', options.id);
  logInfo('Resolution', options.resolution);
  logInfo('URL', url);

  const spin = spinner('Resolving error...').start();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ERROR_API_TOKEN ? { Authorization: `Bearer ${ERROR_API_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      resolution: options.resolution,
    }),
  });

  spin.stop(response.ok);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to resolve error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}

async function main() {
  const options = parseArgs();

  logBanner('Error Resolver', `${options.server}:${options.port}`);

  try {
    const result = await resolveError(options);

    console.log();
    console.log(JSON.stringify(result, null, 2));

    logSuccess(`Error ${options.id} marked as resolved`);
  } catch (err) {
    logError(err.message);
    process.exit(1);
  }
}

main();
