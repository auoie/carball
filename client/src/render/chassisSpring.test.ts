// The body's sway (src/render/chassisSpring.ts; notes/visual-timing.md VT-32, the static session's SU1): a mass held at a
// world position 100 above the body, a damped spring in the car's axes, gravity; its rest, its lean at a steady speed, the
// stops, the step's cap
import { describe, expect, it } from "vitest";
import { type Rot3, vec3 } from "../math/vec";
import { CHASSIS_SPRINGS, ChassisSpring, DEFAULT_SPRING, SPRING_MAX_DT } from "./chassisSpring";

const UPRIGHT: Rot3 = { forward: vec3(1, 0, 0), right: vec3(0, 1, 0), up: vec3(0, 0, 1) };
const DEGREES_PER_RAD = 180 / Math.PI;

/** The spring after `seconds` of a car moving at `speed` along +x from the origin, upright, at 120 frames a second */
function settle(car: number, speed: number, seconds = 6): ReturnType<ChassisSpring["step"]> {
  const spring = new ChassisSpring(CHASSIS_SPRINGS[car] ?? DEFAULT_SPRING);
  let sway = spring.step(vec3(0, 0, 0), UPRIGHT, 0);
  for (let t = 1; t <= seconds * 120; t++) sway = spring.step(vec3((speed * t) / 120, 0, 0), UPRIGHT, 1 / 120);
  return sway;
}

describe("the body's sway (VT-32)", () => {
  it("at rest: no pitch or roll, the body 0.65 uu lower (the mass 6.5 down on its 100/s² spring under -650)", () => {
    const sway = settle(0, 0);
    expect(sway.pitch).toBeCloseTo(0, 9);
    expect(sway.roll).toBeCloseTo(0, 9);
    expect(sway.z).toBeCloseTo(-0.65, 4);
  });

  it("at a steady 2300 uu/s the nose up, the lag 5V/k along the car (Sport's held at its 30 stop): 4.1°, 3.8°, 7.9°", () => {
    const pitch = (car: number): number => settle(car, 2300).pitch * DEGREES_PER_RAD;
    expect(pitch(0)).toBeCloseTo((30 * 25 * 360) / 65536, 3);
    expect(pitch(2)).toBeCloseTo((((5 * 2300) / 200) * 12 * 360) / 65536, 2);
    expect(pitch(3)).toBeCloseTo((((5 * 2300) / 200) * 25 * 360) / 65536, 2);
    expect([pitch(0), pitch(2), pitch(3)].map((d) => Math.round(d * 10) / 10)).toEqual([4.1, 3.8, 7.9]);
  });

  it("the first frame seeds the mass (no sway); a reset seeds it again; a frame of no time changes nothing", () => {
    const spring = new ChassisSpring(DEFAULT_SPRING);
    expect(spring.step(vec3(0, 0, 0), UPRIGHT, 1)).toEqual({ pitch: 0, roll: 0, z: 0 });
    const moved = spring.step(vec3(-50, 0, 0), UPRIGHT, 1 / 60);
    expect(moved.pitch).toBeLessThan(0);
    expect(spring.step(vec3(-50, 0, 0), UPRIGHT, 0)).toEqual(moved);
    spring.reset();
    expect(spring.step(vec3(500, 0, 0), UPRIGHT, 1 / 60)).toEqual({ pitch: 0, roll: 0, z: 0 });
  });

  it("a turn: the mass swung out across the car rolls it (a car turning left, the mass right: right side down, held by its stop)", () => {
    const spring = new ChassisSpring(DEFAULT_SPRING);
    spring.step(vec3(0, 0, 0), UPRIGHT, 0);
    let sway = spring.step(vec3(0, 0, 0), UPRIGHT, 1 / 120);
    // (the car pulled left, -y, under the mass: the mass's lag to its right)
    for (let t = 1; t <= 30; t++) sway = spring.step(vec3(0, -20 * t, 0), UPRIGHT, 1 / 120);
    expect(sway.roll).toBeGreaterThan(0);
    expect(sway.roll).toBeLessThanOrEqual(((20 * 25) / 32768) * Math.PI + 1e-9);
  });

  it("a frame's step at most 0.05 s: a long frame no further than one of 0.05", () => {
    const a = new ChassisSpring(DEFAULT_SPRING);
    const b = new ChassisSpring(DEFAULT_SPRING);
    a.step(vec3(0, 0, 0), UPRIGHT, 0);
    b.step(vec3(0, 0, 0), UPRIGHT, 0);
    expect(a.step(vec3(-10, 0, 0), UPRIGHT, 1)).toEqual(b.step(vec3(-10, 0, 0), UPRIGHT, SPRING_MAX_DT));
  });
});
