// A goal replay's ball hits against the live game's on the same simulated frames, the real engine (RX30C's measure): the
// replay's from the recording (the engine's car–ball impacts kept at their frames: ReplayRecorder.ballImpacts) through
// the live trigger's gate (gatedBallHits: 50 uu/s, the ball's 0.15 s cooldown), the live from the same impacts through
// ImpactTriggers. SND-19: the game's replay re-runs the same impact code, so the same hits at the same frames
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { type CarConfig, NO_CONTROLS, World, initEngine } from "../engine/world";
import { ZERO, vec3 } from "../math/vec";
import { arenaMeshes } from "../testing/arena";
import { ImpactTriggers, triggerSounds } from "./impactTriggers";
import type { SoundEvent } from "../audio/detect";
import { IMPACT_SCALES } from "./impactTriggers";
import { gatedBallHits } from "./replayPlayback";
import { type RecordedFrame, ReplayRecorder, recordCar } from "./replayRecorder";

let engine: Awaited<ReturnType<typeof createEngine>>;
beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

/** A seeded random (made-up scenarios, the same each run) */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UPRIGHT = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };

/** One car and the ball for `ticks`: the live hits' frames and the replay's */
function run(place: (world: World, car: number) => void, controls: (tick: number) => Partial<typeof NO_CONTROLS>, ticks: number) {
  const world = World.create(engine);
  world.setDemolitions(false);
  const car = world.addCar(0);
  place(world, car);
  const triggers = new ImpactTriggers();
  const configs = new Map<number, CarConfig>([[car, world.carConfig(car)]]);
  const recorder = new ReplayRecorder();
  const frame = (): RecordedFrame => ({ cars: new Map([[car, recordCar(world.car(car))]]), ball: world.ball(), ballExploded: false, lastTouchTeam: null });
  const live: number[] = [];
  world.takeImpacts();
  const start = world.tick;
  for (let t = 1; t <= ticks; t++) {
    world.setControls(car, { ...NO_CONTROLS, ...controls(t) });
    world.step(1);
    recorder.record(world.tick, frame());
    const impacts = world.takeImpacts();
    recorder.ballImpacts(impacts);
    const sounds = triggerSounds(triggers.frame(1 / 120, impacts, new Map([[car, world.car(car)]]), configs, null));
    if (sounds.some((s) => s.kind === "ballHit")) live.push(world.tick);
  }
  // (the replay over the recording, as ReplayPlayback hears it)
  const replay: number[] = [];
  const gate = { frame: -Infinity };
  for (let f = start + 1; f <= start + ticks; f++) {
    const impact = recorder.ballImpactAt(f);
    const hit: SoundEvent[] = impact ? [{ kind: "ballHit", at: impact.at, strength: Math.min(1, impact.speed / IMPACT_SCALES.ball) }] : [];
    if (gatedBallHits(hit, f, gate).length > 0) replay.push(f);
  }
  world.dispose();
  return { live, replay };
}

/** The same hits at the same frames */
function matched(live: readonly number[], replay: readonly number[]): boolean {
  return live.length === replay.length && live.every((f, i) => replay[i] === f);
}

describe("a goal replay's ball hits are the live game's (SND-19; RX30C: each touch heard twice, a carry's every tick)", () => {
  it("a car driven into the ball, at rest or moving, boosting or not: the same hits at the same frames", () => {
    const r = random(30);
    const off: string[] = [];
    for (let i = 0; i < 24; i++) {
      const speed = 200 + r() * 2100;
      const y = (r() - 0.5) * 200;
      const boost = r() < 0.3;
      const moving = r() < 0.5;
      const ball = moving ? { z: 93 + r() * 150, vel: vec3(-r() * 1500, (r() - 0.5) * 400, r() * 500) } : { z: 92.75, vel: ZERO };
      const { live, replay } = run(
        (world, car) => {
          world.setCar(car, { pos: vec3(-700, y, 17), vel: vec3(speed, 0, 0), angVel: ZERO, rot: UPRIGHT, boost: 100 });
          world.setBall({ pos: vec3(0, 0, ball.z), vel: ball.vel, angVel: ZERO });
        },
        () => ({ throttle: 1, boost }),
        150,
      );
      if (!matched(live, replay)) off.push(`run ${String(i)}: live ${live.join(",")} replay ${replay.join(",")}`);
    }
    expect(off).toEqual([]);
  });

  it("a car jumping at a raised ball: the same hits at the same frames", () => {
    const r = random(31);
    const off: string[] = [];
    for (let i = 0; i < 12; i++) {
      const speed = 600 + r() * 1400;
      const at = Math.floor(r() * 30);
      const z = 150 + r() * 200;
      const y = (r() - 0.5) * 120;
      const { live, replay } = run(
        (world, car) => {
          world.setCar(car, { pos: vec3(-900, y, 17), vel: vec3(speed, 0, 0), angVel: ZERO, rot: UPRIGHT, boost: 100 });
          world.setBall({ pos: vec3(0, 0, z), vel: ZERO, angVel: ZERO });
        },
        (t) => ({ throttle: 1, jump: t >= at && t < at + 12, pitch: t > at + 12 ? -0.3 : 0 }),
        150,
      );
      if (!matched(live, replay)) off.push(`run ${String(i)}: live ${live.join(",")} replay ${replay.join(",")}`);
    }
    expect(off).toEqual([]);
  });

  it("a push and a carry (the touch moving on every tick): as many hits as the live game's, not one a tick", () => {
    const r = random(32);
    const off: string[] = [];
    for (let i = 0; i < 6; i++) {
      const speed = 150 + r() * 500;
      const carry = i >= 3;
      const { live, replay } = run(
        (world, car) => {
          world.setCar(car, { pos: vec3(carry ? 0 : -150, 0, 17), vel: vec3(speed, 0, 0), angVel: ZERO, rot: UPRIGHT, boost: 100 });
          world.setBall({ pos: vec3(carry ? -8 : 0, 0, carry ? 145 : 92.75), vel: vec3(speed, 0, 0), angVel: ZERO });
        },
        () => ({ throttle: carry ? 0.3 : 0.6 }),
        240,
      );
      if (!matched(live, replay)) off.push(`run ${String(i)}: live ${live.join(",")} replay ${replay.join(",")}`);
    }
    expect(off).toEqual([]);
  });
});
