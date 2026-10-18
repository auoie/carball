// The free-camera editor's words and rows (notes/training-editor.md TE1 §6.1, §4, §5.1: verbatim) and its input's reading
import { describe, expect, it } from "vitest";
import { LOOK } from "../training/editorControls";
import { FLY_TEXT, hudRows, packHeading, readMove, tagLabel } from "./flyEditor";

describe("the shot editor's HUD rows (TE1 §6.1)", () => {
  it("Test Shot, the next selection's Edit, the car's pitch rows, Free Cam when something's selected, Shot List, the timer", () => {
    const labels = (s: Parameters<typeof hudRows>[0]): string[] => hudRows(s).map((r) => r.label);
    expect(labels("free")).toEqual(["Test Shot", "Edit Ball", "Shot List", "Increase Timer", "Decrease Timer"]);
    expect(labels("ball")).toEqual(["Test Shot", "Edit Car", "Free Cam", "Shot List", "Increase Timer", "Decrease Timer"]);
    expect(labels("car")).toEqual(["Test Shot", "Edit Ball", "Toggle Pitch Lock", "Reset Pitch (Hold)", "Free Cam", "Shot List", "Increase Timer", "Decrease Timer"]);
  });

  it("the game's words elsewhere: the list's, the dialog's, the difficulties as Rookie, Pro and All-Star", () => {
    expect([FLY_TEXT.shot, FLY_TEXT.timeLimit, FLY_TEXT.strength, FLY_TEXT.shotRow(3), FLY_TEXT.create]).toEqual(["SHOT", "TIME LIMIT", "STRENGTH", "SHOT 3", "CREATE NEW SHOT"]);
    expect([FLY_TEXT.modify, FLY_TEXT.duplicate, FLY_TEXT.delete]).toEqual(["Modify the selected shot.", "Duplicate the selected shot.", "Delete the selected shot."]);
    expect([FLY_TEXT.sequenceSettings, FLY_TEXT.testSequence, FLY_TEXT.openMenu, FLY_TEXT.accept, FLY_TEXT.cancel]).toEqual(["SEQUENCE SETTINGS", "TEST SEQUENCE", "OPEN MENU", "ACCEPT", "CANCEL"]);
    expect(packHeading({ type: "striker", difficulty: "easy" })).toBe("ROOKIE STRIKER");
    expect(packHeading({ type: "goalie", difficulty: "hard" })).toBe("ALL-STAR GOALIE");
    expect(tagLabel("AirDribbles")).toBe("Air Dribbles");
  });
});

describe("the editor's input (TE1 §2.1)", () => {
  const none = (): boolean => false;
  it("W/S/A/D and Space/Left Ctrl move; the mouse looks (right turns right, up looks up)", () => {
    const held = new Set(["KeyW", "KeyA", "Space"]);
    const r = readMove((c) => held.has(c), null, { x: 10, y: -4 }, 1 / 60);
    expect(r.move).toEqual({ forward: 1, right: -1, up: 1 });
    expect(r.yaw).toBeCloseTo(10 * LOOK.mouse, 12);
    expect(r.pitch).toBeCloseTo(4 * LOOK.mouse, 12);
    expect(readMove((c) => c === "ControlLeft", null, { x: 0, y: 0 }, 1).move.up).toBe(-1);
  });

  it("the pad: the left stick moves (past its dead zone), the triggers up and down, the right stick looks at 20000 units/s", () => {
    const pad = { axes: [0.1, -1, 0.5, 0], buttons: [0, 0, 0, 0, 0, 0, 0.25, 1] };
    const r = readMove(none, pad, { x: 0, y: 0 }, 0.5);
    expect(r.move).toEqual({ forward: 1, right: 0, up: 0.75 });
    expect(r.yaw).toBeCloseTo(0.5 * LOOK.pad * 0.5, 12);
    expect(r.pitch).toBe(-0);
  });
});
