#!/usr/bin/env node

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { basename, dirname, relative, resolve } from 'path';
import {
  loadDotEnvIfExists,
  resolveApiAuthToken,
  resolveBaseUrl,
} from '../utils/env-resolver.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'reblock-mcp',
  version: '0.1.0',
};

const MAX_CAPTURE_CHARS = 200_000;
const DEFAULT_BASE_URL = 'http://127.0.0.1:4362';
const DEFAULT_MANIFEST_FILE = 'analysis_output/upload-manifest.json';
const DEFAULT_PLAN_FILE = 'analysis_output/upload-sync-plan.json';
const DEFAULT_REPORT_DIR = 'analysis_output';

loadDotEnvIfExists();

const TOOL_DEFS = [
  {
    name: 'run_hurl_suite',
    description: 'Run the full Reblock hurl suite through test-hurl.sh.',
    inputSchema: {
      type: 'object',
      properties: {
        hurlEnv: { type: 'string', default: 'local' },
        testPort: { type: 'integer', minimum: 1, maximum: 65535, default: 4362 },
        apiToken: { type: 'string' },
        serverLog: { type: 'string', default: '/tmp/reblock-hurl-server.log' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'run_hurl_case',
    description: 'Run a single hurl file with standard variables.',
    inputSchema: {
      type: 'object',
      required: ['hurlFile'],
      properties: {
        hurlFile: { type: 'string', minLength: 1 },
        baseUrl: { type: 'string', default: DEFAULT_BASE_URL },
        apiToken: { type: 'string' },
        hurlEnv: { type: 'string', default: 'local' },
        timestamp: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_open_errors',
    description: 'Fetch /errors with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', minimum: 1, maximum: 30, default: 1 },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'ignored'],
          default: 'open',
        },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        offset: { type: 'integer', minimum: 0, default: 0 },
        requestId: { type: 'string' },
        baseUrl: { type: 'string' },
        apiToken: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'generate_error_repro',
    description: 'Generate a hurl repro case from /errors/:id/export (optional --run).',
    inputSchema: {
      type: 'object',
      properties: {
        errorId: { type: 'string' },
        days: { type: 'integer', minimum: 1, maximum: 30, default: 1 },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'ignored'],
          default: 'open',
        },
        expectStatus: { type: 'integer', minimum: 100, maximum: 599 },
        output: { type: 'string' },
        runImmediately: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'resolve_error',
    description: 'Resolve an error by id with a resolution note.',
    inputSchema: {
      type: 'object',
      required: ['errorId', 'resolution'],
      properties: {
        errorId: { type: 'string', minLength: 1 },
        resolution: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'build_local_manifest',
    description: 'Build a local file manifest with sha256 for upload sync.',
    inputSchema: {
      type: 'object',
      required: ['sourceDir'],
      properties: {
        sourceDir: { type: 'string', minLength: 1 },
        glob: { type: 'string', default: '**/*' },
        outputFile: { type: 'string', default: DEFAULT_MANIFEST_FILE },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'plan_upload_sync',
    description: 'Compare local manifest with remote entry resources and produce a sync plan.',
    inputSchema: {
      type: 'object',
      required: ['entryAlias', 'manifestFile'],
      properties: {
        entryAlias: { type: 'string', minLength: 1 },
        manifestFile: { type: 'string', minLength: 1 },
        outputFile: { type: 'string', default: DEFAULT_PLAN_FILE },
        baseUrl: { type: 'string', default: DEFAULT_BASE_URL },
        apiToken: { type: 'string' },
        dryRun: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'apply_upload_sync',
    description: 'Execute upload actions from a sync plan. Requires confirm=true.',
    inputSchema: {
      type: 'object',
      required: ['planFile', 'confirm'],
      properties: {
        planFile: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean', const: true },
        baseUrl: { type: 'string' },
        apiToken: { type: 'string' },
        concurrency: { type: 'integer', minimum: 1, maximum: 8, default: 3 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'verify_upload_sync',
    description: 'Verify remote resources after sync. Use manifestFile for full validation.',
    inputSchema: {
      type: 'object',
      required: ['entryAlias'],
      properties: {
        entryAlias: { type: 'string', minLength: 1 },
        baseUrl: { type: 'string', default: DEFAULT_BASE_URL },
        apiToken: { type: 'string' },
        sampleSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        manifestFile: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'sync_directories_to_entries',
    description: 'High-level batch workflow: ensure entries, sync local folders, and generate reports.',
    inputSchema: {
      type: 'object',
      required: ['directories'],
      properties: {
        directories: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['sourceDir'],
            properties: {
              sourceDir: { type: 'string', minLength: 1 },
              entryName: { type: 'string' },
              entryAlias: { type: 'string' },
              glob: { type: 'string', default: '**/*' },
            },
            additionalProperties: false,
          },
        },
        createEntryIfMissing: { type: 'boolean', default: true },
        remotePolicy: { type: 'string', enum: ['keep', 'prune'], default: 'keep' },
        baseUrl: { type: 'string', default: DEFAULT_BASE_URL },
        apiToken: { type: 'string' },
        concurrency: { type: 'integer', minimum: 1, maximum: 8, default: 3 },
        dryRun: { type: 'boolean', default: false },
        reportDir: { type: 'string', default: DEFAULT_REPORT_DIR },
      },
      additionalProperties: false,
    },
  },
];

function appendTail(existing, chunk, maxChars = MAX_CAPTURE_CHARS) {
  const next = existing + chunk;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

function tailLines(text, maxLines = 80) {
  const lines = (text || '').trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines);
}

function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    timeoutMs = 0,
  } = options;

  return new Promise((resolveRun, rejectRun) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timer = null;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout = appendTail(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendTail(stderr, chunk.toString());
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      rejectRun(err);
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolveRun({
        code: code ?? 1,
        signal: signal ?? null,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value.map(cleanObject);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = cleanObject(v);
      }
    }
    return out;
  }
  return value;
}

function normalizeSlashes(inputPath) {
  return inputPath.replace(/\\/g, '/');
}

function escapeRegex(input) {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function createGlobMatcher(globPattern) {
  const pattern = normalizeSlashes((globPattern || '**/*').trim() || '**/*');
  if (pattern === '**/*' || pattern === '*' || pattern === '**') {
    return () => true;
  }

  const tokenized = pattern
    .split('**')
    .map((segment) => segment.split('*').map(escapeRegex).join('[^/]*'))
    .join('.*');
  const regex = new RegExp(`^${tokenized}$`);
  return (candidatePath) => regex.test(normalizeSlashes(candidatePath));
}

async function sha256File(filePath) {
  const hash = createHash('sha256');

  return new Promise((resolveHash, rejectHash) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', (err) => {
      rejectHash(err);
    });
    stream.on('end', () => {
      resolveHash(hash.digest('hex'));
    });
  });
}

async function listFilesRecursive(sourceDir, globPattern) {
  const matcher = createGlobMatcher(globPattern);
  const files = [];
  const stack = [sourceDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absPath = resolve(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relPath = normalizeSlashes(relative(sourceDir, absPath));
      if (!matcher(relPath)) {
        continue;
      }
      files.push({
        absPath,
        relativePath: relPath,
      });
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

async function ensureParentDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

function resolvedBaseUrl(args = {}) {
  if (args.baseUrl) {
    return String(args.baseUrl).replace(/\/+$/, '');
  }
  return resolveBaseUrl({}).baseUrl;
}

function authHeaders(apiToken) {
  return apiToken ? { Authorization: `Bearer ${apiToken}` } : {};
}

async function fetchJsonSafe(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json,
    text,
  };
}

async function fetchAllEntryResources({ entryAlias, baseUrl, apiToken }) {
  const limit = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const items = [];

  while (offset < total) {
    const url = new URL(`${baseUrl}/resources`);
    url.searchParams.set('entryAlias', entryAlias);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));

    const response = await fetchJsonSafe(url.toString(), {
      headers: authHeaders(apiToken),
    });

    if (!response.ok) {
      const body = response.json ?? response.text;
      throw new Error(`Failed to fetch resources: ${response.status} ${response.statusText} - ${JSON.stringify(body)}`);
    }

    const pageItems = Array.isArray(response.json?.items) ? response.json.items : [];
    total = typeof response.json?.total === 'number' ? response.json.total : pageItems.length;
    items.push(...pageItems);

    if (pageItems.length === 0) {
      break;
    }
    offset += pageItems.length;
  }

  return items;
}

function resourceByNameMap(resources) {
  const map = new Map();
  for (const item of resources) {
    const name = typeof item?.name === 'string' ? item.name : '';
    if (!name) continue;
    if (!map.has(name)) {
      map.set(name, []);
    }
    map.get(name).push(item);
  }
  return map;
}

async function runWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Math.min(8, Math.floor(concurrency || 1)));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current], current);
    }
  }

  const workers = [];
  for (let i = 0; i < safeConcurrency; i += 1) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

function sanitizeEntryAlias(rawValue) {
  if (typeof rawValue !== 'string') return '';
  return rawValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pickEntryNameAndAlias(spec) {
  const sourceDir = String(spec.sourceDir);
  const derivedName = basename(resolve(process.cwd(), sourceDir));
  const entryName = String(spec.entryName || derivedName).trim();
  const aliasSource = typeof spec.entryAlias === 'string' && spec.entryAlias.trim()
    ? spec.entryAlias
    : entryName;
  const entryAlias = sanitizeEntryAlias(aliasSource);
  return { entryName, entryAlias };
}

function buildReportPrefix(reportDir, entryAlias, runTimestamp) {
  const safeAlias = sanitizeEntryAlias(entryAlias) || 'unknown';
  const base = `sync-${safeAlias}-${runTimestamp}`;
  let candidate = base;
  let attempt = 2;
  while (
    existsSync(resolve(reportDir, `${candidate}.json`))
    || existsSync(resolve(reportDir, `${candidate}.md`))
    || existsSync(resolve(reportDir, `${candidate}.manifest.json`))
    || existsSync(resolve(reportDir, `${candidate}.plan.json`))
  ) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  return candidate;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function markdownForFolderResult(folderResult) {
  const lines = [];
  lines.push(`# Sync Report: ${folderResult.entryAlias}`);
  lines.push('');
  lines.push(`- Status: ${folderResult.ok ? 'success' : 'failed'}`);
  lines.push(`- Source Directory: ${folderResult.sourceDir}`);
  lines.push(`- Entry Name: ${folderResult.entryName}`);
  lines.push(`- Entry Alias: ${folderResult.entryAlias}`);
  if (folderResult.entryId) {
    lines.push(`- Entry ID: ${folderResult.entryId}`);
  }
  lines.push('');

  if (folderResult.planSummary) {
    lines.push('## Plan Summary');
    lines.push(`- Local Files: ${folderResult.planSummary.localFiles ?? 0}`);
    lines.push(`- Remote Resources: ${folderResult.planSummary.remoteResources ?? 0}`);
    lines.push(`- Upload Count: ${folderResult.planSummary.uploadCount ?? 0}`);
    lines.push(`- Skip Count: ${folderResult.planSummary.skipCount ?? 0}`);
    lines.push(`- Changed Count: ${folderResult.planSummary.changedCount ?? 0}`);
    lines.push(`- New Count: ${folderResult.planSummary.newCount ?? 0}`);
    lines.push('');
  }

  if (folderResult.applySummary) {
    lines.push('## Apply Summary');
    lines.push(`- Requested Uploads: ${folderResult.applySummary.requestedUploads ?? 0}`);
    lines.push(`- Uploaded: ${folderResult.applySummary.uploaded ?? 0}`);
    lines.push(`- Failed: ${folderResult.applySummary.failed ?? 0}`);
    lines.push(`- Skipped: ${folderResult.applySummary.skipped ?? 0}`);
    lines.push(`- Duration (ms): ${folderResult.applySummary.durationMs ?? 0}`);
    lines.push('');
  }

  if (folderResult.verifySummary) {
    lines.push('## Verify Summary');
    lines.push(`- Remote Resources: ${folderResult.verifySummary.remoteResources ?? 0}`);
    lines.push(`- Local Files: ${folderResult.verifySummary.localFiles ?? 0}`);
    lines.push(`- Missing Remote: ${folderResult.verifySummary.missingRemoteCount ?? 0}`);
    lines.push(`- Missing SHA: ${folderResult.verifySummary.missingShaCount ?? 0}`);
    lines.push(`- Missing Name: ${folderResult.verifySummary.missingNameCount ?? 0}`);
    lines.push(`- Duplicate Names: ${folderResult.verifySummary.duplicateNameCount ?? 0}`);
    lines.push('');
  }

  const topFailures = toArray(folderResult.topFailures);
  if (topFailures.length > 0) {
    lines.push('## Top Failures');
    for (const item of topFailures.slice(0, 20)) {
      lines.push(`- ${item.relativePath || 'unknown'}: ${item.error || `${item.status || ''} ${item.statusText || ''}`.trim()}`);
    }
    lines.push('');
  }

  if (folderResult.error) {
    lines.push('## Error');
    lines.push(`- Message: ${folderResult.error.message || 'unknown error'}`);
    if (folderResult.error.code) {
      lines.push(`- Code: ${folderResult.error.code}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function fetchEntryByAlias({ baseUrl, apiToken, alias }) {
  const url = `${baseUrl}/entries/${encodeURIComponent(alias)}`;
  return fetchJsonSafe(url, {
    headers: authHeaders(apiToken),
  });
}

async function ensureEntry({ baseUrl, apiToken, entryName, entryAlias, createEntryIfMissing }) {
  const existing = await fetchEntryByAlias({ baseUrl, apiToken, alias: entryAlias });
  if (existing.ok && existing.json?._id) {
    return {
      ok: true,
      created: false,
      entry: existing.json,
    };
  }

  if (existing.status !== 404) {
    return {
      ok: false,
      error: {
        code: 'ENTRY_LOOKUP_FAILED',
        message: `Failed to query entry by alias: ${existing.status} ${existing.statusText}`,
      },
    };
  }

  if (!createEntryIfMissing) {
    return {
      ok: false,
      error: {
        code: 'ENTRY_NOT_FOUND',
        message: `Entry alias not found: ${entryAlias}`,
      },
    };
  }

  const createRes = await fetchJsonSafe(`${baseUrl}/entries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(apiToken),
    },
    body: JSON.stringify({
      name: entryName,
      alias: entryAlias,
    }),
  });

  if (createRes.ok && createRes.json?._id) {
    return {
      ok: true,
      created: true,
      entry: createRes.json,
    };
  }

  if (createRes.status === 409) {
    const retry = await fetchEntryByAlias({ baseUrl, apiToken, alias: entryAlias });
    if (retry.ok && retry.json?._id) {
      return {
        ok: true,
        created: false,
        entry: retry.json,
      };
    }
    return {
      ok: false,
      error: {
        code: 'ENTRY_CONFLICT_REFETCH_FAILED',
        message: `Entry create conflict but refetch failed for alias: ${entryAlias}`,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'ENTRY_CREATE_FAILED',
      message: `Failed to create entry: ${createRes.status} ${createRes.statusText}`,
    },
  };
}

async function toolRunHurlSuite(args = {}) {
  const hurlEnv = args.hurlEnv || 'local';
  const testPort = String(args.testPort || 4362);
  const apiToken = args.apiToken || resolveApiAuthToken() || 'test-api-token';
  const serverLog = args.serverLog || '/tmp/reblock-hurl-server.log';

  const result = await runCommand('sh', ['./test-hurl.sh'], {
    env: {
      HURL_ENV: hurlEnv,
      TEST_PORT: testPort,
      API_TOKEN: apiToken,
      SERVER_LOG: serverLog,
    },
  });

  return cleanObject({
    ok: result.code === 0,
    tool: 'run_hurl_suite',
    summary: {
      exitCode: result.code,
      durationMs: result.durationMs,
      hurlEnv,
      testPort: Number(testPort),
      serverLog,
    },
    stdoutTail: tailLines(result.stdout),
    stderrTail: tailLines(result.stderr),
    nextAction: result.code === 0
      ? 'suite passed'
      : 'inspect stderrTail and rerun failing case with run_hurl_case',
  });
}

async function toolRunHurlCase(args = {}) {
  const hurlFileRaw = args.hurlFile;
  if (!hurlFileRaw) {
    throw new Error('hurlFile is required');
  }

  const hurlFile = resolve(process.cwd(), hurlFileRaw);
  if (!existsSync(hurlFile)) {
    throw new Error(`hurlFile not found: ${hurlFile}`);
  }

  const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
  const apiToken = args.apiToken || resolveApiAuthToken() || 'test-api-token';
  const hurlEnv = args.hurlEnv || 'local';
  const timestamp = Number.isInteger(args.timestamp) ? args.timestamp : Math.floor(Date.now() / 1000);

  const today = new Date();
  const date = today.toISOString().slice(0, 10);

  const commandArgs = [
    '--test',
    '--variables-file',
    `tests/hurl/env/${hurlEnv}.env`,
    '--variable',
    `BASE_URL=${baseUrl}`,
    '--variable',
    `API_TOKEN=${apiToken}`,
    '--variable',
    `ERRORS_TOKEN=${apiToken}`,
    '--variable',
    `timestamp=${timestamp}`,
    '--variable',
    `date=${date}`,
    hurlFile,
  ];

  const result = await runCommand('hurl', commandArgs);

  return cleanObject({
    ok: result.code === 0,
    tool: 'run_hurl_case',
    summary: {
      exitCode: result.code,
      durationMs: result.durationMs,
      hurlFile,
      baseUrl,
      hurlEnv,
    },
    stdoutTail: tailLines(result.stdout),
    stderrTail: tailLines(result.stderr),
    nextAction: result.code === 0
      ? 'case passed'
      : 'use fetch_open_errors or generate_error_repro if status 500',
  });
}

async function toolFetchOpenErrors(args = {}) {
  const days = Number.isInteger(args.days) ? args.days : 1;
  const status = args.status || 'open';
  const limit = Number.isInteger(args.limit) ? args.limit : 50;
  const offset = Number.isInteger(args.offset) ? args.offset : 0;
  const requestId = args.requestId;
  const apiToken = args.apiToken || resolveApiAuthToken();

  const resolved = args.baseUrl
    ? { baseUrl: args.baseUrl }
    : resolveBaseUrl({});
  const baseUrl = resolved.baseUrl;

  const url = new URL(`${baseUrl}/errors`);
  url.searchParams.set('days', String(days));
  url.searchParams.set('status', status);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (requestId) {
    url.searchParams.set('requestId', requestId);
  }

  try {
    const response = await fetch(url.toString(), {
      headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        tool: 'fetch_open_errors',
        summary: {
          status: response.status,
          statusText: response.statusText,
        },
        error: payload,
        nextAction: 'verify API_AUTH_TOKEN and /errors endpoint availability',
      };
    }

    return cleanObject({
      ok: true,
      tool: 'fetch_open_errors',
      summary: {
        total: payload.total ?? 0,
        returned: Array.isArray(payload.errors) ? payload.errors.length : 0,
        days,
        status,
        baseUrl,
      },
      errors: payload.errors || [],
      nextAction: (payload.errors || []).length > 0
        ? 'use generate_error_repro on the latest error'
        : 'no matching errors',
    });
  } catch (err) {
    return {
      ok: false,
      tool: 'fetch_open_errors',
      summary: {
        baseUrl,
      },
      error: {
        message: err instanceof Error ? err.message : String(err),
      },
      nextAction: 'start API server or set baseUrl to a reachable endpoint',
    };
  }
}

async function toolGenerateErrorRepro(args = {}) {
  const commandArgs = ['scripts/error-handling/errors-repro.mjs'];

  if (args.errorId) {
    commandArgs.push('--id', String(args.errorId));
  }
  if (Number.isInteger(args.days)) {
    commandArgs.push('--days', String(args.days));
  } else {
    commandArgs.push('--days', '1');
  }
  if (args.status) {
    commandArgs.push('--status', String(args.status));
  } else {
    commandArgs.push('--status', 'open');
  }
  if (Number.isInteger(args.expectStatus)) {
    commandArgs.push('--expect-status', String(args.expectStatus));
  }
  if (args.output) {
    commandArgs.push('--output', String(args.output));
  }
  if (args.runImmediately) {
    commandArgs.push('--run');
  }

  const result = await runCommand('node', commandArgs);
  const combined = `${result.stdout}\n${result.stderr}`;
  const generatedMatch = combined.match(/Generated hurl file:\s*(.+)/i);
  const generatedFile = generatedMatch ? generatedMatch[1].trim() : null;

  return cleanObject({
    ok: result.code === 0,
    tool: 'generate_error_repro',
    summary: {
      exitCode: result.code,
      durationMs: result.durationMs,
      generatedFile,
      ranHurl: Boolean(args.runImmediately),
    },
    stdoutTail: tailLines(result.stdout),
    stderrTail: tailLines(result.stderr),
    nextAction: result.code === 0
      ? 'run_hurl_case on generated file after code changes'
      : 'check /errors availability and script output',
  });
}

async function toolResolveError(args = {}) {
  if (!args.errorId) {
    throw new Error('errorId is required');
  }
  if (!args.resolution) {
    throw new Error('resolution is required');
  }

  const result = await runCommand('node', [
    'scripts/error-handling/errors-resolve.mjs',
    '--id',
    String(args.errorId),
    '--resolution',
    String(args.resolution),
  ]);

  return cleanObject({
    ok: result.code === 0,
    tool: 'resolve_error',
    summary: {
      exitCode: result.code,
      durationMs: result.durationMs,
      errorId: String(args.errorId),
    },
    stdoutTail: tailLines(result.stdout),
    stderrTail: tailLines(result.stderr),
    nextAction: result.code === 0
      ? 'error resolved'
      : 'verify error id and auth token',
  });
}

async function toolBuildLocalManifest(args = {}) {
  if (!args.sourceDir) {
    throw new Error('sourceDir is required');
  }

  const sourceDir = resolve(process.cwd(), String(args.sourceDir));
  const sourceStat = await stat(sourceDir).catch(() => null);
  if (!sourceStat || !sourceStat.isDirectory()) {
    throw new Error(`sourceDir is not a directory: ${sourceDir}`);
  }

  const globPattern = args.glob || '**/*';
  const outputFile = resolve(process.cwd(), String(args.outputFile || DEFAULT_MANIFEST_FILE));
  const discovered = await listFilesRecursive(sourceDir, globPattern);
  const startedAt = Date.now();

  const files = [];
  let totalSize = 0;
  for (const item of discovered) {
    const fileStat = await stat(item.absPath);
    const sha256 = await sha256File(item.absPath);
    totalSize += fileStat.size;
    files.push({
      relativePath: item.relativePath,
      absPath: item.absPath,
      size: fileStat.size,
      mtimeMs: Math.floor(fileStat.mtimeMs),
      sha256,
    });
  }

  const manifest = {
    version: 1,
    generatedAt: Date.now(),
    sourceDir,
    glob: globPattern,
    fileCount: files.length,
    totalSize,
    files,
  };

  await ensureParentDir(outputFile);
  await writeFile(outputFile, JSON.stringify(manifest, null, 2), 'utf8');

  return cleanObject({
    ok: true,
    tool: 'build_local_manifest',
    summary: {
      sourceDir,
      outputFile,
      fileCount: files.length,
      totalSize,
      durationMs: Date.now() - startedAt,
    },
    artifacts: {
      manifestFile: outputFile,
      firstFiles: files.slice(0, 10).map((f) => f.relativePath),
    },
    nextAction: 'run plan_upload_sync with entryAlias and manifestFile',
  });
}

async function toolPlanUploadSync(args = {}) {
  if (!args.entryAlias) {
    throw new Error('entryAlias is required');
  }
  if (!args.manifestFile) {
    throw new Error('manifestFile is required');
  }

  const entryAlias = String(args.entryAlias);
  const manifestFile = resolve(process.cwd(), String(args.manifestFile));
  const outputFile = resolve(process.cwd(), String(args.outputFile || DEFAULT_PLAN_FILE));
  const dryRun = args.dryRun !== false;
  const apiToken = args.apiToken || resolveApiAuthToken();
  const baseUrl = resolvedBaseUrl(args);

  const manifestRaw = await readFile(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestRaw);
  const localFiles = Array.isArray(manifest.files) ? manifest.files : [];

  const remoteResources = await fetchAllEntryResources({ entryAlias, baseUrl, apiToken });
  const byName = resourceByNameMap(remoteResources);
  const localNames = new Set(localFiles.map((f) => f.relativePath));

  let uploadCount = 0;
  let skipCount = 0;
  let changedCount = 0;
  let newCount = 0;

  const planItems = localFiles.map((file) => {
    const candidates = byName.get(file.relativePath) || [];
    const exact = candidates.find((r) => r.sha256 && r.sha256 === file.sha256);

    if (exact) {
      skipCount += 1;
      return {
        action: 'skip',
        reason: 'unchanged',
        relativePath: file.relativePath,
        absPath: file.absPath,
        size: file.size,
        sha256: file.sha256,
        remoteResourceId: exact._id,
      };
    }

    uploadCount += 1;
    if (candidates.length > 0) {
      changedCount += 1;
    } else {
      newCount += 1;
    }

    return {
      action: 'upload',
      reason: candidates.length > 0 ? 'hash_mismatch' : 'missing_remote_name',
      relativePath: file.relativePath,
      absPath: file.absPath,
      size: file.size,
      sha256: file.sha256,
      remoteCandidates: candidates.slice(0, 5).map((c) => ({
        _id: c._id,
        sha256: c.sha256,
        size: c.size,
      })),
    };
  });

  const remoteOnly = remoteResources
    .filter((r) => typeof r.name === 'string' && r.name && !localNames.has(r.name))
    .map((r) => ({
      _id: r._id,
      name: r.name,
      sha256: r.sha256,
      size: r.size,
    }));

  const plan = {
    version: 1,
    generatedAt: Date.now(),
    entryAlias,
    baseUrl,
    manifestFile,
    dryRun,
    summary: {
      localFiles: localFiles.length,
      remoteResources: remoteResources.length,
      uploadCount,
      skipCount,
      changedCount,
      newCount,
      remoteOnlyCount: remoteOnly.length,
    },
    items: planItems,
    remoteOnly: remoteOnly.slice(0, 500),
  };

  await ensureParentDir(outputFile);
  await writeFile(outputFile, JSON.stringify(plan, null, 2), 'utf8');

  return cleanObject({
    ok: true,
    tool: 'plan_upload_sync',
    summary: {
      ...plan.summary,
      entryAlias,
      dryRun,
      outputFile,
    },
    artifacts: {
      planFile: outputFile,
      manifestFile,
    },
    nextAction: uploadCount > 0
      ? 'run apply_upload_sync with confirm=true'
      : 'no upload required',
  });
}

async function uploadSingleFile({ baseUrl, apiToken, entryAlias, item }) {
  const encodedAlias = encodeURIComponent(entryAlias);
  const url = new URL(`${baseUrl}/upload/${encodedAlias}`);
  url.searchParams.set('name', item.relativePath);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...authHeaders(apiToken),
    },
    body: createReadStream(item.absPath),
    duplex: 'half',
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: json ?? text,
  };
}

async function toolApplyUploadSync(args = {}) {
  if (!args.planFile) {
    throw new Error('planFile is required');
  }
  if (args.confirm !== true) {
    throw new Error('confirm=true is required for apply_upload_sync');
  }

  const planFile = resolve(process.cwd(), String(args.planFile));
  const rawPlan = await readFile(planFile, 'utf8');
  const plan = JSON.parse(rawPlan);
  const entryAlias = plan.entryAlias;
  const baseUrl = args.baseUrl ? resolvedBaseUrl(args) : String(plan.baseUrl || DEFAULT_BASE_URL);
  const apiToken = args.apiToken || resolveApiAuthToken();
  const concurrency = Number.isInteger(args.concurrency) ? args.concurrency : 3;

  if (!entryAlias) {
    throw new Error('entryAlias is missing in plan');
  }

  const uploads = Array.isArray(plan.items)
    ? plan.items.filter((item) => item.action === 'upload')
    : [];

  const startedAt = Date.now();
  const results = await runWithConcurrency(uploads, concurrency, async (item) => {
    try {
      const fileStat = await stat(item.absPath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) {
        return {
          ok: false,
          relativePath: item.relativePath,
          error: 'local_file_missing',
        };
      }

      const response = await uploadSingleFile({
        baseUrl,
        apiToken,
        entryAlias,
        item,
      });

      return {
        ok: response.ok,
        relativePath: item.relativePath,
        status: response.status,
        statusText: response.statusText,
        response: response.body,
      };
    } catch (err) {
      return {
        ok: false,
        relativePath: item.relativePath,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const uploaded = results.filter((r) => r.ok).length;
  const failed = results.length - uploaded;
  const reportFile = `${planFile}.apply-result.json`;

  const report = {
    version: 1,
    generatedAt: Date.now(),
    entryAlias,
    baseUrl,
    planFile,
    summary: {
      requestedUploads: uploads.length,
      uploaded,
      failed,
      skipped: Array.isArray(plan.items) ? plan.items.filter((i) => i.action !== 'upload').length : 0,
      durationMs: Date.now() - startedAt,
    },
    results,
  };

  await ensureParentDir(reportFile);
  await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');

  return cleanObject({
    ok: failed === 0,
    tool: 'apply_upload_sync',
    summary: report.summary,
    artifacts: {
      reportFile,
      failedItems: results.filter((r) => !r.ok).slice(0, 20),
    },
    nextAction: failed === 0
      ? 'run verify_upload_sync'
      : 'inspect failedItems and retry apply_upload_sync',
  });
}

async function toolVerifyUploadSync(args = {}) {
  if (!args.entryAlias) {
    throw new Error('entryAlias is required');
  }

  const entryAlias = String(args.entryAlias);
  const baseUrl = resolvedBaseUrl(args);
  const apiToken = args.apiToken || resolveApiAuthToken();
  const sampleSize = Number.isInteger(args.sampleSize) ? args.sampleSize : 20;
  const manifestFile = args.manifestFile ? resolve(process.cwd(), String(args.manifestFile)) : null;

  const remoteResources = await fetchAllEntryResources({ entryAlias, baseUrl, apiToken });
  const byName = resourceByNameMap(remoteResources);
  const missingShaCount = remoteResources.filter((r) => !r.sha256).length;
  const missingNameCount = remoteResources.filter((r) => !r.name).length;

  const duplicateNameCount = Array.from(byName.values()).filter((items) => items.length > 1).length;

  if (manifestFile) {
    const manifestRaw = await readFile(manifestFile, 'utf8');
    const manifest = JSON.parse(manifestRaw);
    const localFiles = Array.isArray(manifest.files) ? manifest.files : [];

    const missingRemote = [];
    for (const file of localFiles) {
      const candidates = byName.get(file.relativePath) || [];
      const hasMatch = candidates.some((r) => r.sha256 === file.sha256);
      if (!hasMatch) {
        missingRemote.push({
          relativePath: file.relativePath,
          sha256: file.sha256,
          size: file.size,
        });
      }
    }

    return cleanObject({
      ok: missingRemote.length === 0 && missingShaCount === 0,
      tool: 'verify_upload_sync',
      summary: {
        entryAlias,
        remoteResources: remoteResources.length,
        localFiles: localFiles.length,
        missingRemoteCount: missingRemote.length,
        missingShaCount,
        missingNameCount,
        duplicateNameCount,
      },
      artifacts: {
        missingRemote: missingRemote.slice(0, 50),
      },
      nextAction: missingRemote.length === 0
        ? 'verification passed'
        : 'rerun apply_upload_sync for missing paths',
    });
  }

  const sampled = remoteResources.slice(0, Math.max(1, Math.min(sampleSize, remoteResources.length)));
  const invalidSample = sampled.filter((r) => !r.name || !r.sha256).map((r) => ({
    _id: r._id,
    name: r.name,
    sha256: r.sha256,
  }));

  return cleanObject({
    ok: invalidSample.length === 0,
    tool: 'verify_upload_sync',
    summary: {
      entryAlias,
      remoteResources: remoteResources.length,
      sampled: sampled.length,
      invalidSampleCount: invalidSample.length,
      missingShaCount,
      missingNameCount,
      duplicateNameCount,
    },
    artifacts: {
      invalidSample: invalidSample.slice(0, 50),
    },
    nextAction: invalidSample.length === 0
      ? 'basic verification passed (add manifestFile for full verification)'
      : 'fix invalid resource metadata and rerun verification',
  });
}

async function toolSyncDirectoriesToEntries(args = {}) {
  const directories = Array.isArray(args.directories) ? args.directories : [];
  if (directories.length === 0) {
    throw new Error('directories must be a non-empty array');
  }

  const remotePolicy = args.remotePolicy || 'keep';
  if (remotePolicy !== 'keep') {
    return {
      ok: false,
      tool: 'sync_directories_to_entries',
      error: {
        code: 'UNSUPPORTED_REMOTE_POLICY',
        message: `remotePolicy=${remotePolicy} is not supported in v1; use "keep"`,
      },
      nextAction: 'set remotePolicy to "keep"',
    };
  }

  const createEntryIfMissing = args.createEntryIfMissing !== false;
  const dryRun = args.dryRun === true;
  const concurrency = Number.isInteger(args.concurrency) ? args.concurrency : 3;
  const apiToken = args.apiToken || resolveApiAuthToken();
  const baseUrl = resolvedBaseUrl(args);
  const runTimestamp = Date.now();
  const reportDir = resolve(process.cwd(), String(args.reportDir || DEFAULT_REPORT_DIR));

  await mkdir(reportDir, { recursive: true });

  const results = [];
  let totalUploaded = 0;
  let totalFailedUploads = 0;
  let succeeded = 0;
  let failed = 0;

  for (const spec of directories) {
    const sourceDir = String(spec.sourceDir || '');
    const folderBase = {
      sourceDir,
      sourceDirResolved: resolve(process.cwd(), sourceDir),
      remotePolicy,
      dryRun,
    };

    let folderResult;
    let entryAliasForReport = 'unknown';

    try {
      const sourceStat = await stat(folderBase.sourceDirResolved).catch(() => null);
      if (!sourceStat || !sourceStat.isDirectory()) {
        throw {
          code: 'SOURCE_DIR_NOT_DIRECTORY',
          message: `sourceDir is not a directory: ${folderBase.sourceDirResolved}`,
        };
      }

      const { entryName, entryAlias } = pickEntryNameAndAlias(spec);
      entryAliasForReport = entryAlias || 'invalid-alias';
      if (!entryAlias) {
        throw {
          code: 'INVALID_ALIAS_DERIVATION',
          message: `Derived alias is empty for sourceDir=${sourceDir}`,
        };
      }

      const ensured = await ensureEntry({
        baseUrl,
        apiToken,
        entryName,
        entryAlias,
        createEntryIfMissing,
      });
      if (!ensured.ok) {
        throw ensured.error || {
          code: 'ENTRY_ENSURE_FAILED',
          message: 'Failed to ensure entry',
        };
      }

      const reportPrefix = buildReportPrefix(reportDir, entryAlias, runTimestamp);
      const manifestFile = resolve(reportDir, `${reportPrefix}.manifest.json`);
      const planFile = resolve(reportDir, `${reportPrefix}.plan.json`);
      const folderJsonFile = resolve(reportDir, `${reportPrefix}.json`);
      const folderMarkdownFile = resolve(reportDir, `${reportPrefix}.md`);

      await toolBuildLocalManifest({
        sourceDir: folderBase.sourceDirResolved,
        glob: spec.glob || '**/*',
        outputFile: manifestFile,
      });

      const planRes = await toolPlanUploadSync({
        entryAlias,
        manifestFile,
        outputFile: planFile,
        baseUrl,
        apiToken,
        dryRun,
      });

      const applyRes = dryRun
        ? {
          ok: true,
          summary: {
            requestedUploads: 0,
            uploaded: 0,
            failed: 0,
            skipped: planRes.summary?.skipCount ?? 0,
            durationMs: 0,
          },
          artifacts: {
            reportFile: null,
            failedItems: [],
          },
        }
        : await toolApplyUploadSync({
          planFile,
          confirm: true,
          baseUrl,
          apiToken,
          concurrency,
        });

      const verifyRes = dryRun
        ? null
        : await toolVerifyUploadSync({
          entryAlias,
          baseUrl,
          apiToken,
          manifestFile,
        });

      const topFailures = toArray(applyRes?.artifacts?.failedItems).slice(0, 20);
      const folderOk = dryRun
        ? Boolean(planRes.ok)
        : Boolean(planRes.ok && applyRes.ok && verifyRes?.ok);

      folderResult = {
        ok: folderOk,
        ...folderBase,
        entryName,
        entryAlias,
        entryId: ensured.entry?._id || null,
        entryCreated: ensured.created,
        planSummary: planRes.summary,
        applySummary: applyRes.summary,
        verifySummary: verifyRes?.summary || null,
        topFailures,
        reports: {
          json: folderJsonFile,
          markdown: folderMarkdownFile,
          manifest: manifestFile,
          plan: planFile,
          apply: applyRes?.artifacts?.reportFile || null,
        },
      };

      totalUploaded += applyRes?.summary?.uploaded || 0;
      totalFailedUploads += applyRes?.summary?.failed || 0;
      if (folderOk) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      const reportPrefix = buildReportPrefix(reportDir, entryAliasForReport, runTimestamp);
      const folderJsonFile = resolve(reportDir, `${reportPrefix}.json`);
      const folderMarkdownFile = resolve(reportDir, `${reportPrefix}.md`);
      folderResult = {
        ok: false,
        ...folderBase,
        entryName: spec.entryName || basename(resolve(process.cwd(), sourceDir || '.')),
        entryAlias: entryAliasForReport,
        entryId: null,
        entryCreated: false,
        planSummary: null,
        applySummary: null,
        verifySummary: null,
        topFailures: [],
        error: {
          code: err?.code || 'SYNC_FOLDER_FAILED',
          message: err?.message || (err instanceof Error ? err.message : String(err)),
        },
        reports: {
          json: folderJsonFile,
          markdown: folderMarkdownFile,
          manifest: null,
          plan: null,
          apply: null,
        },
      };
      failed += 1;
    }

    await writeFile(folderResult.reports.json, JSON.stringify(folderResult, null, 2), 'utf8');
    await writeFile(folderResult.reports.markdown, markdownForFolderResult(folderResult), 'utf8');
    results.push(folderResult);
  }

  const batchSummary = {
    version: 1,
    generatedAt: Date.now(),
    baseUrl,
    remotePolicy,
    dryRun,
    summary: {
      totalDirectories: directories.length,
      succeeded,
      failed,
      totalUploaded,
      totalFailedUploads,
    },
    results,
  };
  const batchReportFile = resolve(reportDir, `sync-batch-${runTimestamp}.json`);
  await writeFile(batchReportFile, JSON.stringify(batchSummary, null, 2), 'utf8');

  return cleanObject({
    ok: failed === 0,
    tool: 'sync_directories_to_entries',
    summary: batchSummary.summary,
    results,
    artifacts: {
      batchReportFile,
      reportDir,
    },
    nextAction: failed === 0
      ? 'sync completed for all directories'
      : 'inspect per-folder reports and retry failed directories',
  });
}

async function callTool(name, args) {
  switch (name) {
    case 'run_hurl_suite':
      return toolRunHurlSuite(args);
    case 'run_hurl_case':
      return toolRunHurlCase(args);
    case 'fetch_open_errors':
      return toolFetchOpenErrors(args);
    case 'generate_error_repro':
      return toolGenerateErrorRepro(args);
    case 'resolve_error':
      return toolResolveError(args);
    case 'build_local_manifest':
      return toolBuildLocalManifest(args);
    case 'plan_upload_sync':
      return toolPlanUploadSync(args);
    case 'apply_upload_sync':
      return toolApplyUploadSync(args);
    case 'verify_upload_sync':
      return toolVerifyUploadSync(args);
    case 'sync_directories_to_entries':
      return toolSyncDirectoriesToEntries(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function writeMessage(message) {
  const body = JSON.stringify(message);
  const payload = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
  process.stdout.write(payload);
}

function writeResult(id, result) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeError(id, code, message, data) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: cleanObject({
      code,
      message,
      data,
    }),
  });
}

function parseHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
  }
  return headers;
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (!method) {
    writeError(id, -32600, 'Invalid Request: method is required');
    return;
  }

  try {
    if (method === 'initialize') {
      writeResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'ping') {
      writeResult(id, {});
      return;
    }

    if (method === 'tools/list') {
      writeResult(id, {
        tools: TOOL_DEFS,
      });
      return;
    }

    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      if (!name) {
        writeError(id, -32602, 'Invalid params: tools/call requires name');
        return;
      }

      let outcome;
      try {
        outcome = await callTool(name, args);
      } catch (err) {
        outcome = {
          ok: false,
          tool: name,
          error: {
            message: err instanceof Error ? err.message : String(err),
          },
          nextAction: 'check tool arguments, file paths, and API availability',
        };
      }
      const text = JSON.stringify(outcome, null, 2);
      writeResult(id, {
        content: [
          {
            type: 'text',
            text,
          },
        ],
        structuredContent: outcome,
        isError: !outcome.ok,
      });
      return;
    }

    writeError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    writeError(
      id,
      -32000,
      err instanceof Error ? err.message : 'Unknown server error',
      err instanceof Error ? { stack: err.stack } : undefined,
    );
  }
}

let queue = Promise.resolve();

function enqueue(message) {
  queue = queue
    .then(async () => {
      if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
        await handleRequest(message);
      } else if (message?.method === 'notifications/initialized') {
        await handleRequest(message);
      }
    })
    .catch((err) => {
      const errorText = err instanceof Error ? err.stack || err.message : String(err);
      process.stderr.write(`[reblock-mcp] queue error: ${errorText}\n`);
    });
}

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const headerText = buffer.slice(0, headerEnd).toString('utf8');
    const headers = parseHeaders(headerText);
    const length = Number.parseInt(headers['content-length'] || '', 10);

    if (!Number.isFinite(length) || length < 0) {
      buffer = Buffer.alloc(0);
      break;
    }

    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) break;

    const bodyText = buffer.slice(messageStart, messageEnd).toString('utf8');
    buffer = buffer.slice(messageEnd);

    try {
      const message = JSON.parse(bodyText);
      enqueue(message);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[reblock-mcp] invalid JSON: ${errorText}\n`);
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});
