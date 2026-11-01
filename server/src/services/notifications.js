import { db } from '../db/index.js';
import { uid, nowIso } from '../lib/ids.js';
import { emitToUser } from '../realtime/io.js';

export const NOTIFICATION_TYPES = {
  match: 'Match',
  wallet: 'Wallet',
  social: 'Social',
  system: 'System',
  security: 'Security',
};

/**
 * Persist a notification and push it live to the player's socket room.
 */
export function notify(userId, { type = 'system', title, body = null, data = null, persist = true }) {
  const id = uid('ntf');
  const createdAt = nowIso();
  if (persist) {
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, data, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(id, userId, type, title, body, data ? JSON.stringify(data) : null, createdAt);
  }
  emitToUser(userId, 'notification', {
    id,
    type,
    title,
    body,
    data,
    read: 0,
    created_at: createdAt,
  });
  return { id, type, title, body, data, read: 0, created_at: createdAt };
}

export function listNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  const sql = `SELECT * FROM notifications WHERE user_id = ? ${unreadOnly ? 'AND read = 0' : ''}
               ORDER BY created_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(userId, limit);
  return rows.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
}

export function unreadCount(userId) {
  const row = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(userId);
  return row ? row.c : 0;
}

export function markRead(userId, ids = null) {
  if (ids && ids.length) {
    const stmt = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND id = ?');
    const run = db.transaction((list) => list.forEach((id) => stmt.run(userId, id)));
    run(ids);
  } else {
    db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
  }
  return unreadCount(userId);
}

export function purgeOld(days = 90) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  db.prepare('DELETE FROM notifications WHERE created_at < ?').run(cutoff);
}
