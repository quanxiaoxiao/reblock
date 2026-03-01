#!/usr/bin/env node

/**
 * Resource Test Suite
 * 
 * Automated testing suite that verifies resource-corrupt and resource-report
 * consistency by applying corruptions and verifying detection.
 * 
 * Usage:
 *   node scripts/resource-test-suite.mjs
 *   node scripts/resource-test-suite.mjs --verbose
 *   node scripts/resource-test-suite.mjs --corruption-types linkcount,delete-file
 * 
 * Options:
 *   --corruption-types <list>    Comma-separated list of corruption types to test
 *   --verbose                      Show detailed output
 *   --keep-data                    Keep test data after completion
 *   --help                         Show this help
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { spawn } from 'child_process';
import mongoose from 'mongoose';

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
const CONFIG = {
  MONGO_URI: '',
  API_BASE: '',
  DEFAULT_CORRUPTIONS: ['linkcount', 'delete-file', 'size', 'invalid-block'],
};

function initializeConfig() {
  const mongoHost = process.env.MONGO_HOSTNAME || 'localhost';
  const mongoPort = process.env.MONGO_PORT || '27017';
  const mongoDb = process.env.MONGO_DATABASE || 'reblock';
  const mongoUser = process.env.MONGO_USERNAME;
  const mongoPass = process.env.MONGO_PASSWORD;
  
  const auth = mongoUser && mongoPass ? `${mongoUser}:${mongoPass}@` : '';
  const authSource = auth ? '?authSource=admin' : '';
  CONFIG.MONGO_URI = `mongodb://${auth}${mongoHost}:${mongoPort}/${mongoDb}${authSource}`;
  
  // Get storage directory from env or use default
  const blockDir = process.env.STORAGE_BLOCK_DIR || './storage/blocks';
  CONFIG.BLOCKS_DIR = resolve(process.cwd(), blockDir);
  
  // API base URL
  const port = process.env.PORT || process.env.SERVER_PORT || 3000;
  CONFIG.API_BASE = `http://localhost:${port}`;
}

initializeConfig();

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

// Parse arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  const typesIndex = args.indexOf('--corruption-types');
  
  return {
    corruptionTypes: typesIndex >= 0 
      ? args[typesIndex + 1].split(',') 
      : CONFIG.DEFAULT_CORRUPTIONS,
    verbose: args.includes('--verbose'),
    keepData: args.includes('--keep-data'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Print helpers
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function warn(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function info(message) {
  console.log(`${colors.gray}  ${message}${colors.reset}`);
}

function section(title) {
  console.log(`\n${colors.cyan}${colors.bold}${title}${colors.reset}`);
  console.log(`${colors.gray}${'─'.repeat(60)}${colors.reset}`);
}

// Connect to MongoDB
async function connectDB() {
  await mongoose.connect(CONFIG.MONGO_URI);
}

async function disconnectDB() {
  await mongoose.disconnect();
}

// Define schemas directly (avoid ES module import issues)
function loadModels() {
  const resourceSchema = new mongoose.Schema({
    block: { type: mongoose.Schema.Types.ObjectId, ref: 'Block' },
    entry: { type: mongoose.Schema.Types.ObjectId, ref: 'Entry' },
    mime: String,
    category: String,
    description: { type: String, default: '' },
    name: { type: String, default: '' },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
    lastAccessedAt: { type: Number, default: Date.now },
    isInvalid: { type: Boolean, default: false },
    invalidatedAt: Number,
    clientIp: String,
    userAgent: String,
    uploadDuration: Number,
  });

  const blockSchema = new mongoose.Schema({
    sha256: { type: String, required: true, unique: true },
    size: { type: Number, required: true },
    linkCount: { type: Number, default: 1 },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
    isInvalid: { type: Boolean, default: false },
    invalidatedAt: Number,
  });

  const entrySchema = new mongoose.Schema({
    name: { type: String, required: true },
    alias: { type: String, unique: true, sparse: true },
    order: { type: Number, default: 0 },
    description: { type: String, default: '' },
    isDefault: { type: Boolean, default: false },
    uploadConfig: {
      readOnly: Boolean,
      maxFileSize: Number,
      allowedMimeTypes: [String],
    },
    createdAt: { type: Number, default: Date.now },
    updatedAt: { type: Number, default: Date.now },
    isInvalid: { type: Boolean, default: false },
    invalidatedAt: Number,
  });

  const Resource = mongoose.models.Resource || mongoose.model('Resource', resourceSchema);
  const Block = mongoose.models.Block || mongoose.model('Block', blockSchema);
  const Entry = mongoose.models.Entry || mongoose.model('Entry', entrySchema);

  return { Resource, Block, Entry };
}

// Run command and return output
function runCommand(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: process.cwd(),
      shell: true,
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    
    proc.on('error', reject);
  });
}

// Create test resource via API
async function createTestResource() {
  const timestamp = Date.now();
  const testContent = `test-content-${timestamp}`;
  
  // Create entry
  const entryRes = await fetch(`${CONFIG.API_BASE}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Test Entry ${timestamp}`,
      alias: `test-entry-${timestamp}`,
    }),
  });
  
  if (!entryRes.ok) {
    throw new Error('Failed to create test entry');
  }
  
  const entry = await entryRes.json();
  
  // Upload file
  const uploadRes = await fetch(`${CONFIG.API_BASE}/upload/${entry.alias}?name=test-file.txt`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'text/plain',
      'User-Agent': 'test-suite/1.0',
    },
    body: testContent,
  });
  
  if (!uploadRes.ok) {
    throw new Error('Failed to upload test file');
  }
  
  const resource = await uploadRes.json();
  
  return {
    entryId: entry._id,
    resourceId: resource._id,
    blockId: resource.block,
    content: testContent,
  };
}

// Delete test resource
async function deleteTestResource(resourceId) {
  await fetch(`${CONFIG.API_BASE}/resources/${resourceId}`, {
    method: 'DELETE',
  });
}

// Apply corruption
async function applyCorruption(resourceId, type, value = null) {
  const args = [
    'scripts/resource-corrupt.mjs',
    '--resource-id', resourceId,
    '--type', type,
    '--yes',
  ];
  
  if (value) {
    args.push('--value', value);
  }
  
  const result = await runCommand('node', args);
  
  if (result.code !== 0) {
    throw new Error(`Failed to apply corruption ${type}: ${result.stderr}`);
  }
  
  return result;
}

// Restore resource
async function restoreResource(resourceId) {
  const result = await runCommand('node', [
    'scripts/resource-corrupt.mjs',
    '--resource-id', resourceId,
    '--restore',
  ]);
  
  return result.code === 0;
}

// Generate report and parse anomalies
async function generateReport(resourceId) {
  const result = await runCommand('node', [
    'scripts/resource-report.mjs',
    '--resource-id', resourceId,
    '--json',
  ]);
  
  if (result.code > 2) {
    throw new Error(`Failed to generate report: ${result.stderr}`);
  }
  
  try {
    const report = JSON.parse(result.stdout);
    return report;
  } catch {
    throw new Error('Failed to parse report JSON');
  }
}

// Expected anomaly mapping
const expectedAnomalies = {
  'linkcount': 'LINKCOUNT_MISMATCH',
  'delete-file': 'MISSING_FILE',
  'size': 'FILE_SIZE_MISMATCH',
  'orphan': 'ORPHANED_RESOURCE',
  'sha256': 'SHA256_MISMATCH',
  'invalid-block': 'INVALID_BLOCK',
};

// Run single test
async function runTest(corruptionType, testData, verbose) {
  const { resourceId } = testData;
  
  if (verbose) {
    info(`Testing corruption type: ${corruptionType}`);
  }
  
  // Restore first to ensure clean state (in case previous test left corruption)
  await restoreResource(resourceId);
  
  // Apply corruption
  let corruptionValue = null;
  if (corruptionType === 'linkcount') corruptionValue = '0';
  if (corruptionType === 'size') corruptionValue = '999999';
  
  await applyCorruption(resourceId, corruptionType, corruptionValue);
  
  // Generate report
  const report = await generateReport(resourceId);
  
  // Check if expected anomaly was detected
  const expectedType = expectedAnomalies[corruptionType];
  const detected = report.anomalies.some(a => a.type === expectedType);
  
  return {
    type: corruptionType,
    expectedAnomaly: expectedType,
    detected: detected,
    anomaliesFound: report.anomalies.map(a => a.type),
    pass: detected,
  };
}

// Main function
async function main() {
  const args = parseArgs();
  
  if (args.help) {
    console.log(`
${colors.cyan}Resource Test Suite${colors.reset}

Usage:
  node scripts/resource-test-suite.mjs [options]

Options:
  --corruption-types <list>    Comma-separated corruption types (default: linkcount,delete-file,size,invalid-block)
  --verbose                      Show detailed output
  --keep-data                    Keep test data after completion
  --help                         Show this help

Available Corruption Types:
  linkcount       - Modify block.linkCount
  delete-file     - Delete physical file
  size            - Modify block.size
  invalid-block   - Point to soft-deleted block

Examples:
  node scripts/resource-test-suite.mjs
  node scripts/resource-test-suite.mjs --verbose
  node scripts/resource-test-suite.mjs --corruption-types linkcount,delete-file
`);
    process.exit(0);
  }
  
  console.log(`${colors.cyan}${colors.bold}🧪 Resource Test Suite${colors.reset}`);
  console.log(`${colors.gray}${'━'.repeat(60)}${colors.reset}\n`);
  
  info(`Corruption types to test: ${args.corruptionTypes.join(', ')}`);
  info(`Keep test data: ${args.keepData ? 'Yes' : 'No'}\n`);
  
  // Safety check
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') {
    error('Cannot run test suite in production environment!');
    process.exit(1);
  }
  
  await connectDB();
  const models = loadModels();
  
  let testData = null;
  const results = [];
  
  try {
    // Setup: Create test resource
    section('Test Setup');
    info('Creating test resource...');
    testData = await createTestResource();
    success(`Test resource created: ${testData.resourceId}`);
    info(`Entry ID: ${testData.entryId}`);
    info(`Block ID: ${testData.blockId}`);
    
    // Create initial backup for restoration
    info('Creating initial backup...');
    const { Resource, Block } = models;
    const resource = await Resource.findById(testData.resourceId).lean();
    const block = await Block.findById(testData.blockId).lean();
    
    // Get file content
    const storagePath = join(CONFIG.BLOCKS_DIR, 
      block.sha256.substring(0, 2), block.sha256);
    
    let fileContent = null;
    if (existsSync(storagePath)) {
      fileContent = readFileSync(storagePath).toString('base64');
    }
    
    // Create backup
    const backupDir = join(process.cwd(), 'storage', '_corrupt-backup');
    if (!existsSync(backupDir)) {
      mkdirSync(backupDir, { recursive: true });
    }
    
    const backup = {
      timestamp: Date.now(),
      resource: resource,
      block: block,
      resourceId: testData.resourceId,
      fileContent: fileContent,
    };
    
    const backupFile = join(backupDir, `${testData.resourceId}-backup.json`);
    writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    success('Initial backup created');
    
    // Run tests
    section('Running Tests');
    
    for (const corruptionType of args.corruptionTypes) {
      if (args.verbose) {
        console.log();
      }
      
      const result = await runTest(corruptionType, testData, args.verbose);
      results.push(result);
      
      const statusIcon = result.pass ? colors.green + '✓' : colors.red + '✗';
      const statusText = result.pass ? 'PASS' : 'FAIL';
      
      console.log(`${statusIcon} Test: ${corruptionType.padEnd(15)} ${colors.reset}[${statusText}]`);
      
      if (args.verbose) {
        info(`  Expected: ${result.expectedAnomaly}`);
        info(`  Detected: ${result.detected ? 'Yes' : 'No'}`);
        if (result.anomaliesFound.length > 0) {
          info(`  Anomalies found: ${result.anomaliesFound.join(', ')}`);
        }
      }
    }
    
    // Summary
    section('Test Summary');
    
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const total = results.length;
    const coverage = Math.round((passed / total) * 100);
    
    info(`Total Tests:    ${total}`);
    info(`Passed:         ${colors.green}${passed}${colors.reset}`);
    info(`Failed:         ${colors.red}${failed}${colors.reset}`);
    info(`Coverage:       ${coverage}%`);
    
    if (failed > 0) {
      console.log(`\n${colors.red}Failed Tests:${colors.reset}`);
      results.filter(r => !r.pass).forEach(r => {
        console.log(`  ${colors.red}✗${colors.reset} ${r.type}`);
        info(`    Expected: ${r.expectedAnomaly}`);
        info(`    Actual anomalies: ${r.anomaliesFound.join(', ') || 'None'}`);
      });
    }
    
    console.log();
    if (failed === 0) {
      console.log(`${colors.green}${colors.bold}✓ All tests passed!${colors.reset}\n`);
    } else {
      console.log(`${colors.red}${colors.bold}✗ ${failed} test(s) failed${colors.reset}\n`);
    }
    
    // Cleanup
    if (!args.keepData && testData) {
      section('Cleanup');
      info('Deleting test resource...');
      await deleteTestResource(testData.resourceId);
      success('Test data cleaned up');
    } else if (testData) {
      section('Cleanup Skipped');
      info(`Resource ID: ${testData.resourceId}`);
      info(`Entry ID: ${testData.entryId}`);
    }
    
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (err) {
    error(`Error: ${err.message}`);
    console.error(err);
    
    // Cleanup on error
    if (!args.keepData && testData) {
      try {
        await deleteTestResource(testData.resourceId);
      } catch {}
    }
    
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

main().catch(err => {
  console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
  process.exit(1);
});
