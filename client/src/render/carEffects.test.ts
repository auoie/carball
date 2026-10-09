// A car's boost and exhaust effects (VT-2; static analysis RV-50, RV-52b, RV-52f).
import { ConeGeometry, Mesh, type Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { CarView } from "./entities";
import { Particles } from "./particles";

const FRAME = 1 / 60;
const OCTANE = {
  hitboxSize: vec3(120.5, 86.7, 38.7),
  hitboxOffset: vec3(13.9, 0, 20.8),
  frontWheel: { offset: vec3(51.25, 25.9, 20.8), radius: 12.5, suspensionRest: 38.8 },
  backWheel: { offset: vec3(-33.75, 29.5, 20.8), radius: 15, suspensionRest: 37.1 },
};

function cone(root: Object3D): Mesh {
  const found: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && o.geometry instanceof ConeGeometry) found.push(o as Mesh);
  });
  const mesh = found[0];
  if (!mesh) throw new Error("no boost cone");
  return mesh;
}

describe("a car's exhausts", () => {
  it("two, at the Fennec's sockets (11.88 uu behind the hitbox, 12.86 up, 20.43 to each side): RV-50", () => {
    const particles = new Particles(() => 0.5);
    const car = new CarView(OCTANE, 0, particles);
    const at = new Vector3(0, 17, 0);
    for (let i = 0; i < 12; i++) car.update(at, new Quaternion(), false, false, false, FRAME, null, true);
    const puffs = particles.list();
    expect(puffs.length).toBeGreaterThanOrEqual(2);
    // (game frame: x forward, y right; the car at x 0 facing +x, its origin 17 up)
    const left = puffs.filter((p) => p.pos.y < -15);
    const right = puffs.filter((p) => p.pos.y > 15);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBe(left.length);
    for (const p of puffs) {
      expect(Math.abs(Math.abs(p.pos.y) - 20.43)).toBeLessThan(5.01);
      expect(p.pos.x).toBeLessThanOrEqual(OCTANE.hitboxOffset.x - OCTANE.hitboxSize.x / 2 - 11.88 + 1e-3);
      expect(p.pos.z).toBeCloseTo(17 + 12.8615, 0);
    }
  });

  it("demolished: its trail and exhaust puffs go at once (KillParticlesForced: RV-52f)", () => {
    const particles = new Particles(() => 0.5);
    const car = new CarView(OCTANE, 0, particles);
    for (let i = 0; i < 30; i++) car.update(new Vector3(i * 20, 17, 0), new Quaternion(), true, false, false, FRAME);
    expect(particles.count).toBeGreaterThan(20);
    car.update(new Vector3(600, 17, 0), new Quaternion(), false, true, false, FRAME);
    expect(particles.count).toBe(0);
  });

  it("the boost cone shows 0.1 s after the boost starts (BoostConeMesh's AttachDelay: RV-52b)", () => {
    const car = new CarView(OCTANE, 0);
    const at = new Vector3(0, 17, 0);
    car.update(at, new Quaternion(), true, false, false, FRAME);
    expect(cone(car.root).visible).toBe(false);
    for (let i = 0; i < 6; i++) car.update(at, new Quaternion(), true, false, false, FRAME);
    expect(cone(car.root).visible).toBe(true);
    car.update(at, new Quaternion(), false, false, false, FRAME);
    expect(cone(car.root).visible).toBe(false);
  });
});
