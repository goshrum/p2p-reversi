// Compact, copy/paste-friendly encoding of WebRTC SDP session descriptions.
// Pure functions (just string + base64 transforms), so they are unit-testable.

export interface SessionPayload {
  type: "offer" | "answer";
  sdp: string;
}

/**
 * Base64-encode a string with UTF-8 safety, working in both browser and Node.
 * SDP is ASCII in practice but we stay correct for any input.
 */
function toBase64(s: string): string {
  if (typeof btoa === "function") {
    // Encode UTF-8 then base64.
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(s, "utf-8").toString("base64");
}

function fromBase64(b64: string): string {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf-8");
}

/**
 * Encode a session description (offer/answer) into a single compact code string
 * the user can copy and paste. We JSON-stringify then base64 to keep it on one
 * blob with no newlines that could be mangled by chat apps.
 */
export function encodeSession(payload: SessionPayload): string {
  return toBase64(JSON.stringify({ t: payload.type, s: payload.sdp }));
}

/** Decode a pasted code back into a session description. Throws on garbage. */
export function decodeSession(code: string): SessionPayload {
  const trimmed = code.trim();
  if (!trimmed) throw new Error("Empty code");
  const json = fromBase64(trimmed);
  const obj = JSON.parse(json) as { t?: unknown; s?: unknown };
  if ((obj.t !== "offer" && obj.t !== "answer") || typeof obj.s !== "string") {
    throw new Error("Invalid session code");
  }
  return { type: obj.t, sdp: obj.s };
}
