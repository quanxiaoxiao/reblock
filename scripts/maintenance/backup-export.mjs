#!/usr/bin/env node

import { join, resolve } from 'path';
import {
  buildChecksums,
  composePsContainerId,
  createTarGz,
  directorySizeBytes,
  encryptWithOpenSSL,
  ensureDir,
  exec,
  formatBytes,
  getContainerImage,
  isContainerRunning,
  loadEnvFile,
  nowStamp,
  parseArgs,
  removePath,
  requireEnv,
  sha256File,
  shellEscape,
} from './backup-common.mjs';
import { writeFileSync } from 'fs';

function usage() {
  console.log(`Reblock backup export

Usage:
  node scripts/maintenance/backup-export.mjs [options]

Options:
  --app-env <path>        App env file (default: .env.reblock.prod)
  --mongo-env <path>      Mongo env file (default: .env.mongo.reblock)
  --out-dir <dir>         Output directory (default: backup)
  --name <name>           Backup base name (default: reblock-backup-<timestamp>)
  --passphrase <text>     Encryption passphrase (or use BACKUP_PASSPHRASE env)
  --app-compose <path>    App compose file (default: docker-compose.app.yml)
  --mongo-compose <path>  Mongo compose file (default: docker-compose.mongo.yml)
  --app-service <name>    App service name (default: app)
  --mongo-service <name>  Mongo service name (default: mongodb)
  --storage-path <path>   Storage path inside app container (default: /app/storage)
  --help                  Show this help
`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    usage();
    return;
  }

  const appEnvFile = args['app-env'] || '.env.reblock.prod';
  const mongoEnvFile = args['mongo-env'] || '.env.mongo.reblock';
  const outDir = resolve(process.cwd(), args['out-dir'] || 'backup');
  const appComposeFile = args['app-compose'] || 'docker-compose.app.yml';
  const mongoComposeFile = args['mongo-compose'] || 'docker-compose.mongo.yml';
  const appService = args['app-service'] || 'app';
  const mongoService = args['mongo-service'] || 'mongodb';
  const storagePath = args['storage-path'] || '/app/storage';
  const passphrase = args.passphrase || process.env.BACKUP_PASSPHRASE;

  if (!passphrase) {
    throw new Error('Missing backup passphrase. Use --passphrase or BACKUP_PASSPHRASE env');
  }

  loadEnvFile(appEnvFile);
  loadEnvFile(mongoEnvFile);

  const mongoDatabase = requireEnv('MONGO_DATABASE');
  const mongoUsername = requireEnv('MONGO_USERNAME');
  const mongoPassword = requireEnv('MONGO_PASSWORD');
  const mongoAuthDb = process.env.MONGO_AUTH_SOURCE || mongoDatabase;

  const stamp = nowStamp();
  const backupName = args.name || `reblock-backup-${stamp}`;
  const stagingRoot = join(outDir, `.staging-${backupName}`);
  const mongoDir = join(stagingRoot, 'mongo');
  const storageDir = join(stagingRoot, 'storage');
  const storageRawDir = join(storageDir, 'raw');

  ensureDir(outDir);
  removePath(stagingRoot);
  ensureDir(mongoDir);
  ensureDir(storageDir);
  ensureDir(storageRawDir);

  const appContainerId = composePsContainerId(appComposeFile, appEnvFile, appService);
  if (!appContainerId) {
    throw new Error(`App container not found via compose service '${appService}'`);
  }
  if (isContainerRunning(appContainerId)) {
    throw new Error('App container is running. Stop app first to enter maintenance window');
  }

  const mongoContainerId = composePsContainerId(mongoComposeFile, mongoEnvFile, mongoService);
  if (!mongoContainerId || !isContainerRunning(mongoContainerId)) {
    throw new Error(`Mongo container is not running for compose service '${mongoService}'`);
  }

  console.log('1/6 Exporting MongoDB dump...');
  const dumpInContainer = '/tmp/reblock-mongo-dump.archive.gz';
  const dumpLocal = join(mongoDir, 'dump.archive.gz');
  exec(
    `docker exec ${shellEscape(mongoContainerId)} mongodump --host 127.0.0.1 --port 27017 --username ${shellEscape(mongoUsername)} --password ${shellEscape(mongoPassword)} --authenticationDatabase ${shellEscape(mongoAuthDb)} --db ${shellEscape(mongoDatabase)} --archive=${shellEscape(dumpInContainer)} --gzip`
  );
  exec(`docker cp ${shellEscape(`${mongoContainerId}:${dumpInContainer}`)} ${shellEscape(dumpLocal)}`);
  exec(`docker exec ${shellEscape(mongoContainerId)} rm -f ${shellEscape(dumpInContainer)}`);

  console.log('2/6 Exporting Reblock storage volume...');
  exec(`docker cp ${shellEscape(`${appContainerId}:${storagePath}/.`)} ${shellEscape(storageRawDir)}`);
  const storageTar = join(storageDir, 'storage.tar.gz');
  createTarGz(storageRawDir, storageTar);
  removePath(storageRawDir);

  console.log('3/6 Building manifest/checksums...');
  const appImageTag = getContainerImage(appContainerId);
  const mongoHash = await sha256File(dumpLocal);
  const storageHash = await sha256File(storageTar);

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    appImageTag,
    mongo: {
      database: mongoDatabase,
      dumpFile: 'mongo/dump.archive.gz',
    },
    storage: {
      path: storagePath,
      archiveFile: 'storage/storage.tar.gz',
    },
    hashes: {
      'mongo/dump.archive.gz': mongoHash,
      'storage/storage.tar.gz': storageHash,
    },
    requiresSecrets: ['ENCRYPTION_KEY', 'API_AUTH_TOKEN', 'MONGO_PASSWORD'],
  };
  const manifestFile = join(stagingRoot, 'manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  await buildChecksums(stagingRoot, [
    'manifest.json',
    'mongo/dump.archive.gz',
    'storage/storage.tar.gz',
  ]);

  console.log('4/6 Creating backup package...');
  const plainPackage = join(outDir, `${backupName}.tar.gz`);
  createTarGz(stagingRoot, plainPackage);

  console.log('5/6 Encrypting backup package...');
  const encryptedPackage = `${plainPackage}.enc`;
  encryptWithOpenSSL(plainPackage, encryptedPackage, passphrase);
  removePath(plainPackage);

  console.log('6/6 Cleaning temporary files...');
  removePath(stagingRoot);

  const encryptedSha = await sha256File(encryptedPackage);
  writeFileSync(`${encryptedPackage}.sha256`, `${encryptedSha}  ${backupName}.tar.gz.enc\n`, 'utf-8');

  const pkgSize = formatBytes(directorySizeBytes(outDir));
  console.log('\nBackup export completed.');
  console.log(`- Package: ${encryptedPackage}`);
  console.log(`- Package SHA256 file: ${encryptedPackage}.sha256`);
  console.log(`- Output directory size: ${pkgSize}`);
}

main().catch((error) => {
  console.error(`Backup export failed: ${error.message}`);
  process.exit(1);
});
