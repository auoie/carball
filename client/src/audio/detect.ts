// What happened that makes a sound, found by comparing the game's state from one frame to the next: jumps, second jumps
// and dodges, boost pickups and demolitions. The same for freeplay and online play (where the states are the predicted
// world). The impacts (a car's body on the arena, on another car, on the ball; the ball's own off the arena) and the
// landings come from the engine's contacts instead, as the game's triggers (game/impactTriggers.ts).
import type { BodyState, BoostPadState, CarState } from "../engine/world";
import { type Vec3, length, sub } from "../math/vec";

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
  | { readonly kind: "land"; readonly car: number; readonly at: Vec3; readonly strength: number } // on its wheels
  | { readonly kind: "impact"; readonly car: number; readonly at: Vec3; readonly strength: number } // its body hit the arena
  | { readonly kind: "pad"; readonly big: boolean; readonly at: Vec3 }
  | { readonly kind: "bump"; readonly at: Vec3; readonly strength: number }
  | { readonly kind: "demo"; readonly at: Vec3 };

/** Moving further than this between frames is a teleport (a reset, a car placed), not a jump. */
const TELEPORT = 600;

export class SoundDetector {
  #previous: SoundWorld | null = null;

  /** The sounds between the last state and this one, `seconds` of simulation apart (0: nothing new). */
  update(world: SoundWorld, seconds: number): SoundEvent[] {
    if (seconds <= 0) return [];
    const previous = this.#previous;
    this.#previous = world;
    if (!previous) return [];
    const events: SoundEvent[] = [];
    for (const [id, car] of world.cars) {
      const before = previous.cars.get(id);
      if (before) this.#carEvents(id, before, car, events);
    }
    world.pads.forEach((pad, i) => {
      if (previous.pads[i]?.active === true && !pad.active) events.push({ kind: "pad", big: pad.big, at: pad.pos });
    });
    return events;
  }

  #carEvents(id: number, before: CarState, now: CarState, events: SoundEvent[]): void {
    if (now.demoed) {
      if (!before.demoed) events.push({ kind: "demo", at: before.pos });
      return;
    }
    if (length(sub(now.pos, before.pos)) > TELEPORT || now.spawnCount !== before.spawnCount) return; // (respawned, reset)
    // (from the flags that hold until the car lands, not the held jump's or the dodge's own: a short press can start
    // and end within one slow frame)
    const jumped = now.hasJumped && !before.hasJumped;
    const flipped = now.hasFlipped && !before.hasFlipped;
    const doubleJumped = now.doubleJumped && !before.doubleJumped;
    if (jumped) events.push({ kind: "jump", car: id, at: now.pos });
    if (flipped) events.push({ kind: "flip", car: id, at: now.pos });
    else if (doubleJumped) events.push({ kind: "doubleJump", car: id, at: now.pos });
  }
}
