import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, setToken, getToken, setTabToken, clearTabToken, hasTabToken } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [wallet, setWallet] = useState({ balance_cents: 0, available_cents: 0, locked_cents: 0 });
  const [walletSummary, setWalletSummary] = useState(null);
  const [journey, setJourney] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [booting, setBooting] = useState(true);
  const [serverConfig, setServerConfig] = useState(null);
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  const toastId = useRef(0);

  const toast = useCallback((message, type = 'info', ttl = 4200) => {
    toastId.current += 1;
    const id = toastId.current;
    // keep the stack short - only the newest few messages stay on screen
    setToasts((list) => [...list, { id, message, type }].slice(-3));
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ttl);
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const data = await get('/wallet');
      setWallet(data.wallet);
      setWalletSummary(data.summary);
      return data.wallet;
    } catch {
      return null;
    }
  }, []);

  const refreshJourney = useCallback(async () => {
    try {
      const data = await get('/auth/me');
      setUser(data.user);
      setJourney(data.journey);
      setWallet(data.wallet);
      setWalletSummary(data.wallet_summary);
      return data;
    } catch {
      return null;
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await get('/notifications?limit=40');
      setNotifications(data.notifications);
      setUnread(data.unread);
    } catch {
      /* ignore */
    }
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const cfg = await get('/config');
      setServerConfig(cfg);
    } catch {
      /* ignore */
    }
    // A "second player" tab arrives with ?join=<token>. It is stored in
    // sessionStorage (tab scoped) so this browser can host two players.
    try {
      const params = new URLSearchParams(window.location.search);
      const joinToken = params.get('join');
      if (joinToken) {
        setTabToken(joinToken);
        params.delete('join');
        const qs = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      }
    } catch {
      /* ignore */
    }
    if (!getToken()) {
      setBooting(false);
      return;
    }
    try {
      const data = await get('/auth/me');
      setUser(data.user);
      setJourney(data.journey);
      setWallet(data.wallet);
      setWalletSummary(data.wallet_summary);
      connect();
      await refreshNotifications();
    } catch {
      if (hasTabToken()) clearTabToken();
      else setToken(null);
    } finally {
      setBooting(false);
    }
  }, [refreshNotifications]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  /* ------------------------------------------------------- realtime link */
  const connect = useCallback(() => {
    if (socketRef.current) return socketRef.current;
    const instance = connectSocket();
    if (!instance) return null;
    socketRef.current = instance;
    setSocket(instance);

    instance.on('notification', (payload) => {
      setNotifications((list) => [{ ...payload, read: 0 }, ...list].slice(0, 60));
      setUnread((n) => n + 1);
      toast(payload.title, payload.type === 'security' ? 'error' : 'info');
    });

    instance.on('wallet', (payload) => {
      if (typeof payload?.balance_cents === 'number') {
        setWallet((w) => ({ ...w, balance_cents: payload.balance_cents }));
      }
      refreshWallet();
    });

    instance.on('match_invite', (payload) => {
      toast(payload?.title || 'Match update', 'info');
    });

    instance.on('your_turn', () => {
      /* surfaced by the match screen */
    });

    // A queued player is pulled straight into the match once an opponent is found.
    instance.on('match_found', (payload) => {
      if (!payload?.match_id) return;
      toast('Opponent found - match starting', 'success');
      navigate(`/app/match/${payload.match_id}`);
    });

    return instance;
  }, [refreshWallet, toast, navigate]);

  useEffect(() => {
    if (!user) {
      disconnectSocket();
      socketRef.current = null;
      setSocket(null);
      return undefined;
    }
    connect();
    return undefined;
  }, [user, connect]);

  const login = useCallback(
    async (identifier, password) => {
      const data = await post('/auth/login', { identifier, password });
      setToken(data.token);
      setUser(data.user);
      connect();
      setJourney(data.journey);
      setWallet(data.wallet);
      await refreshNotifications();
      return data;
    },
    [refreshNotifications, connect],
  );

  const register = useCallback(async (payload) => {
    const data = await post('/auth/register', payload);
    setToken(data.token);
    setUser(data.user);
    setWallet(data.wallet);
    return data;
  }, [connect]);

  /**
   * Adopt a session issued elsewhere (e.g. the sandbox demo account).
   * `tab: true` keeps the session inside this tab only (sessionStorage),
   * so a second tab can play as a different player in the same browser.
   */
  const adoptSession = useCallback(
    async (data, opts = {}) => {
      if (opts.tab) setTabToken(data.token);
      else setToken(data.token);
      setUser(data.user);
      setJourney(data.journey || null);
      setWallet(data.wallet || { balance_cents: 0, available_cents: 0, locked_cents: 0 });
      if (data.wallet_summary) setWalletSummary(data.wallet_summary);
      connect();
      await refreshNotifications();
      return data;
    },
    [connect, refreshNotifications],
  );

  const logout = useCallback(() => {
    clearTabToken();
    setToken(null);
    disconnectSocket();
    socketRef.current = null;
    setSocket(null);
    setUser(null);
    setJourney(null);
    setWallet({ balance_cents: 0, available_cents: 0, locked_cents: 0 });
    setNotifications([]);
    setUnread(0);
  }, []);

  const markNotificationsRead = useCallback(async () => {
    try {
      await post('/notifications/read', {});
    } catch {
      /* ignore */
    }
    setUnread(0);
    setNotifications((list) => list.map((n) => ({ ...n, read: 1 })));
  }, []);

  const value = useMemo(
    () => ({
      user,
      setUser,
      wallet,
      setWallet,
      walletSummary,
      setWalletSummary,
      journey,
      setJourney,
      notifications,
      unread,
      toasts,
      setToasts,
      toast,
      booting,
      serverConfig,
      login,
      register,
      adoptSession,
      logout,
      refreshWallet,
      refreshJourney,
      refreshNotifications,
      markNotificationsRead,
      socket,
    }),
    [
      user, wallet, walletSummary, journey, notifications, unread, toasts, toast, booting,
      serverConfig, login, register, adoptSession, logout, refreshWallet, refreshJourney, refreshNotifications,
      markNotificationsRead, socket,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
