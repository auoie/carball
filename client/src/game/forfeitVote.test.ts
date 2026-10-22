import { describe, expect, it } from "vitest";
import type { ForfeitVote } from "../net/protocol";
import { type MatchMenuState, type VoteHud, matchMenuItems, pressTo, voteFlashes, voteHud, voteLabel } from "./forfeitVote";

const NONE: ForfeitVote = { state: "none", yes: 0, required: 0, secondsLeft: 0, voted: false, canStart: true };
const RUNNING: ForfeitVote = { state: "running", yes: 1, required: 3, secondsLeft: 17, voted: false, canStart: true };

const labels = (s: MatchMenuState): string[] => matchMenuItems(s).map((i) => i.label);

describe("the midgame menu's match buttons", () => {
  it("offers a 1v1 forfeit with its confirm while votes are allowed, else leaving", () => {
    const state = { matchType: "ranked", teamSize: 1, canVoteForfeit: true, vote: NONE, leavePenalty: false } as const;
    expect(matchMenuItems(state)).toEqual([
      { action: "forfeit", label: "Forfeit Match", confirm: "Are you sure you want to forfeit the match?", danger: true },
    ]);
    expect(matchMenuItems({ ...state, canVoteForfeit: false })).toEqual([
      { action: "leave", label: "Leave Match", confirm: "Are you sure you want to quit the match?", danger: false },
    ]);
  });

  it("one slot (RV-236): a team vote labelled by the match type while the player can start or join one, else leaving", () => {
    const state = { matchType: "casual", teamSize: 3, canVoteForfeit: true, vote: NONE, leavePenalty: false } as const;
    expect(labels(state)).toEqual(["Vote to Concede"]);
    expect(labels({ ...state, matchType: "ranked" })).toEqual(["Vote to Forfeit"]);
    expect(matchMenuItems(state)[0]).toMatchObject({ confirm: null, danger: false });
    expect(matchMenuItems({ ...state, vote: RUNNING })[0]?.danger).toBe(true); // (red while one runs)
    // Not yet allowed (the clock's wait), or a private match's
    expect(labels({ ...state, canVoteForfeit: false })).toEqual(["Leave Match"]);
    expect(labels({ ...state, matchType: "private" })).toEqual(["Leave Match"]);
    // Locked out: only to join a running vote they haven't voted in
    const locked = { ...NONE, canStart: false };
    expect(labels({ ...state, vote: locked })).toEqual(["Leave Match"]);
    expect(labels({ ...state, vote: { ...RUNNING, canStart: false } })).toEqual(["Vote to Concede"]);
    expect(labels({ ...state, vote: { ...RUNNING, canStart: false, voted: true } })).toEqual(["Leave Match"]);
    expect(labels({ ...state, vote: null })).toEqual(["Leave Match"]);
  });

  it("a ranked lobby with the leave penalty: Abandon Match, its warning and red buttons, unless a vote is theirs to take part in (RV-715)", () => {
    const abandon = {
      action: "leave",
      label: "Abandon Match",
      confirm: "Abandoning a ranked game will temporarily ban you from matchmaking. ARE YOU SURE?",
      danger: false,
      warning: "Warning",
    };
    const team = { matchType: "ranked", teamSize: 2, canVoteForfeit: false, vote: NONE, leavePenalty: true } as const;
    expect(matchMenuItems(team)).toEqual([abandon]); // (no votes allowed yet: checked first)
    expect(labels({ ...team, canVoteForfeit: true })).toEqual(["Vote to Forfeit"]); // (a vote they may start)
    expect(labels({ ...team, canVoteForfeit: true, vote: RUNNING })).toEqual(["Vote to Forfeit"]); // (one to vote in)
    expect(labels({ ...team, canVoteForfeit: true, vote: { ...RUNNING, voted: true } })).toEqual(["Abandon Match"]);
    expect(labels({ ...team, canVoteForfeit: true, vote: { ...NONE, canStart: false } })).toEqual(["Abandon Match"]);
    // (no penalty: a lobby short of a player, or a winner; a casual or private match: Leave Match)
    expect(labels({ ...team, leavePenalty: false })).toEqual(["Leave Match"]);
    expect(labels({ ...team, matchType: "casual" })).toEqual(["Leave Match"]);
    // (a 1v1: its forfeit first while allowed, then the penalty's)
    const duel = { ...team, teamSize: 1 } as const;
    expect(labels({ ...duel, canVoteForfeit: true })).toEqual(["Forfeit Match"]);
    expect(matchMenuItems(duel)).toEqual([abandon]);
  });
});

describe("the vote widget", () => {
  it("shows the tally, the bar as the votes of those needed, the time and the hint until the player votes (RV-237)", () => {
    expect(voteHud(RUNNING, "casual", "Esc")).toEqual({
      tally: "Vote to Concede 1/3",
      yes: 1,
      fill: 1 / 3,
      time: "0:17",
      instructions: "Press Esc to Vote",
      running: true,
    });
    expect(voteHud({ ...RUNNING, voted: true, yes: 2, secondsLeft: 20 }, "ranked", "Esc")).toEqual({
      tally: "Vote to Forfeit 2/3",
      yes: 2,
      fill: 2 / 3,
      time: "0:20",
      instructions: null,
      running: true,
    });
  });

  it("flashes its bar at each new yes, the first one too, a new vote's while a finished one shows also (RV-268)", () => {
    const widget = (yes: number, running = true): VoteHud => ({ tally: "", yes, fill: 0, time: "", instructions: null, running });
    expect(voteFlashes(null, widget(1))).toBe(true);
    expect(voteFlashes(widget(1), widget(1))).toBe(false);
    expect(voteFlashes(widget(1), widget(2))).toBe(true);
    expect(voteFlashes(widget(2), widget(2, false))).toBe(false); // (finished: its 5 s)
    expect(voteFlashes(widget(1, false), widget(1))).toBe(true); // (a teammate's new vote in the failed one's 5 s)
  });

  it("stays through a finished vote's 5 s (no hint); gone when there is none or the match has ended", () => {
    expect(voteHud({ ...RUNNING, state: "failed", secondsLeft: 0 }, "casual", "Esc")).toMatchObject({ tally: "Vote to Concede 1/3", instructions: null });
    expect(voteHud({ ...RUNNING, state: "passed", yes: 3 }, "casual", "Esc")?.fill).toBe(1);
    expect(voteHud(RUNNING, "casual", "Esc", true)).toBeNull();
    expect(voteHud(NONE, "casual", "Esc")).toBeNull();
    expect(voteHud(null, "casual", "Esc")).toBeNull();
  });

  it("uses the game's strings", () => {
    expect(voteLabel("private")).toBe("Vote to Concede");
    expect(pressTo("Space", "Skip")).toBe("Press Space to Skip");
  });
});
