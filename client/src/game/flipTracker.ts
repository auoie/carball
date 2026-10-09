// Whether a car can dodge, for the flip indicator, from the engine's own flip state (CarState::HasFlipOrJump,
// HasFlipReset, airTimeSinceJump): in the air a car can dodge (or double jump) once, within 1.25 s of its jump ending;
// in the air without having jumped (it drove off something, or got a flip reset) there is no time limit. Its wheels
// touching anything (3 or more of them: "on the ground"), the ball or another car included, give the dodge back.
// A flip reset is the game's signal for it (its indicator): a landing on the ball or a car, at most one wheel on the
// arena, after the jump or dodge was used (the engine's flipResets count, the game's DodgesRefreshedCounter; not after
// driving off something without jumping) (notes/physics-values.md, "Flip reset").
import type { CarState, RbActor } from "../engine/world";

/** RLConst::DOUBLEJUMP_MAX_DELAY: how long after a jump ends the car can still dodge (s). */
export const DODGE_WINDOW = 1.25;

export type Dodge =
  | { readonly kind: "ground" } // wheels down: jumps and dodges come back
  | { readonly kind: "window"; readonly remaining: number } // after a jump: seconds left to dodge
  | { readonly kind: "free"; readonly reset: boolean } // a dodge with no time limit (`reset`: from a flip reset)
  | { readonly kind: "spent" }; // dodged or double jumped, or the window ran out

export interface FlipTick {
  readonly dodge: Dodge;
  /** A flip reset this tick: what the wheels landed on (the ball or another car) */
  readonly reset: RbActor | null;
}


export class FlipTracker {
  #airborne = false; // in the air last tick
  #fromReset = false; // this time in the air started with a flip reset
  #flipResets: number | null = null; // the engine's count last tick
  #spawnCount: number | null = null; // the car's placements last tick

  /** One physics tick of `seconds`: the car's state after it. */
  tick(car: CarState, seconds: number): FlipTick {
    // A reset or a respawn makes a new car (its count back at 0): not a flip reset
    const placed = this.#spawnCount !== null && car.spawnCount !== this.#spawnCount;
    this.#spawnCount = car.spawnCount;
    const counted = !placed && this.#flipResets !== null && car.flipResets !== this.#flipResets;
    this.#flipResets = car.flipResets;
    if (placed) this.#fromReset = false;
    if (car.onGround) {
      // (the count goes up on the landing tick, on the ball or a car: the game's IsOnRBActor)
      const reset: FlipTick["reset"] = counted ? (car.rbActor ?? { kind: "ball" }) : null;
      if (this.#airborne || counted) this.#fromReset = counted;
      this.#airborne = false;
      return { dodge: { kind: "ground" }, reset };
    }
    this.#airborne = true;
    // A press is read on the next tick, after the engine's jump timer has moved on (Car::_UpdateDoubleJumpOrFlip)
    const next = car.airTimeSinceJump + (car.hasJumped && !car.jumping ? seconds : 0);
    const dodge: Dodge =
      car.demoed || !car.hasFlipOrJump || next >= DODGE_WINDOW
        ? { kind: "spent" }
        : car.hasFlipReset
          ? { kind: "free", reset: this.#fromReset }
          : { kind: "window", remaining: DODGE_WINDOW - next };
    return { dodge, reset: null };
  }
}
