import React, { useEffect, useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { get, post } from '../lib/api.js';
import { formatKSh, timeAgo } from '../lib/format.js';
import { Stat, Empty } from '../components/ui.jsx';

export default function Referrals() {
  const { user, toast } = useApp();
  const [stats, setStats] = useState(null);
  const [link, setLink] = useState('');

  const load = () => get('/referrals').then(setStats).catch(() => {});

  useEffect(() => {
    load();
  }, []);

  async function createInvite(channel) {
    try {
      const d = await post('/referrals/invite', { channel, source: 'referrals' });
      const url = `${window.location.origin}/join/${d.invite.token}`;
      setLink(url);
      if (navigator.clipboard) await navigator.clipboard.writeText(url);
      toast('Invite link copied to clipboard', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const code = stats?.code || user?.referral_code;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <h1>Referrals</h1>
        <p className="small" style={{ margin: 0 }}>
          Bring your people onto PeerPlay. Every invite is tracked, and you earn a bonus when your referral completes
          the 5-match onboarding journey.
        </p>
      </div>

      <div className="card">
        <div className="card-head"><h3>Your invite link</h3><span className="badge pink">Code {code}</span></div>
        <div className="row wrap">
          <input className="input mono grow" readOnly value={link || `${window.location.origin}/join/${code}`} />
        </div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <button className="btn ghost sm" onClick={() => createInvite('whatsapp')}>WhatsApp</button>
          <button className="btn ghost sm" onClick={() => createInvite('sms')}>SMS</button>
          <button className="btn ghost sm" onClick={() => createInvite('email')}>Email</button>
          <button className="btn ghost sm" onClick={() => createInvite('social')}>Social</button>
          <button className="btn primary sm" onClick={() => createInvite('copy')}>Copy link</button>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="Invites sent" value={stats?.invites_sent ?? 0} />
        <Stat label="Link clicks" value={stats?.clicks ?? 0} />
        <Stat label="Sign-ups" value={stats?.signups ?? 0} tone="cyan" />
        <Stat label="Bonus earned" value={formatKSh(stats?.earned_cents ?? 0)} tone="gold" />
      </div>

      <div className="card">
        <div className="card-head"><h3>Referred players</h3></div>
        {!stats?.referrals?.length ? (
          <Empty icon="✦">No referrals yet. Share your link to get started.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Player</th><th>Status</th><th>Source</th><th className="right">Joined</th></tr>
              </thead>
              <tbody>
                {stats.referrals.map((r) => (
                  <tr key={r.id}>
                    <td>{r.invitee}</td>
                    <td>
                      <span className={`badge ${r.status === 'rewarded' || r.status === 'qualified' ? 'lime' : 'grey'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="muted">{r.source || r.channel || 'direct'}</td>
                    <td className="right tiny dim">{timeAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
