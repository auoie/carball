// Placeholder visuals built from the physics shapes: the car is its hitbox plus wheels,
// the ball is its collision sphere. Real models come later (roadmap §10).
import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BoxGeometry,
  type Object3D,
  type Quaternion,
  type Vector3,
} from "three";
import type { BoostPadState, CarConfig, Team } from "../engine/world";
import { toThreeVector } from "./coords";
import { vec3 } from "../math/vec";

export const BALL_RADIUS = 91.25;
const TEAM_CAR_COLORS = [new Color(0x1f6fff), new Color(0xff7a12)] as const;

/** A car: hitbox box, four wheels and a boost flame, in the car's local frame (x forward, y up, z right). */
export class CarView {
  readonly root = new Group();
  readonly #flame: Mesh;

  constructor(config: CarConfig, team: Team) {
    const body = new Mesh(
      new BoxGeometry(config.hitboxSize.x, config.hitboxSize.z, config.hitboxSize.y),
      new MeshStandardMaterial({ color: TEAM_CAR_COLORS[team], roughness: 0.45, metalness: 0.3 }),
    );
    body.position.copy(toThreeVector(config.hitboxOffset));
    this.root.add(body);

    // A darker roof stripe so the car's facing is readable
    const roof = new Mesh(
      new BoxGeometry(config.hitboxSize.x * 0.45, 2, config.hitboxSize.y * 0.8),
      new MeshStandardMaterial({ color: 0x15181f, roughness: 0.6 }),
    );
    roof.position.copy(toThreeVector(vec3(config.hitboxOffset.x - 10, 0, config.hitboxOffset.z + config.hitboxSize.z / 2)));
    this.root.add(roof);

    const tyre = new MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    for (const wheel of [config.frontWheel, config.backWheel]) {
      for (const side of [-1, 1]) {
        const w = new Mesh(new CylinderGeometry(wheel.radius, wheel.radius, 9, 16), tyre);
        w.rotation.x = Math.PI / 2; // axle along the car's right axis (Three z)
        // At rest the suspension sits about 12 uu (its travel) above full extension
        const restDrop = wheel.suspensionRest - 12;
        w.position.copy(toThreeVector(vec3(wheel.offset.x, side * wheel.offset.y, wheel.offset.z - restDrop)));
        this.root.add(w);
      }
    }

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

/** The ball, faceted so its spin is visible, plus a shadow straight below it (as in the game). */
export class BallView {
  readonly root = new Group();
  readonly #ball: Mesh;
  readonly #shadow: Mesh;

  constructor() {
    this.#ball = new Mesh(
      new IcosahedronGeometry(BALL_RADIUS, 2),
      new MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, metalness: 0.1, flatShading: true }),
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
