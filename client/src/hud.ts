// On-screen overlay: boost, speed, score, camera mode, help.
import { ACTIONS, type Bindings, inputName } from "./input/bindings";

export interface HudState {
  readonly boost: number;
  readonly speed: number; // uu/s
  readonly supersonic: boolean;
  readonly score: readonly [number, number];
  readonly ballCam: boolean;
  readonly message: string | null;
  readonly fps: number;
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
  readonly #help: HTMLElement;
  readonly #ringLength: number;

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
    this.#help = element(root, "#help", HTMLElement);
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
  }
}
