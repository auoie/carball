// The camera's fade (Camera.SetCameraFade): the goal replay cuts in from black and fades in over 0.5 s, and the camera
// after it does the same (CameraState_LiveReplay_TA Begin / End; notes/camera-respawn-goal.md GS-10). Real time. Drawn
// through the renderer's post-processing (its remap, as the game's LUT: RV-159: Renderer.cameraFade).

export const FADE_SECONDS = 0.5;

export class Fade {
  #left = 0;
  #length = FADE_SECONDS;

  /** Black now, clear after `seconds` */
  fromBlack(seconds = FADE_SECONDS): void {
    this.#left = seconds;
    this.#length = seconds;
  }

  update(realSeconds: number): void {
    this.#left = Math.max(0, this.#left - realSeconds);
  }

  /** 1 black .. 0 clear */
  get opacity(): number {
    return this.#length > 0 ? this.#left / this.#length : 0;
  }
}
