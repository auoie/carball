// The greenhouse's boost pads (ours, the game's idea): low pucks and round pedestals with a floating ball; the ball's pops,
// the big pads' recharge clock, few draws
import { InstancedMesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { BoostPadState } from "../engine/world";
import { ArenaView } from "./arena";
import { nightTheme } from "./themes/night";
import { TOKENS, TokenPadsView, popIn, popOut, ringFill, roundBase } from "./tokenPads";

const pad = (x: number, y: number, big: boolean, active = true, cooldown = 0): BoostPadState => ({ pos: { x, y, z: 0 }, big, active, cooldown });
const pads = (): BoostPadState[] => [pad(-3584, 0, true), pad(3584, 0, true), pad(0, -2816, false), pad(0, 2816, false), pad(-1792, -4184, false)];

describe("the pads' pops and clock", () => {
  it("the ball pops back in with a small overshoot; on a pickup it swells and fades out", () => {
    expect(popIn(0)).toBeCloseTo(0, 6);
    expect(popIn(1)).toBeCloseTo(1, 6);
    expect(Math.max(...Array.from({ length: 50 }, (_, k) => popIn(k / 49)))).toBeGreaterThan(1.02);
    expect(popOut(0)).toEqual({ scale: 1, fade: 1 });
    expect(popOut(1)).toEqual({ scale: 1.7, fade: 0 });
  });

  it("a big pad's ring fills over its 10 s (the VT-13 delay): empty when taken, full on its return", () => {
    expect(ringFill({ active: false, cooldown: 10 })).toBe(0);
    expect(ringFill({ active: false, cooldown: 2.5 })).toBeCloseTo(0.75, 6);
    expect(ringFill({ active: true, cooldown: 0 })).toBe(1);
  });
});

describe("the pads' view", () => {
  it("four instanced draws (pucks, pedestals, balls, halos), slightly 3D at the game's footprint, the pads' 3k triangle budget", () => {
    const view = new TokenPadsView(pads());
    const meshes = view.root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    expect(meshes.map((m) => m.count)).toEqual([3, 2, 2, 2]);
    const triangles = (m: InstancedMesh): number => (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3;
    // (a full field: 28 small pads, 6 big)
    const [pucks, pedestals, balls, halos] = meshes.map(triangles);
    const full = 28 * (pucks ?? 0) + 6 * ((pedestals ?? 0) + (balls ?? 0) + (halos ?? 0));
    expect(full).toBeLessThanOrEqual(3000);
    // (the game's bases' reach: the small's 48 uu, the big's ~90; raised off the grass)
    expect([TOKENS.puck.radius, TOKENS.pedestal.radius]).toEqual([48, 90]);
    expect(TOKENS.puck.height).toBeGreaterThan(4);
    expect(TOKENS.pedestal.height).toBeGreaterThan(TOKENS.puck.height);
  });

  it("a base's faces outward: its top up, its sides away from its axis", () => {
    const g = roundBase(48, 8, 4, 10);
    const p = g.getAttribute("position");
    const idx = g.index?.array ?? [];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] ?? 0, idx[t + 1] ?? 0, idx[t + 2] ?? 0].map((i) => new Vector3(p.getX(i), p.getY(i), p.getZ(i)));
      if (!a || !b || !c) continue;
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      const centre = new Vector3().add(a).add(b).add(c).divideScalar(3);
      const out = new Vector3(centre.x, 0, centre.z).normalize().add(new Vector3(0, centre.y >= 7.9 ? 1 : 0, 0));
      expect(n.dot(out)).toBeGreaterThan(0);
    }
  });

  it("a big pad's pickup: the ball swells and fades, then gone; the disc taken; a return pops the ball back", () => {
    const state = pads();
    const view = new TokenPadsView(state);
    const [, pedestals, balls] = view.root.children as InstancedMesh[];
    const scaleOf = (m: InstancedMesh | undefined, i: number): number => {
      const e = m?.instanceMatrix.array ?? [];
      return new Vector3(e[16 * i] ?? 0, e[16 * i + 1] ?? 0, e[16 * i + 2] ?? 0).length();
    };
    const lit = (i: number): number => pedestals?.instanceColor?.getY(i) ?? -1;
    expect(scaleOf(balls, 0)).toBeCloseTo(TOKENS.ball.radius, 3);
    state[0] = pad(-3584, 0, true, false, 10);
    view.update(state, 0.1);
    expect(scaleOf(balls, 0)).toBeGreaterThan(TOKENS.ball.radius);
    expect(lit(0)).toBe(0);
    view.update(state, TOKENS.pop.out);
    expect(scaleOf(balls, 0)).toBe(0);
    state[0] = pad(-3584, 0, true);
    view.update(state, 0.05);
    expect(scaleOf(balls, 0)).toBeGreaterThan(0);
    expect(scaleOf(balls, 0)).toBeLessThan(TOKENS.ball.radius);
    expect(lit(0)).toBe(1);
  });

  it("the arena makes them (Night's own pads)", () => {
    expect(new ArenaView(nightTheme()).createPads(pads())).toBeInstanceOf(TokenPadsView);
  });
});
