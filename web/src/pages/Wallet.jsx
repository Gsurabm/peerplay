import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { get, post } from '../lib/api.js';
import { formatKSh, formatDate, parseAmount } from '../lib/format.js';
import { Stat, Empty, Tabs, Modal } from '../components/ui.jsx';

const TYPE_LABEL = {
  deposit: 'Deposit',
  stake: 'Stake',
  win: 'Match winnings',
  fee: 'Platform fee',
  refund: 'Escrow refund',
  penalty: 'Penalty',
  withdrawal: 'Withdrawal',
  adjustment: 'Adjustment',
  referral_bonus: 'Referral bonus',
};

export default function Wallet() {
  const { user, wallet, walletSummary, journey, refreshWallet, refreshJourney, toast } = useApp();
  const [tab, setTab] = useState('overview');
  const [methods, setMethods] = useState({ deposit_methods: [], withdrawal_methods: [], limits: {} });
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);

  const [depositMethod, setDepositMethod] = useState('mpesa');
  const [depositAmount, setDepositAmount] = useState('100');
  const [depositDetails, setDepositDetails] = useState({});
  const [depositIntent, setDepositIntent] = useState(null);
  const [depositStatus, setDepositStatus] = useState('idle');

  const [withdrawAmount, setWithdrawAmount] = useState('100');
  const [withdrawMethod, setWithdrawMethod] = useState('mpesa');
  const [withdrawDestination, setWithdrawDestination] = useState('');
  const [withdrawAccount, setWithdrawAccount] = useState('');

  const loadTx = useCallback(async () => {
    const d = await get('/wallet/transactions?limit=100').catch(() => ({ transactions: [] }));
    setTransactions(d.transactions || []);
  }, []);

  useEffect(() => {
    get('/wallet/methods').then(setMethods).catch(() => {});
    loadTx();
    get('/withdrawals').then((d) => setWithdrawals(d.withdrawals || [])).catch(() => {});
  }, [loadTx]);

  const pollDeposit = useCallback(
    async (intentId) => {
      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const d = await get(`/payments/intents/${intentId}`).catch(() => null);
        if (!d) break;
        if (d.intent.status === 'completed') {
          setDepositStatus('completed');
          await refreshWallet();
          await loadTx();
          toast('Deposit confirmed - your wallet is funded', 'success');
          return;
        }
        if (d.intent.status === 'failed') {
          setDepositStatus('failed');
          toast('Deposit was declined by the provider', 'error');
          return;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 900));
      }
      setDepositStatus('pending');
    },
    [refreshWallet, loadTx, toast],
  );

  async function submitDeposit(e) {
    e.preventDefault();
    const cents = parseAmount(depositAmount);
    if (!Number.isFinite(cents) || cents < (methods.limits.min_deposit_cents || 5000)) {
      toast(`Minimum deposit is KSh ${(methods.limits.min_deposit_cents || 5000) / 100}`, 'error');
      return;
    }
    setDepositStatus('processing');
    try {
      const intent = await post('/payments/intents', {
        method: depositMethod,
        amount_cents: cents,
        details: depositDetails,
      });
      setDepositIntent(intent);
      pollDeposit(intent.id);
    } catch (err) {
      setDepositStatus('failed');
      toast(err.message, 'error');
    }
  }

  async function submitWithdrawal(e) {
    e.preventDefault();
    const cents = parseAmount(withdrawAmount);
    try {
      const res = await post('/withdrawals', {
        amount_cents: cents,
        method: withdrawMethod,
        destination: withdrawDestination.trim(),
        account_name: withdrawAccount.trim() || null,
      });
      toast(
        res.status === 'review'
          ? 'Withdrawal submitted and queued for review'
          : 'Withdrawal requested - funds reserved',
        'success',
      );
      setWithdrawDestination('');
      const d = await get('/withdrawals');
      setWithdrawals(d.withdrawals || []);
      await refreshWallet();
      await loadTx();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const selectedDeposit = methods.deposit_methods.find((m) => m.slug === depositMethod);
  const selectedWithdraw = methods.withdrawal_methods.find((m) => m.slug === withdrawMethod);
  const withdrawLocked = journey?.state !== 'complete';
  const maxWithdrawable = Math.max(0, (wallet?.balance_cents || 0) - (methods.limits.withdraw_floor_cents || 5000));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head row-between wrap">
        <div>
          <h1>Wallet</h1>
          <p className="small" style={{ margin: 0 }}>
            Fund the pot, track every cent. Deposits are verified server-side by the payment provider.
          </p>
        </div>
        <span className="balance-pill">◈ {formatKSh(wallet?.balance_cents || 0)}</span>
      </div>

      <div className="grid grid-4">
        <Stat label="Available" value={formatKSh(wallet?.available_cents || 0)} sub="Ready to stake" tone="cyan" />
        <Stat label="Total deposited" value={formatKSh(walletSummary?.deposited_cents || 0)} />
        <Stat label="Total staked" value={formatKSh(walletSummary?.staked_cents || 0)} />
        <Stat label="Total withdrawn" value={formatKSh(walletSummary?.withdrawn_cents || 0)} tone="gold" />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'deposit', label: 'Deposit' },
          { value: 'withdraw', label: 'Withdraw' },
          { value: 'transactions', label: 'Transactions' },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h3>Recent activity</h3></div>
            {transactions.length === 0 ? (
              <Empty>No transactions yet.</Empty>
            ) : (
              <div className="stack-sm">
                {transactions.slice(0, 12).map((t) => (
                  <div className="row" key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="small">{TYPE_LABEL[t.type] || t.title}</div>
                      <div className="tiny dim">{t.description}</div>
                    </div>
                    <div className="right">
                      <div className={`small ${t.direction === 'credit' ? 'amount-credit' : 'amount-debit'}`}>
                        {t.direction === 'credit' ? '+' : '−'}{formatKSh(t.amount_cents)}
                      </div>
                      <div className="tiny dim mono">{formatKSh(t.balance_after)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-head"><h3>Withdrawal rules</h3></div>
              <div className="kv"><span className="k">Minimum withdrawal</span><span className="v mono">KSh 50.00</span></div>
              <div className="kv"><span className="k">Balance floor after withdrawal</span><span className="v mono">KSh 50.00</span></div>
              <div className="kv"><span className="k">Onboarding journey</span><span className="v">{journey?.state === 'complete' ? 'Complete ✓' : `${journey?.completed ?? 0}/${journey?.required ?? 5}`}</span></div>
              <div className="kv"><span className="k">Large withdrawals</span><span className="v">Identity check required</span></div>
              {withdrawLocked && (
                <div className="notice warn" style={{ marginTop: 12 }}>
                  Withdrawals unlock after your {journey?.required}-match onboarding journey. You have completed{' '}
                  {journey?.completed ?? 0}.
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head"><h3>Pending payouts</h3></div>
              {withdrawals.filter((w) => !['paid', 'rejected', 'cancelled'].includes(w.status)).length === 0 ? (
                <Empty>No pending withdrawals.</Empty>
              ) : (
                <div className="stack-sm">
                  {withdrawals
                    .filter((w) => !['paid', 'rejected', 'cancelled'].includes(w.status))
                    .map((w) => (
                      <div className="row" key={w.id}>
                        <span className="grow small mono">{w.destination}</span>
                        <span className="small mono">{formatKSh(w.amount_cents)}</span>
                        <span className={`badge ${w.status === 'review' || w.status === 'risk_hold' ? 'gold' : 'cyan'}`}>
                          {w.status.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'deposit' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h3>Deposit funds</h3>
              <span className="badge cyan">Minimum KSh {(methods.limits.min_deposit_cents || 5000) / 100}</span>
            </div>
            <div className="grid grid-2" style={{ marginBottom: 16 }}>
              {methods.deposit_methods.map((m) => (
                <button
                  key={m.slug}
                  type="button"
                  className={`method-card ${depositMethod === m.slug ? 'selected' : ''}`}
                  onClick={() => {
                    setDepositMethod(m.slug);
                    setDepositDetails({});
                  }}
                >
                  <span className="method-logo">{m.label.slice(0, 4).toUpperCase()}</span>
                  <span>
                    <span className="small" style={{ display: 'block', fontWeight: 600 }}>{m.label}</span>
                    <span className="tiny dim">{m.speed}</span>
                  </span>
                </button>
              ))}
            </div>

            <form onSubmit={submitDeposit}>
              <div className="field">
                <label className="label">Amount (KSh)</label>
                <input className="input mono" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} inputMode="decimal" />
                <div className="row" style={{ marginTop: 8 }}>
                  {[50, 100, 200, 500, 1000].map((v) => (
                    <button key={v} type="button" className="chip" onClick={() => setDepositAmount(String(v))}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {selectedDeposit?.fields.map((f) => (
                <div className="field" key={f.name}>
                  <label className="label">{f.label}</label>
                  <input
                    className="input"
                    type={f.type || 'text'}
                    placeholder={f.placeholder}
                    value={depositDetails[f.name] || ''}
                    onChange={(e) => setDepositDetails({ ...depositDetails, [f.name]: e.target.value })}
                  />
                </div>
              ))}

              {selectedDeposit && <div className="notice" style={{ marginBottom: 14 }}>{selectedDeposit.instructions}</div>}

              <button className="btn primary block" type="submit" disabled={depositStatus === 'processing'}>
                {depositStatus === 'processing' ? <span className="spinner" /> : `Deposit via ${selectedDeposit?.label || ''}`}
              </button>
            </form>
          </div>

          <div className="card">
            <div className="card-head"><h3>Deposit status</h3></div>
            {!depositIntent && (
              <Empty icon="◈">Start a deposit to see the provider confirmation here.</Empty>
            )}
            {depositIntent && (
              <div className="stack">
                <div className="kv"><span className="k">Reference</span><span className="v mono small">{depositIntent.reference}</span></div>
                <div className="kv"><span className="k">Amount</span><span className="v mono">{formatKSh(depositIntent.amount_cents)}</span></div>
                <div className="kv"><span className="k">Account</span><span className="v mono small">{depositIntent.account_hint}</span></div>
                <div className="kv"><span className="k">Status</span><span className="v">
                  <span className={`badge ${depositStatus === 'completed' ? 'lime' : depositStatus === 'failed' ? 'red' : 'cyan'}`}>
                    {depositStatus}
                  </span>
                </span></div>
                <div className="notice">
                  The wallet is credited only after the provider callback is verified on the server. Screenshots and
                  client confirmations are never trusted.
                </div>
                {depositStatus === 'completed' && (
                  <div className="notice success">
                    Deposit complete. Your balance is now {formatKSh(wallet?.balance_cents || 0)}.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'withdraw' && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head">
              <h3>Withdraw winnings</h3>
              <span className="badge gold">Minimum KSh {(methods.limits.min_withdraw_cents || 5000) / 100}</span>
            </div>

            {withdrawLocked ? (
              <div className="notice warn">
                <strong>Withdrawals are locked.</strong> Complete your {journey?.required}-match onboarding journey
                first - you have completed {journey?.completed ?? 0}. Every completed win or loss counts; draws do not.
              </div>
            ) : (
              <form onSubmit={submitWithdrawal}>
                <div className="field">
                  <label className="label">Amount (KSh)</label>
                  <input className="input mono" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} inputMode="decimal" />
                  <div className="field-hint">
                    You can withdraw up to {formatKSh(maxWithdrawable)} right now - your balance may not drop below
                    KSh {(methods.limits.withdraw_floor_cents || 5000) / 100}.
                  </div>
                </div>

                <div className="field">
                  <label className="label">Payout method</label>
                  <select className="select" value={withdrawMethod} onChange={(e) => setWithdrawMethod(e.target.value)}>
                    {methods.withdrawal_methods.map((m) => (
                      <option key={m.slug} value={m.slug}>{m.label} · {m.speed}</option>
                    ))}
                  </select>
                </div>

                {selectedWithdraw?.fields.map((f) => (
                  <div className="field" key={f.name}>
                    <label className="label">{f.label}</label>
                    <input
                      className="input"
                      placeholder={f.placeholder}
                      value={f.name === 'phone' ? withdrawDestination : f.name === 'account_name' ? withdrawAccount : ''}
                      onChange={(e) => {
                        if (f.name === 'phone') setWithdrawDestination(e.target.value);
                        if (f.name === 'account_name') setWithdrawAccount(e.target.value);
                      }}
                    />
                  </div>
                ))}

                <div className="notice" style={{ marginBottom: 14 }}>
                  Suspicious withdrawals are delayed and reviewed by our risk team. Large payouts require a verified
                  identity.
                </div>

                <button className="btn primary block" type="submit">
                  Request withdrawal
                </button>
              </form>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Withdrawal history</h3></div>
            {withdrawals.length === 0 ? (
              <Empty>No withdrawals yet.</Empty>
            ) : (
              <div className="stack-sm">
                {withdrawals.map((w) => (
                  <div className="row" key={w.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <div className="grow">
                      <div className="small mono">{w.destination}</div>
                      <div className="tiny dim">{formatDate(w.requested_at)}</div>
                    </div>
                    <span className="small mono">{formatKSh(w.amount_cents)}</span>
                    <span
                      className={`badge ${
                        w.status === 'paid' ? 'lime'
                        : w.status === 'rejected' ? 'red'
                        : w.status === 'review' || w.status === 'risk_hold' ? 'gold'
                        : 'cyan'
                      }`}
                    >
                      {w.status.replace('_', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'transactions' && (
        <div className="card">
          <div className="card-head">
            <h3>Transaction history</h3>
            <button className="btn ghost sm" onClick={loadTx}>Refresh</button>
          </div>
          {transactions.length === 0 ? (
            <Empty>No transactions yet.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Details</th>
                    <th className="right">Amount</th>
                    <th className="right">Balance after</th>
                    <th className="right">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <span className={`badge ${t.type === 'deposit' ? 'lime' : t.type === 'fee' || t.type === 'penalty' ? 'gold' : t.type === 'win' ? 'cyan' : 'grey'}`}>
                          {TYPE_LABEL[t.type] || t.type}
                        </span>
                      </td>
                      <td className="small muted">{t.description}</td>
                      <td className={`right ${t.direction === 'credit' ? 'amount-credit' : 'amount-debit'}`}>
                        {t.direction === 'credit' ? '+' : '−'}{formatKSh(t.amount_cents)}
                      </td>
                      <td className="right mono muted">{formatKSh(t.balance_after)}</td>
                      <td className="right tiny dim nowrap">{formatDate(t.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
