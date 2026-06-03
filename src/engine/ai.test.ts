import { describe, it, expect } from "vitest";
import {
  createInitialBoard,
  legalMoves,
  applyMove,
  isLegalMove,
  nextPlayer,
  isGameOver,
  type Player,
} from "./reversi.ts";
import { chooseMove, evaluate } from "./ai.ts";

describe("AI chooseMove", () => {
  it("returns a legal move from the opening position", () => {
    const b = createInitialBoard();
    const move = chooseMove(b, "B", 3);
    expect(move).not.toBeNull();
    expect(isLegalMove(b, "B", move!)).toBe(true);
  });

  it("returns null when there are no legal moves", () => {
    // White stuck position: full of black, no empties that flip.
    const full = createInitialBoard().map(() => "B" as Player);
    const move = chooseMove(full, "W", 2);
    expect(move).toBeNull();
  });

  it("is deterministic for identical inputs", () => {
    const b = createInitialBoard();
    const a1 = chooseMove(b, "B", 3);
    const a2 = chooseMove(b, "B", 3);
    expect(a1).toEqual(a2);
  });

  it("prefers a corner when one is immediately available", () => {
    // Build a position where taking the (0,0) corner is legal and clearly best.
    // (0,0) empty, (0,1)=W, (0,2)=B  => playing (0,0) flips (0,1) and grabs corner.
    const board = createInitialBoard();
    board[0] = null;
    board[1] = "W";
    board[2] = "B";
    const move = chooseMove(board, "B", 2);
    expect(move).toEqual({ row: 0, col: 0 });
  });

  it("only ever returns legal moves across a full self-play game at depth 2", () => {
    let board = createInitialBoard();
    let toMove: Player | null = "B";
    let plies = 0;
    while (toMove !== null && plies < 200) {
      if (legalMoves(board, toMove).length === 0) {
        toMove = nextPlayer(board, toMove);
        continue;
      }
      const move = chooseMove(board, toMove, 2);
      expect(move).not.toBeNull();
      expect(isLegalMove(board, toMove, move!)).toBe(true);
      board = applyMove(board, toMove, move!);
      const mover = toMove;
      toMove = nextPlayer(board, mover);
      plies++;
    }
    expect(isGameOver(board)).toBe(true);
  });
});

describe("AI evaluate", () => {
  it("is symmetric: evaluate(b, B) === -evaluate(b, W)", () => {
    const b = createInitialBoard();
    const eB = evaluate(b, "B");
    const eW = evaluate(b, "W");
    expect(eB).toBeCloseTo(-eW, 6);
  });

  it("scores a board owning a corner higher than a board owning an X-square", () => {
    const corner = createInitialBoard();
    corner[0] = "B"; // a1 corner
    const xsq = createInitialBoard();
    xsq[9] = "B"; // b2 X-square (dangerous)
    expect(evaluate(corner, "B")).toBeGreaterThan(evaluate(xsq, "B"));
  });
});
