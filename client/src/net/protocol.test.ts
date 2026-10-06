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
  decodeDatagram,
  dequantizeAxis,
  encodeControl,
  encodeDatagram,
  quantizeAxis,
} from "./protocol";

// Shared with the Rust server's tests
const vectorsPath = fileURLToPath(new URL("../../../protocol/vectors.json", import.meta.url));
const vectors = JSON.parse(readFileSync(vectorsPath, "utf8")) as {
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
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
  airPitchSafety: boolean;
}

function toMessage(m: Record<string, unknown>): ControlMessage | DatagramMessage {
  const bytes = (key: string): Uint8Array => Uint8Array.from(m[key] as number[]);
  switch (m["type"]) {
    case "welcome":
      return { ...(m as unknown as ControlMessage & { type: "welcome" }), snapshot: bytes("snapshot") };
    case "world":
      return { ...(m as unknown as ControlMessage & { type: "world" }), snapshot: bytes("snapshot") };
    case "update":
      return { ...(m as unknown as DatagramMessage & { type: "update" }), state: bytes("state") };
    case "inputs":
      return {
        type: "inputs",
        timestamp: m["timestamp"] as number,
        firstFrame: m["firstFrame"] as number,
        frames: (m["frames"] as JsonFrame[]).map((f) => ({
          throttle: quantizeAxis(f.throttle),
          steer: quantizeAxis(f.steer),
          pitch: quantizeAxis(f.pitch),
          yaw: quantizeAxis(f.yaw),
          roll: quantizeAxis(f.roll),
          bits:
            (f.jump ? BIT_JUMP : 0) | (f.boost ? BIT_BOOST : 0) | (f.handbrake ? BIT_HANDBRAKE : 0) | (f.airPitchSafety ? BIT_AIR_PITCH_SAFETY : 0),
        })),
      };
    default:
      return m as unknown as ControlMessage;
  }
}

describe("protocol", () => {
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

  it("rejects malformed messages", () => {
    expect(() => decodeDatagram(new Uint8Array([]))).toThrow(DecodeError);
    expect(() => decodeDatagram(new Uint8Array([0x01, 1, 2]))).toThrow(DecodeError);
    expect(() => decodeDatagram(new Uint8Array([0x7f]))).toThrow(DecodeError);
    expect(() => decodeControl(new Uint8Array([0x81, 1]))).toThrow(DecodeError);
  });
});
