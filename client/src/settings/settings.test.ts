import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "../input/bindings";
import { DEFAULT_CAMERA_SETTINGS } from "../camera/rlCamera";
import { DEFAULT_SETTINGS, MODERN_CAMERA_KBM, MODERN_CAMERA_PAD, loadSettings, parseSettings, saveSettings } from "./settings";

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
  it("settings saved before the per-input cameras migrate as the game's old profiles: no free look, their toggle and inversion kept", () => {
    const old = parseSettings({ camera: { ...DEFAULT_CAMERA_SETTINGS, distance: 270 }, options: { ballCamToggle: false, invertSwivelPitch: true } });
    for (const input of [old.cameraKbm, old.cameraPad]) {
      expect(input).toEqual({ freeLook: false, ballCamToggle: false, invertPitch: true, smoothing: true, accelRate: 5.8, decelRate: 10.8, freeLookSpeed: 2.5 });
    }
    expect(old.camera.distance).toBe(270);
    // (the old defaults, toggle and inversion on, where they weren't saved)
    const bare = parseSettings({ controller: { deadzone: 0.3 } });
    expect([bare.cameraKbm.ballCamToggle, bare.cameraKbm.invertPitch, bare.cameraKbm.freeLook]).toEqual([true, true, false]);
  });

  it("round-trips through storage", () => {
    const storage = new MemoryStorage();
    const custom = {
      ...DEFAULT_SETTINGS,
      bindings: { ...DEFAULT_BINDINGS, jump: { keyboard: { kind: "key", code: "Space" } as const, gamepad: null } },
      camera: { ...DEFAULT_SETTINGS.camera, fov: 110, distance: 260, stiffness: 0.45 },
      controller: { ...DEFAULT_SETTINGS.controller, deadzone: 0.15, aerialSensitivity: 1.4 },
      cameraKbm: { ...DEFAULT_SETTINGS.cameraKbm, freeLook: false, accelRate: 7.5 },
      cameraPad: { ...DEFAULT_SETTINGS.cameraPad, freeLook: true, invertPitch: true, freeLookSpeed: 4 },
      options: { ...DEFAULT_SETTINGS.options, rearCameraToggle: true, muted: true },
      audio: { master: 0.5, effects: 0.25, cars: 0, ambience: 1 },
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
      audio: { master: 3, effects: -1, cars: "loud" },
    });
    expect(s.camera.fov).toBe(110);
    expect(s.camera.height).toBe(DEFAULT_SETTINGS.camera.height);
    expect(s.camera.pitch).toBe(-15);
    expect(s.controller.deadzone).toBe(0);
    expect(s.controller.dodgeDeadzone).toBe(1);
    expect(s.controller.aerialSensitivity).toBe(1);
    expect(s.options.airPitchSafety).toBe(true);
    expect(s.options.rearCameraToggle).toBe(true);
    expect(s.audio).toEqual({ ...DEFAULT_SETTINGS.audio, master: 1, effects: 0 });
  });

  it("defaults are the game's profile defaults: a new profile's camera is the Modern preset", () => {
    expect(DEFAULT_SETTINGS.controller).toEqual({
      deadzone: 0.2,
      dodgeDeadzone: 0.8,
      steeringSensitivity: 1,
      aerialSensitivity: 1,
      freeLookDeadzone: 0.1,
      mouseSensitivity: 10,
    });
    expect(DEFAULT_SETTINGS.camera).toEqual({ ...DEFAULT_CAMERA_SETTINGS, distance: 290 });
    expect(DEFAULT_SETTINGS.cameraKbm).toEqual({
      freeLook: true,
      ballCamToggle: false,
      invertPitch: false,
      smoothing: true,
      accelRate: 10.8,
      decelRate: 10.8,
      freeLookSpeed: 2.5,
    });
    expect(DEFAULT_SETTINGS.cameraPad).toEqual({ ...MODERN_CAMERA_KBM, freeLook: false, ballCamToggle: true, accelRate: 5.8 });
    expect(MODERN_CAMERA_PAD).toEqual(DEFAULT_SETTINGS.cameraPad);
    expect(DEFAULT_SETTINGS.options).toEqual({
      rearCameraToggle: false,
      airPitchSafety: true,
      muted: false,
      flipIndicator: true,
      autoSkipReplay: false, // (ProfileGameplaySave bAutoSkipGoalReplay)
    });
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

  it("an action saved bindings don't know doesn't take an input they already use (left mouse saved as boost)", () => {
    const saved = Object.fromEntries(Object.entries(DEFAULT_BINDINGS).filter(([id]) => id !== "jumpAlternative"));
    const s = parseSettings({ bindings: { ...saved, boost: { keyboard: { kind: "mouse", button: 0 }, gamepad: null } } });
    expect(s.bindings.boost.keyboard).toEqual({ kind: "mouse", button: 0 });
    expect(s.bindings.jumpAlternative.keyboard).toBeNull();
    // With nothing saved, every default applies
    expect(parseSettings({}).bindings.jumpAlternative).toEqual(DEFAULT_BINDINGS.jumpAlternative);
  });

  it("bindings saved before the Modern controller layout keep air roll where they had it (X)", () => {
    const saved = { ...DEFAULT_BINDINGS, airRoll: { keyboard: { kind: "mouse", button: 2 }, gamepad: { kind: "padButton", button: 2 } } };
    const s = parseSettings({ bindings: saved });
    expect(s.bindings.airRoll.gamepad).toEqual({ kind: "padButton", button: 2 });
    expect(s.bindings.throttleReverse.gamepad).toEqual({ kind: "padButton", button: 6 });
    // A new player gets the game's: the left trigger on both
    expect(parseSettings({}).bindings.airRoll.gamepad).toEqual({ kind: "padButton", button: 6 });
  });

  it("treats non-objects as empty", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
  });
});
