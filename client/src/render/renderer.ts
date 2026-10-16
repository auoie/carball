// Three.js scene and camera. The lights, background and fog come with the arena's theme (src/render/themes/). The scene
// is drawn linear HDR and through the game's post-processing (postProcess.ts) to display values: no three.js tone
// mapping or sRGB encoding (PP-19).
import { LinearSRGBColorSpace, NoToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { fogAll } from "./heightFog";
import { useGameTranslucentSort } from "./translucentSort";
import { PostProcess, type PostOptions } from "./postProcess";
import type { CameraView } from "../camera/carballCamera";
import type { Vec3 } from "../math/vec";
import { horizontalToVerticalFov } from "../camera/interp";
import { toThreeVector } from "./coords";

/** The camera's far plane (uu): scenery farther from the camera isn't drawn */
export const CAMERA_FAR = 40000;

export class Renderer {
  readonly scene = new Scene();
  readonly #camera = new PerspectiveCamera(60, 16 / 9, 5, CAMERA_FAR);
  readonly #gl: WebGLRenderer;
  readonly #target = new Vector3();
  readonly #forward = new Vector3();
  readonly #projected = new Vector3();
  readonly #viewDirection = new Vector3();
  #horizontalFov = 90;
  readonly #observer: ResizeObserver;
  /** Work with the WebGL renderer before the next frame, once each (the arena's reflection capture) */
  readonly #beforeNextFrame: ((gl: WebGLRenderer, scene: Scene) => void)[] = [];

  readonly #post: PostProcess;
  /** The video options that change the post-processing (Bloom, Depth of Field: both on in the game's High preset) */
  postOptions: PostOptions = { bloom: true, depthOfField: true };
  /** When the first frame was drawn: the camera fades in from black over a second (PP-18) */
  #firstFrame: number | null = null;
  /** The camera's fade (0 clear .. 1 black: the goal replay's cuts, fade.ts), through the post-processing's remap as the
   *  game's LUT (RV-159) */
  cameraFade = 0;
  /** The stadium's height fog in every material drawn (render/heightFog.ts: the arena, cars and ball too, RV-187): new
   *  meshes taken in each frame */
  heightFog = false;
  /** Frames drawn (the browser tests turn it off where nothing reads the pixels, `?render=off`: software WebGL is most of
   *  their time): off, the camera and the scene's matrices still follow each frame (projections, the HUD), nothing is
   *  drawn and the reflection capture waits */
  draws = true;

  constructor(readonly canvas: HTMLCanvasElement) {
    // (no anti-aliasing: the game's default is Off, PP-16; the scene goes to an HDR target anyway)
    this.#gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.#gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.#gl.toneMapping = NoToneMapping;
    this.#gl.outputColorSpace = LinearSRGBColorSpace;
    // (the translucents in the game's order, the reflection capture's faces too: TRN1)
    useGameTranslucentSort(this.#gl, this.scene);
    this.#post = new PostProcess(this.#gl);

    this.#observer = new ResizeObserver(() => { this.#resize(); });
    this.#observer.observe(canvas);
    this.#resize();
  }

  dispose(): void {
    this.#observer.disconnect();
    this.#post.dispose();
    this.#gl.dispose();
  }

  /** `work` before the next frame is drawn (once) */
  beforeNextFrame(work: (gl: WebGLRenderer, scene: Scene) => void): void {
    this.#beforeNextFrame.push(work);
  }

  /** A world point (RL frame) on the page as the last frame's camera sees it, CSS px; null behind the camera */
  project(p: Vec3): { readonly x: number; readonly y: number } | null {
    const v = toThreeVector(p, this.#projected).project(this.#camera);
    if (v.z > 1 || v.z < -1) return null;
    const rect = this.#gl.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** How big a world unit at `p` is on the page (CSS px, by its depth along the last frame's view) and the camera's
   *  distance to it, with the view's horizontal FOV (degrees); null behind the camera */
  scaleAt(p: Vec3): { readonly pxPerUnit: number; readonly distance: number; readonly horizontalFov: number } | null {
    const v = toThreeVector(p, this.#projected).sub(this.#camera.position);
    const depth = v.dot(this.#camera.getWorldDirection(this.#viewDirection));
    if (depth <= 1) return null;
    const height = this.#gl.domElement.getBoundingClientRect().height;
    const focal = height / 2 / Math.tan((this.#camera.fov * Math.PI) / 360);
    return { pxPerUnit: focal / depth, distance: v.length(), horizontalFov: this.#horizontalFov };
  }

  /** Before the first frame, the page's loading line still up (RV-458): the first frame's work (the reflection
   *  capture), then every shader program the scene and the post-processing use compiled, so the first frames don't stall
   *  on them. Nothing when it draws nothing */
  async prepare(): Promise<void> {
    if (!this.draws) return;
    if (this.heightFog) fogAll(this.scene);
    for (const work of this.#beforeNextFrame.splice(0)) work(this.#gl, this.scene);
    await this.#post.compile(this.scene, this.#camera);
  }

  render(view: CameraView): void {
    // (before the frame's work, the reflection capture's included)
    if (this.draws) {
      if (this.heightFog) fogAll(this.scene);
      for (const work of this.#beforeNextFrame.splice(0)) work(this.#gl, this.scene);
    }
    this.#camera.position.copy(toThreeVector(view.position));
    this.#camera.up.copy(toThreeVector(view.up));
    this.#target.copy(this.#camera.position).add(toThreeVector(view.forward, this.#forward).multiplyScalar(1000));
    this.#camera.lookAt(this.#target);
    this.#horizontalFov = view.horizontalFov;
    const fov = horizontalToVerticalFov(view.horizontalFov, this.#camera.aspect);
    if (Math.abs(fov - this.#camera.fov) > 1e-3) {
      this.#camera.fov = fov;
      this.#camera.updateProjectionMatrix();
    }
    const now = performance.now() / 1000;
    this.#firstFrame ??= now;
    if (!this.draws) {
      this.scene.updateMatrixWorld();
      this.#camera.updateMatrixWorld();
      return;
    }
    this.#post.render(this.scene, this.#camera, this.postOptions, Math.max(1 - (now - this.#firstFrame), this.cameraFade));
  }

  #resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.#gl.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }
}
