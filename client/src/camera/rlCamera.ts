// Rocket League's player camera, ported from the game's UnrealScript (TAGame.upk / ProjectX.upk,
// disassembled with scripts/ubytecode.py; notes/camera.md):
//   CameraState_Car_TA      car cam: UpdateValidPOV and the functions it calls
//   CameraState_BallCam_TA  ball cam: overrides of UpdateFocusWorldOffset / UpdateFocus /
//                           UpdateAirAndGroundCamera / UpdateRotationModifiers
//   CameraStateBlender_X    transitions between the two
//   Camera_X / Camera_TA    UpdateCamera, FinalizeOrientation, ClipToField
// Not ported: swivel (right-stick/mouse look), rear camera, proximity distance, the "bouncy chassis"
// wobble (driven by the car mesh's suspension spring bone), demolished/replay cameras.
import type { CarState } from "../engine/world";
import { type Vec3, add, dot, scale, sub, vec3 } from "../math/vec";
import {
  type Rotator,
  ZERO_ROTATOR,
  addRotators,
  axesToRotator,
  cross,
  lerp,
  normal,
  normalizeRotator,
  rlerp,
  rotationAxes,
  rotator,
  rotatorToVector,
  rSmoothInterpTo,
  scaleRotator,
  subRotators,
  vSmoothInterpTo,
  vectorToRotator,
  vlerp,
} from "./unreal";

/** The player's camera settings (ProfileCameraSettings); defaults from the game. */
export interface CameraSettings {
  readonly fov: number; // horizontal, degrees
  readonly distance: number;
  readonly height: number;
  readonly pitch: number; // "angle", degrees
  readonly stiffness: number;
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

/** Archetypes.Camera.CameraState_Car (shared by the ball cam). */
const CAR = {
  interpToAirRate: 4,
  interpToGroundRate: 2,
  focusInterpRate: 6.32,
  focusInterpMaxDistance: 100,
  focusOffsetInterpRate: 2.03,
  distanceInterpRate: 4.14,
  groundRotationInterpRate: 13.39,
  groundRotationInterpRateWall: 2.03,
  airVelocityInfluence: 35,
  airVelocityInfluenceMaxSpeed: 10,
  distanceSpeedScale: 0.05,
  distanceOffsetMin: -50,
  maxSpeedFov: 5,
  fovInterpSpeed: 25,
  supersonicFov: 10,
  supersonicFovInterpSpeed: 40,
  rollScale: 0.1,
  groundNormalInterpRate: 10.46,
} as const;

/** Archetypes.Camera.CameraState_Ballcam. */
const BALL = { rotationRate: 8.59, pitchScale: 0.8, pitchFocusZFactor: 0.005, pitchExtentMin: 4000, pitchExtentMax: 8000 } as const;

const CAR_MAX_SPEED = 2300; // Car.MaxLinearSpeed
const DEGREES_TO_UNITS = 182.044; // as in UpdateViewOffset
const GROUND_CLAMP_Z_OFFSET = 10; // Camera_TA.GroundClampZOffset (ClipToField, soccar pylon ground at z 0)

/** Camera_X.CameraOrientation. */
export interface Pov {
  focus: Vec3;
  rotation: Rotator;
  distance: number;
  fov: number;
  calculatedLocation: Vec3;
}

const copyPov = (p: Pov): Pov => ({ ...p });

/** Camera_X.FinalizeOrientation. */
function finalize(p: Pov): void {
  p.rotation = normalizeRotator(p.rotation);
  p.calculatedLocation = sub(p.focus, scale(rotatorToVector(p.rotation), p.distance));
}

/** CameraState_Car_TA's InterpVector structs and UpdateInterpVector (framerate-independent path). */
class InterpVector {
  location: Vec3 = vec3(0, 0, 0);
  initialized = false;
  constructor(
    readonly rate: number,
    public maxDistance = 0,
  ) {}

  update(newValue: Vec3, dt: number): void {
    if (!this.initialized) {
      this.initialized = true;
      this.location = newValue;
      return;
    }
    this.location = vSmoothInterpTo(this.location, newValue, this.rate, dt);
    let delta = sub(newValue, this.location);
    if (this.maxDistance > 0 && dot(delta, delta) > this.maxDistance * this.maxDistance) {
      delta = scale(normal(delta), this.maxDistance);
      this.location = sub(newValue, delta);
    }
  }
}

export interface CameraInput {
  readonly car: CarState;
  readonly ball: Vec3;
  readonly settings: CameraSettings;
}

/** CameraState_Car_TA, or CameraState_BallCam_TA when `ballCam` (its overrides are inlined). */
export class CarCameraState {
  #onGround = false;
  #airGroundBlend = 0;
  #groundNormal = vec3(0, 0, 1);
  #firstExecution = true;
  #viewOffset = { focusZ: 0, pitch: 0, distance: 0 };
  readonly #focusInterp = new InterpVector(CAR.focusInterpRate, CAR.focusInterpMaxDistance);
  readonly #distanceInterp = new InterpVector(CAR.distanceInterpRate);
  readonly #focusOffsetInterp = new InterpVector(CAR.focusOffsetInterpRate);

  constructor(readonly ballCam: boolean) {}

  /** CameraState_Car_TA.BeginCameraState. */
  begin(input: CameraInput): void {
    this.#updateViewOffset(input.settings);
    this.#onGround = isOnGround(input.car);
    this.#airGroundBlend = this.#onGround ? 1 : 0;
    this.#groundNormal = input.car.groundNormal;
    this.#firstExecution = true;
    this.#focusInterp.initialized = false;
    this.#distanceInterp.initialized = false;
    this.#focusOffsetInterp.initialized = false;
  }

  /** CameraState_Car_TA.UpdateValidPOV. */
  update(dt: number, input: CameraInput, pov: Pov): void {
    const { car, settings } = input;
    this.#updateViewOffset(settings);
    this.#updateAirGroundBlend(dt, car);
    this.#updateFocusWorldOffset(dt, car);
    this.#updateFocus(dt, car, settings, pov);
    this.#updateAirAndGroundCamera(dt, input, pov);
    this.#updateDistance(dt, car, settings, pov);
    this.#updateFov(dt, car, settings, pov);
    if (!this.ballCam) this.#updateRotationModifiers(car, pov);
    this.#firstExecution = false;
  }

  #updateViewOffset(s: CameraSettings): void {
    this.#viewOffset = {
      focusZ: s.height, // + Camera_TA.GetDefaultViewHeightOffset() (splitscreen only)
      pitch: Math.trunc(s.pitch * DEGREES_TO_UNITS),
      distance: s.distance, // CameraStartDistance (0) + Distance * Max(0.75, mesh scale 1) + proximity (0)
    };
  }

  #updateAirGroundBlend(dt: number, car: CarState): void {
    if (this.#onGround !== isOnGround(car)) {
      this.#onGround = !this.#onGround;
      if (this.#onGround) this.#groundNormal = car.groundNormal;
    }
    this.#airGroundBlend += this.#onGround ? CAR.interpToGroundRate * dt : -CAR.interpToAirRate * dt;
    this.#airGroundBlend = Math.min(1, Math.max(0, this.#airGroundBlend));
  }

  #updateFocusWorldOffset(dt: number, car: CarState): void {
    if (this.ballCam) {
      this.#focusOffsetInterp.location = vec3(0, 0, this.#viewOffset.focusZ);
      return;
    }
    // On the ground the focus sits `height` above the car along the car's own up axis
    const offset =
      this.#airGroundBlend >= 1 ? scale(car.rot.up, this.#viewOffset.focusZ) : vec3(0, 0, this.#viewOffset.focusZ);
    this.#focusOffsetInterp.update(offset, dt);
  }

  #updateFocus(dt: number, car: CarState, s: CameraSettings, pov: Pov): void {
    // Ball cam: the focus may not lag behind the car at all
    this.#focusInterp.maxDistance = this.ballCam ? 0.001 : CAR.focusInterpMaxDistance;
    const focus = add(car.pos, this.#focusOffsetInterp.location);
    this.#focusInterp.update(focus, dt);
    const forward = rotatorToVector(pov.rotation);
    // Lagged focus sideways/vertically, but at the real focus's depth along the view
    let focusOffset = sub(this.#focusInterp.location, pov.calculatedLocation);
    focusOffset = sub(focusOffset, scale(forward, dot(forward, focusOffset)));
    focusOffset = add(focusOffset, scale(forward, dot(forward, sub(focus, pov.calculatedLocation))));
    pov.focus = vlerp(add(pov.calculatedLocation, focusOffset), focus, s.stiffness);
  }

  #updateAirAndGroundCamera(dt: number, input: CameraInput, pov: Pov): void {
    if (this.ballCam) {
      this.#updateBallCamRotation(dt, input.ball, pov);
      return;
    }
    const { car, settings } = input;
    if (this.#airGroundBlend >= 1) {
      this.#updateGroundPov(dt, car, settings, pov);
    } else if (this.#airGroundBlend <= 0) {
      this.#updateAirPov(car, pov);
    } else {
      const air = copyPov(pov);
      const ground = copyPov(pov);
      this.#updateGroundPov(dt, car, settings, ground);
      this.#updateAirPov(car, air);
      // Camera_X.BlendCameraOrientations(Air, Ground, AirGroundBlend)
      const a = this.#airGroundBlend;
      pov.distance = lerp(air.distance, ground.distance, a);
      pov.focus = vlerp(air.focus, ground.focus, a);
      pov.rotation = rlerp(air.rotation, ground.rotation, a);
      pov.fov = lerp(air.fov, ground.fov, a);
      finalize(pov);
    }
  }

  /** Look along the car's forward direction projected onto the (smoothed) ground plane. */
  #updateGroundPov(dt: number, car: CarState, s: CameraSettings, pov: Pov): void {
    this.#groundNormal = normal(vSmoothInterpTo(this.#groundNormal, car.groundNormal, CAR.groundNormalInterpRate, dt));
    const u = this.#groundNormal;
    const r = cross(u, car.rot.forward);
    const f = cross(r, u);
    const carPitch = vectorToRotator(f).pitch;
    const pitchBlend = Math.min(Math.abs(carPitch) / 48000, 1);
    const cameraDir = vlerp(f, carPitch > 0 ? scale(u, -1) : u, pitchBlend);
    let newRot = vectorToRotator(cameraDir);
    newRot = rotator(newRot.pitch + Math.min(this.#viewOffset.pitch, 16384 - newRot.pitch), newRot.yaw, newRot.roll);

    if (this.#firstExecution) {
      pov.rotation = newRot;
      return;
    }
    const rateScale = lerp(1, 3.427, s.stiffness);
    const ground =
      s.stiffness < 1 ? rSmoothInterpTo(pov.rotation, newRot, CAR.groundRotationInterpRate * rateScale, dt) : newRot;
    const wall = rSmoothInterpTo(pov.rotation, newRot, CAR.groundRotationInterpRateWall * rateScale, dt);
    pov.rotation = rlerp(ground, wall, 1 - Math.abs(u.z));
  }

  /** In the air the camera turns to look at the focus from where it is, dragging behind the car. */
  #updateAirPov(car: CarState, pov: Pov): void {
    if (this.#firstExecution) {
      const toVelocity = vectorToRotator(car.vel);
      const yaw = rlerp(axesToRotator(car.rot), toVelocity, Math.min(Math.hypot(car.vel.x, car.vel.y) / 500, 1)).yaw;
      pov.rotation = rotator(this.#viewOffset.pitch, yaw, 0);
      return;
    }
    const speedScale = Math.min(lengthOf(car.vel) / CAR_MAX_SPEED, 1);
    const interpRate = lerp(CAR.airVelocityInfluence, CAR.airVelocityInfluenceMaxSpeed, speedScale);
    let newRot = vectorToRotator(sub(pov.focus, pov.calculatedLocation));
    // The game uses a fixed 1/60 here, not DeltaTime
    newRot = rlerp(pov.rotation, newRot, Math.min(interpRate * (1 / 60), 1));
    // ScalePitch: flatten the pitch when moving backwards relative to the view
    const speedScale2D = Math.hypot(car.vel.x, car.vel.y) / CAR_MAX_SPEED;
    if (dot(car.vel, rotatorToVector(newRot)) < 0) {
      newRot = rotator(newRot.pitch * (1 - speedScale2D), newRot.yaw, newRot.roll);
    }
    pov.rotation = newRot;
  }

  /** CameraState_BallCam_TA.UpdateAirAndGroundCamera. */
  #updateBallCamRotation(dt: number, ball: Vec3, pov: Pov): void {
    const ballLocation = ball; // Target.GetFocus(): the ball
    let toBall = vectorToRotator(sub(ballLocation, pov.focus));
    pov.focus = add(pov.focus, vec3(0, 0, Math.abs(toBall.pitch) * BALL.pitchFocusZFactor));
    toBall = vectorToRotator(sub(ballLocation, pov.focus));
    const strength = Math.min(
      1,
      Math.max(0, (Math.abs(toBall.pitch) - BALL.pitchExtentMin) / (BALL.pitchExtentMax - BALL.pitchExtentMin)),
    );
    toBall = rotator(lerp(this.#viewOffset.pitch, toBall.pitch, BALL.pitchScale * strength), toBall.yaw, toBall.roll);
    pov.rotation = this.#firstExecution ? toBall : rSmoothInterpTo(pov.rotation, toBall, BALL.rotationRate, dt);
  }

  #updateDistance(dt: number, car: CarState, s: CameraSettings, pov: Pov): void {
    const viewDir = rotatorToVector(pov.rotation);
    const newDistance =
      this.#viewOffset.distance +
      Math.max(dot(car.vel, viewDir) * CAR.distanceSpeedScale * (1 - s.stiffness), CAR.distanceOffsetMin);
    this.#distanceInterp.update(vec3(newDistance, 0, 0), dt);
    pov.distance = this.#distanceInterp.location.x;
  }

  #updateFov(dt: number, car: CarState, s: CameraSettings, pov: Pov): void {
    const [newFov, interpSpeed] = car.supersonic
      ? [s.fov + CAR.supersonicFov, CAR.supersonicFovInterpSpeed]
      : [lerp(s.fov, s.fov + CAR.maxSpeedFov, lengthOf(car.vel) / CAR_MAX_SPEED), CAR.fovInterpSpeed];
    if (this.#firstExecution) {
      pov.fov = newFov;
      return;
    }
    const maxDelta = interpSpeed * dt;
    pov.fov += Math.min(maxDelta, Math.max(-maxDelta, newFov - pov.fov));
  }

  /** Car cam only: roll a tenth of the car's roll while grounded. (Bouncy chassis not ported.) */
  #updateRotationModifiers(car: CarState, pov: Pov): void {
    if (this.#airGroundBlend > 0) {
      const roll = Math.trunc(vectorToRotator(car.rot.right).pitch * -CAR.rollScale * this.#airGroundBlend);
      pov.rotation = rotator(pov.rotation.pitch, pov.rotation.yaw, roll);
    }
  }
}

const lengthOf = (v: Vec3): number => Math.sqrt(dot(v, v));

/** CameraState_CarRef_TA.IsOnGround: on the ground and not in the middle of a jump. */
const isOnGround = (car: CarState): boolean => car.onGround && !car.jumping;

interface PovDelta {
  focus: Vec3;
  rotation: Rotator;
  distance: number;
  fov: number;
}

const EMPTY_DELTA: PovDelta = { focus: vec3(0, 0, 0), rotation: ZERO_ROTATOR, distance: 0, fov: 0 };

/** CameraStateBlender_X: blends a camera switch by fading out the offset between the two views. */
class Blender {
  state: CarCameraState | null = null;
  #from: CarCameraState | null = null;
  #remaining = 0;
  #blendTime = 0;
  #started = false;
  #snapshot: PovDelta = EMPTY_DELTA;
  #delta: PovDelta = EMPTY_DELTA;

  /** TransitionToState; blend time from CameraState_Car_TA.StaticOverrideBlendParams. */
  transitionTo(next: CarCameraState, input: CameraInput): void {
    if (next === this.state) return;
    this.#clearTransition();
    if (this.state) {
      const transitionSpeed = Math.min(2, Math.max(1, input.settings.transitionSpeed));
      this.#blendTime = lerp(0.5, 0, Math.min(1, Math.max(0, transitionSpeed - 1)));
      if (this.#blendTime > 0) {
        this.#from = this.state;
        this.#remaining = this.#blendTime;
      } else {
        this.#delta = EMPTY_DELTA;
        next.begin(input);
      }
    } else {
      next.begin(input);
    }
    this.state = next;
  }

  tick(dt: number, input: CameraInput): void {
    if (this.#remaining <= 0) return;
    this.#remaining -= dt;
    if (this.#remaining <= 0) {
      if (!this.#started) this.state?.begin(input);
      this.#clearTransition();
      this.#delta = EMPTY_DELTA;
    }
  }

  update(dt: number, input: CameraInput, pov: Pov): void {
    if (this.#remaining > 0) this.#blendState(dt, input, pov);
    else this.state?.update(dt, input, pov);
  }

  /** Adds the fading offset to the displayed view only. */
  postProcess(pov: Pov): void {
    if (this.#remaining <= 0) return;
    pov.focus = add(pov.focus, this.#delta.focus);
    pov.rotation = addRotators(pov.rotation, this.#delta.rotation);
    pov.distance += this.#delta.distance;
    pov.fov += this.#delta.fov;
  }

  #blendState(dt: number, input: CameraInput, pov: Pov): void {
    if (!this.#started) {
      this.#started = true;
      const snapshot = copyPov(pov);
      this.#from?.update(dt, input, snapshot);
      this.state?.begin(input);
      this.#from = null;
      this.state?.update(dt, input, pov);
      this.#snapshot = {
        focus: add(sub(snapshot.focus, pov.focus), this.#delta.focus),
        rotation: normalizeRotator(addRotators(normalizeRotator(subRotators(snapshot.rotation, pov.rotation)), this.#delta.rotation)),
        distance: snapshot.distance - pov.distance + this.#delta.distance,
        fov: snapshot.fov - pov.fov + this.#delta.fov,
      };
      this.#delta = EMPTY_DELTA;
    } else {
      this.state?.update(dt, input, pov);
    }
    const blendPct = this.#remaining / this.#blendTime; // CameraUtils_X.GetBlendPercent, linear
    this.#delta = {
      focus: scale(this.#snapshot.focus, blendPct),
      rotation: scaleRotator(this.#snapshot.rotation, blendPct),
      distance: this.#snapshot.distance * blendPct,
      fov: this.#snapshot.fov * blendPct,
    };
  }

  #clearTransition(): void {
    this.#from = null;
    this.#remaining = 0;
    this.#started = false;
  }
}

export interface CameraView {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly horizontalFov: number;
}

/** Camera_X.UpdateCamera with the car cam and ball cam states. */
export class PlayerCamera {
  settings: CameraSettings = DEFAULT_CAMERA_SETTINGS;
  readonly #carCam = new CarCameraState(false);
  readonly #ballCam = new CarCameraState(true);
  readonly #blender = new Blender();
  #pov: Pov = { focus: vec3(0, 0, 0), rotation: ZERO_ROTATOR, distance: 0, fov: 90, calculatedLocation: vec3(0, 0, 0) };

  /** Start over (after a reset): the next update snaps instead of blending. */
  reset(): void {
    this.#blender.state = null;
  }

  update(dt: number, car: CarState, ball: Vec3, ballCam: boolean): CameraView {
    const input: CameraInput = { car, ball, settings: this.settings };
    // UpdateCameraState: the first state whose ShouldExecute() passes
    const wanted = ballCam ? this.#ballCam : this.#carCam;
    if (this.#blender.state !== wanted) this.#blender.transitionTo(wanted, input);
    this.#blender.tick(dt, input);
    this.#blender.update(dt, input, this.#pov);
    finalize(this.#pov);

    const view = copyPov(this.#pov);
    this.#blender.postProcess(view);
    finalize(view);
    // Camera_TA.ClipToField (soccar: keep the camera GroundClampZOffset above the floor)
    const location = view.calculatedLocation;
    const clipped = vec3(location.x, location.y, Math.max(location.z, GROUND_CLAMP_Z_OFFSET));

    const axes = rotationAxes(view.rotation);
    return { position: clipped, forward: axes.forward, up: axes.up, horizontalFov: view.fov };
  }
}
