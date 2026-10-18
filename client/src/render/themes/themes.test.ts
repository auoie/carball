import { BackSide, Box3, InstancedMesh, type Material, Matrix4, Mesh, type Object3D, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { THEMES, createTheme } from ".";
import { PLAYING_VOLUME, type Theme } from "./theme";
import { CAMERA_FAR } from "../renderer";

const built = new Map<string, Theme>();
beforeAll(() => {
  for (const name of THEMES) built.set(name, createTheme());
});
const theme = (name: string): Theme => {
  const t = built.get(name);
  if (!t) throw new Error(name);
  return t;
};

/** The playing volume, plus a margin all round (floor level up: scenery under the field is hidden by it). */
const MARGIN = 100;
const field = new Box3(
  new Vector3(-PLAYING_VOLUME.halfX - MARGIN, 0, -PLAYING_VOLUME.halfZ - MARGIN),
  new Vector3(PLAYING_VOLUME.halfX + MARGIN, PLAYING_VOLUME.height + MARGIN, PLAYING_VOLUME.halfZ + MARGIN),
);
/** Whether a point is in the cage itself plus the margin (the field with its cut corners, the goals behind): scenery
 *  may stand behind the end walls beside the goals and outside the corners (the stadium's scaffolds and flags) */
function inCage(p: Vector3, margin = MARGIN): boolean {
  const V = PLAYING_VOLUME;
  const [x, y, z] = [Math.abs(p.x), p.y, Math.abs(p.z)];
  if (y < 0 || y > V.height + margin) return false;
  const inField = x <= V.halfX + margin && z <= V.fieldHalfZ + margin && x + z <= V.cornerSum + margin * Math.SQRT2;
  const inGoal = x <= V.goalHalfWidth + margin && z <= V.halfZ + margin && y <= V.goalHeight + margin;
  return inField || inGoal;
}

/** Every drawn object under `root`, after the theme's animation has run a while with the ball at the centre (the main
 *  view's: not the reflection capture's own hotspots, hidden but while it captures). */
function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

describe("the map's scenery (Night)", () => {
  it.each(THEMES)("%s: no scenery reaches into the playing volume", (name) => {
    const t = theme(name);
    t.update(12.3, new Vector3(0, 93, 0));
    const v = new Vector3();
    const instance = new Matrix4();
    const box = new Box3();
    for (const mesh of meshes(t.root)) {
      const geometry = mesh.geometry;
      if (mesh instanceof InstancedMesh) {
        // Each copy's bounds, with room for the animation (the crowd's breathing, the grass swaying) and for how far it
        // wanders from home (the ghosts)
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) throw new Error("no bounds");
        const reach: unknown = mesh.userData["reach"];
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instance);
          box.copy(bounds).applyMatrix4(instance.premultiply(mesh.matrixWorld));
          box.max.y += 50;
          if (typeof reach === "number") box.expandByScalar(reach);
          const at = new Vector3().setFromMatrixPosition(instance).toArray().map(Math.round).join(", ");
          expect.soft(box.intersectsBox(field), `${name}: instance ${i} of ${mesh.name || geometry.type} at ${at}`).toBe(false);
        }
      } else {
        // Each triangle, its inside too (RV-116): those whose bounds reach the cage's box sampled every 50 uu or finer (at
        // most 64 steps a side: the largest that reach it, the stadium's 2150 across, take 43, RV-147); MARGIN off the
        // volume, or the mesh's own `clearance` (a game placement standing nearer)
        const clearance: unknown = mesh.userData["clearance"];
        const margin = typeof clearance === "number" ? clearance : MARGIN;
        const position = geometry.getAttribute("position");
        const index = geometry.getIndex();
        const count = index ? index.count : position.count;
        const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
        const corner = (k: number, out: Vector3): Vector3 => out.fromBufferAttribute(position, index ? index.getX(k) : k).applyMatrix4(mesh.matrixWorld);
        for (let k = 0; k + 2 < count; k += 3) {
          corner(k, a);
          corner(k + 1, b);
          corner(k + 2, c);
          if (!box.setFromPoints([a, b, c]).intersectsBox(field)) continue;
          const n = Math.min(64, Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / 50)));
          for (let i = 0; i <= n; i++) {
            for (let j = 0; i + j <= n; j++) {
              v.copy(a)
                .addScaledVector(b.clone().sub(a), i / n)
                .addScaledVector(c.clone().sub(a), j / n);
              if (inCage(v, margin))
                expect.fail(
                  `${name}: triangle ${String(k / 3)} of ${mesh.name || `${mesh.type} in ${mesh.parent?.name ?? "?"}`} at ${v.toArray().map(Math.round).join(", ")}`,
                );
            }
          }
        }
      }
    }
  });

  it.each(THEMES)(
    "%s: its sky and everything unfogged within the camera's far plane from anywhere in the arena, all through its animation (RV-58, RV-90, RV-113)",
    (name) => {
      const t = theme(name);
      // (the camera within the playing volume: its farthest corner from the centre)
      const reach = Math.hypot(PLAYING_VOLUME.halfX, PLAYING_VOLUME.height, PLAYING_VOLUME.halfZ);
      const v = new Vector3();
      let farthest = 0;
      let farthestMesh = "";
      const matrix = new Matrix4();
      // (every 1.5 s over 5 minutes: the searchlights' sweeps and the like reach farthest at some moment, not at any one)
      for (let seconds = 0; seconds <= 300; seconds += 1.5) {
        t.update(seconds, new Vector3(0, 93, 0));
        // The sky domes (drawn from inside: their back faces) and everything else unfogged (RV-90); fogged ground and
        // terrain may reach past it, fogged out
        const sky = meshes(t.root).filter((m) => {
          const material = m.material as Material & { fog?: boolean };
          return material.side === BackSide || material.fog === false;
        });
        for (const mesh of sky) {
          const position = mesh.geometry.getAttribute("position");
          const instances = mesh instanceof InstancedMesh ? mesh.count : 1;
          for (let k = 0; k < instances; k++) {
            if (mesh instanceof InstancedMesh) mesh.getMatrixAt(k, matrix);
            else matrix.identity();
            for (let i = 0; i < position.count; i++) {
              const d = v.fromBufferAttribute(position, i).applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld).length();
              if (d > farthest) [farthest, farthestMesh] = [d, `${mesh.name || mesh.type} at ${String(seconds)} s`];
            }
          }
        }
      }
      expect(farthest + reach, farthestMesh).toBeLessThan(CAMERA_FAR);
    },
  );
});
