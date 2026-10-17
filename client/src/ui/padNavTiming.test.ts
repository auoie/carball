// The menus with a pad against MENU-12..16 on a fake clock, in a stand-in DOM (RV-486: the timing and button rules
// pinned; the reviewer's RX20 probe the pattern): the repeats, the stick's threshold and ownership, A and B on release,
// the bumpers, X and Y, the slider's and the list's steps, the focus's memory, the device's mode
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PadMenuNav, clickCue, sliderStep } from "./padNav";

const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
const pad = (down: readonly number[] = [], axes: readonly number[] = [0, 0, 0, 0]): { buttons: number[]; axes: number[] } => ({
  buttons: Array.from({ length: 17 }, (_, i) => (down.includes(i) ? 1 : 0)),
  axes: [...axes],
});

class FakeElement {
  readonly fake = "element";
}
class FakeInput {
  readonly fake = "input";
}
class FakeMouseEvent {
  constructor(readonly type: string) {}
}

/** The stand-in document's focused element */
const focus: { active: unknown } = { active: null };
const bodyClasses = new Set<string>();
const windowListeners = new Map<string, (() => void)[]>();

beforeEach(() => {
  focus.active = null;
  bodyClasses.clear();
  windowListeners.clear();
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("MouseEvent", FakeMouseEvent);
  vi.stubGlobal("document", {
    get activeElement() {
      return focus.active;
    },
    body: { classList: { toggle: (c: string, on: boolean) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)) } },
  });
  vi.stubGlobal("window", {
    addEventListener: (type: string, f: () => void) => {
      windowListeners.set(type, [...(windowListeners.get(type) ?? []), f]);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A control: its box, role and attributes; its clicks, steps, events and classes recorded */
class Control extends FakeElement {
  readonly classes = new Set<string>();
  readonly classList = {
    add: (c: string): void => void this.classes.add(c),
    remove: (c: string): void => void this.classes.delete(c),
    contains: (c: string): boolean => this.classes.has(c),
  };
  readonly disabled = false;
  clicks = 0;
  steps: number[] = [];
  events: string[] = [];
  /** Whether a step moves its value (false: at an end) */
  stepMoves = true;
  constructor(
    readonly name: string,
    readonly box: Box,
    readonly attributes: Record<string, string> = {},
    readonly within: readonly string[] = [],
  ) {
    super();
  }
  getBoundingClientRect(): Box {
    return this.box;
  }
  getAttribute(n: string): string | null {
    return this.attributes[n] ?? null;
  }
  hasAttribute(n: string): boolean {
    return n in this.attributes;
  }
  closest(selector: string): object | null {
    return this.within.some((w) => selector.includes(w)) ? {} : null;
  }
  focus(): void {
    focus.active = this;
  }
  scrollIntoView(): void {
    this.events.push("scroll");
  }
  click(): void {
    this.clicks++;
    if (this.attributes["role"] === "checkbox") this.attributes["aria-checked"] = this.attributes["aria-checked"] === "true" ? "false" : "true";
  }
  dispatchEvent(e: { type: string; detail?: number }): boolean {
    this.events.push(e.type);
    if (e.type === "control-step") {
      this.steps.push(e.detail ?? 0);
      return !this.stepMoves; // (cancelled: it moved)
    }
    return true;
  }
}

class Page {
  events: string[] = [];
  constructor(
    readonly key: string,
    readonly attributes: Record<string, string> = {},
  ) {}
  get dataset(): Record<string, string> {
    return { padPage: this.key };
  }
  closest(): null {
    return null;
  }
  hasAttribute(n: string): boolean {
    return n in this.attributes;
  }
  querySelector(): null {
    return null;
  }
  dispatchEvent(e: { type: string }): boolean {
    this.events.push(e.type);
    return true;
  }
}

class Tab {
  readonly classes = new Set<string>();
  readonly classList = { contains: (c: string): boolean => this.classes.has(c) };
  constructor(readonly onClick: () => void) {}
  closest(): null {
    return null;
  }
  getAttribute(): null {
    return null;
  }
  click(): void {
    this.onClick();
  }
}

/** A menu: its id, the shown page's controls, its pages, its tabs */
class Menu {
  controls: Control[] = [];
  pages: Page[] = [];
  tabs: Tab[] | null = null;
  constructor(readonly id: string) {}
  querySelectorAll(q: string): unknown[] {
    return q === "[data-pad-page]" ? this.pages : this.controls;
  }
  querySelector(q: string): unknown {
    const tabs = this.tabs;
    return q === "[data-pad-tabs]" && tabs ? { querySelectorAll: () => tabs } : null;
  }
  hasAttribute(): boolean {
    return false;
  }
}

const box = (left: number, top: number, width = 120, height = 28): Box => ({ left, top, width, height });
/** A column of `n` buttons */
const column = (prefix: string, n: number): Control[] => Array.from({ length: n }, (_, i) => new Control(`${prefix}${String(i)}`, box(0, 40 * i)));

function harness(menu: () => Menu | null, back: () => boolean = () => true): { nav: PadMenuNav; sounds: string[]; backs: number[] } {
  const sounds: string[] = [];
  const backs: number[] = [];
  const nav = new PadMenuNav({
    menu: () => menu() as unknown as HTMLElement | null,
    back: () => {
      backs.push(1);
      return back();
    },
    start: () => undefined,
    sound: (cue) => {
      sounds.push(cue);
    },
  });
  return { nav, sounds, backs };
}

const focusedName = (menu: Menu): string | undefined => menu.controls.find((c) => c.classes.has("pad-focus"))?.name;

/** Frames at `hz` from `t0` for `seconds`, the pad `state(t)`; the times (from t0) the focus moved */
function run(nav: PadMenuNav, menu: Menu, state: (t: number) => ReturnType<typeof pad>, t0: number, seconds: number, hz = 60): number[] {
  const moves: number[] = [];
  let last = focusedName(menu);
  for (let k = 0; k / hz < seconds; k++) {
    const t = t0 + k / hz;
    nav.frame(state(t), t);
    const now = focusedName(menu);
    if (now !== last) moves.push(Number((k / hz).toFixed(4)));
    last = now;
  }
  return moves;
}

/** A tap: pressed one frame, released the next */
function tapper(nav: PadMenuNav): (button: number) => void {
  let t = 100;
  return (button) => {
    nav.frame(pad([button]), (t += 0.05));
    nav.frame(pad(), (t += 0.05));
  };
}

/** A hold's frames from `t0` at `hz` (from its press): the press, the first frame at or after `delay` on, then each at
 *  or after the last + `every`, in the frames' own times (no tolerance: the game's own arithmetic, a repeat a frame late
 *  where the float sum falls a hair short, RV-493); each gap checked within a frame of the rule's */
function repeats(t0: number, hz: number, seconds: number, delay: number, every: number): number[] {
  const out: number[] = [];
  let next = -Infinity;
  for (let k = 0; k / hz < seconds; k++) {
    const t = t0 + k / hz;
    if (t >= next) {
      out.push(Number((k / hz).toFixed(4)));
      next = t + (out.length === 1 ? delay : every);
    }
  }
  out.slice(1).forEach((at, i) => {
    const gap = at - (out[i] ?? 0);
    const rule = i === 0 ? delay : every;
    expect(gap).toBeGreaterThanOrEqual(rule - 1e-3);
    expect(gap).toBeLessThanOrEqual(rule + 1 / hz + 1e-3);
  });
  return out;
}

describe("the menus' repeats (MENU-12)", () => {
  it("the D-pad: at its press, then 0.2 s on, then every 0.1 s, at any frame rate", () => {
    for (const hz of [60, 144, 37]) {
      const menu = new Menu("m");
      menu.controls = column("b", 40);
      const { nav } = harness(() => menu);
      nav.frame(pad(), 0);
      expect(run(nav, menu, () => pad([BTN.down]), 1, 1, hz), `${String(hz)} Hz`).toEqual(repeats(1, hz, 1, 0.2, 0.1));
    }
  });

  it("the stick: at 0.8, not under it (no deadzone, no hysteresis), then 0.3 s on, then every 0.1 s", () => {
    const menu = new Menu("m");
    menu.controls = column("b", 40);
    const { nav } = harness(() => menu);
    nav.frame(pad(), 0);
    expect(run(nav, menu, () => pad([], [0, 0.79]), 1, 0.5)).toEqual([]);
    expect(run(nav, menu, () => pad([], [0, 0.8]), 2, 1)).toEqual(repeats(2, 60, 1, 0.3, 0.1));
    // (under 0.8 for a frame, then at it again: a new press)
    nav.frame(pad([], [0, 0.799]), 3);
    const before = focusedName(menu);
    nav.frame(pad([], [0, 0.8]), 3 + 1 / 60);
    expect(focusedName(menu)).not.toBe(before);
  });

  it("the stick's direction the first axis to reach 0.8's till it falls back; a flick a release, then the press", () => {
    // (rows of three: left and right along a row, up and down between them)
    const menu = new Menu("m");
    menu.controls = Array.from({ length: 30 }, (_, i) => new Control(`g${String(Math.floor(i / 3))}.${String(i % 3)}`, box(130 * (i % 3), 40 * Math.floor(i / 3))));
    const { nav } = harness(() => menu);
    nav.frame(pad(), 0);
    nav.frame(pad([], [0.85, 0]), 0.1);
    expect(focusedName(menu)).toBe("g0.1");
    nav.frame(pad([], [0.85, 0.95]), 0.12);
    nav.frame(pad([], [0.85, 0.95]), 0.2);
    expect(focusedName(menu), "y doesn't take it while x holds").toBe("g0.1");
    nav.frame(pad([], [0.5, 0.95]), 0.25);
    expect(focusedName(menu), "y presses as x lets go").toBe("g1.1");
    nav.frame(pad([], [0, -0.95]), 0.26);
    expect(focusedName(menu), "the flick's frame: a release").toBe("g1.1");
    nav.frame(pad([], [0, -0.95]), 0.27);
    expect(focusedName(menu), "the next: up").toBe("g0.1");
  });

  it("the right stick does nothing", () => {
    const menu = new Menu("m");
    menu.controls = column("b", 10);
    const { nav } = harness(() => menu);
    nav.frame(pad(), 0);
    run(nav, menu, () => pad([], [0, 0, 0, 1]), 1, 0.5);
    run(nav, menu, () => pad([], [0, 0, 1, 0]), 2, 0.5);
    expect(focusedName(menu)).toBe("b0");
  });
});

describe("the menus' buttons (MENU-13)", () => {
  it("A and B act on release, never while held, B once for a long hold, silent at the top; pressed looks while A's held", () => {
    const menu = new Menu("m");
    menu.controls = column("b", 3);
    let top = false;
    const { nav, sounds, backs } = harness(() => menu, () => !top);
    nav.frame(pad(), 0);
    for (let k = 1; k <= 30; k++) nav.frame(pad([BTN.a]), k / 60);
    expect(menu.controls[0]?.clicks).toBe(0);
    expect(menu.controls[0]?.classes.has("pad-pressed"), "pressed while A's held (RV-478)").toBe(true);
    nav.frame(pad(), 31 / 60);
    expect(menu.controls[0]?.clicks).toBe(1);
    expect(menu.controls[0]?.classes.has("pad-pressed")).toBe(false);
    expect(sounds.at(-1)).toBe("select");
    for (let k = 1; k <= 60; k++) nav.frame(pad([BTN.b]), 1 + k / 60);
    expect(backs).toHaveLength(0);
    nav.frame(pad(), 2.1);
    expect(backs).toHaveLength(1);
    expect(sounds.at(-1)).toBe("back");
    top = true;
    const before = sounds.length;
    nav.frame(pad([BTN.b]), 3);
    nav.frame(pad(), 3.1);
    expect(sounds.slice(before), "B at the top: silent").toEqual([]);
  });

  it("the bumpers: a tab at the press, held 0.2 s on then every 0.1 s, stopping at the ends, a cue per change, the other ignored while one's held", () => {
    const menu = new Menu("settings");
    let active = 0;
    const tabs = Array.from({ length: 9 }, (_, i) => new Tab(() => (active = i)));
    const sync = (): void => {
      tabs.forEach((t, i) => (i === active ? t.classes.add("active") : t.classes.delete("active")));
    };
    sync();
    menu.tabs = tabs;
    menu.controls = column("b", 3);
    const { nav, sounds } = harness(() => menu);
    nav.frame(pad(), 0);
    const changes: number[] = [];
    let last = active;
    for (let k = 0; k < 60; k++) {
      nav.frame(pad([BTN.rb]), 1 + k / 60);
      sync();
      if (active !== last) changes.push(Number((k / 60).toFixed(4)));
      last = active;
    }
    expect(changes).toEqual(repeats(1, 60, 1, 0.2, 0.1).slice(0, 8));
    expect(active, "stops at the last tab").toBe(8);
    expect(sounds.filter((s) => s === "tab")).toHaveLength(8);
    nav.frame(pad(), 2.05);
    nav.frame(pad([BTN.rb]), 2.1);
    sync();
    nav.frame(pad([BTN.rb, BTN.lb]), 2.12);
    sync();
    expect(active, "LB while RB's held: ignored").toBe(8);
    nav.frame(pad(), 2.2);
    nav.frame(pad([BTN.lb]), 2.3);
    sync();
    expect(active).toBe(7);
  });

  it("X asks for the page's Default (data-pad-x) on its release; Y clears only a bindings page's (data-pad-y) control", () => {
    const menu = new Menu("settings");
    const page = new Page("controls", { "data-pad-x": "" });
    menu.pages = [page];
    menu.controls = [new Control("slot", box(0, 0), {}, ["[data-pad-y]"]), new Control("other", box(0, 40))];
    const { nav } = harness(() => menu);
    const tap = tapper(nav);
    nav.frame(pad(), 0);
    tap(BTN.x);
    expect(page.events).toEqual(["pad-default"]);
    tap(BTN.y);
    expect(menu.controls[0]?.events).toContain("contextmenu");
    tap(BTN.down);
    tap(BTN.y);
    expect(menu.controls[1]?.events).not.toContain("contextmenu");
    menu.pages = [new Page("audio")];
    tap(BTN.x);
    expect(page.events, "no Default on a page without one").toEqual(["pad-default"]);
  });
});

describe("the pad's Y over the search (MM-10, RV-529)", () => {
  it("on its release, not its press: a focused binding's clear first (the settings over the banner), else the search's cancel", () => {
    const menu = new Menu("settings");
    menu.pages = [new Page("controls")];
    menu.controls = [new Control("slot", box(0, 0), {}, ["[data-pad-y]"]), new Control("other", box(0, 40))];
    const cancels: number[] = [];
    const nav = new PadMenuNav({
      menu: () => menu as unknown as HTMLElement,
      back: () => true,
      start: () => undefined,
      sound: () => undefined,
      cancelSearch: () => {
        cancels.push(1);
        return true;
      },
    });
    nav.frame(pad(), 0);
    // (pressed and held on the binding: nothing yet; released: its clear, the search kept)
    nav.frame(pad([BTN.y]), 0.05);
    nav.frame(pad([BTN.y]), 0.6);
    expect(menu.controls[0]?.events).not.toContain("contextmenu");
    nav.frame(pad(), 0.65);
    expect(menu.controls[0]?.events).toContain("contextmenu");
    expect(cancels).toEqual([]);
    // (on another control: held, nothing; released, the search's cancel)
    nav.frame(pad([BTN.down]), 0.7);
    nav.frame(pad(), 0.75);
    nav.frame(pad([BTN.y]), 0.8);
    nav.frame(pad([BTN.y]), 1.4);
    expect(cancels).toEqual([]);
    nav.frame(pad(), 1.45);
    expect(cancels).toEqual([1]);
    expect(menu.controls[1]?.events).not.toContain("contextmenu");
  });
});

describe("the menus' focus (MENU-15)", () => {
  it("no wrap: not up and down, not along a row, not in a radio group (RV-477); silent at the ends", () => {
    const menu = new Menu("main-menu");
    const radios = ["1v1", "2v2", "3v3"].map((name, i) => new Control(name, box(130 * i, 40), { role: "radio", "aria-checked": i === 0 ? "true" : "false" }, ["[data-pad-choose]"]));
    menu.controls = [new Control("free", box(0, 0)), ...radios, new Control("find", box(0, 80))];
    const { nav, sounds } = harness(() => menu);
    const tap = tapper(nav);
    nav.frame(pad(), 0);
    tap(BTN.up);
    expect([focusedName(menu), sounds]).toEqual(["free", []]);
    tap(BTN.down);
    tap(BTN.left);
    expect(focusedName(menu)).toBe("1v1");
    tap(BTN.down);
    const before = sounds.length;
    tap(BTN.down);
    expect([focusedName(menu), sounds.length - before]).toEqual(["find", 0]);
  });

  it("a menu returned to keeps its place; a forgetting page (data-pad-forget: the settings' tabs) and a menu opened again start at the first row; a question opens on NO", () => {
    const main = new Menu("main-menu");
    main.pages = [new Page("top")];
    main.controls = column("m", 4);
    const settings = new Menu("settings");
    const pageA = new Page("controls", { "data-pad-forget": "" });
    const pageB = new Page("camera", { "data-pad-forget": "" });
    const rowsA = column("a", 6);
    const rowsB = column("c", 6);
    [settings.pages, settings.controls] = [[pageA], rowsA];
    const confirm = new Menu("settings-confirm");
    confirm.controls = [new Control("yes", box(0, 0, 60)), new Control("no", box(70, 0, 60), { "data-pad-default": "" })];
    let open: Menu | null = main;
    const { nav, sounds } = harness(() => open);
    const tap = tapper(nav);
    let t = 200;
    const show = (menu: Menu | null): void => {
      open = menu;
      nav.frame(pad(), (t += 0.05));
    };
    show(main);
    tap(BTN.down);
    tap(BTN.down);
    show(settings);
    expect(focusedName(settings)).toBe("a0");
    tap(BTN.down);
    tap(BTN.down);
    [settings.pages, settings.controls] = [[pageB], rowsB];
    show(settings);
    expect(focusedName(settings), "a tab switched to: its first row").toBe("c0");
    tap(BTN.down);
    [settings.pages, settings.controls] = [[pageA], rowsA];
    show(settings);
    expect(focusedName(settings), "a tab switched back to: its first row (RV-476)").toBe("a0");
    show(confirm);
    expect(focusedName(confirm)).toBe("no");
    tap(BTN.left);
    tap(BTN.a);
    expect(sounds.at(-1), "a question's answer: its own cue (MENU-18)").toBe("confirm");
    show(settings);
    show(confirm);
    expect(focusedName(confirm), "asked again after a YES: NO (RV-473)").toBe("no");
    show(main);
    expect(focusedName(main), "the menu returned to: its place").toBe("m2");
    show(null);
    show(settings);
    expect(focusedName(settings), "opened afresh: the first row").toBe("a0");
  });

  it("a page rebuilt (new elements, the same layout) keeps its row", () => {
    const menu = new Menu("settings");
    menu.pages = [new Page("audio")];
    menu.controls = column("x", 6);
    const { nav } = harness(() => menu);
    const tap = tapper(nav);
    nav.frame(pad(), 0);
    for (let i = 0; i < 3; i++) tap(BTN.down);
    menu.controls = column("y", 6);
    nav.frame(pad(), 300);
    expect(focusedName(menu)).toBe("y3");
  });
});

describe("the menus' controls (MENU-14)", () => {
  it("a held slider: its steps x1 for events 1-7, x2 8-13, x3 14-19, x6 20-25, x11 on, the count anew after a release; silent at an end", () => {
    const menu = new Menu("settings");
    const slider = new Control("s", box(0, 0, 300, 24), { role: "slider" });
    menu.controls = [slider];
    const { nav, sounds } = harness(() => menu);
    nav.frame(pad(), 0);
    run(nav, menu, () => pad([BTN.right]), 1, 3.5);
    expect(slider.steps.length).toBe(repeats(1, 60, 3.5, 0.2, 0.1).length);
    expect(slider.steps).toEqual(slider.steps.map((_, i) => sliderStep(i + 1)));
    expect(sounds.filter((s) => s === "move")).toHaveLength(slider.steps.length);
    nav.frame(pad(), 5);
    slider.steps = [];
    nav.frame(pad([BTN.right]), 5.1);
    expect(slider.steps).toEqual([1]);
    slider.stepMoves = false;
    const before = sounds.length;
    nav.frame(pad(), 5.2);
    nav.frame(pad([BTN.right]), 5.3);
    expect(sounds.slice(before)).toEqual([]);
  });

  it("a list: left and right a step each with the select cue (RV-481), held at the repeats; a checkbox: A toggles it, left and right don't", () => {
    const menu = new Menu("settings");
    const list = new Control("list", box(0, 0, 300), { role: "spinbutton" });
    const check = new Control("check", box(0, 40, 300), { role: "checkbox", "aria-checked": "false" });
    menu.controls = [list, check];
    const { nav, sounds } = harness(() => menu);
    const tap = tapper(nav);
    nav.frame(pad(), 0);
    tap(BTN.right);
    tap(BTN.left);
    expect(list.steps).toEqual([1, -1]);
    expect(sounds).toEqual(["select", "select"]);
    list.steps = [];
    run(nav, menu, () => pad([BTN.right]), 10, 1);
    expect(list.steps).toEqual(repeats(10, 60, 1, 0.2, 0.1).map(() => 1));
    nav.frame(pad(), 12);
    tap(BTN.down);
    tap(BTN.right);
    tap(BTN.left);
    expect(check.attributes["aria-checked"]).toBe("false");
    tap(BTN.a);
    expect(check.attributes["aria-checked"]).toBe("true");
  });
});

describe("the device's mode (MENU-16)", () => {
  it("a pad button at once, an axis only past 0.5, the mouse or keys back; at most one switch per 0.2 s, the last asked for made at its end, dropped if returned", () => {
    const menu = new Menu("m");
    menu.controls = column("b", 3);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
    const { nav } = harness(() => menu);
    const fire = (type: string): void => {
      for (const f of windowListeners.get(type) ?? []) f();
    };
    const log: string[] = [];
    const at = (label: string): void => {
      log.push(`${label}:${nav.padMode ? "pad" : "kbm"}`);
    };
    now = 10;
    nav.frame(pad([], [0.5, 0]), now);
    at("axis 0.5");
    now = 10.1;
    nav.frame(pad([], [0.51, 0]), now);
    at("axis 0.51");
    now = 10.15;
    fire("pointermove");
    at("move 10.15");
    now = 10.29;
    nav.frame(pad(), now);
    at("10.29");
    now = 10.31;
    nav.frame(pad(), now);
    at("10.31");
    now = 10.4;
    nav.frame(pad([BTN.a]), now);
    at("A 10.4");
    now = 10.45;
    fire("keydown");
    nav.frame(pad(), now);
    at("key 10.45");
    now = 10.6;
    nav.frame(pad(), now);
    at("10.6");
    expect(log).toEqual(["axis 0.5:kbm", "axis 0.51:pad", "move 10.15:pad", "10.29:pad", "10.31:kbm", "A 10.4:kbm", "key 10.45:kbm", "10.6:kbm"]);
    expect(bodyClasses.has("pad-mode")).toBe(false);
  });
});

describe("the keyboard's focus with a pad idle (RV-502)", () => {
  it("in the keyboard's mode the focus stays where the keys put it, a page rebuilt in place too (Reset), not the pad's kept row", () => {
    const menu = new Menu("m");
    menu.controls = column("b", 4);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now * 1000);
    const { nav } = harness(() => menu);
    // (the pad used here first: its place kept at the first row)
    now = 1;
    nav.frame(pad([BTN.down]), now);
    nav.frame(pad(), (now = 1.05));
    expect(nav.padMode).toBe(true);
    // The keyboard: its mode; it focuses the third control
    for (const f of windowListeners.get("keydown") ?? []) f();
    now = 2;
    nav.frame(pad(), now);
    expect(nav.padMode).toBe(false);
    focus.active = menu.controls[2];
    nav.frame(pad(), (now = 2.1));
    expect(focusedName(menu)).toBe("b2");
    // The page rebuilt in place (Reset): new controls, the keys' focus on the new fourth (Reset itself)
    menu.controls = column("b", 4);
    focus.active = menu.controls[3];
    nav.frame(pad(), (now = 2.2));
    expect(focusedName(menu)).toBe("b3");
    expect(focus.active).toBe(menu.controls[3]);
  });
});

describe("a click's cue (MENU-18, RV-501)", () => {
  it("confirm only with a question shown; a page's hidden question (kept for later) leaves it a select", () => {
    const menu = new Menu("m");
    const no = new Control("no", box(0, 0), { "data-pad-default": "" }, ["[hidden]"]);
    menu.controls = [...column("b", 2), no];
    expect(clickCue(menu as unknown as HTMLElement)).toBe("select");
    menu.controls = [...column("b", 2), new Control("no", box(0, 0), { "data-pad-default": "" })];
    expect(clickCue(menu as unknown as HTMLElement)).toBe("confirm");
    expect(clickCue(null)).toBe("select");
  });
});

