import { InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
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
    { pos: vec3(0, -4240, 70), big: false, active: true },
    { pos: vec3(-3584, 0, 73), big: true, active: true },
    { pos: vec3(1788, 2300, 70), big: false, active: true },
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

  it("draws every pad in six instanced meshes, lit, with its orb", () => {
    const view = new BoostPadsView(pads);
    expect(view.root.children).toHaveLength(6);
    // Big: lit discs, dim discs, orbs; then small
    expect(drawn(view)).toEqual({
      0: [[-3584, 3, 0]],
      1: [null],
      2: [[-3584, 70, 0]],
      3: [[0, 3, -4240], [1788, 3, 2300]],
      4: [null, null],
      5: [[0, 12, -4240], [1788, 12, 2300]],
    });
  });

  it("dims a pad that was taken and hides its orb, until it is back", () => {
    const view = new BoostPadsView(pads);
    view.update(pads.map((p, i) => ({ ...p, active: i !== 2 })));
    expect(drawn(view)[3]).toEqual([[0, 3, -4240], null]);
    expect(drawn(view)[4]).toEqual([null, [1788, 3, 2300]]);
    expect(drawn(view)[5]).toEqual([[0, 12, -4240], null]);
    view.update(pads);
    expect(drawn(view)[4]).toEqual([null, null]);
    expect(drawn(view)[5]).toEqual([[0, 12, -4240], [1788, 12, 2300]]);
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
