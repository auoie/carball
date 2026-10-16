// The loading screen (ours, the user's request, 2026-10-16: the menus' look, nothing of the game's): the name, the map
// and mode when known, a slowly turning ring, the step in small text over a thin bar; over the whole game layer (the HUD
// and menus not seen half laid out: the user's finding) until the game's first frame is drawn, then faded out. Its
// markup is the page's own (index.html: shown from the first paint); the ring turns and the bar moves on the
// compositor, so a busy main thread (the engine's compile, the shaders') neither stops them nor is slowed by them.

/** The steps, in order, and how far along the bar each starts (the shaders the longest) */
export const LOADING_STEPS = {
  engine: { text: "Loading the physics engine", at: 0.05 },
  arena: { text: "Building the arena", at: 0.3 },
  connecting: { text: "Connecting to the server", at: 0.42 },
  map: { text: "Loading the map", at: 0.5 },
  shaders: { text: "Preparing shaders", at: 0.62 },
  firstFrame: { text: "Preparing shaders", at: 0.86 },
} as const;

export type LoadingStep = keyof typeof LOADING_STEPS;

/** The fade into the game (s: the style sheet's #loading transition) */
export const LOADING_FADE = 0.45;

/** The map and mode line ("Night · Free Play"; either alone; empty without both) */
export function placeText(map: string | null, mode: string | null): string {
  return [map, mode].filter((text): text is string => text !== null && text !== "").join(" · ");
}

export class LoadingScreen {
  readonly #root: HTMLElement;
  readonly #step: HTMLElement;
  readonly #place: HTMLElement;
  #done = false;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#step = part(root, ".loading-step");
    this.#place = part(root, ".loading-place");
  }

  /** The step under way: its text, the bar to its start */
  step(step: LoadingStep): void {
    const { text, at } = LOADING_STEPS[step];
    this.#step.textContent = text;
    this.#root.style.setProperty("--loading-progress", String(at));
  }

  /** The map and mode, once known */
  place(map: string | null, mode: string | null): void {
    const text = placeText(map, mode);
    this.#place.textContent = text;
    this.#place.hidden = text === "";
  }

  /** The game's first frame drawn under it: the bar full, faded out, then gone */
  done(): void {
    if (this.#done) return;
    this.#done = true;
    this.#root.style.setProperty("--loading-progress", "1");
    this.#root.classList.add("loading-done");
    window.setTimeout(() => {
      this.#root.hidden = true;
    }, LOADING_FADE * 1000 + 50);
  }

  /** Gone at once (the viewers: no game frame to fade into) */
  hide(): void {
    this.#done = true;
    this.#root.hidden = true;
  }
}

/** The start failed: the reason where the step was, the ring stopped (the page kept as it is) */
export function showLoadingFailure(root: Element | null, message: string): void {
  if (!(root instanceof HTMLElement)) return;
  root.hidden = false;
  root.classList.remove("loading-done");
  root.classList.add("loading-failed");
  const step = root.querySelector(".loading-step");
  if (step) step.textContent = `Failed to start: ${message}`;
  else root.textContent = `Failed to start: ${message}`;
}

function part(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return el;
}
