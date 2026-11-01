import express from 'express';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { requireString, requireEmail, normalizePhone, optionalString } from '../lib/validate.js';
import { badRequest, conflict, unauthorized, forbidden } from '../lib/errors.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import {
  createUser,
  findUserById,
  findUserByLogin,
  checkPassword,
  issueVerificationCode,
  verifyCode,
  registerDevice,
  buildFingerprint,
  touchLogin,
  journeyState,
  setPassword,
} from '../services/identity.js';
import { getWallet, walletSummary, credit } from '../services/wallet.js';
import { registerReferral, findUserByReferralCode, trackInviteClick } from '../services/referrals.js';
import { notify } from '../services/notifications.js';
import { audit } from '../services/audit.js';
import { recordRiskEvent } from '../services/risk.js';
import { recordRankSnapshot } from '../services/rankings.js';
import { nowIso } from '../lib/ids.js';

const router = express.Router();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

/** Device fingerprint: a risk signal, hashed server-side, never the sole block reason. */
function captureDevice(req, userId) {
  const raw = req.headers['x-device-signals'];
  if (!raw) return null;
  try {
    const signals = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const fingerprint = buildFingerprint({
      ua: signals.ua || req.headers['user-agent'] || '',
      platform: signals.platform || '',
      language: signals.language || '',
      timezone: signals.timezone || '',
      screen: signals.screen || '',
      colorDepth: signals.colorDepth || '',
      deviceMemory: signals.deviceMemory || '',
      hardwareConcurrency: signals.hardwareConcurrency || '',
      persistentId: signals.persistentId || '',
    });
    registerDevice(userId, {
      fingerprint,
      platform: signals.platform || null,
      userAgent: req.headers['user-agent'] || null,
      ip: clientIp(req),
    });
    return fingerprint;
  } catch {
    return null;
  }
}

router.post('/register', (req, res) => {
  const b = req.body || {};
  const username = requireString(b.username, 'username', { min: 3, max: 16 });
  const email = requireEmail(b.email);
  const phone = b.phone ? normalizePhone(b.phone) : null;
  const password = requireString(b.password, 'password', { min: 8, max: 128 });
  const realName = optionalString(b.real_name, 'real name', { max: 120 });
  const legalIdType = optionalString(b.legal_id_type, 'legal id type', { max: 40 });
  const legalIdNumber = optionalString(b.legal_id_number, 'legal id number', { max: 60 });
  const country = optionalString(b.country, 'country', { max: 60 }) || 'Kenya';
  const countryCode = (optionalString(b.country_code, 'country code', { max: 4 }) || 'KE').toUpperCase();
  const city = optionalString(b.city, 'city', { max: 80 });

  let inviter = null;
  let referralSource = null;
  if (b.referral_code) {
    inviter = findUserByReferralCode(b.referral_code);
    if (inviter) referralSource = b.referral_source || 'referral_link';
    else throw badRequest('That referral code is not valid');
  }

  const user = createUser({
    username,
    email,
    phone,
    password,
    realName,
    legalIdType,
    legalIdNumber,
    country,
    countryCode,
    city,
    referredBy: inviter?.id || null,
    referralSource,
  });

  captureDevice(req, user.id);

  if (inviter) {
    registerReferral({
      inviterId: inviter.id,
      inviteeId: user.id,
      source: referralSource,
      channel: b.referral_channel || null,
    });
  }

  const emailCode = issueVerificationCode(user.id, 'email', 'email_verify');
  const phoneCode = phone ? issueVerificationCode(user.id, 'phone', 'phone_verify') : null;

  audit({ actorId: user.id, actorRole: 'player', action: 'user.register', targetType: 'user', targetId: user.id });

  res.status(201).json({
    token: signToken(user),
    user: publicUser(user),
    wallet: getWallet(user.id),
    verification: {
      email_code: emailCode.code,
      phone_code: phoneCode?.code || null,
      note: 'Sandbox delivery: codes are returned here instead of being emailed/SMSed.',
    },
  });
});


/**
 * Sandbox convenience: create a ready-to-play account in one click.
 * Funded wallet, verified identity and a completed onboarding journey so the
 * player can jump straight into a real staked match.
 */
router.post('/demo', (req, res) => {
  if (config.env === 'production') throw forbidden('Demo accounts are disabled in production');

  const ip = clientIp(req);
  const hour = new Date().toISOString().slice(0, 13);
  const used = db
    .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE action = 'demo.create' AND meta LIKE ?`)
    .get(`%"ip":"${ip}"%"`).c;
  // Sandbox-only endpoint: generous cap so a tester can spin up many pairs of players.
  if (used >= 300) throw badRequest('Too many demo accounts from this connection - try again shortly');

  const suffix = Math.random().toString(36).slice(2, 7);
  const username = `challenger_${suffix}`;
  const email = `${username}@demo.peerplay.gg`;
  const phone = `+2547${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const password = `demo${suffix.toUpperCase()}`;

  const user = createUser({
    username,
    email,
    phone,
    password,
    realName: 'Demo Challenger',
    legalIdType: 'National ID',
    legalIdNumber: `DEMO${Math.floor(100000 + Math.random() * 899999)}`,
    country: 'Kenya',
    countryCode: 'KE',
  });

  db.prepare(
    `UPDATE users SET email_verified = 1, phone_verified = 1, identity_verified = 1, tutorial_done = 1,
      first_deposit_done = 1, journey_state = 'complete', journey_matches = 5, journey_wins = 3, journey_losses = 2,
      onboarding_step = 4, last_stake_cents = 2000, avatar_seed = ?, updated_at = ? WHERE id = ?`,
  ).run(Math.floor(Math.random() * 24), nowIso(), user.id);

  credit(user.id, {
    type: 'deposit',
    amountCents: 100000,
    refType: 'demo',
    refId: user.id,
    title: 'Demo starting balance',
    description: 'Sandbox demo wallet credit - KSh 1,000.00 to play with.',
    meta: { demo: true },
  });

  audit({
    actorId: user.id,
    actorRole: 'player',
    action: 'demo.create',
    targetType: 'user',
    targetId: user.id,
    meta: { ip, username },
  });

  notify(user.id, {
    type: 'system',
    title: 'Welcome to PeerPlay',
    body: 'Your demo wallet is funded with KSh 1,000. Pick a stake and challenge an opponent.',
    data: { demo: true },
  });

  res.status(201).json({
    token: signToken(findUserById(user.id)),
    credentials: { username, password },
    user: publicUser(findUserById(user.id)),
    wallet: getWallet(user.id),
    journey: journeyState(findUserById(user.id)),
  });
});

router.post('/login', (req, res) => {
  const b = req.body || {};
  const identifier = requireString(b.identifier, 'email or username');
  const password = requireString(b.password, 'password');
  const user = findUserByLogin(identifier);
  if (!user || !checkPassword(user, password)) throw unauthorized('Incorrect username or password');
  if (user.status === 'banned') throw forbidden('This account has been banned. Contact support.');
  if (user.status === 'suspended') throw forbidden('This account is suspended. Contact support.');
  captureDevice(req, user.id);
  touchLogin(user.id, clientIp(req));
  res.json({
    token: signToken(user),
    user: publicUser(user),
    wallet: getWallet(user.id),
    journey: journeyState(user),
  });
});

router.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.userId);
  res.json({
    user: publicUser(user),
    wallet: getWallet(user.id),
    wallet_summary: walletSummary(user.id),
    journey: journeyState(user),
  });
});

router.post('/verify', requireAuth, (req, res) => {
  const { channel, code } = req.body || {};
  if (!['email', 'phone'].includes(channel)) throw badRequest('Channel must be email or phone');
  const purpose = channel === 'email' ? 'email_verify' : 'phone_verify';
  verifyCode(req.userId, channel, purpose, requireString(String(code || ''), 'code', { min: 4, max: 10 }));
  const user = findUserById(req.userId);
  notify(req.userId, {
    type: 'security',
    title: `${channel === 'email' ? 'Email' : 'Phone'} verified`,
    body: 'Your verification is complete - your trust score just went up.',
    data: { channel },
  });
  res.json({ verified: true, user: publicUser(user) });
});

router.post('/resend-verification', requireAuth, (req, res) => {
  const { channel } = req.body || {};
  const user = findUserById(req.userId);
  const target = channel === 'email' ? user.email : user.phone_e164;
  if (!target) throw badRequest('No phone number on file');
  const purpose = channel === 'email' ? 'email_verify' : 'phone_verify';
  const issued = issueVerificationCode(user.id, channel, purpose);
  res.json({ sent: true, channel, code: issued.code });
});

router.post('/identity', requireAuth, (req, res) => {
  const b = req.body || {};
  const realName = requireString(b.real_name, 'real name', { min: 3, max: 120 });
  const legalIdType = requireString(b.legal_id_type, 'legal id type', { max: 40 });
  const legalIdNumber = requireString(b.legal_id_number, 'legal id number', { min: 4, max: 60 });
  const city = optionalString(b.city, 'city', { max: 80 });

  const duplicate = db
    .prepare('SELECT id FROM users WHERE legal_id_number = ? AND id != ?')
    .get(legalIdNumber, req.userId);
  if (duplicate) {
    recordRiskEvent(req.userId, 'identity_duplicate', 40, { legal_id_type: legalIdType });
    throw conflict('That identity document is already registered to another account');
  }

  db.prepare(
    `UPDATE users SET real_name = ?, legal_id_type = ?, legal_id_number = ?, city = COALESCE(?, city),
      identity_verified = CASE WHEN email_verified = 1 AND phone_verified = 1 THEN 1 ELSE identity_verified END,
      updated_at = ? WHERE id = ?`,
  ).run(realName, legalIdType, legalIdNumber, city, new Date().toISOString(), req.userId);

  audit({ actorId: req.userId, actorRole: 'player', action: 'identity.submit', targetType: 'user', targetId: req.userId });
  const user = findUserById(req.userId);
  res.json({ user: publicUser(user), verified: Boolean(user.identity_verified) });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = findUserById(req.userId);
  if (!checkPassword(user, current_password)) throw badRequest('Current password is incorrect');
  if (!new_password || String(new_password).length < 8) throw badRequest('New password must be at least 8 characters');
  setPassword(req.userId, String(new_password));
  audit({ actorId: req.userId, actorRole: 'player', action: 'user.password_change', targetType: 'user', targetId: req.userId });
  res.json({ changed: true });
});

router.post('/referral-click', (req, res) => {
  const token = String(req.body?.token || '');
  const result = trackInviteClick(token, { source: req.body?.source || null });
  res.json({ tracked: Boolean(result) });
});

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    avatar_type: user.avatar_type,
    avatar_seed: user.avatar_seed,
    avatar_url: user.avatar_url,
    country: user.country,
    country_code: user.country_code,
    city: user.city,
    bio: user.bio,
    email_verified: Boolean(user.email_verified),
    phone_verified: Boolean(user.phone_verified),
    identity_verified: Boolean(user.identity_verified),
    journey_state: user.journey_state,
    journey_matches: user.journey_matches,
    referral_code: user.referral_code,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    streak_wins: user.streak_wins,
    best_streak: user.best_streak,
    games_played: user.games_played,
    reputation_score: user.reputation_score,
    risk_score: user.risk_score,
    total_wagered_cents: user.total_wagered_cents,
    total_won_cents: user.total_won_cents,
    biggest_win_cents: user.biggest_win_cents,
    total_deposited_cents: user.total_deposited_cents,
    total_withdrawn_cents: user.total_withdrawn_cents,
    tutorial_done: Boolean(user.tutorial_done),
    first_deposit_done: Boolean(user.first_deposit_done),
    created_at: user.created_at,
    last_seen_at: user.last_seen_at,
  };
}

export default router;
