// DFH Stadium (Stadium_P), the game's own soccar arena at sunset, from the static session's spec
// (notes/arena-visuals.md): its sky (H-10), its sun low from -X (AV-17), its sky light (AV-18), fog only beyond
// 10240 uu (AV-19), and the game's own arena materials for the cage, the walls and the glass (H-6, H-8, H-9) in the
// teams' primaries (AV-2). Values only: the look is built in code.
import { BackSide, Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, ShaderMaterial, SphereGeometry } from "three";
import { TEAM_PRIMARY_LINEAR, linear } from "../teamColors";
import type { Theme } from "./theme";

/** SkyDome_MAT (H-10): the zenith, the warm horizon added as q^4 (q = sat(2 (v - 0.5)), v 0 at the zenith, 1 at the
 *  horizon), pulled towards (1.496, 1.149, 0.531) by sat(-X_world 5.859e-8) on the sun's (-x) side, the whole times
 *  v. X_world on the game's dome: SkySphere01, a 65536 uu hemisphere scaled (128, 128, 76.8), so semi-axes 8388608
 *  across and 5033165 up (RV-69; about 0.49 at the -x horizon). The clouds, twinkles and fog hemisphere aren't drawn */
const SKY_ZENITH = [0.017, 0.043, 0.0546] as const;
const SKY_HORIZON_ADD = [1.479, 1.106, 0.476] as const;
const SKY_HORIZON = [1.496, 1.149, 0.531] as const;

const skyVertex = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const skyFragment = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizonAdd;
uniform vec3 horizon;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  // v: 0 at the zenith, 1 at the horizon (and below it)
  float v = clamp(1.0 - asin(clamp(d.y, 0.0, 1.0)) / 1.5707963, 0.0, 1.0);
  float q = clamp(2.0 * (v - 0.5), 0.0, 1.0);
  // (the game's world X of this direction on its dome; Three's y is up)
  float across = d.x * d.x + d.z * d.z;
  float t = 1.0 / sqrt(across / (8388608.0 * 8388608.0) + d.y * d.y / (5033165.0 * 5033165.0));
  float pull = clamp(-t * d.x * 5.859e-8, 0.0, 1.0);
  vec3 c = mix(zenith + q * q * q * q * horizonAdd, horizon, pull) * v;
  // (HDR: the same tone curve as every other shader here, until one global tone map: RV-64)
  gl_FragColor = vec4(1.0 - exp(-c), 1.0);
  #include <colorspace_fragment>
}
`;

export function stadiumTheme(): Theme {
  const root = new Group();
  // The sun (DirectionalLight__LC_1): from -X, 23.2 degrees up, (255, 241, 204), brightness 1; the sky light 1.5
  // (x pi: three.js's Lambert divides by pi where the game's doesn't: RV-70a)
  const sun = new DirectionalLight(linear([1, 0.883, 0.612]), Math.PI);
  sun.position.set(-0.919 * 10000, 0.393 * 10000, -0.007 * 10000);
  // The sky light: upper (255, 235, 186), lower (206, 255, 140), x 1.5
  const sky = new HemisphereLight(linear([1, 0.83, 0.49]), linear([0.62, 1, 0.26]), 1.5 * Math.PI);
  const dome = new Mesh(
    new SphereGeometry(30000, 48, 24), // (inside the camera's far plane from anywhere in the arena: RV-58)
    new ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms: { zenith: { value: linear(SKY_ZENITH) }, horizonAdd: { value: linear(SKY_HORIZON_ADD) }, horizon: { value: linear(SKY_HORIZON) } },
      side: BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.renderOrder = -1;
  root.add(sun, sky, dome);
  const [p0 = [0, 0, 1], p1 = [1, 0.5, 0]] = TEAM_PRIMARY_LINEAR;
  return {
    background: new Color(0x0b1418),
    // (ExponentialHeightFog: none inside the arena, from 10240 uu out; orange towards the sun)
    fog: new Fog(new Color().setRGB(0.42, 0.3, 0.16), 10240, 40000),
    style: {
      floor: new Color(0x3d5a2c),
      floorStripe: null,
      markings: null,
      walls: {
        neutral: new Color(0xffffff),
        blue: linear(p0),
        orange: linear(p1),
        lines: 0.2,
        ceilingLines: 0.06,
        game: true,
      },
    },
    root,
    update: () => undefined,
  };
}
