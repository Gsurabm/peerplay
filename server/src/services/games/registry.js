import { ticTacToe } from './tic-tac-toe.js';

const registry = new Map();

export function registerGame(game) {
  registry.set(game.slug, game);
  return game;
}

export function getGame(slug) {
  return registry.get(slug) || null;
}

export function listGames() {
  return [...registry.values()].map((g) => ({
    slug: g.slug,
    name: g.name,
    tagline: g.tagline,
    description: g.description,
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    turnSec: g.turnSec,
    rules: g.rules,
  }));
}

registerGame(ticTacToe);
