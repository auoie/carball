// Nameplates (notes/hud-menus.md HUD-13, HT-8, HT-12): a plate over each car but the player's own, 60 uu above it, its
// size the plane's under DistanceScaleCurve (0.5 at 0 uu to 9 at 10000) and FOVScaleCurve (0.1 at 0 degrees to 1 at 90)
// times Nameplate Scale; the name upper-cased on its team's colour ("YOU" for the player's own car, when it's seen
// from elsewhere). Distance Fade shows only the arrow beyond 7000 uu, Simplified only the arrow. Drawn in the world as
// the game's plane is (PlaneMat_Masked: alpha-tested at 0.667, hard edges, unlit, no fog, depth-tested and writing
// depth): the ball, the cars and the arena in front of a plate cover it (HT-12, the user's finding 17).
import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial, Vector2 } from "three";
import type { Vec3 } from "../math/vec";
import { toThreeVector } from "../render/coords";
import type { NameplateMode } from "../settings/settings";

/** The plate's height in the world at scale 1 (uu): GFx_Meshes.NameplatePlane, 512 x 64 under Scale3D (1, 2, 1),
 *  its bottom edge's middle the pivot (HT-8) */
export const NAMEPLATE_UU = 64;
/** The plate as drawn (its texture, px at 1x): the name's box 22 high, 100 to 264 wide with 16 either side of the name
 *  ($SmallBoldFont 16), the arrow under it 14 x 8: 30 high in all */
const PLATE_PX = 30;
const NAME_PX = 22;
const NAME_MIN = 100;
const NAME_MAX = 264;
const NAME_PAD = 16;
const ARROW_W = 14;
const ARROW_H = 8;
/** The texture's resolution over the 1x drawing */
const TEXTURE_SCALE = 4;
/** PlaneMat_Masked's clip */
const MASK_CLIP = 0.667;
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
  /** Its pivot in the world: the bottom edge's middle, NAMEPLATE_HEIGHT over the car */
  readonly top: Vec3;
  /** Where it goes on the page (CSS px) and how big a world unit is there (null: not on screen) */
  readonly at: { readonly x: number; readonly y: number; readonly pxPerUnit: number; readonly distance: number; readonly horizontalFov: number } | null;
}

/** The plate's text for the player's own car, verbatim (the user's decision of 2026-10-14: HT-2) */
export const NAMEPLATE_YOU = "YOU";

/** The plates for cars at these positions: each NAMEPLATE_HEIGHT above its car, where `project` puts it; the player's
 *  own car's says YOU (one local player: LocalPlayerCount <= 1 && bLocalPlayer, NP:38824-38832, RV-288) */
export function platesAt(
  cars: ReadonlyMap<number, { readonly pos: Vec3; readonly team: number }>,
  localCar: number,
  nameOf: (car: number) => string,
  project: (top: Vec3) => Plate["at"],
): Plate[] {
  return [...cars].map(([car, { pos, team }]) => {
    const top = { x: pos.x, y: pos.y, z: pos.z + NAMEPLATE_HEIGHT };
    return { car, name: car === localCar ? NAMEPLATE_YOU : nameOf(car), team, top, at: project(top) };
  });
}

/** The plate's size in the world (uu) for a texture `aspect` wide over high at scale `k`: NAMEPLATE_UU high at 1 */
export function plateSize(aspect: number, k: number): { readonly width: number; readonly height: number } {
  return { width: aspect * NAMEPLATE_UU * k, height: NAMEPLATE_UU * k };
}

/** The teams' plate and text colours (the HUD's tints, Team0/1 FontColor) */
const PLATE_COLOR = ["rgb(0, 45, 191)", "rgb(178, 61, 0)"];
const TEXT_COLOR = ["#f0ffff", "#fffff0"];

/** Draws a plate's texture: the name on its box (unless only the arrow shows), the arrow under it */
function drawPlate(canvas: HTMLCanvasElement, name: string, team: number, onlyArrow: boolean): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const font = getComputedStyle(document.documentElement).getPropertyValue("--hud-small").trim() || "sans-serif";
  ctx.font = `bold ${String(16 * TEXTURE_SCALE)}px ${font}`;
  let text = name.toUpperCase();
  const room = (NAME_MAX - 2 * NAME_PAD) * TEXTURE_SCALE;
  if (ctx.measureText(text).width > room) {
    while (text.length > 0 && ctx.measureText(`${text}…`).width > room) text = text.slice(0, -1);
    text = `${text}…`;
  }
  const width = Math.min(NAME_MAX, Math.max(NAME_MIN, Math.ceil(ctx.measureText(text).width / TEXTURE_SCALE) + 2 * NAME_PAD));
  canvas.width = width * TEXTURE_SCALE;
  canvas.height = PLATE_PX * TEXTURE_SCALE;
  ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE);
  ctx.fillStyle = PLATE_COLOR[team] ?? PLATE_COLOR[0] ?? "";
  if (!onlyArrow) {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, NAME_PX, 4);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(width / 2 - ARROW_W / 2, NAME_PX);
  ctx.lineTo(width / 2 + ARROW_W / 2, NAME_PX);
  ctx.lineTo(width / 2, NAME_PX + ARROW_H);
  ctx.closePath();
  ctx.fill();
  if (onlyArrow) return;
  ctx.font = `bold 16px ${font}`;
  ctx.fillStyle = TEXT_COLOR[team] ?? TEXT_COLOR[0] ?? "";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, NAME_PX / 2 + 1);
}

interface PlateSprite {
  readonly sprite: Sprite;
  texture: CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  key: string;
}

/** A texture of the plate's canvas as drawn now (a new one each time it's drawn: once uploaded, a texture's storage
 *  can't change size, and a name that came after its car is wider than the empty plate: RV-290) */
function plateTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class Nameplates {
  /** The plates in the world (the game adds it to its scene) */
  readonly root = new Group();
  readonly #plates = new Map<number, PlateSprite>();
  #shown: { readonly name: string; readonly team: number; readonly onScreen: boolean; readonly arrowOnly: boolean }[] = [];

  /** The plates now, on screen or not (the tests') */
  get shown(): readonly { readonly name: string; readonly team: number; readonly onScreen: boolean; readonly arrowOnly: boolean }[] {
    return this.#shown;
  }

  update(plates: readonly Plate[], mode: NameplateMode, setting: number, hidden: boolean): void {
    this.root.visible = !hidden;
    const seen = new Set<number>();
    this.#shown = [];
    for (const p of plates) {
      seen.add(p.car);
      let plate = this.#plates.get(p.car);
      if (!plate) {
        const canvas = document.createElement("canvas");
        const texture = plateTexture(canvas);
        const material = new SpriteMaterial({ map: texture, alphaTest: MASK_CLIP, transparent: false, depthTest: true, depthWrite: true, fog: false });
        material.userData = { heightFog: "none" };
        const sprite = new Sprite(material);
        sprite.center = new Vector2(0.5, 0); // (the pivot: the bottom edge's middle)
        this.root.add(sprite);
        plate = { sprite, texture, canvas, key: "" };
        this.#plates.set(p.car, plate);
      }
      plate.sprite.visible = p.at !== null;
      const team = p.team === 1 ? 1 : 0;
      if (!p.at) {
        this.#shown.push({ name: p.name, team, onScreen: false, arrowOnly: false });
        continue;
      }
      const only = arrowOnly(mode, p.at.distance);
      const key = `${p.name}|${String(team)}|${String(only)}`;
      if (key !== plate.key) {
        plate.key = key;
        drawPlate(plate.canvas, p.name, team, only);
        const old = plate.texture;
        plate.texture = plateTexture(plate.canvas);
        plate.sprite.material.map = plate.texture;
        old.dispose();
      }
      const size = plateSize(plate.canvas.width / plate.canvas.height, nameplateScale(p.at.distance, p.at.horizontalFov, setting));
      toThreeVector(p.top, plate.sprite.position);
      plate.sprite.scale.set(size.width, size.height, 1);
      this.#shown.push({ name: p.name, team, onScreen: true, arrowOnly: only });
    }
    for (const [car, plate] of this.#plates) {
      if (!seen.has(car)) {
        this.root.remove(plate.sprite);
        plate.texture.dispose();
        plate.sprite.material.dispose();
        this.#plates.delete(car);
      }
    }
  }
}
