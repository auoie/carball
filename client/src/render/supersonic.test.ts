import { type BufferAttribute, Mesh, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { vec3 } from "../math/vec";
import { CarView } from "./entities";
import { TRAIL_SECONDS, Trail, trailingRearWheels } from "./supersonic";
import { trailGround } from "./entities";

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
    const ground = { rearContact: [true, true] as const, forwardSpeed: 2300, sideSpeed: 0 };
    for (let i = 0; i < 30; i++) car.update(new Vector3(i * 38, 17, 0), facingX, true, false, true, FRAME, ground);
    expect(car.trailLength).toBe(Math.floor(TRAIL_SECONDS / FRAME) + 1); // (0.1 s of points)
    // Every point of the trails is behind the rear wheels
    const child = car.root.children[1];
    if (!(child instanceof Mesh)) throw new Error("no trail");
    const trail = child as Mesh;
    const position = trail.geometry.getAttribute("position") as BufferAttribute;
    // (from the rear tyres' contact points back)
    const front = 29 * 38 + OCTANE.backWheel.offset.x + 1;
    for (let v = 0; v < car.trailLength * 2; v++) expect(position.getX(v)).toBeLessThan(front);
    for (let i = 0; i < 30; i++) car.update(new Vector3(1140 + i * 30, 17, 0), facingX, false, false, false, FRAME, ground);
    expect(car.trailLength).toBe(0);
  });

  it("none in the air, nor from a wheel off the ground; sliding sideways, the wheel on the side away from the slide", () => {
    expect(trailingRearWheels(2300, 0)).toEqual([true, true]);
    expect(trailingRearWheels(-2300, 0)).toEqual([false, false]); // (reversing: the front wheels, which have no trail)
    expect(trailingRearWheels(400, 900)).toEqual([true, false]); // (sliding right: the left rear wheel, RV-29)
    expect(trailingRearWheels(400, -900)).toEqual([false, true]);
    expect(trailingRearWheels(1500, 900)).toEqual([true, true]); // (|side| under the forward speed)
    const car = new CarView(OCTANE, 0);
    const air = { rearContact: [false, false] as const, forwardSpeed: 2300, sideSpeed: 0 };
    for (let i = 0; i < 10; i++) car.update(new Vector3(i * 38, 300, 0), new Quaternion(), true, false, true, FRAME, air);
    expect(car.trailLength).toBe(0);
  });

  it("reads RocketSim's wheel order (front right, front left, back right, back left: RV-28)", () => {
    const rolledRightSideDown = { vel: { x: 2300, y: 0, z: 0 }, rot: { forward: { x: 1, y: 0, z: 0 }, right: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } }, wheelContact: [false, false, true, false] };
    expect(trailGround(rolledRightSideDown).rearContact).toEqual([false, true]); // (back right touching)
  });
});
