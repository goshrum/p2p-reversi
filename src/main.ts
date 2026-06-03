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
} from "./engine/reversi.ts";
import { chooseMove } from "./engine/ai.ts";
import { PeerConnection, type ConnState } from "./net/connection.ts";
import { validateReceivedMove, type NetMessage } from "./net/protocol.ts";

type Mode = "menu" | "p2p" | "ai" | "hotseat";

interface State {
  mode: Mode;
  board: Board;
  turn: Player | null; // null => game over
  lastMove: Position | null;
  flipped: Set<number>; // indices flipped on the last move (for animation)
  // P2P
  myColor: Player | null; // which color the local human controls (P2P / AI)
  conn: PeerConnection | null;
  connState: ConnState;
  // AI
  aiThinking: boolean;
}

const app = document.getElementById("app")!;

const state: State = {
  mode: "menu",
  board: createInitialBoard(),
  turn: "B",
  lastMove: null,
  flipped: new Set(),
  myColor: null,
  conn: null,
  connState: "new",
  aiThinking: false,
};

const AI_DEPTH = 4;
const AI_COLOR: Player = "W"; // human is Black by default in vs-computer

// ---------- helpers ----------

function resetGame() {
  state.board = createInitialBoard();
  state.turn = "B";
  state.lastMove = null;
  state.flipped = new Set();
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
    showToast(`${passer === "B" ? "Чёрные" : "Белые"} пропускают ход (нет ходов)`);
  }
}

// ---------- local move application ----------

function localMakeMove(pos: Position, mover: Player) {
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
      const move = chooseMove(state.board, AI_COLOR, AI_DEPTH);
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
        showToast(`Получен некорректный ход от соперника (${check.reason}) — отклонён`);
        return;
      }
      localMakeMove(check.pos, msg.by);
      break;
    }
    case "resign": {
      showToast(`Соперник сдался. Победа за вами!`);
      state.turn = null;
      render();
      break;
    }
    case "newgame":
    case "rematch": {
      resetGame();
      showToast("Новая партия");
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
      "Отелло с другом напрямую через WebRTC. Без сервера, без регистрации, бесплатно.",
    ),
  );

  const modes = el("div", "modes");

  const defs: { mode: Mode; emoji: string; title: string; sub: string }[] = [
    {
      mode: "p2p",
      emoji: "🔗",
      title: "Играть с другом (P2P)",
      sub: "Прямое соединение по ссылке-коду. Сервера нет.",
    },
    {
      mode: "ai",
      emoji: "🤖",
      title: "Против компьютера",
      sub: "Минимакс с оценкой углов. Вы играете чёрными.",
    },
    {
      mode: "hotseat",
      emoji: "👥",
      title: "Вдвоём на одном устройстве",
      sub: "Ходите по очереди на этом экране.",
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

  const explainerCard = el("div", "card");
  explainerCard.innerHTML = `
    <details class="explainer">
      <summary>Как работает P2P без сервера?</summary>
      <ol>
        <li>Хост создаёт «код приглашения» (это его WebRTC-offer, упакованный в base64).</li>
        <li>Отправляет код другу любым способом (мессенджер, почта).</li>
        <li>Друг вставляет код и получает «ответный код», шлёт его обратно.</li>
        <li>Хост вставляет ответ — устанавливается прямой канал RTCDataChannel.</li>
      </ol>
      <p>Для обхода NAT используется бесплатный публичный STUN-сервер Google.
      Нет ни игрового, ни сигнального сервера: компьютеры обмениваются ходами напрямую.
      <strong>Важно:</strong> при строгом NAT/симметричном фаерволе без TURN соединение
      может не установиться (TURN платный, поэтому здесь его нет). В одной сети и на
      большинстве домашних подключений всё работает.</p>
    </details>
  `;
  app.appendChild(explainerCard);

  app.appendChild(renderFooter());
}

function renderFooter(): HTMLElement {
  const f = el("div", "footer");
  f.innerHTML = `Движок и протокол полностью покрыты юнит-тестами · MIT · 100% serverless`;
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
  const back = el("button", "btn-ghost", "← Меню");
  back.onclick = backToMenu;
  top.appendChild(back);
  top.appendChild(el("h1", undefined, "Игра с другом"));
  app.appendChild(top);

  if (state.conn?.isOpen) {
    renderGame();
    return;
  }

  const card = el("div", "card");
  card.appendChild(
    el("p", "hint-text", "Выберите роль. Один из вас — Хост, другой — Присоединяется."),
  );
  const row = el("div", "row gap-top");
  const hostBtn = el("button", "btn-primary", "Я хост (создать игру)");
  hostBtn.onclick = renderHostFlow;
  const joinBtn = el("button", "btn-accent", "Присоединиться по коду");
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
    new: "ожидание соединения…",
    connecting: "соединение…",
    connected: "соединено",
    disconnected: "соединение потеряно",
    failed: "не удалось соединиться (возможно строгий NAT без TURN)",
  };
  const s = el("div", `status ${cls}`);
  s.appendChild(el("span", "dot"));
  s.appendChild(document.createTextNode(labels[state.connState] ?? state.connState));
  return s;
}

function copyButton(getText: () => string): HTMLButtonElement {
  const btn = el("button", "btn-primary", "📋 Копировать") as HTMLButtonElement;
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
    btn.textContent = "✓ Скопировано";
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
  const back = el("button", "btn-ghost", "← Назад");
  back.onclick = () => {
    state.conn?.close();
    state.conn = null;
    renderP2P();
  };
  top.appendChild(back);
  top.appendChild(el("h1", undefined, "Хост"));
  app.appendChild(top);

  const card = el("div", "card");
  card.appendChild(statusEl());
  card.appendChild(
    el("p", "hint-text", "Вы играете чёрными (ходите первым). Генерируем код приглашения…"),
  );

  // Step 1: offer
  const step1 = el("div", "step");
  const lbl1 = el("div", "step-label");
  lbl1.appendChild(el("span", "step-num", "1"));
  lbl1.appendChild(document.createTextNode("Скопируйте код приглашения и отправьте другу"));
  step1.appendChild(lbl1);
  const offerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  offerBox.readOnly = true;
  offerBox.value = "Генерация…";
  step1.appendChild(offerBox);
  const r1 = el("div", "row gap-top");
  r1.appendChild(copyButton(() => offerBox.value));
  step1.appendChild(r1);
  card.appendChild(step1);

  // Step 2: answer
  const step2 = el("div", "step");
  const lbl2 = el("div", "step-label");
  lbl2.appendChild(el("span", "step-num", "2"));
  lbl2.appendChild(document.createTextNode("Вставьте ответный код от друга"));
  step2.appendChild(lbl2);
  const answerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  answerBox.placeholder = "Сюда вставьте ответный код…";
  step2.appendChild(answerBox);
  const r2 = el("div", "row gap-top");
  const connectBtn = el("button", "btn-accent", "Подключиться") as HTMLButtonElement;
  connectBtn.onclick = async () => {
    try {
      connectBtn.disabled = true;
      connectBtn.textContent = "Подключение…";
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
      showToast("Не удалось разобрать ответный код");
      connectBtn.disabled = false;
      connectBtn.textContent = "Подключиться";
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
    offerBox.value = "Ошибка генерации offer: " + (e as Error).message;
  }
}

function renderJoinFlow() {
  state.conn = newPeer();
  state.myColor = "W"; // joiner plays white by default; corrected by hello

  app.innerHTML = "";
  const top = el("div", "topbar");
  const back = el("button", "btn-ghost", "← Назад");
  back.onclick = () => {
    state.conn?.close();
    state.conn = null;
    renderP2P();
  };
  top.appendChild(back);
  top.appendChild(el("h1", undefined, "Присоединиться"));
  app.appendChild(top);

  const card = el("div", "card");
  card.appendChild(statusEl());

  // Step 1: paste offer
  const step1 = el("div", "step");
  const lbl1 = el("div", "step-label");
  lbl1.appendChild(el("span", "step-num", "1"));
  lbl1.appendChild(document.createTextNode("Вставьте код приглашения от хоста"));
  step1.appendChild(lbl1);
  const offerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  offerBox.placeholder = "Сюда вставьте код приглашения…";
  step1.appendChild(offerBox);
  const r1 = el("div", "row gap-top");
  const genBtn = el("button", "btn-primary", "Сгенерировать ответ") as HTMLButtonElement;
  r1.appendChild(genBtn);
  step1.appendChild(r1);
  card.appendChild(step1);

  // Step 2: answer output
  const step2 = el("div", "step");
  const lbl2 = el("div", "step-label");
  lbl2.appendChild(el("span", "step-num", "2"));
  lbl2.appendChild(document.createTextNode("Скопируйте ответный код и пошлите хосту"));
  step2.appendChild(lbl2);
  const answerBox = el("textarea", "code-box") as HTMLTextAreaElement;
  answerBox.readOnly = true;
  answerBox.placeholder = "Ответный код появится здесь…";
  step2.appendChild(answerBox);
  const r2 = el("div", "row gap-top");
  r2.appendChild(copyButton(() => answerBox.value));
  step2.appendChild(r2);
  card.appendChild(step2);

  card.appendChild(
    el("p", "hint-text", "Вы играете белыми. Как только хост вставит ответ — начнётся игра."),
  );

  genBtn.onclick = async () => {
    try {
      genBtn.disabled = true;
      genBtn.textContent = "Генерация…";
      const answer = await state.conn!.acceptOffer(offerBox.value);
      answerBox.value = answer;
      genBtn.textContent = "Готово ✓";
    } catch (e) {
      showToast("Не удалось разобрать код приглашения");
      genBtn.disabled = false;
      genBtn.textContent = "Сгенерировать ответ";
    }
  };

  app.appendChild(card);
}

// ---- Game board ----

function renderGame() {
  app.innerHTML = "";

  const top = el("div", "topbar");
  const back = el("button", "btn-ghost", "← Меню");
  back.onclick = backToMenu;
  top.appendChild(back);

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

      if (occupant) {
        const disc = el("div", `disc ${occupant}`);
        if (state.flipped.has(i)) disc.classList.add("flip");
        cell.appendChild(disc);
      } else if (myTurn && moveSet.has(i)) {
        cell.classList.add("playable");
        cell.appendChild(el("div", "hint"));
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
  return p === "B" ? "Чёрные" : "Белые";
}

function renderStatusLine(): HTMLElement {
  const line = el("div", "status");
  if (state.turn === null) {
    line.textContent = "Партия окончена.";
    return line;
  }

  let text = "";
  if (state.mode === "hotseat") {
    text = `Ход: ${colorName(state.turn)}`;
  } else if (state.mode === "ai") {
    if (state.aiThinking) text = "Компьютер думает…";
    else text = state.turn === state.myColor ? "Ваш ход (чёрные)" : "Ход компьютера";
  } else if (state.mode === "p2p") {
    const me = state.myColor ? `вы — ${colorName(state.myColor)}` : "";
    if (!state.conn?.isOpen) {
      text = "Соединение…";
    } else if (state.turn === state.myColor) {
      text = `Ваш ход (${me})`;
    } else {
      text = `Ход соперника · ${me}`;
    }
  }
  line.textContent = text;
  return line;
}

function renderGameOverBanner(): HTMLElement {
  const banner = el("div", "banner win");
  const s = score(state.board);
  const w = winner(state.board);
  const left = el("div");
  let title = "";
  if (w === "draw") title = `Ничья ${s.B}:${s.W}`;
  else title = `Победа: ${colorName(w)} ${Math.max(s.B, s.W)}:${Math.min(s.B, s.W)}`;
  left.appendChild(el("div", "banner-title", title));

  let sub = "";
  if (state.mode === "ai") {
    if (w === state.myColor) sub = "Вы обыграли компьютер!";
    else if (w === "draw") sub = "Равная игра.";
    else sub = "Компьютер сильнее в этот раз.";
  } else if (state.mode === "p2p") {
    sub = w === state.myColor ? "Вы победили!" : w === "draw" ? "Ничья." : "Соперник победил.";
  }
  if (sub) left.appendChild(el("div", "banner-sub", sub));
  banner.appendChild(left);

  const rematch = el("button", "btn-accent", "Реванш");
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

render();
