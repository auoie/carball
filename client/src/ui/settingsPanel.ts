// Settings menu (from the pause menu or the main menu): rebind controls, camera settings, controller settings, audio. Changes apply at once
// and are saved in the browser.
import type { CameraSettings } from "../camera/rlCamera";
import { ACTIONS, type Action, type GamepadInput, type KeyboardInput, inputName } from "../input/bindings";
import { readGamepad } from "../input/devices";
import {
  AUDIO_LIMITS,
  type AudioSettings,
  CAMERA_LIMITS,
  type ChatSettings,
  CONTROLLER_LIMITS,
  type ControllerSettings,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_PRESET,
  DEFAULT_SCOREBOARD_SETTINGS,
  DEFAULT_SETTINGS,
  INPUT_CAMERA_LIMITS,
  type InputCameraSettings,
  MODERN_PRESET,
  type Options,
  PRESET_CAMERA_SHAKE,
  type Range,
  type Settings,
  saveSettings,
  slotPool,
  tidyName,
  INTERFACE_LIMITS,
  type InterfaceSettings,
  type GameplaySettings,
} from "../settings/settings";
import { presetText } from "../game/quickChat";
import { SCOREBOARD_COLUMNS } from "../game/matchStats";

type Tab = "controls" | "camera" | "controller" | "gameplay" | "interface" | "scoreboard" | "chat" | "video" | "audio";

/** The Gameplay tab's lists (verbatim, the game's settings labels: MENU-9) */
const GAMEPLAY_TEXT = {
  statDisplayLevel: "Game Stat Display Level",
  statLevels: { none: "No Stats", primary: "Main Stats Only", all: "All Stats" },
  flipResetIndicator: "Flip Reset Indicator",
  flipModes: { off: "Off", audio: "Audio Only", visual: "Visuals Only", on: "On" },
} as const;

/** The Interface tab's text (verbatim, the game's settings labels: MENU-6) */
const INTERFACE_TEXT = {
  scale: "Interface Scale",
  displayScale: "Display Scale",
  nameplateScale: "Nameplate Scale",
  nameplateMode: "Nameplate Mode",
  nameplateModes: { distanceFade: "Nearby Only", default: "Default", simplified: "Simplified" },
  matchNotifications: "Match Notifications",
  notifications: { all: "All", gameUpdates: "Time Updates Only", kickoff: "Kickoffs Only" },
  teamColoredBoost: "Team-Colored Boost Meter",
  metric: "Metric",
  ballCamIndicator: "Ball Cam Indicator",
  ballArrow: "Ball Arrow",
  hideHud: "Hide In-Game HUD",
} as const;

/** The chat settings' text (verbatim: notes/quick-chat.md "Chat UI text") */
const CHAT_SETTINGS_TEXT = {
  quickChat: "Quick Chat",
  quickChatDescription: "Controls what types of Quick Chat messages from other players are visible.",
  filters: { everyone: "Allow Quick Chat with Everyone", team: "Allow Quick Chat with Teammates Only", friends: "Allow Quick Chat with Friends Only", off: "Off" },
  blockNonTactical: "Block Non-Tactical Quick Chat",
  blockNonTacticalDescription: "Hides incoming non-tactical Quick Chat messages from other players during a match. Does not filter out Pre-game or Post-game Quick Chat.",
  rows: ["Information (Team)", "Compliments", "Reactions", "Apologies", "Post Game", "Pre Game"],
} as const;
type Device = "keyboard" | "gamepad";

const CAMERA_LABELS: Readonly<Record<keyof CameraSettings, string>> = {
  fov: "Field of view",
  distance: "Distance",
  height: "Height",
  pitch: "Angle",
  stiffness: "Stiffness",
  swivelSpeed: "Swivel speed",
  transitionSpeed: "Transition speed",
};

const CONTROLLER_LABELS: Readonly<Record<keyof ControllerSettings, string>> = {
  deadzone: "Controller deadzone",
  dodgeDeadzone: "Dodge deadzone",
  steeringSensitivity: "Steering sensitivity",
  freeLookDeadzone: "Free look deadzone (the stick past the deadzone above)",
  mouseSensitivity: "Mouse sensitivity (free look)",
  aerialSensitivity: "Aerial sensitivity",
};

const INPUT_CAMERA_LABELS: Readonly<Record<keyof InputCameraSettings, string>> = {
  freeLook: "Free look (the view turns only with the look input; no swivel)",
  ballCamToggle: "Ball camera toggles (off: hold)",
  invertPitch: "Invert look pitch",
  smoothing: "Free look smoothing",
  accelRate: "Free look acceleration",
  decelRate: "Free look deceleration",
  freeLookSpeed: "Free look speed",
};

const OPTION_LABELS: Readonly<Record<keyof Options, string>> = {
  rearCameraToggle: "Rear camera toggles (off: hold)",
  cameraShake: "Camera shake (goals, demolitions, pickups, jumps; the Default preset's, off with Modern)",
  airPitchSafety: "Air pitch safety (keyboard: holding W off the ground doesn't pitch until released)",
  muted: "Mute all sound (M)",
  autoSkipReplay: "Skip Goal Replay: Automatically votes to skip the goal replay.", // ([AutoSkipGoalReplay] Label, Description)
  bloom: "Bloom (a glow round the brightest parts)",
  depthOfField: "Depth of Field",
  unlimitedBoost: "Unlimited boost in free play (off: 33 boost each round, used up as you boost, and pads to pick up; a full tank takes none)",
};

const AUDIO_LABELS: Readonly<Record<keyof AudioSettings, string>> = {
  master: "Master volume",
  effects: "Effects (hits, jumps, pickups, goals)",
  cars: "Cars (engines, boost)",
  ambience: "Ambience",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: readonly Node[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

export class SettingsPanel {
  readonly #root: HTMLElement;
  readonly #body: HTMLElement;
  /** Called as it closes (the pause menu under it comes back) */
  onClose: () => void = () => undefined;
  #settings: Settings;
  #tab: Tab = "controls";
  #capture: { action: Action; device: Device; cancel: () => void } | null = null;

  constructor(
    host: HTMLElement,
    initial: Settings,
    private readonly onChange: (settings: Settings) => void,
  ) {
    this.#settings = initial;
    this.#body = el("div", { className: "settings-body" });
    const tabs = el("div", { className: "settings-tabs" }, [
      this.#tabButton("controls", "Controls"),
      this.#tabButton("camera", "Camera"),
      this.#tabButton("controller", "Controller"),
      this.#tabButton("gameplay", "Gameplay"),
      this.#tabButton("interface", "Interface"),
      this.#tabButton("scoreboard", "Scoreboard"),
      this.#tabButton("chat", "Chat"),
      this.#tabButton("video", "Video"),
      this.#tabButton("audio", "Audio"),
    ]);
    const close = el("button", { className: "settings-close", textContent: "Close (Esc)" });
    close.addEventListener("click", () => { this.close(); });
    this.#root = el("div", { className: "settings" }, [el("div", { className: "settings-header" }, [el("h2", { textContent: "Settings" }), tabs, close]), this.#body]);
    this.#root.id = "settings";
    this.#root.hidden = true;
    host.append(this.#root);
  }

  /** Escape while it's open: a rebind's capture ends, else it closes */
  escape(): void {
    if (this.#capture) this.#stopCapture();
    else this.close();
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  get settings(): Settings {
    return this.#settings;
  }

  open(): void {
    // (the free look's captured mouse is let go: the menu needs the pointer)
    if (document.pointerLockElement) document.exitPointerLock();
    this.#root.hidden = false;
    this.#render();
  }

  close(): void {
    this.#stopCapture();
    const was = this.isOpen;
    this.#root.hidden = true;
    if (was) this.onClose();
  }

  /** Changes settings from outside the menu (a shortcut key): saved and applied like any change in it. */
  apply(next: Settings): void {
    this.#update(next);
  }

  #update(next: Settings): void {
    this.#settings = next;
    saveSettings(next);
    this.onChange(next);
    this.#render();
  }

  #tabButton(tab: Tab, label: string): HTMLButtonElement {
    const b = el("button", { className: "settings-tab", textContent: label });
    b.dataset["tab"] = tab;
    b.addEventListener("click", () => {
      this.#stopCapture();
      this.#tab = tab;
      this.#render();
    });
    return b;
  }

  #render(): void {
    for (const b of this.#root.querySelectorAll<HTMLButtonElement>(".settings-tab")) {
      b.classList.toggle("active", b.dataset["tab"] === this.#tab);
    }
    const content =
      this.#tab === "controls"
        ? this.#controls()
        : this.#tab === "camera"
          ? this.#cameraTab()
          : this.#tab === "controller"
            ? this.#controllerTab()
            : this.#tab === "gameplay"
              ? this.#gameplayTab()
              : this.#tab === "interface"
                ? this.#interfaceTab()
                : this.#tab === "scoreboard"
                ? this.#scoreboardTab()
                : this.#tab === "chat"
                  ? this.#chatTab()
                  : this.#tab === "video"
                    ? this.#videoTab()
                    : this.#audioTab();
    this.#body.replaceChildren(content);
  }

  // --- controls ---

  #controls(): HTMLElement {
    const table = el("table", { className: "bindings" });
    table.append(el("tr", {}, [el("th", { textContent: "Action" }), el("th", { textContent: "Keyboard & mouse" }), el("th", { textContent: "Gamepad" })]));
    let group = "";
    for (const action of ACTIONS) {
      if (action.group !== group) {
        group = action.group;
        const header = el("td", { className: "group", textContent: group });
        header.colSpan = 3;
        table.append(el("tr", {}, [header]));
      }
      const binding = this.#settings.bindings[action.id];
      table.append(
        el("tr", {}, [
          el("td", { textContent: action.label }),
          el("td", {}, [this.#slot(action.id, "keyboard", binding.keyboard)]),
          el("td", {}, [this.#slot(action.id, "gamepad", binding.gamepad)]),
        ]),
      );
    }
    const reset = el("button", { textContent: "Reset controls to defaults" });
    reset.addEventListener("click", () => {
      this.#update({ ...this.#settings, bindings: DEFAULT_SETTINGS.bindings });
    });
    const hint = el("p", {
      className: "settings-hint",
      textContent: "Click a slot, then press a key, click a mouse button, or press/move a gamepad input. Right-click a slot to clear it. Esc cancels.",
    });
    return el("div", {}, [hint, table, reset]);
  }

  #slot(action: Action, device: Device, input: KeyboardInput | GamepadInput | null): HTMLButtonElement {
    const capturing = this.#capture?.action === action && this.#capture.device === device;
    const b = el("button", {
      className: `binding-slot${capturing ? " capturing" : ""}${input === null ? " empty" : ""}`,
      textContent: capturing ? (device === "keyboard" ? "Press a key or mouse button…" : "Press or move a gamepad input…") : inputName(input),
    });
    b.dataset["action"] = action;
    b.dataset["device"] = device;
    b.addEventListener("click", (e) => {
      if (capturing) return; // the click itself is not the binding
      e.stopPropagation();
      this.#startCapture(action, device);
    });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!capturing) this.#setBinding(action, device, null);
    });
    return b;
  }

  #setBinding(action: Action, device: Device, input: KeyboardInput | GamepadInput | null): void {
    const current = this.#settings.bindings[action];
    const binding =
      device === "keyboard"
        ? { ...current, keyboard: input as KeyboardInput | null }
        : { ...current, gamepad: input as GamepadInput | null };
    this.#update({ ...this.#settings, bindings: { ...this.#settings.bindings, [action]: binding } });
  }

  #startCapture(action: Action, device: Device): void {
    this.#stopCapture();
    const abort = new AbortController();
    let frame = 0;
    const finish = (input: KeyboardInput | GamepadInput): void => {
      this.#stopCapture();
      this.#setBinding(action, device, input);
    };

    if (device === "keyboard") {
      window.addEventListener(
        "keydown",
        (e) => {
          if (e.code === "Escape") return; // handled by the Escape listener (cancel)
          e.preventDefault();
          e.stopPropagation();
          finish({ kind: "key", code: e.code });
        },
        { capture: true, signal: abort.signal },
      );
      // Mouse buttons: wait one frame so the click that started capturing isn't taken
      requestAnimationFrame(() => {
        window.addEventListener(
          "mousedown",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            finish({ kind: "mouse", button: e.button });
          },
          { capture: true, signal: abort.signal },
        );
        window.addEventListener("contextmenu", (e) => { e.preventDefault(); }, { capture: true, signal: abort.signal });
      });
    } else {
      // Gamepad: wait until everything is released, then take the first button or stick direction
      let released = false;
      const poll = (): void => {
        const pad = readGamepad();
        if (pad) {
          const pressed = pad.buttons.findIndex((v) => v > 0.5);
          const moved = pad.axes.findIndex((v) => Math.abs(v) > 0.6);
          if (!released) {
            released = pressed < 0 && moved < 0;
          } else if (pressed >= 0) {
            finish({ kind: "padButton", button: pressed });
            return;
          } else if (moved >= 0) {
            finish({ kind: "padAxis", axis: moved, sign: (pad.axes[moved] ?? 0) > 0 ? 1 : -1 });
            return;
          }
        }
        frame = requestAnimationFrame(poll);
      };
      frame = requestAnimationFrame(poll);
    }

    this.#capture = {
      action,
      device,
      cancel: () => {
        abort.abort();
        cancelAnimationFrame(frame);
      },
    };
    this.#render();
  }

  #stopCapture(): void {
    if (!this.#capture) return;
    this.#capture.cancel();
    this.#capture = null;
    this.#render();
  }

  // --- sliders ---

  #cameraTab(): HTMLElement {
    const sliders = this.#sliders(
      this.#settings.camera,
      CAMERA_LIMITS,
      CAMERA_LABELS,
      (camera) => { this.#update({ ...this.#settings, camera }); },
      DEFAULT_SETTINGS.camera,
    );
    sliders.append(this.#checkboxes(["rearCameraToggle", "cameraShake"]));
    const presets = el("div", { className: "options" });
    for (const [name, preset] of [["Modern", MODERN_PRESET], ["Default", DEFAULT_PRESET]] as const) {
      const button = el("button", { textContent: `${name} preset` });
      button.dataset["preset"] = name.toLowerCase();
      const shake = name === "Modern" ? PRESET_CAMERA_SHAKE.modern : PRESET_CAMERA_SHAKE.default;
      button.addEventListener("click", () => {
        this.#update({ ...this.#settings, ...preset, options: { ...this.#settings.options, cameraShake: shake } });
      });
      presets.append(button);
    }
    sliders.prepend(
      el("p", {
        className: "settings-hint",
        textContent:
          "Modern (the game's for a new profile): free look with the mouse on keyboard and mouse, the ball camera held; the controller swivels, " +
          "the ball camera toggles. Default: swivel and toggle on both. Each input keeps its own camera settings below.",
      }),
      presets,
    );
    sliders.append(this.#inputCamera("cameraKbm", "Keyboard and mouse"), this.#inputCamera("cameraPad", "Controller"));
    return sliders;
  }

  /** One input's camera settings (ProfileCameraInputSettings) */
  #inputCamera(key: "cameraKbm" | "cameraPad", title: string): HTMLElement {
    const current = this.#settings[key];
    const apply = (next: InputCameraSettings): void => { this.#update({ ...this.#settings, [key]: next }); };
    const box = el("div", { className: "options" });
    for (const option of ["freeLook", "ballCamToggle", "invertPitch", "smoothing"] as const) {
      const input = el("input");
      input.type = "checkbox";
      input.checked = current[option];
      input.dataset["camera"] = key;
      input.dataset["option"] = option;
      input.addEventListener("change", () => { apply({ ...current, [option]: input.checked }); });
      box.append(el("label", { className: "option" }, [input, el("span", { textContent: INPUT_CAMERA_LABELS[option] })]));
    }
    const numbers = (c: InputCameraSettings) => ({ accelRate: c.accelRate, decelRate: c.decelRate, freeLookSpeed: c.freeLookSpeed });
    const sliders = this.#sliders(
      numbers(current),
      INPUT_CAMERA_LIMITS,
      INPUT_CAMERA_LABELS,
      (next) => { apply({ ...current, ...next }); },
      numbers(DEFAULT_SETTINGS[key]),
    );
    return el("div", { className: "input-camera" }, [el("h3", { textContent: title }), box, sliders]);
  }

  #controllerTab(): HTMLElement {
    const sliders = this.#sliders(
      this.#settings.controller,
      CONTROLLER_LIMITS,
      CONTROLLER_LABELS,
      (controller) => { this.#update({ ...this.#settings, controller }); },
      DEFAULT_SETTINGS.controller,
    );
    sliders.prepend(
      el("p", {
        className: "settings-hint",
        textContent:
          "The deadzone applies to each stick axis on its own. Sensitivity scales the input, then clamps it; at 10 any input is full input. " +
          "Dodge deadzone: how far the stick must be pushed for a second jump to dodge instead of double jumping.",
      }),
    );
    sliders.append(this.#checkboxes(["airPitchSafety"]));
    return sliders;
  }

  /** The game's Gameplay settings (MENU-9): the flip indicator, goal replays, free play's boost */
  #gameplayTab(): HTMLElement {
    // (the game's row labels upper-cased, its values as written: HT-5, RV-281)
    const box = el("div", { className: "sliders caps-labels" });
    const gameplay = this.#settings.gameplay;
    const apply = (next: Partial<GameplaySettings>): void => {
      this.#update({ ...this.#settings, gameplay: { ...this.#settings.gameplay, ...next } });
    };
    const T = GAMEPLAY_TEXT;
    const select = <K extends keyof GameplaySettings>(key: K, label: string, options: Readonly<Record<GameplaySettings[K], string>>): HTMLElement => {
      const input = el("select");
      input.dataset["setting"] = key;
      for (const [value, text] of Object.entries(options) as [GameplaySettings[K], string][]) {
        input.append(el("option", { value, textContent: text, selected: value === gameplay[key] }));
      }
      input.addEventListener("change", () => {
        if (input.value in options) apply({ [key]: input.value });
      });
      return el("label", { className: "option" }, [el("span", { textContent: label }), input]);
    };
    // (the game's creation order: free play's unlimited boost first, the goal replay's skip last: HT-5, RV-281)
    box.append(
      this.#checkboxes(["unlimitedBoost"]),
      select("statDisplayLevel", T.statDisplayLevel, T.statLevels),
      select("flipResetIndicator", T.flipResetIndicator, T.flipModes),
      this.#checkboxes(["autoSkipReplay"]),
    );
    return box;
  }

  /** Interface: the HUD's scales, the nameplates, which messages show, the boost meter's colours, units, the ball-cam
   *  indicator, hiding the HUD */
  #interfaceTab(): HTMLElement {
    const T = INTERFACE_TEXT;
    const ui = this.#settings.interface;
    const apply = (next: Partial<InterfaceSettings>): void => {
      this.#update({ ...this.#settings, interface: { ...this.#settings.interface, ...next } });
    };
    const d = DEFAULT_SETTINGS.interface;
    const box = this.#sliders(
      { scale: ui.scale, displayScale: ui.displayScale, nameplateScale: ui.nameplateScale },
      INTERFACE_LIMITS,
      { scale: T.scale, displayScale: T.displayScale, nameplateScale: T.nameplateScale },
      (next) => { apply(next); },
      { scale: d.scale, displayScale: d.displayScale, nameplateScale: d.nameplateScale },
      true,
    );
    box.classList.add("caps-labels"); // (HT-5, RV-281)
    const reset = box.lastElementChild;
    const select = <K extends "nameplateMode" | "matchNotifications">(key: K, label: string, options: Readonly<Record<InterfaceSettings[K], string>>): HTMLElement => {
      const input = el("select");
      input.dataset["setting"] = key;
      for (const [value, text] of Object.entries(options) as [InterfaceSettings[K], string][]) {
        input.append(el("option", { value, textContent: text, selected: value === ui[key] }));
      }
      input.addEventListener("change", () => {
        const value = input.value;
        if (value in options) apply({ [key]: value });
      });
      return el("label", { className: "option" }, [el("span", { textContent: label }), input]);
    };
    const options = el("div", { className: "options" });
    for (const key of ["teamColoredBoost", "metric", "ballCamIndicator", "ballArrow", "hideHud"] as const) {
      const input = el("input", { type: "checkbox", checked: ui[key] });
      input.dataset["setting"] = key;
      input.addEventListener("change", () => {
        apply({ [key]: input.checked });
      });
      options.append(el("label", { className: "option" }, [input, el("span", { textContent: T[key] })]));
    }
    const extra = [select("nameplateMode", T.nameplateMode, T.nameplateModes), select("matchNotifications", T.matchNotifications, T.notifications), options];
    if (reset) reset.before(...extra);
    else box.append(...extra);
    return box;
  }

  /** Chat (online): the player's name, the quick-chat filters, the 24 quick-chat slots by category */
  #chatTab(): HTMLElement {
    const T = CHAT_SETTINGS_TEXT;
    const chat = this.#settings.chat;
    const apply = (next: Partial<ChatSettings>): void => {
      this.#update({ ...this.#settings, chat: { ...this.#settings.chat, ...next } });
    };
    const box = el("div", { className: "sliders chat-settings" });
    const name = el("input", { type: "text", value: chat.name, placeholder: "Player", maxLength: 32 });
    name.dataset["setting"] = "name";
    name.addEventListener("change", () => {
      apply({ name: tidyName(name.value) });
    });
    box.append(el("label", { className: "option" }, [el("span", { textContent: "Name (when you next join)" }), name]));
    const filter = el("select");
    filter.dataset["setting"] = "quickChatFilter";
    for (const [value, label] of Object.entries(T.filters)) filter.append(el("option", { value, textContent: label, selected: value === chat.quickChatFilter }));
    filter.addEventListener("change", () => {
      const value = filter.value;
      if (value === "everyone" || value === "team" || value === "friends" || value === "off") apply({ quickChatFilter: value });
    });
    box.append(el("label", { className: "option", title: T.quickChatDescription }, [el("span", { textContent: T.quickChat }), filter]));
    const block = el("input", { type: "checkbox", checked: chat.blockNonTactical });
    block.dataset["setting"] = "blockNonTactical";
    block.addEventListener("change", () => {
      apply({ blockNonTactical: block.checked });
    });
    box.append(el("label", { className: "option", title: T.blockNonTacticalDescription }, [block, el("span", { textContent: T.blockNonTactical })]));
    const slots = el("table", { className: "chat-slots" });
    T.rows.forEach((title, row) => {
      const cells = [0, 1, 2, 3].map((k) => {
        const slot = 4 * row + k;
        const select = el("select");
        select.dataset["slot"] = String(slot);
        // (sorted by their text, as the game's SortQuickChat: RV-256)
        const keys = slotPool(slot).toSorted((a, b) => presetText(a).localeCompare(presetText(b)));
        for (const key of keys) select.append(el("option", { value: key, textContent: presetText(key), selected: key === chat.slots[slot] }));
        select.addEventListener("change", () => {
          apply({ slots: this.#settings.chat.slots.map((s, i) => (i === slot ? select.value : s)) });
        });
        return el("td", {}, [select]);
      });
      slots.append(el("tr", {}, [el("th", { textContent: title }), ...cells]));
    });
    box.append(slots);
    const reset = el("button", { className: "settings-reset", textContent: "Reset quick chat to defaults" });
    reset.dataset["reset"] = "slots";
    reset.addEventListener("click", () => {
      apply({ slots: DEFAULT_CHAT_SETTINGS.slots });
    });
    box.append(reset);
    return box;
  }

  /** The scoreboard's four columns after SCORE (Soccar: SB-17), each from the columns this clone counts, sorted by
   *  label; a reset to the defaults */
  #scoreboardTab(): HTMLElement {
    const columns = this.#settings.scoreboard.columns;
    const box = el("div", { className: "sliders scoreboard-settings" });
    box.append(el("h3", { textContent: "Soccar" }));
    columns.forEach((current, i) => {
      const select = el("select");
      select.dataset["column"] = String(i);
      for (const c of SCOREBOARD_COLUMNS) select.append(el("option", { value: c.id, textContent: c.label, selected: c.id === current }));
      select.addEventListener("change", () => {
        this.#update({ ...this.#settings, scoreboard: { columns: this.#settings.scoreboard.columns.map((c, k) => (k === i ? select.value : c)) } });
      });
      box.append(el("label", { className: "option" }, [el("span", { textContent: `Column ${String(i + 1)}` }), select]));
    });
    const reset = el("button", { className: "settings-reset", textContent: "Reset to defaults" });
    reset.dataset["reset"] = "scoreboard";
    reset.addEventListener("click", () => {
      this.#update({ ...this.#settings, scoreboard: DEFAULT_SCOREBOARD_SETTINGS });
    });
    box.append(reset);
    return box;
  }

  #videoTab(): HTMLElement {
    const box = el("div", { className: "sliders" }, [
      el("p", {
        className: "settings-hint",
        textContent: "The game's post-processing: its tone map always, these on in its High preset (the default). Depth of Field softens the whole arena a little (a quarter of every pixel), the sky and far stands more.",
      }),
    ]);
    box.append(this.#checkboxes(["bloom", "depthOfField"]));
    return box;
  }

  #audioTab(): HTMLElement {
    const sliders = this.#sliders(
      this.#settings.audio,
      AUDIO_LIMITS,
      AUDIO_LABELS,
      (audio) => { this.#update({ ...this.#settings, audio }); },
      DEFAULT_SETTINGS.audio,
    );
    sliders.prepend(
      el("p", {
        className: "settings-hint",
        textContent: "Every sound is made in the browser as you play. The ambience is the arena theme's own soundscape.",
      }),
    );
    sliders.append(this.#checkboxes(["muted"]));
    return sliders;
  }

  #checkboxes(keys: readonly (keyof Options)[]): HTMLElement {
    const box = el("div", { className: "options" });
    for (const key of keys) {
      const input = el("input");
      input.type = "checkbox";
      input.checked = this.#settings.options[key];
      input.dataset["option"] = key;
      input.addEventListener("change", () => {
        this.#update({ ...this.#settings, options: { ...this.#settings.options, [key]: input.checked } });
      });
      box.append(el("label", { className: "option" }, [input, el("span", { textContent: OPTION_LABELS[key] })]));
    }
    return box;
  }

  #sliders<T extends object>(
    values: T,
    limits: Readonly<Record<keyof T, Range>>,
    labels: Readonly<Record<keyof T, string>>,
    apply: (next: T) => void,
    defaults: T,
    percent = false,
  ): HTMLElement {
    const rows = el("div", { className: "sliders" });
    for (const key of Object.keys(limits) as (keyof T & string)[]) {
      const range = limits[key];
      const value = values[key] as number;
      const input = el("input");
      input.type = "range";
      input.min = String(range.min);
      input.max = String(range.max);
      input.step = String(range.step);
      input.value = String(value);
      input.dataset["setting"] = key;
      // (the game's percentage readout: round(v x 100) "%", HT-5)
      const shown = (v: number): string => (percent ? `${String(Math.round(v * 100))}%` : formatNumber(v, range.step));
      const output = el("output", { textContent: shown(value) });
      input.addEventListener("input", () => {
        output.textContent = shown(Number(input.value));
      });
      input.addEventListener("change", () => {
        apply({ ...values, [key]: Number(input.value) });
      });
      rows.append(el("label", { className: "slider" }, [el("span", { textContent: labels[key] }), input, output]));
    }
    const reset = el("button", { textContent: "Reset to defaults" });
    reset.addEventListener("click", () => { apply(defaults); });
    rows.append(reset);
    return rows;
  }
}

function formatNumber(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals);
}
