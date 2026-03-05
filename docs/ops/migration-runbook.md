# Reblock Migration Runbook (Change Machine)

## Scope

This runbook migrates a self-hosted Reblock production-like setup to a new machine with:
- isolated Mongo container (`docker-compose.mongo.yml`)
- isolated Reblock app container (`docker-compose.app.yml`)
- no Mongo host port exposure

Assumptions:
- short downtime is acceptable
- backup package is encrypted
- secrets are transferred separately

## Prerequisites

- New machine has Docker + Docker Compose plugin
- You have:
  - encrypted backup package (`*.tar.gz.enc`)
  - backup passphrase
  - `ENCRYPTION_KEY`
  - `API_AUTH_TOKEN`
  - Mongo credentials

## Environment files

### Mongo env (`.env.mongo.reblock`)

Use `.env.mongo.reblock.example` as template.

Required:
- `MONGO_ROOT_USERNAME`
- `MONGO_ROOT_PASSWORD`
- `MONGO_APP_DB`
- `MONGO_APP_USER`
- `MONGO_APP_PASSWORD`

### App env (`.env.reblock.prod`)

Use `.env.reblock.prod.example` as template.

Required:
- `API_AUTH_TOKEN`
- `ENCRYPTION_KEY` (must match old machine)
- `MONGO_HOSTNAME=reblock-mongo`
- `MONGO_DATABASE`
- `MONGO_USERNAME`
- `MONGO_PASSWORD`

## Old machine export

1. Stop app write path:

```bash
docker compose -f docker-compose.app.yml --env-file .env.reblock.prod stop app
```

2. Export encrypted backup package:

```bash
npm run backup:export -- --passphrase '<backup-passphrase>'
```

3. Verify package:

```bash
npm run backup:verify -- --file backup/<package>.tar.gz.enc --passphrase '<backup-passphrase>'
```

4. Copy package to new machine using offline medium.

## New machine restore

1. Create network:

```bash
docker network create reblock-shared-net || true
```

2. Start Mongo:

```bash
docker compose -f docker-compose.mongo.yml --env-file .env.mongo.reblock up -d
```

3. Start app container once (creates container + volume), then stop app:

```bash
docker compose -f docker-compose.app.yml --env-file .env.reblock.prod up -d app
docker compose -f docker-compose.app.yml --env-file .env.reblock.prod stop app
```

4. Restore backup:

```bash
npm run backup:restore -- --file backup/<package>.tar.gz.enc --passphrase '<backup-passphrase>' --yes
```

5. Start app:

```bash
docker compose -f docker-compose.app.yml --env-file .env.reblock.prod up -d app
```

## Post-restore checks

1. Health endpoint:

```bash
curl -f http://127.0.0.1:3900/health
```

2. Mongo is not exposed on host:

```bash
docker ps | grep reblock-mongo
# ensure no 0.0.0.0:27017 mapping
```

3. App functionality checks:
- upload a file
- download existing resource
- list/query resources

## Rollback

If restore fails on new machine:
- Keep old machine untouched and resume app there.
- Fix issue on new machine and retry restore.

To resume old machine quickly:

```bash
docker compose -f docker-compose.app.yml --env-file .env.reblock.prod up -d app
```

## Forbidden operations (data safety)

- Do NOT run `docker compose -f docker-compose.mongo.yml down -v` in production.
- Do NOT rotate `ENCRYPTION_KEY` unless you have a full re-encryption plan.
- Do NOT place secrets inside backup package.

## Troubleshooting

- `mongorestore unauthorized`
  - check root/app credentials in env files
  - ensure `MONGO_DATABASE` matches backup manifest

- existing resources unreadable after restore
  - `ENCRYPTION_KEY` mismatch between old/new machine

- backup verify checksum mismatch
  - package corrupted during transfer, recopy and verify again
