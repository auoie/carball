import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BIT_AIR_PITCH_SAFETY,
  BIT_BOOST,
  BIT_HANDBRAKE,
  BIT_JUMP,
  type ControlMessage,
  type DatagramMessage,
  DecodeError,
  decodeControl,
  welcomeVersion,
  decodeDatagram,
  dequantizeAxis,
  encodeControl,
  encodeDatagram,
  MAX_TICKET_BYTES,
  PROTOCOL_VERSION,
  quantizeAxis,
} from "./protocol";

// Shared with the Rust server's tests
const vectorsPath = fileURLToPath(new URL("../../../protocol/vectors.json", import.meta.url));
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
  protocolVersion: number;
  vectors: { channel: "control" | "datagram"; message: Record<string, unknown>; hex: string }[];
  dequantizedAxes: { bits: string[] };
};

const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g) ?? [], (b) => Number.parseInt(b, 16));

interface JsonFrame {
  throttle: number;
  steer: number;
  pitch: number;
  yaw: number;
  roll: number;
  dodgeForward: number;
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
  airPitchSafety: boolean;
}

function toMessage(m: Record<string, unknown>): ControlMessage | DatagramMessage {
  const bytes = (key: string): Uint8Array => Uint8Array.from(m[key] as number[]);
  // (64-bit values are decimal strings in the JSON)
  const big = (key: string): bigint => BigInt(m[key] as string);
  switch (m["type"]) {
    case "hello":
      return { ...(m as unknown as ControlMessage & { type: "hello" }), key: big("key"), token: big("token") };
    case "welcome":
      return { ...(m as unknown as ControlMessage & { type: "welcome" }), key: big("key"), matchId: big("matchId"), snapshot: bytes("snapshot") };
    case "world":
      return { ...(m as unknown as ControlMessage & { type: "world" }), snapshot: bytes("snapshot") };
    case "update":
      return { ...(m as unknown as DatagramMessage & { type: "update" }), state: bytes("state") };
    case "inputs":
      return {
        type: "inputs",
        timestamp: m["timestamp"] as number,
        sequence: m["sequence"] as number,
        firstFrame: m["firstFrame"] as number,
        frames: (m["frames"] as JsonFrame[]).map((f) => ({
          throttle: quantizeAxis(f.throttle),
          steer: quantizeAxis(f.steer),
          pitch: quantizeAxis(f.pitch),
          yaw: quantizeAxis(f.yaw),
          roll: quantizeAxis(f.roll),
          dodgeForward: quantizeAxis(f.dodgeForward),
          bits: (f.jump ? BIT_JUMP : 0) | (f.boost ? BIT_BOOST : 0) | (f.handbrake ? BIT_HANDBRAKE : 0) | (f.airPitchSafety ? BIT_AIR_PITCH_SAFETY : 0),
        })),
      };
    default:
      return m as unknown as ControlMessage;
  }
}

describe("protocol", () => {
  it("has the vectors of this version (RV-257)", () => {
    expect(vectors.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(vectors.vectors.find((v) => v.message["type"] === "hello")?.message["version"]).toBe(PROTOCOL_VERSION);
  });

  it("reads a welcome's version before its fields, whatever the version (RV-243, RV-262)", () => {
    // (version 11's welcome, its version set: shorter than ours, so it doesn't decode as ours)
    const v11 = hex("1500810b00030000007800000000010203000000010203").subarray(2);
    expect(welcomeVersion(v11)).toBe(11);
    expect(() => decodeControl(v11)).toThrow(DecodeError);
    const welcome = vectors.vectors.find((v) => v.message["type"] === "welcome");
    expect(welcomeVersion(hex(welcome?.hex ?? "").subarray(2))).toBe(PROTOCOL_VERSION);
    expect(welcomeVersion(Uint8Array.of(0x01, 11, 0))).toBeNull(); // (a hello)
    expect(welcomeVersion(Uint8Array.of(0x81, 11))).toBeNull(); // (too short)
  });

  it("matches the shared byte vectors", () => {
    for (const v of vectors.vectors) {
      const expected = hex(v.hex);
      const message = toMessage(v.message);
      if (v.channel === "control") {
        const m = message as ControlMessage;
        expect(encodeControl(m)).toEqual(expected);
        const decoded = decodeControl(expected.subarray(2));
        if (m.type === "hello") {
          // f32 fields come back as the nearest float32
          expect(decoded).toMatchObject({ ...m, dodgeDeadzone: Math.fround(m.dodgeDeadzone) });
        } else {
          expect(decoded).toEqual(m);
        }
      } else {
        expect(encodeDatagram(message as DatagramMessage)).toEqual(expected);
        expect(decodeDatagram(expected)).toEqual(message);
      }
    }
  });

  it("dequantizes axes to the same float32 values as the server", () => {
    expect(vectors.dequantizedAxes.bits).toHaveLength(256);
    vectors.dequantizedAxes.bits.forEach((bits, i) => {
      const q = i - 128;
      const view = new DataView(new ArrayBuffer(4));
      view.setFloat32(0, dequantizeAxis(q));
      expect(view.getUint32(0).toString(16).padStart(8, "0")).toBe(bits);
      expect(quantizeAxis(dequantizeAxis(q))).toBe(q);
    });
  });

  it("quantizes like the game: 1/127 steps above zero, 1/128 below, halves up, clamped", () => {
    expect(quantizeAxis(-0.5)).toBe(-64);
    expect(quantizeAxis(0.5)).toBe(64);
    expect(quantizeAxis(-0.7)).toBe(-90);
    expect(quantizeAxis(0.7)).toBe(89);
    expect(quantizeAxis(-63.5 / 128)).toBe(-63);
    expect(quantizeAxis(63.5 / 127)).toBe(64);
    expect(quantizeAxis(2)).toBe(127);
    expect(quantizeAxis(-2)).toBe(-128);
    expect(quantizeAxis(-0.001)).toBe(0);
  });

  it("reads a Pong's server name; one from a server from before the name, none; a name past 64 bytes, an error (RV-887's K02-K04)", () => {
    expect(decodeControl(Uint8Array.of(0x93))).toEqual({ type: "pong", server: "" });
    const named = encodeControl({ type: "pong", server: "game-eu.example:4433" });
    expect(decodeControl(named.subarray(2))).toEqual({ type: "pong", server: "game-eu.example:4433" });
    expect(() => decodeControl(Uint8Array.of(0x93, 65, ...new Uint8Array(65)))).toThrow();
    // (a name past the cap sent empty)
    expect(decodeControl(encodeControl({ type: "pong", server: "h".repeat(65) }).subarray(2))).toEqual({ type: "pong", server: "" });
  });

  it("rejects malformed messages", () => {
    expect(() => decodeDatagram(new Uint8Array([]))).toThrow(DecodeError);
    expect(() => decodeDatagram(new Uint8Array([0x01, 1, 2]))).toThrow(DecodeError);
    expect(() => decodeDatagram(new Uint8Array([0x7f]))).toThrow(DecodeError);
    expect(() => decodeControl(new Uint8Array([0x81, 1]))).toThrow(DecodeError);
  });

  it("caps a hello's ticket at MAX_TICKET_BYTES both ways: a longer one sent empty, read as an error", () => {
    const vector = vectors.vectors.find((v) => v.message["type"] === "hello");
    const hello = { ...(toMessage(vector?.message ?? {}) as ControlMessage & { type: "hello" }), ticket: "A".repeat(MAX_TICKET_BYTES) };
    const whole = encodeControl(hello).subarray(2);
    expect(decodeControl(whole)).toMatchObject({ ticket: hello.ticket });
    expect(decodeControl(encodeControl({ ...hello, ticket: "A".repeat(MAX_TICKET_BYTES + 1) }).subarray(2))).toMatchObject({ ticket: "" });
    // (one byte more, written by hand: its count little-endian, then its bytes)
    const long = new Uint8Array(whole.byteLength + 1);
    long.set(whole.subarray(0, whole.byteLength - MAX_TICKET_BYTES - 2));
    long.set([(MAX_TICKET_BYTES + 1) & 0xff, (MAX_TICKET_BYTES + 1) >> 8], whole.byteLength - MAX_TICKET_BYTES - 2);
    long.fill(0x41, whole.byteLength - MAX_TICKET_BYTES);
    expect(() => decodeControl(long)).toThrow(/ticket too long/);
    // (the cap holds a version 3 ticket with the longest name, 267 characters, with room: the server's the same, RX31)
    const longest = "A".repeat(300);
    expect(decodeControl(encodeControl({ ...hello, ticket: longest }).subarray(2))).toMatchObject({ ticket: longest });
  });
});
