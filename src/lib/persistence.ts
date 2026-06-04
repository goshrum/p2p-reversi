// Pure serialization/deserialization for resuming a local game.
// No DOM, no localStorage access, no side effects — fully unit-testable.
// Only single-device modes (hotseat, vs-computer) are ever persisted; P2P is not.

import {
  type Board,
  type Player,
  type Position,
  SIZE,
  isGameOver,
} from "../engine/reversi.ts";

/** Modes that can be saved and resumed. P2P is intentionally excluded. */
export type SavedMode = "hotseat" | "ai";

/** The serializable shape of a local game. Plain JSON-friendly data only. */
export interface SavedGame {
  /** Schema version, so future formats can be detected and rejected cleanly. */
  v: number;
  mode: SavedMode;
  board: Board;
  /** Side to move; never null here — finished games are not saved. */
  turn: Player;
  lastMove: Position | null;
  /** Move history as a list of pre-move snapshots, for undo. */
  history: SavedSnapshot[];
  /** AI search depth in vs-computer mode (the chosen difficulty). */
  aiDepth: number;
}

/** A single undo-stack entry, as stored. */
export interface SavedSnapshot {
  board: Board;
  turn: Player | null;
  lastMove: Position | null;
}

export const SAVE_VERSION = 1;

function isPlayer(x: unknown): x is Player {
  return x === "B" || x === "W";
}

function isCell(x: unknown): boolean {
  return x === null || x === "B" || x === "W";
}

function isBoard(x: unknown): x is Board {
  return Array.isArray(x) && x.length === SIZE * SIZE && x.every(isCell);
}

function isPosition(x: unknown): x is Position {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.row === "number" &&
    typeof p.col === "number" &&
    Number.isInteger(p.row) &&
    Number.isInteger(p.col) &&
    p.row >= 0 &&
    p.row < SIZE &&
    p.col >= 0 &&
    p.col < SIZE
  );
}

function isLastMove(x: unknown): x is Position | null {
  return x === null || isPosition(x);
}

function isSnapshot(x: unknown): x is SavedSnapshot {
  if (typeof x !== "object" || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    isBoard(s.board) &&
    (s.turn === null || isPlayer(s.turn)) &&
    isLastMove(s.lastMove)
  );
}

/**
 * Serialize the current local game into a plain object suitable for
 * `JSON.stringify`. Returns null when the game must NOT be saved: the mode is
 * not persistable, the game is already over, or there is no side to move.
 * Pure: does not touch storage and does not mutate its inputs.
 */
export function serializeGame(input: {
  mode: SavedMode;
  board: Board;
  turn: Player | null;
  lastMove: Position | null;
  history: SavedSnapshot[];
  aiDepth: number;
}): SavedGame | null {
  if (input.mode !== "hotseat" && input.mode !== "ai") return null;
  if (input.turn === null) return null;
  if (isGameOver(input.board)) return null;

  return {
    v: SAVE_VERSION,
    mode: input.mode,
    board: input.board.slice(),
    turn: input.turn,
    lastMove: input.lastMove,
    history: input.history.map((h) => ({
      board: h.board.slice(),
      turn: h.turn,
      lastMove: h.lastMove,
    })),
    aiDepth: input.aiDepth,
  };
}

/**
 * Validate and deserialize arbitrary parsed JSON back into a SavedGame.
 * Returns null for anything that is missing fields, has the wrong shape, an
 * unknown version, a corrupt board, a finished game, or no side to move — so
 * the caller can safely fall back to "no saved game". Pure and total: never
 * throws on bad input.
 */
export function deserializeGame(raw: unknown): SavedGame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (o.v !== SAVE_VERSION) return null;
  if (o.mode !== "hotseat" && o.mode !== "ai") return null;
  if (!isBoard(o.board)) return null;
  if (!isPlayer(o.turn)) return null;
  if (!isLastMove(o.lastMove)) return null;
  if (typeof o.aiDepth !== "number" || !Number.isFinite(o.aiDepth)) return null;
  if (!Array.isArray(o.history) || !o.history.every(isSnapshot)) return null;

  // A finished position is not resumable.
  if (isGameOver(o.board as Board)) return null;

  return {
    v: SAVE_VERSION,
    mode: o.mode,
    board: (o.board as Board).slice(),
    turn: o.turn,
    lastMove: o.lastMove,
    history: (o.history as SavedSnapshot[]).map((h) => ({
      board: h.board.slice(),
      turn: h.turn,
      lastMove: h.lastMove,
    })),
    aiDepth: o.aiDepth,
  };
}

/**
 * Parse a raw localStorage string into a SavedGame, or null when the string is
 * absent, not valid JSON, or fails validation. Convenience wrapper that never
 * throws.
 */
export function parseSavedGame(text: string | null): SavedGame | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return deserializeGame(parsed);
}
