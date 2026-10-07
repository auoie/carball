// On-screen overlay: boost, the flip indicator, speed, score, camera mode, help.
import { DODGE_WINDOW, type Dodge } from "./game/flipTracker";
import { ACTIONS, type Bindings, inputName } from "./input/bindings";

export interface HudState {
  readonly boost: number;
  readonly speed: number; // uu/s
  readonly supersonic: boolean;
  readonly score: readonly [number, number];
  readonly ballCam: boolean;
  readonly message: string | null;
  readonly fps: number;
  readonly net: string | null; // online: ping and buffer
  /** Whether the car can dodge (null: the indicator is turned off) */
  readonly flip: Dodge | null;
  /** A flip reset happened since the last update */
  readonly flipReset: boolean;
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
  readonly #orange: HTMLElement;
  readonly #camera: HTMLElement;
  readonly #message: HTMLElement;
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

  constructor(root: HTMLElement) {
    this.#boostValue = element(root, "#boost-value", HTMLElement);
    const ring = root.querySelector("#boost-ring");
    if (!(ring instanceof SVGCircleElement)) throw new Error("HUD element #boost-ring missing");
    this.#boostRing = ring;
    this.#ringLength = 2 * Math.PI * ring.r.baseVal.value;
    this.#speed = element(root, "#speed", HTMLElement);
    this.#blue = element(root, "#score-blue", HTMLElement);
    this.#orange = element(root, "#score-orange", HTMLElement);
    this.#camera = element(root, "#camera-mode", HTMLElement);
    this.#message = element(root, "#message", HTMLElement);
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
    const boost = Math.round(s.boost);
    this.#boostValue.textContent = String(boost);
    this.#boostRing.style.strokeDasharray = `${(this.#ringLength * boost) / 100} ${this.#ringLength}`;
    this.#speed.textContent = `${Math.round(s.speed)} uu/s`;
    this.#speed.classList.toggle("supersonic", s.supersonic);
    this.#blue.textContent = String(s.score[0]);
    this.#orange.textContent = String(s.score[1]);
    this.#camera.textContent = s.ballCam ? "Ball cam" : "Car cam";
    this.#message.textContent = s.message ?? "";
    this.#message.hidden = s.message === null;
    this.#fps.textContent = `${Math.round(s.fps)} fps`;
    this.#net.textContent = s.net ?? "";
    this.#net.hidden = s.net === null;
    this.#updateFlip(s.flip, s.flipReset);
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
