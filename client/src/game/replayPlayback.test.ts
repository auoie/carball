// The goal replay's cars for their nameplates (HT-8, RV-279): where the replay draws them, between its recorded frames
import { describe, expect, it } from "vitest";
import type { CarWheels } from "../engine/world";
import type { SoundEvent } from "../audio/detect";
import { vec3 } from "../math/vec";
import { ReplayPlayback, type ReplayScene, ballHits, flipResetCars, replayCarPositions } from "./replayPlayback";
import { type RecordedCar, type RecordedFrame, ReplayRecorder, recordCar } from "./replayRecorder";

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
  hasJumped: false,
  hasFlipped: false,
  doubleJumped: false,
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

describe("a Blender car's wheels in a replay (RV-581)", () => {
  it("recorded with the car's vehicle, and drawn from the recording, else at rest by its contact", () => {
    const wheels: CarWheels = { suspension: [1, 2, 3, 4], steer: [0.1, 0.1, 0, 0] };
    const live = { ...car(0, 0), spawnCount: 0, boost: 33 } as unknown as Parameters<typeof recordCar>[0];
    expect(recordCar(live, wheels).wheels).toBe(wheels);
    expect("wheels" in recordCar(live)).toBe(false);
    // (a replay of two frames, one car whose view poses its wheels)
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 10; f++) recorder.record(f, frame([[7, f < 5 ? { ...car(f, 0), wheels } : car(f, 0)]]));
    const drawn: unknown[] = [];
    const rested: unknown[] = [];
    const view = {
      root: { visible: true },
      posesWheels: true,
      set wheels(w: unknown) {
        drawn.push(w);
      },
      replayWheels: (contact: unknown) => rested.push(contact),
      update: () => undefined,
    };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: stub(),
      ballView: stub(),
      cars: [[7, view]],
      flipReset: { visual: false, audio: false },
    } as unknown as ReplayScene;
    const playback = new ReplayPlayback({ startTick: 0, goalTick: 8, endTick: 10, scoringTeam: 0, slomo: [], focus: [] }, recorder);
    playback.frame(0.001, scene);
    expect(drawn).toEqual([{ ...wheels, contact: [true, true, true, true] }]);
    // (past the frames recorded with them: at rest by the recorded contact)
    for (let i = 0; i < 20 && rested.length === 0; i++) playback.frame(0.05, scene);
    expect(rested[0]).toEqual([true, true, true, true]);
  });
});

describe("a replayed flip reset's chime (the user's report, 2026-10-18)", () => {
  it("plays at the car's place, heard from the replay's camera (SND-9), not up close", () => {
    const recorder = new ReplayRecorder();
    // (car 7's flip resets go up between frames 4 and 5, at x 5)
    for (let f = 0; f <= 10; f++) recorder.record(f, frame([[7, car(f, 0, false, f < 5 ? 0 : 1)]]));
    const chimes: unknown[] = [];
    const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: {
        flipReset: (at?: unknown) => {
          chimes.push(at);
        },
        replayFrame: () => undefined,
      },
      ballView: stub(),
      cars: [[7, view]],
      flipReset: { visual: false, audio: true },
    } as unknown as ReplayScene;
    const playback = new ReplayPlayback({ startTick: 0, goalTick: 8, endTick: 10, scoringTeam: 0, slomo: [], focus: [] }, recorder);
    for (let i = 0; i < 40 && chimes.length === 0; i++) playback.frame(0.02, scene);
    expect(chimes).toHaveLength(1);
    expect(chimes[0]).toEqual(vec3(5, 0, 17));
  });
});

describe("a goal replay's sounds (RA1)", () => {
  it("hears the live sounds of the frames it moves past once each, in order, with its LiveReplay state; the goal's explosion again", () => {
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 40; f++) {
      recorder.record(f, frame([[7, car(f, 0)]]));
      recorder.sounds([{ kind: "ballBounce", at: vec3(f, 0, 0), strength: 0.5 }]);
    }
    const heard: { sounds: readonly SoundEvent[]; state: string }[] = [];
    let goals = 0;
    const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: {
        flipReset: () => undefined,
        replayGoal: () => {
          goals++;
        },
        replayFrame: (_cars: unknown, _camera: unknown, replay: { sounds: readonly SoundEvent[]; state: string }) => {
          heard.push({ sounds: replay.sounds, state: replay.state });
        },
      },
      ballView: stub(),
      cars: [[7, view]],
      flipReset: { visual: false, audio: false },
    } as unknown as ReplayScene;
    const playback = new ReplayPlayback({ startTick: 10, goalTick: 30, endTick: 40, scoringTeam: 0, slomo: [[20, 24]], focus: [] }, recorder);
    for (let i = 0; i < 400 && !playback.done; i++) playback.frame(1 / 240, scene);
    const xs = heard.flatMap((h) => h.sounds.map((e) => e.at.x));
    expect(xs).toEqual(Array.from({ length: 30 }, (_, i) => 11 + i)); // (after the first frame shown, to the end)
    expect(goals).toBe(1);
    const states = heard.map((h) => h.state).filter((s, i, all) => s !== all[i - 1]);
    expect(states).toEqual(["preScore", "slomo", "preScore", "postGoal"]);
  });
});

describe("a goal replay's ball hits, from its frames as corrected (RX29C)", () => {
  // (the car at x 0, the ball 100 ahead of it on x: the normal +x)
  const touched = (touch: number | null, carVx: number, demoed = false, carY = 0): RecordedFrame => ({
    ...frame([[1, { ...car(0, 0, demoed), pos: vec3(0, carY, 17), vel: vec3(carVx, 0, 0), lastTouch: touch }]]),
    ball: { pos: vec3(100, 0, 17), vel: ZERO, angVel: ZERO, rot: UPRIGHT },
  });
  const hit = (strength: number): SoundEvent[] => [{ kind: "ballHit", at: vec3(100, 0, 17), strength }];

  it("are each car's last touch moving on, at the ball, as hard as the game's intensity: the speed into each other", () => {
    const last = new Map<number, number | null>();
    expect(ballHits(last, touched(null, 0), touched(40, 0))).toEqual([]); // (a car first seen: noted)
    expect(ballHits(last, touched(40, 0), touched(40, 0))).toEqual([]);
    // (the car into the ball at 650 along the normal: half the scale's 1300; at 2600, full)
    expect(ballHits(last, touched(40, 650), touched(52, 650))).toEqual(hit(0.5));
    expect(ballHits(last, touched(52, 2600), touched(60, 2600))).toEqual(hit(1));
    // (across the normal: the car beside the ball's line, moving along x, the normal tilted: less)
    const glancing = ballHits(last, touched(60, 650, false, 100), touched(61, 650))[0] as { strength: number };
    expect(glancing.strength).toBeCloseTo(0.5 * Math.SQRT1_2);
    expect(ballHits(last, touched(61, 650), touched(70, 650, true))).toEqual([]); // (a wreck's: none)
  });

  it("are heard though no live sound was kept: a touch a correction put in the recording", () => {
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 40; f++) recorder.record(f, touched(null, 650));
    // (corrections: frames 20 on recorded again with a touch the prediction had missed, then 30 on with another; no live
    // sound kept for either)
    for (let f = 20; f <= 40; f++) recorder.record(f, touched(20, 650));
    for (let f = 30; f <= 40; f++) recorder.record(f, touched(30, 650));
    const heard: SoundEvent[] = [];
    const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: {
        flipReset: () => undefined,
        replayGoal: () => undefined,
        replayFrame: (_cars: unknown, _camera: unknown, replay: { sounds: readonly SoundEvent[] }) => {
          heard.push(...replay.sounds);
        },
      },
      ballView: stub(),
      cars: [[1, view]],
      flipReset: { visual: false, audio: false },
    } as unknown as ReplayScene;
    const playback = new ReplayPlayback({ startTick: 10, goalTick: 30, endTick: 40, scoringTeam: 0, slomo: [], focus: [] }, recorder);
    for (let i = 0; i < 400 && !playback.done; i++) playback.frame(1 / 240, scene);
    expect(heard.filter((e) => e.kind === "ballHit")).toHaveLength(2);
  });
});
