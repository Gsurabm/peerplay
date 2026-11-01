import { config } from '../config.js';

/** All monetary amounts are stored as integer KES cents (1 KSh = 100 cents). */

export function formatKSh(cents) {
  const n = Number(cents || 0) / 100;
  return `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatKShShort(cents) {
  const n = Number(cents || 0) / 100;
  return `KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

/** Parse user input like "50", "50.50", "KSh 50" into integer cents. */
export function parseAmountToCents(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = String(input).replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function isValidStake(cents) {
  if (!Number.isInteger(cents)) return false;
  if (cents < config.minStakeCents) return false;
  if (cents % config.stakeStepCents !== 0) return false;
  return true;
}

/** Round down to the nearest allowed stake increment. */
export function floorToStakeStep(cents) {
  const step = config.stakeStepCents;
  return Math.floor(cents / step) * step;
}

/**
 * Recommended onboarding stake: 1.5x the previous stake.
 * The raw 1.5x value is returned as `raw` for display; the selectable value is
 * floored to the nearest legal stake increment (multiples of KSh 5) because
 * 1.5x of a KSh 5 multiple is not itself a legal stake (e.g. 112.50 -> 110).
 */
export function onboardingRecommendedStake(previousStakeCents) {
  if (!previousStakeCents) {
    return { raw: config.minStakeCents, value: config.minStakeCents };
  }
  const raw = Math.round(previousStakeCents * 1.5);
  return { raw, value: Math.max(config.minStakeCents, floorToStakeStep(raw)) };
}

/**
 * Core escrow maths for a two-player match.
 * pool = a + b; fee = 25% of pool; escrow = pool - fee.
 */
export function computeMatchSplit(stakeACents, stakeBCents) {
  const pool = stakeACents + stakeBCents;
  const fee = Math.round((pool * config.platformFeeBps) / 10000);
  const escrow = pool - fee;
  return { pool, fee, escrow };
}

/**
 * Anti-draw-farming penalty applied when a match is cancelled on the third draw.
 * penalty = 5% of the ORIGINAL combined stake, taken out of the escrow pot.
 */
export function computeDrawPenalty(originalPoolCents) {
  return Math.round((originalPoolCents * config.drawPenaltyBps) / 10000);
}
