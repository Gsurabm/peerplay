import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { get, post } from '../lib/api.js';
import { formatKSh, formatDate, timeAgo } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import { Stat, Empty, Tabs, Modal } from '../components/ui.jsx';

export default function AdminConsole() {
  const { user, toast } = useApp();
  const [caps, setCaps] = useState([]);
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [withdrawals, setWithdrawals] = useState([]);
  const [reports, setReports] = useState([]);
  const [matches, setMatches] = useState([]);
  const [ledger, setLedger] = useState(null);
  const [risk, setRisk] = useState(null);
  const [audit, setAudit] = useState([]);
  const [detail, setDetail] = useState(null);

  const has = useCallback((cap) => caps.includes(cap), [caps]);

  useEffect(() => {
    get('/admin/capabilities').then((d) => {
      setCaps(d.capabilities || []);
      setTab((t) => t);
    }).catch(() => {});
  }, []);

  const loadOverview = useCallback(() => {
    get('/admin/overview').then(setOverview).catch(() => {});
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (tab === 'users') get(`/admin/users?q=${encodeURIComponent(query)}`).then((d) => setUsers(d.users || [])).catch(() => {});
    if (tab === 'finance') {
      get('/admin/finance/withdrawals').then((d) => setWithdrawals(d.withdrawals || [])).catch(() => {});
      get('/admin/finance/ledger').then(setLedger).catch(() => {});
    }
    if (tab === 'reports') get('/admin/reports').then((d) => setReports(d.reports || [])).catch(() => {});
    if (tab === 'matches') get('/admin/matches?limit=40').then((d) => setMatches(d.matches || [])).catch(() => {});
    if (tab === 'risk') get('/admin/risk').then(setRisk).catch(() => {});
    if (tab === 'audit') get('/admin/audit').then((d) => setAudit(d.audit || [])).catch(() => {});
  }, [tab, query]);

  async function setStatus(id, status) {
    try {
      await post(`/admin/users/${id}/status`, { status });
      toast(`Account ${status}`, 'success');
      get(`/admin/users?q=${encodeURIComponent(query)}`).then((d) => setUsers(d.users || []));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function openUser(id) {
    try {
      const d = await get(`/admin/users/${id}`);
      setDetail(d);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function processWithdrawal(id, action) {
    try {
      await post(`/admin/finance/withdrawals/${id}`, { action, note: action === 'reject' ? 'Failed provider verification' : null });
      toast(`Withdrawal ${action}d`, 'success');
      get('/admin/finance/withdrawals').then((d) => setWithdrawals(d.withdrawals || []));
      loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function resolveReport(id, action) {
    try {
      await post(`/admin/reports/${id}`, { action, resolution: `${action} by ${user.username}` });
      toast(`Report ${action}`, 'success');
      get('/admin/reports').then((d) => setReports(d.reports || []));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    has('users.read') && { value: 'users', label: 'Users' },
    has('finance.read') && { value: 'finance', label: 'Finance' },
    has('reports.read') && { value: 'reports', label: 'Reports' },
    has('matches.read') && { value: 'matches', label: 'Matches' },
    has('risk.read') && { value: 'risk', label: 'Risk' },
    has('audit.read') && { value: 'audit', label: 'Audit log' },
  ].filter(Boolean);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head row-between wrap">
        <div>
          <h1>Admin console</h1>
          <p className="small" style={{ margin: 0 }}>
            Signed in as <span className="mono">{user.username}</span> · role <span className="badge cyan">{user.role.replace('_', ' ')}</span>
          </p>
        </div>
        <button className="btn ghost sm" onClick={loadOverview}>Refresh</button>
      </div>

      <Tabs value={tab} onChange={setTab} options={tabs} />

      {tab === 'overview' && overview && (
        <div className="stack">
          <div className="grid grid-4">
            <Stat label="Players" value={overview.players} sub={`${overview.active_players} active now`} tone="cyan" />
            <Stat label="Matches" value={overview.matches} sub={`${overview.live_matches} live`} />
            <Stat label="Platform revenue" value={formatKSh(overview.platform_revenue_cents)} sub="Fees + penalties" tone="gold" />
            <Stat label="Player liabilities" value={formatKSh(overview.player_liabilities_cents)} sub="Wallet balances owed" tone="violet" />
          </div>
          <div className="grid grid-4">
            <Stat label="Deposits" value={overview.deposits.count} sub={formatKSh(overview.deposits.total_cents)} />
            <Stat label="Withdrawals" value={overview.withdrawals.count} sub={`${overview.withdrawals.pending} awaiting action`} />
            <Stat label="Open reports" value={overview.open_reports} tone={overview.open_reports > 0 ? 'gold' : ''} />
            <Stat label="Journey completed" value={overview.journey_complete} sub="Players fully unlocked" />
          </div>
          <div className="card">
            <div className="card-head"><h3>Gateway settlement</h3></div>
            <div className="kv"><span className="k">Completed deposits</span><span className="v mono">{overview.settlement.completed_count} · {formatKSh(overview.settlement.completed_total_cents)}</span></div>
            <div className="kv"><span className="k">Pending deposits</span><span className="v mono">{overview.settlement.pending_count} · {formatKSh(overview.settlement.pending_total_cents)}</span></div>
            <div className="kv"><span className="k">Failed deposits</span><span className="v mono">{overview.settlement.failed_count}</span></div>
            <div className="kv"><span className="k">Ledger balance</span><span className="v mono">{formatKSh(overview.settlement.ledger_balance_cents)}</span></div>
            <div className="kv"><span className="k">Platform revenue</span><span className="v mono pos">{formatKSh(overview.settlement.platform_revenue_cents)}</span></div>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="card">
          <div className="card-head">
            <h3>User management</h3>
            <input className="input" style={{ maxWidth: 260 }} placeholder="Search username / email / phone" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th><th>Role</th><th>Status</th><th>Journey</th><th>W/L</th><th>Rep</th><th className="right">Balance</th><th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="row">
                        <Avatar seed={u.avatar_seed} size={28} />
                        <div>
                          <div className="small">{u.username}</div>
                          <div className="tiny dim">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className="badge grey">{u.role.replace('_', ' ')}</span></td>
                    <td><span className={`badge ${u.status === 'active' ? 'lime' : u.status === 'suspended' ? 'gold' : 'red'}`}>{u.status}</span></td>
                    <td className="small">{u.journey_matches}/5</td>
                    <td className="small">{u.wins}/{u.losses}</td>
                    <td className="mono small">{u.reputation_score}</td>
                    <td className="right mono small">{formatKSh(u.balance_cents)}</td>
                    <td className="right">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn sm ghost" onClick={() => openUser(u.id)}>Inspect</button>
                        {has('users.suspend') && u.status === 'active' && (
                          <button className="btn sm danger" onClick={() => setStatus(u.id, 'suspended')}>Suspend</button>
                        )}
                        {has('users.suspend') && u.status !== 'active' && (
                          <button className="btn sm success" onClick={() => setStatus(u.id, 'active')}>Restore</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'finance' && (
        <div className="stack">
          {ledger && (
            <div className="card">
              <div className="card-head"><h3>Platform ledger</h3><span className="badge gold">{formatKSh(ledger.revenue_cents)}</span></div>
              <div className="row wrap">
                {ledger.breakdown.map((b) => (
                  <span key={b.type} className="chip static">
                    {b.type} · {formatKSh(b.total)}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-head"><h3>Withdrawals</h3></div>
            {withdrawals.length === 0 ? (
              <Empty>No withdrawal requests.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Player</th><th>Destination</th><th>Method</th><th className="right">Amount</th><th>Status</th><th>Risk</th><th /></tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td className="small">{w.username}</td>
                        <td className="mono small">{w.destination}</td>
                        <td className="small">{w.method}</td>
                        <td className="right mono">{formatKSh(w.amount_cents)}</td>
                        <td><span className={`badge ${w.status === 'paid' ? 'lime' : w.status === 'rejected' ? 'red' : 'gold'}`}>{w.status.replace('_', ' ')}</span></td>
                        <td className="mono small">{w.risk_score}</td>
                        <td className="right">
                          {has('finance.withdrawals') && ['requested', 'review', 'risk_hold'].includes(w.status) && (
                            <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                              <button className="btn sm success" onClick={() => processWithdrawal(w.id, 'approve')}>Approve</button>
                              <button className="btn sm danger" onClick={() => processWithdrawal(w.id, 'reject')}>Reject</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'reports' && (
        <div className="card">
          <div className="card-head"><h3>Player reports</h3></div>
          {reports.length === 0 ? (
            <Empty>No reports filed.</Empty>
          ) : (
            <div className="stack-sm">
              {reports.map((r) => (
                <div className="card pad-sm" key={r.id}>
                  <div className="row-between wrap">
                    <div>
                      <div className="row" style={{ gap: 8 }}>
                        <span className={`badge ${r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'gold' : 'grey'}`}>
                          {r.severity}
                        </span>
                        <span className="small">{r.reason.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="tiny dim" style={{ marginTop: 4 }}>
                        {r.reporter_username} → {r.reported_username || 'unknown'} · {timeAgo(r.created_at)}
                      </div>
                      {r.details && <div className="small muted" style={{ marginTop: 6 }}>{r.details}</div>}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className={`badge ${r.status === 'resolved' ? 'lime' : r.status === 'dismissed' ? 'grey' : 'gold'}`}>
                        {r.status}
                      </span>
                      {has('reports.resolve') && r.status !== 'resolved' && r.status !== 'dismissed' && (
                        <>
                          <button className="btn sm success" onClick={() => resolveReport(r.id, 'resolve')}>Uphold</button>
                          <button className="btn sm ghost" onClick={() => resolveReport(r.id, 'dismiss')}>Dismiss</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'matches' && (
        <div className="card">
          <div className="card-head"><h3>Match monitor</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Match</th><th>Players</th><th className="right">Stake</th><th className="right">Fee</th><th>Status</th><th>Draws</th><th className="right">Ended</th></tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.id}>
                    <td className="mono tiny">{m.id.slice(-8)}</td>
                    <td className="small">{m.x_username || '—'} vs {m.o_username || '—'}</td>
                    <td className="right mono small">{formatKSh(m.stake_cents)}</td>
                    <td className="right mono small">{formatKSh(m.fee_cents)}</td>
                    <td><span className={`badge ${m.status === 'active' ? 'cyan' : m.status === 'completed' ? 'lime' : 'grey'}`}>{m.status}</span></td>
                    <td className="mono small">{m.draw_count}</td>
                    <td className="right tiny dim">{m.ended_at ? timeAgo(m.ended_at) : 'live'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'risk' && risk && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h3>Flagged accounts</h3></div>
            {risk.flagged.length === 0 ? (
              <Empty>No flagged accounts.</Empty>
            ) : (
              <div className="stack-sm">
                {risk.flagged.map((f) => (
                  <div className="row" key={f.id}>
                    <div className="grow">
                      <div className="small">{f.username}</div>
                      <div className="tiny dim">{f.events} risk events · {f.status}</div>
                    </div>
                    <span className={`badge ${f.risk_score > 40 ? 'red' : 'gold'}`}>risk {f.risk_score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-head"><h3>Shared devices</h3></div>
            {risk.shared_devices.length === 0 ? (
              <Empty>No shared devices detected.</Empty>
            ) : (
              <div className="stack-sm">
                {risk.shared_devices.map((d) => (
                  <div className="row" key={d.fingerprint}>
                    <span className="mono tiny grow">{d.fingerprint.slice(0, 20)}...</span>
                    <span className="badge gold">{d.accounts} accounts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="card">
          <div className="card-head"><h3>Audit log</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Meta</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="tiny dim nowrap">{formatDate(a.created_at)}</td>
                    <td className="small">{a.actor_role || 'system'}</td>
                    <td className="mono small">{a.action}</td>
                    <td className="tiny dim">{a.target_type} {a.target_id ? a.target_id.slice(-6) : ''}</td>
                    <td className="tiny dim">{a.meta ? JSON.stringify(a.meta).slice(0, 70) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Player inspection" wide>
        {detail && (
          <div className="stack">
            <div className="row">
              <Avatar seed={detail.user.avatar_seed} size={48} />
              <div>
                <div style={{ fontWeight: 700 }}>{detail.user.username}</div>
                <div className="tiny dim">{detail.user.email} · {detail.user.phone_e164}</div>
              </div>
              <div className="grow" />
              <span className="badge cyan">Risk {detail.user.risk_score}</span>
              <span className="badge gold">Rep {detail.user.reputation_score}</span>
            </div>
            <div className="grid grid-2">
              <div className="card pad-sm">
                <div className="card-title">Journey</div>
                <div className="kv"><span className="k">State</span><span className="v">{detail.user.journey_state}</span></div>
                <div className="kv"><span className="k">Matches</span><span className="v mono">{detail.user.journey_matches}/5</span></div>
                <div className="kv"><span className="k">Wins / losses</span><span className="v mono">{detail.user.wins}/{detail.user.losses}</span></div>
                <div className="kv"><span className="k">Total wagered</span><span className="v mono">{formatKSh(detail.user.total_wagered_cents)}</span></div>
                <div className="kv"><span className="k">Balance</span><span className="v mono">{formatKSh(detail.balance_cents)}</span></div>
              </div>
              <div className="card pad-sm">
                <div className="card-title">Risk signals</div>
                {detail.risk_events.length === 0 ? (
                  <div className="tiny dim">No risk events.</div>
                ) : (
                  detail.risk_events.slice(0, 6).map((r) => (
                    <div className="kv" key={r.id}>
                      <span className="k">{r.type}</span>
                      <span className="v mono">{r.score}</span>
                    </div>
                  ))
                )}
                <div className="card-title" style={{ marginTop: 10 }}>Devices</div>
                {detail.devices.length === 0 ? (
                  <div className="tiny dim">No device records.</div>
                ) : (
                  detail.devices.map((d) => (
                    <div className="tiny dim" key={d.id}>
                      {d.platform || 'unknown'} · {d.ip || 'n/a'} · last seen {timeAgo(d.last_seen_at)}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="card pad-sm">
              <div className="card-title">Recent transactions</div>
              <div className="stack-sm">
                {detail.transactions.slice(0, 8).map((t) => (
                  <div className="row" key={t.id}>
                    <span className="grow small">{t.title}</span>
                    <span className={`small mono ${t.direction === 'credit' ? 'pos' : 'neg'}`}>
                      {t.direction === 'credit' ? '+' : '−'}{formatKSh(t.amount_cents)}
                    </span>
                    <span className="tiny dim">{formatDate(t.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
