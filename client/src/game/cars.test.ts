// The garage's cars (src/game/cars.ts): Sport and Standard one physics preset, every simulated value the same (the
// user's decision, 2026-10-16), against the real engine; the choice kept in the browser's storage.
// Requires the engine build (engine/build-wasm) and the generated arena (out/arena).
import createEngine from "@engine/carball_engine.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { CarBody, World, initEngine } from "../engine/world";
import { arenaMeshes } from "../testing/arena";
import { CARS, DEFAULT_CAR, carChoice, storeCar, storeTeam, storedCar, storedTeam } from "./cars";

let engine: Awaited<ReturnType<typeof createEngine>>;

beforeAll(async () => {
  engine = await createEngine();
  initEngine(engine, arenaMeshes());
});

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
};

describe("the garage's cars", () => {
  it("Sport, Flat and Tall, each its own preset; the retired Standard (id 1) Sport (the user's, 2026-10-17)", () => {
    const world = World.create(engine);
    const config = (id: number): string => JSON.stringify(world.carConfig(world.addCar(0, carChoice(id).body)));
    expect(CARS.map((c) => [c.id, c.name])).toEqual([
      [0, "Sport"],
      [2, "Flat"],
      [3, "Tall"],
    ]);
    expect(carChoice(0).body).toBe(CarBody.Standard);
    expect(carChoice(1)).toBe(CARS[DEFAULT_CAR]);
    expect(config(2)).not.toBe(config(0));
    expect(config(3)).not.toBe(config(0));
    expect([carChoice(2).body, carChoice(3).body]).toEqual([CarBody.Flat, CarBody.Tall]);
    world.dispose();
  });

  it("an unknown id is the default car; the choice and the team colour kept, blue and Sport before any", () => {
    expect(carChoice(99)).toBe(CARS[DEFAULT_CAR]);
    const retired = memory();
    retired.setItem("carball.car", "1");
    expect(storedCar(retired)).toBe(0);
    const store = memory();
    expect([storedCar(store), storedTeam(store)]).toEqual([DEFAULT_CAR, 0]);
    storeCar(3, store);
    storeTeam(1, store);
    expect([storedCar(store), storedTeam(store)]).toEqual([3, 1]);
    store.setItem("carball.car", "7");
    expect(storedCar(store)).toBe(DEFAULT_CAR);
  });
});
