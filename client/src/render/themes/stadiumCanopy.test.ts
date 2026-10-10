// The glass canopy as the game's pieces (SUR-6, TRN-19..24): panels one-sided facing the field, fins two-sided, one
// layer each, an open wedge over each end's centre, each end mirror-symmetric about az 108.
import { Color, DoubleSide, FrontSide, type Material, type Mesh, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PRIORITY } from "../translucentSort";
import { CANOPY, buildCanopy } from "./stadiumCanopy";

const canopy = buildCanopy(new Color(0.1, 0.4, 1), new Color(1, 0.4, 0.1));
canopy.updateMatrixWorld(true);
const piece = (name: string): Mesh => canopy.children.find((m) => m.name === name) as Mesh;

describe("the glass canopy (SUR-6, TRN-19..24)", () => {
  it("16 panels (one-sided, -9) and 16 fins (two-sided, -7): four a quarter, each end and each side of its centre", () => {
    const [panels, fins] = [piece("bowl: canopy"), piece("bowl: canopy fins")];
    expect(panels.geometry.getAttribute("position").count).toBe(16 * 10 * 6);
    expect(fins.geometry.getAttribute("position").count).toBe(16 * 10 * 6);
    expect([(panels.material as Material).side, panels.renderOrder]).toEqual([FrontSide, PRIORITY.canopy]);
    expect([(fins.material as Material).side, fins.renderOrder]).toEqual([DoubleSide, PRIORITY.canopy2]);
  });

  it("the panels' faces toward the field, in and down (by area, the normal's elevation -45 to -65 as the surfaces' quadratics slope: P1 -47 to P3 -60; the mesh's median -44)", () => {
    const position = piece("bowl: canopy").geometry.getAttribute("position");
    const els: [number, number][] = [];
    for (let k = 0; k < position.count; k += 3) {
      const [a, b, c] = [0, 1, 2].map((i) => new Vector3().fromBufferAttribute(position, k + i)) as [Vector3, Vector3, Vector3];
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      const n = cross.clone().normalize();
      const toward = new Vector3(-a.x, 0, -a.z).normalize();
      expect(n.dot(toward), `triangle ${String(k / 3)}`).toBeGreaterThan(0);
      els.push([(Math.asin(n.y) * 180) / Math.PI, cross.length() / 2]);
    }
    els.sort((x, y) => x[0] - y[0]);
    const total = els.reduce((s, [, w]) => s + w, 0);
    let run = 0;
    const median = els.find(([, w]) => (run += w) >= total / 2)?.[0] ?? 0;
    expect(median, `median ${median.toFixed(1)}`).toBeLessThan(-45);
    expect(median, `median ${median.toFixed(1)}`).toBeGreaterThan(-65);
  });

  it("an open wedge over each end's centre (between F4 and its mirror: no glass at az 108 or 252, r 14.5-25k)", () => {
    const ray = new Raycaster();
    const glass = [piece("bowl: canopy"), piece("bowl: canopy fins")];
    for (const az of [108, 252]) {
      for (const el of [15, 20, 25, 30, 35]) {
        const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
        ray.set(new Vector3(0, 928, 0), new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
        expect(ray.intersectObjects(glass, false).length, `az ${String(az)} el ${String(el)}`).toBe(0);
      }
    }
  });

  it("mirror-symmetric about az 108 (and the -Y end the +Y end's mirror): the same glass seen at az 108 +- d", () => {
    const ray = new Raycaster();
    const glass = [piece("bowl: canopy")];
    const hit = (az: number, el: number): number => {
      const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
      ray.set(new Vector3(0, 928, 0), new Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)));
      return ray.intersectObjects(glass, false)[0]?.distance ?? -1;
    };
    // (the middles of P4, P3 and P2 where el 15 meets them)
    for (const d of [19, 29.5, 40]) {
      for (const el of [15]) {
        const [p, q, m] = [hit(108 - d, el), hit(108 + d, el), hit(-(108 - d), el)];
        expect(p, `az ${String(108 - d)} el ${String(el)}`).toBeGreaterThan(0);
        expect(Math.abs(p - q), `d ${String(d)} el ${String(el)}`).toBeLessThan(5);
        expect(Math.abs(p - m)).toBeLessThan(5);
      }
    }
  });

  it("the panels' corners on their surfaces within 250 uu (the quadratics' fits: rms 33-65; P1's free side not straight)", () => {
    for (const p of CANOPY.panels) {
      const phi = (p.phi * Math.PI) / 180;
      for (const [az, r, z] of p.outline) {
        const a = (az * Math.PI) / 180;
        const u = r * Math.cos(a) * Math.cos(phi) + r * Math.sin(a) * Math.sin(phi);
        expect(Math.abs(p.abc[0] * u * u + p.abc[1] * u + p.abc[2] - z), `phi ${String(p.phi)} az ${String(az)}`).toBeLessThan(250);
      }
    }
  });
});
