// The menus with a controller (as the game's menus take a pad): the D-pad and the left stick move the focus from
// control to control (the nearest one that way on screen), held they repeat; A presses the focused control (a list
// steps to its next value), left and right change a list's or a slider's value, B goes back (Escape's), Start opens and
// closes the pause menu. The focused control is highlighted. A button still held when a menu closes isn't the game's
// (A is jump: Resume Game mustn't jump the car) until every button is up.
import type { GamepadSnapshot } from "../input/mapping";

/** The standard layout's buttons and axes */
const PAD_A = 0;
const PAD_B = 1;
const PAD_START = 9;
const PAD_UP = 12;
const PAD_DOWN = 13;
const PAD_LEFT = 14;
const PAD_RIGHT = 15;
const STICK_THRESHOLD = 0.5;
/** A held direction repeats after this long, then this often (s) */
const REPEAT_DELAY = 0.4;
const REPEAT_EVERY = 0.12;

export type NavDirection = "up" | "down" | "left" | "right";

export interface NavRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The pad's menu direction now: the D-pad's, else the left stick's past half way (null: none) */
export function padDirection(pad: GamepadSnapshot): NavDirection | null {
  const down = (i: number): boolean => (pad.buttons[i] ?? 0) > 0.5;
  if (down(PAD_UP)) return "up";
  if (down(PAD_DOWN)) return "down";
  if (down(PAD_LEFT)) return "left";
  if (down(PAD_RIGHT)) return "right";
  const x = pad.axes[0] ?? 0;
  const y = pad.axes[1] ?? 0;
  if (Math.max(Math.abs(x), Math.abs(y)) < STICK_THRESHOLD) return null;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

/** The candidate to move to from `from` going `direction`: the nearest whose centre lies that way (along the way plus
 *  twice the offset across it), or -1 */
export function nearestTowards(from: NavRect, direction: NavDirection, candidates: readonly NavRect[]): number {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((r, i) => {
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const along = direction === "up" ? -dy : direction === "down" ? dy : direction === "left" ? -dx : dx;
    const across = direction === "up" || direction === "down" ? Math.abs(dx) : Math.abs(dy);
    if (along <= 1) return;
    const score = along + 2 * across;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const FOCUSABLE = "button, select, input, [tabindex]:not([tabindex='-1'])";

function shown(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest("[hidden]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export interface PadNavActions {
  /** The open menu the pad drives (the topmost), or null */
  readonly menu: () => HTMLElement | null;
  /** B: back out of the open menu (Escape's) */
  readonly back: () => void;
  /** Start: the pause menu opens or closes (Escape's) */
  readonly start: () => void;
}

export class PadMenuNav {
  readonly #actions: PadNavActions;
  #previous: readonly boolean[] = [];
  #held: NavDirection | null = null;
  #heldSince = 0;
  #repeatedAt = 0;
  #focused: HTMLElement | null = null;
  /** A menu's button is still down after the menu closed: the game doesn't see the pad until all are up */
  #suppress = false;

  constructor(actions: PadNavActions) {
    this.#actions = actions;
  }

  /** Whether the game should ignore the pad now (a menu's press still held) */
  get suppressed(): boolean {
    return this.#suppress;
  }

  /** Each frame: the pad's state and the real time (s) */
  frame(pad: GamepadSnapshot | null, now: number): void {
    const buttons = pad?.buttons.map((v) => v > 0.5) ?? [];
    // (the last frame's, kept before it's replaced: the user's finding 15, every press was read against itself)
    const previous = this.#previous;
    const pressed = (i: number): boolean => (buttons[i] ?? false) && !(previous[i] ?? false);
    const anyDown = buttons.some(Boolean);
    this.#previous = buttons;
    const menu = this.#actions.menu();
    if (!menu) {
      this.#blur();
      if (this.#suppress && !anyDown) this.#suppress = false;
      if (pad && pressed(PAD_START)) {
        this.#actions.start();
        this.#suppress = true;
      }
      return;
    }
    this.#suppress = true; // (whatever is down while a menu is up stays the menu's until released)
    if (!pad) return;
    if (pressed(PAD_START)) {
      this.#actions.start();
      return;
    }
    if (pressed(PAD_B)) {
      this.#actions.back();
      return;
    }
    const controls = [...menu.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
    if (controls.length === 0) return;
    let current = this.#focused && controls.includes(this.#focused) ? this.#focused : null;
    if (!current && document.activeElement instanceof HTMLElement && controls.includes(document.activeElement)) current = document.activeElement;
    // (a menu, or its new page, has its first control focused at once, as the game's: Cross/A always selects what's
    // highlighted, never only focuses)
    if (!current) {
      current = controls[0] ?? null;
      this.#focus(current);
    }
    if (pressed(PAD_A)) {
      if (current) this.#press(current);
      return;
    }
    const direction = padDirection(pad);
    if (direction !== this.#held) {
      this.#held = direction;
      this.#heldSince = now;
      this.#repeatedAt = now;
      if (direction) this.#move(current, controls, direction);
      return;
    }
    if (direction && now - this.#heldSince >= REPEAT_DELAY && now - this.#repeatedAt >= REPEAT_EVERY) {
      this.#repeatedAt = now;
      this.#move(current, controls, direction);
    }
  }

  #move(current: HTMLElement | null, controls: readonly HTMLElement[], direction: NavDirection): void {
    if (!current) {
      this.#focus(controls[0] ?? null);
      return;
    }
    // Left and right change a list's or a slider's value
    if ((direction === "left" || direction === "right") && (current instanceof HTMLSelectElement || (current instanceof HTMLInputElement && current.type === "range"))) {
      this.#step(current, direction === "right" ? 1 : -1);
      return;
    }
    const others = controls.filter((c) => c !== current);
    const i = nearestTowards(current.getBoundingClientRect(), direction, others.map((c) => c.getBoundingClientRect()));
    if (i >= 0) this.#focus(others[i] ?? null);
  }

  /** A: a button or a checkbox is clicked, a list steps to its next value, a text field takes the keyboard */
  #press(el: HTMLElement): void {
    if (el instanceof HTMLSelectElement) {
      this.#step(el, 1, true);
      return;
    }
    if (el instanceof HTMLInputElement && (el.type === "text" || el.type === "range")) {
      el.focus();
      return;
    }
    el.click();
  }

  #step(el: HTMLSelectElement | HTMLInputElement, by: 1 | -1, wrap = false): void {
    if (el instanceof HTMLSelectElement) {
      const n = el.options.length;
      if (n === 0) return;
      const next = el.selectedIndex + by;
      el.selectedIndex = wrap ? (next + n) % n : Math.min(n - 1, Math.max(0, next));
    } else {
      if (by > 0) el.stepUp();
      else el.stepDown();
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  #focus(el: HTMLElement | null): void {
    if (el === this.#focused) return;
    this.#blur();
    if (!el) return;
    this.#focused = el;
    el.classList.add("pad-focus");
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: "nearest" });
  }

  #blur(): void {
    this.#focused?.classList.remove("pad-focus");
    this.#focused = null;
  }
}
