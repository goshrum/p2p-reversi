// Pure AI opponent for vs-computer mode. Deterministic given a board + player.

import {
  type Board,
  type Player,
  type Position,
  SIZE,
  index,
  legalMoves,
  applyMove,
  opponent,
  mustPass,
  score,
} from "./reversi.ts";

/**
 * Positional weights. Corners are gold; squares adjacent to corners (X/C squares)
 * are dangerous because they hand the corner to the opponent. Standard heuristic.
 */
const WEIGHTS: ReadonlyArray<ReadonlyArray<number>> = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

/** Heuristic evaluation from the perspective of `me`. Higher is better for `me`. */
export function evaluate(board: Board, me: Player): number {
  const foe = opponent(me);
  let positional = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = board[index(r, c)];
      if (cell === me) positional += WEIGHTS[r][c];
      else if (cell === foe) positional -= WEIGHTS[r][c];
    }
  }

  // Mobility: having more options than the opponent is good.
  const myMoves = legalMoves(board, me).length;
  const foeMoves = legalMoves(board, foe).length;
  let mobility = 0;
  if (myMoves + foeMoves !== 0) {
    mobility = (100 * (myMoves - foeMoves)) / (myMoves + foeMoves);
  }

  // Disc differential matters most near the endgame.
  const s = score(board);
  const total = s.B + s.W;
  const discDiff = me === "B" ? s.B - s.W : s.W - s.B;
  const endgameWeight = total > 54 ? 10 : 1;

  return positional + 2 * mobility + endgameWeight * discDiff;
}

/**
 * Negamax with alpha-beta pruning. Returns the value for the side to move
 * (`toMove`) at this node, using the negamax convention (negate at each level).
 */
function negamax(
  board: Board,
  toMove: Player,
  depth: number,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) {
    return evaluate(board, toMove);
  }

  const moves = legalMoves(board, toMove);

  if (moves.length === 0) {
    // No move for the side to move.
    if (mustPass(board, opponent(toMove))) {
      // Both stuck -> game over. Terminal value for side to move.
      return evaluate(board, toMove);
    }
    // Forced pass: hand turn to opponent, negate as usual.
    return -negamax(board, opponent(toMove), depth - 1, -beta, -alpha);
  }

  let best = -Infinity;
  for (const move of moves) {
    const child = applyMove(board, toMove, move);
    const value = -negamax(child, opponent(toMove), depth - 1, -beta, -alpha);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // prune
  }
  return best;
}

/**
 * Choose the best move for `player` searching to the given depth.
 * Returns null if there are no legal moves (caller should pass).
 * Deterministic: ties broken by move order (row-major), so same input -> same output.
 */
export function chooseMove(board: Board, player: Player, depth = 3): Position | null {
  const moves = legalMoves(board, player);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  let bestMove: Position = moves[0];
  let bestValue = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of moves) {
    const child = applyMove(board, player, move);
    // After our move it's the opponent's turn; negate their best value.
    const value = -negamax(child, opponent(player), depth - 1, -beta, -alpha);
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
    if (bestValue > alpha) alpha = bestValue;
  }

  return bestMove;
}
