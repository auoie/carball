// Three.js scene and camera. The lights, background and fog come with the arena's theme (src/render/themes/). The scene
// is drawn linear HDR and through the game's post-processing (postProcess.ts) to display values: no three.js tone
// mapping or sRGB encoding (PP-19).
import { LinearSRGBColorSpace, NoToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { PostProcess, type PostOptions } from "./postProcess";
import type { CameraView } from "../camera/rlCamera";
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

  constructor(readonly canvas: HTMLCanvasElement) {
    // (no anti-aliasing: the game's default is Off, PP-16; the scene goes to an HDR target anyway)
    this.#gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.#gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.#gl.toneMapping = NoToneMapping;
    this.#gl.outputColorSpace = LinearSRGBColorSpace;
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

  render(view: CameraView): void {
    for (const work of this.#beforeNextFrame.splice(0)) work(this.#gl, this.scene);
    this.#camera.position.copy(toThreeVector(view.position));
    this.#camera.up.copy(toThreeVector(view.up));
    this.#target.copy(this.#camera.position).add(toThreeVector(view.forward, this.#forward).multiplyScalar(1000));
    this.#camera.lookAt(this.#target);
    const fov = horizontalToVerticalFov(view.horizontalFov, this.#camera.aspect);
    if (Math.abs(fov - this.#camera.fov) > 1e-3) {
      this.#camera.fov = fov;
      this.#camera.updateProjectionMatrix();
    }
    const now = performance.now() / 1000;
    this.#firstFrame ??= now;
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
