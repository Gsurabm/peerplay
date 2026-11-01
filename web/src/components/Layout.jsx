import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import Avatar from './Avatar.jsx';
import { formatKSh } from '../lib/format.js';

const ADMIN_ROLES = ['super_admin', 'ops_admin', 'finance_admin', 'mod_admin'];

const NAV = [
  { to: '/app', icon: '⌂', label: 'Dashboard', end: true },
  { to: '/app/play', icon: '✦', label: 'Play' },
  { to: '/app/wallet', icon: '◈', label: 'Wallet' },
  { to: '/app/leaderboards', icon: '★', label: 'Leaderboards' },
  { to: '/app/friends', icon: '◉', label: 'Friends' },
  { to: '/app/referrals', icon: '✦', label: 'Referrals' },
];

export default function Layout({ children }) {
  const { user, wallet, unread, logout, markNotificationsRead } = useApp();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = ADMIN_ROLES.includes(user?.role);

  const nav = (
    <>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="icon">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
      <div className="nav-section">Account</div>
      <NavLink to="/app/notifications" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon">◔</span>
        Notifications
        {unread > 0 && <span className="pill">{unread > 99 ? '99+' : unread}</span>}
      </NavLink>
      <NavLink to={`/app/profile/${user?.username || ''}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon">◉</span>
        Profile
      </NavLink>
      <NavLink to="/app/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
        <span className="icon">⚙</span>
        Settings
      </NavLink>
      {isAdmin && (
        <>
          <div className="nav-section">Administration</div>
          <NavLink to="/app/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="icon">◈</span>
            Admin console
          </NavLink>
        </>
      )}
    </>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <div className="brand-name">PeerPlay</div>
            <div className="brand-tag">Challenge accepted</div>
          </div>
        </div>
        {nav}
        <div className="grow" />
        <button
          type="button"
          className="nav-item"
          style={{ border: '1px solid var(--line)' }}
          onClick={() => {
            logout();
            navigate('/');
          }}
        >
          <span className="icon">↩</span>
          Sign out
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <NavLink to="/app" className="topbar-brand">
            <span className="brand-mark">P</span>
            <span className="brand-name" style={{ fontSize: '1rem' }}>PeerPlay</span>
          </NavLink>

          <div className="grow" />

          <button
            type="button"
            className="balance-pill"
            onClick={() => navigate('/app/wallet')}
            title="Open wallet"
          >
            <span>◈</span>
            {formatKSh(wallet?.balance_cents || 0)}
          </button>

          <NavLink to="/app/notifications" className="btn ghost sm bell" onClick={markNotificationsRead}>
            ◔
            {unread > 0 && <span className="count">{unread > 9 ? '9+' : unread}</span>}
          </NavLink>

          <div style={{ position: 'relative' }}>
            <button type="button" className="btn ghost sm" onClick={() => setMenuOpen((v) => !v)}>
              <Avatar src={user?.avatar_url} seed={user?.avatar_seed} size={28} />
              <span className="nowrap topbar-user-name">{user?.username}</span>
            </button>
            {menuOpen && (
              <div
                className="card"
                style={{
                  position: 'absolute', right: 0, top: 42, width: 220, zIndex: 50, padding: 10,
                  background: 'rgba(16,24,39,0.98)',
                }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div className="small muted" style={{ padding: '4px 6px' }}>
                  {user?.email}
                </div>
                <div className="divider" />
                <button
                  type="button"
                  className="nav-item"
                  style={{ width: '100%' }}
                  onClick={() => navigate(`/app/profile/${user?.username}`)}
                >
                  <span className="icon">◉</span> My profile
                </button>
                <button
                  type="button"
                  className="nav-item"
                  style={{ width: '100%' }}
                  onClick={() => navigate('/app/settings')}
                >
                  <span className="icon">⚙</span> Settings
                </button>
                <button
                  type="button"
                  className="nav-item"
                  style={{ width: '100%' }}
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  <span className="icon">↩</span> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content wide">{children}</main>
      </div>

      <nav className="mobile-nav">
        <NavLink to="/app" end>
          <span className="icon">⌂</span>Home
        </NavLink>
        <NavLink to="/app/play">
          <span className="icon">✦</span>Play
        </NavLink>
        <NavLink to="/app/wallet">
          <span className="icon">◈</span>Wallet
        </NavLink>
        <NavLink to="/app/leaderboards">
          <span className="icon">★</span>Ranks
        </NavLink>
        <NavLink to="/app/notifications">
          <span className="icon">◔</span>Alerts
        </NavLink>
      </nav>
    </div>
  );
}
