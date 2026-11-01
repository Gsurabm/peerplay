import { db } from '../db/index.js';
import { config } from '../config.js';
import { uid, nowIso, shortCode } from '../lib/ids.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { isValidStake } from '../lib/money.js';
import { getGame } from './games/registry.js';
import { createMatch, activateMatch, getMatch } from './matches.js';
import { notify } from './notifications.js';
import { emitToUser, isOnline } from '../realtime/io.js';
import { getWallet } from './wallet.js';

const QUEUE_TTL_MS = 15 * 60 * 1000;
/** A player is matchable if they have a live socket OR they joined the queue in the last 90s. */
const RECENT_QUEUE_MS = 45 * 1000;

function isMatchable(userId, entryCreatedAt) {
  if (isOnline(userId)) return true;
  if (!entryCreatedAt) return false;
  return Date.now() - new Date(entryCreatedAt).getTime() < RECENT_QUEUE_MS;
}

/* ------------------------------------------------------------- queue */

export function joinQueue(userId, gameSlug, stakeCents) {
  const game = getGame(gameSlug);
  if (!game) throw badRequest('Unknown game');
  if (!isValidStake(stakeCents)) {
    throw badRequest(`Stake must be a multiple of KSh 5 and at least KSh ${config.minStakeCents / 100}`);
  }
  const wallet = getWallet(userId);
  if (wallet.available_cents < stakeCents) {
    throw conflict('Your balance is too low for this stake');
  }

  db.prepare(`UPDATE queue_entries SET status = 'cancelled' WHERE user_id = ? AND status = 'waiting'`).run(userId);
  db.prepare(`DELETE FROM queue_entries WHERE user_id = ? AND status = 'waiting'`).run(userId);

  const cutoff = new Date(Date.now() - QUEUE_TTL_MS).toISOString();
  const candidates = db
    .prepare(
      `SELECT * FROM queue_entries WHERE status = 'waiting' AND game_slug = ? AND stake_cents = ?
       AND user_id != ? AND created_at > ? ORDER BY created_at ASC LIMIT 10`,
    )
    .all(gameSlug, stakeCents, userId, cutoff);

  // Skip stale entries (player left / went offline) instead of giving up.
  let candidate = null;
  for (const entry of candidates) {
    const player = db.prepare('SELECT * FROM users WHERE id = ?').get(entry.user_id);
    if (!player || player.status !== 'active' || !isMatchable(player.id, entry.created_at)) {
      db.prepare(`UPDATE queue_entries SET status = 'expired' WHERE id = ?`).run(entry.id);
      continue;
    }
    candidate = entry;
    break;
  }

  const entryId = uid('qe');
  if (candidate) {
    const opponent = db.prepare('SELECT * FROM users WHERE id = ?').get(candidate.user_id);
    const match = createMatch({
      gameSlug,
      stakeCents,
      playerAId: opponent.id,
      playerBId: userId,
      mode: 'ranked',
      createdBy: userId,
    });
    db.prepare(`UPDATE queue_entries SET status = 'matched', match_id = ? WHERE id IN (?, ?)`).run(match.id, candidate.id, entryId);
    activateMatch(match.id);
    notify(opponent.id, {
      type: 'match',
      title: 'Opponent found',
      body: `Match started - ${game.name} at KSh ${(stakeCents / 100).toLocaleString('en-KE')}.`,
      data: { match_id: match.id },
    });
    notify(userId, {
      type: 'match',
      title: 'Opponent found',
      body: `Match started - ${game.name} at KSh ${(stakeCents / 100).toLocaleString('en-KE')}.`,
      data: { match_id: match.id },
    });
    // Both players are pulled straight into the match.
    emitToUser(opponent.id, 'match_found', { match_id: match.id, game: gameSlug, stake_cents: stakeCents });
    emitToUser(userId, 'match_found', { match_id: match.id, game: gameSlug, stake_cents: stakeCents });
    return { status: 'matched', match_id: match.id, opponent: publicOpponent(opponent.id) };
  }

  return waitInQueue(userId, gameSlug, stakeCents, entryId);
}

function waitInQueue(userId, gameSlug, stakeCents, entryId) {
  db.prepare(
    `INSERT INTO queue_entries (id, user_id, game_slug, stake_cents, status, created_at) VALUES (?, ?, ?, ?, 'waiting', ?)`,
  ).run(entryId, userId, gameSlug, stakeCents, nowIso());
  const online = db
    .prepare(
      `SELECT COUNT(*) AS c FROM queue_entries WHERE status = 'waiting' AND game_slug = ? AND stake_cents = ? AND created_at > ?`,
    )
    .get(gameSlug, stakeCents, new Date(Date.now() - QUEUE_TTL_MS).toISOString());
  notify(userId, {
    type: 'match',
    title: 'Searching for an opponent',
    body: `Looking for a ${gameName(gameSlug)} opponent at KSh ${(stakeCents / 100).toLocaleString('en-KE')}.`,
    data: { queue: 'waiting', stake_cents: stakeCents, game: gameSlug },
  });
  return {
    status: 'waiting',
    entry_id: entryId,
    players_in_queue: online?.c || 1,
    game: gameSlug,
    stake_cents: stakeCents,
  };
}

function gameName(slug) {
  return getGame(slug)?.name || slug;
}

export function leaveQueue(userId) {
  db.prepare(`UPDATE queue_entries SET status = 'cancelled' WHERE user_id = ? AND status = 'waiting'`).run(userId);
  return { status: 'cancelled' };
}

export function queueStatus(userId) {
  const entry = db
    .prepare(`SELECT * FROM queue_entries WHERE user_id = ? AND status = 'waiting' ORDER BY created_at DESC LIMIT 1`)
    .get(userId);
  if (!entry) return { status: 'idle' };
  const online = db
    .prepare(
      `SELECT COUNT(*) AS c FROM queue_entries WHERE status = 'waiting' AND game_slug = ? AND stake_cents = ?`,
    )
    .get(entry.game_slug, entry.stake_cents);
  return {
    status: 'waiting',
    game: entry.game_slug,
    stake_cents: entry.stake_cents,
    entry_id: entry.id,
    players_in_queue: online?.c || 1,
  };
}

/** Simple cross-pairing sweep: when someone joins, also try to pair older queues. */
export function sweepQueue() {
  const cutoff = new Date(Date.now() - QUEUE_TTL_MS).toISOString();
  const waiting = db
    .prepare(`SELECT * FROM queue_entries WHERE status = 'waiting' AND created_at > ? ORDER BY created_at ASC`)
    .all(cutoff);
  const groups = new Map();
  for (const entry of waiting) {
    const key = `${entry.game_slug}:${entry.stake_cents}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const [, entries] of groups) {
    while (entries.length >= 2) {
      const a = entries.shift();
      const b = entries.shift();
      const ua = db.prepare('SELECT * FROM users WHERE id = ?').get(a.user_id);
      const ub = db.prepare('SELECT * FROM users WHERE id = ?').get(b.user_id);
      if (!ua || !ub || !isMatchable(a.user_id, a.created_at) || !isMatchable(b.user_id, b.created_at)) continue;
      const match = createMatch({
        gameSlug: a.game_slug,
        stakeCents: a.stake_cents,
        playerAId: a.user_id,
        playerBId: b.user_id,
        mode: 'ranked',
        createdBy: a.user_id,
      });
      db.prepare(`UPDATE queue_entries SET status = 'matched', match_id = ? WHERE id IN (?, ?)`).run(match.id, a.id, b.id);
      activateMatch(match.id);
      for (const uidv of [a.user_id, b.user_id]) {
        notify(uidv, {
          type: 'match',
          title: 'Opponent found',
          body: `Match started - ${gameName(a.game_slug)} at KSh ${(a.stake_cents / 100).toLocaleString('en-KE')}.`,
          data: { match_id: match.id },
        });
      }
    }
  }
}

/* ---------------------------------------------------------- challenges */

export function createChallenge({ fromUserId, toUserId = null, stakeCents, gameSlug, openLink = false }) {
  const game = getGame(gameSlug);
  if (!game) throw badRequest('Unknown game');
  if (!isValidStake(stakeCents)) throw badRequest('Stake must be a multiple of KSh 5 (minimum KSh 10)');
  const wallet = getWallet(fromUserId);
  if (wallet.available_cents < stakeCents) throw conflict('Your balance is too low for this stake');

  if (toUserId) {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(toUserId);
    if (!target) throw notFound('Player not found');
    if (target.id === fromUserId) throw badRequest('You cannot challenge yourself');
  }

  const id = uid('chl');
  const code = shortCode(10);
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO challenges (id, from_user_id, to_user_id, open_link, game_slug, stake_cents, code, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(id, fromUserId, toUserId, openLink ? 1 : 0, gameSlug, stakeCents, code, nowIso(), expires);

  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  if (toUserId) {
    notify(toUserId, {
      type: 'match',
      title: 'Challenge received',
      body: `You have been challenged to ${game.name} for KSh ${(stakeCents / 100).toLocaleString('en-KE')}.`,
      data: { challenge_id: id, from: db.prepare('SELECT username FROM users WHERE id = ?').get(fromUserId)?.username },
    });
  }
  return challenge;
}

export function respondToChallenge({ challengeId, userId, accept }) {
  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
  if (!challenge) throw notFound('Challenge not found');
  if (challenge.status !== 'pending') throw conflict('This challenge is no longer open');
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE challenges SET status = 'expired' WHERE id = ?`).run(challengeId);
    throw conflict('This challenge has expired');
  }
  if (challenge.to_user_id && challenge.to_user_id !== userId) throw forbidden('This challenge is not for you');
  if (challenge.from_user_id === userId) throw badRequest('You cannot accept your own challenge');

  const opponent = db.prepare('SELECT * FROM users WHERE id = ?').get(challenge.from_user_id);
  if (!opponent) throw notFound('Opponent not found');

  if (!accept) {
    db.prepare(`UPDATE challenges SET status = 'declined', responded_at = ? WHERE id = ?`).run(nowIso(), challengeId);
    notify(challenge.from_user_id, {
      type: 'match',
      title: 'Challenge declined',
      body: `Your ${getGame(challenge.game_slug)?.name} challenge was declined.`,
      data: { challenge_id: challengeId },
    });
    return { status: 'declined' };
  }

  const wallet = getWallet(userId);
  if (wallet.available_cents < challenge.stake_cents) throw conflict('Your balance is too low for this stake');
  const oppWallet = getWallet(opponent.id);
  if (oppWallet.available_cents < challenge.stake_cents) {
    throw conflict('Your opponent no longer has enough balance for this stake');
  }

  const match = createMatch({
    gameSlug: challenge.game_slug,
    stakeCents: challenge.stake_cents,
    playerAId: opponent.id,
    playerBId: userId,
    mode: challenge.to_user_id ? 'friend' : 'ranked',
    createdBy: userId,
  });
  db.prepare(`UPDATE challenges SET status = 'accepted', responded_at = ?, match_id = ? WHERE id = ?`).run(nowIso(), match.id, challengeId);
  activateMatch(match.id);

  notify(opponent.id, {
    type: 'match',
    title: 'Challenge accepted - match live',
    body: `Your ${getGame(challenge.game_slug)?.name} match at KSh ${(challenge.stake_cents / 100).toLocaleString('en-KE')} is starting.`,
    data: { match_id: match.id },
  });
  emitToUser(opponent.id, 'match_found', { match_id: match.id, game: challenge.game_slug, stake_cents: challenge.stake_cents });
  notify(userId, {
    type: 'match',
    title: 'Opponent found',
    body: `Match live - ${getGame(challenge.game_slug)?.name} at KSh ${(challenge.stake_cents / 100).toLocaleString('en-KE')}.`,
    data: { match_id: match.id },
  });
  return { status: 'accepted', match_id: match.id };
}

export function listChallenges(userId) {
  const rows = db
    .prepare(
      `SELECT c.*, u.username AS from_username, u.avatar_seed AS from_avatar_seed, u.avatar_type AS from_avatar_type,
              u.avatar_url AS from_avatar_url, u.wins AS from_wins, u.losses AS from_losses
       FROM challenges c JOIN users u ON u.id = c.from_user_id
       WHERE (c.to_user_id = ? OR c.open_link = 1) AND c.status = 'pending'
       ORDER BY c.created_at DESC LIMIT 50`,
    )
    .all(userId);
  return rows;
}

export function getChallengeByCode(code) {
  const challenge = db.prepare('SELECT * FROM challenges WHERE code = ?').get(code);
  if (!challenge) return null;
  const from = db.prepare('SELECT username, avatar_seed, avatar_type, avatar_url, wins, losses, reputation_score FROM users WHERE id = ?').get(challenge.from_user_id);
  return { ...challenge, from };
}

export function publicOpponent(userId) {
  const u = db.prepare('SELECT username, avatar_seed, avatar_type, avatar_url, wins, losses, streak_wins, reputation_score, country_code FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return {
    username: u.username,
    avatar_seed: u.avatar_seed,
    avatar_type: u.avatar_type,
    avatar_url: u.avatar_url,
    wins: u.wins,
    losses: u.losses,
    streak_wins: u.streak_wins,
    reputation_score: u.reputation_score,
    country_code: u.country_code,
  };
}

/** Players currently online and open to a challenge. */
export function onlinePlayers(excludeUserId = null) {
  const rows = db
    .prepare(`SELECT * FROM users WHERE status = 'active' AND last_seen_at > ? ORDER BY reputation_score DESC LIMIT 50`)
    .all(new Date(Date.now() - 10 * 60 * 1000).toISOString());
  return rows
    .filter((u) => u.id !== excludeUserId)
    .filter((u) => isOnline(u.id))
    .map((u) => ({
      id: u.id,
      username: u.username,
      avatar_seed: u.avatar_seed,
      avatar_type: u.avatar_type,
      avatar_url: u.avatar_url,
      wins: u.wins,
      losses: u.losses,
      streak_wins: u.streak_wins,
      reputation_score: u.reputation_score,
      country_code: u.country_code,
      online: true,
    }));
}
