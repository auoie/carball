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

/** The screen's safe area's insets (px: a phone's notch and rounded corners; 0 elsewhere): a probe's padding of
 *  env(safe-area-inset-*), resolved by the browser (a custom property would keep env() unresolved); read once, again
 *  only after the window's size or turn changes (each read a style recalculation after the frame's HUD writes: RV-1229) */
export interface Insets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}
const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
let probe: HTMLElement | null = null;
let insets: Insets | null = null;
export function safeInsets(): Insets {
  if (typeof document === "undefined") return NO_INSETS;
  if (insets) return insets;
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
    document.body.append(probe);
    const forget = (): void => {
      insets = null;
    };
    window.addEventListener("resize", forget);
    window.addEventListener("orientationchange", forget);
    window.visualViewport?.addEventListener("resize", forget);
  }
  const s = getComputedStyle(probe);
  insets = {
    left: parseFloat(s.paddingLeft) || 0,
    right: parseFloat(s.paddingRight) || 0,
    top: parseFloat(s.paddingTop) || 0,
    bottom: parseFloat(s.paddingBottom) || 0,
  };
  return insets;
}

/** The stage within a `width` × `height` window's safe area (`inset`): laid out inside it, placed from its corner (a
 *  phone's HUD clear of its notch, RV-1212) */
export function insetStage(
  width: number,
  height: number,
  inset: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
): ContentStage {
  const stage = contentStage(width - inset.left - inset.right, height - inset.top - inset.bottom);
  return { ...stage, left: stage.left + inset.left, top: stage.top + inset.top };
}

/** The stage for the window now, within its safe area */
export function windowStage(): ContentStage {
  return insetStage(window.innerWidth, window.innerHeight, safeInsets());
}

/** Sizes and places a stage element for the window now; returns the stage. `last`: the key it was fitted for (refitted
 *  only when the stage changes) */
export function fitStage(el: HTMLElement, last: { key: string }): ContentStage {
  const stage = windowStage();
  const key = `${String(stage.width)}x${String(stage.height)}x${String(stage.scale)}x${String(stage.left)}x${String(stage.top)}`;
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
