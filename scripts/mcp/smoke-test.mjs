#!/usr/bin/env node

import { spawn } from 'child_process';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

function frame(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

class McpClient {
  constructor(command, args, options = {}) {
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    this.buffer = Buffer.alloc(0);
    this.responses = [];
    this.pending = new Map();
    this.nextId = 1;

    this.child.stdout.on('data', (chunk) => this.#onData(chunk));
    this.child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;
      const headers = this.buffer.slice(0, headerEnd).toString('utf8');
      const match = headers.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const len = Number(match[1]);
      const start = headerEnd + 4;
      const end = start + len;
      if (this.buffer.length < end) break;
      const body = this.buffer.slice(start, end).toString('utf8');
      this.buffer = this.buffer.slice(end);
      const message = JSON.parse(body);
      this.responses.push(message);
      if (Object.prototype.hasOwnProperty.call(message, 'id') && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    }
  }

  request(method, params = {}, timeoutMs = 5000) {
    const id = this.nextId++;
    const payload = { jsonrpc: '2.0', id, method, params };
    const raw = frame(payload);
    this.child.stdin.write(raw);

    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectReq(new Error(`MCP request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolveReq(message);
      });
    });
  }

  close() {
    this.child.kill('SIGTERM');
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    reportFile: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--report-file' && args[i + 1]) {
      options.reportFile = resolve(process.cwd(), args[++i]);
    }
  }

  return options;
}

async function writeReportIfNeeded(reportFile, reportData) {
  if (!reportFile) return;
  await mkdir(dirname(reportFile), { recursive: true });
  await writeFile(reportFile, JSON.stringify(reportData, null, 2), 'utf8');
}

async function main(options) {
  const cwd = process.cwd();
  const manifestFile = resolve(cwd, 'analysis_output/mcp-smoke-manifest.json');
  const client = new McpClient('node', ['scripts/mcp/reblock-mcp-server.mjs'], { cwd });

  try {
    const init = await client.request('initialize', {});
    assert(Boolean(init.result?.serverInfo?.name), 'initialize failed: missing serverInfo.name');

    const listed = await client.request('tools/list', {});
    const names = (listed.result?.tools || []).map((t) => t.name);
    assert(names.includes('run_hurl_suite'), 'tools/list missing run_hurl_suite');
    assert(names.includes('build_local_manifest'), 'tools/list missing build_local_manifest');
    assert(names.includes('verify_upload_sync'), 'tools/list missing verify_upload_sync');
    assert(names.includes('sync_directories_to_entries'), 'tools/list missing sync_directories_to_entries');

    const build = await client.request('tools/call', {
      name: 'build_local_manifest',
      arguments: {
        sourceDir: 'tests/hurl/upload',
        outputFile: 'analysis_output/mcp-smoke-manifest.json',
      },
    }, 20_000);
    const buildData = build.result?.structuredContent;
    assert(buildData?.ok === true, 'build_local_manifest should succeed in smoke test');

    const plan = await client.request('tools/call', {
      name: 'plan_upload_sync',
      arguments: {
        entryAlias: 'smoke-test-alias',
        manifestFile: 'analysis_output/mcp-smoke-manifest.json',
        baseUrl: 'http://127.0.0.1:4362',
      },
    });
    const planData = plan.result?.structuredContent;
    assert(planData?.ok === false, 'plan_upload_sync should fail gracefully when API is unreachable');

    const highLevel = await client.request('tools/call', {
      name: 'sync_directories_to_entries',
      arguments: {
        remotePolicy: 'prune',
        directories: [
          {
            sourceDir: 'tests/hurl/upload',
          },
        ],
      },
    });
    const highLevelData = highLevel.result?.structuredContent;
    assert(highLevelData?.ok === false, 'sync_directories_to_entries should reject remotePolicy=prune');
    assert(highLevelData?.error?.code === 'UNSUPPORTED_REMOTE_POLICY', 'expected explicit UNSUPPORTED_REMOTE_POLICY');

    return {
      ok: true,
      initialize: true,
      toolCount: names.length,
      buildManifestOk: buildData?.ok === true,
      planHandledAsToolError: planData?.ok === false,
      highLevelRejectsPrune: highLevelData?.error?.code === 'UNSUPPORTED_REMOTE_POLICY',
    };
  } finally {
    client.close();
    await unlink(manifestFile).catch(() => {});
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
