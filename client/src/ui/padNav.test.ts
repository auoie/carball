import { afterEach, describe, expect, it, vi } from "vitest";
import { MENU_INPUT, PadMenuNav, menuRows, padDirection, padInput, sliderStep, stickDirection } from "./padNav";

const pad = (down: number[], axes: number[] = [0, 0, 0, 0]): { buttons: number[]; axes: number[] } => ({
  buttons: Array.from({ length: 17 }, (_, i) => (down.includes(i) ? 1 : 0)),
  axes,
});

describe("the menus with a pad", () => {
  it("move by the D-pad, else the left stick only at 0.8 or past it (MENU-12: a resting or drifting stick never moves it)", () => {
    expect([padDirection(pad([12])), padDirection(pad([13])), padDirection(pad([14])), padDirection(pad([15]))]).toEqual(["up", "down", "left", "right"]);
    expect(padDirection(pad([], [0.3, -0.2]))).toBeNull();
    expect(padDirection(pad([], [0.6, 0.7]))).toBeNull();
    expect(padDirection(pad([], [0.1, 0.9]))).toBe("down");
    expect(padDirection(pad([], [-0.85, 0.6]))).toBe("left");
    expect(padDirection(pad([], [0, MENU_INPUT.stick - 0.01]))).toBeNull();
    expect(padDirection(pad([], [0, MENU_INPUT.stick]))).toBe("down");
    expect(padInput(pad([], [0, 0.9]))?.stick).toBe(true);
    expect(padInput(pad([13]))?.stick).toBe(false);
  });

  it("give the stick's direction to the axis that reached 0.8 first, till it falls back under it (MN1: no hysteresis)", () => {
    // (x reached first: still right though y's now the larger)
    expect(stickDirection(0.85, 0.95, 0)).toEqual({ direction: "right", owner: 0 });
    // (x falls under 0.8: y has it)
    expect(stickDirection(0.79, 0.95, 0)).toEqual({ direction: "down", owner: 1 });
    // (exactly 0.8 counts; under it, nothing)
    expect(stickDirection(0, -0.8, null)).toEqual({ direction: "up", owner: 1 });
    expect(stickDirection(0.79, 0, null)).toEqual({ direction: null, owner: null });
    // (flicked to the other side: a release this frame)
    expect(stickDirection(-0.9, 0, 0, "right")).toEqual({ direction: null, owner: null });
    expect(stickDirection(-0.9, 0, null)).toEqual({ direction: "left", owner: 0 });
  });

  it("step a held slider by 1, then 2, 3, 6 and 11 of its steps as a hold goes on (MENU-16)", () => {
    expect([1, 7, 8, 13, 14, 19, 20, 25, 26, 60].map(sliderStep)).toEqual([1, 1, 2, 2, 3, 3, 6, 6, 11, 11]);
  });

  it("make a page's rows: each value its own, buttons on one line together", () => {
    const box = (top: number, left = 0, height = 30): { left: number; top: number; width: number; height: number } => ({ left, top, width: 80, height });
    // A slider, a checkbox, a row of three buttons, a button under them, two values on one line
    const rows = menuRows([
      { rect: box(0), value: true },
      { rect: box(40), value: true },
      { rect: box(80, 0), value: false },
      { rect: box(82, 90), value: false },
      { rect: box(80, 180), value: false },
      { rect: box(130), value: false },
      { rect: box(170, 0), value: true },
      { rect: box(170, 90), value: true },
    ]);
    expect(rows).toEqual([[0], [1], [2, 3, 4], [5], [6], [7]]);
  });

  it("keeps a button pressed for a menu from the game until it's released, not one held from before (RV-289)", () => {
    let open = false;
    const menu = { querySelectorAll: () => [] } as unknown as HTMLElement;
    const nav = new PadMenuNav({
      menu: () => (open ? menu : null),
      back: () => true,
      start: () => {
        open = !open;
      },
    });
    const held = (...down: number[]): { axes: number[]; buttons: number[] } => pad(down);
    const RT = 7;
    const START = 9;
    nav.frame(held(RT), 0); // (boosting)
    nav.frame(held(RT, START), 0.1); // (Start: the pause menu)
    expect(open).toBe(true);
    nav.frame(held(RT), 0.2);
    nav.frame(held(RT, START), 0.3); // (Start again: closed)
    expect(open).toBe(false);
    expect(nav.mask(held(RT, START))?.buttons[RT]).toBe(1); // (the boost the game's all along)
    expect(nav.mask(held(RT, START))?.buttons[START]).toBe(0); // (Start the menu's while it's held)
    nav.frame(held(RT), 0.4);
    expect(nav.mask(held(RT))?.buttons).toEqual(held(RT).buttons);
  });

  it("stands aside while a binding's capture waits: B, Start and the D-pad bind instead of navigating, until all are up", () => {
    let capturing = true;
    let backs = 0;
    let starts = 0;
    const menu = { querySelectorAll: () => [] } as unknown as HTMLElement;
    const nav = new PadMenuNav({
      menu: () => menu,
      back: () => {
        backs++;
        return true;
      },
      start: () => {
        starts++;
      },
      capturing: () => capturing,
    });
    const B = 1;
    const START = 9;
    nav.frame(pad([]), 0);
    nav.frame(pad([B]), 0.1); // (Circle: the capture's)
    nav.frame(pad([START]), 0.2);
    expect([backs, starts]).toEqual([0, 0]);
    // The capture took Circle earlier in this frame (it's no longer waiting): Circle still down isn't a back
    nav.frame(pad([]), 0.3);
    nav.frame(pad([B]), 0.4);
    capturing = false;
    nav.frame(pad([B]), 0.5);
    expect(backs).toBe(0);
    expect(nav.mask(pad([B]))?.buttons[B]).toBe(0); // (kept from the game until released)
    nav.frame(pad([]), 0.6);
    nav.frame(pad([B]), 0.7); // (a new press, the capture over: back, as it's released)
    nav.frame(pad([]), 0.75);
    expect(backs).toBe(1);
  });

  it("holds the pad after a capture until every button is up and the stick back, not just the capture's end (RV-382)", () => {
    let capturing = true;
    let backs = 0;
    const menu = { querySelectorAll: () => [] } as unknown as HTMLElement;
    const nav = new PadMenuNav({
      menu: () => menu,
      back: () => {
        backs++;
        return true;
      },
      start: () => undefined,
      capturing: () => capturing,
    });
    const B = 1;
    const START = 9;
    nav.frame(pad([START]), 0); // (Start bound)
    capturing = false;
    nav.frame(pad([START]), 0.1);
    nav.frame(pad([START, B]), 0.2); // (B pressed with Start still down: still the capture's hold)
    expect(backs).toBe(0);
    nav.frame(pad([]), 0.3);
    nav.frame(pad([B]), 0.4);
    nav.frame(pad([]), 0.45);
    expect(backs).toBe(1);
    // A stick move bound: held there, the stick still out isn't a press after the capture
    capturing = true;
    nav.frame(pad([], [0, 1, 0, 0]), 0.5);
    capturing = false;
    nav.frame(pad([], [0, 1, 0, 0]), 0.6);
    nav.frame(pad([B], [0, 1, 0, 0]), 0.7);
    expect(backs).toBe(1);
  });
});

/** A control in a stand-in DOM: its box, its role and whether it's checked (a radio) */
class FakeControl {
  readonly classList = { add: (): void => undefined, remove: (): void => undefined };
  readonly disabled = false;
  clicks = 0;
  constructor(
    readonly name: string,
    readonly box: { left: number; top: number; width: number; height: number },
    readonly attributes: Record<string, string> = {},
  ) {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.box;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }
  closest(selector: string): object | null {
    // (the playlists a choosing group: data-pad-choose)
    return selector === "[data-pad-choose]" && this.attributes["role"] === "radio" ? {} : null;
  }
  focus(): void {
    // (a stand-in)
  }
  scrollIntoView(): void {
    // (a stand-in)
  }
  click(): void {
    this.clicks++;
  }
}

describe("a menu page as a list with a pad (the user's request: native to controllers)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("up and down along its rows in order, left and right along a row's buttons (a radio group's choice taken); its place kept when it's rebuilt", () => {
    // (no element is one of these: a stand-in DOM's controls are buttons)
    const NoElement = function NoElement(): void {
      // (never constructed)
    };
    vi.stubGlobal("HTMLElement", NoElement);
    vi.stubGlobal("HTMLInputElement", NoElement);
    vi.stubGlobal("document", { activeElement: null });
    const box = (left: number, top: number): { left: number; top: number; width: number; height: number } => ({ left, top, width: 70, height: 28 });
    // Free Play; the three playlists (a radio group, 2v2 chosen); Find Match; Back
    const build = (): FakeControl[] => [
      new FakeControl("free", box(0, 0)),
      new FakeControl("1v1", box(0, 40), { role: "radio", "aria-checked": "false" }),
      new FakeControl("2v2", box(80, 40), { role: "radio", "aria-checked": "true" }),
      new FakeControl("3v3", box(160, 40), { role: "radio", "aria-checked": "false" }),
      new FakeControl("find", box(0, 80)),
      new FakeControl("back", box(0, 120)),
    ];
    let controls = build();
    const menu = { id: "main-menu", querySelectorAll: (q: string) => (q === "[data-pad-page]" ? [] : controls) } as unknown as HTMLElement;
    const nav = new PadMenuNav({ menu: () => menu, back: () => true, start: () => undefined });
    const focused: string[] = [];
    const watch = (): void => {
      for (const c of controls) c.focus = (): void => void focused.push(c.name);
    };
    watch();
    let t = 0;
    const step = (button: number): string | undefined => {
      nav.frame(pad([button]), (t += 0.05));
      nav.frame(pad([]), (t += 0.05));
      return focused.at(-1);
    };
    const [UP, DOWN, LEFT, RIGHT] = [12, 13, 14, 15];
    nav.frame(pad([]), 0);
    expect(focused.at(-1), "the first row's at once").toBe("free");
    expect(step(DOWN), "into the radio group: its chosen one").toBe("2v2");
    expect(step(RIGHT)).toBe("3v3");
    expect(controls[3]?.clicks, "a radio's choice taken as the focus moves").toBe(1);
    expect(step(RIGHT), "a radio group wraps, a list's cycle").toBe("1v1");
    expect(step(DOWN)).toBe("find");
    expect(step(DOWN)).toBe("back");
    expect(step(DOWN), "the list's end: no wrap").toBe("back");
    expect(step(UP)).toBe("find");
    // The page rebuilt (a setting changed): the same place, by its row
    controls = build();
    watch();
    nav.frame(pad([]), (t += 0.05));
    expect(focused.at(-1)).toBe("find");
    expect(step(LEFT), "a lone button: left does nothing").toBe("find");
  });
});
