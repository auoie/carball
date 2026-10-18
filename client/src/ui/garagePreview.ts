// The garage's preview (the user's feature, 2026-10-16): the chosen car in the chosen team's colour, turning slowly on
// a small view of its own, drawn only while the garage shows (its WebGL context made on opening and let go on leaving:
// RV-468). The same model the game draws (src/render/carModel.ts).
import { AmbientLight, type BufferGeometry, type Color, DirectionalLight, Group, type Material, Mesh, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { CarConfig, Team } from "../engine/world";
import { buildCarModel } from "../render/carModel";
import { carModelParts } from "../render/carGlb";
import { toThreeVector } from "../render/coords";
import { vec3 } from "../math/vec";

/** The view: its size (CSS px), the camera's field of view, its distance and height (uu: the longest car, 151 uu, about
 *  half the view's width), the point it looks at, how fast the car turns (rad/s) */
const PREVIEW = { width: 360, height: 210, fov: 32, distance: 290, height3d: 105, lookAt: 22, spin: 0.5 } as const;

export class GaragePreview {
  #element: HTMLCanvasElement;
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
    this.#element = GaragePreview.#canvas();
    this.#scene.add(new AmbientLight(0xffffff, 1.1), this.#turntable);
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.copy(toThreeVector(vec3(300, -400, 600)));
    this.#scene.add(sun);
    this.#camera.position.copy(toThreeVector(vec3(-PREVIEW.distance, -PREVIEW.distance * 0.35, PREVIEW.height3d)));
    this.#camera.lookAt(toThreeVector(vec3(0, 0, PREVIEW.lookAt)));
  }

  /** The view on the page (a new one after each `stop`: a canvas whose context was let go can't have another) */
  get element(): HTMLCanvasElement {
    return this.#element;
  }

  static #canvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.className = "garage-preview";
    canvas.width = PREVIEW.width;
    canvas.height = PREVIEW.height;
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  }

  /** The car and colour to show (the model built anew when either changes) */
  show(car: number, team: Team): void {
    if (this.#shown?.car === car && this.#shown.team === team) return;
    this.#shown = { car, team };
    for (const child of [...this.#turntable.children]) {
      this.#turntable.remove(child);
      // (a Blender model's geometry and materials are shared with the cars in play: left)
      if (carModelParts(child)) continue;
      child.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        (o.geometry as BufferGeometry).dispose();
        const material = o.material as Material | Material[];
        for (const m of Array.isArray(material) ? material : [material]) m.dispose();
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

  /** The garage left: no more frames, and its WebGL context let go (its canvas swapped for a fresh one in place, the
   *  next opening's) */
  stop(): void {
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    const renderer = this.#renderer;
    if (!renderer) return;
    this.#renderer = null;
    renderer.dispose();
    renderer.forceContextLoss();
    const fresh = GaragePreview.#canvas();
    this.#element.replaceWith(fresh);
    this.#element = fresh;
  }

  #draw(): void {
    if (!this.#renderer) {
      try {
        this.#renderer = new WebGLRenderer({ canvas: this.#element, alpha: true, antialias: true });
      } catch {
        return; // (no WebGL here: no preview)
      }
      // (its size once, as it's made: not every frame, RV-492)
      this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.#renderer.setSize(PREVIEW.width, PREVIEW.height, false);
    }
    this.#turntable.rotation.y = this.#angle;
    this.#renderer.render(this.#scene, this.#camera);
  }
}
