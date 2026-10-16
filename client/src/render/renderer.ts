// Three.js scene and camera. The lights, background and fog come with the arena's theme (src/render/themes/). The scene
// is drawn linear HDR and through the game's post-processing (postProcess.ts) to display values: no three.js tone
// mapping or sRGB encoding (PP-19).
import { gpuName } from "../settings/video";
import { LinearSRGBColorSpace, NoToneMapping, type Object3D, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { fogAll } from "./heightFog";
import { useGameTranslucentSort } from "./translucentSort";
import { PostProcess, type PostOptions } from "./postProcess";
import type { CameraView } from "../camera/carballCamera";
import type { Vec3 } from "../math/vec";
import { horizontalToVerticalFov } from "../camera/interp";
import { toThreeVector } from "./coords";

/** The camera's far plane (uu): scenery farther from the camera isn't drawn */
export const CAMERA_FAR = 40000;

/** The most a page's loading waits on its shader compile (ms): past it the frames start anyway */
export const PREPARE_WAIT_MS = 10_000;

/** `work`, or the canvas's WebGL context lost, or `ms`: whichever comes first (the shaders' compile never resolves once
 *  the context is gone) */
export async function settledOr(work: Promise<unknown>, canvas: EventTarget, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lost: (() => void) | undefined;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        lost = (): void => {
          resolve();
        };
        canvas.addEventListener("webglcontextlost", lost, { once: true });
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (lost) canvas.removeEventListener("webglcontextlost", lost);
  }
}

/** The GPU timer: the context, its timer query extension's enums, the measures in flight (oldest first) */
interface GpuTimer {
  readonly gl: WebGL2RenderingContext;
  readonly ext: { readonly TIME_ELAPSED_EXT: number; readonly GPU_DISJOINT_EXT: number };
  readonly pending: WebGLQuery[];
}

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

  /** Render Quality's share of the view's resolution each way (settings/video.ts: the canvas drawn smaller and shown
   *  at its size, the HUD and menus not in it) */
  #renderScale = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    // (no anti-aliasing: the game's default is Off, PP-16; the scene goes to an HDR target anyway)
    this.#gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.#gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.#gl.toneMapping = NoToneMapping;
    this.#gl.outputColorSpace = LinearSRGBColorSpace;
    // (the translucents in the game's order, the reflection capture's faces too: TRN1)
    useGameTranslucentSort(this.#gl, this.scene);
    this.#post = new PostProcess(this.#gl);
    // (the scene never moves: its matrix kept, so a frame doesn't force every object's world matrix again; what moves
    // updates its own, the arena's still pieces never: src/render/arena.ts freeze)
    this.scene.matrixAutoUpdate = false;

    this.#observer = new ResizeObserver(() => { this.#resize(); });
    this.#observer.observe(canvas);
    window.addEventListener("resize", this.#readRect);
    this.#resize();
  }

  /** The GPU's name, as the browser gives it (settings/video.ts isWeakGpu) */
  get gpuName(): string {
    return gpuName(this.#gl.getContext());
  }

  get renderScale(): number {
    return this.#renderScale;
  }

  set renderScale(scale: number) {
    if (scale === this.#renderScale) return;
    this.#renderScale = scale;
    this.#gl.setPixelRatio(Math.min(2, window.devicePixelRatio) * scale);
    this.#resize();
  }

  dispose(): void {
    this.#observer.disconnect();
    window.removeEventListener("resize", this.#readRect);
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
    const rect = this.#rect;
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** How big a world unit at `p` is on the page (CSS px, by its depth along the last frame's view) and the camera's
   *  distance to it, with the view's horizontal FOV (degrees); null behind the camera */
  scaleAt(p: Vec3): { readonly pxPerUnit: number; readonly distance: number; readonly horizontalFov: number } | null {
    const v = toThreeVector(p, this.#projected).sub(this.#camera.position);
    const depth = v.dot(this.#camera.getWorldDirection(this.#viewDirection));
    if (depth <= 1) return null;
    const height = this.#rect.height;
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
    // (never waiting forever: a context lost mid-compile never resolves it, RV-484)
    await settledOr(this.#post.compile(this.scene, this.#camera), this.canvas, PREPARE_WAIT_MS);
  }

  /** The whole chain drawn once while the loading screen still covers the page (RV-483): the reflection capture, every
   *  mesh (frustum culling off for it: its buffers and textures uploaded, its programs used once) and the
   *  post-processing at the canvas's size, so the first frames seen upload and finalize nothing; then two frames for the
   *  browser to present it. The camera's fade-in starts at the first real frame */
  async warmUp(): Promise<void> {
    if (!this.draws) return;
    if (this.heightFog) fogAll(this.scene);
    for (const work of this.#beforeNextFrame.splice(0)) work(this.#gl, this.scene);
    const culled: Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.frustumCulled) return;
      culled.push(o);
      o.frustumCulled = false;
    });
    this.#post.render(this.scene, this.#camera, this.postOptions, 1);
    for (const o of culled) o.frustumCulled = true;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  }

  /** The last frame's render on the CPU (ms: the Stat Graphs' Render row, HUD-21) */
  lastRenderMs = 0;
  /** The GPU's time for the latest frame measured (ms: the Stat Graphs' GPU row; null where the browser has no timer
   *  query, Firefox's case), measured only while `gpuTiming` */
  lastGpuMs: number | null = null;
  gpuTiming = false;
  #timer: GpuTimer | null | undefined;

  /** The timer query (EXT_disjoint_timer_query_webgl2), made at its first use; null without one */
  #gpuTimer(): GpuTimer | null {
    if (this.#timer === undefined) {
      const gl = this.#gl.getContext();
      const ext = gl instanceof WebGL2RenderingContext ? (gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
      this.#timer = gl instanceof WebGL2RenderingContext && ext ? { gl, ext, pending: [] } : null;
    }
    return this.#timer;
  }

  /** The finished measures read (the oldest first: a few frames late), a new one begun if few are in flight */
  #beginGpuTiming(): WebGLQuery | null {
    const timer = this.gpuTiming ? this.#gpuTimer() : null;
    if (!timer) return null;
    const { gl, ext, pending } = timer;
    while (pending.length > 0) {
      const q = pending[0];
      if (!q || !(gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      pending.shift();
      if (!(gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean)) this.lastGpuMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
      gl.deleteQuery(q);
    }
    if (pending.length >= 4) return null;
    const q = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    return q;
  }

  render(view: CameraView): void {
    const started = performance.now();
    try {
      this.#render(view);
    } finally {
      this.lastRenderMs = performance.now() - started;
    }
  }

  #render(view: CameraView): void {
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
    const query = this.#beginGpuTiming();
    this.#post.render(this.scene, this.#camera, this.postOptions, Math.max(1 - (now - this.#firstFrame), this.cameraFade));
    const timer = this.#timer;
    if (query && timer) {
      timer.gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
      timer.pending.push(query);
    }
  }

  #resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.#gl.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#readRect();
  }

  /** The canvas's box on the page (CSS px), read when it's resized or the window is, not by every projection: each read
   *  a forced layout, the HUD writing between them (the nameplates, the arrows, every frame) */
  #rect = { left: 0, top: 0, width: 1, height: 1 };

  readonly #readRect = (): void => {
    const r = this.canvas.getBoundingClientRect();
    this.#rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  };
}
