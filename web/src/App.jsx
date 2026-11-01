import React from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { useApp } from './state/AppContext.jsx';
import Layout from './components/Layout.jsx';
import { Toasts, Spinner } from './components/ui.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Verify from './pages/Verify.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Play from './pages/Play.jsx';
import MatchScreen from './pages/MatchScreen.jsx';
import Wallet from './pages/Wallet.jsx';
import Leaderboards from './pages/Leaderboards.jsx';
import Friends from './pages/Friends.jsx';
import Profile from './pages/Profile.jsx';
import Notifications from './pages/Notifications.jsx';
import Referrals from './pages/Referrals.jsx';
import Settings from './pages/Settings.jsx';
import AdminConsole from './pages/AdminConsole.jsx';
import NotFound from './pages/NotFound.jsx';

const ADMIN_ROLES = ['super_admin', 'ops_admin', 'finance_admin', 'mod_admin'];

function RequireAuth() {
  const { user, booting } = useApp();
  const location = useLocation();
  if (booting) return <Spinner label="Loading PeerPlay" />;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function RequireAdmin() {
  const { user } = useApp();
  if (!ADMIN_ROLES.includes(user?.role)) return <Navigate to="/app" replace />;
  return <Outlet />;
}

export default function App() {
  const { toasts } = useApp();
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/join/:token" element={<Register />} />
        <Route path="/verify" element={<Verify />} />

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<Dashboard />} />
          <Route path="/app/play" element={<Play />} />
          <Route path="/app/match/:id" element={<MatchScreen />} />
          <Route path="/app/wallet" element={<Wallet />} />
          <Route path="/app/leaderboards" element={<Leaderboards />} />
          <Route path="/app/friends" element={<Friends />} />
          <Route path="/app/notifications" element={<Notifications />} />
          <Route path="/app/referrals" element={<Referrals />} />
          <Route path="/app/profile/:username" element={<Profile />} />
          <Route path="/app/settings" element={<Settings />} />
          <Route element={<RequireAdmin />}>
            <Route path="/app/admin" element={<AdminConsole />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toasts toasts={toasts} />
    </>
  );
}
