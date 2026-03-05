import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, createReadStream } from 'fs';
import { dirname, join, resolve } from 'path';
import { execSync } from 'child_process';

export function loadEnvFile(filePath, { override = false } = {}) {
  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) return;

  const content = readFileSync(absPath, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (override || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const eqIdx = token.indexOf('=');
    if (eqIdx > -1) {
      const k = token.slice(2, eqIdx);
      const v = token.slice(eqIdx + 1);
      args[k] = v;
      continue;
    }

    const k = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[k] = next;
      i += 1;
    } else {
      args[k] = true;
    }
  }
  return args;
}

export function exec(command, options = {}) {
  return execSync(command, {
    encoding: 'utf-8',
    stdio: 'pipe',
    ...options,
  });
}

export function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

export function removePath(path) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

export function nowStamp() {
  const d = new Date();
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const DD = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}-${hh}${mm}${ss}`;
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', rejectPromise);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

export async function buildChecksums(baseDir, relativePaths) {
  const lines = [];
  const map = {};
  for (const relPath of relativePaths) {
    const absPath = join(baseDir, relPath);
    const sum = await sha256File(absPath);
    map[relPath] = sum;
    lines.push(`${sum}  ${relPath}`);
  }
  const output = lines.join('\n') + '\n';
  writeFileSync(join(baseDir, 'checksums.sha256'), output, 'utf-8');
  return map;
}

export function readChecksumsFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/i);
    if (!match) {
      throw new Error(`Invalid checksum line: ${line}`);
    }
    result[match[2]] = match[1].toLowerCase();
  }
  return result;
}

export function verifyRequiredFiles(baseDir, relativePaths) {
  for (const relPath of relativePaths) {
    const absPath = join(baseDir, relPath);
    if (!existsSync(absPath)) {
      throw new Error(`Required file missing: ${relPath}`);
    }
  }
}

export function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env: ${key}`);
  return value;
}

export function createTarGz(sourceDir, outTarGz) {
  ensureDir(dirname(outTarGz));
  exec(`tar -czf ${shellEscape(outTarGz)} -C ${shellEscape(sourceDir)} .`);
}

export function extractTarGz(tarGzPath, targetDir) {
  ensureDir(targetDir);
  exec(`tar -xzf ${shellEscape(tarGzPath)} -C ${shellEscape(targetDir)}`);
}

export function encryptWithOpenSSL(inputPath, outputPath, passphrase) {
  if (!passphrase) throw new Error('Backup passphrase is required for encryption');
  const cmd = `openssl enc -aes-256-cbc -pbkdf2 -salt -in ${shellEscape(inputPath)} -out ${shellEscape(outputPath)} -pass env:BACKUP_PASSPHRASE`;
  exec(cmd, {
    env: {
      ...process.env,
      BACKUP_PASSPHRASE: passphrase,
    },
  });
}

export function decryptWithOpenSSL(inputPath, outputPath, passphrase) {
  if (!passphrase) throw new Error('Backup passphrase is required for decryption');
  const cmd = `openssl enc -d -aes-256-cbc -pbkdf2 -in ${shellEscape(inputPath)} -out ${shellEscape(outputPath)} -pass env:BACKUP_PASSPHRASE`;
  exec(cmd, {
    env: {
      ...process.env,
      BACKUP_PASSPHRASE: passphrase,
    },
  });
}

export function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function composePsContainerId(composeFile, envFile, serviceName) {
  const cmd = `docker compose -f ${shellEscape(composeFile)} --env-file ${shellEscape(envFile)} ps -q ${shellEscape(serviceName)}`;
  return exec(cmd).trim();
}

export function isContainerRunning(containerId) {
  if (!containerId) return false;
  const out = exec(`docker inspect -f '{{.State.Running}}' ${shellEscape(containerId)}`).trim();
  return out === 'true';
}

export function getContainerImage(containerName) {
  try {
    return exec(`docker inspect -f '{{.Config.Image}}' ${shellEscape(containerName)}`).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function directorySizeBytes(dirPath) {
  if (!existsSync(dirPath)) return 0;

  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        total += statSync(abs).size;
      }
    }
  }
  return total;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
