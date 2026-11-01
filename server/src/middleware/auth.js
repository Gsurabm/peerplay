import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

function readToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.pp_token) return req.cookies.pp_token;
  return null;
}

export function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();
  const payload = verifyToken(token);
  if (!payload) return next();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (user && user.status !== 'banned') {
    req.user = user;
    req.userId = user.id;
  }
  return next();
}

export function requireAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next(unauthorized());
  const payload = verifyToken(token);
  if (!payload) return next(unauthorized('Session expired, please sign in again'));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
  if (!user) return next(unauthorized('Account not found'));
  if (user.status === 'banned') return next(forbidden('This account has been banned'));
  if (user.status === 'suspended') return next(forbidden('This account is suspended'));
  req.user = user;
  req.userId = user.id;
  return next();
}

export const ADMIN_ROLES = ['super_admin', 'ops_admin', 'finance_admin', 'mod_admin'];

export function requireAdmin(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!ADMIN_ROLES.includes(req.user.role)) return next(forbidden('Admin access required'));
    if (roles.length && !roles.includes(req.user.role)) {
      return next(forbidden('Your admin role does not permit this action'));
    }
    return next();
  };
}

/** Capability matrix per admin role. */
export const ADMIN_CAPABILITIES = {
  super_admin: [
    'users.read', 'users.write', 'users.suspend', 'username.manage', 'reports.read', 'reports.resolve',
    'finance.read', 'finance.write', 'finance.withdrawals', 'matches.read', 'risk.read', 'audit.read',
  ],
  ops_admin: ['users.read', 'users.write', 'users.suspend', 'username.manage', 'reports.read', 'reports.resolve', 'matches.read', 'risk.read'],
  finance_admin: ['users.read', 'finance.read', 'finance.write', 'finance.withdrawals', 'matches.read', 'risk.read', 'audit.read'],
  mod_admin: ['reports.read', 'reports.resolve', 'users.read', 'matches.read', 'risk.read'],
};

export function can(role, capability) {
  return (ADMIN_CAPABILITIES[role] || []).includes(capability);
}

export function requireCapability(capability) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, capability)) {
      return next(forbidden(`Missing capability: ${capability}`));
    }
    return next();
  };
}
