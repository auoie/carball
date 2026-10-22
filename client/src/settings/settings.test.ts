import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "../input/bindings";
import { DEFAULT_CAMERA_SETTINGS } from "../camera/carballCamera";
import { DEFAULT_SETTINGS, MODERN_CAMERA_KBM, MODERN_CAMERA_PAD, loadSettings, parseSettings, resolveSettings, saveSettings, tidyName } from "./settings";
import { DEFAULT_SLOTS } from "../game/quickChat";

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
    broken.setItem("carball.settings.v1", "{not json");
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
      cameraShake: false, // (the Modern preset's: only the Default preset turns it on)
      airPitchSafety: true,
      muted: false,
      autoSkipReplay: false, // (ProfileGameplaySave bAutoSkipGoalReplay)
      unlimitedBoost: true, // (Unlimited boost in free play, on: MENU-9)
      bloom: true, // (the video options' High preset: PP-16)
      depthOfField: true,
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

  it("bindings saved before free play's last three commands take their defaults beside the scoreboard and quick chats (FP3)", () => {
    const saved = Object.fromEntries(Object.entries(DEFAULT_BINDINGS).filter(([id]) => !["passBall", "launchBall", "defendShot"].includes(id)));
    const s = parseSettings({ bindings: saved });
    // (LB the scoreboard's online, Defend Shot's in free play; 3 and 4 the quick chats' too)
    expect(s.bindings.defendShot).toEqual({ keyboard: { kind: "key", code: "Digit5" }, gamepad: { kind: "padButton", button: 4 } });
    expect(s.bindings.passBall).toEqual(DEFAULT_BINDINGS.passBall);
    expect(s.bindings.launchBall).toEqual(DEFAULT_BINDINGS.launchBall);
    expect(s.bindings.scoreboard.gamepad).toEqual({ kind: "padButton", button: 4 });
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

describe("chat settings (CHAT-5, 18)", () => {
  it("the filters and slots from saved data, each invalid one its default", () => {
    const slots = [...DEFAULT_SLOTS];
    slots[0] = "Group3Message5"; // ("No way!": in the match pool)
    slots[16] = "Group5Message3"; // ("That was fun!": post game, its pool)
    slots[20] = "Group1Message1"; // (not a pre-game preset: back to its default)
    const chat = parseSettings({ chat: { name: " Merc ", quickChatFilter: "team", blockNonTactical: true, slots } }).chat;
    expect(chat).toMatchObject({ name: "Merc", quickChatFilter: "team", blockNonTactical: true });
    expect([chat.slots[0], chat.slots[16], chat.slots[20]]).toEqual(["Group3Message5", "Group5Message3", DEFAULT_SLOTS[20]]);
    expect(parseSettings({ chat: { quickChatFilter: "loud", slots: "x" } }).chat).toEqual(DEFAULT_SETTINGS.chat);
  });

  it("a name: control characters out, trimmed, 32 bytes of whole characters at most", () => {
    expect(tidyName("  Ziggy\u0007 ")).toBe("Ziggy");
    expect(new TextEncoder().encode(tidyName("é".repeat(40))).byteLength).toBe(32);
    expect(tidyName(`${"a".repeat(30)}👍🏽`)).toBe("a".repeat(30)); // (the emoji whole or not at all)
    expect(tidyName(12)).toBe("");
  });

  it("a name loses its hidden characters: direction controls, zero-width ones, the BOM, fillers (RV-249)", () => {
    expect(tidyName("\u202Eziggy")).toBe("ziggy");
    expect(tidyName("\u2066Bo\u2069")).toBe("Bo");
    expect(tidyName("\u200B")).toBe("");
    expect(tidyName("\uFEFF")).toBe("");
    expect(tidyName("\u3164")).toBe("");
    expect(tidyName("a\u2028b")).toBe("ab");
  });

  it("saved bindings from before quick chat: its keys 1-4 though freeplay's use 1 and 2 (never active together)", () => {
    const saved = {
      bindings: {
        ballInFront: DEFAULT_BINDINGS.ballInFront,
        ballOnCar: DEFAULT_BINDINGS.ballOnCar,
        jump: { keyboard: { kind: "key", code: "Digit3" }, gamepad: null },
      },
    };
    const b = parseSettings(saved).bindings;
    expect([b.chatPreset1.keyboard, b.chatPreset2.keyboard]).toEqual([
      { kind: "key", code: "Digit1" },
      { kind: "key", code: "Digit2" },
    ]);
    expect(b.chatPreset3.keyboard).toBeNull(); // (a saved binding that drives the car keeps the key)
    expect(b.chatPreset4.keyboard).toEqual({ kind: "key", code: "Digit4" });
  });

  it("the Interface and Gameplay tabs: defaults, limits, unknown values back to the default (MENU-6/9)", () => {
    expect(DEFAULT_SETTINGS.interface).toMatchObject({
      scale: 1,
      displayScale: 1,
      nameplateMode: "default",
      matchNotifications: "all",
      teamColoredBoost: true,
      metric: true,
    });
    const parsed = parseSettings({
      interface: { scale: 0.2, displayScale: 0.95, nameplateMode: "huge", matchNotifications: "kickoff", hideHud: true },
      gameplay: { statDisplayLevel: "all" },
    });
    expect(parsed.interface).toMatchObject({
      scale: 0.5,
      displayScale: 0.95,
      nameplateMode: "default",
      matchNotifications: "kickoff",
      hideHud: true,
      ballCamIndicator: true,
      ballArrow: true,
    });
    expect(parsed.gameplay).toEqual({ statDisplayLevel: "all", flipResetIndicator: "on" });
    // (Stat Graphs: None by default, the game's ten options kept, anything else None)
    expect(DEFAULT_SETTINGS.interface.statGraphs).toBe("none");
    expect(parseSettings({ interface: { statGraphs: "networkLong" } }).interface.statGraphs).toBe("networkLong");
    expect(parseSettings({ interface: { statGraphs: "everything" } }).interface.statGraphs).toBe("none");
  });

  it("the old flip indicator checkbox, off, is Flip Reset Indicator Off", () => {
    expect(parseSettings({ options: { flipIndicator: false } }).gameplay.flipResetIndicator).toBe("off");
    expect(parseSettings({ options: { flipIndicator: true } }).gameplay.flipResetIndicator).toBe("on");
    expect(parseSettings({ options: { flipIndicator: false }, gameplay: { flipResetIndicator: "audio" } }).gameplay.flipResetIndicator).toBe("audio");
  });
});

describe("a save from before the video group (RV-495)", () => {
  it("keeps Bloom and Depth of Field turned off, on any GPU, as the player's own (Custom) choice", () => {
    for (const weak of [false, true]) {
      const s = resolveSettings(parseSettings({ options: { bloom: false } }), weak);
      expect([s.options.bloom, s.options.depthOfField]).toEqual([false, true]);
      expect(s.video).toMatchObject({ chosen: true, renderDetail: "custom" });
      expect(resolveSettings(parseSettings({ options: { depthOfField: false } }), weak).options.depthOfField).toBe(false);
    }
    // (both on, as the defaults: the automatic default still applies)
    expect(resolveSettings(parseSettings({ options: { bloom: true } }), true).video.chosen).toBe(false);
    // (a save with its video group: that group as saved, Bloom off or not, RV-529's CM35)
    const saved = parseSettings({ options: { bloom: false }, video: { renderDetail: "performance", chosen: false } });
    expect(saved.video).toMatchObject({ renderDetail: "performance", chosen: false });
  });
});
