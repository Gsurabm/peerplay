import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../../..');

/**
 * The public tunnel addresses this server is currently reachable on.
 *
 * Quick tunnels are anonymous and get recycled by their provider, so the
 * address can change while the app keeps running. The tunnel supervisors write
 * the live addresses to these files; we read them on every request so the
 * client always gets the current one (never a stale, dead link).
 */
const PROVIDERS = [
  { key: 'tm', label: 'Tunnelmole' },
  { key: 'cf', label: 'Cloudflare tunnel' },
  { key: 'pg', label: 'Pinggy tunnel' },
];

const SOURCES = [
  ...PROVIDERS.map((pr) => ({ file: path.join(repoRoot, `.tools/url_${pr.key}.txt`), label: pr.label })),
  { file: path.join(repoRoot, 'PUBLIC_URL.txt'), label: 'Cloudflare tunnel' },
];

function readLines(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^https:\/\/[a-z0-9.-]+$/i.test(l));
  } catch {
    return [];
  }
}

export function publicLinks() {
  const links = [];
  const seen = new Set();
  for (const src of SOURCES) {
    for (const url of readLines(src.file)) {
      if (seen.has(url)) continue;
      seen.add(url);
      links.push({ url, label: src.label });
    }
  }
  return links;
}
