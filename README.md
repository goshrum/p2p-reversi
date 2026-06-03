# P2P Reversi

Play **Reversi / Othello** with a friend **directly, peer-to-peer**, over a copy-paste link — with **no game server, no signaling server, and no cost, ever.**

Two browsers exchange moves over a direct **WebRTC `RTCDataChannel`**. There is no backend to deploy, no broker that can disappear, and nothing to pay for. The whole thing is static files you can host for free on GitHub Pages.

## The serverless-P2P pitch

Normally "play online with a friend" needs a server: at minimum a *signaling* server to introduce the two browsers to each other. This project removes even that by doing **manual signaling** — you copy a short code, paste it into your chat app, your friend pastes it back. That code is the WebRTC session description (SDP), base64-packed into a single blob. Once both sides have exchanged codes, the browsers talk directly. Game moves never touch any server.

## Three modes

- **Играть с другом (P2P)** — direct WebRTC connection via copy-paste codes.
- **Против компьютера** — single-player vs a minimax AI (corner-weighted heuristic + mobility). You play Black.
- **Вдвоём на одном устройстве (hotseat)** — two people take turns on the same screen.

So the game is fully playable and demoable by one person even with no second device.

## How the copy/paste P2P connection works, step by step

1. **Host** clicks *"Я хост"*. The app generates an **offer code** (its WebRTC offer + gathered ICE candidates, base64-encoded into one pasteable string).
2. Host sends that code to the friend through **any channel** — Telegram, WhatsApp, email, SMS.
3. **Friend** clicks *"Присоединиться"*, pastes the offer code, and clicks generate. The app produces an **answer code**.
4. Friend sends the answer code back to the host.
5. Host pastes the answer code and clicks *"Подключиться"*. The direct `RTCDataChannel` opens and the game begins.

Host plays **Black** (moves first); the joiner plays **White**. The color is announced over the channel via a `hello` message.

## STUN / TURN and the honest strict-NAT caveat

For NAT traversal the app uses Google's **free public STUN server** (`stun:stun.l.google.com:19302`). STUN is free, standard, and just helps each browser discover its public address.

STUN is **not always enough**. Some network setups (symmetric NAT, restrictive corporate/mobile firewalls) require a **TURN relay** to connect — and TURN servers cost money to run. To keep this project truly free and serverless, **there is no TURN server**. Consequence:

- Same Wi-Fi / LAN, and most home broadband connections: **works**.
- Strict/symmetric NAT on one or both ends: the connection **may fail**, and there is no fallback. This is an honest, accepted limitation of a zero-cost serverless design.

## Run locally

```bash
npm install
npm run dev        # start Vite dev server
npm run build      # type-check + production build into dist/
npm run preview    # preview the production build
npm test           # run the Vitest unit suite
```

## Deploy (free, GitHub Pages)

The included workflow `.github/workflows/deploy.yml` runs the tests, builds, and publishes `dist/` to GitHub Pages on every push to `main`.

1. Push this repo to GitHub.
2. In **Settings → Pages**, set **Source = GitHub Actions**.
3. Push to `main`. CI runs `npm test` + `npm run build` and deploys.

Vite `base` is set to `'./'`, so it works under a project sub-path (`user.github.io/p2p-reversi/`).

## Architecture

```
src/
  engine/        pure game logic — NO DOM, fully deterministic, exhaustively tested
    reversi.ts   board, legalMoves, applyMove (flips in all 8 directions),
                 mustPass, isGameOver, score, winner, turn handling
    ai.ts        negamax + alpha-beta with corner/mobility heuristic
  net/
    signaling.ts compact base64 encode/decode of the WebRTC SDP (pure, tested)
    protocol.ts  data-channel message protocol + the never-trust-the-peer
                 move-validation guard (pure, tested)
    connection.ts RTCPeerConnection / RTCDataChannel wrapper (browser only)
  main.ts        UI: menu, P2P wizard, board rendering, animations
  style.css      hand-written responsive dark/light CSS
```

### Trust model

The peer is **never trusted**. Every received move is re-validated against our *own* engine state with `validateReceivedMove`: it must be that player's turn **and** a legal move on our board, or it is rejected. A malicious or buggy peer cannot corrupt local state. Each side only ever sends its own moves and enforces turn order locally.

## Tests

Vitest covers:

- **Engine:** initial position, legal-move generation, flips in **every one of the 8 directions** (incl. multi-disc and multi-direction flips), illegal-move rejection, immutability of `applyMove`, forced pass, double-pass game end, full-board end, scoring, winner/draw, turn logic with passes, and a full random-ish playthrough invariant.
- **AI:** only ever returns legal moves (incl. across a full self-play game), determinism, prefers a corner, evaluation symmetry.
- **Protocol:** encode/decode round-trip for every message type, rejection of malformed/wrong-version/out-of-range input, and the received-move guard rejecting illegal and out-of-turn moves.
- **Signaling:** base64 SDP encode/decode round-trip and garbage rejection.

```bash
npm test
```

## Limitations (honest)

- **No TURN → some strict-NAT pairs cannot connect** (see above). This is the main one.
- **Manual copy-paste signaling** is a little clunky by design — it's the price of having zero servers. The codes are long because they include ICE candidates.
- **No reconnect / no persistence.** If the data channel drops, you start a new connection. There is no spectating, matchmaking, or saved games.
- **The live WebRTC data channel is exercised in a real browser only.** The unit tests cover the pure engine, the message protocol, and the SDP encode/decode — the parts whose correctness can be verified deterministically. The actual RTC handshake itself is integration-tested by playing in a browser, not in the headless unit suite.
- AI strength is "decent club player," not a championship engine — fixed-depth minimax (default depth 4) with a classic positional heuristic.

## License

MIT © 2026 georgerum07
