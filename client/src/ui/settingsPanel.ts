// Settings menu (from the pause menu or the main menu): rebind controls, camera settings, controller settings, audio. Changes apply at once
// and are saved in the browser.
import type { CameraSettings } from "../camera/carballCamera";
import { ACTIONS, type Action, type GamepadInput, type KeyboardInput, inputName, onPadStyle } from "../input/bindings";
import { glyphElement, keyGlyph } from "./keyGlyph";
import { checkbox, cycler, cyclerControl, slider } from "./controls";
import { VIDEO_TEXT, type VideoState, withRenderDetail, withVideoChange } from "../settings/video";
import { END_TEXT } from "../game/matchSequence";

/** The pad's X Default asks first (MENU-14: a confirm, NO focused): our words, the game's YES / NO */
export const DEFAULT_QUESTION = "Reset this page to its defaults?";
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
import { TRAINING_DEFAULTS, TRAINING_LIMITS, TRAINING_SETTINGS_TEXT, type TrainingNumbers, type TrainingSettings } from "../training/settings";

type Tab = "controls" | "camera" | "controller" | "gameplay" | "training" | "interface" | "scoreboard" | "chat" | "video" | "audio";

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
  statGraphs: "Stat Graphs",
  statGraphOptions: {
    none: "None",
    performanceSummary: "Performance Summary",
    performanceShort: "Performance Graph (short)",
    performanceLong: "Performance Graph (long)",
    networkSummary: "Network Summary",
    networkShort: "Network Graph (short)",
    networkLong: "Network Graph (long)",
    speedSummary: "Speed Summary",
    speedShort: "Speed Graph (short)",
    speedLong: "Speed Graph (long)",
  },
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
  /** The pad's X Default's question over the page (YES resets it, NO or B leaves it) */
  readonly #confirm: HTMLElement;
  /** The bumpers' glyphs at the tab strip's ends (the pad's mode only) */
  readonly #tabGlyphs: readonly [HTMLElement, HTMLElement];

  constructor(
    host: HTMLElement,
    initial: Settings,
    private readonly onChange: (settings: Settings) => void,
    /** The settings as they apply (the video settings' automatic default: main.ts), after each change */
    private readonly resolve: (settings: Settings) => Settings = (s) => s,
  ) {
    this.#settings = initial;
    this.#body = el("div", { className: "settings-body" });
    const tabs = el("div", { className: "settings-tabs" }, [
      this.#tabButton("controls", "Controls"),
      this.#tabButton("camera", "Camera"),
      this.#tabButton("controller", "Controller"),
      this.#tabButton("gameplay", "Gameplay"),
      this.#tabButton("training", "Training"),
      this.#tabButton("interface", "Interface"),
      this.#tabButton("scoreboard", "Scoreboard"),
      this.#tabButton("chat", "Chat"),
      this.#tabButton("video", "Video"),
      this.#tabButton("audio", "Audio"),
    ]);
    // (a pad's bumpers switch the tabs, stopping at the first and last: the list isn't in its rows, nor Close (B and Start
    // close))
    tabs.dataset["padTabs"] = "";
    tabs.dataset["padSkip"] = "";
    const close = el("button", { className: "settings-close", textContent: "Close (Esc)" });
    close.dataset["padSkip"] = "";
    close.addEventListener("click", () => { this.close(); });
    // (the pad's X Default asks first: YES runs the page's own reset, NO (focused) leaves it)
    const yes = el("button", { textContent: END_TEXT.yes });
    const no = el("button", { textContent: END_TEXT.no });
    no.dataset["padDefault"] = "";
    this.#confirm = el("div", { className: "settings-confirm" }, [el("div", { className: "settings-confirm-box" }, [el("p", { textContent: DEFAULT_QUESTION }), el("div", { className: "settings-confirm-buttons" }, [yes, no])])]);
    this.#confirm.id = "settings-confirm";
    this.#confirm.hidden = true;
    yes.addEventListener("click", () => {
      this.#confirm.hidden = true;
      this.#update(pageDefaults(this.#tab, this.#settings));
    });
    no.addEventListener("click", () => {
      this.#confirm.hidden = true;
    });
    this.#tabGlyphs = [el("span", { className: "settings-tab-glyph" }), el("span", { className: "settings-tab-glyph" })];
    this.#root = el("div", { className: "settings" }, [
      el("div", { className: "settings-header" }, [el("h2", { textContent: "Settings" }), this.#tabGlyphs[0], tabs, this.#tabGlyphs[1], close]),
      this.#body,
      this.#confirm,
    ]);
    this.#root.id = "settings";
    // (a dialog over the menus: named, modal, Tab kept inside it: RV-482)
    this.#root.setAttribute("role", "dialog");
    this.#root.setAttribute("aria-modal", "true");
    this.#root.setAttribute("aria-label", "Settings");
    this.#root.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusable = [...this.#root.querySelectorAll<HTMLElement>("button, [tabindex='0'], input")].filter((f) => !f.closest("[hidden]") && f.getClientRects().length > 0);
      const [first, last] = [focusable[0], focusable.at(-1)];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    // (B Back in the pad's hints: a level over the menu it opened from; the hints under the panel)
    this.#root.dataset["padBack"] = "";
    this.#root.dataset["padHintsUnder"] = "";
    this.#root.hidden = true;
    // (NO focused each time it's asked, never where the last answer was: RV-473)
    this.#root.addEventListener("pad-default", () => {
      this.#confirm.hidden = false;
      no.focus();
    });
    host.append(this.#root);
    // (the pad's names in its family's: a pad seen after the panel drew them, or another plugged in)
    onPadStyle(() => {
      if (this.isOpen) this.#render();
    });
  }

  /** Escape while it's open: a rebind's capture ends, else the Default question goes, else it closes */
  escape(): void {
    if (this.#capture) this.#stopCapture();
    else if (!this.#confirm.hidden) this.#confirm.hidden = true;
    else this.close();
  }

  /** The Default question is up (the pad's menu while it is) */
  get confirming(): boolean {
    return this.isOpen && !this.#confirm.hidden;
  }

  get isOpen(): boolean {
    return !this.#root.hidden;
  }

  /** A pad input is awaited for a binding (the pad's menu navigation stands aside meanwhile: src/ui/padNav.ts) */
  get capturingGamepad(): boolean {
    return this.#capture?.device === "gamepad";
  }

  get settings(): Settings {
    return this.#settings;
  }

  open(): void {
    // (the free look's captured mouse is let go: the menu needs the pointer)
    if (document.pointerLockElement) document.exitPointerLock();
    this.#root.hidden = false;
    // (always on the first tab, as the game's: MENU-15)
    this.#tab = "controls";
    this.#confirm.hidden = true;
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

  #update(change: Settings): void {
    const next = this.resolve(change);
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
    // (the bumpers' glyphs in the connected pad's family)
    this.#tabGlyphs.forEach((g, i) => {
      g.replaceChildren(glyphElement(keyGlyph({ kind: "padButton", button: i === 0 ? 4 : 5 })));
    });
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
              : this.#tab === "training"
              ? this.#trainingTab()
              : this.#tab === "interface"
                ? this.#interfaceTab()
                : this.#tab === "scoreboard"
                ? this.#scoreboardTab()
                : this.#tab === "chat"
                  ? this.#chatTab()
                  : this.#tab === "video"
                    ? this.#videoTab()
                    : this.#audioTab();
    // (each tab a page of the pad's: its focus kept while the settings are open; its reset the pad's X Default, its
    // bindings' slots cleared by Y)
    content.dataset["padPage"] = this.#tab;
    // (a tab come back to, or the settings opened again, starts at its first row: RV-476)
    content.dataset["padForget"] = "";
    // (every tab's X Default: the whole page back to its defaults, RV-474)
    content.dataset["padX"] = "";
    if (this.#tab === "controls") content.dataset["padY"] = "";
    // (the control that had the keyboard's focus has it again in the new page: a slider or list stepped by its keys goes
    // on stepping)
    const focused = document.activeElement instanceof HTMLElement && this.#body.contains(document.activeElement) ? document.activeElement : null;
    const selector = focused ? sameControl(focused) : null;
    this.#body.replaceChildren(content);
    // (by its data attributes, else (a reset button) the same kind of control with the same text: RV-482)
    const again = selector ? content.querySelector<HTMLElement>(selector) : focused ? [...content.querySelectorAll<HTMLElement>(focused.tagName)].find((e) => e.textContent === focused.textContent) : null;
    again?.focus({ preventScroll: true });
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
    // (a pad's face button with its glyph, in the connected pad's family: PlayStation's ✕ ○ □ △ before its name; an Xbox
    // pad's letter, its name too, alone)
    if (!capturing && input?.kind === "padButton" && input.button <= 3) {
      const glyph = keyGlyph(input);
      if (glyph.kind === "pad" && glyph.text === inputName(input)) b.replaceChildren(glyphElement(glyph));
      else b.prepend(glyphElement(glyph), " ");
    }
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
      box.append(
        checkbox({
          label: INPUT_CAMERA_LABELS[option],
          checked: current[option],
          data: { camera: key, option },
          onChange: (checked) => { apply({ ...current, [option]: checked }); },
        }),
      );
    }
    const numbers = (c: InputCameraSettings) => ({ accelRate: c.accelRate, decelRate: c.decelRate, freeLookSpeed: c.freeLookSpeed });
    const sliders = this.#sliders(
      numbers(current),
      INPUT_CAMERA_LIMITS,
      INPUT_CAMERA_LABELS,
      (next) => { apply({ ...current, ...next }); },
      numbers(DEFAULT_SETTINGS[key]),
    );
    // (a group named by its heading: its controls' names repeat in the other input's, RV-482)
    const heading = el("h3", { textContent: title });
    heading.id = `settings-${key}`;
    const group = el("div", { className: "input-camera" }, [heading, box, sliders]);
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", heading.id);
    return group;
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
    const select = <K extends keyof GameplaySettings>(key: K, label: string, options: Readonly<Record<GameplaySettings[K], string>>): HTMLElement =>
      cycler({
        label,
        options: Object.entries(options) as [GameplaySettings[K], string][],
        value: gameplay[key],
        data: { setting: key },
        onChange: (value) => { apply({ [key]: value }); },
      });
    // (the game's creation order: free play's unlimited boost first, the goal replay's skip last: HT-5, RV-281)
    box.append(
      this.#checkboxes(["unlimitedBoost"]),
      select("statDisplayLevel", T.statDisplayLevel, T.statLevels),
      select("flipResetIndicator", T.flipResetIndicator, T.flipModes),
      this.#checkboxes(["autoSkipReplay"]),
    );
    return box;
  }

  /** Training (custom training's: notes/custom-training.md §5): the game speed, the round start's input delay, the
   *  variance's modifiers, the starting boost; the replay's skip, the car on the ground, unlimited boost */
  #trainingTab(): HTMLElement {
    const T = TRAINING_SETTINGS_TEXT;
    const training = this.#settings.training;
    const apply = (next: Partial<TrainingSettings>): void => {
      this.#update({ ...this.#settings, training: { ...this.#settings.training, ...next } });
    };
    const numbers = Object.fromEntries(Object.keys(TRAINING_LIMITS).map((k) => [k, training[k as keyof TrainingNumbers]])) as unknown as TrainingNumbers;
    const box = this.#sliders(numbers, TRAINING_LIMITS, T, (next) => { apply(next); }, TRAINING_DEFAULTS);
    box.classList.add("caps-labels");
    const options = el("div", { className: "options" });
    for (const key of ["skipReplay", "spawnOnGround", "unlimitedBoost"] as const) {
      options.append(checkbox({ label: T[key], checked: training[key], data: { setting: key }, onChange: (checked) => { apply({ [key]: checked }); } }));
    }
    const reset = box.lastElementChild;
    if (reset) reset.before(options);
    else box.append(options);
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
    const select = <K extends "nameplateMode" | "matchNotifications" | "statGraphs">(key: K, label: string, options: Readonly<Record<InterfaceSettings[K], string>>): HTMLElement =>
      cycler({
        label,
        options: Object.entries(options) as [InterfaceSettings[K], string][],
        value: ui[key],
        data: { setting: key },
        onChange: (value) => { apply({ [key]: value }); },
      });
    const options = el("div", { className: "options" });
    for (const key of ["teamColoredBoost", "metric", "ballCamIndicator", "ballArrow", "hideHud"] as const) {
      options.append(checkbox({ label: T[key], checked: ui[key], data: { setting: key }, onChange: (checked) => { apply({ [key]: checked }); } }));
    }
    const extra = [
      select("nameplateMode", T.nameplateMode, T.nameplateModes),
      select("matchNotifications", T.matchNotifications, T.notifications),
      select("statGraphs", T.statGraphs, T.statGraphOptions),
      options,
    ];
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
    box.append(el("label", { className: "option control-row" }, [el("span", { textContent: "Name (when you next join)" }), name]));
    box.append(
      cycler({
        label: T.quickChat,
        title: T.quickChatDescription,
        options: Object.entries(T.filters) as [ChatSettings["quickChatFilter"], string][],
        value: chat.quickChatFilter,
        data: { setting: "quickChatFilter" },
        onChange: (quickChatFilter) => { apply({ quickChatFilter }); },
      }),
      checkbox({
        label: T.blockNonTactical,
        title: T.blockNonTacticalDescription,
        checked: chat.blockNonTactical,
        data: { setting: "blockNonTactical" },
        onChange: (blockNonTactical) => { apply({ blockNonTactical }); },
      }),
    );
    const slots = el("table", { className: "chat-slots" });
    T.rows.forEach((title, row) => {
      const cells = [0, 1, 2, 3].map((k) => {
        const slot = 4 * row + k;
        // (sorted by their text, as the game's SortQuickChat: RV-256)
        const keys = slotPool(slot).toSorted((a, b) => presetText(a).localeCompare(presetText(b)));
        const select = cyclerControl({
          label: `${title} ${String(k + 1)}`,
          options: keys.map((key) => [key, presetText(key)] as const),
          value: chat.slots[slot] ?? "",
          data: { slot: String(slot) },
          onChange: (value) => { apply({ slots: this.#settings.chat.slots.map((s, i) => (i === slot ? value : s)) }); },
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

  /** The scoreboard's four columns after SCORE (the game's soccar set: SB-17; headed "Columns": shipped text names no mode,
   *  the user's decision), each from the columns this clone counts, sorted by
   *  label; a reset to the defaults */
  #scoreboardTab(): HTMLElement {
    const columns = this.#settings.scoreboard.columns;
    const box = el("div", { className: "sliders scoreboard-settings" });
    box.append(el("h3", { textContent: "Columns" }));
    columns.forEach((current, i) => {
      box.append(
        cycler({
          label: `Column ${String(i + 1)}`,
          options: SCOREBOARD_COLUMNS.map((c) => [c.id, c.label] as const),
          value: current,
          data: { column: String(i) },
          onChange: (value) => {
            this.#update({ ...this.#settings, scoreboard: { columns: this.#settings.scoreboard.columns.map((c, k) => (k === i ? value : c)) } });
          },
        }),
      );
    });
    const reset = el("button", { className: "settings-reset", textContent: "Reset to defaults" });
    reset.dataset["reset"] = "scoreboard";
    reset.addEventListener("click", () => {
      this.#update({ ...this.#settings, scoreboard: DEFAULT_SCOREBOARD_SETTINGS });
    });
    box.append(reset);
    return box;
  }

  /** Video (MENU-19..21, GQ1): Render Quality and Render Detail, then the advanced switches that change what we draw (the
   *  game's no-op rows here not shown: Anti-aliasing, Texture Detail, Effect Intensity, Ambient Occlusion, Light Shafts,
   *  Lens Flares, Dynamic Shadows, Motion Blur, Weather Effects); the game's labels, its preset rules (settings/video.ts) */
  #videoTab(): HTMLElement {
    const T = VIDEO_TEXT;
    const s = this.#settings;
    const state: VideoState = { video: s.video, bloom: s.options.bloom, depthOfField: s.options.depthOfField };
    const apply = (next: VideoState): void => {
      this.#update({ ...this.#settings, video: next.video, options: { ...this.#settings.options, bloom: next.bloom, depthOfField: next.depthOfField } });
    };
    const list = <V extends string>(key: string, label: string, values: readonly V[], value: V, onChange: (v: V) => void): HTMLElement =>
      cycler({ label, options: values.map((v) => [v, T.levels[v as keyof typeof T.levels]] as const), value, data: { setting: key }, onChange });
    const box = el("div", { className: "sliders" }, [
      el("p", {
        className: "settings-hint",
        textContent: s.video.chosen
          ? "Render Quality draws the 3D view at a share of the screen's resolution (the HUD and menus stay sharp). Render Detail sets the switches below; changing one of them, or Render Quality, makes it Custom."
          : "Set for this device's graphics until you change one (Default goes back to that). Render Quality draws the 3D view at a share of the screen's resolution (the HUD and menus stay sharp); Render Detail sets the switches below.",
      }),
      el("h3", { textContent: T.basic }),
      list("renderQuality", T.renderQuality, ["highQuality", "quality", "performance", "highPerformance"] as const, s.video.renderQuality, (renderQuality) => {
        apply(withVideoChange(state, { renderQuality }));
      }),
      list("renderDetail", T.renderDetail, ["highQuality", "quality", "performance", "custom"] as const, s.video.renderDetail, (detail) => {
        apply(withRenderDetail(state, detail));
      }),
      el("h3", { textContent: T.advanced }),
      list("worldDetail", T.worldDetail, ["highQuality", "quality", "performance"] as const, s.video.worldDetail, (worldDetail) => {
        apply(withVideoChange(state, { worldDetail }));
      }),
      list("particleDetail", T.particleDetail, ["highQuality", "performance"] as const, s.video.particleDetail, (particleDetail) => {
        apply(withVideoChange(state, { particleDetail }));
      }),
    ]);
    const options = el("div", { className: "options" });
    options.append(
      checkbox({ label: T.highQualityShaders, checked: s.video.highQualityShaders, data: { setting: "highQualityShaders" }, onChange: (on) => { apply(withVideoChange(state, { highQualityShaders: on })); } }),
      checkbox({ label: T.depthOfField, checked: s.options.depthOfField, data: { option: "depthOfField" }, onChange: (on) => { apply(withVideoChange(state, { depthOfField: on })); } }),
      checkbox({ label: T.bloom, checked: s.options.bloom, data: { option: "bloom" }, onChange: (on) => { apply(withVideoChange(state, { bloom: on })); } }),
    );
    box.append(options);
    box.classList.add("caps-labels");
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
      box.append(
        checkbox({
          label: OPTION_LABELS[key],
          checked: this.#settings.options[key],
          data: { option: key },
          onChange: (checked) => { this.#update({ ...this.#settings, options: { ...this.#settings.options, [key]: checked } }); },
        }),
      );
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
      rows.append(
        slider({
          label: labels[key],
          min: range.min,
          max: range.max,
          step: range.step,
          value: values[key] as number,
          // (the game's percentage readout: round(v x 100) "%", HT-5)
          format: (v) => (percent ? `${String(Math.round(v * 100))}%` : formatNumber(v, range.step)),
          data: { setting: key },
          onChange: (value) => { apply({ ...values, [key]: value }); },
        }),
      );
    }
    const reset = el("button", { textContent: "Reset to defaults" });
    reset.addEventListener("click", () => { apply(defaults); });
    rows.append(reset);
    return rows;
  }
}

/** A settings tab's every setting back to its default (the pad's X Default, "Reset this page to its defaults?": MENU-14,
 *  RV-474), the rest kept; the player's name kept on the chat's */
export function pageDefaults(tab: Tab, s: Settings): Settings {
  const d = DEFAULT_SETTINGS;
  const options = (keys: readonly (keyof Options)[]): Options => ({ ...s.options, ...Object.fromEntries(keys.map((k) => [k, d.options[k]])) });
  switch (tab) {
    case "controls":
      return { ...s, bindings: d.bindings };
    case "camera":
      return { ...s, camera: d.camera, cameraKbm: d.cameraKbm, cameraPad: d.cameraPad, options: options(["rearCameraToggle", "cameraShake"]) };
    case "controller":
      return { ...s, controller: d.controller, options: options(["airPitchSafety"]) };
    case "gameplay":
      return { ...s, gameplay: d.gameplay, options: options(["unlimitedBoost", "autoSkipReplay"]) };
    case "training":
      return { ...s, training: d.training };
    case "interface":
      return { ...s, interface: d.interface };
    case "scoreboard":
      return { ...s, scoreboard: d.scoreboard };
    case "chat":
      return { ...s, chat: { ...d.chat, name: s.chat.name } };
    case "video":
      // (back to the automatic default: the panel's resolve applies it)
      return { ...s, video: d.video, options: options(["bloom", "depthOfField"]) };
    case "audio":
      return { ...s, audio: d.audio, options: options(["muted"]) };
  }
}

/** A selector for the control `el` is in the page made again (its role and data attributes, the pad's left out); null for
 *  one with none */
function sameControl(control: HTMLElement): string | null {
  const data = Object.entries(control.dataset).filter(([k]) => !k.startsWith("pad") && k !== "value");
  if (data.length === 0) return null;
  const attr = (k: string): string => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  return data.map(([k, v]) => `[${attr(k)}="${CSS.escape(v ?? "")}"]`).join("");
}

function formatNumber(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals);
}
