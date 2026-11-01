import { db } from '../db/index.js';
import { config } from '../config.js';
import { uid, nowIso, numericCode } from '../lib/ids.js';
import { hashPassword, verifyPassword, fingerprintDevice, sha256 } from '../lib/crypto.js';
import { badRequest, conflict, notFound, forbidden } from '../lib/errors.js';
import { isValidUsername } from '../lib/validate.js';

/* ------------------------------------------------------------------ users */

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

export function findUserByLogin(login) {
  const key = String(login || '').trim().toLowerCase();
  return (
    db.prepare('SELECT * FROM users WHERE email_lower = ? OR username_lower = ?').get(key, key) || null
  );
}

export function assertUsernameAvailable(username, excludeUserId = null) {
  if (!isValidUsername(username)) {
    throw badRequest('Username must be 3-16 characters using letters, numbers or underscore');
  }
  const row = db.prepare('SELECT id FROM users WHERE username_lower = ?').get(username.toLowerCase());
  if (row && row.id !== excludeUserId) throw conflict('That username is already taken');
  return true;
}

export function createUser({
  username,
  email,
  phone,
  password,
  realName = null,
  legalIdType = null,
  legalIdNumber = null,
  country = 'Kenya',
  countryCode = 'KE',
  city = null,
  referredBy = null,
  referralSource = null,
}) {
  assertUsernameAvailable(username);
  const existingEmail = db.prepare('SELECT id FROM users WHERE email_lower = ?').get(email.toLowerCase());
  if (existingEmail) throw conflict('An account with that email already exists');
  if (phone) {
    const existingPhone = db.prepare('SELECT id FROM users WHERE phone_e164 = ?').get(phone);
    if (existingPhone) throw conflict('An account with that phone number already exists');
  }

  const id = uid('usr');
  const now = nowIso();
  const referralCode = `PP-${sha256(id).slice(0, 8).toUpperCase()}`;

  db.prepare(
    `INSERT INTO users
      (id, username, username_lower, email, email_lower, phone, phone_e164, password_hash, role, status,
       real_name, legal_id_type, legal_id_number, country, country_code, city,
       referral_code, referred_by, referral_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'player', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    username,
    username.toLowerCase(),
    email,
    email.toLowerCase(),
    phone,
    phone,
    hashPassword(password),
    realName,
    legalIdType,
    legalIdNumber,
    country,
    countryCode,
    city,
    referralCode,
    referredBy,
    referralSource,
    now,
    now,
  );

  db.prepare(
    `INSERT INTO wallets (user_id, balance_cents, locked_cents, currency, updated_at) VALUES (?, 0, 0, 'KES', ?)`,
  ).run(id, now);

  db.prepare(
    `INSERT INTO username_history (id, user_id, username, changed_at, reason) VALUES (?, ?, ?, ?, 'registration')`,
  ).run(uid('unh'), id, username, now);

  return findUserById(id);
}

export function checkPassword(user, password) {
  return verifyPassword(password, user.password_hash);
}

export function setPassword(userId, password) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(password),
    nowIso(),
    userId,
  );
}

/* --------------------------------------------------------------- username */

export function usernameChangeInfo(user) {
  const last = db
    .prepare('SELECT changed_at FROM username_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT 1')
    .get(user.id);
  if (!last) return { can_change: true, last_changed_at: null };
  const nextAllowed = new Date(new Date(last.changed_at).getTime() + 30 * 86400000);
  return {
    can_change: nextAllowed.getTime() <= Date.now(),
    last_changed_at: last.changed_at,
    next_change_available_at: nextAllowed.toISOString(),
  };
}

export function changeUsername(userId, newUsername) {
  const user = findUserById(userId);
  if (!user) throw notFound('Account not found');
  const info = usernameChangeInfo(user);
  if (!info.can_change) {
    throw forbidden('You can only change your username once per month');
  }
  assertUsernameAvailable(newUsername, userId);
  const now = nowIso();
  db.prepare('UPDATE users SET username = ?, username_lower = ?, updated_at = ? WHERE id = ?').run(
    newUsername,
    newUsername.toLowerCase(),
    now,
    userId,
  );
  db.prepare(
    `INSERT INTO username_history (id, user_id, username, changed_at, reason) VALUES (?, ?, ?, ?, 'change')`,
  ).run(uid('unh'), userId, newUsername, now);
  return findUserById(userId);
}

export function usernameHistory(userId, limit = 50) {
  return db
    .prepare('SELECT username, changed_at, reason FROM username_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT ?')
    .all(userId, limit);
}

/* ----------------------------------------------------------- verification */

export function issueVerificationCode(userId, channel, purpose, { ttlMinutes = 15 } = {}) {
  const code = numericCode(6);
  const id = uid('vt');
  const now = new Date();
  db.prepare(
    `INSERT INTO verification_tokens (id, user_id, channel, purpose, code_hash, attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, userId, channel, purpose, sha256(`${channel}:${purpose}:${code}`), new Date(now.getTime() + ttlMinutes * 60000).toISOString(), now.toISOString());
  return { id, code, channel, purpose, expires_in_minutes: ttlMinutes };
}

export function verifyCode(userId, channel, purpose, code) {
  const row = db
    .prepare(
      `SELECT * FROM verification_tokens WHERE user_id = ? AND channel = ? AND purpose = ? AND verified_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId, channel, purpose);
  if (!row) throw badRequest('Request a new verification code');
  if (new Date(row.expires_at).getTime() < Date.now()) throw badRequest('That code has expired - request a new one');
  if (row.attempts >= 6) throw badRequest('Too many attempts - request a new code');
  db.prepare('UPDATE verification_tokens SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  if (sha256(`${channel}:${purpose}:${String(code).trim()}`) !== row.code_hash) {
    throw badRequest('Incorrect verification code');
  }
  db.prepare('UPDATE verification_tokens SET verified_at = ? WHERE id = ?').run(nowIso(), row.id);
  if (channel === 'email' && purpose === 'email_verify') {
    db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?').run(nowIso(), userId);
  }
  if (channel === 'phone' && purpose === 'phone_verify') {
    db.prepare('UPDATE users SET phone_verified = 1, updated_at = ? WHERE id = ?').run(nowIso(), userId);
  }
  return true;
}

/* -------------------------------------------------------------- devices */

export function registerDevice(userId, { fingerprint, platform, userAgent, ip }) {
  const now = nowIso();
  const existing = db.prepare('SELECT * FROM devices WHERE user_id = ? AND fingerprint = ?').get(userId, fingerprint);
  if (existing) {
    db.prepare('UPDATE devices SET last_seen_at = ?, ip = ?, user_agent = ? WHERE id = ?').run(now, ip, userAgent, existing.id);
    return existing.id;
  }
  const id = uid('dev');
  db.prepare(
    `INSERT INTO devices (id, user_id, fingerprint, platform, user_agent, ip, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, fingerprint, platform, userAgent, ip, now, now);
  db.prepare('UPDATE users SET device_fingerprint = ?, last_seen_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?').run(
    fingerprint,
    now,
    ip,
    now,
    userId,
  );
  return id;
}

export function accountsOnDevice(fingerprint, excludeUserId = null) {
  const rows = db.prepare('SELECT user_id FROM devices WHERE fingerprint = ?').all(fingerprint);
  return rows.map((r) => r.user_id).filter((id) => id !== excludeUserId);
}

export function buildFingerprint(parts) {
  return fingerprintDevice(parts);
}

export function touchLogin(userId, ip) {
  db.prepare('UPDATE users SET last_seen_at = ?, last_login_ip = ? WHERE id = ?').run(nowIso(), ip, userId);
}

export function journeyState(user) {
  const remaining = Math.max(0, config.journeyLength - user.journey_matches);
  return {
    state: user.journey_state,
    completed: user.journey_matches,
    required: config.journeyLength,
    remaining,
    wins: user.journey_wins,
    losses: user.journey_losses,
    withdrawals_unlocked: user.journey_state === 'complete',
  };
}
