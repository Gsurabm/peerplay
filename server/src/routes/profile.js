import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { optionalString, requireString, requireEnum } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { uid, nowIso } from '../lib/ids.js';
import { changeUsername, usernameChangeInfo, usernameHistory, findUserById } from '../services/identity.js';
import { walletSummary } from '../services/wallet.js';
import { reputationBreakdown } from '../services/reputation.js';
import { identitySignals } from '../services/risk.js';
import { publicUser } from './auth.js';
import { listFriends, sendFriendRequest, respondToFriendRequest, removeFriend, searchPlayers } from '../services/friends.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
    cb(null, `${uid('av')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return cb(badRequest('Avatars must be JPG or PNG images'));
    }
    return cb(null, true);
  },
});

router.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.userId);
  res.json({
    user: publicUser(user),
    username_policy: usernameChangeInfo(user),
    username_history: usernameHistory(user.id),
    financial: walletSummary(user.id),
    reputation: reputationBreakdown(user.id),
    signals: identitySignals(user),
  });
});

router.get('/:username', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username_lower = ?').get(String(req.params.username).toLowerCase());
  if (!user) throw notFound('Player not found');
  const total = user.wins + user.losses;
  const byGame = db
    .prepare(
      `SELECT mp.game_slug AS game, COUNT(*) AS played,
              SUM(CASE WHEN mp.result='win' THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN mp.result='loss' THEN 1 ELSE 0 END) AS losses
       FROM match_players mp JOIN matches m ON m.id = mp.match_id
       WHERE mp.user_id = ? AND m.is_tutorial = 0 GROUP BY mp.game_slug`,
    )
    .all(user.id);
  res.json({
    player: {
      id: user.id,
      username: user.username,
      avatar_type: user.avatar_type,
      avatar_seed: user.avatar_seed,
      avatar_url: user.avatar_url,
      country: user.country,
      country_code: user.country_code,
      city: user.city,
      bio: user.bio,
      wins: user.wins,
      losses: user.losses,
      draws: user.draws,
      win_rate: total ? Number(((user.wins / total) * 100).toFixed(1)) : 0,
      streak: user.streak_wins,
      best_streak: user.best_streak,
      games_played: user.games_played,
      reputation_score: user.reputation_score,
      fav_game: user.fav_game,
      created_at: user.created_at,
      last_seen_at: user.last_seen_at,
    },
    games: byGame,
  });
});

router.patch('/me', requireAuth, (req, res) => {
  const b = req.body || {};
  const bio = optionalString(b.bio, 'bio', { max: 280 });
  const city = optionalString(b.city, 'city', { max: 80 });
  const favGame = b.fav_game ? requireEnum(b.fav_game, 'favourite game', ['tic-tac-toe']) : null;
  db.prepare(
    `UPDATE users SET bio = COALESCE(?, bio), city = COALESCE(?, city), fav_game = COALESCE(?, fav_game), updated_at = ? WHERE id = ?`,
  ).run(bio, city, favGame, nowIso(), req.userId);
  res.json({ user: publicUser(findUserById(req.userId)) });
});

router.post('/username', requireAuth, (req, res) => {
  const username = requireString(req.body?.username, 'username', { min: 3, max: 16 });
  const user = changeUsername(req.userId, username);
  res.json({ user: publicUser(user), username_history: usernameHistory(req.userId) });
});

router.post('/avatar/upload', requireAuth, (req, res) => {
  upload.single('avatar')(req, res, (err) => {
    if (err) {
      const message = err?.message || 'Upload failed';
      return res.status(400).json({ error: message.includes('size') ? 'Avatar must be smaller than 2MB' : message });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    db.prepare('UPDATE users SET avatar_type = ?, avatar_url = ?, updated_at = ? WHERE id = ?').run(
      'upload',
      `/uploads/${req.file.filename}`,
      nowIso(),
      req.userId,
    );
    return res.json({ avatar_type: 'upload', avatar_url: `/uploads/${req.file.filename}` });
  });
});

router.post('/avatar/library', requireAuth, (req, res) => {
  const seed = Number.parseInt(req.body?.seed, 10);
  if (!Number.isInteger(seed) || seed < 0 || seed > 999) throw badRequest('Choose a valid avatar from the library');
  db.prepare('UPDATE users SET avatar_type = ?, avatar_seed = ?, avatar_url = NULL, updated_at = ? WHERE id = ?').run(
    'library',
    seed,
    nowIso(),
    req.userId,
  );
  res.json({ avatar_type: 'library', avatar_seed: seed });
});

router.get('/avatars/library', (_req, res) => {
  res.json({ seeds: Array.from({ length: 24 }, (_, i) => i) });
});

/* ------------------------------------------------------------- friends */

router.get('/friends/list', requireAuth, (req, res) => {
  res.json({ friends: listFriends(req.userId) });
});

router.get('/friends/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ players: [] });
  return res.json({ players: searchPlayers(q, req.userId) });
});

router.post('/friends/request', requireAuth, (req, res) => {
  const toUserId = requireString(req.body?.user_id, 'user id');
  res.json(sendFriendRequest(req.userId, toUserId));
});

router.post('/friends/respond', requireAuth, (req, res) => {
  const id = requireString(req.body?.friendship_id, 'friendship id');
  const accept = Boolean(req.body?.accept);
  res.json(respondToFriendRequest(id, req.userId, accept));
});

router.delete('/friends/:id', requireAuth, (req, res) => {
  res.json(removeFriend(req.params.id, req.userId));
});

export default router;
