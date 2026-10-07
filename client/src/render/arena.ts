// The arena: our generated collision mesh (out/arena) plus the planes the physics adds itself
// (floor, ceiling, side walls). All surfaces are one-sided, facing into the field, so the camera
// can see through them from outside (just like the one-sided collision).
// The floor is opaque; the walls and ceiling are see-through with a hexagon pattern (src/render/hexWalls.ts) that
// lights up around the ball, so you can see how close it is to a wall.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type Vector3,
} from "three";
import type { TriangleMesh } from "../engine/cmf";
import { toThreeVector } from "./coords";
import { BALL_RADIUS } from "./entities";
import { HexWallMaterial } from "./hexWalls";
import { vec3 } from "../math/vec";

const ARENA = { sideX: 4096, backY: 5120, goalDepthY: 6000, height: 2048, cornerTangentY: 3968 - 256 * Math.SQRT2 };
const TEAM_COLORS = [new Color(0x2a7fff), new Color(0xff8a1f)] as const; // blue (-y goal), orange (+y goal)
const FLOOR_COLOR = new Color(0x24402c);
/** Mesh triangles facing up below this height are floor (ramp bottoms, goal floors): drawn opaque like the floor. */
const FLOOR_PIECE_MAX_Z = 30;

export class ArenaView {
  readonly root = new Group();
  readonly #walls = new HexWallMaterial(BALL_RADIUS);

  constructor(collision: TriangleMesh) {
    this.root.add(this.#buildMeshSurfaces(collision), this.#buildPlanes(), buildFieldMarkings(), buildSurroundings());
  }

  /** Lights the walls around the ball (Three.js frame). */
  update(ballPosition: Vector3): void {
    this.#walls.ballPosition.copy(ballPosition);
  }

  /** Curves, corners, back walls and goals: floor pieces opaque (team colour inside the goals), the rest see-through. */
  #buildMeshSurfaces({ positions, indices }: TriangleMesh): Group {
    const threePositions = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      threePositions.set([positions[i] ?? 0, positions[i + 2] ?? 0, positions[i + 1] ?? 0], i);
    }
    const floorIndices: number[] = [];
    const wallIndices: number[] = [];
    const vertex = (i: number): [number, number, number] => [
      positions[i * 3] ?? 0,
      positions[i * 3 + 1] ?? 0,
      positions[i * 3 + 2] ?? 0,
    ];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] ?? 0;
      const b = indices[i + 1] ?? 0;
      const c = indices[i + 2] ?? 0;
      const [ax, ay, az] = vertex(a);
      const [bx, by, bz] = vertex(b);
      const [cx, cy, cz] = vertex(c);
      // Face normal's z in the game's frame (the mesh faces into the field)
      const ux = bx - ax, uy = by - ay, vx = cx - ax, vy = cy - ay;
      const nz = ux * vy - uy * vx;
      const len = Math.hypot(uy * (cz - az) - (bz - az) * vy, (bz - az) * vx - ux * (cz - az), nz);
      const floor = len > 0 && nz / len > 0.95 && (az + bz + cz) / 3 < FLOOR_PIECE_MAX_Z;
      // Swapping y and z mirrors the winding, so swap two indices per triangle to keep normals inward
      (floor ? floorIndices : wallIndices).push(a, c, b);
    }

    const geometry = (triangles: number[]): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(threePositions, 3));
      g.setIndex(triangles);
      g.computeVertexNormals();
      return g;
    };

    // Floor pieces: grass, team colour inside the goals
    const colors = new Float32Array(positions.length);
    const color = new Color();
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] ?? 0;
      const y = positions[i + 1] ?? 0;
      const inGoal = Math.abs(y) > ARENA.backY + 1 && Math.abs(x) < 920;
      color.copy(inGoal ? TEAM_COLORS[y < 0 ? 0 : 1] : FLOOR_COLOR);
      if (inGoal) color.multiplyScalar(0.4);
      colors.set([color.r, color.g, color.b], i);
    }
    const floorGeometry = geometry(floorIndices);
    floorGeometry.setAttribute("color", new BufferAttribute(colors, 3));
    const floor = new Mesh(
      floorGeometry,
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: FrontSide }),
    );
    const walls = new Mesh(geometry(wallIndices), this.#walls);
    walls.renderOrder = 1;
    const group = new Group();
    group.add(floor, walls);
    return group;
  }

  #buildPlanes(): Group {
    const group = new Group();
    // Pushed back in depth: the mesh's floor pieces lie in the same plane and draw over it
    const floorMat = new MeshStandardMaterial({
      color: FLOOR_COLOR,
      roughness: 0.95,
      side: FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
    });

    // Floor (covers the goals too). PlaneGeometry faces +z; rotate it to face up (+y in Three)
    const floor = new Mesh(new PlaneGeometry(ARENA.sideX * 2, ARENA.goalDepthY * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    const ceiling = new Mesh(new PlaneGeometry(ARENA.sideX * 2, ARENA.backY * 2), this.#walls);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ARENA.height;
    ceiling.renderOrder = 1;
    group.add(ceiling);

    // Side walls, straight section only (the corner meshes take over beyond it)
    for (const side of [-1, 1]) {
      const wallMesh = new Mesh(new PlaneGeometry(ARENA.cornerTangentY * 2, ARENA.height), this.#walls);
      wallMesh.position.copy(toThreeVector(vec3(side * ARENA.sideX, 0, ARENA.height / 2)));
      wallMesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // face the centre
      wallMesh.renderOrder = 1;
      group.add(wallMesh);
    }
    return group;
  }
}

/** Centre line, centre circle and goal lines, just above the floor. */
function buildFieldMarkings(): Group {
  const group = new Group();
  const line = new MeshStandardMaterial({ color: 0xd8e2d0, roughness: 0.9, side: DoubleSide });
  const strip = (lengthX: number, widthY: number, y: number, x = 0): Mesh => {
    const m = new Mesh(new PlaneGeometry(lengthX, widthY), line);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(toThreeVector(vec3(x, y, 0.5)));
    return m;
  };
  group.add(strip(ARENA.sideX * 2, 12, 0));
  for (const end of [-1, 1]) group.add(strip(1786, 12, end * ARENA.backY));
  // Centre circle as a ring of short strips
  const segments = 64;
  const radius = 1000;
  for (let i = 0; i < segments; i++) {
    const a = ((i + 0.5) / segments) * Math.PI * 2;
    const m = new Mesh(new PlaneGeometry(12, ((2 * Math.PI * radius) / segments) * 1.02), line);
    m.rotation.order = "YXZ";
    m.rotation.y = -a;
    m.rotation.x = -Math.PI / 2;
    m.position.copy(toThreeVector(vec3(Math.cos(a) * radius, Math.sin(a) * radius, 0.5)));
    group.add(m);
  }
  return group;
}

/** Dark ground around the arena, so the see-through walls don't show a void. */
function buildSurroundings(): Mesh {
  const ground = new Mesh(
    new PlaneGeometry(40000, 40000),
    new MeshStandardMaterial({ color: 0x10151d, roughness: 1, side: FrontSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -40;
  return ground;
}
