// Three.js scene, lights and camera.
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import type { CameraView } from "../camera/carCamera";
import { horizontalToVerticalFov } from "../camera/interp";
import { toThreeVector } from "./coords";

export class Renderer {
  readonly scene = new Scene();
  readonly #camera = new PerspectiveCamera(60, 16 / 9, 5, 40000);
  readonly #gl: WebGLRenderer;
  readonly #target = new Vector3();
  readonly #observer: ResizeObserver;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.#gl = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.#gl.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new Color(0x0d1117);
    this.scene.fog = new Fog(0x0d1117, 9000, 22000);

    this.scene.add(new HemisphereLight(0xd6e4ff, 0x2a3a2a, 1.4));
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(3000, 8000, 2000);
    this.scene.add(sun);

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
    this.#camera.lookAt(toThreeVector(view.target, this.#target));
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
