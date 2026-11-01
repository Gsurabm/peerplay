import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';
import { AppError } from '../lib/errors.js';
import { emitToUser } from '../realtime/io.js';

/**
 * Ledger-first wallet.
 * Every balance change writes an immutable transaction row; the wallets row is
 * a cached projection of the ledger and is updated in the same SQLite transaction.
 */

export function ensureWallet(userId) {
  const existing = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO wallets (user_id, balance_cents, locked_cents, currency, updated_at)
     VALUES (?, 0, 0, 'KES', ?)`,
  ).run(userId, nowIso());
  return db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
}

export function getBalance(userId) {
  const wallet = ensureWallet(userId);
  return wallet.balance_cents;
}

export function getWallet(userId) {
  const wallet = ensureWallet(userId);
  return { ...wallet, available_cents: wallet.balance_cents - wallet.locked_cents };
}

export function listTransactions(userId, { limit = 100, offset = 0, type = null } = {}) {
  const clauses = ['user_id = ?'];
  const params = [userId];
  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  params.push(limit, offset);
  const rows = db
    .prepare(
      `SELECT * FROM transactions WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...params);
  return rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null }));
}

export function transactionCount(userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(userId);
  return row ? row.c : 0;
}

/**
 * Apply a balance change. `amount_cents` must be positive; direction decides sign.
 */
export function postTransaction(userId, entry) {
  const {
    type,
    direction,
    amountCents,
    refType = null,
    refId = null,
    title,
    description = null,
    meta = null,
    status = 'completed',
  } = entry;

  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new AppError('Invalid transaction amount', 400, 'bad_request');
  }

  const wallet = ensureWallet(userId);
  const delta = direction === 'credit' ? amountCents : -amountCents;
  const nextBalance = wallet.balance_cents + delta;

  if (nextBalance < 0) {
    throw new AppError('Insufficient wallet balance', 400, 'insufficient_funds', {
      balance_cents: wallet.balance_cents,
      required_cents: amountCents,
    });
  }

  db.prepare(
    `UPDATE wallets SET balance_cents = ?, updated_at = ? WHERE user_id = ?`,
  ).run(nextBalance, nowIso(), userId);

  const id = uid('txn');
  db.prepare(
    `INSERT INTO transactions
      (id, user_id, type, direction, amount_cents, balance_after, status, ref_type, ref_id, title, description, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    type,
    direction,
    amountCents,
    nextBalance,
    status,
    refType,
    refId,
    title,
    description,
    meta ? JSON.stringify(meta) : null,
    nowIso(),
  );

  // Live wallet update so the client never shows a stale balance.
  emitToUser(userId, 'wallet', { balance_cents: nextBalance, type, direction });

  return { id, balance_cents: nextBalance, delta };
}

export function credit(userId, entry) {
  return postTransaction(userId, { ...entry, direction: 'credit' });
}

export function debit(userId, entry) {
  return postTransaction(userId, { ...entry, direction: 'debit' });
}

export function platformLedger({ type, amountCents, refType = null, refId = null, description = null }) {
  db.prepare(
    `INSERT INTO platform_ledger (id, type, amount_cents, ref_type, ref_id, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid('plg'), type, amountCents, refType, refId, description, nowIso());
}

export function walletSummary(userId) {
  const wallet = getWallet(userId);
  const stats = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction='credit' AND type IN ('win','escrow_release','refund','referral_bonus') THEN amount_cents END),0) AS won,
         COALESCE(SUM(CASE WHEN direction='debit' AND type IN ('stake','withdrawal','penalty') THEN amount_cents END),0) AS spent,
         COALESCE(SUM(CASE WHEN type='deposit' THEN amount_cents END),0) AS deposited,
         COALESCE(SUM(CASE WHEN type='withdrawal' AND status IN ('completed','paid') THEN amount_cents END),0) AS withdrawn
       FROM transactions WHERE user_id = ?`,
    )
    .get(userId);

  const pendingWithdrawals = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents),0) AS total FROM withdrawals
       WHERE user_id = ? AND status IN ('requested','risk_hold','review','approved','processing')`,
    )
    .get(userId);

  return {
    balance_cents: wallet.balance_cents,
    locked_cents: wallet.locked_cents,
    available_cents: wallet.available_cents,
    deposited_cents: stats.deposited || 0,
    withdrawn_cents: stats.withdrawn || 0,
    won_cents: stats.won || 0,
    staked_cents: stats.spent || 0,
    pending_withdrawal_cents: pendingWithdrawals.total || 0,
  };
}
