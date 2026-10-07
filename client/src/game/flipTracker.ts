// Whether a car can dodge, for the flip indicator, from the engine's own flip state (CarState::HasFlipOrJump,
// HasFlipReset, airTimeSinceJump): in the air a car can dodge (or double jump) once, within 1.25 s of its jump ending;
// in the air without having jumped (it drove off something, or got a flip reset) there is no time limit. Its wheels
// touching anything (3 or more of them: "on the ground"), the ball or another car included, give the dodge back:
// touching the ball or a car in mid-air is a flip reset (notes/physics-values.md, "Flip reset").
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
  /** A flip reset this tick: the wheels just touched the ball or another car in mid-air */
  readonly reset: RbActor | null;
}


export class FlipTracker {
  #airborne = false; // in the air last tick
  #fromReset = false; // this time in the air started with a flip reset

  /** One physics tick of `seconds`: the car's state after it. */
  tick(car: CarState, seconds: number): FlipTick {
    if (car.onGround) {
      // Touching down from the air onto the ball or a car (the game's IsOnRBActor): a flip reset
      let reset: FlipTick["reset"] = null;
      if (this.#airborne) {
        reset = car.rbActor;
        this.#fromReset = reset !== null;
      }
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
