// Carball's starter packs (src/training/starterPacks.ts): each within the format; every goalie shot reaches the blue
// goal unless saved, within its time limit; every striker ball stays out of both nets for its first 2 s (no free goals),
// simulated with the engine (the ball alone)
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { World, initEngine } from "../engine/world";
import { ZERO } from "../math/vec";
import { arenaMeshes } from "../testing/arena";
import { parsePack } from "./pack";
import { launchVelocity } from "./run";
import { STARTER_PACKS } from "./starterPacks";

let world: World;
beforeAll(async () => {
  const engine = await createEngine();
  initEngine(engine, arenaMeshes());
  world = World.create(engine);
});

/** The ball alone from the shot's start for `seconds`: its lowest and highest y (uu), whether a goal was scored */
function flight(shot: (typeof STARTER_PACKS)[number]["shots"][number], seconds: number): { minY: number; maxY: number; goal: boolean } {
  world.setBall({ pos: shot.ball.location, vel: launchVelocity(shot), angVel: ZERO });
  world.takeEvents();
  let [minY, maxY, goal] = [Infinity, -Infinity, false];
  for (let t = 0; t < seconds * 120 && !goal; t++) {
    world.step();
    const y = world.ball().pos.y;
    [minY, maxY] = [Math.min(minY, y), Math.max(maxY, y)];
    goal = world.takeEvents().some((e) => e.type === "goal");
  }
  return { minY, maxY, goal };
}

describe("the starter packs", () => {
  it("are five, ours, each within the format (as JSON, as a pack file would hold them)", () => {
    expect(STARTER_PACKS.map((p) => p.id)).toEqual([
      "carball-first-touches",
      "carball-open-net",
      "carball-bounce-shots",
      "carball-air-starters",
      "carball-keeper-basics",
    ]);
    for (const p of STARTER_PACKS) {
      const json = JSON.parse(
        JSON.stringify({
          format: 1,
          ...p,
          shots: p.shots.map((s) => ({
            ...s,
            ball: { ...s.ball, location: [s.ball.location.x, s.ball.location.y, s.ball.location.z] },
            car: { ...s.car, location: [s.car.location.x, s.car.location.y, s.car.location.z] },
          })),
        }),
      ) as unknown;
      expect(typeof parsePack(json), p.id).toBe("object");
      expect(p.creator).toBe("Carball");
    }
  });

  it("goalie: every shot reaches the blue goal unless saved, within its time limit", () => {
    for (const p of STARTER_PACKS.filter((x) => x.type === "goalie")) {
      for (const [i, s] of p.shots.entries()) {
        const f = flight(s, s.timeLimit);
        expect(f.goal && f.minY < -5120, `${p.id} shot ${String(i + 1)}`).toBe(true);
      }
    }
  });

  it("striker: no ball in either net in its first 2 s (no shot starts as a free goal)", () => {
    for (const p of STARTER_PACKS.filter((x) => x.type !== "goalie")) {
      for (const [i, s] of p.shots.entries()) {
        const f = flight(s, 2);
        expect(!f.goal && f.maxY < 5120 && f.minY > -5120, `${p.id} shot ${String(i + 1)}: ${JSON.stringify(f)}`).toBe(true);
      }
    }
  });
});
