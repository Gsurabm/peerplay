import { verifyToken, ADMIN_ROLES } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { emitToUser } from './io.js';
import { handleMove, matchView, onUserDisconnect, onUserReconnect, getMatch } from '../services/matches.js';
import { joinQueue, leaveQueue, sweepQueue } from '../services/matchmaking.js';
import { notify } from '../services/notifications.js';
import { unreadCount } from '../services/notifications.js';

/**
 * Realtime gateway. Every gameplay decision is validated on the server:
 * the socket layer only transports intent, never state it trusts.
 */
export function attachRealtime(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('unauthorized'));
    const payload = verifyToken(token);
    if (!payload) return next(new Error('unauthorized'));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user || user.status === 'banned') return next(new Error('unauthorized'));
    socket.data.user = user;
    socket.data.userId = user.id;
    return next();
  });

  io.on('connection', (socket) => {
    const { user, userId } = socket.data;
    socket.join(`user:${userId}`);
    if (ADMIN_ROLES.includes(user.role)) socket.join('admins');
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), userId);

    onUserReconnect(userId);
    sweepQueue();

    socket.emit('hello', {
      user_id: userId,
      unread_notifications: unreadCount(userId),
      server_time: new Date().toISOString(),
    });

    socket.on('match:join', (payload, ack) => {
      const matchId = typeof payload === 'string' ? payload : payload?.match_id;
      const match = getMatch(matchId);
      if (!match) return ack?.({ error: 'Match not found' });
      if (match.player_x_id !== userId && match.player_o_id !== userId) {
        return ack?.({ error: 'Not your match' });
      }
      socket.join(`match:${matchId}`);
      const view = matchView(matchId, userId);
      socket.emit('match_state', view);
      socket.to(`match:${matchId}`).emit('opponent_joined', { user_id: userId });
      return ack?.({ ok: true, match: view });
    });

    socket.on('match:leave', (payload) => {
      const matchId = typeof payload === 'string' ? payload : payload?.match_id;
      if (matchId) socket.leave(`match:${matchId}`);
    });

    socket.on('match:move', (payload, ack) => {
      const matchId = payload?.match_id;
      const cell = Number.parseInt(payload?.cell, 10);
      try {
        const view = handleMove(matchId, userId, cell);
        ack?.({ ok: true, match: view });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    socket.on('queue:join', (payload, ack) => {
      try {
        const result = joinQueue(userId, payload?.game || 'tic-tac-toe', Number(payload?.stake_cents));
        ack?.({ ok: true, ...result });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    socket.on('queue:leave', (_payload, ack) => {
      ack?.({ ok: true, ...leaveQueue(userId) });
    });

    socket.on('wallet:sync', (_payload, ack) => {
      const balance = db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(userId)?.balance_cents ?? 0;
      ack?.({ ok: true, balance_cents: balance });
    });

    socket.on('notification:read', (_payload, ack) => {
      db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0').run(userId);
      ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      // A player who closes the tab must not linger in the matchmaking queue.
      db.prepare(`UPDATE queue_entries SET status = 'cancelled' WHERE user_id = ? AND status = 'waiting'`).run(userId);
      onUserDisconnect(userId);
    });
  });
}
