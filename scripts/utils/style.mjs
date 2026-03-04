#!/usr/bin/env node
/**
 * Shared Console Style Utilities
 *
 * Usage:
 *   import { c, logSection, logInfo, logSuccess, logWarn, logError, spinner } from './utils/style.mjs';
 *
 * Follows .opencode/rules/console-output-style.rule.md
 */

// ─── Colors & Formatting ───────────────────────────────────────────────────

export const c = {
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

// ─── Layout Constants ──────────────────────────────────────────────────────

const DEFAULT_DIVIDER_WIDTH = 52;

// ─── Header Pattern ────────────────────────────────────────────────────────

export function logBanner(title, host, subtitle = '') {
  console.log(`\n${c.bold}${c.white}${title}${c.reset}  ${c.dim}${host}${c.reset}`);
  if (subtitle) console.log(`${c.dim}${subtitle}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(DEFAULT_DIVIDER_WIDTH)}${c.reset}`);
}

// ─── Section Pattern ───────────────────────────────────────────────────────

export function logSection(title) {
  console.log(`\n${c.bold}${title}${c.reset}`);
  // Calculate visual width (CJK chars count as 2)
  const width = title.replace(/[\u4e00-\u9fa5]/g, 'xx').length;
  console.log(`${c.dim}${'─'.repeat(width)}${c.reset}`);
}

// ─── Info Line Pattern ─────────────────────────────────────────────────────

export function logInfo(label, value, hint = '') {
  const lbl = `${c.dim}${label.padEnd(16)}${c.reset}`;
  const hintStr = hint ? `  ${c.dim}${hint}${c.reset}` : '';
  console.log(`  ${lbl}${value}${hintStr}`);
}

// ─── Status Indicators ─────────────────────────────────────────────────────

export function logSuccess(message) {
  console.log(`  ${c.green}✔ ${message}${c.reset}`);
}

export function logWarn(message) {
  console.log(`  ${c.yellow}! ${message}${c.reset}`);
}

export function logError(message) {
  console.log(`\n  ${c.red}✖ ${message}${c.reset}`);
}

export function logDetail(message) {
  console.log(`  ${c.dim}  ${message}${c.reset}`);
}

// ─── Data Formatting ───────────────────────────────────────────────────────

export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);

  if (days > 0)    return `${c.white}${days}${c.reset}${c.dim}d ${c.reset}${c.white}${hours % 24}${c.reset}${c.dim}h${c.reset}`;
  if (hours > 0)   return `${c.white}${hours}${c.reset}${c.dim}h ${c.reset}${c.white}${minutes % 60}${c.reset}${c.dim}m${c.reset}`;
  if (minutes > 0) return `${c.white}${minutes}${c.reset}${c.dim}m ${c.reset}${c.white}${seconds % 60}${c.reset}${c.dim}s${c.reset}`;
  return `${c.white}${seconds}${c.reset}${c.dim}s${c.reset}`;
}

export function formatBytes(bytes) {
  if (bytes === 0)               return '0 B';
  if (bytes < 1024)              return `${bytes} B`;
  if (bytes < 1024 * 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function colorByPercent(percent) {
  if (percent >= 90) return c.red;
  if (percent >= 70) return c.yellow;
  return c.green;
}

export function formatPercent(percent) {
  const color = colorByPercent(percent);
  return `${color}${percent.toFixed(1)}${c.reset}${c.dim}%${c.reset}`;
}

// ─── Progress Spinner ──────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  constructor(message) {
    this.message = message;
    this.frame = 0;
    this.interval = null;
  }

  start() {
    this.interval = setInterval(() => {
      process.stdout.write(`\r${c.dim}${SPINNER_FRAMES[this.frame]}${c.reset} ${this.message}`);
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
    }, 80);
    return this;
  }

  stop(success = true, finalMessage = null) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r\x1b[K'); // Clear line
    if (finalMessage !== false) {
      if (success) {
        logSuccess(finalMessage || this.message.replace('…', '').trim());
      } else {
        logError(finalMessage || this.message.replace('…', '').trim());
      }
    }
  }

  succeed(message) {
    this.stop(true, message);
  }

  fail(message) {
    this.stop(false, message);
  }
}

export function spinner(message) {
  return new Spinner(message);
}

// ─── Progress Bar ──────────────────────────────────────────────────────────

export function progressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = colorByPercent(percent);
  return `${color}${bar}${c.reset} ${formatPercent(percent)}`;
}

// ─── Divider ───────────────────────────────────────────────────────────────

export function logDivider(width = DEFAULT_DIVIDER_WIDTH) {
  console.log(`${c.dim}${'─'.repeat(width)}${c.reset}`);
}

// ─── List ──────────────────────────────────────────────────────────────────

export function logList(items, bullet = '•') {
  items.forEach(item => {
    console.log(`  ${c.dim}${bullet}${c.reset} ${item}`);
  });
}

export function logSuccessList(items) {
  items.forEach(item => {
    console.log(`  ${c.green}✔${c.reset} ${item}`);
  });
}

export function logWarningList(items) {
  items.forEach(item => {
    console.log(`  ${c.yellow}!${c.reset} ${item}`);
  });
}

export function logErrorList(items) {
  items.forEach(item => {
    console.log(`  ${c.red}✖${c.reset} ${item}`);
  });
}

// ─── Summary ───────────────────────────────────────────────────────────────

export function logSummary(overallOk, issues = []) {
  console.log(`\n${c.dim}${'─'.repeat(DEFAULT_DIVIDER_WIDTH)}${c.reset}`);
  if (overallOk) {
    console.log(`  ${c.green}✔ all systems operational${c.reset}`);
  } else {
    console.log(`  ${c.yellow}! ${issues.join('  ')}${c.reset}`);
  }
  console.log();
}
