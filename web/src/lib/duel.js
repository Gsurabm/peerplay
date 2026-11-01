import { post } from './api.js';

/**
 * Two-player test helper.
 *
 * A browser tab normally shares its session with every other tab of the same
 * origin (localStorage), so two tabs would be the SAME player and the server
 * (correctly) refuses to match a player with themselves.
 *
 * PeerPlay solves this with a tab-scoped session: the second player is created
 * as a sandbox demo account and handed to the new tab through a one-shot
 * ?join=<token> query parameter. The new tab stores that token in
 * sessionStorage, which is private to that tab, so both tabs are two different
 * players on the same machine.
 */

export const DEMO_STAKE_CENTS = 1000;

export function secondTabUrl(token, stake = DEMO_STAKE_CENTS) {
  return `/app/play?join=${encodeURIComponent(token)}&stake=${stake}&auto=1`;
}

/** Absolute URL - a blank tab has no reliable base to resolve a relative path against. */
export function absoluteUrl(path) {
  return `${window.location.origin}${path}`;
}

/**
 * Opens a blank tab immediately - popup blockers only allow window.open
 * while the user gesture is still active.
 */
export function openBlankTab() {
  try {
    return window.open('about:blank', '_blank');
  } catch {
    return null;
  }
}

export function pointTabAt(win, path) {
  if (!win) return false;
  try {
    win.location.replace(absoluteUrl(path));
    return true;
  } catch {
    return false;
  }
}

/** Creates a funded, verified sandbox player and returns the session payload. */
export function createDemoPlayer() {
  return post('/auth/demo', {});
}

/**
 * One click, two players, two tabs.
 * The current tab becomes player 1, the new tab becomes player 2.
 * Both queue at the same stake and the server pairs them.
 */
export async function startTestDuel({ stake = DEMO_STAKE_CENTS, adoptSession, navigate, toast }) {
  const win = openBlankTab();
  const [playerOne, playerTwo] = await Promise.all([createDemoPlayer(), createDemoPlayer()]);
  const url = secondTabUrl(playerTwo.token, stake);
  const opened = pointTabAt(win, url);
  await adoptSession(playerOne);
  navigate(`/app/play?stake=${stake}&auto=1`, { replace: true });
  toast(
    opened
      ? `Two players ready (${playerOne.credentials.username} vs ${playerTwo.credentials.username}) - matching now`
      : 'Pop-up blocked - open the second player from the link on the match page',
    opened ? 'success' : 'error',
  );
  return { opened, url, playerOne, playerTwo };
}
