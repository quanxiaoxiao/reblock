#!/usr/bin/env node

import { spawn } from "child_process";

function frame(obj) {
  const body = JSON.stringify(obj);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

class McpClient {
  constructor(command, args, options = {}) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
    this.buffer = Buffer.alloc(0);
    this.responses = [];
    this.pending = new Map();
    this.nextId = 1;

    this.child.stdout.on("data", (chunk) => this.#onData(chunk));
    this.child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const headers = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = headers.match(/Content-Length:\s*(\d+)/i);
      if (!match) break;
      const len = Number(match[1]);
      const start = headerEnd + 4;
      const end = start + len;
      if (this.buffer.length < end) break;
      const body = this.buffer.slice(start, end).toString("utf8");
      this.buffer = this.buffer.slice(end);
      const message = JSON.parse(body);
      this.responses.push(message);
      if (Object.prototype.hasOwnProperty.call(message, "id") && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
    }
  }

  request(method, params = {}, timeoutMs = 5000) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
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

  async callTool(name, args, timeoutMs = 60000) {
    const response = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    return response.result?.structuredContent || response.result?.content?.[0]?.text;
  }

  close() {
    this.child.kill("SIGTERM");
  }
}

async function main() {
  const mcp = new McpClient("node", ["scripts/mcp/reblock-mcp-server.mjs"], { cwd: "/Users/huzhedong/temp/resources" });
  
  try {
    await mcp.request("initialize", {}, 5000);
    console.error("MCP initialized");
    
    const result = await mcp.callTool("sync_directories_to_entries", {
      directories: [{ sourceDir: "/Users/huzhedong/temp/resources/imgs", entryAlias: "auto" }],
      baseUrl: "http://127.0.0.1:4362",
      createEntryIfMissing: true,
      remotePolicy: "keep",
      concurrency: 3,
      dryRun: false,
      reportDir: "/Users/huzhedong/temp/resources/analysis_output"
    }, 300000);
    
    console.log(JSON.stringify(result, null, 2));
  } finally {
    mcp.close();
  }
}

main().catch(console.error);
