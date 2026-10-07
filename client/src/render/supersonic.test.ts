import { type BufferAttribute, Mesh, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { CarView } from "./entities";
import { TRAIL_SECONDS, Trail } from "./supersonic";

const FRAME = 1 / 60;
const OCTANE = {
  hitboxSize: vec3(120.5, 86.7, 38.7),
  hitboxOffset: vec3(13.9, 0, 20.8),
  frontWheel: { offset: vec3(51.25, 25.9, 20.8), radius: 12.5, suspensionRest: 38.8 },
  backWheel: { offset: vec3(-33.75, 29.5, 20.8), radius: 15, suspensionRest: 37.1 },
};

describe("supersonic trail", () => {
  it("grows while active, holds at most its lifetime of path, and fades out after", () => {
    const trail = new Trail();
    const at = new Vector3();
    for (let i = 0; i < 120; i++) trail.update(at.set(i * 38, 0, 0), true, FRAME); // (2300 uu/s)
    expect(trail.length).toBe(Math.floor(TRAIL_SECONDS / FRAME) + 1);
    expect(trail.mesh.visible).toBe(true);
    for (let t = 0; t <= TRAIL_SECONDS + FRAME; t += FRAME) trail.update(at, false, FRAME);
    expect(trail.length).toBe(0);
    expect(trail.mesh.visible).toBe(false);
  });

  it("breaks rather than streaking across the arena when the car jumps (a reset)", () => {
    const trail = new Trail();
    for (let i = 0; i < 10; i++) trail.update(new Vector3(i * 38, 0, 0), true, FRAME);
    trail.update(new Vector3(0, 0, -4000), true, FRAME);
    expect(trail.length).toBe(1);
  });

  it("a supersonic car leaves its trails behind it, and they go when it slows", () => {
    const car = new CarView(OCTANE, 0);
    const facingX = new Quaternion(); // (the car faces +x in its own frame)
    for (let i = 0; i < 30; i++) car.update(new Vector3(i * 38, 17, 0), facingX, true, false, true, FRAME);
    expect(car.trailLength).toBeGreaterThan(10);
    // Every point of the trails is behind the car's rear
    const child = car.root.children[1];
    if (!(child instanceof Mesh)) throw new Error("no trail");
    const trail = child as Mesh;
    const position = trail.geometry.getAttribute("position") as BufferAttribute;
    const front = 29 * 38 + OCTANE.hitboxOffset.x - OCTANE.hitboxSize.x / 2 + 5;
    for (let v = 0; v < car.trailLength * 2; v++) expect(position.getX(v)).toBeLessThan(front);
    for (let i = 0; i < 30; i++) car.update(new Vector3(1140 + i * 30, 17, 0), facingX, false, false, false, FRAME);
    expect(car.trailLength).toBe(0);
  });
});
