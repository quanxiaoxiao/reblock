#!/usr/bin/env node
/**
 * OpenAPI Export Script
 * 
 * Exports the OpenAPI specification directly from the app instance
 * and saves it to openapi.json for version control and documentation.
 * 
 * Usage:
 *   node scripts/export-openapi.mjs           # Export to ./openapi.json
 *   node scripts/export-openapi.mjs --check   # Check if openapi.json is up to date (for CI)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(projectRoot, 'openapi.json');
const DIST_APP_FILE = path.join(projectRoot, 'dist', 'app.js');

function runBuild() {
  console.log('🔧 Building project for OpenAPI export...');
  const result = spawnSync('npm', ['run', '-s', 'build'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    console.error('❌ Build failed, cannot export OpenAPI spec');
    process.exit(result.status || 1);
  }
}

async function generateSpec() {
  // Keep docs route available when environment is not explicitly set.
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
  }

  runBuild();

  const appModulePath = `${pathToFileURL(DIST_APP_FILE).href}?ts=${Date.now()}`;
  const appModule = await import(appModulePath);
  const app = appModule.default?.fetch
    ? appModule.default
    : appModule.default?.default;

  if (!app || typeof app.fetch !== 'function') {
    throw new Error('Failed to load app instance from dist/app.js');
  }

  const response = await app.fetch(new Request('http://localhost/openapi.json'));
  if (!response.ok) {
    throw new Error(`Failed to generate OpenAPI spec: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function exportOpenAPI() {
  console.log('📄 Exporting OpenAPI specification...');

  try {
    const spec = await generateSpec();

    // Pretty print with 2-space indentation
    const specJson = JSON.stringify(spec, null, 2);

    // Write to file
    await fs.writeFile(OUTPUT_FILE, specJson, 'utf-8');

    console.log(`✅ OpenAPI spec exported to: ${path.relative(projectRoot, OUTPUT_FILE)}`);
    console.log(`   Paths: ${Object.keys(spec.paths || {}).length}`);
    console.log(`   Schemas: ${Object.keys(spec.components?.schemas || {}).length}`);

    return spec;
  } catch (error) {
    console.error('❌ Error exporting OpenAPI spec:', error.message);
    process.exit(1);
  }
}

async function checkOpenAPI() {
  console.log('🔍 Checking if openapi.json is up to date...');
  
  try {
    // Read current file
    const currentContent = await fs.readFile(OUTPUT_FILE, 'utf-8');
    const currentSpec = JSON.parse(currentContent);

    // Generate latest spec
    const latestSpec = await generateSpec();

    // Compare (remove servers field as it may differ)
    const currentCopy = { ...currentSpec };
    const latestCopy = { ...latestSpec };
    delete currentCopy.servers;
    delete latestCopy.servers;
    
    const currentJson = JSON.stringify(currentCopy, null, 2);
    const latestJson = JSON.stringify(latestCopy, null, 2);
    
    if (currentJson === latestJson) {
      console.log('✅ openapi.json is up to date');
      process.exit(0);
    } else {
      console.error('❌ openapi.json is out of date');
      console.error('   Run: node scripts/export-openapi.mjs');
      console.error('   Then commit the changes to openapi.json');
      process.exit(1);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ openapi.json not found');
      console.error('   Run: node scripts/export-openapi.mjs');
      process.exit(1);
    }
    console.error('❌ Error checking OpenAPI spec:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const shouldCheck = args.includes('--check');

if (shouldCheck) {
  checkOpenAPI();
} else {
  exportOpenAPI();
}
