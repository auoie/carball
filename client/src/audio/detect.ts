// What happened that makes a sound, found by comparing the game's state from one frame to the next: ball hits and
// bounces, jumps, second jumps and dodges, landings, boost pickups, bumps and demolitions. The same for freeplay and
// online play (where the states are the predicted world), with no help from the engine.
import type { BodyState, BoostPadState, CarState } from "../engine/world";
import { type Vec3, dot, length, lerp, sub } from "../math/vec";

export interface SoundWorld {
  readonly cars: ReadonlyMap<number, CarState>;
  readonly ball: BodyState;
  readonly pads: readonly BoostPadState[];
}

export type SoundEvent =
  | { readonly kind: "ballHit"; readonly at: Vec3; readonly strength: number } // a car touched the ball (0..1)
  | { readonly kind: "ballBounce"; readonly at: Vec3; readonly strength: number } // the ball hit the arena
  | { readonly kind: "jump"; readonly car: number; readonly at: Vec3 }
  | { readonly kind: "doubleJump"; readonly car: number; readonly at: Vec3 }
  | { readonly kind: "flip"; readonly car: number; readonly at: Vec3 }
  | { readonly kind: "land"; readonly car: number; readonly at: Vec3; readonly strength: number }
  | { readonly kind: "pad"; readonly big: boolean; readonly at: Vec3 }
  | { readonly kind: "bump"; readonly at: Vec3; readonly strength: number }
  | { readonly kind: "demo"; readonly at: Vec3 };

/** The arena's gravity (uu/s², along -z). */
const GRAVITY = -650;
/** A velocity change (uu/s) beyond what gravity explains, that counts as an impact; smaller ones are rolling and
 *  pushing. */
const BALL_IMPACT = 160;
/** A car this close to the ball (centres, uu) is what hit it. */
const TOUCH_DISTANCE = 270;
/** Moving further than this between frames is a teleport (a reset, a ball placed), not a hit. */
const TELEPORT = 600;
/** In the air at least this long before touching down counts as a landing (not a bump in the road). */
const AIRBORNE_SECONDS = 0.25;
/** At most one ball sound per this long, so a dribble or a car pushing the ball doesn't rattle. */
const BALL_COOLDOWN = 0.07;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const wheelsDown = (c: CarState): number => c.wheelContact.filter(Boolean).length;

export class SoundDetector {
  #previous: SoundWorld | null = null;
  readonly #airborne = new Map<number, number>(); // seconds in the air, per car
  #ballQuiet = 0; // seconds until the next ball sound may play
  readonly #bumpQuiet = new Map<string, number>();

  /** The sounds between the last state and this one, `seconds` of simulation apart (0: nothing new). */
  update(world: SoundWorld, seconds: number): SoundEvent[] {
    if (seconds <= 0) return [];
    const previous = this.#previous;
    this.#previous = world;
    this.#ballQuiet = Math.max(0, this.#ballQuiet - seconds);
    for (const [key, t] of this.#bumpQuiet) this.#bumpQuiet.set(key, t - seconds);
    if (!previous) return [];
    const events: SoundEvent[] = [];
    this.#ballEvents(previous, world, seconds, events);
    for (const [id, car] of world.cars) {
      const before = previous.cars.get(id);
      if (before) this.#carEvents(id, before, car, seconds, events);
    }
    this.#bumps(previous, world, events);
    world.pads.forEach((pad, i) => {
      if (previous.pads[i]?.active === true && !pad.active) events.push({ kind: "pad", big: pad.big, at: pad.pos });
    });
    return events;
  }

  #ballEvents(previous: SoundWorld, world: SoundWorld, seconds: number, events: SoundEvent[]): void {
    const before = previous.ball;
    const now = world.ball;
    if (length(sub(now.pos, before.pos)) > TELEPORT) return;
    // The change in velocity that gravity doesn't account for
    const change = sub(now.vel, before.vel);
    const impulse = length({ ...change, z: change.z - GRAVITY * seconds });
    if (impulse < BALL_IMPACT || this.#ballQuiet > 0) return;
    this.#ballQuiet = BALL_COOLDOWN;
    const touched = [...world.cars.values()].some((c) => !c.demoed && length(sub(c.pos, now.pos)) < TOUCH_DISTANCE);
    events.push(
      touched
        ? { kind: "ballHit", at: now.pos, strength: clamp01(impulse / 2600) }
        : { kind: "ballBounce", at: now.pos, strength: clamp01(impulse / 1800) },
    );
  }

  #carEvents(id: number, before: CarState, now: CarState, seconds: number, events: SoundEvent[]): void {
    if (now.demoed) {
      if (!before.demoed) events.push({ kind: "demo", at: before.pos });
      return;
    }
    if (length(sub(now.pos, before.pos)) > TELEPORT) {
      this.#airborne.delete(id); // (respawned, reset)
      return;
    }
    if (now.jumping && !before.jumping) events.push({ kind: "jump", car: id, at: now.pos });
    if (now.flipping && !before.flipping) events.push({ kind: "flip", car: id, at: now.pos });
    else if (now.doubleJumped && !before.doubleJumped) events.push({ kind: "doubleJump", car: id, at: now.pos });
    // Landing: wheels down after a while in the air, as hard as it was coming in against the surface
    const air = this.#airborne.get(id) ?? 0;
    if (wheelsDown(now) >= 2) {
      if (wheelsDown(before) === 0 && air >= AIRBORNE_SECONDS) {
        const into = -dot(before.vel, now.groundNormal);
        events.push({ kind: "land", car: id, at: now.pos, strength: clamp01(into / 1400) });
      }
      this.#airborne.set(id, 0);
    } else if (wheelsDown(now) === 0) {
      this.#airborne.set(id, air + seconds);
    }
  }

  /** Two cars close together whose velocities just changed sharply: they hit each other. */
  #bumps(previous: SoundWorld, world: SoundWorld, events: SoundEvent[]): void {
    const ids = [...world.cars.keys()];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i] ?? 0, ids[j] ?? 0];
        const [ca, cb, pa, pb] = [world.cars.get(a), world.cars.get(b), previous.cars.get(a), previous.cars.get(b)];
        if (!ca || !cb || !pa || !pb || ca.demoed || cb.demoed) continue;
        if (length(sub(ca.pos, cb.pos)) > 260) continue;
        const relativeBefore = sub(pa.vel, pb.vel);
        const relativeNow = sub(ca.vel, cb.vel);
        const change = length(sub(relativeNow, relativeBefore));
        const key = `${String(a)}:${String(b)}`;
        if (change < 500 || (this.#bumpQuiet.get(key) ?? 0) > 0) continue;
        this.#bumpQuiet.set(key, 0.3);
        events.push({ kind: "bump", at: lerp(ca.pos, cb.pos, 0.5), strength: clamp01(change / 2500) });
      }
    }
  }
}
