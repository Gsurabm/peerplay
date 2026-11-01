import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { AuthShell } from './Login.jsx';
import { post } from '../lib/api.js';

const ID_TYPES = ['National ID', 'Passport', 'Driving licence', 'Birth certificate'];

export default function Register() {
  const { register, toast, adoptSession } = useApp();
  const navigate = useNavigate();
  const { token } = useParams();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    real_name: '',
    legal_id_type: 'National ID',
    legal_id_number: '',
    city: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    post('/auth/referral-click', { token, source: 'landing' }).catch(() => {});
  }, [token]);

  async function quickStart() {
    setDemoBusy(true);
    try {
      const data = await post('/auth/demo', {});
      await adoptSession(data);
      toast(`Signed in as ${data.credentials.username} - KSh 1,000 ready to stake`, 'success');
      navigate('/app', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDemoBusy(false);
    }
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  function validateStep1() {
    const errs = {};
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(form.username)) {
      errs.username = '3-16 characters: letters, numbers or underscore';
    }
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email)) errs.email = 'Enter a valid email address';
    if (!/^(\+?254|0)?\d{9}$/.test(form.phone.replace(/[\s()-]/g, ''))) errs.phone = 'Enter a valid Kenyan phone number (e.g. 0712345678)';
    if (form.password.length < 8) errs.password = 'At least 8 characters';
    if (form.password !== form.confirm) errs.confirm = 'Passwords do not match';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      const payload = {
        username: form.username.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        real_name: form.real_name.trim() || null,
        legal_id_type: form.legal_id_type,
        legal_id_number: form.legal_id_number.trim() || null,
        city: form.city.trim() || null,
      };
      if (token) payload.referral_code = token.toUpperCase();
      const data = await register(payload);
      toast(`Welcome to PeerPlay, ${data.user.username}!`, 'success');
      navigate('/verify', { replace: true, state: { verification: data.verification } });
    } catch (err) {
      setServerError(err.message);
      toast(err.message, 'error');
      if (err.code === 'conflict') setStep(1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={step === 1 ? 'Create your account' : 'Private identity details'}
      subtitle={
        step === 1
          ? 'Your username and stats are public. Your legal identity stays private and is used only for financial compliance.'
          : 'This information is encrypted at rest and never shown to other players. It unlocks large withdrawals.'
      }
      footer={
        <>
          Already registered? <Link to="/login">Sign in</Link>
        </>
      }
    >
      {serverError && (
        <div className="notice danger" style={{ marginBottom: 14 }}>
          <strong>Signup failed:</strong> {serverError}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn sm ghost" onClick={quickStart} disabled={demoBusy}>
              {demoBusy ? <span className="spinner" /> : 'Skip signup - play as a demo player'}
            </button>
          </div>
        </div>
      )}

      <div className="steps" style={{ marginBottom: 20 }}>
        <div className="step done"><div className="dot" />Account</div>
        <div className={`step ${step === 1 ? 'active' : 'done'}`}><div className="dot" />Identity</div>
        <div className="step"><div className="dot" />Verify</div>
      </div>

      {step === 1 ? (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="field">
            <label className="label">Username (public)</label>
            <input className="input" value={form.username} onChange={set('username')} placeholder="keen_challenger" />
            {errors.username && <div className="field-hint neg">{errors.username}</div>}
            <div className="field-hint">Visible on the leaderboard. Changeable once per month - old names stay on file.</div>
          </div>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" />
            {errors.email && <div className="field-hint neg">{errors.email}</div>}
          </div>
          <div className="field">
            <label className="label">Phone number</label>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder="0712 345 678" />
            {errors.phone && <div className="field-hint neg">{errors.phone}</div>}
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" value={form.password} onChange={set('password')} />
              {errors.password && <div className="field-hint neg">{errors.password}</div>}
            </div>
            <div className="field">
              <label className="label">Confirm password</label>
              <input className="input" type="password" value={form.confirm} onChange={set('confirm')} />
              {errors.confirm && <div className="field-hint neg">{errors.confirm}</div>}
            </div>
          </div>
          <button className="btn primary block" type="submit">Continue</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="field">
            <label className="label">Full legal name</label>
            <input className="input" value={form.real_name} onChange={set('real_name')} placeholder="As shown on your ID" />
            <div className="field-hint">Private. Used for withdrawals and compliance only.</div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label className="label">ID type</label>
              <select className="select" value={form.legal_id_type} onChange={set('legal_id_type')}>
                {ID_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">ID number</label>
              <input className="input" value={form.legal_id_number} onChange={set('legal_id_number')} placeholder="12345678" />
            </div>
          </div>
          <div className="field">
            <label className="label">City (optional)</label>
            <input className="input" value={form.city} onChange={set('city')} placeholder="Nairobi" />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary grow" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}
