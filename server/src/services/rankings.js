import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';
import { notify } from './notifications.js';

/**
 * Ranking is built from real match history - points are earned by winning
 * (with a small stake-weighting bonus) and by playing at higher stakes.
 */

export const SCOPES = ['daily', 'weekly', 'monthly', 'yearly', 'overall'];

export function periodKey(scope, date = new Date()) {
  const d = new Date(date);
  switch (scope) {
    case 'daily':
      return d.toISOString().slice(0, 10);
    case 'weekly': {
      const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
      return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    case 'monthly':
      return d.toISOString().slice(0, 7);
    case 'yearly':
      return d.toISOString().slice(0, 4);
    default:
      return 'all';
  }
}

function periodStart(scope, date = new Date()) {
  const d = new Date(date);
  switch (scope) {
    case 'daily':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    case 'weekly': {
      const key = periodKey('weekly', d);
      const [year, week] = key.split('-W').map(Number);
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const dayNum = jan4.getUTCDay() || 7;
      const monday = new Date(jan4);
      monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7);
      return monday.toISOString();
    }
    case 'monthly':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    case 'yearly':
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).toISOString();
    default:
      return '1970-01-01T00:00:00.000Z';
  }
}

export function pointsFor(stakeCents, isWin) {
  if (!isWin) return 0;
  const stakeBonus = Math.min(50, Math.floor(stakeCents / 500));
  return 100 + stakeBonus;
}

/**
 * Compute a leaderboard.
 * @param {object} opts scope, game, country, friendIds, limit, viewerId
 */
export function computeLeaderboard({
  scope = 'overall',
  game = null,
  country = null,
  friendIds = null,
  limit = 50,
  viewerId = null,
} = {}) {
  const since = scope === 'overall' ? null : periodStart(scope);
  const params = [];
  let where = `mp.result = 'win' AND m.status = 'completed' AND m.is_tutorial = 0`;
  if (since) {
    where += ' AND m.ended_at >= ?';
    params.push(since);
  }
  if (game) {
    where += ' AND mp.game_slug = ?';
    params.push(game);
  }
  if (country) {
    where += ' AND u.country_code = ?';
    params.push(country);
  }
  if (friendIds && friendIds.length) {
    where += ` AND mp.user_id IN (${friendIds.map(() => '?').join(',')})`;
    params.push(...friendIds);
  }

  const rows = db
    .prepare(
      `SELECT mp.user_id, u.username, u.avatar_seed, u.avatar_type, u.avatar_url, u.country_code, u.streak_wins,
              COUNT(*) AS wins, SUM(mp.stake_cents) AS staked,
              SUM(CASE WHEN mp.result = 'win' THEN ${pointsSql()} ELSE 0 END) AS points
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       JOIN users u ON u.id = mp.user_id
       WHERE ${where}
       GROUP BY mp.user_id
       ORDER BY points DESC, wins DESC, staked DESC`,
    )
    .all(...params);

  const leaderboard = rows.slice(0, limit).map((r, index) => ({
    rank: index + 1,
    user_id: r.user_id,
    username: r.username,
    avatar_seed: r.avatar_seed,
    avatar_type: r.avatar_type,
    avatar_url: r.avatar_url,
    country_code: r.country_code,
    streak: r.streak_wins,
    wins: r.wins,
    points: r.points || 0,
    staked_cents: r.staked || 0,
    is_viewer: r.user_id === viewerId,
  }));

  const viewerRow = viewerId ? rows.find((r) => r.user_id === viewerId) : null;
  let viewerRank = null;
  if (viewerId) {
    const idx = rows.findIndex((r) => r.user_id === viewerId);
    viewerRank = idx >= 0 ? { rank: idx + 1, points: viewerRow.points || 0, wins: viewerRow.wins } : null;
  }

  return { scope, period: scope === 'overall' ? 'all-time' : periodKey(scope), game, country, leaderboard, viewer: viewerRank };
}

function pointsSql() {
  return '100 + MIN(50, CAST(mp.stake_cents / 500 AS INTEGER))';
}

export function playerRankingSummary(userId) {
  const boards = {};
  for (const scope of SCOPES) {
    const since = scope === 'overall' ? null : periodStart(scope);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS wins, COALESCE(SUM(CASE WHEN mp.result='win' THEN ${pointsSql()} ELSE 0 END),0) AS points
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.user_id = ? AND m.status='completed' AND m.is_tutorial = 0 ${since ? 'AND m.ended_at >= ?' : ''}`,
      )
      .get(...(since ? [userId, since] : [userId]));
    boards[scope] = row;
  }
  return boards;
}

/** Weekly snapshot used to notify players when their rank moves. */
export function recordRankSnapshot(scope = 'overall') {
  const key = periodKey(scope);
  const board = computeLeaderboard({ scope, limit: 100 });
  const now = nowIso();
  const insert = db.prepare(
    `INSERT INTO ranking_snapshots (id, scope, period_key, user_id, rank, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const changes = [];
  for (const row of board.leaderboard) {
    const previous = db
      .prepare(`SELECT rank FROM ranking_snapshots WHERE scope = ? AND period_key = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(scope, key, row.user_id);
    if (previous && previous.rank !== row.rank) {
      changes.push({ user_id: row.user_id, from: previous.rank, to: row.rank });
    }
    insert.run(uid('rks'), scope, key, row.user_id, row.rank, row.points, now);
  }
  for (const change of changes) {
    if (change.to < change.from) {
      notify(change.user_id, {
        type: 'social',
        title: `You climbed to #${change.to}`,
        body: `Your ${scope} ranking improved from #${change.from} to #${change.to}. Keep the streak alive.`,
        data: { scope, from: change.from, to: change.to },
      });
    }
  }
  return changes;
}

export function rankChanges(userId, scope = 'overall') {
  const key = periodKey(scope);
  const rows = db
    .prepare(`SELECT rank, points, created_at FROM ranking_snapshots WHERE scope = ? AND period_key = ? AND user_id = ? ORDER BY created_at DESC LIMIT 2`)
    .all(scope, key, userId);
  if (rows.length < 2) return null;
  return { previous: rows[1].rank, current: rows[0].rank, delta: rows[1].rank - rows[0].rank };
}
