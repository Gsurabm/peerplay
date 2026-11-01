import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../lib/api.js';
import Avatar from '../components/Avatar.jsx';
import { Empty, Tabs } from '../components/ui.jsx';

const SCOPES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'overall', label: 'All time' },
];

const FILTERS = [
  { value: 'global', label: 'Global' },
  { value: 'country', label: 'By country' },
  { value: 'friends', label: 'Friends' },
  { value: 'game', label: 'Per game' },
];

export default function Leaderboards() {
  const [scope, setScope] = useState('overall');
  const [filter, setFilter] = useState('global');
  const [game, setGame] = useState('tic-tac-toe');
  const [country, setCountry] = useState('');
  const [data, setData] = useState(null);
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get('/matches/games').then((d) => setGames(d.games)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const query = new URLSearchParams({ scope });
    if (filter === 'country' && country) query.set('country', country);
    if (filter === 'game') query.set('game', game);
    if (filter === 'friends') query.set('filter', 'friends');
    get(`/leaderboards?${query.toString()}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [scope, filter, game, country]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <h1>Leaderboards</h1>
        <p className="small" style={{ margin: 0 }}>
          Ranked purely on real match history - wins earn points, higher stakes earn more. No ratings, no votes.
        </p>
      </div>

      <Tabs value={scope} onChange={setScope} options={SCOPES} />
      <Tabs value={filter} onChange={setFilter} options={FILTERS} />

      {filter === 'country' && (
        <div className="row wrap">
          <button type="button" className={`chip ${!country ? 'active' : ''}`} onClick={() => setCountry('')}>All countries</button>
          {(data?.countries || []).map((c) => (
            <button key={c.code} type="button" className={`chip ${country === c.code ? 'active' : ''}`} onClick={() => setCountry(c.code)}>
              {c.name} ({c.players})
            </button>
          ))}
        </div>
      )}

      {filter === 'game' && (
        <div className="row wrap">
          {games.map((g) => (
            <button key={g.slug} type="button" className={`chip ${game === g.slug ? 'active' : ''}`} onClick={() => setGame(g.slug)}>
              {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
        <div className="card">
          <div className="card-head">
            <h3>{SCOPES.find((s) => s.value === scope)?.label} board</h3>
            <span className="badge grey">{data?.period}</span>
          </div>
          {loading ? (
            <div className="loader"><span className="spinner" /></div>
          ) : !data?.leaderboard?.length ? (
            <Empty icon="★">No ranked results in this period yet. Play a match to claim a spot.</Empty>
          ) : (
            <div className="stack-sm">
              {data.leaderboard.map((row) => (
                <Link
                  key={row.user_id}
                  to={`/app/profile/${row.username}`}
                  className={`rank-row ${row.is_viewer ? 'me' : ''}`}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  <span className={`rank-num ${row.rank <= 3 ? 'top' : ''}`}>#{row.rank}</span>
                  <Avatar src={row.avatar_url} seed={row.avatar_seed} size={40} />
                  <div style={{ minWidth: 0 }}>
                    <div className="small" style={{ fontWeight: 600 }}>{row.username}</div>
                    <div className="tiny dim">
                      {row.wins} win{row.wins === 1 ? '' : 's'} · {row.points} pts
                      {row.streak > 1 && ` · ${row.streak} streak`}
                    </div>
                  </div>
                  <span className="mono small cyan">{row.points}p</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Your position</h3></div>
            {data?.viewer ? (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="rank-num top" style={{ fontSize: '1.8rem' }}>#{data.viewer.rank}</span>
                  <div>
                    <div className="small">{data.viewer.wins} wins this period</div>
                    <div className="tiny dim">{data.viewer.points} ranking points</div>
                  </div>
                </div>
                <div className="notice">
                  Points = 100 per win, plus a stake bonus of up to 50 for higher-value matches.
                </div>
              </>
            ) : (
              <Empty>You are not ranked in this period yet - win a match to appear.</Empty>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>How ranking works</h3></div>
            <div className="stack-sm small muted">
              <div>✦ Wins earn 100 points plus a bonus scaled by the stake played.</div>
              <div>✦ Losses cost reputation, not points.</div>
              <div>✦ Forfeits on time or disconnect reduce your reputation score.</div>
              <div>✦ Each board filters by real match dates - daily resets at midnight.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
