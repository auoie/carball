import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "../input/bindings";
import { DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from "./settings";

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe("settings", () => {
  it("round-trips through storage", () => {
    const storage = new MemoryStorage();
    const custom = {
      ...DEFAULT_SETTINGS,
      bindings: { ...DEFAULT_BINDINGS, jump: { keyboard: { kind: "key", code: "Space" } as const, gamepad: null } },
      camera: { ...DEFAULT_SETTINGS.camera, fov: 110, distance: 260, stiffness: 0.45 },
      controller: { ...DEFAULT_SETTINGS.controller, deadzone: 0.15, aerialSensitivity: 1.4 },
      options: { ...DEFAULT_SETTINGS.options, ballCamToggle: false, invertSwivelPitch: false },
    };
    saveSettings(custom, storage);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it("falls back to defaults for nothing stored or broken JSON", () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
    const broken = new MemoryStorage();
    broken.setItem("rl-clone.settings.v1", "{not json");
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps numbers to the game's slider limits and ignores junk", () => {
    const s = parseSettings({
      camera: { fov: 400, height: "high", pitch: -99 },
      controller: { deadzone: -1, dodgeDeadzone: 5, aerialSensitivity: 0.5 },
      options: { airPitchSafety: "no", rearCameraToggle: true },
    });
    expect(s.camera.fov).toBe(110);
    expect(s.camera.height).toBe(DEFAULT_SETTINGS.camera.height);
    expect(s.camera.pitch).toBe(-15);
    expect(s.controller.deadzone).toBe(0);
    expect(s.controller.dodgeDeadzone).toBe(1);
    expect(s.controller.aerialSensitivity).toBe(1);
    expect(s.options.airPitchSafety).toBe(true);
    expect(s.options.rearCameraToggle).toBe(true);
  });

  it("defaults are the game's profile defaults", () => {
    expect(DEFAULT_SETTINGS.controller).toEqual({ deadzone: 0.2, dodgeDeadzone: 0.8, steeringSensitivity: 1, aerialSensitivity: 1 });
    expect(DEFAULT_SETTINGS.options).toEqual({ ballCamToggle: true, rearCameraToggle: false, invertSwivelPitch: true, airPitchSafety: true });
  });

  it("keeps defaults for missing bindings, clears invalid ones", () => {
    const s = parseSettings({
      bindings: {
        boost: { keyboard: { kind: "key", code: "KeyF" } }, // gamepad slot missing: default kept
        jump: { keyboard: { kind: "teleport" }, gamepad: { kind: "padAxis", axis: 1, sign: 5 } }, // invalid: cleared
      },
    });
    expect(s.bindings.boost.keyboard).toEqual({ kind: "key", code: "KeyF" });
    expect(s.bindings.boost.gamepad).toEqual(DEFAULT_BINDINGS.boost.gamepad);
    expect(s.bindings.jump).toEqual({ keyboard: null, gamepad: null });
    expect(s.bindings.throttleForward).toEqual(DEFAULT_BINDINGS.throttleForward);
  });

  it("treats non-objects as empty", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
  });
});
