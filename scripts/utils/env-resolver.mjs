import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export function loadDotEnvIfExists(cwd = process.cwd(), envFile = '.env') {
  const envPath = resolve(cwd, envFile);
  if (!existsSync(envPath)) {
    return;
  }

  const envContent = readFileSync(envPath, 'utf-8');
  for (const rawLine of envContent.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

export function resolveBaseUrl({ serverArg, portArg } = {}) {
  const explicitServer = serverArg?.trim();
  const explicitPort = portArg?.trim();

  if (explicitServer || explicitPort) {
    const server = explicitServer || 'localhost';
    const port = explicitPort || process.env.PORT || process.env.SERVER_PORT || '4362';
    return {
      baseUrl: `http://${server}:${port}`,
      server,
      port,
    };
  }

  const configuredBaseUrl = process.env.API_BASE_URL?.trim();
  if (configuredBaseUrl) {
    let parsed;
    try {
      parsed = new URL(configuredBaseUrl);
    } catch {
      throw new Error(`Invalid API_BASE_URL: ${configuredBaseUrl}`);
    }

    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return {
      baseUrl: trimTrailingSlash(parsed.toString()),
      server: parsed.hostname,
      port,
    };
  }

  const port = process.env.PORT || process.env.SERVER_PORT || '4362';
  return {
    baseUrl: `http://localhost:${port}`,
    server: 'localhost',
    port,
  };
}

export function resolveApiAuthToken() {
  return process.env.API_AUTH_TOKEN || process.env.ERRORS_API_TOKEN || process.env.MIGRATION_API_TOKEN || '';
}
