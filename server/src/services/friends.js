import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { notify } from './notifications.js';

export function areFriends(userA, userB) {
  const row = db
    .prepare(
      `SELECT id FROM friendships WHERE status = 'accepted' AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))`,
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function friendIds(userId) {
  const rows = db
    .prepare(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS fid FROM friendships
       WHERE status = 'accepted' AND (user_a = ? OR user_b = ?)`,
    )
    .all(userId, userId, userId);
  return rows.map((r) => r.fid);
}

export function listFriends(userId) {
  const rows = db
    .prepare(
      `SELECT f.id, f.status, f.created_at, f.accepted_at,
              CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END AS other_id,
              u.username, u.avatar_seed, u.avatar_type, u.avatar_url, u.wins, u.losses, u.streak_wins, u.reputation_score, u.country_code, u.last_seen_at
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
       WHERE (f.user_a = ? OR f.user_b = ?)`,
    )
    .all(userId, userId, userId, userId);
  return rows.map((r) => ({
    friendship_id: r.id,
    status: r.status,
    user_id: r.other_id,
    username: r.username,
    avatar_seed: r.avatar_seed,
    avatar_type: r.avatar_type,
    avatar_url: r.avatar_url,
    wins: r.wins,
    losses: r.losses,
    streak: r.streak_wins,
    reputation_score: r.reputation_score,
    country_code: r.country_code,
    last_seen_at: r.last_seen_at,
  }));
}

export function sendFriendRequest(fromUserId, toUserId) {
  if (fromUserId === toUserId) throw badRequest('You cannot add yourself');
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(toUserId);
  if (!target) throw notFound('Player not found');
  const existing = db
    .prepare(
      `SELECT * FROM friendships WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)) AND status != 'blocked'`,
    )
    .get(fromUserId, toUserId, toUserId, fromUserId);
  if (existing) throw conflict('A request already exists between you and this player');

  const id = uid('fr');
  db.prepare(
    `INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
  ).run(id, fromUserId, toUserId, nowIso());
  notify(toUserId, {
    type: 'social',
    title: 'New friend request',
    body: 'A player wants to connect on PeerPlay.',
    data: { friendship_id: id, from: db.prepare('SELECT username FROM users WHERE id = ?').get(fromUserId)?.username },
  });
  return { id, status: 'pending' };
}

export function respondToFriendRequest(friendshipId, userId, accept) {
  const f = db.prepare('SELECT * FROM friendships WHERE id = ?').get(friendshipId);
  if (!f) throw notFound('Request not found');
  if (f.user_b !== userId && f.user_a !== userId) throw badRequest('Not your request');
  if (f.status !== 'pending') throw conflict('Request already handled');
  if (accept) {
    db.prepare(`UPDATE friendships SET status = 'accepted', accepted_at = ? WHERE id = ?`).run(nowIso(), friendshipId);
    const other = f.user_a === userId ? f.user_b : f.user_a;
    notify(other, {
      type: 'social',
      title: 'Friend request accepted',
      body: 'You are now connected. Challenge them to a match.',
      data: { friendship_id: friendshipId },
    });
    return { status: 'accepted' };
  }
  db.prepare(`UPDATE friendships SET status = 'blocked' WHERE id = ?`).run(friendshipId);
  return { status: 'declined' };
}

export function removeFriend(friendshipId, userId) {
  db.prepare('DELETE FROM friendships WHERE id = ? AND (user_a = ? OR user_b = ?)').run(friendshipId, userId);
  return { status: 'removed' };
}

export function searchPlayers(query, excludeUserId) {
  const like = `%${String(query || '').toLowerCase()}%`;
  return db
    .prepare(
      `SELECT id, username, avatar_seed, avatar_type, avatar_url, wins, losses, streak_wins, reputation_score, country_code
       FROM users WHERE status = 'active' AND id != ? AND (username_lower LIKE ? OR email_lower LIKE ?) LIMIT 25`,
    )
    .all(excludeUserId, like, like);
}
