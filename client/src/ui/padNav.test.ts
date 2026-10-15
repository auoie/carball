import { afterEach, describe, expect, it, vi } from "vitest";
import { PadMenuNav, nearestTowards, padDirection, stepInSequence } from "./padNav";

const pad = (down: number[], axes: number[] = [0, 0, 0, 0]): { buttons: number[]; axes: number[] } => ({
  buttons: Array.from({ length: 17 }, (_, i) => (down.includes(i) ? 1 : 0)),
  axes,
});

describe("the menus with a pad", () => {
  it("move by the D-pad, else the left stick past half way", () => {
    expect([padDirection(pad([12])), padDirection(pad([13])), padDirection(pad([14])), padDirection(pad([15]))]).toEqual(["up", "down", "left", "right"]);
    expect(padDirection(pad([], [0.3, -0.2]))).toBeNull();
    expect(padDirection(pad([], [0.1, 0.9]))).toBe("down");
    expect(padDirection(pad([], [-0.8, 0.6]))).toBe("left");
  });

  it("to the nearest control that way, the one in line before one off to the side", () => {
    const from = { left: 100, top: 100, width: 100, height: 40 };
    const below = { left: 100, top: 160, width: 100, height: 40 };
    const belowRight = { left: 300, top: 150, width: 100, height: 40 };
    const right = { left: 260, top: 100, width: 100, height: 40 };
    const above = { left: 100, top: 40, width: 100, height: 40 };
    const candidates = [below, belowRight, right, above];
    expect(nearestTowards(from, "down", candidates)).toBe(0);
    expect(nearestTowards(from, "right", candidates)).toBe(2);
    expect(nearestTowards(from, "up", candidates)).toBe(3);
    expect(nearestTowards(from, "left", candidates)).toBe(-1);
  });

  it("left and right in the same row first, up and down in the same column, before a nearer control off it (the user's finding)", () => {
    // The settings' tabs wrapped onto two rows (widths as their labels'): right from Camera is Controller, not
    // Scoreboard below it (its centre a little to the right, it scored nearer)
    const tab = (left: number, row: number, width: number): { left: number; top: number; width: number; height: number } => ({ left, top: row * 32, width, height: 28 });
    const camera = tab(84, 0, 70);
    const controller = tab(158, 0, 90);
    const interfaceTab = tab(0, 1, 85);
    const scoreboard = tab(89, 1, 95);
    expect(nearestTowards(camera, "right", [scoreboard, controller, interfaceTab])).toBe(1);
    expect(nearestTowards(controller, "left", [scoreboard, camera, interfaceTab])).toBe(1);
    // Nothing that way in the row: the nearest, wherever it is
    expect(nearestTowards(controller, "right", [scoreboard, camera, interfaceTab])).toBe(-1);
    // (merely touching the row, edge to edge, isn't in it: RX13's Q4)
    const row = { left: 0, top: 0, width: 100, height: 30 };
    expect(nearestTowards(row, "right", [{ left: 110, top: 30, width: 50, height: 30 }, { left: 400, top: 0, width: 50, height: 30 }])).toBe(1);
    expect(nearestTowards(tab(300, 0, 60), "left", [scoreboard])).toBe(0);
    // Up and down: the control in the column, before a nearer one beside it
    const from = { left: 0, top: 0, width: 100, height: 30 };
    const diagonal = { left: 101, top: 40, width: 18, height: 30 };
    const column = { left: 0, top: 200, width: 100, height: 30 };
    expect(nearestTowards(from, "down", [diagonal, column])).toBe(1);
    expect(nearestTowards(from, "down", [diagonal])).toBe(0);
  });

  it("steps through a sequence's controls in their order, across its rows (the settings' tabs), none past its ends", () => {
    const tabs = ["Controls", "Camera", "Controller", "Gameplay", "Interface", "Scoreboard", "Chat", "Video", "Audio"];
    expect(stepInSequence(tabs, "Camera", "right")).toBe("Controller");
    expect(stepInSequence(tabs, "Interface", "right")).toBe("Scoreboard");
    expect(stepInSequence(tabs, "Scoreboard", "left")).toBe("Interface");
    expect(stepInSequence(tabs, "Controls", "left")).toBeNull();
    expect(stepInSequence(tabs, "Audio", "right")).toBeNull();
    expect(stepInSequence(tabs, "Close", "right")).toBeNull();
  });

  it("keeps a button pressed for a menu from the game until it's released, not one held from before (RV-289)", () => {
    let open = false;
    const menu = { querySelectorAll: () => [] } as unknown as HTMLElement;
    const nav = new PadMenuNav({
      menu: () => (open ? menu : null),
      back: () => undefined,
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
    nav.frame(pad([B]), 0.7); // (a new press, the capture over: back)
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

/** A control in a stand-in DOM: its box, its container */
class FakeControl {
  readonly classList = { add: (): void => undefined, remove: (): void => undefined };
  readonly disabled = false;
  constructor(
    readonly name: string,
    readonly box: { left: number; top: number; width: number; height: number },
    readonly sequence: { contains: (c: unknown) => boolean } | null,
  ) {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.box;
  }
  closest(selector: string): unknown {
    return selector === "[data-pad-sequence]" ? this.sequence : null;
  }
  focus(): void {
    // (a stand-in)
  }
  scrollIntoView(): void {
    // (a stand-in)
  }
  click(): void {
    // (a stand-in)
  }
}

describe("a sequence of controls with a pad (the settings' tabs: RV-383)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("steps left and right in its order across its rows; up and down, and past its end, by the nearest", () => {
    // (no element is one of these: a stand-in DOM's controls are buttons)
    const NoElement = function NoElement(): void {
      // (never constructed)
    };
    vi.stubGlobal("HTMLElement", NoElement);
    vi.stubGlobal("HTMLSelectElement", NoElement);
    vi.stubGlobal("HTMLInputElement", NoElement);
    vi.stubGlobal("document", { activeElement: null });
    const tabs: FakeControl[] = [];
    const row = { contains: (c: unknown): boolean => tabs.includes(c as FakeControl) };
    const box = (left: number, top: number, width: number): { left: number; top: number; width: number; height: number } => ({ left, top, width, height: 28 });
    // Two rows of tabs, Close at the first row's end, Reset beside the second row's tab, a list under the third tab
    tabs.push(new FakeControl("t0", box(0, 0, 80), row), new FakeControl("t1", box(84, 0, 70), row), new FakeControl("t2", box(158, 0, 90), row), new FakeControl("t3", box(0, 32, 85), row));
    const controls = [...tabs, new FakeControl("close", box(600, 0, 90), null), new FakeControl("reset", box(300, 32, 80), null), new FakeControl("list", box(150, 100, 250), null)];
    const menu = { querySelectorAll: () => controls } as unknown as HTMLElement;
    const nav = new PadMenuNav({ menu: () => menu, back: () => undefined, start: () => undefined });
    const RIGHT = 15;
    const DOWN = 13;
    let t = 0;
    // (the focused control: the one the nav last focused)
    const shownFocus: string[] = [];
    for (const c of controls) c.focus = (): void => void shownFocus.push(c.name);
    nav.frame(pad([]), 0); // (the first control focused at once)
    const step = (button: number): string | undefined => {
      nav.frame(pad([button]), (t += 0.05));
      nav.frame(pad([]), (t += 0.05));
      return shownFocus.at(-1);
    };
    expect(shownFocus.at(-1)).toBe("t0");
    expect(step(RIGHT)).toBe("t1");
    expect(step(RIGHT)).toBe("t2");
    expect(step(RIGHT), "the next row's first tab, not Close (in this row) or the list").toBe("t3");
    expect(step(RIGHT), "past the sequence's end: the nearest that way in the row (RX13's Q7)").toBe("reset");
    nav.frame(pad([]), (t += 0.05));
    const back = new PadMenuNav({ menu: () => menu, back: () => undefined, start: () => undefined });
    shownFocus.length = 0;
    back.frame(pad([]), 0);
    for (let i = 0; i < 2; i++) {
      back.frame(pad([RIGHT]), (t += 0.05));
      back.frame(pad([]), (t += 0.05));
    }
    expect(shownFocus.at(-1)).toBe("t2");
    back.frame(pad([DOWN]), (t += 0.05));
    expect(shownFocus.at(-1), "down from a tab: the list under it, not the next tab (RX13's Q8)").toBe("list");
  });
});
