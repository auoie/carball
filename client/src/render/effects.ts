// The game's effects as emitters (src/render/particles.ts), with the values of its default boost (Boost_Standard) and
// goal explosion (Explosion_Default), from the static session's rl-fx/1 descriptions (notes/visual-timing.md VT-2,
// VT-16): values only, the look our own. A demolition's: src/render/demolition.ts.
import {
  AdditiveBlending,
  Color,
  Mesh,
  type Object3D,
  ShaderMaterial,
  SphereGeometry,
} from "three";
import type { Vec3 } from "../math/vec";
import { toThreeVector } from "./coords";
import { Demolition } from "./demolition";
import { type Curve, type Curve3, Emitter, type EmitterSpec, Particles, evaluate } from "./particles";

const curve = (times: readonly number[], values: readonly number[]): Curve => ({ times, values });
const curve3 = (values: readonly [number, number, number]): Curve3 => ({ times: [0], values: [values] });
/** A curve per axis (or per colour channel), as the game scales each (0x140ae7f40: RV-87) */
const curveXYZ = (times: readonly number[], values: readonly (readonly [number, number, number])[]): Curve3 => ({ times, values });
// (the curves at the data's own knots: rl-fx/1 size, alpha, colour and velocity over life, the materials' parameters)
const T20 = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

/** The default boost's paint (no team colour on boost: Boost_Standard's CustomColor default) */
export const BOOST_COLOR = [3, 0.625, 0.1] as const;

/** SmokePuff_Mat: the puffs turn from the particle's colour to 0.5 grey, rgb ~ lerp(0.5, C, P1) */
const PUFF_GREY = [0.5, 0.5, 0.5] as const;

/** Boost_Painted_PS on the Fennec's two sockets: puffs spawned by distance (its per-socket SpawnRate 1-4 per 32 uu,
 *  drawn each frame; a move over 128 uu a frame isn't filled), so a car boosting in place leaves none and the trail
 *  lingers after the boost stops; its per-socket ParticleSize 20-35 (single-exhaust bodies: 50-100); no inherited
 *  velocity; drifting up, slowing (VelocityOverLifetime) */
export const BOOST_TRAIL: EmitterSpec = {
  name: "boost trail",
  blend: "translucent",
  duration: 1,
  loops: true,
  perUnit: { unit: 32, count: { min: 1, max: 4 }, maxFrame: 128 },
  lifetime: { min: 1, max: 1.5 },
  size: { min: 20, max: 35 },
  sizeOverLife: curve(
    [0.00132, 0.05373, 0.1061, 0.1585, 0.2109, 0.2634, 0.3158, 0.3682, 0.4206, 0.473, 0.5254, 0.5778, 0.6302, 0.6826, 0.735, 0.7874, 0.8398, 0.8922, 0.9446, 0.9971],
    [0.25, 0.695, 0.9081, 0.9754, 0.9826, 1.013, 1.062, 1.113, 1.163, 1.213, 1.261, 1.307, 1.349, 1.388, 1.423, 1.452, 1.475, 1.491, 1.5, 1.5],
  ),
  acceleration: [{ min: [0, 0, 0], max: [0, 0, 30] }],
  velocityOverLife: curve(
    [-0.001478, 0.05288, 0.1072, 0.1616, 0.2159, 0.2703, 0.3247, 0.379, 0.4334, 0.4877],
    [0.9891, 0.9633, 0.8943, 0.7944, 0.676, 0.5514, 0.4329, 0.333, 0.264, 0.2382],
  ),
  color: BOOST_COLOR,
  colorFade: {
    to: PUFF_GREY,
    param: curve([-0.000579, 0.05524, 0.111, 0.1669, 0.2227, 0.2785, 0.3343, 0.3901, 0.4459], [0.9951, 0.9633, 0.8773, 0.751, 0.5981, 0.4327, 0.2687, 0.1198, 0]),
  },
  alpha: 1,
  alphaOverLife: curve(
    [0, 0.05215, 0.1043, 0.1565, 0.2086, 0.2608, 0.3129, 0.3651, 0.4172, 0.4694, 0.5215, 0.5737, 0.6258, 0.678, 0.7302, 0.7823, 0.8345, 0.8866, 0.9388, 0.9909],
    [0.1745, 0.5637, 0.9435, 0.9209, 0.8619, 0.7776, 0.679, 0.5772, 0.4833, 0.4082, 0.363, 0.3525, 0.3285, 0.2845, 0.2275, 0.1647, 0.1034, 0.05076, 0.01389, 0],
  ),
};

/** Drive_PS: the idle exhaust while throttling and not boosting (10 a second, blown back), in the exhaust's own frame:
 *  the puffs move with the car (bUseLocalSpace), turning grey */
export const IDLE_EXHAUST: EmitterSpec = {
  name: "idle exhaust",
  blend: "translucent",
  duration: 0.25,
  loops: true,
  rate: 10,
  lifetime: { min: 0.5, max: 1 },
  size: { min: 6.5, max: 12.5 },
  sizeOverLife: curve(T20, [1, 1.022, 1.084, 1.182, 1.312, 1.469, 1.648, 1.845, 2.056, 2.276, 2.5, 2.724, 2.944, 3.155, 3.352, 3.531, 3.688, 3.818, 3.916, 3.978, 4]),
  velocity: { min: [-50, -5, -5], max: [-100, 5, 5] },
  local: true,
  color: BOOST_COLOR,
  colorOverLife: curve(T20, [2, 1.986, 1.944, 1.879, 1.792, 1.688, 1.568, 1.437, 1.296, 1.149, 1, 0.8505, 0.704, 0.5635, 0.432, 0.3125, 0.208, 0.1215, 0.056, 0.0145, 0]),
  colorFade: {
    to: PUFF_GREY,
    param: curve(
      [0.003921, 0.0573, 0.1107, 0.164, 0.2174, 0.2708, 0.3242, 0.3775, 0.4309, 0.4843, 0.5377, 0.591],
      [1.034, 1.017, 0.9716, 0.9009, 0.8104, 0.7047, 0.5888, 0.4673, 0.3453, 0.2274, 0.1184, 0.02326],
    ),
  },
  alpha: 0.5,
  alphaOverLife: curve(T20, [0.25, 0.2482, 0.243, 0.2348, 0.224, 0.2109, 0.196, 0.1796, 0.162, 0.1437, 0.125, 0.1063, 0.088, 0.07044, 0.054, 0.03906, 0.026, 0.01519, 0.007, 0.001812, 0]),
};

const SPARK_KNOTS = [0, 0.05206, 0.1041, 0.1562, 0.2082, 0.2603, 0.3123, 0.3644, 0.4165, 0.4685, 0.5206, 0.5726, 0.6247, 0.6767, 0.7288, 0.7809, 0.8329, 0.885, 0.937, 0.9891, 1.041];
const SPARK_SIZE = curve(SPARK_KNOTS, [0.1407, 0.3562, 0.6105, 0.8381, 0.9736, 0.9849, 0.9702, 0.9437, 0.9064, 0.8598, 0.8051, 0.7435, 0.6764, 0.6051, 0.5308, 0.4548, 0.3784, 0.3028, 0.2295, 0.1596, 0.09441]);
const SPARK_ALPHA_KNOTS = [0.01363, 0.06444, 0.1153, 0.1661, 0.2169, 0.2677, 0.3185, 0.3693, 0.4201, 0.4709, 0.5218, 0.5726, 0.6234, 0.6742, 0.725, 0.7758, 0.8266, 0.8774, 0.9283, 0.9791];
const SPARK_ALPHA = curve(SPARK_ALPHA_KNOTS, [0.9776, 0.9698, 0.9474, 0.9122, 0.8659, 0.8102, 0.7467, 0.6773, 0.6036, 0.5274, 0.4503, 0.374, 0.3003, 0.2309, 0.1675, 0.1117, 0.06542, 0.03022, 0.007839, 0]);
const SMOKE_ALPHA = curve(
  [-0.003609, 0.04811, 0.09983, 0.1516, 0.2033, 0.255, 0.3067, 0.3584, 0.4102, 0.4619, 0.5136, 0.5653, 0.617, 0.6688, 0.7205, 0.7722, 0.8239, 0.8756, 0.9274, 0.9791],
  [0.00353, 0.9732, 0.994, 0.97, 0.9312, 0.8798, 0.8177, 0.7471, 0.6701, 0.5888, 0.5052, 0.4216, 0.3399, 0.2623, 0.1909, 0.1278, 0.07502, 0.03474, 0.009036, 0],
);
/** Smoke_Explosion_Mat: col = P1 C + (1 - P1) P2 (0.558, 0.502, 0.401): the team's colour fading to warm grey */
const SMOKE_WARM = [0.558, 0.502, 0.401] as const;
const SMOKE_P1 = curve(
  [-0.006707, 0.04527, 0.09725, 0.1492, 0.2012, 0.2532, 0.3052, 0.3571, 0.4091, 0.4611, 0.5131, 0.565, 0.617, 0.669, 0.721, 0.773, 0.8249, 0.8769, 0.9289, 0.9809],
  [1.011, 0.9041, 0.6563, 0.3764, 0.1732, 0.1222, 0.1001, 0.08111, 0.06492, 0.05133, 0.04011, 0.03104, 0.02389, 0.01842, 0.01442, 0.01166, 0.0099, 0.00893, 0.008513, 0.008424],
);
/** FlashSmall stays white; every other emitter takes the team's colour */
const WHITE_FLASH = "small flash";
const FLING: { min: [number, number, number]; max: [number, number, number] } = { min: [-16384, -16384, -16384], max: [16384, 16384, 16384] };
const SHRINK = curve([0, 0.9878], [1, 0.1251]);

/** Explosion_Default's emitters, in the scoring team's colour ('Color'); its ribbons (smoke and light trails behind the
 *  sparks) and its shadow are not drawn */
export const GOAL_EXPLOSION: readonly EmitterSpec[] = [
  {
    name: "smoke puffs",
    blend: "translucent",
    delay: 0.1,
    duration: 0.0625,
    rate: 512,
    lifetime: { min: 2, max: 5 },
    size: { min: 256, max: 768 },
    sizeOverLife: curve(
      [0, 0.05077, 0.1015, 0.1523, 0.2031, 0.2538, 0.3046, 0.3554, 0.4061, 0.4569, 0.5077, 0.5584, 0.6092, 0.66, 0.7107, 0.7615, 0.8122, 0.863, 0.9138, 0.9645],
      [0.7496, 0.7773, 0.8032, 0.8273, 0.8497, 0.8703, 0.8892, 0.9065, 0.9222, 0.9364, 0.949, 0.9601, 0.9698, 0.978, 0.9849, 0.9904, 0.9947, 0.9977, 0.9994, 1],
    ),
    sphere: { radius: curve([-0.000366, 0.07377, 0.1479], [0, 306.707, 311.369]), velocityScale: { min: 0.5, max: 1 } },
    velocityOverLife: curveXYZ(
      [-0.009479, 0.04393, 0.09734, 0.1507, 0.2042, 0.2576, 0.311, 0.3644],
      [
        [0.982, 0.9551, 0.9551],
        [0.9455, 0.9186, 0.9186],
        [0.8513, 0.8244, 0.8244],
        [0.7226, 0.6957, 0.6957],
        [0.5823, 0.5554, 0.5554],
        [0.4535, 0.4266, 0.4266],
        [0.3594, 0.3325, 0.3325],
        [0.3228, 0.2959, 0.2959],
      ],
    ),
    color: [4, 1, 0],
    colorFade: {
      to: SMOKE_WARM,
      param: SMOKE_P1,
      toScale: curve(
        [0.008308, 0.05913, 0.11, 0.1608, 0.2116, 0.2624, 0.3133, 0.3641, 0.4149, 0.4657, 0.5166, 0.5674, 0.6182, 0.669, 0.7199, 0.7707, 0.8215, 0.8723, 0.9231, 0.9739],
        [0.51, 0.509, 0.505, 0.499, 0.491, 0.482, 0.468, 0.444, 0.411, 0.371, 0.325, 0.277, 0.227, 0.178, 0.132, 0.089, 0.053, 0.025, 0.007, 0],
      ),
    },
    alphaOverLife: SMOKE_ALPHA,
  },
  {
    name: "smoke stretched",
    blend: "translucent",
    duration: 0.125,
    rate: 256,
    lifetime: { min: 0.5, max: 3 },
    size: { min: 128, max: 256 },
    length: { min: 512, max: 1024 },
    sizeOverLife: curve(
      [-0.001983, 0.04889, 0.09976, 0.1506, 0.2015, 0.2524, 0.3032, 0.3541, 0.405, 0.4558, 0.5067, 0.5576, 0.6085, 0.6593, 0.7102, 0.7611, 0.8119, 0.8628, 0.9137, 0.9645],
      [0.3998, 0.5262, 0.6404, 0.6897, 0.7208, 0.7511, 0.7805, 0.8088, 0.8358, 0.8614, 0.8854, 0.9076, 0.9278, 0.9459, 0.9617, 0.975, 0.9857, 0.9935, 0.9984, 1],
    ),
    // (its length: the data's size over life in Y, unlike X)
    lengthOverLife: curve(
      [-0.001983, 0.04889, 0.09976, 0.1506, 0.2015, 0.2524, 0.3032, 0.3541, 0.405, 0.4558, 0.5067, 0.5576, 0.6085, 0.6593, 0.7102, 0.7611, 0.8119, 0.8628, 0.9137, 0.9645],
      [0.1737, 0.7252, 0.9576, 0.9899, 0.992, 0.9938, 0.9953, 0.9965, 0.9976, 0.9984, 0.999, 0.9995, 0.9998, 1, 1.0001, 1.0001, 1.0001, 1.0001, 1, 1],
    ),
    velocity: { min: [-128, -128, -128], max: [128, 128, 128] },
    sphere: { radius: 256, velocityScale: { min: 2, max: 4 } },
    velocityOverLife: curveXYZ(
      [-0.009479, 0.04192, 0.09333, 0.1447, 0.1961, 0.2475, 0.2989],
      [
        [0.982, 0.9551, 0.9551],
        [0.9116, 0.8866, 0.8865],
        [0.7355, 0.7153, 0.7152],
        [0.5065, 0.4926, 0.4924],
        [0.2776, 0.27, 0.2696],
        [0.1015, 0.09872, 0.09829],
        [0.03104, 0.03021, 0.02974],
      ],
    ),
    color: [4, 1, 0],
    colorOverLife: curveXYZ(
      [-0.004774, 0.4629],
      [
        [3.615, 3.553, 3.615],
        [0.9592, 0.9875, 0.9733],
      ],
    ),
    colorFade: {
      to: SMOKE_WARM,
      param: SMOKE_P1,
      toScale: curve(
        [0, 0.051, 0.103, 0.154, 0.205, 0.256, 0.308, 0.359, 0.41, 0.461, 0.513, 0.564, 0.615, 0.666, 0.718, 0.769, 0.82, 0.871, 0.923, 0.974],
        [0.657, 0.656, 0.652, 0.645, 0.638, 0.628, 0.612, 0.581, 0.539, 0.487, 0.428, 0.365, 0.3, 0.235, 0.174, 0.118, 0.07, 0.033, 0.009, 0],
      ),
    },
    alphaOverLife: SMOKE_ALPHA,
  },
  {
    name: "trail parents",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 8 }],
    lifetime: { min: 0.125, max: 0.333 },
    size: 64,
    sizeOverLife: SPARK_SIZE,
    acceleration: [FLING, FLING],
    sphere: { radius: 96, surface: true, velocityScale: 128 },
    color: [4, 1, 0],
    colorOverLife: curve3([3.466352, 3.494587, 3.487528]),
    alphaOverLife: SPARK_ALPHA,
  },
  {
    name: "sparks",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 64 }],
    lifetime: { min: 0.25, max: 0.5 },
    size: 16,
    length: 128,
    sizeOverLife: SPARK_SIZE,
    acceleration: [FLING, { min: [0, 0, -8192], max: [0, 0, -8192] }],
    sphere: { radius: 96, surface: true, velocityScale: 64 },
    color: [4, 1, 0],
    colorOverLife: curve3([1.089699, 1.117931, 1.110872]),
    alphaOverLife: SPARK_ALPHA,
  },
  {
    name: "outer sparks",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 256 }],
    lifetime: { min: 0.5, max: 1 },
    size: { min: 3, max: 8 },
    length: { min: 48, max: 128 },
    sizeOverLife: SPARK_SIZE,
    sphere: { radius: 256, surface: true, velocityScale: 8 },
    velocityOverLife: curveXYZ(
      [-0.009479, 0.04272, 0.09491, 0.1471, 0.1993, 0.2515, 0.3037, 0.3559, 0.4081, 0.4603, 0.5125],
      [
        [0.982, 0.9551, 0.9551],
        [0.9563, 0.9301, 0.9309],
        [0.8864, 0.8621, 0.8654],
        [0.7834, 0.7619, 0.7688],
        [0.6584, 0.6403, 0.6515],
        [0.5223, 0.508, 0.5239],
        [0.3862, 0.3757, 0.3962],
        [0.2612, 0.254, 0.279],
        [0.1582, 0.1539, 0.1824],
        [0.08836, 0.08594, 0.1168],
        [0.06262, 0.0609, 0.09268],
      ],
    ),
    color: [3, 1, 0],
    colorOverLife: curve3([1.089699, 1.117931, 1.110872]),
    // (late, it flares: alpha up to 9.8, an intensity on an additive sprite)
    alphaOverLife: curve(SPARK_ALPHA_KNOTS, [0.9776, 0.9652, 0.9307, 0.8781, 0.8116, 0.7352, 0.6532, 0.5695, 0.4883, 0.4136, 0.3496, 0.3004, 0.27, 2.341, 9.794, 8.182, 5.679, 3.003, 0.8703, 0]),
  },
  {
    name: WHITE_FLASH,
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 1 }],
    lifetime: 0.1,
    size: 1536,
    sizeOverLife: SHRINK,
    color: [1, 1, 1],
    alpha: 16,
    alphaOverLife: curve(
      [-0.000442, 0.05111, 0.1027, 0.1542, 0.2058, 0.2573, 0.3089, 0.3604, 0.412, 0.4635, 0.5151, 0.5666, 0.6182, 0.6698, 0.7213, 0.7729, 0.8244, 0.876, 0.9275, 0.9791],
      [0, 0.9799, 0.2461, 0.2039, 0.1807, 0.169, 0.1666, 0.1715, 0.1814, 0.1941, 0.2074, 0.2193, 0.2276, 0.2299, 0.2243, 0.2085, 0.1803, 0.1376, 0.07824, 0],
    ),
  },
  {
    name: "big flash",
    blend: "additive",
    duration: 1,
    bursts: [{ time: 0, count: 1 }],
    lifetime: 0.5,
    size: 6144,
    sizeOverLife: SHRINK,
    color: [4, 1, 0],
    colorOverLife: 0.064084,
    alphaOverLife: curve(
      [-0.0334, 0.01722, 0.06785, 0.1185, 0.1691, 0.2197, 0.2703, 0.321, 0.3716, 0.4222, 0.4728, 0.5235, 0.5741, 0.6247, 0.6753, 0.726, 0.7766, 0.8272, 0.8778, 0.9285, 0.9791],
      [2.765, 2.618, 2.46, 2.293, 2.118, 1.938, 1.755, 1.571, 1.387, 1.207, 1.031, 0.863, 0.7037, 0.5554, 0.4203, 0.3004, 0.1977, 0.1143, 0.05215, 0.01338, 0],
    ),
  },
];

/** MeshStatic1: the electric sphere (radius 128 scaled 0.5 x its curve: about 30 to 1230 uu in its 0.5 s), additive */
const SPHERE = {
  life: 0.5,
  radius: 128 * 0.5,
  size: curve([0, 0.153, 0.305, 0.458, 0.61, 0.763, 0.915, 0.966], [0.471, 7.343, 12.253, 15.544, 17.561, 18.646, 19.142, 19.236]),
  color: curve([0, 0.068], [16.67, 5.878]),
  alpha: curve([-0.001, 0.157, 0.314, 0.471, 0.628, 0.786, 0.943, 0.995], [0, 0.503, 0.347, 0.235, 0.148, 0.078, 0.019, 0]),
} as const;

/** The goal explosion at the ball, in the scoring team's colour (linear): its emitters and its electric sphere, for its
 *  5 s life (the actor's LifeSpan); world time, so it slows with the goal's slow motion */
export class GoalExplosion {
  readonly #emitters: Emitter[];
  readonly #sphere: Mesh;
  readonly #material: ShaderMaterial;
  readonly #color: readonly [number, number, number];
  readonly #at: Vec3;
  #age = 0;

  constructor(particles: Particles, scene: Object3D, at: Vec3, color: readonly [number, number, number]) {
    this.#at = at;
    this.#color = color;
    this.#emitters = GOAL_EXPLOSION.map((spec) => {
      const e = new Emitter(particles, spec, spec.name === WHITE_FLASH ? spec.color : color);
      e.start();
      return e;
    });
    // (a shell, brightest at its rim: the game's sphere is a thin electric texture, not a fill)
    this.#material = new ShaderMaterial({
      uniforms: { tint: { value: new Color() } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 tint;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
          gl_FragColor = vec4(tint * rim * rim * rim, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.#sphere = new Mesh(new SphereGeometry(1, 24, 16), this.#material);
    toThreeVector(at, this.#sphere.position);
    scene.add(this.#sphere);
  }

  /** Whether it's over (its emitters done, its 5 s up: then the caller drops it) */
  get done(): boolean {
    return this.#age >= 5;
  }

  update(seconds: number): void {
    this.#age += Math.max(0, seconds);
    for (const e of this.#emitters) if (e.active) e.update(seconds, this.#at);
    const t = this.#age / SPHERE.life;
    this.#sphere.visible = t < 1;
    if (t < 1) {
      this.#sphere.scale.setScalar(SPHERE.radius * evaluate(SPHERE.size, t));
      // (Electricity_Mat: rgb = I C, I scaled by the vertex colour's alpha: an intensity, tone-mapped after, RV-46)
      const k = evaluate(SPHERE.color, t) * evaluate(SPHERE.alpha, t);
      const tone = (v: number): number => 1 - Math.exp(-Math.max(0, v * k));
      (this.#material.uniforms["tint"]?.value as Color).setRGB(tone(this.#color[0]), tone(this.#color[1]), tone(this.#color[2]));
    }
  }

  dispose(): void {
    this.#sphere.removeFromParent();
    this.#sphere.geometry.dispose();
    this.#material.dispose();
  }
}

/** The teams' primary colours (linear; the stadium's, AV-2): the goal explosion's 'Color' */
export const TEAM_PRIMARY: readonly (readonly [number, number, number])[] = [
  [0.098, 0.451, 1],
  [0.7647, 0.3922, 0.098],
];

/** A scene's effects: its particles and the goal explosions under way (world time) */
export class SceneEffects {
  readonly particles = new Particles();
  readonly #scene: Object3D;
  readonly #explosions: GoalExplosion[] = [];
  readonly #demolitions: Demolition[] = [];

  constructor(scene: Object3D) {
    this.#scene = scene;
    scene.add(this.particles.root);
  }

  /** A goal: the explosion at the ball (`at`, game frame), in the scoring team's colour */
  goal(at: Vec3, scoringTeam: number): void {
    this.#explosions.push(new GoalExplosion(this.particles, this.#scene, at, TEAM_PRIMARY[scoringTeam === 1 ? 1 : 0] ?? [1, 1, 1]));
  }

  /** Where the camera is (last drawn): the demolitions' husks collide only near it */
  camera: Vec3 | null = null;

  /** A car demolished: its effect at the car's origin (src/render/demolition.ts) */
  demolition(at: Vec3): void {
    this.#demolitions.push(new Demolition(this.particles, this.#scene, at));
  }

  update(seconds: number): void {
    for (const list of [this.#explosions, this.#demolitions] as (GoalExplosion | Demolition)[][]) {
      for (const e of list) e.update(seconds, this.camera);
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e?.done) {
          e.dispose();
          list.splice(i, 1);
        }
      }
    }
    this.particles.update(seconds);
  }
}
