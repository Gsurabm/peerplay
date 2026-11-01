import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listNotifications, unreadCount, markRead } from '../services/notifications.js';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const limit = Math.min(100, Number.parseInt(req.query.limit || '40', 10));
  const unreadOnly = req.query.unread === '1';
  res.json({
    notifications: listNotifications(req.userId, { limit, unreadOnly }),
    unread: unreadCount(req.userId),
  });
});

router.post('/read', requireAuth, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  res.json({ unread: markRead(req.userId, ids) });
});

export default router;
