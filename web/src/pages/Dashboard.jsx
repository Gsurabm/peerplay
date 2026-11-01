import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { get } from '../lib/api.js';
import { formatKSh, timeAgo } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import { Stat, Empty, Progress } from '../components/ui.jsx';

export default function Dashboard() {
  const { user, wallet, journey, refreshWallet, refreshJourney, notifications } = useApp();
  const navigate = useNavigate();
  const [recent, setRecent] = useState([]);
  const [board, setBoard] = useState([]);
  const [me, setMe] = useState(null);

  useEffect(() => {
    get('/matches/mine?limit=6').then((d) => setRecent(d.matches)).catch(() => {});
    get('/leaderboards?scope=overall').then((d) => {
      setBoard(d.leaderboard.slice(0, 6));
      setMe(d.viewer);
    }).catch(() => {});
  }, []);

  const total = (user?.wins || 0) + (user?.losses || 0);
  const winRate = total ? ((user.wins / total) * 100).toFixed(1) : '0.0';

  const steps = [
    { key: 'register', label: 'Register', done: true },
    { key: 'tutorial', label: 'Tutorial', done: Boolean(user?.tutorial_done) },
    { key: 'deposit', label: 'Deposit', done: Boolean(user?.first_deposit_done) },
    { key: 'journey', label: `Journey ${journey?.completed ?? 0}/${journey?.required ?? 5}`, done: journey?.state === 'complete' },
    { key: 'unlocked', label: 'Unlocked', done: journey?.state === 'complete' },
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head row-between wrap">
        <div>
          <h1>Welcome back, {user?.username}</h1>
          <p className="small" style={{ margin: 0 }}>
            {journey?.state === 'complete'
              ? 'Your journey is complete - free stakes, free withdrawals, full leaderboards.'
              : `Finish your ${journey?.required}-match journey to unlock withdrawals and flexible stakes.`}
          </p>
        </div>
        <div className="row">
          <button className="btn pink" onClick={() => navigate('/app/play')}>✦ Find a match</button>
          <button className="btn ghost" onClick={() => navigate('/app/wallet')}>◈ Wallet</button>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="Wallet balance" value={formatKSh(wallet?.balance_cents || 0)} sub="Available for staking" tone="cyan" />
        <Stat label="Wins / Losses" value={`${user?.wins ?? 0} / ${user?.losses ?? 0}`} sub={`${winRate}% win rate`} />
        <Stat label="Current streak" value={user?.streak_wins ?? 0} sub={`Best: ${user?.best_streak ?? 0}`} tone="gold" />
        <Stat
          label="Global rank"
          value={me?.rank ? `#${me.rank}` : '—'}
          sub={me?.points ? `${me.points} ranking points` : 'Win matches to rank up'}
          tone="violet"
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Onboarding journey</h3>
              <span className={`badge ${journey?.state === 'complete' ? 'lime' : 'pink'}`}>
                {journey?.state === 'complete' ? 'Complete' : `${journey?.completed ?? 0} of ${journey?.required ?? 5} done`}
              </span>
            </div>
            <div className="steps">
              {steps.map((s) => (
                <div key={s.key} className={`step ${s.done ? 'done' : ''}`}>
                  <div className="dot" />
                  {s.label}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14 }}>
              <Progress value={journey?.completed ?? 0} max={journey?.required ?? 5} />
            </div>
            <p className="small" style={{ marginTop: 12, marginBottom: 0 }}>
              {journey?.state === 'complete'
                ? 'Withdrawals are unlocked and your balance may never drop below KSh 50.00.'
                : `During the journey your recommended stake grows 1.5x each match. Draws do not count - wins and losses do. Withdrawals unlock at 5 matches.`}
            </p>
            {journey?.state !== 'complete' && (
              <button className="btn primary sm" style={{ marginTop: 12 }} onClick={() => navigate('/app/play')}>
                Continue journey
              </button>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Recent matches</h3>
              <Link to="/app/play" className="small">Play again →</Link>
            </div>
            {recent.length === 0 ? (
              <Empty icon="✦">
                No matches yet. Stake KSh 10 and find your first opponent.
                <div style={{ marginTop: 12 }}>
                  <button className="btn primary sm" onClick={() => navigate('/app/play')}>Find a match</button>
                </div>
              </Empty>
            ) : (
              <div className="stack-sm">
                {recent.map((m) => {
                  const opponent = m.players[m.seat === 'x' ? 'o' : 'x'];
                  const won = m.result === 'win';
                  return (
                    <div className="row" key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <span className={`badge ${won ? 'lime' : m.result === 'draw' ? 'gold' : 'red'}`}>
                        {m.result === 'win' ? 'WIN' : m.result === 'draw' ? 'DRAW' : 'LOSS'}
                      </span>
                      <Avatar src={opponent?.avatar_url} seed={opponent?.avatar_seed} size={28} />
                      <span className="grow small">vs {opponent?.username || 'Unknown'}</span>
                      <span className="mono small muted">{formatKSh(m.stake_cents, { decimals: 0 })}</span>
                      <span className={`mono small ${won ? 'pos' : 'neg'}`}>
                        {won ? '+' : ''}{formatKSh(m.net_cents, { decimals: 0 })}
                      </span>
                      <span className="tiny dim nowrap">{timeAgo(m.ended_at || m.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Global leaderboard</h3>
              <Link to="/app/leaderboards" className="small">All boards →</Link>
            </div>
            {board.length === 0 ? (
              <Empty>No ranked matches yet.</Empty>
            ) : (
              <div className="stack-sm">
                {board.map((row) => (
                  <div className="row" key={row.user_id} style={{ padding: '4px 0' }}>
                    <span className={`rank-num ${row.rank <= 3 ? 'top' : ''}`} style={{ width: 26 }}>#{row.rank}</span>
                    <Avatar src={row.avatar_url} seed={row.avatar_seed} size={28} />
                    <span className="grow small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.username}</span>
                    <span className="mono tiny muted">{row.points}p</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Latest alerts</h3>
              <Link to="/app/notifications" className="small">All →</Link>
            </div>
            {notifications.length === 0 ? (
              <Empty>You're all caught up.</Empty>
            ) : (
              <div className="stack-sm">
                {notifications.slice(0, 5).map((n) => (
                  <div key={n.id} className="row" style={{ alignItems: 'flex-start' }}>
                    <span className="online-dot" style={{ marginTop: 7, flexShrink: 0 }} />
                    <div>
                      <div className="small">{n.title}</div>
                      <div className="tiny dim">{n.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Trust &amp; safety</h3></div>
            <div className="kv"><span className="k">Reputation</span><span className="v mono">{user?.reputation_score}</span></div>
            <div className="kv"><span className="k">Email verified</span><span className="v">{user?.email_verified ? '✓' : '—'}</span></div>
            <div className="kv"><span className="k">Phone verified</span><span className="v">{user?.phone_verified ? '✓' : '—'}</span></div>
            <div className="kv"><span className="k">Identity verified</span><span className="v">{user?.identity_verified ? '✓' : '—'}</span></div>
            <Link to="/app/settings" className="btn ghost sm block" style={{ marginTop: 12 }}>
              Improve verification
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
