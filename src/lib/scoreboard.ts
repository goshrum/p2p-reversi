// Pure scoreboard tracking for vs-computer results.
// No DOM, no localStorage access, no side effects — fully unit-testable.

/** Outcome of a finished vs-computer game, from the human player's perspective. */
export type GameResult = "win" | "loss" | "draw";

/** Difficulty buckets, matching the AI search-depth presets in the UI. */
export type Difficulty = "easy" | "normal" | "hard";

/** Win/loss/draw tallies. */
export interface Tally {
  wins: number;
  losses: number;
  draws: number;
}

/**
 * The full scoreboard: an overall tally plus a per-difficulty breakdown.
 * Stored as plain JSON in localStorage by the caller.
 */
export interface Scoreboard {
  v: number;
  overall: Tally;
  byDifficulty: Record<Difficulty, Tally>;
}

export const SCOREBOARD_VERSION = 1;

function emptyTally(): Tally {
  return { wins: 0, losses: 0, draws: 0 };
}

/** A fresh, zeroed scoreboard. */
export function emptyScoreboard(): Scoreboard {
  return {
    v: SCOREBOARD_VERSION,
    overall: emptyTally(),
    byDifficulty: {
      easy: emptyTally(),
      normal: emptyTally(),
      hard: emptyTally(),
    },
  };
}

function isTally(x: unknown): x is Tally {
  if (typeof x !== "object" || x === null) return false;
  const t = x as Record<string, unknown>;
  return (
    typeof t.wins === "number" &&
    typeof t.losses === "number" &&
    typeof t.draws === "number" &&
    Number.isFinite(t.wins) &&
    Number.isFinite(t.losses) &&
    Number.isFinite(t.draws)
  );
}

/**
 * Validate and normalize arbitrary parsed JSON into a Scoreboard. Returns a
 * fresh empty scoreboard for anything corrupt or of an unknown version, so the
 * caller can always rely on a usable value. Pure and total.
 */
export function deserializeScoreboard(raw: unknown): Scoreboard {
  if (typeof raw !== "object" || raw === null) return emptyScoreboard();
  const o = raw as Record<string, unknown>;
  if (o.v !== SCOREBOARD_VERSION) return emptyScoreboard();
  if (!isTally(o.overall)) return emptyScoreboard();
  const by = o.byDifficulty;
  if (typeof by !== "object" || by === null) return emptyScoreboard();
  const b = by as Record<string, unknown>;
  if (!isTally(b.easy) || !isTally(b.normal) || !isTally(b.hard)) {
    return emptyScoreboard();
  }
  return {
    v: SCOREBOARD_VERSION,
    overall: { ...(o.overall as Tally) },
    byDifficulty: {
      easy: { ...(b.easy as Tally) },
      normal: { ...(b.normal as Tally) },
      hard: { ...(b.hard as Tally) },
    },
  };
}

/** Parse a raw localStorage string, falling back to an empty scoreboard. */
export function parseScoreboard(text: string | null): Scoreboard {
  if (text === null) return emptyScoreboard();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyScoreboard();
  }
  return deserializeScoreboard(parsed);
}

function bump(tally: Tally, result: GameResult): Tally {
  return {
    wins: tally.wins + (result === "win" ? 1 : 0),
    losses: tally.losses + (result === "loss" ? 1 : 0),
    draws: tally.draws + (result === "draw" ? 1 : 0),
  };
}

/**
 * Return a NEW scoreboard with the given result recorded, in both the overall
 * tally and (when a difficulty is given) the matching per-difficulty bucket.
 * Pure: does not mutate its input.
 */
export function updateScoreboard(
  board: Scoreboard,
  result: GameResult,
  difficulty?: Difficulty,
): Scoreboard {
  const next: Scoreboard = {
    v: SCOREBOARD_VERSION,
    overall: bump(board.overall, result),
    byDifficulty: {
      easy: { ...board.byDifficulty.easy },
      normal: { ...board.byDifficulty.normal },
      hard: { ...board.byDifficulty.hard },
    },
  };
  if (difficulty) {
    next.byDifficulty[difficulty] = bump(board.byDifficulty[difficulty], result);
  }
  return next;
}

/** Total games recorded in a tally. */
export function totalGames(tally: Tally): number {
  return tally.wins + tally.losses + tally.draws;
}
