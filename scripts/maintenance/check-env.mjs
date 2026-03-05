#!/usr/bin/env node
/**
 * Environment Configuration Checker & Sync Tool
 *
 * Usage:
 *   node check-env.mjs
 *
 * Compares local deploy.config.mjs env configuration with remote .env file
 * and supports interactive sync from local to remote.
 */

import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import readline from 'node:readline';

// ─── Colors & Formatting ───────────────────────────────────────────────────

const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  gray:    '\x1b[90m',
  white:   '\x1b[37m',
};

const W           = 80;
const DIVIDER     = `${c.dim}${'─'.repeat(W)}${c.reset}`;
const DIVIDER_FAT = `${c.dim}${'━'.repeat(W)}${c.reset}`;

// ─── Logging ───────────────────────────────────────────────────────────────

const log = {
  banner(title, subtitle = '') {
    const line = '═'.repeat(W);
    console.log(`\n${c.cyan}${c.bold}╔${line}╗`);
    console.log(`║  🔍  ${title.padEnd(W - 6)}║`);
    if (subtitle) console.log(`║${c.dim}     ${subtitle.padEnd(W - 5)}${c.bold}║`);
    console.log(`╚${line}╝${c.reset}\n`);
  },

  step(icon, title) {
    console.log(`\n${c.blue}${c.bold}${icon}  ${title}${c.reset}`);
  },

  info(label, value) {
    console.log(`${c.gray}${('  ' + label).padEnd(22)}${c.reset}${c.white}${value}${c.reset}`);
  },

  ok(msg)     { console.log(`   ${c.green}✔  ${msg}${c.reset}`); },
  warn(msg)   { console.log(`   ${c.yellow}⚠  ${msg}${c.reset}`); },
  error(msg)  { console.log(`\n   ${c.red}${c.bold}✖  ${msg}${c.reset}`); },
  detail(msg) { console.log(`   ${c.gray}   ${msg}${c.reset}`); },

  successBanner() {
    const line = '═'.repeat(W);
    console.log(`\n${c.green}${c.bold}╔${line}╗`);
    console.log(`║  ✅  Environment sync completed!${''.padEnd(W - 33)}║`);
    console.log(`╚${line}╝${c.reset}\n`);
  },
};

// ─── Readline (single shared instance per prompt session) ─────────────────

/**
 * Ask a single question on stdin and return the trimmed, lowercased answer.
 * Creates a fresh interface each time to avoid state issues between calls.
 */
function question(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (err) {
    throw new Error(`Command failed: ${cmd}\n${err.stderr || err.message}`, { cause: err });
  }
}

function stripQuotes(value) {
  // Strip matching surrounding quotes: "val" or 'val' → val
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

function parseEnvContent(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_]\w*)\s*=\s*(.*)$/);
    if (match) env[match[1]] = stripQuotes(match[2].trim());
  }
  return env;
}

/** Normalize a config value to string for comparison (JS config may use numbers/booleans) */
function normalizeValue(v) {
  return v == null ? null : String(v);
}

function truncate(str, maxLen) {
  const s = String(str ?? '');
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 3)}...`;
}

// ─── Configuration ─────────────────────────────────────────────────────────

async function loadConfig() {
  const configPath = join(process.cwd(), 'deploy.config.mjs');

  if (!existsSync(configPath)) {
    log.error('deploy.config.mjs not found in project root!');
    process.exit(1);
  }

  const { default: config } = await import(configPath);
  const { host, port = 22, user, privateKey, remotePath, env: envConfig } = config;

  const missing = ['host', 'user', 'privateKey', 'remotePath'].filter((k) => !config[k]);
  if (missing.length) {
    log.error(`deploy.config.mjs is missing required fields: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (!envConfig || typeof envConfig !== 'object') {
    log.error('deploy.config.mjs has no valid "env" configuration!');
    process.exit(1);
  }

  return {
    host,
    port,
    user,
    remotePath,
    envConfig,
    sshBaseCmd: `ssh -p ${port} -i ${privateKey} -o StrictHostKeyChecking=no ${user}@${host}`,
    envPath: `${remotePath}/.env`,
  };
}

// ─── Remote .env ───────────────────────────────────────────────────────────

async function loadRemoteEnv(sshBaseCmd, envPath) {
  try {
    const content = exec(`${sshBaseCmd} 'cat ${envPath}'`).trim();
    return parseEnvContent(content);
  } catch (err) {
    if (err.message.includes('No such file')) return null;
    throw err;
  }
}

// ─── Comparison ────────────────────────────────────────────────────────────

const STATUS_META = {
  missing: { icon: '🟢', color: 'green',  label: 'missing from remote' },
  extra:   { icon: '🟡', color: 'yellow', label: 'only in remote' },
  diff:    { icon: '🔴', color: 'red',    label: 'different values' },
  same:    { icon: '  ', color: 'white',  label: 'identical' },
};

function compareEnvs(localEnv, remoteEnv = {}) {
  const allKeys = Array.from(new Set([...Object.keys(localEnv), ...Object.keys(remoteEnv)])).sort();

  return allKeys.map((key) => {
    const localValue  = normalizeValue(localEnv[key]  ?? null);
    const remoteValue = normalizeValue(remoteEnv[key] ?? null);

    let status;
    if      (localValue  === null)              status = 'extra';
    else if (remoteValue === null)              status = 'missing';
    else if (localValue  !== remoteValue)       status = 'diff';
    else                                        status = 'same';

    return { key, status, localValue, remoteValue, ...STATUS_META[status] };
  });
}

// ─── Display ───────────────────────────────────────────────────────────────

function displayComparison(results, host) {
  const changed = results.filter((r) => r.status !== 'same');
  if (!changed.length) {
    console.log(`\n   ${c.green}${c.bold}✓  Local and remote environments are identical!${c.reset}\n`);
    return false;
  }

  const keyWidth   = Math.max(...results.map((r) => r.key.length), 20) + 2;
  const valueWidth = 28;

  console.log(`\n${DIVIDER_FAT}`);
  console.log(`   ${c.bold}${c.white}Environment Comparison${c.reset}  ${c.gray}(remote: ${host})${c.reset}`);
  console.log(DIVIDER_FAT);
  console.log(`   ${c.bold}${'Variable'.padEnd(keyWidth)} ${'Local (deploy.config)'.padEnd(valueWidth)} ${'Remote (.env)'.padEnd(valueWidth)}${c.reset}`);
  console.log(DIVIDER);

  for (const r of changed) {
    const key    = r.key.padEnd(keyWidth);
    const local  = truncate(r.localValue  ?? '(not set)', valueWidth - 1).padEnd(valueWidth);
    const remote = truncate(r.remoteValue ?? '(not set)', valueWidth - 1).padEnd(valueWidth);
    const lColor = r.localValue  ? c.white : c.gray;
    const rColor = r.remoteValue ? c.white : c.gray;
    console.log(`   ${c[r.color]}${r.icon}${c.reset} ${c.white}${key}${lColor}${local}${rColor}${remote}${c.reset}`);
  }

  console.log(DIVIDER);

  const counts = { missing: 0, extra: 0, diff: 0 };
  for (const r of changed) counts[r.status]++;

  console.log(`\n   ${c.bold}Summary:${c.reset}`);
  if (counts.missing) console.log(`     ${c.green}🟢 ${counts.missing} variable(s) missing from remote (will be added)${c.reset}`);
  if (counts.diff)    console.log(`     ${c.red}🔴 ${counts.diff} variable(s) have different values (will be updated)${c.reset}`);
  if (counts.extra)   console.log(`     ${c.yellow}🟡 ${counts.extra} variable(s) only in remote (will be kept)${c.reset}`);

  return true;
}

// ─── Sync ──────────────────────────────────────────────────────────────────

async function selectVariablesToSync(candidates) {
  log.step('🔄', 'Interactive Synchronization');
  console.log(`   ${c.gray}Review each change before applying...${c.reset}\n`);

  const toSync = [];

  for (const item of candidates) {
    console.log(DIVIDER);

    if (item.status === 'missing') {
      console.log(`   ${c.green}${c.bold}🟢 NEW: ${item.key}${c.reset}`);
      console.log(`   ${c.gray}Local value:${c.reset}  ${c.white}${item.localValue}${c.reset}`);
      console.log(`   ${c.gray}Remote:${c.reset}      ${c.gray}(not set)${c.reset}`);
    } else {
      console.log(`   ${c.red}${c.bold}🔴 DIFFERENT: ${item.key}${c.reset}`);
      console.log(`   ${c.gray}Local value:${c.reset}   ${c.white}${item.localValue}${c.reset}`);
      console.log(`   ${c.gray}Remote value:${c.reset}  ${c.yellow}${item.remoteValue}${c.reset}`);
    }

    const answer = await question(`\n   ${c.cyan}Sync this variable to remote? (yes/no/skip all): ${c.reset}`);

    if (answer === 'yes' || answer === 'y') {
      toSync.push(item);
      log.ok(`Added ${item.key} to sync queue`);
    } else if (answer === 'skip all') {
      log.warn('Skipping remaining variables');
      break;
    } else {
      log.detail(`Skipped ${item.key}`);
    }
    console.log();
  }

  return toSync;
}

async function confirmAndApply(toSync, config) {
  const { sshBaseCmd, envPath, envConfig, user, host } = config;

  console.log(`${DIVIDER_FAT}`);
  console.log(`   ${c.bold}${c.white}Ready to Sync${c.reset}`);
  console.log(DIVIDER_FAT);

  for (const item of toSync) {
    if (item.status === 'missing') {
      console.log(`   ${c.green}ADD${c.reset}    ${item.key}=${c.gray}${truncate(item.localValue, 40)}${c.reset}`);
    } else {
      console.log(`   ${c.red}UPDATE${c.reset} ${item.key}`);
      log.detail(`from: ${item.remoteValue}`);
      log.detail(`to:   ${item.localValue}`);
    }
  }

  const confirm = await question(`\n   ${c.yellow}${c.bold}Apply these changes to remote .env? (yes/no): ${c.reset}`);
  if (confirm !== 'yes' && confirm !== 'y') {
    log.warn('Synchronization cancelled.');
    return;
  }

  log.step('💾', 'Applying changes to remote server');

  // Backup existing .env
  try {
    exec(`${sshBaseCmd} 'test -f ${envPath} && cp ${envPath} ${envPath}.backup.${Date.now()}'`);
    log.ok(`Created backup of ${envPath}`);
  } catch {
    log.detail('No existing .env to backup (ok for first deploy)');
  }

  // Build env file content and write via base64 to avoid shell-quoting pitfalls
  const newEnvContent = Object.entries(envConfig)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  // Encode locally, decode remotely — no heredoc quoting issues
  const b64 = Buffer.from(newEnvContent, 'utf8').toString('base64');
  exec(`${sshBaseCmd} 'echo "${b64}" | base64 -d > ${envPath} && chmod 600 ${envPath}'`);

  log.ok(`Updated ${envPath} on remote server`);
  log.successBanner();

  console.log(`   ${c.bold}Next steps:${c.reset}`);
  console.log(`   1. ${c.gray}Restart the app to apply new environment variables${c.reset}`);
  console.log(`   2. ${c.gray}Quick restart: ssh ${user}@${host} 'docker restart reblock-app'${c.reset}`);
  console.log(`   3. ${c.gray}Full redeploy:  node scripts/maintenance/deploy.mjs${c.reset}\n`);
}

async function performSync(results, config) {
  const candidates = results.filter((r) => r.status === 'missing' || r.status === 'diff');

  if (!candidates.length) {
    log.warn('No variables need synchronization.');
    return;
  }

  const toSync = await selectVariablesToSync(candidates);

  if (!toSync.length) {
    log.warn('No variables selected for synchronization.');
    return;
  }

  await confirmAndApply(toSync, config);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  log.banner('Environment Configuration Checker', 'Compare local config with remote .env');

  log.step('📋', 'Loading configuration');
  const config = await loadConfig();
  log.ok('Configuration loaded');
  log.info('Host', `${config.host}:${config.port}`);
  log.info('User', config.user);
  log.info('Remote path', config.remotePath);

  log.step('🌐', 'Loading remote .env file');
  let remoteEnv;
  try {
    remoteEnv = await loadRemoteEnv(config.sshBaseCmd, config.envPath);
    if (remoteEnv === null) {
      log.warn('No .env file found on remote server (fresh deployment?)');
      remoteEnv = {};
    } else {
      log.ok(`Loaded ${Object.keys(remoteEnv).length} variable(s) from remote .env`);
    }
  } catch (err) {
    log.error(`Failed to load remote .env: ${err.message}`);
    process.exit(1);
  }

  log.step('🔍', 'Comparing configurations');
  const results = compareEnvs(config.envConfig, remoteEnv);
  const hasDifferences = displayComparison(results, config.host);

  if (!hasDifferences) {
    console.log(`   ${c.green}${c.bold}No action needed. Exiting.${c.reset}\n`);
    process.exit(0);
  }

  const wantsSync = await question(`\n   ${c.cyan}Do you want to synchronize variables to remote? (yes/no): ${c.reset}`);
  if (wantsSync !== 'yes' && wantsSync !== 'y') {
    console.log(`\n   ${c.gray}Skipped synchronization. Exiting.${c.reset}\n`);
    process.exit(0);
  }

  await performSync(results, config);
}

main().catch((err) => {
  log.error(`Unexpected error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
