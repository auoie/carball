// Open-air stands around the arena: tiered bleachers in four bright colours, banner walls behind them, flags, and
// floodlight towers in the corners. One draw call. Also where the crowd sits. Three.js frame: ground in x/z, y up.
import { BoxGeometry, type BufferGeometry, Color, ConeGeometry, CylinderGeometry, Mesh, MeshLambertMaterial } from "three";
import { GROUND_LEVEL } from "./nature";
import { combine, part } from "./shapes";
import { seededRandom } from "./random";

const ROWS = 10;
const ROW_DEPTH = 170;
const ROW_RISE = 110;
const FIRST_STEP = 130;
/** Front edge of the first row: the side stands (|x|) and the end stands (|z|) */
const SIDE_FRONT = 4500;
const END_FRONT = 6450;
const SIDE_LENGTH = 10400; // along z
const END_LENGTH = 7800; // along x
const SECTION_COLORS = [0xe5533d, 0x3f7fe0, 0x4caf50, 0xf2c12e].map((c) => new Color(c));

export interface Seat {
  readonly x: number;
  readonly y: number; // the step's top
  readonly z: number;
  readonly facing: number; // rotation about y that turns +z towards the field
}

/** The top of row `r` */
const stepTop = (r: number): number => FIRST_STEP + r * ROW_RISE;
const BACK_TOP = stepTop(ROWS - 1) + 380;

export function buildStands(seed: number): { mesh: Mesh; seats: Seat[] } {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  const seats: Seat[] = [];
  const shade = new Color();

  // A stand: rows of steps along its length, in coloured sections, seats on every step
  const stand = (along: "x" | "z", side: number, front: number, length: number, sections: number): void => {
    const sectionLength = length / sections;
    for (let r = 0; r < ROWS; r++) {
      const depthCentre = side * (front + r * ROW_DEPTH + ROW_DEPTH / 2);
      const top = stepTop(r);
      for (let s = 0; s < sections; s++) {
        const centre = -length / 2 + (s + 0.5) * sectionLength;
        const base = SECTION_COLORS[s % SECTION_COLORS.length] ?? new Color(0xffffff);
        shade.copy(base).multiplyScalar(r % 2 === 0 ? 1 : 0.82);
        const height = top - GROUND_LEVEL;
        const size: [number, number, number] =
          along === "z" ? [ROW_DEPTH, height, sectionLength - 30] : [sectionLength - 30, height, ROW_DEPTH];
        const position: [number, number, number] =
          along === "z" ? [depthCentre, GROUND_LEVEL + height / 2, centre] : [centre, GROUND_LEVEL + height / 2, depthCentre];
        parts.push(part(new BoxGeometry(...size), shade.clone(), { position }));
      }
      // Seats, a few left empty
      const facing = along === "z" ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
      for (let t = -length / 2 + 120; t < length / 2 - 60; t += 185 + random() * 30) {
        if (random() < 0.22) continue;
        const jitter = (random() - 0.5) * 30;
        seats.push(
          along === "z"
            ? { x: depthCentre + jitter, y: top, z: t, facing }
            : { x: t, y: top, z: depthCentre + jitter, facing },
        );
      }
    }
    // Back wall, with a banner per section facing the field, and flags on top
    const back = side * (front + ROWS * ROW_DEPTH + 60);
    const wallSize: [number, number, number] =
      along === "z" ? [120, BACK_TOP - GROUND_LEVEL, length] : [length, BACK_TOP - GROUND_LEVEL, 120];
    const wallAt: [number, number, number] =
      along === "z" ? [back, (BACK_TOP + GROUND_LEVEL) / 2, 0] : [0, (BACK_TOP + GROUND_LEVEL) / 2, back];
    parts.push(part(new BoxGeometry(...wallSize), 0xf3efe4, { position: wallAt }));
    for (let s = 0; s < sections; s++) {
      const centre = -length / 2 + (s + 0.5) * sectionLength;
      const color = SECTION_COLORS[(s + 2) % SECTION_COLORS.length] ?? new Color(0xffffff);
      const inner = back - side * 65;
      const y = BACK_TOP - 170;
      const banner: [number, number, number] = along === "z" ? [10, 260, sectionLength * 0.8] : [sectionLength * 0.8, 260, 10];
      parts.push(part(new BoxGeometry(...banner), color, { position: along === "z" ? [inner, y, centre] : [centre, y, inner] }));
      // A flag on a pole at each end of the section
      for (const end of [-0.45, 0.45]) {
        const t = centre + end * sectionLength;
        const at = (h: number): [number, number, number] => (along === "z" ? [back, h, t] : [t, h, back]);
        parts.push(part(new CylinderGeometry(9, 12, 520, 6), 0xdedede, { position: at(BACK_TOP + 260) }));
        parts.push(
          part(new ConeGeometry(70, 200, 3), color, {
            position: at(BACK_TOP + 430),
            // (the flag's face towards the field, flying along the wall)
            rotation: [0, along === "z" ? Math.PI / 2 : 0, -Math.PI / 2],
            scale: [1, 1, 0.12],
          }),
        );
      }
    }
  };
  for (const side of [-1, 1]) {
    stand("z", side, SIDE_FRONT, SIDE_LENGTH, 4);
    stand("x", side, END_FRONT, END_LENGTH, 3);
  }

  // Floodlight towers in the corners, leaning over the field
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 5900;
      const z = sz * 7900;
      parts.push(part(new CylinderGeometry(55, 90, 3400, 8), 0xd9dde3, { position: [x, GROUND_LEVEL + 1700, z] }));
      parts.push(
        part(new BoxGeometry(520, 300, 120), 0x40454f, {
          position: [x - sx * 60, GROUND_LEVEL + 3450, z - sz * 60],
          rotation: [0, Math.atan2(sx, sz), 0],
        }),
      );
      parts.push(
        part(new BoxGeometry(470, 250, 20), 0xfff6cf, {
          position: [x - sx * 105, GROUND_LEVEL + 3450, z - sz * 105],
          rotation: [0, Math.atan2(sx, sz), 0],
        }),
      );
    }
  }

  return { mesh: new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true })), seats };
}
