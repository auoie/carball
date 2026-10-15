import { describe, expect, it } from "vitest";
import { KICK_IDLE, KICK_NOT_ALL_JOINED } from "../net/protocol";
import { idleTipShown, sessionEndReason } from "./sessionEnd";

describe("a match session's end and the idle warning (MM-36..41, RV-360)", () => {
  it("names the end by the kick, else by the phase it ended in", () => {
    expect(sessionEndReason(KICK_IDLE, "active")).toBe("idle");
    expect(sessionEndReason(KICK_NOT_ALL_JOINED, "waiting")).toBe("notAllJoined");
    expect(sessionEndReason(null, "finished")).toBe("ended");
    expect(sessionEndReason(KICK_IDLE, "finished")).toBe("idle");
    for (const phase of ["active", "waiting", "podium", "replay", undefined] as const) expect(sessionEndReason(null, phase), phase).toBe("lost");
  });

  it("shows the tip only during play, with the car's camera, connected", () => {
    expect(idleTipShown(true, "active", false, false)).toBe(true);
    expect(idleTipShown(true, "timeUp", false, false)).toBe(true);
    expect(idleTipShown(false, "active", false, false)).toBe(false);
    for (const phase of ["countdown", "postGoal", "replay", "waiting", "finished"] as const) expect(idleTipShown(true, phase, false, false), phase).toBe(false);
    expect(idleTipShown(true, "active", true, false)).toBe(false);
    expect(idleTipShown(true, "active", false, true)).toBe(false);
  });
});
