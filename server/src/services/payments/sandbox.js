import { hmacSign } from '../../lib/crypto.js';
import { config } from '../../config.js';

/**
 * Sandbox provider simulator.
 *
 * It reproduces the real gateways' async behaviour: the money is NOT credited
 * when the player clicks "pay". Instead the provider signs a callback that is
 * delivered to our own webhook endpoint, exactly like M-Pesa / Airtel / PayPal
 * would. The webhook signature + amount + reference are verified server-side.
 */

const BASE = () => config.paymentBaseUrl || `http://127.0.0.1:${config.port}`;

/** Deterministic gateway rules so the demo behaves like a real acquirer. */
function authorise(method, details, amountCents) {
  if (method === 'visa' || method === 'mastercard' || method === 'pesalink') {
    const digits = String(details.card_number || '').replace(/[\s-]/g, '');
    if (digits.endsWith('0002')) {
      return { approved: false, code: 'card_declined', message: 'Your card was declined by the issuer.' };
    }
    if (digits.endsWith('9995')) {
      return { approved: false, code: 'insufficient_funds', message: 'The card has insufficient funds.' };
    }
    if (!/^4|5/.test(digits)) {
      return { approved: false, code: 'invalid_card', message: 'Unsupported card network.' };
    }
    return { approved: true, code: 'approved' };
  }
  if (method === 'mpesa' || method === 'airtel') {
    const phone = String(details.phone || '').replace(/\s/g, '');
    if (phone.endsWith('0000')) {
      return { approved: false, code: 'insufficient_funds', message: 'Insufficient M-Pesa balance.' };
    }
    return { approved: true, code: 'approved' };
  }
  if (method === 'paypal') {
    return { approved: true, code: 'approved' };
  }
  return { approved: true, code: 'pending_review' };
}

export function simulateProviderCallback({ intent, details, method }) {
  const delay = method === 'bank' ? 4000 : 1800;
  setTimeout(() => {
    const decision = authorise(method, details, intent.amount_cents);
    const payload = {
      provider: method,
      reference: intent.reference,
      intent_id: intent.id,
      amount_cents: intent.amount_cents,
      currency: intent.currency,
      status: decision.approved ? 'completed' : 'failed',
      error_code: decision.approved ? null : decision.code,
      message: decision.message || null,
      provider_ref: `${method.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      account_hint: intent.account_hint,
    };
    deliver(payload);
  }, delay).unref?.();
}

function deliver(payload) {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = hmacSign(`${timestamp}.${body}`);
  const url = `${BASE()}/api/payments/webhook/${payload.provider}`;
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pp-signature': signature,
      'x-pp-timestamp': timestamp,
    },
    body,
  })
    .then(async (res) => {
      const text = await res.text();
      if (!res.ok) console.error('[payments] callback rejected', res.status, text);
    })
    .catch((err) => console.error('[payments] callback delivery failed', err.message));
}

/** Test helper for the admin console: force a pending deposit to settle. */
export function forceSettle(intent) {
  const payload = {
    provider: intent.provider,
    reference: intent.reference,
    intent_id: intent.id,
    amount_cents: intent.amount_cents,
    currency: intent.currency,
    status: 'completed',
    provider_ref: `MANUAL-${Date.now().toString(36).toUpperCase()}`,
    account_hint: intent.account_hint,
  };
  deliver(payload);
  return payload;
}
