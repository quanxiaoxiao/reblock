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
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};

const W = 64;
const DIVIDER     = `${c.dim}${'─'.repeat(W)}${c.reset}`;
const DIVIDER_FAT = `${c.dim}${'━'.repeat(W)}${c.reset}`;

// ─── Step counter ──────────────────────────────────────────────────────────

let _stepTotal = 4;
let _stepCurrent = 0;

function stepLabel() {
  _stepCurrent++;
  return `${c.dim}[${String(_stepCurrent).padStart(2)}/${_stepTotal}]${c.reset}`;
}

// ─── Logging helpers ───────────────────────────────────────────────────────

function logBanner(title, subtitle = '') {
  const line = '═'.repeat(W);
  console.log(`\n${c.cyan}${c.bold}╔${line}╗`);
  const t = `  🔄  ${title}`;
  console.log(`║${t.padEnd(W)}║`);
  if (subtitle) {
    const s = `     ${subtitle}`;
    console.log(`║${c.dim}${s.padEnd(W)}${c.bold}║`);
  }
  console.log(`╚${line}╝${c.reset}\n`);
}

function logStep(icon, title) {
  console.log(`\n${stepLabel()} ${c.blue}${c.bold}${icon}  ${title}${c.reset}`);
}

function logInfo(label, value) {
  const lbl = `${c.gray}${('  ' + label).padEnd(22)}${c.reset}`;
  console.log(`${lbl}${c.white}${value}${c.reset}`);
}

function logOk(message) {
  console.log(`   ${c.green}✔  ${message}${c.reset}`);
}

function logWarn(message) {
  console.log(`   ${c.yellow}⚠  ${message}${c.reset}`);
}

function logError(message) {
  console.log(`\n   ${c.red}${c.bold}✖  ${message}${c.reset}`);
}

function logDetail(message) {
  console.log(`   ${c.gray}   ${message}${c.reset}`);
}

function logSuccessBanner() {
  const line = '═'.repeat(W);
  console.log(`\n${c.green}${c.bold}╔${line}╗`);
  console.log(`║  🎉  Rollback completed successfully!${''.padEnd(W - 40)}║`);
  console.log(`╚${line}╝${c.reset}\n`);
}

function logFailBanner() {
  const line = '═'.repeat(W);
  console.log(`\n${c.red}${c.bold}╔${line}╗`);
  console.log(`║  💥  Rollback failed!${''.padEnd(W - 22)}║`);
  console.log(`╚${line}╝${c.reset}\n`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.stderr || error.message}`);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function question(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Parse arguments ───────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    list: args.includes('--list'),
    cleanup: args.includes('--cleanup'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// ─── Load configuration ────────────────────────────────────────────────────

async function loadConfig() {
  const configPath = join(process.cwd(), 'deploy.config.mjs');
  if (!existsSync(configPath)) {
    logError('deploy.config.mjs not found!');
    console.log(`\n${c.yellow}Please create deploy.config.mjs in project root.${c.reset}`);
    process.exit(1);
  }

  const config = (await import(configPath)).default;
  const {
    host,
    port = 22,
    user,
    privateKey,
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
    host,
    port,
    user,
    privateKey,
    remotePath,
    storagePath,
    storageInternalDir,
    dockerNetwork,
    appPort,
    appPortBind,
    sshBaseCmd,
  };
}

// ─── Get remote versions ───────────────────────────────────────────────────

async function getRemoteVersions(sshBaseCmd, remotePath) {
  try {
    // Get list of version directories
    const result = exec(`${sshBaseCmd} 'ls -1d ${remotePath}/v-* 2>/dev/null || echo ""'`).trim();
    if (!result) return [];

    const versionDirs = result.split('\n').filter(line => line.trim());
    
    // Get current symlink target
    let currentVersion = '';
    try {
      currentVersion = exec(`${sshBaseCmd} 'readlink ${remotePath}/current 2>/dev/null || echo ""'`).trim();
      currentVersion = currentVersion.split('/').pop(); // Get just the version name
    } catch {
      // current symlink might not exist
    }

    // Get details for each version
    const versions = [];
    for (const dir of versionDirs) {
      const versionName = dir.split('/').pop();
      const timestamp = parseInt(versionName.replace('v-', ''));
      
      // Get directory size
      let size = 0;
      try {
        const sizeResult = exec(`${sshBaseCmd} 'du -sb ${dir} 2>/dev/null || echo "0"'`).trim();
        size = parseInt(sizeResult.split('\t')[0]) || 0;
      } catch {
        // Ignore size errors
      }

      versions.push({
        name: versionName,
        timestamp,
        date: formatDate(timestamp),
        size,
        isCurrent: versionName === currentVersion,
        path: dir,
      });
    }

    // Sort by timestamp descending (newest first)
    return versions.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    logError(`Failed to get remote versions: ${error.message}`);
    return [];
  }
}

// ─── List versions ─────────────────────────────────────────────────────────

async function listVersions(versions, currentVersion) {
  console.log(`\n${DIVIDER}`);
  console.log(`   ${c.bold}${c.white}Remote Versions (${versions.length} total)${c.reset}`);
  console.log(DIVIDER);
  
  if (versions.length === 0) {
    logWarn('No versions found on remote server');
    return;
  }

  console.log();
  versions.forEach((v, index) => {
    const marker = v.isCurrent ? `${c.green}← current${c.reset}` : '         ';
    const num = `${c.dim}[${index + 1}]${c.reset}`;
    console.log(`   ${num} ${c.cyan}${v.name}${c.reset}  ${c.gray}${v.date}${c.reset}  ${marker}`);
  });
  
  console.log();
  console.log(DIVIDER);
}

// ─── Select version interactively ──────────────────────────────────────────

async function selectVersion(versions) {
  if (versions.length === 0) {
    logError('No versions available for rollback');
    return null;
  }

  console.log(`\n${DIVIDER}`);
  console.log(`   ${c.bold}${c.white}Select version to rollback${c.reset}`);
  console.log(DIVIDER);
  console.log();

  versions.forEach((v, index) => {
    const marker = v.isCurrent ? `${c.green}← current${c.reset}` : '         ';
    const num = `${c.cyan}[${index + 1}]${c.reset}`;
    console.log(`   ${num} ${v.name}  ${c.gray}${v.date}${c.reset}  ${marker}`);
  });

  console.log();
  const answer = await question(`   Select version [1-${versions.length}, or 'q' to quit]: `);
  
  if (answer.toLowerCase() === 'q') {
    console.log(`\n   ${c.gray}Cancelled by user${c.reset}`);
    return null;
  }

  const index = parseInt(answer) - 1;
  if (isNaN(index) || index < 0 || index >= versions.length) {
    logError('Invalid selection');
    return null;
  }

  const selected = versions[index];
  
  if (selected.isCurrent) {
    logWarn('Selected version is already current');
    const confirm = await question(`   ${c.yellow}Are you sure you want to restart the current version? (yes/no): ${c.reset}`);
    if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
      console.log(`\n   ${c.gray}Cancelled${c.reset}`);
      return null;
    }
  }

  return selected;
}

// ─── Confirm rollback ──────────────────────────────────────────────────────

async function confirmRollback(version) {
  console.log(`\n${DIVIDER}`);
  console.log(`   ${c.bold}${c.white}Rollback Confirmation${c.reset}`);
  console.log(DIVIDER);
  console.log();
  logInfo('Target version', version.name);
  logInfo('Deploy time', version.date);
  logInfo('Size', formatBytes(version.size));
  console.log();
  logWarn('This will stop the current container and switch to the selected version.');
  
  const answer = await question(`\n   ${c.yellow}Continue with rollback? (yes/no): ${c.reset}`);
  return answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
}

// ─── Execute rollback ──────────────────────────────────────────────────────

async function executeRollback(config, version) {
  const { sshBaseCmd, remotePath, storagePath, storageInternalDir, dockerNetwork, appPort, appPortBind } = config;
  
  try {
    // Stop current container
    logStep('🛑', 'Stopping current container');
    exec(`${sshBaseCmd} 'docker stop reblock-app 2>/dev/null && echo "stopped" || echo "not running"'`);
    logOk('Container stopped');

    // Remove old container
    logStep('🗑️', 'Removing old container');
    exec(`${sshBaseCmd} 'docker rm reblock-app 2>/dev/null || true'`);
    logOk('Old container removed');

    // Update symlink
    logStep('🔗', 'Updating symlink');
    const versionDir = `${remotePath}/${version.name}`;
    const currentLink = `${remotePath}/current`;
    exec(`${sshBaseCmd} 'ln -sfn ${versionDir} ${currentLink}'`);
    logOk(`Symlink updated: current → ${version.name}`);

    // Start new container
    logStep('🚀', 'Starting container');
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

    const dockerCmd = dockerArgs.join(' \\\n');
    exec(`${sshBaseCmd} 'cd ${remotePath} && ${dockerCmd}'`);
    logOk('Container started');

    return true;
  } catch (error) {
    logError(`Rollback failed: ${error.message}`);
    return false;
  }
}

// ─── Health check ──────────────────────────────────────────────────────────

async function healthCheck(config) {
  logStep('🏥', 'Running health check');
  
  const { sshBaseCmd, appPort, appPortBind } = config;
  const healthUrl = `http://localhost:${appPortBind ?? appPort}/health`;
  
  // Wait for container to warm up
  await new Promise(r => setTimeout(r, 3000));
  
  const maxRetries = 5;
  const retryDelay = 3000;
  
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const status = exec(`${sshBaseCmd} 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${healthUrl}"'`).trim();
      
      if (status === '200') {
        logOk(`Health check passed (HTTP 200)`);
        return true;
      }
      
      if (i < maxRetries) {
        logDetail(`Health check returned HTTP ${status}, retrying ${i}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, retryDelay));
      } else {
        logError(`Health check failed after ${maxRetries} attempts (last: HTTP ${status})`);
      }
    } catch (error) {
      if (i < maxRetries) {
        logDetail(`Health check error, retrying ${i}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, retryDelay));
      } else {
        logError(`Health check failed: ${error.message}`);
      }
    }
  }
  
  return false;
}

// ─── Cleanup old versions ──────────────────────────────────────────────────

async function cleanupVersions(config, versions) {
  const { sshBaseCmd, remotePath } = config;
  
  // Filter out current version
  const deletableVersions = versions.filter(v => !v.isCurrent);
  
  if (deletableVersions.length === 0) {
    logWarn('No versions available for cleanup (current version cannot be deleted)');
    return;
  }

  console.log(`\n${DIVIDER}`);
  console.log(`   ${c.bold}${c.white}Version Cleanup${c.reset}`);
  console.log(DIVIDER);
  console.log();
  
  // Show current version
  const currentVersion = versions.find(v => v.isCurrent);
  if (currentVersion) {
    logInfo('Current version', `${currentVersion.name} (${currentVersion.date})`);
    console.log();
  }

  // Show deletable versions
  console.log(`   ${c.bold}Versions available for cleanup:${c.reset}\n`);
  deletableVersions.forEach((v, index) => {
    const num = `${c.cyan}[${index + 1}]${c.reset}`;
    console.log(`   ${num} ${v.name}  ${c.gray}${v.date}${c.reset}  ${c.yellow}${formatBytes(v.size)}${c.reset}`);
  });

  console.log();
  const totalSize = deletableVersions.reduce((sum, v) => sum + v.size, 0);
  logInfo('Total deletable size', formatBytes(totalSize));
  console.log();

  const answer = await question(`   ${c.yellow}Select versions to delete (comma-separated, e.g., 1,3,5 or 'all'): ${c.reset}`);
  
  if (answer.toLowerCase() === 'q' || answer.toLowerCase() === 'quit') {
    console.log(`\n   ${c.gray}Cancelled${c.reset}`);
    return;
  }

  let toDelete = [];
  if (answer.toLowerCase() === 'all') {
    toDelete = deletableVersions;
  } else {
    const indices = answer.split(',').map(s => parseInt(s.trim()) - 1).filter(i => !isNaN(i) && i >= 0 && i < deletableVersions.length);
    toDelete = indices.map(i => deletableVersions[i]);
  }

  if (toDelete.length === 0) {
    logWarn('No versions selected for deletion');
    return;
  }

  // Confirm deletion
  const deleteSize = toDelete.reduce((sum, v) => sum + v.size, 0);
  console.log(`\n${DIVIDER}`);
  console.log(`   ${c.bold}${c.white}Deletion Confirmation${c.reset}`);
  console.log(DIVIDER);
  console.log();
  logInfo('Versions to delete', `${toDelete.length}`);
  logInfo('Space to free', formatBytes(deleteSize));
  console.log();
  
  toDelete.forEach(v => {
    console.log(`   ${c.red}✖${c.reset}  ${v.name}  ${c.gray}${v.date}${c.reset}`);
  });
  
  console.log();
  logWarn('This action cannot be undone!');
  
  const confirm = await question(`\n   ${c.red}Type 'delete' to confirm: ${c.reset}`);
  
  if (confirm !== 'delete') {
    console.log(`\n   ${c.gray}Cancelled${c.reset}`);
    return;
  }

  // Execute deletion
  console.log();
  logStep('🗑️', 'Deleting versions');
  
  let deletedCount = 0;
  let freedSpace = 0;
  
  for (const v of toDelete) {
    try {
      exec(`${sshBaseCmd} 'rm -rf ${v.path}'`);
      logOk(`Deleted: ${v.name} (${formatBytes(v.size)})`);
      deletedCount++;
      freedSpace += v.size;
    } catch (error) {
      logError(`Failed to delete ${v.name}: ${error.message}`);
    }
  }

  console.log();
  console.log(DIVIDER);
  logInfo('Deleted', `${deletedCount} version(s)`);
  logInfo('Freed space', formatBytes(freedSpace));
  console.log(DIVIDER);
}

// ─── Main rollback function ────────────────────────────────────────────────

async function rollback() {
  const startTime = Date.now();
  const args = parseArgs();

  if (args.help) {
    console.log(`
${c.cyan}Reblock Rollback Tool${c.reset}

Usage:
  npm run rollback              Interactive rollback
  npm run rollback -- --list    List versions only
  npm run rollback -- --cleanup Cleanup old versions

Options:
  --list      List all remote versions without rolling back
  --cleanup   Interactive cleanup of old versions
  --help      Show this help message
`);
    return;
  }

  logBanner('Reblock Rollback', `Started at ${new Date().toLocaleTimeString()}`);

  // Step 1: Load config
  logStep('📋', 'Loading configuration');
  const config = await loadConfig();
  logOk('Configuration loaded');
  console.log(`\n${DIVIDER_FAT}`);
  logInfo('Host', `${config.host}:${config.port}`);
  logInfo('User', config.user);
  logInfo('Remote path', config.remotePath);
  logInfo('App port', `${config.appPortBind ?? config.appPort}`);
  console.log(`${DIVIDER_FAT}\n`);

  // Step 2: Get versions
  logStep('📊', 'Fetching remote versions');
  const versions = await getRemoteVersions(config.sshBaseCmd, config.remotePath);
  
  if (versions.length === 0) {
    logError('No versions found on remote server');
    process.exit(1);
  }
  
  logOk(`Found ${versions.length} version(s)`);

  // Handle --list mode
  if (args.list) {
    await listVersions(versions);
    return;
  }

  // Handle --cleanup mode
  if (args.cleanup) {
    await cleanupVersions(config, versions);
    return;
  }

  // Step 3: Select version
  const selectedVersion = await selectVersion(versions);
  if (!selectedVersion) {
    process.exit(0);
  }

  // Step 4: Confirm
  const confirmed = await confirmRollback(selectedVersion);
  if (!confirmed) {
    console.log(`\n   ${c.gray}Rollback cancelled${c.reset}`);
    process.exit(0);
  }

  // Step 5: Execute rollback
  const success = await executeRollback(config, selectedVersion);
  if (!success) {
    logFailBanner();
    process.exit(1);
  }

  // Step 6: Health check
  const healthOk = await healthCheck(config);

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n${DIVIDER_FAT}`);
  console.log(`   ${c.bold}${c.white}Rollback Summary${c.reset}`);
  console.log(DIVIDER_FAT);
  logInfo('Duration', `${elapsed}s`);
  logInfo('Rolled to', selectedVersion.name);
  logInfo('Health', healthOk ? `${c.green}✔ OK${c.reset}` : `${c.yellow}⚠ Check failed${c.reset}`);
  console.log(`${DIVIDER_FAT}\n`);

  if (healthOk) {
    logSuccessBanner();
  } else {
    logWarn('Rollback completed but health check failed');
    logDetail('Check container logs: ');
    logDetail(`ssh ${config.user}@${config.host} 'docker logs reblock-app --tail 50'`);
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────

rollback().catch(error => {
  logError(`Unexpected error: ${error.message}`);
  process.exit(1);
});
