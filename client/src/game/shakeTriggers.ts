// What starts the camera shakes and the demolition effects, from the states drawn (notes/camera-shakes.md,
// notes/visual-timing.md VT-19): a pad taken (any car, BoostOrb_Used where the pad is), a car demolished (any car:
// Explosion_Medium at the wreck, and its debris), the player's own jumps, double jumps and dodges. (The goal's shake
// starts with its explosion; an impact's waits for the hit detection's contact data.)
import { DODGE, EXPLOSION_MEDIUM, JUMP, BOOST_ORB_USED, type CameraShakes } from "../camera/shake";
import type { BoostPadState, CarState } from "../engine/world";

export class ShakeTriggers {
  #pads: readonly boolean[] | null = null;
  readonly #demoed = new Map<number, boolean>();
  #own: { readonly hasJumped: boolean; readonly doubleJumped: boolean; readonly hasFlipped: boolean; readonly spawnCount: number } | null = null;

  /** This frame's states: `onDemolition` for each car newly demolished (the debris) */
  frame(
    shakes: CameraShakes,
    own: CarState | undefined,
    cars: ReadonlyMap<number, CarState>,
    pads: readonly BoostPadState[],
    onDemolition: (car: CarState) => void,
  ): void {
    pads.forEach((pad, i) => {
      if (this.#pads?.[i] === true && !pad.active) shakes.play(BOOST_ORB_USED, pad.pos);
    });
    this.#pads = pads.map((p) => p.active);
    for (const [id, car] of cars) {
      if (car.demoed && this.#demoed.get(id) === false) {
        shakes.play(EXPLOSION_MEDIUM, car.pos);
        onDemolition(car);
      }
      this.#demoed.set(id, car.demoed);
    }
    if (own) {
      const before = this.#own;
      // (a new car starts over: no shake for its reset flags)
      if (before?.spawnCount === own.spawnCount) {
        if (own.hasJumped && !before.hasJumped) shakes.play(JUMP);
        if (own.doubleJumped && !before.doubleJumped) shakes.play(JUMP);
        if (own.hasFlipped && !before.hasFlipped) shakes.play(DODGE);
      }
      this.#own = { hasJumped: own.hasJumped, doubleJumped: own.doubleJumped, hasFlipped: own.hasFlipped, spawnCount: own.spawnCount };
    }
  }
}
