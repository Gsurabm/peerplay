import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { AuthShell } from './Login.jsx';
import { post, get } from '../lib/api.js';

export default function Verify() {
  const { user, refreshJourney, toast, refreshWallet } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const initial = location.state?.verification || {};
  const [emailCode, setEmailCode] = useState(initial.email_code || '');
  const [phoneCode, setPhoneCode] = useState(initial.phone_code || '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState({});

  async function verify(channel, code) {
    setBusy(true);
    try {
      await post('/auth/verify', { channel, code: code.trim() });
      toast(`${channel === 'email' ? 'Email' : 'Phone'} verified`, 'success');
      await refreshJourney();
      await refreshWallet();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function resend(channel) {
    try {
      const data = await post('/auth/resend-verification', { channel });
      setSent({ ...sent, [channel]: data.code });
      toast(`New ${channel} code issued`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function finish() {
    const data = await get('/auth/me');
    if (data.user.journey_state === 'not_started' && !data.user.tutorial_done) {
      navigate('/app/play?tutorial=1', { replace: true });
    } else {
      navigate('/app', { replace: true });
    }
  }

  const cards = [
    {
      channel: 'email',
      label: 'Email address',
      value: user?.email,
      code: emailCode,
      setCode: setEmailCode,
      done: user?.email_verified,
    },
    {
      channel: 'phone',
      label: 'Phone number',
      value: user?.phone,
      code: phoneCode,
      setCode: setPhoneCode,
      done: user?.phone_verified,
    },
  ];

  return (
    <AuthShell
      title="Verify your account"
      subtitle="Verification raises your trust score and unlocks larger withdrawals. Sandbox mode shows codes here - production sends them by email and SMS."
    >
      <div className="stack">
        {cards.map((c) => (
          <div className="card pad-sm" key={c.channel}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div>
                <div className="small muted">{c.label}</div>
                <div className="mono small">{c.value || 'Not provided'}</div>
              </div>
              <span className={`badge ${c.done ? 'lime' : 'grey'}`}>{c.done ? 'Verified' : 'Pending'}</span>
            </div>
            {!c.done && (
              <>
                <div className="row">
                  <input
                    className="input mono"
                    value={c.code}
                    onChange={(e) => c.setCode(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                  />
                  <button className="btn primary" disabled={busy} onClick={() => verify(c.channel, c.code)}>
                    Verify
                  </button>
                </div>
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="tiny dim">
                    {sent[c.channel] ? `New code: ${sent[c.channel]}` : 'Need a new code?'}
                  </span>
                  <button type="button" className="btn ghost sm" onClick={() => resend(c.channel)}>
                    Resend
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        <button className="btn primary block" onClick={finish}>
          Continue to PeerPlay
        </button>
        <p className="tiny dim center" style={{ margin: 0 }}>
          Prefer to do this later? <Link to="/app" onClick={(e) => { e.preventDefault(); finish(); }}>Skip for now</Link>
        </p>
      </div>
    </AuthShell>
  );
}
