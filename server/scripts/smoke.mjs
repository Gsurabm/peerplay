#!/usr/bin/env node
/**
 * PeerPlay smoke test.
 *
 * Boots a throwaway server against a temporary SQLite database and walks the
 * critical money path:
 *
 *   health -> register -> verify -> deposit intent -> signed provider callback
 *          -> wallet credited -> methods/limits exposed
 *
 * Exits 0 when every check passes, 1 otherwise. Used by GitHub Actions and
 * handy locally before pushing.
 *
 *   node server/scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 4180);
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = path.join(serverDir, 'data', 'smoke-test.db');
const UPLOADS = path.join(serverDir, 'uploads-smoke-test');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` (${detail})` : ''}`);
  }
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
    rmSync(f, { force: true });
  }

  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      DB_FILE,
      UPLOADS_DIR: UPLOADS,
      PAYMENT_BASE_URL: BASE,
      JWT_SECRET: 'smoke-secret',
      WEBHOOK_SECRET: 'smoke-webhook-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    console.log(`\nPeerPlay smoke test  (port ${PORT})\n`);
    if (!(await waitForHealth())) throw new Error('server did not become healthy in time');

    const health = await api('/api/health');
    check('health endpoint responds', health.status === 200 && health.body?.ok === true);

    const cfg = await api('/api/config');
    check(
      'config exposes the 25% platform fee',
      cfg.status === 200 && cfg.body?.platform_fee_bps === 2500,
      `fee_bps=${cfg.body?.platform_fee_bps}`,
    );

    const stamp = Date.now().toString(36);
    const username = `smoke_${stamp}`.slice(0, 16);
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: {
        username,
        email: `${username}@example.com`,
        phone: '0712345678',
        password: 'SmokeTest123!',
        real_name: 'Smoke Tester',
      },
    });
    check('register returns a token', reg.status === 201 && !!reg.body?.token);
    const token = reg.body?.token;
    if (!token) throw new Error('cannot continue without a token');

    const verify = await api('/api/auth/verify', {
      method: 'POST',
      token,
      body: { channel: 'email', code: reg.body?.verification?.email_code },
    });
    check('email verification succeeds', verify.status === 200 && verify.body?.verified === true);

    const methods = await api('/api/wallet/methods', { token });
    check(
      'wallet methods expose the deposit limits',
      methods.status === 200 &&
        methods.body?.limits?.min_deposit_cents === 5000 &&
        methods.body?.limits?.min_stake_cents === 1000 &&
        Array.isArray(methods.body?.deposit_methods) &&
        methods.body.deposit_methods.length > 0,
    );

    const intent = await api('/api/payments/intents', {
      method: 'POST',
      token,
      body: { method: 'mpesa', amount_cents: 10000, details: { phone: '0712345678' } },
    });
    check('deposit intent is created', intent.status === 201 && intent.body?.status === 'pending');

    // The sandbox provider delivers a signed callback to the webhook endpoint.
    let balance = 0;
    for (let i = 0; i < 25; i += 1) {
      await new Promise((r) => setTimeout(r, 400));
      const wallet = await api('/api/wallet', { token });
      balance = wallet.body?.wallet?.balance_cents ?? 0;
      if (balance >= 10000) break;
    }
    check('signed provider callback credits the wallet', balance === 10000, `balance=${balance}`);

    const bad = await api('/api/payments/webhook/mpesa', {
      method: 'POST',
      body: { reference: 'DEP-FAKE', amount_cents: 50000, status: 'completed' },
    });
    check('unsigned webhook is rejected', bad.status >= 400);

    const logout = await api('/api/auth/me', { token });
    check('authenticated profile is readable', logout.status === 200 && logout.body?.user?.username === username);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${err.message}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!child.killed) child.kill('SIGKILL');
    for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) rmSync(f, { force: true });
    rmSync(UPLOADS, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
