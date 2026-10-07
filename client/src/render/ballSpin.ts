// The ball's orientation, for display. The engine doesn't track it: RocketSim skips it by default
// (ArenaConfig::noBallRot), since a sphere's orientation never affects its collisions, and the ball state's rotation
// stays at identity. Its angular velocity is simulated, so the client integrates an orientation from it.
import { Quaternion, Vector3 } from "three";
import type { BodyState } from "../engine/world";
import { type Rot3, type Vec3, vec3 } from "../math/vec";

export class BallSpin {
  readonly #orientation = new Quaternion(); // in the engine's frame (Bullet's right-handed maths on its coordinates)
  readonly #step = new Quaternion();
  readonly #axis = new Vector3();

  /** The ball state with its orientation turned by `seconds` of its angular velocity. */
  advance(state: BodyState, seconds: number): BodyState {
    const { x, y, z } = state.angVel;
    const speed = Math.hypot(x, y, z);
    if (speed > 1e-9) {
      // World-frame angular velocity: the step applies before the current orientation (btTransformUtil::integrateTransform)
      this.#step.setFromAxisAngle(this.#axis.set(x / speed, y / speed, z / speed), speed * seconds);
      this.#orientation.premultiply(this.#step).normalize();
    }
    return { ...state, rot: this.rotation() };
  }

  rotation(): Rot3 {
    const axis = (ax: number, ay: number, az: number): Vec3 => {
      const v = this.#axis.set(ax, ay, az).applyQuaternion(this.#orientation);
      return vec3(v.x, v.y, v.z);
    };
    return { forward: axis(1, 0, 0), right: axis(0, 1, 0), up: axis(0, 0, 1) };
  }
}
