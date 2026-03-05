#!/usr/bin/env node
/**
 * Rollback script for Reblock
 *
 * Usage:
 *   node rollback.mjs                    # Interactive rollback
 *   node rollback.mjs --list             # List versions only
 *   node rollback.mjs --cleanup          # Cleanup old versions
 *
 * Requirements:
 *   - deploy.config.mjs must exist in project root
 *   - SSH key authentication must be configured on server
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import readline from 'readline';

// ─── Terminal Detection ────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY;
const supportsColor = isTTY && process.env.TERM !== 'dumb';

// ─── Colors & Formatting ───────────────────────────────────────────────────

const c = supportsColor ? {
  reset:     '\x1b[0m',
  bold:      '\x1b[1m',
  dim:       '\x1b[2m',
  italic:    '\x1b[3m',
  underline: '\x1b[4m',
  green:     '\x1b[38;2;80;200;120m',
  greenBg:   '\x1b[48;2;20;60;30m',
  yellow:    '\x1b[38;2;255;200;60m',
  yellowBg:  '\x1b[48;2;60;45;0m',
  red:       '\x1b[38;2;255;90;90m',
  redBg:     '\x1b[48;2;60;15;15m',
  blue:      '\x1b[38;2;100;160;255m',
  cyan:      '\x1b[38;2;80;220;200m',
  magenta:   '\x1b[38;2;200;120;255m',
  orange:    '\x1b[38;2;255;160;60m',
  white:     '\x1b[38;2;230;230;240m',
  gray:      '\x1b[38;2;120;120;140m',
  darkGray:  '\x1b[38;2;60;60;75m',
} : Object.fromEntries([
  'reset','bold','dim','italic','underline',
  'green','greenBg','yellow','yellowBg','red','redBg',
  'blue','cyan','magenta','orange','white','gray','darkGray',
].map(k => [k, '']));

// ─── Box Drawing Characters ────────────────────────────────────────────────

const box = {
  tl: '╭', tr: '╮', bl: '╰', br: '╯',
  h: '─', v: '│', cross: '┼',
  ltee: '├', rtee: '┤', ttee: '┬', btee: '┴',
  dh: '═', dv: '║',
  dtl: '╔', dtr: '╗', dbl: '╚', dbr: '╝',
  dltee: '╠', drtee: '╣',
};

const W = 62;

// ─── Spinner ───────────────────────────────────────────────────────────────

class Spinner {
  constructor(text) {
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.text = text;
    this.i = 0;
    this.timer = null;
    this.active = false;
  }

  start() {
    if (!isTTY) return this;
    this.active = true;
    process.stdout.write('\x1b[?25l'); // hide cursor
    this.timer = setInterval(() => {
      const frame = `\r  ${c.cyan}${this.frames[this.i % this.frames.length]}${c.reset}  ${c.dim}${this.text}${c.reset}  `;
      process.stdout.write(frame);
      this.i++;
    }, 80);
    return this;
  }

  stop(icon = '', message = '') {
    if (!this.active) return;
    clearInterval(this.timer);
    this.active = false;
    process.stdout.write('\r\x1b[2K'); // clear line
    process.stdout.write('\x1b[?25h'); // show cursor
    if (message) console.log(`  ${icon}  ${message}`);
  }

  succeed(msg) { this.stop(`${c.green}✔${c.reset}`, `${c.white}${msg}${c.reset}`); }
  fail(msg)    { this.stop(`${c.red}✖${c.reset}`,   `${c.red}${msg}${c.reset}`); }
  warn(msg)    { this.stop(`${c.yellow}⚠${c.reset}`, `${c.yellow}${msg}${c.reset}`); }
}

// ─── Step tracker ──────────────────────────────────────────────────────────

const steps = { total: 4, current: 0 };

function nextStep(icon, title) {
  steps.current++;
  const badge = `${c.darkGray}${box.tl}${box.h}${c.reset}${c.dim} Step ${steps.current}/${steps.total} ${c.reset}${c.darkGray}${box.h}${c.reset}`;
  console.log(`\n${badge}`);
  console.log(`${c.darkGray}${box.v}${c.reset} ${icon}  ${c.bold}${c.white}${title}${c.reset}`);
  console.log(`${c.darkGray}${box.bl}${'─'.repeat(W - 2)}${c.reset}`);
}

// ─── Print helpers ─────────────────────────────────────────────────────────

function print(...args)   { console.log(...args); }
function printLn()        { console.log(); }

function printDivider(style = 'thin') {
  const ch = style === 'fat' ? '━' : style === 'dotted' ? '┄' : '─';
  print(`${c.darkGray}${'  '}${ch.repeat(W)}${c.reset}`);
}

function printKV(label, value, { labelColor = c.gray, valueColor = c.white } = {}) {
  const lbl = `${labelColor}${('  ' + label).padEnd(24)}${c.reset}`;
  print(`${lbl}${valueColor}${value}${c.reset}`);
}

function printOk(message) {
  print(`  ${c.green}✔${c.reset}  ${c.white}${message}${c.reset}`);
}

function printWarn(message) {
  print(`  ${c.yellow}⚠${c.reset}  ${c.yellow}${message}${c.reset}`);
}

function printError(message) {
  print(`\n  ${c.red}${c.bold}✖${c.reset}  ${c.red}${message}${c.reset}`);
}

function printDetail(message) {
  print(`     ${c.dim}${c.gray}${message}${c.reset}`);
}

function printTag(text, color) {
  return `${color}${c.bold} ${text} ${c.reset}`;
}

// ─── Banners ───────────────────────────────────────────────────────────────

function printMainBanner(subtitle = '') {
  const inner = W + 2;
  printLn();
  print(`  ${c.cyan}${box.dtl}${box.dh.repeat(inner)}${box.dtr}${c.reset}`);
  print(`  ${c.cyan}${box.dv}${c.reset}${' '.repeat(inner)}${c.cyan}${box.dv}${c.reset}`);

  const titleText = '🔄  Reblock Rollback';
  // eslint-disable-next-line no-control-regex
  const titlePad  = inner - titleText.replace(/\x1b\[[^m]*m/g,'').replace(/[^\x00-\x7F]/g, '  ').length - 4;
  print(`  ${c.cyan}${box.dv}${c.reset}  ${c.bold}${c.white}${titleText}${c.reset}${' '.repeat(titlePad)}  ${c.cyan}${box.dv}${c.reset}`);

  if (subtitle) {
    const subPad = inner - subtitle.length - 4;
    print(`  ${c.cyan}${box.dv}${c.reset}  ${c.dim}${c.gray}${subtitle}${c.reset}${' '.repeat(Math.max(0, subPad))}  ${c.cyan}${box.dv}${c.reset}`);
  }

  print(`  ${c.cyan}${box.dv}${c.reset}${' '.repeat(inner)}${c.cyan}${box.dv}${c.reset}`);
  print(`  ${c.cyan}${box.dbl}${box.dh.repeat(inner)}${box.dbr}${c.reset}`);
  printLn();
}

function printSuccessBanner(rolledTo, elapsed) {
  const inner = W + 2;
  printLn();
  print(`  ${c.green}${box.dtl}${box.dh.repeat(inner)}${box.dtr}${c.reset}`);
  print(`  ${c.green}${box.dv}${c.reset}${' '.repeat(inner)}${c.green}${box.dv}${c.reset}`);
  print(`  ${c.green}${box.dv}${c.reset}  ${c.bold}${c.green}🎉  Rollback completed successfully!${c.reset}${' '.repeat(inner - 38)}  ${c.green}${box.dv}${c.reset}`);
  print(`  ${c.green}${box.dv}${c.reset}  ${c.dim}${c.gray}Rolled to ${rolledTo} in ${elapsed}s${c.reset}${' '.repeat(Math.max(0, inner - 22 - rolledTo.length - elapsed.toString().length))}  ${c.green}${box.dv}${c.reset}`);
  print(`  ${c.green}${box.dv}${c.reset}${' '.repeat(inner)}${c.green}${box.dv}${c.reset}`);
  print(`  ${c.green}${box.dbl}${box.dh.repeat(inner)}${box.dbr}${c.reset}`);
  printLn();
}

function printFailBanner() {
  const inner = W + 2;
  printLn();
  print(`  ${c.red}${box.dtl}${box.dh.repeat(inner)}${box.dtr}${c.reset}`);
  print(`  ${c.red}${box.dv}${c.reset}  ${c.bold}${c.red}💥  Rollback failed!${c.reset}${' '.repeat(inner - 22)}  ${c.red}${box.dv}${c.reset}`);
  print(`  ${c.red}${box.dbl}${box.dh.repeat(inner)}${box.dbr}${c.reset}`);
  printLn();
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.stderr || error.message}`, { cause: error });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024)            return `${bytes} B`;
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)       return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 1)    return `${c.green}just now${c.reset}`;
  if (mins < 60)   return `${c.cyan}${mins}m ago${c.reset}`;
  if (hours < 24)  return `${c.blue}${hours}h ago${c.reset}`;
  if (days < 7)    return `${c.yellow}${days}d ago${c.reset}`;
  return `${c.gray}${days}d ago${c.reset}`;
}

function question(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Parse arguments ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    list:    args.includes('--list'),
    cleanup: args.includes('--cleanup'),
    help:    args.includes('--help') || args.includes('-h'),
  };
}

// ─── Load configuration ────────────────────────────────────────────────────

async function loadConfig() {
  const configPath = join(process.cwd(), 'deploy.config.mjs');
  if (!existsSync(configPath)) {
    printError('deploy.config.mjs not found!');
    print(`\n  ${c.yellow}Please create deploy.config.mjs in project root.${c.reset}`);
    process.exit(1);
  }

  const config = (await import(configPath)).default;
  const {
    host, port = 22, user, privateKey,
    remotePath,
    storagePath = `${remotePath}/storage`,
    dockerNetwork,
    env: envConfig,
    appPortBind,
  } = config;

  const appPort = envConfig?.PORT || 3000;
  const storageInternalDir = envConfig?.STORAGE_INTERNAL_DIR || '/app/storage';
  const sshBaseCmd = `ssh -p ${port} -i ${privateKey} -o StrictHostKeyChecking=no ${user}@${host}`;

  return {
    host, port, user, privateKey,
    remotePath, storagePath, storageInternalDir,
    dockerNetwork, appPort, appPortBind, sshBaseCmd,
  };
}

// ─── Get remote versions ───────────────────────────────────────────────────

async function getRemoteVersions(sshBaseCmd, remotePath) {
  try {
    const result = exec(`${sshBaseCmd} 'ls -1d ${remotePath}/v-* 2>/dev/null || echo ""'`).trim();
    if (!result) return [];

    const versionDirs = result.split('\n').filter(l => l.trim());

    let currentVersion = '';
    try {
      currentVersion = exec(`${sshBaseCmd} 'readlink ${remotePath}/current 2>/dev/null || echo ""'`).trim().split('/').pop();
    } catch { /* symlink may not exist */ }

    const versions = [];
    for (const dir of versionDirs) {
      const versionName = dir.split('/').pop();
      const timestamp   = parseInt(versionName.replace('v-', ''));
      let size = 0;
      try {
        const s = exec(`${sshBaseCmd} 'du -sb ${dir} 2>/dev/null || echo "0"'`).trim();
        size = parseInt(s.split('\t')[0]) || 0;
      } catch { /* ignore */ }

      versions.push({
        name: versionName,
        timestamp,
        date: formatDate(timestamp),
        size,
        isCurrent: versionName === currentVersion,
        path: dir,
      });
    }

    return versions.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    printError(`Failed to get remote versions: ${error.message}`);
    return [];
  }
}

// ─── Render version table ──────────────────────────────────────────────────

function renderVersionTable(versions, { selectable = false } = {}) {
  const colW = { idx: 5, name: 18, date: 22, age: 14, size: 10, status: 12 };

  // Header
  const headerRow = [
    selectable ? `${c.gray}  #  ${c.reset}` : '',
    `${c.gray}${'Version'.padEnd(colW.name)}${c.reset}`,
    `${c.gray}${'Deploy Time'.padEnd(colW.date)}${c.reset}`,
    `${c.gray}${'Age'.padEnd(colW.age)}${c.reset}`,
    `${c.gray}${'Size'.padEnd(colW.size)}${c.reset}`,
    `${c.gray}Status${c.reset}`,
  ].join('  ');

  printLn();
  print(`  ${headerRow}`);
  printDivider('dotted');

  versions.forEach((v, i) => {
    const num    = selectable ? `${c.cyan}${String(i + 1).padStart(2)}.${c.reset}  ` : '  ';
    const name   = `${c.white}${v.name.padEnd(colW.name)}${c.reset}`;
    const date   = `${c.dim}${v.date.padEnd(colW.date)}${c.reset}`;
    const age    = (formatRelativeTime(v.timestamp) + ' '.repeat(20)).slice(0, colW.age + 15);
    const size   = `${c.orange}${formatBytes(v.size).padEnd(colW.size)}${c.reset}`;
    const status = v.isCurrent
      ? `${c.greenBg}${c.green}${c.bold} ● CURRENT ${c.reset}`
      : `${c.darkGray}  ○ old    ${c.reset}`;

    print(`  ${num}${name}  ${date}  ${age}  ${size}  ${status}`);
  });

  printLn();
}

// ─── List versions ─────────────────────────────────────────────────────────

async function listVersions(versions) {
  printLn();
  print(`  ${c.bold}${c.white}Remote Versions${c.reset}  ${c.dim}(${versions.length} total)${c.reset}`);
  printDivider('fat');

  if (versions.length === 0) {
    printWarn('No versions found on remote server');
    return;
  }

  renderVersionTable(versions);
  printDivider();
}

// ─── Select version interactively ──────────────────────────────────────────

async function selectVersion(versions) {
  if (versions.length === 0) {
    printError('No versions available for rollback');
    return null;
  }

  printLn();
  print(`  ${c.bold}${c.white}Select Version to Rollback${c.reset}`);
  printDivider('fat');

  renderVersionTable(versions, { selectable: true });
  printDivider();
  printLn();

  const answer = await question(`  ${c.cyan}❯${c.reset}  Enter version number ${c.dim}[1–${versions.length}]${c.reset}  or  ${c.dim}[q]${c.reset} to quit: `);

  if (answer.toLowerCase() === 'q') {
    print(`\n  ${c.gray}Cancelled by user.${c.reset}`);
    return null;
  }

  const index = parseInt(answer) - 1;
  if (isNaN(index) || index < 0 || index >= versions.length) {
    printError(`Invalid selection: "${answer}"`);
    return null;
  }

  const selected = versions[index];

  if (selected.isCurrent) {
    printLn();
    printWarn('Selected version is already current.');
    const confirm = await question(`  ${c.yellow}❯${c.reset}  Restart the current version? ${c.dim}(yes/no)${c.reset}: `);
    if (!['yes', 'y'].includes(confirm.toLowerCase())) {
      print(`\n  ${c.gray}Cancelled.${c.reset}`);
      return null;
    }
  }

  return selected;
}

// ─── Confirm rollback ──────────────────────────────────────────────────────

async function confirmRollback(version) {
  const inner = W - 4;
  printLn();
  print(`  ${c.yellow}${box.tl}${'─'.repeat(inner)}${box.tr}${c.reset}`);
  print(`  ${c.yellow}${box.v}${c.reset}  ${c.bold}${c.white}Rollback Confirmation${c.reset}${' '.repeat(inner - 22)}${c.yellow}${box.v}${c.reset}`);
  print(`  ${c.yellow}${box.ltee}${'─'.repeat(inner)}${box.rtee}${c.reset}`);
  print(`  ${c.yellow}${box.v}${c.reset}`);
  printKV('Target version', version.name, { labelColor: `  ${c.gray}`, valueColor: `${c.cyan}${c.bold}` });
  printKV('Deploy time',    version.date, { labelColor: `  ${c.gray}` });
  printKV('Size',           formatBytes(version.size), { labelColor: `  ${c.gray}`, valueColor: c.orange });
  printKV('Age',            formatRelativeTime(version.timestamp) + ' '.repeat(0), { labelColor: `  ${c.gray}` });
  print(`  ${c.yellow}${box.v}${c.reset}`);
  print(`  ${c.yellow}${box.ltee}${'─'.repeat(inner)}${box.rtee}${c.reset}`);
  print(`  ${c.yellow}${box.v}${c.reset}  ${c.yellow}⚠${c.reset}  ${c.dim}This will stop the current container and switch versions.${c.reset}  ${c.yellow}${box.v}${c.reset}`);
  print(`  ${c.yellow}${box.bl}${'─'.repeat(inner)}${box.br}${c.reset}`);
  printLn();

  const answer = await question(`  ${c.yellow}❯${c.reset}  Continue with rollback? ${c.dim}(yes/no)${c.reset}: `);
  return ['yes', 'y'].includes(answer.toLowerCase());
}

// ─── Execute rollback ──────────────────────────────────────────────────────

async function executeRollback(config, version) {
  const { sshBaseCmd, remotePath, storagePath, storageInternalDir, dockerNetwork, appPort, appPortBind } = config;

  try {
    let spinner = new Spinner('Stopping current container…').start();
    exec(`${sshBaseCmd} 'docker stop reblock-app 2>/dev/null && echo "stopped" || echo "not running"'`);
    spinner.succeed('Container stopped');

    spinner = new Spinner('Removing old container…').start();
    exec(`${sshBaseCmd} 'docker rm reblock-app 2>/dev/null || true'`);
    spinner.succeed('Old container removed');

    spinner = new Spinner(`Updating symlink → ${version.name}…`).start();
    const versionDir  = `${remotePath}/${version.name}`;
    const currentLink = `${remotePath}/current`;
    exec(`${sshBaseCmd} 'ln -sfn ${versionDir} ${currentLink}'`);
    spinner.succeed(`Symlink updated: current → ${c.cyan}${version.name}${c.reset}`);

    spinner = new Spinner('Starting new container…').start();
    const dockerArgs = [
      'docker run -d',
      '  --name reblock-app',
      '  --restart unless-stopped',
      '  --env-file .env',
      `  -p ${appPortBind ?? appPort}:${appPort}`,
    ];
    if (dockerNetwork) dockerArgs.push(`  --network ${dockerNetwork}`);
    dockerArgs.push(
      `  -v ${currentLink}:/app`,
      `  -v ${storagePath}:${storageInternalDir}`,
      '  -v /usr/share/zoneinfo/Asia/Shanghai:/etc/localtime:ro',
      '  -w /app',
      '  node:24-alpine',
      '  node dist/server.js',
    );
    exec(`${sshBaseCmd} 'cd ${remotePath} && ${dockerArgs.join(' \\\n')}'`);
    spinner.succeed('Container started');

    return true;
  } catch (error) {
    printError(`Rollback failed: ${error.message}`);
    return false;
  }
}

// ─── Health check ──────────────────────────────────────────────────────────

async function healthCheck(config) {
  const { sshBaseCmd, appPort, appPortBind } = config;
  const healthUrl = `http://localhost:${appPortBind ?? appPort}/health`;
  const maxRetries = 5;
  const retryDelay = 3000;

  // Warm-up pause
  const warmupSpinner = new Spinner('Waiting for container to warm up…').start();
  await new Promise(r => setTimeout(r, 3000));
  warmupSpinner.stop();

  for (let i = 1; i <= maxRetries; i++) {
    const attempt = i < maxRetries
      ? new Spinner(`Health check attempt ${i}/${maxRetries}…`).start()
      : new Spinner(`Final health check attempt…`).start();

    try {
      const status = exec(
        `${sshBaseCmd} 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${healthUrl}"'`
      ).trim();

      if (status === '200') {
        attempt.succeed(`Health check passed ${printTag('HTTP 200', c.green)}`);
        return true;
      }

      if (i < maxRetries) {
        attempt.warn(`HTTP ${status} — retrying in ${retryDelay / 1000}s…`);
        await new Promise(r => setTimeout(r, retryDelay));
      } else {
        attempt.fail(`Health check failed after ${maxRetries} attempts (last: HTTP ${status})`);
      }
    } catch (error) {
      if (i < maxRetries) {
        attempt.warn(`Connection error — retrying in ${retryDelay / 1000}s…`);
        await new Promise(r => setTimeout(r, retryDelay));
      } else {
        attempt.fail(`Health check failed: ${error.message}`);
      }
    }
  }

  return false;
}

// ─── Cleanup old versions ──────────────────────────────────────────────────

async function cleanupVersions(config, versions) {
  const { sshBaseCmd } = config;
  const deletableVersions = versions.filter(v => !v.isCurrent);
  const currentVersion    = versions.find(v => v.isCurrent);

  printLn();
  print(`  ${c.bold}${c.white}Version Cleanup${c.reset}`);
  printDivider('fat');

  if (currentVersion) {
    printLn();
    printKV('Current', `${c.cyan}${currentVersion.name}${c.reset}  ${c.dim}${currentVersion.date}${c.reset}`);
  }

  if (deletableVersions.length === 0) {
    printLn();
    printWarn('No versions available for cleanup (current version is protected).');
    return;
  }

  renderVersionTable(deletableVersions, { selectable: true });
  printDivider();

  const totalSize = deletableVersions.reduce((sum, v) => sum + v.size, 0);
  printLn();
  printKV('Total reclaimable', `${c.orange}${formatBytes(totalSize)}${c.reset}`);
  printLn();

  const answer = await question(
    `  ${c.cyan}❯${c.reset}  Select versions to delete ${c.dim}(e.g. 1,3,5 / all / q)${c.reset}: `
  );

  if (['q', 'quit'].includes(answer.toLowerCase())) {
    print(`\n  ${c.gray}Cancelled.${c.reset}`);
    return;
  }

  let toDelete;
  if (answer.toLowerCase() === 'all') {
    toDelete = deletableVersions;
  } else {
    const indices = answer
      .split(',')
      .map(s => parseInt(s.trim()) - 1)
      .filter(i => !isNaN(i) && i >= 0 && i < deletableVersions.length);
    toDelete = indices.map(i => deletableVersions[i]);
  }

  if (toDelete.length === 0) {
    printWarn('No valid versions selected.');
    return;
  }

  // Confirm deletion ────────────────────────────────────
  const deleteSize = toDelete.reduce((sum, v) => sum + v.size, 0);
  const inner = W - 4;
  printLn();
  print(`  ${c.red}${box.tl}${'─'.repeat(inner)}${box.tr}${c.reset}`);
  print(`  ${c.red}${box.v}${c.reset}  ${c.bold}${c.white}Deletion Confirmation${c.reset}${' '.repeat(inner - 22)}${c.red}${box.v}${c.reset}`);
  print(`  ${c.red}${box.ltee}${'─'.repeat(inner)}${box.rtee}${c.reset}`);
  print(`  ${c.red}${box.v}${c.reset}`);
  printKV('Versions selected', `${toDelete.length}`, { labelColor: `  ${c.gray}` });
  printKV('Space to free',     formatBytes(deleteSize), { labelColor: `  ${c.gray}`, valueColor: c.orange });
  print(`  ${c.red}${box.v}${c.reset}`);

  for (const v of toDelete) {
    print(`  ${c.red}${box.v}${c.reset}  ${c.red}✖${c.reset}  ${c.white}${v.name}${c.reset}  ${c.dim}${v.date}${c.reset}`);
  }

  print(`  ${c.red}${box.v}${c.reset}`);
  print(`  ${c.red}${box.ltee}${'─'.repeat(inner)}${box.rtee}${c.reset}`);
  print(`  ${c.red}${box.v}${c.reset}  ${c.red}⚠${c.reset}  ${c.bold}${c.red}This action cannot be undone!${c.reset}${' '.repeat(inner - 33)}${c.red}${box.v}${c.reset}`);
  print(`  ${c.red}${box.bl}${'─'.repeat(inner)}${box.br}${c.reset}`);
  printLn();

  const confirm = await question(`  ${c.red}❯${c.reset}  Type ${c.bold}${c.red}delete${c.reset} to confirm: `);
  if (confirm !== 'delete') {
    print(`\n  ${c.gray}Cancelled.${c.reset}`);
    return;
  }

  // Execute deletion ────────────────────────────────────
  printLn();
  let deletedCount = 0;
  let freedSpace   = 0;

  for (const v of toDelete) {
    const spinner = new Spinner(`Deleting ${v.name}…`).start();
    try {
      exec(`${sshBaseCmd} 'rm -rf ${v.path}'`);
      spinner.succeed(`Deleted ${c.cyan}${v.name}${c.reset}  ${c.dim}(${formatBytes(v.size)} freed)${c.reset}`);
      deletedCount++;
      freedSpace += v.size;
    } catch (error) {
      spinner.fail(`Failed to delete ${v.name}: ${error.message}`);
    }
  }

  printLn();
  printDivider('fat');
  printKV('Deleted',     `${deletedCount} version(s)`);
  printKV('Freed space', `${c.orange}${formatBytes(freedSpace)}${c.reset}`);
  printDivider('fat');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function rollback() {
  const startTime = Date.now();
  const args      = parseArgs();

  if (args.help) {
    printLn();
    print(`${c.cyan}${c.bold}Reblock Rollback Tool${c.reset}`);
    printLn();
    print(`${c.bold}Usage:${c.reset}`);
    printDetail(`npm run rollback               ${c.dim}Interactive rollback${c.reset}`);
    printDetail(`npm run rollback -- --list     ${c.dim}List versions only${c.reset}`);
    printDetail(`npm run rollback -- --cleanup  ${c.dim}Cleanup old versions${c.reset}`);
    printLn();
    print(`${c.bold}Options:${c.reset}`);
    printDetail(`${c.cyan}--list    ${c.reset}  ${c.dim}List all remote versions without rolling back${c.reset}`);
    printDetail(`${c.cyan}--cleanup ${c.reset}  ${c.dim}Interactive cleanup of old versions${c.reset}`);
    printDetail(`${c.cyan}--help    ${c.reset}  ${c.dim}Show this help message${c.reset}`);
    printLn();
    return;
  }

  printMainBanner(`Started at ${new Date().toLocaleTimeString()}`);

  // ── Step 1: Load config ──────────────────────────────
  nextStep('📋', 'Loading Configuration');
  const config = await loadConfig();
  printOk('Configuration loaded');
  printLn();
  printDivider('fat');
  printKV('Host',        `${config.host}:${config.port}`);
  printKV('User',        config.user);
  printKV('Remote path', config.remotePath);
  printKV('App port',    `${config.appPortBind ?? config.appPort}`);
  printDivider('fat');

  // ── Step 2: Fetch versions ───────────────────────────
  nextStep('📡', 'Fetching Remote Versions');
  const spinner = new Spinner('Connecting to remote…').start();
  const versions = await getRemoteVersions(config.sshBaseCmd, config.remotePath);

  if (versions.length === 0) {
    spinner.fail('No versions found on remote server');
    process.exit(1);
  }
  spinner.succeed(`Found ${c.cyan}${versions.length}${c.reset} version(s)`);

  // ── List mode ────────────────────────────────────────
  if (args.list) {
    await listVersions(versions);
    return;
  }

  // ── Cleanup mode ─────────────────────────────────────
  if (args.cleanup) {
    await cleanupVersions(config, versions);
    return;
  }

  // ── Step 3: Select version ───────────────────────────
  nextStep('🎯', 'Select Target Version');
  const selectedVersion = await selectVersion(versions);
  if (!selectedVersion) process.exit(0);

  // ── Step 4: Confirm ──────────────────────────────────
  nextStep('⚡', 'Confirm & Execute');
  const confirmed = await confirmRollback(selectedVersion);
  if (!confirmed) {
    print(`\n  ${c.gray}Rollback cancelled.${c.reset}`);
    process.exit(0);
  }

  // ── Execute rollback ─────────────────────────────────
  printLn();
  const success = await executeRollback(config, selectedVersion);
  if (!success) {
    printFailBanner();
    process.exit(1);
  }

  // ── Health check ─────────────────────────────────────
  printLn();
  const healthOk = await healthCheck(config);

  // ── Summary ──────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  printLn();
  printDivider('fat');
  print(`  ${c.bold}${c.white}Summary${c.reset}`);
  printDivider();
  printKV('Duration',    `${elapsed}s`);
  printKV('Rolled to',   `${c.cyan}${selectedVersion.name}${c.reset}`);
  printKV('Health',
    healthOk
      ? `${c.green}✔  Passed${c.reset}`
      : `${c.yellow}⚠  Check failed${c.reset}`
  );
  printDivider('fat');

  if (healthOk) {
    printSuccessBanner(selectedVersion.name, elapsed);
  } else {
    printLn();
    printWarn('Rollback completed but health check failed.');
    printDetail(`Check container logs:`);
    printDetail(`${c.dim}ssh ${config.user}@${config.host} 'docker logs reblock-app --tail 50'${c.reset}`);
    printLn();
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────

rollback().catch(error => {
  printError(`Unexpected error: ${error.message}`);
  process.exit(1);
});

