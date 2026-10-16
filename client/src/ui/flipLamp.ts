// Our flip indicator as a dashboard tell-tale, drawn flat (the user's choices, 2026-10-16: as the boost meter borrows a
// rev gauge and the ball-cam indicator a camcorder's REC light, this one a car's warning lamp; flat as those two are, a
// modern digital dashboard's glowing pictogram, no bezel or glass): our own pictogram (a side-view car tipped under a
// curved rotation arrow, in the manner of a rollover lamp, copied from none) in flat fills, glowing amber, inside a thin
// flat ring; lit amber, dim on the wheels, very dim once spent, gold after a flip reset (style.css: #flip's states).
// Under it during the dodge window, the seconds left in the boost number's own style. All vector, sized by the HUD's stage.
import { setNumberText } from "./numberCells";

const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.appendChild(el);
  return el;
}

/** The lamp in its 100 x 100 box: the thin ring's radius and width */
export const LAMP = { ring: 44, ringWidth: 2.2 } as const;

/** The pictogram: a car (its body with its side windows cut through and its wheel arches cut out round its wheels, r 5.6
 *  about them, so they stand clear) tipped 20 degrees under a rotation arrow's arc (r 25 about (50, 52), from 200 to 340
 *  degrees, clockwise) and its head */
const CAR_BODY =
  "M -20 4 L -20 -1 Q -19 -4 -15 -4.5 L -9 -5 L -5 -10 Q -4 -11 -2 -11 L 7 -11 Q 9 -11 10 -10 L 14 -5 L 18 -4.5 Q 20 -4 20 -1 L 20 4 " +
  "L 17.58 4 A 5.6 5.6 0 0 0 6.42 4 L -6.42 4 A 5.6 5.6 0 0 0 -17.58 4 Z " +
  "M -4.2 -9.4 L -1.8 -9.4 L -1.8 -6 L -6.6 -6 Z M 0.2 -9.4 L 6.6 -9.4 Q 7.6 -9.4 8.2 -8.6 L 10.2 -6 L 0.2 -6 Z";
const WHEELS = [-12, 12] as const;
const ARROW_ARC = "M 26.51 43.45 A 25 25 0 0 1 73.49 43.45";
const ARROW_HEAD = "M 75.2 48.15 L 77.44 42.01 L 69.54 44.89 Z";

export class FlipLamp {
  readonly lamp: SVGSVGElement;
  readonly #seconds: HTMLElement;
  #shown: string | null = null;

  constructor(box: HTMLElement) {
    this.lamp = svg("svg", { viewBox: "0 0 100 100", class: "flip-lamp", "aria-hidden": "true" });
    svg("circle", { cx: "50", cy: "50", r: String(LAMP.ring), class: "flip-ring", "stroke-width": String(LAMP.ringWidth) }, this.lamp);
    const icon = svg("g", { class: "flip-icon" }, this.lamp);
    const car = svg("g", { transform: "translate(50 60) rotate(-20)" }, icon);
    svg("path", { d: CAR_BODY, "fill-rule": "evenodd" }, car);
    for (const x of WHEELS) svg("circle", { cx: String(x), cy: "4.5", r: "4" }, car);
    svg("path", { d: ARROW_ARC, class: "flip-icon-arc" }, icon);
    svg("path", { d: ARROW_HEAD }, icon);
    box.prepend(this.lamp);
    // The seconds, in the boost number's style (its font, its digit cells)
    this.#seconds = document.createElement("span");
    this.#seconds.className = "flip-seconds";
    this.#seconds.setAttribute("aria-hidden", "true");
    box.append(this.#seconds);
  }

  /** The seconds shown under the lamp ("0.6"; null: none) */
  digits(text: string | null): void {
    if (text === this.#shown) return;
    this.#shown = text;
    this.#seconds.classList.toggle("shown", text !== null);
    if (text !== null) setNumberText(this.#seconds, text);
  }

  /** A flip reset: the lamp flickers bright, then holds (its gold the state's) */
  flicker(): void {
    this.lamp.animate(
      [{ filter: "brightness(1)" }, { filter: "brightness(2.2)" }, { filter: "brightness(0.6)" }, { filter: "brightness(1.9)" }, { filter: "brightness(0.85)" }, { filter: "brightness(1.5)" }, { filter: "brightness(1)" }],
      { duration: 600, easing: "linear" },
    );
  }
}
