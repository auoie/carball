import { describe, expect, it } from "vitest";
import { LeaveGuard } from "./leaveGuard";

/** A page's window and history: its listeners, the entries pushed, the Backs taken */
function page(): {
  target: Pick<Window, "addEventListener">;
  fire: (kind: string) => boolean;
  pushed: () => number;
  backs: () => number;
  entries: { pushState: () => void; back: () => void };
} {
  const listeners = new Map<string, ((e: Event) => void)[]>();
  let pushed = 0;
  let backs = 0;
  const target = {
    addEventListener: (kind: string, f: (e: Event) => void) => {
      listeners.set(kind, [...(listeners.get(kind) ?? []), f]);
    },
  } as unknown as Pick<Window, "addEventListener">;
  // (whether the event's default went ahead: false, asked about)
  const fire = (kind: string): boolean => {
    const e = new Event(kind, { cancelable: true });
    for (const f of listeners.get(kind) ?? []) f(e);
    return !e.defaultPrevented;
  };
  const entries = {
    pushState: () => {
      pushed++;
    },
    back: () => {
      backs++;
    },
  };
  return { target, fire, pushed: () => pushed, backs: () => backs, entries };
}

describe("a queue match's page left by accident (RV-1091, RV-1103, RV-1104, RV-1109)", () => {
  it("asks before the page unloads from its start, while the match lives; not once it's over (RV-1116)", () => {
    const p = page();
    const guard = new LeaveGuard(p.target, p.entries);
    expect(p.fire("beforeunload"), "loading, the seat claimed").toBe(false);
    let live = true;
    guard.live = () => live;
    expect(p.fire("beforeunload")).toBe(false);
    live = false;
    expect(p.fire("beforeunload"), "the match over").toBe(true);
  });

  it("pushes Back's entry at a press alone (a browser skips one pushed without), again at the next press after a Back", () => {
    const p = page();
    const guard = new LeaveGuard(p.target, p.entries);
    expect(p.pushed(), "none before a press").toBe(0);
    p.fire("keydown");
    p.fire("pointerdown");
    expect(p.pushed(), "one at the first press, not one a press").toBe(1);
    p.fire("popstate");
    expect([p.pushed(), p.backs()], "Back took it: kept in the page, no Back of ours").toEqual([1, 0]);
    p.fire("pointerdown");
    expect(p.pushed(), "another at the next press").toBe(2);
    guard.live = () => false;
    p.fire("popstate");
    expect(p.backs(), "over: on to where Back goes").toBe(1);
    p.fire("keydown");
    expect(p.pushed(), "over: no entry").toBe(2);
  });

  it("never asks about the page's own leave (the menu's Leave, the end screen's exit, a failed claim or load)", () => {
    const p = page();
    const guard = new LeaveGuard(p.target, p.entries);
    p.fire("keydown");
    guard.leaving();
    expect(guard.asks()).toBe(false);
    expect(p.fire("beforeunload")).toBe(true);
    p.fire("popstate");
    expect(p.backs(), "leaving: no Back of its own").toBe(0);
  });
});
