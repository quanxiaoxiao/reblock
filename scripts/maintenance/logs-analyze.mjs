#!/usr/bin/env node

/**
 * Reblock Logs Analyze - Log Analysis Tool
 *
 * Analyze log files and generate reports
 *
 * Usage:
 *   npm run logs:analyze                    # Analyze last 7 days
 *   npm run logs:analyze -- --days 30       # Analyze last 30 days
 *   npm run logs:analyze -- --category MISSING_FILE  # Filter by category
 *   npm run logs:analyze -- --json          # JSON output
 */

import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// Load environment variables
function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Ignore if .env doesn't exist
  }
}

loadEnv();

// Configuration
const LOG_DIR = join(process.env.STORAGE_LOG_DIR || './storage/_logs', 'issues');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const daysIndex = args.indexOf('--days');
  const categoryIndex = args.indexOf('--category');
  const levelIndex = args.indexOf('--level');
  
  return {
    days: daysIndex >= 0 ? parseInt(args[daysIndex + 1]) || 7 : 7,
    category: categoryIndex >= 0 ? args[categoryIndex + 1] : undefined,
    level: levelIndex >= 0 ? args[levelIndex + 1] : undefined,
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Get log files within date range
function getLogFiles(days) {
  const files = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  // Get date strings for comparison (YYYY-MM-DD)
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  try {
    const entries = readdirSync(LOG_DIR);
    
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      
      // Extract date from filename (assuming format: YYYY-MM-DD.jsonl)
      const fileDateStr = entry.replace('.jsonl', '');
      
      // Include file if its date >= cutoff date
      if (fileDateStr >= cutoffDateStr) {
        const filePath = join(LOG_DIR, entry);
        files.push(filePath);
      }
    }
  } catch (error) {
    console.error(`${colors.red}Error reading log directory:${colors.reset}`, error.message);
  }

  return files.sort();
}

// Parse a single log line
function parseLogLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Analyze logs from files
async function analyzeLogs(files, options) {
  const stats = {
    total: 0,
    byCategory: {},
    byLevel: {},
    byStatus: {},
    byDay: {},
    recent: [],
    critical: [],
  };

  for (const file of files) {
    const fileStream = createReadStream(file, { encoding: 'utf-8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      
      const log = parseLogLine(line);
      if (!log) continue;

      // Apply filters
      if (options.category && log.category !== options.category) continue;
      if (options.level && log.level !== options.level) continue;

      stats.total++;

      // Count by category
      stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;

      // Count by level
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

      // Count by status
      stats.byStatus[log.status] = (stats.byStatus[log.status] || 0) + 1;

      // Count by day
      const day = new Date(log.timestamp).toISOString().split('T')[0];
      stats.byDay[day] = (stats.byDay[day] || 0) + 1;

      // Track critical issues
      if (log.level === 'CRITICAL') {
        stats.critical.push({
          id: log._id,
          category: log.category,
          timestamp: log.timestamp,
          blockId: log.blockId,
          message: log.suggestedAction,
        });
      }

      // Track recent issues (last 10)
      if (stats.recent.length < 10) {
        stats.recent.push({
          id: log._id,
          category: log.category,
          level: log.level,
          timestamp: log.timestamp,
          blockId: log.blockId,
        });
      }
    }
  }

  return stats;
}

// Print text report
function printTextReport(stats, options) {
  console.log(`\n${colors.cyan}📊 Log Analysis Report${colors.reset}`);
  console.log(`${colors.gray}Period: Last ${options.days} days${colors.reset}`);
  console.log(`${'='.repeat(60)}\n`);

  // Summary
  console.log(`${colors.bold}Summary:${colors.reset}`);
  console.log(`  Total issues: ${colors.bold}${stats.total}${colors.reset}`);
  console.log(`  Critical: ${stats.byLevel.CRITICAL ? colors.red : colors.green}${stats.byLevel.CRITICAL || 0}${colors.reset}`);
  console.log(`  Error: ${stats.byLevel.ERROR ? colors.red : colors.green}${stats.byLevel.ERROR || 0}${colors.reset}`);
  console.log(`  Warning: ${stats.byLevel.WARNING ? colors.yellow : colors.green}${stats.byLevel.WARNING || 0}${colors.reset}`);
  console.log(`  Info: ${stats.byLevel.INFO ? colors.blue : colors.gray}${stats.byLevel.INFO || 0}${colors.reset}`);
  console.log();

  // By category
  if (Object.keys(stats.byCategory).length > 0) {
    console.log(`${colors.bold}By Category:${colors.reset}`);
    Object.entries(stats.byCategory)
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, count]) => {
        console.log(`  ${category}: ${colors.yellow}${count}${colors.reset}`);
      });
    console.log();
  }

  // By status
  if (Object.keys(stats.byStatus).length > 0) {
    console.log(`${colors.bold}By Status:${colors.reset}`);
    Object.entries(stats.byStatus)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        const color = status === 'open' ? colors.red :
                     status === 'resolved' ? colors.green :
                     colors.yellow;
        console.log(`  ${status}: ${color}${count}${colors.reset}`);
      });
    console.log();
  }

  // Daily trend
  if (Object.keys(stats.byDay).length > 0) {
    console.log(`${colors.bold}Daily Trend:${colors.reset}`);
    Object.entries(stats.byDay)
      .sort()
      .forEach(([day, count]) => {
        console.log(`  ${day}: ${colors.blue}${count}${colors.reset}`);
      });
    console.log();
  }

  // Critical issues
  if (stats.critical.length > 0) {
    console.log(`${colors.red}${colors.bold}⚠️  Critical Issues:${colors.reset}`);
    stats.critical.forEach((issue, idx) => {
      console.log(`  ${idx + 1}. ${issue.category} (${new Date(issue.timestamp).toLocaleDateString()})`);
      console.log(`     Block: ${issue.blockId?.substring(0, 16)}...`);
      console.log(`     Action: ${issue.message}`);
    });
    console.log();
  }

  // Recent issues
  if (stats.recent.length > 0) {
    console.log(`${colors.bold}Recent Issues (last 10):${colors.reset}`);
    stats.recent.forEach((issue, idx) => {
      const color = issue.level === 'CRITICAL' ? colors.red :
                   issue.level === 'ERROR' ? colors.red :
                   issue.level === 'WARNING' ? colors.yellow :
                   colors.blue;
      console.log(`  ${idx + 1}. [${color}${issue.level}${colors.reset}] ${issue.category}`);
      console.log(`     ${new Date(issue.timestamp).toLocaleString()}`);
    });
    console.log();
  }

  console.log(`${'='.repeat(60)}\n`);
}

// Print JSON report
function printJsonReport(stats) {
  console.log(JSON.stringify(stats, null, 2));
}

// Main function
async function main() {
  const options = parseArgs();

  if (options.help) {
    console.log(`
${colors.cyan}Reblock Logs Analyze - Log Analysis Tool${colors.reset}

Usage:
  npm run logs:analyze [options]

Options:
  --days <n>        Analyze last n days (default: 7)
  --category <cat>   Filter by category (e.g., MISSING_FILE)
  --level <level>   Filter by level (CRITICAL/ERROR/WARNING/INFO)
  --json            Output as JSON
  --help, -h        Show help

Examples:
  npm run logs:analyze                    # Analyze last 7 days
  npm run logs:analyze -- --days 30       # Analyze last 30 days
  npm run logs:analyze -- --category ORPHANED_BLOCK
`);
    process.exit(0);
  }

  console.log(`\n${colors.cyan}Analyzing logs...${colors.reset}`);

  const files = getLogFiles(options.days);
  
  if (files.length === 0) {
    console.log(`${colors.yellow}No log files found for the specified period.${colors.reset}\n`);
    process.exit(0);
  }

  console.log(`${colors.gray}Found ${files.length} log file(s)${colors.reset}\n`);

  const stats = await analyzeLogs(files, options);

  if (options.json) {
    printJsonReport(stats);
  } else {
    printTextReport(stats, options);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(`${colors.red}Error:${colors.reset}`, error.message);
  process.exit(1);
});
