// Nameplates (notes/hud-menus.md HUD-13, HT-8): a plate over each car but the player's own, 60 uu above it, its
// size the plane's under DistanceScaleCurve (0.5 at 0 uu to 9 at 10000) and FOVScaleCurve (0.1 at 0 degrees to 1 at 90)
// times Nameplate Scale; the name upper-cased on its team's colour ("YOU" for the player's own car, when it's seen
// from elsewhere). Distance Fade shows only the arrow beyond 7000 uu, Simplified only the arrow.
import type { NameplateMode } from "../settings/settings";

/** The plate's height in the world at scale 1 (uu): GFx_Meshes.NameplatePlane, 512 x 64 under Scale3D (1, 2, 1),
 *  its bottom edge's middle the pivot (HT-8) */
export const NAMEPLATE_UU = 64;
/** The plate's height as drawn before its scale (CSS px) */
const PLATE_PX = 30;
/** Where the plate sits over the car's origin (uu) */
export const NAMEPLATE_HEIGHT = 60;
const FADE_DISTANCE = 7000;

const curve = (x: number, x0: number, y0: number, x1: number, y1: number): number => y0 + ((y1 - y0) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0))));

/** The plate's scale: the distance curve times the FOV curve times the setting [I: the combination is native
 *  (TickNameplate), a product assumed: HT-8] */
export function nameplateScale(distance: number, horizontalFov: number, setting: number): number {
  return curve(distance, 0, 0.5, 10000, 9) * curve(horizontalFov, 0, 0.1, 90, 1) * setting;
}

/** Whether only the arrow shows */
export function arrowOnly(mode: NameplateMode, distance: number): boolean {
  return mode === "simplified" || (mode === "distanceFade" && distance > FADE_DISTANCE);
}

export interface Plate {
  readonly car: number;
  /** The name, or "YOU" */
  readonly name: string;
  readonly team: number;
  /** Where it goes on the page (CSS px) and how big a world unit is there (null: not on screen) */
  readonly at: { readonly x: number; readonly y: number; readonly pxPerUnit: number; readonly distance: number; readonly horizontalFov: number } | null;
}

/** A plate's CSS transform (origin top left): its bottom-centre on the point (x, y), scaled `k` about it (HT-8's pivot;
 *  the right-to-left order matters: the shift to the pivot first, then the scale, then the move, RV-280) */
export function plateTransform(x: number, y: number, k: number): string {
  return `translate(${String(x)}px, ${String(y)}px) scale(${String(k)}) translate(-50%, -100%)`;
}

export class Nameplates {
  readonly #root: HTMLDivElement;
  readonly #plates = new Map<number, { readonly el: HTMLDivElement; readonly name: HTMLElement }>();

  constructor(parent: HTMLElement) {
    this.#root = document.createElement("div");
    this.#root.className = "nameplates";
    parent.prepend(this.#root);
  }

  update(plates: readonly Plate[], mode: NameplateMode, setting: number, hidden: boolean): void {
    this.#root.hidden = hidden;
    const seen = new Set<number>();
    for (const p of plates) {
      seen.add(p.car);
      let plate = this.#plates.get(p.car);
      if (!plate) {
        const el = document.createElement("div");
        el.className = "nameplate";
        const label = document.createElement("div");
        label.className = "nameplate-name";
        const name = document.createElement("bdi");
        label.append(name);
        const arrow = document.createElement("div");
        arrow.className = "nameplate-arrow";
        el.append(label, arrow);
        this.#root.append(el);
        plate = { el, name };
        this.#plates.set(p.car, plate);
      }
      if (plate.name.textContent !== p.name) plate.name.textContent = p.name;
      plate.el.dataset["team"] = String(p.team === 1 ? 1 : 0);
      plate.el.hidden = p.at === null;
      if (!p.at) continue;
      const px = NAMEPLATE_UU * nameplateScale(p.at.distance, p.at.horizontalFov, setting) * p.at.pxPerUnit;
      plate.el.classList.toggle("arrow-only", arrowOnly(mode, p.at.distance));
      plate.el.style.transform = plateTransform(p.at.x, p.at.y, px / PLATE_PX);
    }
    for (const [car, plate] of this.#plates) {
      if (!seen.has(car)) {
        plate.el.remove();
        this.#plates.delete(car);
      }
    }
  }
}
