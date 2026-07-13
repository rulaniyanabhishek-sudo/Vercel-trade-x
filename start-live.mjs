import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(path = '.env') {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) return;
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();
await import('./live-server.mjs');
