// Rocket League's player camera, ported from the game's UnrealScript (TAGame.upk / ProjectX.upk,
// disassembled with scripts/ubytecode.py; notes/camera.md):
//   CameraState_Car_TA      car cam: UpdateValidPOV and the functions it calls
//   CameraState_BallCam_TA  ball cam: overrides of UpdateFocusWorldOffset / UpdateFocus /
//                           UpdateAirAndGroundCamera / UpdateRotationModifiers
//   CameraStateBlender_X    transitions between the states
//   Camera_X / Camera_TA    UpdateCamera, FinalizeOrientation, ClipToField, swivel, rear camera
//   CameraState_Demolished_TA, CameraState_DemoSpawnSelect_TA, CameraState_Prespawn_TA
//                           after a demolition (notes/camera-respawn-goal.md CAM-20..29)
// The goal replay's camera is src/camera/replayCamera.ts. Not ported: proximity distance, the "bouncy chassis"
// wobble (driven by the car mesh's suspension spring bone).
import type { CarState, RespawnSpot } from "../engine/world";
import { type Vec3, add, dot, scale, sub, vec3 } from "../math/vec";
import { type FreeLookAxes, FreeLookRate, type FreeLookSettings, MAX_FREE_LOOK_PITCH, type RotatorOffset } from "./freeLook";
import { CameraShakes } from "./shake";
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

  clone(): InterpVector {
    const copy = new InterpVector(this.rate, this.maxDistance);
    copy.location = this.location;
    copy.initialized = this.initialized;
    return copy;
  }

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
  readonly rear: boolean; // CameraSettings.bUsingBehindView
  /** The local car's respawn, while it's demolished */
  readonly respawn: RespawnCameraInput | null;
  /** Free look running in this state: this frame's offset (rotator units); null: off (classic, or not allowed) */
  readonly freeLook: RotatorOffset | null;
}

/** ApplyFreeLook: the offset added, the pitch clamped to ±75° (truncated), no roll */
function applyFreeLook(rotation: Rotator, offset: RotatorOffset): Rotator {
  const pitch = Math.trunc(Math.min(MAX_FREE_LOOK_PITCH, Math.max(-MAX_FREE_LOOK_PITCH, rotation.pitch + offset.pitch)));
  return rotator(pitch, rotation.yaw + offset.yaw, 0);
}

/** What the respawn cameras follow (the local car demolished) */
export interface RespawnCameraInput {
  /** Where the car was demolished (its drawn position then) */
  readonly wreck: Vec3;
  /** The spot picked so far (DemoSpawnSelect), null before the first pick */
  readonly selected: RespawnSpot | null;
  /** The spot locked in for the respawn (Prespawn), null before */
  readonly locked: RespawnSpot | null;
}

/** A camera state (CameraState_X): BeginCameraState, then UpdatePOV each frame on the persistent POV */
interface CameraState {
  begin(input: CameraInput): void;
  update(dt: number, input: CameraInput, pov: Pov): void;
}

/** Spawn actors stand at z 83 (the respawn cameras' focus is that + Height) */
const SPAWN_Z = 83;
const RADIANS_TO_UNITS = 32768 / Math.PI;

/** CameraState_Demolished_TA: on its first frame the focus goes above the wreck, 400 away at FOV 120; the rotation is
 *  never written (the car cam's last one stays, its roll too) */
class DemolishedCameraState implements CameraState {
  #first = true;

  begin(): void {
    this.#first = true;
  }

  update(_dt: number, input: CameraInput, pov: Pov): void {
    if (this.#first && input.respawn) {
      this.#first = false;
      pov.focus = add(input.respawn.wreck, vec3(0, 0, input.settings.height));
      pov.distance = 400;
      pov.fov = 120;
    }
    if (input.freeLook) pov.rotation = applyFreeLook(pov.rotation, input.freeLook);
  }
}

/** CameraState_DemoSpawnSelect_TA: above the picked spot, facing its way (pitch 0), at the player's distance and FOV;
 *  a new pick moves there over DemoSelectChangeSpawnTime 0.1 s */
class SpawnSelectCameraState implements CameraState {
  static readonly CHANGE_SECONDS = 0.1;
  #since = SpawnSelectCameraState.CHANGE_SECONDS;
  #spot: RespawnSpot | null = null;
  /** The view shown last (before the height and the free look): a new pick moves from there (PrevLocation/Rotation) */
  #shown: { focus: Vec3; rotation: Rotator } | null = null;
  #from: { focus: Vec3; rotation: Rotator } | null = null;
  #look: Rotator = ZERO_ROTATOR; // the free look accumulated on the spot's view (FreeLookAccumOffset)

  begin(input: CameraInput): void {
    this.#look = ZERO_ROTATOR;
    this.#since = SpawnSelectCameraState.CHANGE_SECONDS; // (no move on entry)
    this.#spot = input.respawn?.selected ?? null;
    this.#shown = null;
    this.#from = null;
  }

  update(dt: number, input: CameraInput, pov: Pov): void {
    const spot = input.respawn?.selected ?? this.#spot;
    if (!spot) return;
    // HandleDemoDataChanged: from the view shown last, even mid-move
    if (this.#spot && this.#shown && (spot.pos.x !== this.#spot.pos.x || spot.pos.y !== this.#spot.pos.y)) {
      this.#from = this.#shown;
      this.#since = 0;
    }
    this.#spot = spot;
    const to = { focus: vec3(spot.pos.x, spot.pos.y, SPAWN_Z), rotation: rotator(0, Math.trunc(spot.yaw * RADIANS_TO_UNITS), 0) };
    // (the move's alpha before the time steps: the change's frame shows where it was)
    const t = this.#since / SpawnSelectCameraState.CHANGE_SECONDS;
    this.#since += dt;
    const shown = t < 1 && this.#from ? { focus: vlerp(this.#from.focus, to.focus, t), rotation: rlerp(this.#from.rotation, to.rotation, t) } : to;
    this.#shown = shown;
    pov.focus = shown.focus;
    pov.rotation = shown.rotation;
    pov.focus = add(pov.focus, vec3(0, 0, input.settings.height));
    pov.distance = input.settings.distance;
    pov.fov = input.settings.fov;
    this.#look = input.freeLook ? applyFreeLook(this.#look, input.freeLook) : ZERO_ROTATOR;
    pov.rotation = rotator(pov.rotation.pitch + this.#look.pitch, pov.rotation.yaw + this.#look.yaw, 0);
  }
}

/** CameraState_Prespawn_TA: above the spot locked in for the respawn, facing its way, at the player's distance and FOV */
class PrespawnCameraState implements CameraState {
  begin(): void {
    // (nothing kept)
  }

  update(_dt: number, input: CameraInput, pov: Pov): void {
    const spot = input.respawn?.locked;
    if (!spot) return;
    pov.focus = vec3(spot.pos.x, spot.pos.y, SPAWN_Z + input.settings.height);
    pov.rotation = rotator(0, Math.trunc(spot.yaw * RADIANS_TO_UNITS), 0);
    pov.distance = input.settings.distance;
    pov.fov = input.settings.fov;
  }
}

/** CameraState_Car_TA, or CameraState_BallCam_TA when `ballCam` (its overrides are inlined). */
export class CarCameraState implements CameraState {
  #onGround = false;
  #airGroundBlend = 0;
  #groundNormal = vec3(0, 0, 1);
  #firstExecution = true;
  #wasRear = false;
  #viewOffset = { focusZ: 0, pitch: 0, distance: 0 };
  #focusInterp = new InterpVector(CAR.focusInterpRate, CAR.focusInterpMaxDistance);
  #distanceInterp = new InterpVector(CAR.distanceInterpRate);
  #focusOffsetInterp = new InterpVector(CAR.focusOffsetInterpRate);
  /** InterpRotationGround / InterpRotationWall: the ground view's two smoothed rotations; with free look they smooth
   *  from their own last values and make the car-facing frame (GetCarFacingRotation) */
  #interpGround: Rotator = ZERO_ROTATOR;
  #interpWall: Rotator = ZERO_ROTATOR;
  /** The view offset's pitch last applied to a free-look rotation */
  #appliedAnglePitch = 0;
  /** The next begin keeps the view's rotation and the other state's smoothing (free look: from the free-look ball cam
   *  to the car cam and back, CAM-14/15) */
  carryFrom: CarCameraState | null = null;

  constructor(readonly ballCam: boolean) {}

  /** CameraState_Car_TA.BeginCameraState. */
  begin(input: CameraInput): void {
    this.#updateViewOffset(input.settings);
    this.#onGround = isOnGround(input.car);
    this.#airGroundBlend = this.#onGround ? 1 : 0;
    this.#groundNormal = input.car.groundNormal;
    const from = this.carryFrom;
    this.carryFrom = null;
    if (from) {
      // CopyInterpStateFrom: the smoothing, the air/ground blend and the ground carry on. Into the free-look ball cam
      // (LookAtBall) its first frame faces the ball (bFirstExecution for the local car), the blender fading the old
      // view out; back into the car cam the view keeps the ball cam's rotation (CAM-14/15, RV-6)
      this.#focusInterp = from.#focusInterp.clone();
      this.#distanceInterp = from.#distanceInterp.clone();
      this.#focusOffsetInterp = from.#focusOffsetInterp.clone();
      this.#interpGround = from.#interpGround;
      this.#interpWall = from.#interpWall;
      this.#appliedAnglePitch = from.#appliedAnglePitch;
      this.#airGroundBlend = from.#airGroundBlend;
      this.#onGround = from.#onGround;
      this.#groundNormal = from.#groundNormal;
      this.#firstExecution = this.ballCam;
      return;
    }
    this.#firstExecution = true;
    this.#focusInterp.initialized = false;
    this.#distanceInterp.initialized = false;
    this.#focusOffsetInterp.initialized = false;
  }

  /** The car-facing frame (free look): RLerp(InterpRotationGround, InterpRotationWall, 1 - |ground normal z|) */
  #carFacing(): Rotator {
    return rlerp(this.#interpGround, this.#interpWall, 1 - Math.abs(this.#groundNormal.z));
  }

  /** CameraState_Car_TA.UpdateValidPOV. */
  update(dt: number, input: CameraInput, pov: Pov): void {
    const { car, settings } = input;
    if (this.ballCam) {
      // CameraState_BallCam_TA.UpdateValidPOV: switching the rear camera on or off starts over
      if (input.rear) {
        this.#firstExecution = !this.#wasRear;
        this.#wasRear = true;
      } else {
        this.#firstExecution ||= this.#wasRear;
        this.#wasRear = false;
      }
    }
    // With the rear camera on, the ball cam's overrides fall back to the car cam
    const lookAtBall = this.ballCam && !input.rear;
    // Free look (the car cam only): the view turns only by the look input; focus and distance follow the car-facing
    // frame (UpdateValidPOV's free-look order, notes/camera-respawn-goal.md CAM-13)
    const freeLook = this.ballCam ? null : input.freeLook;
    this.#updateViewOffset(settings);
    this.#updateAirGroundBlend(dt, car);
    this.#updateFocusWorldOffset(dt, car, lookAtBall);
    this.#updateFocus(dt, car, settings, pov, lookAtBall, freeLook !== null);
    const saved = freeLook && !this.#firstExecution ? pov.rotation : null;
    this.#updateAirAndGroundCamera(dt, input, pov, lookAtBall, freeLook !== null);
    if (saved) pov.rotation = rotator(saved.pitch + this.#viewOffset.pitch - this.#appliedAnglePitch, saved.yaw, saved.roll);
    this.#appliedAnglePitch = this.#viewOffset.pitch;
    this.#updateDistance(dt, car, settings, pov, freeLook !== null);
    this.#updateFov(dt, car, settings, pov);
    if (freeLook) pov.rotation = applyFreeLook(pov.rotation, freeLook);
    else if (!this.ballCam) this.#updateRotationModifiers(car, pov);
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

  #updateFocusWorldOffset(dt: number, car: CarState, lookAtBall: boolean): void {
    if (lookAtBall) {
      this.#focusOffsetInterp.location = vec3(0, 0, this.#viewOffset.focusZ);
      return;
    }
    // On the ground the focus sits `height` above the car along the car's own up axis
    const offset =
      this.#airGroundBlend >= 1 ? scale(car.rot.up, this.#viewOffset.focusZ) : vec3(0, 0, this.#viewOffset.focusZ);
    this.#focusOffsetInterp.update(offset, dt);
  }

  #updateFocus(dt: number, car: CarState, s: CameraSettings, pov: Pov, lookAtBall: boolean, freeLook: boolean): void {
    // Ball cam: the focus may not lag behind the car at all
    this.#focusInterp.maxDistance = lookAtBall ? 0.001 : CAR.focusInterpMaxDistance;
    const focus = add(car.pos, this.#focusOffsetInterp.location);
    this.#focusInterp.update(focus, dt);
    // (free look: along the car-facing frame, from where that frame would put the camera)
    const forward = rotatorToVector(freeLook ? this.#carFacing() : pov.rotation);
    const location = freeLook ? sub(pov.focus, scale(forward, pov.distance)) : pov.calculatedLocation;
    // Lagged focus sideways/vertically, but at the real focus's depth along the view
    let focusOffset = sub(this.#focusInterp.location, location);
    focusOffset = sub(focusOffset, scale(forward, dot(forward, focusOffset)));
    focusOffset = add(focusOffset, scale(forward, dot(forward, sub(focus, location))));
    pov.focus = vlerp(add(location, focusOffset), focus, s.stiffness);
  }

  #updateAirAndGroundCamera(dt: number, input: CameraInput, pov: Pov, lookAtBall: boolean, freeLook: boolean): void {
    if (lookAtBall) {
      this.#updateBallCamRotation(dt, input.ball, pov);
      return;
    }
    const { car, settings } = input;
    if (this.#airGroundBlend >= 1) {
      this.#updateGroundPov(dt, car, settings, pov, freeLook);
    } else if (this.#airGroundBlend <= 0) {
      this.#updateAirPov(car, pov);
    } else {
      const air = copyPov(pov);
      const ground = copyPov(pov);
      this.#updateGroundPov(dt, car, settings, ground, freeLook);
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
  #updateGroundPov(dt: number, car: CarState, s: CameraSettings, pov: Pov, freeLook: boolean): void {
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
      this.#interpGround = newRot;
      this.#interpWall = newRot;
      return;
    }
    const rateScale = lerp(1, 3.427, s.stiffness);
    // (free look: each from its own last value, toward the car's forward and the angle, no roll; else from the view's)
    const fromGround = freeLook ? this.#interpGround : pov.rotation;
    const fromWall = freeLook ? this.#interpWall : pov.rotation;
    const ground =
      s.stiffness < 1 ? rSmoothInterpTo(fromGround, newRot, CAR.groundRotationInterpRate * rateScale, dt) : newRot;
    const wall = rSmoothInterpTo(fromWall, newRot, CAR.groundRotationInterpRateWall * rateScale, dt);
    this.#interpGround = ground;
    this.#interpWall = wall;
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

  #updateDistance(dt: number, car: CarState, s: CameraSettings, pov: Pov, freeLook: boolean): void {
    const viewDir = rotatorToVector(freeLook ? this.#carFacing() : pov.rotation);
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
  state: CameraState | null = null;
  #from: CameraState | null = null;
  #remaining = 0;
  #blendTime = 0;
  #started = false;
  #snapshot: PovDelta = EMPTY_DELTA;
  #delta: PovDelta = EMPTY_DELTA;

  /** TransitionToState, blending over `blendTime` (the states' blend params: blendTimeBetween) */
  transitionTo(next: CameraState, input: CameraInput, blendTime: number): void {
    if (next === this.state) return;
    this.#clearTransition();
    if (this.state) {
      this.#blendTime = blendTime;
      if (this.#blendTime > 0) {
        this.#from = this.state;
        this.#remaining = this.#blendTime;
      } else {
        this.#delta = EMPTY_DELTA;
        next.begin(input);
      }
    } else {
      this.#delta = EMPTY_DELTA; // (the live game clears it on the first state too: camera-update-audit CAM-8)
      next.begin(input);
    }
    this.state = next;
  }

  /** A transition is still blending in */
  get blending(): boolean {
    return this.#remaining > 0;
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
      // The live game keeps the outgoing view's rotation from the previous frame (its blender resets the snapshot's
      // rotation after the state's last update: camera-update-audit CAM-7)
      snapshot.rotation = pov.rotation;
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
    // CameraUtils_X.GetBlendPercent with the states' blend params: the car and ball-cam archetypes override only
    // BlendTime, so the base Default__CameraState_X.DefaultBlendParams apply, VTBlend_EaseIn with BlendExp 2: the
    // offset fades as (remaining / BlendTime)^2 (a quarter at mid-blend, landing with zero slope), not linearly
    // (camera-update-audit CAM-2)
    const blendPct = (this.#remaining / this.#blendTime) ** 2;
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

/** Camera_TA swivel data (Default__Camera_TA), rotator units. */
const SWIVEL = {
  slow: { pitchMin: -8900, pitchMax: 5500, yawMax: 22500 },
  fast: { pitchMin: -8900, pitchMax: 5500, yawMax: 18000 },
  fastSpeed: 2500, // car speed at which the fast extents apply
  dieRate: 2, // speed multiplier while returning towards the centre
} as const;

/** Round to nearest, ties to even (x86 cvtss2si). */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * The swivel input is replicated as a byte: Object.FloatToRangeByteSigned, then RangeByteToFloatSigned
 * (natives 0x140362740 / 0x1403628b0).
 */
export function quantizeSwivelInput(v: number): number {
  const f = v < 0 ? Math.max(v * 128, -128) : Math.min(v * 127, 127);
  const b = roundHalfEven(2 * (f + 128) + 0.5) >> 1;
  return b < 128 ? (b - 128) / 128 : (b - 128) / 127;
}

/** Camera_TA.UpdateSwivel / GetDesiredSwivel: look around, eased towards the stick's angle. */
export class Swivel {
  #pitch = 0;
  #yaw = 0;

  get rotation(): Rotator {
    return rotator(this.#pitch, this.#yaw, 0);
  }

  /** `up`, `right`: the quantized input; `speed`: the car's speed; `swivelSpeed`: the player's setting. */
  update(dt: number, up: number, right: number, speed: number, swivelSpeed: number): void {
    const alpha = Math.min(1, Math.max(0, speed / SWIVEL.fastSpeed));
    const pitchMax = Math.trunc(lerp(SWIVEL.slow.pitchMax, SWIVEL.fast.pitchMax, alpha));
    const pitchMin = Math.trunc(lerp(SWIVEL.slow.pitchMin, SWIVEL.fast.pitchMin, alpha));
    const yawMax = Math.trunc(lerp(SWIVEL.slow.yawMax, SWIVEL.fast.yawMax, alpha));
    const desiredYaw = Math.trunc(right * yawMax);
    const desiredPitch = Math.trunc(up > 0 ? up * pitchMax : Math.abs(up) * pitchMin);
    const pitchSpeed = swivelSpeed * (Math.abs(desiredPitch) < Math.abs(this.#pitch) ? SWIVEL.dieRate : 1);
    const yawSpeed = swivelSpeed * (Math.abs(desiredYaw) < Math.abs(this.#yaw) ? SWIVEL.dieRate : 1);
    this.#pitch = Math.trunc(lerp(this.#pitch, desiredPitch, Math.min(pitchSpeed * dt, 1)));
    this.#yaw = Math.trunc(lerp(this.#yaw, desiredYaw, Math.min(yawSpeed * dt, 1)));
  }
}

/** What the player does with the camera this frame. */
export interface CameraControls {
  readonly ballCam: boolean;
  readonly rear: boolean;
  /** Swivel input, -1..1: positive looks up / right (the caller applies the pitch inversion option). */
  readonly lookUp: number;
  readonly lookRight: number;
  /** Free-look mode (the input in use has free look on: bUnconstrainRotation): its input; null or absent: classic */
  readonly freeLook?: FreeLookControls | null;
}

export interface FreeLookControls {
  readonly axes: FreeLookAxes;
  readonly settings: FreeLookSettings;
  /** The ball cam is held, not toggled (it then lasts at least its blend in) */
  readonly ballCamHold: boolean;
}

/** FreeLookExitSpeedFloor / FreeLookExitDuration: in toggle mode, mouse free look this fast (input per second) for this
 *  long leaves the free-look ball cam; a stick past its free-look deadzone leaves it at once */
const FREE_LOOK_EXIT_SPEED = 30;
const FREE_LOOK_EXIT_SECONDS = 0.15;

export interface CameraView {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly horizontalFov: number;
}

/** The local car's respawn as the cameras need it (each frame while it's demolished) */
export interface RespawnState {
  /** Respawns wait (after a goal, until the kickoff): no prespawn, the demolished camera stays */
  readonly held: boolean;
  /** The spot picked so far (respawnSpots(team, side)[index]), null before the first pick */
  readonly selected: RespawnSpot | null;
}


/** Camera_X.UpdateCamera with the game's states (Camera_Default.States, in order: Prespawn, Demolished,
 *  DemoSpawnSelect, the ball cam, the car cam): the current one runs while it ShouldKeepExecuting, else the first that
 *  ShouldExecute. */
export class PlayerCamera {
  settings: CameraSettings = DEFAULT_CAMERA_SETTINGS;
  /** The camera shakes playing (src/camera/shake.ts); applied only with `shake` on (the Default preset's camera shake) */
  readonly shakes = new CameraShakes();
  shake = false;
  readonly #carCam = new CarCameraState(false);
  readonly #ballCam = new CarCameraState(true);
  readonly #demolished = new DemolishedCameraState();
  readonly #spawnSelect = new SpawnSelectCameraState();
  readonly #prespawn = new PrespawnCameraState();
  readonly #blender = new Blender();
  readonly #swivel = new Swivel();
  #fov = 90; // the last view's FOV (GetFOVAngle)
  #pov: Pov = { focus: vec3(0, 0, 0), rotation: ZERO_ROTATOR, distance: 0, fov: 90, calculatedLocation: vec3(0, 0, 0) };
  /** Camera_TA.bDemolished: set by the demolition (Camera_TA.Demolished), cleared when its state ends */
  #demolishedFlag = false;
  #wreck: Vec3 | null = null;
  #wasDemoed = false;
  readonly #freeLook = new FreeLookRate();
  #fastLook = 0; // seconds the mouse free look has been past the exit speed (the ball cam's exit)
  #ballCamExit = false;

  /** Start over (after a reset): the next update snaps instead of blending. */
  reset(): void {
    this.#blender.state = null;
  }

  /** The last view's FOV (GetFOVAngle: the look input scales by FOV / 90) */
  get fov(): number {
    return this.#fov;
  }

  /** Whether free look left the ball cam since the last call (toggle mode: the caller turns its toggle off) */
  takeBallCamExit(): boolean {
    const exit = this.#ballCamExit;
    this.#ballCamExit = false;
    return exit;
  }

  /** `respawn`: while the car is demolished (null otherwise); `realDt`: real time (the swivel's; `dt` is the world's,
   *  slowed after a goal: Camera_TA.UpdateSwivel divides by the time dilation) */
  update(dt: number, car: CarState, ball: Vec3, controls: CameraControls, respawn: RespawnState | null = null, realDt = dt): CameraView {
    if (car.demoed && !this.#wasDemoed) {
      this.#demolishedFlag = true;
      this.#wreck = car.pos;
    }
    this.#wasDemoed = car.demoed;
    const respawnInput: RespawnCameraInput | null =
      car.demoed && this.#wreck ? { wreck: this.#wreck, selected: respawn?.selected ?? null, locked: car.spawnSelection.locked } : null;
    const mode = controls.freeLook ?? null;
    const current = this.#blender.state;
    // Free-look mode, ball cam held: a release while it still blends in is ignored (it lasts at least its blend)
    const holding = mode !== null && mode.ballCamHold && current === this.#ballCam && this.#blender.blending;
    const wanted = this.#select(car, { ...controls, ballCam: controls.ballCam || holding }, respawn);
    // Free look runs in the car cam (not in rear view), the demolished and the spot-selection views; elsewhere, or with
    // free look off, it's turned off (TurnOffFreeLook), as when any of those three begins; the car cam's first frame
    // takes no free-look input (RV-11)
    const canFreeLook = wanted === this.#carCam || wanted === this.#demolished || wanted === this.#spawnSelect;
    // (back from the free-look ball cam the car cam carries on: no TurnOffFreeLook, and its first frame takes input,
    // bFirstExecution false: RV-27; nothing turns free look off while the ball cam runs)
    const fromLookAtBall = mode !== null && current === this.#ballCam && wanted === this.#carCam;
    const begins = current !== wanted && canFreeLook && !fromLookAtBall;
    if (canFreeLook && (mode === null || controls.rear || begins)) this.#freeLook.reset();
    // (a fresh car cam's first frame stays in free-look mode, bFreeLookActive, with no input: RV-19)
    const firstCarFrame = current !== wanted && wanted === this.#carCam && !fromLookAtBall;
    const active = mode !== null && canFreeLook && !controls.rear;
    const freeLook = active ? (firstCarFrame ? { pitch: 0, yaw: 0 } : this.#freeLook.update(dt, mode.axes, mode.settings)) : null;
    const input: CameraInput = { car, ball, settings: this.settings, rear: controls.rear, respawn: respawnInput, freeLook };
    if (current !== wanted) {
      // Free look: between the free-look ball cam (LookAtBall) and the car cam the view keeps its rotation and smoothing
      const cams = [this.#carCam, this.#ballCam];
      const from = cams.find((c) => c === current);
      const to = cams.find((c) => c === wanted);
      if (mode && from && to) to.carryFrom = from;
      this.#blender.transitionTo(wanted, input, this.#blendTime(current, wanted));
    }
    this.#watchBallCamExit(dt, mode, controls);
    this.#blender.tick(dt, input);
    this.#blender.update(dt, input, this.#pov);
    finalize(this.#pov);

    // Camera_TA.PostProcessCameraState: the blend offset, swivel, then the rear view
    const view = copyPov(this.#pov);
    this.#blender.postProcess(view);
    // PlayerInput_TA scales the look input by FOV / 90, then it is replicated as a byte
    const fovScale = this.#fov / 90;
    const up = quantizeSwivelInput(controls.lookUp * fovScale);
    const right = quantizeSwivelInput(controls.lookRight * fovScale);
    // (no swivel in free-look mode, bCanSwivel && !bUnconstrainRotation: neither updated nor applied, so it's kept for
    // when free look is off again: RV-13)
    if (!mode) {
      this.#swivel.update(realDt, up, right, lengthOf(car.vel), this.settings.swivelSpeed);
      view.rotation = addRotators(view.rotation, this.#swivel.rotation);
    }
    if (controls.rear) view.rotation = rotator(view.rotation.pitch, view.rotation.yaw + 32768, view.rotation.roll);
    finalize(view);
    // Camera_X.ApplyCameraModifiers: the shakes, summed, after the swivel and the rear camera, before ClipToField
    this.shakes.update(dt);
    if (this.shake) {
      const { rotation, location } = this.shakes.offsets(car.pos);
      view.rotation = addRotators(view.rotation, rotation);
      view.calculatedLocation = add(view.calculatedLocation, location);
    }
    this.#fov = view.fov;
    // Camera_TA.ClipToField (soccar: keep the camera GroundClampZOffset above the floor)
    const location = view.calculatedLocation;
    const clipped = vec3(location.x, location.y, Math.max(location.z, GROUND_CLAMP_Z_OFFSET));

    const axes = rotationAxes(view.rotation);
    return { position: clipped, forward: axes.forward, up: axes.up, horizontalFov: view.fov };
  }

  /** SelectCameraState: the current state while it keeps executing, else the first in order that executes */
  #select(car: CarState, controls: CameraControls, respawn: RespawnState | null): CameraState {
    const demoed = car.demoed;
    const held = respawn?.held ?? false;
    // (a spot locked in: PC.Prespawn.bPrespawnSet; without one, nothing prespawns and the new car cuts in: RV-8)
    const locked = car.spawnSelection.locked !== null;
    // PC.Prespawn.bPrespawnSet (HandlePrespawn, 0.5 s before the respawn); the spot selection while it's open, once a
    // spot was picked (HasDemoSelection)
    const prespawnSet = demoed && !held && locked;
    const selecting = demoed && !held && !locked && (respawn?.selected ?? null) !== null;
    const current = this.#blender.state;
    const keeps =
      (current === this.#prespawn && (prespawnSet || demoed)) || // (… || waiting for the new car)
      (current === this.#demolished && demoed && !prespawnSet && !selecting) ||
      (current === this.#spawnSelect && selecting);
    if (current && keeps) return current;
    if (current === this.#demolished) this.#demolishedFlag = false; // (its EndCameraState: it doesn't come back)
    if (prespawnSet && !selecting) return this.#prespawn;
    if (demoed && this.#demolishedFlag) return this.#demolished;
    if (selecting) return this.#spawnSelect;
    if (demoed) return current ?? this.#demolished; // (nothing else runs without a car: the view stays)
    return controls.ballCam ? this.#ballCam : this.#carCam;
  }

  /** The blend between two states (their start and end blend params; all EaseIn, exponent 2): into the demolished
   *  view 0.25 s; from it 0.25 s to the spot selection, 0.5 s to the prespawn (PrespawnLerpSpeed), else a cut; out of
   *  the selection and the prespawn, and between the car and ball cams, by the transition speed (0.5 s at 1) */
  #blendTime(from: CameraState | null, to: CameraState): number {
    const transition = lerp(0.5, 0, Math.min(1, Math.max(0, this.settings.transitionSpeed - 1)));
    if (to === this.#demolished) return 0.25;
    if (from === this.#demolished) return to === this.#spawnSelect ? 0.25 : to === this.#prespawn ? 0.5 : 0;
    return transition;
  }

  /** The free-look ball cam's exit by looking around (toggle mode; never while it blends in): the mouse past
   *  FREE_LOOK_EXIT_SPEED for FREE_LOOK_EXIT_SECONDS, a stick past its deadzone at once */
  #watchBallCamExit(dt: number, mode: FreeLookControls | null, controls: CameraControls): void {
    if (!mode || mode.ballCamHold || !controls.ballCam || this.#blender.state !== this.#ballCam || this.#blender.blending || dt <= 0) {
      this.#fastLook = 0;
      return;
    }
    const { pitch, yaw, source } = mode.axes;
    if (source === "stick") {
      if (pitch !== 0 || yaw !== 0) this.#ballCamExit = true;
      return;
    }
    this.#fastLook = Math.hypot(pitch, yaw) / dt > FREE_LOOK_EXIT_SPEED ? this.#fastLook + dt : 0;
    if (this.#fastLook >= FREE_LOOK_EXIT_SECONDS) {
      this.#fastLook = 0;
      this.#ballCamExit = true;
    }
  }
}
