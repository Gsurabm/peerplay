import { db } from '../db/index.js';
import { config } from '../config.js';
import { uid, nowIso } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { debit, platformLedger, getWallet } from './wallet.js';
import { analyseWithdrawal } from './risk.js';
import { notify } from './notifications.js';
import { audit } from './audit.js';

export const WITHDRAWAL_METHODS = {
  mpesa: {
    label: 'M-Pesa',
    speed: 'Instant - usually under 1 minute',
    instant: true,
    fields: [{ name: 'phone', label: 'M-Pesa phone number', type: 'tel', placeholder: '0712 345 678', required: true }],
  },
  airtel: {
    label: 'Airtel Money',
    speed: 'Instant - usually under 1 minute',
    instant: true,
    fields: [{ name: 'phone', label: 'Airtel Money number', type: 'tel', placeholder: '0712 345 678', required: true }],
  },
  paypal: {
    label: 'PayPal',
    speed: 'Instant - usually under 5 minutes',
    instant: true,
    fields: [{ name: 'email', label: 'PayPal email', type: 'email', placeholder: 'you@example.com', required: true }],
  },
  bank: {
    label: 'Bank transfer',
    speed: '1-3 business days after approval',
    instant: false,
    fields: [
      { name: 'account_name', label: 'Account holder name', type: 'text', required: true },
      { name: 'bank_name', label: 'Bank', type: 'text', required: true },
      { name: 'account_number', label: 'Account number', type: 'text', required: true },
    ],
  },
};

export function listWithdrawalMethods() {
  return Object.entries(WITHDRAWAL_METHODS).map(([slug, m]) => ({
    slug,
    label: m.label,
    speed: m.speed,
    fields: m.fields,
    min_cents: config.minWithdrawCents,
  }));
}

export function requestWithdrawal(user, { amountCents, method, destination, accountName = null }) {
  if (user.journey_state !== 'complete') {
    throw forbidden(
      `Withdrawals unlock after your 5-match onboarding journey. You have completed ${user.journey_matches}/${config.journeyLength}.`,
    );
  }
  const spec = WITHDRAWAL_METHODS[method];
  if (!spec) throw badRequest('Unsupported withdrawal method');
  if (!Number.isInteger(amountCents) || amountCents < config.minWithdrawCents) {
    throw badRequest(`Minimum withdrawal is KSh ${config.minWithdrawCents / 100}`);
  }
  const wallet = getWallet(user.id);
  const maxWithdrawable = wallet.balance_cents - config.withdrawFloorCents;
  if (maxWithdrawable < config.minWithdrawCents) {
    throw conflict(
      `Your balance must stay above KSh ${config.withdrawFloorCents / 100} after a withdrawal. Available to withdraw: KSh ${(Math.max(0, maxWithdrawable) / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`,
    );
  }
  if (amountCents > maxWithdrawable) {
    throw conflict(
      `You can withdraw at most KSh ${(maxWithdrawable / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} right now (balance must stay above KSh ${config.withdrawFloorCents / 100}).`,
    );
  }
  if (!destination || String(destination).trim().length < 4) throw badRequest('Enter a valid payout destination');
  if (['mpesa', 'airtel'].includes(method) && !/^(\+?254|0)\d{9}$/.test(String(destination).replace(/[\s()-]/g, ''))) {
    throw badRequest('Enter a valid Kenyan phone number for the payout');
  }

  const analysis = analyseWithdrawal(user, { amountCents, method, destination });
  const status = analysis.action === 'review' ? 'review' : analysis.action === 'delay' ? 'risk_hold' : 'processing';
  const id = uid('wdw');
  const expectedAt = new Date(Date.now() + (spec.instant ? 60 : 3 * 86400000)).toISOString();

  debit(user.id, {
    type: 'withdrawal',
    amountCents,
    refType: 'withdrawal',
    refId: id,
    title: `Withdrawal to ${spec.label}`,
    description: `Withdrawal request ${id.slice(-6).toUpperCase()} - funds reserved pending payout.`,
    status: 'pending',
    meta: { method, destination, risk_score: analysis.score, flags: analysis.flags.map((f) => f.code) },
  });

  db.prepare(
    `INSERT INTO withdrawals (id, user_id, amount_cents, fee_cents, net_cents, method, destination, account_name, status, risk_score, risk_flags, requested_at, expected_at)
     VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    user.id,
    amountCents,
    amountCents,
    method,
    String(destination).trim(),
    accountName,
    status,
    analysis.score,
    JSON.stringify(analysis.flags),
    nowIso(),
    expectedAt,
  );

  notify(user.id, {
    type: 'wallet',
    title: 'Withdrawal requested',
    body: `KSh ${(amountCents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} requested to ${spec.label}. Expected: ${spec.speed}.`,
    data: { withdrawal_id: id, status },
  });

  if (status === 'review') {
    notify(user.id, {
      type: 'security',
      title: 'Withdrawal under review',
      body: 'Our risk team is verifying this withdrawal. Large payouts may need extra identity verification. We will notify you once it clears.',
      data: { withdrawal_id: id, flags: analysis.flags.map((f) => f.code) },
    });
  }

  if (spec.instant && status === 'processing') {
    scheduleInstantPayout(id);
  }

  return { id, status, amount_cents: amountCents, expected_at: expectedAt, risk: analysis };
}

const payoutTimers = new Map();

function scheduleInstantPayout(id) {
  clearTimeout(payoutTimers.get(id));
  const timer = setTimeout(() => completePayout(id), 6000);
  payoutTimers.set(id, timer);
  timer.unref?.();
}

export function completePayout(id) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  if (!w || ['paid', 'rejected', 'cancelled'].includes(w.status)) return null;
  db.prepare(`UPDATE withdrawals SET status = 'paid', processed_at = ?, payout_ref = ? WHERE id = ?`).run(
    nowIso(),
    `WDL-${Date.now().toString(36).toUpperCase()}`,
    id,
  );
  db.prepare(
    `UPDATE transactions SET status = 'completed' WHERE ref_type = 'withdrawal' AND ref_id = ? AND user_id = ?`,
  ).run(id, w.user_id);
  platformLedger({
    type: 'withdrawal_payout',
    amountCents: w.amount_cents,
    refType: 'withdrawal',
    refId: id,
    description: `Payout to ${w.method} for user ${w.user_id}`,
  });
  notify(w.user_id, {
    type: 'wallet',
    title: 'Withdrawal completed',
    body: `KSh ${(w.amount_cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })} has been sent to your ${w.method} account.`,
    data: { withdrawal_id: id },
  });
  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
}

export function listWithdrawals(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC LIMIT ?')
    .all(userId, limit)
    .map((w) => ({ ...w, risk_flags: w.risk_flags ? JSON.parse(w.risk_flags) : [] }));
}

export function adminWithdrawals({ status = null, limit = 100 } = {}) {
  const sql = `SELECT w.*, u.username FROM withdrawals w JOIN users u ON u.id = w.user_id
               ${status ? 'WHERE w.status = ?' : ''} ORDER BY w.requested_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...(status ? [status, limit] : [limit]));
  return rows.map((w) => ({ ...w, risk_flags: w.risk_flags ? JSON.parse(w.risk_flags) : [] }));
}

export function adminProcessWithdrawal(id, admin, action, note = null) {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  if (!w) throw notFound('Withdrawal not found');
  if (action === 'approve') {
    db.prepare(`UPDATE withdrawals SET status = 'processing', note = ? WHERE id = ?`).run(note, id);
    audit({ actorId: admin.id, actorRole: admin.role, action: 'withdrawal.approve', targetType: 'withdrawal', targetId: id, meta: { amount_cents: w.amount_cents, user_id: w.user_id } });
    if (WITHDRAWAL_METHODS[w.method]?.instant) scheduleInstantPayout(id);
    return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  }
  if (action === 'reject') {
    db.prepare(`UPDATE withdrawals SET status = 'rejected', processed_at = ?, note = ? WHERE id = ?`).run(nowIso(), note, id);
    credit(w.user_id, {
      type: 'refund',
      amountCents: w.amount_cents,
      refType: 'withdrawal',
      refId: id,
      title: 'Withdrawal rejected - funds returned',
      description: note || 'Your withdrawal could not be processed. The amount has been returned to your wallet.',
      meta: { withdrawal_id: id },
    });
    audit({ actorId: admin.id, actorRole: admin.role, action: 'withdrawal.reject', targetType: 'withdrawal', targetId: id, meta: { amount_cents: w.amount_cents, user_id: w.user_id, note } });
    notify(w.user_id, {
      type: 'wallet',
      title: 'Withdrawal rejected',
      body: note || 'Your withdrawal was rejected and the funds returned to your wallet.',
      data: { withdrawal_id: id },
    });
    return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
  }
  throw badRequest('Unknown action');
}

/** Resume pending instant payouts after a restart. */
export function resumePendingPayouts() {
  const rows = db.prepare(`SELECT * FROM withdrawals WHERE status IN ('processing','approved')`).all();
  rows.forEach((w) => {
    if (WITHDRAWAL_METHODS[w.method]?.instant) scheduleInstantPayout(w.id);
  });
  return rows.length;
}
