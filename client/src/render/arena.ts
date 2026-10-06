// The arena: our generated collision mesh (out/arena) plus the planes the physics adds itself
// (floor, ceiling, side walls). All surfaces are one-sided, facing into the field, so the camera
// can see through them from outside (just like the one-sided collision).
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
} from "three";
import type { TriangleMesh } from "../engine/cmf";
import { toThreeVector } from "./coords";
import { vec3 } from "../math/vec";

const ARENA = { sideX: 4096, backY: 5120, goalDepthY: 6000, height: 2048, cornerTangentY: 3968 - 256 * Math.SQRT2 };
const TEAM_COLORS = [new Color(0x2a7fff), new Color(0xff8a1f)] as const; // blue (-y goal), orange (+y goal)

export function buildArena(collision: TriangleMesh): Group {
  const group = new Group();
  group.add(buildMeshSurfaces(collision));
  group.add(buildPlanes());
  group.add(buildFieldMarkings());
  return group;
}

/** Curves, corners, back walls and goals. Vertex colours tint each goal end by team. */
function buildMeshSurfaces({ positions, indices }: TriangleMesh): Mesh {
  const vertexCount = positions.length / 3;
  const threePositions = new Float32Array(positions.length);
  const colors = new Float32Array(positions.length);
  const wall = new Color(0x3c4658);
  const color = new Color();
  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    threePositions.set([x, z, y], i * 3);
    // Inside the goals: team colour; elsewhere a neutral wall colour
    const inGoal = Math.abs(y) > ARENA.backY + 1 && Math.abs(x) < 920;
    color.copy(inGoal ? (y < 0 ? TEAM_COLORS[0] : TEAM_COLORS[1]) : wall);
    if (inGoal) color.multiplyScalar(0.55);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  // Swapping y and z mirrors the winding, so swap two indices per triangle to keep normals inward
  const threeIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 3) {
    threeIndices[i] = indices[i] ?? 0;
    threeIndices[i + 1] = indices[i + 2] ?? 0;
    threeIndices[i + 2] = indices[i + 1] ?? 0;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(threePositions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(threeIndices, 1));
  geometry.computeVertexNormals();
  return new Mesh(
    geometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: FrontSide }),
  );
}

function buildPlanes(): Group {
  const group = new Group();
  const floorMat = new MeshStandardMaterial({ color: 0x24402c, roughness: 0.95, side: FrontSide });
  const wallMat = new MeshStandardMaterial({ color: 0x3c4658, roughness: 0.85, side: FrontSide });
  const ceilingMat = new MeshStandardMaterial({ color: 0x1b2230, roughness: 1, side: FrontSide });

  // Floor (covers the goals too). PlaneGeometry faces +z; rotate it to face up (+y in Three)
  const floor = new Mesh(new PlaneGeometry(ARENA.sideX * 2, ARENA.goalDepthY * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const ceiling = new Mesh(new PlaneGeometry(ARENA.sideX * 2, ARENA.backY * 2), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ARENA.height;
  group.add(ceiling);

  // Side walls, straight section only (the corner meshes take over beyond it)
  for (const side of [-1, 1]) {
    const wallMesh = new Mesh(new PlaneGeometry(ARENA.cornerTangentY * 2, ARENA.height), wallMat);
    wallMesh.position.copy(toThreeVector(vec3(side * ARENA.sideX, 0, ARENA.height / 2)));
    wallMesh.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // face the centre
    group.add(wallMesh);
  }
  return group;
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
