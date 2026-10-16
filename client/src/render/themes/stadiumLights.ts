// The stadium's lights and haze (notes/arena-surroundings.md SUR-8, 13, 14, 23; RV-130): the team uplight beams, the
// floodlights' flare sheets, the team light bulbs along the roof, the canopy's mullions with their team light dots, the
// StadiumFog haze and the near fog sheets. Placements and formulas the spec's; our own soft shapes (no textures).
import { detailMode } from "../detail";
import {
  AdditiveBlending,
  type Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  BufferGeometry,
} from "three";
import { PRIORITY, drawnNearer, scaleWithin, withTrueDepth } from "../translucentSort";
import { FAR_ROOM } from "./theme";
import { withHeightFog } from "../heightFog";
import { fullBright } from "../teamColors";
import { GRASS_CUBE_AT } from "../grassCube";
import { FILL_FLARE_G, STRUCTURES, circleSprite, edgeAt } from "./stadiumSurroundings";

export const LIGHTS = {
  /** The team uplight beams (LightCone_Team1/2_MIC, SUR-13, corrected: RV-177), each two crossed axis-aligned quads:
   *  beside the side walls at (+-4560, +-128); per end 8 short on the corner arc (both x signs) and 2 long at x +-1136,
   *  y +-5362; the short and side ones 128 wide, z -848 to 3248, the long 256 wide, z -352 to 5792; 24 in all, the
   *  team's by its y; translucent: a = `peak` (our soft profile, its mean a ninth of its peak: the game's mean 0.022) */
  beams: {
    side: { at: [[4560, 128]] as readonly (readonly [number, number])[], z: [-848, 3248] as const, width: 128 },
    short: { at: [[4224, 3584], [3920, 4304], [3280, 4944], [2560, 5248]] as readonly (readonly [number, number])[], z: [-848, 3248] as const, width: 128 },
    long: { at: [[1136, 5362]] as readonly (readonly [number, number])[], z: [-352, 5792] as const, width: 256 },
    peak: 0.198,
  },
  /** The floodlights' flare sheets (Stadium_LightCones, StadiumLight_Flare_Mat, SUR-8, 13): additive white, from each
   *  bank (az 80-130) down toward the field (r 5k, z -2k), 1.5k wide; 0.62 at the bank fading as (1 - t)^6 (area mean
   *  about 0.03, the game's 0.025) */
  flares: { az: [80, 130] as const, count: 6, to: [5000, -2000] as const, width: 1500, peak: 0.62, falloff: 6, vertex: [255, 222, 147] as const },
  /** LightBulbs_01/02 (SUR-8, RV-130): 8 clusters per end along the roof's inner edge (az 65-155), 600 under it, 700
   *  across; 8 P their bulbs, seen as a whole as the spec's front means */
  bulbs: { perEnd: 8, az: [65, 155] as const, under: 600, size: 700, seen: [[0.09, 0.4, 0.89], [0.73, 0.37, 0.09]] as const },
  /** The canopy's mullions (Stadium_GlassSupports, MetalBeam_SoftEdge_Lights_MIC, SUR-14): every 5 degrees over the
   *  canopy, 120 wide, dark (diffuse 0.154 lit); team light dots 4 FB, one every 400 uu along, 7 % of it, 57 % across
   *  (4 % of the beam) */
  mullions: { every: 5, width: 120, diffuse: 0.154, dotEvery: 400, dotLength: 0.07, dotAcross: 0.57 },
  /** StadiumFog (FogMesh_01, SUR-23): not team-coloured; colour h = sat(z / 8197); alpha 0.19 low, 0.15 from el 10
   *  degrees from the capture point, none from 30: a shell just outside the cage (r 9k), z -1k to 13k */
  haze: { r: 9000, z: [-1000, 13000] as const, alpha: [0.19, 0.15] as const, el: [10, 20, 30] as const, hScale: 8197, vertex: [25, 35, 38] as const },
  /** The fog sheets (FogSheet_Mat, SUR-23 corrected: RV-194, 195): (0.533, 0.686, 0.725), alpha FillFlare.G (its disc's
   *  mean 0.33, no factor); six seen: behind each goal, over the -X plaza, and the three DetailMode Medium ones (drawn at
   *  the default High too) far out; each vertical, facing the capture point turned by `yaw` (+ toward +az), `size` its
   *  visible disc (uu); the far ones placed nearer (scaleWithin: their angular size kept, their fog and depth at their
   *  true vertices); `big` the four at TranslucencySortPriority -10, the low pair behind the goals at -5 (TRN1);
   *  `vertex` its painted vertex colour (SUR-23 v2: rgb v.rgb, alpha G v.a; RGBA bytes), not the mesh's */
  fogSheets: [
    { at: [48, -7696, -192] as const, size: [21226, 5306] as const, yaw: -0.36, big: false, vertex: [23, 31, 33, 185] as const },
    { at: [48, 7728, -192] as const, size: [21226, 5306] as const, yaw: 0.36, big: false, vertex: [23, 31, 33, 185] as const },
    { at: [-20880, 49, 3728] as const, size: [21226, 6191] as const, yaw: 0.13, big: true, vertex: [255, 205, 116, 142] as const },
    { at: [-2441, -30406, 6784] as const, size: [84902, 56602] as const, yaw: 7.4, big: true, vertex: [255, 193, 91, 61] as const },
    { at: [-41904, 49, 1200] as const, size: [169805, 49526] as const, yaw: 0.07, big: true, vertex: [255, 205, 116, 142] as const },
    { at: [-416, 29904, 6720] as const, size: [84902, 56602] as const, yaw: -0.8, big: true, vertex: [255, 193, 91, 61] as const },
  ],
} as const;


/** The haze shell's rows' height (its vertex fog per row) */
export const HAZE_ROW = 500;

/** FillFlare's G by radius (SUR-41: the hotspots') */
const FLARE_G = FILL_FLARE_G;

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

/** A beam: two crossed vertical quads at (x, y) (game frame), along x and along y, `width` across, from z0 up `height`
 *  (RV-177) */
function crossed(x: number, y: number, z0: number, width: number, height: number, material: ShaderMaterial): Group {
  const beam = new Group();
  for (const turn of [0, Math.PI / 2]) {
    const quad = new Mesh(new PlaneGeometry(width, height), material);
    quad.rotation.y = turn;
    // (the corner beams stand at the game's placements, 64 uu past the side walls (x 4224, 128 wide): their room from
    // the playing volume, for tests)
    quad.userData["clearance"] = 50;
    beam.add(quad);
  }
  beam.position.set(x, z0 + height / 2, y);
  beam.name = "lights: team beam";
  return beam;
}


/** A beam's a at `across` (0 to 1 over its width) and `up` (0 to 1): B (1 - u)^2, B our soft profile across scaled to
 *  the game's mean (the shader's, for tests) */
export function beamAlpha(across: number, up: number): number {
  const b = 1 - Math.abs(2 * across - 1);
  return LIGHTS.beams.peak * b * b * (1 - up) * (1 - up);
}

/** The team uplight beams: a = B (1 - u)^2 (B our soft profile across, scaled: beamAlpha; u up the beam), k = sat(a -
 *  0.25) from that a (RV-155), colour P + k (FB - P) + k */
function beamMaterial(p: Color): ShaderMaterial {
  const fb = fullBright([p.r, p.g, p.b]);
  return new ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 primary;
      uniform vec3 bright;
      uniform float peak;
      varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(2.0 * vUv.x - 1.0);
        float a = peak * across * across * (1.0 - vUv.y) * (1.0 - vUv.y);
        float k = clamp(a - 0.25, 0.0, 1.0);
        gl_FragColor = vec4(primary + k * (bright - primary) + k, a);
        #include <colorspace_fragment>
      }`,
    uniforms: { primary: { value: new Vector3(p.r, p.g, p.b) }, bright: { value: new Vector3(...fb) }, peak: { value: LIGHTS.beams.peak } },
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
  // The team uplight beams: each placement in all four quadrants
  const materials = [beamMaterial(primary0), beamMaterial(primary1)];
  for (const kind of [L.beams.side, L.beams.short, L.beams.long]) {
    for (const [ax, ay] of kind.at) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const material = materials[sy < 0 ? 0 : 1] ?? beamMaterial(team(sy));
          group.add(crossed(sx * ax, sy * ay, kind.z[0], kind.width, kind.z[1] - kind.z[0], material));
        }
      }
    }
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
          // (times their painted vertex colour: SUR-23 v2)
          gl_FragColor = vec4(g * vec3(${L.flares.vertex.map((v) => (v / 255).toFixed(4)).join(", ")}), 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
  );
  flares.name = "lights: flare sheets";
  detailMode(flares, "medium"); // (QG-14)
  flares.renderOrder = PRIORITY.flares;
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
          bool lit = abs(along - 0.245) < ${(L.mullions.dotLength / 2).toFixed(3)} && abs(vUv.x - 0.5) < ${(L.mullions.dotAcross / 2).toFixed(3)};
          vec3 c = lit ? 4.0 * mix(bright0, bright1, vSide) : vec3(${L.mullions.diffuse});
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
  // (in rows 500 uu tall: its vertex fog follows the height, not two rings' worth: RV-192)
  const rows = Math.ceil((haze.z[1] - haze.z[0]) / HAZE_ROW);
  for (let i = 0; i < segments; i++) {
    const [a0, a1] = [(i / segments) * 2 * Math.PI, ((i + 1) / segments) * 2 * Math.PI];
    const p = (a: number, z: number): number[] => [haze.r * Math.cos(a), z, haze.r * Math.sin(a)];
    for (let j = 0; j < rows; j++) {
      const [z0, z1] = [haze.z[0] + ((haze.z[1] - haze.z[0]) * j) / rows, haze.z[0] + ((haze.z[1] - haze.z[0]) * (j + 1)) / rows];
      shellPos.push(...p(a0, z0), ...p(a1, z0), ...p(a1, z1), ...p(a0, z0), ...p(a1, z1), ...p(a0, z1));
    }
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
          // (times its painted vertex colour, SUR-23 v2; its alpha the painted per-vertex alpha, our table by height)
          gl_FragColor = vec4(h * vec3(${haze.vertex.map((v) => (v / 255).toFixed(4)).join(", ")}), alpha);
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
  detailMode(shell, "medium"); // (FogMesh_01: QG-14)
  shell.renderOrder = PRIORITY.haze;
  group.add(shell);
  // The fog sheets: each a Circle_Sprite hexagon facing the capture point, turned by its yaw; its vertex fog at its true
  // vertices (RV-188)
  const C = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
  for (const sheet of L.fogSheets) {
    const [x, y, z] = sheet.at;
    const at3 = new Vector3(x, z, y);
    // (vertical, facing the capture point, then its yaw: + toward +az)
    const orient = (m: Mesh): void => {
      m.lookAt(C.x, m.position.y, C.z);
      m.rotateOnWorldAxis(new Vector3(0, 1, 0), (-sheet.yaw * Math.PI) / 180);
    };
    const mesh = new Mesh(circleSprite(sheet.size[0], sheet.size[1]));
    mesh.position.copy(at3);
    orient(mesh);
    const k = scaleWithin(mesh, C, FAR_ROOM);
    const sheetMaterial = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform vec3 colour;
        uniform float flare[10];
        uniform float alphaScale;
        varying vec2 vUv;
        void main() {
          float x = length(vUv - 0.5) * 20.0;
          int i = int(min(floor(x), 9.0));
          float g = x >= 10.0 ? 0.0 : mix(flare[i], i < 9 ? flare[i + 1] : 0.0, x - float(i));
          gl_FragColor = vec4(colour, g * alphaScale);
          #include <colorspace_fragment>
        }`,
      uniforms: {
        colour: { value: new Vector3(sheet.vertex[0] / 255, sheet.vertex[1] / 255, sheet.vertex[2] / 255) },
        flare: { value: FLARE_G },
        alphaScale: { value: sheet.vertex[3] / 255 },
      },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    // (a far one drawn nearer about the camera, its fog and its depth as at its true place: what stands between covers
    // it)
    withHeightFog(sheetMaterial, "translucent", k < 1 ? { scale: 1 / k } : {});
    if (k < 1) withTrueDepth(sheetMaterial, 1 / k, "camera");
    mesh.material = sheetMaterial;
    mesh.name = "lights: fog sheet";
    // (its TranslucencySortPriority, TRN1: below the canopy's glass, the fog bowl and the haze, so it no longer sorts
    // against them by position, which popped it in and out as the view turned)
    mesh.renderOrder = sheet.big ? PRIORITY.bigFogSheet : PRIORITY.lowFogSheet;
    const piece = k < 1 ? drawnNearer(mesh, k, C) : mesh;
    // (the three big far ones DetailMode Medium, QG-14; the -X plaza's and the low pair always drawn)
    if ((sheet.big && sheet.at[2] > 5000) || sheet.at[0] < -40000) detailMode(piece, "medium");
    group.add(piece);
  }
  return group;
}
