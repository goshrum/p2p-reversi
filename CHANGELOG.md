# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Resume last game** in single-device modes. The current local game (board,
  side to move, mode, move history, and chosen difficulty) is saved to
  `localStorage` after each move in hotseat and vs-computer modes. When an
  unfinished local game is found on load, the menu offers a "Resume game" button
  (`data-testid="resume-game"`) that restores it. The save is cleared when the
  game ends or a new game starts. P2P games are never persisted. Serialization
  and validation are pure, unit-tested helpers (`serializeGame` /
  `deserializeGame`) that reject corrupt or invalid saved data and fall back to
  no save.
- **Scoreboard vs the computer** shown on the menu (`data-testid="scoreboard"`).
  Tracks lifetime wins / losses / draws against the computer, with a
  per-difficulty breakdown, stored in `localStorage` and updated when a
  vs-computer game ends. Updates run through a pure, unit-tested
  `updateScoreboard(record, result, difficulty)` helper.
- **Stable `data-testid` attributes** for end-to-end testing: `mode-hotseat`,
  `mode-cpu`, `resume-game`, `scoreboard`, the board container (`board`), and
  each board cell (`cell-<row>-<col>`, 0-indexed).
- **Hint button** in single-device modes (hotseat and vs-computer). It reuses the
  minimax engine to compute the best move for the side to move and highlights that
  square with a distinct pulsing marker, without playing it. Clicking Hint again or
  making a move clears the highlight, and a per-game hint counter is shown on the
  button. Hints are hidden in P2P, where they would be unfair and could desync the
  peer. Backed by a pure, unit-tested `bestMoveFor` helper that mirrors the engine's
  choice.
- **Undo last move** in single-device modes. Hotseat undoes one move; vs-computer
  rewinds both the computer's reply and your move so it's your turn again. Backed
  by a pure, unit-tested `undo` helper in the engine.
- **Selectable board theme** — Classic green, Dark, and High contrast — persisted
  to `localStorage`.
- **Adjustable computer difficulty** — Easy / Normal / Hard, mapped to minimax
  search depths 2 / 4 / 6, persisted to `localStorage`.
- **Move counter** shown in the in-game status line.

### Changed

- The entire UI, README, and source comments are now in English.

## [1.0.0]

### Added

- Serverless peer-to-peer Reversi/Othello over a direct WebRTC `RTCDataChannel`
  with manual copy-paste signaling (no game or signaling server).
- Three modes: play with a friend (P2P), play vs the computer (minimax AI), and
  two players on the same device (hotseat).
- Pure, exhaustively unit-tested game engine, AI, SDP signaling, and the
  never-trust-the-peer move-validation protocol guard.
- GitHub Actions workflow that tests, builds, and deploys to GitHub Pages.
