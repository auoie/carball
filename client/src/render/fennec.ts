// The game's own Fennec (its body and the default wheels) as the car's look, for testing (the user plays the Fennec):
// Psyonix assets, exported by the static session to out/bsim/assets_local/fennec/ (git-ignored; its README.txt has the
// frame and the placements used here). Only the dev server serves them, at /local-assets/ (vite.config.ts): they are
// never part of a build. Without them (a build, another machine) cars keep the model built around their hitbox
// (src/render/carModel.ts). The Fennec has the Octane preset's hitbox, so only cars of that hitbox wear it.
import { type Color, Group, type Material, Mesh, MeshStandardMaterial, type Texture } from "three";
import type { CarConfig } from "../engine/world";

const BASE = "/local-assets/fennec/";
/** The body mesh's origin above the physics body's (uu; the game's T: suspension offset for the Fennec's axles) */
const BODY_RAISE = 2.6115;
/** Each wheel in the body mesh's frame (three.js): at its axle bone, scaled to the axle's radius and width, the left
 *  ones mirrored (the game's SetWheelMesh) */
const WHEELS: readonly { readonly position: readonly [number, number, number]; readonly scale: readonly [number, number, number] }[] = [
  { position: [48.8139, -6.1115, -28.0614], scale: [0.796875, 0.796875, -0.866667] },
  { position: [48.8139, -6.1115, 28.0614], scale: [0.796875, 0.796875, 0.866667] },
  { position: [-36.5145, -4.6502, -29.065], scale: [0.859375, 0.859375, -0.866667] },
  { position: [-36.5145, -4.6502, 29.065], scale: [0.859375, 0.859375, 0.866667] },
];
/** The Octane preset's hitbox (size and offset from the body's origin, uu) */
const OCTANE_HITBOX = { size: [120.507, 86.6994, 38.6591], offset: [13.8757, 0, 20.755] } as const;
const PAINTED_MATERIAL = "MIC_Body_Grain";

interface FennecAssets {
  readonly body: Group;
  readonly wheel: Group;
  /** The paint mask: red where the team's colour goes */
  readonly skin: Texture | null;
}

let assets: FennecAssets | null = null;
const painted = new Map<number, Material>();

/** Loads the Fennec if the dev server has it; whether it did. */
export async function loadFennec(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const { TextureLoader } = await import("three");
    const loader = new GLTFLoader();
    const [body, wheel] = await Promise.all([loader.loadAsync(`${BASE}fennec_body.glb`), loader.loadAsync(`${BASE}fennec_wheel.glb`)]);
    const skin = await new TextureLoader().loadAsync(`${BASE}textures/Body_Grain_BlankSkin.png`).catch(() => null);
    if (skin) skin.flipY = false; // (the glTF's UVs: origin top-left)
    assets = { body: body.scene, wheel: wheel.scene, skin };
    return true;
  } catch {
    return false;
  }
}

/** The body's paint: its base colour times `paint` where the mask says paint (the game's paintable body shader does
 *  that with the team's colour), one material per colour. */
function paintedMaterial(original: MeshStandardMaterial, paint: Color, skin: Texture | null): Material {
  const key = paint.getHex();
  const known = painted.get(key);
  if (known) return known;
  const material = original.clone();
  if (skin) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms["paintColor"] = { value: paint.clone() };
      shader.uniforms["paintMask"] = { value: skin };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 paintColor;\nuniform sampler2D paintMask;")
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * paintColor, texture2D(paintMask, vMapUv).r);",
        );
    };
    material.customProgramCacheKey = () => `fennecPaint${String(key)}`;
  } else {
    material.color.copy(paint);
  }
  painted.set(key, material);
  return material;
}

/** The Fennec for a car of `config` in `paint`, in the car's frame (x forward, y up, z right; origin the physics
 *  body's), or null: not loaded, or not the Octane preset's hitbox. */
export function fennecModel(config: CarConfig, paint: Color): Group | null {
  if (!assets) return null;
  const { hitboxSize: s, hitboxOffset: o } = config;
  const near = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 0.05);
  if (!near([s.x, s.y, s.z], OCTANE_HITBOX.size) || !near([o.x, o.y, o.z], OCTANE_HITBOX.offset)) return null;
  const { skin } = assets;
  const body = assets.body.clone(true);
  body.traverse((part) => {
    if (part instanceof Mesh && part.material instanceof MeshStandardMaterial && part.material.name === PAINTED_MATERIAL) {
      part.material = paintedMaterial(part.material, paint, skin);
    }
  });
  body.position.set(0, BODY_RAISE, 0);
  for (const { position, scale } of WHEELS) {
    const wheel = assets.wheel.clone(true);
    wheel.position.set(...position);
    wheel.scale.set(...scale);
    body.add(wheel);
  }
  const car = new Group();
  car.add(body);
  return car;
}
