#!/usr/bin/env node
/**
 * Upload the PeerPlay project to GitHub WITHOUT installing Git.
 *
 * Uses the GitHub REST "git data" API: one blob per file -> one tree -> one commit -> branch.
 * Everything lands in a single clean commit.
 *
 *   node upload-to-github.mjs
 *   node upload-to-github.mjs --owner YOUR-USERNAME --repo peerplay --branch main
 *   GITHUB_TOKEN=ghp_xxx node upload-to-github.mjs          (token from the environment)
 *
 * The token needs the "repo" scope: https://github.com/settings/tokens
 * It is only ever sent to api.github.com.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API = arg('api', process.env.GITHUB_API || 'https://api.github.com');
const OWNER = arg('owner') || process.env.GITHUB_OWNER;
const REPO = arg('repo', 'peerplay');
const BRANCH = arg('branch', 'main');
const DIR = arg('dir', process.cwd());

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.tools', 'dist', 'build', 'coverage', 'data', 'uploads', '.next', '.cache',
]);
const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'PUBLIC_URL.txt', 'PUBLIC_URLS.txt',
  'peerplay.db', 'peerplay.db-wal', 'peerplay.db-shm',
]);

function collect(dir, rel = '', out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      collect(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, out);
    } else {
      if (IGNORE_FILES.has(entry.name)) continue;
      if (entry.name === '.env') continue;
      out.push({ path: rel ? `${rel}/${entry.name}` : entry.name, full: path.join(dir, entry.name) });
    }
  }
  return out;
}

async function ask(question, fallback = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return (answer || fallback).trim();
}

async function gh(pathname, token, opts = {}) {
  const res = await fetch(API + pathname, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || `${res.status} ${res.statusText}`;
    if (res.status === 401) throw new Error('Token rejected (401) - wrong, expired or revoked.');
    if (res.status === 403) throw new Error('Permission denied (403) - token needs the "repo" scope.');
    if (res.status === 404) throw new Error(`Not found (404) - ${OWNER}/${REPO} does not exist yet. Create it first at https://github.com/new (tick nothing).`);
    throw new Error(msg);
  }
  return json;
}

async function main() {
  const token = process.env.GITHUB_TOKEN || (await ask('Paste your GitHub token (ghp_...): '));
  const owner = OWNER || (await ask('GitHub username: '));
  if (!token || !owner) {
    console.error('Need both a token and a username.');
    process.exit(1);
  }

  console.log(`\n→ checking the connection (${API})…`);
  const me = await gh('/user', token);
  console.log(`   token belongs to: ${me.login}`);
  const info = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(REPO)}`, token);
  console.log(`   repository       : ${info.full_name} (${info.private ? 'private' : 'public'})`);

  const files = collect(DIR);
  console.log(`\n→ ${files.length} files will be uploaded from ${DIR}`);
  const preview = {};
  for (const f of files) {
    const top = f.path.split('/')[0];
    preview[top] = (preview[top] || 0) + 1;
  }
  for (const [k, v] of Object.entries(preview)) console.log(`     ${k}/ — ${v} file(s)`);

  const proceed = (await ask(`\nUpload ${files.length} files as ONE commit? (yes/no): `, 'yes')).toLowerCase();
  if (!['y', 'yes'].includes(proceed)) {
    console.log('Cancelled.');
    return;
  }

  let parentSha = null;
  let baseTree = null;
  try {
    const ref = await gh(`/repos/${owner}/${REPO}/git/ref/heads/${BRANCH}`, token);
    parentSha = ref.object.sha;
    const commit = await gh(`/repos/${owner}/${REPO}/git/commits/${parentSha}`, token);
    baseTree = commit.tree.sha;
    console.log(`\n→ branch "${BRANCH}" exists - the new commit will sit on top of ${parentSha.slice(0, 7)}`);
  } catch {
    console.log(`\n→ branch "${BRANCH}" does not exist yet - this will be the first commit`);
  }

  console.log('\n→ creating blobs…');
  const tree = [];
  let done = 0;
  for (const f of files) {
    const content = fs.readFileSync(f.full).toString('base64');
    const blob = await gh(`/repos/${owner}/${REPO}/git/blobs`, token, {
      method: 'POST',
      body: JSON.stringify({ content, encoding: 'base64' }),
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    done += 1;
    if (done % 20 === 0 || done === files.length) console.log(`   ${done}/${files.length}`);
  }

  console.log('→ creating the tree…');
  const treeRes = await gh(`/repos/${owner}/${REPO}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTree || undefined, tree }),
  });

  console.log('→ creating the commit…');
  const commitRes = await gh(`/repos/${owner}/${REPO}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message:
        'PeerPlay v1.0 - P2P competitive gaming platform\n\n' +
        'Server-authoritative Tic-Tac-Toe platform with a 25% flat platform fee:\n' +
        'escrow, wallet ledger, 5-match onboarding journey, matchmaking, rankings,\n' +
        'reputation, referrals, withdrawals, risk signals and an admin console.\n\n' +
        '- server/: Express + better-sqlite3 + Socket.IO API, game engine, wallet,\n' +
        '  payments (signed webhook verification), realtime gateway\n' +
        '- web/: React 18 + Vite responsive client, 15 pages\n' +
        '- CI: build + smoke test on every push\n',
      tree: treeRes.sha,
      parents: parentSha ? [parentSha] : [],
    }),
  });

  try {
    await gh(`/repos/${owner}/${REPO}/git/refs/heads/${BRANCH}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitRes.sha, force: false }),
    });
  } catch {
    await gh(`/repos/${owner}/${REPO}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commitRes.sha }),
    });
  }

  console.log(`\n✅ Done. ${files.length} files in commit ${commitRes.sha.slice(0, 7)}`);
  console.log(`   https://github.com/${owner}/${REPO}`);
  console.log(`\nNext: clone it with  git clone https://github.com/${owner}/${REPO}.git`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
