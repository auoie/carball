// On-screen overlay: boost, the flip indicator, speed, score, camera mode, help.
import type { SpawnSide } from "./engine/world";
import { DODGE_WINDOW, type Dodge } from "./game/flipTracker";
import { type VoteHud, voteFlashes } from "./game/forfeitVote";
import { ACTIONS, type Bindings, inputName } from "./input/bindings";

/** The local car demolished: its respawn and the respawn spot selection (the steer input picks a side). */
export interface RespawnHud {
  readonly secondsLeft: number;
  /** What's left of the 2.5 s to pick a spot, 1 .. 0 (0 once the spot is locked) */
  readonly pickLeft: number;
  readonly side: SpawnSide | null;
  readonly inner: boolean; // the inner spot of that side (else the outer)
  readonly locked: boolean;
}

/** RLConst DEMO_PRESPAWN_STATE_LENGTH: the spot locks this long before the respawn; the pick takes the rest. */
const PRESPAWN_SECONDS = 0.5;
const PICK_SECONDS = 2.5;

/** The HUD's respawn panel from a demolished car's state (null when it isn't). */
export function respawnHud(car: { readonly demoed: boolean; readonly demoRespawnTimer: number; readonly spawnSelection: { readonly side: SpawnSide | null; readonly index: number; readonly locked: unknown } }): RespawnHud | null {
  if (!car.demoed) return null;
  const locked = car.spawnSelection.locked !== null;
  return {
    secondsLeft: car.demoRespawnTimer,
    pickLeft: locked ? 0 : Math.min(1, Math.max(0, (car.demoRespawnTimer - PRESPAWN_SECONDS) / PICK_SECONDS)),
    side: car.spawnSelection.side,
    inner: car.spawnSelection.index === 0,
    locked,
  };
}

/** The boost meter's number (GFxHUD_TA.GetBoostAmountForUI): floor(pct · 100), at least 1 while any is left
 *  (notes/visual-timing.md VT-21) */
export function boostShown(boost: number): number {
  return boost <= 0 ? 0 : Math.min(100, Math.max(1, Math.floor(boost)));
}

export interface HudState {
  readonly boost: number;
  readonly speed: number; // uu/s
  readonly supersonic: boolean;
  readonly score: readonly [number, number];
  /** The match clock (null: no match, as in freeplay) */
  readonly clock: string | null;
  readonly ballCam: boolean;
  readonly message: string | null;
  /** A smaller line under the message (null: none) */
  readonly hint?: string | null;
  readonly fps: number;
  readonly net: string | null; // online: ping and buffer
  /** Whether the car can dodge (null: the indicator is turned off) */
  readonly flip: Dodge | null;
  /** A flip reset happened since the last update */
  readonly flipReset: boolean;
  /** The local car is demolished (null: it isn't) */
  readonly respawn: RespawnHud | null;
  /** The team's forfeit vote while it runs (null or absent: none; the widget fades out) */
  readonly vote?: VoteHud | null;
  /** The match's HUD parts shown (online, by phase: MIO-5/17; absent: both, as freeplay) */
  readonly parts?: { readonly scoreboard: boolean; readonly boost: boolean };
}

function element<T extends HTMLElement>(root: ParentNode, selector: string, type: new () => T): T {
  const el = root.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`HUD element ${selector} missing`);
  return el;
}

export class Hud {
  readonly #boostValue: HTMLElement;
  readonly #boostRing: SVGCircleElement;
  readonly #speed: HTMLElement;
  readonly #blue: HTMLElement;
  readonly #scoreBox: HTMLElement;
  readonly #boostBox: HTMLElement;
  readonly #clock: HTMLElement;
  readonly #orange: HTMLElement;
  readonly #camera: HTMLElement;
  readonly #message: HTMLElement;
  readonly #hint: HTMLElement;
  readonly #fps: HTMLElement;
  readonly #net: HTMLElement;
  readonly #help: HTMLElement;
  readonly #ringLength: number;
  readonly #flip: HTMLElement;
  readonly #flipRing: SVGCircleElement;
  readonly #flipLabel: HTMLElement;
  readonly #flipDetail: HTMLElement;
  readonly #flipToast: HTMLElement;
  readonly #flipRingLength: number;
  readonly #respawn: HTMLElement;
  readonly #respawnTime: HTMLElement;
  readonly #respawnLeft: HTMLElement;
  readonly #respawnRight: HTMLElement;
  readonly #respawnFill: HTMLElement;
  readonly #vote: HTMLElement;
  readonly #voteTally: HTMLElement;
  readonly #voteTime: HTMLElement;
  readonly #voteFill: HTMLElement;
  readonly #voteHint: HTMLElement;

  constructor(root: HTMLElement) {
    this.#boostValue = element(root, "#boost-value", HTMLElement);
    const ring = root.querySelector("#boost-ring");
    if (!(ring instanceof SVGCircleElement)) throw new Error("HUD element #boost-ring missing");
    this.#boostRing = ring;
    this.#ringLength = 2 * Math.PI * ring.r.baseVal.value;
    this.#speed = element(root, "#speed", HTMLElement);
    this.#blue = element(root, "#score-blue", HTMLElement);
    this.#scoreBox = element(root, "#score", HTMLElement);
    this.#boostBox = element(root, "#boost", HTMLElement);
    this.#orange = element(root, "#score-orange", HTMLElement);
    this.#clock = element(root, "#clock", HTMLElement);
    this.#camera = element(root, "#camera-mode", HTMLElement);
    this.#message = element(root, "#message", HTMLElement);
    this.#hint = element(root, "#message-hint", HTMLElement);
    this.#fps = element(root, "#fps", HTMLElement);
    this.#net = element(root, "#net", HTMLElement);
    this.#help = element(root, "#help", HTMLElement);
    this.#flip = element(root, "#flip", HTMLElement);
    const flipRing = root.querySelector("#flip-ring");
    if (!(flipRing instanceof SVGCircleElement)) throw new Error("HUD element #flip-ring missing");
    this.#flipRing = flipRing;
    this.#flipRingLength = 2 * Math.PI * flipRing.r.baseVal.value;
    this.#flipLabel = element(root, "#flip-label", HTMLElement);
    this.#flipDetail = element(root, "#flip-detail", HTMLElement);
    this.#flipToast = element(root, "#flip-toast", HTMLElement);
    this.#respawn = element(root, "#respawn", HTMLElement);
    this.#respawnTime = element(root, "#respawn-time", HTMLElement);
    this.#respawnLeft = element(root, "#respawn-left", HTMLElement);
    this.#respawnRight = element(root, "#respawn-right", HTMLElement);
    this.#respawnFill = element(root, "#respawn-fill", HTMLElement);
    this.#vote = element(root, "#vote", HTMLElement);
    this.#voteTally = element(root, "#vote-tally", HTMLElement);
    this.#voteTime = element(root, "#vote-time", HTMLElement);
    this.#voteFill = element(root, "#vote-fill", HTMLElement);
    this.#voteHint = element(root, "#vote-hint", HTMLElement);
  }

  /** Shows or hides the controls list, filled from the current bindings. */
  toggleHelp(bindings: Bindings): void {
    this.#help.hidden = !this.#help.hidden;
    if (this.#help.hidden) return;
    const rows = ACTIONS.map((a) => {
      const b = bindings[a.id];
      const row = document.createElement("tr");
      for (const text of [a.label, inputName(b.keyboard), inputName(b.gamepad)]) {
        const td = document.createElement("td");
        td.textContent = text;
        row.append(td);
      }
      return row;
    });
    const head = document.createElement("tr");
    for (const text of ["", "Keyboard & mouse", "Gamepad"]) {
      const th = document.createElement("th");
      th.textContent = text;
      head.append(th);
    }
    const table = document.createElement("table");
    table.append(head, ...rows);
    const title = document.createElement("h2");
    title.textContent = "Controls (Esc: change them)";
    this.#help.replaceChildren(title, table);
  }

  update(s: HudState): void {
    const boost = boostShown(s.boost);
    this.#boostValue.textContent = String(boost);
    this.#boostRing.style.strokeDasharray = `${(this.#ringLength * boost) / 100} ${this.#ringLength}`;
    this.#speed.textContent = `${Math.round(s.speed)} uu/s`;
    this.#speed.classList.toggle("supersonic", s.supersonic);
    this.#blue.textContent = String(s.score[0]);
    this.#orange.textContent = String(s.score[1]);
    this.#clock.textContent = s.clock ?? "";
    this.#scoreBox.hidden = !(s.parts?.scoreboard ?? true);
    this.#boostBox.hidden = !(s.parts?.boost ?? true);
    this.#clock.hidden = s.clock === null;
    this.#camera.textContent = s.ballCam ? "Ball cam" : "Car cam";
    this.#message.textContent = s.message ?? "";
    this.#message.hidden = s.message === null;
    this.#hint.textContent = s.hint ?? "";
    this.#hint.hidden = (s.hint ?? null) === null;
    this.#fps.textContent = `${Math.round(s.fps)} fps`;
    this.#net.textContent = s.net ?? "";
    this.#net.hidden = s.net === null;
    this.#updateFlip(s.flip, s.flipReset);
    this.#updateRespawn(s.respawn);
    this.#updateVote(s.vote ?? null);
  }

  #lastVote: VoteHud | null = null;

  /** (shown at once, faded out in 0.3 s, its last text kept while it fades; the bar flashes at each new vote) */
  #updateVote(v: VoteHud | null): void {
    this.#vote.classList.toggle("shown", v !== null);
    const last = this.#lastVote;
    this.#lastVote = v;
    if (v === null) return;
    if (voteFlashes(last, v)) this.#voteFill.animate([{ filter: "brightness(2.5)" }, { filter: "none" }], { duration: 400, easing: "ease-out" });
    this.#voteTally.textContent = v.tally;
    this.#voteTime.textContent = v.time;
    this.#voteFill.style.width = `${String(v.fill * 100)}%`;
    this.#voteHint.textContent = v.instructions ?? "";
    this.#voteHint.hidden = v.instructions === null;
  }

  #updateRespawn(r: RespawnHud | null): void {
    this.#respawn.hidden = r === null;
    if (r === null) return;
    this.#respawnTime.textContent = `Respawning in ${r.secondsLeft.toFixed(1)} s`;
    const spot = r.inner ? "inner" : "outer";
    this.#respawnLeft.textContent = r.side === "left" ? `◀ LEFT · ${spot}` : "◀ LEFT";
    this.#respawnRight.textContent = r.side === "right" ? `RIGHT · ${spot} ▶` : "RIGHT ▶";
    this.#respawnLeft.classList.toggle("picked", r.side === "left");
    this.#respawnRight.classList.toggle("picked", r.side === "right");
    this.#respawn.classList.toggle("locked", r.locked);
    this.#respawnFill.style.width = `${String(r.pickLeft * 100)}%`;
  }

  #updateFlip(dodge: Dodge | null, reset: boolean): void {
    this.#flip.hidden = dodge === null;
    if (dodge === null) return;
    // The ring: full when a dodge is there with no time limit, draining over the window after a jump
    const fill = dodge.kind === "window" ? dodge.remaining / DODGE_WINDOW : dodge.kind === "spent" ? 0 : 1;
    this.#flipRing.style.strokeDasharray = `${this.#flipRingLength * fill} ${this.#flipRingLength}`;
    this.#flipRing.style.visibility = fill > 0 ? "visible" : "hidden"; // (an empty ring would still show its round cap)
    const state = dodge.kind === "free" && dodge.reset ? "reset" : dodge.kind;
    this.#flip.dataset["state"] = state;
    this.#flipLabel.textContent = dodge.kind === "spent" ? "NO FLIP" : "FLIP";
    this.#flipDetail.textContent =
      dodge.kind === "window" ? `${dodge.remaining.toFixed(1)} s` : state === "reset" ? "RESET" : dodge.kind === "free" ? "∞" : "";
    if (reset) {
      // A pulse, and a toast rising and fading
      this.#flip.animate([{ transform: "scale(1.35)" }, { transform: "scale(1)" }], { duration: 500, easing: "ease-out" });
      this.#flipToast.animate(
        [
          { opacity: 0, transform: "translateY(12px) scale(0.9)" },
          { opacity: 1, transform: "translateY(0) scale(1.05)", offset: 0.12 },
          { opacity: 1, transform: "none", offset: 0.7 },
          { opacity: 0, transform: "translateY(-8px)" },
        ],
        { duration: 1200, easing: "ease-out" },
      );
    }
  }
}
