#!/usr/bin/env node
/**
 * OpenAPI Export Script
 * 
 * Exports the OpenAPI specification from the running application
 * and saves it to openapi.json for version control and documentation.
 * 
 * Usage:
 *   node scripts/export-openapi.mjs           # Export to ./openapi.json
 *   node scripts/export-openapi.mjs --check   # Check if openapi.json is up to date (for CI)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const API_PORT = process.env.PORT || 3000;
const API_HOST = process.env.HOST || 'localhost';
const OPENAPI_URL = `http://${API_HOST}:${API_PORT}/openapi.json`;
const OUTPUT_FILE = path.join(projectRoot, 'openapi.json');

async function exportOpenAPI() {
  console.log('📄 Exporting OpenAPI specification...');
  console.log(`   URL: ${OPENAPI_URL}`);
  
  try {
    const response = await fetch(OPENAPI_URL);
    
    if (!response.ok) {
      console.error(`❌ Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
      console.error('   Make sure the server is running (npm run dev or npm start)');
      process.exit(1);
    }
    
    const spec = await response.json();
    
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
    console.error('   Make sure the server is running (npm run dev or npm start)');
    process.exit(1);
  }
}

async function checkOpenAPI() {
  console.log('🔍 Checking if openapi.json is up to date...');
  
  try {
    // Read current file
    const currentContent = await fs.readFile(OUTPUT_FILE, 'utf-8');
    const currentSpec = JSON.parse(currentContent);
    
    // Fetch latest spec
    const response = await fetch(OPENAPI_URL);
    if (!response.ok) {
      console.error(`❌ Failed to fetch OpenAPI spec: ${response.status} ${response.statusText}`);
      process.exit(1);
    }
    
    const latestSpec = await response.json();
    
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
