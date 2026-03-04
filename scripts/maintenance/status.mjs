#!/usr/bin/env node
/**
 * Server Status Monitor for Reblock
 *
 * Usage:
 *   node status.mjs              # Show status once
 *   node status.mjs --watch      # Watch mode (refresh every 5s)
 *   node status.mjs --json       # JSON output
 *
 * Requirements:
 *   - deploy.config.mjs must exist in project root
 *   - SSH key authentication must be configured on server
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

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

// ─── Logging helpers ───────────────────────────────────────────────────────

function logBanner(title, subtitle = '') {
  const line = '═'.repeat(W);
  console.log(`\n${c.cyan}${c.bold}╔${line}╗`);
  const t = `  📊  ${title}`;
  console.log(`║${t.padEnd(W)}║`);
  if (subtitle) {
    const s = `     ${subtitle}`;
    console.log(`║${c.dim}${s.padEnd(W)}${c.bold}║`);
  }
  console.log(`╚${line}╝${c.reset}\n`);
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

function logSection(title) {
  console.log(`\n${DIVIDER}`);
  console.log(`   ${c.bold}${c.white}${title}${c.reset}`);
  console.log(DIVIDER);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch (error) {
    return null;
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    watch: args.includes('--watch'),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// ─── Load configuration ────────────────────────────────────────────────────

async function loadConfig() {
  const configPath = join(process.cwd(), 'deploy.config.mjs');
  if (!existsSync(configPath)) {
    logError('deploy.config.mjs not found!');
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
    appPortBind,
  } = config;

  const appPort = appPortBind || 3000;
  const sshBaseCmd = `ssh -p ${port} -i ${privateKey} -o StrictHostKeyChecking=no ${user}@${host}`;

  return {
    host,
    port,
    user,
    privateKey,
    remotePath,
    storagePath,
    appPort,
    sshBaseCmd,
  };
}

// ─── Collect CPU stats using /proc/stat ────────────────────────────────────

async function collectCpuStats(sshBaseCmd) {
  try {
    // Get first sample
    const sample1 = exec(`${sshBaseCmd} 'cat /proc/stat | grep "^cpu "'`);
    if (!sample1) return { total: 'N/A' };

    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get second sample
    const sample2 = exec(`${sshBaseCmd} 'cat /proc/stat | grep "^cpu "'`);
    if (!sample2) return { total: 'N/A' };

    // Parse samples
    // Format: cpu user nice system idle iowait irq softirq steal guest guest_nice
    const s1 = sample1.trim().split(/\s+/).slice(1).map(Number);
    const s2 = sample2.trim().split(/\s+/).slice(1).map(Number);

    if (s1.length < 10 || s2.length < 10) return { total: 'N/A' };

    // Calculate deltas
    const user = s2[0] - s1[0];
    const nice = s2[1] - s1[1];
    const system = s2[2] - s1[2];
    const idle = s2[3] - s1[3];
    const iowait = s2[4] - s1[4];
    const irq = s2[5] - s1[5];
    const softirq = s2[6] - s1[6];
    const steal = s2[7] - s1[7];

    const totalDelta = user + nice + system + idle + iowait + irq + softirq + steal;
    const idleDelta = idle + iowait;

    if (totalDelta === 0) return { total: '0.0%' };

    return {
      total: ((1 - idleDelta / totalDelta) * 100).toFixed(1) + '%',
      user: ((user / totalDelta) * 100).toFixed(1) + '%',
      system: ((system / totalDelta) * 100).toFixed(1) + '%',
      iowait: ((iowait / totalDelta) * 100).toFixed(1) + '%',
    };
  } catch {
    return { total: 'N/A' };
  }
}

// ─── Collect status data ───────────────────────────────────────────────────

async function collectStatus(config) {
  const { sshBaseCmd, remotePath, storagePath, appPort } = config;
  const status = {
    timestamp: new Date().toISOString(),
    container: {},
    system: {},
    versions: {},
    network: {},
  };

  // Container Status
  try {
    const containerInfo = exec(`${sshBaseCmd} 'docker inspect reblock-app --format="{{json .}}" 2>/dev/null || echo "{}"'`);
    if (containerInfo && containerInfo !== '{}') {
      const info = JSON.parse(containerInfo);
      status.container = {
        exists: true,
        status: info.State?.Status || 'unknown',
        running: info.State?.Running || false,
        startedAt: info.State?.StartedAt || null,
        uptime: info.State?.StartedAt 
          ? formatDuration(Date.now() - new Date(info.State.StartedAt).getTime())
          : 'N/A',
        restartCount: info.RestartCount || 0,
        health: info.State?.Health?.Status || 'unknown',
      };
    } else {
      status.container = { exists: false, status: 'not_found' };
    }
  } catch {
    status.container = { exists: false, status: 'error' };
  }

  // Current Version
  try {
    const currentVersion = exec(`${sshBaseCmd} 'readlink ${remotePath}/current 2>/dev/null || echo ""'`);
    if (currentVersion) {
      const versionName = currentVersion.trim().split('/').pop();
      const timestamp = parseInt(versionName.replace('v-', ''));
      status.container.version = versionName;
      status.container.deployedAt = new Date(timestamp).toLocaleString('zh-CN');
    }
  } catch {
    status.container.version = 'unknown';
  }

  // System Resources
  try {
    // CPU Usage (using /proc/stat for accurate calculation)
    const cpuStats = await collectCpuStats(sshBaseCmd);
    status.system.cpu = cpuStats;

    // Load Average
    const loadAvgInfo = exec(`${sshBaseCmd} 'cat /proc/loadavg'`);
    if (loadAvgInfo) {
      const parts = loadAvgInfo.trim().split(/\s+/);
      status.system.loadavg = {
        '1m': parts[0],
        '5m': parts[1],
        '15m': parts[2],
      };
    }

    // Memory
    const memInfo = exec(`${sshBaseCmd} 'free -m | grep Mem'`);
    if (memInfo) {
      const parts = memInfo.trim().split(/\s+/);
      const total = parseInt(parts[1]);
      const used = parseInt(parts[2]);
      const percent = ((used / total) * 100).toFixed(1);
      status.system.memory = {
        total: `${total} MB`,
        used: `${used} MB`,
        percent: `${percent}%`,
      };
    }

    // Disk - Storage Path
    const storageDiskInfo = exec(`${sshBaseCmd} 'df -h ${storagePath} | tail -1'`);
    if (storageDiskInfo) {
      const parts = storageDiskInfo.trim().split(/\s+/);
      status.system.storageDisk = {
        total: parts[1],
        used: parts[2],
        available: parts[3],
        percent: parts[4],
      };
    }

    // Disk - App Path (remotePath)
    const appDiskInfo = exec(`${sshBaseCmd} 'df -h ${remotePath} | tail -1'`);
    if (appDiskInfo) {
      const parts = appDiskInfo.trim().split(/\s+/);
      status.system.appDisk = {
        total: parts[1],
        used: parts[2],
        available: parts[3],
        percent: parts[4],
      };
    }
  } catch {
    status.system = { cpu: {}, memory: {}, disk: {} };
  }

  // Docker Stats
  try {
    const dockerStats = exec(`${sshBaseCmd} 'docker stats reblock-app --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}" 2>/dev/null || echo ""'`);
    if (dockerStats && dockerStats.trim()) {
      const [cpuPerc, memUsage] = dockerStats.trim().split('|');
      status.docker = {
        reblockApp: {
          cpu: cpuPerc.trim(),
          memory: memUsage.trim(),
        },
      };
    }
  } catch {
    status.docker = { reblockApp: { cpu: 'N/A', memory: 'N/A' } };
  }

  // Versions
  try {
    const versionsResult = exec(`${sshBaseCmd} 'ls -1d ${remotePath}/v-* 2>/dev/null | wc -l'`);
    const totalVersions = parseInt(versionsResult?.trim() || '0');
    
    // Calculate total size of all versions
    let totalSize = 0;
    if (totalVersions > 0) {
      const sizeResult = exec(`${sshBaseCmd} 'du -sb ${remotePath}/v-* 2>/dev/null | awk "{sum+=\$1} END {print sum}"'`);
      totalSize = parseInt(sizeResult?.trim() || '0');
    }

    status.versions = {
      total: totalVersions,
      totalSize: formatBytes(totalSize),
      totalSizeBytes: totalSize,
    };
  } catch {
    status.versions = { total: 0, totalSize: '0 B' };
  }

  // Network & Health
  try {
    const startTime = Date.now();
    const healthResult = exec(`${sshBaseCmd} 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${appPort}/health'`);
    const responseTime = Date.now() - startTime;
    
    status.network = {
      responseTime: `${responseTime}ms`,
      healthStatus: healthResult?.trim() === '200' ? 'ok' : 'error',
      httpCode: healthResult?.trim() || 'N/A',
    };
  } catch {
    status.network = { responseTime: 'N/A', healthStatus: 'error', httpCode: 'N/A' };
  }

  return status;
}

// ─── Display status ────────────────────────────────────────────────────────

function displayStatus(status, config) {
  logBanner('Reblock Server Status', `Last check: ${new Date(status.timestamp).toLocaleString('zh-CN')}`);

  // Container Status
  logSection('Container');
  if (status.container.exists) {
    const statusColor = status.container.running ? c.green : c.red;
    logInfo('Status', `${statusColor}${status.container.status}${c.reset}`);
    logInfo('Running', status.container.running ? `${c.green}Yes${c.reset}` : `${c.red}No${c.reset}`);
    if (status.container.version) {
      logInfo('Version', status.container.version);
    }
    if (status.container.deployedAt) {
      logInfo('Deployed', status.container.deployedAt);
    }
    if (status.container.uptime) {
      logInfo('Uptime', status.container.uptime);
    }
    if (status.container.restartCount > 0) {
      logInfo('Restarts', `${c.yellow}${status.container.restartCount}${c.reset}`);
    }
  } else {
    logInfo('Status', `${c.red}Not found${c.reset}`);
  }

  // System Resources
  logSection('System Resources');
  
  // CPU Usage with breakdown
  if (status.system.cpu?.total) {
    const cpuDetail = status.system.cpu.user 
      ? `(${c.cyan}user: ${status.system.cpu.user}${c.reset}, ${c.magenta}sys: ${status.system.cpu.system}${c.reset}, ${c.yellow}io: ${status.system.cpu.iowait}${c.reset})`
      : '';
    logInfo('CPU Usage', `${status.system.cpu.total} ${cpuDetail}`);
  } else {
    logInfo('CPU Usage', 'N/A');
  }
  
  // Load Average
  if (status.system.loadavg) {
    logInfo('Load Average', `${status.system.loadavg['1m']} / ${status.system.loadavg['5m']} / ${status.system.loadavg['15m']} (1m/5m/15m)`);
  }
  
  if (status.system.memory?.total) {
    logInfo('Memory', `${status.system.memory.used} / ${status.system.memory.total} (${status.system.memory.percent})`);
  }
  if (status.system.storageDisk?.total) {
    const diskPercent = parseInt(status.system.storageDisk.percent);
    const diskColor = diskPercent > 90 ? c.red : diskPercent > 70 ? c.yellow : c.green;
    logInfo('Disk (Storage)', `${status.system.storageDisk.used} / ${status.system.storageDisk.total} (${diskColor}${status.system.storageDisk.percent}${c.reset})`);
  }
  if (status.system.appDisk?.total) {
    const diskPercent = parseInt(status.system.appDisk.percent);
    const diskColor = diskPercent > 90 ? c.red : diskPercent > 70 ? c.yellow : c.green;
    logInfo('Disk (App)', `${status.system.appDisk.used} / ${status.system.appDisk.total} (${diskColor}${status.system.appDisk.percent}${c.reset})`);
  }

  // Docker Stats
  if (status.docker?.reblockApp) {
    logSection('Docker');
    logInfo('reblock-app CPU', status.docker.reblockApp.cpu);
    logInfo('reblock-app Memory', status.docker.reblockApp.memory);
  }

  // Versions
  logSection('Versions');
  logInfo('Total', `${status.versions.total} versions`);
  logInfo('Total Size', status.versions.totalSize);

  // Network
  logSection('Network');
  logInfo('Health Check', status.network.healthStatus === 'ok' 
    ? `${c.green}✔ OK${c.reset} (HTTP ${status.network.httpCode})`
    : `${c.red}✖ Error${c.reset} (HTTP ${status.network.httpCode})`
  );
  logInfo('Response Time', status.network.responseTime);
  logInfo('App URL', `http://${config.host}:${config.appPort}`);

  console.log(`\n${DIVIDER_FAT}\n`);
}

// ─── Display JSON ──────────────────────────────────────────────────────────

function displayJSON(status) {
  console.log(JSON.stringify(status, null, 2));
}

// ─── Watch mode ─────────────────────────────────────────────────────────────

async function watchMode(config) {
  const readline = await import('readline');
  
  console.log(`${c.cyan}Watch mode enabled. Press Ctrl+C to exit.${c.reset}\n`);
  
  const refresh = async () => {
    console.clear();
    const status = await collectStatus(config);
    displayStatus(status, config);
    console.log(`${c.dim}Refreshing every 5 seconds...${c.reset}`);
  };

  await refresh();
  
  const interval = setInterval(refresh, 5000);
  
  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(`\n${c.cyan}Watch mode stopped.${c.reset}`);
    process.exit(0);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
${c.cyan}Reblock Server Status Monitor${c.reset}

Usage:
  npm run status              Show server status
  npm run status -- --watch   Watch mode (refresh every 5s)
  npm run status -- --json    Output as JSON

Options:
  --watch     Continuously refresh status
  --json      Output as JSON instead of formatted text
  --help      Show this help message
`);
    return;
  }

  const config = await loadConfig();
  const status = await collectStatus(config);

  if (args.json) {
    displayJSON(status);
  } else if (args.watch) {
    await watchMode(config);
  } else {
    displayStatus(status, config);
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────

main().catch(error => {
  logError(`Unexpected error: ${error.message}`);
  process.exit(1);
});
