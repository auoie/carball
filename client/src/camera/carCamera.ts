// Car camera and ball camera.
// The numbers are the game's (GameInfo_Soccar_SF: Archetypes.Camera.CameraState_Car / _Ballcam; default
// player settings from CameraState_DirectorBallCam_TA.ForcedCameraSettings). The update logic is
// PROVISIONAL: the real CameraState_Car_TA / CameraState_BallCam_TA code is still to be decompiled
// (roadmap §3), so this is a plausible follow camera that uses those rates.
import type { BodyState, CarState } from "../engine/world";
import { type Vec3, add, length, normalize, scale, sub, vec3 } from "../math/vec";
import { fInterpTo, vInterpTo } from "./interp";

export interface CameraSettings {
  readonly fov: number; // horizontal, degrees
  readonly distance: number;
  readonly height: number;
  readonly pitch: number; // degrees, negative looks down
  readonly stiffness: number; // 0..1
  readonly swivelSpeed: number;
  readonly transitionSpeed: number;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  fov: 90,
  distance: 270,
  height: 100,
  pitch: -3,
  stiffness: 0.5,
  swivelSpeed: 2.5,
  transitionSpeed: 1,
};

/** CameraState_Car archetype values. */
export const CAR_CAMERA = {
  focusInterpRate: 6.32,
  focusMaxDistance: 100,
  distanceInterpRate: 4.14,
  groundRotationInterpRate: 13.39,
  groundRotationInterpRateWall: 2.03,
  distanceSpeedScale: 0.05,
  distanceOffsetMin: -50,
  maxSpeedFov: 5,
  fovInterpSpeed: 25,
  supersonicFov: 10,
  supersonicFovInterpSpeed: 40,
} as const;

/** CameraState_Ballcam archetype values (rotator units: 65536 = 360 degrees). */
export const BALL_CAMERA = {
  rotationRate: 8.59,
  pitchScale: 0.8,
  pitchExtentMinDeg: (4000 / 65536) * 360,
  pitchExtentMaxDeg: (8000 / 65536) * 360,
} as const;

const CAR_MAX_SPEED = 2300;
const WORLD_UP = vec3(0, 0, 1);
const DEG = Math.PI / 180;

export interface CameraView {
  readonly position: Vec3;
  readonly target: Vec3; // look-at point
  readonly up: Vec3;
  readonly horizontalFov: number;
}

const flatten = (v: Vec3): Vec3 => normalize(vec3(v.x, v.y, 0));

export class CarCamera {
  #focus: Vec3 | null = null;
  #yawDir = vec3(1, 0, 0);
  #distance: number;
  #speedFov = 0;
  #supersonicFov = 0;

  constructor(public settings: CameraSettings = DEFAULT_CAMERA_SETTINGS) {
    this.#distance = settings.distance;
  }

  /** Snap to the car (after a reset or respawn). */
  reset(): void {
    this.#focus = null;
  }

  update(dt: number, car: CarState, ball: BodyState, ballCam: boolean): CameraView {
    const s = this.settings;

    // Focus follows the car origin, lagging by at most focusMaxDistance
    let focus = this.#focus ? vInterpTo(this.#focus, car.pos, dt, CAR_CAMERA.focusInterpRate) : car.pos;
    const lag = sub(focus, car.pos);
    if (length(lag) > CAR_CAMERA.focusMaxDistance) {
      focus = add(car.pos, scale(normalize(lag), CAR_CAMERA.focusMaxDistance));
    }

    // Horizontal direction the camera looks along
    const onWall = car.onGround && car.rot.up.z < 0.7;
    const wanted = ballCam ? flatten(sub(ball.pos, car.pos)) : flatten(car.rot.forward);
    const rate = ballCam
      ? BALL_CAMERA.rotationRate
      : onWall
        ? CAR_CAMERA.groundRotationInterpRateWall
        : CAR_CAMERA.groundRotationInterpRate;
    if (length(wanted) > 0.5) {
      // Snap on the first frame after a reset, otherwise turn at the archetype's rate
      this.#yawDir = this.#focus === null ? wanted : normalize(vInterpTo(this.#yawDir, wanted, dt, rate), wanted);
    }
    this.#focus = focus;

    // Lower stiffness lets the camera fall further behind at speed
    const speed = length(car.vel);
    const speedOffset = Math.max(
      CAR_CAMERA.distanceOffsetMin,
      speed * CAR_CAMERA.distanceSpeedScale * (1 - s.stiffness),
    );
    this.#distance = fInterpTo(this.#distance, s.distance + speedOffset, dt, CAR_CAMERA.distanceInterpRate);

    const position = add(sub(focus, scale(this.#yawDir, this.#distance)), scale(WORLD_UP, s.height));

    // Look along the yaw direction, pitched; ball cam pitches towards the ball
    let pitchDeg = s.pitch;
    if (ballCam) {
      const toBall = sub(ball.pos, focus);
      const ballPitch = Math.atan2(toBall.z, Math.hypot(toBall.x, toBall.y)) / DEG;
      pitchDeg = Math.min(
        BALL_CAMERA.pitchExtentMaxDeg,
        Math.max(-BALL_CAMERA.pitchExtentMinDeg, s.pitch + ballPitch * BALL_CAMERA.pitchScale),
      );
    }
    const lookDir = add(scale(this.#yawDir, Math.cos(pitchDeg * DEG)), scale(WORLD_UP, Math.sin(pitchDeg * DEG)));

    // Speed widens the FOV, supersonic more
    this.#speedFov = fInterpTo(
      this.#speedFov,
      CAR_CAMERA.maxSpeedFov * Math.min(1, speed / CAR_MAX_SPEED),
      dt,
      CAR_CAMERA.fovInterpSpeed,
    );
    this.#supersonicFov = fInterpTo(
      this.#supersonicFov,
      car.supersonic ? CAR_CAMERA.supersonicFov : 0,
      dt,
      CAR_CAMERA.supersonicFovInterpSpeed,
    );

    return {
      position,
      target: add(position, scale(lookDir, 1000)),
      up: WORLD_UP,
      horizontalFov: s.fov + this.#speedFov + this.#supersonicFov,
    };
  }
}
