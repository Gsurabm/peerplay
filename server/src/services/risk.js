import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';
import { config } from '../config.js';
import { accountsOnDevice } from './identity.js';

/**
 * Behaviour + identity risk analysis.
 * Device fingerprinting is ONE signal among many - never the sole reason an
 * account is blocked. Scores are additive and explainable so admins can act.
 */

export function recordRiskEvent(userId, type, score, details = null) {
  const id = uid('rsk');
  db.prepare(
    `INSERT INTO risk_events (id, user_id, type, score, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, type, score, details ? JSON.stringify(details) : null, nowIso());
  db.prepare('UPDATE users SET risk_score = risk_score + ? WHERE id = ?').run(score, userId);
  return id;
}

export function listRiskEvents(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM risk_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)
    .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}

export function userRiskEvents(userId) {
  const row = db.prepare('SELECT COALESCE(SUM(score),0) AS s FROM risk_events WHERE user_id = ?').get(userId);
  return row?.s || 0;
}

/** Multi-account detection using device + payment identity signals. */
export function detectMultiAccount(user) {
  const flags = [];
  if (user.device_fingerprint) {
    const others = accountsOnDevice(user.device_fingerprint, user.id);
    if (others.length) {
      flags.push({ code: 'device_shared', weight: 25, detail: `${others.length} other account(s) seen on this device` });
    }
  }
  if (user.phone_e164) {
    const samePhone = db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE phone_e164 = ? AND id != ?')
      .get(user.phone_e164, user.id);
    if ((samePhone?.c || 0) > 0) flags.push({ code: 'phone_reuse', weight: 20, detail: 'Phone number linked to other accounts' });
  }
  if (user.legal_id_number) {
    const sameId = db
      .prepare('SELECT COUNT(*) AS c FROM users WHERE legal_id_number = ? AND id != ?')
      .get(user.legal_id_number, user.id);
    if ((sameId?.c || 0) > 0) flags.push({ code: 'identity_reuse', weight: 40, detail: 'National ID already in use' });
  }
  return flags;
}

/** Deposit / withdrawal behavioural anomalies. */
export function detectFlowAnomalies(user, { amountCents = 0 } = {}) {
  const flags = [];
  const deposits = db
    .prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total, COUNT(*) AS n FROM transactions
              WHERE user_id = ? AND type = 'deposit'`)
    .get(user.id);
  const withdrawals = db
    .prepare(`SELECT COALESCE(SUM(amount_cents),0) AS total, COUNT(*) AS n FROM withdrawals WHERE user_id = ? AND status IN ('paid','processing','approved')`)
    .get(user.id);

  const deposited = deposits?.total || 0;
  const withdrawn = withdrawals?.total || 0;

  if (deposited > 0 && withdrawn >= deposited * 0.9 && withdrawn > 0) {
    flags.push({ code: 'deposit_withdraw_ratio', weight: 30, detail: 'Nearly all deposited funds withdrawn' });
  }
  if ((deposits?.n || 0) >= 4 && (withdrawals?.n || 0) >= 3 && deposited < withdrawn * 1.2) {
    flags.push({ code: 'rapid_churn', weight: 20, detail: 'High frequency of deposits and withdrawals' });
  }
  if (amountCents >= config.largeWithdrawalCents && !user.identity_verified) {
    flags.push({ code: 'large_withdrawal_unverified', weight: 35, detail: 'Large withdrawal without verified identity' });
  }
  if (!user.phone_verified) {
    flags.push({ code: 'phone_unverified', weight: 10, detail: 'Phone number not verified' });
  }
  if (!user.email_verified) {
    flags.push({ code: 'email_unverified', weight: 5, detail: 'Email address not verified' });
  }
  if (user.journey_state !== 'complete' && amountCents > 0) {
    flags.push({ code: 'journey_incomplete', weight: 15, detail: 'Withdrawal attempted before onboarding journey completed' });
  }
  const accounts = db.prepare('SELECT COUNT(*) AS c FROM users WHERE device_fingerprint = ? AND device_fingerprint IS NOT NULL').get(user.device_fingerprint);
  if (user.device_fingerprint && (accounts?.c || 0) > 2) {
    flags.push({ code: 'device_farm', weight: 20, detail: 'Device linked to several accounts' });
  }
  return flags;
}

/**
 * Analyse a withdrawal request.
 * Returns a score, human readable flags and a recommended action.
 */
export function analyseWithdrawal(user, { amountCents, method, destination }) {
  const flags = [...detectMultiAccount(user), ...detectFlowAnomalies(user, { amountCents })];

  if (String(destination || '').trim().length < 4) {
    flags.push({ code: 'invalid_destination', weight: 30, detail: 'Destination account looks incomplete' });
  }
  if (['mpesa', 'airtel'].includes(method) && !/^(\+?254|0)\d{9}$/.test(String(destination).replace(/[\s()-]/g, ''))) {
    flags.push({ code: 'destination_mismatch', weight: 20, detail: 'Destination does not match the selected method' });
  }

  const score = flags.reduce((sum, f) => sum + f.weight, 0);
  let action = 'approve';
  if (score >= 60) action = 'review';
  else if (score >= 30) action = 'delay';

  return {
    score,
    action,
    flags,
    requires_identity: amountCents >= config.largeWithdrawalCents && !user.identity_verified,
  };
}

export function identitySignals(user) {
  const devices = db.prepare('SELECT COUNT(*) AS c FROM devices WHERE user_id = ?').get(user.id);
  const payments = db
    .prepare(`SELECT COUNT(*) AS c FROM payment_intents WHERE user_id = ? AND status = 'completed'`)
    .get(user.id);
  const matches = db.prepare('SELECT COUNT(*) AS c FROM match_players WHERE user_id = ?').get(user.id);
  return {
    phone_verified: Boolean(user.phone_verified),
    email_verified: Boolean(user.email_verified),
    identity_verified: Boolean(user.identity_verified),
    devices: devices?.c || 0,
    payment_history: payments?.c || 0,
    matches_played: matches?.c || 0,
    risk_score: user.risk_score,
  };
}
