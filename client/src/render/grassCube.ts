// The stadium's reflection capture (notes/arena-visuals.md AV-3, notes/arena-surroundings.md SUR-32: Grass_Textures
// .GrassCube, 256 square a face, near plane 32, fogged, rendered once at load from (0, 0, 928), again when the team
// colours change in freeplay): the arena, its theme and the capture-only hotspots (SUR-33) seen from above the centre
// spot, which the grass, the metal floor and the frames reflect. As the exe's chain (CAP1, PP-31: cubeChain.ts): the
// faces rendered in linear HDR, each blurred on its own, stored as the game's 8-bit gamma encode read back through an
// sRGB decode; the materials sample it at level 0. Two stored cubes in turn: the materials read the last capture while
// the next is drawn (a texture can't be read while it's drawn into).
import { CUBE_FOG_CAP } from "./heightFog";
import { CubeChain, rawCube, storedCube } from "./cubeChain";
import { Color, CubeCamera, DataUtils, LinearFilter, type Object3D, type Scene, type Texture, UnsignedByteType, WebGLCubeRenderTarget, type WebGLRenderer } from "three";

/** Where the game captures it from (game frame: above the centre spot) */
export const GRASS_CUBE_AT = { x: 0, y: 0, z: 928 } as const;
export const GRASS_CUBE_SIZE = 256;
/** The capture's near plane (SUR-32) and far (its hotspots are 8-37k out: far beyond the main camera's) */
export const GRASS_CUBE_NEAR = 32;
const GRASS_CUBE_FAR = 1e6;
/** The level the materials sample: 0 (the stored cube has no mips: its blur is the chain's, CAP1) */
export const GRASS_CUBE_BLUR_LOD = 0;

export class GrassCube {
  /** The cube the materials sample: share this uniform (its value turns to each new capture) */
  readonly uniform: { value: Texture };
  /** The faces as rendered (linear HDR), and the two stored cubes in turn */
  readonly #raw: WebGLCubeRenderTarget;
  readonly #targets: readonly [WebGLCubeRenderTarget, WebGLCubeRenderTarget];
  readonly #camera: CubeCamera;
  #chain: CubeChain | null = null;
  /** A constant cube (one texel a face): the surroundings' cube value while capturing (environment) */
  readonly #constant = new WebGLCubeRenderTarget(1, { type: UnsignedByteType, generateMipmaps: false, minFilter: LinearFilter });
  #next: 0 | 1 = 0;
  #captures = 0;

  constructor() {
    this.#raw = rawCube();
    this.#targets = [storedCube(), storedCube()];
    this.#camera = new CubeCamera(GRASS_CUBE_NEAR, GRASS_CUBE_FAR, this.#raw);
    this.#camera.position.set(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y); // (Three's y up)
    // (each face's opaque height fog capped at its view depth's 31,887 uu: FOG-8, 11)
    for (const face of this.#camera.children) face.userData["fogCap"] = CUBE_FOG_CAP;
    this.uniform = { value: this.#targets[1].texture };
  }

  /** Captures `scene` with only `subject` (the arena and its theme) drawn: no cars, no ball; and `captureOnly` (the
   *  hotspots, hidden from the game's view: shown for the capture). `environment`: what the reflective surfaces see
   *  meanwhile, one colour all round (the last capture's otherwise) */
  capture(gl: WebGLRenderer, scene: Scene, subject: Object3D, captureOnly: Object3D | null = null, environment: readonly number[] | null = null): void {
    if (environment) {
      // (the constant cube cleared to it, face by face)
      const [previous, clearColour, clearAlpha] = [gl.getRenderTarget(), gl.getClearColor(new Color()), gl.getClearAlpha()];
      gl.setClearColor(new Color(environment[0] ?? 0, environment[1] ?? 0, environment[2] ?? 0), 1);
      for (let face = 0; face < 6; face++) {
        gl.setRenderTarget(this.#constant, face);
        gl.clear(true, false, false);
      }
      gl.setRenderTarget(previous);
      gl.setClearColor(clearColour, clearAlpha);
      this.uniform.value = this.#constant.texture;
    }
    const hidden = scene.children.filter((child) => child !== subject && child.visible);
    for (const child of hidden) child.visible = false;
    if (captureOnly) captureOnly.visible = true;
    // (unparented: it updates its own matrices)
    this.#camera.update(gl, scene);
    if (captureOnly) captureOnly.visible = false;
    for (const child of hidden) child.visible = true;
    const target = this.#targets[this.#next];
    this.#chain ??= new CubeChain(gl);
    this.#chain.run(this.#raw.texture, target);
    this.uniform.value = target.texture;
    this.#next = this.#next === 0 ? 1 : 0;
    this.#captures++;
  }

  /** The capture's six face cameras (for tests) */
  get faceCameras(): readonly Object3D[] {
    return this.#camera.children;
  }

  /** Captures so far (for tests) */
  get captures(): number {
    return this.#captures;
  }

  /** The last capture's six faces, linear RGBA floats, in Three's face order (+x, -x, +y, -y, +z, -z): as stored
 *  (what the materials sample: SUR-35's "sampled") or as rendered (`raw`, before the blur: clamp it for its "ldr"): for
 *  calibrating against the game's reflection profile (the dev arena viewer) */
  readCapture(gl: WebGLRenderer, raw = false): Float32Array[] {
    const target = raw ? this.#raw : this.#targets[this.#next === 0 ? 1 : 0];
    return [0, 1, 2, 3, 4, 5].map((face) => {
      const halves = new Uint16Array(GRASS_CUBE_SIZE * GRASS_CUBE_SIZE * 4);
      gl.readRenderTargetPixels(target, 0, 0, GRASS_CUBE_SIZE, GRASS_CUBE_SIZE, halves, face);
      return Float32Array.from(halves, (h) => DataUtils.fromHalfFloat(h));
    });
  }

  /** The last capture's upper hemisphere's mean (linear RGB, as stored, solid-angle weighted): SUR-36's G_env */
  upperMean(gl: WebGLRenderer): [number, number, number] {
    const faces = this.readCapture(gl);
    const n = GRASS_CUBE_SIZE;
    const sum = [0, 0, 0, 0];
    // (each face's texel directions, the GL cube map convention; up is Three's +y)
    const up = [(_s: number, t: number) => -t, (_s: number, t: number) => -t, () => 1, () => -1, (_s: number, t: number) => -t, (_s: number, t: number) => -t];
    faces.forEach((pixels, f) => {
      for (let j = 0; j < n; j += 2) {
        for (let i = 0; i < n; i += 2) {
          const [s, t] = [(2 * (i + 0.5)) / n - 1, (2 * (j + 0.5)) / n - 1];
          if ((up[f]?.(s, t) ?? 0) <= 0) continue;
          const w = 1 / (1 + s * s + t * t) ** 1.5;
          const k = 4 * (j * n + i);
          for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (pixels[k + c] ?? 0) * w;
          sum[3] = (sum[3] ?? 0) + w;
        }
      }
    });
    const w = Math.max(sum[3] ?? 0, 1e-9);
    return [(sum[0] ?? 0) / w, (sum[1] ?? 0) / w, (sum[2] ?? 0) / w];
  }

  dispose(): void {
    for (const target of this.#targets) target.dispose();
    this.#raw.dispose();
    this.#constant.dispose();
    this.#chain?.dispose();
  }
}
