// Visuals built from the physics shapes: the car is a body around its hitbox (src/render/carModel.ts), the ball is
// its collision sphere. Real models come later (roadmap §10).
import { BufferAttribute, type BufferGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, type Quaternion, ShaderMaterial, Vector3 } from "three";
import type { BoostPadState, CarConfig, Team } from "../engine/world";
import { buildCarModel } from "./carModel";
import { Trail, trailingRearWheels } from "./supersonic";
import { BOOST_TRAIL, IDLE_EXHAUST } from "./effects";
import { Emitter, type Particles } from "./particles";
import { toThreeVector } from "./coords";
import { type Rot3, type Vec3, vec3 } from "../math/vec";

export const BALL_RADIUS = 91.25;
/** What the supersonic trails need of a car: its rear wheels' contact (back left, back right) and its speed along its
 *  forward and right axes (uu/s) */
export interface TrailGround {
  readonly rearContact: readonly [boolean, boolean];
  readonly forwardSpeed: number;
  readonly sideSpeed: number;
}

/** A car state's TrailGround */
export function trailGround(car: { readonly vel: Vec3; readonly rot: Rot3; readonly wheelContact: readonly boolean[] }): TrailGround {
  const along = (a: Vec3): number => car.vel.x * a.x + car.vel.y * a.y + car.vel.z * a.z;
  return {
    // (RocketSim's order: front right, front left, back right, back left)
    rearContact: [car.wheelContact[3] ?? false, car.wheelContact[2] ?? false],
    forwardSpeed: along(car.rot.forward),
    sideSpeed: along(car.rot.right),
  };
}

/** Suspension travel: at rest the wheels sit about this far above full extension (as carModel.ts draws them) */
const WHEEL_TRAVEL = 12;

/** The default loadout's team paint (CarColorSet BlueTeamV3[35] / OrangeTeamV3[33], ^2.2 as GetCorrectedPaintColor
 *  hands it to the material: linear; notes/car-paint.md PNT-3/4) */
export const TEAM_CAR_COLORS = [
  new Color().setRGB(0.001343, 0.25301, 0.978132, LinearSRGBColorSpace),
  new Color().setRGB(0.978132, 0.206684, 0.001343, LinearSRGBColorSpace),
] as const;

/** A car: the boxy model built around its hitbox (src/render/carModel.ts) and a boost flame, in the car's local
 *  frame (x forward, y up, z right); and, in the world, its supersonic trails and shockwave (src/render/supersonic.ts). */
/** The exhausts, where the boost trail and idle exhaust come out: the Fennec's BoostEmitterLeft/Right sockets,
 *  (-57, -+20.43, 10.25) in its mesh's frame, the mesh 2.6115 uu above the car's origin and not shifted along x
 *  (boost_standard.json car_attachment.sockets: RV-81; every car here is drawn Fennec-style), in the car's Three.js
 *  frame */
export const EXHAUSTS: readonly [Vector3, Vector3] = [new Vector3(-57, 10.25 + 2.6115, -20.43), new Vector3(-57, 10.25 + 2.6115, 20.43)];
/** The boost cone shows this long after the boost starts (body_grain BoostConeMesh: AttachDelay 0.1 s) */
const CONE_DELAY = 0.1;

export class CarView {
  /** Add this to the scene: the car and its effects */
  readonly root = new Group();
  readonly #body = new Group(); // posed as the car
  readonly #flame: Mesh;
  readonly #trails: readonly [Trail, Trail] = [new Trail(), new Trail()];
  /** Where the trails leave the car: its rear corners, a little above the middle (local frame) */
  readonly #trailFrom: readonly [Vector3, Vector3];

  readonly #point = new Vector3();
  /** Each exhaust's boost trail and idle exhaust (with a scene's particles) */
  readonly #exhausts: readonly { readonly at: Vector3; readonly trail: Emitter; readonly idle: Emitter }[];
  readonly #axis = new Vector3();
  #wasDemoed = false;
  /** World seconds the boost has been on (the cone's delay) */
  #boosted = 0;

  /** `particles`: the scene's, for the boost trail and the idle exhaust (none: no particles) */
  constructor(config: CarConfig, team: Team, particles: Particles | null = null) {
    const model = buildCarModel(config, TEAM_CAR_COLORS[team], team);
    this.#body.add(model);
    this.#exhausts = particles
      ? EXHAUSTS.map((at) => ({ at, trail: new Emitter(particles, BOOST_TRAIL), idle: new Emitter(particles, IDLE_EXHAUST) }))
      : [];
    this.root.add(this.#body, ...this.#trails.map((t) => t.mesh));
    // The rear tyres' contact points at rest (car frame: the bottom of each, as the model draws them)
    const back = config.backWheel;
    const height = back.offset.z - (back.suspensionRest - WHEEL_TRAVEL) - back.radius;
    const side = config.hitboxSize.y / 2 - 8;
    this.#trailFrom = [new Vector3(back.offset.x, height, -side), new Vector3(back.offset.x, height, side)];

    this.#flame = new Mesh(
      new ConeGeometry(14, 70, 12),
      new MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.85 }),
    );
    this.#flame.rotation.z = Math.PI / 2; // point backwards (-x)
    this.#flame.position.copy(
      toThreeVector(vec3(config.hitboxOffset.x - config.hitboxSize.x / 2 - 35, 0, config.hitboxOffset.z)),
    );
    this.#body.add(this.#flame);
  }

  /** A frame: the car's pose and state; `seconds` since the last frame (for the trails); `ground`: its rear wheels'
   *  contact and its speed along and across itself (the supersonic trails; none: no trail) */
  update(
    position: Vector3,
    rotation: Quaternion,
    boosting: boolean,
    demoed: boolean,
    supersonic = false,
    seconds = 0,
    ground: TrailGround | null = null,
    throttling = false,
  ): void {
    this.#body.position.copy(position);
    this.#body.quaternion.copy(rotation);
    // The boost trail while boosting, the idle exhaust while throttling and not boosting (Drive_PS), from each exhaust
    if (this.#exhausts.length > 0) {
      const axis = (x: number, y: number, z: number): Vec3 => {
        const a = this.#axis.set(x, y, z).applyQuaternion(rotation);
        return vec3(a.x, a.z, a.y);
      };
      const frame = { forward: axis(1, 0, 0), right: axis(0, 0, 1), up: axis(0, 1, 0) };
      // (demolished: its trail and exhaust gone at once, StopAllEffects + KillParticlesForced: RV-52f)
      const killed = demoed && !this.#wasDemoed;
      for (const { at, trail, idle } of this.#exhausts) {
        if (killed) {
          trail.kill();
          idle.kill();
        }
        const p = this.#point.copy(at).applyQuaternion(rotation).add(position);
        const game = vec3(p.x, p.z, p.y);
        trail.active = boosting && !demoed;
        trail.update(seconds, game, frame);
        idle.active = throttling && !boosting && !demoed;
        idle.update(seconds, game, frame);
      }
    }
    this.#wasDemoed = demoed;
    this.#boosted = boosting && !demoed ? this.#boosted + Math.max(0, seconds) : 0;
    this.#flame.visible = this.#boosted >= CONE_DELAY;
    this.root.visible = !demoed;
    // Each rear wheel's trail: supersonic, picked by the direction rule, touching the ground (back left, back right)
    const picked = ground ? trailingRearWheels(ground.forwardSpeed, ground.sideSpeed) : [false, false];
    const trailing = ground && supersonic && !demoed ? [picked[0] && ground.rearContact[0], picked[1] && ground.rearContact[1]] : [false, false];
    this.#trails.forEach((trail, i) => {
      const from = this.#trailFrom[i];
      const active = trailing[i] ?? false;
      if (from) trail.update(this.#point.copy(from).applyQuaternion(rotation).add(position), active, seconds);
    });
  }

  /** How many points the trails have (for tests). */
  get trailLength(): number {
    return Math.max(...this.#trails.map((t) => t.length));
  }
}

/** The ball, faceted and patched so its spin is visible, plus its marker on the floor straight below it. */
export class BallView {
  readonly root = new Group();
  readonly #ball: Mesh;
  readonly #material: MeshStandardMaterial;
  readonly #marker: Mesh;
  readonly #fade = { value: 1 };
  #opacity = 1;

  constructor() {
    // (transparent throughout: it dissolves on a goal and fades in at a kickoff)
    this.#material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, flatShading: true, transparent: true });
    this.#ball = new Mesh(patchedBallGeometry(), this.#material);
    // The ball's size, so it shows where the ball will come down; a plane a little bigger, to hold the rim
    this.#marker = new Mesh(
      new PlaneGeometry(BALL_RADIUS * 2 * MARKER_SPAN, BALL_RADIUS * 2 * MARKER_SPAN),
      new ShaderMaterial({
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: { fade: this.#fade },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.#marker.rotation.x = -Math.PI / 2;
    this.#marker.renderOrder = 1; // (over the floor and its markings)
    this.root.add(this.#ball, this.#marker);
  }

  update(position: Vector3, rotation: Quaternion): void {
    this.#ball.position.copy(position);
    this.#ball.quaternion.copy(rotation);
    // On the floor straight below the ball, the ball's size at any height; a little fainter the higher it is
    this.#marker.position.set(position.x, 1, position.z);
    this.#fade.value = markerFade(Math.max(0, position.y - BALL_RADIUS));
  }

  /** A new ball (a kickoff, a goal's reset): it fades in over 1 s (VT-30); `instant`: shown at once (a replay's,
   *  freeplay's placements) */
  spawn(instant = false): void {
    this.#opacity = instant ? 1 : 0;
    this.#show(false);
  }

  /** This frame's look: exploded, the ball's Dissolve falls at 3/s (Ball_TA's BallFadeOutSpeed -3: 0.333 s, VT-15),
   *  its marker gone at once; else it rises at 1/s (after a spawn); the frame time capped at 1/30 either way (RV-30) */
  fade(exploded: boolean, seconds: number): void {
    const dt = Math.min(Math.max(0, seconds), 1 / 30);
    this.#opacity = exploded ? Math.max(0, this.#opacity - 3 * dt) : Math.min(1, this.#opacity + dt);
    this.#show(exploded);
  }

  /** The ball's Dissolve parameter, 0..1 (for tests) */
  get opacity(): number {
    return this.#opacity;
  }

  /** How opaque it's drawn: the material's dissolve keeps the ball solid while Dissolve ≥ ~0.714, a noise front eating
   *  it below; as a uniform fade, clamp((D - 0.5) / 0.214) (RV-31) */
  get alpha(): number {
    return Math.min(1, Math.max(0, (this.#opacity - 0.5) / 0.214));
  }

  #show(exploded: boolean): void {
    const alpha = this.alpha;
    this.#material.opacity = alpha;
    this.#material.depthWrite = alpha >= 1;
    this.#ball.visible = alpha > 0;
    this.#marker.visible = !exploded;
  }

  /** The marker's place on the floor, and how strongly it shows (for tests). */
  get marker(): { readonly x: number; readonly z: number; readonly fade: number } {
    return { x: this.#marker.position.x, z: this.#marker.position.z, fade: this.#fade.value };
  }
}

/** The marker's plane, in ball radii from its centre to its edge. */
const MARKER_SPAN = 1.3;

/** How strongly the marker shows with the ball `height` uu off the floor: fully on the floor, never below 0.45. */
export function markerFade(height: number): number {
  return Math.max(0.45, 1 - height / 3000);
}

const MARKER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// A soft dark disc the ball's size with a light rim round it: one or the other shows on any floor, dark or light
const MARKER_FRAGMENT = /* glsl */ `
uniform float fade;
varying vec2 vUv;
void main() {
  float r = length(vUv * 2.0 - 1.0) * ${MARKER_SPAN.toFixed(2)}; // 1 at the ball's radius
  float core = (1.0 - smoothstep(0.5, 1.0, r)) * 0.6 * fade;
  // The rim stays at least a pixel and a half wide however far away (it would vanish into the floor otherwise)
  float width = max(0.09, fwidth(r) * 1.5);
  float rim = (1.0 - smoothstep(width * 0.5, width, abs(r - 0.97))) * 0.8 * (0.4 + 0.6 * fade);
  // The rim over the core
  float alpha = rim + core * (1.0 - rim);
  vec3 color = vec3(1.0, 0.97, 0.9) * rim / max(alpha, 1e-4);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

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

/** Seconds a taken pad stays down (VehiclePickup RespawnDelay x RespawnDelayScale 1): the engine's pad cooldown. */
export const PAD_RESPAWN_SECONDS = { big: 10, small: 4 } as const;
/** The game's second warm-up stage starts this long before a pad is back (VehiclePickup_Boost_TA AlmostSpawnedTime) */
export const PAD_ALMOST_SPAWNED_SECONDS = 1;

/** A pad's light fades out on a pickup and in on its return over this long (notes/visual-timing.md VT-12/13) */
export const PAD_FADE_SECONDS = 0.1;

/** Boost pads, instanced (six draw calls for all of them): flat discs, big pads with an orb, small ones with a low
 *  cylinder. Taken, a pad's light fades out over 0.1 s to its dim look (a big pad's orb goes at once, a small pad
 *  stays, dark); back, its light fades in over 0.1 s. Only big pads warm up while down, as the game's: a ghost of the
 *  orb growing over the whole delay (its glow eases in: EaseInCirc), and in the last second a brighter, pulsing one
 *  (AlmostSpawnedEvent). */
export class BoostPadsView {
  readonly root = new Group();
  readonly #pads: readonly {
    readonly meshes: PadMeshes;
    readonly big: boolean;
    readonly slot: number;
    readonly base: Matrix4;
    readonly orb: Matrix4;
    readonly delay: number;
  }[];
  readonly #shown: (boolean | null)[];
  /** Seconds left of each pad's light fading (out after a pickup, in after its return) */
  readonly #fading: number[];
  readonly #color = new Color();
  readonly #scale = new Matrix4();
  readonly #m = new Matrix4();

  constructor(pads: readonly BoostPadState[]) {
    // Each pad's light (the game's Brightness, 0..1) by its instance colour: from the dim look (0: taken, waiting) to
    // the lit one, the glow too, so the end of a fade is the resting look (RV-33)
    const active = new MeshStandardMaterial({ color: 0xffc533, emissive: 0x996a00, roughness: 0.4 });
    const dim = new Color(0x4a4130);
    active.onBeforeCompile = (shader) => {
      shader.uniforms["dimColor"] = { value: dim };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 dimColor;")
        .replace(
          "#include <color_fragment>",
          "#ifdef USE_INSTANCING_COLOR\ndiffuseColor.rgb = mix(dimColor, diffuseColor.rgb, vColor.r);\n#endif",
        )
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif",
        );
    };
    const warmup = new MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.3, depthWrite: false });
    const almost = new MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.65, depthWrite: false });
    const count = (big: boolean): number => pads.filter((p) => p.big === big).length;
    const big = padMeshes(new CylinderGeometry(80, 90, 6, 24), new IcosahedronGeometry(45, 1), count(true), active, warmup, almost);
    const small = padMeshes(new CylinderGeometry(50, 55, 6, 24), new CylinderGeometry(18, 18, 8, 12), count(false), active, warmup, almost);
    const slots = { big: 0, small: 0 };
    this.#pads = pads.map((pad) => {
      const at = toThreeVector(pad.pos);
      return {
        meshes: pad.big ? big : small,
        big: pad.big,
        slot: pad.big ? slots.big++ : slots.small++,
        base: new Matrix4().makeTranslation(at.x, 3, at.z),
        orb: new Matrix4().makeTranslation(at.x, pad.big ? 70 : 12, at.z),
        delay: pad.big ? PAD_RESPAWN_SECONDS.big : PAD_RESPAWN_SECONDS.small,
      };
    });
    for (const m of [big, small]) this.root.add(m.active, m.orb);
    this.root.add(big.warmup, big.almost);
    this.#shown = pads.map(() => null);
    this.#fading = pads.map(() => 0);
    this.update(pads);
  }

  /** `seconds`: since the last update (the lights' fades; none given: at their end at once) */
  update(pads: readonly BoostPadState[], seconds = Infinity): void {
    pads.forEach((pad, i) => {
      const p = this.#pads[i];
      if (!p) return;
      const { active, orb, warmup, almost } = p.meshes;
      const changed = this.#shown[i] !== pad.active;
      const first = this.#shown[i] === null;
      if (changed) {
        this.#shown[i] = pad.active;
        this.#fading[i] = first ? 0 : PAD_FADE_SECONDS;
        // Taken: the big orb goes at once, the light fades out; back: the orb at once, the light fading in
        active.setMatrixAt(p.slot, p.base);
        orb.setMatrixAt(p.slot, pad.active || !p.big ? p.orb : HIDDEN);
        for (const mesh of [active, orb]) mesh.instanceMatrix.needsUpdate = true;
        if (pad.active && p.big) {
          warmup.setMatrixAt(p.slot, HIDDEN);
          almost.setMatrixAt(p.slot, HIDDEN);
          warmup.instanceMatrix.needsUpdate = almost.instanceMatrix.needsUpdate = true;
        }
      }
      const fading = this.#fading[i] ?? 0;
      if (fading > 0 || changed) {
        const left = Math.max(0, fading - seconds);
        this.#fading[i] = left;
        const light = pad.active ? 1 - left / PAD_FADE_SECONDS : left / PAD_FADE_SECONDS;
        this.#color.setRGB(light, light, light);
        active.setColorAt(p.slot, this.#color);
        orb.setColorAt(p.slot, this.#color);
        if (active.instanceColor) active.instanceColor.needsUpdate = true;
        if (orb.instanceColor) orb.instanceColor.needsUpdate = true;
      }
      if (pad.active || !p.big) return;
      // The warm-up: how far through the delay (the game's normalized time), the glow easing in
      const t = Math.min(1, Math.max(0, 1 - pad.cooldown / p.delay));
      const glow = 1 - Math.sqrt(1 - t * t);
      this.#setScaled(warmup, p.slot, p.orb, 0.2 + 0.8 * glow);
      if (pad.cooldown <= PAD_ALMOST_SPAWNED_SECONDS) {
        const pulse = Math.sin((PAD_ALMOST_SPAWNED_SECONDS - pad.cooldown) * 2 * Math.PI * 3); // three pulses
        this.#setScaled(almost, p.slot, p.orb, 1 + 0.12 * pulse);
      } else {
        almost.setMatrixAt(p.slot, HIDDEN);
        almost.instanceMatrix.needsUpdate = true;
      }
    });
  }

  #setScaled(mesh: InstancedMesh, slot: number, at: Matrix4, scale: number): void {
    mesh.setMatrixAt(slot, this.#m.copy(at).multiply(this.#scale.makeScale(scale, scale, scale)));
    mesh.instanceMatrix.needsUpdate = true;
  }
}

/** One size of pad: its disc (lit to dim by each pad's light), its orb (a big pad's only shown while lit) and the orb's
 *  warm-up ghosts (while down). Unused instances are scaled to 0. */
interface PadMeshes {
  readonly active: InstancedMesh;
  readonly orb: InstancedMesh;
  readonly warmup: InstancedMesh;
  readonly almost: InstancedMesh;
}
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

function padMeshes(
  base: BufferGeometry,
  orb: BufferGeometry,
  count: number,
  active: MeshStandardMaterial,
  warmup: MeshBasicMaterial,
  almost: MeshBasicMaterial,
): PadMeshes {
  const make = (geometry: BufferGeometry, material: MeshStandardMaterial | MeshBasicMaterial, hidden = false): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false; // (spread over the whole field)
    if (hidden) for (let i = 0; i < count; i++) mesh.setMatrixAt(i, HIDDEN);
    return mesh;
  };
  return {
    active: make(base, active),
    orb: make(orb, active),
    warmup: make(orb, warmup, true),
    almost: make(orb, almost, true),
  };
}
