// The camera's fade (Camera.SetCameraFade): the goal replay cuts in from black and fades in over 0.5 s, and the camera
// after it does the same (CameraState_LiveReplay_TA Begin / End; notes/camera-respawn-goal.md GS-10). Real time. Drawn
// through the renderer's post-processing (its remap, as the game's LUT: RV-159: Renderer.cameraFade).

export const FADE_SECONDS = 0.5;

export class Fade {
  #left = 0;
  #length = FADE_SECONDS;
  #from = 1;
  #to = 0;

  /** Black now, clear after `seconds` */
  fromBlack(seconds = FADE_SECONDS): void {
    this.#from = 1;
    this.#to = 0;
    this.#left = seconds;
    this.#length = seconds;
  }

  /** From where it is to black over `seconds` (the pre-podium's: CAM-35), staying black */
  toBlack(seconds: number): void {
    this.#from = this.opacity;
    this.#to = 1;
    this.#left = seconds;
    this.#length = seconds;
  }

  update(realSeconds: number): void {
    this.#left = Math.max(0, this.#left - realSeconds);
  }

  /** 1 black .. 0 clear */
  get opacity(): number {
    const t = this.#length > 0 ? this.#left / this.#length : 0;
    return this.#to + (this.#from - this.#to) * t;
  }
}
