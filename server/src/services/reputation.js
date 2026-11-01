import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';

/**
 * Reputation is earned from REAL match history and behaviour - never from
 * star ratings, mutual opinions or subjective votes.
 */
export const REPUTATION_EVENTS = {
  match_win: { delta: 12, label: 'Match win' },
  match_loss: { delta: -6, label: 'Match loss' },
  timeout_forfeit: { delta: -20, label: 'Forfeited on time' },
  disconnect_forfeit: { delta: -25, label: 'Forfeited on disconnect' },
  draw_farming: { delta: -40, label: 'Draw farming' },
  report_upheld: { delta: -60, label: 'Report upheld' },
  report_dismissed: { delta: 3, label: 'Report dismissed' },
  clean_record: { delta: 1, label: 'Clean record bonus' },
  admin_adjustment: { delta: 0, label: 'Admin adjustment' },
};

export function updateReputation(userId, type, { delta = null, reason = null, matchId = null } = {}) {
  const meta = REPUTATION_EVENTS[type] || { delta: 0, label: type };
  const effective = delta === null ? meta.delta : delta;
  db.prepare(
    `INSERT INTO reputation_events (id, user_id, type, delta, reason, match_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(uid('rpe'), userId, type, effective, reason || meta.label, matchId, nowIso());
  db.prepare('UPDATE users SET reputation_score = MAX(0, reputation_score + ?), updated_at = ? WHERE id = ?').run(
    effective,
    nowIso(),
    userId,
  );
  return effective;
}

export function reputationBreakdown(userId) {
  const rows = db
    .prepare('SELECT type, COUNT(*) AS count, SUM(delta) AS total FROM reputation_events WHERE user_id = ? GROUP BY type')
    .all(userId);
  const user = db.prepare('SELECT reputation_score FROM users WHERE id = ?').get(userId);
  const score = user?.reputation_score ?? 1000;
  return {
    score,
    tier: reputationTier(score),
    events: rows.map((r) => ({
      type: r.type,
      label: REPUTATION_EVENTS[r.type]?.label || r.type,
      count: r.count,
      total: r.total,
    })),
  };
}

export function reputationTier(score) {
  if (score >= 1300) return { name: 'Legend', tone: 'gold' };
  if (score >= 1150) return { name: 'Elite', tone: 'purple' };
  if (score >= 1000) return { name: 'Veteran', tone: 'cyan' };
  if (score >= 850) return { name: 'Challenger', tone: 'blue' };
  return { name: 'Rookie', tone: 'grey' };
}

/** Trust score used in matchmaking (0..1). */
export function trustScore(user) {
  const base = Math.min(1, Math.max(0, (user.reputation_score - 500) / 800));
  const played = Math.min(1, user.games_played / 20);
  return Number((base * 0.7 + played * 0.3).toFixed(3));
}

export function listReputationEvents(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM reputation_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit);
}
