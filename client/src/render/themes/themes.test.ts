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

  it("haunted: at most 24 draw calls for all its scenery", () => {
    expect(meshes(theme("haunted").root).length).toBeLessThanOrEqual(24);
  });

  it("ghosts: all three kinds of ghost, and at most 20 draw calls for all its scenery", () => {
    const all = meshes(theme("ghosts").root);
    expect(all.length).toBeLessThanOrEqual(20);
    const ghosts = all.filter((m): m is InstancedMesh => m.name.startsWith("ghost: "));
    expect(ghosts.map((m) => m.name).sort()).toEqual(["ghost: orb", "ghost: peeker", "ghost: sheet"]);
    for (const kind of ghosts) expect(kind.count, kind.name).toBeGreaterThan(15);
  });

  it("dimension: its creatures are all there, and at most 28 draw calls for all its scenery", () => {
    const all = meshes(theme("dimension").root);
    expect(all.length).toBeLessThanOrEqual(28);
    const names = new Set(all.map((m) => m.name));
    for (const name of ["serpent", "watcher", "ghost: jelly", "wildlife: sprout", "wildlife: caterpillar"]) {
      expect(names.has(name), name).toBe(true);
    }
    // The watchers face the ball: their eyes' shader is given its position
    const t = theme("dimension");
    t.update(1, new Vector3(1234, 93, 0));
  });

  it("summit: its creatures are all there, and at most 26 draw calls for all its scenery", () => {
    const all = meshes(theme("summit").root);
    expect(all.length).toBeLessThanOrEqual(26);
    const names = new Set(all.map((m) => m.name));
    for (const name of ["ice bird", "snow beast", "wildlife: snowpuff", "ghost: crystal", "wildlife: butterfly"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("crater: its creatures and landmarks are all there, and at most 28 draw calls for all its scenery", () => {
    const all = meshes(theme("crater").root);
    expect(all.length).toBeLessThanOrEqual(28);
    const names = new Set(all.map((m) => m.name));
    for (const name of ["colossus", "wildlife: tortoise", "ghost: crystal", "wildlife: butterfly", "crystals", "heart crystal"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("temple: its creatures and landmarks are all there, and at most 30 draw calls for all its scenery", () => {
    const all = meshes(theme("temple").root);
    expect(all.length).toBeLessThanOrEqual(30);
    const names = new Set(all.map((m) => m.name));
    for (const name of ["sky whale", "guardians", "ghost: orb", "sky ring"]) expect(names.has(name), name).toBe(true);
    expect(all.filter((m) => m.name === "sky whale")).toHaveLength(2); // (a mother and her calf)
  });

  it("island: its creatures and landmarks are all there, and at most 26 draw calls for all its scenery", () => {
    const all = meshes(theme("island").root);
    expect(all.length).toBeLessThanOrEqual(26);
    const names = new Set(all.map((m) => m.name));
    for (const name of ["manta", "wildlife: leaper", "wildlife: crab", "wildlife: butterfly", "palms", "smoke", "sea"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("lake: its creatures and landmarks are all there, and at most 30 draw calls for all its scenery", () => {
    const all = meshes(theme("lake").root);
    expect(all.length).toBeLessThanOrEqual(30);
    const names = new Set(all.map((m) => m.name));
    for (const name of ["guardian", "wildlife: swan", "wildlife: frog", "wildlife: leaper", "lake", "deck", "islet", "lanterns"]) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("lake: the water reflects only the big scenery (a second render of the scene: kept to a dozen draw calls)", () => {
    const all = meshes(theme("lake").root);
    const reflected = all.filter((m) => m.layers.isEnabled(5));
    expect(reflected.length).toBeGreaterThan(5);
    expect(reflected.length).toBeLessThanOrEqual(14);
    expect(reflected.map((m) => m.name)).not.toContain("wildlife: swan");
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
