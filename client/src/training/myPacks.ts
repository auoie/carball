// The player's own training packs (the training editor's), kept in the browser in the pack format (src/training/pack.ts)
// and exported or imported as a pack file; a new pack's first shot the game's default (notes/custom-training.md CTR-3).
import { type Vec3, vec3 } from "../math/vec";
import { PACK_FORMAT, type Shot, type TrainingPack, type TrainingType, parsePack } from "./pack";

/** The default shot (SetupDefaultRound): the striker's ball 1000 uu in front of the orange goal, launched at 45° and
 *  1500 uu/s toward the field's centre, the car there facing it; the goalie's ball at the centre launched at the blue
 *  goal, the car in that goal facing it */
export function defaultShot(type: TrainingType): Shot {
  const goalie = type === "goalie";
  const ball = goalie ? vec3(0, 0, 100) : vec3(0, 4120, 100);
  const car = goalie ? vec3(0, -5000, 17) : vec3(0, 0, 17);
  // (the launch toward -y both ways: to the centre from the orange goal's front, or to the blue goal; the car facing +y,
  // at the ball)
  return { timeLimit: 10, ball: { location: ball, launch: { pitch: 8192, yaw: 49152, roll: 0 }, speed: 1500 }, car: { location: car, rotation: { pitch: 0, yaw: 16384, roll: 0 }, startSpeed: 0 } };
}

/** A new pack of one default shot, its id ours (mine-…) */
export function newPack(random: () => number = Math.random): TrainingPack {
  return { id: newPackId(random), name: "My Training", type: "striker", difficulty: "easy", tags: [], description: "", creator: "", shots: [defaultShot("striker")] };
}

/** A new pack id of the player's own (mine-…: an imported pack takes one, so it never replaces a pack kept: RX25) */
export function newPackId(random: () => number = Math.random): string {
  return `mine-${Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, "0")}`;
}

const xyz = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** A pack as its file holds it (format 1: locations as [x, y, z]) */
export function packFile(pack: TrainingPack): unknown {
  return {
    format: PACK_FORMAT,
    id: pack.id,
    name: pack.name,
    type: pack.type,
    difficulty: pack.difficulty,
    tags: pack.tags,
    description: pack.description,
    creator: pack.creator,
    shots: pack.shots.map((s) => ({
      timeLimit: s.timeLimit,
      ball: { location: xyz(s.ball.location), launch: { pitch: s.ball.launch.pitch, yaw: s.ball.launch.yaw }, speed: s.ball.speed },
      car: { location: xyz(s.car.location), rotation: s.car.rotation, startSpeed: s.car.startSpeed },
    })),
  };
}

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
const KEY = "carball.training.mine";

/** The player's packs as kept (each checked; a broken one left out) */
export function storedPacks(storage: Store | null = local()): TrainingPack[] {
  try {
    const v: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.map((p) => parsePack(p)).filter((p): p is TrainingPack => typeof p !== "string") : [];
  } catch {
    return [];
  }
}

/** The player's packs kept; whether they were (not: the browser's storage full or blocked) */
export function storePacks(packs: readonly TrainingPack[], storage: Store | null = local()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(KEY, JSON.stringify(packs.map(packFile)));
    return true;
  } catch {
    return false;
  }
}

/** One pack kept (replacing the one with its id, else added); whether it was */
export function storePack(pack: TrainingPack, storage: Store | null = local()): boolean {
  const packs = storedPacks(storage);
  const at = packs.findIndex((p) => p.id === pack.id);
  if (at >= 0) packs[at] = pack;
  else packs.push(pack);
  return storePacks(packs, storage);
}

export function deletePack(id: string, storage: Store | null = local()): void {
  storePacks(
    storedPacks(storage).filter((p) => p.id !== id),
    storage,
  );
}
