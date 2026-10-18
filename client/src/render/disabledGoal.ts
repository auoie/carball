// Custom training's "disabled goal" (notes/custom-training.md §2.1: GoalMeshBlocker, DisabledGoal_SM): a plane about
// 1990 × 678 uu across the goal that doesn't count (the striker's own, the goalie's opponent's), no collision: the ball
// may roll in behind it. Ours: its look, translucent diagonal stripes in a frame.
import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from "three";

/** The plane's size (uu) and the goals' line */
export const DISABLED_GOAL = { width: 1990, height: 678, goalY: 5120 } as const;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * vec2(${DISABLED_GOAL.width.toFixed(1)}, ${DISABLED_GOAL.height.toFixed(1)});
    float stripe = step(0.5, fract((p.x + p.y) / 120.0));
    vec2 edge = min(p, vec2(${DISABLED_GOAL.width.toFixed(1)}, ${DISABLED_GOAL.height.toFixed(1)}) - p);
    float frame = 1.0 - step(14.0, min(edge.x, edge.y));
    float alpha = max(frame * 0.7, stripe * 0.22);
    gl_FragColor = vec4(vec3(0.95, 0.22, 0.16), alpha);
  }`;

export class DisabledGoalView {
  readonly root: Mesh;

  constructor() {
    this.root = new Mesh(
      new PlaneGeometry(DISABLED_GOAL.width, DISABLED_GOAL.height),
      new ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, side: DoubleSide }),
    );
    this.root.name = "training disabled goal";
    this.root.visible = false;
  }

  /** Across the goal at `goalSign` × the goals' line (Three's z the game's y), or hidden (null) */
  show(goalSign: 1 | -1 | null): void {
    this.root.visible = goalSign !== null;
    if (goalSign !== null) this.root.position.set(0, DISABLED_GOAL.height / 2, goalSign * DISABLED_GOAL.goalY);
  }
}
