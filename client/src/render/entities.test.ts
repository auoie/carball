import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { BALL_RADIUS, BallView, BoostPadsView, patchedBallGeometry } from "./entities";

describe("ball", () => {
  it("has twelve five-triangle patches, so its spin shows", () => {
    const geometry = patchedBallGeometry();
    const colors = geometry.getAttribute("color");
    const positions = geometry.getAttribute("position");
    let dark = 0;
    for (let i = 0; i < colors.count; i += 3) if (colors.getX(i) < 0.1) dark++;
    expect(dark).toBe(12 * 5);
    for (let i = 0; i < positions.count; i++) {
      const r = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      expect(r).toBeCloseTo(BALL_RADIUS, 3);
    }
  });
});

describe("boost pads", () => {
  const pads = [
    { pos: vec3(0, -4240, 70), big: false, active: true, cooldown: 0 },
    { pos: vec3(-3584, 0, 73), big: true, active: true, cooldown: 0 },
    { pos: vec3(1788, 2300, 70), big: false, active: true, cooldown: 0 },
  ];
  /** Where each mesh draws a pad (Three's x, y, z), or null where it's hidden. */
  const drawn = (view: BoostPadsView): Record<string, ([number, number, number] | null)[]> => {
    const out: Record<string, ([number, number, number] | null)[]> = {};
    view.root.children.forEach((child, i) => {
      if (!(child instanceof InstancedMesh)) return;
      const m = new Matrix4();
      out[i] = Array.from({ length: child.count }, (_, k) => {
        child.getMatrixAt(k, m);
        const p = new Vector3().setFromMatrixPosition(m);
        return m.determinant() === 0 ? null : [p.x, p.y, p.z]; // (hidden instances are scaled to 0)
      });
    });
    return out;
  };

  it("draws every pad in eight instanced meshes, lit, with its orb", () => {
    const view = new BoostPadsView(pads);
    expect(view.root.children).toHaveLength(8);
    // Big: lit discs, dim discs, orbs; then small; then the big pads' warm-up ghosts (all the delay, the last second)
    expect(drawn(view)).toEqual({
      0: [[-3584, 3, 0]],
      1: [null],
      2: [[-3584, 70, 0]],
      3: [[0, 3, -4240], [1788, 3, 2300]],
      4: [null, null],
      5: [[0, 12, -4240], [1788, 12, 2300]],
      6: [null],
      7: [null],
    });
  });

  it("warms a taken big pad up over its delay, and pulses in the last second (the game's AlmostSpawnedTime)", () => {
    const view = new BoostPadsView(pads);
    const scale = (mesh: number, slot: number): number => {
      const m = new Matrix4();
      (view.root.children[mesh] as InstancedMesh).getMatrixAt(slot, m);
      return Math.cbrt(m.determinant());
    };
    // The big pad, taken: 5 s of its 10 left; then 0.5 s left
    view.update(pads.map((p, i) => (i === 1 ? { ...p, active: false, cooldown: 5 } : p)));
    const half = scale(6, 0);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.5); // (the glow eases in: 1 - sqrt(1 - 0.5^2) = 0.13)
    expect(scale(7, 0)).toBe(0);
    view.update(pads.map((p, i) => (i === 1 ? { ...p, active: false, cooldown: 0.5 } : p)));
    expect(scale(6, 0)).toBeGreaterThan(half);
    expect(scale(7, 0)).toBeGreaterThan(0.8);
    // Back: the ghosts go
    view.update(pads);
    expect(scale(6, 0)).toBe(0);
    expect(scale(7, 0)).toBe(0);
  });

  it("small pads don't warm up (VT-13)", () => {
    const view = new BoostPadsView(pads);
    view.update(pads.map((p, i) => (i === 2 ? { ...p, active: false, cooldown: 0.5 } : p)));
    expect(view.root.children.length).toBe(8); // (no small ghosts at all)
  });

  it("taken: the light fades over 0.1 s (a big orb goes at once, a small pad stays, dark), then the dimmed disc", () => {
    const view = new BoostPadsView(pads);
    const light = (mesh: number, slot: number): number => {
      const c = new Color();
      (view.root.children[mesh] as InstancedMesh).getColorAt(slot, c);
      return c.r;
    };
    const taken = pads.map((p) => ({ ...p, active: false }));
    view.update(taken, 0.05);
    expect(drawn(view)[2]).toEqual([null]); // (the big orb at once)
    expect(drawn(view)[0]).toEqual([[-3584, 3, 0]]); // (its lit disc still fading)
    expect(light(0, 0)).toBeCloseTo(0.5, 6);
    expect(drawn(view)[5]).toEqual([[0, 12, -4240], [1788, 12, 2300]]); // (the small pads stay)
    view.update(taken, 0.06);
    expect(drawn(view)[0]).toEqual([null]);
    expect(drawn(view)[1]).toEqual([[-3584, 3, 0]]);
    expect(light(5, 1)).toBe(0); // (dark)
    // Back: the orb at once, the light fading in
    view.update(pads, 0.025);
    expect(drawn(view)[2]).toEqual([[-3584, 70, 0]]);
    expect(light(2, 0)).toBeCloseTo(0.25, 6);
    view.update(pads, 0.1);
    expect(light(2, 0)).toBe(1);
  });
});

describe("the ball's floor marker", () => {
  it("stays under the ball, the ball's size at any height, a little fainter high up", () => {
    const view = new BallView();
    const at = (x: number, y: number, z: number): { x: number; z: number; fade: number } => {
      view.update(new Vector3(x, y, z), new Quaternion());
      return view.marker;
    };
    expect(at(500, BALL_RADIUS, -800)).toEqual({ x: 500, z: -800, fade: 1 });
    const high = at(-1200, 1800, 300);
    expect([high.x, high.z]).toEqual([-1200, 300]);
    expect(high.fade).toBeLessThan(1);
    expect(at(0, 2000, 0).fade).toBeGreaterThanOrEqual(0.45); // (never gone: it's where the ball will come down)
  });
});

describe("the ball's look on a goal and at a kickoff (VT-15, VT-30)", () => {
  it("dissolves in 0.333 s once exploded (each frame's time capped at 1/30), its marker gone at once", () => {
    const view = new BallView();
    view.fade(true, 1 / 60);
    expect(view.opacity).toBeCloseTo(1 - 3 / 60, 9);
    for (let i = 0; i < 19; i++) view.fade(true, 1 / 60);
    expect(view.opacity).toBe(0);
    const slow = new BallView();
    slow.fade(true, 0.2); // (a long frame counts 1/30)
    expect(slow.opacity).toBeCloseTo(0.9, 9);
  });

  it("a new ball fades in over a second; a replay's is shown at once", () => {
    const view = new BallView();
    view.spawn();
    expect(view.opacity).toBe(0);
    view.fade(false, 0.5);
    expect(view.opacity).toBeCloseTo(0.5, 9);
    view.fade(false, 0.6);
    expect(view.opacity).toBe(1);
    view.spawn(true);
    expect(view.opacity).toBe(1);
  });
});
