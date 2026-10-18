// Carball's own starter packs (ours: made from simple geometry here, nothing from another creator's pack), in the
// format of src/training/pack.ts: rolling first touches, open nets, bounces from midfield, high balls over the box, and a
// keeper's basics. The goalie's shots each reach the goal unless saved (src/training/starterPacks.test.ts checks them
// with the engine).
import { type Vec3, vec3 } from "../math/vec";
import type { Difficulty, Shot, TrainingPack, TrainingType } from "./pack";

/** Rotator units a radian */
const UNITS = 32768 / Math.PI;

/** The yaw from `from` toward `to` (rotator units, wrapped) */
function yawTo(from: Vec3, to: Vec3): number {
  return ((Math.round(Math.atan2(to.y - from.y, to.x - from.x) * UNITS) % 65536) + 65536) % 65536;
}

/** A shot: the ball at `ball` launched toward `toward` at `pitch` degrees and `speed`, the car at `car` facing `face` */
function shot(timeLimit: number, ball: Vec3, toward: Vec3, pitchDegrees: number, speed: number, car: Vec3, face: Vec3): Shot {
  return {
    timeLimit,
    ball: { location: ball, launch: { pitch: Math.round((pitchDegrees * 16384) / 90), yaw: yawTo(ball, toward), roll: 0 }, speed },
    car: { location: car, rotation: { pitch: 0, yaw: yawTo(car, face), roll: 0 }, startSpeed: 0 },
  };
}

function pack(id: string, name: string, type: TrainingType, difficulty: Difficulty, tags: string[], description: string, shots: Shot[]): TrainingPack {
  return { id, name, type, difficulty, tags, description, creator: "Carball", shots };
}

/** The orange goal's mouth (the striker's target) and the blue goal's (the keeper's own) */
const ORANGE = vec3(0, 5120, 300);
const BLUE_Y = -5120;
const FLOOR = 100;
const CAR_Z = 17;

/** Rolling balls crossing in front of the box from either side, the car coming up from midfield */
function firstTouches(): TrainingPack {
  const shots = [-1, 1, -1, 1, -1, 1, -1, 1].map((side, i) => {
    const ball = vec3(side * (2200 + 150 * (i % 3)), 2400 + 180 * i, FLOOR);
    const meet = vec3(side * -300, 3500 + 60 * i, FLOOR);
    const car = vec3(side * 400, 900 + 100 * (i % 2), CAR_Z);
    return shot(8, ball, meet, 0, 900 + 60 * i, car, meet);
  });
  return pack("carball-first-touches", "First Touches", "striker", "easy", ["Shots", "CloseShots"], "Meet the rolling ball and put it in.", shots);
}

/** The ball resting in front of the orange goal at different angles, the car behind it */
function openNet(): TrainingPack {
  const spots: [number, number][] = [
    [0, 3400],
    [-900, 3300],
    [900, 3300],
    [-1600, 3800],
    [1600, 3800],
    [0, 2600],
    [-2200, 2900],
    [2200, 2900],
  ];
  const shots = spots.map(([x, y]) => {
    const ball = vec3(x, y, FLOOR);
    const back = Math.hypot(ORANGE.x - x, ORANGE.y - y) || 1;
    const car = vec3(x - ((ORANGE.x - x) / back) * 1000, y - ((ORANGE.y - y) / back) * 1000, CAR_Z);
    return shot(6, ball, ORANGE, 0, 0, car, ball);
  });
  return pack("carball-open-net", "Open Net", "striker", "easy", ["Shots"], "Drive through the ball into the open goal.", shots);
}

/** Lobs from around midfield landing in or near the orange box, the car starting off to one side */
function bounceShots(): TrainingPack {
  const shots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const ball = vec3(side * (300 + 120 * i), -200 + 100 * i, 300);
    const land = vec3(side * -(200 + 80 * i), 3000 + 70 * i, FLOOR);
    const car = vec3(side * -1100, -600, CAR_Z);
    return shot(9, ball, land, 42 + (i % 3) * 4, 1350 + 40 * i, car, land);
  });
  return pack("carball-bounce-shots", "Bounce Shots", "striker", "medium", ["Bounces", "Shots"], "Read the bounce and finish.", shots);
}

/** High balls hanging over the orange box, the car below at the top of the box */
function airStarters(): TrainingPack {
  const shots = [0, 1, 2, 3, 4, 5].map((i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const ball = vec3(side * (1400 + 100 * i), 3600, 400);
    const toward = vec3(side * -200, 4300, FLOOR);
    const car = vec3(side * -600 + 200 * i, 1600, CAR_Z);
    return shot(8, ball, toward, 64 + (i % 3) * 3, 1700 + 50 * i, car, vec3(0, 4300, 0));
  });
  return pack("carball-air-starters", "Air Starters", "aerial", "medium", ["Aerials"], "Take the ball out of the air.", shots);
}

/** Shots at the blue goal from the field, the car in goal: save them */
function keeperBasics(): TrainingPack {
  const shots: Shot[] = [
    [0, -2200, 0, 2, 1600],
    [-1500, -2600, -500, 4, 1700],
    [1500, -2600, 500, 4, 1700],
    [-800, -1800, 600, 8, 1900],
    [800, -1800, -600, 8, 1900],
    [-2400, -3200, -300, 3, 1800],
    [2400, -3200, 300, 3, 1800],
    [0, -1500, 0, 10, 2100],
  ].map(([x, y, aimX, pitch, speed]) => {
    const ball = vec3(x ?? 0, y ?? 0, 200);
    const target = vec3(aimX ?? 0, BLUE_Y - 400, 200);
    const car = vec3(0, BLUE_Y + 250, CAR_Z);
    return shot(6, ball, target, pitch ?? 0, speed ?? 1600, car, ball);
  });
  return pack("carball-keeper-basics", "Keeper Basics", "goalie", "easy", ["Saves", "Defense"], "Keep the ball out of your net.", shots);
}

/** Every starter pack, in the menu's order */
export const STARTER_PACKS: readonly TrainingPack[] = [firstTouches(), openNet(), bounceShots(), airStarters(), keeperBasics()];
