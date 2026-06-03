// Thin wrapper around RTCPeerConnection + RTCDataChannel implementing the
// manual (copy/paste) signaling flow. Browser-only (uses WebRTC + DOM globals),
// so this module is not imported by the pure unit tests.

import { encodeSession, decodeSession } from "./signaling.ts";
import { encodeMessage, decodeMessage, type NetMessage } from "./protocol.ts";

const STUN_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export type ConnState = "new" | "connecting" | "connected" | "disconnected" | "failed";

export interface ConnectionHandlers {
  onMessage?: (msg: NetMessage) => void;
  onStateChange?: (state: ConnState) => void;
  onOpen?: () => void;
}

/**
 * Wait until ICE gathering is complete so the SDP we hand to the user already
 * contains all candidates (no trickle ICE needed for copy/paste signaling).
 */
function waitForIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    // Safety timeout: hand over whatever we have after 3s.
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 3000);
  });
}

export class PeerConnection {
  private pc: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private handlers: ConnectionHandlers;

  constructor(handlers: ConnectionHandlers = {}) {
    this.handlers = handlers;
    this.pc = new RTCPeerConnection(STUN_SERVERS);
    this.pc.addEventListener("connectionstatechange", () => {
      this.handlers.onStateChange?.(this.pc.connectionState as ConnState);
    });
  }

  private bindChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => this.handlers.onOpen?.();
    channel.onmessage = (ev) => {
      const msg = decodeMessage(ev.data);
      if (msg) this.handlers.onMessage?.(msg);
    };
  }

  /** HOST step 1: create the data channel + offer code to send to the friend. */
  async createOffer(): Promise<string> {
    const channel = this.pc.createDataChannel("reversi", { ordered: true });
    this.bindChannel(channel);
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    await waitForIceComplete(this.pc);
    const local = this.pc.localDescription!;
    return encodeSession({ type: "offer", sdp: local.sdp });
  }

  /** HOST step 2: accept the answer code pasted back from the friend. */
  async acceptAnswer(code: string): Promise<void> {
    const { sdp } = decodeSession(code);
    await this.pc.setRemoteDescription({ type: "answer", sdp });
  }

  /** JOINER: accept the host's offer code and produce an answer code to send back. */
  async acceptOffer(code: string): Promise<string> {
    const { sdp } = decodeSession(code);
    this.pc.ondatachannel = (ev) => this.bindChannel(ev.channel);
    await this.pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await waitForIceComplete(this.pc);
    const local = this.pc.localDescription!;
    return encodeSession({ type: "answer", sdp: local.sdp });
  }

  send(msg: NetMessage): void {
    if (this.channel && this.channel.readyState === "open") {
      this.channel.send(encodeMessage(msg));
    }
  }

  get isOpen(): boolean {
    return this.channel?.readyState === "open";
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}
