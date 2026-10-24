import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, lockedKeys } from "../input/bindings";
import { DisplayMode, type FullscreenDocument } from "./displayMode";

/** A page whose full screen a test drives: its requests (granted or refused), exits, locks and presses */
function page(opts: { enabled?: boolean; refuse?: boolean } = {}) {
  const log: string[] = [];
  const listeners = new Map<string, (() => void)[]>();
  const on = (kind: string, f: () => void): void => {
    listeners.set(kind, [...(listeners.get(kind) ?? []), f]);
  };
  const fire = (kind: string): void => {
    for (const f of listeners.get(kind) ?? []) f();
  };
  let full: Element | null = null;
  let refuse = opts.refuse ?? false;
  const doc: FullscreenDocument = {
    get fullscreenElement() {
      return full;
    },
    fullscreenEnabled: opts.enabled ?? true,
    documentElement: {
      requestFullscreen: () => {
        log.push("request");
        if (refuse) return Promise.reject(new Error("no press"));
        full = {} as Element;
        fire("fullscreenchange");
        return Promise.resolve();
      },
    },
    exitFullscreen: () => {
      log.push("exit");
      full = null;
      fire("fullscreenchange");
      return Promise.resolve();
    },
    addEventListener: on,
  };
  const target = {
    addEventListener: (kind: string, f: () => void) => {
      on(kind, f);
    },
  } as unknown as Pick<Window, "addEventListener">;
  const keyboard = {
    lock: (codes?: string[]) => {
      log.push(`lock ${(codes ?? ["(all)"]).join(" ")}`);
      return Promise.resolve();
    },
  };
  return {
    log,
    fire,
    full: () => full !== null,
    allow: () => {
      refuse = false;
    },
    mode: new DisplayMode({ keys: () => ["Escape", "KeyW"], doc, target, keyboard: () => keyboard }),
  };
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe("Display Mode (RV-1091, RV-1112, RV-1113, RV-1116)", () => {
  it("Fullscreen chosen: the lock asked first, for the keys needed, then full screen, locked again there", () => {
    const p = page();
    p.mode.set(true, true);
    expect(p.log).toEqual(["lock Escape KeyW", "request", "lock Escape KeyW"]);
    expect(p.full()).toBe(true);
    p.mode.set(false, true);
    expect(p.log.at(-1)).toBe("exit");
  });

  it("loaded so set: asked at the page's first press, once; a refused one asked again at the next press", async () => {
    const p = page({ refuse: true });
    p.mode.set(true, false);
    expect(p.log).toEqual([]);
    p.fire("keydown");
    await settle();
    expect(p.log.filter((l) => l === "request")).toHaveLength(1);
    p.allow();
    p.fire("pointerdown");
    await settle();
    expect(p.full(), "the next press's").toBe(true);
    p.fire("keydown");
    expect(
      p.log.filter((l) => l === "request"),
      "in full screen: no more",
    ).toHaveLength(2);
  });

  it("nothing where the page can't go full screen (an iPhone's Safari)", () => {
    const p = page({ enabled: false });
    p.mode.set(true, true);
    p.fire("keydown");
    expect(p.log).toEqual([]);
  });

  it("the lock's keys: the bound ones, Escape, W, T, N; never Tab nor the system key (Alt+Tab, the Windows key)", () => {
    const keys = lockedKeys({ ...DEFAULT_BINDINGS, rollLeft: { ...DEFAULT_BINDINGS.rollLeft, keyboard: { kind: "key", code: "MetaLeft" } } });
    for (const code of ["Escape", "KeyW", "KeyT", "KeyN", "ControlLeft", "Space"]) expect(keys, code).toContain(code);
    for (const code of ["Tab", "MetaLeft", "MetaRight"]) expect(keys, code).not.toContain(code);
  });
});
