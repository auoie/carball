// The stadium's far layer (notes/arena-surroundings.md SUR-11, 22, 23; TRN1): the skyline and the city's glow, opaque
// and at their distance's depth, and the FogCylinder's band over them, the game's mesh drawn nearer about the camera.
import { detailMode, onWorldDetail } from "../detail";
import { BackSide, BufferGeometry, Float32BufferAttribute, Group, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from "three";
import { GRASS_CUBE_AT } from "../grassCube";
import { withHeightFog } from "../heightFog";
import { PRIORITY, drawnNearer, scaleWithin, withTrueDepth } from "../translucentSort";
import { FAR_ROOM } from "./theme";

// --- The far layer: the skyline, the city's glow, the horizon's fog band (SUR-11, 22, 23) -----------------------------

/** The skyline (SkyScrapers_01 on the -Y side, _02 on the +Y side: az -176..-5 and 3..176 from the capture point, their
 *  tops up to el 51 and 65 degrees; most of them lower: SUR-34's city fraction 0.29 at el 20-25, 0.07 at 50-65), drawn on
 *  a layer just inside the sky's dome (the real towers are 57-200k out, past the camera's reach) with our own window
 *  grid at its mean (0.20, 0.17, 0.11). Below the horizon the city's warm glow, v (0.748, 0.574, 0.265) toward the rim;
 *  over the horizon FogCylinder's white band, alpha by elevation (SUR-23: 0.9 at 0, 0.73 at 7.5, 0.43 at 12.5, 0.19 at
 *  17.5, 0.06 at 22.5, none from 30) */
export const FAR_LAYER = {
  radius: 31600,
  /** Where the city and its glow are for the height fog and the depth (FOG-10, SUR-23): 100k out (its towers 57-200k) */
  fog: { city: 100000 },
  /** The FogCylinder as the game's mesh (FogCylinder#0: eight sides, 16 triangles, no caps; its corners on the axes at
   *  57.27-57.39k round (-32, -48), z -13,688 to 43,656; game frame): its height fog per vertex at these 16 corners, F
   *  0.10 at the bottom to about 0.4 at the top (TRN1) */
  cylinder: { centre: [-32, -48] as const, r: 57332, z: [-13688, 43656] as const, sides: 8 },
  /** Its painted vertex colour (SUR-23 v2: rgb v.rgb, alpha times v.a), RGBA bytes */
  cylinderVertex: [255, 180, 89, 92] as const,
  skyline: { minusY: [-176, -5] as const, plusY: [3, 176] as const, maxEl: [51, 65] as const },
  windows: [0.2, 0.17, 0.11] as const,
  ground: [0.748, 0.574, 0.265] as const,
  fogBand: [[0, 0.9], [7.5, 0.73], [12.5, 0.43], [17.5, 0.19], [22.5, 0.06], [30, 0]] as readonly (readonly [number, number])[],
} as const;

/** The windows' lit share's threshold (a cell lit when its hash passes it): a third of them; at World Detail Performance
 *  the C lights' quarter of those (QG-14: three of the four light meshes gone; ours by rule, the meshes' shares not
 *  measured) */
export const CITY_LIT_FROM = { highQuality: 0.66, performance: 1 - 0.34 / 4 } as const;

const farVertex = /* glsl */ `
uniform vec3 from;
varying vec3 vDirection;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDirection = world.xyz - from;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** The city over the -X plaza (City_OOB_A, SUR-1, RV-154a): from az 180.5 (the -Y side of the gap: none over 177-180),
 *  its tops el 8 to 181.5, then 14.9 to 188.5 (the game's first open sky there: 8.6 at 181, about 15 at 182-188) */
export const PLAZA_CITY = { from: 180.5, step: 181.5, to: 188.5, low: 8, high: 14.9 } as const;

/** Its top at az (degrees, 0-360; none outside it: the shader's, for tests) */
export function plazaCityTop(az: number): number | null {
  const C = PLAZA_CITY;
  return az >= C.from && az < C.to ? (az < C.step ? C.low : C.high) : null;
}

const farFragment = /* glsl */ `
uniform vec3 windows;
uniform float litFrom;
uniform vec3 ground;
varying vec3 vDirection;
float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDirection);
  // (the game's az = atan2(y, x), el; Three's y is up, its z the game's y)
  float az = degrees(atan(d.z, d.x));
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec3 colour = vec3(0.0);
  float alpha = 0.0;
  // The skyline: towers 1-4 degrees wide; their tops mostly low, a few tall
  bool minusY = az >= -${(360 - PLAZA_CITY.to).toFixed(1)} && az <= -5.0;
  bool plusY = az >= 3.0 && az <= 176.0;
  // (and over the -X plaza, beyond the gap in the stands, City_OOB_A, by rule: plazaCityTop)
  float g = az < 0.0 ? az + 360.0 : az;
  bool plaza = g >= ${PLAZA_CITY.from.toFixed(1)} && g < ${PLAZA_CITY.to.toFixed(1)};
  if ((minusY || plusY || plaza) && el > -2.0) {
    float bin = floor(az / 2.5);
    float u = hash1(bin + (minusY ? 17.0 : 0.0));
    float top = plaza ? (g < ${PLAZA_CITY.step.toFixed(1)} ? ${PLAZA_CITY.low.toFixed(1)} : ${PLAZA_CITY.high.toFixed(1)}) : 10.0 + (minusY ? 41.0 : 55.0) * u * u * u;
    if (el < top) {
      // (windows: columns 0.18 degrees, rows 0.3; a third lit, warm)
      vec2 cell = vec2(floor(az / 0.18), floor(el / 0.3));
      float lit = step(litFrom, hash2(cell));
      vec2 f = fract(vec2(az / 0.18, el / 0.3));
      float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.85);
      // (lit panes 0.12 of the face: their mean the windows' (0.20, 0.17, 0.11), RV-127c)
      colour = vec3(0.022, 0.02, 0.018) + lit * pane * windows * 7.3;
      alpha = 1.0;
    }
  }
  // Below the horizon: the city's glow toward the rim
  if (el < 0.0 && alpha < 1.0) {
    float v = 0.95 * exp(el / 1.5);
    float sparkle = step(0.97, hash2(floor(vec2(az * 3.0, el * 6.0)))) * (1.0 - v);
    colour = v * ground + sparkle * vec3(0.9, 0.7, 0.4);
    alpha = 1.0;
  }
  // (the city and its glow: opaque, in the height fog at their distance, along the drawing camera's sight line)
  if (alpha <= 0.0) discard;
  vec3 sight = normalize(vFogWorld - uFogCam);
  vec4 cityFog = carballHeightFog(carballOpaqueDelta(uFogCam + sight * ${FAR_LAYER.fog.city.toFixed(1)}));
  gl_FragColor = vec4(colour * cityFog.a + cityFog.rgb, 1.0);
  #include <colorspace_fragment>
}
`;

/** The band's vertices: its direction from the capture point at its true place (drawn nearer about the camera:
 *  drawnNearer, `unscale` its inverse) */
const bandVertex = /* glsl */ `
uniform vec3 from;
uniform float unscale;
varying vec3 vDirection;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDirection = cameraPosition + (world.xyz - cameraPosition) * unscale - from;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** The horizon's fog band: FogCylinder, its painted vertex colour (warm) by alpha by elevation from the capture point
 *  (SUR-23's table) times its painted alpha (0.36: v2), over whatever is drawn (the city, the sky); its height fog per
 *  vertex (c F + fog: withHeightFog) */
const bandFragment = /* glsl */ `
uniform float fogEl[6];
uniform float fogAlpha[6];
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  float e = abs(degrees(asin(clamp(d.y, -1.0, 1.0))));
  float band = 0.0;
  for (int i = 0; i < 5; i++) {
    if (e >= fogEl[i] && e < fogEl[i + 1]) band = mix(fogAlpha[i], fogAlpha[i + 1], (e - fogEl[i]) / (fogEl[i + 1] - fogEl[i]));
  }
  if (band <= 0.0) discard;
  gl_FragColor = vec4(${FAR_LAYER.cylinderVertex.slice(0, 3).map((v) => (v / 255).toFixed(4)).join(", ")}, band * ${(FAR_LAYER.cylinderVertex[3] / 255).toFixed(4)});
  #include <colorspace_fragment>
}
`;

/** The FogCylinder's mesh (Three's frame): its eight sides, a ring of corners at the bottom and one at the top */
export function fogCylinder(): BufferGeometry {
  const { centre, r, z, sides } = FAR_LAYER.cylinder;
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    const [x, y] = [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
    position.push(x, z[0], y, x, z[1], y);
    const [b0, t0, b1, t1] = [2 * i, 2 * i + 1, (2 * i + 2) % (2 * sides), (2 * i + 3) % (2 * sides)];
    index.push(b0, b1, t1, b0, t1, t0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setIndex(index);
  return g;
}

/** The far city's place in the opaque pass: after the sky's dome (-1, which writes no depth), before the rest */
export const FAR_CITY_ORDER = -0.5;

/** The far layer, two spheres centred on the field (inside the dome and the camera's far plane from anywhere in the
 *  arena): the city, opaque as the game's (City_OOB_A, the skyscrapers), its depth as at its distance (so a hotspot
 *  nearer than it shows over it, a farther one doesn't: _13 below el 3 at +X); and the FogCylinder's band over it,
 *  translucent, the first after the big hotspots (TRN1: drawn over them all, whatever their depth) */
export function buildFarLayer(): Group {
  const L = FAR_LAYER;
  const from = new Vector3(GRASS_CUBE_AT.x, GRASS_CUBE_AT.z, GRASS_CUBE_AT.y);
  const city = new ShaderMaterial({
    vertexShader: farVertex,
    fragmentShader: farFragment,
    uniforms: {
      // (its elevations as seen from the capture point; Three's frame)
      from: { value: from },
      windows: { value: new Vector3(...L.windows) },
      litFrom: { value: CITY_LIT_FROM.highQuality },
      ground: { value: new Vector3(...L.ground) },
    },
    side: BackSide,
    fog: false,
  });
  withHeightFog(city, "custom");
  withTrueDepth(city, L.fog.city / L.radius, [from.x, from.y, from.z]);
  const cityMesh = new Mesh(new SphereGeometry(L.radius, 96, 48), city);
  cityMesh.name = "far layer: city";
  // (World Detail Performance: SkyScraperLights_01/02 and SkyScraper_B_Lights gone, SkyScraper_C_Lights kept, QG-14:
  // a quarter of the lit windows, RV-507)
  onWorldDetail(cityMesh, (level) => {
    (city.uniforms["litFrom"] as { value: number }).value = level === "performance" ? CITY_LIT_FROM.performance : CITY_LIT_FROM.highQuality;
  });
  cityMesh.renderOrder = FAR_CITY_ORDER;
  const band = new ShaderMaterial({
    vertexShader: bandVertex,
    fragmentShader: bandFragment,
    uniforms: {
      from: { value: from },
      fogEl: { value: L.fogBand.map(([e]) => e) },
      fogAlpha: { value: L.fogBand.map(([, a]) => a) },
    },
    side: BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  // (drawn nearer about the camera, inside the far plane, its shape kept; its fog and depth at its true corners, its
  // alpha by its true corners' elevation from the capture point)
  const bandMesh = new Mesh(fogCylinder(), band);
  const k = scaleWithin(bandMesh, from, FAR_ROOM);
  band.uniforms["unscale"] = { value: 1 / k };
  withHeightFog(band, "translucent", { scale: 1 / k });
  withTrueDepth(band, 1 / k, "camera");
  bandMesh.name = "far layer: band";
  bandMesh.renderOrder = PRIORITY.fogCylinder;
  const group = new Group();
  group.name = "far layer";
  // (the FogCylinder's far band DetailMode High: QG-15)
  group.add(cityMesh, detailMode(drawnNearer(bandMesh, k, from), "high"));
  return group;
}
