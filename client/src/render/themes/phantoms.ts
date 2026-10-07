// Ghosts (original designs): little sheet ghosts with wavy hems, glowing orb spirits with wispy tails, and shadowy
// blobs with glowing eyes that peek up from behind graves. Translucent, glowing at their edges, solid only in the eyes;
// each fades in, lingers and fades away again on its own cycle, drifting in slow loops round its home (or rising from
// behind its grave). Their motion is all in the vertex shader. Each kind is one draw call.
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  type InstancedMesh,
  LatheGeometry,
  OctahedronGeometry,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector2,
} from "three";
import { type Placement, combine, instances, part } from "./shapes";

/** A part that is solid (the eyes: drawn opaque, untinted) or not (the body: translucent, tinted per ghost). */
function piece(geometry: BufferGeometry, color: number, solid: boolean, placement: Placement = {}): BufferGeometry {
  const g = part(geometry, color, placement);
  g.setAttribute("solid", new Float32BufferAttribute(new Array<number>(g.getAttribute("position").count).fill(solid ? 1 : 0), 1));
  return g;
}

/** A sheet ghost, about 170 tall, facing +z, its hem at y = 0. */
function sheet(): BufferGeometry {
  const profile: Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16; // from the hem up
    const y = t * 170;
    // Flared at the hem, straight sides, a round head
    const r = t < 0.62 ? 64 - 10 * t : 58 * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2));
    profile.push(new Vector2(Math.max(0.5, r), y));
  }
  const body = new LatheGeometry(profile, 20);
  // A wavy hem
  const pos = body.getAttribute("position");
  for (let v = 0; v < pos.count; v++) {
    if (pos.getY(v) < 30) {
      const angle = Math.atan2(pos.getZ(v), pos.getX(v));
      pos.setY(v, pos.getY(v) + (1 - pos.getY(v) / 30) * 14 * Math.sin(angle * 6));
    }
  }
  body.computeVertexNormals();
  return combine([
    piece(body, 0xffffff, false),
    piece(new SphereGeometry(10, 8, 6), 0x140c1e, true, { position: [-20, 118, 50], scale: [0.8, 1.25, 0.6] }),
    piece(new SphereGeometry(10, 8, 6), 0x140c1e, true, { position: [20, 118, 50], scale: [0.8, 1.25, 0.6] }),
    piece(new SphereGeometry(9, 8, 6), 0x140c1e, true, { position: [0, 92, 55], scale: [0.9, 1.1, 0.5] }), // "oo"
  ]);
}

/** An orb spirit: a round glowing body with a wispy tail streaming back, facing +z. */
function orb(): BufferGeometry {
  return combine([
    piece(new SphereGeometry(55, 16, 12), 0xffffff, false, { position: [0, 100, 0] }),
    piece(new ConeGeometry(42, 170, 12), 0xffffff, false, { position: [0, 82, -95], rotation: [-1.35, 0, 0] }),
    piece(new SphereGeometry(9, 8, 6), 0x140c1e, true, { position: [-19, 112, 48], scale: [0.8, 1.3, 0.6] }),
    piece(new SphereGeometry(9, 8, 6), 0x140c1e, true, { position: [19, 112, 48], scale: [0.8, 1.3, 0.6] }),
  ]);
}

/** A sky jelly: a domed bell with a frilled rim and trailing tentacles, two small eyes; about 260 from bell to
 *  tentacle tips, the bell's rim at y = 0. */
function jelly(): BufferGeometry {
  const parts: BufferGeometry[] = [
    piece(new SphereGeometry(85, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xffffff, false, { scale: [1, 0.8, 1] }),
    piece(new ConeGeometry(70, 26, 18, 1, true), 0xffffff, false, { position: [0, -10, 0], rotation: [Math.PI, 0, 0] }),
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = i % 2 === 0 ? 48 : 26;
    const length = 150 + (i % 3) * 45;
    parts.push(piece(new ConeGeometry(7, length, 5), 0xffffff, false, { position: [Math.cos(a) * r, -length / 2 - 8, Math.sin(a) * r], rotation: [Math.PI, 0, 0] }));
  }
  parts.push(piece(new SphereGeometry(7, 6, 5), 0x140c1e, true, { position: [-22, 30, 72] }));
  parts.push(piece(new SphereGeometry(7, 6, 5), 0x140c1e, true, { position: [22, 30, 72] }));
  return combine(parts);
}

/** An ice sprite: a floating crystal, a tall faceted diamond with smaller shards about it, two eyes; facing +z. */
function crystal(): BufferGeometry {
  return combine([
    piece(new OctahedronGeometry(60, 0), 0xffffff, false, { position: [0, 120, 0], scale: [1, 1.9, 0.8] }),
    piece(new OctahedronGeometry(22, 0), 0xffffff, false, { position: [-70, 150, 0], rotation: [0, 0, 0.5], scale: [1, 2, 1] }),
    piece(new OctahedronGeometry(22, 0), 0xffffff, false, { position: [70, 150, 0], rotation: [0, 0, -0.5], scale: [1, 2, 1] }),
    piece(new SphereGeometry(8, 6, 5), 0x0e1a2e, true, { position: [-17, 130, 44], scale: [0.8, 1.2, 0.6] }),
    piece(new SphereGeometry(8, 6, 5), 0x0e1a2e, true, { position: [17, 130, 44], scale: [0.8, 1.2, 0.6] }),
  ]);
}

/** A shadow peeker: a dark blob with two glowing, slanted eyes, facing +z. */
function peeker(): BufferGeometry {
  return combine([
    piece(new SphereGeometry(70, 16, 12), 0xffffff, false, { position: [0, 60, 0], scale: [1.15, 0.85, 0.9] }),
    piece(new SphereGeometry(11, 8, 6), 0xffd34a, true, { position: [-24, 78, 56], rotation: [0, 0, 0.35], scale: [1.3, 0.7, 0.5] }),
    piece(new SphereGeometry(11, 8, 6), 0xffd34a, true, { position: [24, 78, 56], rotation: [0, 0, -0.35], scale: [1.3, 0.7, 0.5] }),
  ]);
}

const vertexShader = /* glsl */ `
uniform float time;
uniform float period; // seconds of one appear-linger-vanish cycle (each ghost varies it)
uniform float speed; // of its loop (rad/s); 0: it stays put
uniform float radius; // of its loop
uniform float bob; // up and down
uniform float rise; // how far it sinks out of sight while faded (a peeker behind its grave)
attribute float solid;
varying vec3 vColor;
varying float vSolid;
varying float vFade;
varying float vRim;
#include <fog_pars_vertex>

vec3 turn(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
  vec3 home = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float own = fract(sin(dot(home.xz, vec2(12.9898, 78.233))) * 43758.5453);
  // Fade in, linger, fade out, stay gone a while
  float s = fract(time / (period * (0.75 + 0.5 * own)) + own);
  vFade = smoothstep(0.0, 0.15, s) * (1.0 - smoothstep(0.6, 0.75, s));
  // A slow loop round home, facing the way it goes (or, not moving, as placed)
  float direction = own > 0.5 ? 1.0 : -1.0;
  float a = time * speed * (0.7 + 0.6 * fract(own * 7.3)) * direction + own * 6.2832;
  float heading = speed > 0.0 ? (direction > 0.0 ? -a : 3.14159265 - a) : 0.0;
  vec3 offset = vec3(cos(a) * radius, sin(time * 0.9 + own * 20.0) * bob + rise * (vFade - 1.0), sin(a) * radius);
  vec3 local = (instanceMatrix * vec4(position, 1.0)).xyz - home;
  // A gentle sway as it floats
  float sway = sin(time * 1.3 + own * 9.0) * 0.08;
  local = turn(local, heading + sway);
  vec4 world = modelMatrix * vec4(home + offset + local, 1.0);
  vec3 n = normalize(turn(mat3(instanceMatrix) * normal, heading + sway));
  vRim = 1.0 - abs(dot(n, normalize(cameraPosition - world.xyz)));
  vSolid = solid;
  #ifdef USE_INSTANCING_COLOR
    vColor = solid > 0.5 ? color : color * instanceColor;
  #else
    vColor = color;
  #endif
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform float opacity;
varying vec3 vColor;
varying float vSolid;
varying float vFade;
varying float vRim;
#include <fog_pars_fragment>
void main() {
  // The body: see-through in the middle, glowing at its edges; the eyes: solid
  float rim = pow(vRim, 1.6);
  vec3 color = vSolid > 0.5 ? vColor : vColor * (0.75 + 0.6 * rim);
  float alpha = vSolid > 0.5 ? vFade : vFade * opacity * (0.35 + 0.65 * rim);
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export type GhostKind = "sheet" | "orb" | "peeker" | "jelly" | "crystal";

interface Behaviour {
  readonly period: number;
  readonly speed: number;
  readonly radius: number;
  readonly bob: number;
  readonly rise: number;
  readonly opacity: number;
}

const BEHAVIOUR: Readonly<Record<GhostKind, Behaviour>> = {
  sheet: { period: 16, speed: 0.09, radius: 280, bob: 55, rise: 0, opacity: 0.8 },
  orb: { period: 12, speed: 0.2, radius: 650, bob: 90, rise: 0, opacity: 0.75 },
  peeker: { period: 10, speed: 0, radius: 0, bob: 8, rise: 150, opacity: 0.9 },
  jelly: { period: 22, speed: 0.04, radius: 260, bob: 220, rise: 0, opacity: 0.7 },
  crystal: { period: 18, speed: 0.07, radius: 300, bob: 90, rise: 0, opacity: 0.75 },
};

const GEOMETRY: Readonly<Record<GhostKind, () => BufferGeometry>> = { sheet, orb, peeker, jelly, crystal };

/** Ghosts of one kind at their homes (each placement's tint colours its body). The mesh's `userData.reach` is how far
 *  they wander from home. Returns the mesh and its clock. */
export function buildGhosts(kind: GhostKind, homes: readonly (Placement & { tint: Color })[]): { mesh: InstancedMesh; time: { value: number } } {
  const b = BEHAVIOUR[kind];
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...UniformsUtils.clone(UniformsLib.fog),
      time,
      period: { value: b.period },
      speed: { value: b.speed },
      radius: { value: b.radius },
      bob: { value: b.bob },
      rise: { value: b.rise },
      opacity: { value: b.opacity },
    },
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = instances(GEOMETRY[kind](), material, homes);
  mesh.name = `ghost: ${kind}`;
  mesh.userData["reach"] = b.radius + b.bob;
  return { mesh, time };
}

/** Tints for ghost bodies: pale lavender, mint, sky, rose. */
export const GHOST_TINTS = [0xe4dcff, 0xc8fff0, 0xcfe4ff, 0xffd8f0].map((c) => new Color(c));
