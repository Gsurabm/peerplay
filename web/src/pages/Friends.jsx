import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { get, post, del } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import { Empty } from '../components/ui.jsx';

export default function Friends() {
  const { toast, user } = useApp();
  const navigate = useNavigate();
  const [friends, setFriends] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const load = () => get('/profile/friends/list').then((d) => setFriends(d.friends || [])).catch(() => {});

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      get(`/profile/friends/search?q=${encodeURIComponent(query)}`).then((d) => setResults(d.players || [])).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  async function add(id, name) {
    try {
      await post('/profile/friends/request', { user_id: id });
      toast(`Friend request sent to ${name}`, 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function respond(friendshipId, accept, name) {
    try {
      await post('/profile/friends/respond', { friendship_id: friendshipId, accept });
      toast(accept ? `You are now connected with ${name}` : 'Request declined', 'info');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(friendshipId) {
    try {
      await del(`/profile/friends/${friendshipId}`);
      toast('Friend removed', 'info');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const pending = friends.filter((f) => f.status === 'pending');
  const accepted = friends.filter((f) => f.status === 'accepted');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <h1>Friends</h1>
        <p className="small" style={{ margin: 0 }}>
          Connect with the people you want to beat. Friends get their own leaderboard and can be challenged directly.
        </p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Find a player</h3></div>
        <input
          className="input"
          placeholder="Search by username or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <div className="stack-sm" style={{ marginTop: 12 }}>
            {results.map((p) => (
              <div className="row" key={p.id}>
                <Avatar src={p.avatar_url} seed={p.avatar_seed} size={34} />
                <div className="grow">
                  <div className="small">{p.username}</div>
                  <div className="tiny dim">{p.wins}W · {p.losses}L · rep {p.reputation_score}</div>
                </div>
                <button className="btn sm ghost" onClick={() => add(p.id, p.username)}>Add friend</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Requests</h3><span className="badge pink">{pending.length}</span></div>
          <div className="stack-sm">
            {pending.map((f) => (
              <div className="row" key={f.friendship_id}>
                <Avatar src={f.avatar_url} seed={f.avatar_seed} size={34} />
                <div className="grow">
                  <div className="small">{f.username}</div>
                  <div className="tiny dim">Requested {timeAgo(f.created_at)}</div>
                </div>
                <button className="btn sm success" onClick={() => respond(f.friendship_id, true, f.username)}>Accept</button>
                <button className="btn sm ghost" onClick={() => respond(f.friendship_id, false, f.username)}>Decline</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Your circle</h3><span className="badge grey">{accepted.length}</span></div>
        {accepted.length === 0 ? (
          <Empty icon="◉">No friends yet. Search above to find your first rival.</Empty>
        ) : (
          <div className="grid grid-2">
            {accepted.map((f) => (
              <div className="row" key={f.friendship_id} style={{ padding: '8px 0' }}>
                <Avatar src={f.avatar_url} seed={f.avatar_seed} size={40} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small" style={{ fontWeight: 600 }}>{f.username}</div>
                  <div className="tiny dim">
                    {f.wins}W · {f.losses}L · streak {f.streak} · rep {f.reputation_score}
                  </div>
                  <div className="tiny dim">Active {timeAgo(f.last_seen_at)}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn sm primary" onClick={() => navigate('/app/play')}>Challenge</button>
                  <button className="btn sm ghost" onClick={() => remove(f.friendship_id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
