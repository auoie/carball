// The goal replay's cars for their nameplates (HT-8, RV-279): where the replay draws them, between its recorded frames
import { describe, expect, it } from "vitest";
import type { CarWheels, Impact } from "../engine/world";
import type { SoundEvent } from "../audio/detect";
import { vec3 } from "../math/vec";
import { ReplayPlayback, type ReplayScene, flipResetCars, gatedBallHits, replayCarPositions } from "./replayPlayback";
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
    // (its jumps and dodges kept: the replay's own jump sounds come from them)
    const jumped = recordCar({ ...live, hasJumped: true, hasFlipped: true, doubleJumped: true });
    expect([jumped.hasJumped, jumped.hasFlipped, jumped.doubleJumped]).toEqual([true, true, true]);
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

describe("a goal replay's sounds: a spectator's view of the live ones (the user's decision, 2026-10-22)", () => {
  it("hears the live sounds of the frames it moves past once each, in order, slow motion or not; the goal as live", () => {
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 40; f++) {
      recorder.record(f, frame([[7, car(f, 0)]]));
      recorder.sounds([{ kind: "ballBounce", at: vec3(f, 0, 0), strength: 0.5 }]);
    }
    const heard: { sounds: readonly SoundEvent[] }[] = [];
    let goals = 0;
    const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: {
        flipReset: () => undefined,
        goal: () => {
          goals++;
        },
        replayFrame: (_cars: unknown, _camera: unknown, replay: { sounds: readonly SoundEvent[] }) => {
          heard.push({ sounds: replay.sounds });
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
    expect(goals).toBe(1); // (its explosion and horn, as the live goal's)
  });

  it("explodes in the colour of the team other than the net's, unless told (free play's: the garage's team)", () => {
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 20; f++) recorder.record(f, frame([[7, car(f, 0)]]));
    const exploded = (playback: ReplayPlayback): number[] => {
      const teams: number[] = [];
      const stub = (): object => new Proxy({}, { get: () => () => undefined });
      const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
      const scene = {
        renderer: stub(),
        arena: stub(),
        effects: { goal: (_at: unknown, team: number) => teams.push(team), update: () => undefined },
        audio: stub(),
        ballView: stub(),
        cars: [[7, view]],
        flipReset: { visual: false, audio: false },
      } as unknown as ReplayScene;
      for (let i = 0; i < 400 && !playback.done; i++) playback.frame(1 / 60, scene);
      return teams;
    };
    const plan = (scoringTeam: 0 | 1) => ({ startTick: 0, goalTick: 10, endTick: 20, scoringTeam, slomo: [], focus: [] });
    expect(exploded(new ReplayPlayback(plan(1), recorder))).toEqual([1]); // (orange scores in blue's net: orange's)
    expect(exploded(new ReplayPlayback(plan(0), recorder))).toEqual([0]);
    expect(exploded(new ReplayPlayback(plan(0), recorder, undefined, 1, 1))).toEqual([1]);
  });
});

describe("a goal replay's ball hits through the live trigger's gate (RX30C)", () => {
  it("are 50 uu/s or more into the ball, and 0.15 s of game time apart: a dribble's touch each tick isn't a hit each", () => {
    const at = vec3(0, 0, 93);
    const hit = (speed: number): SoundEvent => ({ kind: "ballHit", at, strength: speed / 1300 });
    const last = { frame: -Infinity };
    const heard: number[] = [];
    for (let f = 0; f < 40; f++) if (gatedBallHits([hit(650)], f, last).length > 0) heard.push(f);
    expect(heard).toEqual([0, 18, 36]); // (0.15 s at 120 a second: 18 frames)
    expect(gatedBallHits([hit(49)], 100, last)).toEqual([]);
    expect(gatedBallHits([hit(50)], 100, last)).toEqual([hit(50)]);
  });
});

describe("a goal replay's ball hits, the engine's impacts recorded at their frames, corrected ones too (RX29C)", () => {
  const impact = (tick: number, speed: number): Impact => ({
    tick,
    car: 1,
    partner: "ball",
    partnerId: -1,
    speed,
    pos: vec3(100, 0, 93),
    normal: vec3(1, 0, 0),
  });

  it("share one gate across the replay's frames: a dribble's touch at every frame heard 0.15 s apart (RX31)", () => {
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 50; f++) recorder.record(f, frame([[1, car(0, 0)]]));
    // (a touch into the ball at every tick from 10 to 49: frames 11 to 50)
    recorder.ballImpacts(Array.from({ length: 40 }, (_, i) => impact(10 + i, 650)));
    let hits = 0;
    const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: {
        flipReset: () => undefined,
        goal: () => undefined,
        replayFrame: (_cars: unknown, _camera: unknown, replay: { sounds: readonly SoundEvent[] }) => {
          hits += replay.sounds.filter((e) => e.kind === "ballHit").length;
        },
      },
      ballView: stub(),
      cars: [[1, view]],
      flipReset: { visual: false, audio: false },
    } as unknown as ReplayScene;
    const playback = new ReplayPlayback({ startTick: 10, goalTick: 30, endTick: 50, scoringTeam: 0, slomo: [], focus: [] }, recorder);
    for (let i = 0; i < 400 && !playback.done; i++) playback.frame(1 / 240, scene);
    expect(hits).toBe(3); // (frames 11, 29 and 47: 18 frames apart, as live)
  });

  it("are heard though no live sound was kept: a touch a correction put in the recording, as hard as its impact", () => {
    const recorder = new ReplayRecorder();
    for (let f = 0; f <= 50; f++) recorder.record(f, frame([[1, car(0, 0)]]));
    // (corrections: frames 20 and 40 recorded again with a touch the prediction had missed, its impact reported as they
    // were re-simulated; an impact before its frame's correction dropped with the frame recorded again)
    recorder.ballImpacts([impact(19, 2600)]);
    recorder.record(20, frame([[1, car(0, 0)]]));
    recorder.ballImpacts([impact(19, 650), impact(39, 1300)]);
    const heard: SoundEvent[] = [];
    const view = { root: { visible: true }, posesWheels: false, update: () => undefined, attach: () => undefined };
    const stub = (): object => new Proxy({}, { get: () => () => undefined });
    const scene = {
      renderer: stub(),
      arena: stub(),
      effects: stub(),
      audio: {
        flipReset: () => undefined,
        goal: () => undefined,
        replayFrame: (_cars: unknown, _camera: unknown, replay: { sounds: readonly SoundEvent[] }) => {
          heard.push(...replay.sounds);
        },
      },
      ballView: stub(),
      cars: [[1, view]],
      flipReset: { visual: false, audio: false },
    } as unknown as ReplayScene;
    const playback = new ReplayPlayback({ startTick: 10, goalTick: 30, endTick: 50, scoringTeam: 0, slomo: [], focus: [] }, recorder);
    for (let i = 0; i < 400 && !playback.done; i++) playback.frame(1 / 240, scene);
    expect(heard.filter((e) => e.kind === "ballHit")).toEqual([
      { kind: "ballHit", at: vec3(100, 0, 93), strength: 0.5 },
      { kind: "ballHit", at: vec3(100, 0, 93), strength: 1 },
    ]);
  });
});
