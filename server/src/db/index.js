import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

export const db = new Database(config.dbFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  const now = new Date().toISOString();
  const defaults = {
    platform_fee_bps: String(config.platformFeeBps),
    min_stake_cents: String(config.minStakeCents),
    stake_step_cents: String(config.stakeStepCents),
    min_deposit_cents: String(config.minDepositCents),
    min_withdraw_cents: String(config.minWithdrawCents),
    withdraw_floor_cents: String(config.withdrawFloorCents),
    journey_length: String(config.journeyLength),
    move_timer_sec: String(config.moveTimerSec),
    recovery_sec: String(config.recoverySec),
    max_draws: String(config.maxDraws),
    draw_penalty_bps: String(config.drawPenaltyBps),
    referral_bonus_cents: String(config.referralBonusCents),
    large_withdrawal_cents: String(config.largeWithdrawalCents),
    payments_mode: process.env.PAYMENTS_MODE || 'sandbox',
  };
  const insert = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(defaults)) insert.run(k, v, now);
  });
  tx();
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, String(value), new Date().toISOString());
}

/** Run a function inside a SQLite transaction (safe with better-sqlite3 sync API). */
export function tx(fn) {
  return db.transaction(fn)();
}

export function nowIso() {
  return new Date().toISOString();
}
