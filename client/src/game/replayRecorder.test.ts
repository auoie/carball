// The goal replay's recording of the live sounds (RA1 §1: heard again at their frames)
import { describe, expect, it } from "vitest";
import type { SoundEvent } from "../audio/detect";
import { vec3 } from "../math/vec";
import { type RecordedFrame, ReplayRecorder, replayedSound } from "./replayRecorder";

const AT = vec3(1, 2, 3);
const FRAME: RecordedFrame = {
  cars: new Map(),
  ball: { pos: AT, vel: AT, angVel: AT, rot: { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) } },
  ballExploded: false,
  lastTouchTeam: null,
};
const hit: SoundEvent = { kind: "ballHit", at: AT, strength: 0.5 };
const jump: SoundEvent = { kind: "jump", car: 1, at: AT };
const pad: SoundEvent = { kind: "pad", big: true, at: AT };

describe("the replay's sounds", () => {
  it("keeps a frame's sounds at the newest frame recorded, not the jumps and dodges (the replay finds those itself)", () => {
    const r = new ReplayRecorder(8);
    r.sounds([hit]); // (nothing recorded yet: nowhere to keep it)
    r.record(5, FRAME);
    r.sounds([hit, jump]);
    r.sounds([pad]);
    expect(r.soundsAt(5)).toEqual([hit, pad]);
    expect(r.soundsAt(4)).toEqual([]);
    // (a correction recording an older frame again: the sounds stay, and new ones go to the newest)
    r.record(3, FRAME);
    r.record(5, FRAME);
    expect(r.soundsAt(5)).toEqual([hit, pad]);
    r.sounds([hit]);
    expect(r.soundsAt(3)).toEqual([]);
    expect(r.soundsAt(5)).toHaveLength(3);
    // (overwritten a lap later)
    r.record(13, FRAME);
    expect(r.soundsAt(5)).toEqual([]);
    r.sounds([pad]);
    expect(r.soundsAt(13)).toEqual([pad]);
    expect(r.soundsAt(5)).toEqual([]);
    expect([hit, jump, pad, { kind: "flip", car: 1, at: AT }, { kind: "doubleJump", car: 1, at: AT }].map((e) => replayedSound(e as SoundEvent))).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });
});
