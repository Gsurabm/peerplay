import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { get, post } from '../lib/api.js';
import { formatKSh } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import { Modal, Empty } from '../components/ui.jsx';

const REPORT_REASONS = [
  ['draw_farming', 'Draw farming'],
  ['cheating', 'Cheating'],
  ['suspicious_behaviour', 'Suspicious behaviour'],
  ['disconnect_abuse', 'Repeated disconnect abuse'],
  ['harassment', 'Harassment'],
  ['other', 'Other'],
];

export default function MatchScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket, toast, refreshWallet, refreshJourney, user } = useApp();
  const [match, setMatch] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [result, setResult] = useState(null);
  const [drawNotice, setDrawNotice] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('cheating');
  const [reportDetails, setReportDetails] = useState('');
  const [error, setError] = useState(null);
  const lastMove = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await get(`/matches/${id}`);
      setMatch(d.match);
      if (d.match.status === 'completed' || d.match.status === 'cancelled') {
        setResult({
          status: d.match.status,
          winner_id: d.match.winner_id,
          loser_id: d.match.loser_id,
          end_reason: d.match.end_reason,
          payout_cents: d.match.escrow_cents,
          fee_cents: d.match.fee_cents,
          pool_cents: d.match.pool_cents,
          draw_count: d.match.draw_count,
          penalty_cents: d.match.penalty_cents,
        });
      }
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // Light polling keeps the board live even if the realtime socket is unavailable.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await get(`/matches/${id}`);
        setMatch((prev) => (prev ? { ...prev, ...d.match } : d.match));
      } catch {
        /* ignore transient errors */
      }
    }, 2500);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    const s = socket;
    if (!s) return undefined;

    const onState = (state) => {
      if (state.id !== id) return;
      setMatch((prev) => (prev && prev.id === state.id ? { ...prev, ...state } : state));
      if (state.board && state.moves?.length) {
        const move = state.moves[state.moves.length - 1];
        lastMove.current = move;
      }
    };
    const onEnd = (payload) => {
      if (payload.match_id !== id) return;
      setResult(payload);
      refreshWallet();
      refreshJourney();
    };
    const onDraw = (payload) => {
      if (payload.match_id !== id) return;
      setDrawNotice(payload);
      toast(payload.warning ? 'Draw farming warning' : `Draw #${payload.draw_count} - rematch`, payload.warning ? 'error' : 'info');
    };
    const onRecovery = (payload) => {
      if (payload.match_id !== id) return;
      setRecovery(payload);
    };

    s.on('match_state', onState);
    s.on('match_end', onEnd);
    s.on('match_draw', onDraw);
    s.on('match_recovery', onRecovery);

    s.emit('match:join', { match_id: id }, () => {});

    return () => {
      s.off('match_state', onState);
      s.off('match_end', onEnd);
      s.off('match_draw', onDraw);
      s.off('match_recovery', onRecovery);
      s.emit('match:leave', { match_id: id });
    };
  }, [id, socket, refreshWallet, refreshJourney, toast]);

  const remaining = useMemo(() => {
    if (!match?.turn_deadline) return 0;
    return Math.max(0, Math.ceil((new Date(match.turn_deadline).getTime() - now) / 1000));
  }, [match, now]);

  const recoveryRemaining = useMemo(() => {
    if (!recovery?.deadline) return 0;
    return Math.max(0, Math.ceil((new Date(recovery.deadline).getTime() - now) / 1000));
  }, [recovery, now]);

  async function play(cell) {
    if (!match || match.viewer_turn === false) return;
    try {
      const s = socket;
      if (s && s.connected) {
        s.emit('match:move', { match_id: id, cell }, (res) => {
          if (res?.error) toast(res.error, 'error');
          else if (res?.match) setMatch(res.match);
        });
      } else {
        const d = await post(`/matches/${id}/move`, { cell });
        setMatch(d.match);
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function submitReport() {
    try {
      await post('/reports', {
        reason: reportReason,
        details: reportDetails,
        reported_user_id: match?.players?.x?.user_id === match?.viewer_seat ? match?.players?.o?.user_id : match?.players?.x?.user_id,
        match_id: id,
      });
      toast('Report submitted - our moderation team will review the match', 'success');
      setReportOpen(false);
      setReportDetails('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  if (error) {
    return <Empty icon="⚠">Could not load this match: {error}</Empty>;
  }
  if (!match) {
    return <div className="loader"><span className="spinner" /></div>;
  }

  const x = match.players?.x;
  const o = match.players?.o;
  const mySeat =
    match.viewer_seat ||
    (x?.user_id && x.user_id === user?.id ? 'x' : o?.user_id && o.user_id === user?.id ? 'o' : null);
  const opponent = mySeat === 'x' ? o : x;
  const myTurn = match.status === 'active' && match.turn === mySeat;
  const timerPct = Math.max(0, Math.min(100, (remaining / (match.move_seconds || 15)) * 100));

  /* Settlement is seat aware: the loser is told they lost, never that the
     opponent won. */
  const winnerId = result?.winner_id || match?.winner_id || null;
  const myId = mySeat === 'x' ? x?.user_id : o?.user_id;
  const iWon = Boolean(winnerId && myId && winnerId === myId);
  const iLost = Boolean(winnerId && myId && winnerId !== myId);
  const opponentName = opponent?.username || 'Your opponent';
  const pot = result?.pool_cents ?? match?.pool_cents ?? 0;
  const fee = result?.fee_cents ?? match?.fee_cents ?? 0;
  const payout = result?.payout_cents ?? 0;
  const myStake = result?.stake_cents ?? match?.stake_cents ?? 0;
  const refund = result?.refund_cents ?? 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head row-between wrap">
        <div>
          <h1 style={{ fontSize: '1.5rem' }}>{match.game.name}</h1>
          <p className="small" style={{ margin: 0 }}>
            {match.mode === 'tutorial' ? 'Free tutorial match' : `Stake ${formatKSh(match.stake_cents)} each`} ·{' '}
            {match.status === 'active' ? 'in play' : match.status}
            {match.draw_count > 0 && ` · ${match.draw_count} draw${match.draw_count > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="row">
          {opponent?.user_id && opponent.user_id !== 'ai' && (
            <button className="btn ghost sm" onClick={() => setReportOpen(true)}>Report</button>
          )}
          <button className="btn ghost sm" onClick={() => navigate('/app')}>Leave</button>
        </div>
      </div>

      {drawNotice && (
        <div className={`notice ${drawNotice.warning ? 'danger' : 'warn'}`}>
          {drawNotice.message}
        </div>
      )}

      {recovery && !recovery.recovered && (
        <div className="recovery-banner row-between wrap">
          <span>
            <strong>Opponent connection interrupted.</strong> Recovery time remaining: <span className="mono">{recoveryRemaining}s</span>.
            If they do not return, you win the match.
          </span>
        </div>
      )}

      <div className="match-layout">
        <div className="board-wrap">
          <div className={`turn-banner ${myTurn || iWon ? 'mine' : 'theirs'}`}>
            {match.status !== 'active'
              ? iWon
                ? '● You won this match'
                : iLost
                  ? '● You lost this match'
                  : 'Match finished'
              : myTurn
                ? '● Your turn - make your move'
                : `● ${opponent?.username || 'Opponent'}'s turn`}
            {match.status === 'active' && <span className="mono">{remaining}s</span>}
          </div>

          <div className={`timer-bar ${remaining <= 5 ? 'danger' : ''}`}>
            <div style={{ width: `${timerPct}%` }} />
          </div>

          <div className="board">
            {match.board.map((cell, index) => (
              <button
                key={index}
                type="button"
                className={`cell ${cell ? 'taken' : ''} ${cell || ''}`}
                onClick={() => play(index)}
                disabled={!myTurn || Boolean(cell) || match.status !== 'active'}
              >
                {cell === 'x' ? '✕' : cell === 'o' ? '◯' : ''}
              </button>
            ))}
          </div>

          <div className="player-row" style={{ width: 'min(440px, 92vw)' }}>
            <div className={`player-chip ${match.turn === 'x' && match.status === 'active' ? 'active' : ''}`}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <span className="seat-tag">X</span>
                <Avatar src={x?.avatar_url} seed={x?.avatar_seed} size={30} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {x?.username}
                </div>
                <div className="tiny dim nowrap">{x?.is_ai ? 'Trainer' : `${x?.wins ?? 0}W · ${x?.losses ?? 0}L`}</div>
              </div>
              {x?.result && x.result !== 'pending' && (
                <span className={`badge ${x.result === 'win' ? 'lime' : x.result === 'loss' ? 'red' : 'gold'}`}>{x.result}</span>
              )}
            </div>
            <div className={`player-chip ${match.turn === 'o' && match.status === 'active' ? 'active' : ''}`}>
              <div className="row" style={{ gap: 8, minWidth: 0 }}>
                <span className="seat-tag o">O</span>
                <Avatar src={o?.avatar_url} seed={o?.avatar_seed} size={30} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o?.username}
                </div>
                <div className="tiny dim nowrap">{o?.is_ai ? 'Trainer' : `${o?.wins ?? 0}W · ${o?.losses ?? 0}L`}</div>
              </div>
              {o?.result && o.result !== 'pending' && (
                <span className={`badge ${o.result === 'win' ? 'lime' : o.result === 'loss' ? 'red' : 'gold'}`}>{o.result}</span>
              )}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Escrow</h3>
              <span className="badge cyan">{match.is_tutorial ? 'Practice' : 'Server held'}</span>
            </div>
            {match.is_tutorial ? (
              <>
                <div className="notice">Free tutorial - no money is staked and no escrow is held. The rules, the clock and the settlement behave exactly like a ranked match.</div>
                <div className="kv" style={{ marginTop: 10 }}><span className="k">Draws so far</span><span className="v mono">{match.draw_count} / 3</span></div>
              </>
            ) : (
              <>
                <div className="kv"><span className="k">Your stake</span><span className="v mono">{formatKSh(match.stake_cents)}</span></div>
                <div className="kv"><span className="k">Opponent stake</span><span className="v mono">{formatKSh(match.stake_cents)}</span></div>
                <div className="kv"><span className="k">Total pot</span><span className="v mono">{formatKSh(match.pool_cents)}</span></div>
                <div className="kv"><span className="k">Platform fee (25%)</span><span className="v mono neg">− {formatKSh(match.fee_cents)}</span></div>
                <div className="kv"><span className="k">Winner receives</span><span className="v mono pos">{formatKSh(match.escrow_cents)}</span></div>
                <div className="kv"><span className="k">Draws so far</span><span className="v mono">{match.draw_count} / 3</span></div>
              </>
            )}
            {match.draw_count > 0 && (
              <div className="notice warn" style={{ marginTop: 10 }}>
                A third draw cancels the match and takes a 5% anti-draw-farming penalty from the pot.
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Match rules</h3></div>
            <ul className="stack-sm small muted" style={{ paddingLeft: 18, margin: 0 }}>
              {match.game.rules.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </div>
        </div>
      </div>

      <Modal
        open={Boolean(result)}
        onClose={() => {
          setResult(null);
          navigate('/app');
        }}
        title={
          result?.status === 'cancelled'
            ? 'Match cancelled'
            : iWon
              ? 'Victory!'
              : iLost
                ? 'Defeat'
                : 'Match complete'
        }
      >
        {result && (
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              {result.status === 'cancelled'
                ? `The match was cancelled after ${result.draw_count} draws. The anti-draw-farming penalty was applied and the escrow released.`
                : iWon
                  ? result.end_reason === 'timeout'
                    ? `${opponentName} ran out of time. The pot is yours.`
                    : result.end_reason === 'disconnect'
                      ? `${opponentName} lost their connection and could not return. The pot is yours.`
                      : 'You closed the line. The pot is yours.'
                  : iLost
                    ? result.end_reason === 'timeout'
                      ? `You ran out of time, so you lost this one. ${opponentName} takes the pot.`
                      : result.end_reason === 'disconnect'
                        ? `Your connection dropped and you did not return in time. ${opponentName} takes the pot by walkover.`
                        : `You lost this one. ${opponentName} closed the line and takes the pot.`
                    : 'The match ended.'}
            </p>
            <div className="split-card" style={{ padding: 16 }}>
              {result.status === 'cancelled' ? (
                <>
                  <div className="fee-row"><span className="muted">Total pot</span><span className="mono">{formatKSh(pot)}</span></div>
                  <div className="fee-row"><span className="muted">Platform fee (25%)</span><span className="mono neg">− {formatKSh(fee)}</span></div>
                  {result.penalty_cents > 0 && (
                    <div className="fee-row"><span className="muted">Anti-draw-farming penalty</span><span className="mono neg">− {formatKSh(result.penalty_cents)}</span></div>
                  )}
                  <div className="fee-row total">
                    <span>You get back</span>
                    <span className="mono pos">{formatKSh(refund || Math.max(0, myStake - Math.round((result.penalty_cents || 0) / 2)))}</span>
                  </div>
                </>
              ) : iWon ? (
                <>
                  <div className="fee-row"><span className="muted">Total pot</span><span className="mono">{formatKSh(pot)}</span></div>
                  <div className="fee-row"><span className="muted">Platform fee (25%)</span><span className="mono neg">− {formatKSh(fee)}</span></div>
                  <div className="fee-row total">
                    <span>You receive</span>
                    <span className="mono pos">{formatKSh(payout)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="fee-row"><span className="muted">Total pot</span><span className="mono">{formatKSh(pot)}</span></div>
                  <div className="fee-row"><span className="muted">Platform fee (25%)</span><span className="mono neg">− {formatKSh(fee)}</span></div>
                  <div className="fee-row"><span className="muted">Paid to {opponentName}</span><span className="mono">{formatKSh(payout)}</span></div>
                  <div className="fee-row"><span className="muted">Your stake</span><span className="mono neg">− {formatKSh(myStake)}</span></div>
                  <div className="fee-row total">
                    <span>You receive</span>
                    <span className="mono">{formatKSh(0)}</span>
                  </div>
                </>
              )}
              {result.end_reason && result.end_reason !== 'normal' && (
                <div className="fee-row"><span className="muted">Reason</span><span className="mono small">{result.end_reason.replace(/_/g, ' ')}</span></div>
              )}
            </div>
            <div className="row">
              <button className="btn primary grow" onClick={() => { setResult(null); navigate('/app'); }}>Back to dashboard</button>
              <button className="btn ghost" onClick={() => { setResult(null); navigate('/app/play'); }}>Play again</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report this player"
        footer={
          <>
            <button className="btn ghost" onClick={() => setReportOpen(false)}>Cancel</button>
            <button className="btn danger" onClick={submitReport}>Submit report</button>
          </>
        }
      >
        <div className="field">
          <label className="label">Reason</label>
          <select className="select" value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
            {REPORT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label">Details</label>
          <textarea className="textarea" value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} placeholder="What happened?" />
        </div>
        <div className="notice">Reports are reviewed by the moderation team. Confirmed violations reduce the reporter's reputation score.</div>
      </Modal>
    </div>
  );
}
