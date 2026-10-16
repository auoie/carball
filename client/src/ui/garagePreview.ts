// The garage's preview (the user's feature, 2026-10-16): the chosen car in the chosen team's colour, turning slowly on
// a small view of its own, drawn only while the garage shows. The same model the game draws (src/render/carModel.ts).
import { AmbientLight, type BufferGeometry, type Color, DirectionalLight, Group, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { CarConfig, Team } from "../engine/world";
import { buildCarModel } from "../render/carModel";
import { toThreeVector } from "../render/coords";
import { vec3 } from "../math/vec";

/** The view: its size (CSS px), the camera's field of view, its distance and height (uu: the longest car, 151 uu, about
 *  half the view's width), the point it looks at, how fast the car turns (rad/s) */
const PREVIEW = { width: 360, height: 210, fov: 32, distance: 290, height3d: 105, lookAt: 22, spin: 0.5 } as const;

export class GaragePreview {
  readonly element: HTMLCanvasElement;
  readonly #config: (car: number) => CarConfig | null;
  readonly #paint: (team: Team) => Color;
  #renderer: WebGLRenderer | null = null;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(PREVIEW.fov, PREVIEW.width / PREVIEW.height, 10, 5000);
  readonly #turntable = new Group();
  #frame = 0;
  #angle = 0.6;
  #last = 0;
  #shown: { car: number; team: Team } | null = null;

  /** `config`: a car's hitbox and wheels (null: no preview for it); `paint`: a team's car colour */
  constructor(config: (car: number) => CarConfig | null, paint: (team: Team) => Color) {
    this.#config = config;
    this.#paint = paint;
    this.element = document.createElement("canvas");
    this.element.className = "garage-preview";
    this.element.width = PREVIEW.width;
    this.element.height = PREVIEW.height;
    this.element.setAttribute("aria-hidden", "true");
    this.#scene.add(new AmbientLight(0xffffff, 1.1), this.#turntable);
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.copy(toThreeVector(vec3(300, -400, 600)));
    this.#scene.add(sun);
    this.#camera.position.copy(toThreeVector(vec3(-PREVIEW.distance, -PREVIEW.distance * 0.35, PREVIEW.height3d)));
    this.#camera.lookAt(toThreeVector(vec3(0, 0, PREVIEW.lookAt)));
  }

  /** The car and colour to show (the model built anew when either changes) */
  show(car: number, team: Team): void {
    if (this.#shown?.car === car && this.#shown.team === team) return;
    this.#shown = { car, team };
    for (const child of [...this.#turntable.children]) {
      this.#turntable.remove(child);
      child.traverse((o) => {
        if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
      });
    }
    const config = this.#config(car);
    if (config) this.#turntable.add(buildCarModel(config, this.#paint(team), team, car));
    // (drawn only while the garage shows: no WebGL of its own until it's first opened)
    if (this.#frame !== 0) this.#draw();
  }

  /** Turning while the garage shows */
  start(): void {
    if (this.#frame !== 0) return;
    this.#last = performance.now();
    this.#draw();
    const step = (now: number): void => {
      this.#angle += ((now - this.#last) / 1000) * PREVIEW.spin;
      this.#last = now;
      this.#draw();
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  stop(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #draw(): void {
    try {
      this.#renderer ??= new WebGLRenderer({ canvas: this.element, alpha: true, antialias: true });
    } catch {
      return; // (no WebGL here: no preview)
    }
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setSize(PREVIEW.width, PREVIEW.height, false);
    this.#turntable.rotation.y = this.#angle;
    this.#renderer.render(this.#scene, this.#camera);
  }
}
