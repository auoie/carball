// The effects' values against the game's own (the static session's rl-fx/1 exports in out/bsim/assets_local/fx/:
// local, never in the repo; these tests skip without them). Start sizes, colours, lifetimes, the curves' knots.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMOLITION } from "./demolition";
import { BOOST_TRAIL, GOAL_EXPLOSION, IDLE_EXHAUST } from "./effects";
import type { Curve, Curve3, EmitterSpec, Range } from "./particles";

const FX = new URL("../../../out/bsim/assets_local/fx/", import.meta.url);
const present = existsSync(new URL("boost/boost_standard.json", FX)) && existsSync(new URL("explosion/explosion_default.json", FX));

interface DataCurve {
  readonly type: string;
  readonly times?: readonly number[];
  readonly values?: readonly (number | readonly number[])[];
  readonly value?: number | readonly number[];
}
interface Summary {
  readonly name: string;
  readonly render?: string;
  readonly lifetime?: number | { readonly min: number; readonly max: number };
  readonly start_size?: readonly (
    readonly number[] | { readonly min: readonly number[]; readonly max: readonly number[] } | { readonly default: readonly number[] }
  )[];
  readonly start_color?: readonly number[] | { readonly default: readonly number[] };
  readonly start_alpha?: number;
  readonly alpha_scale_over_life?: DataCurve;
  readonly size_over_life?: readonly DataCurve[];
  readonly velocity_over_life?: { readonly curve: DataCurve };
  readonly color_scale_over_life?: DataCurve;
}

function emitters(file: string): Summary[] {
  const data = JSON.parse(readFileSync(new URL(file, FX), "utf8")) as Record<string, unknown>;
  const systems = (data["particle_systems"] ?? data["particle_system"]) as Record<string, unknown>;
  const lists = "emitters" in systems ? [systems["emitters"]] : Object.values(systems).map((s) => (s as Record<string, unknown>)["emitters"]);
  return (lists.flat() as { summary?: Summary }[]).map((e) => e.summary ?? (e as Summary));
}

function find(list: Summary[], name: string, render = "sprite"): Summary {
  const s = list.find((e) => e.name === name && (e.render ?? "sprite") === render);
  if (!s) throw new Error(`no emitter ${name}`);
  return s;
}

const range = (r: Range): [number, number] => (typeof r === "number" ? [r, r] : [Math.min(r.min, r.max), Math.max(r.min, r.max)]);
const dataRange = (l: Summary["lifetime"]): [number, number] =>
  typeof l === "number" ? [l, l] : l ? [Math.min(l.min, l.max), Math.max(l.min, l.max)] : [0, 0];

/** The data's curve (one channel) against ours (a curve per channel: that channel's): every knot of the data on ours
 *  within `eps` */
function sameCurve(ours: Curve | Curve3 | undefined, data: DataCurve | undefined, channel = 0, eps = 2e-3): void {
  expect(ours, "a curve").toBeDefined();
  expect(data, "the data's curve").toBeDefined();
  if (!ours || !data?.times || !data.values) return;
  const value = (v: number | readonly number[]): number => (typeof v === "number" ? v : (v[channel] ?? 0));
  data.times.forEach((t, i) => {
    const want = value(data.values?.[i] ?? 0);
    const k = ours.times.findIndex((x) => Math.abs(x - t) < 1e-3);
    expect(k, `a knot at ${String(t)}`).toBeGreaterThanOrEqual(0);
    const got = value(ours.values[k] ?? 0);
    expect(Math.abs(got - want), `at ${String(t)}, channel ${String(channel)}`).toBeLessThan(Math.max(eps, Math.abs(want) * 2e-3));
  });
}

/** Every channel of a per-channel data curve (RV-87): ours per channel too */
function sameCurves(ours: Curve | Curve3 | undefined, data: DataCurve | undefined): void {
  const channels = Array.isArray(data?.values?.[0]) ? 3 : 1;
  for (let c = 0; c < channels; c++) sameCurve(ours, data, c);
}

const spec = (list: readonly EmitterSpec[], name: string): EmitterSpec => {
  const s = list.find((e) => e.name === name);
  if (!s) throw new Error(name);
  return s;
};

describe.skipIf(!present)("the effects against the game's data (local fx exports)", () => {
  it("Boost_Painted_PS (the trail) and Drive_PS (the idle exhaust)", () => {
    const boost = emitters("boost/boost_standard.json");
    const trail = boost.find((e) => e.name === "Particle Emitter");
    const drive = find(boost, "Main");
    expect(trail).toBeDefined();
    if (!trail) return;
    expect(range(BOOST_TRAIL.lifetime)).toEqual(dataRange(trail.lifetime));
    sameCurve(BOOST_TRAIL.alphaOverLife, trail.alpha_scale_over_life);
    sameCurve(BOOST_TRAIL.sizeOverLife, trail.size_over_life?.[0]);
    sameCurves(BOOST_TRAIL.velocityOverLife, trail.velocity_over_life?.curve);
    expect(range(IDLE_EXHAUST.lifetime)).toEqual(dataRange(drive.lifetime));
    sameCurve(IDLE_EXHAUST.alphaOverLife, drive.alpha_scale_over_life);
    sameCurve(IDLE_EXHAUST.sizeOverLife, drive.size_over_life?.[0]);
    expect(IDLE_EXHAUST.alpha).toBe(drive.start_alpha);
    expect(IDLE_EXHAUST.local).toBe(true);
  });

  it("Explosion_Default: every modelled emitter's lifetime, start alpha, size and velocity curves", () => {
    const explosion = emitters("explosion/explosion_default.json");
    const pairs: [string, string][] = [
      ["smoke puffs", "SmokePuffs"],
      ["smoke stretched", "SmokeStretched"],
      ["trail parents", "TrailParent"],
      ["sparks", "SparkParent"],
      ["outer sparks", "SparksOuter"],
      ["small flash", "FlashSmall"],
      ["big flash", "FlashBig"],
    ];
    for (const [ours, theirs] of pairs) {
      const s = spec(GOAL_EXPLOSION, ours);
      const d = find(explosion, theirs);
      expect(range(s.lifetime), ours).toEqual(dataRange(d.lifetime));
      sameCurve(s.alphaOverLife, d.alpha_scale_over_life);
      sameCurve(s.sizeOverLife, d.size_over_life?.[0], 0);
      if (s.lengthOverLife) sameCurve(s.lengthOverLife, d.size_over_life?.[0], 1);
      if (d.velocity_over_life) sameCurves(s.velocityOverLife, d.velocity_over_life.curve);
      if (d.color_scale_over_life?.type === "curve") sameCurves(typeof s.colorOverLife === "number" ? undefined : s.colorOverLife, d.color_scale_over_life);
      expect(s.alpha ?? 1, ours).toBe(d.start_alpha ?? 1);
    }
  });

  it.skipIf(!existsSync(new URL("demolition/demolition.json", FX)))("Demolished_New_PS: lifetimes, start alphas, the flash's curve", () => {
    const demolition = emitters("demolition/demolition.json");
    const pairs: [string, string][] = [
      ["demolition embers", "large_embers"],
      ["demolition smoke", "Smoke"],
      ["demolition fireball", "Menu"],
      ["demolition plume", "Up"],
      ["demolition flash", "Particle Emitter"],
    ];
    for (const [ours, theirs] of pairs) {
      const s = spec(DEMOLITION, ours);
      const d = find(demolition, theirs);
      expect(range(s.lifetime), ours).toEqual(dataRange(d.lifetime));
      expect(s.alpha ?? 1, ours).toBe(d.start_alpha ?? 1);
    }
    sameCurve(spec(DEMOLITION, "demolition flash").alphaOverLife, find(demolition, "Particle Emitter").alpha_scale_over_life);
  });
});

/** The rest of a data emitter's summary (rl-fx/1) */
interface Full extends Summary {
  readonly duration?: number;
  readonly delay?: number;
  readonly spawn?: { readonly rate: number; readonly rate_scale: number; readonly bursts: readonly { readonly time: number; readonly count: number }[] };
  readonly location?:
    | readonly {
        readonly sphere_radius?: number | DataCurve;
        readonly surface_only?: boolean;
        readonly velocity_scale?: number | { readonly min: number; readonly max: number };
      }[]
    | null;
  readonly color_scale_over_life?: DataCurve;
  readonly dynamic_params?: readonly { readonly name: string; readonly value: DataCurve }[];
}

/** A Range as [min, max] (either way round) */
const asRange = (r: Range | undefined): [number, number] | undefined => (r === undefined ? undefined : range(r));

/** Every field of ours that the data has, against it (RV-83): timing, spawning, start colour and size, the spawn
 *  sphere, the colour-scale curve, the material's fade parameter (P1, the first dynamic parameter) */
function sameEmitter(ours: EmitterSpec, data: Full, label: string): void {
  if (data.duration !== undefined) expect(ours.duration, `${label}: duration`).toBeCloseTo(data.duration, 6);
  if (data.delay !== undefined) expect(ours.delay ?? 0, `${label}: delay`).toBeCloseTo(data.delay, 6);
  if (data.spawn) {
    expect(ours.rate ?? 0, `${label}: rate`).toBeCloseTo(data.spawn.rate * data.spawn.rate_scale, 6);
    const bursts = data.spawn.bursts.filter((b) => b.count > 0).map((b) => ({ time: b.time, count: b.count }));
    expect(ours.bursts ?? [], `${label}: bursts`).toEqual(bursts);
  }
  const start = data.start_color;
  const colour = start && (Array.isArray(start) ? start : (start as { default: readonly number[] }).default);
  if (colour && Array.isArray(ours.color)) expect(ours.color, `${label}: start colour`).toEqual([...colour]);
  const size = data.start_size?.[0];
  if (size && !("default" in size)) {
    const [lo, hi] = "min" in size ? [size.min, size.max] : [size, size];
    expect(asRange(ours.size), `${label}: start size`).toEqual([Math.min(lo[0] ?? 0, hi[0] ?? 0), Math.max(lo[0] ?? 0, hi[0] ?? 0)]);
    if (ours.length !== undefined)
      expect(asRange(ours.length), `${label}: start length`).toEqual([Math.min(lo[1] ?? 0, hi[1] ?? 0), Math.max(lo[1] ?? 0, hi[1] ?? 0)]);
  }
  const sphere = data.location?.[0];
  if (sphere?.sphere_radius !== undefined) {
    expect(ours.sphere, `${label}: a spawn sphere`).toBeDefined();
    if (typeof sphere.sphere_radius === "number") expect(ours.sphere?.radius, `${label}: sphere radius`).toBe(sphere.sphere_radius);
    else sameCurve(ours.sphere?.radius as Curve, sphere.sphere_radius);
    expect(ours.sphere?.surface ?? false, `${label}: on the sphere's surface`).toBe(sphere.surface_only ?? false);
    const scale = sphere.velocity_scale;
    if (scale !== undefined) {
      expect(asRange(ours.sphere?.velocityScale), `${label}: sphere velocity scale`).toEqual(typeof scale === "number" ? [scale, scale] : range(scale));
    }
  }
  const cso = data.color_scale_over_life;
  if (cso?.type === "constant") {
    const v = cso.value;
    const ourScale = ours.colorOverLife;
    const constant =
      ourScale === undefined
        ? [1, 1, 1]
        : typeof ourScale === "number"
          ? [ourScale, ourScale, ourScale]
          : "times" in ourScale && ourScale.times.length === 1
            ? ourScale.values[0]
            : null;
    expect(constant, `${label}: a constant colour scale`).not.toBeNull();
    const want = typeof v === "number" ? [v, v, v] : v;
    want?.forEach((c, i) => {
      const got = Array.isArray(constant) ? (constant as readonly number[])[i] : constant;
      expect(got, `${label}: colour scale ${String(i)}`).toBeCloseTo(c, 3);
    });
  } else if (cso?.type === "curve") sameCurves(typeof ours.colorOverLife === "number" ? undefined : ours.colorOverLife, cso);
  const p1 = data.dynamic_params?.[0];
  if (ours.colorFade && p1?.value.type === "curve") sameCurve(ours.colorFade.param, p1.value);
}

describe.skipIf(!present)("every modelled emitter's fields against the game's data (RV-83)", () => {
  it("Explosion_Default: timing, spawning, start colour and size, the spawn sphere, colour scales, P1", () => {
    const explosion = emitters("explosion/explosion_default.json") as Full[];
    const pairs: [string, string][] = [
      ["smoke puffs", "SmokePuffs"],
      ["smoke stretched", "SmokeStretched"],
      ["trail parents", "TrailParent"],
      ["sparks", "SparkParent"],
      ["outer sparks", "SparksOuter"],
      ["small flash", "FlashSmall"],
      ["big flash", "FlashBig"],
    ];
    for (const [ours, theirs] of pairs) sameEmitter(spec(GOAL_EXPLOSION, ours), find(explosion, theirs), ours);
  });

  it("Drive_PS (the idle exhaust): its rate, size, colour, its colour scale 2 -> 0 and P1", () => {
    const boost = emitters("boost/boost_standard.json") as Full[];
    sameEmitter(IDLE_EXHAUST, find(boost, "Main"), "idle exhaust");
  });
});
