// A readout of the pads as the browser reports them, opt-in with `?pad` in the address (for telling us what a pad
// sends: its id, its mapping, the buttons held, the axes). Not part of the game's look.
import { gamepads } from "../input/devices";

export interface PadReport {
  readonly index: number;
  readonly id: string;
  readonly mapping: string;
  readonly pressed: readonly number[];
  readonly axes: readonly number[];
}

/** A pad's line */
export function padLine(pad: PadReport): string {
  const axes = pad.axes.map((a) => a.toFixed(2)).join(" ");
  return `#${String(pad.index)} ${pad.id} | mapping "${pad.mapping}" | held [${pad.pressed.join(", ")}] | axes ${axes}`;
}

export class PadReadout {
  readonly #el: HTMLPreElement;

  constructor(parent: HTMLElement) {
    this.#el = document.createElement("pre");
    this.#el.className = "pad-readout";
    parent.append(this.#el);
  }

  /** Each frame */
  update(): void {
    const pads = [...gamepads()].flatMap((pad) =>
      pad?.connected
        ? [{ index: pad.index, id: pad.id, mapping: pad.mapping, pressed: pad.buttons.flatMap((b, i) => (b.pressed || b.value > 0.5 ? [i] : [])), axes: pad.axes }]
        : [],
    );
    const text = pads.length > 0 ? pads.map(padLine).join("\n") : "no pad (press a button on it)";
    if (this.#el.textContent !== text) this.#el.textContent = text;
  }
}
