// The camera's input for a frame, shared by freeplay and online: the camera settings of the input in use (keyboard and
// mouse, or controller: notes/camera-respawn-goal.md CAM-17), the swivel, and the free look when that input has it on.
import type { FreeLookControls } from "../camera/carballCamera";
import type { InputDevices } from "../input/devices";
import { type InputSnapshot, type LookInput, readFreeLook, readLook } from "../input/mapping";
import type { InputCameraSettings, Settings } from "../settings/settings";

export interface CameraInputs {
  readonly device: InputCameraSettings;
  /** The swivel (PlayerController_TA.SwivelPitchDir applied) */
  readonly look: LookInput;
  /** Free-look mode's input (null: classic) */
  readonly freeLook: FreeLookControls | null;
}

/** `fov`: the camera's last view's (the look input scales by FOV / 90) */
export function cameraInputs(settings: Settings, snapshot: InputSnapshot, devices: InputDevices, fov: number): CameraInputs {
  const { bindings, controller } = settings;
  const gamepad = devices.ownerIsGamepad;
  const device = gamepad ? settings.cameraPad : settings.cameraKbm;
  // (the mouse is captured on a click while keyboard-and-mouse free look is on)
  devices.capturePointer = settings.cameraKbm.freeLook;
  const look = readLook(snapshot, bindings, controller.deadzone);
  const freeLook = device.freeLook
    ? {
        axes: readFreeLook(snapshot, bindings, controller.deadzone, {
          gamepad,
          fov,
          invertPitch: device.invertPitch,
          mouseSensitivity: controller.mouseSensitivity,
          freeLookDeadzone: controller.freeLookDeadzone,
        }),
        settings: device,
        ballCamHold: !device.ballCamToggle,
      }
    : null;
  return { device, look: { up: device.invertPitch ? -look.up : look.up, right: look.right }, freeLook };
}

/** The ball cam and rear camera switches (PressSecondaryCamera / PressRearCamera and their releases) */
export interface CameraSwitches {
  readonly ballCam: boolean;
  readonly rear: boolean;
}

/**
 * The switches after this frame's buttons (`held`, `before`: the buttons now and last frame): a toggle flips on its
 * press; held mode is on from the press to the release (the rear camera: a new car turns it off until the next press,
 * newCar). `blocked`: the goal replay or after the match, when the ball cam ignores its presses (PressSecondaryCamera
 * returns, RV-9) but not its release (ReleaseSecondaryCamera isn't blocked, RV-20).
 */
export function updateSwitches(
  state: CameraSwitches,
  held: { readonly ballCam: boolean; readonly rearCamera: boolean },
  before: { readonly ballCam: boolean; readonly rearCamera: boolean },
  o: { readonly ballCamToggle: boolean; readonly rearCameraToggle: boolean; readonly blocked: boolean },
): CameraSwitches {
  const ballPressed = held.ballCam && !before.ballCam;
  const rearPressed = held.rearCamera && !before.rearCamera;
  const press = ballPressed && !o.blocked;
  const ballCam = o.ballCamToggle ? (press ? !state.ballCam : state.ballCam) : held.ballCam && (state.ballCam || press);
  const rear = o.rearCameraToggle ? (rearPressed ? !state.rear : state.rear) : held.rearCamera && (state.rear || rearPressed);
  return { ballCam, rear };
}

/** A new car (a kickoff, a respawn, a reset: PlayerController_TA.OnPawnChange → SetUsingBehindView(false), RV-10) */
export function newCar(state: CameraSwitches): CameraSwitches {
  return { ...state, rear: false };
}

/**
 * When to send input packets (NetworkInputBuffer_TA.ShouldSendClientMovePackets): once a frame, when 1/60 s of real
 * time (DeltaSeconds / TimeDilation) has passed since the last; the leftover carried, at most one interval (RV-4).
 */
export class SendClock {
  #since = 0;

  constructor(readonly interval = 1 / 60) {}

  due(realSeconds: number): boolean {
    this.#since += realSeconds;
    if (this.#since < this.interval) return false;
    this.#since = Math.min(this.interval, Math.max(0, this.#since - this.interval));
    return true;
  }
}
