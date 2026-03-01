# Rule: Scripts Generation Standards

## Overview

All scripts in the `scripts/` directory must follow these standards for configuration loading and environment setup.

## Configuration Loading

### Required Pattern

All scripts must include a standardized `loadEnv()` function:

```javascript
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load environment variables from .env file
 * This ensures scripts can read configuration consistently
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
    // Ignore if .env doesn't exist - environment may already be configured
  }
}

// Call at script start
loadEnv();
```

## Required Configuration

### API Server Configuration

Scripts making HTTP requests must construct the base URL from environment variables:

```javascript
const CONFIG = {
  API_BASE: '',
  PORT: 0,
  MONGO_URI: '',
};

function initializeConfig() {
  // Port: PORT takes precedence over SERVER_PORT
  CONFIG.PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000');
  CONFIG.API_BASE = `http://localhost:${CONFIG.PORT}`;
  
  // MongoDB configuration
  const mongoHost = process.env.MONGO_HOSTNAME || 'localhost';
  const mongoPort = process.env.MONGO_PORT || '27017';
  const mongoDb = process.env.MONGO_DATABASE || 'reblock';
  const mongoUser = process.env.MONGO_USERNAME;
  const mongoPass = process.env.MONGO_PASSWORD;
  
  const auth = mongoUser && mongoPass ? `${mongoUser}:${mongoPass}@` : '';
  const authSource = auth ? '?authSource=admin' : '';
  CONFIG.MONGO_URI = `mongodb://${auth}${mongoHost}:${mongoPort}/${mongoDb}${authSource}`;
}

// Initialize after loadEnv()
initializeConfig();
```

### Storage Paths

Scripts accessing storage must respect environment configuration:

```javascript
const STORAGE_CONFIG = {
  TEMP_DIR: process.env.STORAGE_TEMP_DIR || './storage/_temp',
  BLOCK_DIR: process.env.STORAGE_BLOCK_DIR || './storage/blocks',
  LOG_DIR: process.env.STORAGE_LOG_DIR || './storage/_logs',
};
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Server port (takes precedence over SERVER_PORT) |
| `SERVER_PORT` | No | 3000 | Alternative server port variable |
| `MONGO_HOSTNAME` | No | localhost | MongoDB host |
| `MONGO_PORT` | No | 27017 | MongoDB port |
| `MONGO_DATABASE` | No | reblock | MongoDB database name |
| `MONGO_USERNAME` | No | - | MongoDB username (optional) |
| `MONGO_PASSWORD` | No | - | MongoDB password (optional) |
| `STORAGE_TEMP_DIR` | No | ./storage/_temp | Temporary file storage |
| `STORAGE_BLOCK_DIR` | No | ./storage/blocks | Block file storage |
| `STORAGE_LOG_DIR` | No | ./storage/_logs | Log file storage |
| `ENCRYPTION_KEY` | Yes | - | File encryption key (base64) |
| `CLEANUP_DEFAULT_DAYS` | No | 30 | Default cleanup threshold |
| `LOG_TTL_DAYS` | No | 90 | Log retention period |
| `LOG_ARCHIVE_DAYS` | No | 30 | Log archive threshold |

## Script Template

Use this template for new scripts:

```javascript
#!/usr/bin/env node

/**
 * [Script Name] - [Brief Description]
 *
 * [Detailed description of what the script does]
 *
 * Usage:
 *   node scripts/[name].mjs [options]
 *
 * Options:
 *   --help, -h     Show help
 *   [other options...]
 *
 * Environment:
 *   Requires .env file with PORT, MONGO_* variables configured
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Configuration
const CONFIG = {
  API_BASE: '',
  PORT: 0,
  MONGO_URI: '',
  STORAGE: {},
};

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

// Initialize configuration from environment
function initializeConfig() {
  CONFIG.PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000');
  CONFIG.API_BASE = `http://localhost:${CONFIG.PORT}`;
  
  const mongoHost = process.env.MONGO_HOSTNAME || 'localhost';
  const mongoPort = process.env.MONGO_PORT || '27017';
  const mongoDb = process.env.MONGO_DATABASE || 'reblock';
  const mongoUser = process.env.MONGO_USERNAME;
  const mongoPass = process.env.MONGO_PASSWORD;
  
  const auth = mongoUser && mongoPass ? `${mongoUser}:${mongoPass}@` : '';
  const authSource = auth ? '?authSource=admin' : '';
  CONFIG.MONGO_URI = `mongodb://${auth}${mongoHost}:${mongoPort}/${mongoDb}${authSource}`;
  
  CONFIG.STORAGE = {
    TEMP_DIR: process.env.STORAGE_TEMP_DIR || './storage/_temp',
    BLOCK_DIR: process.env.STORAGE_BLOCK_DIR || './storage/blocks',
    LOG_DIR: process.env.STORAGE_LOG_DIR || './storage/_logs',
  };
}

// Parse command line arguments
function parseArgs() {
  return {
    help: process.argv.includes('--help') || process.argv.includes('-h'),
    // Add other options here
  };
}

// Main function
async function main() {
  const args = parseArgs();
  
  if (args.help) {
    console.log(`
[Script Name]

Usage:
  node scripts/[name].mjs [options]

Options:
  --help, -h     Show this help
`);
    process.exit(0);
  }
  
  loadEnv();
  initializeConfig();
  
  console.log(`API Base: ${CONFIG.API_BASE}`);
  console.log(`MongoDB: ${CONFIG.MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
  
  // Script logic here
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
```

## Validation Checklist

Before committing a new script, verify:

- [ ] Includes `loadEnv()` function
- [ ] Reads `PORT` or `SERVER_PORT` for API base URL
- [ ] Reads MongoDB configuration from environment
- [ ] Uses environment variables for storage paths
- [ ] Has clear usage documentation in header comments
- [ ] Parses command line arguments
- [ ] Has proper error handling
- [ ] Exits with appropriate exit codes (0=success, 1=error)

## Examples

### API Client Script

```javascript
// Construct API URL from environment
const apiUrl = `${CONFIG.API_BASE}/resources/${resourceId}`;
const response = await fetch(apiUrl);
```

### Database Script

```javascript
import mongoose from 'mongoose';

await mongoose.connect(CONFIG.MONGO_URI);
```

### Storage Access Script

```javascript
import { join } from 'path';

const logFile = join(CONFIG.STORAGE.LOG_DIR, 'issues', '2024-01-15.jsonl');
```

## Common Patterns

### HTTP Request Helper

```javascript
async function api(method, endpoint, body = null, headers = {}) {
  const url = `${CONFIG.API_BASE}${endpoint}`;
  const options = {
    method,
    headers: { ...headers },
  };

  if (body) {
    if (body instanceof Buffer) {
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
  }

  const response = await fetch(url, options);
  const data = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : await response.text();

  return { status: response.status, ok: response.ok, data };
}
```

### MongoDB Connection Helper

```javascript
async function connectDB() {
  await mongoose.connect(CONFIG.MONGO_URI);
  console.log('Connected to MongoDB:', CONFIG.MONGO_URI.split('/').pop().split('?')[0]);
}

async function disconnectDB() {
  await mongoose.disconnect();
}
```

## Error Handling

Scripts should handle missing environment gracefully:

```javascript
// Check required variables
const required = ['ENCRYPTION_KEY'];
const missing = required.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error (missing env vars) |
| 3 | Connection error (database, API unavailable) |

## Notes

- Always call `loadEnv()` before accessing `process.env`
- Mask sensitive data (passwords, keys) in console output
- Use `parseInt()` for numeric environment variables
- Provide sensible defaults for optional configuration
- Document all environment dependencies in script header
