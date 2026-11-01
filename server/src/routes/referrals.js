import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createInvite, referralStats } from '../services/referrals.js';
import { requireEnum, requireString } from '../lib/validate.js';
import { REFERRAL_CHANNELS } from '../services/referrals.js';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json(referralStats(req.userId));
});

router.post('/invite', requireAuth, (req, res) => {
  const channel = requireEnum(requireString(req.body?.channel || 'copy', 'channel'), 'channel', REFERRAL_CHANNELS);
  const target = req.body?.target ? String(req.body.target).slice(0, 120) : null;
  const source = req.body?.source ? String(req.body.source).slice(0, 60) : null;
  const invite = createInvite(req.userId, { channel, target, source });
  res.status(201).json({
    invite: {
      ...invite,
      link: `/join/${invite.token}`,
    },
  });
});

export default router;
