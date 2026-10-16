// A theme's chunk as it loads (RV-445, RV-455): fetched ahead without being built; one that fails to load or build gives
// night's arena, the match playing on (themes are looks only)
import { afterEach, describe, expect, it, vi } from "vitest";
import { createThemeOrNight, preloadTheme } from ".";

const loaded = vi.hoisted(() => ({ chunk: 0, built: 0 }));
vi.mock("./meadow", () => {
  loaded.chunk += 1;
  return {
    meadowTheme: () => {
      loaded.built += 1;
      throw new Error("Failed to fetch dynamically imported module");
    },
  };
});

describe("a theme's chunk", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is fetched ahead, not built (a found match's map, during the join's countdown: RV-455)", async () => {
    expect(loaded.chunk).toBe(0);
    await preloadTheme("meadow");
    expect(loaded.chunk).toBe(1);
    expect(loaded.built).toBe(0);
    // (night's is in the main bundle: nothing to fetch)
    await expect(preloadTheme("night")).resolves.toBeUndefined();
  });

  it("that fails gives night's arena, named night, the match playing on (RV-445)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const made = await createThemeOrNight("meadow");
    expect(loaded.built).toBe(1);
    expect(made.name).toBe("night");
    expect(made.theme.style.walls.blue).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect((await createThemeOrNight("night")).name).toBe("night");
  });
});
