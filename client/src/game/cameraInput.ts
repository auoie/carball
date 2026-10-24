// The camera's input for a frame, shared by freeplay and online: the camera settings of the input in use (keyboard and
// mouse, or controller: notes/camera-respawn-goal.md CAM-17), the swivel, and the free look when that input has it on.
import type { FreeLookControls } from "../camera/carballCamera";
import type { InputDevices } from "../input/devices";
import { type ActionButton, type InputSnapshot, type LookInput, actionEvents, presses, readFreeLook, readLook } from "../input/mapping";
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
 * The switches after this frame's buttons (`held`, `before`: the buttons now and last frame), as the game's press and
 * release commands, each run as it comes (PlayerInput_X::InputKey 0x140e3a2b0) in the frame's input pass before the
 * camera reads them (UInput::Tick FUN_1409da2a0; WHEEL1's spec, RV-1137; notes/client-loop-timing.md LT-5): a toggle
 * flips on each press (N presses in a frame N times); held mode is one flag, set by any input's press and cleared by any
 * input's release (PressSecondaryCamera, ReleaseSecondaryCamera: the TAGame dump's 76986, 76995; the rear camera's 77005:
 * one bHoldingBallCamKey, no count of inputs held, RV-1144), the last event winning, so a press and release within the
 * frame leaves it off, and letting go of one of two held inputs turns it off (the rear camera: a new car turns it off
 * until the next press, newCar). A press held over frames counts once. `blocked`: the goal replay or after the
 * match, when the ball cam ignores its presses (PressSecondaryCamera returns, RV-9) but not its release
 * (ReleaseSecondaryCamera isn't blocked, RV-20).
 */
export function updateSwitches(
  state: CameraSwitches,
  held: { readonly ballCam: ActionButton; readonly rearCamera: ActionButton },
  before: { readonly ballCam: ActionButton; readonly rearCamera: ActionButton },
  o: { readonly ballCamToggle: boolean; readonly rearCameraToggle: boolean; readonly blocked: boolean },
): CameraSwitches {
  const ballPresses = o.blocked ? 0 : presses(held.ballCam, before.ballCam);
  const rearPresses = presses(held.rearCamera, before.rearCamera);
  // (held mode: the last of the frame's presses and releases, a blocked ball cam's presses left out, its releases not)
  const last = (events: boolean[], was: boolean): boolean => events.at(-1) ?? was;
  const ballEvents = actionEvents(held.ballCam, before.ballCam).filter((down) => !(o.blocked && down));
  const ballCam = o.ballCamToggle ? state.ballCam !== (ballPresses % 2 === 1) : last(ballEvents, state.ballCam);
  const rear = o.rearCameraToggle ? state.rear !== (rearPresses % 2 === 1) : last(actionEvents(held.rearCamera, before.rearCamera), state.rear);
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
