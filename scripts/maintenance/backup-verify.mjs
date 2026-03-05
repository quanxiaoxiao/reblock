#!/usr/bin/env node

import { join, resolve } from 'path';
import {
  decryptWithOpenSSL,
  ensureDir,
  extractTarGz,
  loadEnvFile,
  parseArgs,
  readChecksumsFile,
  removePath,
  sha256File,
  verifyRequiredFiles,
} from './backup-common.mjs';
import { readFileSync } from 'fs';

function usage() {
  console.log(`Reblock backup verify

Usage:
  node scripts/maintenance/backup-verify.mjs --file <backup.tar.gz.enc> [options]

Options:
  --file <path>          Encrypted backup package path (required)
  --passphrase <text>    Encryption passphrase (or BACKUP_PASSPHRASE env)
  --app-env <path>       App env file (default: .env.reblock.prod)
  --mongo-env <path>     Mongo env file (default: .env.mongo.reblock)
  --help                 Show this help
`);
}

async function verifyChecksums(extractDir) {
  const checksumFile = join(extractDir, 'checksums.sha256');
  const expected = readChecksumsFile(checksumFile);

  for (const [relativePath, checksum] of Object.entries(expected)) {
    const actual = await sha256File(join(extractDir, relativePath));
    if (actual !== checksum) {
      throw new Error(`Checksum mismatch for ${relativePath}`);
    }
  }
}

function verifyManifest(extractDir) {
  const manifestRaw = readFileSync(join(extractDir, 'manifest.json'), 'utf-8');
  const manifest = JSON.parse(manifestRaw);

  if (!manifest.version || !manifest.createdAt || !manifest.mongo || !manifest.storage) {
    throw new Error('Invalid manifest structure');
  }
  if (!manifest.mongo.database) {
    throw new Error('manifest.mongo.database missing');
  }
  if (!manifest.hashes || typeof manifest.hashes !== 'object') {
    throw new Error('manifest.hashes missing');
  }
  if (!Array.isArray(manifest.requiresSecrets)) {
    throw new Error('manifest.requiresSecrets missing');
  }

  return manifest;
}

function verifySecrets(manifest, appEnvFile, mongoEnvFile) {
  loadEnvFile(appEnvFile);
  loadEnvFile(mongoEnvFile);

  const secretChecks = {
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    API_AUTH_TOKEN: process.env.API_AUTH_TOKEN,
    MONGO_PASSWORD: process.env.MONGO_PASSWORD || process.env.MONGO_APP_PASSWORD,
  };

  for (const secretName of manifest.requiresSecrets) {
    if (!secretChecks[secretName]) {
      throw new Error(`Required secret not found in env files: ${secretName}`);
    }
  }
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const encryptedFile = args.file;
  if (!encryptedFile) {
    usage();
    throw new Error('--file is required');
  }

  const passphrase = args.passphrase || process.env.BACKUP_PASSPHRASE;
  if (!passphrase) {
    throw new Error('Missing backup passphrase. Use --passphrase or BACKUP_PASSPHRASE env');
  }

  const appEnvFile = args['app-env'] || '.env.reblock.prod';
  const mongoEnvFile = args['mongo-env'] || '.env.mongo.reblock';
  const absEncryptedFile = resolve(process.cwd(), encryptedFile);
  const workDir = join(resolve(process.cwd(), 'backup'), `.verify-${Date.now()}`);
  const decryptedTar = join(workDir, 'payload.tar.gz');
  const extractDir = join(workDir, 'extract');

  ensureDir(workDir);
  ensureDir(extractDir);

  try {
    console.log('1/5 Decrypting backup package...');
    decryptWithOpenSSL(absEncryptedFile, decryptedTar, passphrase);

    console.log('2/5 Extracting package...');
    extractTarGz(decryptedTar, extractDir);

    console.log('3/5 Verifying required files...');
    verifyRequiredFiles(extractDir, [
      'manifest.json',
      'checksums.sha256',
      'mongo/dump.archive.gz',
      'storage/storage.tar.gz',
    ]);

    console.log('4/5 Verifying checksums...');
    await verifyChecksums(extractDir);

    console.log('5/5 Verifying required secrets in env files...');
    const manifest = verifyManifest(extractDir);
    verifySecrets(manifest, appEnvFile, mongoEnvFile);

    console.log('\nBackup verify passed.');
    console.log(`- Package: ${absEncryptedFile}`);
    console.log(`- Database: ${manifest.mongo.database}`);
    console.log(`- Created at: ${manifest.createdAt}`);
  } finally {
    removePath(workDir);
  }
}

main().catch((error) => {
  console.error(`Backup verify failed: ${error.message}`);
  process.exit(1);
});
