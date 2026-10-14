import { describe, expect, it } from "vitest";
import { PadMenuNav, nearestTowards, padDirection } from "./padNav";

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
});
