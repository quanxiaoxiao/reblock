#!/usr/bin/env node

/**
 * Compare Missing Resources with Old Server
 *
 * Reads missing-ids.json and checks which resources exist on the old server,
 * and whether the files are empty (0 bytes).
 *
 * Old server API: GET /api/resource/:id (returns actual file with Content-Length)
 *
 * Usage:
 *   node scripts/migration/compare-with-old.mjs --file missing-ids.json
 *   node scripts/migration/compare-with-old.mjs --file missing-ids.json --old-url http://resources2:3000
 *   node scripts/migration/compare-with-old.mjs --file missing-ids.json --concurrency 10
 *   node scripts/migration/compare-with-old.mjs --file missing-ids.json --output report.json
 *
 * Options:
 *   --file <path>        Path to missing-ids.json (default: missing-ids.json)
 *   --old-url <url>      Old server base URL (default: from OLD_SYSTEM_URL env or http://resources2:3000)
 *   --concurrency <n>    Number of parallel requests (default: 10)
 *   --timeout <ms>       Request timeout in ms (default: 30000)
 *   --output <path>      Save JSON report to file
 *   --verbose            Show detailed progress
 *   --help, -h           Show this help
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Environment ─────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        const [, key, val] = m;
        process.env[key.trim()] ??= val.trim();
      }
    }
  } catch {
    // .env 不存在时忽略
  }
}

loadEnv();

// ─── Config ───────────────────────────────────────────────────────────────────

function buildConfig() {
  return {
    DEFAULT_OLD_URL: process.env.OLD_SYSTEM_URL || 'http://resources2:3000',
    DEFAULT_CONCURRENCY: 10,
    DEFAULT_TIMEOUT: 30000,
  };
}

const CONFIG = buildConfig();

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };

  return {
    file: get('--file') ?? 'missing-ids.json',
    oldUrl: get('--old-url') ?? CONFIG.DEFAULT_OLD_URL,
    concurrency: parseInt(get('--concurrency') ?? '10', 10) || 10,
    timeout: parseInt(get('--timeout') ?? '30000', 10) || 30000,
    output: get('--output'),
    verbose: args.includes('--verbose'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// ─── Terminal helpers ─────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

function logBanner(title, host) {
  console.log(`\n${c.bold}${c.white}${title}${c.reset}  ${c.dim}${host}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(52)}${c.reset}`);
}

function logSection(title) {
  console.log(`\n${c.bold}${title}${c.reset}`);
  const width = title.replace(/[\u4e00-\u9fa5]/g, 'xx').length;
  console.log(`${c.dim}${'─'.repeat(width)}${c.reset}`);
}

function logInfo(label, value, hint = '') {
  const lbl = `${c.dim}${label.padEnd(18)}${c.reset}`;
  const hintStr = hint ? `  ${c.dim}${hint}${c.reset}` : '';
  console.log(`  ${lbl}${value}${hintStr}`);
}

function logSuccess(message) {
  console.log(`  ${c.green}✔ ${message}${c.reset}`);
}

function logWarn(message) {
  console.log(`  ${c.yellow}! ${message}${c.reset}`);
}

function logError(message) {
  console.log(`  ${c.red}✖ ${message}${c.reset}`);
}

function logDetail(message) {
  console.log(`  ${c.dim}  ${message}${c.reset}`);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return `${c.yellow}0 B (empty)${c.reset}`;
  if (bytes < 1024) return `${c.white}${bytes}${c.reset}${c.dim} B${c.reset}`;
  if (bytes < 1024 * 1024) return `${c.white}${(bytes / 1024).toFixed(2)}${c.reset}${c.dim} KB${c.reset}`;
  return `${c.white}${(bytes / 1024 / 1024).toFixed(2)}${c.reset}${c.dim} MB${c.reset}`;
}

// ─── HTTP Check ───────────────────────────────────────────────────────────────

async function checkOldServer(oldUrl, resourceId, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const startTime = Date.now();

  try {
    // Use GET to download and check actual file size
    const response = await fetch(`${oldUrl}/api/resource/${resourceId}`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 404) {
      return {
        resourceId,
        exists: false,
        status: 404,
        size: null,
        isEmpty: false,
        duration: Date.now() - startTime,
      };
    }

    if (!response.ok) {
      return {
        resourceId,
        exists: false,
        status: response.status,
        size: null,
        isEmpty: false,
        error: `HTTP ${response.status}`,
        duration: Date.now() - startTime,
      };
    }

    // Get Content-Length header if available
    const contentLength = response.headers.get('content-length');
    let size = contentLength ? parseInt(contentLength, 10) : null;

    // If no Content-Length or need actual size, read the body
    if (size === null || size === 0) {
      try {
        const buffer = Buffer.from(await response.arrayBuffer());
        size = buffer.length;
      } catch (err) {
        return {
          resourceId,
          exists: true,
          status: response.status,
          size: null,
          isEmpty: false,
          error: `Failed to read body: ${err.message}`,
          duration: Date.now() - startTime,
        };
      }
    }

    return {
      resourceId,
      exists: true,
      status: response.status,
      size,
      isEmpty: size === 0,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    clearTimeout(timer);

    return {
      resourceId,
      exists: false,
      status: 0,
      size: null,
      isEmpty: false,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
      duration: Date.now() - startTime,
    };
  }
}

// ─── Batch Processing ─────────────────────────────────────────────────────────

async function processBatch(items, oldUrl, concurrency, timeout, onProgress) {
  const results = [];
  const queue = [...items];
  let completed = 0;

  async function worker() {
    while (queue.length > 0) {
      const resourceId = queue.shift();
      const result = await checkOldServer(oldUrl, resourceId, timeout);
      results.push(result);
      completed++;

      if (onProgress) {
        onProgress(completed, items.length, result);
      }
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

// ─── Report Generation ────────────────────────────────────────────────────────

function generateReport(results) {
  const existing = results.filter((r) => r.exists && !r.isEmpty);
  const emptyFiles = results.filter((r) => r.exists && r.isEmpty);
  const notFound = results.filter((r) => !r.exists && r.status === 404);
  const errors = results.filter((r) => !r.exists && r.status !== 404);

  const totalSize = existing.reduce((sum, r) => sum + (r.size || 0), 0);
  const avgSize = existing.length > 0 ? totalSize / existing.length : 0;

  return {
    timestamp: new Date().toISOString(),
    oldServerUrl: CONFIG.oldUrl,
    summary: {
      total: results.length,
      existing: existing.length,
      emptyFiles: emptyFiles.length,
      notFound: notFound.length,
      errors: errors.length,
      existingRate: results.length > 0 ? ((existing.length / results.length) * 100).toFixed(2) : 0,
      emptyRate: results.length > 0 ? ((emptyFiles.length / results.length) * 100).toFixed(2) : 0,
      notFoundRate: results.length > 0 ? ((notFound.length / results.length) * 100).toFixed(2) : 0,
      totalSize,
      avgSize: Math.round(avgSize),
    },
    existing: existing.map((r) => ({
      resourceId: r.resourceId,
      size: r.size,
      duration: r.duration,
    })),
    emptyFiles: emptyFiles.map((r) => ({
      resourceId: r.resourceId,
      size: 0,
      duration: r.duration,
    })),
    notFound: notFound.map((r) => ({
      resourceId: r.resourceId,
      status: r.status,
      duration: r.duration,
    })),
    errors: errors.map((r) => ({
      resourceId: r.resourceId,
      status: r.status,
      error: r.error,
      duration: r.duration,
    })),
    allResults: results.map((r) => ({
      resourceId: r.resourceId,
      exists: r.exists,
      status: r.status,
      size: r.size,
      isEmpty: r.isEmpty,
      error: r.error || null,
      duration: r.duration,
    })),
  };
}

function printTextReport(report) {
  logBanner('Compare with Old Server Report', report.oldServerUrl);

  logSection('Summary Statistics');
  logInfo('Total Checked', `${c.white}${report.summary.total}${c.reset}`);
  logInfo('Exists (OK)', `${c.green}${report.summary.existing}${c.reset}`);
  logInfo('Empty Files', `${c.yellow}${report.summary.emptyFiles}${c.reset}`);
  logInfo('Not Found (404)', `${c.red}${report.summary.notFound}${c.reset}`);
  logInfo('Errors', `${c.red}${report.summary.errors}${c.reset}`);

  logSection('Percentages');
  const existingPercent = parseFloat(report.summary.existingRate);
  const existingColor = existingPercent >= 80 ? c.green : existingPercent >= 50 ? c.yellow : c.red;
  logInfo('Exists Rate', `${existingColor}${report.summary.existingRate}${c.reset}${c.dim}%${c.reset}`);

  const emptyPercent = parseFloat(report.summary.emptyRate);
  const emptyColor = emptyPercent === 0 ? c.green : emptyPercent < 5 ? c.yellow : c.red;
  logInfo('Empty Rate', `${emptyColor}${report.summary.emptyRate}${c.reset}${c.dim}%${c.reset}`);

  const notFoundPercent = parseFloat(report.summary.notFoundRate);
  const notFoundColor = notFoundPercent === 0 ? c.green : notFoundPercent < 20 ? c.yellow : c.red;
  logInfo('Not Found Rate', `${notFoundColor}${report.summary.notFoundRate}${c.reset}${c.dim}%${c.reset}`);

  logSection('File Sizes');
  logInfo('Total Size', formatBytes(report.summary.totalSize));
  logInfo('Average Size', formatBytes(report.summary.avgSize));

  if (report.emptyFiles.length > 0) {
    logSection(`Empty Files (${report.emptyFiles.length})`);
    report.emptyFiles.slice(0, 15).forEach((item) => {
      logWarn(item.resourceId);
    });
    if (report.emptyFiles.length > 15) {
      logDetail(`... and ${report.emptyFiles.length - 15} more`);
    }
  }

  if (report.notFound.length > 0) {
    logSection(`Not Found in Old Server (${report.notFound.length})`);
    report.notFound.slice(0, 15).forEach((item) => {
      logError(item.resourceId);
    });
    if (report.notFound.length > 15) {
      logDetail(`... and ${report.notFound.length - 15} more`);
    }
  }

  if (report.errors.length > 0) {
    logSection(`Errors (${report.errors.length})`);
    report.errors.slice(0, 10).forEach((item) => {
      logWarn(`${item.resourceId}: ${item.error}`);
    });
    if (report.errors.length > 10) {
      logDetail(`... and ${report.errors.length - 10} more`);
    }
  }

  if (report.existing.length > 0) {
    logSection(`Existing Files Sample (${Math.min(report.existing.length, 5)} of ${report.existing.length})`);
    report.existing.slice(0, 5).forEach((item) => {
      logSuccess(`${item.resourceId}: ${formatBytes(item.size).replace(/\x1b\[[0-9;]*m/g, '')}`);
    });
  }

  console.log(`\n${c.dim}${'─'.repeat(52)}${c.reset}`);
  if (report.summary.existing > 0 && report.summary.notFound === 0 && report.summary.errors === 0) {
    logSuccess('All missing resources exist in old server');
  } else if (report.summary.notFound > 0) {
    logWarn(`${report.summary.notFound} resources completely missing (404 in both servers)`);
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
${c.cyan}Compare Missing Resources with Old Server${c.reset}

Usage:
  node scripts/migration/compare-with-old.mjs --file <path> [options]

Options:
  --file <path>        Path to missing-ids.json (default: missing-ids.json)
  --old-url <url>      Old server base URL (default: from OLD_SYSTEM_URL env)
  --concurrency <n>    Number of parallel requests (default: 10)
  --timeout <ms>       Request timeout in ms (default: 30000)
  --output <path>      Save JSON report to file
  --verbose            Show detailed progress
  --help, -h           Show this help

Examples:
  node scripts/migration/compare-with-old.mjs
  node scripts/migration/compare-with-old.mjs --file missing-ids.json
  node scripts/migration/compare-with-old.mjs --old-url http://resources2:3000
  node scripts/migration/compare-with-old.mjs --file missing-ids.json --output report.json
`);
    process.exit(0);
  }

  if (!existsSync(args.file)) {
    logError(`File not found: ${args.file}`);
    process.exit(1);
  }

  let resourceIds;
  try {
    const content = readFileSync(args.file, 'utf-8');
    resourceIds = JSON.parse(content);

    if (!Array.isArray(resourceIds)) {
      throw new Error('File must contain a JSON array');
    }

    if (resourceIds.length === 0) {
      logError('No resource IDs found in file');
      process.exit(1);
    }
  } catch (error) {
    logError(`Failed to parse JSON file: ${error.message}`);
    process.exit(1);
  }

  logBanner('Compare with Old Server', args.oldUrl);
  logSection('Configuration');
  logInfo('Input File', args.file);
  logInfo('Resource Count', `${resourceIds.length}`);
  logInfo('Old Server URL', args.oldUrl);
  logInfo('API Endpoint', `${args.oldUrl}/api/resource/:id`);
  logInfo('Concurrency', `${args.concurrency}`);
  logInfo('Timeout', `${args.timeout}ms`);
  console.log();

  const startTime = Date.now();

  const progressCallback = args.verbose
    ? (completed, total, result) => {
        const symbol = result.exists
          ? result.isEmpty
            ? c.yellow + '!'
            : c.green + '✔'
          : c.red + '✖';
        const status = result.exists ? (result.isEmpty ? 'EMPTY' : 'OK') : result.status === 404 ? '404' : 'ERR';
        const size = result.exists ? `(${formatBytes(result.size).replace(/\x1b\[[0-9;]*m/g, '')})` : '';
        console.log(`  ${symbol}${c.reset} ${result.resourceId} [${status}] ${size}`);
      }
    : (completed, total) => {
        if (completed % 10 === 0 || completed === total) {
          const percent = ((completed / total) * 100).toFixed(1);
          process.stdout.write(`\r  ${c.dim}Progress: ${completed}/${total} (${percent}%)${c.reset}`);
        }
      };

  const results = await processBatch(resourceIds, args.oldUrl, args.concurrency, args.timeout, progressCallback);

  if (!args.verbose) {
    process.stdout.write('\r\x1b[K'); // Clear progress line
  }

  const duration = Date.now() - startTime;
  const report = generateReport(results);

  // Add timing info to report
  report.duration = {
    milliseconds: duration,
    seconds: (duration / 1000).toFixed(2),
  };

  if (args.output) {
    writeFileSync(args.output, JSON.stringify(report, null, 2));
    logSuccess(`Report saved to: ${args.output}`);
  }

  printTextReport(report);
  logInfo('Duration', `${c.white}${(duration / 1000).toFixed(2)}${c.reset}${c.dim}s${c.reset}`);

  // Exit with error code if there are missing resources or errors
  const exitCode = report.summary.notFound > 0 || report.summary.errors > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`${c.red}Fatal error: ${error.message}${c.reset}`);
  console.error(error);
  process.exit(1);
});
