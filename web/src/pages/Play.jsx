import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { get, post, del } from '../lib/api.js';
import { formatKSh, parseAmount } from '../lib/format.js';
import { createDemoPlayer, openBlankTab, pointTabAt, secondTabUrl } from '../lib/duel.js';
import Avatar from '../components/Avatar.jsx';
import { Empty, Modal } from '../components/ui.jsx';

const QUICK_STAKES = [10, 15, 20, 25, 30, 50, 100, 200, 500];

function initialStake(params) {
  const raw = Number(params.get('stake'));
  return Number.isFinite(raw) && raw >= 500 ? Math.round(raw / 5) * 5 : 2000;
}

export default function Play() {
  const { user, wallet, journey, toast, refreshWallet, refreshJourney } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [stake, setStake] = useState(() => initialStake(params));
  const [custom, setCustom] = useState('');
  const [queue, setQueue] = useState(null);
  const [online, setOnline] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [friends, setFriends] = useState([]);
  const [guidance, setGuidance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [duelBusy, setDuelBusy] = useState(false);
  const [duelLink, setDuelLink] = useState('');
  const autoJoined = useRef(false);

  const loadChallenges = useCallback(async () => {
    try {
      const d = await get('/matches/challenges');
      setChallenges(d.challenges);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    get('/matches/online').then((d) => setOnline(d.players)).catch(() => {});
    get('/profile/friends/list').then((d) => setFriends(d.friends)).catch(() => {});
    get('/matches/stake-guidance').then((d) => setGuidance(d)).catch(() => {});
    loadChallenges();
    const t = setInterval(loadChallenges, 8000);
    return () => clearInterval(t);
  }, [loadChallenges]);

  useEffect(() => {
    if (params.get('tutorial') === '1' || (user && !user.tutorial_done)) setTutorialOpen(true);
  }, [params, user]);

  const recommended = guidance?.recommended;
  const journeyActive = journey && journey.state !== 'complete';

  const stakeOptions = useMemo(() => QUICK_STAKES.map((v) => v * 100), []);

  function pickStake(cents) {
    setStake(cents);
    setCustom('');
  }

  async function joinQueue() {
    setBusy(true);
    try {
      const result = await post('/matches/queue', { game: 'tic-tac-toe', stake_cents: stake });
      if (result.status === 'matched') {
        toast('Opponent found - match starting', 'success');
        setQueue(null);
        navigate(`/app/match/${result.match_id}`);
      } else {
        setQueue(result);
        toast('Searching for an opponent at this stake', 'info');
      }
      await refreshWallet();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function cancelQueue() {
    try {
      await del('/matches/queue');
      setQueue(null);
      toast('Left the queue', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /**
   * Opens a second player in a brand new tab with its own funded account.
   * The new tab keeps its session in sessionStorage, so both tabs are two
   * different players even though they share a browser.
   */
  async function openSecondPlayer() {
    setDuelBusy(true);
    const win = openBlankTab();
    try {
      const data = await createDemoPlayer();
      const url = secondTabUrl(data.token, stake);
      const opened = pointTabAt(win, url);
      if (!opened) {
        setDuelLink(`${window.location.origin}${url}`);
        toast('Your browser blocked the pop-up - open the second player from the link below', 'error');
      } else {
        toast(`Second player ready (${data.credentials.username}) - joining your queue`, 'success');
      }
      if (queue) {
        toast('Opponent tab is joining your queue', 'info');
      } else {
        await joinQueue();
      }
    } catch (err) {
      try {
        win?.close();
      } catch {
        /* ignore */
      }
      toast(err.message, 'error');
    } finally {
      setDuelBusy(false);
    }
  }

  // A "second player" tab arrives with ?auto=1 - it queues itself.
  useEffect(() => {
    if (autoJoined.current) return;
    if (params.get('auto') !== '1') return;
    if (!user) return;
    autoJoined.current = true;
    toast('You are player 2 - searching for the opponent', 'info');
    joinQueue();
  }, [params, user, toast]);

  async function challenge(userId, username) {
    setBusy(true);
    try {
      await post('/matches/challenges', { to_user_id: userId, game: 'tic-tac-toe', stake_cents: stake });
      toast(`Challenge sent to ${username}`, 'success');
      loadChallenges();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function respond(challengeId, accept) {
    try {
      const result = await post(`/matches/challenges/${challengeId}/respond`, { accept });
      if (result.status === 'accepted') {
        toast('Challenge accepted - match live', 'success');
        navigate(`/app/match/${result.match_id}`);
      } else {
        toast('Challenge declined', 'info');
        loadChallenges();
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function createInvite(channel) {
    try {
      const d = await post('/referrals/invite', { channel, source: 'play' });
      const link = `${window.location.origin}/join/${d.invite.token}`;
      setInviteLink(link);
      if (navigator.clipboard) await navigator.clipboard.writeText(link);
      toast(`${channel.toUpperCase()} invite link copied`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const shareTargets = inviteLink
    ? {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`I challenge you to Tic-Tac-Toe on PeerPlay! ${inviteLink}`)}`,
        sms: `sms:?&body=${encodeURIComponent(`I challenge you to Tic-Tac-Toe on PeerPlay! ${inviteLink}`)}`,
        email: `mailto:?subject=${encodeURIComponent('A PeerPlay challenge')}&body=${encodeURIComponent(`I challenge you to Tic-Tac-Toe on PeerPlay! ${inviteLink}`)}`,
        social: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I challenge you to Tic-Tac-Toe on PeerPlay! ${inviteLink}`)}`,
      }
    : null;

  const balance = wallet?.available_cents ?? 0;
  const tooExpensive = stake > balance;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <h1>Find a match</h1>
        <p className="small" style={{ margin: 0 }}>
          Pick a stake, we match you with an opponent at the same amount. Both sides fund escrow before the first move.
        </p>
      </div>

      {!user?.tutorial_done && (
        <div className="notice warn row-between wrap">
          <div>
            <strong>New here?</strong> Take the free tutorial match first - learn the board, the clock and the escrow
            before risking a shilling.
          </div>
          <button className="btn sm" onClick={() => setTutorialOpen(true)}>Start free tutorial</button>
        </div>
      )}

      <div className="card" style={{ borderColor: 'rgba(0,229,255,.3)' }}>
        <div className="card-head">
          <h3>✦ Two-player test</h3>
          <span className="badge cyan">opens a second tab</span>
        </div>
        <p className="small" style={{ marginTop: 0 }}>
          Two tabs of the same browser share one session, so they are the same player and the server will not match
          them. This button opens a second tab with its own funded account (KSh 1,000), queues both sides at{' '}
          <strong>{formatKSh(stake, { decimals: 0 })}</strong> and starts the match.
        </p>
        <button className="btn primary block" onClick={openSecondPlayer} disabled={duelBusy}>
          {duelBusy ? <span className="spinner" /> : 'Open a second player & match'}
        </button>
        {duelLink && (
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input mono tiny grow" readOnly value={duelLink} />
            <button
              className="btn sm ghost"
              onClick={() => {
                window.open(duelLink, '_blank');
              }}
            >
              Open
            </button>
          </div>
        )}
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,1fr)' }}>
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Choose your stake</h3>
              <span className="badge cyan">Both players match the same stake</span>
            </div>

            {recommended && journeyActive && (
              <div className="notice" style={{ marginBottom: 14 }}>
                <div className="row-between wrap">
                  <div>
                    <strong>1.5x growth:</strong> your last stake was {formatKSh(recommended.raw / 1.5, { decimals: 0 })},
                    so the 1.5x recommendation is {formatKSh(recommended.raw)}.
                  </div>
                  <button className="btn sm pink" onClick={() => pickStake(recommended.value)}>
                    Use {formatKSh(recommended.value, { decimals: 0 })}
                  </button>
                </div>
                <div className="tiny dim" style={{ marginTop: 6 }}>
                  Stakes are multiples of KSh 5, so the selectable amount is rounded down to {formatKSh(recommended.value)}.
                </div>
              </div>
            )}

            <div className="row wrap" style={{ marginBottom: 12 }}>
              {stakeOptions.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`chip ${stake === v && !custom ? 'active' : ''}`}
                  onClick={() => pickStake(v)}
                >
                  {formatKSh(v, { decimals: 0 })}
                </button>
              ))}
            </div>

            <div className="row" style={{ marginBottom: 14 }}>
              <input
                className="input mono grow"
                placeholder="Custom stake (KSh, multiples of 5)"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value);
                  const cents = parseAmount(e.target.value);
                  if (Number.isFinite(cents)) setStake(cents);
                }}
              />
            </div>

            <div className="split-card" style={{ padding: 16, marginBottom: 14 }}>
              <div className="fee-row">
                <span className="muted">Your stake</span>
                <span className="mono">{formatKSh(stake)}</span>
              </div>
              <div className="fee-row">
                <span className="muted">Opponent stakes</span>
                <span className="mono">{formatKSh(stake)}</span>
              </div>
              <div className="fee-row">
                <span className="muted">Total pot</span>
                <span className="mono">{formatKSh(stake * 2)}</span>
              </div>
              <div className="fee-row">
                <span className="muted">Platform fee (25%)</span>
                <span className="mono neg">− {formatKSh(Math.round(stake * 2 * 0.25))}</span>
              </div>
              <div className="fee-row total">
                <span>Winner receives</span>
                <span className="mono pos">{formatKSh(Math.round(stake * 2 * 0.75))}</span>
              </div>
            </div>

            {tooExpensive && (
              <div className="notice danger" style={{ marginBottom: 12 }}>
                That stake is higher than your available balance of {formatKSh(balance)}. Deposit to keep playing.
              </div>
            )}

            {queue ? (
              <div className="stack-sm">
                <div className="notice queue-pulse row-between">
                  <span>
                    Searching for an opponent at <strong>{formatKSh(queue.stake_cents)}</strong>...
                  </span>
                  <span className="mono tiny">{queue.players_in_queue} in queue</span>
                </div>
                <button className="btn ghost block" onClick={cancelQueue}>Cancel search</button>
              </div>
            ) : (
              <button className="btn primary block lg" disabled={busy || tooExpensive} onClick={joinQueue}>
                {busy ? <span className="spinner" /> : '✦ Find opponent'}
              </button>
            )}
            <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
              <span className="tiny dim">Minimum stake KSh 10 · multiples of KSh 5 · 15s per move</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Challenge a friend</h3>
              <span className="badge grey">{friends.length} friends · {online.length} online</span>
            </div>
            {friends.length === 0 && online.length === 0 ? (
              <Empty icon="◉">No friends online right now. Try public matchmaking above.</Empty>
            ) : (
              <div className="stack-sm" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {friends.map((f) => (
                  <div className="row" key={f.user_id} style={{ padding: '6px 0' }}>
                    <Avatar src={f.avatar_url} seed={f.avatar_seed} size={34} online={f.online} />
                    <div className="grow">
                      <div className="small">{f.username}</div>
                      <div className="tiny dim">{f.wins}W · {f.losses}L · rep {f.reputation_score}</div>
                    </div>
                    <button className="btn sm ghost" disabled={busy || tooExpensive} onClick={() => challenge(f.user_id, f.username)}>
                      Challenge
                    </button>
                  </div>
                ))}
                {online.filter((o) => !friends.some((f) => f.user_id === o.id)).map((o) => (
                  <div className="row" key={o.id} style={{ padding: '6px 0' }}>
                    <Avatar src={o.avatar_url} seed={o.avatar_seed} size={34} online />
                    <div className="grow">
                      <div className="small">{o.username}</div>
                      <div className="tiny dim">Online · {o.wins}W · rep {o.reputation_score}</div>
                    </div>
                    <button className="btn sm ghost" disabled={busy || tooExpensive} onClick={() => challenge(o.id, o.username)}>
                      Challenge
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Challenges</h3>
              <span className="badge grey">{challenges.length} open</span>
            </div>
            {challenges.length === 0 ? (
              <Empty icon="✦">No open challenges right now.</Empty>
            ) : (
              <div className="stack-sm">
                {challenges.map((c) => (
                  <div className="row" key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                    <Avatar src={c.from_avatar_url} seed={c.from_avatar_seed} size={34} />
                    <div className="grow">
                      <div className="small">{c.from_username}</div>
                      <div className="tiny dim">Tic-Tac-Toe · {formatKSh(c.stake_cents, { decimals: 0 })}</div>
                    </div>
                    <button className="btn sm success" onClick={() => respond(c.id, true)}>Accept</button>
                    <button className="btn sm ghost" onClick={() => respond(c.id, false)}>Decline</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>Invite &amp; share</h3></div>
            <p className="small">
              Send a challenge link over SMS, WhatsApp, email or social. Every invite is tracked for referrals.
            </p>
            <div className="row wrap" style={{ marginBottom: 12 }}>
              <button className="btn ghost sm" onClick={() => createInvite('whatsapp')}>WhatsApp</button>
              <button className="btn ghost sm" onClick={() => createInvite('sms')}>SMS</button>
              <button className="btn ghost sm" onClick={() => createInvite('email')}>Email</button>
              <button className="btn ghost sm" onClick={() => createInvite('social')}>Social</button>
              <button className="btn ghost sm" onClick={() => createInvite('copy')}>Copy link</button>
            </div>
            {inviteLink && (
              <>
                <div className="row">
                  <input className="input mono tiny grow" readOnly value={inviteLink} />
                </div>
                <div className="row wrap" style={{ marginTop: 10 }}>
                  {shareTargets && (
                    <>
                      <a className="btn sm ghost" href={shareTargets.whatsapp} target="_blank" rel="noreferrer">Open WhatsApp</a>
                      <a className="btn sm ghost" href={shareTargets.sms}>Open SMS</a>
                      <a className="btn sm ghost" href={shareTargets.email}>Open Email</a>
                      <a className="btn sm ghost" href={shareTargets.social} target="_blank" rel="noreferrer">Share</a>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h3>How a match works</h3></div>
            <div className="stack-sm small muted">
              <div>1. Both stakes move into escrow - nobody can cash out mid-match.</div>
              <div>2. 15 seconds per move. Run out of time and you lose the match.</div>
              <div>3. A dropped connection gets a 30-second recovery window before a walkover.</div>
              <div>4. Win? The escrow pays out minus the flat 25% platform fee.</div>
              <div>5. Draw? Same escrow replays. Three draws cancel the match and apply a 5% anti-farming penalty.</div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
        title="Free tutorial match"
        footer={
          <>
            <button className="btn ghost" onClick={() => setTutorialOpen(false)}>Later</button>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  const d = await post('/matches/tutorial/start', {});
                  setTutorialOpen(false);
                  navigate(`/app/match/${d.match.id}`);
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
            >
              Start tutorial
            </button>
          </>
        }
      >
        <p className="small">
          Play a free match against the PeerPlay trainer. No money is involved - this is where you learn the board, the
          15-second clock, how winning works and what escrow means.
        </p>
        <div className="stack-sm small muted">
          <div>✦ You play X, the trainer plays O.</div>
          <div>✦ 15 seconds per move, exactly like a ranked match.</div>
          <div>✦ Winning lines, draws and the settlement screen all behave the same.</div>
        </div>
      </Modal>
    </div>
  );
}
