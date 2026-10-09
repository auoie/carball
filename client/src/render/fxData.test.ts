// The effects' values against the game's own (the static session's rl-fx/1 exports in out/bsim/assets_local/fx/:
// local, never in the repo; these tests skip without them). Start sizes, colours, lifetimes, the curves' knots.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMOLITION } from "./demolition";
import { BOOST_TRAIL, GOAL_EXPLOSION, IDLE_EXHAUST } from "./effects";
import type { Curve, EmitterSpec, Range } from "./particles";

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
  readonly start_size?: readonly (readonly number[] | { readonly min: readonly number[]; readonly max: readonly number[] } | { readonly default: readonly number[] })[];
  readonly start_color?: readonly number[] | { readonly default: readonly number[] };
  readonly start_alpha?: number;
  readonly alpha_scale_over_life?: DataCurve;
  readonly size_over_life?: readonly DataCurve[];
  readonly velocity_over_life?: { readonly curve: DataCurve };
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
const dataRange = (l: Summary["lifetime"]): [number, number] => (typeof l === "number" ? [l, l] : l ? [Math.min(l.min, l.max), Math.max(l.min, l.max)] : [0, 0]);

/** The data's curve (one channel) against ours: every knot of the data on ours within `eps` */
function sameCurve(ours: Curve | undefined, data: DataCurve | undefined, channel = 0, eps = 2e-3): void {
  expect(ours, "a curve").toBeDefined();
  expect(data, "the data's curve").toBeDefined();
  if (!ours || !data?.times || !data.values) return;
  const value = (v: number | readonly number[]): number => (typeof v === "number" ? v : (v[channel] ?? 0));
  data.times.forEach((t, i) => {
    const want = value(data.values?.[i] ?? 0);
    const k = ours.times.findIndex((x) => Math.abs(x - t) < 1e-3);
    expect(k, `a knot at ${String(t)}`).toBeGreaterThanOrEqual(0);
    expect(Math.abs((ours.values[k] ?? 0) - want), `at ${String(t)}`).toBeLessThan(Math.max(eps, Math.abs(want) * 2e-3));
  });
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
    sameCurve(BOOST_TRAIL.velocityOverLife as Curve, trail.velocity_over_life?.curve);
    expect(range(IDLE_EXHAUST.lifetime)).toEqual(dataRange(drive.lifetime));
    sameCurve(IDLE_EXHAUST.alphaOverLife, drive.alpha_scale_over_life);
    sameCurve(IDLE_EXHAUST.sizeOverLife, drive.size_over_life?.[0]);
    expect(IDLE_EXHAUST.alpha).toBe(drive.start_alpha);
    expect(IDLE_EXHAUST.local).toBe(true);
  });

  it("Explosion_Default: every modelled emitter's lifetime, start size and alpha, size and velocity curves", () => {
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
      if (d.velocity_over_life) sameCurve(s.velocityOverLife as Curve, d.velocity_over_life.curve);
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
