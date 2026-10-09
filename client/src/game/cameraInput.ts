// The camera's input for a frame, shared by freeplay and online: the camera settings of the input in use (keyboard and
// mouse, or controller: notes/camera-respawn-goal.md CAM-17), the swivel, and the free look when that input has it on.
import type { FreeLookControls } from "../camera/rlCamera";
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
