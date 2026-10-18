// The impact and landing triggers as the game's (notes/impact-triggers.md IT-1..5, §2b): the engine reports each car's
// contacts per physics step, and the ball's with the world (engine patch 96: the speed along the averaged normal); here
// they become the Impact_Medium shake (the local car's, restarted by every hit over 200 uu/s), the sparks and the body
// sound (50 uu/s or more, a 0.15 s game-time cooldown each for world and actor partners; a car–ball hit sounds the
// ball's, on its actor slot, a car–car hit one car's), the ball's own Impact_Ball off the arena (its world slot: RV-172),
// and the wheels' landings (once a frame, each wheel's contact edge, the previous frame's speed into the surface at its
// hard point, over 50 uu/s; every car, no cooldown).
import type { SoundEvent } from "../audio/detect";
import { BALL_IMPACT, type CarConfig, type CarState, type Impact, type ImpactPartner } from "../engine/world";
import { type Vec3, add, cross, dot, localToWorld, vec3 } from "../math/vec";

/** ImpactEffectsComponent_TA: MinImpactMomentum (uu/s), MinImpactDelay (s); the ball's the same (Ball_Default: 50, the
 *  class's 0.15; its SoundPriority 100 over the car's 0) */
export const IMPACT_EFFECTS = { minMomentum: 50, minDelay: 0.15 } as const;

/** The landing's minimum speed into the surface (MinImpactMomentum, strict: IT-5) */
export const LANDING_MIN = 50;

/** The Impact_Medium shake's scale by impact speed (ShakeScaleCurve: linear (0, 0), (200, 0), (201, 0.1), (4000, 1)) */
export function impactShakeScale(v: number): number {
  if (v <= 200) return 0;
  if (v <= 201) return 0.1 * (v - 200);
  if (v >= 4000) return 1;
  return 0.1 + (0.9 * (v - 201)) / 3799;
}

/** What the triggers start this frame */
export type Trigger =
  /** the local car's Impact_Medium shake, restarted at this scale */
  | { readonly kind: "shake"; readonly car: number; readonly scale: number }
  /** an impact's sparks (every one past the cooldown) */
  | { readonly kind: "sparks"; readonly car: number; readonly at: Vec3; readonly normal: Vec3; readonly speed: number }
  /** a car's body sound (Body impact: a world or car partner) */
  | { readonly kind: "carImpact"; readonly car: number; readonly at: Vec3; readonly speed: number; readonly partner: ImpactPartner }
  /** the ball's sound (Impact_Ball: its priority over the car's), off a car or the arena */
  | { readonly kind: "ballImpact"; readonly at: Vec3; readonly speed: number; readonly partner: "car" | "world" }
  /** a wheel touching down (Impact_Wheel, its RTPC the speed) */
  | { readonly kind: "landing"; readonly car: number; readonly wheel: number; readonly at: Vec3; readonly speed: number };

/** A car as the landing trigger reads it: its state and each wheel's ray-hit normal */
export type TriggerCar = Pick<CarState, "pos" | "vel" | "angVel" | "rot" | "wheelContact" | "wheelNormals" | "spawnCount" | "demoed">;

/** A wheel's hard point in the car's frame (RocketSim's order: front right, front left, back right, back left): the
 *  suspension's anchor, at the hitbox centre's height (IT-5) */
export function hardPoint(config: CarConfig, wheel: number): Vec3 {
  const w = wheel < 2 ? config.frontWheel : config.backWheel;
  return vec3(w.offset.x, wheel % 2 === 0 ? w.offset.y : -w.offset.y, config.hitboxOffset.z);
}

/** The chassis' velocity at a point of the car's frame */
export function pointVelocity(car: Pick<CarState, "vel" | "angVel" | "rot">, local: Vec3): Vec3 {
  return add(car.vel, cross(car.angVel, localToWorld(car.rot, local)));
}

export class ImpactTriggers {
  /** The newest physics tick handled: a prediction's re-simulated ticks come again, and are skipped (as the game's
   *  rollback re-sims) */
  #lastTick = -Infinity;
  /** Game time (dilated, advancing per frame: WorldInfo.TimeSeconds) */
  #time = 0;
  /** Per car, the last effect's time with a world and with an actor partner; the ball's with an actor */
  readonly #slots = new Map<number, { world: number; actor: number }>();
  #ballActor = -Infinity;
  #ballWorld = -Infinity;
  /** Per car, last frame's state (the landing's previous frame) */
  readonly #previous = new Map<number, TriggerCar>();

  /** This frame's triggers: `seconds` of game time since the last frame, the engine's new impacts, the cars now (with
   *  their configs), the local car */
  frame(
    seconds: number,
    impacts: readonly Impact[],
    cars: ReadonlyMap<number, TriggerCar>,
    configs: ReadonlyMap<number, CarConfig>,
    local: number | null,
  ): Trigger[] {
    this.#time += Math.max(0, seconds);
    const out: Trigger[] = [];
    const fresh = impacts.filter((i) => i.tick > this.#lastTick).sort((a, b) => a.tick - b.tick);
    for (const impact of fresh) this.#impact(impact, local, out);
    this.#lastTick = Math.max(this.#lastTick, ...fresh.map((i) => i.tick));
    for (const [id, car] of cars) this.#landings(id, car, configs.get(id), out);
    for (const id of [...this.#previous.keys()]) if (!cars.has(id)) this.#previous.delete(id);
    return out;
  }

  #impact(impact: Impact, local: number | null, out: Trigger[]): void {
    const { car, speed } = impact;
    // (the ball's own, off the arena: Impact_Ball on its world slot; no shake, no sparks: §2b)
    if (car === BALL_IMPACT) {
      if (speed >= IMPACT_EFFECTS.minMomentum && this.#time - this.#ballWorld >= IMPACT_EFFECTS.minDelay) {
        this.#ballWorld = this.#time;
        out.push({ kind: "ballImpact", at: impact.pos, speed, partner: "world" });
      }
      return;
    }
    // The shake (before the effects' gate: no cooldown; at most a restart a hit)
    const scale = impactShakeScale(speed);
    if (car === local && scale > 0) out.push({ kind: "shake", car, scale });
    // The car's effects: past the momentum and its slot's cooldown, the sparks, and its sound unless the partner's wins
    if (speed < IMPACT_EFFECTS.minMomentum) return;
    const slots = this.#slots.get(car) ?? { world: -Infinity, actor: -Infinity };
    this.#slots.set(car, slots);
    const slot = impact.partner === "world" ? "world" : "actor";
    if (this.#time - slots[slot] >= IMPACT_EFFECTS.minDelay) {
      slots[slot] = this.#time;
      out.push({ kind: "sparks", car, at: impact.pos, normal: impact.normal, speed });
      // (a car–car pair sounds once: the one with the larger index, the other side yields [I: the object index])
      const sounds = impact.partner === "world" || (impact.partner === "car" && car > impact.partnerId);
      if (sounds) out.push({ kind: "carImpact", car, at: impact.pos, speed, partner: impact.partner });
    }
    // The ball's own side of a car–ball hit: its sound, on its own actor cooldown
    if (impact.partner === "ball" && this.#time - this.#ballActor >= IMPACT_EFFECTS.minDelay) {
      this.#ballActor = this.#time;
      out.push({ kind: "ballImpact", at: impact.pos, speed, partner: "car" });
    }
  }

  #landings(id: number, car: TriggerCar, config: CarConfig | undefined, out: Trigger[]): void {
    const before = this.#previous.get(id);
    this.#previous.set(id, car);
    // (a new car, a new placement or a wreck: no edge)
    if (!before || !config || before.spawnCount !== car.spawnCount || car.demoed || before.demoed) return;
    car.wheelContact.forEach((contact, wheel) => {
      if (!contact || before.wheelContact[wheel] === true) return;
      const n = car.wheelNormals[wheel] ?? vec3(0, 0, 1);
      const local = hardPoint(config, wheel);
      const speed = Math.abs(dot(pointVelocity(before, local), n));
      if (speed > LANDING_MIN) out.push({ kind: "landing", car: id, wheel, at: add(car.pos, localToWorld(car.rot, local)), speed });
    });
  }
}

/** The intensities' full scales (the game's RTPCs, SND-5/6: RV-173): Impact_Body one event, 0-2000, whichever the
 *  partner (the world an impact, a car a bump); Impact_Ball at 0 dB by 1200 off the world (its base Volume curve) and by
 *  1300 off a car (the Car MaterialType's extra curve: RV-205); a wheel's landing */
export const IMPACT_SCALES = { body: 2000, ball: 1300, ballBounce: 1200, wheel: 1100 } as const;

/** The triggers' sounds for the synth (its strengths 0..1 from the speeds on IMPACT_SCALES): a car's body on the world
 *  an impact, on a car a bump, the ball's off a car a ball hit and off the arena a bounce; each wheel touching down a landing of its own (the game posts one
 *  Impact_Wheel a wheel, up to four a landing, RV-171; their voices' limit, 25, is the sound bank's) */
export function triggerSounds(triggers: readonly Trigger[]): SoundEvent[] {
  const strength = (v: number, full: number): number => Math.min(1, Math.max(0, v / full));
  const out: SoundEvent[] = [];
  for (const t of triggers) {
    if (t.kind === "carImpact") {
      const s = strength(t.speed, IMPACT_SCALES.body);
      out.push(t.partner === "car" ? { kind: "bump", at: t.at, strength: s } : { kind: "impact", car: t.car, at: t.at, strength: s });
    } else if (t.kind === "ballImpact") {
      out.push(
        t.partner === "car"
          ? { kind: "ballHit", at: t.at, strength: strength(t.speed, IMPACT_SCALES.ball) }
          : { kind: "ballBounce", at: t.at, strength: strength(t.speed, IMPACT_SCALES.ballBounce) },
      );
    } else if (t.kind === "landing") {
      out.push({ kind: "land", car: t.car, at: t.at, strength: strength(t.speed, IMPACT_SCALES.wheel) });
    }
  }
  return out;
}
