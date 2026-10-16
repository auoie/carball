// The settings' X Default (MENU-14, RV-474): a tab's every setting back to its default, nothing else changed
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../settings/settings";
import { pageDefaults } from "./settingsPanel";

describe("a settings page reset to its defaults (the pad's X Default)", () => {
  // (every setting changed from its default)
  const changed: Settings = {
    ...DEFAULT_SETTINGS,
    camera: { ...DEFAULT_SETTINGS.camera, fov: 105 },
    cameraKbm: { ...DEFAULT_SETTINGS.cameraKbm, freeLook: !DEFAULT_SETTINGS.cameraKbm.freeLook },
    controller: { ...DEFAULT_SETTINGS.controller, deadzone: 0.5 },
    options: { ...DEFAULT_SETTINGS.options, cameraShake: true, muted: true, bloom: false, unlimitedBoost: false, airPitchSafety: false },
    audio: { ...DEFAULT_SETTINGS.audio, master: 0.3 },
    interface: { ...DEFAULT_SETTINGS.interface, nameplateMode: "hidden" as never, scale: 1.2 },
    chat: { ...DEFAULT_SETTINGS.chat, name: "Me", quickChatFilter: "off" },
  };

  it("all of the page's own settings, its checkboxes and lists too, the others as they were", () => {
    const camera = pageDefaults("camera", changed);
    expect(camera.camera).toEqual(DEFAULT_SETTINGS.camera);
    expect(camera.cameraKbm).toEqual(DEFAULT_SETTINGS.cameraKbm);
    expect(camera.options.cameraShake).toBe(DEFAULT_SETTINGS.options.cameraShake);
    expect(camera.options.muted).toBe(true);
    expect(camera.controller.deadzone).toBe(0.5);
    const ui = pageDefaults("interface", changed);
    expect(ui.interface).toEqual(DEFAULT_SETTINGS.interface);
    const audio = pageDefaults("audio", changed);
    expect([audio.audio, audio.options.muted]).toEqual([DEFAULT_SETTINGS.audio, DEFAULT_SETTINGS.options.muted]);
    const video = pageDefaults("video", changed);
    expect(video.options.bloom).toBe(DEFAULT_SETTINGS.options.bloom);
    expect(video.options.muted).toBe(true);
    // (the player's choice and the guard's step undone: the automatic default again, RV-499)
    const chosen = pageDefaults("video", { ...changed, video: { ...DEFAULT_SETTINGS.video, chosen: true, stepped: true, autoLevel: 2, renderDetail: "custom" } });
    expect(chosen.video).toEqual(DEFAULT_SETTINGS.video);
    expect([chosen.video.chosen, chosen.video.stepped, chosen.video.autoLevel]).toEqual([false, false, 0]);
    const gameplay = pageDefaults("gameplay", changed);
    expect(gameplay.options.unlimitedBoost).toBe(DEFAULT_SETTINGS.options.unlimitedBoost);
    const controller = pageDefaults("controller", changed);
    expect([controller.controller, controller.options.airPitchSafety]).toEqual([DEFAULT_SETTINGS.controller, DEFAULT_SETTINGS.options.airPitchSafety]);
  });

  it("the chat's filters and slots, the player's name kept", () => {
    const chat = pageDefaults("chat", changed);
    expect(chat.chat).toEqual({ ...DEFAULT_SETTINGS.chat, name: "Me" });
  });
});
