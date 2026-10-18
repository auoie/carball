// The goal replay's cars for their nameplates (HT-8, RV-279): where the replay draws them, between its recorded frames
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { ReplayPlayback, type ReplayScene, flipResetCars, replayCarPositions } from "./replayPlayback";
import { type RecordedCar, type RecordedFrame, ReplayRecorder } from "./replayRecorder";

const ZERO = vec3(0, 0, 0);
const UPRIGHT = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };
const car = (x: number, team: 0 | 1, demoed = false, flipResets = 0): RecordedCar => ({
  pos: vec3(x, 0, 17),
  vel: ZERO,
  angVel: ZERO,
  rot: UPRIGHT,
  team,
  boosting: false,
  demoed,
  supersonic: false,
  wheelContact: [true, true, true, true],
  flipResets,
});
const frame = (cars: [number, RecordedCar][]): RecordedFrame => ({
  cars: new Map(cars),
  ball: { pos: ZERO, vel: ZERO, angVel: ZERO, rot: UPRIGHT },
  ballExploded: false,
  lastTouchTeam: null,
});

describe("the goal replay's cars (RV-279)", () => {
  it("are where it draws them, between its frames, the demolished left out", () => {
    const a = frame([
      [1, car(0, 0)],
      [2, car(100, 1)],
      [3, car(500, 1, true)],
    ]);
    const b = frame([
      [1, car(40, 0)],
      [2, car(100, 1)],
      [3, car(500, 1, true)],
    ]);
    const at = replayCarPositions(a, b, 0.25);
    expect([...at.keys()]).toEqual([1, 2]);
    expect(at.get(1)).toEqual({ pos: vec3(10, 0, 17), team: 0 });
    expect(at.get(2)?.team).toBe(1);
  });
});

describe("the goal replay's flip resets (HUD-19: replays play every car's)", () => {
  it("are the cars whose count goes up in the replayed window: once each, not at the first frame, not the demolished", () => {
    const last = new Map<number, number>();
    // (the first frame: each car's count only noted, whatever it is)
    expect([
      ...flipResetCars(
        last,
        frame([
          [1, car(0, 0, false, 3)],
          [2, car(100, 1, false, 0)],
        ]),
      ),
    ]).toEqual([]);
    // (car 2's goes up: its reset; the same frame again (slow motion) plays nothing more)
    const reset = frame([
      [1, car(0, 0, false, 3)],
      [2, car(100, 1, false, 1)],
    ]);
    expect([...flipResetCars(last, reset)]).toEqual([2]);
    expect([...flipResetCars(last, reset)]).toEqual([]);
    // (both up, car 1 demolished in that frame: car 2's alone)
    expect([
      ...flipResetCars(
        last,
        frame([
          [1, car(0, 0, true, 4)],
          [2, car(100, 1, false, 2)],
        ]),
      ),
    ]).toEqual([2]);
    // (a car first seen later only starts its count)
    expect([...flipResetCars(last, frame([[3, car(0, 1, false, 5)]]))]).toEqual([]);
  });
});

describe("a goal replay beginning before this page's recording (its page still loading as the match went on)", () => {
  it("holds the cars as first recorded till the recording begins, not an empty field (their plates shown)", () => {
    const recorder = new ReplayRecorder();
    for (let f = 100; f <= 220; f++) recorder.record(f, frame([[7, car(f, 0)]]));
    expect(recorder.after(40)).toBe(recorder.at(100));
    expect(recorder.after(40, 30)).toBeUndefined();
    const plan = { startTick: 50, goalTick: 150, endTick: 220, scoringTeam: 0, slomo: [], focus: [] };
    const playback = new ReplayPlayback(plan, recorder);
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: stub(),
      ballView: stub(),
      cars: [],
      flipReset: { visual: false, audio: false },
    } as unknown as ReplayScene;
    playback.frame(0.01, scene);
    expect(playback.tick).toBeLessThan(100);
    // (the car at its first recorded place, x 100: the recording's first frame held)
    expect([...playback.cars.entries()].map(([id, c]) => [id, c.pos.x])).toEqual([[7, 100]]);
  });
});
