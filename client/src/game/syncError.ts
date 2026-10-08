// Render-only smoothing of network corrections, as the game's RBActor sync error (notes/netcode-audit.md N-1): when a
// correction moves a body, the difference (predicted minus corrected) is added to an offset the body is drawn with, and
// the offset decays each frame. So a misprediction glides out over a few frames instead of popping. The physics state
// itself is the corrected one; only the drawn pose (and the camera following it) carries the offset.
// The game: after a resimulation SyncErrorLocation += pre - post (the rotation folded in as axis-angle, FUN_140eabb70);
// each frame the error decays by min(dt x rate, 1) of itself (RBActor_TA.NetworkSyncSettings: LocationFixRate 4,
// AngularFixRate 5), snapping to 0 below 0.1 uu^2 and 0.001 rad. Teleports aren't smoothed.
import { Quaternion, type Vector3 } from "three";
import { type Rot3, type Vec3, ZERO, add, dot, scale, sub } from "../math/vec";
import { toThreeQuaternion } from "../render/coords";

export const LOCATION_FIX_RATE = 4;
export const ANGULAR_FIX_RATE = 5;
const LOCATION_SNAP_SQ = 0.1;
const ANGLE_SNAP = 0.001;

const IDENTITY = new Quaternion();
const tmpPre = new Quaternion();
const tmpPost = new Quaternion();

export class SyncError {
  /** uu, Rocket League frame: added to the drawn position */
  location: Vec3 = ZERO;
  /** Three's frame: applied on top of the drawn rotation */
  readonly rotation = new Quaternion();

  /** A correction moved the body from `pre` to `post` (its present state, before and after). */
  accumulate(pre: { readonly pos: Vec3; readonly rot?: Rot3 }, post: { readonly pos: Vec3; readonly rot?: Rot3 }): void {
    this.location = add(this.location, sub(pre.pos, post.pos));
    if (pre.rot && post.rot) {
      // error' = (pre x post^-1) x error: drawn = error' x post = pre (at the moment of the correction)
      const delta = toThreeQuaternion(pre.rot, tmpPre).multiply(toThreeQuaternion(post.rot, tmpPost).invert());
      this.rotation.premultiply(delta).normalize();
    }
  }

  /** One rendered frame of `seconds`. */
  decay(seconds: number): void {
    this.location = scale(this.location, 1 - Math.min(seconds * LOCATION_FIX_RATE, 1));
    if (dot(this.location, this.location) < LOCATION_SNAP_SQ) this.location = ZERO;
    this.rotation.slerp(IDENTITY, Math.min(seconds * ANGULAR_FIX_RATE, 1));
    if (this.angle() < ANGLE_SNAP) this.rotation.identity();
  }

  /** The rotation error's angle (rad) */
  angle(): number {
    return 2 * Math.acos(Math.min(1, Math.abs(this.rotation.w)));
  }

  clear(): void {
    this.location = ZERO;
    this.rotation.identity();
  }

  /** The drawn rotation: the error on top of `rot` (Three's frame, in place). */
  applyRotation(rot: Quaternion): Quaternion {
    return rot.premultiply(this.rotation);
  }

  /** The drawn position: `pos` (Three's frame, in place) plus the error. */
  applyPosition(pos: Vector3): Vector3 {
    return pos.set(pos.x + this.location.x, pos.y + this.location.z, pos.z + this.location.y);
  }
}
