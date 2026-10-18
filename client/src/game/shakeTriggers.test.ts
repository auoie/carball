// What starts the camera shakes and the demolition effects (notes/camera-shakes.md).
import { describe, expect, it } from "vitest";
import { CameraShakes } from "../camera/shake";
import type { BoostPadState, CarState } from "../engine/world";
import { vec3 } from "../math/vec";
import { ShakeTriggers } from "./shakeTriggers";

const car = (o: Partial<CarState> = {}): CarState =>
  ({ pos: vec3(0, 0, 17), vel: vec3(0, 0, 0), demoed: false, hasJumped: false, doubleJumped: false, hasFlipped: false, spawnCount: 0, ...o }) as CarState;
const pad = (active: boolean): BoostPadState => ({ pos: vec3(0, 400, 70), big: false, active, cooldown: 0 });

describe("shake triggers", () => {
  it("a pad taken, a car demolished (and its debris), the player's jump, double jump and dodge", () => {
    const shakes = new CameraShakes();
    const triggers = new ShakeTriggers();
    const demolished: CarState[] = [];
    const frame = (own: CarState, other: CarState, pads: BoostPadState[]): void => {
      triggers.frame(
        shakes,
        own,
        new Map([
          [1, own],
          [2, other],
        ]),
        pads,
        (c) => demolished.push(c),
      );
    };
    frame(car(), car(), [pad(true)]);
    expect(shakes.count).toBe(0);
    frame(car(), car(), [pad(false)]);
    expect(shakes.count).toBe(1); // (BoostOrb_Used)
    frame(car(), car({ demoed: true }), [pad(false)]);
    expect(shakes.count).toBe(2); // (Explosion_Medium)
    expect(demolished).toHaveLength(1);
    frame(car({ hasJumped: true }), car({ demoed: true }), [pad(false)]);
    frame(car({ hasJumped: true, doubleJumped: true }), car({ demoed: true }), [pad(false)]);
    frame(car({ hasJumped: true, doubleJumped: true, hasFlipped: true }), car({ demoed: true }), [pad(false)]);
    expect(shakes.count).toBe(5);
    // A new car's flags start over without a shake
    frame(car({ hasJumped: false, spawnCount: 1 }), car({ demoed: true }), [pad(false)]);
    frame(car({ hasJumped: true, spawnCount: 2 }), car({ demoed: true }), [pad(false)]);
    expect(shakes.count).toBe(5);
  });

  it("online (the server's Demo events start them: RV-47): a predicted demolition, rolled back or not, starts nothing", () => {
    const shakes = new CameraShakes();
    const triggers = new ShakeTriggers({ demolitions: false });
    const demolished: CarState[] = [];
    const frame = (other: CarState): void => {
      triggers.frame(
        shakes,
        car(),
        new Map([
          [1, car()],
          [2, other],
        ]),
        [],
        (c) => demolished.push(c),
      );
    };
    frame(car());
    frame(car({ demoed: true })); // (predicted)
    frame(car()); // (rolled back)
    frame(car({ demoed: true }));
    expect(demolished).toHaveLength(0);
    expect(shakes.count).toBe(0);
  });
});
