// The menus with a controller, as the game's (Scaleform CLIK) take one (the user's request, 2026-10-16: native to
// controllers; notes/hud-menus.md MENU-12..18, the static session's MN1). A menu's page is a list of rows in order: each
// value (a slider, a toggle, a list) a row of its own, buttons on one line a row together (a binding's two slots, a row of
// maps, a radio group). Up and down step through the rows, never wrapping; left and right change the focused row's value
// (a slider steps, held in bigger steps: ×1, then 2, 3, 6, 11 as the steps go on; a toggle flips; a list cycles in place,
// never its native popup), never leave it, or move along a row of buttons (a radio group's choice taken as it goes, in a
// group marked `data-pad-choose`: the playlists, the garage's cars and colours; the maps, whose press loads one, only
// moved along). A (Cross) and B (Circle) act on release: A presses, B backs out a level (nothing, silently, at the main
// menu's top); Start opens and closes the pause menu; the bumpers step through a tabbed page's tabs (`data-pad-tabs`),
// stopping at the ends, held repeating, the other ignored while one's held; X presses the page's Default
// (`data-pad-x`), Y clears the focused keybinding (`data-pad-y`'s pages). The D-pad steps on a press, then repeats after
// 0.2 s every 0.1 s; the stick counts at 0.8 or past it, then repeats (0.3 s, then every 0.1 s). The focused
// row is highlighted and scrolled into view (the stick's axis that reaches 0.8 first owns its direction till it falls
// back under it: MN1's confirmed values); a page keeps its focus while its menu is open (rebuilt after a change, by its
// place in the list); a page that focuses its own control (a confirm's NO) is followed; a menu opened afresh starts at
// its `data-pad-default` control or its first row. The pad's mode (the last device used, switching at most every 0.2 s)
// shows the highlight and the button hints (bottom left: B Back on a deeper page, X Default, Y Clear Keybinding) and
// keeps the mouse's hover off; the mouse's shows neither.
// A button pressed for a menu isn't the game's until it's released (A is jump: Resume Game mustn't jump the car); one
// held from before (boost through a pause: RV-289) is, and the keyboard always. While the settings wait for a pad input to
// bind, the pad is theirs: no button navigates (B, Start and the D-pad would back out, close or move away instead of
// binding), until every button is up and the stick back again.
import type { GamepadSnapshot } from "../input/mapping";
import { stepControl } from "./controls";
import { type KeyGlyph, glyphElement, keyGlyph } from "./keyGlyph";

/** The standard layout's buttons */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

/** The menus' input (MENU-12..18, the static session's MN1, its native values confirmed): the stick's axis at `stick`
 *  or past it (no deadzone, no hysteresis); the D-pad (and the bumpers) repeat after `padDelay` s every `padEvery`, the
 *  stick after `stickDelay` every `stickEvery`; a slider's step times k from the nth step of a hold (`sliderSteps`: [from
 *  n, k]); the device's mode switching on a button at once, on an axis past `modeAxis`, at most every `modeCooldown` s
 *  (InputTypeChangeCooldown: a switch asked for meanwhile made at its end) */
export const MENU_INPUT = {
  stick: 0.8,
  padDelay: 0.2,
  padEvery: 0.1,
  stickDelay: 0.3,
  stickEvery: 0.1,
  modeAxis: 0.5,
  sliderSteps: [
    [1, 1],
    [8, 2],
    [14, 3],
    [20, 6],
    [26, 11],
  ] as readonly (readonly [number, number])[],
  modeCooldown: 0.2,
} as const;

export type NavDirection = "up" | "down" | "left" | "right";

export interface NavRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type Axis = 0 | 1;

/** The left stick's direction: the axis that reached 0.8 first (`owner`, the last frame's) keeps it while it's at 0.8
 *  or past it, its side as it is (to the other side at once: let go this frame, `held` the last direction); else the
 *  axis at 0.8 now (both: the further); the new owner */
export function stickDirection(
  x: number,
  y: number,
  owner: Axis | null,
  held: NavDirection | null = null,
): { readonly direction: NavDirection | null; readonly owner: Axis | null } {
  const axes = [x, y] as const;
  const way = (axis: Axis, v: number): NavDirection => (axis === 0 ? (v > 0 ? "right" : "left") : v > 0 ? "down" : "up");
  if (owner !== null && Math.abs(axes[owner]) >= MENU_INPUT.stick) {
    const direction = way(owner, axes[owner]);
    // (flicked to the other side: a release first, then a press on the next frame)
    return held !== null && direction !== held ? { direction: null, owner: null } : { direction, owner };
  }
  const reached = ([0, 1] as const).filter((a) => Math.abs(axes[a]) >= MENU_INPUT.stick);
  const first = reached.length > 1 ? (Math.abs(x) >= Math.abs(y) ? 0 : 1) : reached[0];
  return first === undefined ? { direction: null, owner: null } : { direction: way(first, axes[first]), owner: first };
}

/** The pad's menu direction now and whether it's the stick's: the D-pad's, else the left stick's (stickDirection) */
export function padInput(
  pad: GamepadSnapshot,
  owner: Axis | null = null,
  held: NavDirection | null = null,
): { readonly direction: NavDirection; readonly stick: boolean; readonly owner: Axis | null } | null {
  const down = (i: number): boolean => (pad.buttons[i] ?? 0) > 0.5;
  if (down(PAD.up)) return { direction: "up", stick: false, owner: null };
  if (down(PAD.down)) return { direction: "down", stick: false, owner: null };
  if (down(PAD.left)) return { direction: "left", stick: false, owner: null };
  if (down(PAD.right)) return { direction: "right", stick: false, owner: null };
  const s = stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0, owner, held);
  return s.direction === null ? null : { direction: s.direction, stick: true, owner: s.owner };
}

export function padDirection(pad: GamepadSnapshot): NavDirection | null {
  return padInput(pad)?.direction ?? null;
}

/** A slider's step multiple at the nth step of a hold (1 the press's) */
export function sliderStep(n: number): number {
  let k = 1;
  for (const [from, times] of MENU_INPUT.sliderSteps) if (n >= from) k = times;
  return k;
}

/** A page's rows: its controls (in order) grouped, each value a row of its own, buttons a row together while on one
 *  line (overlapping up and down by over half the smaller's height); the rows' control indices */
export function menuRows(items: readonly { readonly rect: NavRect; readonly value: boolean }[]): number[][] {
  const rows: number[][] = [];
  items.forEach((item, i) => {
    const last = rows.at(-1);
    const prev = last ? items[last[last.length - 1] ?? -1] : undefined;
    const sameLine = (a: NavRect, b: NavRect): boolean =>
      Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > Math.min(a.height, b.height) / 2;
    if (last && prev && !item.value && !prev.value && sameLine(prev.rect, item.rect)) last.push(i);
    else rows.push([i]);
  });
  return rows;
}

const FOCUSABLE = "button, select, input, [tabindex]:not([tabindex='-1'])";

function shown(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest("[hidden], [data-pad-skip]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** A control that holds a value (a row of its own; left and right change it): our slider, list cycler or checkbox
 *  (src/ui/controls.ts), a text field. A box in a row of boxes (`data-pad-boxes`: the Play page's playlists) isn't: left
 *  and right move along its row, A ticks it (RV-883) */
function isValue(el: Element): boolean {
  const role = el.getAttribute("role");
  if (role === "checkbox" && el.closest("[data-pad-boxes]") !== null) return false;
  return role === "slider" || role === "spinbutton" || role === "checkbox" || (el instanceof HTMLInputElement && el.type === "text");
}

const isRadio = (el: Element): boolean => el.getAttribute("role") === "radio";

/** The element a row's highlight bar is drawn on: its label or table row, else its controls' own */
function rowElement(controls: readonly HTMLElement[]): HTMLElement | null {
  const [first] = controls;
  if (!first) return null;
  const holder = first.closest<HTMLElement>("label, tr, [data-pad-row]");
  return holder && controls.every((c) => holder.contains(c)) ? holder : null;
}

/** A page's identity in its menu (its focus kept under it): the menu's id and its shown `data-pad-page` */
function pageKey(menu: HTMLElement): string {
  const page = [...menu.querySelectorAll<HTMLElement>("[data-pad-page]")].find((p) => !p.closest("[hidden]"));
  return `${menu.id}|${page?.dataset["padPage"] ?? ""}`;
}

/** A click's cue in the open menu (MENU-18): a question's answer (a shown question: not the hidden one a page keeps for
 *  later, RV-501) confirms, else it selects */
export function clickCue(menu: HTMLElement | null): "confirm" | "select" {
  const answers = [...(menu?.querySelectorAll<HTMLElement>("[data-pad-default]") ?? [])];
  return answers.some((c) => c.hasAttribute("data-pad-default") && shown(c)) ? "confirm" : "select";
}

export interface PadNavActions {
  /** The open menu the pad drives (the topmost), or null */
  readonly menu: () => HTMLElement | null;
  /** B: back out of the open menu (Escape's); whether it did (nothing, silently, at the main menu's top) */
  readonly back: () => boolean;
  /** Start: the pause menu opens or closes (Escape's) */
  readonly start: () => void;
  /** A pad input is being captured for a binding (the settings' rebind): the pad isn't the menus' meanwhile */
  readonly capturing?: () => boolean;
  /** Y released with no control of the page's own Y focused: the search's cancel where it applies (MM-10: the banner's,
   *  over the main or pause menu); whether it did */
  readonly cancelSearch?: () => boolean;
  /** The menus' sounds: the focus moved or a value stepped, a press, a question's answer (or a notice's OK), a back, a
   *  tab */
  readonly sound?: (cue: "move" | "select" | "confirm" | "back" | "tab") => void;
}

/** What a hint names (its button, its words): B Back, X Default, Y Clear Keybinding (MENU-17) */
const HINTS = [
  [PAD.b, "Back"],
  [PAD.x, "Default"],
  [PAD.y, "Clear Keybinding"],
] as const;

export class PadMenuNav {
  readonly #actions: PadNavActions;
  #previous: readonly boolean[] = [];
  #held: NavDirection | null = null;
  #heldStick = false;
  /** The stick's axis that owns its direction (stickDirection) */
  #stickAxis: Axis | null = null;
  #nextRepeat = 0;
  #steps = 0;
  /** The bumper held (the other ignored meanwhile) and when it repeats */
  #bumper: number | null = null;
  #bumperNext = 0;
  /** A, B, X and Y pressed in this menu, acted on as they're released (Settings' X and Y too, MENU-13) */
  #armed = new Set<number>();
  /** The control drawn pressed (A held on it) */
  #pressedEl: HTMLElement | null = null;
  #focused: HTMLElement | null = null;
  #row: HTMLElement | null = null;
  /** Each page's focus while its menu is open: its row and its place in the row */
  readonly #memory = new Map<string, { row: number; column: number }>();
  #page = "";
  /** The buttons pressed for a menu (the Start that opened it too), the game's again once each is released */
  readonly #masked = new Set<number>();
  /** A binding's capture was waiting: no navigation until every button is up and the stick back (the press or the stick
   *  move that bound it, read by the capture maybe earlier in the same frame, isn't a menu's too) */
  #captureHold = false;
  #hints: HTMLElement | null = null;
  #hintsKey = "";
  /** Where the hints were put (left and top, CSS px) */
  #hintsAt = "";
  /** The pad's mode (the last device used was the pad), when it last switched (s), the switch asked for during its
   *  cooldown (made at its end) */
  #padMode = false;
  #modeAt = -Infinity;
  #modeWanted: boolean | null = null;
  /** The open menu's control under the pointer (its cue on a change) */
  #hovered: HTMLElement | null = null;

  constructor(actions: PadNavActions) {
    this.#actions = actions;
    if (typeof window !== "undefined" && "addEventListener" in window) {
      for (const type of ["keydown", "pointerdown", "pointermove"]) {
        window.addEventListener(
          type,
          () => {
            this.#setMode(false, performance.now() / 1000);
          },
          { capture: true, passive: true },
        );
      }
      // The mouse's and the keyboard's cues too (MENU-18, RV-481): a control of the open menu clicked (not the pad's own
      // presses: those cue themselves; a slider's drag silent), the pointer onto another of its controls
      window.addEventListener(
        "click",
        (e: Event) => {
          const control = e.isTrusted ? this.#menuControl(e.target) : null;
          if (!control || control.getAttribute("role") === "slider") return;
          this.#actions.sound?.(clickCue(this.#actions.menu()));
        },
        { capture: true, passive: true },
      );
      window.addEventListener(
        "pointerover",
        (e: Event) => {
          const control = this.#padMode ? null : this.#menuControl(e.target);
          if (control === this.#hovered) return;
          this.#hovered = control;
          if (control) this.#actions.sound?.("move");
        },
        { passive: true },
      );
    }
  }

  /** Whether the pad's mode is on (its highlight and hints shown, the mouse's hover off) */
  get padMode(): boolean {
    return this.#padMode;
  }

  /** The pad as the game should see it: the menu's buttons still held, up */
  mask(pad: GamepadSnapshot | null): GamepadSnapshot | null {
    if (!pad || this.#masked.size === 0) return pad;
    return { ...pad, buttons: pad.buttons.map((v, i) => (this.#masked.has(i) ? 0 : v)) };
  }

  /** Each frame: the pad's state and the real time (s) */
  frame(pad: GamepadSnapshot | null, now: number): void {
    const buttons = pad?.buttons.map((v) => v > 0.5) ?? [];
    // (the last frame's, kept before it's replaced: the user's finding 15, every press was read against itself)
    const previous = this.#previous;
    const pressed = (i: number): boolean => (buttons[i] ?? false) && !(previous[i] ?? false);
    const released = (i: number): boolean => !(buttons[i] ?? false) && (previous[i] ?? false);
    this.#previous = buttons;
    for (const i of [...this.#masked]) if (!(buttons[i] ?? false)) this.#masked.delete(i);
    if (this.#actions.capturing?.()) this.#captureHold = true;
    else if (this.#captureHold && !buttons.some(Boolean) && (pad === null || padDirection(pad) === null)) this.#captureHold = false;
    if (this.#captureHold) {
      // (the capture's presses kept from the game too, as a menu's)
      buttons.forEach((down, i) => {
        if (down && pressed(i)) this.#masked.add(i);
      });
      this.#held = null;
      this.#armed.clear();
      return;
    }
    // (the stick's own direction, the D-pad's first: the stick's owning axis kept across frames)
    const input = pad ? padInput(pad, this.#stickAxis, this.#heldStick ? this.#held : null) : null;
    this.#stickAxis = input?.stick === true ? input.owner : pad && !input ? stickDirection(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.#stickAxis).owner : null;
    // (the pad's mode: a button pressed, or an axis past 0.5; a switch asked for in the cooldown made at its end)
    if (buttons.some((down, i) => down && pressed(i)) || (pad?.axes.some((v) => Math.abs(v) > MENU_INPUT.modeAxis) ?? false)) this.#setMode(true, now);
    else if (this.#modeWanted !== null) this.#setMode(this.#modeWanted, now);
    const menu = this.#actions.menu();
    this.#showHints(menu);
    if (!menu) {
      this.#blur();
      // (a menu opened afresh starts at its first row)
      this.#memory.clear();
      this.#page = "";
      this.#armed.clear();
      if (pad && pressed(PAD.start)) {
        this.#actions.start();
        this.#masked.add(PAD.start);
      }
      return;
    }
    // (every press while a menu is up is the menu's until released)
    buttons.forEach((down, i) => {
      if (down && pressed(i)) this.#masked.add(i);
    });
    if (!pad) return;
    if (pressed(PAD.start)) {
      this.#armed.clear();
      this.#actions.start();
      return;
    }
    for (const b of [PAD.a, PAD.b, PAD.x, PAD.y]) if (pressed(b)) this.#armed.add(b);
    if (released(PAD.b) && this.#armed.delete(PAD.b)) {
      if (this.#actions.back()) this.#actions.sound?.("back");
      return;
    }
    this.#bumpers(menu, buttons, now);
    const controls = [...menu.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);
    if (controls.length === 0) return;
    const rows = menuRows(controls.map((c) => ({ rect: c.getBoundingClientRect(), value: isValue(c) }))).map((r) =>
      r.map((i) => controls[i]).filter((c): c is HTMLElement => c !== undefined),
    );
    const current = this.#current(menu, controls, rows);
    if (!current) return;
    // (A held: its control looks pressed till A's let go, not a frame more, RV-478)
    const releasedA = released(PAD.a) && this.#armed.delete(PAD.a);
    const held = this.#armed.has(PAD.a) ? current : null;
    if (held !== this.#pressedEl) {
      this.#pressedEl?.classList.remove("pad-pressed");
      held?.classList.add("pad-pressed");
      this.#pressedEl = held;
    }
    if (releasedA) {
      // (a question's answer, or a notice's OK, its own cue: a page with a default control, MENU-18)
      this.#press(
        current,
        controls.some((c) => c.hasAttribute("data-pad-default")),
      );
      return;
    }
    if (released(PAD.x) && this.#armed.delete(PAD.x)) {
      // (the page's Default: its menu asks first, MENU-14)
      const page = [...menu.querySelectorAll<HTMLElement>("[data-pad-page]")].find((p) => !p.closest("[hidden]"));
      if (page?.hasAttribute("data-pad-x")) page.dispatchEvent(new CustomEvent("pad-default", { bubbles: true }));
      return;
    }
    if (released(PAD.y) && this.#armed.delete(PAD.y)) {
      // (the focused control's own Y first, a binding cleared: the settings are a modal screen over the banner's cancel,
      // MM-10; else the search's cancel, the menu's cue)
      if (current.closest("[data-pad-y]")) current.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      else this.#actions.cancelSearch?.();
      return;
    }
    const direction = input?.direction ?? null;
    if (direction !== this.#held || (input?.stick ?? false) !== this.#heldStick) {
      this.#held = direction;
      this.#heldStick = input?.stick ?? false;
      this.#steps = 1;
      this.#nextRepeat = now + (this.#heldStick ? MENU_INPUT.stickDelay : MENU_INPUT.padDelay);
      if (direction) this.#move(current, rows, direction, 1);
      return;
    }
    if (direction && now >= this.#nextRepeat) {
      this.#nextRepeat = now + (this.#heldStick ? MENU_INPUT.stickEvery : MENU_INPUT.padEvery);
      this.#steps++;
      this.#move(current, rows, direction, sliderStep(this.#steps));
    }
  }

  /** The bumpers: a tabbed page's previous or next tab, stopping at the ends; held, repeating; the other ignored while
   *  one's held */
  #bumpers(menu: HTMLElement, buttons: readonly boolean[], now: number): void {
    if (this.#bumper !== null && !(buttons[this.#bumper] ?? false)) this.#bumper = null;
    if (this.#bumper === null) {
      const b = (buttons[PAD.lb] ?? false) ? PAD.lb : (buttons[PAD.rb] ?? false) ? PAD.rb : null;
      if (b === null) return;
      this.#bumper = b;
      this.#bumperNext = now + MENU_INPUT.padDelay;
      this.#switchTab(menu, b === PAD.rb ? 1 : -1);
      return;
    }
    if (now >= this.#bumperNext) {
      this.#bumperNext = now + MENU_INPUT.padEvery;
      this.#switchTab(menu, this.#bumper === PAD.rb ? 1 : -1);
    }
  }

  /** The focused control: the one focused, still there (or the one the page focused itself since: a confirm's NO);
   *  else the page's kept place (its rows rebuilt, or the page come back to), its own focused control (the map select's
   *  last pick), its `data-pad-default`, or its first row's */
  #current(menu: HTMLElement, controls: readonly HTMLElement[], rows: readonly (readonly HTMLElement[])[]): HTMLElement | null {
    const page = pageKey(menu);
    const samePage = page === this.#page;
    this.#page = page;
    const active = document.activeElement instanceof HTMLElement && controls.includes(document.activeElement) ? document.activeElement : null;
    // (the keyboard's or the mouse's mode: the focus where they put it, never moved to the pad's kept place by an idle
    // pad, RV-502)
    if (!this.#padMode && active) {
      if (active !== this.#focused) {
        this.#focused?.classList.remove("pad-focus");
        this.#focused = active;
        active.classList.add("pad-focus");
      }
      this.#highlight(active, rows);
      return active;
    }
    if (samePage && this.#focused && controls.includes(this.#focused)) {
      if (active && active !== this.#focused && this.#padMode) {
        this.#focus(active, rows, false);
        return active;
      }
      this.#highlight(this.#focused, rows);
      return this.#focused;
    }
    // (a page marked data-pad-forget, the settings' tabs, starts at its first row whenever it's come to again: its place
    // kept only while it's rebuilt in place, RV-476)
    const shownPage = [...menu.querySelectorAll<HTMLElement>("[data-pad-page]")].find((p) => !p.closest("[hidden]"));
    const kept = !samePage && shownPage?.hasAttribute("data-pad-forget") === true ? undefined : this.#memory.get(page);
    const at = kept ? rows[Math.min(kept.row, rows.length - 1)] : undefined;
    // (a question opens on its default, NO, whatever had the focus there last, asked again or in place of the menu's
    // buttons: RV-472, RV-473)
    let next = controls.find((c) => c.hasAttribute("data-pad-default")) ?? null;
    next ??= at ? (at[Math.min(kept?.column ?? 0, at.length - 1)] ?? null) : null;
    next ??= active;
    next ??= this.#entry(rows[0] ?? []);
    this.#focus(next, rows, false);
    return next;
  }

  /** The open menu's control `target` is on, if any */
  #menuControl(target: EventTarget | null): HTMLElement | null {
    const menu = this.#actions.menu();
    const control = typeof Element !== "undefined" && target instanceof Element ? target.closest<HTMLElement>(FOCUSABLE) : null;
    return menu && control && menu.contains(control) && !control.hasAttribute("disabled") ? control : null;
  }

  /** Where focus lands entering a row: its checked radio, else its control at `column` */
  #entry(row: readonly HTMLElement[], column = 0): HTMLElement | null {
    return row.find((c) => isRadio(c) && c.getAttribute("aria-checked") === "true") ?? row[Math.min(column, row.length - 1)] ?? null;
  }

  #move(current: HTMLElement, rows: readonly (readonly HTMLElement[])[], direction: NavDirection, step: number): void {
    const r = rows.findIndex((row) => row.includes(current));
    const row = rows[r] ?? [];
    const column = row.indexOf(current);
    if (direction === "up" || direction === "down") {
      const next = rows[r + (direction === "down" ? 1 : -1)];
      if (next) this.#focus(this.#entry(next, column), rows);
      return;
    }
    const by = direction === "right" ? 1 : -1;
    // A text field's caret moves while it can, as the game's (TE2 §2.7, RV-611)
    if (current instanceof HTMLInputElement && current.type === "text" && document.activeElement === current) {
      const at = (current.selectionDirection === "backward" ? current.selectionStart : current.selectionEnd) ?? current.value.length;
      const next = at + by;
      if (next >= 0 && next <= current.value.length) {
        current.setSelectionRange(next, next);
        return;
      }
    }
    // A value changes in place (never leaving its row): a slider by the held steps (the move cue), a list by one (the
    // select cue); a checkbox only by A (RV-481)
    const role = current.getAttribute("role");
    if (role === "slider" || role === "spinbutton") {
      if (stepControl(current, role === "slider" ? by * step : by)) this.#actions.sound?.(role === "slider" ? "move" : "select");
      return;
    }
    if (role === "checkbox" && isValue(current)) return;
    // Along a row of buttons: a choosing group's choice taken as it goes, else the next one; stopping at either end, as
    // the game's (RV-477)
    if (row.length > 1) {
      const choose = isRadio(current) && current.closest("[data-pad-choose]") !== null;
      const i = Math.min(row.length - 1, Math.max(0, column + by));
      const next = row[i];
      if (!next || next === current) return;
      this.#focus(next, rows);
      if (choose) next.click();
    }
  }

  /** A: a button, checkbox or radio is clicked, a list steps to its next value (in place), a text field takes the
   *  keyboard; a slider nothing */
  #press(el: HTMLElement, question = false): void {
    const role = el.getAttribute("role");
    if (role === "slider") return;
    this.#actions.sound?.(question ? "confirm" : "select");
    if (role === "spinbutton") {
      stepControl(el, 1);
      return;
    }
    if (el instanceof HTMLInputElement && el.type === "text") {
      el.focus();
      return;
    }
    el.click();
  }

  /** A tabbed page's previous or next tab (its `data-pad-tabs` list; the active one marked so), stopping at the ends */
  #switchTab(menu: HTMLElement, by: 1 | -1): void {
    // (the shown page's list: a hidden page's never, Custom Training's tabs beside the leaderboard's)
    const list = [...menu.querySelectorAll<HTMLElement>("[data-pad-tabs]")].find((l) => !l.closest("[hidden]") && !l.hidden);
    if (!list) return;
    const tabs = [...list.querySelectorAll<HTMLElement>("button")].filter((t) => !t.closest("[hidden]"));
    const active = tabs.findIndex((t) => t.classList.contains("active") || t.getAttribute("aria-selected") === "true");
    const next = tabs[active + by];
    if (active < 0 || !next) return;
    next.click();
    this.#actions.sound?.("tab");
  }

  #focus(el: HTMLElement | null, rows: readonly (readonly HTMLElement[])[], sound = true): void {
    if (el !== this.#focused) {
      this.#focused?.classList.remove("pad-focus");
      this.#focused = el;
      if (el) {
        el.classList.add("pad-focus");
        el.focus({ preventScroll: true });
        if (sound) this.#actions.sound?.("move");
      }
    }
    this.#highlight(el, rows);
  }

  /** The focused row's highlight bar, scrolled into view, and the page's kept place */
  #highlight(el: HTMLElement | null, rows: readonly (readonly HTMLElement[])[]): void {
    const r = el ? rows.findIndex((row) => row.includes(el)) : -1;
    const row = rows[r];
    const holder = row ? (rowElement(row) ?? el) : null;
    if (holder !== this.#row) {
      this.#row?.classList.remove("pad-row");
      this.#row = holder;
      holder?.classList.add("pad-row");
      if (this.#padMode) holder?.scrollIntoView({ block: "nearest" });
    }
    if (el && row) this.#memory.set(this.#page, { row: r, column: row.indexOf(el) });
  }

  #blur(): void {
    this.#pressedEl?.classList.remove("pad-pressed");
    this.#pressedEl = null;
    this.#focused?.classList.remove("pad-focus");
    this.#focused = null;
    this.#row?.classList.remove("pad-row");
    this.#row = null;
  }

  /** The pad's mode on or off (the last device used): at once, else after the last switch's 0.2 s cooldown (asked for
   *  meanwhile, made at its end; dropped if the player's back on the device the mode's for); the page's class (its
   *  highlight shown, the mouse's hover off) */
  #setMode(pad: boolean, now: number): void {
    if (pad === this.#padMode) {
      this.#modeWanted = null;
      return;
    }
    if (now - this.#modeAt < MENU_INPUT.modeCooldown) {
      this.#modeWanted = pad;
      return;
    }
    this.#modeWanted = null;
    this.#padMode = pad;
    this.#modeAt = now;
    if (typeof document !== "undefined" && "body" in document) document.body.classList.toggle("pad-mode", pad);
    if (pad && this.#row) this.#row.scrollIntoView({ block: "nearest" });
  }

  /** The hints under the open panel and centred on it: the one marked `data-pad-hints-under` it's in (the settings, its
   *  question too), else its page (the main menu's column), else the menu; kept on the screen */
  #placeHints(menu: HTMLElement, page: HTMLElement | null): void {
    const hints = this.#hints;
    if (!hints) return;
    const panel = (menu.closest<HTMLElement>("[data-pad-hints-under]") ?? page ?? menu).getBoundingClientRect();
    const gap = 12;
    // (its height as drawn, at the menus' scale: RV-833)
    const top = Math.max(gap, Math.min(panel.bottom + gap, window.innerHeight - hints.getBoundingClientRect().height - gap));
    const at = `${(panel.left + panel.width / 2).toFixed(0)}px ${top.toFixed(0)}px`;
    if (at === this.#hintsAt) return;
    this.#hintsAt = at;
    [hints.style.left, hints.style.top] = at.split(" ") as [string, string];
  }

  /** The button hints (MENU-16): B Back on a page deeper than its menu's top (`data-pad-back`), X Default where the
   *  page has one (`data-pad-x`), Y Clear Keybinding on a bindings page (`data-pad-y`), in the game's order, in the pad's
   *  glyphs; none on the main menu's top, the pause menu or a modal. In the mouse's mode clickable words, no glyph, and
   *  Clear Keybinding gone (no focused binding: an entry without an action vanishes, RV-480) */
  #showHints(menu: HTMLElement | null): void {
    if (typeof document === "undefined" || !("createElement" in document)) return;
    const page = menu ? ([...menu.querySelectorAll<HTMLElement>("[data-pad-page]")].find((p) => !p.closest("[hidden]")) ?? menu) : null;
    const has = (attr: string): boolean =>
      menu !== null && (menu.hasAttribute(attr) || page?.hasAttribute(attr) === true || page?.querySelector(`[${attr}]`) !== null);
    const pad = this.#padMode;
    const shownHints = menu ? HINTS.filter(([b]) => (b === PAD.b ? has("data-pad-back") : b === PAD.x ? has("data-pad-x") : pad && has("data-pad-y"))) : [];
    // (under the open panel, centred on it, where the eye is: the user's finding, 2026-10-16)
    if (shownHints.length > 0 && menu) this.#placeHints(menu, page);
    const key = `${pad ? "pad" : "mouse"} ${shownHints.map(([b]) => String(b)).join(",")}`;
    if (key === this.#hintsKey) return;
    this.#hintsKey = key;
    if (!this.#hints) {
      this.#hints = document.createElement("div");
      this.#hints.id = "menu-hints";
      this.#hints.setAttribute("aria-hidden", "true");
      document.body.append(this.#hints);
    }
    this.#hints.hidden = shownHints.length === 0;
    this.#hints.classList.toggle("menu-hints-mouse", !pad);
    this.#hints.replaceChildren(
      ...shownHints.map(([button, label]): HTMLElement => {
        if (!pad) {
          // (the mouse's: the words, clicked for the button's action; out of the Tab order, the page's own Close and
          // reset buttons the keyboard's)
          const item = document.createElement("button");
          item.className = "menu-hint menu-hint-click";
          item.tabIndex = -1;
          item.textContent = label;
          item.addEventListener("click", () => {
            const open = this.#actions.menu();
            if (button === PAD.b) {
              if (this.#actions.back()) this.#actions.sound?.("back");
            } else if (open) {
              const shownPage = [...open.querySelectorAll<HTMLElement>("[data-pad-page]")].find((p) => !p.closest("[hidden]"));
              if (shownPage?.hasAttribute("data-pad-x")) shownPage.dispatchEvent(new CustomEvent("pad-default", { bubbles: true }));
            }
          });
          return item;
        }
        const item = document.createElement("span");
        item.className = "menu-hint";
        const glyph: KeyGlyph = keyGlyph({ kind: "padButton", button });
        item.append(glyphElement(glyph), document.createTextNode(label));
        return item;
      }),
    );
  }
}
