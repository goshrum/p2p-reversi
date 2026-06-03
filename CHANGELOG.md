# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
