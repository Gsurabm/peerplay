import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { get, post } from '../lib/api.js';
import { startTestDuel } from '../lib/duel.js';

const FEATURES = [
  {
    icon: '✦',
    tone: '',
    title: 'Skill, not luck',
    body: 'Server-authoritative matches. Every move, timer and win is verified by the engine - never by the client.',
  },
  {
    icon: '◈',
    tone: 'pink',
    title: 'Real wallets, real stakes',
    body: 'M-Pesa, Airtel Money, cards, PayPal and bank transfers. Deposits are confirmed server-side by the provider callback.',
  },
  {
    icon: '★',
    tone: 'gold',
    title: 'Rankings that mean something',
    body: 'Daily, weekly, monthly, yearly and all-time boards built from real match history - no star ratings, no votes.',
  },
  {
    icon: '◉',
    tone: '',
    title: 'Challenge your people',
    body: 'Direct challenges to friends, open invite links, WhatsApp, SMS and email invites with referral tracking.',
  },
  {
    icon: '◷',
    tone: 'pink',
    title: '15 seconds a move',
    body: 'Fast, focused matches with a 30-second connection recovery window so a dropped signal never decides a game.',
  },
  {
    icon: '◈',
    tone: 'gold',
    title: 'Fraud-aware by design',
    body: 'Multi-signal identity checks, device fingerprinting, behaviour analysis and anti-draw-farming penalties.',
  },
];

export default function Landing() {
  const { user, toast, adoptSession } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [duelBusy, setDuelBusy] = useState(false);
  const [publicLinks, setPublicLinks] = useState([]);
  const [copied, setCopied] = useState('');

  // Must stay ABOVE the early return below - hooks cannot be conditional.
  useEffect(() => {
    get('/config')
      .then((c) => setPublicLinks(c?.public_links || []))
      .catch(() => {});
  }, []);

  if (user) return <Navigate to="/app" replace />;

  async function quickStart() {
    setBusy(true);
    try {
      const data = await post('/auth/demo', {});
      await adoptSession(data);
      toast(`Signed in as ${data.credentials.username} - KSh 1,000 ready to stake`, 'success');
      navigate('/app', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  /** One click: this tab becomes player 1, a new tab becomes player 2. */
  async function copyLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      window.prompt('Copy this link', url);
    }
  }

  async function testDuel() {
    setDuelBusy(true);
    try {
      await startTestDuel({ adoptSession, navigate, toast });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDuelBusy(false);
    }
  }

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">PeerPlay</div>
            <div className="brand-tag">Challenge accepted</div>
          </div>
        </div>
        <div className="row">
          <Link to="/login" className="btn ghost">
            Sign in
          </Link>
          <Link to="/register" className="btn primary">
            Create account
          </Link>
        </div>
      </nav>

      <header className="landing-hero">
        <div>
          <span className="badge pink">Peer-to-peer esports</span>
          <h1 className="hero-title" style={{ marginTop: 14 }}>
            Two players.
            <br />
            One pot. <span className="grad">One winner.</span>
          </h1>
          <p className="hero-sub">
            PeerPlay is a skill-based competitive gaming platform. Pick a stake, match an opponent, and play
            head-to-head while both sides sit in escrow. The winner takes the pot, the platform keeps a flat 25%.
          </p>
          <div className="hero-cta">
            <button className="btn primary lg" onClick={quickStart} disabled={busy}>
              {busy ? <span className="spinner" /> : '⚡ Play instantly - no signup'}
            </button>
            <button className="btn ghost lg" onClick={testDuel} disabled={duelBusy}>
              {duelBusy ? <span className="spinner" /> : '✦ Two-player test (opens a second tab)'}
            </button>
            <Link to="/register" className="btn ghost lg">
              Create an account
            </Link>
          </div>
          <div className="hero-cta" style={{ marginTop: 12 }}>
            <Link to="/login" className="btn ghost sm">Sign in with an existing account</Link>
          </div>
          <div className="hero-badges">
            <span>✦ First game: Tic-Tac-Toe</span>
            <span>✦ Flat 25% platform fee</span>
            <span>✦ KSh 10 minimum stake</span>
          </div>
          {publicLinks.length > 0 && (
            <div className="card pad-sm" style={{ marginTop: 16, maxWidth: 520 }}>
              <div className="card-title" style={{ marginBottom: 8 }}>
                Open this app on another device
              </div>
              {publicLinks.map((l) => (
                <div key={l.url} className="row" style={{ gap: 8, marginBottom: 6 }}>
                  <span className="tiny dim" style={{ minWidth: 118 }}>
                    {l.label}
                  </span>
                  <span className="mono tiny grow" style={{ wordBreak: 'break-all' }}>
                    {l.url}
                  </span>
                  <button className="btn sm ghost" onClick={() => copyLink(l.url)}>
                    {copied === l.url ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))}
              <div className="tiny dim" style={{ marginTop: 6 }}>
                Tunnel addresses change when the sandbox recycles them - copy the link again if it stops
                responding.
              </div>
            </div>
          )}
        </div>

        <div className="split-card">
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>How a KSh 100 pot settles</h3>
            <span className="badge cyan">Escrow</span>
          </div>
          <div className="fee-row">
            <span className="muted">Player A stakes</span>
            <span className="mono">KSh 50.00</span>
          </div>
          <div className="fee-row">
            <span className="muted">Player B stakes</span>
            <span className="mono">KSh 50.00</span>
          </div>
          <div className="fee-row">
            <span className="muted">Total stake pool</span>
            <span className="mono">KSh 100.00</span>
          </div>
          <div className="fee-row">
            <span className="muted">Platform fee (25%)</span>
            <span className="mono neg">− KSh 25.00</span>
          </div>
          <div className="fee-row total">
            <span>Winner receives</span>
            <span className="mono pos">KSh 75.00</span>
          </div>
          <div className="notice" style={{ marginTop: 14 }}>
            Both stakes are held in escrow before the first move. Nothing is released until the server confirms the
            result.
          </div>
        </div>
      </header>

      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div className="card" key={f.title}>
            <div className={`feature-icon ${f.tone}`}>{f.icon}</div>
            <h3>{f.title}</h3>
            <p className="small" style={{ margin: 0 }}>
              {f.body}
            </p>
          </div>
        ))}
      </section>

      <section className="section-wrap">
        <div className="card" style={{ padding: 26 }}>
          <div className="grid grid-3">
            <div>
              <div className="card-title">Step 1</div>
              <h3 style={{ marginTop: 6 }}>Register & verify</h3>
              <p className="small">
                Username, email, phone and a private legal identity. Verify your phone and email to raise your trust
                score.
              </p>
            </div>
            <div>
              <div className="card-title">Step 2</div>
              <h3 style={{ marginTop: 6 }}>Fund your wallet</h3>
              <p className="small">
                Deposit from KSh 50 via M-Pesa, Airtel Money, Visa, Mastercard, PayPal, Pesalink or bank transfer.
              </p>
            </div>
            <div>
              <div className="card-title">Step 3</div>
              <h3 style={{ marginTop: 6 }}>Play 5 matches, then compete</h3>
              <p className="small">
                The onboarding journey unlocks free withdrawals and flexible stakes. Draws do not count - wins and
                losses do.
              </p>
            </div>
          </div>
          <div className="row" style={{ marginTop: 20, justifyContent: 'center' }}>
            <Link to="/register" className="btn primary lg">
              Create your free account
            </Link>
          </div>
          <p className="tiny center dim" style={{ marginTop: 12, marginBottom: 0 }}>
            Demo accounts - player: any seeded username with password Player123! · admin: arenaadmin / Admin123!
          </p>
        </div>
      </section>

      <footer className="section-wrap" style={{ paddingTop: 0 }}>
        <div className="divider" />
        <div className="row-between wrap" style={{ fontSize: '0.8rem', color: 'var(--dim)' }}>
          <span>© {new Date().getFullYear()} PeerPlay. Challenge Accepted.</span>
          <span>Built for fair, skill-based, peer-to-peer competition.</span>
        </div>
      </footer>
    </div>
  );
}
