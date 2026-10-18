// The HUD's virtual stage (notes/hud-menus.md HUD-1, projectx.core.UIScreen): every movie is 1120 x 720; the content
// stage keeps 720 of height at wide aspects (S = height / 720 from 1.5556 up, else width / 1120), scaled by
// ContentScale = max(0.5, S x Interface Scale x Display Scale), the Display Scale's border left round it.

/** Interface Scale (UIScale, 0.5–1) and Display Scale (SafeZoneRatio, 0.9–1), MENU-6 */
let interfaceScale = 1;
let displayScale = 1;

export function setInterfaceScale(scale: number, display: number): void {
  interfaceScale = Math.min(1, Math.max(0.5, scale));
  displayScale = Math.min(1, Math.max(0.9, display));
}

export interface ContentStage {
  /** Virtual px to CSS px */
  readonly scale: number;
  /** The stage's virtual size */
  readonly width: number;
  readonly height: number;
  /** Where it starts on the page (CSS px: the Display Scale's border) */
  readonly left: number;
  readonly top: number;
}

/** The content stage for a `width` x `height` CSS px window */
export function contentStage(width: number, height: number, scale = interfaceScale, display = displayScale): ContentStage {
  const s = width / height >= 1.5556 ? height / 720 : width / 1120;
  const content = Math.max(0.5, s * scale * display);
  return {
    scale: content,
    width: (width * display) / content,
    height: (height * display) / content,
    left: (width * (1 - display)) / 2,
    top: (height * (1 - display)) / 2,
  };
}

/** The CSS transform that puts a stage-sized element (origin top left) where the stage is */
export function stageTransform(stage: ContentStage): string {
  return `translate(${String(stage.left)}px, ${String(stage.top)}px) scale(${String(stage.scale)})`;
}

/** Sizes and places a stage element for the window now; returns the stage. `last`: the key it was fitted for (refitted
 *  only when the stage changes) */
export function fitStage(el: HTMLElement, last: { key: string }): ContentStage {
  const stage = contentStage(window.innerWidth, window.innerHeight);
  const key = `${String(stage.width)}x${String(stage.height)}x${String(stage.scale)}x${String(stage.left)}`;
  if (key !== last.key) {
    last.key = key;
    el.style.width = `${String(stage.width)}px`;
    el.style.height = `${String(stage.height)}px`;
    el.style.transform = stageTransform(stage);
  }
  return stage;
}

/** A layer of its own on the virtual stage (HUD-1: a piece laid out in its units, scaled with the screen), refitted to
 *  the window when `fit` is called (each frame it's shown) */
export class StageLayer {
  readonly root: HTMLDivElement;
  readonly #fitted = { key: "" };

  constructor(parent: HTMLElement, id: string) {
    this.root = document.createElement("div");
    this.root.className = "hud-stage";
    this.root.id = id;
    parent.append(this.root);
  }

  fit(): ContentStage {
    return fitStage(this.root, this.#fitted);
  }
}
