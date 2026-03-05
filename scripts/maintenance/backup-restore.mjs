#!/usr/bin/env node

import { createInterface } from 'readline';
import { join, resolve } from 'path';
import {
  composePsContainerId,
  decryptWithOpenSSL,
  ensureDir,
  exec,
  extractTarGz,
  getContainerImage,
  isContainerRunning,
  loadEnvFile,
  parseArgs,
  readChecksumsFile,
  removePath,
  requireEnv,
  sha256File,
  shellEscape,
  verifyRequiredFiles,
} from './backup-common.mjs';
import { readFileSync } from 'fs';

function usage() {
  console.log(`Reblock backup restore

Usage:
  node scripts/maintenance/backup-restore.mjs --file <backup.tar.gz.enc> [options]

Options:
  --file <path>          Encrypted backup package path (required)
  --passphrase <text>    Encryption passphrase (or BACKUP_PASSPHRASE env)
  --app-env <path>       App env file (default: .env.reblock.prod)
  --mongo-env <path>     Mongo env file (default: .env.mongo.reblock)
  --app-compose <path>   App compose file (default: docker-compose.app.yml)
  --mongo-compose <path> Mongo compose file (default: docker-compose.mongo.yml)
  --app-service <name>   App service name (default: app)
  --mongo-service <name> Mongo service name (default: mongodb)
  --yes                  Skip interactive confirmation
  --force                Skip manifest database safety check
  --help                 Show this help
`);
}

function askConfirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer.trim());
    });
  });
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

function readManifest(extractDir) {
  const manifestRaw = readFileSync(join(extractDir, 'manifest.json'), 'utf-8');
  return JSON.parse(manifestRaw);
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
  const appComposeFile = args['app-compose'] || 'docker-compose.app.yml';
  const mongoComposeFile = args['mongo-compose'] || 'docker-compose.mongo.yml';
  const appService = args['app-service'] || 'app';
  const mongoService = args['mongo-service'] || 'mongodb';

  loadEnvFile(appEnvFile);
  loadEnvFile(mongoEnvFile);

  const mongoDatabase = requireEnv('MONGO_DATABASE');
  const mongoHost = requireEnv('MONGO_HOSTNAME');
  const mongoPort = process.env.MONGO_PORT || '27017';
  const appMongoUsername = process.env.MONGO_USERNAME;
  const appMongoPassword = process.env.MONGO_PASSWORD;

  const mongoRootUsername = process.env.MONGO_ROOT_USERNAME;
  const mongoRootPassword = process.env.MONGO_ROOT_PASSWORD;

  const absEncryptedFile = resolve(process.cwd(), encryptedFile);
  const workDir = join(resolve(process.cwd(), 'backup'), `.restore-${Date.now()}`);
  const decryptedTar = join(workDir, 'payload.tar.gz');
  const extractDir = join(workDir, 'extract');

  ensureDir(workDir);
  ensureDir(extractDir);

  const appContainerId = composePsContainerId(appComposeFile, appEnvFile, appService);
  if (!appContainerId) {
    throw new Error(`App container not found via compose service '${appService}'`);
  }
  if (isContainerRunning(appContainerId)) {
    throw new Error('App container is running. Stop app first before restore');
  }

  const mongoContainerId = composePsContainerId(mongoComposeFile, mongoEnvFile, mongoService);
  if (!mongoContainerId || !isContainerRunning(mongoContainerId)) {
    throw new Error(`Mongo container is not running for compose service '${mongoService}'`);
  }

  try {
    console.log('1/7 Decrypting backup package...');
    decryptWithOpenSSL(absEncryptedFile, decryptedTar, passphrase);

    console.log('2/7 Extracting package...');
    extractTarGz(decryptedTar, extractDir);

    console.log('3/7 Validating package integrity...');
    verifyRequiredFiles(extractDir, [
      'manifest.json',
      'checksums.sha256',
      'mongo/dump.archive.gz',
      'storage/storage.tar.gz',
    ]);
    await verifyChecksums(extractDir);

    const manifest = readManifest(extractDir);
    if (!args.force && manifest.mongo?.database !== mongoDatabase) {
      throw new Error(
        `Manifest DB (${manifest.mongo?.database}) does not match current MONGO_DATABASE (${mongoDatabase}). Use --force to override`
      );
    }

    if (!args.yes) {
      const answer = await askConfirm(`Type database name '${mongoDatabase}' to continue restore: `);
      if (answer !== mongoDatabase) {
        throw new Error('Database name confirmation mismatch. Restore aborted');
      }
    }

    console.log('4/7 Restoring MongoDB dump...');
    const dumpLocal = join(extractDir, 'mongo', 'dump.archive.gz');
    const dumpInContainer = '/tmp/reblock-restore-dump.archive.gz';

    exec(`docker cp ${shellEscape(dumpLocal)} ${shellEscape(`${mongoContainerId}:${dumpInContainer}`)}`);

    const restoreUser = mongoRootUsername || appMongoUsername;
    const restorePassword = mongoRootPassword || appMongoPassword;
    const authDb = mongoRootUsername ? 'admin' : mongoDatabase;

    if (!restoreUser || !restorePassword) {
      throw new Error('Missing Mongo restore credentials. Set root or app Mongo credentials in env files');
    }

    exec(
      `docker exec ${shellEscape(mongoContainerId)} mongorestore --host 127.0.0.1 --port 27017 --username ${shellEscape(restoreUser)} --password ${shellEscape(restorePassword)} --authenticationDatabase ${shellEscape(authDb)} --db ${shellEscape(mongoDatabase)} --drop --archive=${shellEscape(dumpInContainer)} --gzip`
    );
    exec(`docker exec ${shellEscape(mongoContainerId)} rm -f ${shellEscape(dumpInContainer)}`);

    console.log('5/7 Restoring storage volume...');
    const storageTar = join(extractDir, 'storage', 'storage.tar.gz');
    const appImage = getContainerImage(appContainerId);

    exec(
      `docker run --rm --volumes-from ${shellEscape(appContainerId)} ${shellEscape(appImage)} sh -lc ${shellEscape('rm -rf /app/storage/* /app/storage/.[!.]* /app/storage/..?* 2>/dev/null || true')}`
    );

    const storageExtractDir = join(extractDir, 'storage', 'content');
    ensureDir(storageExtractDir);
    extractTarGz(storageTar, storageExtractDir);
    exec(`docker cp ${shellEscape(`${storageExtractDir}/.`)} ${shellEscape(`${appContainerId}:/app/storage/`)}`);

    console.log('6/7 Final checks...');
    console.log(`- Mongo target: ${mongoHost}:${mongoPort}/${mongoDatabase}`);
    console.log(`- Restored package: ${absEncryptedFile}`);

    console.log('7/7 Restore completed. Start app manually after validation:');
    console.log(`docker compose -f ${appComposeFile} --env-file ${appEnvFile} up -d app`);
  } finally {
    removePath(workDir);
  }
}

main().catch((error) => {
  console.error(`Backup restore failed: ${error.message}`);
  process.exit(1);
});
