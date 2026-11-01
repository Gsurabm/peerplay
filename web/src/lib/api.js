const TOKEN_KEY = 'peerplay.token';
const TAB_TOKEN_KEY = 'peerplay.tabToken';

function safeGet(store, key) {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store, key, value) {
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Token used by THIS tab.
 * A tab-scoped token (sessionStorage) wins over the browser-wide one
 * (localStorage). That is what lets a single browser host two different
 * players at once - e.g. one normal tab and one "second player" tab.
 */
export function getToken() {
  return safeGet(window.sessionStorage, TAB_TOKEN_KEY) || safeGet(window.localStorage, TOKEN_KEY);
}

/** The browser-wide session (the one a normal tab uses). */
export function getAccountToken() {
  return safeGet(window.localStorage, TOKEN_KEY);
}

export function setToken(token) {
  safeSet(window.localStorage, TOKEN_KEY, token);
  if (!token) safeSet(window.sessionStorage, TAB_TOKEN_KEY, null);
}

export function setTabToken(token) {
  safeSet(window.sessionStorage, TAB_TOKEN_KEY, token);
}

export function clearTabToken() {
  safeSet(window.sessionStorage, TAB_TOKEN_KEY, null);
}

export function hasTabToken() {
  return Boolean(safeGet(window.sessionStorage, TAB_TOKEN_KEY));
}

/* ------------------------------------------------- device fingerprinting */

let persistentId = null;

function getPersistentId() {
  if (persistentId) return persistentId;
  try {
    persistentId = localStorage.getItem('peerplay.device');
    if (!persistentId) {
      persistentId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem('peerplay.device', persistentId);
    }
  } catch {
    persistentId = 'no-storage';
  }
  return persistentId;
}

/** Coarse, privacy-respecting signals used as ONE risk input on the server. */
export function deviceSignals() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const screen = typeof window !== 'undefined' && window.screen ? window.screen : {};
  return {
    ua: nav.userAgent || '',
    platform: nav.platform || '',
    language: nav.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screen: `${screen.width || 0}x${screen.height || 0}x${screen.colorDepth || 0}`,
    colorDepth: screen.colorDepth || 0,
    deviceMemory: nav.deviceMemory || 0,
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    persistentId: getPersistentId(),
  };
}

/* ------------------------------------------------------------------ fetch */

export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  const token = getToken();
  const finalHeaders = {
    'x-device-signals': JSON.stringify(deviceSignals()),
    ...(body && !raw ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const res = await fetch(`/api${path}`, {
    method,
    headers: finalHeaders,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
    signal,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message =
      data?.error ||
      (res.status === 403 || res.status === 401
        ? 'The preview gateway blocked this request. Open PeerPlay from the preview link, or use one of the demo logins.'
        : `Request failed (${res.status})`);
    throw new ApiError(message, res.status, data?.code, data?.details);
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });

export function uploadFile(path, formData) {
  return api(path, { method: 'POST', body: formData, raw: true });
}
