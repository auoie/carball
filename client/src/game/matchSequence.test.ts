import { describe, expect, it } from "vitest";
import type { MatchPhase } from "../net/protocol";
import { WAITING_VIEW, dimming, hudParts, matchOver, onlineHudParts, podiumSpots, podiumView, respawnShown, winnerBanner, winnersGoal } from "./matchSequence";

const near = (a: number, b: number, eps = 0.2): boolean => Math.abs(a - b) <= eps;

describe("the match's start and end", () => {
  it("joins on the side view: CameraActor_7 looking across the field, 2° up, FOV 100 (CAM-30)", () => {
    expect(WAITING_VIEW.position).toEqual({ x: 3974.73, y: 0, z: 342.39 });
    expect(near(WAITING_VIEW.forward.x, -0.9994, 0.001) && near(WAITING_VIEW.forward.z, 0.0349, 0.001)).toBe(true);
    expect(WAITING_VIEW.horizontalFov).toBe(100);
  });

  it("frames the podium from the field side toward the winners' goal, easing from 600 to 400 uu (CAM-36's numbers)", () => {
    // Three blue cars, their mean (−30, −1761.7): the camera at (−30, −1162, 80.9) at once, (−30, −1361.9, 74.0) settled
    const cars = [{ x: -40, y: -1670, z: 17 }, { x: -200, y: -1795, z: 17 }, { x: 150, y: -1820, z: 17 }];
    const start = podiumView(cars, 0, 0);
    expect(near(start.position.x, -30) && near(start.position.y, -1162, 0.5) && near(start.position.z, 80.9)).toBe(true);
    const settled = podiumView(cars, 0, 5.3);
    expect(near(settled.position.y, -1361.9, 0.5) && near(settled.position.z, 74.0)).toBe(true);
    expect(start.horizontalFov).toBe(70);
    // The spots themselves, not where the cars were last seen (the placement comes a datagram after the phase: RV-273)
    expect(podiumSpots(0, 3)).toEqual(cars);
    expect(podiumView(podiumSpots(0, 3), 0, 0)).toEqual(start);
    expect(podiumSpots(1, 1)).toEqual([{ x: 40, y: 1670, z: 17 }]);
    expect(podiumSpots(0, 6)).toHaveLength(4);
    // Orange's: the other way round
    const orange = podiumView(podiumSpots(1, 1), 1, 0);
    expect(orange.forward.y).toBeGreaterThan(0.99);
    expect(winnersGoal(1)).toEqual({ x: 0, y: 5120, z: 312 });
  });

  it("names the winner, by forfeit too; none without one", () => {
    expect(winnerBanner(0, false)).toEqual({ label: "WINNER", team: "BLUE", side: 0 });
    expect(winnerBanner(1, true)).toEqual({ label: "WINNER BY FORFEIT", team: "ORANGE", side: 1 });
    expect(winnerBanner(null, false)).toBeNull();
  });

  it("dims the screen to 0.8 before the podium, swaps to the vignette on it, back to 0.8 at the end (MIO-20)", () => {
    const none = { filter: 0, vignette: 0 };
    expect(dimming("prePodium", 0.5, none)).toEqual({ filter: 0.4, vignette: 0 });
    expect(dimming("prePodium", 2, none)).toEqual({ filter: 0.8, vignette: 0 });
    expect(dimming("podium", 0.25, { filter: 0.8, vignette: 0 })).toEqual({ filter: 0.4, vignette: 0.375 });
    expect(dimming("finished", 1, { filter: 0, vignette: 0.75 })).toEqual({ filter: 0.8, vignette: 0 });
  });

  it("shows the HUD's match parts only while playing; the held scoreboard not at the end (MIO-5, MIO-17)", () => {
    expect(hudParts("waiting")).toEqual({ scoreboard: false, boost: false, heldScoreboard: true });
    expect(hudParts("active")).toEqual({ scoreboard: true, boost: true, heldScoreboard: true });
    expect(hudParts("replay")).toEqual({ scoreboard: true, boost: false, heldScoreboard: true });
    expect(hudParts("podium")).toEqual({ scoreboard: false, boost: false, heldScoreboard: false });
    expect(matchOver("finished") && !matchOver("replay")).toBe(true);
  });

  it("online, a demolished car's own HUD gone: its boost meter and ball cam indicator (HUD-16, RV-513; RV-538 CM15)", () => {
    expect(onlineHudParts("active", false)).toEqual({ scoreboard: true, boost: true, heldScoreboard: true, ballCamIndicator: true });
    expect(onlineHudParts("active", true)).toEqual({ scoreboard: true, boost: false, heldScoreboard: true, ballCamIndicator: false });
    expect(onlineHudParts("replay", false)).toMatchObject({ boost: false, ballCamIndicator: true });
    expect(onlineHudParts("finished", false)).toMatchObject({ boost: false, ballCamIndicator: false });
  });
});

describe("the respawn view's phases (HUD-20, RH1; the user's finding at a match's end, 2026-10-16)", () => {
  it("in Active play only (0:00 too); cleared by a goal, its replay, the countdown and the match's end; free play always", () => {
    expect(respawnShown(undefined)).toBe(true);
    expect(respawnShown(null)).toBe(true);
    const phases: readonly MatchPhase[] = ["waiting", "countdown", "active", "timeUp", "postGoal", "replay", "prePodium", "podium", "finished"];
    expect(phases.filter((phase) => respawnShown({ phase }))).toEqual(["active", "timeUp"]);
  });
});

