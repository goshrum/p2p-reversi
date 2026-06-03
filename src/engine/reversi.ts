// Pure Reversi/Othello engine. No DOM, no side effects, fully deterministic.

export type Player = "B" | "W";
export type Cell = Player | null;
/** Board is a flat array of 64 cells, row-major (index = row * 8 + col). */
export type Board = Cell[];

export const SIZE = 8;

export interface Position {
  row: number;
  col: number;
}

export interface Score {
  B: number;
  W: number;
}

/** The 8 directions: N, NE, E, SE, S, SW, W, NW. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
];

export function index(row: number, col: number): number {
  return row * SIZE + col;
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

export function opponent(player: Player): Player {
  return player === "B" ? "W" : "B";
}

/** Create the standard Othello starting board. Black moves first. */
export function createInitialBoard(): Board {
  const board: Board = new Array(SIZE * SIZE).fill(null);
  board[index(3, 3)] = "W";
  board[index(3, 4)] = "B";
  board[index(4, 3)] = "B";
  board[index(4, 4)] = "W";
  return board;
}

/** Return a shallow copy of the board (cells are primitives, so this is a deep copy). */
export function cloneBoard(board: Board): Board {
  return board.slice();
}

/**
 * For a given move, compute all opponent discs that would be flipped.
 * Returns an array of indices to flip (empty if the move is illegal).
 */
export function flipsForMove(board: Board, player: Player, pos: Position): number[] {
  const { row, col } = pos;
  if (!inBounds(row, col)) return [];
  if (board[index(row, col)] !== null) return [];

  const foe = opponent(player);
  const flips: number[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const lineFlips: number[] = [];
    let r = row + dr;
    let c = col + dc;
    // Walk over a contiguous run of opponent discs.
    while (inBounds(r, c) && board[index(r, c)] === foe) {
      lineFlips.push(index(r, c));
      r += dr;
      c += dc;
    }
    // The run must be terminated by one of our own discs (and be non-empty).
    if (lineFlips.length > 0 && inBounds(r, c) && board[index(r, c)] === player) {
      flips.push(...lineFlips);
    }
  }

  return flips;
}

/** True if the move is legal for the given player. */
export function isLegalMove(board: Board, player: Player, pos: Position): boolean {
  return flipsForMove(board, player, pos).length > 0;
}

/** All legal moves for a player on the given board. */
export function legalMoves(board: Board, player: Player): Position[] {
  const moves: Position[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (board[index(row, col)] !== null) continue;
      if (flipsForMove(board, player, { row, col }).length > 0) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

/**
 * Apply a move, returning a NEW board with the disc placed and all flips applied.
 * Throws if the move is illegal — callers must validate first or catch.
 */
export function applyMove(board: Board, player: Player, pos: Position): Board {
  const flips = flipsForMove(board, player, pos);
  if (flips.length === 0) {
    throw new Error(`Illegal move for ${player} at (${pos.row},${pos.col})`);
  }
  const next = cloneBoard(board);
  next[index(pos.row, pos.col)] = player;
  for (const i of flips) {
    next[i] = player;
  }
  return next;
}

/** True if the player has no legal moves and therefore must pass. */
export function mustPass(board: Board, player: Player): boolean {
  return legalMoves(board, player).length === 0;
}

/**
 * The game is over when neither player has a legal move
 * (board full, or both sides stuck).
 */
export function isGameOver(board: Board): boolean {
  return mustPass(board, "B") && mustPass(board, "W");
}

/** Count discs for each player. */
export function score(board: Board): Score {
  const s: Score = { B: 0, W: 0 };
  for (const cell of board) {
    if (cell === "B") s.B++;
    else if (cell === "W") s.W++;
  }
  return s;
}

/** Winner of a finished (or current) board: "B", "W", or "draw". */
export function winner(board: Board): Player | "draw" {
  const s = score(board);
  if (s.B > s.W) return "B";
  if (s.W > s.B) return "W";
  return "draw";
}

/**
 * Determine the next player to move given the player who just moved.
 * Returns the next player, or null if the game is over.
 * Handles forced passes automatically.
 */
export function nextPlayer(board: Board, justMoved: Player): Player | null {
  const foe = opponent(justMoved);
  if (!mustPass(board, foe)) return foe;
  if (!mustPass(board, justMoved)) return justMoved;
  return null; // game over
}

/** A snapshot of the game position, used for an undo history stack. */
export interface GameSnapshot {
  board: Board;
  turn: Player | null;
  lastMove: Position | null;
}

/**
 * Pop the most recent snapshot off a history stack, returning the restored
 * position and the remaining history. Pure: does not mutate its inputs.
 *
 * When `count` snapshots should be undone at once (e.g. undoing both the AI's
 * reply and the player's move in vs-computer mode), pass `count > 1`. The number
 * of pops is clamped to the available history length.
 *
 * Returns `null` when there is nothing to undo.
 */
export function undo(
  history: ReadonlyArray<GameSnapshot>,
  count = 1,
): { restored: GameSnapshot; history: GameSnapshot[] } | null {
  if (history.length === 0) return null;
  const pops = Math.min(Math.max(count, 1), history.length);
  const remaining = history.slice(0, history.length - pops);
  const restored = history[history.length - pops];
  return { restored, history: remaining };
}
