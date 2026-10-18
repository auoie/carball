// Carball's training editor (ours; notes/custom-training.md §4.1 for what shapes the data): a pack's name, type and
// difficulty; its shots (add, duplicate, delete, move); the selected shot's ball (place, launch pitch and yaw, speed),
// car (place, yaw, start speed) and time limit, within the format's limits; shown in the arena as placed, its path
// predicted. The camera orbits the shot: drag to turn it, the wheel to come nearer; a click on the field places the ball
// or the car there. Saved in the browser, exported and imported as a pack file; playtested in training. Or the free-camera
// mode, the game's way (src/ui/flyEditor.ts): the player's choice, kept.
import type { CameraView } from "../camera/carballCamera";
import type { Vec3 } from "../math/vec";
import { vec3 } from "../math/vec";
import { PACK_LIMITS, type Difficulty, type Shot, TRAINING_TAGS, type TrainingPack, type TrainingType, parsePack, wrapYaw } from "../training/pack";
import { defaultShot, deletePack, newPackId, packFile, storePack } from "../training/myPacks";
import { CLAMPS, GOAL_BACK, clampTo, editorPack } from "../training/editorControls";
import type { TestKind } from "../training/run";
import { cycler, slider } from "./controls";
import { FLY_TEXT, FlyEditor, type PackDetails } from "./flyEditor";

/** The editor's words (ours) */
export const EDITOR_TEXT = {
  title: "Training Editor",
  name: "Name",
  type: "Type",
  difficulty: "Difficulty",
  types: { striker: "Striker", goalie: "Goalie", aerial: "Aerial" },
  difficulties: { easy: "Easy", medium: "Medium", hard: "Hard" },
  tags: "Tags",
  shots: "Shots",
  add: "Add",
  duplicate: "Duplicate",
  delete: "Delete",
  earlier: "Move Earlier",
  later: "Move Later",
  place: "Click the field to place",
  ball: "Ball",
  car: "Car",
  x: "X",
  y: "Y",
  height: "Height",
  pitch: "Launch Pitch",
  yaw: "Launch Yaw",
  speed: "Speed",
  carYaw: "Facing",
  startSpeed: "Start Speed",
  timeLimit: "Time Limit",
  playtest: "Playtest",
  save: "Save",
  saved: "Saved",
  notSavedTitle: "Not Saved",
  notSaved: "Not saved: the browser's storage is full or blocked",
  tooBig: "the file is over 1 MB",
  exportPack: "Export",
  importPack: "Import",
  exit: "Exit",
  hint: "Drag to turn the camera · wheel to zoom",
  unsaved: "Unsaved changes",
  deleteSequence: "Delete Sequence",
  /** The game's prompts (notes/training-editor.md §5.3, verbatim) */
  invalidName: "INVALID NAME",
  invalidNameBody: "Please enter a valid name.",
  saveAndExit: "SAVE AND EXIT",
  saveAndExitBody: "Save changes to this sequence before exiting?",
  deleteTitle: "DELETE SEQUENCE",
  deleteBody: "Are you sure you want to delete this sequence?",
  yes: "YES",
  no: "NO",
  cancel: "CANCEL",
  confirmDelete: "DELETE",
} as const;

/** A pack's name, its tags (the game's: notes/training-editor.md §3), an imported file's size (bytes, ours) */
export const EDITOR_LIMITS = { nameMin: 3, nameMax: 30, tags: 4, fileBytes: 1_000_000 } as const;

export interface EditorActions {
  /** Show this shot in the arena (null: the editor closed; `asPlaced`: the car where it is, in the air too) */
  readonly show: (shot: Shot | null, asPlaced: boolean) => void;
  /** The editor's camera, each time it moves */
  readonly camera: (view: CameraView) => void;
  /** The ray through a page point (the field's click) */
  readonly rayAt: (x: number, y: number) => { readonly origin: Vec3; readonly dir: Vec3 };
  /** Play this pack from this shot */
  readonly playtest: (pack: TrainingPack, shot: number) => void;
  /** The editor left (Exit, Escape) */
  readonly exit: () => void;
  /** A notice (OK), or a choice of buttons (the default `focus`): the page's modal */
  readonly notice: (title: string, body: string) => void;
  readonly choose: (title: string, body: string, choices: readonly { readonly label: string; readonly act?: () => void }[], focus: number) => void;
  /** The free-camera mode's test of this pack from this shot, and whether it still plays */
  readonly test: (pack: TrainingPack, shot: number, kind: TestKind) => void;
  readonly testing: () => boolean;
  /** A world point on the page (CSS px), null behind the camera */
  readonly project: (p: Vec3) => { readonly x: number; readonly y: number } | null;
  /** A menu over the editor: the free-camera mode takes no input */
  readonly blocked: () => boolean;
}

/** The editor's two modes: the panel (ours) or the free camera (the game's), the player's last choice kept */
export type EditorMode = "panel" | "fly";
const MODE_KEY = "carball.training.editorMode";

function storedMode(): EditorMode {
  try {
    return localStorage.getItem(MODE_KEY) === "fly" ? "fly" : "panel";
  } catch {
    return "panel";
  }
}

function storeMode(mode: EditorMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // (no storage: the choice for this page alone)
  }
}

/** The orbit's limits: its pitch (rad) and distance (uu) */
const ORBIT = { minPitch: 0.08, maxPitch: 1.45, minDistance: 400, maxDistance: 9000 } as const;
/** Rotator units a degree */
const UNITS = 65536 / 360;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class TrainingEditor {
  readonly #root: HTMLDivElement;
  readonly #actions: EditorActions;
  #pack: Mutable<TrainingPack> | null = null;
  #shots: Shot[] = [];
  #shot = 0;
  #placing: "ball" | "car" = "ball";
  #orbit = { yaw: -Math.PI / 2, pitch: 0.55, distance: 3200 };
  #status = "";
  /** edited since it was opened or saved */
  #dirty = false;
  #drag: { x: number; y: number; moved: boolean } | null = null;
  #mode: EditorMode = storedMode();
  readonly #fly: FlyEditor;

  constructor(host: HTMLElement, canvas: HTMLElement, actions: EditorActions) {
    this.#actions = actions;
    this.#root = document.createElement("div");
    this.#root.id = "training-editor";
    this.#root.hidden = true;
    host.append(this.#root);
    this.#fly = new FlyEditor(host, canvas, {
      pack: () => this.pack ?? { id: "none", name: "", type: "striker", difficulty: "easy", tags: [], description: "", creator: "", shots: [defaultShot("striker")] },
      index: () => this.#shot,
      select: (index) => {
        this.#shot = Math.min(Math.max(0, index), this.#shots.length - 1);
        this.#changed(false);
      },
      edit: (shot) => {
        this.#edit(() => shot);
      },
      add: () => {
        if (!this.#pack || this.#shots.length >= PACK_LIMITS.shots) return;
        this.#shots.push(defaultShot(this.#pack.type));
        this.#shot = this.#shots.length - 1;
        this.#changed();
      },
      duplicate: () => {
        const shot = this.#shots[this.#shot];
        if (!shot || this.#shots.length >= PACK_LIMITS.shots) return;
        this.#shots.splice(this.#shot + 1, 0, shot);
        this.#shot += 1;
        this.#changed();
      },
      remove: () => {
        if (this.#shots.length <= 1) return;
        this.#shots.splice(this.#shot, 1);
        this.#shot = Math.min(this.#shot, this.#shots.length - 1);
        this.#changed();
      },
      details: (details) => this.#setDetails(details),
      test: (kind) => {
        const p = this.pack;
        if (p) this.#actions.test(p, kind === "sequence" ? 0 : this.#shot, kind);
      },
      testing: () => this.#actions.testing(),
      menu: () => {
        this.escape();
      },
      panel: () => {
        this.#setMode("panel");
      },
      closed: () => {
        this.close();
      },
      camera: (view) => {
        this.#actions.camera(view);
      },
      project: (p) => this.#actions.project(p),
      blocked: () => this.#actions.blocked(),
    });
    // (unsaved changes asked about before the page goes: a reload, the tab closed, Ctrl+W among the free camera's keys:
    // RX25)
    window.addEventListener("beforeunload", (e) => {
      if (!this.#dirty || (!this.isOpen && !this.testing)) return;
      e.preventDefault();
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (this.#root.hidden) return;
      this.#drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    window.addEventListener("pointermove", (e) => {
      const drag = this.#drag;
      if (!drag || this.#root.hidden) return;
      const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      [drag.x, drag.y] = [e.clientX, e.clientY];
      this.#orbit.yaw -= dx * 0.006;
      this.#orbit.pitch = Math.max(ORBIT.minPitch, Math.min(ORBIT.maxPitch, this.#orbit.pitch + dy * 0.005));
      this.#aim();
    });
    window.addEventListener("pointerup", (e) => {
      const drag = this.#drag;
      this.#drag = null;
      if (!drag || drag.moved || this.#root.hidden || e.button !== 0) return;
      this.#placeAt(e.clientX, e.clientY);
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.#root.hidden) return;
        e.preventDefault();
        this.#orbit.distance = Math.max(ORBIT.minDistance, Math.min(ORBIT.maxDistance, this.#orbit.distance * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
        this.#aim();
      },
      { passive: false },
    );
  }

  /** Open (the panel or the free-camera mode shown; not while the free-camera mode's test plays) */
  get isOpen(): boolean {
    return !this.#root.hidden || this.#fly.isOpen;
  }

  /** The editor's menu a pad drives while it's shown (the free camera's SEQUENCE SETTINGS or shot list, else the panel:
   *  its rows, sliders and cyclers; B backing out as Escape does, RX25), else null (the shot editor: its own controls) */
  get padMenu(): HTMLElement | null {
    return this.#fly.padMenu ?? (this.#root.hidden ? null : this.#root);
  }

  /** The free-camera mode's test playing (the editor back when it ends) */
  get testing(): boolean {
    return this.#fly.testing;
  }

  /** For the browser tests: the mode and the free-camera mode's state */
  get state(): { readonly mode: EditorMode; readonly fly: FlyEditor["state"] } {
    return { mode: this.#mode, fly: this.#fly.state };
  }

  /** The pack being edited (as it stands now), null when closed */
  get pack(): TrainingPack | null {
    return this.#pack ? { ...this.#pack, shots: [...this.#shots] } : null;
  }

  /** Editing this pack, from this shot */
  open(pack: TrainingPack, shot = 0): void {
    this.#pack = { ...pack };
    this.#shots = [...pack.shots];
    this.#shot = Math.min(Math.max(0, shot), this.#shots.length - 1);
    this.#status = "";
    this.#dirty = false;
    this.#enter();
  }

  /** The mode's view: the panel, or the free-camera mode's shot list */
  #enter(): void {
    this.#root.hidden = this.#mode !== "panel";
    if (this.#mode === "fly") this.#fly.open();
    else this.#fly.close();
    this.#changed(false);
  }

  #setMode(mode: EditorMode): void {
    this.#mode = mode;
    storeMode(mode);
    this.#enter();
  }

  /** Left (its pack kept as it stands in `pack` until the next open) */
  close(): void {
    if (!this.isOpen && !this.testing) return;
    this.#root.hidden = true;
    this.#fly.close();
    this.#actions.show(null, false);
  }

  /** A frame (`dt` real s): the free-camera mode's flight and HUD */
  frame(dt: number): void {
    this.#fly.frame(dt);
  }

  /** The free-camera mode's test over (the pause menu's Back to Editor) */
  endTest(): void {
    this.#fly.endTest();
  }

  /** Escape (and Exit): the editor left; with unsaved changes, the game's question first (YES saves and leaves, NO leaves,
   *  CANCEL stays) */
  escape(): void {
    if (this.#fly.escape()) return;
    this.leave(() => {
      this.#actions.exit();
    });
  }

  /** Left whatever is open in it, as Escape leaves it (the pause menu's Exit to Main Menu over the editor, its test or a
   *  playtest of its pack): the details' dialog closed, the unsaved changes asked about first; `then` once it's left
   *  (CANCEL stays) */
  leave(then: () => void): void {
    this.#fly.escape();
    const leave = (): void => {
      this.close();
      then();
    };
    if (!this.#dirty) {
      leave();
      return;
    }
    const T = EDITOR_TEXT;
    this.#actions.choose(T.saveAndExit, T.saveAndExitBody, [
      {
        label: T.yes,
        act: () => {
          if (this.#save()) leave();
        },
      },
      { label: T.no, act: leave },
      { label: T.cancel },
    ], 2);
  }

  /** Saved (the name 3 characters at least, else the game's refusal); whether it was */
  #save(): boolean {
    const p = this.pack;
    if (!p) return false;
    if (p.name.trim().length < EDITOR_LIMITS.nameMin) {
      this.#actions.notice(EDITOR_TEXT.invalidName, EDITOR_TEXT.invalidNameBody);
      return false;
    }
    if (!storePack(p)) {
      this.#status = EDITOR_TEXT.notSaved;
      this.#actions.notice(EDITOR_TEXT.notSavedTitle, EDITOR_TEXT.notSaved);
      this.#render();
      return false;
    }
    this.#dirty = false;
    this.#status = EDITOR_TEXT.saved;
    this.#render();
    return true;
  }

  /** The shot changed (or another shot chosen): shown, the camera on it, the panel again (the free-camera mode: shown as
   *  placed, its camera its own) */
  #changed(edited = true): void {
    if (edited) this.#edited();
    const shot = this.#shots[this.#shot];
    if (this.#mode === "fly") {
      if (shot) this.#actions.show(shot, true);
      return;
    }
    if (shot) this.#actions.show(shot, false);
    this.#aim();
    this.#render();
  }

  /** SEQUENCE SETTINGS' details: taken with a name of 3 characters at least (else the game's refusal) */
  #setDetails(details: PackDetails): boolean {
    const pack = this.#pack;
    if (!pack) return false;
    const name = details.name.trim().slice(0, EDITOR_LIMITS.nameMax);
    if (name.length < EDITOR_LIMITS.nameMin) {
      this.#actions.notice(EDITOR_TEXT.invalidName, EDITOR_TEXT.invalidNameBody);
      return false;
    }
    pack.name = name;
    pack.type = details.type;
    pack.difficulty = details.difficulty;
    pack.tags = details.tags.slice(0, EDITOR_LIMITS.tags);
    this.#edited();
    return true;
  }

  /** The camera orbiting the shot's middle (between its ball and car) */
  #aim(): void {
    const shot = this.#shots[this.#shot];
    if (!shot) return;
    const b = shot.ball.location;
    const c = shot.car.location;
    const target = vec3((b.x + c.x) / 2, (b.y + c.y) / 2, Math.max(100, (b.z + c.z) / 2));
    const { yaw, pitch, distance } = this.#orbit;
    const eye = vec3(target.x + distance * Math.cos(pitch) * Math.cos(yaw), target.y + distance * Math.cos(pitch) * Math.sin(yaw), target.z + distance * Math.sin(pitch));
    const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z) || 1;
    this.#actions.camera({ position: eye, forward: vec3((target.x - eye.x) / d, (target.y - eye.y) / d, (target.z - eye.z) / d), up: vec3(0, 0, 1), horizontalFov: 90 });
  }

  /** A click on the field: the ball (at its height) or the car (on the floor) placed where the ray meets it */
  #placeAt(x: number, y: number): void {
    const shot = this.#shots[this.#shot];
    if (!shot) return;
    const height = this.#placing === "ball" ? shot.ball.location.z : 17;
    const { origin, dir } = this.#actions.rayAt(x, y);
    if (dir.z >= -1e-6) return;
    const t = (height - origin.z) / dir.z;
    if (t <= 0) return;
    const reach = this.#placing === "ball" ? 92.75 : 60;
    const px = Math.max(-(PACK_LIMITS.halfX - reach), Math.min(PACK_LIMITS.halfX - reach, origin.x + dir.x * t));
    const py = Math.max(-(5120 - reach), Math.min(5120 - reach, origin.y + dir.y * t));
    this.#edit((s) =>
      this.#placing === "ball" ? { ...s, ball: { ...s.ball, location: vec3(px, py, s.ball.location.z) } } : { ...s, car: { ...s.car, location: vec3(px, py, s.car.location.z) } },
    );
  }

  #edit(change: (shot: Shot) => Shot): void {
    const shot = this.#shots[this.#shot];
    if (!shot) return;
    this.#shots[this.#shot] = change(shot);
    this.#changed();
  }

  #render(): void {
    const pack = this.#pack;
    const shot = this.#shots[this.#shot];
    if (!pack || !shot) return;
    const T = EDITOR_TEXT;
    const section = (title: string): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = "editor-section";
      d.textContent = title;
      return d;
    };
    const button = (label: string, click: () => void, className = ""): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = `editor-button ${className}`.trim();
      b.textContent = label;
      b.addEventListener("click", click);
      return b;
    };
    const row = (...items: HTMLElement[]): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = "editor-row";
      d.append(...items);
      return d;
    };
    const number = (label: string, value: number, min: number, max: number, step: number, unit: string, set: (v: number) => void, key: string): HTMLDivElement =>
      slider({ label, min, max, step, value, format: (v) => `${String(Math.round(v * 100) / 100)}${unit}`, data: { editor: key }, onChange: set });
    const heading = document.createElement("div");
    heading.className = "editor-title";
    heading.textContent = T.title;
    // (the modes: the panel, or the free camera)
    const mode = (label: string, to: EditorMode): HTMLButtonElement => {
      const b = button(label, () => {
        if (to !== this.#mode) this.#setMode(to);
      }, "editor-mode");
      b.setAttribute("aria-pressed", String(to === this.#mode));
      return b;
    };
    const name = document.createElement("input");
    name.type = "text";
    name.className = "editor-name";
    name.value = pack.name;
    name.maxLength = EDITOR_LIMITS.nameMax;
    name.placeholder = T.name;
    name.setAttribute("aria-label", T.name);
    name.addEventListener("change", () => {
      pack.name = name.value.trim().slice(0, EDITOR_LIMITS.nameMax);
      this.#edited();
      this.#render();
    });
    const type = cycler<TrainingType>({
      label: T.type,
      options: Object.entries(T.types) as [TrainingType, string][],
      value: pack.type,
      data: { editor: "type" },
      onChange: (v) => {
        pack.type = v;
        this.#changed();
      },
    });
    const difficulty = cycler<Difficulty>({
      label: T.difficulty,
      options: Object.entries(T.difficulties) as [Difficulty, string][],
      value: pack.difficulty,
      data: { editor: "difficulty" },
      onChange: (v) => {
        pack.difficulty = v;
        this.#changed();
      },
    });
    // (the game's tags, each on or off: search and display only)
    const tags = document.createElement("div");
    tags.className = "editor-tags";
    for (const tag of TRAINING_TAGS) {
      const on = pack.tags.includes(tag);
      const t = button(tag.replace(/([a-z])([A-Z])/g, "$1 $2"), () => {
        pack.tags = on ? pack.tags.filter((x) => x !== tag) : [...pack.tags, tag];
        this.#edited();
        this.#render();
      }, "editor-tag");
      t.setAttribute("aria-pressed", String(on));
      // (4 at most, as the game's)
      t.disabled = !on && pack.tags.length >= EDITOR_LIMITS.tags;
      tags.append(t);
    }
    const shots = document.createElement("div");
    shots.className = "editor-shots";
    this.#shots.forEach((_, i) => {
      const b = button(String(i + 1), () => {
        this.#shot = i;
        this.#changed(false);
      }, "editor-shot");
      b.setAttribute("aria-pressed", String(i === this.#shot));
      shots.append(b);
    });
    const full = this.#shots.length >= PACK_LIMITS.shots;
    const add = button(T.add, () => {
      this.#shots.splice(this.#shot + 1, 0, defaultShot(pack.type));
      this.#shot += 1;
      this.#changed();
    });
    const duplicate = button(T.duplicate, () => {
      this.#shots.splice(this.#shot + 1, 0, shot);
      this.#shot += 1;
      this.#changed();
    });
    add.disabled = duplicate.disabled = full;
    const remove = button(T.delete, () => {
      this.#shots.splice(this.#shot, 1);
      this.#shot = Math.min(this.#shot, this.#shots.length - 1);
      this.#changed();
    });
    remove.disabled = this.#shots.length <= 1;
    const move = (by: -1 | 1): void => {
      const to = this.#shot + by;
      const [s] = this.#shots.splice(this.#shot, 1);
      if (s) this.#shots.splice(to, 0, s);
      this.#shot = to;
      this.#changed();
    };
    const earlier = button(T.earlier, () => { move(-1); });
    earlier.disabled = this.#shot === 0;
    const later = button(T.later, () => { move(1); });
    later.disabled = this.#shot === this.#shots.length - 1;
    const place = (what: "ball" | "car", label: string): HTMLButtonElement => {
      const b = button(label, () => {
        this.#placing = what;
        this.#render();
      }, "editor-place");
      b.setAttribute("aria-pressed", String(this.#placing === what));
      return b;
    };
    const b = shot.ball;
    const c = shot.car;
    // (the sliders span the clamps, each change kept within them: the goal's inside for the ball, RV-594)
    const ballAt = (v: Partial<Record<"x" | "y" | "z", number>>): void => {
      this.#edit((s) => ({ ...s, ball: { ...s.ball, location: clampTo("ball", vec3(v.x ?? s.ball.location.x, v.y ?? s.ball.location.y, v.z ?? s.ball.location.z)) } }));
    };
    const carAt = (v: Partial<Record<"x" | "y", number>>): void => {
      this.#edit((s) => ({ ...s, car: { ...s.car, location: clampTo("car", vec3(v.x ?? s.car.location.x, v.y ?? s.car.location.y, s.car.location.z)) } }));
    };
    const status = document.createElement("div");
    status.className = "editor-status";
    status.textContent = this.#status || (this.#dirty ? T.unsaved : "");
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "application/json,.json";
    file.hidden = true;
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (f) void this.#import(f);
    });
    const hint = document.createElement("div");
    hint.className = "editor-hint";
    hint.textContent = T.hint;
    // (the control in use kept focused through the rebuild: a slider's arrow keys step on, RX25)
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.#root.contains(active) ? active.dataset["editor"] : undefined;
    this.#root.replaceChildren(
      heading,
      row(mode(FLY_TEXT.panel, "panel"), mode(FLY_TEXT.freeCamera, "fly")),
      name,
      type,
      difficulty,
      section(T.tags),
      tags,
      section(T.shots),
      shots,
      row(add, duplicate, remove),
      row(earlier, later),
      section(T.place),
      row(place("ball", T.ball), place("car", T.car)),
      section(T.ball),
      number(T.x, b.location.x, -CLAMPS.ball.x, CLAMPS.ball.x, 10, "", (v) => { ballAt({ x: v }); }, "ballX"),
      number(T.y, b.location.y, -GOAL_BACK, GOAL_BACK, 10, "", (v) => { ballAt({ y: v }); }, "ballY"),
      number(T.height, b.location.z, CLAMPS.ball.zMin, CLAMPS.ball.zMax, 10, "", (v) => { ballAt({ z: v }); }, "ballZ"),
      number(T.pitch, (b.launch.pitch / 16384) * 90, -90, 90, 1, "°", (v) => { this.#edit((s) => ({ ...s, ball: { ...s.ball, launch: { ...s.ball.launch, pitch: Math.round((v * 16384) / 90) } } })); }, "pitch"),
      number(T.yaw, wrapYaw(b.launch.yaw) / UNITS, 0, 359, 1, "°", (v) => { this.#edit((s) => ({ ...s, ball: { ...s.ball, launch: { ...s.ball.launch, yaw: wrapYaw(Math.round(v * UNITS)) } } })); }, "yaw"),
      number(T.speed, b.speed, 0, PACK_LIMITS.ballSpeed, 50, "", (v) => { this.#edit((s) => ({ ...s, ball: { ...s.ball, speed: v } })); }, "speed"),
      section(T.car),
      number(T.x, c.location.x, -CLAMPS.car.x, CLAMPS.car.x, 10, "", (v) => { carAt({ x: v }); }, "carX"),
      number(T.y, c.location.y, -CLAMPS.car.y, CLAMPS.car.y, 10, "", (v) => { carAt({ y: v }); }, "carY"),
      number(T.carYaw, wrapYaw(c.rotation.yaw) / UNITS, 0, 359, 1, "°", (v) => { this.#edit((s) => ({ ...s, car: { ...s.car, rotation: { ...s.car.rotation, yaw: wrapYaw(Math.round(v * UNITS)) } } })); }, "carYaw"),
      number(T.startSpeed, c.startSpeed, 0, PACK_LIMITS.carSpeed, 50, "", (v) => { this.#edit((s) => ({ ...s, car: { ...s.car, startSpeed: v } })); }, "startSpeed"),
      number(T.timeLimit, shot.timeLimit, 1, PACK_LIMITS.timeLimit, 1, " s", (v) => { this.#edit((s) => ({ ...s, timeLimit: v })); }, "timeLimit"),
      row(
        button(T.playtest, () => {
          const p = this.pack;
          if (p) this.#actions.playtest(p, this.#shot);
        }, "editor-primary"),
        button(T.save, () => {
          this.#save();
        }),
      ),
      row(
        button(T.exportPack, () => { this.#export(); }),
        button(T.importPack, () => { file.click(); }),
        button(T.exit, () => { this.escape(); }),
      ),
      row(
        button(T.deleteSequence, () => {
          const id = pack.id;
          this.#actions.choose(T.deleteTitle, T.deleteBody, [
            {
              label: T.confirmDelete,
              act: () => {
                deletePack(id);
                this.close();
                this.#actions.exit();
              },
            },
            { label: T.cancel },
          ], 1);
        }, "editor-delete"),
      ),
      status,
      hint,
      file,
    );
    if (focused !== undefined) this.#root.querySelector<HTMLElement>(`[data-editor="${focused}"]`)?.focus();
  }

  /** An edit: unsaved now */
  #edited(): void {
    this.#dirty = true;
    this.#status = "";
  }

  /** The pack as a file to download */
  #export(): void {
    const p = this.pack;
    if (!p) return;
    const blob = new Blob([JSON.stringify(packFile(p), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name.replace(/[^\w -]+/g, "").trim() || "training"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** A pack file opened: edited here if it's a pack (a new pack of the player's own, its own id: it never replaces one
   *  kept; within the editor's limits: RX25), else why not */
  async #import(file: File): Promise<void> {
    try {
      if (file.size > EDITOR_LIMITS.fileBytes) {
        this.#status = `${EDITOR_TEXT.importPack}: ${EDITOR_TEXT.tooBig}`;
        this.#render();
        return;
      }
      const pack = parsePack(JSON.parse(await file.text()));
      if (typeof pack === "string") {
        this.#status = `${EDITOR_TEXT.importPack}: ${pack}`;
        this.#render();
        return;
      }
      this.open({ ...editorPack(pack), id: newPackId() });
      // (an imported pack not kept until saved)
      this.#dirty = true;
      this.#render();
    } catch (e) {
      this.#status = `${EDITOR_TEXT.importPack}: ${e instanceof Error ? e.message : String(e)}`;
      this.#render();
    }
  }
}
