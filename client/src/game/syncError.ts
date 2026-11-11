// Render-only smoothing of network corrections, as the game's RBActor sync error (notes/netcode-audit.md N-1): when a
// correction moves a body, the difference (predicted minus corrected) is added to an offset the body is drawn with, and
// the offset decays each frame. So a misprediction glides out over a few frames instead of popping. The physics state
// itself is the corrected one; only the drawn pose (and the camera following it) carries the offset.
// The game: after a resimulation SyncErrorLocation += pre - post (the rotation folded in as axis-angle, FUN_140eabb70);
// each frame the error decays by min(dt x rate, 1) of itself (RBActor_TA.NetworkSyncSettings: LocationFixRate 4,
// AngularFixRate 5), snapping to 0 below 0.1 uu^2 and 0.001 rad. Teleports aren't smoothed.
// Ours decays once a tick, and is drawn between the last tick's offset and this one's at the frame's alpha, as the body's
// poses are, so the camera (told each tick's car with its offset, its steps blended between them:
// camera/pacedCamera.ts) and the drawn body agree whatever the frames (RV-1247).
import { Quaternion, type Vector3 } from "three";
import { type Rot3, type Vec3, ZERO, add, dot, scale, sub, vec3 } from "../math/vec";
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
  /** The last tick's (the body drawn between it and this one) */
  #previousLocation: Vec3 = ZERO;
  readonly #previousRotation = new Quaternion();
  readonly #at = new Quaternion();

  /** A correction moved the body from `pre` to `post` (its present state, before and after); the last tick's offset moves
   *  with it, as the body's previous pose does (the session's #smooth), so the drawn pose stays where it was at any
   *  alpha */
  accumulate(pre: { readonly pos: Vec3; readonly rot?: Rot3 }, post: { readonly pos: Vec3; readonly rot?: Rot3 }): void {
    const moved = sub(pre.pos, post.pos);
    this.location = add(this.location, moved);
    this.#previousLocation = add(this.#previousLocation, moved);
    if (pre.rot && post.rot) {
      // error' = error x (pre x post^-1): drawn = error' x post = error x pre, what was drawn before the correction
      // (the game's FUN_140eabb70: E' = E (x) d)
      const delta = toThreeQuaternion(pre.rot, tmpPre).multiply(toThreeQuaternion(post.rot, tmpPost).invert());
      this.rotation.multiply(delta).normalize();
      this.#previousRotation.multiply(delta).normalize();
    }
  }

  /** One tick of `seconds`: this offset kept as the last tick's, then decayed */
  tick(seconds: number): void {
    this.#previousLocation = this.location;
    this.#previousRotation.copy(this.rotation);
    this.decay(seconds);
  }

  /** The offset (uu) at `alpha` between the last tick's (0) and this one (1) */
  locationAt(alpha: number): Vec3 {
    const a = this.#previousLocation;
    const b = this.location;
    return vec3(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
  }

  /** The rotation offset at `alpha` (into `out`: by default one this error reuses) */
  rotationAt(alpha: number, out: Quaternion = this.#at): Quaternion {
    return out.slerpQuaternions(this.#previousRotation, this.rotation, alpha);
  }

  /** One rendered frame of `seconds`. */
  decay(seconds: number): void {
    seconds = Math.max(0, seconds); // (a first frame's timestamp can be before the last one)
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
    this.#previousLocation = ZERO;
    this.#previousRotation.identity();
  }

  /** The drawn rotation: the error at `alpha` on top of `rot` (Three's frame, in place). */
  applyRotation(rot: Quaternion, alpha = 1): Quaternion {
    return rot.premultiply(this.rotationAt(alpha));
  }

  /** The drawn position: `pos` (Three's frame, in place) plus the error at `alpha`. */
  applyPosition(pos: Vector3, alpha = 1): Vector3 {
    const l = this.locationAt(alpha);
    return pos.set(pos.x + l.x, pos.y + l.z, pos.z + l.y);
  }
}
