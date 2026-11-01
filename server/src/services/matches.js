import { db, tx } from '../db/index.js';
import { config } from '../config.js';
import { uid, nowIso } from '../lib/ids.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { computeMatchSplit, computeDrawPenalty, formatKSh, onboardingRecommendedStake } from '../lib/money.js';
import { getGame } from './games/registry.js';
import { credit, debit, platformLedger, ensureWallet } from './wallet.js';
import { notify } from './notifications.js';
import { emitToMatch, emitToUser, isOnline } from '../realtime/io.js';
import { updateReputation } from './reputation.js';
import { maybeQualifyReferral } from './referrals.js';

const AI_PLAYER = 'ai';

/* --------------------------------------------------------------- helpers */

export function getMatch(matchId) {
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) || null;
}

export function playerSeat(match, userId) {
  if (match.player_x_id === userId) return 'x';
  if (match.player_o_id === userId) return 'o';
  return null;
}

function logEvent(matchId, type, actorId = null, payload = null) {
  db.prepare(
    `INSERT INTO match_events (id, match_id, type, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(uid('mev'), matchId, type, actorId, payload ? JSON.stringify(payload) : null, nowIso());
}

export function getPlayerRow(matchId, userId) {
  return db.prepare('SELECT * FROM match_players WHERE match_id = ? AND user_id = ?').get(matchId, userId) || null;
}

/* ---------------------------------------------------------- match create */

/**
 * Create a match and move both stakes into escrow.
 * Escrow holds the pot minus the 25% platform fee; the fee is only recognised
 * in the platform ledger when the match settles.
 */
export function createMatch({
  gameSlug,
  stakeCents,
  playerAId,
  playerBId,
  mode = 'ranked',
  isTutorial = false,
  createdBy = null,
  matchId = null,
}) {
  const game = getGame(gameSlug);
  if (!game) throw badRequest('Unknown game');

  const id = matchId || uid('mch');
  const { pool, fee, escrow } = computeMatchSplit(stakeCents, stakeCents);
  const now = nowIso();

  tx(() => {
    if (!isTutorial) {
      for (const pid of [playerAId, playerBId]) {
        const wallet = ensureWallet(pid);
        if (wallet.balance_cents < stakeCents) {
          throw conflict('One of the players does not have enough balance for this stake');
        }
      }
      for (const pid of [playerAId, playerBId]) {
        debit(pid, {
          type: 'stake',
          amountCents: stakeCents,
          refType: 'match',
          refId: id,
          title: `Stake locked - ${game.name}`,
          description: `Stake of ${formatKSh(stakeCents)} moved into escrow for match ${id.slice(-6)}`,
          meta: { match_id: id, game: gameSlug, escrow_cents: escrow, platform_fee_cents: fee },
        });
      }
    }

    db.prepare(
      `INSERT INTO matches
        (id, game_slug, stake_cents, pool_cents, fee_cents, escrow_cents, penalty_cents, status, is_tutorial,
         player_x_id, player_o_id, board, turn, mode, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, 'x', ?, ?, ?)`,
    ).run(
      id,
      gameSlug,
      stakeCents,
      pool,
      fee,
      escrow,
      isTutorial ? 1 : 0,
      playerAId,
      playerBId,
      JSON.stringify(game.initialState()),
      mode,
      createdBy,
      now,
    );

    db.prepare(
      `INSERT INTO match_players (id, match_id, user_id, game_slug, seat, result, stake_cents, fee_cents, net_cents, created_at)
       VALUES (?, ?, ?, ?, 'x', 'pending', ?, 0, 0, ?)`,
    ).run(uid('mp'), id, playerAId, gameSlug, isTutorial ? 0 : stakeCents, now);

    db.prepare(
      `INSERT INTO match_players (id, match_id, user_id, game_slug, seat, result, stake_cents, fee_cents, net_cents, created_at)
       VALUES (?, ?, ?, ?, 'o', 'pending', ?, 0, 0, ?)`,
    ).run(uid('mp'), id, playerBId, gameSlug, isTutorial ? 0 : stakeCents, now);

    logEvent(id, 'created', createdBy, { stake_cents: stakeCents, mode, tutorial: isTutorial });
  });

  const match = getMatch(id);
  return match;
}

/** Put a pending match into play: initial board + first turn timer. */
export function activateMatch(matchId) {
  const match = getMatch(matchId);
  if (!match) return null;
  const game = getGame(match.game_slug);
  const state = game.initialState();
  const deadline = new Date(Date.now() + game.turnSec * 1000).toISOString();
  db.prepare(
    `UPDATE matches SET status = 'active', board = ?, turn = 'x', turn_started_at = ?, turn_deadline = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
  ).run(JSON.stringify(state), nowIso(), deadline, nowIso(), matchId);
  logEvent(matchId, 'started');
  broadcastState(matchId);
  return getMatch(matchId);
}

/* ---------------------------------------------------------- realtime view */

export function matchView(matchId, viewerId = null) {
  const match = getMatch(matchId);
  if (!match) return null;
  const game = getGame(match.game_slug);
  const board = JSON.parse(match.board || '{}');
  const players = db
    .prepare(
      `SELECT mp.*, u.username, u.avatar_type, u.avatar_seed, u.avatar_url, u.country_code, u.streak_wins, u.wins, u.losses
       FROM match_players mp LEFT JOIN users u ON u.id = mp.user_id WHERE mp.match_id = ?`,
    )
    .all(matchId);

  const x = players.find((p) => p.seat === 'x');
  const o = players.find((p) => p.seat === 'o');
  const viewerSeat = viewerId ? playerSeat(match, viewerId) : null;

  return {
    id: match.id,
    game: { slug: game.slug, name: game.name, turn_sec: game.turnSec, rules: game.rules },
    stake_cents: match.stake_cents,
    pool_cents: match.pool_cents,
    fee_cents: match.fee_cents,
    escrow_cents: match.escrow_cents,
    penalty_cents: match.penalty_cents,
    status: match.status,
    mode: match.mode,
    is_tutorial: Boolean(match.is_tutorial),
    draw_count: match.draw_count,
    board: board.board,
    moves: board.moves || [],
    turn: match.turn,
    turn_deadline: match.turn_deadline,
    turn_started_at: match.turn_started_at,
    disconnect_user_id: match.disconnect_user_id,
    disconnect_deadline: match.disconnect_deadline,
    recovery_seconds: config.recoverySec,
    move_seconds: game.turnSec,
    winner_id: match.winner_id,
    loser_id: match.loser_id,
    end_reason: match.end_reason,
    viewer_seat: viewerSeat,
    viewer_turn: Boolean(viewerSeat) && match.turn === viewerSeat && match.status === 'active',
    server_time: nowIso(),
    players: {
      x: x ? publicPlayer(x) : null,
      o: o ? publicPlayer(o) : null,
    },
  };
}

function publicPlayer(row) {
  return {
    user_id: row.user_id,
    username: row.username || (row.user_id === AI_PLAYER ? 'PeerPlay Trainer' : 'Unknown'),
    avatar_type: row.avatar_type,
    avatar_seed: row.avatar_seed,
    avatar_url: row.avatar_url,
    seat: row.seat,
    result: row.result,
    is_ai: row.user_id === AI_PLAYER,
    country_code: row.country_code,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    streak_wins: row.streak_wins ?? 0,
    disconnected: Boolean(row.disconnected),
  };
}

export function broadcastState(matchId) {
  const match = getMatch(matchId);
  if (!match) return;
  // Generic view for the match room (spectators / late joiners) first...
  emitToMatch(matchId, 'match_state', matchView(matchId));
  // ...then a per-player view so each client knows whose turn it is.
  for (const pid of [match.player_x_id, match.player_o_id]) {
    if (pid && pid !== AI_PLAYER) emitToUser(pid, 'match_state', matchView(matchId, pid));
  }
}

/* ------------------------------------------------------------- move flow */

export function handleMove(matchId, userId, cell) {
  const match = getMatch(matchId);
  if (!match) throw notFound('Match not found');
  if (match.status !== 'active') throw conflict('This match is not active');
  if (match.is_tutorial && match.player_o_id === AI_PLAYER && userId !== AI_PLAYER) {
    // normal human turn
  }
  const seat = playerSeat(match, userId);
  if (!seat) throw forbidden('You are not part of this match');
  if (match.disconnect_user_id === userId) throw conflict('Your connection is recovering');
  if (match.turn !== seat) throw conflict('It is not your turn');
  if (match.turn_deadline && Date.now() > new Date(match.turn_deadline).getTime()) {
    forfeitByTimeout(matchId);
    throw conflict('Your time expired');
  }

  const game = getGame(match.game_slug);
  const state = JSON.parse(match.board || '{}');
  const result = game.applyMove(state, seat, cell);
  if (!result.ok) throw badRequest(result.error === 'cell_taken' ? 'That square is already taken' : 'Invalid square');

  db.prepare('UPDATE matches SET board = ? WHERE id = ?').run(JSON.stringify(result.state), matchId);
  db.prepare('UPDATE match_players SET moves = moves + 1 WHERE match_id = ? AND seat = ?').run(matchId, seat);
  logEvent(matchId, 'move', userId, { seat, cell });

  if (result.result.outcome === 'win') {
    settleWin(matchId, seat === 'x' ? match.player_x_id : match.player_o_id, seat === 'x' ? match.player_o_id : match.player_x_id, 'normal');
    return matchView(matchId, userId);
  }

  if (result.result.outcome === 'draw') {
    handleDraw(matchId);
    return matchView(matchId, userId);
  }

  // next turn
  const nextSeat = seat === 'x' ? 'o' : 'x';
  const deadline = new Date(Date.now() + game.turnSec * 1000).toISOString();
  db.prepare('UPDATE matches SET turn = ?, turn_started_at = ?, turn_deadline = ? WHERE id = ?').run(
    nextSeat,
    nowIso(),
    deadline,
    matchId,
  );
  logEvent(matchId, 'turn', null, { seat: nextSeat });

  const nextUser = nextSeat === 'x' ? match.player_x_id : match.player_o_id;
  if (nextUser && nextUser !== AI_PLAYER) {
    const count = db
      .prepare(`SELECT COUNT(*) AS c FROM match_events WHERE match_id = ? AND type = 'turn' AND actor_id = ?`)
      .get(matchId, nextUser)?.c || 0;
    emitToUser(nextUser, 'your_turn', { match_id: matchId });
    if (count < 4) {
      notify(nextUser, {
        type: 'match',
        title: 'Your turn',
        body: `Make your move in ${game.name} - ${game.turnSec}s on the clock.`,
        data: { match_id: matchId },
      });
    }
  } else if (nextUser === AI_PLAYER) {
    scheduleAiMove(matchId);
  }
  broadcastState(matchId);
  return matchView(matchId, userId);
}

/* ----------------------------------------------------------- draw system */

function handleDraw(matchId) {
  const match = getMatch(matchId);
  const drawCount = match.draw_count + 1;
  const game = getGame(match.game_slug);
  logEvent(matchId, 'draw', null, { draw_count: drawCount });

  if (drawCount >= config.maxDraws) {
    cancelWithPenalty(matchId, drawCount);
    return;
  }

  const warning = drawCount >= config.maxDraws - 1;
  db.prepare(
    `UPDATE matches SET draw_count = ?, board = ?, turn = 'x', turn_started_at = ?, turn_deadline = ?, status = 'active' WHERE id = ?`,
  ).run(drawCount, JSON.stringify(game.initialState()), nowIso(), new Date(Date.now() + game.turnSec * 1000).toISOString(), matchId);

  const message = warning
    ? `Draw #${drawCount} - draw farming warning. One more draw cancels the match and a 5% penalty is applied to the pot.`
    : `Draw #${drawCount} - same escrow, instant rematch. No additional fee.`;

  for (const pid of [match.player_x_id, match.player_o_id]) {
    if (!pid || pid === AI_PLAYER) continue;
    notify(pid, {
      type: 'match',
      title: warning ? `Draw #${drawCount} - draw farming warning` : `Draw #${drawCount} - rematch`,
      body: message,
      data: { match_id: matchId, draw_count: drawCount, warning },
    });
  }
  emitToMatch(matchId, 'match_draw', {
    match_id: matchId,
    draw_count: drawCount,
    warning,
    message,
    escrow_cents: match.escrow_cents,
  });
  broadcastState(matchId);
}

/**
 * Third draw: cancel the match and apply the anti-draw-farming penalty
 * (5% of the ORIGINAL combined stake) out of the escrow pot.
 */
function cancelWithPenalty(matchId, drawCount) {
  const match = getMatch(matchId);
  const penalty = computeDrawPenalty(match.pool_cents);
  const distributable = match.escrow_cents - penalty;
  const share = Math.floor(distributable / 2);
  const remainder = distributable - share * 2;
  const now = nowIso();

  tx(() => {
    db.prepare(
      `UPDATE matches SET status = 'cancelled', penalty_cents = ?, draw_count = ?, ended_at = ?, end_reason = 'draw_farming_penalty', turn_deadline = NULL, disconnect_deadline = NULL WHERE id = ?`,
    ).run(penalty, drawCount, now, matchId);

    for (const pid of [match.player_x_id, match.player_o_id]) {
      if (!pid || pid === AI_PLAYER) continue;
      const grossShare = Math.floor(match.escrow_cents / 2);
      credit(pid, {
        type: 'refund',
        amountCents: grossShare,
        refType: 'match',
        refId: matchId,
        title: 'Escrow refund - match cancelled',
        description: `Match cancelled after ${drawCount} draws. Escrow share released (fee and draw penalty deducted).`,
        meta: { match_id: matchId, draw_count: drawCount },
      });
      debit(pid, {
        type: 'penalty',
        amountCents: grossShare - share,
        refType: 'match',
        refId: matchId,
        title: 'Anti-draw-farming penalty',
        description: `5% of the original ${formatKSh(match.pool_cents)} pot, charged after ${drawCount} draws.`,
        meta: { match_id: matchId, draw_count: drawCount, penalty_cents: penalty },
      });
      if (remainder && grossShare > share) {
        credit(pid, {
          type: 'refund',
          amountCents: remainder,
          refType: 'match',
          refId: matchId,
          title: 'Escrow refund - rounding',
          description: 'Remaining escrow cent.',
          meta: { match_id: matchId },
        });
      }
      db.prepare(`UPDATE match_players SET result = 'draw' WHERE match_id = ? AND user_id = ?`).run(matchId, pid);
    }

    platformLedger({
      type: 'fee',
      amountCents: match.fee_cents,
      refType: 'match',
      refId: matchId,
      description: `Platform fee 25% - cancelled match ${matchId.slice(-6)} (${drawCount} draws)`,
    });
    platformLedger({
      type: 'penalty',
      amountCents: penalty,
      refType: 'match',
      refId: matchId,
      description: `Anti-draw-farming penalty on match ${matchId.slice(-6)}`,
    });
    logEvent(matchId, 'cancelled', null, { draw_count: drawCount, penalty_cents: penalty });
  });

  for (const pid of [match.player_x_id, match.player_o_id]) {
    if (!pid || pid === AI_PLAYER) continue;
    notify(pid, {
      type: 'match',
      title: 'Match cancelled - draw farming penalty',
      body: `${drawCount} draws. A 5% penalty (${formatKSh(penalty)}) was taken from the pot. Each escrow share released: ${formatKSh(share)}.`,
      data: { match_id: matchId, penalty_cents: penalty, share_cents: share },
    });
  }

  emitToMatch(matchId, 'match_end', {
    match_id: matchId,
    status: 'cancelled',
    end_reason: 'draw_farming_penalty',
    draw_count: drawCount,
    penalty_cents: penalty,
    refund_cents: share,
    pool_cents: match.pool_cents,
    fee_cents: match.fee_cents,
  });
  broadcastState(matchId);
}

/* ------------------------------------------------------------- settlement */

export function settleWin(matchId, winnerId, loserId, reason = 'normal') {
  const match = getMatch(matchId);
  if (!match || match.status === 'completed') return null;
  const now = nowIso();
  const fee = match.fee_cents;
  const payout = match.escrow_cents;

  tx(() => {
    db.prepare(
      `UPDATE matches SET status = 'completed', winner_id = ?, loser_id = ?, ended_at = ?, end_reason = ?, turn_deadline = NULL, disconnect_deadline = NULL, disconnect_user_id = NULL WHERE id = ?`,
    ).run(winnerId, loserId, now, reason, matchId);

    if (!match.is_tutorial) {
      // Winner receives the gross pot, the platform fee is then charged (net = escrow).
      credit(winnerId, {
        type: 'win',
        amountCents: match.pool_cents,
        refType: 'match',
        refId: matchId,
        title: `Match winnings - ${getGame(match.game_slug).name}`,
        description: `Gross pot ${formatKSh(match.pool_cents)} released from escrow.`,
        meta: { match_id: matchId, gross_cents: match.pool_cents, fee_cents: fee, net_cents: payout },
      });
      debit(winnerId, {
        type: 'fee',
        amountCents: fee,
        refType: 'match',
        refId: matchId,
        title: 'Platform fee (25%)',
        description: `25% of the ${formatKSh(match.pool_cents)} pot. Net payout ${formatKSh(payout)}.`,
        meta: { match_id: matchId, platform_fee_bps: config.platformFeeBps },
      });

      db.prepare(`UPDATE match_players SET result = 'win', net_cents = ?, fee_cents = ? WHERE match_id = ? AND user_id = ?`).run(payout, fee, matchId, winnerId);
      db.prepare(`UPDATE match_players SET result = 'loss', net_cents = ?, fee_cents = ? WHERE match_id = ? AND user_id = ?`).run(-match.stake_cents, 0, matchId, loserId);

      platformLedger({
        type: 'fee',
        amountCents: fee,
        refType: 'match',
        refId: matchId,
        description: `Platform fee 25% - match ${matchId.slice(-6)}`,
      });

      applyStats(winnerId, { result: 'win', stakeCents: match.stake_cents, payout, matchId, reason });
      applyStats(loserId, { result: 'loss', stakeCents: match.stake_cents, payout: 0, matchId, reason });
    } else {
      db.prepare(`UPDATE match_players SET result = 'win', net_cents = 0 WHERE match_id = ? AND user_id = ?`).run(matchId, winnerId);
      db.prepare(`UPDATE match_players SET result = 'loss', net_cents = 0 WHERE match_id = ? AND user_id = ?`).run(matchId, loserId);
    }

    logEvent(matchId, 'settled', winnerId, { reason, payout_cents: payout, fee_cents: fee });
  });

  const settlement = {
    match_id: matchId,
    status: 'completed',
    end_reason: reason,
    winner_id: winnerId,
    loser_id: loserId,
    stake_cents: match.stake_cents,
    pool_cents: match.pool_cents,
    fee_cents: fee,
    payout_cents: payout,
    reason,
  };

  if (!match.is_tutorial) {
    for (const pid of [winnerId, loserId]) {
      const won = pid === winnerId;
      notify(pid, {
        type: 'match',
        title: won ? 'You won!' : 'Match lost',
        body: won
          ? `You took ${formatKSh(payout)} from a ${formatKSh(match.pool_cents)} pot (25% platform fee).`
          : `You lost ${formatKSh(match.stake_cents)} to a ${reason === 'normal' ? 'better player' : reason}.`,
        data: { match_id: matchId, result: won ? 'win' : 'loss', payout_cents: payout },
      });
    }
  }

  emitToMatch(matchId, 'match_end', settlement);
  broadcastState(matchId);
  return settlement;
}

function applyStats(userId, { result, stakeCents, payout, matchId, reason }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;
  const now = nowIso();
  const won = result === 'win';

  if (won) {
    db.prepare(
      `UPDATE users SET wins = wins + 1, streak_wins = streak_wins + 1, best_streak = MAX(best_streak, streak_wins + 1),
        games_played = games_played + 1, total_wagered_cents = total_wagered_cents + ?,
        total_won_cents = total_won_cents + ?, biggest_win_cents = MAX(biggest_win_cents, ?), updated_at = ? WHERE id = ?`,
    ).run(stakeCents, payout, payout, now, userId);
  } else {
    db.prepare(
      `UPDATE users SET losses = losses + 1, streak_wins = 0, games_played = games_played + 1,
        total_wagered_cents = total_wagered_cents + ?, updated_at = ? WHERE id = ?`,
    ).run(stakeCents, now, userId);
  }

  // Onboarding journey: only decisive matches count.
  if (user.journey_state !== 'complete') {
    const completed = user.journey_matches + 1;
    const state = completed >= config.journeyLength ? 'complete' : 'in_progress';
    db.prepare(
      `UPDATE users SET journey_matches = ?, journey_wins = journey_wins + ?, journey_losses = journey_losses + ?,
        journey_state = ?, last_stake_cents = ?, updated_at = ? WHERE id = ?`,
    ).run(completed, won ? 1 : 0, won ? 0 : 1, state, stakeCents, now, userId);

    if (state === 'complete') {
      db.prepare('UPDATE users SET onboarding_step = 4, updated_at = ? WHERE id = ?').run(now, userId);
      notify(userId, {
        type: 'social',
        title: 'Journey complete - you are unlocked',
        body: `Five matches done. Withdrawals are now open and you can choose any stake. Welcome to PeerPlay.`,
        data: { journey: 'complete' },
      });
      maybeQualifyReferral(userId);
    } else {
      const remaining = config.journeyLength - completed;
      notify(userId, {
        type: 'social',
        title: `Journey ${completed}/${config.journeyLength}`,
        body: `${remaining} match${remaining === 1 ? '' : 'es'} to go. Recommended next stake: ${formatKSh(onboardingRecommendedStake(stakeCents).value)}.`,
        data: { journey_matches: completed },
      });
    }
  }

  updateReputation(userId, won ? 'match_win' : 'match_loss', {
    matchId,
    reason,
    delta: won ? 12 : -6,
  });
}

/* ------------------------------------------------------ forfeits & timers */

function forfeitByTimeout(matchId) {
  const match = getMatch(matchId);
  if (!match || match.status !== 'active') return;
  const loserId = match.turn === 'x' ? match.player_x_id : match.player_o_id;
  const winnerId = match.turn === 'x' ? match.player_o_id : match.player_x_id;
  settleWin(matchId, winnerId, loserId, 'timeout');
  updateReputation(loserId, 'timeout_forfeit', { matchId, delta: -20 });
  db.prepare('UPDATE match_players SET disconnected = 1 WHERE match_id = ? AND user_id = ?').run(matchId, loserId);
}

function forfeitByDisconnect(matchId, disconnectedId) {
  const match = getMatch(matchId);
  if (!match || match.status !== 'active') return;
  const winnerId = disconnectedId === match.player_x_id ? match.player_o_id : match.player_x_id;
  settleWin(matchId, winnerId, disconnectedId, 'disconnect');
  updateReputation(disconnectedId, 'disconnect_forfeit', { matchId, delta: -25 });
  db.prepare('UPDATE match_players SET disconnected = 1 WHERE match_id = ? AND user_id = ?').run(matchId, disconnectedId);
}

/** Called every second by the engine loop. */
export function tick() {
  const now = Date.now();
  const active = db.prepare(`SELECT * FROM matches WHERE status = 'active'`).all();
  for (const match of active) {
    if (match.disconnect_deadline && now > new Date(match.disconnect_deadline).getTime()) {
      forfeitByDisconnect(match.id, match.disconnect_user_id);
      continue;
    }
    if (match.turn_deadline && now > new Date(match.turn_deadline).getTime()) {
      forfeitByTimeout(match.id);
    }
  }
}

let engineTimer = null;

export function startEngine() {
  if (engineTimer) return;
  engineTimer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error('[engine] tick error', err);
    }
  }, 1000);
  engineTimer.unref?.();
}

export function stopEngine() {
  if (engineTimer) clearInterval(engineTimer);
  engineTimer = null;
}

/* --------------------------------------------------- connect / disconnect */

export function onUserDisconnect(userId) {
  const matches = db
    .prepare(`SELECT * FROM matches WHERE status = 'active' AND (player_x_id = ? OR player_o_id = ?)`)
    .all(userId, userId);
  for (const match of matches) {
    const deadline = new Date(Date.now() + config.recoverySec * 1000).toISOString();
    db.prepare('UPDATE matches SET disconnect_user_id = ?, disconnect_deadline = ?, turn_deadline = ? WHERE id = ?').run(
      userId,
      deadline,
      deadline,
      match.id,
    );
    db.prepare('UPDATE match_players SET disconnected = 1 WHERE match_id = ? AND user_id = ?').run(match.id, userId);
    const opponentId = match.player_x_id === userId ? match.player_o_id : match.player_x_id;
    logEvent(match.id, 'disconnect', userId, { recovery_until: deadline });
    emitToMatch(match.id, 'match_recovery', {
      match_id: match.id,
      user_id: userId,
      deadline,
      recovery_seconds: config.recoverySec,
      message: `Opponent connection interrupted. Recovery time remaining: ${config.recoverySec} seconds.`,
    });
    if (opponentId && opponentId !== AI_PLAYER) {
      notify(opponentId, {
        type: 'match',
        title: 'Opponent connection interrupted',
        body: `Recovery time remaining: ${config.recoverySec} seconds. If they do not return, you win the match.`,
        data: { match_id: match.id },
      });
    }
    broadcastState(match.id);
  }
}

export function onUserReconnect(userId) {
  const matches = db
    .prepare(`SELECT * FROM matches WHERE status = 'active' AND (player_x_id = ? OR player_o_id = ?)`)
    .all(userId, userId);
  for (const match of matches) {
    db.prepare(
      'UPDATE matches SET disconnect_user_id = NULL, disconnect_deadline = NULL, turn_deadline = ? WHERE id = ?',
    ).run(new Date(Date.now() + config.moveTimerSec * 1000).toISOString(), match.id);
    db.prepare('UPDATE match_players SET disconnected = 0 WHERE match_id = ? AND user_id = ?').run(match.id, userId);
    logEvent(match.id, 'reconnect', userId, {});
    emitToMatch(match.id, 'match_recovery', {
      match_id: match.id,
      user_id: userId,
      recovered: true,
      message: 'Opponent is back online.',
    });
    broadcastState(match.id);
  }
}

/* ------------------------------------------------------------ AI trainer */

const aiTimers = new Map();

function scheduleAiMove(matchId) {
  clearTimeout(aiTimers.get(matchId));
  const timer = setTimeout(() => {
    aiTimers.delete(matchId);
    const match = getMatch(matchId);
    if (!match || match.status !== 'active' || match.turn !== 'o') return;
    const game = getGame(match.game_slug);
    const state = JSON.parse(match.board || '{}');
    const cell = pickAiMove(state.board);
    if (cell === null) return;
    const result = game.applyMove(state, 'o', cell);
    db.prepare('UPDATE matches SET board = ? WHERE id = ?').run(JSON.stringify(result.state), matchId);
    db.prepare('UPDATE match_players SET moves = moves + 1 WHERE match_id = ? AND seat = ?').run(matchId, 'o');
    logEvent(matchId, 'move', AI_PLAYER, { seat: 'o', cell });
    if (result.result.outcome === 'win') {
      settleWin(matchId, AI_PLAYER, match.player_x_id, 'normal');
      return;
    }
    if (result.result.outcome === 'draw') {
      handleDraw(matchId);
      return;
    }
    const deadline = new Date(Date.now() + game.turnSec * 1000).toISOString();
    db.prepare('UPDATE matches SET turn = ?, turn_started_at = ?, turn_deadline = ? WHERE id = ?').run('x', nowIso(), deadline, matchId);
    broadcastState(matchId);
  }, 900);
  aiTimers.set(matchId, timer);
  timer.unref?.();
}

function pickAiMove(board) {
  const empties = board.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  if (!empties.length) return null;
  const wins = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
  ];
  const wouldWin = (seat) =>
    wins.find(([a, b, c]) => board[a] === seat && board[b] === seat && board[c] === null)?.[2] ??
    wins.map(([a, b, c]) => (board[a] === seat && board[b] === seat && board[c] === null ? c : null)).find((v) => v !== null);
  const winCell = wouldWin('o');
  if (winCell !== null && winCell !== undefined) return winCell;
  const blockCell = wouldWin('x');
  if (blockCell !== null && blockCell !== undefined) return blockCell;
  if (board[4] === null) return 4;
  const corners = [0, 2, 6, 8].filter((i) => board[i] === null);
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  return empties[Math.floor(Math.random() * empties.length)];
}

/* ------------------------------------------------------------- tutorial */

export function createTutorialMatch(userId) {
  const existing = db
    .prepare(`SELECT id FROM matches WHERE player_x_id = ? AND is_tutorial = 1 AND status IN ('pending','active')`)
    .get(userId);
  if (existing) return getMatch(existing.id);
  const match = createMatch({
    gameSlug: 'tic-tac-toe',
    stakeCents: 0,
    playerAId: userId,
    playerBId: AI_PLAYER,
    mode: 'tutorial',
    isTutorial: true,
    createdBy: userId,
  });
  activateMatch(match.id);
  return getMatch(match.id);
}

export function finishTutorial(userId) {
  db.prepare('UPDATE users SET tutorial_done = 1, onboarding_step = MAX(onboarding_step, 1), updated_at = ? WHERE id = ?').run(
    nowIso(),
    userId,
  );
}

export { AI_PLAYER, isOnline };
