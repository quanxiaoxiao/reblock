#!/usr/bin/env node

/**
 * Resource Corruption Tool
 * 
 * Intentionally corrupts Resource/Block data for testing detection capabilities.
 * 
 * Usage:
 *   node scripts/resource-corrupt.mjs --resource-id <id> --type <type> [options]
 *   node scripts/resource-corrupt.mjs --resource-id <id> --restore
 * 
 * Corruption Types:
 *   --type linkcount --value <n>     Modify block.linkCount
 *   --type delete-file               Delete physical file
 *   --type size --value <n>          Modify block.size
 *   --type orphan                    Point resource to non-existent block
 *   --type sha256 --value <hash>     Modify block.sha256
 *   --type invalid-block             Point to soft-deleted block
 * 
 * Options:
 *   --dry-run                        Preview without executing
 *   --backup                         Create backup before corruption (default: true)
 *   --restore                        Restore from backup
 *   --yes                            Skip confirmation
 * 
 * Safety:
 *   - Only works in development/test environment
 *   - Automatic backup before corruption
 *   - Use --restore to revert changes
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, join, dirname } from 'path';
import mongoose from 'mongoose';
import { createHmac, createDecipheriv } from 'crypto';

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
  BACKUP_DIR: join(process.cwd(), 'storage', '_corrupt-backup'),
  ENV: process.env.NODE_ENV || 'development',
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

  // Get encryption key for HMAC path calculation
  CONFIG.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
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
  
  const resourceIdIndex = args.indexOf('--resource-id');
  
  const types = [];
  const values = [];
  
  // Parse multiple --type and --value pairs
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type' && i + 1 < args.length) {
      types.push(args[i + 1]);
    }
    if (args[i] === '--value' && i + 1 < args.length) {
      values.push(args[i + 1]);
    }
  }
  
  return {
    resourceId: resourceIdIndex >= 0 ? args[resourceIdIndex + 1] : null,
    types: types,
    values: values,
    dryRun: args.includes('--dry-run'),
    backup: !args.includes('--no-backup'),
    restore: args.includes('--restore'),
    yes: args.includes('--yes'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

// Print helpers
// eslint-disable-next-line no-unused-vars
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
  console.log(`${colors.gray}${'─'.repeat(50)}${colors.reset}`);
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

// Create backup
async function createBackup(resourceId, models) {
  const { Resource, Block } = models;
  
  const resource = await Resource.findById(resourceId).lean();
  if (!resource) {
    throw new Error(`Resource ${resourceId} not found`);
  }
  
  const block = resource.block ? await Block.findById(resource.block).lean() : null;
  
  const backup = {
    timestamp: Date.now(),
    resource: resource,
    block: block,
    resourceId: resourceId,
  };
  
  // Backup physical file content if exists
  if (block) {
    const storagePath = getStoragePath(block.sha256);
    if (existsSync(storagePath)) {
      const content = readFileSync(storagePath);
      backup.fileContent = content.toString('base64');
    }
  }
  
  if (!existsSync(CONFIG.BACKUP_DIR)) {
    mkdirSync(CONFIG.BACKUP_DIR, { recursive: true });
  }
  
  const backupFile = join(CONFIG.BACKUP_DIR, `${resourceId}-backup.json`);
  writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  
  return backupFile;
}

// Restore from backup
async function restoreFromBackup(resourceId, models) {
  const { Resource, Block } = models;
  
  const backupFile = join(CONFIG.BACKUP_DIR, `${resourceId}-backup.json`);
  
  if (!existsSync(backupFile)) {
    throw new Error(`Backup not found for resource ${resourceId}`);
  }
  
  const backup = JSON.parse(readFileSync(backupFile, 'utf-8'));
  
  // Restore block if exists
  if (backup.block) {
    const existingBlock = await Block.findById(backup.block._id);
    if (existingBlock) {
      await Block.findByIdAndUpdate(backup.block._id, backup.block);
    } else {
      await Block.create(backup.block);
    }
    
    // Restore physical file if backup contains file content
    if (backup.fileContent) {
      const storagePath = getStoragePath(backup.block.sha256);
      const dir = dirname(storagePath);
      
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      writeFileSync(storagePath, Buffer.from(backup.fileContent, 'base64'));
    }
  }
  
  // Restore resource
  const existingResource = await Resource.findById(backup.resource._id);
  if (existingResource) {
    await Resource.findByIdAndUpdate(backup.resource._id, backup.resource);
  } else {
    await Resource.create(backup.resource);
  }
  
  return backup;
}

// Generate storage name from sha256 using HMAC
function generateStorageName(sha256) {
  if (!CONFIG.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY not configured');
  }
  const key = Buffer.from(CONFIG.ENCRYPTION_KEY, 'base64');
  return createHmac('sha256', key).update(sha256).digest('hex');
}

// Get storage path for block using HMAC-based path calculation
function getStoragePath(sha256) {
  const storageName = generateStorageName(sha256);
  const prefix1 = storageName.substring(0, 2);
  const secondChar = storageName.substring(2, 3);
  const relativePath = `${prefix1}/${secondChar}${storageName}`;
  return join(CONFIG.BLOCKS_DIR, relativePath);
}

// Generate IV from MongoDB ObjectId (12 bytes + 4 zero bytes padding = 16 bytes for AES)
function generateIV(objectId) {
  const objectIdBuffer = Buffer.isBuffer(objectId)
    ? objectId
    : Buffer.from(objectId.toString(), 'hex');
  return Buffer.concat([objectIdBuffer, Buffer.from([0, 0, 0, 0])]);
}

// Corruption functions
const corruptions = {
  async linkcount(resource, block, value, models) {
    const { Block } = models;
    const newValue = parseInt(value);
    if (isNaN(newValue)) {
      throw new Error(`Invalid value for linkcount: ${value}`);
    }
    
    const oldValue = block.linkCount;
    await Block.findByIdAndUpdate(block._id, { linkCount: newValue });
    
    return {
      type: 'linkcount',
      description: `Changed block.linkCount from ${oldValue} to ${newValue}`,
      oldValue,
      newValue,
    };
  },
  
  async 'delete-file'(resource, block, _value, _models) {
    const storagePath = getStoragePath(block.sha256);
    
    if (!existsSync(storagePath)) {
      throw new Error(`Physical file already missing: ${storagePath}`);
    }
    
    // Store file content in backup for restoration
    const content = readFileSync(storagePath);
    
    // Update backup file with file content before deleting
    const backupFile = join(CONFIG.BACKUP_DIR, `${resource._id.toString()}-backup.json`);
    if (existsSync(backupFile)) {
      const backup = JSON.parse(readFileSync(backupFile, 'utf-8'));
      backup.fileContent = content.toString('base64');
      writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    }
    
    unlinkSync(storagePath);
    
    return {
      type: 'delete-file',
      description: `Deleted physical file at ${storagePath}`,
      path: storagePath,
      content: content.toString('base64'), // Store for restoration
    };
  },
  
  async size(resource, block, value, models) {
    const { Block } = models;
    const newValue = parseInt(value);
    if (isNaN(newValue)) {
      throw new Error(`Invalid value for size: ${value}`);
    }
    
    const oldValue = block.size;
    await Block.findByIdAndUpdate(block._id, { size: newValue });
    
    return {
      type: 'size',
      description: `Changed block.size from ${oldValue} to ${newValue}`,
      oldValue,
      newValue,
    };
  },
  
  async orphan(resource, block, value, models) {
    const { Resource } = models;
    const fakeBlockId = new mongoose.Types.ObjectId();
    
    await Resource.findByIdAndUpdate(resource._id, { block: fakeBlockId });
    
    return {
      type: 'orphan',
      description: `Changed resource.block to non-existent ID: ${fakeBlockId}`,
      fakeBlockId: fakeBlockId.toString(),
    };
  },
  
  async sha256(resource, block, value, models) {
    const { Block } = models;
    const oldValue = block.sha256;
    
    await Block.findByIdAndUpdate(block._id, { sha256: value });
    
    return {
      type: 'sha256',
      description: `Changed block.sha256 from ${oldValue} to ${value}`,
      oldValue,
      newValue: value,
    };
  },
  
  async 'invalid-block'(resource, block, value, models) {
    const { Block, Resource } = models;
    
    // Create a soft-deleted block
    const deletedBlock = await Block.create({
      sha256: 'deleted-' + Date.now(),
      size: 0,
      linkCount: 0,
      isInvalid: true,
      invalidatedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    await Resource.findByIdAndUpdate(resource._id, { block: deletedBlock._id });
    
    return {
      type: 'invalid-block',
      description: `Changed resource.block to soft-deleted block: ${deletedBlock._id}`,
      deletedBlockId: deletedBlock._id.toString(),
    };
  },
};

// Main function
async function main() {
  const args = parseArgs();
  
  if (args.help) {
    console.log(`
${colors.cyan}Resource Corruption Tool${colors.reset}

Usage:
  node scripts/resource-corrupt.mjs --resource-id <id> --type <type> [options]
  node scripts/resource-corrupt.mjs --resource-id <id> --restore

Corruption Types:
  --type linkcount --value <n>     Modify block.linkCount
  --type delete-file               Delete physical file
  --type size --value <n>          Modify block.size  
  --type orphan                    Point resource to non-existent block
  --type sha256 --value <hash>     Modify block.sha256
  --type invalid-block             Point to soft-deleted block

Options:
  --dry-run                        Preview without executing
  --no-backup                      Skip backup creation
  --restore                        Restore from backup
  --yes                            Skip confirmation
  --help                           Show this help

Examples:
  node scripts/resource-corrupt.mjs --resource-id abc123 --type linkcount --value 0
  node scripts/resource-corrupt.mjs --resource-id abc123 --type delete-file --yes
  node scripts/resource-corrupt.mjs --resource-id abc123 --restore
`);
    process.exit(0);
  }
  
  // Safety check
  if (CONFIG.ENV === 'production') {
    error('This tool cannot be used in production environment!');
    process.exit(1);
  }
  
  if (!args.resourceId) {
    error('Resource ID is required. Use --resource-id <id>');
    process.exit(1);
  }
  
  console.log(`${colors.cyan}${colors.bold}🔧 Resource Corruption Tool${colors.reset}`);
  console.log(`${colors.gray}${'━'.repeat(50)}${colors.reset}\n`);
  
  await connectDB();
  const models = loadModels();
  
  try {
    if (args.restore) {
      section('Restoring from Backup');
      const backup = await restoreFromBackup(args.resourceId, models);
      success(`Resource ${args.resourceId} restored successfully`);
      info(`Backup from: ${new Date(backup.timestamp).toISOString()}`);
      process.exit(0);
    }
    
    // Get resource
    const resource = await models.Resource.findById(args.resourceId).populate('block');
    if (!resource) {
      error(`Resource ${args.resourceId} not found`);
      process.exit(2);
    }
    
    const block = resource.block;
    if (!block) {
      error(`Resource has no associated block`);
      process.exit(2);
    }
    
    section('Current State');
    info(`Resource ID: ${resource._id}`);
    info(`Name: ${resource.name || '(empty)'}`);
    info(`Block ID: ${block._id}`);
    info(`SHA256: ${block.sha256.substring(0, 16)}...`);
    info(`Link Count: ${block.linkCount}`);
    info(`Size: ${block.size} bytes`);
    info(`Status: ${resource.isInvalid ? 'Deleted' : 'Active'}`);
    
    if (args.types.length === 0) {
      error('No corruption type specified. Use --type <type>');
      process.exit(1);
    }
    
    section('Planned Corruptions');
    const plannedCorruptions = [];
    
    for (let i = 0; i < args.types.length; i++) {
      const type = args.types[i];
      const value = args.values[i] || null;
      
      if (!corruptions[type]) {
        error(`Unknown corruption type: ${type}`);
        continue;
      }
      
      plannedCorruptions.push({ type, value });
      info(`${i + 1}. [${type}] ${value ? `with value: ${value}` : ''}`);
    }
    
    if (plannedCorruptions.length === 0) {
      error('No valid corruptions planned');
      process.exit(1);
    }
    
    // Create backup
    if (args.backup && !args.dryRun) {
      section('Creating Backup');
      const backupFile = await createBackup(args.resourceId, models);
      success(`Backup created: ${backupFile}`);
    }
    
    // Dry run
    if (args.dryRun) {
      section('Dry Run Mode');
      warn('No changes will be made. Use without --dry-run to execute.');
      process.exit(0);
    }
    
    // Confirmation
    if (!args.yes) {
      section('Confirmation Required');
      warn(`You are about to corrupt Resource ${args.resourceId}`);
      warn('This may cause data inconsistencies!');
      
      // Note: In a real implementation, you'd use readline here
      // For now, we'll require --yes flag
      error('Use --yes flag to confirm execution');
      process.exit(1);
    }
    
    // Execute corruptions
    section('Executing Corruptions');
    const results = [];
    
    for (const { type, value } of plannedCorruptions) {
      try {
        const result = await corruptions[type](resource, block, value, models);
        results.push(result);
        success(`Corruption complete: ${result.description}`);
      } catch (err) {
        error(`Failed to apply ${type}: ${err.message}`);
      }
    }
    
    // Summary
    section('Summary');
    info(`Resource ID: ${args.resourceId}`);
    info(`Corruptions applied: ${results.length}`);
    info(`Expected anomalies: ${results.map(r => r.type.toUpperCase()).join(', ')}`);
    
    if (args.backup) {
      info(`To restore: node scripts/resource-corrupt.mjs --resource-id ${args.resourceId} --restore`);
    }
    
    console.log(`\n${colors.green}${colors.bold}✓ Corruptions applied successfully${colors.reset}`);
    console.log(`${colors.yellow}⚠ Remember to run resource-report to verify detection${colors.reset}\n`);
    
  } catch (err) {
    error(`Error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await disconnectDB();
  }
}

main().catch(err => {
  console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`);
  process.exit(1);
});
