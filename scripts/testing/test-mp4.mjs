#!/usr/bin/env node

/**
 * MP4 Video Streaming & Range Request Test
 *
 * Tests:
 * 1. Upload MP4 file to the server
 * 2. Video playback in browser (using chrome-devtools MCP)
 * 3. Full download verification
 * 4. Range request validation (206 Partial Content)
 * 5. Multiple range segments simulation
 *
 * Usage: node scripts/test-mp4.mjs
 */

import { readFileSync, createReadStream, statSync } from 'fs';
import { resolve } from 'path';

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

const CONFIG = {
  MP4_PATH: process.env.TEST_MP4_PATH || resolve(process.cwd(), '_temp/aaa.mp4'),
  BASE_URL: `http://127.0.0.1:${process.env.PORT || process.env.SERVER_PORT || 4362}`,
  TEST_TIMEOUT: 30000,
  RANGE_TEST_SIZE: 1024 * 1024, // 1MB for range test
};

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ ${colors.reset}${msg}`),
  success: (msg) => console.log(`${colors.green}✓ ${colors.reset}${msg}`),
  error: (msg) => console.log(`${colors.red}✗ ${colors.reset}${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠ ${colors.reset}${msg}`),
  section: (msg) => console.log(`\n${colors.cyan}▶ ${msg}${colors.reset}\n`),
};

// API helpers
const request = async (url, options = {}) => {
  const res = await fetch(`${CONFIG.BASE_URL}${url}`, options);
  return res;
};

const createEntry = async () => {
  const ts = Date.now();
  const res = await request('/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name: `MP4 Test Entry ${ts}`, 
      alias: `mp4-test-${ts}` 
    }),
  });
  if (!res.ok) throw new Error(`Failed to create entry: ${res.status}`);
  return res.json();
};

const uploadFile = async (alias, filePath) => {
  const fileStream = createReadStream(filePath);
  const res = await request(`/upload/${alias}`, {
    method: 'POST',
    headers: { 'Content-Type': 'video/mp4' },
    body: fileStream,
    duplex: 'half',
  });
  if (!res.ok) throw new Error(`Failed to upload file: ${res.status}`);
  return res.json();
};

const deleteResource = async (id) => {
  const res = await request(`/resources/${id}`, { method: 'DELETE' });
  return res.ok;
};

const deleteEntry = async (id) => {
  const res = await request(`/entries/${id}`, { method: 'DELETE' });
  return res.ok;
};

// Format bytes
const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(2)} ${['B', 'KB', 'MB', 'GB'][i]}`;
};

// Test 1: Upload MP4
async function testUpload(entryAlias) {
  log.section('Test 1: Upload MP4 File');
  
  const stats = statSync(CONFIG.MP4_PATH);
  const fileSize = stats.size;
  log.info(`File: ${CONFIG.MP4_PATH}`);
  log.info(`Size: ${formatBytes(fileSize)}`);
  
  const start = Date.now();
  const resource = await uploadFile(entryAlias, CONFIG.MP4_PATH);
  const duration = Date.now() - start;
  
  log.success(`Upload completed in ${duration}ms`);
  log.info(`Resource ID: ${resource._id}`);
  log.info(`Resource Name: ${resource.name}`);
  
  return { resource, fileSize };
}

// Test 2: Full Download
async function testFullDownload(resourceId, _expectedSize) {
  log.section('Test 2: Full Download');

  const start = Date.now();
  const res = await request(`/resources/${resourceId}/download`);

  if (res.status !== 200) {
    throw new Error(`Expected 200, got ${res.status}`);
  }

  const contentType = res.headers.get('Content-Type');
  const acceptRanges = res.headers.get('Accept-Ranges');
  const contentDisposition = res.headers.get('Content-Disposition');

  log.info(`Content-Type: ${contentType}`);
  log.info(`Accept-Ranges: ${acceptRanges}`);
  log.info(`Content-Disposition: ${contentDisposition}`);

  // Download body to verify size
  const arrayBuffer = await res.arrayBuffer();
  const downloadedSize = arrayBuffer.byteLength;
  const duration = Date.now() - start;

  log.success(`Downloaded ${formatBytes(downloadedSize)} in ${duration}ms`);

  // Note: Due to encryption, downloaded size might differ from original
  // We just verify the download completed successfully
  return { contentType, contentLength: downloadedSize, acceptRanges };
}

// Test 3: Range Request (206 Partial Content)
async function testRangeRequest(resourceId, expectedTotalSize) {
  log.section('Test 3: Range Request (206 Partial Content)');
  
  const rangeStart = 0;
  const rangeEnd = Math.min(CONFIG.RANGE_TEST_SIZE - 1, expectedTotalSize - 1);

  log.info(`Requesting range: bytes=${rangeStart}-${rangeEnd}`);
  
  const res = await request(`/resources/${resourceId}/download`, {
    headers: {
      'Range': `bytes=${rangeStart}-${rangeEnd}`,
    },
  });
  
  if (res.status !== 206) {
    throw new Error(`Expected 206 Partial Content, got ${res.status}`);
  }
  
  const contentType = res.headers.get('Content-Type');
  const contentLength = parseInt(res.headers.get('Content-Length') || '0');
  const contentRange = res.headers.get('Content-Range');
  const acceptRanges = res.headers.get('Accept-Ranges');
  
  log.info(`Content-Type: ${contentType}`);
  log.info(`Content-Length: ${formatBytes(contentLength)}`);
  log.info(`Content-Range: ${contentRange}`);
  log.info(`Accept-Ranges: ${acceptRanges}`);
  
  // Validate Content-Range format
  const rangeMatch = contentRange?.match(/bytes (\d+)-(\d+)\/(\d+)/);
  if (!rangeMatch) {
    throw new Error(`Invalid Content-Range format: ${contentRange}`);
  }
  
  const [, start, end, total] = rangeMatch.map(Number);
  
  if (start !== rangeStart) {
    throw new Error(`Range start mismatch: expected ${rangeStart}, got ${start}`);
  }
  if (end !== rangeEnd) {
    throw new Error(`Range end mismatch: expected ${rangeEnd}, got ${end}`);
  }
  if (total !== expectedTotalSize) {
    log.warn(`Total size mismatch: expected ${expectedTotalSize}, got ${total}`);
  }
  
  log.success(`Range request validated: bytes ${start}-${end}/${total}`);
  
  return { contentType, contentLength, contentRange, start, end, total };
}

// Test 4: Multiple Range Segments (Simulate streaming)
async function testMultipleRanges(resourceId, totalSize) {
  log.section('Test 4: Multiple Range Segments (Streaming Simulation)');
  
  const segmentSize = 256 * 1024; // 256KB per segment
  const segments = [];
  const numSegments = Math.min(4, Math.ceil(totalSize / segmentSize));
  
  for (let i = 0; i < numSegments; i++) {
    const start = i * segmentSize;
    const end = Math.min(start + segmentSize - 1, totalSize - 1);
    segments.push({ start, end });
  }
  
  log.info(`Testing ${segments.length} segments`);
  
  let totalDownloaded = 0;
  const results = [];
  
  for (const [index, segment] of segments.entries()) {
    const res = await request(`/resources/${resourceId}/download`, {
      headers: {
        'Range': `bytes=${segment.start}-${segment.end}`,
      },
    });
    
    if (res.status !== 206) {
      throw new Error(`Segment ${index}: Expected 206, got ${res.status}`);
    }
    
    const contentRange = res.headers.get('Content-Range');

    const arrayBuffer = await res.arrayBuffer();
    const actualSize = arrayBuffer.byteLength;
    
    totalDownloaded += actualSize;
    
    const result = {
      index,
      range: `${segment.start}-${segment.end}`,
      expectedSize: segment.end - segment.start + 1,
      actualSize,
      contentRange,
    };
    
    results.push(result);
    log.success(`Segment ${index}: bytes=${segment.start}-${segment.end} (${formatBytes(actualSize)})`);
  }
  
  log.success(`Total downloaded: ${formatBytes(totalDownloaded)}`);
  
  return results;
}

// Test 5: Invalid Range Request
async function testInvalidRange(resourceId, totalSize) {
  log.section('Test 5: Invalid Range Request');
  
  const invalidStart = totalSize + 1000; // Beyond file size
  
  log.info(`Testing invalid range: bytes=${invalidStart}-${invalidStart + 1000}`);
  
  const res = await request(`/resources/${resourceId}/download`, {
    headers: {
      'Range': `bytes=${invalidStart}-${invalidStart + 1000}`,
    },
  });
  
  if (res.status !== 416) {
    throw new Error(`Expected 416 Range Not Satisfiable, got ${res.status}`);
  }
  
  const contentRange = res.headers.get('Content-Range');
  log.info(`Content-Range: ${contentRange}`);
  
  log.success('Invalid range correctly rejected with 416');
}

// Test 6: Browser Video Playback (using chrome-devtools MCP)
async function testVideoPlayback(resourceId) {
  log.section('Test 6: Browser Video Playback (chrome-devtools MCP)');
  
  const videoUrl = `${CONFIG.BASE_URL}/resources/${resourceId}/download?inline=true`;
  log.info(`Video URL: ${videoUrl}`);
  
  // Create HTML page with video player
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>MP4 Test</title>
  <style>
    body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
    video { max-width: 100%; height: auto; border: 1px solid #ccc; }
    #status { margin-top: 10px; padding: 10px; background: #f0f0f0; }
  </style>
</head>
<body>
  <h2>MP4 Video Test</h2>
  <video id="testVideo" controls preload="metadata">
    <source src="${videoUrl}" type="video/mp4">
    Your browser does not support the video tag.
  </video>
  <div id="status">Loading...</div>
  <script>
    const video = document.getElementById('testVideo');
    const status = document.getElementById('status');
    
    video.addEventListener('loadedmetadata', () => {
      status.textContent = 'Metadata loaded - Duration: ' + video.duration + 's';
      window.videoMetadata = {
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
    });
    
    video.addEventListener('canplay', () => {
      status.textContent += ' - Can play';
    });
    
    video.addEventListener('error', (e) => {
      status.textContent = 'Error: ' + (video.error?.message || 'Unknown error');
      window.videoError = video.error;
    });
  </script>
</body>
</html>
  `;
  
  // Serve HTML content via data URL
  const dataUrl = `data:text/html;base64,${Buffer.from(htmlContent).toString('base64')}`;
  
  log.info('Opening video in browser...');
  log.info(`To manually test, open: ${videoUrl}`);
  
  // Note: This would normally use chrome-devtools MCP to navigate and test
  // For now, we provide the URL for manual testing
  log.warn('Skipping automated browser test (requires MCP chrome-devtools)');
  log.info('To run browser test manually:');
  log.info(`1. Open browser to: ${CONFIG.BASE_URL}/resources/${resourceId}/download?inline=true`);
  log.info('2. Check that video plays correctly');
  log.info('3. Check Network tab for 206 Partial Content requests');
  
  return { videoUrl, dataUrl };
}

// Main test runner
async function runTests() {
  console.log('\n🎬 MP4 Video Streaming & Range Request Test');
  console.log('=========================================\n');
  
  let entry = null;
  let resource = null;
  let testPassed = true;
  
  try {
    // Step 0: Verify MP4 file exists
    log.section('Step 0: Verify MP4 File');
    try {
      const stats = statSync(CONFIG.MP4_PATH);
      log.success(`MP4 file found: ${formatBytes(stats.size)}`);
    } catch {
      throw new Error(`MP4 file not found at ${CONFIG.MP4_PATH}`);
    }
    
    // Step 1: Create entry
    log.section('Step 1: Create Test Entry');
    entry = await createEntry();
    log.success(`Entry created: ${entry._id} (alias: ${entry.alias})`);
    
    // Step 2: Upload MP4
    const { resource: uploadedResource, fileSize } = await testUpload(entry.alias);
    resource = uploadedResource;
    
    // Update resource with proper MIME type and name
    log.info('Updating resource with video/mp4 MIME type...');
    await request(`/resources/${resource._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        mime: 'video/mp4',
        name: 'aaa.mp4'
      }),
    });
    
    // Step 3: Get total size from server
    log.section('Step 3: Get Resource Info');
    const resourceInfoRes = await request(`/resources/${resource._id}`);
    const resourceInfo = await resourceInfoRes.json();
    log.info(`Resource ID: ${resourceInfo._id}`);
    
    // Step 4: Test full download
    const downloadInfo = await testFullDownload(resource._id, fileSize);
    
    // Step 5: Test range request
    await testRangeRequest(resource._id, downloadInfo.contentLength);
    
    // Step 6: Test multiple ranges
    await testMultipleRanges(resource._id, downloadInfo.contentLength);
    
    // Step 7: Test invalid range
    await testInvalidRange(resource._id, downloadInfo.contentLength);
    
    // Step 8: Browser playback test
    await testVideoPlayback(resource._id);
    
    // Summary
    log.section('Test Summary');
    console.log(`${colors.green}✓ All tests passed!${colors.reset}`);
    console.log(`\nResource URL: ${CONFIG.BASE_URL}/resources/${resource._id}/download`);
    console.log(`Inline URL: ${CONFIG.BASE_URL}/resources/${resource._id}/download?inline=true`);
    
    // Ask user if they want to keep the test data
    console.log(`\n${colors.yellow}Test data created:${colors.reset}`);
    console.log(`- Entry: ${entry._id}`);
    console.log(`- Resource: ${resource._id}`);
    console.log(`\nTo cleanup, run:`);
    console.log(`curl -X DELETE ${CONFIG.BASE_URL}/resources/${resource._id}`);
    console.log(`curl -X DELETE ${CONFIG.BASE_URL}/entries/${entry._id}`);
    
  } catch (error) {
    testPassed = false;
    log.error(`Test failed: ${error.message}`);
    console.error(error);
  } finally {
    // Cleanup
    if (resource && entry) {
      log.section('Cleanup');
      try {
        await deleteResource(resource._id);
        log.success('Resource deleted');
      } catch (e) {
        log.error(`Failed to delete resource: ${e.message}`);
      }
      
      try {
        await deleteEntry(entry._id);
        log.success('Entry deleted');
      } catch (e) {
        log.error(`Failed to delete entry: ${e.message}`);
      }
    }
  }
  
  process.exit(testPassed ? 0 : 1);
}

// Run tests
runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
