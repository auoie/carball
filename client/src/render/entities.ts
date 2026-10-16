// Visuals built from the physics shapes: the car is a body around its hitbox (src/render/carModel.ts), the ball is
// its collision sphere. Real models come later (roadmap §10).
import { AdditiveBlending, BackSide, BufferAttribute, type BufferGeometry, Color, FrontSide, Group, IcosahedronGeometry, LinearSRGBColorSpace, type Material, Mesh, MeshStandardMaterial, type Object3D, PlaneGeometry, type Quaternion, ShaderMaterial, type Side, SphereGeometry, Vector3 } from "three";
import type { CarConfig, Team } from "../engine/world";
import { RETICLE, RETICLE_GLSL_FN } from "./ballShadow";
import { buildCarModel, carExhausts } from "./carModel";
import { Trail, trailingRearWheels } from "./supersonic";
import { BOOST_TRAIL, IDLE_EXHAUST } from "./effects";
import { Emitter, type Particles } from "./particles";
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

/** A car: the boxy model built around its hitbox (src/render/carModel.ts), in the car's local frame (x forward, y up,
 *  z right), its boost trail and idle exhaust; and, in the world, its supersonic trails and shockwave
 *  (src/render/supersonic.ts). (No boost cone: the user's decision, 2026-10-14: one boost, the trail) */
/** The exhausts, where the boost trail and idle exhaust come out: the Fennec's BoostEmitterLeft/Right sockets,
 *  (-57, -+20.43, 10.25) in its mesh's frame, the mesh 2.6115 uu above the car's origin and not shifted along x
 *  (boost_standard.json car_attachment.sockets: RV-81; every car here is drawn Fennec-style), in the car's Three.js
 *  frame */
export const EXHAUSTS: readonly [Vector3, Vector3] = [new Vector3(-57, 10.25 + 2.6115, -20.43), new Vector3(-57, 10.25 + 2.6115, 20.43)];

export class CarView {
  /** Add this to the scene: the car and its effects */
  readonly root = new Group();
  readonly #body = new Group(); // posed as the car
  /** The model it built (what `dispose` frees: not what's attached, the flip's effect being the game's) */
  readonly #model: Object3D;
  readonly #trails: readonly [Trail, Trail] = [new Trail(), new Trail()];
  /** Where the trails leave the car: its rear corners, a little above the middle (local frame) */
  readonly #trailFrom: readonly [Vector3, Vector3];

  readonly #point = new Vector3();
  /** Each exhaust's boost trail and idle exhaust (with a scene's particles) */
  readonly #exhausts: readonly { readonly at: Vector3; readonly trail: Emitter; readonly idle: Emitter }[];
  readonly #axis = new Vector3();
  #wasDemoed = false;

  /** `particles`: the scene's, for the boost trail and the idle exhaust (none: no particles); `car`: the garage's car
   *  (its look: src/game/cars.ts), painted in `team`'s colour */
  constructor(config: CarConfig, team: Team, particles: Particles | null = null, car = 0) {
    const model = buildCarModel(config, TEAM_CAR_COLORS[team], team, car);
    this.#model = model;
    // (the game's sockets on its Fennec, where it's loaded; our bodies' at their backs, found before it's posed: RV-470)
    const exhausts = model.userData["gameMesh"] === true ? EXHAUSTS : carExhausts(model, config, car);
    this.#body.add(model);
    this.#exhausts = particles
      ? exhausts.map((at) => ({ at, trail: new Emitter(particles, BOOST_TRAIL), idle: new Emitter(particles, IDLE_EXHAUST) }))
      : [];
    this.root.add(this.#body, ...this.#trails.map((t) => t.mesh));
    // The rear tyres' contact points at rest (car frame: the bottom of each, as the model draws them)
    const back = config.backWheel;
    const height = back.offset.z - (back.suspensionRest - WHEEL_TRAVEL) - back.radius;
    const side = config.hitboxSize.y / 2 - 8;
    this.#trailFrom = [new Vector3(back.offset.x, height, -side), new Vector3(back.offset.x, height, side)];
  }

  /** Puts `object` on the car, in its frame (x forward, y up, z right): it moves and turns with it (once) */
  attach(object: Object3D): void {
    if (object.parent !== this.#body) this.#body.add(object);
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

  /** A car replaced or gone (RV-467): its model's and trails' geometries and materials freed, its exhausts' particles
   *  gone; its root taken out of the scene first. What's attached isn't its own: left alone */
  dispose(): void {
    for (const { trail, idle } of this.#exhausts) {
      trail.kill();
      idle.kill();
    }
    const free = (o: Object3D): void => {
      if (!(o instanceof Mesh)) return;
      (o.geometry as BufferGeometry).dispose();
      const material = o.material as Material | Material[];
      for (const m of Array.isArray(material) ? material : [material]) m.dispose();
    };
    // (the loaded game mesh's geometry and paint are shared by every car showing it: left)
    if (this.#model.userData["gameMesh"] !== true) this.#model.traverse(free);
    for (const t of this.#trails) free(t.mesh);
  }

  /** How many points the trails have (for tests). */
  get trailLength(): number {
    return Math.max(...this.#trails.map((t) => t.length));
  }
}

/** The ball, faceted and patched so its spin is visible, plus its reticle on the floor straight below it (VT-30a). */
export class BallView {
  readonly root = new Group();
  readonly #ball: Mesh;
  readonly #material: MeshStandardMaterial;
  readonly #marker: Mesh;
  /** The ball's centre's height (uu: the inner ring's contraction) */
  readonly #altitude = { value: 0 };
  /** The ball's FX actor's other pieces (VT-30a): the location beam, the far ring and the clarity sphere */
  readonly #beam: Mesh;
  readonly #ring: Mesh;
  readonly #sphere: Mesh;
  /** Since the ball's FX actor was made (a spawn, a reset, a replay's ball: s) */
  #sinceSpawn = 0;
  /** The goal line's effect on the ball (VT-31): the mouth's plane where the ball is crossing it (Three's frame), the
   *  goals' nearness, the FX time, on unless dissolving */
  readonly #goalLine = {
    planeLoc: { value: new Vector3() },
    planeN: { value: new Vector3() },
    proximity: { value: 0 },
    time: { value: 0 },
    on: { value: 0 },
  };
  #opacity = 1;

  constructor() {
    // (transparent throughout: it dissolves on a goal and fades in at a kickoff)
    this.#material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1, flatShading: true, transparent: true });
    addGoalLineEffect(this.#material, this.#goalLine);
    this.#ball = new Mesh(patchedBallGeometry(), this.#material);
    // The game's reticle: a decal 192 uu square straight down from the ball's centre, square to the world's axes (it
    // never turns), its two white rings added (src/render/ballShadow.ts); just over the floor's pieces, under the pads
    this.#marker = new Mesh(
      new PlaneGeometry(RETICLE.half * 2, RETICLE.half * 2),
      new ShaderMaterial({
        vertexShader: MARKER_VERTEX,
        fragmentShader: MARKER_FRAGMENT,
        uniforms: { altitude: this.#altitude },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.#marker.rotation.x = -Math.PI / 2;
    this.#marker.renderOrder = 1; // (over the floor and its markings)
    // The FX actor's group (its sort priority 2, the decal's 1): plain alpha, unlit, white or black, none faded in
    const fx = (geometry: BufferGeometry, vertexShader: string, fragmentShader: string, depthTest: boolean, side: Side = FrontSide): Mesh => {
      const mesh = new Mesh(geometry, new ShaderMaterial({ vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest, side }));
      mesh.renderOrder = 2;
      mesh.visible = false;
      return mesh;
    };
    // (the beam: a strip 2 uu wide from the ball's centre 2500 uu down, turned about the vertical to face the camera)
    this.#beam = fx(new PlaneGeometry(BALL_FX.beam.width, BALL_FX.beam.length).translate(0, -BALL_FX.beam.length / 2, 0), BEAM_VERTEX, BEAM_FRAGMENT, true);
    // (the far ring: a 192 uu billboard at the ball, through everything)
    this.#ring = fx(new PlaneGeometry(BALL_FX.ring.size, BALL_FX.ring.size), RING_VERTEX, RING_FRAGMENT, false);
    // (the clarity sphere: 128 uu, seen from inside, black, its rim soft)
    this.#sphere = fx(new SphereGeometry(BALL_FX.sphere.radius, 32, 16), SPHERE_VERTEX, SPHERE_FRAGMENT, true, BackSide);
    this.root.add(this.#ball, this.#marker, this.#sphere, this.#beam, this.#ring);
  }

  update(position: Vector3, rotation: Quaternion): void {
    this.#ball.position.copy(position);
    this.#ball.quaternion.copy(rotation);
    // On the floor straight below the ball; its inner ring by the height of the ball's centre (no fade: VT-30a)
    this.#marker.position.set(position.x, MARKER_HEIGHT, position.z);
    this.#altitude.value = position.y;
    for (const piece of [this.#beam, this.#ring, this.#sphere]) piece.position.copy(position);
    // (the goal line's plane and the goals' nearness: the game's per frame, VT-31; Three's z the game's y)
    const line = goalLine(position.x, position.z, position.y);
    this.#goalLine.proximity.value = line.proximity;
    if (line.plane) {
      this.#goalLine.planeLoc.value.set(position.x, position.y, line.plane.y);
      this.#goalLine.planeN.value.set(0, 0, line.plane.n);
    } else this.#goalLine.planeN.value.set(0, 0, 0);
  }

  /** A new ball (a kickoff, a goal's reset): it fades in over 1 s (VT-30); `instant`: shown at once (a replay's,
   *  freeplay's placements) */
  spawn(instant = false): void {
    this.#opacity = instant ? 1 : 0;
    this.#sinceSpawn = 0; // (a new FX actor: its beam, ring and sphere come again, VT-30a)
    this.#show(false);
  }

  /** This frame's look: exploded, the ball's Dissolve falls at 3/s (Ball_TA's BallFadeOutSpeed -3: 0.333 s, VT-15),
   *  its marker gone at once; else it rises at 1/s (after a spawn); the frame time capped at 1/30 either way (RV-30) */
  fade(exploded: boolean, seconds: number): void {
    const dt = Math.min(Math.max(0, seconds), 1 / 30);
    this.#opacity = exploded ? Math.max(0, this.#opacity - 3 * dt) : Math.min(1, this.#opacity + dt);
    this.#sinceSpawn += Math.max(0, seconds);
    this.#goalLine.time.value += Math.max(0, seconds);
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
    // (the goal line's effect: not under the dissolve, VT-31)
    this.#goalLine.on.value = !exploded && this.#opacity >= 1 ? 1 : 0;
    // (popping on 1 s after the FX actor's made, the beam's first particle a second later; gone at once on the explosion)
    this.#ring.visible = !exploded && this.#sinceSpawn >= BALL_FX.attach;
    this.#sphere.visible = this.#ring.visible;
    this.#beam.visible = !exploded && this.#sinceSpawn >= BALL_FX.beam.first;
  }

  /** The goal line's effect now (for tests): its plane's normal (Three's frame; 0 off), the goals' nearness, whether on */
  get goalLineState(): { readonly normalZ: number; readonly proximity: number; readonly on: boolean } {
    return { normalZ: this.#goalLine.planeN.value.z, proximity: this.#goalLine.proximity.value, on: this.#goalLine.on.value > 0 };
  }

  /** Which of the FX actor's other pieces show (for tests) */
  get fxShown(): { readonly beam: boolean; readonly ring: boolean; readonly sphere: boolean } {
    return { beam: this.#beam.visible, ring: this.#ring.visible, sphere: this.#sphere.visible };
  }

  /** The reticle's place on the floor, and the height its inner ring is drawn for (for tests). */
  get marker(): { readonly x: number; readonly z: number; readonly altitude: number } {
    return { x: this.#marker.position.x, z: this.#marker.position.z, altitude: this.#altitude.value };
  }
}

/** The goal line's effect on the ball (notes/visual-timing.md VT-31, the static session's BR1): the goal volume's face
 *  (y = -/+5120, |x| <= 960, -64 <= z <= 688, its normal toward the field) where the ball's centre projects onto it
 *  and the ball is less than its radius from it on the field side; the goals' nearness 1 - min(d / 2048, 1) from the
 *  nearer goal's location (0, -/+5120, 312); in the ball's shader: past the plane (g over 1 uu) its albedo darkened
 *  to nothing, a white-hot line where the plane cuts it (96 x), an 8 Hz sawtooth glow (8 x: facing outside, a rim
 *  inside) and a shake (1 + 4 g uu); the game's lit honeycomb (its ball texture's: 4.1 uu, 0.74 uu lines, line/cell
 *  albedo 0.18/0.087) drawn by rule in the part past the plane, our ball's own look kept elsewhere */
export const GOAL_LINE = {
  y: 5120,
  halfWidth: 960,
  z: [-64, 688] as const,
  location: { z: 312 },
  near: 2048,
  line: 96,
  flicker: { gain: 8, hz: 8 },
  shake: { base: 1, inside: 4, rates: [204.331, 155.14, 145.444] as const },
  honeycomb: { spacing: 4.1, line: 0.74, albedo: [0.18, 0.087] as const },
} as const;

/** The goal line's plane for a ball at (x, y, z) (game frame): which goal's face (y and its normal's y), if the ball's
 *  crossing it; and the nearer goal's nearness */
export function goalLine(x: number, y: number, z: number): { readonly plane: { readonly y: number; readonly n: number } | null; readonly proximity: number } {
  const G = GOAL_LINE;
  const side = y >= 0 ? 1 : -1;
  const proximity = 1 - Math.min(Math.hypot(x, y - side * G.y, z - G.location.z) / G.near, 1);
  const s = side * (G.y * side - y); // (the centre's distance on the field side of the face)
  const onFace = Math.abs(x) <= G.halfWidth && z >= G.z[0] && z <= G.z[1];
  return { plane: onFace && s < BALL_RADIUS ? { y: side * G.y, n: -side } : null, proximity };
}

/** The goal line's effect added to the ball's material (VT-31); `u` its uniforms, set every frame */
function addGoalLineEffect(
  material: MeshStandardMaterial,
  u: { planeLoc: { value: Vector3 }; planeN: { value: Vector3 }; proximity: { value: number }; time: { value: number }; on: { value: number } },
): void {
  const G = GOAL_LINE;
  const [r0, r1, r2] = G.shake.rates;
  const [lineAlbedo, cellAlbedo] = G.honeycomb.albedo;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { glPlaneLoc: u.planeLoc, glPlaneN: u.planeN, glProximity: u.proximity, glTime: u.time, glOn: u.on });
    const common = `uniform vec3 glPlaneLoc;\nuniform vec3 glPlaneN;\nuniform float glProximity;\nuniform float glTime;\nuniform float glOn;\nvarying vec3 glWorld;\nvarying vec3 glLocal;`;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${common}`)
      .replace(
        "#include <project_vertex>",
        `vec4 glW = modelMatrix * vec4(transformed, 1.0);
        float glG = clamp(dot(glPlaneLoc - glW.xyz, glPlaneN), 0.0, 1.0);
        // (the shake, in the world's uu: the game's (x, y, z) as Three's (x, z, y))
        glW.xyz += glOn * (${G.shake.base.toFixed(1)} + ${G.shake.inside.toFixed(1)} * glG) * glProximity * vec3(sin(${r0} * glTime), cos(${r2} * glTime), sin(${r1} * glTime));
        glWorld = glW.xyz;
        glLocal = transformed;
        vec4 mvPosition = viewMatrix * glW;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${common}
// (the game's ball texture's honeycomb, by rule: its cells' distance to their edges on the ball's surface, three ways)
float glHexEdge(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - 0.5 * s;
  vec2 b = mod(p - 0.5 * s, s) - 0.5 * s;
  vec2 h = dot(a, a) < dot(b, b) ? a : b;
  h = abs(h);
  return 0.5 - max(dot(h, normalize(s)), h.x);
}
vec3 glHoneycomb(vec3 p, vec3 n) {
  vec3 w = abs(n) / (abs(n.x) + abs(n.y) + abs(n.z));
  float e = w.x * glHexEdge(p.yz / ${G.honeycomb.spacing.toFixed(2)}) + w.y * glHexEdge(p.zx / ${G.honeycomb.spacing.toFixed(2)}) + w.z * glHexEdge(p.xy / ${G.honeycomb.spacing.toFixed(2)});
  float halfLine = ${(G.honeycomb.line / 2 / G.honeycomb.spacing).toFixed(4)};
  float aa = fwidth(e);
  float line = 1.0 - smoothstep(halfLine - aa, halfLine + aa, e);
  // (cells under a pixel or so: their average)
  float mean = ${(((G.honeycomb.line / G.honeycomb.spacing) * 2) * lineAlbedo + (1 - (G.honeycomb.line / G.honeycomb.spacing) * 2) * cellAlbedo).toFixed(4)};
  return vec3(mix(mix(${cellAlbedo.toFixed(3)}, ${lineAlbedo.toFixed(3)}, line), mean, smoothstep(0.1, 0.3, aa * 4.0)));
}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float glD = dot(glPlaneLoc - glWorld, glPlaneN);
        float glG = glOn * clamp(glD, 0.0, 1.0);
        vec3 glAlbedo = diffuseColor.rgb;
        diffuseColor.rgb *= 1.0 - glG;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (glOn > 0.0 && dot(glPlaneN, glPlaneN) > 0.0) {
          vec3 glN = normalize(cross(dFdx(glLocal), dFdy(glLocal)));
          vec3 glD3 = mix(glAlbedo, glHoneycomb(glLocal, glN), glG);
          float glNdotV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          // (the line: 1 uu, a pixel and a half at least, as bright as it's narrow)
          float glW = max(1.0, fwidth(glD) * 1.5);
          float glLine = clamp(1.0 - abs(2.0 * (glD - 0.5) / glW), 0.0, 1.0) / glW;
          float glFlicker = ${G.flicker.gain.toFixed(1)} * fract(${G.flicker.hz.toFixed(1)} * glTime) * glProximity
            * mix(pow(clamp(glNdotV - 0.5, 0.0, 1.0), 2.0), pow(1.0 - glNdotV, 2.0), glG);
          totalEmissiveRadiance += glD3 * (${G.line.toFixed(1)} * glLine + glFlicker);
        }`,
      );
  };
  material.customProgramCacheKey = () => "goalLine";
}

/** The ball's FX actor's pieces besides the reticle (VT-30a, the static session's BR1): attached 1 s after it's made; the
 *  location beam (Ball_LocationBeam01_PS: a strip 2 x 2500 uu down from the ball's centre, its dashes every 78.125 uu,
 *  alpha 0.0625 at most, faded near the screen's centre; its emitter's first particle at 2 s), the far ring (Reticle_Mat:
 *  192 uu, its ring at d2 0.875, only for balls 2048 to 4096 uu or more from the camera) and the clarity sphere (128 uu,
 *  black, (N.V sat(depth / 2049))^2) */
export const BALL_FX = {
  attach: 1,
  beam: { width: 2, length: 2500, dash: 78.125, alpha: 0.0625, first: 2 },
  ring: { size: 192, at: 0.875, near: 2048, far: 4096 },
  sphere: { radius: 128, depth: 2049 },
} as const;

// The beam: turned about the vertical toward the camera; s its distance below the ball's centre; its screen position
// for the fade near the screen's centre (plain [0, 1] screen uv)
const BEAM_VERTEX = /* glsl */ `
varying float vBelow;
varying vec4 vClip;
void main() {
  vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 toCamera = cameraPosition - centre;
  vec3 across = normalize(vec3(toCamera.z, 0.0, -toCamera.x) + vec3(1e-6, 0.0, 0.0));
  vec3 world = centre + across * position.x + vec3(0.0, position.y, 0.0);
  vBelow = -position.y;
  vClip = projectionMatrix * viewMatrix * vec4(world, 1.0);
  gl_Position = vClip;
}
`;

const BEAM_FRAGMENT = /* glsl */ `
varying float vBelow;
varying vec4 vClip;
void main() {
  float a = 0.25 + clamp(8.0 * (sin(${(2 * Math.PI).toFixed(6)} * vBelow / ${BALL_FX.beam.dash.toFixed(3)}) - 0.75), 0.0, 0.75);
  vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;
  vec2 off = uv - 0.5;
  float fade = clamp(4.0 * (dot(off, off) - 0.0625), 0.0, 1.0);
  gl_FragColor = vec4(1.0, 1.0, 1.0, ${BALL_FX.beam.alpha.toFixed(4)} * a * fade);
}
`;

// The far ring: facing the camera, its view depth for the distance it shows from
const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 view = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0) + vec4(position.xy, 0.0, 0.0);
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const RING_FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vDepth;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d2 = dot(p, p);
  float ring = clamp(4.0 * (1.0 - abs(12.0 * (${BALL_FX.ring.at.toFixed(3)} - d2))), 0.0, 1.0);
  float far = max(0.0, 2.0 * clamp(vDepth / ${BALL_FX.ring.far.toFixed(1)}, 0.0, 1.0) - 1.0);
  gl_FragColor = vec4(1.0, 1.0, 1.0, ring * far);
}
`;

// The clarity sphere: its inside's faces, the normal inward, against the view; black
const SPHERE_VERTEX = /* glsl */ `
varying vec3 vInward;
varying vec3 vToCamera;
varying float vDepth;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vInward = -normalize(mat3(modelMatrix) * normal);
  vToCamera = cameraPosition - world.xyz;
  vec4 view = viewMatrix * world;
  vDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const SPHERE_FRAGMENT = /* glsl */ `
varying vec3 vInward;
varying vec3 vToCamera;
varying float vDepth;
void main() {
  float k = clamp(dot(normalize(vInward), normalize(vToCamera)), 0.0, 1.0) * clamp(vDepth / ${BALL_FX.sphere.depth.toFixed(1)}, 0.0, 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, k * k);
}
`;

/** The reticle's height over the floor (uu): over the field's pieces (its raised centre ring at 2), under the pads */
const MARKER_HEIGHT = 2.5;

const MARKER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The game's rings (VT-30a), white, added: the plane's uv across its 192 uu, so p = uv * 2 - 1 = (P - ball) / 96
const MARKER_FRAGMENT = /* glsl */ `
uniform float altitude;
varying vec2 vUv;
${RETICLE_GLSL_FN}
void main() {
  gl_FragColor = vec4(vec3(ballReticle(vUv * 2.0 - 1.0, altitude)), 1.0);
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

