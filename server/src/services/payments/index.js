import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { uid, nowIso, reference } from '../../lib/ids.js';
import { hmacVerify, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { credit, platformLedger } from '../wallet.js';
import { notify } from '../notifications.js';
import { recordRiskEvent } from '../risk.js';
import { simulateProviderCallback } from './sandbox.js';

/**
 * Payment gateway layer.
 * Every deposit is verified SERVER-SIDE through a signed provider callback
 * (webhook). Screenshots and client-side confirmations are never trusted.
 *
 * Each provider below models the real gateway's contract. In sandbox mode the
 * simulator produces a provider-shaped, HMAC-signed callback that hits the
 * same webhook endpoint the live gateways would use.
 */

export const PAYMENT_METHODS = {
  mpesa: {
    slug: 'mpesa',
    label: 'M-Pesa',
    kind: 'mobile',
    network: 'Safaricom',
    speed: 'Instant',
    fee_cents: 0,
    fields: [{ name: 'phone', label: 'M-Pesa phone number', type: 'tel', placeholder: '0712 345 678', required: true }],
    instructions: 'You will receive an STK push prompt on your phone. Enter your M-Pesa PIN to authorise the deposit.',
    live_config: ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY'],
  },
  airtel: {
    slug: 'airtel',
    label: 'Airtel Money',
    kind: 'mobile',
    network: 'Airtel',
    speed: 'Instant',
    fee_cents: 0,
    fields: [{ name: 'phone', label: 'Airtel Money number', type: 'tel', placeholder: '0712 345 678', required: true }],
    instructions: 'You will receive an Airtel Money confirmation prompt. Approve the deposit with your PIN.',
    live_config: ['AIRTEL_CLIENT_ID', 'AIRTEL_CLIENT_SECRET', 'AIRTEL_SHORTCODE'],
  },
  visa: {
    slug: 'visa',
    label: 'Visa',
    kind: 'card',
    network: 'Visa',
    speed: 'Instant',
    fee_cents: 0,
    fields: [
      { name: 'card_number', label: 'Card number', type: 'text', placeholder: '4242 4242 4242 4242', required: true },
      { name: 'card_exp', label: 'Expiry (MM/YY)', type: 'text', placeholder: '12/29', required: true },
      { name: 'card_cvc', label: 'CVV', type: 'text', placeholder: '123', required: true },
      { name: 'card_name', label: 'Name on card', type: 'text', placeholder: 'AS PER CARD', required: true },
    ],
    instructions: 'Your card is authorised by the gateway. Only the last 4 digits are stored - never the full number.',
    live_config: ['CARD_GATEWAY_API_KEY', 'CARD_GATEWAY_MERCHANT_ID'],
  },
  mastercard: {
    slug: 'mastercard',
    label: 'Mastercard',
    kind: 'card',
    network: 'Mastercard',
    speed: 'Instant',
    fee_cents: 0,
    fields: [
      { name: 'card_number', label: 'Card number', type: 'text', placeholder: '5555 5555 5555 4444', required: true },
      { name: 'card_exp', label: 'Expiry (MM/YY)', type: 'text', placeholder: '12/29', required: true },
      { name: 'card_cvc', label: 'CVV', type: 'text', placeholder: '123', required: true },
      { name: 'card_name', label: 'Name on card', type: 'text', placeholder: 'AS PER CARD', required: true },
    ],
    instructions: 'Your card is authorised by the gateway. Only the last 4 digits are stored - never the full number.',
    live_config: ['CARD_GATEWAY_API_KEY', 'CARD_GATEWAY_MERCHANT_ID'],
  },
  paypal: {
    slug: 'paypal',
    label: 'PayPal',
    kind: 'wallet',
    network: 'PayPal',
    speed: 'Instant',
    fee_cents: 0,
    fields: [{ name: 'email', label: 'PayPal email', type: 'email', placeholder: 'you@example.com', required: true }],
    instructions: 'Sign in to PayPal and approve the payment request. The wallet is credited once PayPal confirms.',
    live_config: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  },
  pesalink: {
    slug: 'pesalink',
    label: 'Pesalink',
    kind: 'card',
    network: 'Pesalink',
    speed: 'Instant',
    fee_cents: 0,
    fields: [
      { name: 'card_number', label: 'Card number', type: 'text', placeholder: '4242 4242 4242 4242', required: true },
      { name: 'card_exp', label: 'Expiry (MM/YY)', type: 'text', placeholder: '12/29', required: true },
      { name: 'card_cvc', label: 'CVV', type: 'text', placeholder: '123', required: true },
      { name: 'card_name', label: 'Name on card', type: 'text', placeholder: 'AS PER CARD', required: true },
    ],
    instructions: 'Pesalink authorises your card securely. Deposit is credited after the gateway confirms.',
    live_config: ['PESALINK_API_KEY', 'PESALINK_MERCHANT_ID'],
  },
  bank: {
    slug: 'bank',
    label: 'Bank transfer',
    kind: 'bank',
    network: 'Bank',
    speed: '1-3 business days',
    fee_cents: 0,
    fields: [
      { name: 'account_name', label: 'Account holder name', type: 'text', placeholder: 'AS PER BANK', required: true },
      { name: 'bank_name', label: 'Bank', type: 'text', placeholder: 'KCB Bank', required: true },
      { name: 'account_number', label: 'Account number', type: 'text', placeholder: '1234567890', required: true },
    ],
    instructions: 'Transfer using the reference below. The wallet is credited once the transfer is confirmed by our finance team.',
    live_config: ['BANK_ACCOUNT_NAME', 'BANK_ACCOUNT_NUMBER', 'BANK_BANK_NAME'],
  },
};

export function listPaymentMethods() {
  return Object.values(PAYMENT_METHODS).map((m) => ({
    slug: m.slug,
    label: m.label,
    kind: m.kind,
    network: m.network,
    speed: m.speed,
    fee_cents: m.fee_cents,
    fields: m.fields,
    instructions: m.instructions,
    min_cents: config.minDepositCents,
    max_cents: 5000000,
  }));
}

function validateDetails(method, details) {
  const spec = PAYMENT_METHODS[method];
  const clean = {};
  for (const field of spec.fields) {
    const value = String(details?.[field.name] ?? '').trim();
    if (field.required && !value) throw badRequest(`${field.label} is required`, { field: field.name });
    clean[field.name] = value;
  }
  if (spec.kind === 'mobile' && !/^(\+?254|0)\d{9}$/.test(clean.phone.replace(/[\s()-]/g, ''))) {
    throw badRequest('Enter a valid Kenyan phone number', { field: 'phone' });
  }
  if (spec.kind === 'card') {
    const digits = clean.card_number.replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(digits)) throw badRequest('Enter a valid card number', { field: 'card_number' });
    if (!/^\d{2}\/\d{2}$/.test(clean.card_exp)) throw badRequest('Expiry must be in MM/YY format', { field: 'card_exp' });
    if (!/^\d{3,4}$/.test(clean.card_cvc)) throw badRequest('Enter a valid CVV', { field: 'card_cvc' });
  }
  if (spec.kind === 'wallet' && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(clean.email)) {
    throw badRequest('Enter a valid email address', { field: 'email' });
  }
  return clean;
}

function accountHint(method, details) {
  const spec = PAYMENT_METHODS[method];
  if (spec.kind === 'mobile') return details.phone.replace(/\s/g, '');
  if (spec.kind === 'card') return `•••• ${details.card_number.replace(/[\s-]/g, '').slice(-4)}`;
  if (spec.kind === 'wallet') return details.email;
  return details.account_number;
}

/**
 * Create a deposit intent and hand it to the gateway.
 * The wallet is credited ONLY when the signed callback arrives.
 */
export function createDepositIntent(user, { method, amountCents, details = {} }) {
  const spec = PAYMENT_METHODS[method];
  if (!spec) throw badRequest('Unsupported payment method');
  if (!Number.isInteger(amountCents) || amountCents < config.minDepositCents) {
    throw badRequest(`Minimum deposit is KSh ${config.minDepositCents / 100}`);
  }
  if (amountCents > 5000000) throw badRequest('Maximum single deposit is KSh 50,000');

  const clean = validateDetails(method, details);
  const id = uid('pi');
  const ref = reference('DEP');
  const meta = { ...clean };
  if (spec.kind === 'card') {
    meta.card_number = `•••• ${clean.card_number.replace(/[\s-]/g, '').slice(-4)}`;
    delete meta.card_cvc;
  }

  db.prepare(
    `INSERT INTO payment_intents (id, user_id, provider, method, amount_cents, currency, reference, status, account_hint, meta, created_at)
     VALUES (?, ?, ?, ?, ?, 'KES', ?, 'pending', ?, ?, ?)`,
  ).run(id, user.id, method, method, amountCents, ref, accountHint(method, clean), JSON.stringify(meta), nowIso());

  const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(id);

  // Hand off to the gateway. Sandbox mode simulates the provider's async confirmation.
  simulateProviderCallback({ intent, details: clean, method });

  return {
    id,
    reference: ref,
    method,
    amount_cents: amountCents,
    status: 'pending',
    instructions: spec.instructions,
    account_hint: intent.account_hint,
    speed: spec.speed,
  };
}

/**
 * Completes a deposit: marks the intent, credits the wallet, notifies.
 * Shared by every provider - this is the ONLY place a wallet is credited.
 */
function completeIntent(intent, { provider, providerRef }) {
  const spec = PAYMENT_METHODS[provider];
  db.prepare(
    `UPDATE payment_intents SET status = 'completed', provider_ref = ?, completed_at = ? WHERE id = ?`,
  ).run(providerRef || intent.reference, nowIso(), intent.id);

  const tx = credit(intent.user_id, {
    type: 'deposit',
    amountCents: intent.amount_cents,
    refType: 'payment_intent',
    refId: intent.id,
    title: `Deposit via ${spec.label}`,
    description: `Deposit confirmed by ${spec.label}. Reference ${intent.reference}.`,
    meta: { provider, provider_ref: providerRef, account_hint: intent.account_hint },
  });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(intent.user_id);
  if (user && !user.first_deposit_done) {
    db.prepare('UPDATE users SET first_deposit_done = 1, onboarding_step = MAX(onboarding_step, 2), updated_at = ? WHERE id = ?').run(
      nowIso(),
      intent.user_id,
    );
    notify(intent.user_id, {
      type: 'social',
      title: 'Wallet funded - welcome to the arena',
      body: `Your first deposit of KSh ${(intent.amount_cents / 100).toLocaleString('en-KE')} is in. Pick a stake and challenge someone.`,
      data: { journey: 'deposited' },
    });
  }

  notify(intent.user_id, {
    type: 'wallet',
    title: 'Deposit completed',
    body: `KSh ${(intent.amount_cents / 100).toLocaleString('en-KE')} added to your PeerPlay wallet via ${spec.label}.`,
    data: { intent_id: intent.id, amount_cents: intent.amount_cents, reference: intent.reference },
  });

  recordRiskEvent(intent.user_id, 'deposit', 0, { method: provider, amount_cents: intent.amount_cents });
  return {
    status: 'completed',
    intent: db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intent.id),
    balance_cents: tx.balance_cents,
  };
}

/** Marks a deposit as failed and tells the player nothing was taken. */
function failIntent(intent, { provider, errorCode, message }) {
  const spec = PAYMENT_METHODS[provider];
  db.prepare(`UPDATE payment_intents SET status = 'failed', error_code = ?, completed_at = ? WHERE id = ?`).run(
    errorCode || 'declined',
    nowIso(),
    intent.id,
  );
  notify(intent.user_id, {
    type: 'wallet',
    title: 'Deposit failed',
    body:
      message ||
      `Your ${spec.label} deposit of KSh ${(intent.amount_cents / 100).toLocaleString('en-KE')} was declined. No funds were taken.`,
    data: { intent_id: intent.id, reference: intent.reference },
  });
  return { status: 'failed', intent: db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intent.id) };
}

/**
 * Process a signed provider callback. This is the ONLY path that credits a wallet.
 */
export function processProviderCallback(provider, payload, signature, timestamp) {
  const spec = PAYMENT_METHODS[provider];
  if (!spec) throw notFound('Unknown payment provider');

  const body = JSON.stringify(payload);
  const expected = hmacVerify(`${timestamp}.${body}`, signature);
  if (!expected) {
    throw badRequest('Invalid callback signature');
  }
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) {
    throw badRequest('Callback timestamp outside the accepted window');
  }

  const intent = db.prepare('SELECT * FROM payment_intents WHERE reference = ?').get(payload.reference);
  if (!intent) throw notFound('Unknown deposit reference');
  if (intent.status === 'completed') return { status: 'already_completed', intent };
  if (intent.status === 'failed') throw conflict('This deposit already failed');
  if (payload.amount_cents !== intent.amount_cents) {
    throw badRequest('Callback amount does not match the deposit');
  }
  if (payload.provider !== provider) throw badRequest('Callback provider mismatch');

  if (payload.status === 'failed') {
    return failIntent(intent, { provider, errorCode: payload.error_code, message: payload.message });
  }

  return completeIntent(intent, { provider, providerRef: payload.provider_ref || payload.reference });
}

export function getIntent(userId, intentId) {
  const intent = db.prepare('SELECT * FROM payment_intents WHERE id = ?').get(intentId);
  if (!intent || intent.user_id !== userId) throw notFound('Deposit not found');
  return intent;
}

export function listIntents(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM payment_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit)
    .map((i) => ({ ...i, meta: i.meta ? JSON.parse(i.meta) : null }));
}

/** Used by the finance console to reconcile gateway money against the ledger. */
export function paymentReconciliation() {
  const deposits = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS total FROM payment_intents WHERE status = 'completed'`)
    .get();
  const pending = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS total FROM payment_intents WHERE status IN ('pending','processing')`)
    .get();
  const failed = db
    .prepare(`SELECT COUNT(*) AS n FROM payment_intents WHERE status = 'failed'`)
    .get();
  return {
    completed_count: deposits.n,
    completed_total_cents: deposits.total,
    pending_count: pending.n,
    pending_total_cents: pending.total,
    failed_count: failed.n,
    ledger_balance_cents: db.prepare('SELECT COALESCE(SUM(balance_cents),0) AS t FROM wallets').get().t,
    platform_revenue_cents: db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS t FROM platform_ledger`).get().t,
  };
}
