#!/usr/bin/env node

import { spawn } from 'child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { loadDotEnvIfExists, resolveBaseUrl } from '../utils/env-resolver.mjs';

loadDotEnvIfExists();

const DEFAULT_TIMEOUT_MS = 5_000;
const SERVER_START_TIMEOUT_MS = 45_000;

function frame(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baseUrl: process.env.API_BASE_URL || resolveBaseUrl({}).baseUrl,
    keepFiles: false,
    skipBuild: false,
    reportFile: null,
    reportDir: resolve(process.cwd(), 'analysis_output'),
    maxDuplicateNames: 0,
    maxMissingSha: 0,
    maxMissingRemote: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--base-url' && args[i + 1]) {
      options.baseUrl = args[++i];
    } else if (arg === '--keep-files') {
      options.keepFiles = true;
    } else if (arg === '--skip-build') {
      options.skipBuild = true;
    } else if (arg === '--report-file' && args[i + 1]) {
      options.reportFile = resolve(process.cwd(), args[++i]);
    } else if (arg === '--report-dir' && args[i + 1]) {
      options.reportDir = resolve(process.cwd(), args[++i]);
    } else if (arg === '--max-duplicate-names' && args[i + 1]) {
      const parsed = Number.parseInt(args[++i], 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.maxDuplicateNames = parsed;
      }
    } else if (arg === '--max-missing-sha' && args[i + 1]) {
      const parsed = Number.parseInt(args[++i], 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.maxMissingSha = parsed;
      }
    } else if (arg === '--max-missing-remote' && args[i + 1]) {
      const parsed = Number.parseInt(args[++i], 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        options.maxMissingRemote = parsed;
      }
    }
  }

  return options;
}

function appendTail(existing, chunk, maxChars = 120_000) {
  const next = existing + chunk;
  return next.length > maxChars ? next.slice(next.length - maxChars) : next;
}

function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = {},
    timeoutMs = 0,
  } = options;

  return new Promise((resolveRun, rejectRun) => {
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
        stdout,
        stderr,
      });
    });
  });
}

async function fetchJson(url, options = {}) {
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

async function waitForHealth(baseUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        return true;
      }
    } catch {
      // Retry until timeout
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function terminateChild(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise((resolveWait) => {
    const t = setTimeout(resolveWait, 2500);
    child.once('close', () => {
      clearTimeout(t);
      resolveWait();
    });
  });
}

class McpClient {
  constructor(cwd) {
    this.child = spawn('node', ['scripts/mcp/reblock-mcp-server.mjs'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;

    this.child.stdout.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (true) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const headerText = this.buffer.slice(0, headerEnd).toString('utf8');
        const match = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!match) break;
        const len = Number(match[1]);
        const start = headerEnd + 4;
        const end = start + len;
        if (this.buffer.length < end) break;
        const body = this.buffer.slice(start, end).toString('utf8');
        this.buffer = this.buffer.slice(end);
        const message = JSON.parse(body);
        if (Object.prototype.hasOwnProperty.call(message, 'id') && this.pending.has(message.id)) {
          this.pending.get(message.id)(message);
          this.pending.delete(message.id);
        }
      }
    });
  }

  async request(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.nextId++;
    const payload = frame({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
    this.child.stdin.write(payload);

    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReq(new Error(`MCP request timeout (${method})`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolveReq(message);
      });
    });
  }

  async callTool(name, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const response = await this.request('tools/call', {
      name,
      arguments: args,
    }, timeoutMs);

    if (response.error) {
      throw new Error(`tools/call ${name} failed: ${response.error.message}`);
    }
    return response.result?.structuredContent;
  }

  async close() {
    await terminateChild(this.child);
  }
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function writeReportIfNeeded(reportFile, reportData) {
  if (!reportFile) return;
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(reportData, null, 2), 'utf8');
}

async function main(options) {
  const cwd = process.cwd();
  const baseUrl = String(options.baseUrl).replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  const port = parsed.port || '80';
  const tempRoot = await mkdtemp(join(tmpdir(), 'reblock-mcp-e2e-'));
  const fixtureDir = join(tempRoot, 'fixtures');
  const artifactDir = resolve(options.reportDir);
  const batchOneDir = join(fixtureDir, 'batch-one');
  const batchTwoDir = join(fixtureDir, 'batch-two');

  let serverChild = null;
  let serverStartedByScript = false;
  let serverStdout = '';
  let serverStderr = '';
  const createdEntryIds = [];
  let mcp = null;

  try {
    await mkdir(batchOneDir, { recursive: true });
    await mkdir(join(batchTwoDir, 'nested'), { recursive: true });
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(batchOneDir, 'alpha.txt'), 'alpha-content-v1\n', 'utf8');
    await writeFile(join(batchOneDir, 'alpha-2.txt'), 'alpha-content-v2\n', 'utf8');
    await writeFile(join(batchTwoDir, 'nested', 'beta.bin'), Buffer.from([0x10, 0x20, 0x30, 0x40]));
    await writeFile(join(batchTwoDir, 'gamma.txt'), 'gamma-content-v1\n', 'utf8');

    const healthyBefore = await waitForHealth(baseUrl, 1500);
    if (!healthyBefore) {
      if (!options.skipBuild) {
        const build = await runCommand('npm', ['run', '-s', 'build'], { cwd, timeoutMs: 240_000 });
        if (build.code !== 0) {
          throw new Error(`build failed before e2e: ${build.stderr || build.stdout}`);
        }
      }

      serverChild = spawn('node', ['dist/server.js'], {
        cwd,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: String(port),
          API_AUTH_TOKEN: process.env.API_AUTH_TOKEN || 'test-api-token',
          RETENTION_SCHEDULER_ENABLED: 'false',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      serverStartedByScript = true;

      serverChild.stdout.on('data', (chunk) => {
        serverStdout = appendTail(serverStdout, chunk.toString());
      });
      serverChild.stderr.on('data', (chunk) => {
        serverStderr = appendTail(serverStderr, chunk.toString());
      });
      serverChild.on('close', (code) => {
        if (code !== 0) {
          serverStderr = appendTail(serverStderr, `\n[server-exit-code] ${code}`);
        }
      });

      const healthyAfter = await waitForHealth(baseUrl, SERVER_START_TIMEOUT_MS);
      if (!healthyAfter) {
        throw new Error(
          `server did not become healthy at ${baseUrl}\nstdout_tail:\n${serverStdout}\nstderr_tail:\n${serverStderr}`,
        );
      }
    }

    mcp = new McpClient(cwd);
    const init = await mcp.request('initialize', {}, 5000);
    assertOk(Boolean(init.result?.serverInfo?.name), 'mcp initialize failed');

    const sync = await mcp.callTool('sync_directories_to_entries', {
      directories: [
        { sourceDir: batchOneDir },
        { sourceDir: batchTwoDir },
      ],
      baseUrl,
      createEntryIfMissing: true,
      remotePolicy: 'keep',
      concurrency: 2,
      dryRun: false,
      reportDir: artifactDir,
    }, 90_000);
    assertOk(sync?.ok === true, `sync_directories_to_entries failed: ${JSON.stringify(sync)}`);
    assertOk(sync?.summary?.totalDirectories === 2, `expected totalDirectories=2, got ${sync?.summary?.totalDirectories}`);
    assertOk(sync?.summary?.succeeded === 2, `expected succeeded=2, got ${sync?.summary?.succeeded}`);
    assertOk(Array.isArray(sync?.results) && sync.results.length === 2, 'expected two folder results');

    for (const folder of sync.results) {
      if (folder?.entryId) {
        createdEntryIds.push(folder.entryId);
      }
      const verify = folder.verifySummary || {};
      const duplicateNameCount = verify.duplicateNameCount || 0;
      const missingShaCount = verify.missingShaCount || 0;
      const missingRemoteCount = verify.missingRemoteCount || 0;

      assertOk(
        duplicateNameCount <= options.maxDuplicateNames,
        `duplicateNameCount ${duplicateNameCount} exceeds threshold ${options.maxDuplicateNames}`,
      );
      assertOk(
        missingShaCount <= options.maxMissingSha,
        `missingShaCount ${missingShaCount} exceeds threshold ${options.maxMissingSha}`,
      );
      assertOk(
        missingRemoteCount <= options.maxMissingRemote,
        `missingRemoteCount ${missingRemoteCount} exceeds threshold ${options.maxMissingRemote}`,
      );

      assertOk(Boolean(folder?.reports?.json), 'missing folder JSON report path');
      assertOk(Boolean(folder?.reports?.markdown), 'missing folder Markdown report path');
      const jsonStat = await stat(folder.reports.json).catch(() => null);
      const mdStat = await stat(folder.reports.markdown).catch(() => null);
      assertOk(Boolean(jsonStat?.size && jsonStat.size > 0), `empty or missing JSON report: ${folder.reports.json}`);
      assertOk(Boolean(mdStat?.size && mdStat.size > 0), `empty or missing Markdown report: ${folder.reports.markdown}`);
    }

    const batchReportFile = sync?.artifacts?.batchReportFile;
    assertOk(Boolean(batchReportFile), 'missing batch report file path');
    const batchStat = await stat(batchReportFile).catch(() => null);
    assertOk(Boolean(batchStat?.size && batchStat.size > 0), `empty or missing batch report: ${batchReportFile}`);

    return {
      ok: true,
      baseUrl,
      summary: sync.summary,
      batchReportFile: sync?.artifacts?.batchReportFile || null,
      folderReports: sync.results.map((r) => ({
        entryAlias: r.entryAlias,
        json: r.reports?.json || null,
        markdown: r.reports?.markdown || null,
      })),
      thresholds: {
        maxDuplicateNames: options.maxDuplicateNames,
        maxMissingSha: options.maxMissingSha,
        maxMissingRemote: options.maxMissingRemote,
      },
      serverStartedByScript,
    };
  } finally {
    if (mcp) {
      await mcp.close();
    }

    for (const entryId of createdEntryIds) {
      await fetch(`${baseUrl}/entries/${entryId}`, { method: 'DELETE' }).catch(() => {});
    }

    if (serverStartedByScript && serverChild) {
      await terminateChild(serverChild);
    }

    if (!options.keepFiles) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

const options = parseArgs();

main(options)
  .then(async (result) => {
    await writeReportIfNeeded(options.reportFile, result);
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(async (err) => {
    const result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    await writeReportIfNeeded(options.reportFile, result).catch(() => {});
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  });
