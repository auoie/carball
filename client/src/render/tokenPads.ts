// The greenhouse's boost pads (ours: the user's requests, 2026-10-17, "small penny boost pads on the ground and then
// popping circle boost pads that give 100", "still kind of like the game where they are slightly 3d"; the game's idea at
// its footprint, nothing of its art), calm and readable:
// - a small pad a low rounded puck (a "penny", the game's small base's 48 uu radius) raised a little off the grass:
//   its top glowing warm orange-yellow, its bevelled rim catching the light; taken, dark metal (as the game's go dark);
// - a big pad a slightly taller round pedestal (the game's big base's ~90 uu reach) with a glowing ball floating above
//   it (the game's 100-boost orb): a pickup pops the ball (a quick swell and fade, a soft halo burst); while it's down
//   the pedestal's top rim fills round as a clock wipe over the 10 s, then the ball pops back in.
// No spin, no confetti, no decals. The pads' timing is the engine's (active, cooldown: VT-11/12/13 unchanged); lit by a
// fixed key light and unlit otherwise, so it reads the same with High Quality Shaders on or off. Instanced: four draws
// (pucks, pedestals, balls, halos), ~2.6k triangles in all (the pads' 3k budget).
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  type Object3D,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { type BoostPadState, padPickedUp } from "../engine/world";

/** Seconds a taken pad stays down (VehiclePickup RespawnDelay x RespawnDelayScale 1): the engine's pad cooldown. */
export const PAD_RESPAWN_SECONDS = { big: 10, small: 4 } as const;

/** A view of the boost pads, updated each frame from the engine's pads (`seconds` since the last update; none given: its
 *  fades at their end at once) */
export interface PadsView {
  readonly root: Object3D;
  update(pads: readonly BoostPadState[], seconds?: number): void;
}

/** The pads' measures (uu, s): the puck and the pedestal (radius, height, bevel, their sides' segments), the ball
 *  (radius, its centre's height), the halo round it (its size, its burst's growth), the pops (a pickup's, a return's),
 *  the pedestal's top rim band carrying the clock wipe (shares of its radius) */
export const TOKENS = {
  puck: { radius: 48, height: 8, bevel: 4, segments: 10 },
  pedestal: { radius: 90, height: 16, bevel: 5, segments: 14 },
  ball: { radius: 36, z: 96 },
  halo: { size: 64, burst: 2.6 },
  pop: { out: 0.22, in: 0.26 },
  rimBand: [0.7, 0.92] as const,
} as const;

/** The pads' warm glow (linear): their tops and rims, the ball's; a taken pad's metal */
export const TOKEN_COLOURS = {
  glow: new Color(1, 0.55, 0.1),
  rim: new Color(1, 0.82, 0.42),
  dark: new Color(0.05, 0.045, 0.04),
} as const;

/** The key light the pads are shaded by (Night's sun's direction, Three's frame) */
const KEY_LIGHT = new Vector3(3000, 8000, 2000).normalize();

/** A return's scale over its pop (a small overshoot: easeOutBack) */
export function popIn(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  const c = 1.4;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

/** A pickup's pop: the ball swelling and fading out */
export function popOut(t: number): { readonly scale: number; readonly fade: number } {
  const x = Math.min(1, Math.max(0, t));
  return { scale: 1 + 0.7 * Math.sqrt(x), fade: (1 - x) ** 2 };
}

/** A big pad's rim fill while it's down (the share of its recharge done), 1 while up */
export function ringFill(pad: Pick<BoostPadState, "active" | "cooldown">): number {
  return pad.active ? 1 : Math.min(1, Math.max(0, 1 - pad.cooldown / PAD_RESPAWN_SECONDS.big));
}

/** A low round base: its top flat to the bevel, one bevelled band to the side, the side down to the grass; its normals
 *  smoothed across the bevel (the top's, leaning out at its edge, to the side's), so it shades round on few triangles
 *  (5 a segment) */
export function roundBase(radius: number, height: number, bevel: number, segments: number): BufferGeometry {
  // (the rings: the top's edge, the side's top, the foot: (radius, height, the normal's lean out from straight up))
  const rings = [
    [radius - bevel, height, 0.38],
    [radius, height - bevel, 0.92],
    [radius, 0, 1],
  ] as const;
  const position: number[] = [0, height, 0];
  const normal: number[] = [0, 1, 0];
  for (const [r, y, lean] of rings) {
    for (let k = 0; k < segments; k++) {
      const a = (2 * Math.PI * k) / segments;
      const [c, sn] = [Math.cos(a), Math.sin(a)];
      position.push(r * c, y, r * sn);
      const up = Math.sqrt(Math.max(0, 1 - lean * lean));
      normal.push(lean * c, up, lean * sn);
    }
  }
  const ring = (j: number, k: number): number => 1 + j * segments + (k % segments);
  const index: number[] = [];
  for (let k = 0; k < segments; k++) {
    // (the top's fan, facing up; each band's quads, facing out)
    index.push(0, ring(0, k + 1), ring(0, k));
    for (let j = 0; j < rings.length - 1; j++) index.push(ring(j, k), ring(j, k + 1), ring(j + 1, k), ring(j, k + 1), ring(j + 1, k + 1), ring(j + 1, k));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

/** The bases (instance colour: the rim's fill share, lit 1 / taken 0): a glowing top, a rim catching the key light, the
 *  side shaded by it; taken, dark metal with a faint rim; a pedestal's top rim band its clock wipe */
const baseVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPad;
  #include <fog_pars_vertex>
  void main() {
    vLocal = position;
    vPad = instanceColor;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vView = cameraPosition - world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const baseFragment = /* glsl */ `
  uniform vec3 glow;
  uniform vec3 rim;
  uniform vec3 dark;
  uniform vec3 keyLight;
  uniform float radius;
  varying vec3 vLocal;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPad;
  #include <fog_pars_fragment>
  void main() {
    vec3 n = normalize(vNormal);
    float diffuse = max(dot(n, keyLight), 0.0);
    float facing = abs(dot(n, normalize(vView)));
    float top = smoothstep(0.92, 0.99, n.y);
    float bevel = (1.0 - top) * smoothstep(0.25, 0.7, n.y);
    float r = length(vLocal.xz) / radius;
    float lit = vPad.y;
    vec3 shine = rim * pow(1.0 - facing, 3.0) * 0.5;
    vec3 litColour = mix(glow * (0.35 + 0.35 * diffuse), glow * mix(1.05, 0.8, r), top);
    litColour = mix(litColour, rim * (0.65 + 0.45 * diffuse), bevel) + shine;
    vec3 darkColour = dark * (0.7 + 0.9 * diffuse) + rim * 0.06 * bevel + rim * pow(1.0 - facing, 3.0) * 0.08;
    vec3 colour = mix(darkColour, litColour, lit);
    #ifdef PEDESTAL
      // (the clock wipe round the top rim band from twelve o'clock, while the pad is down: done bright, to come dark)
      float band = top * smoothstep(${TOKENS.rimBand[0].toFixed(2)} - 0.015, ${TOKENS.rimBand[0].toFixed(2)} + 0.015, r) * (1.0 - smoothstep(${TOKENS.rimBand[1].toFixed(2)} - 0.015, ${TOKENS.rimBand[1].toFixed(2)} + 0.015, r));
      float a = fract(atan(vLocal.x, vLocal.z) / 6.2831853 + 1.0);
      float filled = max(lit, step(a, vPad.x));
      colour = mix(colour, mix(dark * 2.5, rim * 1.15, filled), band);
    #endif
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

/** The ball: a glowing sphere, bright at its heart, softer at its rim (instance colour r: its fade) */
const ballVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vFade;
  #include <fog_pars_vertex>
  void main() {
    vFade = instanceColor.r;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * position);
    vView = cameraPosition - world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const ballFragment = /* glsl */ `
  uniform vec3 glow;
  uniform vec3 rim;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vFade;
  #include <fog_pars_fragment>
  void main() {
    float facing = abs(dot(normalize(vNormal), normalize(vView)));
    vec3 colour = mix(glow * 0.9, rim * 1.3, pow(facing, 2.0)) * vFade;
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
    #ifdef USE_FOG
      gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  }`;

/** The halo: an additive camera-facing glow round the ball (its size the instance's scale, instance colour r its level) */
const haloVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vLevel;
  void main() {
    vUv = position.xy;
    vLevel = instanceColor.r;
    vec4 centre = viewMatrix * modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float size = length(instanceMatrix[0].xyz);
    gl_Position = projectionMatrix * (centre + vec4(position.xy * size, 0.0, 0.0));
  }`;
const haloFragment = /* glsl */ `
  uniform vec3 glow;
  varying vec2 vUv;
  varying float vLevel;
  void main() {
    // (tight round the ball, falling off fast: the user's, 2026-10-17)
    float soft = max(0.0, 1.0 - length(vUv));
    gl_FragColor = vec4(glow * soft * soft * soft * 0.55 * vLevel, 1.0);
  }`;

interface PadSlot {
  readonly big: boolean;
  /** Its instance in the pucks' or the pedestals' (the balls' and halos' too, a big pad's) */
  readonly slot: number;
  readonly at: Vector3;
  active: boolean | null;
  since: number;
  /** Its cooldown last seen (a jump back up while taken: taken again the tick it returned) */
  cooldown: number;
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

export class TokenPadsView implements PadsView {
  readonly root = new Group();
  readonly #pucks: InstancedMesh;
  readonly #pedestals: InstancedMesh;
  readonly #balls: InstancedMesh;
  readonly #halos: InstancedMesh;
  readonly #slots: PadSlot[];
  #time = 0;
  readonly #m = new Matrix4();
  readonly #c = new Color();

  constructor(pads: readonly BoostPadState[]) {
    const count = (big: boolean): number => Math.max(1, pads.filter((p) => p.big === big).length);
    const fog = (): Record<string, { value: unknown }> => UniformsUtils.clone(UniformsLib.fog);
    const colours = {
      glow: { value: TOKEN_COLOURS.glow },
      rim: { value: TOKEN_COLOURS.rim },
      dark: { value: TOKEN_COLOURS.dark },
      keyLight: { value: KEY_LIGHT },
    };
    const base = (shape: typeof TOKENS.puck | typeof TOKENS.pedestal, pedestal: boolean, n: number): InstancedMesh =>
      new InstancedMesh(
        roundBase(shape.radius, shape.height, shape.bevel, shape.segments),
        new ShaderMaterial({
          vertexShader: baseVertex,
          fragmentShader: baseFragment,
          defines: pedestal ? { PEDESTAL: "" } : {},
          uniforms: { ...fog(), ...colours, radius: { value: shape.radius } },
          fog: true,
        }),
        n,
      );
    this.#pucks = base(TOKENS.puck, false, count(false));
    this.#pedestals = base(TOKENS.pedestal, true, count(true));
    this.#balls = new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: ballVertex,
        fragmentShader: ballFragment,
        uniforms: { ...fog(), ...colours },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: true,
      }),
      count(true),
    );
    this.#halos = new InstancedMesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        uniforms: { glow: { value: TOKEN_COLOURS.glow } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      count(true),
    );
    for (const mesh of [this.#pucks, this.#pedestals, this.#balls, this.#halos]) mesh.frustumCulled = false;
    this.#halos.renderOrder = 3;
    const slots = { big: 0, small: 0 };
    this.#slots = pads.map((pad) => ({
      big: pad.big,
      slot: pad.big ? slots.big++ : slots.small++,
      at: new Vector3(pad.pos.x, 0, pad.pos.y),
      active: null,
      since: 0,
      cooldown: 0,
    }));
    for (const s of this.#slots) {
      const mesh = s.big ? this.#pedestals : this.#pucks;
      mesh.setMatrixAt(s.slot, this.#m.makeTranslation(s.at.x, 0, s.at.z));
      mesh.setColorAt(s.slot, this.#c.setRGB(1, 1, 0));
    }
    for (let i = 0; i < count(true); i++) {
      this.#balls.setColorAt(i, this.#c.setRGB(1, 0, 0));
      this.#halos.setColorAt(i, this.#c.setRGB(1, 0, 0));
    }
    this.root.add(this.#pucks, this.#pedestals, this.#balls, this.#halos);
    this.update(pads, 0);
  }

  update(pads: readonly BoostPadState[], seconds = Infinity): void {
    const dt = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    this.#time += dt;
    const t = this.#time;
    pads.forEach((pad, i) => {
      const s = this.#slots[i];
      if (!s) return;
      // (a change in this frame, or taken again the tick it came back (a car parked on it): its age the frame's time on its
      // first frame; the ball's pop played either way)
      const retaken = s.active === false && padPickedUp({ active: false, cooldown: s.cooldown }, pad);
      if (s.active !== pad.active || retaken) {
        s.since = s.active === null ? -10 : t - dt;
        s.active = pad.active;
      }
      s.cooldown = pad.cooldown;
      (s.big ? this.#pedestals : this.#pucks).setColorAt(s.slot, this.#c.setRGB(s.big ? ringFill(pad) : 1, pad.active ? 1 : 0, 0));
      if (s.big) this.#ball(s, pad.active, t - s.since);
    });
    for (const mesh of [this.#pucks, this.#pedestals, this.#balls, this.#halos]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** A big pad's ball: popped back in on a return, swollen and faded out on a pickup with its halo bursting, else gone */
  #ball(s: PadSlot, active: boolean, age: number): void {
    const pop = active
      ? { scale: age < TOKENS.pop.in ? popIn(age / TOKENS.pop.in) : 1, fade: 1 }
      : age < TOKENS.pop.out
        ? popOut(age / TOKENS.pop.out)
        : { scale: 0, fade: 0 };
    const r = TOKENS.ball.radius * Math.max(0, pop.scale);
    this.#balls.setMatrixAt(s.slot, r > 0 && pop.fade > 0 ? this.#m.makeScale(r, r, r).setPosition(s.at.x, TOKENS.ball.z, s.at.z) : HIDDEN);
    this.#balls.setColorAt(s.slot, this.#c.setRGB(pop.fade, 0, 0));
    const burst = active ? Math.max(0, pop.scale) : 1 + (TOKENS.halo.burst - 1) * Math.sqrt(Math.min(1, age / TOKENS.pop.out));
    const h = TOKENS.halo.size * burst;
    this.#halos.setMatrixAt(s.slot, h > 0 && pop.fade > 0 ? this.#m.makeScale(h, h, h).setPosition(s.at.x, TOKENS.ball.z, s.at.z) : HIDDEN);
    this.#halos.setColorAt(s.slot, this.#c.setRGB(pop.fade, 0, 0));
  }
}
