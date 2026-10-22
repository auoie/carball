// The goal replay's recording of the live sounds (RA1 §1: heard again at their frames)
import { describe, expect, it } from "vitest";
import type { SoundEvent } from "../audio/detect";
import type { Impact } from "../engine/world";
import { vec3 } from "../math/vec";
import { type RecordedFrame, ReplayRecorder, replayedSound } from "./replayRecorder";

const AT = vec3(1, 2, 3);
const FRAME: RecordedFrame = {
  cars: new Map(),
  ball: { pos: AT, vel: AT, angVel: AT, rot: { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) } },
  ballExploded: false,
  lastTouchTeam: null,
};
const hit: SoundEvent = { kind: "ballBounce", at: AT, strength: 0.5 };
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
    r.sounds([hit]); // (the newest still 5)
    expect(r.soundsAt(3)).toEqual([]);
    r.record(5, FRAME);
    expect(r.soundsAt(5)).toEqual([hit, pad, hit]);
    r.sounds([hit]);
    expect(r.soundsAt(3)).toEqual([]);
    expect(r.soundsAt(5)).toHaveLength(4);
    // (overwritten a lap later)
    r.record(13, FRAME);
    expect(r.soundsAt(5)).toEqual([]);
    r.sounds([pad]);
    expect(r.soundsAt(13)).toEqual([pad]);
    expect(r.soundsAt(5)).toEqual([]);
    // (the ball's hits the replay finds in its frames, as corrected: not the live ones, RX29C)
    const ballHit: SoundEvent = { kind: "ballHit", at: AT, strength: 0.5 };
    expect(
      [hit, jump, pad, { kind: "flip", car: 1, at: AT }, { kind: "doubleJump", car: 1, at: AT }, ballHit].map((e) => replayedSound(e as SoundEvent)),
    ).toEqual([true, false, true, false, false, false]);
  });
});

describe("the replay's ball impacts", () => {
  it("keep each frame's strongest car–ball impact at the frame after its step; a frame recorded again drops its own", () => {
    const r = new ReplayRecorder(8);
    for (let f = 0; f < 6; f++) r.record(f, FRAME);
    const impact = (tick: number, speed: number, partner: Impact["partner"] = "ball"): Impact => ({
      tick,
      car: 1,
      partner,
      partnerId: -1,
      speed,
      pos: AT,
      normal: AT,
    });
    r.ballImpacts([impact(2, 300), impact(2, 900), impact(2, 400), impact(3, 2000, "world"), impact(3, 1500, "car"), impact(9, 700)]);
    expect(r.ballImpactAt(3)).toEqual({ speed: 900, at: AT }); // (tick 2's step: frame 3)
    expect(r.ballImpactAt(4)).toBeNull(); // (the world's and a car's: not the ball's)
    expect(r.ballImpactAt(10)).toBeNull(); // (a frame not recorded)
    r.record(3, FRAME);
    expect(r.ballImpactAt(3)).toBeNull();
    // (frames numbered apart from the ticks: online's)
    r.ballImpacts([impact(102, 650)], (tick) => tick + 1 - 100);
    expect(r.ballImpactAt(3)).toEqual({ speed: 650, at: AT });
  });
});
