import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requestWithdrawal, listWithdrawals } from '../services/withdrawals.js';
import { badRequest } from '../lib/errors.js';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ withdrawals: listWithdrawals(req.userId) });
});

router.post('/', requireAuth, (req, res) => {
  const amountCents = Number.parseInt(req.body?.amount_cents, 10);
  if (!Number.isFinite(amountCents)) throw badRequest('Enter a valid withdrawal amount');
  const method = String(req.body?.method || '');
  const destination = String(req.body?.destination || '').trim();
  const accountName = req.body?.account_name ? String(req.body.account_name).trim() : null;
  const result = requestWithdrawal(req.user, { amountCents, method, destination, accountName });
  res.status(201).json(result);
});

export default router;
