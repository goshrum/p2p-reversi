import { describe, it, expect } from "vitest";
import {
  serializeGame,
  deserializeGame,
  parseSavedGame,
  SAVE_VERSION,
  type SavedSnapshot,
} from "./persistence.ts";
import {
  createInitialBoard,
  applyMove,
  type Board,
  type Player,
} from "../engine/reversi.ts";

function midGame(): { board: Board; turn: Player } {
  // Black opens at (2,3) then it is White's turn — a normal mid-game position.
  const board = applyMove(createInitialBoard(), "B", { row: 2, col: 3 });
  return { board, turn: "W" };
}

describe("serializeGame", () => {
  it("serializes a hotseat game in progress", () => {
    const { board, turn } = midGame();
    const saved = serializeGame({
      mode: "hotseat",
      board,
      turn,
      lastMove: { row: 2, col: 3 },
      history: [],
      aiDepth: 4,
    });
    expect(saved).not.toBeNull();
    expect(saved!.v).toBe(SAVE_VERSION);
    expect(saved!.mode).toBe("hotseat");
    expect(saved!.turn).toBe("W");
    expect(saved!.lastMove).toEqual({ row: 2, col: 3 });
  });

  it("refuses to serialize a finished game (no side to move)", () => {
    const { board } = midGame();
    const saved = serializeGame({
      mode: "ai",
      board,
      turn: null,
      lastMove: null,
      history: [],
      aiDepth: 4,
    });
    expect(saved).toBeNull();
  });

  it("does not alias the input board (defensive copy)", () => {
    const { board, turn } = midGame();
    const saved = serializeGame({
      mode: "hotseat",
      board,
      turn,
      lastMove: null,
      history: [],
      aiDepth: 4,
    })!;
    expect(saved.board).not.toBe(board);
    expect(saved.board).toEqual(board);
  });
});

describe("serialize/deserialize round-trip", () => {
  it("round-trips a hotseat game with history through JSON", () => {
    const history: SavedSnapshot[] = [
      { board: createInitialBoard(), turn: "B", lastMove: null },
    ];
    const { board, turn } = midGame();
    const saved = serializeGame({
      mode: "hotseat",
      board,
      turn,
      lastMove: { row: 2, col: 3 },
      history,
      aiDepth: 6,
    })!;
    const text = JSON.stringify(saved);
    const restored = deserializeGame(JSON.parse(text));
    expect(restored).toEqual(saved);
  });

  it("round-trips a vs-computer game", () => {
    const { board, turn } = midGame();
    const saved = serializeGame({
      mode: "ai",
      board,
      turn,
      lastMove: { row: 2, col: 3 },
      history: [],
      aiDepth: 2,
    })!;
    const restored = parseSavedGame(JSON.stringify(saved));
    expect(restored).toEqual(saved);
  });
});

describe("deserializeGame rejects corrupt/invalid data", () => {
  const good = () => {
    const { board, turn } = midGame();
    return serializeGame({
      mode: "hotseat",
      board,
      turn,
      lastMove: null,
      history: [],
      aiDepth: 4,
    })!;
  };

  it("rejects null and non-objects", () => {
    expect(deserializeGame(null)).toBeNull();
    expect(deserializeGame(42)).toBeNull();
    expect(deserializeGame("nope")).toBeNull();
  });

  it("rejects an unknown version", () => {
    const g = { ...good(), v: 999 };
    expect(deserializeGame(g)).toBeNull();
  });

  it("rejects an unknown / non-persistable mode (e.g. p2p)", () => {
    expect(deserializeGame({ ...good(), mode: "p2p" })).toBeNull();
    expect(deserializeGame({ ...good(), mode: "bogus" })).toBeNull();
  });

  it("rejects a board of the wrong length", () => {
    expect(deserializeGame({ ...good(), board: [null, null, null] })).toBeNull();
  });

  it("rejects a board with invalid cell values", () => {
    const bad = good();
    const board = bad.board.slice();
    board[0] = "X" as unknown as null;
    expect(deserializeGame({ ...bad, board })).toBeNull();
  });

  it("rejects an invalid side to move", () => {
    expect(deserializeGame({ ...good(), turn: "X" })).toBeNull();
    expect(deserializeGame({ ...good(), turn: null })).toBeNull();
  });

  it("rejects a corrupt lastMove", () => {
    expect(deserializeGame({ ...good(), lastMove: { row: 99, col: 0 } })).toBeNull();
    expect(deserializeGame({ ...good(), lastMove: { row: 0 } })).toBeNull();
  });

  it("rejects a corrupt history entry", () => {
    expect(deserializeGame({ ...good(), history: [{ board: [1, 2] }] })).toBeNull();
    expect(deserializeGame({ ...good(), history: "nope" })).toBeNull();
  });

  it("rejects a missing/invalid aiDepth", () => {
    expect(deserializeGame({ ...good(), aiDepth: "fast" })).toBeNull();
    const { aiDepth, ...noDepth } = good();
    void aiDepth;
    expect(deserializeGame(noDepth)).toBeNull();
  });

  it("rejects a finished game position", () => {
    // A fully Black board has no legal move for either side -> game over.
    const fullBoard: Board = new Array(64).fill("B");
    const g = { ...good(), board: fullBoard };
    expect(deserializeGame(g)).toBeNull();
  });
});

describe("parseSavedGame", () => {
  it("returns null for absent storage", () => {
    expect(parseSavedGame(null)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseSavedGame("{not json")).toBeNull();
  });
});
