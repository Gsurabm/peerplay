import { db } from '../db/index.js';
import { config } from '../config.js';
import { uid, nowIso } from '../lib/ids.js';
import { credit, platformLedger } from './wallet.js';
import { notify } from './notifications.js';

export const REFERRAL_CHANNELS = ['sms', 'whatsapp', 'email', 'social', 'copy'];

export function createInvite(userId, { channel = 'copy', target = null, source = null } = {}) {
  const token = uid('inv').replace(/-/g, '').slice(0, 18);
  const id = uid('invt');
  db.prepare(
    `INSERT INTO invites (id, user_id, token, channel, target, source, clicks, conversions, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(id, userId, token, channel, target, source, nowIso());
  return db.prepare('SELECT * FROM invites WHERE id = ?').get(id);
}

export function inviteLink(token) {
  return `/join/${token}`;
}

export function trackInviteClick(token, meta = {}) {
  const invite = db.prepare('SELECT * FROM invites WHERE token = ?').get(token);
  if (!invite) return null;
  db.prepare('UPDATE invites SET clicks = clicks + 1 WHERE id = ?').run(invite.id);
  return { inviter_id: invite.user_id, channel: invite.channel, source: meta.source || null };
}

export function registerReferral({ inviterId, inviteeId, source = null, channel = null }) {
  if (!inviterId || inviterId === inviteeId) return null;
  const id = uid('ref');
  db.prepare(
    `INSERT INTO referrals (id, inviter_id, invitee_id, source, channel, status, created_at) VALUES (?, ?, ?, ?, ?, 'registered', ?)`,
  ).run(id, inviterId, inviteeId, source, channel, nowIso());
  db.prepare('UPDATE invites SET conversions = conversions + 1 WHERE user_id = ? AND token IS NOT NULL').run(inviterId);
  notify(inviterId, {
    type: 'social',
    title: 'A friend joined PeerPlay',
    body: 'Your invite converted into a new account. Complete their 5-match journey to earn your referral bonus.',
    data: { referral_id: id },
  });
  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(id);
}

/** Called when a referred player completes the 5-match onboarding journey. */
export function maybeQualifyReferral(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.referred_by) return null;
  const referral = db
    .prepare(`SELECT * FROM referrals WHERE invitee_id = ? AND status = 'registered'`)
    .get(userId);
  if (!referral) return null;

  db.prepare(`UPDATE referrals SET status = 'qualified', qualified_at = ? WHERE id = ?`).run(nowIso(), referral.id);

  if (config.referralBonusCents > 0) {
    credit(user.referred_by, {
      type: 'referral_bonus',
      amountCents: config.referralBonusCents,
      refType: 'referral',
      refId: referral.id,
      title: 'Referral bonus',
      description: 'Your referred player completed the 5-match journey.',
      meta: { referral_id: referral.id, invitee: user.username },
    });
    platformLedger({
      type: 'referral_payout',
      amountCents: config.referralBonusCents,
      refType: 'referral',
      refId: referral.id,
      description: `Referral bonus for inviter ${user.referred_by}`,
    });
    notify(user.referred_by, {
      type: 'wallet',
      title: 'Referral bonus credited',
      body: `Your friend completed the onboarding journey. Bonus added to your wallet.`,
      data: { referral_id: referral.id, amount_cents: config.referralBonusCents },
    });
  }
  return referral;
}

export function referralStats(userId) {
  const rows = db.prepare('SELECT * FROM referrals WHERE inviter_id = ?').all(userId);
  const invites = db.prepare('SELECT * FROM invites WHERE user_id = ?').all(userId);
  const qualified = rows.filter((r) => r.status !== 'registered').length;
  return {
    code: db.prepare('SELECT referral_code FROM users WHERE id = ?').get(userId)?.referral_code,
    invites_sent: invites.length,
    clicks: invites.reduce((s, i) => s + i.clicks, 0),
    signups: rows.length,
    qualified,
    conversion_rate: rows.length ? Number((qualified / rows.length).toFixed(3)) : 0,
    earned_cents: qualified * config.referralBonusCents,
    channels: invites.reduce((acc, i) => {
      acc[i.channel] = (acc[i.channel] || 0) + 1;
      return acc;
    }, {}),
    referrals: rows.map((r) => ({
      id: r.id,
      status: r.status,
      source: r.source,
      channel: r.channel,
      created_at: r.created_at,
      invitee: db.prepare('SELECT username FROM users WHERE id = ?').get(r.invitee_id)?.username || 'Player',
    })),
  };
}

export function findUserByReferralCode(code) {
  if (!code) return null;
  return db.prepare('SELECT * FROM users WHERE referral_code = ?').get(String(code).toUpperCase()) || null;
}
