import { badRequest } from './errors.js';

export function requireString(value, field, { min = 1, max = 255 } = {}) {
  if (typeof value !== 'string') throw badRequest(`${field} is required`, { field });
  const v = value.trim();
  if (v.length < min) throw badRequest(`${field} must be at least ${min} characters`, { field });
  if (v.length > max) throw badRequest(`${field} must be at most ${max} characters`, { field });
  return v;
}

export function requireEmail(value, field = 'email') {
  const v = requireString(value, field, { max: 190 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) throw badRequest('Enter a valid email address', { field });
  return v;
}

/** Accepts Kenyan formats: 07xx..., 7xx..., +2547xx..., 2547xx... */
export function normalizePhone(value, field = 'phone') {
  const raw = String(value || '').replace(/[\s()-]/g, '');
  if (!raw) throw badRequest(`${field} is required`, { field });
  let digits = raw.replace(/^\+/, '');
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  if (!digits.startsWith('254') && /^7\d{9}$/.test(digits)) digits = `254${digits}`;
  if (!/^254\d{9}$/.test(digits)) throw badRequest('Enter a valid Kenyan phone number, e.g. 0712345678', { field });
  return `+${digits}`;
}

export function optionalString(value, field, opts = {}) {
  if (value === null || value === undefined || value === '') return null;
  return requireString(value, field, opts);
}

export function parseIntParam(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`, { field });
  if (n < min || n > max) throw badRequest(`${field} is out of range`, { field });
  return n;
}

export function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) throw badRequest(`${field} must be one of: ${allowed.join(', ')}`, { field });
  return value;
}

export function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,16}$/.test(username);
}
