#!/usr/bin/env node

/**
 * Check Images 404 Status
 *
 * Reads images.json (array of resource IDs) and checks which resources return 404
 * vs 200 via HTTP requests to the Reblock API.
 *
 * Usage:
 *   node scripts/resource-mgmt/check-images-404.mjs --file images.json
 *   node scripts/resource-mgmt/check-images-404.mjs --file images.json --concurrency 50
 *   node scripts/resource-mgmt/check-images-404.mjs --file images.json --json
 *   node scripts/resource-mgmt/check-images-404.mjs --file images.json --output report.json
 *
 * Options:
 *   --file <path>        Path to images.json (required)
 *   --concurrency <n>    Number of parallel requests (default: 20)
 *   --timeout <ms>       Request timeout in ms (default: 10000)
 *   --json               Output results as JSON
 *   --output <path>      Save report to file
 *   --output-missing <path>  Save 404 IDs to file (default: missing-ids.json)
 *   --verbose            Show progress for each request
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
  const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000', 10);

  return {
    API_BASE: `http://localhost:${port}`,
    DEFAULT_CONCURRENCY: 20,
    DEFAULT_TIMEOUT: 10000,
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
    file: get('--file'),
    concurrency: parseInt(get('--concurrency') ?? '20', 10) || 20,
    timeout: parseInt(get('--timeout') ?? '10000', 10) || 10000,
    json: args.includes('--json'),
    output: get('--output'),
    outputMissing: get('--output-missing') ?? 'missing-ids.json',
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
  const lbl = `${c.dim}${label.padEnd(16)}${c.reset}`;
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

// ─── HTTP Check ───────────────────────────────────────────────────────────────

async function checkResource(resourceId, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${CONFIG.API_BASE}/resources/${resourceId}`, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timer);

    return {
      resourceId,
      status: response.status,
      ok: response.ok,
      is404: response.status === 404,
    };
  } catch (error) {
    clearTimeout(timer);

    return {
      resourceId,
      status: 0,
      ok: false,
      is404: false,
      error: error.name === 'AbortError' ? 'timeout' : error.message,
    };
  }
}

// ─── Batch Processing ─────────────────────────────────────────────────────────

async function processBatch(items, concurrency, timeout, onProgress) {
  const results = [];
  const queue = [...items];
  let completed = 0;

  async function worker() {
    while (queue.length > 0) {
      const resourceId = queue.shift();
      const result = await checkResource(resourceId, timeout);
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
  const notFound = results.filter((r) => r.is404);
  const found = results.filter((r) => r.ok);
  const errors = results.filter((r) => !r.ok && !r.is404);

  return {
    timestamp: new Date().toISOString(),
    apiBase: CONFIG.API_BASE,
    summary: {
      total: results.length,
      found: found.length,
      notFound: notFound.length,
      errors: errors.length,
      foundRate: results.length > 0 ? ((found.length / results.length) * 100).toFixed(2) : 0,
      notFoundRate: results.length > 0 ? ((notFound.length / results.length) * 100).toFixed(2) : 0,
    },
    found: found.map((r) => r.resourceId),
    notFound: notFound.map((r) => r.resourceId),
    errorDetails: errors.map((r) => ({
      resourceId: r.resourceId,
      status: r.status,
      error: r.error || `HTTP ${r.status}`,
    })),
    allResults: results.map((r) => ({
      resourceId: r.resourceId,
      status: r.status,
      ok: r.ok,
      is404: r.is404,
      error: r.error || null,
    })),
  };
}

function printTextReport(report) {
  logBanner('Images 404 Check Report', CONFIG.API_BASE);

  logSection('Summary');
  logInfo('Total Checked', `${c.white}${report.summary.total}${c.reset}`);
  logInfo('Found (200)', `${c.green}${report.summary.found}${c.reset}`);
  logInfo('Not Found (404)', `${c.red}${report.summary.notFound}${c.reset}`);
  logInfo('Errors', `${c.yellow}${report.summary.errors}${c.reset}`);

  const foundPercent = parseFloat(report.summary.foundRate);
  const foundColor = foundPercent >= 90 ? c.green : foundPercent >= 70 ? c.yellow : c.red;
  logInfo('Found Rate', `${foundColor}${report.summary.foundRate}${c.reset}${c.dim}%${c.reset}`);

  if (report.notFound.length > 0) {
    logSection(`Not Found Resources (${report.notFound.length})`);
    report.notFound.slice(0, 20).forEach((id) => {
      logError(id);
    });
    if (report.notFound.length > 20) {
      logDetail(`... and ${report.notFound.length - 20} more`);
    }
  }

  if (report.errorDetails.length > 0) {
    logSection(`Errors (${report.errorDetails.length})`);
    report.errorDetails.slice(0, 10).forEach((e) => {
      logWarn(`${e.resourceId}: ${e.error}`);
    });
    if (report.errorDetails.length > 10) {
      logDetail(`... and ${report.errorDetails.length - 10} more`);
    }
  }

  if (report.found.length > 0 && report.found.length <= 10) {
    logSection(`Found Resources (${report.found.length})`);
    report.found.forEach((id) => {
      logSuccess(id);
    });
  }

  console.log(`\n${c.dim}${'─'.repeat(52)}${c.reset}`);
  if (report.summary.notFound === 0 && report.summary.errors === 0) {
    logSuccess('All resources are accessible');
  } else if (report.summary.notFound > 0) {
    logWarn(`${report.summary.notFound} resources not found (404)`);
  }
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
${c.cyan}Check Images 404 Status${c.reset}

Usage:
  node scripts/resource-mgmt/check-images-404.mjs --file <path> [options]

Options:
  --file <path>        Path to images.json (required)
  --concurrency <n>    Number of parallel requests (default: 20)
  --timeout <ms>       Request timeout in ms (default: 10000)
  --json               Output results as JSON
  --output <path>      Save report to file
  --output-missing <path>  Save 404 IDs to file (default: missing-ids.json)
  --verbose            Show progress for each request
  --help, -h           Show this help

Examples:
  node scripts/resource-mgmt/check-images-404.mjs --file images.json
  node scripts/resource-mgmt/check-images-404.mjs --file images.json --concurrency 50
  node scripts/resource-mgmt/check-images-404.mjs --file images.json --json --output report.json
`);
    process.exit(0);
  }

  if (!args.file) {
    logError('File path is required. Use --file <path>');
    process.exit(1);
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

  if (!args.json) {
    logBanner('Images 404 Check', CONFIG.API_BASE);
    logSection('Configuration');
    logInfo('Input File', args.file);
    logInfo('Resource Count', `${resourceIds.length}`);
    logInfo('Concurrency', `${args.concurrency}`);
    logInfo('Timeout', `${args.timeout}ms`);
    console.log();
  }

  const startTime = Date.now();

  const progressCallback = args.verbose
    ? (completed, total, result) => {
        const symbol = result.is404 ? c.red + '✖' : result.ok ? c.green + '✔' : c.yellow + '!';
        console.log(`  ${symbol}${c.reset} ${result.resourceId} (${result.status})`);
      }
    : (completed, total) => {
        if (completed % 10 === 0 || completed === total) {
          const percent = ((completed / total) * 100).toFixed(1);
          process.stdout.write(`\r  ${c.dim}Progress: ${completed}/${total} (${percent}%)${c.reset}`);
        }
      };

  const results = await processBatch(resourceIds, args.concurrency, args.timeout, progressCallback);

  if (!args.verbose && !args.json) {
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
    if (!args.json) {
      logSuccess(`Report saved to: ${args.output}`);
    }
  }

  // Auto-save 404 IDs to file
  const missingIds = results.filter((r) => r.is404).map((r) => r.resourceId);
  if (missingIds.length > 0) {
    writeFileSync(args.outputMissing, JSON.stringify(missingIds, null, 2));
    if (!args.json) {
      logSuccess(`Missing IDs saved to: ${args.outputMissing}`);
    }
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
    logInfo('Duration', `${c.white}${(duration / 1000).toFixed(2)}${c.reset}${c.dim}s${c.reset}`);
  }

  // Exit with error code if there are 404s or errors
  const exitCode = report.summary.notFound > 0 || report.summary.errors > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`${c.red}Fatal error: ${error.message}${c.reset}`);
  console.error(error);
  process.exit(1);
});
