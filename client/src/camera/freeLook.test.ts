// The free look's rate against the static session's vectors (out/bsim/agents/K2/work/fl_vectors.py, 120 fps).
import { describe, expect, it } from "vitest";
import { type FreeLookAxes, FreeLookRate, freeLookStick } from "./freeLook";

const PAD = { smoothing: true, accelRate: 5.8, decelRate: 10.8, freeLookSpeed: 2.5 };
const run = (frames: readonly FreeLookAxes[], settings = PAD): number[] => {
  const rate = new FreeLookRate();
  return frames.map((axes) => rate.update(1 / 120, axes, settings).yaw);
};
const sum = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0);
const stick = (yaw: number): FreeLookAxes => ({ pitch: 0, yaw, source: "stick" });

describe("free look", () => {
  it("full stick for a second turns 20745 units (114°), then 22910 once let go for a second", () => {
    const held = run(Array.from({ length: 120 }, () => stick(1)));
    expect(sum(held)).toBe(20745);
    expect(sum(run([...Array.from({ length: 120 }, () => stick(1)), ...Array.from({ length: 120 }, () => stick(0))]))).toBe(22910);
  });

  it("without smoothing a full stick turns 24960 units a second", () => {
    expect(sum(run(Array.from({ length: 120 }, () => stick(1)), { ...PAD, smoothing: false }))).toBe(24960);
  });

  it("100 mouse counts in one frame (sensitivity 10, FOV 90, Modern accel 10.8) turn 2036 units: 178, 163, 149, …", () => {
    const frames: FreeLookAxes[] = [{ pitch: 0, yaw: 1000, source: "mouse" }, ...Array.from({ length: 239 }, () => ({ pitch: 0, yaw: 0, source: "mouse" as const }))];
    const offsets = run(frames, { ...PAD, accelRate: 10.8 });
    expect(offsets.slice(0, 3)).toEqual([178, 163, 149]);
    expect(sum(offsets)).toBe(2036);
  });

  it("a stick's free look cuts at its deadzone without rescaling", () => {
    expect(freeLookStick(0.1, 0.1)).toBe(0);
    expect(freeLookStick(0.11, 0.1)).toBe(0.11);
    expect(freeLookStick(-1.2, 0.1)).toBe(-1);
  });
});
