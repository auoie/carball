// The stadium's reflection capture (notes/arena-visuals.md AV-3, notes/arena-surroundings.md SUR-32: Grass_Textures
// .GrassCube, 256 square a face, 8-bit (LDR: clamped to 1), near plane 32, fogged, blurred over 64 pixels, rendered once
// at load from (0, 0, 928), again when the team colours change in freeplay): the arena, its theme and the
// capture-only hotspots (SUR-33) seen from above the centre spot, which the grass, the metal floor and the frames
// reflect. Two targets in turn: the materials sampling the cube read the last capture while the next is drawn (a
// texture can't be read while it's drawn into). The blur: the materials sample its mipmaps at GRASS_CUBE_BLUR_LOD.
import { CubeCamera, LinearMipmapLinearFilter, type Object3D, type Scene, type Texture, UnsignedByteType, WebGLCubeRenderTarget, type WebGLRenderer } from "three";

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
   *  hotspots, hidden from the game's view: shown for the capture) */
  capture(gl: WebGLRenderer, scene: Scene, subject: Object3D, captureOnly: Object3D | null = null): void {
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

  dispose(): void {
    for (const target of this.#targets) target.dispose();
  }
}
