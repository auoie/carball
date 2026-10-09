// The camera's fade (Camera.SetCameraFade): the goal replay cuts in from black and fades in over 0.5 s, and the camera
// after it does the same (CameraState_LiveReplay_TA Begin / End; notes/camera-respawn-goal.md GS-10). Real time.

export const FADE_SECONDS = 0.5;

export class Fade {
  readonly #element: HTMLElement | null;
  #left = 0;
  #length = FADE_SECONDS;

  constructor(element: HTMLElement | null = document.querySelector<HTMLElement>("#fade")) {
    this.#element = element;
  }

  /** Black now, clear after `seconds` */
  fromBlack(seconds = FADE_SECONDS): void {
    this.#left = seconds;
    this.#length = seconds;
    this.#apply();
  }

  update(realSeconds: number): void {
    if (this.#left <= 0) return;
    this.#left = Math.max(0, this.#left - realSeconds);
    this.#apply();
  }

  /** 1 black .. 0 clear */
  get opacity(): number {
    return this.#length > 0 ? this.#left / this.#length : 0;
  }

  #apply(): void {
    if (this.#element) this.#element.style.opacity = String(this.opacity);
  }
}
