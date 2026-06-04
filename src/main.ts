import "./style.css";
import {
  type Board,
  type Player,
  type Position,
  SIZE,
  index,
  createInitialBoard,
  legalMoves,
  applyMove,
  isLegalMove,
  isGameOver,
  score,
  winner,
  nextPlayer,
  opponent,
  undo,
} from "./engine/reversi.ts";
import { chooseMove, bestMoveFor } from "./engine/ai.ts";
import { PeerConnection, type ConnState } from "./net/connection.ts";
import { validateReceivedMove, type NetMessage } from "./net/protocol.ts";

type Mode = "menu" | "p2p" | "ai" | "hotseat";

/** A snapshot of the position, used for the undo history stack. */
interface HistorySnapshot {
  board: Board;
  turn: Player | null;
  lastMove: Position | null;
}

interface State {
  mode: Mode;
  board: Board;
  turn: Player | null; // null => game over
  lastMove: Position | null;
  flipped: Set<number>; // indices flipped on the last move (for animation)
  history: HistorySnapshot[]; // positions before each local move (for undo)
  // P2P
  myColor: Player | null; // which color the local human controls (P2P / AI)
  conn: PeerConnection | null;
  connState: ConnState;
  // AI
  aiThinking: boolean;
  // Hint (local modes only): the suggested square to highlight, plus a counter.
  hint: Position | null;
  hintCount: number;
}

const app = document.getElementById("app")!;

const state: State = {
  mode: "menu",
  board: createInitialBoard(),
  turn: "B",
  lastMove: null,
  flipped: new Set(),
  history: [],
  myColor: null,
  conn: null,
  connState: "new",
  aiThinking: false,
  hint: null,
  hintCount: 0,
};

const AI_COLOR: Player = "W"; // human is Black by default in vs-computer

// ---------- board theme (persisted) ----------

type Theme = "classic" | "dark" | "contrast";
const THEMES: { id: Theme; label: string }[] = [
  { id: "classic", label: "Classic green" },
  { id: "dark", label: "Dark" },
  { id: "contrast", label: "High contrast" },
];
const THEME_KEY = "p2p-reversi.theme";

function loadTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "classic" || saved === "dark" || saved === "contrast") return saved;
  return "classic";
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
}

let currentTheme: Theme = loadTheme();

// ---------- AI difficulty (search depth, persisted) ----------

const DIFFICULTIES: { id: string; label: string; depth: number }[] = [
  { id: "easy", label: "Easy", depth: 2 },
  { id: "normal", label: "Normal", depth: 4 },
  { id: "hard", label: "Hard", depth: 6 },
];
const DIFFICULTY_KEY = "p2p-reversi.difficulty";

function loadDifficultyDepth(): number {
  const saved = localStorage.getItem(DIFFICULTY_KEY);
  const found = DIFFICULTIES.find((d) => d.id === saved);
  return found ? found.depth : 4;
}

let aiDepth = loadDifficultyDepth();

// ---------- helpers ----------

function resetGame() {
  state.board = createInitialBoard();
  state.turn = "B";
  state.lastMove = null;
  state.flipped = new Set();
  state.history = [];
  state.hint = null;
  state.hintCount = 0;
}

/**
 * Hints are offered only in the single-device modes. In P2P they would be
 * unfair and could desync the opponent's view, so the button is hidden there.
 */
function hintsEnabled(): boolean {
  return state.mode === "hotseat" || state.mode === "ai";
}

/** Clear any active hint highlight (called on a new move or a fresh hint). */
function clearHint() {
  state.hint = null;
}

/**
 * Compute and highlight the best move for the side currently to move, reusing
 * the engine. Clicking again recomputes (and so clears the old marker first).
 * Does NOT make the move. No-op when it isn't a hintable human turn.
 */
function requestHint() {
  if (!hintsEnabled()) return;
  if (state.turn === null) return;
  if (state.mode === "ai" && (state.turn !== state.myColor || state.aiThinking)) return;
  const suggestion = bestMoveFor(state.board, state.turn, aiDepth);
  if (!suggestion) {
    showToast("No move available — you must pass");
    state.hint = null;
    render();
    return;
  }
  state.hint = suggestion;
  state.hintCount++;
  render();
}

/** True if undo is offered in the current mode (local-only games). */
function canUndo(): boolean {
  return (state.mode === "hotseat" || state.mode === "ai") && state.history.length > 0;
}

/** Push the current position onto the undo stack before a local move is applied. */
function pushHistory() {
  state.history.push({
    board: state.board,
    turn: state.turn,
    lastMove: state.lastMove,
  });
}

/**
 * Undo the last local move. In vs-computer mode this rewinds both the AI's
 * reply and the player's own move, so it is the player's turn again.
 */
function undoMove() {
  if (!canUndo()) return;
  // In AI mode, the history holds [..., playerMove, aiReply]; undo both so the
  // human is back on move. In hotseat, undo a single move.
  const count = state.mode === "ai" ? 2 : 1;
  const result = undo(state.history, count);
  if (!result) return;
  state.board = result.restored.board;
  state.turn = result.restored.turn;
  state.lastMove = result.restored.lastMove;
  state.flipped = new Set();
  state.history = result.history;
  state.aiThinking = false;
  clearHint();
  render();
}

function flippedFor(board: Board, player: Player, pos: Position): Set<number> {
  // recompute flips for animation (engine validated already)
  const before = board;
  const after = applyMove(before, player, pos);
  const set = new Set<number>();
  for (let i = 0; i < after.length; i++) {
    if (before[i] !== after[i] && i !== index(pos.row, pos.col)) set.add(i);
  }
  return set;
}

function showToast(text: string, ms = 2200) {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Advance the turn after a move was applied by `mover`, handling passes. */
function advanceTurn(mover: Player) {
  const next = nextPlayer(state.board, mover);
  state.turn = next;
  if (next === null) {
    render();
    return;
  }
  if (next === mover) {
    // opponent had to pass
    const passer = opponent(mover);
    showToast(`${passer === "B" ? "Black" : "White"} has no moves and passes`);
  }
}

// ---------- local move application ----------

function localMakeMove(pos: Position, mover: Player) {
  // Record the pre-move position for undo (local modes only; undoing a P2P
  // move would desync the peer, so history is not kept there).
  if (state.mode === "hotseat" || state.mode === "ai") pushHistory();
  clearHint();
  state.flipped = flippedFor(state.board, mover, pos);
  state.board = applyMove(state.board, mover, pos);
  state.lastMove = pos;
  advanceTurn(mover);
  render();
}

/** Called when the human clicks a cell. */
function onCellClick(pos: Position) {
  if (state.turn === null) return;

  if (state.mode === "hotseat") {
    if (!isLegalMove(state.board, state.turn, pos)) return;
    localMakeMove(pos, state.turn);
    return;
  }

  if (state.mode === "ai") {
    if (state.turn !== state.myColor || state.aiThinking) return;
    if (!isLegalMove(state.board, state.turn, pos)) return;
    localMakeMove(pos, state.turn);
    maybeRunAI();
    return;
  }

  if (state.mode === "p2p") {
    if (!state.conn?.isOpen) return;
    if (state.turn !== state.myColor) return;
    if (!isLegalMove(state.board, state.turn, pos)) return;
    state.conn.send({ t: "move", v: 1, by: state.myColor, row: pos.row, col: pos.col });
    localMakeMove(pos, state.myColor);
    return;
  }
}

// ---------- AI loop ----------

function maybeRunAI() {
  if (state.mode !== "ai") return;
  if (state.turn === null) return;
  if (state.turn !== AI_COLOR) return;

  state.aiThinking = true;
  render();
  // Defer so the UI repaints with the human's move + "thinking" first.
  setTimeout(() => {
    // It may have become a forced-pass-only situation already handled by advanceTurn,
    // but if it's genuinely the AI's turn, play.
    if (state.turn === AI_COLOR) {
      const move = chooseMove(state.board, AI_COLOR, aiDepth);
      if (move) {
        localMakeMove(move, AI_COLOR);
      }
    }
    state.aiThinking = false;
    render();
    // If after the AI move it's still the AI's turn (human passed), keep going.
    if (state.turn === AI_COLOR) maybeRunAI();
  }, 350);
}

// ---------- P2P networking ----------

function handlePeerMessage(msg: NetMessage) {
  switch (msg.t) {
    case "hello": {
      // Host announced its color; we take the opposite.
      state.myColor = opponent(msg.hostColor);
      render();
      break;
    }
    case "move": {
      if (state.turn === null) return;
      const check = validateReceivedMove(state.board, state.turn, msg);
      if (!check.ok) {
        showToast(`Rejected an invalid move from the opponent (${check.reason})`);
        return;
      }
      localMakeMove(check.pos, msg.by);
      break;
    }
    case "resign": {
      showToast(`Opponent resigned. You win!`);
      state.turn = null;
      render();
      break;
    }
    case "newgame":
    case "rematch": {
      resetGame();
      showToast("New game");
      render();
      break;
    }
    case "pass":
      // informational; turn logic is driven locally by engine
      break;
  }
}

function newPeer(): PeerConnection {
  return new PeerConnection({
    onMessage: handlePeerMessage,
    onStateChange: (s) => {
      state.connState = s;
      render();
    },
    onOpen: () => {
      state.connState = "connected";
      render();
    },
  });
}

// ---------- rendering ----------

function render() {
  switch (state.mode) {
    case "menu":
      renderMenu();
      break;
    case "p2p":
      renderP2P();
      break;
    default:
      renderGame();
  }
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderMenu() {
  app.innerHTML = "";
  app.appendChild(el("h1", undefined, "P2P Reversi"));
  app.appendChild(
    el(
      "p",
      "tagline",
      "Play Othello with a friend directly over WebRTC. No server, no sign-up, free.",
    ),
  );

  const modes = el("div", "modes");

  const defs: { mode: Mode; emoji: string; title: string; sub: string }[] = [
    {
      mode: "p2p",
      emoji: "🔗",
      title: "Play with a friend (P2P)",
      sub: "Direct connection via a copy-paste code. No server.",
    },
    {
      mode: "ai",
      emoji: "🤖",
      title: "Play vs computer",
      sub: "Corner-weighted minimax. You play Black.",
    },
    {
      mode: "hotseat",
      emoji: "👥",
      title: "Two players (same device)",
      sub: "Take turns on this screen.",
    },
  ];

  for (const d of defs) {
    const b = el("button", "mode-btn");
    b.appendChild(el("span", "emoji", d.emoji));
    const txt = el("div");
    txt.appendChild(el("div", "mode-title", d.title));
    txt.appendChild(el("div", "mode-sub", d.sub));
    b.appendChild(txt);
    b.onclick = () => startMode(d.mode);
    modes.appendChild(b);
  }

  const card = el("div", "card");
  card.appendChild(modes);
  app.appendChild(card);

  app.appendChild(renderSettingsCard());

  const explainerCard = el("div", "card");
  explainerCard.innerHTML = `
    <details class="explainer">
      <summary>How does serverless P2P work?</summary>
      <ol>
        <li>The host creates an "invite code" (its WebRTC offer, packed into base64).</li>
        <li>Sends the code to a friend any way they like (messenger, email).</li>
        <li>The friend pastes the code, gets an "answer code", and sends it back.</li>
        <li>The host pastes the answer — a direct RTCDataChannel is established.</li>
      </ol>
      <p>For NAT traversal it uses Google's free public STUN server.
      There is no game server and no signaling server: the computers exchange moves directly.
      <strong>Note:</strong> with a strict/symmetric NAT or firewall and no TURN, the connection
      may fail (TURN costs money, so there is none here). On the same network and on most
      home connections it just works.</p>
    </details>
  `;
  app.appendChild(explainerCard);

  app.appendChild(renderFooter());
}

/** Settings card on the menu: board theme + AI difficulty, both persisted. */
function renderSettingsCard(): HTMLElement {
  const card = el("div", "card");

  // Board theme
  const themeRow = el("div", "settings-row");
  themeRow.appendChild(el("span", "settings-label", "Board theme"));
  const themeGroup = el("div", "segmented");
  for (const t of THEMES) {
    const b = el("button", `seg-btn${currentTheme === t.id ? " active" : ""}`, t.label);
    b.onclick = () => {
      currentTheme = t.id;
      applyTheme(t.id);
      render();
    };
    themeGroup.appendChild(b);
  }
  themeRow.appendChild(themeGroup);
  card.appendChild(themeRow);

  // AI difficulty
  const diffRow = el("div", "settings-row");
  diffRow.appendChild(el("span", "settings-label", "Computer difficulty"));
  const diffGroup = el("div", "segmented");
  for (const d of DIFFICULTIES) {
    const b = el("button", `seg-btn${aiDepth === d.depth ? " active" : ""}`, d.label);
    b.onclick = () => {
      aiDepth = d.depth;
      localStorage.setItem(DIFFICULTY_KEY, d.id);
      render();
    };
    diffGroup.appendChild(b);
  }
  diffRow.appendChild(diffGroup);
  card.appendChild(diffRow);

  return card;
}

function renderFooter(): HTMLElement {
  const f = el("div", "footer");
  f.innerHTML = `Engine and protocol fully covered by unit tests · MIT · 100% serverless`;
  return f;
}

function startMode(mode: Mode) {
  state.mode = mode;
  resetGame();
  state.aiThinking = false;

  if (mode === "ai") {
    state.myColor = "B"; // human plays black, moves first
    render();
    // If AI somehow moves first (it doesn't, B starts), this is a no-op.
    maybeRunAI();
  } else if (mode === "hotseat") {
    state.myColor = null;
    render();
  } else if (mode === "p2p") {
    state.myColor = null;
    render();
  }
}

function backToMenu() {
  if (state.conn) {
    state.conn.close();
    state.conn = null;
  }
  state.mode = "menu";
  state.connState = "new";
  render();
}

// ---- P2P wizard ----

function renderP2P() {
  app.innerHTML = "";
  const top = el("div", "topbar");
  const back = el("button", "btn-ghost", "← Menu");
  back.onclick = backToMenu;
  top.appendChild(back);
  top.appendChild(el("h1", undefined, "Play with a friend"));
  app.appendChild(top);

  if (state.conn?.isOpen) {
    renderGame();
    return;
  }

  const card = el("div", "card");
  card.appendChild(
    el("p", "hint-text", "Pick a role. One of you is the Host, the other Joins."),
  );
  const row = el("div", "row gap-top");
  const hostBtn = el("button", "btn-primary", "I'm the host (create game)");
  hostBtn.onclick = renderHostFlow;
  const joinBtn = el("button", "btn-accent", "Join with a code");
  joinBtn.onclick = renderJoinFlow;
  row.appendChild(hostBtn);
  row.appendChild(joinBtn);
  card.appendChild(row);
  app.appendChild(card);

  app.appendChild(renderFooter());
}

function statusEl(): HTMLElement {
  const cls =
    state.connState === "connected"
      ? "connected"
      : state.connState === "connecting" || state.connState === "new"
        ? "connecting"
        : "failed";
  const labels: Record<string, string> = {
    new: "waiting for connection…",
    connecting: "connecting…",
    connected: "connected",
    disconnected: "connection lost",
    failed: "could not connect (possibly a strict NAT without TURN)",
  };
  const s = el("div", `status ${cls}`);
  s.appendChild(el("span", "dot"));
  s.appendChild(document.createTextNode(labels[state.connState] ?? state.connState));
  return s;
}

function copyButton(getText: () => string): HTMLButtonElement {
  const btn = el("button", "btn-primary", "📋 Copy") as HTMLButtonElement;
  btn.onclick = async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const prev = btn.textContent;
    btn.textContent = "✓ Copied";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = prev;
      btn.classList.remove("copied");
    }, 1400);
  };
  return btn;
}

async function renderHostFlow() {
  state.myColor = "B"; // host plays black (moves first)
  state.conn = newPeer();

  app.innerHTML = "";
  const top = el("div", "topbar");
  const back = el("button", "btn-ghost", "← Back");
  back.onclick = () => {
    state.conn?.close();
    state.conn = null;
    renderP2P();
  };
  top.appendChild(back);
  top.appendChild(el("h1", undefined, "Host"));
  app.appendChild(top);

  const card = el("div", "card");
  card.appendChild(statusEl());
  card.appendChild(
    el("p", "hint-text", "You play Black (move first). Generating an invite code…"),
  );

  // Step 1: offer
  const step1 = el("div", "step");
  const lbl1 = el("div", "step-label");
  lbl1.appendChild(el("span", "step-num", "1"));
  lbl1.appendChild(document.createTextNode("Copy the invite code and send it to your friend"));
  step1.appendChild(lbl1);
  const offerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  offerBox.readOnly = true;
  offerBox.value = "Generating…";
  step1.appendChild(offerBox);
  const r1 = el("div", "row gap-top");
  r1.appendChild(copyButton(() => offerBox.value));
  step1.appendChild(r1);
  card.appendChild(step1);

  // Step 2: answer
  const step2 = el("div", "step");
  const lbl2 = el("div", "step-label");
  lbl2.appendChild(el("span", "step-num", "2"));
  lbl2.appendChild(document.createTextNode("Paste the answer code from your friend"));
  step2.appendChild(lbl2);
  const answerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  answerBox.placeholder = "Paste the answer code here…";
  step2.appendChild(answerBox);
  const r2 = el("div", "row gap-top");
  const connectBtn = el("button", "btn-accent", "Connect") as HTMLButtonElement;
  connectBtn.onclick = async () => {
    try {
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting…";
      await state.conn!.acceptAnswer(answerBox.value);
      // hello so the joiner learns the host color
      const waitOpen = setInterval(() => {
        if (state.conn?.isOpen) {
          clearInterval(waitOpen);
          state.conn.send({ t: "hello", v: 1, hostColor: "B" });
          render();
        }
      }, 200);
    } catch (e) {
      showToast("Could not parse the answer code");
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect";
    }
  };
  r2.appendChild(connectBtn);
  step2.appendChild(r2);
  card.appendChild(step2);

  app.appendChild(card);

  try {
    const offer = await state.conn.createOffer();
    offerBox.value = offer;
  } catch (e) {
    offerBox.value = "Failed to generate offer: " + (e as Error).message;
  }
}

function renderJoinFlow() {
  state.conn = newPeer();
  state.myColor = "W"; // joiner plays white by default; corrected by hello

  app.innerHTML = "";
  const top = el("div", "topbar");
  const back = el("button", "btn-ghost", "← Back");
  back.onclick = () => {
    state.conn?.close();
    state.conn = null;
    renderP2P();
  };
  top.appendChild(back);
  top.appendChild(el("h1", undefined, "Join"));
  app.appendChild(top);

  const card = el("div", "card");
  card.appendChild(statusEl());

  // Step 1: paste offer
  const step1 = el("div", "step");
  const lbl1 = el("div", "step-label");
  lbl1.appendChild(el("span", "step-num", "1"));
  lbl1.appendChild(document.createTextNode("Paste the invite code from the host"));
  step1.appendChild(lbl1);
  const offerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  offerBox.placeholder = "Paste the invite code here…";
  step1.appendChild(offerBox);
  const r1 = el("div", "row gap-top");
  const genBtn = el("button", "btn-primary", "Generate answer") as HTMLButtonElement;
  r1.appendChild(genBtn);
  step1.appendChild(r1);
  card.appendChild(step1);

  // Step 2: answer output
  const step2 = el("div", "step");
  const lbl2 = el("div", "step-label");
  lbl2.appendChild(el("span", "step-num", "2"));
  lbl2.appendChild(document.createTextNode("Copy the answer code and send it to the host"));
  step2.appendChild(lbl2);
  const answerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  answerBox.readOnly = true;
  answerBox.placeholder = "The answer code will appear here…";
  step2.appendChild(answerBox);
  const r2 = el("div", "row gap-top");
  r2.appendChild(copyButton(() => answerBox.value));
  step2.appendChild(r2);
  card.appendChild(step2);

  card.appendChild(
    el("p", "hint-text", "You play White. The game starts as soon as the host pastes your answer."),
  );

  genBtn.onclick = async () => {
    try {
      genBtn.disabled = true;
      genBtn.textContent = "Generating…";
      const answer = await state.conn!.acceptOffer(offerBox.value);
      answerBox.value = answer;
      genBtn.textContent = "Done ✓";
    } catch (e) {
      showToast("Could not parse the invite code");
      genBtn.disabled = false;
      genBtn.textContent = "Generate answer";
    }
  };

  app.appendChild(card);
}

// ---- Game board ----

function renderGame() {
  app.innerHTML = "";

  const top = el("div", "topbar");
  const back = el("button", "btn-ghost", "← Menu");
  back.onclick = backToMenu;
  top.appendChild(back);

  if (state.mode === "hotseat" || state.mode === "ai") {
    const undoBtn = el("button", "btn-ghost", "↶ Undo") as HTMLButtonElement;
    undoBtn.disabled = !canUndo();
    undoBtn.onclick = undoMove;
    top.appendChild(undoBtn);

    // Hint: highlight the engine's suggested move without playing it.
    const label = state.hintCount > 0 ? `💡 Hint (${state.hintCount})` : "💡 Hint";
    const hintBtn = el("button", "btn-ghost", label) as HTMLButtonElement;
    hintBtn.disabled = !isMyTurn();
    hintBtn.title = "Highlight the move the AI considers best (does not play it)";
    hintBtn.onclick = requestHint;
    top.appendChild(hintBtn);
  }

  const s = score(state.board);
  const sb = el("div", "scoreboard");
  const pillB = el("div", `score-pill${state.turn === "B" ? " active" : ""}`);
  pillB.appendChild(el("span", "mini-disc B"));
  pillB.appendChild(document.createTextNode(String(s.B)));
  const pillW = el("div", `score-pill${state.turn === "W" ? " active" : ""}`);
  pillW.appendChild(el("span", "mini-disc W"));
  pillW.appendChild(document.createTextNode(String(s.W)));
  sb.appendChild(pillB);
  sb.appendChild(pillW);
  top.appendChild(sb);
  app.appendChild(top);

  // status line
  app.appendChild(renderStatusLine());

  // game over banner
  if (state.turn === null || isGameOver(state.board)) {
    app.appendChild(renderGameOverBanner());
  }

  // board
  const wrap = el("div", "board-wrap");
  const boardEl = el("div", "board");
  const myTurn = isMyTurn();
  const moves = state.turn ? legalMoves(state.board, state.turn) : [];
  const moveSet = new Set(moves.map((m) => index(m.row, m.col)));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const i = index(r, c);
      const cell = el("div", "cell");
      const occupant = state.board[i];

      const isLast =
        state.lastMove && state.lastMove.row === r && state.lastMove.col === c;
      if (isLast) cell.classList.add("last");

      const isHint = state.hint && state.hint.row === r && state.hint.col === c;

      if (occupant) {
        const disc = el("div", `disc ${occupant}`);
        if (state.flipped.has(i)) disc.classList.add("flip");
        cell.appendChild(disc);
      } else if (myTurn && moveSet.has(i)) {
        cell.classList.add("playable");
        cell.appendChild(el("div", "hint"));
        if (isHint) {
          cell.classList.add("suggested");
          cell.appendChild(el("div", "suggest-marker"));
        }
        cell.onclick = () => onCellClick({ row: r, col: c });
      }
      boardEl.appendChild(cell);
    }
  }
  wrap.appendChild(boardEl);
  app.appendChild(wrap);

  app.appendChild(renderFooter());
}

function isMyTurn(): boolean {
  if (state.turn === null) return false;
  if (state.mode === "hotseat") return true;
  if (state.mode === "ai") return state.turn === state.myColor && !state.aiThinking;
  if (state.mode === "p2p") return !!state.conn?.isOpen && state.turn === state.myColor;
  return false;
}

function colorName(p: Player): string {
  return p === "B" ? "Black" : "White";
}

/** Number of moves played so far (4 starting discs are not moves). */
function moveNumber(): number {
  const s = score(state.board);
  return s.B + s.W - 4;
}

function renderStatusLine(): HTMLElement {
  const line = el("div", "status");
  if (state.turn === null) {
    line.textContent = "Game over.";
    return line;
  }

  let text = "";
  if (state.mode === "hotseat") {
    text = `Turn: ${colorName(state.turn)}`;
  } else if (state.mode === "ai") {
    if (state.aiThinking) text = "Computer is thinking…";
    else text = state.turn === state.myColor ? "Your move (Black)" : "Computer's move";
  } else if (state.mode === "p2p") {
    const me = state.myColor ? `you are ${colorName(state.myColor)}` : "";
    if (!state.conn?.isOpen) {
      text = "Connecting…";
    } else if (state.turn === state.myColor) {
      text = `Your move (${me})`;
    } else {
      text = `Opponent's move · ${me}`;
    }
  }
  line.textContent = `${text} · move ${moveNumber()}`;
  return line;
}

function renderGameOverBanner(): HTMLElement {
  const banner = el("div", "banner win");
  const s = score(state.board);
  const w = winner(state.board);
  const left = el("div");
  let title = "";
  if (w === "draw") title = `Draw ${s.B}:${s.W}`;
  else title = `${colorName(w)} wins ${Math.max(s.B, s.W)}:${Math.min(s.B, s.W)}`;
  left.appendChild(el("div", "banner-title", title));

  let sub = "";
  if (state.mode === "ai") {
    if (w === state.myColor) sub = "You beat the computer!";
    else if (w === "draw") sub = "An even game.";
    else sub = "The computer was stronger this time.";
  } else if (state.mode === "p2p") {
    sub = w === state.myColor ? "You win!" : w === "draw" ? "A draw." : "Your opponent wins.";
  }
  if (sub) left.appendChild(el("div", "banner-sub", sub));
  banner.appendChild(left);

  const rematch = el("button", "btn-accent", "Rematch");
  rematch.onclick = () => {
    resetGame();
    if (state.mode === "p2p" && state.conn?.isOpen) {
      state.conn.send({ t: "rematch", v: 1 });
    }
    render();
    if (state.mode === "ai") maybeRunAI();
  };
  banner.appendChild(rematch);
  return banner;
}

// ---------- boot ----------

applyTheme(currentTheme);
render();
