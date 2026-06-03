import { describe, it, expect } from "vitest";
import {
  encodeMessage,
  decodeMessage,
  validateReceivedMove,
  PROTOCOL_VERSION,
  type NetMessage,
  type MoveMessage,
} from "./protocol.ts";
import { encodeSession, decodeSession } from "./signaling.ts";
import { createInitialBoard, applyMove } from "../engine/reversi.ts";

describe("protocol encode/decode round-trip", () => {
  const cases: NetMessage[] = [
    { t: "move", v: PROTOCOL_VERSION, by: "B", row: 2, col: 3 },
    { t: "pass", v: PROTOCOL_VERSION, by: "W" },
    { t: "newgame", v: PROTOCOL_VERSION },
    { t: "rematch", v: PROTOCOL_VERSION },
    { t: "resign", v: PROTOCOL_VERSION, by: "B" },
    { t: "hello", v: PROTOCOL_VERSION, hostColor: "B" },
  ];

  for (const msg of cases) {
    it(`round-trips a ${msg.t} message`, () => {
      const encoded = encodeMessage(msg);
      expect(typeof encoded).toBe("string");
      const decoded = decodeMessage(encoded);
      expect(decoded).toEqual(msg);
    });
  }
});

describe("protocol decode rejects bad input", () => {
  it("rejects non-string", () => {
    expect(decodeMessage(42)).toBeNull();
    expect(decodeMessage(null)).toBeNull();
    expect(decodeMessage({ t: "move" })).toBeNull();
  });

  it("rejects invalid JSON", () => {
    expect(decodeMessage("{not json")).toBeNull();
  });

  it("rejects wrong protocol version", () => {
    expect(decodeMessage(JSON.stringify({ t: "move", v: 999, by: "B", row: 0, col: 0 }))).toBeNull();
  });

  it("rejects unknown message type", () => {
    expect(decodeMessage(JSON.stringify({ t: "explode", v: PROTOCOL_VERSION }))).toBeNull();
  });

  it("rejects move with invalid player", () => {
    expect(
      decodeMessage(JSON.stringify({ t: "move", v: PROTOCOL_VERSION, by: "X", row: 0, col: 0 })),
    ).toBeNull();
  });

  it("rejects move with out-of-range coordinates", () => {
    expect(
      decodeMessage(JSON.stringify({ t: "move", v: PROTOCOL_VERSION, by: "B", row: 8, col: 0 })),
    ).toBeNull();
    expect(
      decodeMessage(JSON.stringify({ t: "move", v: PROTOCOL_VERSION, by: "B", row: -1, col: 0 })),
    ).toBeNull();
    expect(
      decodeMessage(JSON.stringify({ t: "move", v: PROTOCOL_VERSION, by: "B", row: 1.5, col: 0 })),
    ).toBeNull();
  });

  it("rejects hello with invalid color", () => {
    expect(
      decodeMessage(JSON.stringify({ t: "hello", v: PROTOCOL_VERSION, hostColor: "Z" })),
    ).toBeNull();
  });
});

describe("received-move validation guard (never trust the peer)", () => {
  it("accepts a legal in-turn move", () => {
    const board = createInitialBoard();
    const msg: MoveMessage = { t: "move", v: PROTOCOL_VERSION, by: "B", row: 2, col: 3 };
    const result = validateReceivedMove(board, "B", msg);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pos).toEqual({ row: 2, col: 3 });
  });

  it("rejects an out-of-turn move", () => {
    const board = createInitialBoard();
    // It's Black's turn but White claims a move.
    const msg: MoveMessage = { t: "move", v: PROTOCOL_VERSION, by: "W", row: 2, col: 4 };
    const result = validateReceivedMove(board, "B", msg);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("out-of-turn");
  });

  it("rejects an illegal move even if it is the right player's turn", () => {
    const board = createInitialBoard();
    // (0,0) flips nothing for Black.
    const msg: MoveMessage = { t: "move", v: PROTOCOL_VERSION, by: "B", row: 0, col: 0 };
    const result = validateReceivedMove(board, "B", msg);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("illegal-move");
  });

  it("rejects replaying onto an occupied square", () => {
    const board = applyMove(createInitialBoard(), "B", { row: 2, col: 3 });
    // White's turn now; peer tries to move on a filled center square.
    const msg: MoveMessage = { t: "move", v: PROTOCOL_VERSION, by: "W", row: 3, col: 3 };
    const result = validateReceivedMove(board, "W", msg);
    expect(result.ok).toBe(false);
  });
});

describe("session (SDP) encode/decode", () => {
  it("round-trips an offer", () => {
    const sdp = "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n";
    const code = encodeSession({ type: "offer", sdp });
    expect(code).not.toContain("\n"); // single pasteable blob
    const back = decodeSession(code);
    expect(back).toEqual({ type: "offer", sdp });
  });

  it("round-trips an answer", () => {
    const code = encodeSession({ type: "answer", sdp: "v=0\r\nfoo" });
    expect(decodeSession(code)).toEqual({ type: "answer", sdp: "v=0\r\nfoo" });
  });

  it("throws on empty or garbage codes", () => {
    expect(() => decodeSession("")).toThrow();
    expect(() => decodeSession("!!!notbase64!!!")).toThrow();
  });
});
