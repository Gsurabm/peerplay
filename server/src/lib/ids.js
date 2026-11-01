import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function uid(prefix = '') {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

/** Human-friendly, unambiguous code (no 0/O/1/I). */
export function shortCode(length = 8) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function numericCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += crypto.randomInt(0, 10);
  return out;
}

export function reference(prefix = 'PP') {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}-${shortCode(6)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoPlus(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
