#!/usr/bin/env node

/**
 * Complete Workflow Test
 * 
 * Test the complete workflow:
 *   cleanup-all → import-imgs → doctor → logs-analyze
 * 
 * Verifies that no LINKCOUNT_MISMATCH warnings are generated
 * 
 * Usage: node scripts/test-workflow.mjs
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/**
 * Load environment variables from .env file
 */
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

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = (color, message) => console.log(`${colors[color]}${message}${colors.reset}`);

// Run a command and return stdout
const runCommand = (cmd, args = []) => {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: process.cwd(),
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        // Only reject if there's actual error content (not just npm warnings)
        const hasRealError = stderr && !stderr.includes('npm warn');
        if (hasRealError) {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      }
    });
  });
};

// Parse logs-analyze output to extract LINKCOUNT_MISMATCH count
const parseLogAnalysis = (output) => {
  const lines = output.split('\n');
  let linkCountMismatch = 0;
  
  for (const line of lines) {
    // Look for "LINKCOUNT_MISMATCH: X" pattern
    const match = line.match(/LINKCOUNT_MISMATCH:\s*(\d+)/);
    if (match) {
      linkCountMismatch = parseInt(match[1], 10);
      break;
    }
  }
  
  return { linkCountMismatch };
};

// Main test
async function runWorkflowTest() {
  console.log('\n' + '='.repeat(60));
  log('cyan', '🧪 Complete Workflow Test');
  log('cyan', 'cleanup-all → import-imgs → doctor → logs-analyze');
  console.log('='.repeat(60) + '\n');

  const startTime = Date.now();

  try {
    // Step 1: Cleanup
    log('blue', '\n📍 Step 1: Running cleanup-all...');
    console.log('-'.repeat(60));
    await runCommand('node', ['scripts/cleanup-all.mjs', '--yes']);
    log('green', '✅ Cleanup completed\n');

    // Step 2: Import Images
    log('blue', '\n📍 Step 2: Running import-imgs...');
    console.log('-'.repeat(60));
    await runCommand('node', ['scripts/import-imgs.mjs']);
    log('green', '✅ Import completed\n');

    // Step 3: Doctor
    log('blue', '\n📍 Step 3: Running doctor...');
    console.log('-'.repeat(60));
    await runCommand('npm', ['run', 'doctor']);
    log('green', '✅ Doctor check completed\n');

    // Step 4: Log Analysis
    log('blue', '\n📍 Step 4: Running logs-analyze...');
    console.log('-'.repeat(60));
    const logOutput = await runCommand('node', ['scripts/logs-analyze.mjs']);
    log('green', '✅ Log analysis completed\n');

    // Parse results
    const results = parseLogAnalysis(logOutput);
    
    // Final Report
    console.log('='.repeat(60));
    log('cyan', '📊 Test Results');
    console.log('='.repeat(60));
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\nDuration: ${duration}s`);
    console.log(`\nLINKCOUNT_MISMATCH Issues: ${results.linkCountMismatch}`);
    
    if (results.linkCountMismatch === 0) {
      log('green', '\n✅ TEST PASSED: No LINKCOUNT_MISMATCH warnings!');
      log('green', '   The atomic linkCount update fix is working correctly.');
      process.exit(0);
    } else {
      log('red', `\n❌ TEST FAILED: Found ${results.linkCountMismatch} LINKCOUNT_MISMATCH warnings!`);
      log('red', '   There may still be race conditions in the upload process.');
      process.exit(1);
    }

  } catch (error) {
    log('red', `\n❌ Workflow test failed: ${error.message}`);
    process.exit(1);
  }
}

runWorkflowTest();
