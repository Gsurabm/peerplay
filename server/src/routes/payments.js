import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createDepositIntent, getIntent, listIntents, processProviderCallback } from '../services/payments/index.js';
import { badRequest } from '../lib/errors.js';

const router = express.Router();

router.post('/intents', requireAuth, (req, res) => {
  const method = String(req.body?.method || '');
  const amountCents = Number.parseInt(req.body?.amount_cents, 10);
  if (!Number.isFinite(amountCents)) throw badRequest('Enter a valid deposit amount');
  const intent = createDepositIntent(req.user, { method, amountCents, details: req.body?.details || {} });
  res.status(201).json(intent);
});

router.get('/intents', requireAuth, (req, res) => {
  res.json({ intents: listIntents(req.userId, 50) });
});

router.get('/intents/:id', requireAuth, (req, res) => {
  const intent = getIntent(req.userId, req.params.id);
  res.json({
    intent: {
      ...intent,
      meta: intent.meta ? JSON.parse(intent.meta) : null,
    },
  });
});

/**
 * Provider callback endpoint. Signed with HMAC, verified server-side.
 * No request body from a browser can credit a wallet - only a signed callback.
 */
router.post('/webhook/:provider', (req, res) => {
  const signature = req.headers['x-pp-signature'];
  const timestamp = req.headers['x-pp-timestamp'];
  try {
    const result = processProviderCallback(req.params.provider, req.body, signature, timestamp);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, error: err.message });
  }
});

export default router;
