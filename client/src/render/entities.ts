// Visuals built from the physics shapes: the car is a body around its hitbox (src/render/carModel.ts), the ball is
// its collision sphere. Real models come later (roadmap §10).
import {
  BufferAttribute,
  type BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Quaternion,
  Vector3,
} from "three";
import type { BoostPadState, CarConfig, Team } from "../engine/world";
import { buildCarModel } from "./carModel";
import { toThreeVector } from "./coords";
import { vec3 } from "../math/vec";

export const BALL_RADIUS = 91.25;
const TEAM_CAR_COLORS = [new Color(0x1f6fff), new Color(0xff7a12)] as const;

/** A car: the boxy model built around its hitbox (src/render/carModel.ts) and a boost flame, in the car's local
 *  frame (x forward, y up, z right). */
export class CarView {
  readonly root = new Group();
  readonly #flame: Mesh;

  constructor(config: CarConfig, team: Team) {
    this.root.add(buildCarModel(config, TEAM_CAR_COLORS[team]));

    this.#flame = new Mesh(
      new ConeGeometry(14, 70, 12),
      new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 }),
    );
    this.#flame.rotation.z = Math.PI / 2; // point backwards (-x)
    this.#flame.position.copy(
      toThreeVector(vec3(config.hitboxOffset.x - config.hitboxSize.x / 2 - 35, 0, config.hitboxOffset.z)),
    );
    this.root.add(this.#flame);
  }

  update(position: Vector3, rotation: Quaternion, boosting: boolean, demoed: boolean): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(rotation);
    this.#flame.visible = boosting;
    this.root.visible = !demoed;
  }
}

/** The ball, faceted and patched so its spin is visible, plus a shadow straight below it (as in the game). */
export class BallView {
  readonly root = new Group();
  readonly #ball: Mesh;
  readonly #shadow: Mesh;

  constructor() {
    this.#ball = new Mesh(
      patchedBallGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, flatShading: true }),
    );
    this.#shadow = new Mesh(
      new CircleGeometry(BALL_RADIUS, 32),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.#shadow.rotation.x = -Math.PI / 2;
    this.root.add(this.#ball, this.#shadow);
  }

  update(position: Vector3, rotation: Quaternion): void {
    this.#ball.position.copy(position);
    this.#ball.quaternion.copy(rotation);
    // Shadow on the floor, smaller and fainter the higher the ball
    const height = Math.max(0, position.y - BALL_RADIUS);
    const s = Math.max(0.35, 1 - height / 2500);
    this.#shadow.position.set(position.x, 1, position.z);
    this.#shadow.scale.setScalar(s);
  }
}

/** An icosphere with a dark pentagon around each of the 12 icosahedron vertices, like a football. */
export function patchedBallGeometry(): BufferGeometry {
  const geometry = new IcosahedronGeometry(BALL_RADIUS, 2); // non-indexed: three vertices per triangle
  const t = (1 + Math.sqrt(5)) / 2;
  const corners = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(([x = 0, y = 0, z = 0]) => new Vector3(x, y, z).normalize());
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const light = new Color(0xe8e8e8);
  const dark = new Color(0x30343c);
  const centre = new Vector3();
  const v = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    centre.set(0, 0, 0);
    for (let k = 0; k < 3; k++) centre.add(v.fromBufferAttribute(position, i + k));
    centre.normalize();
    // The five triangles around a corner have their centres within about 13 degrees of it
    const patch = corners.some((c) => c.dot(centre) > Math.cos((18 * Math.PI) / 180));
    const color = patch ? dark : light;
    for (let k = 0; k < 3; k++) colors.set([color.r, color.g, color.b], (i + k) * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

/** Boost pads: flat discs, big pads with an orb; dimmed while respawning. */
export class BoostPadsView {
  readonly root = new Group();
  readonly #orbs: Object3D[] = [];
  readonly #active = new MeshStandardMaterial({ color: 0xffc533, emissive: 0x996a00, roughness: 0.4 });
  readonly #inactive = new MeshStandardMaterial({ color: 0x4a4130, roughness: 0.9 });

  constructor(pads: readonly BoostPadState[]) {
    for (const pad of pads) {
      const base = new Mesh(new CylinderGeometry(pad.big ? 80 : 50, pad.big ? 90 : 55, 6, 24), this.#active);
      base.position.copy(toThreeVector(pad.pos)).setY(3);
      this.root.add(base);
      const orb = pad.big
        ? new Mesh(new IcosahedronGeometry(45, 1), this.#active)
        : new Mesh(new CylinderGeometry(18, 18, 8, 12), this.#active);
      orb.position.copy(toThreeVector(pad.pos)).setY(pad.big ? 70 : 12);
      this.root.add(orb);
      this.#orbs.push(base, orb);
    }
  }

  update(pads: readonly BoostPadState[]): void {
    pads.forEach((pad, i) => {
      for (const obj of [this.#orbs[i * 2], this.#orbs[i * 2 + 1]]) {
        if (obj instanceof Mesh) obj.material = pad.active ? this.#active : this.#inactive;
      }
      const orb = this.#orbs[i * 2 + 1];
      if (orb) orb.visible = pad.active;
    });
  }
}
