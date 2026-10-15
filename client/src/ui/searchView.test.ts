import { describe, expect, it } from "vitest";
import { searchViews } from "./searchView";

describe("the search's views", () => {
  it("show the panel while it's open over the menu, else the banner, never both; neither without a search (RX13's C17)", () => {
    const searching = { status: "searching", lines: [] } as const;
    expect(searchViews(searching, true)).toEqual({ panel: true, banner: false });
    expect(searchViews(searching, false)).toEqual({ panel: false, banner: true });
    expect(searchViews(null, true)).toEqual({ panel: false, banner: false });
    expect(searchViews(null, false)).toEqual({ panel: false, banner: false });
  });
});
