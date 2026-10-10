// The stadium's crowd (notes/arena-surroundings.md SUR-26..31): every card one instanced draw, seated on the stands'
// tiers (src/render/themes/stadiumSurroundings.ts STANDS) where the game's are, its team rule, presence, bob and baked
// light the game's formulas.
import { type Color, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, ShaderMaterial, Vector3 } from "three";
import { fullBright } from "../teamColors";
import { seededRandom } from "./random";
import { STANDS, type TierName, rowsAt, tierRows } from "./stadiumSurroundings";

// --- The crowd (SUR-26..31) ------------------------------------------------------------------------------------------

/** The cards: 126 x 146.8 uu, 144 apart along a row, facing the centre; rows on the tiers (card centres, r and z):
 *  the lower bowl's 4 front rows and its main rake (az 27-171), the upper tiers' (az 76-139). No gaps but the open +X
 *  (|az| < 27) and the back's plaza (beyond 171); an aisle every 12 degrees */
export const CROWD = {
  card: [126, 146.8] as const,
  pitch: 144,
  aisle: { every: 12, width: 1.2 },
  /** The stands' tiers the cards sit on (their rows: STANDS; which of them at each az: rowsAt) */
  tiers: [
    { az: STANDS.lower.az, name: "front" },
    { az: STANDS.lower.az, name: "main" },
    { az: STANDS.lower.az, name: "third" },
    { az: STANDS.upper.az, name: "mid" },
    { az: STANDS.upper.az, name: "midBack" },
    { az: STANDS.upper.az, name: "top" },
  ] as readonly { readonly az: readonly [number, number]; readonly name: TierName }[],
  /** Baked light (a flat normal; the cards' means, RV-122): 0.194 round most of the bowl, 0.495 on the +X ends
   *  (Crowd_03, az 27-72: sunlit); its colour C0, warm (normalised: (1.07, 1.075, 0.855)) */
  light: { base: 0.194, sunlit: 0.495, sunlitAz: [27, 72] as const, tint: [1.07, 1.075, 0.855] as const },
  /** CrowdSize (SUR-28, 29) and the bob (SUR-30: 48 Cheer, Cheer stuck at 0.25) */
  size: 1.25,
  bob: 12,
} as const;

/** The teams' secondaries (AV-2) */
export const SECONDARY = [
  [0.5216, 0.8078, 0.902],
  [0.902, 0.2353, 0.098],
] as const;

const crowdVertex = /* glsl */ `
attribute vec3 card;
attribute vec3 seat; // (UV1.x, UV1.y, light)
uniform float time;
uniform float crowdSize;
uniform float bob;
varying vec2 vUv;
varying vec3 vCard;
varying vec2 vSeat;
varying float vTeam;
void main() {
  vUv = uv;
  vCard = card;
  vSeat = seat.yz;
  // (each card's instance matrix: its seat, facing the centre)
  vTeam = instanceMatrix[3].z < 0.0 ? 0.0 : 1.0;
  // Presence: x = 0.5 (lum + b - 0.5) + 0.35 UV1.y + CrowdSize - 1.375; the card sinks 128 where x < 1/32 (SUR-28)
  float lum = dot(card, vec3(0.3, 0.59, 0.11));
  float x = 0.5 * (lum + card.b - 0.5) + 0.35 * seat.y + crowdSize - 1.375;
  // (sunk its whole half height and the tread's offset under it: hidden, RV-128b)
  float sink = (1.0 - clamp(32.0 * x, 0.0, 1.0)) * 153.4;
  float bobbing = bob * sin(4.66943 * (time * (card.r + 0.5) + seat.x));
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position.x, position.y + bobbing - sink, 0.0, 1.0);
}
`;

/** The crowd's directional lightmap's scale over the HL2 basis sum (about 1 on the sphere's normal: with the disc's
 *  vertical wash, mean 0.5, the game's 0.495 over the disc; RV-122, the static session's cards' median 0.518) */
export const CROWD_LIGHT = 1;

/** A card's mean seen colour over its disc (the shader's, for tests): `card` its vertex colour, `seat` its UV1 and baked
 *  light, `colours` its team's primary, secondary and their full brights */
export function crowdSeen(
  card: readonly [number, number, number],
  seat: readonly [number, number, number],
  colours: { p: readonly number[]; s: readonly number[]; fp: readonly number[]; fs: readonly number[] },
  crowdSize: number = CROWD.size,
): [number, number, number] {
  const [r, g, b] = card;
  const sat = (x: number): number => Math.min(Math.max(x, 0), 1);
  const frac = (x: number): number => x - Math.floor(x);
  const p = sat(32 * (0.912 * frac(2.19298 * (r + g)) + 0.35 * seat[1] + crowdSize - 2));
  const m = sat(32 * (g - 0.75));
  const mix = (a: number, c: number, t: number): number => a + (c - a) * t;
  const albedo = [0, 1, 2].map((k) => {
    const C = mix(mix(colours.p[k] ?? 0, colours.s[k] ?? 0, m), mix(colours.fp[k] ?? 0, colours.fs[k] ?? 0, m), b);
    const team = Math.min(Math.max(8 * Math.min(Math.max(C, 0.0425), 1), 0), 2);
    return Math.min(Math.max(mix(1.5 * ((card[k] ?? 0) + 0.25), team, p), 0), 2);
  });
  // (the disc's mean of vUv.y x the light: sampled)
  let sum = 0;
  let count = 0;
  const basis = [[0.8164966, 0, 0.5773503], [-0.4082483, 0.7071068, 0.5773503], [-0.4082483, -0.7071068, 0.5773503]];
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) {
      const [qx, qy] = [((i + 0.5) / 40) * 2 - 1, ((j + 0.5) / 40) * 2 - 1];
      const q2 = qx * qx + qy * qy;
      if (q2 > 0.9) continue;
      const n = [0.8758 * qx, 0.8758 * qy, Math.sqrt(Math.max(0, 1 - 0.767 * q2))];
      const hl = basis.reduce((s, bb) => s + sat((n[0] ?? 0) * (bb[0] ?? 0) + (n[1] ?? 0) * (bb[1] ?? 0) + (n[2] ?? 0) * (bb[2] ?? 0)) ** 2, 0);
      sum += ((qy + 1) / 2) * CROWD_LIGHT * hl;
      count++;
    }
  }
  return albedo.map((a, k) => (a * seat[2] * (CROWD.light.tint[k] ?? 1) * sum) / count) as [number, number, number];
}

const crowdFragment = /* glsl */ `
uniform vec3 primary0;
uniform vec3 primary1;
uniform vec3 secondary0;
uniform vec3 secondary1;
uniform vec3 bright0;
uniform vec3 bright1;
uniform vec3 brightS0;
uniform vec3 brightS1;
uniform float crowdSize;
varying vec2 vUv;
varying vec3 vCard;
varying vec2 vSeat;
varying float vTeam;
void main() {
  // The ellipse (SUR-27): q = 2 uv - 1, |q|^2 <= 0.9; shaded as a sphere facing the sky
  vec2 q = 2.0 * vUv - 1.0;
  float q2 = dot(q, q);
  if (q2 > 0.9) discard;
  float nz = sqrt(max(0.0, 1.0 - 0.767 * q2));
  // The team rule (SUR-29)
  vec3 rgb = vCard;
  float p = clamp(32.0 * (0.912 * fract(2.19298 * (rgb.r + rgb.g)) + 0.35 * vSeat.x + crowdSize - 2.0), 0.0, 1.0);
  float m = clamp(32.0 * (rgb.g - 0.75), 0.0, 1.0);
  vec3 P = vTeam < 0.5 ? primary0 : primary1;
  vec3 S = vTeam < 0.5 ? secondary0 : secondary1;
  vec3 FP = vTeam < 0.5 ? bright0 : bright1;
  vec3 FS = vTeam < 0.5 ? brightS0 : brightS1;
  vec3 C = mix(mix(P, S, m), mix(FP, FS, m), rgb.b);
  vec3 team = clamp(8.0 * clamp(C, 0.0425, 1.0), 0.0, 2.0);
  vec3 neutral = 1.5 * (rgb + 0.25);
  vec3 albedo = clamp(mix(neutral, team, p), 0.0, 2.0) * vUv.y;
  // (the baked light on the sphere's normal: the directional lightmap's HL2 basis, sum sat(n . b)^2 about 1 over the
  // disc, at CROWD_LIGHT's scale: RV-122)
  vec3 n = vec3(0.8758 * q, nz);
  vec3 hl = clamp(vec3(dot(n, vec3(0.8164966, 0.0, 0.5773503)), dot(n, vec3(-0.4082483, 0.7071068, 0.5773503)), dot(n, vec3(-0.4082483, -0.7071068, 0.5773503))), 0.0, 1.0);
  gl_FragColor = vec4(albedo * vSeat.y * vec3(${CROWD.light.tint.join(", ")}) * ${CROWD_LIGHT.toFixed(3)} * dot(hl, hl), 1.0);
  #include <colorspace_fragment>
}
`;

/** The crowd: one instanced draw of every card; `update(seconds)` bobs them */
export function buildCrowd(primary0: Color, primary1: Color, seed = 7): { mesh: InstancedMesh; update(seconds: number): void } {
  const random = seededRandom(seed);
  const seatings: Matrix4[] = [];
  const cards: number[] = [];
  const seats: number[] = [];
  const { card, pitch, aisle, tiers, light } = CROWD;
  const tierOf: TierName[] = [];
  for (const { az: span, name } of tiers) {
    const tier = name === "front" || name === "main" || name === "third" ? STANDS.lower[name] : STANDS.upper[name];
    tierRows(tier).forEach(([r, z], row) => {
      const step = (pitch / r) * (180 / Math.PI);
      for (const sign of [1, -1]) {
        for (let az = span[0] + step / 2; az < span[1]; az += step) {
          // (the aisles; the rows with seats here)
          if (az % aisle.every < aisle.width) continue;
          const [from, to] = rowsAt(name, az);
          if (row < from || row >= to) continue;
          tierOf.push(name);
          const a = (sign * az * Math.PI) / 180;
          // (Three's frame: x, z up, the game's y; the card's right along the row, its face toward the centre)
          seatings.push(new Matrix4().makeRotationY(-a - Math.PI / 2).setPosition(r * Math.cos(a), z, r * Math.sin(a)));
          cards.push(random(), random(), random());
          const sunlit = az >= light.sunlitAz[0] && az <= light.sunlitAz[1];
          // UV1: x 1.196 - 0.007 |az| (the phase, the same on both halves: RV-132), y 1.0986 - 1.0994e-4 z (the height
          // ramp)
          seats.push(1.196 - 0.007 * az, 1.0986 - 1.0994e-4 * z, sunlit ? light.sunlit : light.base);
        }
      }
    });
  }
  const geometry = new PlaneGeometry(card[0], card[1]);
  geometry.setAttribute("card", new InstancedBufferAttribute(new Float32Array(cards), 3));
  geometry.setAttribute("seat", new InstancedBufferAttribute(new Float32Array(seats), 3));
  const v3 = (c: readonly number[]): Vector3 => new Vector3(c[0], c[1], c[2]);
  const time = { value: 0 };
  const material = new ShaderMaterial({
    vertexShader: crowdVertex,
    fragmentShader: crowdFragment,
    uniforms: {
      time,
      crowdSize: { value: CROWD.size },
      bob: { value: CROWD.bob },
      primary0: { value: primary0 },
      primary1: { value: primary1 },
      secondary0: { value: v3(SECONDARY[0]) },
      secondary1: { value: v3(SECONDARY[1]) },
      bright0: { value: v3(fullBright([primary0.r, primary0.g, primary0.b])) },
      bright1: { value: v3(fullBright([primary1.r, primary1.g, primary1.b])) },
      brightS0: { value: v3(fullBright(SECONDARY[0])) },
      brightS1: { value: v3(fullBright(SECONDARY[1])) },
    },
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(geometry, material, seatings.length);
  seatings.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
  });
  mesh.name = "crowd";
  // (each card's tier, for tests)
  mesh.userData["tiers"] = tierOf;
  // (the bob above each card's seat)
  mesh.userData["reach"] = CROWD.bob;
  // (all round the camera)
  mesh.frustumCulled = false;
  return {
    mesh,
    update: (seconds: number) => {
      time.value = seconds;
    },
  };
}
