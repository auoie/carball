// The garage's cars (the user's feature, 2026-10-16), named by their shape (shipped files name no game: the user's
// decision, 2026-10-15): each its look (our own procedural body) and its physics preset (the engine's hitbox preset,
// src/engine/world.ts CarBody). Sport plays the Standard preset. Id 1 (the garage's Standard, an Octane-like body) is
// gone (the user's, 2026-10-17): the ids stay as they were (no wire change), a stored or sent 1 is Sport. And the team
// colour the player picks, Free Play's (online, the queue picks the team: the car takes that team's colour).
import { CarBody, type Team } from "../engine/world";

export interface CarChoice {
  /** The car's id (the hello's: append-only, never reused; the server checks it) */
  readonly id: number;
  readonly name: string;
  /** Its physics preset */
  readonly body: CarBody;
}

export const CARS: readonly CarChoice[] = [
  { id: 0, name: "Sport", body: CarBody.Standard },
  { id: 2, name: "Flat", body: CarBody.Flat },
  { id: 3, name: "Tall", body: CarBody.Tall },
];

/** The car Sport's look stands in for until a body of its own (the default: the car the game started with) */
export const DEFAULT_CAR = 0;

/** A car id as the client takes it: one it knows, else the default */
export function carChoice(id: number): CarChoice {
  return CARS.find((c) => c.id === id) ?? CARS[DEFAULT_CAR] ?? { id: 0, name: "Sport", body: CarBody.Standard };
}

const CAR_KEY = "carball.car";
const TEAM_KEY = "carball.team";

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The garage's car, as last chosen (the default before any, or for one this page doesn't know) */
export function storedCar(storage: Store | null = local()): number {
  try {
    const id = Number(storage?.getItem(CAR_KEY) ?? DEFAULT_CAR);
    return CARS.some((c) => c.id === id) ? id : DEFAULT_CAR;
  } catch {
    return DEFAULT_CAR;
  }
}

export function storeCar(id: number, storage: Store | null = local()): void {
  try {
    storage?.setItem(CAR_KEY, String(carChoice(id).id));
  } catch {
    // (not kept)
  }
}

/** The garage's team colour (Free Play's), as last chosen: blue before any */
export function storedTeam(storage: Store | null = local()): Team {
  try {
    return storage?.getItem(TEAM_KEY) === "1" ? 1 : 0;
  } catch {
    return 0;
  }
}

export function storeTeam(team: Team, storage: Store | null = local()): void {
  try {
    storage?.setItem(TEAM_KEY, String(team));
  } catch {
    // (not kept)
  }
}
