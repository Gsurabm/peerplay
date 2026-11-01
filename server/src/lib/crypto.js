import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password, hash) {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Device fingerprints are salted + hashed so raw signals are never stored. */
export function fingerprintDevice(parts) {
  const canonical = Object.keys(parts)
    .sort()
    .map((k) => `${k}:${parts[k] ?? ''}`)
    .join('|');
  return sha256(`${config.deviceSalt}::${canonical}`);
}

export function hmacSign(payload, secret = config.webhookSecret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function hmacVerify(payload, signature, secret = config.webhookSecret) {
  const expected = hmacSign(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function signJwt(payload) {
  return crypto
    .createHash('sha256')
    .update(`${payload}:${config.jwtSecret}`)
    .digest('hex');
}
