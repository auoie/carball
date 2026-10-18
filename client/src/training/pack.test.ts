// Carball's training packs (notes/custom-training.md §1.2-1.4): checked before they're played, the rotators read as
// the game's (vector, axes, the mirror)
import { describe, expect, it } from "vitest";
import { direction, mirrorShot, parsePack, rotatorAxes, type TrainingPack } from "./pack";

// (synthetic numbers, ours: no shot of anyone's pack, RX25)
const SHOT = {
  timeLimit: 10,
  ball: { location: [200, 2400, 800], launch: { pitch: 1600, yaw: -17000 }, speed: 1500 },
  car: { location: [1100, 1000, 30], rotation: { pitch: 0, yaw: 45000, roll: 0 }, startSpeed: 0 },
};
const PACK = { format: 1, id: "test-pack", name: "Test", type: "striker", difficulty: "hard", tags: ["Aerials", "NotATag"], creator: "us", shots: [SHOT] };

const parsed = (json: unknown): TrainingPack => {
  const p = parsePack(json);
  if (typeof p === "string") throw new Error(p);
  return p;
};

describe("a training pack", () => {
  it("is read with its yaws wrapped into one turn, its pitch within a quarter, unknown tags dropped", () => {
    const p = parsed(PACK);
    expect(p).toMatchObject({ id: "test-pack", name: "Test", type: "striker", difficulty: "hard", tags: ["Aerials"], creator: "us" });
    expect(p.shots[0]?.ball.launch).toEqual({ pitch: 1600, yaw: 65536 - 17000, roll: 0 });
    expect(parsed({ ...PACK, shots: [{ ...SHOT, ball: { ...SHOT.ball, launch: { pitch: 20000, yaw: 4 * 65536 + 342 } } }] }).shots[0]?.ball.launch).toEqual({
      pitch: 16384,
      yaw: 342,
      roll: 0,
    });
    // (the car's start speed optional: 0; the difficulty easy when absent)
    const car = { location: SHOT.car.location, rotation: SHOT.car.rotation };
    expect(parsed({ ...PACK, difficulty: undefined, shots: [{ ...SHOT, car }] })).toMatchObject({ difficulty: "easy", shots: [{ car: { startSpeed: 0 } }] });
  });

  it("is refused outside the format: its format, id, type, 1 to 50 shots, speeds, time limit, the arena's box", () => {
    const bad = (over: Record<string, unknown>, shot: Record<string, unknown> = {}): string | TrainingPack =>
      parsePack({ ...PACK, ...over, shots: [{ ...SHOT, ...shot }] });
    expect(bad({ format: 2 })).toBe("its format");
    expect(bad({ id: "../x" })).toBe("its id");
    expect(bad({ type: "keeper" })).toBe("its type");
    expect(parsePack({ ...PACK, shots: [] })).toBe("its shots (1 to 50)");
    expect(parsePack({ ...PACK, shots: Array.from({ length: 51 }, () => SHOT) })).toBe("its shots (1 to 50)");
    expect(typeof parsePack({ ...PACK, shots: Array.from({ length: 50 }, () => SHOT) })).toBe("object");
    expect(bad({}, { timeLimit: 60 })).toBe("shot 1: its time limit");
    expect(bad({}, { ball: { ...SHOT.ball, speed: 6001 } })).toBe("shot 1: its ball");
    expect(bad({}, { ball: { ...SHOT.ball, location: [5000, 0, 100] } })).toBe("shot 1: its ball");
    expect(bad({}, { car: { ...SHOT.car, startSpeed: 2301 } })).toBe("shot 1: its car");
    expect(bad({}, { car: { ...SHOT.car, rotation: { pitch: 0 } } })).toBe("shot 1: its car");
  });
});

describe("the rotators (UE's)", () => {
  it("vector(): yaw a quarter turn faces +y, pitch a quarter straight up", () => {
    const close = (v: { x: number; y: number; z: number }): number[] => [v.x, v.y, v.z].map((c) => Math.round(c * 1e6) / 1e6 + 0);
    expect(close(direction({ pitch: 0, yaw: 0 }))).toEqual([1, 0, 0]);
    expect(close(direction({ pitch: 0, yaw: 16384 }))).toEqual([0, 1, 0]);
    expect(close(direction({ pitch: 16384, yaw: 5000 }))).toEqual([0, 0, 1]);
  });

  it("the axes: forward the vector, right a quarter turn of yaw from it, an orthonormal basis for any rotator", () => {
    const yawOnly = rotatorAxes({ pitch: 0, yaw: 10000, roll: 0 });
    const a = (10000 * Math.PI) / 32768;
    expect(yawOnly.right.x).toBeCloseTo(-Math.sin(a), 9);
    expect(yawOnly.right.y).toBeCloseTo(Math.cos(a), 9);
    const r = rotatorAxes({ pitch: 1000, yaw: 45000, roll: 500 });
    const dot = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }): number => p.x * q.x + p.y * q.y + p.z * q.z;
    for (const [p, q] of [
      [r.forward, r.right],
      [r.forward, r.up],
      [r.right, r.up],
    ] as const)
      expect(dot(p, q)).toBeCloseTo(0, 9);
    for (const v of [r.forward, r.right, r.up]) expect(dot(v, v)).toBeCloseTo(1, 9);
    expect(r.forward).toEqual(direction({ pitch: 1000, yaw: 45000 }));
  });

  it("the mirror: x to -x and yaw to 32768 - yaw for the ball and the car, the rest kept (CTR-13)", () => {
    const s = parsed(PACK).shots[0];
    if (!s) throw new Error("shot");
    const m = mirrorShot(s);
    expect([m.ball.location.x, m.ball.location.y, m.ball.location.z]).toEqual([-s.ball.location.x, s.ball.location.y, s.ball.location.z]);
    expect(m.ball.launch.yaw).toBe((32768 - s.ball.launch.yaw + 65536) % 65536);
    expect(m.car.rotation.yaw).toBe((32768 - s.car.rotation.yaw + 65536) % 65536);
    expect([m.ball.speed, m.timeLimit, m.car.rotation.pitch]).toEqual([s.ball.speed, s.timeLimit, s.car.rotation.pitch]);
    expect(mirrorShot(m)).toEqual(s);
  });
});
