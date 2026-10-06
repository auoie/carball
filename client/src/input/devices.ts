// Collects keyboard, mouse and gamepad state from the browser into snapshots.
import type { GamepadSnapshot, InputSnapshot } from "./mapping";

export class InputDevices {
  readonly #keys = new Set<string>();
  readonly #mouseButtons = new Set<number>();
  // Pressed since the last snapshot: a tap shorter than one frame still shows up in one snapshot
  readonly #tappedKeys = new Set<string>();
  readonly #tappedButtons = new Set<number>();
  readonly #abort = new AbortController();
  #usingGamepad = false;

  /** `surface`: the element that receives mouse buttons (the game canvas). */
  constructor(surface: HTMLElement) {
    const signal = this.#abort.signal;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "Space" || e.code === "Backspace") e.preventDefault(); // no page scroll/back
        this.#usingGamepad = false;
        this.#keys.add(e.code);
        this.#tappedKeys.add(e.code);
      },
      { signal },
    );
    window.addEventListener("keyup", (e) => this.#keys.delete(e.code), { signal });
    surface.addEventListener(
      "mousedown",
      (e) => {
        if (e.button === 1) e.preventDefault(); // middle button = rear camera, not autoscroll
        this.#usingGamepad = false;
        this.#mouseButtons.add(e.button);
        this.#tappedButtons.add(e.button);
      },
      { signal },
    );
    window.addEventListener("mouseup", (e) => this.#mouseButtons.delete(e.button), { signal });
    surface.addEventListener("contextmenu", (e) => { e.preventDefault(); }, { signal }); // right button = jump
    window.addEventListener("blur", () => { this.#keys.clear(); this.#mouseButtons.clear(); }, { signal });
  }

  /** PlayerInput.bUsingGamepad: the gamepad was used more recently than the keyboard or mouse. */
  get usingGamepad(): boolean {
    return this.#usingGamepad;
  }

  dispose(): void {
    this.#abort.abort();
  }

  /** Held inputs, plus anything pressed (even briefly) since the previous snapshot. */
  snapshot(): InputSnapshot {
    const gamepad = readGamepad();
    if (gamepad && (gamepad.buttons.some((v) => v > 0.5) || gamepad.axes.some((v) => Math.abs(v) > 0.5))) {
      this.#usingGamepad = true;
    }
    const snapshot = {
      keys: new Set([...this.#keys, ...this.#tappedKeys]),
      mouseButtons: new Set([...this.#mouseButtons, ...this.#tappedButtons]),
      gamepad,
    };
    this.#tappedKeys.clear();
    this.#tappedButtons.clear();
    return snapshot;
  }
}

/** The first connected gamepad with the standard layout. */
export function readGamepad(): GamepadSnapshot | null {
  for (const pad of navigator.getGamepads()) {
    if (pad?.connected && pad.mapping === "standard") {
      return { axes: [...pad.axes], buttons: pad.buttons.map((b) => b.value) };
    }
  }
  return null;
}
