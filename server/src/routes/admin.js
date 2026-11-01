import express from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin, requireCapability, ADMIN_CAPABILITIES, can } from '../middleware/auth.js';
import { audit, listAudit } from '../services/audit.js';
import { adminWithdrawals, adminProcessWithdrawal } from '../services/withdrawals.js';
import { paymentReconciliation } from '../services/payments/index.js';
import { forceSettle } from '../services/payments/sandbox.js';
import { listTransactions, credit, debit } from '../services/wallet.js';
import { identitySignals, listRiskEvents } from '../services/risk.js';
import { reputationBreakdown } from '../services/reputation.js';
import { usernameHistory, changeUsername } from '../services/identity.js';
import { updateReputation } from '../services/reputation.js';
import { notify } from '../services/notifications.js';
import { emitToAdmins } from '../realtime/io.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uid, nowIso } from '../lib/ids.js';

const router = express.Router();

router.use(requireAuth, requireAdmin());

router.get('/capabilities', (req, res) => {
  res.json({ role: req.user.role, capabilities: ADMIN_CAPABILITIES[req.user.role] || [] });
});

/* ------------------------------------------------------------ overview */

router.get('/overview', (req, res) => {
  const players = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'player'`).get().n;
  const active = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status='active' AND last_seen_at > ?`).get(new Date(Date.now() - 3600000).toISOString()).n;
  const matches = db.prepare(`SELECT COUNT(*) AS n FROM matches WHERE is_tutorial = 0`).get().n;
  const liveMatches = db.prepare(`SELECT COUNT(*) AS n FROM matches WHERE status = 'active'`).get().n;
  const deposits = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS t FROM payment_intents WHERE status='completed'`).get();
  const withdrawals = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS t FROM withdrawals WHERE status IN ('requested','review','risk_hold','processing','approved','paid')`).get();
  const pendingWithdrawals = db.prepare(`SELECT COUNT(*) AS n FROM withdrawals WHERE status IN ('requested','review','risk_hold')`).get().n;
  const openReports = db.prepare(`SELECT COUNT(*) AS n FROM reports WHERE status IN ('open','reviewing')`).get().n;
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM platform_ledger`).get().t;
  const liabilities = db.prepare(`SELECT COALESCE(SUM(balance_cents),0) AS t FROM wallets`).get().t;
  const journeyComplete = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE journey_state='complete'`).get().n;

  res.json({
    players,
    active_players: active,
    matches,
    live_matches: liveMatches,
    deposits: { count: deposits.n, total_cents: deposits.t },
    withdrawals: { count: withdrawals.n, total_cents: withdrawals.t, pending: pendingWithdrawals },
    open_reports: openReports,
    platform_revenue_cents: revenue,
    player_liabilities_cents: liabilities,
    journey_complete: journeyComplete,
    settlement: paymentReconciliation(),
  });
});

/* --------------------------------------------------------------- users */

router.get('/users', requireCapability('users.read'), (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(100, Number.parseInt(req.query.limit || '50', 10));
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10));
  const where = q ? 'WHERE username_lower LIKE ? OR email_lower LIKE ? OR phone_e164 LIKE ?' : '';
  const params = q ? [`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q}%`] : [];
  const rows = db
    .prepare(
      `SELECT id, username, email, phone_e164, role, status, country_code, wins, losses, draws, streak_wins,
              reputation_score, risk_score, journey_state, journey_matches, total_wagered_cents, total_won_cents,
              total_deposited_cents, total_withdrawn_cents, created_at, last_seen_at, referral_code
       FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const balances = db.prepare('SELECT user_id, balance_cents FROM wallets').all();
  const map = new Map(balances.map((b) => [b.user_id, b.balance_cents]));
  res.json({
    users: rows.map((u) => ({ ...u, balance_cents: map.get(u.id) || 0 })),
    total: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  });
});

router.get('/users/:id', requireCapability('users.read'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found');
  res.json({
    user: {
      ...user,
      password_hash: undefined,
      legal_id_number: user.legal_id_number ? maskId(user.legal_id_number) : null,
    },
    balance_cents: db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(user.id)?.balance_cents || 0,
    transactions: listTransactions(user.id, { limit: 50 }),
    username_history: usernameHistory(user.id, 25),
    risk_events: listRiskEvents(user.id, 25),
    signals: identitySignals(user),
    reputation: reputationBreakdown(user.id),
    devices: db.prepare('SELECT id, platform, user_agent, ip, first_seen_at, last_seen_at FROM devices WHERE user_id = ?').all(user.id),
  });
});

function maskId(value) {
  const s = String(value);
  return `${s.slice(0, 3)}${'*'.repeat(Math.max(0, s.length - 5))}${s.slice(-2)}`;
}

router.post('/users/:id/status', requireCapability('users.suspend'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found');
  const status = String(req.body?.status || '');
  if (!['active', 'suspended', 'banned'].includes(status)) throw badRequest('Invalid status');
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), user.id);
  audit({ actorId: req.user.id, actorRole: req.user.role, action: 'user.status', targetType: 'user', targetId: user.id, meta: { status } });
  notify(user.id, {
    type: 'system',
    title: status === 'active' ? 'Account restored' : `Account ${status}`,
    body: status === 'active' ? 'Your account is active again. Welcome back.' : `Your account is now ${status}. Contact support if you think this is a mistake.`,
    data: { status },
  });
  res.json({ id: user.id, status });
});

router.post('/users/:id/username', requireCapability('username.manage'), (req, res) => {
  const username = String(req.body?.username || '').trim();
  const reason = String(req.body?.reason || 'admin action');
  const user = changeUsername(req.params.id, username);
  audit({ actorId: req.user.id, actorRole: req.user.role, action: 'user.username_change', targetType: 'user', targetId: user.id, meta: { username, reason } });
  res.json({ user: { id: user.id, username: user.username } });
});

router.post('/users/:id/wallet', requireCapability('finance.write'), (req, res) => {
  const amountCents = Number.parseInt(req.body?.amount_cents, 10);
  if (!Number.isFinite(amountCents) || amountCents === 0) throw badRequest('Enter a valid adjustment amount');
  const reason = String(req.body?.reason || 'admin adjustment');
  const fn = amountCents > 0 ? credit : debit;
  const result = fn(req.params.id, {
    type: 'adjustment',
    amountCents: Math.abs(amountCents),
    refType: 'admin',
    refId: req.user.id,
    title: 'Admin adjustment',
    description: `${reason} (by ${req.user.username})`,
    meta: { admin_id: req.user.id, reason },
  });
  audit({ actorId: req.user.id, actorRole: req.user.role, action: 'wallet.adjust', targetType: 'user', targetId: req.params.id, meta: { amount_cents: amountCents, reason } });
  res.json({ balance_cents: result.balance_cents });
});

router.post('/users/:id/reputation', requireCapability('reports.resolve'), (req, res) => {
  const delta = Number.parseInt(req.body?.delta, 10);
  if (!Number.isFinite(delta)) throw badRequest('Enter a reputation delta');
  const reason = String(req.body?.reason || 'moderation decision');
  updateReputation(req.params.id, 'admin_adjustment', { delta, reason });
  audit({ actorId: req.user.id, actorRole: req.user.role, action: 'user.reputation', targetType: 'user', targetId: req.params.id, meta: { delta, reason } });
  res.json({ ok: true });
});

/* ------------------------------------------------------------ finance */

router.get('/finance/transactions', requireCapability('finance.read'), (req, res) => {
  const limit = Math.min(200, Number.parseInt(req.query.limit || '60', 10));
  const type = req.query.type || null;
  const rows = db
    .prepare(
      `SELECT t.*, u.username FROM transactions t JOIN users u ON u.id = t.user_id
       ${type ? 'WHERE t.type = ?' : ''} ORDER BY t.created_at DESC LIMIT ?`,
    )
    .all(...(type ? [type, limit] : [limit]));
  res.json({ transactions: rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })) });
});

router.get('/finance/ledger', requireCapability('finance.read'), (_req, res) => {
  const rows = db.prepare('SELECT * FROM platform_ledger ORDER BY created_at DESC LIMIT 200').all();
  res.json({
    ledger: rows,
    revenue_cents: db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS t FROM platform_ledger').get().t,
    breakdown: db.prepare('SELECT type, COALESCE(SUM(amount_cents),0) AS total FROM platform_ledger GROUP BY type').all(),
  });
});

router.get('/finance/deposits', requireCapability('finance.read'), (req, res) => {
  const rows = db.prepare('SELECT * FROM payment_intents ORDER BY created_at DESC LIMIT 100').all();
  res.json({ deposits: rows.map((r) => ({ ...r, meta: r.meta ? JSON.parse(r.meta) : null })) });
});

router.post('/finance/deposits/:id/settle', requireCapability('finance.write'), (req, res) => {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(req.params.id);
  if (!intent) throw notFound('Deposit not found');
  if (intent.status !== 'pending') throw badRequest('Only pending deposits can be settled');
  forceSettle(intent);
  audit({ actorId: req.user.id, actorRole: req.user.role, action: 'deposit.settle', targetType: 'payment_intent', targetId: intent.id, meta: { amount_cents: intent.amount_cents } });
  res.json({ status: 'settling' });
});

router.get('/finance/withdrawals', requireCapability('finance.withdrawals'), (req, res) => {
  res.json({ withdrawals: adminWithdrawals({ status: req.query.status || null, limit: 100 }) });
});

router.post('/finance/withdrawals/:id', requireCapability('finance.withdrawals'), (req, res) => {
  const action = String(req.body?.action || '');
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  const result = adminProcessWithdrawal(req.params.id, req.user, action, note);
  res.json({ withdrawal: result });
});

/* ---------------------------------------------------------- moderation */

router.get('/reports', requireCapability('reports.read'), (req, res) => {
  const status = req.query.status || null;
  const rows = db
    .prepare(
      `SELECT r.*, ru.username AS reporter_username, eu.username AS reported_username
       FROM reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
       LEFT JOIN users eu ON eu.id = r.reported_user_id
       ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 200`,
    )
    .all(...(status ? [status] : []));
  res.json({ reports: rows });
});

router.post('/reports/:id', requireCapability('reports.resolve'), (req, res) => {
  const action = String(req.body?.action || '');
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) throw notFound('Report not found');
  const resolution = req.body?.resolution ? String(req.body.resolution).slice(0, 1000) : null;

  if (action === 'resolve') {
    db.prepare(`UPDATE reports SET status='resolved', resolution=?, handled_by=?, resolved_at=? WHERE id=?`).run(
      resolution,
      req.user.id,
      nowIso(),
      report.id,
    );
    if (report.reported_user_id) {
      const penalty = { draw_farming: -40, cheating: -80, disconnect_abuse: -25 }[report.reason] ?? -20;
      updateReputation(report.reported_user_id, 'report_upheld', { delta: penalty, reason: report.reason });
    }
  } else if (action === 'dismiss') {
    db.prepare(`UPDATE reports SET status='dismissed', resolution=?, handled_by=?, resolved_at=? WHERE id=?`).run(
      resolution,
      req.user.id,
      nowIso(),
      report.id,
    );
    if (report.reported_user_id) {
      updateReputation(report.reported_user_id, 'report_dismissed', { delta: 3, reason: report.reason });
    }
  } else if (action === 'reviewing') {
    db.prepare(`UPDATE reports SET status='reviewing', handled_by=? WHERE id=?`).run(req.user.id, report.id);
  } else {
    throw badRequest('Unknown report action');
  }

  audit({ actorId: req.user.id, actorRole: req.user.role, action: `report.${action}`, targetType: 'report', targetId: report.id, meta: { reason: report.reason } });
  emitToAdmins('report_updated', { report_id: report.id, status: action });
  res.json({ id: report.id, status: action });
});

/* ------------------------------------------------------ match monitor */

router.get('/matches', requireCapability('matches.read'), (req, res) => {
  const limit = Math.min(100, Number.parseInt(req.query.limit || '50', 10));
  const rows = db
    .prepare(
      `SELECT m.*, ux.username AS x_username, uo.username AS o_username,
              (SELECT COUNT(*) FROM match_events me WHERE me.match_id = m.id) AS events
       FROM matches m
       LEFT JOIN users ux ON ux.id = m.player_x_id
       LEFT JOIN users uo ON uo.id = m.player_o_id
       ORDER BY COALESCE(m.ended_at, m.created_at) DESC LIMIT ?`,
    )
    .all(limit);
  res.json({ matches: rows });
});

router.get('/matches/:id/events', requireCapability('matches.read'), (req, res) => {
  const rows = db.prepare('SELECT * FROM match_events WHERE match_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ events: rows.map((r) => ({ ...r, payload: r.payload ? JSON.parse(r.payload) : null })) });
});

/* ---------------------------------------------------------------- risk */

router.get('/risk', requireCapability('risk.read'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.risk_score, u.status, u.created_at, u.last_seen_at, u.device_fingerprint,
              (SELECT COUNT(*) FROM risk_events re WHERE re.user_id = u.id) AS events
       FROM users u WHERE u.risk_score > 0 ORDER BY u.risk_score DESC LIMIT 50`,
    )
    .all();
  const devices = db
    .prepare(
      `SELECT fingerprint, COUNT(*) AS accounts FROM devices GROUP BY fingerprint HAVING accounts > 1 ORDER BY accounts DESC LIMIT 25`,
    )
    .all();
  res.json({ flagged: rows, shared_devices: devices });
});

router.get('/audit', requireCapability('audit.read'), (req, res) => {
  res.json({ audit: listAudit({ limit: 100, action: req.query.action || null }) });
});

export default router;
