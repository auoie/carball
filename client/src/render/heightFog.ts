// The stadium's height fog as the exe's (notes/arena-surroundings.md FOG-1..15: ExponentialHeightFog_0, the fog pass's
// and the translucent base pass's maths): nothing within 10240 uu of the camera, then an exponential in height along
// the sight line, floored at 0.1; its colour from the fog actor's own direction (not the sun), weakly orange toward the
// -X horizon, blue elsewhere. Opaque geometry and the sky take it as a pass (in the cube capture its view depth capped
// at 31,887 uu), translucents per vertex. Three's axes (x, y up, z = the game's y), uu.
import { AdditiveBlending, type Camera, type Material, type Object3D, type ShaderMaterial, Vector3 } from "three";

/** The fog's constants (FOG-5): Cd's base (Density / 1000) and height, f (Falloff / 1000), the start, the floor (1 -
 *  MaxOpacity), p (the exe's -0.30103 / ln(0.5 - 0.5 cos 22.5)), the light vector (Rotation(-2131, -32905, 2467)
 *  .Vector(), three's axes), the opposite and inscattering colours (gamma 2.2 x brightness) */
export const HEIGHT_FOG = {
  density: 7.5e-5,
  height: 6783.999,
  falloff: 2.0e-4,
  start: 10240,
  floor: 0.10000002,
  p: 0.0920979,
  light: [-0.9790941, -0.2029826, 0.0131425] as const,
  opposite: [0.0290958, 0.0776102, 0.1062447] as const,
  inscatter: [1.0, 0.325037, 0.0] as const,
} as const;

/** The game's sky dome (8,388,608 x 5,033,165 uu): the sky's fog is at its distance, not our dome's */
export const RL_DOME = { radius: 8388608, height: 5033165 } as const;

/** The GrassCube's opaque cap (FOG-8): the view depth where deviceZ reaches 0.999 (before the exe's 1 + 1e-8 z) */
export const CUBE_FOG_CAP = 31897.44;

/** Cd for a camera at height `y` (the game's z) */
export function fogCd(y: number): number {
  return HEIGHT_FOG.density * 2 ** (-HEIGHT_FOG.falloff * (y - HEIGHT_FOG.height));
}

type V3 = readonly [number, number, number];

/** The fog for a receiver at `delta` from the camera: F (what of the scene shows) and the colour added ((1 - F) x
 *  the inscatter's) (FOG-6; the shader's rlHeightFog) */
export function heightFog(delta: V3, cd: number): { F: number; add: [number, number, number] } {
  const F0 = HEIGHT_FOG;
  const dist = Math.hypot(...delta);
  const ez = Math.abs(delta[1]) > 0.01 ? delta[1] : 0.01;
  const fz = F0.falloff * ez;
  const line = (cd * Math.max(dist - F0.start, 0) * (1 - 2 ** -fz)) / fz;
  const F = Math.max(Math.min(2 ** -line, 1), F0.floor);
  const d = dist > 1e-3 ? dist : 1e-3;
  const t = Math.abs(0.5 - (0.499 * (F0.light[0] * delta[0] + F0.light[1] * delta[1] + F0.light[2] * delta[2])) / d) ** F0.p;
  const add = [0, 1, 2].map((k) => (1 - F) * ((F0.inscatter[k] ?? 0) + t * ((F0.opposite[k] ?? 0) - (F0.inscatter[k] ?? 0)))) as [number, number, number];
  return { F, add };
}

/** An opaque receiver's delta as the fog pass sees it: its view depth along `axis` capped (the cube capture's 31,887; the
 *  main view none) and the exe's z / (1 + 1e-8 z) (the shader's rlOpaqueDelta) */
export function opaqueDelta(delta: V3, axis: V3, cap: number): [number, number, number] {
  const z = delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2];
  const capped = Math.min(z, cap);
  const s = capped / Math.max(z, 1e-6) / (1 + 1e-8 * capped);
  return [delta[0] * s, delta[1] * s, delta[2] * s];
}

/** The sky's delta along a direction: the game's dome's distance (FOG-15) */
export function skyDelta(dir: V3): [number, number, number] {
  const [x, y, z] = dir;
  const r = 1 / Math.sqrt((x * x + z * z) / RL_DOME.radius ** 2 + (y * y) / RL_DOME.height ** 2);
  return [x * r, y * r, z * r];
}

const f = (v: number): string => v.toPrecision(8);

/** The shader chunk (FOG-15): uniforms uFogCam (the camera, uu), uFogCd (fogCd of its height), uFogCap (CUBE_FOG_CAP in the
 *  capture, 1e30 in the main view), uFogAxis (the view's forward axis; the cube face's in the capture). rlHeightFog(delta)
 *  gives (premultiplied colour, F): opaque c * F + rgb; translucent (per vertex) c * F + rgb; additive c * F */
export const HEIGHT_FOG_GLSL = /* glsl */ `
uniform vec3 uFogCam;
uniform float uFogCd;
uniform float uFogCap;
uniform vec3 uFogAxis;
vec4 rlHeightFog(vec3 delta) {
  float dist = length(delta);
  float ez = abs(delta.y) > 0.01 ? delta.y : 0.01;
  float fz = ${f(HEIGHT_FOG.falloff)} * ez;
  // ((1 - 2^-fz) / fz: in float32 1 - 2^-fz cancels for small fz (the sight line level), so there its series: the
  // exact value, as the TS twin's)
  float k = fz * 0.69314718;
  float gain = abs(fz) < 0.01 ? 0.69314718 * (1.0 - 0.5 * k + k * k / 6.0) : (1.0 - exp2(-fz)) / fz;
  float line = uFogCd * max(dist - ${f(HEIGHT_FOG.start)}, 0.0) * gain;
  float F = max(min(exp2(-line), 1.0), ${f(HEIGHT_FOG.floor)});
  float t = pow(abs(0.5 - 0.499 * dot(vec3(${HEIGHT_FOG.light.map(f).join(", ")}), delta / max(dist, 1e-3))), ${f(HEIGHT_FOG.p)});
  vec3 ins = vec3(${HEIGHT_FOG.inscatter.map(f).join(", ")});
  vec3 opp = vec3(${HEIGHT_FOG.opposite.map(f).join(", ")});
  return vec4((1.0 - F) * mix(ins, opp, t), F);
}
vec3 rlOpaqueDelta(vec3 worldPos) {
  vec3 d = worldPos - uFogCam;
  float z = dot(d, uFogAxis);
  float capped = min(z, uFogCap);
  return d * (capped / max(z, 1e-6)) / (1.0 + 1e-8 * capped);
}
vec3 rlSkyDelta(vec3 dir) {
  float r = inversesqrt((dir.x * dir.x + dir.z * dir.z) / ${f(RL_DOME.radius ** 2)} + dir.y * dir.y / ${f(RL_DOME.height ** 2)});
  return dir * r;
}
`;

/** How a material takes the fog (FOG-10): opaque per pixel (capped in the capture); the sky at the game's dome's
 *  distance; a far layer at its own distance (`distance`: the skyline's towers, drawn nearer than they are); translucent
 *  and additive per vertex (c F + fog; c F), at the vertex or, given `distance`, that far along its direction; custom
 *  (the chunk, the uniforms and vFogWorld given: the shader fogs itself); none */
export type FogMode = "opaque" | "sky" | "far" | "translucent" | "additive" | "custom" | "none";

/** The uniforms every fogged material shares (one object each, set from the camera drawing: updateHeightFog) */
export const HEIGHT_FOG_UNIFORMS = {
  uFogCam: { value: new Vector3() },
  uFogCd: { value: fogCd(0) },
  uFogCap: { value: 1e30 },
  uFogAxis: { value: new Vector3(0, 0, -1) },
};

let lastCamera: Camera | null = null;
let lastFrame = -1;

/** The uniforms for `camera` (its position, Cd at its height, its forward axis; the capture's cap when its
 *  userData.fogCap says so), once per camera and frame */
export function updateHeightFog(camera: Camera, frame: number): void {
  if (camera === lastCamera && frame === lastFrame) return;
  [lastCamera, lastFrame] = [camera, frame];
  const U = HEIGHT_FOG_UNIFORMS;
  camera.getWorldPosition(U.uFogCam.value);
  camera.getWorldDirection(U.uFogAxis.value);
  U.uFogCd.value = fogCd(U.uFogCam.value.y);
  const cap = (camera.userData as { fogCap?: number }).fogCap;
  U.uFogCap.value = cap ?? 1e30;
}

/** The fog put into a shader material (its shaders amended, the shared uniforms added; once) */
export function withHeightFog<T extends ShaderMaterial>(material: T, mode: FogMode, distance?: number): T {
  const data = material.userData as { heightFog?: FogMode; fogDistance?: number };
  if (data.heightFog !== undefined) return material;
  data.heightFog = mode;
  if (distance !== undefined) data.fogDistance = distance;
  if (mode === "none") return material;
  Object.assign(material.uniforms, HEIGHT_FOG_UNIFORMS);
  const along = (world: string): string => (distance === undefined ? `${world} - uFogCam` : `normalize(${world} - uFogCam) * ${f(distance)}`);
  const perVertex = mode === "translucent" || mode === "additive";
  const world = `
  #ifdef USE_INSTANCING
    vFogWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
  #else
    vFogWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  #endif
  ${perVertex ? `vFog = rlHeightFog(${along("vFogWorld")});` : ""}`;
  material.vertexShader = beforeLastBrace(`varying vec3 vFogWorld;\n${perVertex ? `varying vec4 vFog;\n${HEIGHT_FOG_GLSL}` : ""}\n${material.vertexShader}`, world);
  const apply = {
    custom: "",
    opaque: "vec4 rlFog = rlHeightFog(rlOpaqueDelta(vFogWorld));\n  gl_FragColor.rgb = gl_FragColor.rgb * rlFog.a + rlFog.rgb;",
    sky: "vec4 rlFog = rlHeightFog(rlOpaqueDelta(uFogCam + rlSkyDelta(normalize(vFogWorld - uFogCam))));\n  gl_FragColor.rgb = gl_FragColor.rgb * rlFog.a + rlFog.rgb;",
    far: `vec4 rlFog = rlHeightFog(rlOpaqueDelta(uFogCam + ${along("vFogWorld")}));\n  gl_FragColor.rgb = gl_FragColor.rgb * rlFog.a + rlFog.rgb;`,
    translucent: "gl_FragColor.rgb = gl_FragColor.rgb * vFog.a + vFog.rgb;",
    additive: "gl_FragColor.rgb *= vFog.a;",
  }[mode];
  material.fragmentShader = `varying vec3 vFogWorld;\n${perVertex ? "varying vec4 vFog;" : HEIGHT_FOG_GLSL}\n${material.fragmentShader}`;
  if (apply) material.fragmentShader = beforeLastBrace(material.fragmentShader, `  {\n  ${apply}\n  }`);
  material.needsUpdate = true;
  return material;
}

/** `code` put just before a shader's last closing brace (its main's end) */
function beforeLastBrace(shader: string, code: string): string {
  const at = shader.lastIndexOf("}");
  if (at < 0) throw new Error("a shader without a main");
  return `${shader.slice(0, at)}${code}\n${shader.slice(at)}`;
}

/** The fog for every shader material under `root` that hasn't its own (opaque, translucent or additive by its
 *  blending), and its meshes' uniforms set from the camera drawing them; other materials are left as they are */
export function fogAll(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Object3D & { material?: Material | Material[] };
    if (!mesh.material) return;
    let fogged = false;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!(m as ShaderMaterial).isShaderMaterial) continue;
      const shader = m as ShaderMaterial;
      const mode: FogMode = !shader.transparent ? "opaque" : shader.blending === AdditiveBlending ? "additive" : "translucent";
      withHeightFog(shader, (shader.userData as { heightFog?: FogMode }).heightFog ?? mode);
      fogged ||= (shader.userData as { heightFog?: FogMode }).heightFog !== "none";
    }
    if (fogged) {
      const before = object.onBeforeRender.bind(object);
      object.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        updateHeightFog(camera, renderer.info.render.frame);
        before(renderer, scene, camera, geometry, material, group);
      };
    }
  });
}
