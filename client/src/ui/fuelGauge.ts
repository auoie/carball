// The boost meter as a car's fuel gauge (ours: the user's design, 2026-10-17; one dashboard with the flip lamp beside
// it; nothing of the game's meter): a flat semicircular dial on a dark translucent face, clean thin ticks every tenth
// (longer at E, the half and F), small E and F at the ends, an amber needle sweeping from E (0) to F (100) on a damped
// spring, the number under its hub in the HUD's number font and BOOST under that. Amber accents; the arc's band glowing
// calmly when full (no blinking), a soft red cue on the arc near E while low and a fuel-pump tell-tale in the dial (dim,
// lit amber at 15 or under, with a pulse as it lights: the flip lamp's style); a pickup brightens the needle and the arc
// for a moment. Flat SVG in the meter's 200 x 200 box (the HUD's stage scales it: ContentScale), drawn crisp.
const NS = "http://www.w3.org/2000/svg";

/** The dial (the meter's box, uu of its 200): the needle's pivot, the arc's radius, the ticks' (outer radius, minor and
 *  major length), the needle's reach and tail, the face's foot, the low cue's share, the needle's spring (rad/s), the
 *  fuel pump's centre (above the hub: clear of the needle whenever it's lit) */
export const GAUGE = {
  pivot: [100, 104] as const,
  arc: 80,
  ticks: { outer: 76, minor: 7, major: 13 },
  needle: { reach: 68, tail: 12 },
  foot: 174,
  low: 0.15,
  spring: 16,
  pump: [100, 70] as const,
} as const;

/** The needle's angle (degrees from straight up, clockwise) for a boost of 0-100: -90 at E, 90 at F */
export function needleAngle(boost: number): number {
  return -90 + 1.8 * Math.min(100, Math.max(0, boost));
}

/** A point at radius r and angle a (degrees from straight up, clockwise) about the pivot */
export function gaugePoint(r: number, a: number): readonly [number, number] {
  const t = (a * Math.PI) / 180;
  return [GAUGE.pivot[0] + r * Math.sin(t), GAUGE.pivot[1] - r * Math.cos(t)];
}

const pt = (r: number, a: number): string =>
  gaugePoint(r, a)
    .map((v) => v.toFixed(2))
    .join(" ");

/** An arc along radius r from angle a0 to a1 (clockwise) */
export function arcPath(r: number, a0: number, a1: number): string {
  return `M ${pt(r, a0)} A ${String(r)} ${String(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(r, a1)}`;
}

/** The ticks: every tenth from E to F, the ends and the half major */
export function gaugeTicks(): { readonly a: number; readonly major: boolean }[] {
  return Array.from({ length: 11 }, (_, i) => ({ a: needleAngle(i * 10), major: i % 5 === 0 }));
}

/** The face: the dial's half disc (radius arc + 14) over a rounded foot holding the number */
function facePath(): string {
  const r = GAUGE.arc + 14;
  const [cx, cy] = GAUGE.pivot;
  const corner = 14;
  return [
    `M ${String(cx - r)} ${String(cy)}`,
    `A ${String(r)} ${String(r)} 0 0 1 ${String(cx + r)} ${String(cy)}`,
    `L ${String(cx + r)} ${String(GAUGE.foot - corner)}`,
    `Q ${String(cx + r)} ${String(GAUGE.foot)} ${String(cx + r - corner)} ${String(GAUGE.foot)}`,
    `L ${String(cx - r + corner)} ${String(GAUGE.foot)}`,
    `Q ${String(cx - r)} ${String(GAUGE.foot)} ${String(cx - r)} ${String(GAUGE.foot - corner)}`,
    "Z",
  ].join(" ");
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.append(el);
  return el;
}

/** The needle's spring: critically damped toward its target (no overshoot to speak of, a smooth settle) */
export class NeedleSpring {
  value: number;
  #velocity = 0;

  constructor(value = 0) {
    this.value = value;
  }

  /** On by `seconds` toward `target` */
  step(target: number, seconds: number): number {
    const w = GAUGE.spring;
    // (exact for a critically damped spring over the step: x'' = -w^2 (x - t) - 2 w x')
    const dt = Math.min(Math.max(0, seconds), 0.1);
    const x0 = this.value - target;
    const v0 = this.#velocity;
    const e = Math.exp(-w * dt);
    const x = (x0 + (v0 + w * x0) * dt) * e;
    this.#velocity = (v0 - w * (v0 + w * x0) * dt) * e;
    this.value = target + x;
    return this.value;
  }
}

let gauges = 0;

export class FuelGaugeArt {
  readonly #needle: SVGGElement;
  readonly #flash: SVGGElement;
  readonly #spring = new NeedleSpring();
  #drawn = Number.NaN;
  #last = Number.NaN;

  /** `box`: the meter's box (#boost), its number and label already in it */
  constructor(box: HTMLElement) {
    const id = `gauge${String(gauges++)}`;
    const art = svg("svg", { viewBox: "0 0 200 200", "aria-hidden": "true", class: "gauge-art" });
    box.prepend(art);
    const defs = svg("defs", {}, art);
    const blur = svg("filter", { id: `${id}-glow`, x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
    svg("feGaussianBlur", { stdDeviation: "3.2" }, blur);
    svg("path", { d: facePath(), class: "gauge-face" }, art);
    // The arc: its track, the low cue's red near E, the full glow's band (blurred and sharp)
    const span = [needleAngle(0), needleAngle(100)] as const;
    svg("path", { d: arcPath(GAUGE.arc, ...span), class: "gauge-track" }, art);
    svg("path", { d: arcPath(GAUGE.arc, span[0], needleAngle(GAUGE.low * 100)), class: "gauge-low" }, art);
    svg("path", { d: arcPath(GAUGE.arc, ...span), class: "gauge-full-glow", filter: `url(#${id}-glow)` }, art);
    svg("path", { d: arcPath(GAUGE.arc, ...span), class: "gauge-full" }, art);
    for (const t of gaugeTicks()) {
      const inner = GAUGE.ticks.outer - (t.major ? GAUGE.ticks.major : GAUGE.ticks.minor);
      svg("path", { d: `M ${pt(inner, t.a)} L ${pt(GAUGE.ticks.outer, t.a)}`, class: t.major ? "gauge-tick major" : "gauge-tick" }, art);
    }
    // E and F, just inside the arc's ends
    for (const [text, a, cls] of [
      ["E", needleAngle(0), "gauge-e"],
      ["F", needleAngle(100), "gauge-f"],
    ] as const) {
      const [x, y] = gaugePoint(GAUGE.arc - 24, a + (a < 0 ? 10 : -10));
      const label = svg(
        "text",
        { x: x.toFixed(2), y: y.toFixed(2), class: `gauge-letter ${cls}`, "text-anchor": "middle", "dominant-baseline": "middle" },
        art,
      );
      label.textContent = text;
    }
    // The fuel pump (ours: a pump with its window, its foot, the hose up to the nozzle; 18 x 21 about its centre)
    const pump = svg("g", { class: "gauge-pump" }, art);
    const at = svg("g", { transform: `translate(${String(GAUGE.pump[0] - 8)} ${String(GAUGE.pump[1] - 11)})` }, pump);
    svg("path", { d: "M1.5 2 H9.5 Q11 2 11 3.5 V18.2 H0 V3.5 Q0 2 1.5 2 Z M2.2 4.6 V9 H8.8 V4.6 Z", "fill-rule": "evenodd", class: "gauge-pump-body" }, at);
    svg("path", { d: "M-1.5 18.2 H12.5 V20.6 H-1.5 Z", class: "gauge-pump-body" }, at);
    svg("path", { d: "M11 7.5 H13.4 Q14.6 7.5 14.6 8.7 V14.2 Q14.6 15.6 15.9 15.6 Q17.2 15.6 17.2 14.2 V6.2 L15.2 3.6", class: "gauge-pump-hose" }, at);
    // The pickup's brightening: the arc and needle lit white, fading
    this.#flash = svg("g", { class: "gauge-flash" }, art);
    svg("path", { d: arcPath(GAUGE.arc, ...span), class: "gauge-flash-arc", filter: `url(#${id}-glow)` }, this.#flash);
    // The needle: pointing up when unturned, turned about the pivot
    this.#needle = svg("g", { class: "gauge-needle" }, art);
    const [px, py] = GAUGE.pivot;
    svg(
      "path",
      { d: `M ${String(px)} ${String(py + GAUGE.needle.tail)} L ${String(px)} ${String(py - GAUGE.needle.reach)}`, class: "gauge-needle-line" },
      this.#needle,
    );
    svg("circle", { cx: String(px), cy: String(py), r: "6.5", class: "gauge-hub" }, art);
    this.#needle.setAttribute("transform", `rotate(${needleAngle(0).toFixed(2)} ${String(px)} ${String(py)})`);
  }

  /** The needle toward `boost` (0-100) at `now` (s): the spring's step since the last call */
  set(boost: number, now: number): void {
    const dt = Number.isFinite(this.#last) ? now - this.#last : Infinity;
    this.#last = now;
    const value = Number.isFinite(dt) ? this.#spring.step(boost, dt) : (this.#spring.value = boost);
    const a = needleAngle(value);
    if (Math.abs(a - this.#drawn) < 0.05) return;
    this.#drawn = a;
    this.#needle.setAttribute("transform", `rotate(${a.toFixed(2)} ${String(GAUGE.pivot[0])} ${String(GAUGE.pivot[1])})`);
  }

  /** A pickup: the arc and needle brighten and ease back over 0.6 s */
  flash(): void {
    const ease = { duration: 600, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
    this.#flash.animate([{ opacity: 1 }, { opacity: 0 }], ease);
    this.#needle.animate([{ filter: "brightness(1.8)" }, { filter: "brightness(1)" }], ease);
  }
}
