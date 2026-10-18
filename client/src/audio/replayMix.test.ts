// A goal replay's mix (RA1, SND-19): the LiveReplay state's offsets and transitions, Replay_InCameraView's curves, the
// replay's pickups' distance curve
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import {
  LiveReplayState,
  REPLAY_MIX,
  dbGain,
  inCameraView,
  inCameraViewDb,
  inCameraViewLpf,
  pickupDb,
  replayState,
  smoothInCameraView,
  transitionSeconds,
  wwiseFilterHz,
} from "./replayMix";

describe("the LiveReplay state (RA1 §4)", () => {
  it("is PreScore from the start, Slomo inside a slowed stretch, PreScore after it, PostGoal from the goal", () => {
    const plan = { goalTick: 1000, slomo: [[400, 460] as const, [970, 1000] as const] };
    expect(replayState(plan, 100)).toBe("preScore");
    expect(replayState(plan, 400)).toBe("preScore"); // (exclusive, as the dilation's)
    expect(replayState(plan, 430)).toBe("slomo");
    expect(replayState(plan, 500)).toBe("preScore");
    expect(replayState(plan, 990)).toBe("slomo");
    expect(replayState(plan, 1000)).toBe("postGoal");
    expect(replayState(plan, 1300)).toBe("postGoal");
  });

  it("moves over the state group's transition times", () => {
    expect(transitionSeconds("none", "preScore")).toBe(1);
    expect(transitionSeconds("none", "slomo")).toBe(1.5);
    expect(transitionSeconds("preScore", "slomo")).toBe(0.5);
    expect(transitionSeconds("slomo", "preScore")).toBe(1);
    expect(transitionSeconds("slomo", "postGoal")).toBe(3);
    expect(transitionSeconds("postGoal", "none")).toBe(1);
  });

  it("moves each bus's offsets linearly from where they are to the new state's", () => {
    const live = new LiveReplayState();
    expect(live.offsets("engine", 0)).toEqual({ db: 0, cents: 0, lpf: 0, hpf: 0 });
    live.set("preScore", 10);
    expect(live.offsets("engine", 10.5)).toEqual({ db: -2, cents: 0, lpf: 7.5, hpf: 0 });
    expect(live.offsets("engine", 11)).toEqual({ db: -4, cents: 0, lpf: 15, hpf: 0 });
    // (Slomo from PreScore in half a second: the ball's pitch down 700 cents, the others' pickups gone)
    live.set("slomo", 12);
    expect(live.offsets("ball", 12.25)).toEqual({ db: 0, cents: -350, lpf: 0, hpf: -20 });
    expect(live.offsets("pickup", 12.5).db).toBe(-108);
    expect(live.offsets("boost", 12.5)).toEqual({ db: 0, cents: -700, lpf: 20, hpf: 0 });
    // (a change midway starts from where it is: Slomo → PostGoal over 3 s)
    live.set("postGoal", 12.25);
    expect(live.offsets("ball", 12.25).cents).toBe(-350);
    expect(live.offsets("ball", 13.75).cents).toBeCloseTo(-175);
    expect(live.offsets("ball", 15.25)).toEqual({ db: -2, cents: 0, lpf: 0, hpf: 0 });
    // (the same state again changes nothing)
    live.set("postGoal", 15.25);
    expect(live.state).toBe("postGoal");
    expect(live.offsets("engine", 20)).toEqual({ db: -8, cents: 0, lpf: 5, hpf: 0 });
  });

  it("leaves movements, tyres, UI and the goal's events alone: no bus of theirs", () => {
    for (const state of Object.values(REPLAY_MIX))
      expect(Object.keys(state).every((g) => ["ball", "carImpact", "engine", "boost", "pickup", "ambient"].includes(g))).toBe(true);
    expect(REPLAY_MIX.slomo.carImpact?.db).toBe(-4);
    expect(REPLAY_MIX.preScore.carImpact).toBeUndefined();
  });
});

describe("Replay_InCameraView (RA1 §3)", () => {
  it("is the cosine between the camera's forward and the way to the car", () => {
    const camera = vec3(0, 0, 0);
    const forward = vec3(1, 0, 0);
    expect(inCameraView(vec3(500, 0, 0), camera, forward)).toBeCloseTo(1);
    expect(inCameraView(vec3(-500, 0, 0), camera, forward)).toBeCloseTo(-1);
    expect(inCameraView(vec3(0, 500, 0), camera, forward)).toBeCloseTo(0);
    expect(inCameraView(vec3(0, 0, 0), camera, forward)).toBeCloseTo(1); // (at the camera: as ahead)
  });

  it("turns a car's sounds down and filters them behind the camera, none within ~71.7° of its forward", () => {
    expect(inCameraViewDb(-1)).toBe(-27);
    expect(inCameraViewDb(0.1)).toBe(-15);
    expect(inCameraViewDb(0.31424)).toBeCloseTo(0.03);
    expect(inCameraViewDb(1)).toBe(0);
    expect(inCameraViewDb(-2)).toBe(-27);
    expect(Math.abs(inCameraViewDb(Math.cos((71 * Math.PI) / 180)))).toBeLessThan(0.05);
    // (Exp3 from −1: slow first; Log3 from 0.1: fast first)
    expect(inCameraViewDb(-0.45)).toBeCloseTo(-27 + 12 * 0.125);
    expect(inCameraViewDb(0.1 + 0.21424 / 2)).toBeCloseTo(-15 + 15.03 * (1 - 0.125));
    expect(inCameraViewLpf(-1)).toBe(20);
    expect(inCameraViewLpf(0.1)).toBe(10);
    expect(inCameraViewLpf(0.2)).toBeCloseTo(10 - 10 * (1 - (1 - 0.1 / 0.21424) ** 3));
    expect(inCameraViewLpf(0.5)).toBe(0);
  });

  it("follows the camera within 0.3 s (its filtering over time)", () => {
    expect(smoothInCameraView(1, -1, 0)).toBe(1);
    const settled = smoothInCameraView(1, -1, 0.3);
    expect(settled).toBeLessThan(-0.89);
    expect(settled).toBeGreaterThan(-1);
    // (frame by frame the same)
    let v = 1;
    for (let i = 0; i < 18; i++) v = smoothInCameraView(v, -1, 1 / 60);
    expect(v).toBeCloseTo(settled);
  });
});

describe("the replay's filters and pickups", () => {
  it("maps a Wwise filter value to its cutoff as the game's Wwise does (RA2): none to 0.1, linear to 30, then halving", () => {
    expect(wwiseFilterHz("lpf", 0)).toBeNull();
    expect(wwiseFilterHz("lpf", 0.1)).toBeNull();
    expect(wwiseFilterHz("lpf", -20)).toBeNull();
    expect(wwiseFilterHz("hpf", -10)).toBeNull();
    // (RA2's sample points, the exe's fast 2^x within 0.25%)
    const near = (got: number | null, want: number): void => {
      expect(Math.abs((got ?? 0) / want - 1)).toBeLessThan(0.0025);
    };
    near(wwiseFilterHz("lpf", 0.2), 20000 - 0.2 * 433.33334);
    near(wwiseFilterHz("lpf", 10), 15667);
    near(wwiseFilterHz("lpf", 25), 9167);
    near(wwiseFilterHz("lpf", 30), 7016);
    near(wwiseFilterHz("lpf", 50), 1247);
    near(wwiseFilterHz("lpf", 75), 144.5);
    near(wwiseFilterHz("lpf", 100), 16.8);
    near(wwiseFilterHz("lpf", 150), 16.8);
    // (the high-pass the same of 100 − its value)
    near(wwiseFilterHz("hpf", 10), 144.5 * 2 ** (-0.12432837 * 15)); // (as the low-pass at 90)
    near(wwiseFilterHz("hpf", 70), 7016);
    near(wwiseFilterHz("hpf", 100), 20000);
  });

  it("hears another car's pickup by its own distance curve, 5 dB down", () => {
    expect(pickupDb(0)).toBe(-5);
    expect(pickupDb(300)).toBe(-5);
    expect(pickupDb(1850)).toBe(-13);
    expect(pickupDb(5500)).toBe(-19);
    expect(pickupDb(14000)).toBe(-101);
    expect(pickupDb(1075)).toBeCloseTo(-9);
    expect(dbGain(-6)).toBeCloseTo(0.501, 3);
  });
});
