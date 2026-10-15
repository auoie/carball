// The goal replay's camera, CameraState_LiveReplay_TA (notes/camera-respawn-goal.md GS-10; the static session's
// out/bsim/agents/K2/work/gs_notes.txt): from the field's +x side, far up the field from the goal scored into, it
// follows the next car to touch the ball together with the ball (then the ball alone, then the field's centre once the
// ball has exploded), and zooms in (FOV 75 to 25, distance 1800 to 2800) over a second while the replay is slowed.
// Its Tick and UpdatePOV run on real time (DeltaTime / TimeDilation).
import { type Vec3, add, length, sub, vec3 } from "../math/vec";
import { lerp, rotationAxes, vectorToRotator, vlerp } from "./unreal";
import type { CameraView } from "./carballCamera";

/** Archetypes.Camera.CameraState_LiveReplay */
const LIVE_REPLAY = {
  locationOffset: vec3(9000, 4000, 1000),
  carBallFocusBlendDistance: 1800,
  distance: 1800,
  fov: 75,
  slomoInterpTime: 1,
  slomoDistance: 2800,
  slomoFov: 25,
  velocityPrediction: vec3(0.3, 0.3, 0.1),
  interpToFieldCenterRate: 1,
  interpToFieldCenterOffset: 500,
} as const;

/** FocusSpeedOverTime: linear (0, 0.1) .. (1, 4), clamped; by game seconds since the focus car changed */
function focusSpeed(seconds: number): number {
  return lerp(0.1, 4, Math.min(1, Math.max(0, seconds)));
}

/** Goal_TA.GetReplayOrientation: the goal scored into (the net at -y for team 0's), its point and facing (pitch
 *  zeroed); LocationOffset.Y's sign by the net's TeamNum (0: -Y, else +Y) */
function goalFrame(goal: number, teamNum: number): { origin: Vec3; yaw: number; y: number } {
  // Blue's (team 0) goal at y -5120 faces +y (yaw +90°), orange's at y +5120 faces -y; with each net's own TeamNum the
  // camera's side offset puts it on the field's +x side for both
  const y = teamNum === 0 ? -4000 : 4000;
  return goal === 0 ? { origin: vec3(0, -5120, 320), yaw: Math.PI / 2, y } : { origin: vec3(0, 5120, 320), yaw: -Math.PI / 2, y };
}

export interface ReplayBody {
  readonly pos: Vec3;
  readonly vel: Vec3;
}

export interface ReplayFocus {
  /** The car to follow with the ball (null: the ball alone) */
  readonly car: ReplayBody | null;
  /** The ball (null: exploded) */
  readonly ball: ReplayBody | null;
  /** Which car that is (a change restarts the focus speed's curve) */
  readonly carId: number | null;
}

export class ReplayCamera {
  readonly #goal: { origin: Vec3; yaw: number; y: number };
  #focus: Vec3 | null = null;
  #focusCar: number | null = null;
  /** Game seconds since a focus car was last taken (none yet: the curve's end, full speed) */
  #sinceFocusChange = Infinity;
  #slomoTime = 0;

  /** `scoringTeam`: the goal scored into is the other team's; `netTeamNum`: that net's TeamNum (its own team's in a
   *  match; 1 for both of freeplay's, so at blue's net the camera takes the other side: static analysis RV-41) */
  constructor(scoringTeam: number, netTeamNum = scoringTeam === 0 ? 1 : 0) {
    this.#goal = goalFrame(scoringTeam === 0 ? 1 : 0, netTeamNum);
  }

  /** `realSeconds`: real time since the last frame; `dilation`: the replay's speed now (0.25 slowed, else 1) */
  update(realSeconds: number, focus: ReplayFocus, dilation: number): CameraView {
    const slowed = dilation < 1;
    // UpdateSlomo
    this.#slomoTime = Math.min(1, Math.max(0, this.#slomoTime + (slowed ? realSeconds : -realSeconds)));
    const a = this.#slomoTime / LIVE_REPLAY.slomoInterpTime;
    const fov = lerp(LIVE_REPLAY.fov, LIVE_REPLAY.slomoFov, a);
    let distance = lerp(LIVE_REPLAY.distance, LIVE_REPLAY.slomoDistance, a);

    // (LastFocusChangeTime moves only when a new car is taken, not when the focus goes to the ball alone: RV-5)
    if (focus.carId !== this.#focusCar) {
      this.#focusCar = focus.carId;
      if (focus.carId !== null) this.#sinceFocusChange = 0;
    }
    this.#sinceFocusChange += realSeconds * dilation;
    const predict = (b: ReplayBody): Vec3 => {
      const v = LIVE_REPLAY.velocityPrediction;
      return add(b.pos, vec3(b.vel.x * v.x * dilation, b.vel.y * v.y * dilation, b.vel.z * v.z * dilation));
    };
    if (focus.ball) {
      const ball = predict(focus.ball);
      let target = ball;
      if (focus.car) {
        const car = predict(focus.car);
        const d = length(sub(ball, car));
        const mid = vlerp(car, ball, 0.5);
        const f = vlerp(car, mid, 1 - Math.min(1, Math.max(0, d / LIVE_REPLAY.carBallFocusBlendDistance)));
        target = vec3(f.x, f.y, lerp(car.z, ball.z, 0.35));
      }
      this.#focus = this.#focus ? vlerp(this.#focus, target, Math.min(focusSpeed(this.#sinceFocusChange) * realSeconds, 1)) : target;
    } else {
      const centre = vec3(0, 0, LIVE_REPLAY.interpToFieldCenterOffset);
      this.#focus = this.#focus ? vlerp(this.#focus, centre, Math.min(LIVE_REPLAY.interpToFieldCenterRate * realSeconds, 1)) : centre;
    }

    // GetCameraBaseLocation: up the field from the goal, sliding to the +x side as the focus comes out of the goal
    const { origin, yaw, y } = this.#goal;
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const rel = sub(this.#focus, origin);
    const localX = rel.x * c + rel.y * s;
    const along = Math.min(1, Math.max(0, localX / LIVE_REPLAY.locationOffset.x));
    const local = vec3(LIVE_REPLAY.locationOffset.x, y * along * along, LIVE_REPLAY.locationOffset.z);
    const base = add(origin, vec3(local.x * c - local.y * s, local.x * s + local.y * c, local.z));
    const toFocus = sub(this.#focus, base);
    const rotation = vectorToRotator(toFocus);
    distance = Math.min(distance, length(toFocus));
    const axes = rotationAxes(rotation);
    const position = sub(this.#focus, vec3(axes.forward.x * distance, axes.forward.y * distance, axes.forward.z * distance));
    return { position, forward: axes.forward, up: axes.up, horizontalFov: fov };
  }
}
