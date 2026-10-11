import { describe, expect, it } from "vitest";
import type { ForfeitVote } from "../net/protocol";
import { type MatchMenuState, matchMenuItems, pressTo, voteHud, voteLabel } from "./forfeitVote";

const NONE: ForfeitVote = { state: "none", yes: 0, required: 0, secondsLeft: 0, voted: false, canStart: true };
const RUNNING: ForfeitVote = { state: "running", yes: 1, required: 3, secondsLeft: 17, voted: false, canStart: true };

const labels = (s: MatchMenuState): string[] => matchMenuItems(s).map((i) => i.label);

describe("the midgame menu's match buttons", () => {
  it("offers a 1v1 forfeit with its confirm while votes are allowed, else leaving", () => {
    const state = { matchType: "ranked", teamSize: 1, canVoteForfeit: true, vote: NONE } as const;
    expect(matchMenuItems(state)).toEqual([
      { action: "forfeit", label: "Forfeit Match", confirm: "Are you sure you want to forfeit the match?", danger: true },
    ]);
    expect(matchMenuItems({ ...state, canVoteForfeit: false })).toEqual([
      { action: "leave", label: "Leave Match", confirm: "Are you sure you want to quit the match?", danger: false },
    ]);
  });

  it("labels a team vote by the match type and shows it only while the player can start or join one", () => {
    const state = { matchType: "casual", teamSize: 3, canVoteForfeit: true, vote: NONE } as const;
    expect(labels(state)).toEqual(["Vote to Concede", "Leave Match"]);
    expect(labels({ ...state, matchType: "ranked" })).toEqual(["Vote to Forfeit", "Leave Match"]);
    expect(matchMenuItems(state)[0]?.confirm).toBeNull();
    // Not yet allowed (the clock's wait), or a private match's
    expect(labels({ ...state, canVoteForfeit: false })).toEqual(["Leave Match"]);
    expect(labels({ ...state, matchType: "private" })).toEqual(["Leave Match"]);
    // Locked out: only to join a running vote they haven't voted in
    const locked = { ...NONE, canStart: false };
    expect(labels({ ...state, vote: locked })).toEqual(["Leave Match"]);
    expect(labels({ ...state, vote: { ...RUNNING, canStart: false } })).toEqual(["Vote to Concede", "Leave Match"]);
    expect(labels({ ...state, vote: { ...RUNNING, canStart: false, voted: true } })).toEqual(["Leave Match"]);
    expect(labels({ ...state, vote: null })).toEqual(["Leave Match"]);
  });
});

describe("the vote widget", () => {
  it("shows the tally, the time left and the hint until the player votes", () => {
    expect(voteHud(RUNNING, "casual", "Esc")).toEqual({ tally: "Vote to Concede 1/3", fill: 17 / 20, time: "0:17", instructions: "Press Esc to Vote" });
    expect(voteHud({ ...RUNNING, voted: true, secondsLeft: 20 }, "ranked", "Esc")).toEqual({ tally: "Vote to Forfeit 1/3", fill: 1, time: "0:20", instructions: null });
  });

  it("is gone when the vote finishes or there is none", () => {
    expect(voteHud({ ...RUNNING, state: "passed" }, "casual", "Esc")).toBeNull();
    expect(voteHud({ ...RUNNING, state: "failed" }, "casual", "Esc")).toBeNull();
    expect(voteHud(NONE, "casual", "Esc")).toBeNull();
    expect(voteHud(null, "casual", "Esc")).toBeNull();
  });

  it("uses the game's strings", () => {
    expect(voteLabel("private")).toBe("Vote to Concede");
    expect(pressTo("Space", "Skip")).toBe("Press Space to Skip");
  });
});
