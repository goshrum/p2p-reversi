import { describe, it, expect } from "vitest";
import {
  type Board,
  type Player,
  SIZE,
  index,
  inBounds,
  opponent,
  createInitialBoard,
  cloneBoard,
  flipsForMove,
  isLegalMove,
  legalMoves,
  applyMove,
  mustPass,
  isGameOver,
  score,
  winner,
  nextPlayer,
  undo,
  type GameSnapshot,
} from "./reversi.ts";

/** Build a board from an 8x8 string layout: '.' empty, 'B' black, 'W' white. */
function boardFrom(rows: string[]): Board {
  expect(rows.length).toBe(SIZE);
  const board: Board = new Array(SIZE * SIZE).fill(null);
  for (let r = 0; r < SIZE; r++) {
    const cells = rows[r].split("");
    expect(cells.length).toBe(SIZE);
    for (let c = 0; c < SIZE; c++) {
      const ch = cells[c];
      if (ch === "B") board[index(r, c)] = "B";
      else if (ch === "W") board[index(r, c)] = "W";
      else board[index(r, c)] = null;
    }
  }
  return board;
}

function setify(positions: { row: number; col: number }[]): Set<string> {
  return new Set(positions.map((p) => `${p.row},${p.col}`));
}

describe("helpers", () => {
  it("index is row-major", () => {
    expect(index(0, 0)).toBe(0);
    expect(index(0, 7)).toBe(7);
    expect(index(1, 0)).toBe(8);
    expect(index(7, 7)).toBe(63);
  });

  it("inBounds", () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(7, 7)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(0, 8)).toBe(false);
    expect(inBounds(8, 8)).toBe(false);
  });

  it("opponent", () => {
    expect(opponent("B")).toBe("W");
    expect(opponent("W")).toBe("B");
  });
});

describe("initial position", () => {
  it("has the standard four center discs", () => {
    const b = createInitialBoard();
    expect(b[index(3, 3)]).toBe("W");
    expect(b[index(3, 4)]).toBe("B");
    expect(b[index(4, 3)]).toBe("B");
    expect(b[index(4, 4)]).toBe("W");
  });

  it("has exactly 4 discs, 2 each, rest empty", () => {
    const b = createInitialBoard();
    const s = score(b);
    expect(s).toEqual({ B: 2, W: 2 });
    expect(b.filter((c) => c === null).length).toBe(60);
  });

  it("black has exactly 4 opening moves", () => {
    const b = createInitialBoard();
    const moves = legalMoves(b, "B");
    expect(moves.length).toBe(4);
    expect(setify(moves)).toEqual(
      setify([
        { row: 2, col: 3 },
        { row: 3, col: 2 },
        { row: 4, col: 5 },
        { row: 5, col: 4 },
      ]),
    );
  });

  it("white also has 4 opening moves (symmetry)", () => {
    const b = createInitialBoard();
    expect(legalMoves(b, "W").length).toBe(4);
  });
});

describe("flips in each direction", () => {
  // A black disc flanking a white disc with black wall, one per direction.
  function lineTest(rows: string[], player: Player, move: { row: number; col: number }) {
    return flipsForMove(boardFrom(rows), player, move);
  }

  it("flips East", () => {
    // Move at (3,0): East neighbor (3,1)=W, then (3,2)=B brackets -> flip (3,1).
    const flips = lineTest(
      ["........", "........", "........", ".WB.....", "........", "........", "........", "........"],
      "B",
      { row: 3, col: 0 },
    );
    expect(flips).toEqual([index(3, 1)]);
  });

  it("flips West", () => {
    const flips = lineTest(
      ["........", "........", "........", "..WB....", "........", "........", "........", "........"],
      "B",
      { row: 3, col: 1 },
    );
    expect(flips).toEqual([index(3, 2)]);
  });

  it("flips North", () => {
    const flips = lineTest(
      ["........", "...B....", "...W....", "........", "........", "........", "........", "........"],
      "B",
      { row: 3, col: 3 },
    );
    expect(flips).toEqual([index(2, 3)]);
  });

  it("flips South", () => {
    const flips = lineTest(
      ["........", "........", "........", "...W....", "...B....", "........", "........", "........"],
      "B",
      { row: 2, col: 3 },
    );
    expect(flips).toEqual([index(3, 3)]);
  });

  it("flips SE diagonal", () => {
    const flips = lineTest(
      ["B.......", ".W......", "........", "........", "........", "........", "........", "........"],
      "B",
      { row: 2, col: 2 },
    );
    expect(flips).toEqual([index(1, 1)]);
  });

  it("flips NW diagonal", () => {
    const flips = lineTest(
      ["........", ".B......", "..W.....", "........", "........", "........", "........", "........"],
      "B",
      { row: 3, col: 3 },
    );
    expect(flips).toEqual([index(2, 2)]);
  });

  it("flips NE diagonal", () => {
    const flips = lineTest(
      ["........", "...B....", "..W.....", "........", "........", "........", "........", "........"],
      "B",
      { row: 3, col: 1 },
    );
    expect(flips).toEqual([index(2, 2)]);
  });

  it("flips SW diagonal", () => {
    const flips = lineTest(
      ["........", "..B.....", "...W....", "........", "........", "........", "........", "........"],
      "B",
      { row: 3, col: 4 },
    );
    // B at (1,2), W at (2,3), move at (3,4) flips (2,3)
    expect(flips).toEqual([index(2, 3)]);
  });

  it("flips multiple discs in a single direction", () => {
    const flips = lineTest(
      ["BWWW....", "........", "........", "........", "........", "........", "........", "........"],
      "B",
      { row: 0, col: 4 },
    );
    expect(setify(flips.map((i) => ({ row: Math.floor(i / 8), col: i % 8 })))).toEqual(
      setify([
        { row: 0, col: 1 },
        { row: 0, col: 2 },
        { row: 0, col: 3 },
      ]),
    );
  });

  it("flips in MULTIPLE directions at once", () => {
    // Move at (3,3). East: (3,4)=W,(3,5)=B -> flip (3,4).
    // South: (4,3)=W,(5,3)=B -> flip (4,3).
    const b = boardFrom([
      "........",
      "........",
      "........",
      "...DWB..",
      "...W....",
      "...B....",
      "........",
      "........",
    ].map((r) => r.replace("D", ".")));
    const flips = flipsForMove(b, "B", { row: 3, col: 3 });
    const set = setify(flips.map((i) => ({ row: Math.floor(i / 8), col: i % 8 })));
    expect(set.has("3,4")).toBe(true);
    expect(set.has("4,3")).toBe(true);
    expect(flips.length).toBe(2);
  });
});

describe("illegal moves", () => {
  it("rejects move on an occupied square", () => {
    const b = createInitialBoard();
    expect(isLegalMove(b, "B", { row: 3, col: 3 })).toBe(false);
    expect(flipsForMove(b, "B", { row: 3, col: 3 })).toEqual([]);
  });

  it("rejects move that flips nothing", () => {
    const b = createInitialBoard();
    expect(isLegalMove(b, "B", { row: 0, col: 0 })).toBe(false);
  });

  it("rejects out-of-bounds", () => {
    const b = createInitialBoard();
    expect(flipsForMove(b, "B", { row: -1, col: 0 })).toEqual([]);
    expect(flipsForMove(b, "B", { row: 8, col: 8 })).toEqual([]);
  });

  it("rejects a run that runs off the edge without bracketing", () => {
    // White discs run to the left edge; placing Black at (0,3) looks West over
    // (0,2)=W,(0,1)=W,(0,0)=W and then falls off the board with no Black wall -> no flip.
    const b = boardFrom([
      "WWW.....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(isLegalMove(b, "B", { row: 0, col: 3 })).toBe(false);
    expect(flipsForMove(b, "B", { row: 0, col: 3 })).toEqual([]);
  });
});

describe("applyMove", () => {
  it("does not mutate the input board", () => {
    const b = createInitialBoard();
    const snapshot = cloneBoard(b);
    applyMove(b, "B", { row: 2, col: 3 });
    expect(b).toEqual(snapshot);
  });

  it("places the disc and flips correctly for an opening move", () => {
    const b = createInitialBoard();
    const next = applyMove(b, "B", { row: 2, col: 3 });
    expect(next[index(2, 3)]).toBe("B"); // placed
    expect(next[index(3, 3)]).toBe("B"); // flipped from W
    const s = score(next);
    expect(s).toEqual({ B: 4, W: 1 });
  });

  it("throws on an illegal move", () => {
    const b = createInitialBoard();
    expect(() => applyMove(b, "B", { row: 0, col: 0 })).toThrow();
  });
});

describe("must-pass and game-over", () => {
  it("a single-disc-per-color board lets the bracketing color move but not the other", () => {
    const b = boardFrom([
      "B.......",
      ".W......",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    // Black needs to bracket a White run with Black on both ends — only one White exists,
    // and it is already adjacent to a Black, so playing the far side ((2,2)) flips it.
    expect(isLegalMove(b, "B", { row: 2, col: 2 })).toBe(true);
    // White cannot bracket: there is only one Black disc, so White has no legal move.
    expect(mustPass(b, "W")).toBe(true);
  });

  it("detects double-pass game end", () => {
    // Both players stuck: full board.
    const full = boardFrom([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    expect(mustPass(full, "B")).toBe(true);
    expect(mustPass(full, "W")).toBe(true);
    expect(isGameOver(full)).toBe(true);
  });

  it("a board with available moves is not game over", () => {
    expect(isGameOver(createInitialBoard())).toBe(false);
  });
});

describe("scoring and winner", () => {
  it("counts discs", () => {
    const b = boardFrom([
      "BBBB....",
      "........",
      "........",
      "........",
      "........",
      "........",
      "........",
      "WW......",
    ]);
    expect(score(b)).toEqual({ B: 4, W: 2 });
  });

  it("winner is the majority color", () => {
    const bWins = boardFrom([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    expect(winner(bWins)).toBe("B");
  });

  it("declares a draw on equal discs", () => {
    const draw = boardFrom([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    expect(score(draw)).toEqual({ B: 32, W: 32 });
    expect(winner(draw)).toBe("draw");
  });
});

describe("nextPlayer turn logic", () => {
  it("alternates normally", () => {
    const b = createInitialBoard();
    const afterBlack = applyMove(b, "B", { row: 2, col: 3 });
    expect(nextPlayer(afterBlack, "B")).toBe("W");
  });

  it("returns the same player when the opponent must pass", () => {
    // Craft a board where only Black has a legal move and White is stuck.
    // B at (1,0), W at (2,1) => Black can play (3,2) flipping (2,1). White has only
    // one disc and cannot bracket anything, so White must pass.
    const onlyBlack = boardFrom([
      "........",
      "B.......",
      ".W......",
      "........",
      "........",
      "........",
      "........",
      "........",
    ]);
    expect(mustPass(onlyBlack, "W")).toBe(true);
    expect(mustPass(onlyBlack, "B")).toBe(false);
    // After White (justMoved) the turn would go to Black; but it's also the case that
    // if Black just moved and White is stuck, the turn stays with Black.
    expect(nextPlayer(onlyBlack, "B")).toBe("B");
  });

  it("returns null when the game is over", () => {
    const full = boardFrom([
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "BBBBBBBB",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
      "WWWWWWWW",
    ]);
    expect(nextPlayer(full, "B")).toBeNull();
  });
});

describe("full game playthrough invariants", () => {
  it("playing random-ish legal moves to the end keeps the board consistent", () => {
    let board = createInitialBoard();
    let toMove: Player | null = "B";
    let lastMover: Player = "B";
    let plies = 0;

    while (toMove !== null && plies < 200) {
      const moves = legalMoves(board, toMove);
      if (moves.length === 0) {
        // forced pass
        lastMover = toMove;
        toMove = nextPlayer(board, toMove);
        continue;
      }
      // deterministic pick: first legal move
      board = applyMove(board, toMove, moves[0]);
      lastMover = toMove;
      // every cell is still B, W, or null
      expect(board.every((c) => c === "B" || c === "W" || c === null)).toBe(true);
      toMove = nextPlayer(board, lastMover);
      plies++;
    }

    expect(isGameOver(board)).toBe(true);
    const s = score(board);
    // Total discs never exceeds 64 and at least the original 4 exist.
    expect(s.B + s.W).toBeGreaterThanOrEqual(4);
    expect(s.B + s.W).toBeLessThanOrEqual(64);
    expect(["B", "W", "draw"]).toContain(winner(board));
  });
});

describe("undo (history stack)", () => {
  function snap(turn: Player | null): GameSnapshot {
    return { board: createInitialBoard(), turn, lastMove: null };
  }

  it("returns null for empty history", () => {
    expect(undo([])).toBeNull();
    expect(undo([], 3)).toBeNull();
  });

  it("pops the last snapshot and returns the rest", () => {
    const a = snap("B");
    const b = snap("W");
    const result = undo([a, b]);
    expect(result).not.toBeNull();
    expect(result!.restored).toBe(b);
    expect(result!.history).toEqual([a]);
  });

  it("undoes multiple snapshots at once (count > 1)", () => {
    const a = snap("B");
    const b = snap("W");
    const c = snap("B");
    const result = undo([a, b, c], 2);
    expect(result!.restored).toBe(b);
    expect(result!.history).toEqual([a]);
  });

  it("clamps count to the available history length", () => {
    const a = snap("B");
    const b = snap("W");
    const result = undo([a, b], 5);
    expect(result!.restored).toBe(a);
    expect(result!.history).toEqual([]);
  });

  it("treats count < 1 as a single pop", () => {
    const a = snap("B");
    const b = snap("W");
    const result = undo([a, b], 0);
    expect(result!.restored).toBe(b);
    expect(result!.history).toEqual([a]);
  });

  it("does not mutate the input history", () => {
    const a = snap("B");
    const b = snap("W");
    const input = [a, b];
    undo(input, 1);
    expect(input).toEqual([a, b]);
    expect(input.length).toBe(2);
  });

  it("round-trips a real move: play then undo restores the prior position", () => {
    const before = createInitialBoard();
    const history: GameSnapshot[] = [{ board: before, turn: "B", lastMove: null }];
    const after = applyMove(before, "B", { row: 2, col: 3 });
    expect(score(after).B + score(after).W).toBe(5);
    const result = undo(history, 1)!;
    expect(result.restored.board).toEqual(before);
    expect(result.restored.turn).toBe("B");
  });
});
