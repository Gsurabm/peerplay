import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { get, post } from '../lib/api.js';
import { formatKSh, timeAgo } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import { Stat, Empty } from '../components/ui.jsx';

export default function Profile() {
  const { username } = useParams();
  const { user, toast } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [privateData, setPrivateData] = useState(null);
  const isMe = user?.username?.toLowerCase() === String(username).toLowerCase();

  useEffect(() => {
    setData(null);
    setPrivateData(null);
    get(`/profile/${username}`).then(setData).catch(() => setData(null));
    if (isMe) get('/profile/me').then(setPrivateData).catch(() => {});
  }, [username, isMe]);

  if (!data) {
    return <div className="loader"><span className="spinner" /></div>;
  }

  const p = data.player;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card">
        <div className="row-between wrap" style={{ gap: 18 }}>
          <div className="row" style={{ gap: 16 }}>
            <Avatar src={p.avatar_url} seed={p.avatar_seed} size={92} ring />
            <div>
              <h1 style={{ fontSize: '1.7rem', marginBottom: 2 }}>{p.username}</h1>
              <div className="row wrap small muted" style={{ gap: 10 }}>
                <span>◎ {p.country}</span>
                {p.city && <span>⌂ {p.city}</span>}
                <span>Joined {timeAgo(p.created_at)}</span>
              </div>
              {p.bio && <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>{p.bio}</p>}
            </div>
          </div>
          {!isMe && (
            <button className="btn primary" onClick={() => navigate('/app/play')}>✦ Challenge</button>
          )}
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="Wins" value={p.wins} sub={`${p.win_rate}% win rate`} tone="cyan" />
        <Stat label="Losses" value={p.losses} />
        <Stat label="Current streak" value={p.streak} sub={`Best ${p.best_streak}`} tone="gold" />
        <Stat label="Reputation" value={p.reputation_score} sub="From real match history" tone="violet" />
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Game statistics</h3></div>
          {data.games.length === 0 ? (
            <Empty>No completed matches yet.</Empty>
          ) : (
            <div className="stack-sm">
              {data.games.map((g) => (
                <div className="row" key={g.game}>
                  <span className="grow small">{g.game === 'tic-tac-toe' ? 'Tic-Tac-Toe' : g.game}</span>
                  <span className="tiny dim">{g.played} played</span>
                  <span className="badge lime">{g.wins}W</span>
                  <span className="badge red">{g.losses}L</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {isMe && privateData ? (
          <div className="card">
            <div className="card-head">
              <h3>Private statistics</h3>
              <span className="badge grey">Only you can see this</span>
            </div>
            <div className="kv"><span className="k">Total money won</span><span className="v mono">{formatKSh(user.total_won_cents)}</span></div>
            <div className="kv"><span className="k">Biggest win</span><span className="v mono">{formatKSh(user.biggest_win_cents)}</span></div>
            <div className="kv"><span className="k">Total staked</span><span className="v mono">{formatKSh(user.total_wagered_cents)}</span></div>
            <div className="kv"><span className="k">Total deposited</span><span className="v mono">{formatKSh(user.total_deposited_cents)}</span></div>
            <div className="kv"><span className="k">Total withdrawn</span><span className="v mono">{formatKSh(user.total_withdrawn_cents)}</span></div>
            <div className="kv"><span className="k">Reputation tier</span><span className="v">{privateData.reputation.tier.name}</span></div>
            <div className="kv"><span className="k">Risk score</span><span className="v mono">{user.risk_score}</span></div>
            <div className="divider" />
            <div className="card-title" style={{ marginBottom: 8 }}>Username history</div>
            <div className="stack-sm small muted">
              {privateData.username_history.map((h) => (
                <div className="row" key={`${h.username}-${h.changed_at}`}>
                  <span className="grow">{h.username}</span>
                  <span className="tiny dim">{h.reason} · {timeAgo(h.changed_at)}</span>
                </div>
              ))}
            </div>
            <button className="btn ghost sm block" style={{ marginTop: 12 }} onClick={() => navigate('/app/settings')}>
              Manage profile &amp; security
            </button>
          </div>
        ) : (
          <div className="card">
            <div className="card-head"><h3>Reputation</h3></div>
            <p className="small">
              PeerPlay reputation comes from real match history and behaviour - wins, losses, rule violations and
              connection discipline. It is never a star rating.
            </p>
            <div className="progress lime" style={{ marginTop: 10 }}>
              <div style={{ width: `${Math.min(100, (p.reputation_score / 1400) * 100)}%` }} />
            </div>
            <div className="tiny dim" style={{ marginTop: 6 }}>Reputation score {p.reputation_score}</div>
          </div>
        )}
      </div>
    </div>
  );
}
