// The touch controls' settings (Settings → Touch on a touch device; notes/mobile.md, the user's choices of 2026-11-10):
// the throttle's model, the stick's (floating or fixed, its size, sensitivity and deadzone), and the buttons' layout (each
// moved, sized, faded or hidden), kept in its own versioned record so an update never wipes it.
import type { Range } from "../settings/settings";

/** How the car is driven by touch: the stick's tilt (forward, reverse in its bottom quarter: the default, Sideswipe's);
 *  always forward, a Brake button to slow and reverse (Auto drive: Rocket Racing's); or the stick steering alone, Gas and
 *  Reverse buttons (Split: the shooters' vehicles') */
export type ThrottleModel = "stick" | "auto" | "split";

/** The frame rate a touch device draws at most (0: the screen's own): a phone's 120 Hz screen draws twice what 60 does,
 *  for heat and battery (the user's OnePlus, 2026-11-10); physics keeps its 120 ticks a second whatever it is */
export type FrameRateCap = 30 | 60 | 0;

export interface TouchNumbers {
  /** The stick's size (× its own: its travel too) */
  readonly stickSize: number;
  /** Its response: full tilt at 1 / this of its travel (above 1 quicker, below gentler) */
  readonly sensitivity: number;
  /** Its own deadzone (of its travel), before the controller's */
  readonly deadzone: number;
}

export interface TouchSettings extends TouchNumbers {
  readonly throttle: ThrottleModel;
  /** The stick at a fixed spot (the layout's), not where the thumb lands */
  readonly fixedStick: boolean;
  readonly frameRate: FrameRateCap;
}

export const TOUCH_DEFAULTS: TouchSettings = { throttle: "stick", fixedStick: false, stickSize: 1, sensitivity: 1, deadzone: 0, frameRate: 60 };

export const TOUCH_LIMITS: Readonly<Record<keyof TouchNumbers, Range>> = {
  stickSize: { min: 0.75, max: 1.5, step: 0.05 },
  sensitivity: { min: 0.5, max: 2, step: 0.05 },
  deadzone: { min: 0, max: 0.5, step: 0.01 },
};

export const TOUCH_SETTINGS_TEXT = {
  tab: "Touch",
  throttle: "Throttle",
  throttles: { stick: "Stick", auto: "Auto drive", split: "Split" },
  throttleHelp: {
    stick: "Tilt the stick to drive; pull it back to reverse. Centre it to double jump: a tilted stick flips.",
    auto: "The car always drives forward; hold Brake to slow down and reverse.",
    split: "The stick only steers; hold Gas to drive and Reverse to back up.",
  },
  stick: "Stick",
  sticks: { floating: "Floating", fixed: "Fixed" },
  stickSize: "Stick Size",
  sensitivity: "Stick Sensitivity",
  deadzone: "Stick Deadzone",
  editLayout: "Edit Button Layout",
  resetLayout: "Reset Button Layout",
  layoutHelp: "Slide is Air Roll in the air. To hold it with Boost, drag it to the left in Edit Button Layout and use a left finger.",
  frameRate: "Frame Rate",
  frameRates: { 60: "60 FPS", 30: "30 FPS", 0: "Uncapped" },
  frameRateHelp: "Lower runs cooler and saves battery; the game's physics is the same at any rate.",
} as const;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The touch settings as stored, each value in its range or its default */
export function readTouch(v: unknown): TouchSettings {
  const src = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const number = (key: keyof TouchNumbers): number => {
    const x = src[key];
    const { min, max } = TOUCH_LIMITS[key];
    return typeof x === "number" && Number.isFinite(x) ? clamp(x, min, max) : TOUCH_DEFAULTS[key];
  };
  const throttle = src["throttle"];
  const frameRate = src["frameRate"];
  return {
    throttle: throttle === "stick" || throttle === "auto" || throttle === "split" ? throttle : TOUCH_DEFAULTS.throttle,
    fixedStick: typeof src["fixedStick"] === "boolean" ? src["fixedStick"] : TOUCH_DEFAULTS.fixedStick,
    stickSize: number("stickSize"),
    sensitivity: number("sensitivity"),
    deadzone: number("deadzone"),
    frameRate: frameRate === 30 || frameRate === 60 || frameRate === 0 ? frameRate : TOUCH_DEFAULTS.frameRate,
  };
}

/** Whether a frame is due under the cap (`hz`; 0: every one), its time `now` (ms) and the last drawn's; and that one's
 *  time as kept: on the cap's cadence (a frame up to a quarter of the interval early counts, so a 120 Hz screen's every
 *  other frame is 60), or now once it's fallen a whole interval behind */
export function frameDue(now: number, lastDrawn: number, hz: number): { readonly due: boolean; readonly drawn: number } {
  if (hz <= 0) return { due: true, drawn: now };
  const interval = 1000 / hz;
  const next = lastDrawn + interval;
  if (now < next - interval / 4) return { due: false, drawn: lastDrawn };
  return { due: true, drawn: now - next >= interval ? now : next };
}

/** The stick's tilt shaped by its own deadzone (radial: zero inside, rescaled past it) and sensitivity (full tilt sooner
 *  or later), its direction kept; within the unit disc */
export function shapeStick(v: { readonly x: number; readonly y: number }, s: Pick<TouchSettings, "deadzone" | "sensitivity">): { x: number; y: number } {
  const m = Math.hypot(v.x, v.y);
  if (m === 0 || m <= s.deadzone) return { x: 0, y: 0 };
  const shaped = Math.min(1, ((m - s.deadzone) / (1 - s.deadzone)) * s.sensitivity);
  return { x: (v.x / m) * shaped, y: (v.y / m) * shaped };
}

/** A button's place in the layout: its centre (fractions of the screen; absent, its default spot), its size (× its own),
 *  opacity, and whether it's hidden */
export interface ButtonPlace {
  readonly x?: number;
  readonly y?: number;
  readonly scale: number;
  readonly opacity: number;
  readonly hidden: boolean;
}

/** The layout: each button's place by its id (ones this page doesn't know kept as they were), the fixed stick's centre */
export interface TouchLayout {
  readonly buttons: Readonly<Record<string, ButtonPlace>>;
  readonly stick?: { readonly x: number; readonly y: number };
}

export const DEFAULT_PLACE: ButtonPlace = { scale: 1, opacity: 1, hidden: false };
export const EMPTY_LAYOUT: TouchLayout = { buttons: {} };
export const PLACE_LIMITS = { scale: { min: 0.6, max: 1.6 }, opacity: { min: 0.2, max: 1 } } as const;

/** The fixed stick's centre at most this far across the screen: in the left half, its stick's zone (RV-1233) */
export const STICK_X_MAX = 0.45;

const LAYOUT_KEY = "carball.touchLayout";
const LAYOUT_VERSION = 1;

const fraction = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, 1) : undefined);

/** A place's own fields; others (a later page's) kept as they were, so this page's save never strips them (RV-1236) */
const PLACE_FIELDS: ReadonlySet<string> = new Set(["x", "y", "scale", "opacity", "hidden"]);

function readPlace(v: unknown): ButtonPlace {
  const src = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const others = Object.fromEntries(Object.entries(src).filter(([k]) => !PLACE_FIELDS.has(k)));
  const x = fraction(src["x"]);
  const y = fraction(src["y"]);
  const scale = typeof src["scale"] === "number" && Number.isFinite(src["scale"]) ? clamp(src["scale"], PLACE_LIMITS.scale.min, PLACE_LIMITS.scale.max) : 1;
  const opacity =
    typeof src["opacity"] === "number" && Number.isFinite(src["opacity"]) ? clamp(src["opacity"], PLACE_LIMITS.opacity.min, PLACE_LIMITS.opacity.max) : 1;
  return { ...others, ...(x !== undefined && y !== undefined ? { x, y } : {}), scale, opacity, hidden: src["hidden"] === true };
}

/** A stored layout read (any version: its buttons by id, each value checked; a later version's buttons and their fields
 *  kept, its other fields dropped), else the empty one (every button at its default) */
export function readLayout(v: unknown): TouchLayout {
  if (typeof v !== "object" || v === null) return EMPTY_LAYOUT;
  const src = v as Record<string, unknown>;
  const buttons: Record<string, ButtonPlace> = {};
  const stored = src["buttons"];
  if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
    for (const [id, place] of Object.entries(stored as Record<string, unknown>)) if (/^[a-zA-Z]{1,32}$/.test(id)) buttons[id] = readPlace(place);
  }
  const stick = typeof src["stick"] === "object" && src["stick"] !== null ? (src["stick"] as Record<string, unknown>) : null;
  // (the fixed stick in the left half, where a thumb takes it: RV-1233)
  const sx = fraction(stick?.["x"]);
  const sy = fraction(stick?.["y"]);
  const stickX = sx === undefined ? undefined : Math.min(STICK_X_MAX, sx);
  return { buttons, ...(stickX !== undefined && sy !== undefined ? { stick: { x: stickX, y: sy } } : {}) };
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function local(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadLayout(storage: Store | null = local()): TouchLayout {
  try {
    const raw = storage?.getItem(LAYOUT_KEY);
    return raw ? readLayout(JSON.parse(raw)) : EMPTY_LAYOUT;
  } catch {
    return EMPTY_LAYOUT;
  }
}

/** Kept with its format's version (an empty layout: the record removed, every button at its default) */
export function saveLayout(layout: TouchLayout, storage: Store | null = local()): void {
  try {
    if (Object.keys(layout.buttons).length === 0 && !layout.stick) storage?.removeItem(LAYOUT_KEY);
    else storage?.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, ...layout }));
  } catch {
    // (storage full or blocked: the layout kept for this page alone)
  }
}
