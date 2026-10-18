// Custom training's ball-path preview (notes/custom-training.md §2.4: BallTrajectoryComponent_Mesh_TA in playtest): small
// balls along the first tenth of the launch's 8 s trajectory, each coloured by its speed over the ball's most (6000
// uu/s); shown while the shot waits for input; the training editor's the whole path, longer. Ours: the balls' look; the
// points the engine's own prediction.
import { Color, InstancedMesh, MeshBasicMaterial, Object3D, SphereGeometry } from "three";
import type { Vec3 } from "../math/vec";
import { toThreeVector } from "./coords";

/** The preview's points (at most), their balls' radius (uu), the slow and fast colours (linear) */
export const BALL_PATH = { points: 16, radius: 14, slow: new Color(0.25, 0.75, 1), fast: new Color(1, 0.3, 0.15), maxSpeed: 6000 } as const;

/** The editor's path: its points (at most) over its span (game s) */
export const EDITOR_PATH = { points: 60, seconds: 3 } as const;

export class BallPathView {
  readonly root: InstancedMesh;
  readonly #dummy = new Object3D();
  readonly #colour = new Color();
  readonly #points: number;

  constructor(points: number = BALL_PATH.points) {
    this.#points = points;
    this.root = new InstancedMesh(new SphereGeometry(BALL_PATH.radius, 12, 8), new MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), points);
    this.root.name = "training ball path";
    this.root.count = 0;
    this.root.frustumCulled = false;
  }

  /** The points to show (the game's frame, with their speeds), or none */
  update(points: readonly { readonly pos: Vec3; readonly speed: number }[] | null): void {
    const shown = points?.slice(0, this.#points) ?? [];
    shown.forEach((p, i) => {
      toThreeVector(p.pos, this.#dummy.position);
      this.#dummy.updateMatrix();
      this.root.setMatrixAt(i, this.#dummy.matrix);
      this.root.setColorAt(i, this.#colour.copy(BALL_PATH.slow).lerp(BALL_PATH.fast, Math.min(1, p.speed / BALL_PATH.maxSpeed)));
    });
    this.root.count = shown.length;
    this.root.instanceMatrix.needsUpdate = true;
    if (this.root.instanceColor) this.root.instanceColor.needsUpdate = true;
  }
}
