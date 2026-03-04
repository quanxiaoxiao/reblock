#!/usr/bin/env node
/**
 * Deploy script for Reblock
 *
 * Usage:
 *   node deploy.mjs
 *
 * Requirements:
 *   - deploy.config.mjs must exist in project root
 *   - SSH key authentication must be configured on server
 *   - Server must have node:24-alpine image
 *
 * Configuration (deploy.config.mjs):
 *   - host: Server IP
 *   - port: SSH port (default: 22)
 *   - user: SSH user
 *   - privateKey: Path to SSH private key
 *   - remotePath: Application directory on server
 *   - storagePath: Storage directory (default: remotePath/storage)
 *   - dockerNetwork: Docker network to join (optional)
 *   - env: Object containing environment variables for .env file
 */

import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
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
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
};

const W = 64;
const DIVIDER     = `${c.dim}${'─'.repeat(W)}${c.reset}`;
const DIVIDER_FAT = `${c.dim}${'━'.repeat(W)}${c.reset}`;

// ─── Step counter ──────────────────────────────────────────────────────────

let _stepTotal = 8;
let _stepCurrent = 0;

function stepLabel() {
  _stepCurrent++;
  return `${c.dim}[${String(_stepCurrent).padStart(2)}/${_stepTotal}]${c.reset}`;
}

// ─── Logging helpers ───────────────────────────────────────────────────────

function logBanner(title, subtitle = '') {
  const line = '═'.repeat(W);
  console.log(`\n${c.cyan}${c.bold}╔${line}╗`);
  const t = `  🚀  ${title}`;
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

function logCheckRow(label, status, note = '') {
  const icon   = status === 'ok'   ? `${c.green}✔` :
                 status === 'warn' ? `${c.yellow}⚠` :
                 status === 'fail' ? `${c.red}✖`   : `${c.gray}─`;
  const lbl    = `${c.reset}${c.white}${label.padEnd(28)}`;
  const noteStr = note ? `${c.gray}  ${note}` : '';
  console.log(`   ${icon}  ${lbl}${noteStr}${c.reset}`);
}

function logSuccessBanner() {
  const line = '═'.repeat(W);
  console.log(`\n${c.green}${c.bold}╔${line}╗`);
  console.log(`║  🎉  Deployment completed successfully!${''.padEnd(W - 41)}║`);
  console.log(`╚${line}╝${c.reset}\n`);
}

function logFailBanner() {
  const line = '═'.repeat(W);
  console.log(`\n${c.red}${c.bold}╔${line}╗`);
  console.log(`║  💥  Deployment failed!${''.padEnd(W - 24)}║`);
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
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function question(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ─── Single HTTP check via SSH ─────────────────────────────────────────────
// Returns the HTTP status code string, or null on network error

async function sshCurlStatus(sshCmd, url) {
  try {
    return exec(`${sshCmd} 'curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${url}"'`).trim();
  } catch {
    return null;
  }
}

// ─── Deployment ───────────────────────────────────────────────────────────

async function deploy() {
  const deployStart = Date.now();

  logBanner('Reblock Deployment', `Started at ${new Date().toLocaleTimeString()}`);

  // ── 1. Load config ──────────────────────────────────────────────────────
  logStep('📋', 'Loading configuration');

  const configPath = join(process.cwd(), 'deploy.config.mjs');
  if (!existsSync(configPath)) {
    logError('deploy.config.mjs not found!');
    console.log(`\n${c.yellow}Please create deploy.config.mjs:\n`);
    console.log(`export default {
  host: 'your-server-ip',
  port: 22,
  user: 'root',
  privateKey: '~/.ssh/id_rsa',
  remotePath: '/opt/reblock',
  storagePath: '/data/reblock/storage',  // Optional
  dockerNetwork: 'reblock-net',          // Optional
  env: {
    NODE_ENV: 'production',
    PORT: 3000,
    MONGO_HOSTNAME: 'your-mongo-host',
    MONGO_PORT: 27017,
    MONGO_DATABASE: 'reblock',
    MONGO_USERNAME: 'reblock',
    MONGO_PASSWORD: 'your-password',
    ENCRYPTION_KEY: 'your-base64-key',
    TZ: 'Asia/Shanghai',
    STORAGE_TEMP_DIR: '/app/storage/_temp',
    STORAGE_BLOCK_DIR: '/app/storage/blocks',
    STORAGE_LOG_DIR: '/app/storage/_logs',
    
    // Migration API (optional - auto-generates tokens if not provided)
    MIGRATION_API_ENABLED: true,
    // MIGRATION_API_TOKEN: 'auto-generated',  // 64-char hex, auto-generated if omitted
    ERRORS_API_TOKEN: '',     // 64-char hex, auto-generated if omitted
    
    // Logging configuration (all optional - use defaults if omitted)
    // LOG_TTL_DAYS: 90,
    // LOG_ARCHIVE_DAYS: 30,
    // LOG_ARCHIVE_TZ: 'Asia/Shanghai',
    // LOG_DEDUP_WINDOW_MINUTES: 10,
    // CASCADE_DELETE_LOG_DAYS: 30,
    // METRICS_SNAPSHOT_INTERVAL_MINUTES: 5,
  },
};${c.reset}`);
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

  const appPort           = envConfig?.PORT || 3000;
  const storageInternalDir = envConfig?.STORAGE_INTERNAL_DIR || '/app/storage';
  const sshBaseCmd        = `ssh -p ${port} -i ${privateKey} -o StrictHostKeyChecking=no ${user}@${host}`;

  logOk('Configuration loaded');
  console.log(`\n${DIVIDER_FAT}`);
  logInfo('Host',           `${host}:${port}`);
  logInfo('User',           user);
  logInfo('Remote path',    remotePath);
  logInfo('Storage (host)', storagePath);
  logInfo('Storage (app)',  storageInternalDir);
  logInfo('App port',       `${appPortBind ?? appPort} → ${appPort}`);
  if (dockerNetwork) logInfo('Docker network', dockerNetwork);
  console.log(`${DIVIDER_FAT}\n`);

  // ── 2. Check .env on server ─────────────────────────────────────────────
  logStep('🔍', 'Checking server environment');

  let envExists = false;
  try {
    const result = exec(`${sshBaseCmd} 'test -f ${remotePath}/.env && echo "exists" || echo "not found"'`).trim();
    envExists = result === 'exists';
  } catch (_) {
    // Directory might not exist yet
  }

  if (envExists) {
    logOk('Existing .env found on server — will reuse it');
  } else {
    logWarn('.env not found on server');

    if (!envConfig) {
      logError('deploy.config.mjs has no "env" configuration!');
      process.exit(1);
    }

    const answer = await question(
      `\n   ${c.yellow}Generate .env from deploy.config.mjs? (yes/no): ${c.reset}`
    );
    if (answer !== 'yes' && answer !== 'y') {
      logError('Deployment cancelled by user.');
      process.exit(1);
    }
    logOk('.env will be generated on server');
  }

  // ── 3. Build ─────────────────────────────────────────────────────────────
  logStep('🔨', 'Building project');
  const buildStart = Date.now();
  try {
    exec('npm run build', { cwd: process.cwd(), stdio: 'inherit' });
    const buildSec = ((Date.now() - buildStart) / 1000).toFixed(1);
    logOk(`Build completed  ${c.gray}(${buildSec}s)${c.reset}`);
  } catch (error) {
    logError(`Build failed: ${error.message}`);
    process.exit(1);
  }

  // ── 4. Create package ────────────────────────────────────────────────────
  const timestamp      = Date.now();
  const packageName    = `reblock-deploy-${timestamp}.tar.gz`;
  const localPackagePath = join(process.cwd(), packageName);

  logStep('📦', 'Creating deployment package');
  try {
    const excludePatterns = [
      '_temp', '.env', '.git', '.github', '.gitignore', '.idea', 'deploy.back.mjs',
      '.opencode', '.vscode', '*.log', 'AGENTS.md', 'CHANGELOG.md',
      'coverage', 'deploy.config.mjs', 'scripts/maintenance/deploy.mjs', 'docker-compose.yml',
      'imgs', 'LICENSE', 'reblock-deploy-*.tar.gz', 'storage',
      'test-hurl.sh', 'tests',
    ];
    const excludeArgs = excludePatterns.map(p => `--exclude='${p}'`).join(' ');
    exec(`tar czf ${packageName} ${excludeArgs} .`, { cwd: process.cwd() });

    const pkgSize = formatBytes(statSync(localPackagePath).size);
    logOk(`Package created: ${c.white}${packageName}${c.reset}  ${c.gray}(${pkgSize})${c.reset}`);
  } catch (error) {
    logError(`Failed to create package: ${error.message}`);
    process.exit(1);
  }

  // ── 5. Upload ─────────────────────────────────────────────────────────────
  logStep('📤', 'Uploading to server');
  const remoteTempPath = `/tmp/${packageName}`;
  const uploadStart    = Date.now();
  try {
    exec(
      `scp -P ${port} -i ${privateKey} -o StrictHostKeyChecking=no ${localPackagePath} ${user}@${host}:${remoteTempPath}`
    );
    const uploadSec = ((Date.now() - uploadStart) / 1000).toFixed(1);
    logOk(`Upload completed  ${c.gray}(${uploadSec}s)  →  ${host}:${remoteTempPath}${c.reset}`);
  } catch (error) {
    logError(`Upload failed: ${error.message}`);
    if (existsSync(localPackagePath)) exec(`rm ${localPackagePath}`);
    process.exit(1);
  }

  // ── 6. Deploy on server ───────────────────────────────────────────────────
  logStep('🚀', 'Deploying on server');
  let deploySuccess = false;
  const generatedTokens = [];
  try {
    const versionDir  = `${remotePath}/v-${timestamp}`;
    const currentLink = `${remotePath}/current`;

    let envContent = '';
    
    if (!envExists && envConfig) {
      // Auto-generate tokens if needed
      const finalEnvConfig = { ...envConfig };
      
      // Generate MIGRATION_API_TOKEN if enabled but not provided
      if (finalEnvConfig.MIGRATION_API_ENABLED === true && finalEnvConfig.MIGRATION_API_TOKEN) {
        generatedTokens.push({ name: 'MIGRATION_API_TOKEN', value: finalEnvConfig.MIGRATION_API_TOKEN });
      }
      
      // Generate ERRORS_API_TOKEN if not provided
      if (finalEnvConfig.ERRORS_API_TOKEN) {
        generatedTokens.push({ name: 'ERRORS_API_TOKEN', value: finalEnvConfig.ERRORS_API_TOKEN });
      }
      
      // Add default LOG_* values if not provided
      const logDefaults = {
        LOG_TTL_DAYS: 90,
        LOG_ARCHIVE_DAYS: 30,
        LOG_ARCHIVE_TZ: 'Asia/Shanghai',
        LOG_DEDUP_WINDOW_MINUTES: 10,
        ERROR_FALLBACK_LOG_FILE: `${finalEnvConfig.STORAGE_LOG_DIR || '/app/storage/_logs'}/runtime-fallback.log`,
        CASCADE_DELETE_LOG_DAYS: 30,
        METRICS_SNAPSHOT_INTERVAL_MINUTES: 5,
        METRICS_WINDOW_MINUTES: 5,
      };
      
      for (const [key, defaultValue] of Object.entries(logDefaults)) {
        if (!(key in finalEnvConfig)) {
          finalEnvConfig[key] = defaultValue;
        }
      }
      
      envContent = Object.entries(finalEnvConfig)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    }

    const scriptParts = [
      'set -e',
      '',
      '# ── Create directories ──────────────────────────────',
      `echo "   › Creating directories..."`,
      `mkdir -p ${remotePath}`,
      `mkdir -p ${storagePath}`,
      `mkdir -p ${storagePath}/blocks`,
      `mkdir -p ${storagePath}/_temp`,
      `mkdir -p ${storagePath}/_logs`,
      `mkdir -p ${versionDir}`,
      '',
      '# ── Extract package ─────────────────────────────────',
      `echo "   › Extracting package to ${versionDir}..."`,
      `tar xzf ${remoteTempPath} -C ${versionDir}`,
      `rm ${remoteTempPath}`,
      '',
    ];

    if (!envExists && envContent) {
      scriptParts.push(
        '# ── Generate .env ──────────────────────────────────',
        `if [ ! -f ${remotePath}/.env ]; then`,
        `  cat > ${remotePath}/.env << 'ENVFILE'`,
        envContent,
        'ENVFILE',
        `  echo "   › .env generated"`,
        `fi`,
        '',
      );
    }

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

    scriptParts.push(
      '# ── Stop old container ──────────────────────────────',
      `echo "   › Stopping old container..."`,
      'docker stop reblock-app 2>/dev/null && echo "   › Stopped" || echo "   › (none running)"',
      'docker rm   reblock-app 2>/dev/null || true',
      '',
      '# ── Update symlink ──────────────────────────────────',
      `echo "   › Updating symlink: current → v-${timestamp}"`,
      `ln -sfn ${versionDir} ${currentLink}`,
      '',
      '# ── Start new container ────────────────────────────',
      `echo "   › Starting container..."`,
      `cd ${remotePath}`,
      dockerArgs.join(' \\\n'),
      '',
      'echo ""',
      'echo "   Container status:"',
      'docker ps -f name=reblock-app --format "   ID={{.ID}}  Status={{.Status}}  Ports={{.Ports}}"',
    );

    exec(`${sshBaseCmd} 'bash -s' << 'SSHEOF'\n${scriptParts.join('\n')}\nSSHEOF`, { stdio: 'inherit' });
    deploySuccess = true;
    logOk('Container started');
  } catch (error) {
    logError(`Deployment failed: ${error.message}`);
    logWarn('The old container may have been stopped. Check server manually.');
  }

  // ── 7. Cleanup local package ──────────────────────────────────────────────
  logStep('🧹', 'Cleaning up local files');
  try {
    if (existsSync(localPackagePath)) exec(`rm ${localPackagePath}`);
    logOk('Local package removed');
  } catch (error) {
    logWarn(`Failed to cleanup local package: ${error.message}`);
  }

  // ── 8. Health & security checks ───────────────────────────────────────────
  if (deploySuccess) {
    logStep('🏥', 'Running health & security checks');

    const baseUrl    = `http://localhost:${appPortBind ?? appPort}`;
    const healthUrl  = `${baseUrl}/health`;

    logInfo('Base URL', baseUrl);
    console.log();

    // Wait for container to warm up
    await new Promise(r => setTimeout(r, 2000));

    // ── 8a. Health check (retried) ────────────────────────────────────────
    let healthOk = false;
    let lastStatus = '';
    const maxRetries  = 5;
    const retryDelay  = 3000;

    for (let i = 1; i <= maxRetries; i++) {
      const status = await sshCurlStatus(sshBaseCmd, healthUrl);
      lastStatus   = status ?? '(no response)';

      if (status === '200') {
        healthOk = true;
        break;
      }
      if (i < maxRetries) {
        logDetail(`/health → HTTP ${lastStatus}  — retry ${i}/${maxRetries} in ${retryDelay / 1000}s...`);
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }

    // ── 8b. Security checks (docs & openapi must be 404) ─────────────────
    const securityChecks = [
      { path: '/docs',         expectStatus: '404', label: 'Docs hidden (/docs)' },
      { path: '/openapi.json', expectStatus: '404', label: 'OpenAPI hidden (/openapi.json)' },
    ];

    const secResults = [];
    for (const chk of securityChecks) {
      const status = await sshCurlStatus(sshBaseCmd, `${baseUrl}${chk.path}`);
      const ok     = status === chk.expectStatus;
      secResults.push({ ...chk, status: status ?? '(no response)', ok });
    }

    // ── 8c. Print check table ─────────────────────────────────────────────
    console.log(`\n${DIVIDER}`);
    console.log(`   ${c.bold}${c.white}Endpoint Checks${c.reset}`);
    console.log(DIVIDER);

    // Health row
    logCheckRow(
      `/health  →  HTTP 200`,
      healthOk ? 'ok' : 'fail',
      healthOk ? 'OK' : `got ${lastStatus}`,
    );

    // Security rows
    for (const r of secResults) {
      const statusOk = r.ok;
      logCheckRow(
        `${r.path}  →  HTTP 404`,
        statusOk ? 'ok' : 'fail',
        statusOk ? 'OK (hidden)' : `got ${r.status} — ${c.yellow}EXPOSED!${c.reset}`,
      );
    }
    console.log(DIVIDER);

    if (!healthOk) {
      logError(`Health check failed after ${maxRetries} attempts (last: ${lastStatus})`);
      logDetail(`Inspect logs: ssh ${user}@${host} 'docker logs reblock-app --tail 50'`);
    }

    const secFailed = secResults.filter(r => !r.ok);
    if (secFailed.length > 0) {
      logWarn(`Security check failed for: ${secFailed.map(r => r.path).join(', ')}`);
      logDetail('These routes should return 404 in production.');
    }

    // ── 8d. Print generated tokens ───────────────────────────────────────
    if (generatedTokens.length > 0) {
      console.log(`\n${DIVIDER}`);
      console.log(`   ${c.bold}${c.white}Auto-Generated Tokens${c.reset}`);
      console.log(DIVIDER);
      for (const token of generatedTokens) {
        const maskedValue = token.value.substring(0, 8) + '...' + token.value.substring(token.value.length - 8);
        logInfo(token.name, `${c.yellow}${maskedValue}${c.reset}`);
        logDetail(`Full value: ${token.value}`);
      }
      console.log(`${c.gray}   Save these tokens for API authentication${c.reset}`);
      console.log(DIVIDER);
    }

    // ── Final summary ─────────────────────────────────────────────────────
    const elapsed    = ((Date.now() - deployStart) / 1000).toFixed(1);
    const allPassed  = healthOk && secResults.every(r => r.ok);

    console.log(`\n${DIVIDER_FAT}`);
    console.log(`   ${c.bold}${c.white}Deployment Summary${c.reset}`);
    console.log(DIVIDER_FAT);
    logInfo('Version',    `v-${timestamp}`);
    logInfo('Duration',   `${elapsed}s`);
    logInfo('App URL',    `http://${host}:${appPortBind ?? appPort}`);
    logInfo('Health',     healthOk
      ? `${c.green}✔  OK${c.reset}`
      : `${c.red}✖  FAILED${c.reset} — check logs above`);
    logInfo('Docs / API', secResults.every(r => r.ok)
      ? `${c.green}✔  Properly hidden (404)${c.reset}`
      : `${c.red}✖  One or more routes exposed!${c.reset}`);
    console.log(`${DIVIDER_FAT}\n`);

    if (allPassed) {
      logSuccessBanner();
    } else {
      logFailBanner();
      process.exit(1);
    }
  } else {
    logFailBanner();
    process.exit(1);
  }
}

// ─── Entry ────────────────────────────────────────────────────────────────

deploy().catch(error => {
  logError(`Unexpected error: ${error.message}`);
  process.exit(1);
});

