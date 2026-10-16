// The search's banner (MM-5, MS1): its line under the strip (ours: the log the game shows only in its panel)
import { describe, expect, it } from "vitest";
import type { LogLine, SearchViewState } from "../game/matchmaking";
import { BannerMessage, MESSAGE_SECONDS } from "./searchView";

const line = (text: string, kind: LogLine["kind"] = "status"): LogLine => ({ text, kind });
const state = (status: SearchViewState["status"], lines: LogLine[]): SearchViewState => ({ status, lines });

describe("the line under the search's banner", () => {
  it("a new line for a while (a warning at the start, the log's timeline), not again once gone; none without a search", () => {
    const m = new BannerMessage();
    const warning = line("Not every player joined the match. Searching again.", "warning");
    expect(m.update(state("connecting", [warning]), 0)).toEqual(warning);
    expect(m.update(state("searching", [warning]), MESSAGE_SECONDS - 0.1)).toEqual(warning);
    expect(m.update(state("searching", [warning]), MESSAGE_SECONDS + 0.1)).toBeNull();
    // (the timeline's line, before the warning in the log: still the new one)
    const finding = line("Trying to find best match...");
    expect(m.update(state("searching", [finding, warning]), 20)).toEqual(finding);
    expect(m.update(state("searching", [finding, warning]), 30)).toBeNull();
    expect(m.update(null, 31)).toBeNull();
    // (a new search: its lines new again)
    expect(m.update(state("connecting", [warning]), 40)).toEqual(warning);
  });

  it("the join's countdown while it runs, and a failed or ended search's last line while it shows (MM-14)", () => {
    const m = new BannerMessage();
    const three = line("Joining in 3", "countdown");
    const two = line("Joining in 2", "countdown");
    expect(m.update(state("joining", [three]), 0)).toEqual(three);
    expect(m.update(state("joining", [three, two]), 100)).toEqual(two);
    const failed = line("Search failed: refused", "warning");
    expect(m.update(state("failed", [failed]), 200)).toEqual(failed);
    expect(m.update(state("failed", [failed]), 200 + 10 * MESSAGE_SECONDS)).toEqual(failed);
    const replaced = line("You started searching in another tab.");
    expect(m.update(state("ended", [replaced]), 400)).toEqual(replaced);
  });
});

describe("the lines under the banner in turn", () => {
  it("a warning keeps its time, the timeline's line due at once after it (a search back from a cancelled match keeps its clock)", () => {
    const m = new BannerMessage();
    const warning = line("Not every player joined the match. Searching again.", "warning");
    const finding = line("Trying to find best match...");
    expect(m.update(state("connecting", [warning]), 0)).toEqual(warning);
    // (searching a moment later, its clock past 5 s: the timeline's line queued behind the warning)
    expect(m.update(state("searching", [finding, warning]), 0.2)).toEqual(warning);
    expect(m.update(state("searching", [finding, warning]), MESSAGE_SECONDS - 0.1)).toEqual(warning);
    expect(m.update(state("searching", [finding, warning]), MESSAGE_SECONDS + 0.1)).toEqual(finding);
    expect(m.update(state("searching", [finding, warning]), 2 * MESSAGE_SECONDS + 0.2)).toBeNull();
  });
});

