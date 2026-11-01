import express from 'express';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest, notFound, forbidden } from '../lib/errors.js';
import { parseAmountToCents, isValidStake, onboardingRecommendedStake, formatKSh } from '../lib/money.js';
import { joinQueue, leaveQueue, queueStatus, onlinePlayers, listChallenges, createChallenge, respondToChallenge, getChallengeByCode } from '../services/matchmaking.js';
import { handleMove, matchView, getMatch, createTutorialMatch, finishTutorial } from '../services/matches.js';
import { journeyState, findUserById } from '../services/identity.js';
import { listGames } from '../services/games/registry.js';

const router = express.Router();

router.get('/games', (_req, res) => {
  res.json({ games: listGames(), config: {
    platform_fee_bps: config.platformFeeBps,
    min_stake_cents: config.minStakeCents,
    stake_step_cents: config.stakeStepCents,
    move_timer_sec: config.moveTimerSec,
    recovery_sec: config.recoverySec,
    max_draws: config.maxDraws,
    journey_length: config.journeyLength,
  } });
});

/* ------------------------------------------------------------- queue */

router.post('/queue', requireAuth, (req, res) => {
  const gameSlug = String(req.body?.game || 'tic-tac-toe');
  const stakeCents = Number.isFinite(Number(req.body?.stake_cents))
    ? Number(req.body.stake_cents)
    : parseAmountToCents(req.body?.stake);
  if (!Number.isFinite(stakeCents)) throw badRequest('Choose a valid stake');
  const result = joinQueue(req.userId, gameSlug, stakeCents);
  res.json(result);
});

router.delete('/queue', requireAuth, (req, res) => {
  res.json(leaveQueue(req.userId));
});

router.get('/queue', requireAuth, (req, res) => {
  res.json(queueStatus(req.userId));
});

router.get('/online', requireAuth, (req, res) => {
  res.json({ players: onlinePlayers(req.userId) });
});

/* -------------------------------------------------------- challenges */

router.get('/challenges', requireAuth, (req, res) => {
  res.json({ challenges: listChallenges(req.userId) });
});

router.post('/challenges', requireAuth, (req, res) => {
  const gameSlug = String(req.body?.game || 'tic-tac-toe');
  const stakeCents = Number.isFinite(Number(req.body?.stake_cents))
    ? Number(req.body.stake_cents)
    : parseAmountToCents(req.body?.stake);
  if (!Number.isFinite(stakeCents)) throw badRequest('Choose a valid stake');
  const challenge = createChallenge({
    fromUserId: req.userId,
    toUserId: req.body?.to_user_id || null,
    stakeCents,
    gameSlug,
    openLink: Boolean(req.body?.open_link),
  });
  res.status(201).json({ challenge });
});

router.post('/challenges/:id/respond', requireAuth, (req, res) => {
  const accept = req.body?.accept !== false;
  res.json(respondToChallenge({ challengeId: req.params.id, userId: req.userId, accept }));
});

router.get('/challenges/code/:code', (req, res) => {
  const challenge = getChallengeByCode(req.params.code);
  if (!challenge) throw notFound('Challenge not found');
  res.json({ challenge });
});

/* ----------------------------------------------------------- matches */

router.get('/mine', requireAuth, (req, res) => {
  const limit = Math.min(100, Number.parseInt(req.query.limit || '25', 10));
  const rows = db
    .prepare(
      `SELECT m.*, mp.seat, mp.result, mp.net_cents,
              ux.username AS x_username, uo.username AS o_username,
              ux.avatar_seed AS x_avatar_seed, ux.avatar_type AS x_avatar_type, ux.avatar_url AS x_avatar_url,
              uo.avatar_seed AS o_avatar_seed, uo.avatar_type AS o_avatar_type, uo.avatar_url AS o_avatar_url
       FROM match_players mp
       JOIN matches m ON m.id = mp.match_id
       LEFT JOIN users ux ON ux.id = m.player_x_id
       LEFT JOIN users uo ON uo.id = m.player_o_id
       WHERE mp.user_id = ? AND m.is_tutorial = 0
       ORDER BY COALESCE(m.ended_at, m.created_at) DESC LIMIT ?`,
    )
    .all(req.userId, limit);
  res.json({
    matches: rows.map((m) => ({
      id: m.id,
      game: m.game_slug,
      stake_cents: m.stake_cents,
      pool_cents: m.pool_cents,
      fee_cents: m.fee_cents,
      escrow_cents: m.escrow_cents,
      penalty_cents: m.penalty_cents,
      status: m.status,
      mode: m.mode,
      draw_count: m.draw_count,
      result: m.result,
      seat: m.seat,
      net_cents: m.net_cents,
      end_reason: m.end_reason,
      created_at: m.created_at,
      ended_at: m.ended_at,
      players: {
        x: { username: m.x_username, avatar_seed: m.x_avatar_seed, avatar_type: m.x_avatar_type, avatar_url: m.x_avatar_url },
        o: { username: m.o_username, avatar_seed: m.o_avatar_seed, avatar_type: m.o_avatar_type, avatar_url: m.o_avatar_url },
      },
    })),
  });
});

/* --------------------------------------------------- stake guidance */

router.get('/stake-guidance', requireAuth, (req, res) => {
  const user = findUserById(req.userId);
  const journey = journeyState(user);
  let recommended = null;
  if (journey.state !== 'complete' && user.last_stake_cents > 0) {
    recommended = onboardingRecommendedStake(user.last_stake_cents);
    recommended.raw_label = formatKSh(recommended.raw);
    recommended.value_label = formatKSh(recommended.value);
  }
  res.json({
    journey,
    recommended,
    min_stake_cents: config.minStakeCents,
    stake_step_cents: config.stakeStepCents,
    stake_options: [10, 15, 20, 25, 30, 50, 100, 200, 500].map((v) => v * 100),
  });
});

router.get('/:id', requireAuth, (req, res) => {
  const view = matchView(req.params.id, req.userId);
  if (!view) throw notFound('Match not found');
  res.json({ match: view });
});

router.post('/:id/move', requireAuth, (req, res) => {
  const cell = Number.parseInt(req.body?.cell, 10);
  if (!Number.isInteger(cell)) throw badRequest('Choose a square');
  const match = getMatch(req.params.id);
  if (!match) throw notFound('Match not found');
  if (match.player_x_id !== req.userId && match.player_o_id !== req.userId) throw forbidden('Not your match');
  const view = handleMove(req.params.id, req.userId, cell);
  res.json({ match: view });
});

/* ---------------------------------------------------------- tutorial */

router.post('/tutorial/start', requireAuth, (req, res) => {
  const match = createTutorialMatch(req.userId);
  res.json({ match: matchView(match.id, req.userId) });
});

router.post('/tutorial/finish', requireAuth, (req, res) => {
  finishTutorial(req.userId);
  const user = findUserById(req.userId);
  res.json({ tutorial_done: true, journey: journeyState(user) });
});

export default router;
