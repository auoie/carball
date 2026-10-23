// Free play's ball commands as the game does them (FP3), with made-up cars and balls
import { describe, expect, it } from "vitest";
import { IDENTITY_ROT, type Vec3, add, dot, length, scale, sub, vec3 } from "../math/vec";
import {
  BALL_BOUNDS_RADIUS,
  type CommandCar,
  FREEPLAY_COMMANDS,
  airTarget,
  defendTarget,
  defendVelocity,
  dribbleTarget,
  headedGoal,
  inGoal,
  launchVector,
  nearestGoal,
  passTarget,
  passVelocity,
  poppedUp,
  possessionTarget,
  teleportAllowed,
  teleportTarget,
  teleportedBall,
} from "./freeplayCommands";

const car = (over: Partial<CommandCar> = {}): CommandCar => ({
  pos: vec3(100, 200, 17),
  rot: IDENTITY_ROT, // (facing +x, right +y, up +z)
  vel: vec3(0, 0, 0),
  angVel: vec3(0, 0, 0),
  onGround: true,
  groundNormal: vec3(0, 0, 1),
  hitboxSize: vec3(120, 84, 36),
  hitboxOffset: vec3(14, 0, 9),
  lastVel: vec3(0, 0, 0),
  ...over,
});

/** Where a launched ball is after t s under gravity (650 down) */
const flight = (from: Vec3, v: Vec3, t: number): Vec3 => add(add(from, scale(v, t)), vec3(0, 0, -325 * t * t));

describe("free play's ball commands (FP3)", () => {
  it("the spec's numbers, pinned: the config's table and the ball's bounds radius (a change deliberate, RV-801)", () => {
    expect(BALL_BOUNDS_RADIUS).toBe(103.22);
    expect(FREEPLAY_COMMANDS).toEqual({
      spinScale: 0.5,
      inFrontDistance: 50,
      onCarDistance: 10,
      onCarForwardBase: 30,
      onCarForwardFromTurn: -100,
      onCarAccelerationEffect: 0.05,
      onCarMaxRight: 350,
      onCarSlowRight: 0.5,
      onCarMinUp: 0.25,
      airAlongVelocity: 40,
      airForward: 25,
      popUpSpeed: 750,
      popUpMax: 6000,
      launchSpeed: 2778,
      maxVerticalRatio: 2,
      passVelocityWeight: 0.9,
      passVelocityZWeight: 0.5,
      passGoalLead: 400,
      passHeight: 100,
      passDropoffRange: 3000,
      passIterations: 5,
      defendHalfWidth: 864.51,
      defendHalfHeight: 280.51,
      defendCentreZ: 320,
    });
  });

  it("Launch Ball: the upward speed held within 0..6000, then 750 more; the rest kept", () => {
    expect(poppedUp(vec3(10, -20, -500))).toEqual(vec3(10, -20, 750));
    expect(poppedUp(vec3(0, 0, 7000))).toEqual(vec3(0, 0, 6750));
    expect(poppedUp(vec3(0, 0, 100))).toEqual(vec3(0, 0, 850));
  });

  it("launch vectors land on their target under gravity, the vertical held within twice the horizontal", () => {
    const from = vec3(-300, 1200, 93);
    const to = vec3(500, 2600, 400);
    const v = launchVector(from, to, 2000);
    const t = Math.hypot(to.x - from.x, to.y - from.y) / 2000;
    const landed = flight(from, v, t);
    for (const k of ["x", "y", "z"] as const) expect(landed[k]).toBeCloseTo(to[k], 6);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(2000, 9);
    // (straight up a cliff: clamped; on top of each other or no speed: nothing)
    expect(launchVector(vec3(0, 0, 0), vec3(10, 0, 5000), 1000).z).toBe(2000);
    expect(launchVector(vec3(0, 0, 0), vec3(0, 0, 500), 1000)).toEqual(vec3(0, 0, 0));
    expect(launchVector(vec3(0, 0, 0), vec3(100, 0, 0), 0)).toEqual(vec3(0, 0, 0));
  });

  it("Defend Shot aims across the nearest goal's mouth, within its spread, from where the ball is", () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      const t = defendTarget(1, random);
      expect(Math.abs(t.x)).toBeLessThanOrEqual(864.51);
      expect(t.y).toBe(5120);
      expect(t.z).toBeGreaterThanOrEqual(320 - 280.51);
      expect(t.z).toBeLessThanOrEqual(320 + 280.51);
    }
    expect([nearestGoal(vec3(0, -100, 17)), nearestGoal(vec3(300, 100, 17))]).toEqual([-1, 1]);
    // (the extremes: a source at 0 and at 1)
    expect(defendTarget(-1, () => 0)).toEqual(vec3(-864.51, -5120, 320 - 280.51));
    expect(defendTarget(-1, () => 1)).toEqual(vec3(864.51, -5120, 320 + 280.51));
    // (launched at 2778 a second sideways, landing on the aim)
    const ball = vec3(0, -2000, 300);
    const v = defendVelocity(ball, vec3(0, -3000, 17), () => 0.5);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(FREEPLAY_COMMANDS.launchSpeed, 6);
    const t = 3120 / FREEPLAY_COMMANDS.launchSpeed;
    expect(flight(ball, v, t).y).toBeCloseTo(-5120, 6);
    expect(flight(ball, v, t).z).toBeCloseTo(320, 6);
  });

  it("Pass Ball: a car at rest gets the ball led 400 toward the goal it ties on (the later, orange), 100 high", () => {
    const resting = car({ pos: vec3(0, 0, 17) });
    expect(headedGoal(resting)).toEqual(vec3(0, 5120, 312));
    const { target, speed } = passTarget(vec3(1000, 0, 93), resting);
    expect(target.x).toBeCloseTo(0, 9);
    expect(target.y).toBeCloseTo(400, 9);
    expect(target.z).toBeCloseTo(117, 9);
    // (the speed: toward the car at 2778, scaled by the distance over 3000 (at least half))
    expect(speed).toBeCloseTo(2778 * 0.5, 9);
    // (a car driving at the blue goal: led that way, the ball sent ahead of it)
    const driving = car({ pos: vec3(0, 0, 17), vel: vec3(0, -1500, 0) });
    expect(headedGoal(driving)).toEqual(vec3(0, -5120, 312));
    const pass = passTarget(vec3(0, 2000, 93), driving);
    expect(pass.target.y).toBeLessThan(-400);
    const v = passVelocity(vec3(0, 2000, 93), driving);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(pass.speed, 6);
    // (a moving car's exact target after the five iterations, worked out apart from this code; one iteration lands
    // short, at (262, -1383): RV-801)
    const moving = passTarget(vec3(300, 2000, 93), car({ pos: vec3(0, 0, 17), vel: vec3(400, -1500, 0) }));
    expect(moving.speed).toBe(2778);
    expect(moving.target.x).toBeCloseTo(587.3699516064954, 6);
    expect(moving.target.y).toBeCloseTo(-2602.637318524358, 6);
    expect(moving.target.z).toBeCloseTo(117, 9);
  });

  it("Take Possession: ahead of the hitbox by 50 past the ball's bounds radius, that radius over the surface", () => {
    const c = car();
    const ext = length(scale(c.hitboxSize, 0.5));
    const p = possessionTarget(c, 17);
    expect(p).toEqual(vec3(100 + BALL_BOUNDS_RADIUS + ext + 50, 200, 17 + BALL_BOUNDS_RADIUS - 17));
    // (the surface found by the ray down; none within reach: as if right under)
    expect(teleportTarget("possession", c, () => 0.5).z).toBeCloseTo(17 + BALL_BOUNDS_RADIUS - BALL_BOUNDS_RADIUS / 2, 9);
    expect(teleportTarget("possession", c, () => null).z).toBeCloseTo(17 + BALL_BOUNDS_RADIUS, 9);
  });

  it("Start Dribble: over the roof; a turn moves it inside, back and lower; a wall's turn and the air don't count", () => {
    const c = car();
    const roof = 18 + 9 + BALL_BOUNDS_RADIUS + 10;
    expect(dribbleTarget(c)).toEqual(vec3(100 + 30, 200, 17 + roof));
    const turning = car({ angVel: vec3(0, 0, 2.75), vel: vec3(1150, 0, 0), lastVel: vec3(1150, 0, 0) });
    const p = sub(dribbleTarget(turning), turning.pos);
    expect(dot(p, turning.rot.right)).toBeGreaterThan(0); // (a right turn: on its right)
    expect(p.z).toBeLessThan(roof);
    expect(p.x).toBeLessThan(30 * (1 - 0.5));
    const onWall = car({ angVel: vec3(0, 0, 2.75), groundNormal: vec3(1, 0, 0) });
    expect(dot(sub(dribbleTarget(onWall), onWall.pos), onWall.rot.right)).toBe(0);
    // (the wall's line: a ground normal's z under 0.9 a wall (a ramp at 0.85), at 0.9 or over the ground (RV-801))
    const ramp = car({ angVel: vec3(0, 0, 2.75), groundNormal: vec3(0.5268, 0, 0.85) });
    expect(dot(sub(dribbleTarget(ramp), ramp.pos), ramp.rot.right)).toBe(0);
    const gentle = car({ angVel: vec3(0, 0, 2.75), groundNormal: vec3(0.42, 0, 0.9075) });
    expect(dot(sub(dribbleTarget(gentle), gentle.pos), gentle.rot.right)).toBeGreaterThan(0);
    // (accelerating forward: further forward)
    const speeding = car({ vel: vec3(500, 0, 0), lastVel: vec3(480, 0, 0) });
    expect(dribbleTarget(speeding).x).toBeGreaterThan(dribbleTarget(car({ vel: vec3(500, 0, 0), lastVel: vec3(500, 0, 0) })).x);
    // (in the air: over the car, ahead along its velocity, a little forward)
    const flying = car({ onGround: false, vel: vec3(0, 600, 0) });
    expect(teleportTarget("dribble", flying, () => null)).toEqual(airTarget(flying));
    expect(airTarget(flying)).toEqual(vec3(100 + 25, 200 + 40, 17 + roof));
  });

  it("a teleport is refused inside a goal or through the static world; the ball moves with the car, half its spin, its rotation kept", () => {
    expect([inGoal(vec3(0, 5500, 300)), inGoal(vec3(0, -5200, 0)), inGoal(vec3(1000, 5500, 300)), inGoal(vec3(0, 5000, 300))]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const c = car({ vel: vec3(300, 0, 0) });
    expect(teleportAllowed(vec3(400, 200, 120), c, () => null)).toBe(true);
    expect(teleportAllowed(vec3(400, 200, 120), c, () => 0.4)).toBe(false);
    expect(teleportAllowed(vec3(0, 5500, 300), c, () => null)).toBe(false);
    const rot = { forward: vec3(0, 1, 0), right: vec3(-1, 0, 0), up: vec3(0, 0, 1) };
    expect(teleportedBall({ angVel: vec3(2, -4, 6), rot }, c, vec3(1, 2, 3))).toEqual({
      pos: vec3(1, 2, 3),
      vel: vec3(300, 0, 0),
      angVel: vec3(1, -2, 3),
      rot,
    });
  });
});
