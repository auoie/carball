import { Box3, InstancedMesh, Matrix4, Mesh, type Object3D, Vector3 } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { THEMES, createTheme, themeName } from ".";
import { PLAYING_VOLUME, type Theme } from "./theme";

const built = new Map<string, Theme>();
beforeAll(async () => {
  for (const name of THEMES) built.set(name, await createTheme(name));
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

/** Every drawn object under `root`, after the theme's animation has run a while with the ball at the centre. */
function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

describe("themes", () => {
  it("are chosen by name, the night theme by default", () => {
    expect(themeName("meadow")).toBe("meadow");
    expect(themeName(null)).toBe("night");
    expect(themeName("nope")).toBe("night");
  });

  it.each(THEMES)("%s: no scenery reaches into the playing volume", (name) => {
    const t = theme(name);
    t.update(12.3, new Vector3(0, 93, 0));
    const v = new Vector3();
    const instance = new Matrix4();
    const box = new Box3();
    for (const mesh of meshes(t.root)) {
      const geometry = mesh.geometry;
      if (mesh instanceof InstancedMesh) {
        // Each copy's bounds, with room for the animation (the crowd's breathing, the grass swaying)
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox;
        if (!bounds) throw new Error("no bounds");
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, instance);
          box.copy(bounds).applyMatrix4(instance.premultiply(mesh.matrixWorld));
          box.max.y += 50;
          expect.soft(box.intersectsBox(field), `${name}: instance ${i} of ${mesh.type} ${mesh.uuid}`).toBe(false);
        }
      } else {
        const position = geometry.getAttribute("position");
        for (let i = 0; i < position.count; i++) {
          v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          if (field.containsPoint(v)) {
            expect.fail(`${name}: vertex ${i} of a ${mesh.type} at ${v.toArray().map(Math.round).join(", ")}`);
          }
        }
      }
    }
  });

  it("meadow: at most 16 draw calls for all its scenery", () => {
    expect(meshes(theme("meadow").root).length).toBeLessThanOrEqual(16);
  });

  it("meadow: fills the stands with all four kinds of creature", () => {
    const crowd = meshes(theme("meadow").root).filter((m): m is InstancedMesh => m.name.startsWith("crowd: "));
    expect(crowd.map((m) => m.name).sort()).toEqual(["crowd: ember", "crowd: puff", "crowd: ripple", "crowd: sprout"]);
    for (const kind of crowd) expect(kind.count, kind.name).toBeGreaterThan(250);
  });

  it("forest: at most 24 draw calls for all its scenery", () => {
    expect(meshes(theme("forest").root).length).toBeLessThanOrEqual(24);
  });

  it("forest: wild creatures of every kind around the clearing, and no stands", () => {
    const wild = meshes(theme("forest").root).filter((m): m is InstancedMesh => m.name.startsWith("wildlife: "));
    expect(wild.map((m) => m.name.slice("wildlife: ".length)).sort()).toEqual(
      ["beetle", "butterfly", "caterpillar", "ember", "puff", "ripple", "sprout"],
    );
    for (const kind of wild) expect(kind.count, kind.name).toBeGreaterThan(5);
    expect(meshes(theme("forest").root).some((m) => m.name.startsWith("crowd: "))).toBe(false);
  });

  it("city: at most 16 draw calls for all its scenery", () => {
    expect(meshes(theme("city").root).length).toBeLessThanOrEqual(16);
  });

  it("infested: at most 14 draw calls for all its scenery", () => {
    expect(meshes(theme("infested").root).length).toBeLessThanOrEqual(14);
  });

  it("kawaii: at most 24 draw calls for all its scenery", () => {
    expect(meshes(theme("kawaii").root).length).toBeLessThanOrEqual(24);
  });

  it("platformer: at most 20 draw calls for all its scenery", () => {
    expect(meshes(theme("platformer").root).length).toBeLessThanOrEqual(20);
  });

  it("meadow: the same scenery every time (seeded)", async () => {
    const placements = (t: Theme): number[] =>
      meshes(t.root).flatMap((m) => (m instanceof InstancedMesh ? Array.from(m.instanceMatrix.array) : []));
    const again = await createTheme("meadow");
    again.update(12.3, new Vector3(0, 93, 0));
    theme("meadow").update(12.3, new Vector3(0, 93, 0));
    expect(placements(again)).toEqual(placements(theme("meadow")));
  });
});
