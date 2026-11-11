import { describe, expect, it } from "vitest";
import { type RatioWindow, watchPixelRatio } from "./pixelRatio";

/** A window whose ratio the test moves: its media queries, each with its listeners */
class FakeWindow implements RatioWindow {
  devicePixelRatio = 2;
  readonly queries: { text: string; listeners: Set<() => void> }[] = [];

  matchMedia(text: string): Pick<MediaQueryList, "addEventListener" | "removeEventListener"> {
    const query = { text, listeners: new Set<() => void>() };
    this.queries.push(query);
    return {
      addEventListener: (_type: string, listener: unknown): void => void query.listeners.add(listener as () => void),
      removeEventListener: (_type: string, listener: unknown): void => void query.listeners.delete(listener as () => void),
    };
  }

  /** The ratio now `ratio`: the queries that matched the old one say so */
  move(ratio: number): void {
    const was = `(resolution: ${String(this.devicePixelRatio)}dppx)`;
    this.devicePixelRatio = ratio;
    for (const query of [...this.queries]) if (query.text === was) for (const listener of [...query.listeners]) listener();
  }
}

describe("the device pixel ratio watched (REN-04)", () => {
  it("each change is told once, the watch made again for the new ratio; none after its end", () => {
    const view = new FakeWindow();
    let changes = 0;
    const stop = watchPixelRatio(() => changes++, view);
    expect(view.queries.map((q) => q.text)).toEqual(["(resolution: 2dppx)"]);
    view.move(1);
    expect(changes).toBe(1);
    // (the old ratio's query let go, the new one's watched: back again, and to a zoom's fraction)
    expect(view.queries.map((q) => [q.text, q.listeners.size])).toEqual([
      ["(resolution: 2dppx)", 0],
      ["(resolution: 1dppx)", 1],
    ]);
    view.move(2);
    view.move(1.25);
    expect(changes).toBe(3);
    stop();
    view.move(1);
    expect(changes).toBe(3);
    expect(view.queries.every((q) => q.listeners.size === 0)).toBe(true);
  });
});
