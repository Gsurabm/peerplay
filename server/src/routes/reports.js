import express from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { requireString, requireEnum } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uid, nowIso } from '../lib/ids.js';
import { notify } from '../services/notifications.js';
import { audit } from '../services/audit.js';
import { updateReputation } from '../services/reputation.js';

const router = express.Router();

export const REPORT_REASONS = [
  'draw_farming',
  'cheating',
  'suspicious_behaviour',
  'disconnect_abuse',
  'harassment',
  'other',
];

router.post('/', requireAuth, (req, res) => {
  const reason = requireEnum(requireString(req.body?.reason, 'reason'), 'reason', REPORT_REASONS);
  const details = req.body?.details ? String(req.body.details).slice(0, 1000) : null;
  const reportedUserId = req.body?.reported_user_id || null;
  const matchId = req.body?.match_id || null;

  if (reportedUserId === req.userId) throw badRequest('You cannot report yourself');

  const id = uid('rep');
  db.prepare(
    `INSERT INTO reports (id, reporter_id, reported_user_id, match_id, reason, details, severity, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(id, req.userId, reportedUserId, matchId, reason, details, severityFor(reason), nowIso());

  audit({ actorId: req.userId, actorRole: 'player', action: 'report.create', targetType: 'report', targetId: id, meta: { reason, reported_user_id: reportedUserId } });

  if (reportedUserId) {
    notify(reportedUserId, {
      type: 'system',
      title: 'Account under review',
      body: 'A report was filed against your account. Our moderation team will review recent matches.',
      data: { report_id: id },
    });
  }

  res.status(201).json({ id, status: 'open' });
});

function severityFor(reason) {
  if (['cheating', 'draw_farming'].includes(reason)) return 'high';
  if (reason === 'other') return 'low';
  return 'medium';
}

router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json({ reports: rows });
});

export default router;
