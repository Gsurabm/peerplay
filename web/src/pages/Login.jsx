import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { post } from '../lib/api.js';
import { startTestDuel } from '../lib/duel.js';

export function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, position: 'relative', zIndex: 1 }}>
      <div style={{ width: 'min(480px, 100%)' }}>
        <div className="center" style={{ marginBottom: 22 }}>
          <Link to="/" className="row" style={{ justifyContent: 'center', textDecoration: 'none' }}>
            <div className="brand-mark">P</div>
            <div style={{ textAlign: 'left' }}>
              <div className="brand-name">PeerPlay</div>
              <div className="brand-tag">Challenge accepted</div>
            </div>
          </Link>
        </div>
        <div className="card" style={{ padding: 24 }}>
          <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
          {subtitle && <p className="small" style={{ marginBottom: 18 }}>{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="center small muted" style={{ marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

export default function Login() {
  const { login, toast, adoptSession } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [duelBusy, setDuelBusy] = useState(false);

  /** Create a funded, unlocked sandbox account and sign straight in. */
  async function quickStart() {
    setDemoBusy(true);
    try {
      const data = await post('/auth/demo', {});
      await adoptSession(data);
      toast(`Signed in as ${data.credentials.username} - your wallet is funded with KSh 1,000`, 'success');
      navigate('/app', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDemoBusy(false);
    }
  }

  /** One click: this tab becomes player 1, a new tab becomes player 2. */
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

  async function useAccount(user, pass, label) {
    setIdentifier(user);
    setPassword(pass);
    setBusy(true);
    try {
      const data = await login(user, pass);
      toast(`Welcome back, ${data.user.username}`, 'success');
      navigate(location.state?.from || '/app', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await login(identifier.trim(), password);
      toast(`Welcome back, ${data.user.username}`, 'success');
      navigate(location.state?.from || '/app', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Sign in to PeerPlay"
      subtitle="Pick up where you left off - your wallet, your journey and your ranking are waiting."
      footer={
        <>
          New here? <Link to="/register">Create an account</Link>
        </>
      }
    >
      {location.state?.from && (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <strong>Sign in required.</strong> That page is only for signed-in players. Use the demo buttons below to get
          straight in - no form needed.
        </div>
      )}
      <form onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="identifier">Email or username</label>
          <input
            id="identifier"
            className="input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>
      </form>
      <div className="divider" />
      <div className="stack-sm">
        <button className="btn primary block" onClick={quickStart} disabled={demoBusy}>
          {demoBusy ? <span className="spinner" /> : '⚡ Play instantly as a demo player'}
        </button>
        <button className="btn ghost block" onClick={testDuel} disabled={duelBusy}>
          {duelBusy ? <span className="spinner" /> : '✦ Two-player test (opens a second tab)'}
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm grow" onClick={() => useAccount('arenaadmin', 'Admin123!', 'admin')}>
            Admin login
          </button>
          <button className="btn ghost sm grow" onClick={() => useAccount('wanjiruachieng', 'Player123!', 'player')}>
            Player login
          </button>
        </div>
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        <strong>Ready-made logins</strong>
        <div className="tiny" style={{ marginTop: 4, lineHeight: 1.8 }}>
          Player · <span className="mono">wanjiruachieng</span> / <span className="mono">Player123!</span>
          <br />
          Player · <span className="mono">brianodhiambo</span> / <span className="mono">Player123!</span>
          <br />
          Admin · <span className="mono">arenaadmin</span> / <span className="mono">Admin123!</span>
          <br />
          Any other name from the leaderboard works with <span className="mono">Player123!</span>
        </div>
      </div>
    </AuthShell>
  );
}
