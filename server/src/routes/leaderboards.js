import express from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { computeLeaderboard, playerRankingSummary, SCOPES } from '../services/rankings.js';
import { friendIds } from '../services/friends.js';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const scope = SCOPES.includes(req.query.scope) ? req.query.scope : 'overall';
  const game = req.query.game || null;
  const country = req.query.country || null;
  const filter = req.query.filter || 'global';

  let friends = null;
  if (filter === 'friends') friends = friendIds(req.userId);

  const board = computeLeaderboard({
    scope,
    game,
    country,
    friendIds: friends,
    limit: 50,
    viewerId: req.userId,
  });

  const countries = db
    .prepare(`SELECT country_code AS code, country AS name, COUNT(*) AS players FROM users GROUP BY country_code ORDER BY players DESC`)
    .all();

  res.json({ ...board, filter, countries, scopes: SCOPES });
});

router.get('/me', requireAuth, (req, res) => {
  const scope = SCOPES.includes(req.query.scope) ? req.query.scope : 'overall';
  const board = computeLeaderboard({ scope, limit: 1, viewerId: req.userId });
  res.json({ summary: playerRankingSummary(req.userId), rank: board.viewer });
});

export default router;
