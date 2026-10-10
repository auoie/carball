// Settings menu (Escape): rebind controls, camera settings, controller settings, audio. Changes apply at once
// and are saved in the browser.
import type { CameraSettings } from "../camera/rlCamera";
import { ACTIONS, type Action, type GamepadInput, type KeyboardInput, inputName } from "../input/bindings";
import { readGamepad } from "../input/devices";
import {
  AUDIO_LIMITS,
  type AudioSettings,
  CAMERA_LIMITS,
  CONTROLLER_LIMITS,
  type ControllerSettings,
  DEFAULT_PRESET,
  DEFAULT_SETTINGS,
  INPUT_CAMERA_LIMITS,
  type InputCameraSettings,
  MODERN_PRESET,
  type Options,
  PRESET_CAMERA_SHAKE,
  type Range,
  type Settings,
  saveSettings,
} from "../settings/settings";

type Tab = "controls" | "camera" | "controller" | "gameplay" | "video" | "audio";
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
  flipIndicator: "Show the flip indicator (whether you can still dodge, and flip resets)",
  autoSkipReplay: "Skip goal replays (online: always ready to skip; Space or (A) skips one)",
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
  props: Partial<Pick<HTMLElementTagNameMap[K], "className" | "textContent" | "title">> = {},
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
      this.#tabButton("video", "Video"),
      this.#tabButton("audio", "Audio"),
    ]);
    const close = el("button", { className: "settings-close", textContent: "Close (Esc)" });
    close.addEventListener("click", () => { this.close(); });
    this.#root = el("div", { className: "settings" }, [
      el("div", { className: "settings-header" }, [el("h2", { textContent: "Settings" }), tabs, close]),
      this.#body,
    ]);
    this.#root.id = "settings";
    this.#root.hidden = true;
    host.append(this.#root);

    // Escape opens/closes (and cancels a rebind); handled first so the game never sees it
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "Escape") return;
        e.preventDefault();
        if (this.#capture) this.#stopCapture();
        else if (this.isOpen) this.close();
        else this.open();
      },
      { capture: true },
    );
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
    this.#root.hidden = true;
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
    const box = el("div", { className: "sliders" });
    box.append(this.#checkboxes(["flipIndicator", "autoSkipReplay", "unlimitedBoost"]));
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
      const output = el("output", { textContent: formatNumber(value, range.step) });
      input.addEventListener("input", () => {
        output.textContent = formatNumber(Number(input.value), range.step);
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
