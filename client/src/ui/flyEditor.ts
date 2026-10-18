// The training editor's free-camera mode (ours, after the game's: notes/training-editor.md TE1 §1-6). The shot list
// (SHOT n rows with their time limits, CREATE NEW SHOT, duplicate and delete on the selected row, SEQUENCE SETTINGS, TEST
// SEQUENCE, OPEN MENU) and the shot editor: the invisible fly camera, the ball and the car selected in turn, moved by the
// movement keys and turned by the look (the ball's launch aimed by it), their speeds in steps of 50 on the wheel or the
// bumpers, the time limit, undo and redo; its HUD's rows and the strength meter (no number). Test Shot (Tab, the pad's
// View) plays the shot in training until pressed again. The rules are src/training/editorControls.ts; the pack, saving
// and leaving are the editor's round it (src/ui/trainingEditor.ts).
import type { CameraView } from "../camera/carballCamera";
import type { GamepadInput, KeyboardInput } from "../input/bindings";
import { readGamepad } from "../input/devices";
import { type Vec3, vec3 } from "../math/vec";
import {
  type Move,
  type Pose,
  Repeat,
  type Selection,
  ShotHistory,
  TapHold,
  axes,
  behind,
  clampTo,
  cycle,
  editBall,
  editCar,
  firstCamera,
  flyVelocity,
  follow,
  lookPose,
  LOOK,
  needleDegrees,
  resetPitch,
  stepSpeed,
  stepTime,
} from "../training/editorControls";
import { type Difficulty, PACK_LIMITS, type Shot, TRAINING_TAGS, type TrainingPack, type TrainingType } from "../training/pack";
import type { TestKind } from "../training/run";
import { type KeyGlyph, glyphElement, keyGlyph } from "./keyGlyph";
import { trainingClock } from "./trainingHud";

/** The free-camera editor's words: the game's (TE1 §4-6, verbatim), the modes' toggle ours */
export const FLY_TEXT = {
  shot: "SHOT",
  timeLimit: "TIME LIMIT",
  testShot: "Test Shot",
  editBall: "Edit Ball",
  editCar: "Edit Car",
  togglePitch: "Toggle Pitch Lock",
  resetPitch: "Reset Pitch (Hold)",
  freeCam: "Free Cam",
  shotList: "Shot List",
  increaseTimer: "Increase Timer",
  decreaseTimer: "Decrease Timer",
  strength: "STRENGTH",
  shotRow: (n: number): string => `SHOT ${String(n)}`,
  create: "CREATE NEW SHOT",
  modify: "Modify the selected shot.",
  duplicate: "Duplicate the selected shot.",
  delete: "Delete the selected shot.",
  sequenceSettings: "SEQUENCE SETTINGS",
  testSequence: "TEST SEQUENCE",
  openMenu: "OPEN MENU",
  name: "NAME",
  selectTags: "Select Tags",
  accept: "ACCEPT",
  cancel: "CANCEL",
  types: { striker: "Striker", goalie: "Goalie", aerial: "Aerial" },
  difficulties: { easy: "Rookie", medium: "Pro", hard: "All-Star" },
  panel: "Panel",
  freeCamera: "Free camera",
} as const;

/** The pack's details SEQUENCE SETTINGS sets */
export type PackDetails = Pick<TrainingPack, "name" | "type" | "difficulty" | "tags">;

/** What the free-camera editor asks of the editor round it */
export interface FlyHost {
  /** The pack as it stands, and the selected shot's place in it */
  readonly pack: () => TrainingPack;
  readonly index: () => number;
  /** Another shot selected (shown in the arena) */
  readonly select: (index: number) => void;
  /** The selected shot changed to this (unsaved now, shown as placed) */
  readonly edit: (shot: Shot) => void;
  /** A new shot at the end, the selected one copied after it, the selected one deleted: the one selected after each */
  readonly add: () => void;
  readonly duplicate: () => void;
  readonly remove: () => void;
  /** SEQUENCE SETTINGS' ACCEPT: whether the details were taken (else the game's refusal shown) */
  readonly details: (details: PackDetails) => boolean;
  /** The editor's test: the selected shot, or the pack from its first */
  readonly test: (kind: TestKind) => void;
  /** Whether the test still plays (it can be left from the pause menu) */
  readonly testing: () => boolean;
  /** OPEN MENU: leaving the editor (its unsaved question) */
  readonly menu: () => void;
  /** The panel instead */
  readonly panel: () => void;
  /** The editor closed from outside (its test left for the main menu) */
  readonly closed: () => void;
  readonly camera: (view: CameraView) => void;
  /** A world point on the page (CSS px), null behind the camera */
  readonly project: (p: Vec3) => { readonly x: number; readonly y: number } | null;
  /** A menu over the editor (the pause menu, a modal): no input taken */
  readonly blocked: () => boolean;
}

/** The HUD's controls and the shot list's legend, each a keyboard-and-mouse input and a pad's (TE1 §2.1) */
type Action = "test" | "cycle" | "pitch" | "free" | "list" | "timeUp" | "timeDown" | "less" | "more" | "settings" | "sequence" | "menu";
const INPUTS: Record<Action, { readonly keyboard: KeyboardInput | null; readonly gamepad: GamepadInput }> = {
  test: { keyboard: { kind: "key", code: "Tab" }, gamepad: { kind: "padButton", button: 8 } },
  cycle: { keyboard: { kind: "mouse", button: 0 }, gamepad: { kind: "padButton", button: 0 } },
  pitch: { keyboard: { kind: "key", code: "KeyR" }, gamepad: { kind: "padButton", button: 2 } },
  free: { keyboard: { kind: "mouse", button: 2 }, gamepad: { kind: "padButton", button: 3 } },
  list: { keyboard: { kind: "key", code: "ShiftLeft" }, gamepad: { kind: "padButton", button: 1 } },
  timeUp: { keyboard: { kind: "key", code: "ArrowUp" }, gamepad: { kind: "padButton", button: 12 } },
  timeDown: { keyboard: { kind: "key", code: "ArrowDown" }, gamepad: { kind: "padButton", button: 13 } },
  // (the speed's: the wheel on a keyboard and mouse, no key: TE1 §6.1)
  less: { keyboard: null, gamepad: { kind: "padButton", button: 4 } },
  more: { keyboard: null, gamepad: { kind: "padButton", button: 5 } },
  settings: { keyboard: null, gamepad: { kind: "padButton", button: 2 } },
  sequence: { keyboard: null, gamepad: { kind: "padButton", button: 8 } },
  menu: { keyboard: { kind: "key", code: "Escape" }, gamepad: { kind: "padButton", button: 9 } },
};

/** The standard pad's buttons and sticks the editor reads */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, view: 8, r3: 11, up: 12, down: 13, left: 14, right: 15 } as const;
/** The sticks' dead zone (ours) */
const DEADZONE = 0.15;
/** The camera's field of view (the panel's) */
const FOV = 90;
/** The strength meter under the selection (px: TE1 §6.1's bar 80 below it, 180 wide), its gauge's pivot and arc in its
 *  180 × 60 drawing */
const METER = { below: 80, width: 180, pivot: { x: 90, y: 56 }, radius: 50 } as const;

/** The shot editor's rows (TE1 §6.1): what each does and its words, as the selection has them */
export function hudRows(selection: Selection): readonly { readonly action: Action; readonly label: string }[] {
  return [
    { action: "test", label: FLY_TEXT.testShot },
    // (the next selection's: Edit Car while the ball's selected)
    { action: "cycle", label: selection === "ball" ? FLY_TEXT.editCar : FLY_TEXT.editBall },
    ...(selection === "car"
      ? [
          { action: "pitch" as const, label: FLY_TEXT.togglePitch },
          { action: "pitch" as const, label: FLY_TEXT.resetPitch },
        ]
      : []),
    ...(selection === "free" ? [] : [{ action: "free" as const, label: FLY_TEXT.freeCam }]),
    { action: "list", label: FLY_TEXT.shotList },
    { action: "timeUp", label: FLY_TEXT.increaseTimer },
    { action: "timeDown", label: FLY_TEXT.decreaseTimer },
  ];
}

/** The shot list's heading: "<DIFFICULTY> <TYPE>" (ROOKIE STRIKER) */
export function packHeading(pack: Pick<TrainingPack, "type" | "difficulty">): string {
  return `${FLY_TEXT.difficulties[pack.difficulty]} ${FLY_TEXT.types[pack.type]}`.toUpperCase();
}

/** A tag's words (its id's: AirDribbles, Air Dribbles) */
export const tagLabel = (tag: string): string => tag.replace(/([a-z])([A-Z])/g, "$1 $2");

/** The move and look from what's held (TE1 §2.1): W/S/A/D or the left stick, Space and Left Ctrl or the triggers; the
 *  look the mouse's motion (px) or the right stick over `dt` s (radians: yaw to the right, pitch up) */
export function readMove(held: (code: string) => boolean, pad: { readonly axes: readonly number[]; readonly buttons: readonly number[] } | null, mouse: { readonly x: number; readonly y: number }, dt: number): { readonly move: Move; readonly yaw: number; readonly pitch: number } {
  const key = (code: string): number => (held(code) ? 1 : 0);
  const stick = (i: number): number => {
    const v = pad?.axes[i] ?? 0;
    return Math.abs(v) < DEADZONE ? 0 : v;
  };
  const button = (i: number): number => pad?.buttons[i] ?? 0;
  const unit = (v: number): number => Math.max(-1, Math.min(1, v));
  return {
    move: {
      forward: unit(key("KeyW") - key("KeyS") - stick(1)),
      right: unit(key("KeyD") - key("KeyA") + stick(0)),
      up: unit(key("Space") - key("ControlLeft") + button(PAD.rt) - button(PAD.lt)),
    },
    yaw: mouse.x * LOOK.mouse + stick(2) * LOOK.pad * dt,
    pitch: -mouse.y * LOOK.mouse - stick(3) * LOOK.pad * dt,
  };
}

const ZERO = vec3(0, 0, 0);
const sameShot = (a: Shot, b: Shot): boolean => JSON.stringify(a) === JSON.stringify(b);

type View = "closed" | "list" | "edit" | "test";

export class FlyEditor {
  readonly #root: HTMLDivElement;
  readonly #canvas: HTMLElement;
  readonly #host: FlyHost;
  /** The shot editor's HUD: SHOT n/total, the time limit, the controls' rows, the strength meter */
  readonly #hud: HTMLDivElement;
  readonly #count: HTMLDivElement;
  readonly #time: HTMLDivElement;
  readonly #rows: HTMLDivElement;
  readonly #meter: HTMLDivElement;
  readonly #needle: SVGLineElement;
  readonly #meterKeys: { readonly less: HTMLSpanElement; readonly more: HTMLSpanElement };
  /** The shot list's screen, its rows, its context line; the details' dialog */
  readonly #list: HTMLDivElement;
  readonly #shots: HTMLDivElement;
  readonly #context: HTMLDivElement;
  readonly #legend: HTMLDivElement;
  readonly #heading: HTMLDivElement;
  readonly #packName: HTMLDivElement;
  readonly #create: HTMLButtonElement;
  readonly #dialog: HTMLDivElement;
  #view: View = "closed";
  #testFrom: "list" | "edit" = "edit";
  #selection: Selection = "free";
  /** The ball's camera side (Toggle Camera Position: -1 left, 1 right) */
  #side: 1 | -1 = -1;
  #pitchLocked = true;
  #camera: Pose = { pos: ZERO, yaw: 0, pitch: 0 };
  /** The free camera's pose while something's selected (restored by Free Cam), its flight's velocity, the selection's */
  #freePose: Pose | null = null;
  #cameraVel: Vec3 = ZERO;
  #actorVel: Vec3 = ZERO;
  /** Each shot's free camera as last left (cleared when shots are added or deleted) */
  readonly #poses = new Map<number, Pose>();
  readonly #history = new ShotHistory();
  readonly #repeat = new Repeat();
  readonly #pitchKey = new TapHold();
  readonly #testKey = new TapHold();
  #clock = 0;
  /** Held keys; the presses and releases, the mouse's clicks, motion and wheel notches since the last frame */
  readonly #keys = new Set<string>();
  #pressed = new Set<string>();
  #released = new Set<string>();
  #clicks: number[] = [];
  #mouse = { x: 0, y: 0 };
  #wheel = 0;
  #padBefore: readonly boolean[] = [];
  #usingPad = false;
  #hudShown = "";
  #legendShown = "";

  constructor(host: HTMLElement, canvas: HTMLElement, actions: FlyHost) {
    this.#host = actions;
    this.#canvas = canvas;
    const div = (className: string, parent: HTMLElement): HTMLDivElement => {
      const d = document.createElement("div");
      d.className = className;
      parent.append(d);
      return d;
    };
    this.#root = document.createElement("div");
    this.#root.id = "fly-editor";
    this.#root.hidden = true;
    // The shot editor's HUD (§6.1)
    this.#hud = div("fly-hud", this.#root);
    const shot = div("fly-shot", this.#hud);
    div("fly-shot-label", shot).textContent = FLY_TEXT.shot;
    this.#count = div("fly-shot-count", shot);
    const time = div("fly-time", this.#hud);
    this.#time = div("fly-time-value", time);
    div("fly-time-label", time).textContent = FLY_TEXT.timeLimit;
    this.#rows = div("fly-rows", this.#hud);
    this.#meter = div("fly-meter", this.#hud);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 180 60");
    // (the arc from +39° to -39° about its pivot at the bottom, the needle inside it: ours)
    const arc = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const r = METER.radius;
    const [ax, ay] = [METER.pivot.x - r * Math.sin((39 * Math.PI) / 180), METER.pivot.y - r * Math.cos((39 * Math.PI) / 180)];
    arc.setAttribute("d", `M ${ax.toFixed(1)} ${ay.toFixed(1)} A ${String(r)} ${String(r)} 0 0 1 ${(2 * METER.pivot.x - ax).toFixed(1)} ${ay.toFixed(1)}`);
    arc.setAttribute("class", "fly-meter-arc");
    this.#needle = document.createElementNS("http://www.w3.org/2000/svg", "line");
    this.#needle.setAttribute("x1", String(METER.pivot.x));
    this.#needle.setAttribute("y1", String(METER.pivot.y));
    this.#needle.setAttribute("x2", String(METER.pivot.x));
    this.#needle.setAttribute("y2", String(METER.pivot.y - r + 8));
    this.#needle.setAttribute("class", "fly-meter-needle");
    const pivot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    pivot.setAttribute("cx", String(METER.pivot.x));
    pivot.setAttribute("cy", String(METER.pivot.y));
    pivot.setAttribute("r", "4");
    pivot.setAttribute("class", "fly-meter-pivot");
    svg.append(arc, this.#needle, pivot);
    const meterRow = div("fly-meter-row", this.#meter);
    const less = document.createElement("span");
    const more = document.createElement("span");
    meterRow.append(less, svg, more);
    this.#meterKeys = { less, more };
    div("fly-meter-label", this.#meter).textContent = FLY_TEXT.strength;
    // The shot list (§4, §6.2)
    this.#list = div("fly-list", this.#root);
    const modes = div("fly-modes", this.#list);
    const mode = (label: string, on: boolean, click: () => void): void => {
      const b = document.createElement("button");
      b.className = "fly-mode";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", click);
      modes.append(b);
    };
    mode(FLY_TEXT.panel, false, () => {
      this.#host.panel();
    });
    mode(FLY_TEXT.freeCamera, true, () => undefined);
    this.#heading = div("fly-heading", this.#list);
    this.#packName = div("fly-pack-name", this.#list);
    this.#shots = div("fly-shots", this.#list);
    this.#create = document.createElement("button");
    this.#create.className = "fly-create";
    this.#create.textContent = FLY_TEXT.create;
    this.#create.addEventListener("click", () => {
      this.#add();
    });
    this.#list.append(this.#create);
    this.#context = div("fly-context", this.#list);
    this.#legend = div("fly-legend", this.#list);
    this.#dialog = div("fly-settings", this.#root);
    this.#dialog.hidden = true;
    host.append(this.#root);
    this.#listen();
  }

  get isOpen(): boolean {
    return this.#view === "list" || this.#view === "edit";
  }

  /** SEQUENCE SETTINGS while it's open (the pad's menu then: src/ui/padNav.ts), else null */
  get dialog(): HTMLElement | null {
    return this.#dialog.hidden ? null : this.#dialog;
  }

  /** The screen a pad drives as a menu (src/ui/padNav.ts: the D-pad's focus over its buttons, A pressing, B backing
   *  out): SEQUENCE SETTINGS while open, else the shot list while it shows; the shot editor's its own controls (null) */
  get padMenu(): HTMLElement | null {
    return this.dialog ?? (this.#view === "list" ? this.#list : null);
  }

  /** The editor's test playing (the editor hidden meanwhile) */
  get testing(): boolean {
    return this.#view === "test";
  }

  /** For the browser tests: where the editor is */
  get state(): { readonly view: View; readonly selection: Selection; readonly pitchLocked: boolean; readonly side: 1 | -1 } {
    return { view: this.#view, selection: this.#selection, pitchLocked: this.#pitchLocked, side: this.#side };
  }

  /** Open on the shot list, the selected shot's first camera */
  open(): void {
    this.#history.clear();
    this.#poses.clear();
    this.#selection = "free";
    this.#freePose = null;
    this.#cameraVel = this.#actorVel = ZERO;
    this.#camera = firstCamera(this.#shot());
    this.#view = "list";
    this.#root.hidden = false;
    this.#renderList();
    this.#show();
  }

  close(): void {
    this.#view = "closed";
    this.#root.hidden = true;
    this.#dialog.hidden = true;
    this.#unlock();
  }

  /** Escape: the details' dialog closed (whether it was open: else the editor's own leaving) */
  escape(): boolean {
    if (this.#dialog.hidden) return false;
    this.#dialog.hidden = true;
    return true;
  }

  /** The test over (Tab again, the pause menu's Back to Editor): back where it started, the shot as placed */
  endTest(): void {
    if (this.#view !== "test") return;
    this.#view = this.#testFrom;
    this.#root.hidden = false;
    this.#host.select(this.#host.index());
    this.#show();
  }

  /** A frame (`dt` real s): the input taken, the camera and the selection moved, the HUD drawn */
  frame(dt: number): void {
    if (this.#view === "closed") return;
    this.#clock += dt;
    const pad = readGamepad();
    const buttons = pad?.buttons.map((v) => v > 0.5) ?? [];
    const before = this.#padBefore;
    this.#padBefore = buttons;
    if (pad && (buttons.some(Boolean) || pad.axes.some((v) => Math.abs(v) > 0.5))) this.#usingPad = true;
    const padPressed = (i: number): boolean => (buttons[i] ?? false) && !(before[i] ?? false);
    const padReleased = (i: number): boolean => !(buttons[i] ?? false) && (before[i] ?? false);
    const pressed = this.#pressed;
    const released = this.#released;
    const clicks = this.#clicks;
    const mouse = this.#mouse;
    const wheel = this.#wheel;
    this.#pressed = new Set();
    this.#released = new Set();
    this.#clicks = [];
    this.#mouse = { x: 0, y: 0 };
    this.#wheel = 0;
    const now = this.#clock;
    if (this.#view === "test") {
      // (left from the pause menu: the editor closed with it)
      if (!this.#host.testing()) {
        this.close();
        this.#host.closed();
        return;
      }
      if (this.#host.blocked()) return;
      if (pressed.has("Tab") || padPressed(PAD.view)) this.#testKey.press(now);
      if ((released.has("Tab") || padReleased(PAD.view)) && this.#testKey.release(now) === "tap") this.endTest();
      return;
    }
    if (this.#host.blocked() || !this.#dialog.hidden) {
      this.#repeat.set(0);
      this.#host.camera(this.#cameraView());
      return;
    }
    if (this.#view === "list") this.#listFrame(pressed, released, padPressed, padReleased);
    else this.#editFrame(dt, pressed, released, clicks, mouse, wheel, pad, padPressed, padReleased);
    if (!this.testing) this.#host.camera(this.#cameraView());
    this.#draw();
  }

  /** The shot list's input: the pad's D-pad, A and B are its menu's (padMenu: a row focused is the shot selected, A
   *  presses); Tab tests the selected shot (the pad's View the sequence), the pad's Y a new shot and X the details (TE1 §4) */
  #listFrame(pressed: ReadonlySet<string>, released: ReadonlySet<string>, padPressed: (i: number) => boolean, padReleased: (i: number) => boolean): void {
    if (padPressed(PAD.y)) this.#add();
    if (padPressed(PAD.x)) this.#openSettings();
    const now = this.#clock;
    if (pressed.has("Tab") || padPressed(PAD.view)) this.#testKey.press(now);
    if (released.has("Tab") && this.#testKey.release(now) === "tap") this.#startTest("shot");
    else if (padReleased(PAD.view) && this.#testKey.release(now) === "tap") this.#startTest("sequence");
  }

  #editFrame(
    dt: number,
    pressed: ReadonlySet<string>,
    released: ReadonlySet<string>,
    clicks: readonly number[],
    mouse: { readonly x: number; readonly y: number },
    wheel: number,
    pad: { readonly axes: readonly number[]; readonly buttons: readonly number[] } | null,
    padPressed: (i: number) => boolean,
    padReleased: (i: number) => boolean,
  ): void {
    const now = this.#clock;
    if (pressed.has("ShiftLeft") || padPressed(PAD.b)) {
      this.#toList();
      return;
    }
    if (pressed.has("Tab") || padPressed(PAD.view)) this.#testKey.press(now);
    if ((released.has("Tab") || padReleased(PAD.view)) && this.#testKey.release(now) === "tap") {
      this.#startTest("shot");
      return;
    }
    if (clicks.includes(0) || padPressed(PAD.a)) this.#cycle();
    if (clicks.includes(2) || padPressed(PAD.y)) this.#release();
    if (clicks.includes(1) || padPressed(PAD.r3)) this.#side = this.#side === 1 ? -1 : 1;
    if (pressed.has("ArrowUp") || padPressed(PAD.up)) this.#change(stepTime(this.#shot(), 1));
    if (pressed.has("ArrowDown") || padPressed(PAD.down)) this.#change(stepTime(this.#shot(), -1));
    if (pressed.has("KeyZ") || padPressed(PAD.left)) this.#undo();
    if (pressed.has("KeyX") || padPressed(PAD.right)) this.#redo();
    // (R or X: a tap the pitch lock, a hold the pitch back to 0 and locked; the car's alone)
    if (pressed.has("KeyR") || padPressed(PAD.x)) this.#pitchKey.press(now);
    if (this.#pitchKey.poll(now) === "hold" && this.#selection === "car") {
      this.#pitchLocked = true;
      this.#change(resetPitch(this.#shot()));
    }
    if ((released.has("KeyR") || padReleased(PAD.x)) && this.#pitchKey.release(now) === "tap" && this.#selection === "car") this.#pitchLocked = !this.#pitchLocked;
    // (the speed: a step a wheel notch; the bumpers a step at once, then repeating)
    const bumper = (pad?.buttons[PAD.rb] ?? 0) > 0.5 ? 1 : (pad?.buttons[PAD.lb] ?? 0) > 0.5 ? -1 : 0;
    const steps = wheel + this.#repeat.set(bumper) + this.#repeat.tick(dt);
    if (steps !== 0 && this.#selection !== "free") this.#change(stepSpeed(this.#shot(), this.#selection, steps));
    // (the flight: the free camera's, else the selection's along the camera's yaw, the look turning it)
    const { move, yaw, pitch } = readMove((code) => this.#keys.has(code), pad, mouse, dt);
    const still = move.forward === 0 && move.right === 0 && move.up === 0;
    const settle = (v: Vec3): Vec3 => (still && Math.hypot(v.x, v.y, v.z) < 1 ? ZERO : v);
    if (this.#selection === "free") {
      const vel = (this.#cameraVel = settle(flyVelocity(this.#cameraVel, move, this.#camera.yaw, dt)));
      const p = this.#camera.pos;
      this.#camera = lookPose({ ...this.#camera, pos: clampTo("camera", vec3(p.x + vel.x * dt, p.y + vel.y * dt, p.z + vel.z * dt)) }, yaw, pitch);
      return;
    }
    const vel = (this.#actorVel = settle(flyVelocity(this.#actorVel, move, this.#camera.yaw, dt)));
    const by = vec3(vel.x * dt, vel.y * dt, vel.z * dt);
    if (by.x !== 0 || by.y !== 0 || by.z !== 0 || yaw !== 0 || pitch !== 0) {
      const shot = this.#shot();
      this.#change(this.#selection === "ball" ? editBall(shot, by, yaw, pitch) : editCar(shot, by, yaw, pitch, this.#pitchLocked));
    }
    this.#camera = follow(this.#camera, behind(this.#shot(), this.#selection, this.#side), dt);
  }

  /** The selected shot */
  #shot(): Shot {
    const pack = this.#host.pack();
    const shot = pack.shots[this.#host.index()] ?? pack.shots[0];
    if (!shot) throw new Error("a pack without shots");
    return shot;
  }

  /** An edit of the selected shot (one undo step once the edits pause): nothing if it's the same */
  #change(next: Shot): void {
    const shot = this.#shot();
    if (sameShot(next, shot)) return;
    this.#history.edited(shot, this.#clock);
    this.#host.edit(next);
  }

  #undo(): void {
    const back = this.#history.undo(this.#shot());
    if (back) this.#host.edit(back);
  }

  #redo(): void {
    const ahead = this.#history.redo(this.#shot());
    if (ahead) this.#host.edit(ahead);
  }

  /** Edit Ball / Edit Car: the ball first (the free camera kept for Free Cam), then each in turn; the camera snapped
   *  behind it */
  #cycle(): void {
    if (this.#selection === "free") this.#freePose = this.#camera;
    const next = cycle(this.#selection);
    this.#selection = next;
    this.#actorVel = ZERO;
    this.#camera = behind(this.#shot(), next, this.#side);
  }

  /** Free Cam: nothing selected, the camera where it was */
  #release(): void {
    if (this.#selection === "free") return;
    this.#selection = "free";
    this.#camera = this.#freePose ?? this.#camera;
    this.#freePose = null;
    this.#cameraVel = ZERO;
  }

  /** The shot editor on the selected shot (the free camera; the pointer captured at the first click) */
  #edit(): void {
    this.#view = "edit";
    this.#selection = "free";
    this.#cameraVel = ZERO;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.#show();
  }

  /** Shot List: the selection let go, the pointer freed */
  #toList(): void {
    this.#release();
    this.#view = "list";
    this.#unlock();
    this.#renderList();
    this.#show();
  }

  #startTest(kind: TestKind): void {
    this.#testFrom = this.#view === "list" ? "list" : "edit";
    this.#release();
    this.#view = "test";
    this.#root.hidden = true;
    this.#host.test(kind);
  }

  /** Another shot selected in the list: its own free camera (as last left, else its first), no undo across shots */
  #select(index: number): void {
    const from = this.#host.index();
    if (index === from) return;
    this.#poses.set(from, this.#camera);
    this.#host.select(index);
    this.#history.clear();
    this.#camera = this.#poses.get(index) ?? firstCamera(this.#shot());
    this.#cameraVel = ZERO;
    this.#markSelected();
  }

  #add(): void {
    if (this.#host.pack().shots.length >= PACK_LIMITS.shots) return;
    this.#poses.clear();
    this.#host.add();
    this.#history.clear();
    this.#renderList();
  }

  #duplicate(): void {
    if (this.#host.pack().shots.length >= PACK_LIMITS.shots) return;
    this.#poses.clear();
    this.#host.duplicate();
    this.#history.clear();
    this.#renderList();
  }

  #remove(): void {
    if (this.#host.pack().shots.length <= 1) return;
    this.#poses.clear();
    this.#host.remove();
    this.#history.clear();
    this.#camera = firstCamera(this.#shot());
    this.#renderList();
  }

  /** Which screen shows: the list's or the editor's HUD */
  #show(): void {
    this.#list.hidden = this.#view !== "list";
    this.#hud.hidden = this.#view !== "edit";
    this.#hudShown = "";
    this.#draw();
  }

  #cameraView(): CameraView {
    const { forward, up } = axes(this.#camera.yaw, this.#camera.pitch);
    return { position: this.#camera.pos, forward, up, horizontalFov: FOV };
  }

  #glyph(action: Action): KeyGlyph | null {
    const input = INPUTS[action];
    if (this.#usingPad) return keyGlyph(input.gamepad);
    return input.keyboard ? keyGlyph(input.keyboard) : null;
  }

  /** The HUD (its rows rebuilt only when they change), the meter at the selection, the list's legend */
  #draw(): void {
    if (this.#view === "list") {
      const legend = JSON.stringify([this.#usingPad, this.#glyph("settings"), this.#glyph("sequence"), this.#glyph("menu")]);
      if (legend !== this.#legendShown) {
        this.#legendShown = legend;
        this.#renderLegend();
      }
      return;
    }
    if (this.#view !== "edit") return;
    const pack = this.#host.pack();
    const shot = this.#shot();
    const count = `${String(this.#host.index() + 1)}/${String(pack.shots.length)}`;
    if (this.#count.textContent !== count) this.#count.textContent = count;
    const time = trainingClock(shot.timeLimit);
    if (this.#time.textContent !== time) this.#time.textContent = time;
    const rows = hudRows(this.#selection);
    const shown = JSON.stringify([rows, rows.map((r) => this.#glyph(r.action)), this.#glyph("less"), this.#glyph("more")]);
    if (shown !== this.#hudShown) {
      this.#hudShown = shown;
      this.#rows.replaceChildren(
        ...rows.map((r) => {
          const row = document.createElement("div");
          row.className = "fly-row";
          const glyph = this.#glyph(r.action);
          if (glyph) {
            const k = glyphElement(glyph);
            k.classList.add("fly-key");
            row.append(k, " ");
          }
          row.append(r.label);
          return row;
        }),
      );
      const keys = (el: HTMLSpanElement, action: Action): void => {
        const glyph = this.#glyph(action);
        el.replaceChildren(...(glyph ? [glyphElement(glyph)] : []));
      };
      keys(this.#meterKeys.less, "less");
      keys(this.#meterKeys.more, "more");
    }
    // (the strength meter under the selection: its speed over its most, no number)
    const selection = this.#selection;
    const at = selection === "free" ? null : this.#host.project(selection === "ball" ? shot.ball.location : shot.car.location);
    this.#meter.hidden = at === null;
    if (at) {
      this.#meter.style.transform = `translate(${(at.x - METER.width / 2).toFixed(1)}px, ${(at.y + METER.below).toFixed(1)}px)`;
      const degrees = selection === "ball" ? needleDegrees(shot.ball.speed, PACK_LIMITS.ballSpeed) : needleDegrees(shot.car.startSpeed, PACK_LIMITS.carSpeed);
      // (+39° the arc's left end: the needle turned against the clock)
      this.#needle.setAttribute("transform", `rotate(${(-degrees).toFixed(2)} ${String(METER.pivot.x)} ${String(METER.pivot.y)})`);
    }
  }

  /** The list's rows (the selected one with its duplicate and delete), the heading, CREATE NEW SHOT */
  #renderList(): void {
    const pack = this.#host.pack();
    this.#heading.textContent = packHeading(pack);
    this.#packName.textContent = pack.name;
    const full = pack.shots.length >= PACK_LIMITS.shots;
    this.#create.disabled = full;
    const hint = (el: HTMLElement, text: string): void => {
      const on = (): void => {
        this.#context.textContent = text;
      };
      el.addEventListener("mouseenter", on);
      el.addEventListener("focus", on);
    };
    this.#shots.replaceChildren(
      ...pack.shots.map((shot, i) => {
        const row = document.createElement("div");
        row.className = "fly-shot-row";
        row.dataset["index"] = String(i);
        const b = document.createElement("button");
        b.className = "fly-shot-button";
        const name = document.createElement("span");
        name.textContent = FLY_TEXT.shotRow(i + 1);
        const time = document.createElement("span");
        time.className = "fly-shot-time";
        time.textContent = trainingClock(shot.timeLimit);
        b.append(name, time);
        b.addEventListener("mouseenter", () => {
          this.#select(i);
        });
        b.addEventListener("focus", () => {
          this.#select(i);
        });
        b.addEventListener("click", () => {
          this.#select(i);
          this.#edit();
        });
        hint(b, FLY_TEXT.modify);
        const duplicate = this.#iconButton("fly-shot-duplicate", FLY_TEXT.duplicate, "M3 5h9v9H3z M6 2h9v9", () => {
          this.#duplicate();
        });
        duplicate.disabled = full;
        hint(duplicate, FLY_TEXT.duplicate);
        const remove = this.#iconButton("fly-shot-delete", FLY_TEXT.delete, "M3 4h12 M6 4V2h6v2 M4.5 4l1 12h7l1-12 M8 7v6 M10 7v6", () => {
          this.#remove();
        });
        // (never the only shot: TE1 §4)
        remove.hidden = pack.shots.length <= 1;
        hint(remove, FLY_TEXT.delete);
        row.append(b, duplicate, remove);
        return row;
      }),
    );
    this.#markSelected();
  }

  #iconButton(className: string, label: string, path: string, click: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `fly-shot-icon ${className}`;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = `<svg viewBox="0 0 18 18" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
    b.addEventListener("click", click);
    return b;
  }

  /** The selected row marked, its buttons shown */
  #markSelected(): void {
    const index = this.#host.index();
    for (const row of this.#shots.querySelectorAll<HTMLElement>(".fly-shot-row")) {
      const on = row.dataset["index"] === String(index);
      row.classList.toggle("selected", on);
      const button = row.querySelector<HTMLElement>(".fly-shot-button");
      button?.setAttribute("aria-current", String(on));
      // (a pad's focus starts on the selected shot when the list opens afresh)
      if (button) {
        if (on) button.dataset["padDefault"] = "";
        else delete button.dataset["padDefault"];
      }
    }
  }

  /** SEQUENCE SETTINGS, TEST SEQUENCE, OPEN MENU: each clickable, its pad button beside it (OPEN MENU's Escape too) */
  #renderLegend(): void {
    const item = (action: Action, label: string, click: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = "fly-legend-item";
      const glyph = this.#glyph(action);
      if (glyph) b.append(glyphElement(glyph), " ");
      b.append(label);
      b.addEventListener("click", click);
      return b;
    };
    this.#legend.replaceChildren(
      item("settings", FLY_TEXT.sequenceSettings, () => {
        this.#openSettings();
      }),
      item("sequence", FLY_TEXT.testSequence, () => {
        this.#startTest("sequence");
      }),
      item("menu", FLY_TEXT.openMenu, () => {
        this.#host.menu();
      }),
    );
  }

  /** SEQUENCE SETTINGS (§5.1): the name (focused), type, difficulty and up to 4 tags; ACCEPT or CANCEL */
  #openSettings(): void {
    const pack = this.#host.pack();
    let tags = [...pack.tags];
    const title = document.createElement("div");
    title.className = "fly-settings-title";
    title.textContent = FLY_TEXT.sequenceSettings;
    const name = document.createElement("input");
    name.type = "text";
    name.className = "fly-settings-name";
    name.value = pack.name;
    name.maxLength = 30;
    name.placeholder = FLY_TEXT.name;
    name.setAttribute("aria-label", FLY_TEXT.name);
    const select = <T extends string>(label: string, options: readonly (readonly [T, string])[], value: T): HTMLSelectElement => {
      const s = document.createElement("select");
      s.className = "fly-settings-select";
      s.setAttribute("aria-label", label);
      for (const [v, text] of options) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = text;
        o.selected = v === value;
        s.append(o);
      }
      return s;
    };
    // (Striker and Goalie, the game's; a pack's Aerial kept as it is)
    const types: TrainingType[] = pack.type === "aerial" ? ["striker", "goalie", "aerial"] : ["striker", "goalie"];
    const type = select<TrainingType>("Type", types.map((t) => [t, FLY_TEXT.types[t]] as const), pack.type);
    const difficulty = select<Difficulty>("Difficulty", (Object.keys(FLY_TEXT.difficulties) as Difficulty[]).map((d) => [d, FLY_TEXT.difficulties[d]] as const), pack.difficulty);
    const tagsButton = document.createElement("button");
    tagsButton.className = "fly-settings-tags-button";
    const tagList = document.createElement("div");
    tagList.className = "fly-settings-tags";
    tagList.hidden = true;
    const showTags = (): void => {
      tagsButton.textContent = tags.length === 0 ? FLY_TEXT.selectTags : tags.map(tagLabel).join(",");
      for (const b of tagList.querySelectorAll<HTMLButtonElement>("button")) {
        const on = tags.includes(b.dataset["tag"] ?? "");
        b.setAttribute("aria-pressed", String(on));
        // (4 at most: TE1 §5.1)
        b.disabled = !on && tags.length >= 4;
      }
    };
    for (const tag of TRAINING_TAGS) {
      const b = document.createElement("button");
      b.className = "fly-settings-tag";
      b.dataset["tag"] = tag;
      b.textContent = tagLabel(tag);
      b.addEventListener("click", () => {
        tags = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
        showTags();
      });
      tagList.append(b);
    }
    tagsButton.addEventListener("click", () => {
      tagList.hidden = !tagList.hidden;
    });
    showTags();
    const buttons = document.createElement("div");
    buttons.className = "fly-settings-buttons";
    const accept = document.createElement("button");
    accept.className = "fly-settings-accept";
    accept.textContent = FLY_TEXT.accept;
    accept.addEventListener("click", () => {
      const details: PackDetails = { name: name.value.trim(), type: type.value as TrainingType, difficulty: difficulty.value as Difficulty, tags };
      if (!this.#host.details(details)) return;
      this.#dialog.hidden = true;
      this.#renderList();
    });
    const cancel = document.createElement("button");
    cancel.className = "fly-settings-cancel";
    cancel.textContent = FLY_TEXT.cancel;
    cancel.addEventListener("click", () => {
      this.#dialog.hidden = true;
    });
    buttons.append(accept, cancel);
    const box = document.createElement("div");
    box.className = "fly-settings-box";
    box.append(title, name, type, difficulty, tagsButton, tagList, buttons);
    this.#dialog.replaceChildren(box);
    this.#dialog.hidden = false;
    name.focus();
  }

  #unlock(): void {
    if (document.pointerLockElement === this.#canvas) document.exitPointerLock();
  }

  /** The keys, the mouse's buttons, motion and wheel (the editor's own: free play takes nothing while it's open) */
  #listen(): void {
    const editable = (t: EventTarget | null): boolean => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
    window.addEventListener("keydown", (e) => {
      if (this.#view === "closed" || editable(e.target) || !this.#dialog.hidden || this.#host.blocked()) return;
      // (on the list, Tab moves the focus while one of its buttons has it: the keyboard's way through them, RX25)
      if (this.#view === "list" && e.code === "Tab" && e.target instanceof HTMLElement && this.#root.contains(e.target)) return;
      // (Tab the editor's Test Shot, not the focus's; Space and the arrows its, not a button's or the page's; with Ctrl down
      // (Move Down) no browser shortcut but those a page can't stop (Ctrl+W): Ctrl+R's reload among them, RX25)
      if (e.code === "Tab" || (this.#view === "edit" && (e.ctrlKey || ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)))) e.preventDefault();
      this.#usingPad = false;
      this.#keys.add(e.code);
      if (!e.repeat) this.#pressed.add(e.code);
      if (this.#view === "list" && e.code === "Enter" && !(e.target instanceof HTMLButtonElement)) this.#edit();
      if (this.#view === "list" && (e.code === "ArrowUp" || e.code === "ArrowDown")) {
        e.preventDefault();
        const count = this.#host.pack().shots.length;
        this.#select((this.#host.index() + (e.code === "ArrowUp" ? count - 1 : 1)) % count);
      }
    });
    window.addEventListener("keyup", (e) => {
      if (this.#keys.delete(e.code)) this.#released.add(e.code);
    });
    window.addEventListener("blur", () => {
      for (const k of this.#keys) this.#released.add(k);
      this.#keys.clear();
    });
    this.#canvas.addEventListener("mousedown", (e) => {
      if (this.#view !== "edit" || !this.#dialog.hidden) return;
      this.#usingPad = false;
      if (document.pointerLockElement !== this.#canvas) {
        // (a refusal, as headless, leaves the mouse free: the keys still fly)
        const lock = (options?: PointerLockOptions): Promise<void> | undefined => this.#canvas.requestPointerLock(options);
        lock({ unadjustedMovement: true })?.catch(() => lock()?.catch(() => undefined));
      }
      this.#clicks.push(e.button);
    });
    window.addEventListener("mousemove", (e) => {
      if (this.#view !== "edit" || document.pointerLockElement !== this.#canvas) return;
      this.#mouse = { x: this.#mouse.x + e.movementX, y: this.#mouse.y + e.movementY };
    });
    this.#canvas.addEventListener(
      "wheel",
      (e) => {
        if (this.#view !== "edit") return;
        e.preventDefault();
        if (e.deltaY !== 0) this.#wheel += e.deltaY < 0 ? 1 : -1;
      },
      { passive: false },
    );
  }
}
