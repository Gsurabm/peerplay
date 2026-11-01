import React from 'react';

const PALETTES = [
  ['#00e5ff', '#0b3a5c'],
  ['#ff2d95', '#4a0f30'],
  ['#7dff8a', '#123a1c'],
  ['#ffc857', '#4a3410'],
  ['#a66bff', '#2c1550'],
  ['#ff8b5c', '#4a2310'],
  ['#5c9dff', '#122a4a'],
  ['#00ffc8', '#0a4a3c'],
];

/**
 * Platform-created avatar library: deterministic geometric art generated on the
 * client from a numeric seed. No AI-generated imagery anywhere in PeerPlay.
 */
export function avatarArt(seed = 0) {
  const s = Number(seed || 0);
  const [a, b] = PALETTES[s % PALETTES.length];
  const variant = s % 6;
  const rot = (s * 37) % 360;
  const cx = 30 + ((s * 13) % 40);
  const cy = 30 + ((s * 17) % 40);

  let shapes = '';
  if (variant === 0) {
    shapes = `<circle cx="${cx}" cy="${cy}" r="26" fill="${a}" opacity="0.92"/><circle cx="${cx}" cy="${cy}" r="14" fill="${b}"/>`;
  } else if (variant === 1) {
    shapes = `<rect x="14" y="14" width="42" height="42" rx="10" fill="${a}" opacity="0.9" transform="rotate(${rot} 35 35)"/><rect x="24" y="24" width="22" height="22" rx="6" fill="${b}"/>`;
  } else if (variant === 2) {
    shapes = `<polygon points="35,10 60,50 10,50" fill="${a}" opacity="0.9"/><circle cx="35" cy="42" r="9" fill="${b}"/>`;
  } else if (variant === 3) {
    shapes = `<circle cx="35" cy="35" r="24" fill="none" stroke="${a}" stroke-width="9" opacity="0.9"/><circle cx="35" cy="35" r="8" fill="${a}"/>`;
  } else if (variant === 4) {
    shapes = `<rect x="12" y="26" width="46" height="12" rx="6" fill="${a}" opacity="0.9" transform="rotate(${rot} 35 35)"/><rect x="26" y="12" width="12" height="46" rx="6" fill="${a}" opacity="0.6" transform="rotate(${rot} 35 35)"/>`;
  } else {
    shapes = `<path d="M12 45 L35 12 L58 45 Z" fill="${a}" opacity="0.85"/><path d="M22 45 L35 26 L48 45 Z" fill="${b}"/>`;
  }

  return (
    <svg viewBox="0 0 70 70" width="100%" height="100%" role="img" aria-label="Player avatar">
      <defs>
        <linearGradient id={`g${s}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={b} />
          <stop offset="100%" stopColor="#070b14" />
        </linearGradient>
      </defs>
      <rect width="70" height="70" fill={`url(#g${s})`} />
      {shapes}
    </svg>
  );
}

export default function Avatar({ src, seed, size = 40, ring = false, online = null, className = '' }) {
  const cls = `avatar sz-${size} ${ring ? 'ring' : ''} ${className}`;
  return (
    <span className={cls}>
      {src ? <img src={src} alt="" /> : avatarArt(seed ?? 0)}
      {online !== null && online !== undefined && <i className={`dot ${online ? '' : 'off'}`} />}
    </span>
  );
}
