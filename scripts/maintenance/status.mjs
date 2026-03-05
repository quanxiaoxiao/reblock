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
  italic:  '\x1b[3m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  bgRed:   '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow:'\x1b[43m',
};

const W = 52;
const DIVIDER = `${c.dim}${'─'.repeat(W)}${c.reset}`;

// ─── Logging helpers ───────────────────────────────────────────────────────

function logBanner(title, host, subtitle = '') {
  console.log(`\n${c.bold}${c.white}${title}${c.reset}  ${c.dim}${host}${c.reset}`);
  if (subtitle) console.log(`${c.dim}${subtitle}${c.reset}`);
  console.log(DIVIDER);
}

function logSection(title) {
  console.log(`\n${c.bold}${title}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(title.replace(/[\u4e00-\u9fa5]/g, 'xx').length)}${c.reset}`);
}

function logInfo(label, value, hint = '') {
  const lbl = `${c.dim}${label.padEnd(16)}${c.reset}`;
  const hintStr = hint ? `  ${c.dim}${hint}${c.reset}` : '';
  console.log(`  ${lbl}${value}${hintStr}`);
}

function logWarn(message) {
  console.log(`  ${c.yellow}! ${message}${c.reset}`);
}

function logError(message) {
  console.log(`\n  ${c.red}✖ ${message}${c.reset}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function exec(command, options = {}) {
  try {
    return execSync(command, { encoding: 'utf-8', stdio: 'pipe', ...options });
  } catch {
    return null;
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);

  if (days > 0)    return `${c.white}${days}${c.reset}${c.dim}d ${c.reset}${c.white}${hours % 24}${c.reset}${c.dim}h ${c.reset}${c.white}${minutes % 60}${c.reset}${c.dim}m${c.reset}`;
  if (hours > 0)   return `${c.white}${hours}${c.reset}${c.dim}h ${c.reset}${c.white}${minutes % 60}${c.reset}${c.dim}m${c.reset}`;
  if (minutes > 0) return `${c.white}${minutes}${c.reset}${c.dim}m ${c.reset}${c.white}${seconds % 60}${c.reset}${c.dim}s${c.reset}`;
  return `${c.white}${seconds}${c.reset}${c.dim}s${c.reset}`;
}

function formatBytes(bytes) {
  if (bytes === 0)               return '0 B';
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function colorByPercent(percent) {
  if (percent >= 90) return c.red;
  if (percent >= 70) return c.yellow;
  return c.green;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    watch: args.includes('--watch'),
    json:  args.includes('--json'),
    help:  args.includes('--help') || args.includes('-h'),
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

  const appPort    = appPortBind || 3000;
  const sshBaseCmd = `ssh -p ${port} -i ${privateKey} -o StrictHostKeyChecking=no ${user}@${host}`;

  return { host, port, user, privateKey, remotePath, storagePath, appPort, sshBaseCmd };
}

// ─── Collect CPU stats using /proc/stat ────────────────────────────────────

async function collectCpuStats(sshBaseCmd) {
  try {
    const sample1 = exec(`${sshBaseCmd} 'cat /proc/stat | grep "^cpu "'`);
    if (!sample1) return { total: 'N/A' };

    await new Promise(resolve => setTimeout(resolve, 1000));

    const sample2 = exec(`${sshBaseCmd} 'cat /proc/stat | grep "^cpu "'`);
    if (!sample2) return { total: 'N/A' };

    // Format: cpu user nice system idle iowait irq softirq steal guest guest_nice
    const s1 = sample1.trim().split(/\s+/).slice(1).map(Number);
    const s2 = sample2.trim().split(/\s+/).slice(1).map(Number);

    if (s1.length < 10 || s2.length < 10) return { total: 'N/A' };

    const user    = s2[0] - s1[0];
    const nice    = s2[1] - s1[1];
    const system  = s2[2] - s1[2];
    const idle    = s2[3] - s1[3];
    const iowait  = s2[4] - s1[4];
    const irq     = s2[5] - s1[5];
    const softirq = s2[6] - s1[6];
    const steal   = s2[7] - s1[7];

    const totalDelta = user + nice + system + idle + iowait + irq + softirq + steal;
    const idleDelta  = idle + iowait;

    if (totalDelta === 0) return { total: '0.0%', percent: 0 };

    const percent = (1 - idleDelta / totalDelta) * 100;
    return {
      percent,
      total:   percent.toFixed(1) + '%',
      user:    ((user   / totalDelta) * 100).toFixed(1) + '%',
      system:  ((system / totalDelta) * 100).toFixed(1) + '%',
      iowait:  ((iowait / totalDelta) * 100).toFixed(1) + '%',
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
    system:    {},
    versions:  {},
    network:   {},
  };

  // ── Container Status ──────────────────────────────────────────────────────
  try {
    const containerInfo = exec(`${sshBaseCmd} 'docker inspect reblock-app --format="{{json .}}" 2>/dev/null || echo "{}"'`);
    if (containerInfo && containerInfo !== '{}') {
      const info = JSON.parse(containerInfo);
      status.container = {
        exists:       true,
        status:       info.State?.Status || 'unknown',
        running:      info.State?.Running || false,
        startedAt:    info.State?.StartedAt || null,
        uptime:       info.State?.StartedAt
          ? formatDuration(Date.now() - new Date(info.State.StartedAt).getTime())
          : 'N/A',
        uptimeMs:     info.State?.StartedAt
          ? Date.now() - new Date(info.State.StartedAt).getTime()
          : 0,
        restartCount: info.RestartCount || 0,
        health:       info.State?.Health?.Status || 'none',
        image:        info.Config?.Image || 'unknown',
      };
    } else {
      status.container = { exists: false, status: 'not_found' };
    }
  } catch {
    status.container = { exists: false, status: 'error' };
  }

  // ── Current Version ───────────────────────────────────────────────────────
  try {
    const currentVersion = exec(`${sshBaseCmd} 'readlink ${remotePath}/current 2>/dev/null || echo ""'`);
    if (currentVersion?.trim()) {
      const versionName = currentVersion.trim().split('/').pop();
      const timestamp   = parseInt(versionName.replace('v-', ''));
      status.container.version    = versionName;
      status.container.deployedAt = new Date(timestamp).toLocaleString('zh-CN');
    }
  } catch {
    status.container.version = 'unknown';
  }

  // ── System Resources ──────────────────────────────────────────────────────
  try {
    // CPU
    const cpuStats = await collectCpuStats(sshBaseCmd);
    status.system.cpu = cpuStats;

    // CPU core count
    const cpuCores = exec(`${sshBaseCmd} 'nproc'`);
    status.system.cpuCores = parseInt(cpuCores?.trim() || '0');

    // Load Average
    const loadAvgInfo = exec(`${sshBaseCmd} 'cat /proc/loadavg'`);
    if (loadAvgInfo) {
      const parts = loadAvgInfo.trim().split(/\s+/);
      status.system.loadavg = { '1m': parts[0], '5m': parts[1], '15m': parts[2] };
    }

    // OS & Kernel info
    const osRelease = exec(`${sshBaseCmd} 'cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d "'`);
    const kernel    = exec(`${sshBaseCmd} 'uname -r'`);
    status.system.os     = osRelease?.trim() || 'unknown';
    status.system.kernel = kernel?.trim() || 'unknown';

    // Uptime
    const uptimeRaw = exec(`${sshBaseCmd} 'cat /proc/uptime'`);
    if (uptimeRaw) {
      const uptimeSeconds = parseFloat(uptimeRaw.trim().split(' ')[0]);
      status.system.uptime = formatDuration(uptimeSeconds * 1000);
    }

    // Memory
    const memInfo = exec(`${sshBaseCmd} 'free -m | grep Mem'`);
    if (memInfo) {
      const parts   = memInfo.trim().split(/\s+/);
      const total   = parseInt(parts[1]);
      const used    = parseInt(parts[2]);
      const free    = parseInt(parts[3]);
      const cached  = parseInt(parts[5]) || 0;
      const percent = (used / total) * 100;
      status.system.memory = {
        total:   `${total} MB`,
        used:    `${used} MB`,
        free:    `${free} MB`,
        cached:  `${cached} MB`,
        percent,
        percentStr: percent.toFixed(1) + '%',
        totalRaw: total,
        usedRaw:  used,
      };
    }

    // Disk - Storage Path
    const storageDiskInfo = exec(`${sshBaseCmd} 'df -h ${storagePath} | tail -1'`);
    if (storageDiskInfo) {
      const parts   = storageDiskInfo.trim().split(/\s+/);
      const percent = parseInt(parts[4]);
      status.system.storageDisk = {
        total: parts[1], used: parts[2], available: parts[3],
        percent, percentStr: parts[4],
      };
    }

    // Disk - App Path
    const appDiskInfo = exec(`${sshBaseCmd} 'df -h ${remotePath} | tail -1'`);
    if (appDiskInfo) {
      const parts   = appDiskInfo.trim().split(/\s+/);
      const percent = parseInt(parts[4]);
      status.system.appDisk = {
        total: parts[1], used: parts[2], available: parts[3],
        percent, percentStr: parts[4],
      };
    }
  } catch {
    status.system = { cpu: {}, memory: {}, disk: {} };
  }

  // ── Docker Stats ──────────────────────────────────────────────────────────
  try {
    const dockerStats = exec(`${sshBaseCmd} 'docker stats reblock-app --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}" 2>/dev/null || echo ""'`);
    if (dockerStats?.trim()) {
      const [cpuPerc, memUsage, netIO, blockIO] = dockerStats.trim().split('|');
      status.docker = {
        reblockApp: {
          cpu:     cpuPerc.trim(),
          memory:  memUsage.trim(),
          netIO:   netIO?.trim() || 'N/A',
          blockIO: blockIO?.trim() || 'N/A',
        },
      };
    }
  } catch {
    status.docker = { reblockApp: { cpu: 'N/A', memory: 'N/A', netIO: 'N/A', blockIO: 'N/A' } };
  }

  // ── Versions ──────────────────────────────────────────────────────────────
  try {
    const versionsResult = exec(`${sshBaseCmd} 'ls -1d ${remotePath}/v-* 2>/dev/null | wc -l'`);
    const totalVersions  = parseInt(versionsResult?.trim() || '0');

    let totalSize = 0;
    if (totalVersions > 0) {
      const sizeResult = exec(`${sshBaseCmd} 'du -sb ${remotePath}/v-* 2>/dev/null | awk "{sum+=\\$1} END {print sum}"'`);
      totalSize = parseInt(sizeResult?.trim() || '0');
    }

    // Latest 3 versions
    const listResult = exec(`${sshBaseCmd} 'ls -1dt ${remotePath}/v-* 2>/dev/null | head -3'`);
    const recentVersions = listResult?.trim().split('\n').filter(Boolean).map(p => p.split('/').pop()) || [];

    status.versions = {
      total:          totalVersions,
      totalSize:      formatBytes(totalSize),
      totalSizeBytes: totalSize,
      recent:         recentVersions,
    };
  } catch {
    status.versions = { total: 0, totalSize: '0 B', recent: [] };
  }

  // ── Network & Health ──────────────────────────────────────────────────────
  try {
    const startTime    = Date.now();
    const healthResult = exec(`${sshBaseCmd} 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${appPort}/health'`);
    const responseTime = Date.now() - startTime;

    status.network = {
      responseTime:    `${responseTime}ms`,
      responseTimeMs:  responseTime,
      healthStatus:    healthResult?.trim() === '200' ? 'ok' : 'error',
      httpCode:        healthResult?.trim() || 'N/A',
    };
  } catch {
    status.network = { responseTime: 'N/A', healthStatus: 'error', httpCode: 'N/A' };
  }

  return status;
}

// ─── Display status ────────────────────────────────────────────────────────

function displayStatus(status, config) {
  const now = new Date(status.timestamp).toLocaleString('zh-CN');
  logBanner('Reblock Server Status', `${config.user}@${config.host}:${config.port}`, now);

  // ── Container ─────────────────────────────────────────────────────────────
  logSection('容器');

  if (status.container.exists) {
    const isRunning  = status.container.running;
    const stateColor = isRunning ? c.green : c.red;
    logInfo('状态',     `${stateColor}${status.container.status}${c.reset}`);
    logInfo('运行时长', isRunning ? status.container.uptime : `${c.dim}—${c.reset}`);
    logInfo('重启次数', status.container.restartCount > 0
      ? `${c.yellow}${status.container.restartCount}${c.reset}`
      : `${c.dim}0${c.reset}`
    );
    if (status.container.health !== 'none') {
      const hc = status.container.health === 'healthy' ? c.green : c.yellow;
      logInfo('健康检查', `${hc}${status.container.health}${c.reset}`);
    }
    if (status.container.image)      logInfo('镜像',     `${c.dim}${status.container.image}${c.reset}`);
    if (status.container.version)    logInfo('当前版本', `${c.cyan}${status.container.version}${c.reset}`);
    if (status.container.deployedAt) logInfo('部署时间', `${c.dim}${status.container.deployedAt}${c.reset}`);
  } else {
    logInfo('状态', `${c.red}not found${c.reset}`);
    logWarn('容器不存在，请检查部署是否正常');
  }

  // ── System ────────────────────────────────────────────────────────────────
  logSection('系统');

  if (status.system.os)     logInfo('系统',       `${c.dim}${status.system.os}${c.reset}`);
  if (status.system.kernel) logInfo('内核',       `${c.dim}${status.system.kernel}${c.reset}`);
  if (status.system.uptime) logInfo('运行时长',   status.system.uptime);

  // CPU
  if (status.system.cpu?.percent !== undefined) {
    const color = colorByPercent(status.system.cpu.percent);
    const cores = status.system.cpuCores ? `${c.dim}/ ${status.system.cpuCores} 核${c.reset}` : '';
    logInfo('CPU', `${color}${status.system.cpu.total}${c.reset}  ${cores}`);
    if (status.system.cpu.user) {
      logInfo('', `${c.dim}user ${status.system.cpu.user}  sys ${status.system.cpu.system}  iowait ${status.system.cpu.iowait}${c.reset}`);
    }
  }

  // Load Average
  if (status.system.loadavg) {
    const la    = status.system.loadavg;
    const cores = status.system.cpuCores || 1;
    const la1   = parseFloat(la['1m']);
    const lc    = la1 > cores ? c.red : la1 > cores * 0.7 ? c.yellow : c.green;
    logInfo('负载均值', `${lc}${la['1m']}${c.reset}  ${c.dim}${la['5m']}  ${la['15m']}${c.reset}`, '1m / 5m / 15m');
  }

  // Memory
  if (status.system.memory?.percent !== undefined) {
    const color = colorByPercent(status.system.memory.percent);
    logInfo('内存', `${color}${status.system.memory.percentStr}${c.reset}  ${c.dim}${status.system.memory.used} / ${status.system.memory.total}${c.reset}`);
    if (status.system.memory.cached) {
      logInfo('', `${c.dim}cached ${status.system.memory.cached}${c.reset}`);
    }
  }

  // Disk
  if (status.system.storageDisk?.percent !== undefined) {
    const d     = status.system.storageDisk;
    const color = colorByPercent(d.percent);
    logInfo('磁盘 storage', `${color}${d.percentStr}${c.reset}  ${c.dim}${d.used} / ${d.total}  (${d.available} 可用)${c.reset}`);
  }
  if (status.system.appDisk?.percent !== undefined) {
    const d     = status.system.appDisk;
    const color = colorByPercent(d.percent);
    logInfo('磁盘 app',     `${color}${d.percentStr}${c.reset}  ${c.dim}${d.used} / ${d.total}  (${d.available} 可用)${c.reset}`);
  }

  // ── Docker ────────────────────────────────────────────────────────────────
  if (status.docker?.reblockApp) {
    logSection('Docker');
    const d = status.docker.reblockApp;
    logInfo('CPU',      `${c.dim}${d.cpu}${c.reset}`);
    logInfo('内存',     `${c.dim}${d.memory}${c.reset}`);
    if (d.netIO   && d.netIO   !== 'N/A') logInfo('网络 I/O', `${c.dim}${d.netIO}${c.reset}`,   '入 / 出');
    if (d.blockIO && d.blockIO !== 'N/A') logInfo('磁盘 I/O', `${c.dim}${d.blockIO}${c.reset}`, '读 / 写');
  }

  // ── Versions ──────────────────────────────────────────────────────────────
  logSection('版本');
  logInfo('历史数量', `${c.dim}${status.versions.total} 个${c.reset}`);
  logInfo('占用空间', `${c.dim}${status.versions.totalSize}${c.reset}`);
  if (status.versions.recent?.length) {
    status.versions.recent.forEach((v, i) => {
      const label = i === 0 ? `${c.cyan}${v}${c.reset}  ${c.dim}← current${c.reset}` : `${c.dim}${v}${c.reset}`;
      logInfo(i === 0 ? '最近版本' : '', label);
    });
  }

  // ── Network ───────────────────────────────────────────────────────────────
  logSection('网络');

  const isHealthy = status.network.healthStatus === 'ok';
  const rtMs      = status.network.responseTimeMs || 0;
  const rtColor   = rtMs < 200 ? c.green : rtMs < 1000 ? c.yellow : c.red;

  logInfo('健康检测',
    isHealthy
      ? `${c.green}ok${c.reset}  ${c.dim}HTTP ${status.network.httpCode}${c.reset}`
      : `${c.red}error${c.reset}  ${c.dim}HTTP ${status.network.httpCode}${c.reset}`
  );
  logInfo('响应时间', `${rtColor}${status.network.responseTime}${c.reset}`);
  logInfo('应用地址', `${c.dim}http://${config.host}:${config.appPort}${c.reset}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${DIVIDER}`);

  const overallOk =
    status.container.running &&
    status.network.healthStatus === 'ok' &&
    (status.system.memory?.percent || 0) < 90 &&
    (status.system.storageDisk?.percent || 0) < 90;

  if (overallOk) {
    console.log(`  ${c.green}✔  all systems operational${c.reset}`);
  } else {
    const issues = [];
    if (!status.container.running)                       issues.push('容器未运行');
    if (status.network.healthStatus !== 'ok')            issues.push('健康检测失败');
    if ((status.system.memory?.percent || 0) >= 90)      issues.push('内存告警');
    if ((status.system.storageDisk?.percent || 0) >= 90) issues.push('磁盘告警');
    console.log(`  ${c.yellow}!  ${issues.join('  ')}${c.reset}`);
  }
  console.log();
}

// ─── Display JSON ──────────────────────────────────────────────────────────

function displayJSON(status) {
  console.log(JSON.stringify(status, null, 2));
}

// ─── Watch mode ─────────────────────────────────────────────────────────────

async function watchMode(config) {
  console.log(`${c.dim}watch 模式，每 5 秒刷新，Ctrl+C 退出${c.reset}\n`);

  const refresh = async () => {
    console.clear();
    const status = await collectStatus(config);
    displayStatus(status, config);
    console.log(`${c.dim}下次刷新: ${new Date(Date.now() + 5000).toLocaleTimeString('zh-CN')}${c.reset}`);
  };

  await refresh();
  const interval = setInterval(refresh, 5000);

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(`\n${c.dim}已退出${c.reset}`);
    process.exit(0);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
${c.cyan}${c.bold}Reblock 服务器状态监控${c.reset}

${c.bold}使用方式:${c.reset}
  npm run status                  一次性显示服务器状态
  npm run status -- --watch       Watch 模式 (每 5 秒刷新)
  npm run status -- --json        以 JSON 格式输出

${c.bold}参数说明:${c.reset}
  ${c.cyan}--watch${c.reset}     持续刷新模式
  ${c.cyan}--json${c.reset}      输出原始 JSON 数据
  ${c.cyan}--help${c.reset}      显示此帮助信息
`);
    return;
  }

  const config = await loadConfig();

  if (!args.json) {
    process.stdout.write(`${c.dim}正在采集...${c.reset}`);
  }

  const status = await collectStatus(config);

  if (!args.json) {
    process.stdout.write('\r\x1b[K'); // clear spinner line
  }

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
  logError(`意外错误: ${error.message}`);
  process.exit(1);
});
