import { db, migrate, tx } from './index.js';
import { uid, nowIso, shortCode } from '../lib/ids.js';
import { hashPassword } from '../lib/crypto.js';
import { computeMatchSplit } from '../lib/money.js';

migrate();

const force = process.argv.includes('--force');
const existing = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (existing > 0 && !force) {
  console.log(`Database already has ${existing} users. Run with --force to add demo content.`);
  process.exit(0);
}

const FIRST = ['Viktor', 'Amina', 'Kelvin', 'Nia', 'Otis', 'Zara', 'Brian', 'Wanjiru', 'Silas', 'Mercy', 'Dento', 'Ivy', 'Rashid', 'Faith', 'Kevin', 'Lupita', 'Sami', 'Neema', 'Brian', 'Atieno'];
const LAST = ['Kimani', 'Otieno', 'Mwangi', 'Wanjala', 'Odhiambo', 'Achieng', 'Njoroge', 'Chebet', 'Maina', 'Karanja'];
const GAME = 'tic-tac-toe';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createUser({ username, email, phone, password, role = 'player', avatarSeed, country = 'Kenya', countryCode = 'KE', verified = true }) {
  const id = uid('usr');
  const now = nowIso();
  db.prepare(
    `INSERT INTO users
      (id, username, username_lower, email, email_lower, phone, phone_e164, password_hash, role, status,
       avatar_type, avatar_seed, country, country_code, email_verified, phone_verified, identity_verified,
       referral_code, created_at, updated_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'library', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    username,
    username.toLowerCase(),
    email,
    email.toLowerCase(),
    phone,
    phone,
    hashPassword(password),
    role,
    avatarSeed,
    country,
    countryCode,
    verified ? 1 : 0,
    verified ? 1 : 0,
    verified ? 1 : 0,
    `PP-${shortCode(6)}`,
    now,
    now,
    now,
  );
  db.prepare(`INSERT INTO wallets (user_id, balance_cents, locked_cents, currency, updated_at) VALUES (?, 0, 0, 'KES', ?)`).run(id, now);
  db.prepare(`INSERT INTO username_history (id, user_id, username, changed_at, reason) VALUES (?, ?, ?, ?, 'registration')`).run(uid('unh'), id, username, now);
  return id;
}

function postTransaction(userId, { type, direction, amountCents, title, description, refType = null, refId = null, createdAt }) {
  const current = db.prepare('SELECT balance_cents FROM wallets WHERE user_id = ?').get(userId).balance_cents;
  const delta = direction === 'credit' ? amountCents : -amountCents;
  const next = current + delta;
  db.prepare('UPDATE wallets SET balance_cents = ? WHERE user_id = ?').run(next, userId);
  db.prepare(
    `INSERT INTO transactions (id, user_id, type, direction, amount_cents, balance_after, status, ref_type, ref_id, title, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
  ).run(uid('txn'), userId, type, direction, amountCents, next, refType, refId, title, description, createdAt);
  return next;
}

function seedMatch(playerA, playerB, stakeCents, winnerId, createdAt, draw = false) {
  const { pool, fee, escrow } = computeMatchSplit(stakeCents, stakeCents);
  const matchId = uid('mch');
  const loserId = winnerId === playerA ? playerB : playerA;
  const board = { board: [null, null, null, null, null, null, null, null, null], moves: [] };

  db.prepare(
    `INSERT INTO matches (id, game_slug, stake_cents, pool_cents, fee_cents, escrow_cents, penalty_cents, status, is_tutorial,
      player_x_id, player_o_id, winner_id, loser_id, draw_count, board, turn, mode, created_at, started_at, ended_at, end_reason)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'completed', 0, ?, ?, ?, ?, ?, ?, 'x', 'ranked', ?, ?, ?, 'normal')`,
  ).run(matchId, GAME, stakeCents, pool, fee, escrow, playerA, playerB, winnerId, loserId, draw ? 1 : 0, JSON.stringify(board), createdAt, createdAt, createdAt);

  db.prepare(
    `INSERT INTO match_players (id, match_id, user_id, game_slug, seat, result, stake_cents, fee_cents, net_cents, moves, created_at)
     VALUES (?, ?, ?, ?, 'x', ?, ?, ?, ?, ?, ?)`,
  ).run(uid('mp'), matchId, playerA, GAME, playerA === winnerId ? 'win' : 'loss', stakeCents, playerA === winnerId ? fee : 0, playerA === winnerId ? escrow : -stakeCents, randomInt(4, 9), createdAt);
  db.prepare(
    `INSERT INTO match_players (id, match_id, user_id, game_slug, seat, result, stake_cents, fee_cents, net_cents, moves, created_at)
     VALUES (?, ?, ?, ?, 'o', ?, ?, ?, ?, ?, ?)`,
  ).run(uid('mp'), matchId, playerB, GAME, playerB === winnerId ? 'win' : 'loss', stakeCents, playerB === winnerId ? fee : 0, playerB === winnerId ? escrow : -stakeCents, randomInt(4, 9), createdAt);

  // Ledger entries (chronological)
  postTransaction(playerA, { type: 'stake', direction: 'debit', amountCents: stakeCents, title: 'Stake locked - Tic-Tac-Toe', description: 'Stake moved into escrow', refType: 'match', refId: matchId, createdAt });
  postTransaction(playerB, { type: 'stake', direction: 'debit', amountCents: stakeCents, title: 'Stake locked - Tic-Tac-Toe', description: 'Stake moved into escrow', refType: 'match', refId: matchId, createdAt });
  if (!draw) {
    postTransaction(winnerId, { type: 'win', direction: 'credit', amountCents: pool, title: 'Match winnings - Tic-Tac-Toe', description: `Gross pot released from escrow`, refType: 'match', refId: matchId, createdAt });
    postTransaction(winnerId, { type: 'fee', direction: 'debit', amountCents: fee, title: 'Platform fee (25%)', description: '25% of the pot', refType: 'match', refId: matchId, createdAt });
    db.prepare(`INSERT INTO platform_ledger (id, type, amount_cents, ref_type, ref_id, description, created_at) VALUES (?, 'fee', ?, 'match', ?, ?, ?)`).run(uid('plg'), fee, matchId, 'Platform fee 25%', createdAt);
  } else {
    postTransaction(playerA, { type: 'refund', direction: 'credit', amountCents: Math.floor(escrow / 2), title: 'Escrow refund - draw', description: 'Draw replay escrow share', refType: 'match', refId: matchId, createdAt });
    postTransaction(playerB, { type: 'refund', direction: 'credit', amountCents: Math.floor(escrow / 2), title: 'Escrow refund - draw', description: 'Draw replay escrow share', refType: 'match', refId: matchId, createdAt });
  }
  return matchId;
}

tx(() => {
  /* ------------------------------------------------------------ admins */
  createUser({ username: 'arenaadmin', email: 'admin@peerplay.gg', phone: '+254700000001', password: 'Admin123!', role: 'super_admin', avatarSeed: 3 });
  createUser({ username: 'opslead', email: 'ops@peerplay.gg', phone: '+254700000002', password: 'Admin123!', role: 'ops_admin', avatarSeed: 7 });
  createUser({ username: 'financeled', email: 'finance@peerplay.gg', phone: '+254700000003', password: 'Admin123!', role: 'finance_admin', avatarSeed: 11 });
  createUser({ username: 'modlead', email: 'moderation@peerplay.gg', phone: '+254700000004', password: 'Admin123!', role: 'mod_admin', avatarSeed: 15 });

  /* ---------------------------------------------------------- players */
  const players = [];
  const usedNames = new Set();
  for (let i = 0; i < 26; i += 1) {
    let username = `${pick(FIRST).toLowerCase()}${pick(LAST).toLowerCase()}`;
    while (usedNames.has(username)) username = `${username}${randomInt(2, 99)}`;
    usedNames.add(username);
    const id = createUser({
      username: username.slice(0, 16),
      email: `${username.slice(0, 16)}@example.com`,
      phone: `+2547${String(randomInt(10000000, 99999999))}`,
      password: 'Player123!',
      avatarSeed: randomInt(0, 23),
      country: i % 7 === 0 ? 'Uganda' : 'Kenya',
      countryCode: i % 7 === 0 ? 'UG' : 'KE',
    });
    players.push(id);
  }

  /* ------------------------------------------------------- match history */
  const now = Date.now();
  for (let i = 0; i < 190; i += 1) {
    const a = pick(players);
    let b = pick(players);
    if (b === a) continue;
    const stake = pick([1000, 1500, 2000, 2500, 3000, 5000, 10000]);
    const daysAgo = randomInt(0, 45);
    const createdAt = new Date(now - daysAgo * 86400000 - randomInt(0, 82800) * 1000).toISOString();
    const winner = Math.random() > 0.5 ? a : b;
    const draw = Math.random() > 0.9;
    seedMatch(a, b, stake, winner, createdAt, draw);

    const w = db.prepare('SELECT * FROM users WHERE id = ?').get(winner);
    const l = db.prepare('SELECT * FROM users WHERE id = ?').get(winner === a ? b : a);
    const { escrow, fee } = computeMatchSplit(stake, stake);
    db.prepare(
      `UPDATE users SET wins = wins + 1, streak_wins = streak_wins + 1, best_streak = MAX(best_streak, streak_wins + 1),
        games_played = games_played + 1, total_wagered_cents = total_wagered_cents + ?, total_won_cents = total_won_cents + ?,
        biggest_win_cents = MAX(biggest_win_cents, ?) WHERE id = ?`,
    ).run(stake, escrow, escrow, winner);
    db.prepare(
      `UPDATE users SET losses = losses + 1, streak_wins = 0, games_played = games_played + 1, total_wagered_cents = total_wagered_cents + ? WHERE id = ?`,
    ).run(stake, winner === a ? b : a);
    if (draw) {
      db.prepare('UPDATE users SET draws = draws + 1 WHERE id = ?').run(a);
      db.prepare('UPDATE users SET draws = draws + 1 WHERE id = ?').run(b);
    }
  }

  /* ------------------------------------------------------ balances */
  for (const pid of players) {
    const deposits = randomInt(2, 6);
    let total = 0;
    for (let i = 0; i < deposits; i += 1) {
      const amount = pick([5000, 10000, 20000, 25000, 50000]);
      total += amount;
      postTransaction(pid, {
        type: 'deposit',
        direction: 'credit',
        amountCents: amount,
        title: 'Deposit via M-Pesa',
        description: 'Deposit confirmed by M-Pesa.',
        createdAt: new Date(now - randomInt(1, 30) * 86400000).toISOString(),
      });
    }
    db.prepare('UPDATE users SET total_deposited_cents = ? WHERE id = ?').run(total, pid);
  }

  /* ------------------------------------------------------ journey state */
  for (const pid of players) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(pid);
    const done = Math.min(5, u.games_played);
    const state = done >= 5 ? 'complete' : done > 0 ? 'in_progress' : 'not_started';
    db.prepare(
      `UPDATE users SET journey_matches = ?, journey_state = ?, journey_wins = ?, journey_losses = ?,
        last_stake_cents = ?, first_deposit_done = 1, tutorial_done = 1, onboarding_step = ? WHERE id = ?`,
    ).run(done, state, Math.max(0, done - 1), done > 0 ? 1 : 0, pick([1000, 1500, 2000, 2500, 3000, 5000]), state === 'complete' ? 4 : 3, pid);
  }

  /* --------------------------------------------------------- friends */
  for (let i = 0; i < 18; i += 1) {
    const a = pick(players);
    const b = pick(players);
    if (a === b) continue;
    db.prepare(
      `INSERT INTO friendships (id, user_a, user_b, status, created_at, accepted_at) VALUES (?, ?, ?, 'accepted', ?, ?)`,
    ).run(uid('fr'), a, b, nowIso(), nowIso());
  }

  /* ------------------------------------------------------ reports */
  db.prepare(
    `INSERT INTO reports (id, reporter_id, reported_user_id, reason, details, severity, status, created_at)
     VALUES (?, ?, ?, 'draw_farming', 'Third draw in a row in the same match - looks like farming.', 'high', 'open', ?)`,
  ).run(uid('rep'), players[3], players[7], new Date(now - 3600000).toISOString());
  db.prepare(
    `INSERT INTO reports (id, reporter_id, reported_user_id, reason, details, severity, status, created_at)
     VALUES (?, ?, ?, 'disconnect_abuse', 'Keeps disconnecting to force a walkover.', 'medium', 'reviewing', ?)`,
  ).run(uid('rep'), players[9], players[12], new Date(now - 7200000).toISOString());

  /* ----------------------------------------------------- withdrawal */
  const wUser = players[2];
  db.prepare(
    `INSERT INTO withdrawals (id, user_id, amount_cents, fee_cents, net_cents, method, destination, status, risk_score, risk_flags, requested_at, expected_at)
     VALUES (?, ?, 5000, 0, 5000, 'mpesa', '+254712345678', 'review', 35, '[]', ?, ?)`,
  ).run(uid('wdw'), wUser, new Date(now - 5400000).toISOString(), new Date(now + 86400000).toISOString());
});

console.log('Seeded PeerPlay demo data:');
console.log('  Admin login   -> arenaadmin / Admin123!');
console.log('  Player login  -> (any seeded player) / Player123!');
console.log(`  Users: ${db.prepare('SELECT COUNT(*) AS n FROM users').get().n}`);
console.log(`  Matches: ${db.prepare('SELECT COUNT(*) AS n FROM matches').get().n}`);
console.log(`  Transactions: ${db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n}`);
