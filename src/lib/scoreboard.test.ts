import { describe, it, expect } from "vitest";
import {
  emptyScoreboard,
  updateScoreboard,
  deserializeScoreboard,
  parseScoreboard,
  totalGames,
  SCOREBOARD_VERSION,
} from "./scoreboard.ts";

describe("updateScoreboard increments", () => {
  it("increments wins", () => {
    const next = updateScoreboard(emptyScoreboard(), "win");
    expect(next.overall).toEqual({ wins: 1, losses: 0, draws: 0 });
  });

  it("increments losses", () => {
    const next = updateScoreboard(emptyScoreboard(), "loss");
    expect(next.overall).toEqual({ wins: 0, losses: 1, draws: 0 });
  });

  it("increments draws", () => {
    const next = updateScoreboard(emptyScoreboard(), "draw");
    expect(next.overall).toEqual({ wins: 0, losses: 0, draws: 1 });
  });

  it("accumulates across multiple results", () => {
    let sb = emptyScoreboard();
    sb = updateScoreboard(sb, "win");
    sb = updateScoreboard(sb, "win");
    sb = updateScoreboard(sb, "loss");
    sb = updateScoreboard(sb, "draw");
    expect(sb.overall).toEqual({ wins: 2, losses: 1, draws: 1 });
    expect(totalGames(sb.overall)).toBe(4);
  });

  it("does not mutate its input", () => {
    const sb = emptyScoreboard();
    const next = updateScoreboard(sb, "win");
    expect(sb.overall.wins).toBe(0);
    expect(next).not.toBe(sb);
  });
});

describe("updateScoreboard per-difficulty", () => {
  it("records into the matching difficulty bucket and overall", () => {
    let sb = emptyScoreboard();
    sb = updateScoreboard(sb, "win", "hard");
    expect(sb.overall.wins).toBe(1);
    expect(sb.byDifficulty.hard.wins).toBe(1);
    expect(sb.byDifficulty.easy.wins).toBe(0);
    expect(sb.byDifficulty.normal.wins).toBe(0);
  });

  it("keeps difficulty buckets independent", () => {
    let sb = emptyScoreboard();
    sb = updateScoreboard(sb, "win", "easy");
    sb = updateScoreboard(sb, "loss", "hard");
    expect(sb.byDifficulty.easy).toEqual({ wins: 1, losses: 0, draws: 0 });
    expect(sb.byDifficulty.hard).toEqual({ wins: 0, losses: 1, draws: 0 });
    expect(sb.overall).toEqual({ wins: 1, losses: 1, draws: 0 });
  });

  it("only updates overall when no difficulty is given", () => {
    const sb = updateScoreboard(emptyScoreboard(), "win");
    expect(sb.overall.wins).toBe(1);
    expect(sb.byDifficulty.easy.wins).toBe(0);
    expect(sb.byDifficulty.normal.wins).toBe(0);
    expect(sb.byDifficulty.hard.wins).toBe(0);
  });
});

describe("deserializeScoreboard validation", () => {
  it("round-trips a real scoreboard through JSON", () => {
    let sb = emptyScoreboard();
    sb = updateScoreboard(sb, "win", "normal");
    sb = updateScoreboard(sb, "draw", "easy");
    const restored = deserializeScoreboard(JSON.parse(JSON.stringify(sb)));
    expect(restored).toEqual(sb);
  });

  it("falls back to empty for null / non-object", () => {
    expect(deserializeScoreboard(null)).toEqual(emptyScoreboard());
    expect(deserializeScoreboard(42)).toEqual(emptyScoreboard());
  });

  it("falls back to empty for an unknown version", () => {
    const sb = { ...emptyScoreboard(), v: 999 };
    expect(deserializeScoreboard(sb)).toEqual(emptyScoreboard());
  });

  it("falls back to empty for a corrupt overall tally", () => {
    const sb = { ...emptyScoreboard(), overall: { wins: "lots" } };
    expect(deserializeScoreboard(sb)).toEqual(emptyScoreboard());
  });

  it("falls back to empty when a difficulty bucket is missing", () => {
    const sb = emptyScoreboard();
    const broken = {
      v: SCOREBOARD_VERSION,
      overall: sb.overall,
      byDifficulty: { easy: sb.byDifficulty.easy, normal: sb.byDifficulty.normal },
    };
    expect(deserializeScoreboard(broken)).toEqual(emptyScoreboard());
  });
});

describe("parseScoreboard", () => {
  it("returns empty for absent storage", () => {
    expect(parseScoreboard(null)).toEqual(emptyScoreboard());
  });

  it("returns empty for invalid JSON", () => {
    expect(parseScoreboard("{broken")).toEqual(emptyScoreboard());
  });
});
