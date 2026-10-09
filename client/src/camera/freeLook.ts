// The free look's input (CameraState_TA.UpdateFreeLookInput / WriteFreeLookOffset; notes/camera-respawn-goal.md
// CAM-11, CAM-12): rate control, unlike the swivel's position control. Each frame the raw input sets a target speed,
// the speed eases towards it (smoothing on: in at CameraAccelRate while there's input, out at CameraDecelRate), and the
// frame's offset is that speed times the frame time, truncated to whole rotator units.

/** Where the free look's input comes from: the mouse (counts this frame), a stick (-1..1), or keys (-1, 0, 1) */
export type FreeLookSource = "mouse" | "stick" | "keys";

export interface FreeLookAxes {
  /** Positive looks up (after the pitch inversion) */
  readonly pitch: number;
  /** Positive looks right */
  readonly yaw: number;
  readonly source: FreeLookSource;
}

export interface FreeLookSettings {
  readonly smoothing: boolean;
  readonly accelRate: number;
  readonly decelRate: number;
  readonly freeLookSpeed: number;
}

/** FreeLookSensitivity (Default__CameraState_TA): the mouse per frame; a stick and keys per second */
const MOUSE_SCALE = 0.83;
const STICK_SCALE = 10000;
const KEYS_SCALE = 5000;
/** MaxFreeLookPitchDegrees 75 (rotator units) */
export const MAX_FREE_LOOK_PITCH = 13653;
const E = 2.71828; // (as the game's FSmoothInterpTo)

export interface RotatorOffset {
  readonly pitch: number;
  readonly yaw: number;
}

export const NO_FREE_LOOK: FreeLookAxes = { pitch: 0, yaw: 0, source: "stick" };

export class FreeLookRate {
  #pitch = 0;
  #yaw = 0;

  /** TurnOffFreeLook: the speed back to zero */
  reset(): void {
    this.#pitch = 0;
    this.#yaw = 0;
  }

  /** The frame's offset (rotator units, truncated toward zero) */
  update(dt: number, axes: FreeLookAxes, s: FreeLookSettings): RotatorOffset {
    if (dt <= 0) return { pitch: 0, yaw: 0 };
    const scale = axes.source === "mouse" ? MOUSE_SCALE : (axes.source === "stick" ? STICK_SCALE : KEYS_SCALE) * dt;
    const axis = (rate: number, raw: number): number => {
      const target = (raw * s.freeLookSpeed * scale) / dt;
      if (!s.smoothing) return target;
      const lambda = raw === 0 ? s.decelRate : s.accelRate;
      return rate + (target - rate) * (1 - E ** (-lambda * dt));
    };
    this.#pitch = axis(this.#pitch, axes.pitch);
    this.#yaw = axis(this.#yaw, axes.yaw);
    return { pitch: Math.trunc(this.#pitch * dt), yaw: Math.trunc(this.#yaw * dt) };
  }
}

/** A stick's free look: past the free-look deadzone (a hard cut, no rescale, after the stick's own deadzone), clamped */
export function freeLookStick(v: number, deadzone: number): number {
  return Math.abs(v) > deadzone ? Math.min(1, Math.max(-1, v)) : 0;
}
