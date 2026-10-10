// The stadium's lights and haze (notes/arena-surroundings.md SUR-8, 13, 14, 23; RV-130): the team uplight beams, the
// floodlights' flare sheets, the team light bulbs along the roof, the canopy's mullions with their team light dots, the
// StadiumFog haze and the near fog sheets. Placements and formulas the spec's; our own soft shapes (no textures).
import { AdditiveBlending, type Color, DoubleSide, Float32BufferAttribute, Group, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3, BufferGeometry } from "three";
import { fullBright } from "../teamColors";
import { GRASS_CUBE_AT } from "../grassCube";
import { STRUCTURES, edgeAt } from "./stadiumSurroundings";

export const LIGHTS = {
  /** The team uplight beams (LightCone_Team1/2_MIC, SUR-13): beside the side walls (x +-4560, y -128 blue, +128
   *  orange), 4096 tall from z -848, 128 wide; behind the goals two 6144 x 256 at (+-1136, -+5361); translucent, mean
   *  alpha 0.022 */
  beams: {
    side: { at: [4560, 128] as const, z: -848, height: 4096, width: 128 },
    long: { at: [1136, 5361] as const, z: -848, height: 6144, width: 256 },
    alpha: 0.13,
  },
  /** The floodlights' flare sheets (Stadium_LightCones, StadiumLight_Flare_Mat, SUR-8, 13): additive white, from each
   *  bank (az 80-130) down toward the field (r 5k, z -2k), 1.5k wide; 0.62 at the bank fading as (1 - t)^6 (area mean
   *  about 0.03, the game's 0.025) */
  flares: { az: [80, 130] as const, count: 6, to: [5000, -2000] as const, width: 1500, peak: 0.62, falloff: 6 },
  /** LightBulbs_01/02 (SUR-8, RV-130): 8 clusters per end along the roof's inner edge (az 65-155), 600 under it, 700
   *  across; 8 P their bulbs, seen as a whole as the spec's front means */
  bulbs: { perEnd: 8, az: [65, 155] as const, under: 600, size: 700, seen: [[0.09, 0.4, 0.89], [0.73, 0.37, 0.09]] as const },
  /** The canopy's mullions (Stadium_GlassSupports, MetalBeam_SoftEdge_Lights_MIC, SUR-14): every 5 degrees over the
   *  canopy, 120 wide, dark (diffuse 0.154 lit); team light dots 4 FB, one every 400 uu along, 7 % of it, 57 % across
   *  (4 % of the beam) */
  mullions: { every: 5, width: 120, diffuse: 0.154, dotEvery: 400, dotLength: 0.07, dotAcross: 0.57 },
  /** StadiumFog (FogMesh_01, SUR-23): not team-coloured; colour h = sat(z / 8197); alpha 0.19 low, 0.15 from el 10
   *  degrees from the capture point, none from 30: a shell just outside the cage (r 9k), z -1k to 13k */
  haze: { r: 9000, z: [-1000, 13000] as const, alpha: [0.19, 0.15] as const, el: [10, 20, 30] as const, hScale: 8197 },
  /** The fog sheets (FogSheet_Mat, SUR-23): (0.533, 0.686, 0.725), alpha FillFlare.G 0.3; behind each goal (y +-7712,
   *  24.6k x 5.3k about z -192, facing the field) and over the -X plaza (x -20880, 24.6k x 6.2k about z 3728) */
  fogSheets: [
    { at: [48, -7712, -192] as const, size: [24576, 5320] as const },
    { at: [48, 7712, -192] as const, size: [24576, 5320] as const },
    { at: [-20880, 49, 3728] as const, size: [24576, 6208] as const },
  ],
  fogSheet: { colour: [0.533, 0.686, 0.725] as const, alpha: 0.3 },
} as const;

/** FillFlare's G by radius (SUR-41), as the hotspots' */
const FLARE_G = [1.0, 0.97, 0.91, 0.81, 0.67, 0.49, 0.31, 0.15, 0.04, 0.01];

const quadVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** A vertical sheet standing at (x, y) (game frame), `width` across, from z0 up `height`, facing the arena's centre */
function standing(x: number, y: number, z0: number, width: number, height: number, material: ShaderMaterial): Mesh {
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.position.set(x, z0 + height / 2, y);
  mesh.lookAt(0, z0 + height / 2, 0);
  return mesh;
}

/** The team uplight beams: a = B (1 - u)^2 (B our soft profile across, u up the beam), k = sat(a - 0.25), colour P +
 *  k (FB - P) + k */
function beamMaterial(p: Color): ShaderMaterial {
  const fb = fullBright([p.r, p.g, p.b]);
  return new ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 primary;
      uniform vec3 bright;
      uniform float alphaScale;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(2.0 * vUv.x - 1.0);
        float a = across * across * (1.0 - vUv.y) * (1.0 - vUv.y);
        float k = clamp(a - 0.25, 0.0, 1.0);
        gl_FragColor = vec4(primary + k * (bright - primary) + k, alphaScale * a);
        #include <colorspace_fragment>
      }`,
    uniforms: { primary: { value: new Vector3(p.r, p.g, p.b) }, bright: { value: new Vector3(...fb) }, alphaScale: { value: LIGHTS.beams.alpha } },
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    side: DoubleSide,
  });
}

/** The lights and haze; `primary0`, `primary1` the teams' (blue the -y side's) */
export function buildStadiumLights(primary0: Color, primary1: Color): Group {
  const group = new Group();
  group.name = "stadium lights";
  const L = LIGHTS;
  const team = (y: number): Color => (y < 0 ? primary0 : primary1);
  // The team uplight beams
  const { side, long } = L.beams;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const [x, y] = [sx * side.at[0], sy * side.at[1]];
      group.add(Object.assign(standing(x, y, side.z, side.width, side.height, beamMaterial(team(y))), { name: "lights: team beam" }));
    }
    const [x, y] = [sx * long.at[0], -sx * long.at[1]];
    group.add(Object.assign(standing(x, y, long.z, long.width, long.height, beamMaterial(team(y))), { name: "lights: team beam" }));
  }
  // The flare sheets: quads from the bank down toward the field, along their azimuth
  const flarePos: number[] = [];
  const flareUv: number[] = [];
  const { lights } = STRUCTURES;
  for (const sign of [1, -1]) {
    for (let k = 0; k < L.flares.count; k++) {
      const az = L.flares.az[0] + ((L.flares.az[1] - L.flares.az[0]) * (k + 0.5)) / L.flares.count;
      const a = (sign * az * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const top = [edgeAt(lights.rIn, az), (edgeAt(lights.zLo, az) + edgeAt(lights.zHi, az)) / 2];
      const bottom = L.flares.to;
      const half = L.flares.width / 2;
      // (Three's frame: x, z up, the game's y; the sheet's width across the azimuth)
      const p = (r: number, z: number, across: number): number[] => [r * c - s * across, z, r * s + c * across];
      const [r0 = 0, z0 = 0] = top;
      const quad = [p(r0, z0, -half), p(r0, z0, half), p(bottom[0], bottom[1], half), p(r0, z0, -half), p(bottom[0], bottom[1], half), p(bottom[0], bottom[1], -half)];
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
      quad.forEach((q) => flarePos.push(...q));
      uvs.forEach((q) => flareUv.push(...q));
    }
  }
  const flareGeometry = new BufferGeometry();
  flareGeometry.setAttribute("position", new Float32BufferAttribute(flarePos, 3));
  flareGeometry.setAttribute("uv", new Float32BufferAttribute(flareUv, 2));
  const flares = new Mesh(
    flareGeometry,
    new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          float across = 1.0 - abs(2.0 * vUv.x - 1.0);
          float g = ${L.flares.peak} * pow(1.0 - vUv.y, ${L.flares.falloff.toFixed(1)}) * across * across;
          gl_FragColor = vec4(vec3(g), 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
  );
  flares.name = "lights: flare sheets";
  group.add(flares);
  // The bulb clusters along the roof's inner edge, facing the capture point
  const centre = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
  const { roof } = STRUCTURES;
  for (const sign of [-1, 1]) {
    const seen = L.bulbs.seen[sign < 0 ? 0 : 1];
    const material = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 seen;
        varying vec2 vUv;
        void main() {
          // (a cluster of bulbs: a soft disc, its mean the spec's front mean)
          float r = length(vUv - 0.5) * 2.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(seen * 2.0 * (1.0 - r * r), 1.0);
          #include <colorspace_fragment>
        }`,
      uniforms: { seen: { value: new Vector3(seen[0], seen[1], seen[2]) } },
      side: DoubleSide,
    });
    for (let k = 0; k < L.bulbs.perEnd; k++) {
      const az = L.bulbs.az[0] + ((L.bulbs.az[1] - L.bulbs.az[0]) * (k + 0.5)) / L.bulbs.perEnd;
      const a = (sign * az * Math.PI) / 180;
      const [r, z] = [edgeAt(roof.rIn, az), edgeAt(roof.zHi, az) - L.bulbs.under];
      const bulb = new Mesh(new PlaneGeometry(L.bulbs.size, L.bulbs.size), material);
      bulb.position.set(r * Math.cos(a), z, r * Math.sin(a));
      bulb.lookAt(centre);
      bulb.name = "lights: bulbs";
      group.add(bulb);
    }
  }
  // The canopy's mullions: strips from its inner edge down to its outer, with their light dots
  const { canopy } = STRUCTURES;
  const mullionPos: number[] = [];
  const mullionUv: number[] = [];
  const mullionSide: number[] = [];
  for (const sign of [1, -1]) {
    for (let az: number = canopy.az[0]; az <= canopy.az[1]; az += L.mullions.every) {
      const a = (sign * az * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const inner: [number, number] = [edgeAt(canopy.rIn, az), edgeAt(canopy.zHi, az)];
      const outer = canopy.outer;
      const length = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]);
      const half = L.mullions.width / 2;
      const p = (r: number, z: number, across: number): number[] => [r * c - s * across, z, r * s + c * across];
      const quad = [p(inner[0], inner[1], -half), p(inner[0], inner[1], half), p(outer[0], outer[1], half), p(inner[0], inner[1], -half), p(outer[0], outer[1], half), p(outer[0], outer[1], -half)];
      const uvs = [[0, 0], [1, 0], [1, length], [0, 0], [1, length], [0, length]];
      quad.forEach((q) => mullionPos.push(...q));
      uvs.forEach((q) => mullionUv.push(...q));
      for (let i = 0; i < 6; i++) mullionSide.push(sign < 0 ? 0 : 1);
    }
  }
  const mullionGeometry = new BufferGeometry();
  mullionGeometry.setAttribute("position", new Float32BufferAttribute(mullionPos, 3));
  mullionGeometry.setAttribute("uv", new Float32BufferAttribute(mullionUv, 2));
  mullionGeometry.setAttribute("side", new Float32BufferAttribute(mullionSide, 1));
  const fb0 = fullBright([primary0.r, primary0.g, primary0.b]);
  const fb1 = fullBright([primary1.r, primary1.g, primary1.b]);
  const mullions = new Mesh(
    mullionGeometry,
    new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float side;
        varying vec2 vUv;
        varying float vSide;
        void main() {
          vUv = uv;
          vSide = side;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 bright0;
        uniform vec3 bright1;
        varying vec2 vUv;
        varying float vSide;
        void main() {
          float along = fract(vUv.y / ${L.mullions.dotEvery.toFixed(1)});
          bool dot = abs(along - 0.245) < ${(L.mullions.dotLength / 2).toFixed(3)} && abs(vUv.x - 0.5) < ${(L.mullions.dotAcross / 2).toFixed(3)};
          vec3 c = dot ? 4.0 * mix(bright0, bright1, vSide) : vec3(${L.mullions.diffuse});
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      uniforms: { bright0: { value: new Vector3(...fb0) }, bright1: { value: new Vector3(...fb1) } },
      side: DoubleSide,
    }),
  );
  mullions.name = "lights: mullions";
  group.add(mullions);
  // The haze: a shell just outside the cage, its alpha by height (as the spec's by elevation from the capture point)
  const { haze } = L;
  const toZ = (el: number): number => GRASS_CUBE_AT.z + haze.r * Math.tan((el * Math.PI) / 180);
  const shellPos: number[] = [];
  const segments = 96;
  for (let i = 0; i < segments; i++) {
    const [a0, a1] = [(i / segments) * 2 * Math.PI, ((i + 1) / segments) * 2 * Math.PI];
    const p = (a: number, z: number): number[] => [haze.r * Math.cos(a), z, haze.r * Math.sin(a)];
    const [z0, z1] = haze.z;
    shellPos.push(...p(a0, z0), ...p(a1, z0), ...p(a1, z1), ...p(a0, z0), ...p(a1, z1), ...p(a0, z1));
  }
  const shellGeometry = new BufferGeometry();
  shellGeometry.setAttribute("position", new Float32BufferAttribute(shellPos, 3));
  const shell = new Mesh(
    shellGeometry,
    new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 levels;
        uniform vec2 alphas;
        uniform float hScale;
        varying vec3 vWorld;
        void main() {
          float z = vWorld.y;
          float alpha = z < levels.x ? alphas.x : z < levels.y ? alphas.y : alphas.y * (1.0 - smoothstep(levels.y, levels.z, z));
          float h = clamp(z / hScale, 0.0, 1.0);
          gl_FragColor = vec4(vec3(h), alpha);
          #include <colorspace_fragment>
        }`,
      uniforms: {
        levels: { value: new Vector3(toZ(haze.el[0]), toZ(haze.el[1]), toZ(haze.el[2])) },
        alphas: { value: haze.alpha.slice() },
        hScale: { value: haze.hScale },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  shell.name = "lights: haze";
  group.add(shell);
  // The near fog sheets
  const sheetMaterial = new ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 colour;
      uniform float alpha;
      uniform float flare[10];
      varying vec2 vUv;
      void main() {
        float x = length(vUv - 0.5) * 20.0;
        int i = int(min(floor(x), 9.0));
        float g = x >= 10.0 ? 0.0 : mix(flare[i], i < 9 ? flare[i + 1] : 0.0, x - float(i));
        gl_FragColor = vec4(colour, alpha * g);
        #include <colorspace_fragment>
      }`,
    uniforms: { colour: { value: new Vector3(...L.fogSheet.colour) }, alpha: { value: L.fogSheet.alpha }, flare: { value: FLARE_G } },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  for (const sheet of L.fogSheets) {
    const [x, y, z] = sheet.at;
    const mesh = new Mesh(new PlaneGeometry(sheet.size[0], sheet.size[1]), sheetMaterial);
    mesh.position.set(x, z, y);
    // (facing the field: along the axis it stands on)
    if (Math.abs(x) > Math.abs(y)) mesh.lookAt(0, z, y);
    else mesh.lookAt(x, z, 0);
    mesh.name = "lights: fog sheet";
    group.add(mesh);
  }
  return group;
}
