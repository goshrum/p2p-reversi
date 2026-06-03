// Message protocol exchanged over the WebRTC data channel.
// Pure, DOM-free, and fully testable. Includes a move-validation guard so a
// malicious or buggy peer can never corrupt our local game state.

import {
  type Board,
  type Player,
  type Position,
  isLegalMove,
} from "../engine/reversi.ts";

export const PROTOCOL_VERSION = 1;

export interface MoveMessage {
  t: "move";
  v: number;
  by: Player;
  row: number;
  col: number;
}

export interface PassMessage {
  t: "pass";
  v: number;
  by: Player;
}

export interface NewGameMessage {
  t: "newgame";
  v: number;
}

export interface RematchMessage {
  t: "rematch";
  v: number;
}

export interface ResignMessage {
  t: "resign";
  v: number;
  by: Player;
}

export interface HelloMessage {
  t: "hello";
  v: number;
  /** Color the host has claimed; joiner takes the opposite. */
  hostColor: Player;
}

export type NetMessage =
  | MoveMessage
  | PassMessage
  | NewGameMessage
  | RematchMessage
  | ResignMessage
  | HelloMessage;

/** Serialize a message to a compact JSON string for the data channel. */
export function encodeMessage(msg: NetMessage): string {
  return JSON.stringify(msg);
}

/**
 * Parse and validate the SHAPE of an incoming message.
 * Returns null for anything malformed or of the wrong protocol version.
 * Never throws.
 */
export function decodeMessage(raw: unknown): NetMessage | null {
  if (typeof raw !== "string") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const m = obj as Record<string, unknown>;

  if (m.v !== PROTOCOL_VERSION) return null;

  switch (m.t) {
    case "move":
      if (!isPlayer(m.by)) return null;
      if (!isBoardCoord(m.row) || !isBoardCoord(m.col)) return null;
      return { t: "move", v: PROTOCOL_VERSION, by: m.by, row: m.row, col: m.col };
    case "pass":
      if (!isPlayer(m.by)) return null;
      return { t: "pass", v: PROTOCOL_VERSION, by: m.by };
    case "newgame":
      return { t: "newgame", v: PROTOCOL_VERSION };
    case "rematch":
      return { t: "rematch", v: PROTOCOL_VERSION };
    case "resign":
      if (!isPlayer(m.by)) return null;
      return { t: "resign", v: PROTOCOL_VERSION, by: m.by };
    case "hello":
      if (!isPlayer(m.hostColor)) return null;
      return { t: "hello", v: PROTOCOL_VERSION, hostColor: m.hostColor };
    default:
      return null;
  }
}

function isPlayer(x: unknown): x is Player {
  return x === "B" || x === "W";
}

function isBoardCoord(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x < 8;
}

export type MoveValidation =
  | { ok: true; pos: Position }
  | { ok: false; reason: string };

/**
 * Re-validate a received move against OUR OWN engine state.
 * Never trust the peer: confirm it is this player's turn AND the move is legal.
 *
 * @param board       our current authoritative board
 * @param currentTurn whose turn it is according to our state
 * @param msg         the decoded move message from the peer
 */
export function validateReceivedMove(
  board: Board,
  currentTurn: Player,
  msg: MoveMessage,
): MoveValidation {
  if (msg.by !== currentTurn) {
    return { ok: false, reason: "out-of-turn" };
  }
  const pos: Position = { row: msg.row, col: msg.col };
  if (!isLegalMove(board, msg.by, pos)) {
    return { ok: false, reason: "illegal-move" };
  }
  return { ok: true, pos };
}
