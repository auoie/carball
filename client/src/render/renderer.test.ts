// The renderer's load-time wait (RV-484): the shaders' compile, the context lost, or the timeout, whichever comes first
import { describe, expect, it, vi } from "vitest";
import { settledOr } from "./renderer";

describe("the page's wait on its shaders' compile", () => {
  it("ends with the compile, on a lost context, or at its timeout: never forever", async () => {
    const canvas = new EventTarget();
    await expect(settledOr(Promise.resolve(), canvas, 10_000)).resolves.toBeUndefined();
    const never = new Promise<void>(() => undefined);
    const lost = settledOr(never, canvas, 10_000);
    canvas.dispatchEvent(new Event("webglcontextlost"));
    await expect(lost).resolves.toBeUndefined();
    vi.useFakeTimers();
    try {
      const timedOut = settledOr(never, canvas, 50);
      vi.advanceTimersByTime(60);
      await expect(timedOut).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
