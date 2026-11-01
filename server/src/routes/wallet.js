import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getWallet, walletSummary, listTransactions, transactionCount } from '../services/wallet.js';
import { listPaymentMethods } from '../services/payments/index.js';
import { listWithdrawalMethods } from '../services/withdrawals.js';
import { config } from '../config.js';

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({
    wallet: getWallet(req.userId),
    summary: walletSummary(req.userId),
    transaction_count: transactionCount(req.userId),
  });
});

router.get('/transactions', requireAuth, (req, res) => {
  const limit = Math.min(200, Number.parseInt(req.query.limit || '50', 10));
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10));
  const type = req.query.type ? String(req.query.type) : null;
  const transactions = listTransactions(req.userId, { limit, offset, type });
  res.json({ transactions, count: transactions.length });
});

router.get('/methods', requireAuth, (_req, res) => {
  res.json({
    deposit_methods: listPaymentMethods(),
    withdrawal_methods: listWithdrawalMethods(),
    limits: {
      min_deposit_cents: config.minDepositCents,
      min_withdraw_cents: config.minWithdrawCents,
      withdraw_floor_cents: config.withdrawFloorCents,
      min_stake_cents: config.minStakeCents,
      stake_step_cents: config.stakeStepCents,
      platform_fee_bps: config.platformFeeBps,
    },
  });
});

export default router;
