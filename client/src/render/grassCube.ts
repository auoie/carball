// The stadium's reflection capture (notes/arena-visuals.md AV-3, notes/arena-surroundings.md SUR-32: Grass_Textures
// .GrassCube, 256 square a face, 8-bit (LDR: clamped to 1), near plane 32, fogged, blurred over 64 pixels, rendered once
// at load from (0, 0, 928), again when the team colours change in freeplay): the arena, its theme and the
// capture-only hotspots (SUR-33) seen from above the centre spot, which the grass, the metal floor and the frames
// reflect. Two targets in turn: the materials sampling the cube read the last capture while the next is drawn (a
// texture can't be read while it's drawn into). The blur: the materials sample its mipmaps at GRASS_CUBE_BLUR_LOD.
import { Color, CubeCamera, LinearFilter, LinearMipmapLinearFilter, type Object3D, type Scene, type Texture, UnsignedByteType, WebGLCubeRenderTarget, type WebGLRenderer } from "three";

/** Where the game captures it from (game frame: above the centre spot) */
export const GRASS_CUBE_AT = { x: 0, y: 0, z: 928 } as const;
export const GRASS_CUBE_SIZE = 256;
/** The capture's near plane (SUR-32) and far (its hotspots are 8-37k out: far beyond the main camera's) */
export const GRASS_CUBE_NEAR = 32;
const GRASS_CUBE_FAR = 1e6;
/** The 64-pixel full-frame blur (Cubemap_Blur64_PP) on 256-square faces: the mip level that averages about as wide */
export const GRASS_CUBE_BLUR_LOD = 5;

export class GrassCube {
  /** The cube the materials sample: share this uniform (its value turns to each new capture) */
  readonly uniform: { value: Texture };
  readonly #targets: readonly [WebGLCubeRenderTarget, WebGLCubeRenderTarget];
  readonly #cameras: readonly [CubeCamera, CubeCamera];
  /** A constant cube (one texel a face): the surroundings' cube value while capturing (environment) */
  readonly #constant = new WebGLCubeRenderTarget(1, { type: UnsignedByteType, generateMipmaps: false, minFilter: LinearFilter });
  #next: 0 | 1 = 0;
  #captures = 0;

  constructor() {
    const target = (): WebGLCubeRenderTarget =>
      new WebGLCubeRenderTarget(GRASS_CUBE_SIZE, { type: UnsignedByteType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    this.#targets = [target(), target()];
    this.#cameras = [new CubeCamera(GRASS_CUBE_NEAR, GRASS_CUBE_FAR, this.#targets[0]), new CubeCamera(GRASS_CUBE_NEAR, GRASS_CUBE_FAR, this.#targets[1])];
    for (const camera of this.#cameras) camera.position.set(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y); // (Three's y up)
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
    const camera = this.#cameras[this.#next];
    const target = this.#targets[this.#next];
    // (unparented: it updates its own matrices)
    camera.update(gl, scene);
    if (captureOnly) captureOnly.visible = false;
    for (const child of hidden) child.visible = true;
    this.uniform.value = target.texture;
    this.#next = this.#next === 0 ? 1 : 0;
    this.#captures++;
  }

  /** Captures so far (for tests) */
  get captures(): number {
    return this.#captures;
  }

  /** The last capture's six faces, RGBA bytes (mip 0: before the blur), in Three's face order (+x, -x, +y, -y, +z, -z):
   *  for calibrating against the game's reflection profile (SUR-35; the dev arena viewer) */
  readCapture(gl: WebGLRenderer): Uint8Array[] {
    const target = this.#targets[this.#next === 0 ? 1 : 0];
    return [0, 1, 2, 3, 4, 5].map((face) => {
      const pixels = new Uint8Array(GRASS_CUBE_SIZE * GRASS_CUBE_SIZE * 4);
      gl.readRenderTargetPixels(target, 0, 0, GRASS_CUBE_SIZE, GRASS_CUBE_SIZE, pixels, face);
      return pixels;
    });
  }

  /** The last capture's upper hemisphere's mean (linear RGB, LDR, solid-angle weighted): SUR-32's G_env */
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
          for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + ((pixels[k + c] ?? 0) / 255) * w;
          sum[3] = (sum[3] ?? 0) + w;
        }
      }
    });
    const w = Math.max(sum[3] ?? 0, 1e-9);
    return [(sum[0] ?? 0) / w, (sum[1] ?? 0) / w, (sum[2] ?? 0) / w];
  }

  dispose(): void {
    for (const target of this.#targets) target.dispose();
    this.#constant.dispose();
  }
}
