// Three.js scene and camera. The lights, background and fog come with the arena's theme (src/render/themes/).
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
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

  constructor(readonly canvas: HTMLCanvasElement) {
    this.#gl = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.#gl.setPixelRatio(Math.min(2, window.devicePixelRatio));

    this.#observer = new ResizeObserver(() => { this.#resize(); });
    this.#observer.observe(canvas);
    this.#resize();
  }

  dispose(): void {
    this.#observer.disconnect();
    this.#gl.dispose();
  }

  render(view: CameraView): void {
    this.#camera.position.copy(toThreeVector(view.position));
    this.#camera.up.copy(toThreeVector(view.up));
    this.#target.copy(this.#camera.position).add(toThreeVector(view.forward, this.#forward).multiplyScalar(1000));
    this.#camera.lookAt(this.#target);
    const fov = horizontalToVerticalFov(view.horizontalFov, this.#camera.aspect);
    if (Math.abs(fov - this.#camera.fov) > 1e-3) {
      this.#camera.fov = fov;
      this.#camera.updateProjectionMatrix();
    }
    this.#gl.render(this.scene, this.#camera);
  }

  #resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.#gl.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }
}
