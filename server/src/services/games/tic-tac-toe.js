/**
 * Classic 3x3 Tic-Tac-Toe - the first PeerPlay game.
 * The server is the sole authority: legal moves, turn order, winning lines and
 * draws are all computed here, never trusted from the client.
 */

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function findWin(board, seat) {
  for (const line of WIN_LINES) {
    if (line.every((i) => board[i] === seat)) return line;
  }
  return null;
}

export const ticTacToe = {
  slug: 'tic-tac-toe',
  name: 'Tic-Tac-Toe',
  tagline: 'Classic 3×3. Read the board, close the line.',
  description:
    'Two players, one board, 15 seconds a move. Win with a horizontal, vertical or diagonal line. Play the board or play the clock - both win games.',
  minPlayers: 2,
  maxPlayers: 2,
  turnSec: 15,
  rules: [
    'Players are X and O. X moves first.',
    'Take turns placing your mark in an empty square.',
    '15 seconds per move - running out of time loses the match.',
    'A horizontal, vertical or diagonal line of three wins instantly.',
    'A full board with no line is a draw. Three draws cancel the match and the anti-draw-farming penalty applies.',
  ],

  initialState() {
    return { board: Array(9).fill(null), moves: [] };
  },

  legalMoves(state) {
    const out = [];
    state.board.forEach((v, i) => {
      if (v === null) out.push(i);
    });
    return out;
  },

  applyMove(state, seat, cell) {
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
      return { ok: false, error: 'invalid_cell' };
    }
    if (state.board[cell] !== null) {
      return { ok: false, error: 'cell_taken' };
    }
    const board = [...state.board];
    board[cell] = seat;
    const line = findWin(board, seat);
    const full = board.every((v) => v !== null);
    const nextState = { board, moves: [...state.moves, { cell, seat }] };

    if (line) return { ok: true, state: nextState, result: { outcome: 'win', winner: seat, line } };
    if (full) return { ok: true, state: nextState, result: { outcome: 'draw' } };
    return { ok: true, state: nextState, result: { outcome: 'ongoing' } };
  },

  /** Serialise for the client - includes everything needed to render the board. */
  formatState(state, { xId, oId } = {}) {
    return {
      board: state.board,
      moves: state.moves,
      seats: { x: xId, o: oId },
      legal: this.legalMoves(state),
    };
  },
};

export { WIN_LINES };
