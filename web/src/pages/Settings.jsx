import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { get, post, uploadFile } from '../lib/api.js';
import { avatarArt } from '../components/Avatar.jsx';
import { Empty } from '../components/ui.jsx';

export default function Settings() {
  const { user, setUser, toast, refreshJourney } = useApp();
  const fileRef = useRef(null);
  const [policy, setPolicy] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedSeed, setSelectedSeed] = useState(user?.avatar_seed ?? 0);
  const [identity, setIdentity] = useState({ real_name: '', legal_id_type: 'National ID', legal_id_number: '', city: '' });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' });
  const [username, setUsername] = useState('');

  useEffect(() => {
    get('/profile/me').then((d) => {
      setPolicy(d.username_policy);
      setHistory(d.username_history || []);
      setIdentity((i) => ({ ...i, real_name: '', city: d.user.city || '' }));
    }).catch(() => {});
  }, []);

  async function changeUsername() {
    try {
      const d = await post('/profile/username', { username: username.trim() });
      setUser({ ...user, username: d.user.username });
      setHistory(d.username_history || []);
      setPolicy((p) => ({ ...p, can_change: false }));
      toast('Username updated - the old name stays on file for security', 'success');
      setUsername('');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function pickLibrary(seed) {
    setSelectedSeed(seed);
    try {
      const d = await post('/profile/avatar/library', { seed });
      setUser({ ...user, avatar_type: d.avatar_type, avatar_seed: d.avatar_seed, avatar_url: null });
      toast('Avatar updated', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast('Avatars must be JPG or PNG', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('Avatar must be smaller than 2MB', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const d = await uploadFile('/profile/avatar/upload', fd);
      setUser({ ...user, avatar_type: d.avatar_type, avatar_url: d.avatar_url });
      toast('Avatar uploaded', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function submitIdentity() {
    try {
      const d = await post('/auth/identity', identity);
      setUser({ ...user, identity_verified: d.verified });
      toast('Identity details stored privately', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function changePassword() {
    try {
      await post('/auth/change-password', passwords);
      toast('Password updated', 'success');
      setPasswords({ current_password: '', new_password: '' });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="small" style={{ margin: 0 }}>Your public identity, private identity and security settings.</p>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h3>Public identity</h3></div>
          <div className="field">
            <label className="label">Username</label>
            <div className="row">
              <input className="input mono grow" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={user?.username} disabled={policy && !policy.can_change} />
              <button className="btn ghost" disabled={!policy?.can_change || !username.trim()} onClick={changeUsername}>Change</button>
            </div>
            <div className="field-hint">
              {policy?.can_change
                ? 'Usernames are unique and can be changed once per month. Previous names stay on file for fraud investigation.'
                : `You can change your username again after ${new Date(policy?.next_change_available_at || Date.now()).toLocaleDateString('en-KE')}.`}
            </div>
          </div>

          <div className="divider" />
          <div className="card-title" style={{ marginBottom: 10 }}>Avatar</div>
          <div className="avatar-library">
            {Array.from({ length: 12 }, (_, i) => (
              <button
                key={i}
                type="button"
                className={`pick ${user?.avatar_type === 'library' && user?.avatar_seed === i ? 'selected' : ''}`}
                onClick={() => pickLibrary(i)}
                style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', background: 'none', padding: 0 }}
              >
                {avatarArt(i)}
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn ghost sm" onClick={() => fileRef.current?.click()}>Upload your own (JPG/PNG)</button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={uploadAvatar} />
          </div>
          <div className="field-hint">Maximum 2MB. Platform avatars are hand-built geometry - no AI-generated imagery.</div>

          {history.length > 0 && (
            <>
              <div className="divider" />
              <div className="card-title" style={{ marginBottom: 8 }}>Previous usernames</div>
              <div className="stack-sm small muted">
                {history.map((h) => (
                  <div className="row" key={`${h.username}-${h.changed_at}`}>
                    <span className="grow mono">{h.username}</span>
                    <span className="tiny dim">{h.reason}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Private identity</h3>
              <span className={`badge ${user?.identity_verified ? 'lime' : 'gold'}`}>
                {user?.identity_verified ? 'Verified' : 'Not verified'}
              </span>
            </div>
            <p className="small">Never shown to other players. Required for large withdrawals and payouts.</p>
            <div className="field">
              <label className="label">Full legal name</label>
              <input className="input" value={identity.real_name} onChange={(e) => setIdentity({ ...identity, real_name: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label className="label">ID type</label>
                <select className="select" value={identity.legal_id_type} onChange={(e) => setIdentity({ ...identity, legal_id_type: e.target.value })}>
                  {['National ID', 'Passport', 'Driving licence', 'Birth certificate'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="label">ID number</label>
                <input className="input" value={identity.legal_id_number} onChange={(e) => setIdentity({ ...identity, legal_id_number: e.target.value })} />
              </div>
            </div>
            <button className="btn primary" onClick={submitIdentity}>Save identity details</button>
          </div>

          <div className="card">
            <div className="card-head"><h3>Password</h3></div>
            <div className="field">
              <label className="label">Current password</label>
              <input className="input" type="password" value={passwords.current_password} onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">New password</label>
              <input className="input" type="password" value={passwords.new_password} onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })} />
            </div>
            <button className="btn ghost" onClick={changePassword}>Update password</button>
          </div>

          <div className="card">
            <div className="card-head"><h3>Security signals</h3></div>
            <div className="kv"><span className="k">Email verified</span><span className="v">{user?.email_verified ? '✓' : 'Pending'}</span></div>
            <div className="kv"><span className="k">Phone verified</span><span className="v">{user?.phone_verified ? '✓' : 'Pending'}</span></div>
            <div className="kv"><span className="k">Device fingerprint</span><span className="v">Active</span></div>
            <div className="kv"><span className="k">Risk score</span><span className="v mono">{user?.risk_score ?? 0}</span></div>
            <div className="notice" style={{ marginTop: 12 }}>
              Device fingerprinting is one signal among many for fraud detection - it never blocks an account on its own.
            </div>
            <button
              className="btn ghost sm block"
              style={{ marginTop: 12 }}
              onClick={async () => {
                try {
                  await post('/auth/resend-verification', { channel: 'email' });
                  toast('Verification code resent', 'success');
                } catch (err) {
                  toast(err.message, 'error');
                }
              }}
            >
              Resend verification email
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
