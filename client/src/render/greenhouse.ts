// The greenhouse arena (ours: an alternative look on Night, the user's request of 2026-10-17; nothing of the game's): the
// walls and ceiling clear glass in a lattice of thin metal glazing bars (equilateral triangles: the user's pick of three
// framings shown, 2026-10-17), the bars tinted toward each team's end, the panes clear (as the game cage's fill between its lines: the user's pick, 2026-10-17,
// no frosting) but for a faint glow round the ball; the wall's
// foot low boards with our name and a band in each half's team colour; white goal posts; a football pitch on the floor
// (mown stripes, chalk markings proportioned to our field). One translucent layer (the glass, its bars drawn in it), one
// floor shader, the same collision as every map. The goals, their nets and glows stay Night's (src/render/arena.ts).
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  type Color,
  DoubleSide,
  FrontSide,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  type Vector3,
} from "three";
import { type ArenaSurface, BACK_Y, CHAMFER, GOAL_X, H, R_CEIL, type Pt } from "./arenaSurface";
import { addBallReticle } from "./ballShadow";
import { beamCurves } from "./cageBeams";
import { lowQualityPath } from "./shaderQuality";
import type { ArenaClock } from "./themes/theme";
import { fullBright, linear } from "./teamColors";
import { ARENA_PRIORITY } from "./translucentSort";
import type { GlowRibbon } from "./themes/theme";
import { WALL_FOOT, clip, fourWays, framePieces, wallParam } from "./wallFoot";

/** The greenhouse's measures (uu): a pane's side (an equilateral triangle), a glazing bar's half width (8 uu wide, as
 *  Night's beams: the user's "a little thicker again", 2026-10-17), its least half width on screen (pixels: Night's
 *  beams', dimmer instead of thinner beyond) and its brightness over Night's beams' formula; the boards' lettering band
 *  and the team band at their top */
export const GREENHOUSE = {
  pane: 560,
  barHalf: 4,
  minHalfPixels: 0.75,
  barGain: 1,
  /** a neutral grey along the bars (linear, at a bar's middle): the game cage's fill net's share of Night's visible lines,
   *  most of what shows over its ceiling, fading as a pixel spans `neutralFade` uu across the bar (Night's net shrinking
   *  into its average far off: its haze, our clear panes); calibrated against Night's screens (the user's, 2026-10-17) */
  barNeutral: 0.032,
  neutralFade: [3, 9] as Pt,
  /** High Quality Shaders off (the user's settings): the bars' brightness over Night's low-quality beams' (flat, I 1), the
   *  neutral grey's (Night's low-quality fill: its faint net alone) */
  lowBarGain: 1,
  lowNeutral: 0.055,

  /** the boards' height (uu), one all the way round, the back walls beside the goals too (the user's, 2026-10-17: not the
   *  game's frame falling to 57 by the posts); their lettering and team band as shares of it, the lettering's repeat
   *  along the wall (uu: the canvas's two phrases at 1.5625 uu a pixel, the letters' size and spacing as CARBALL's were) */
  boards: { top: 140, textFrom: 0.1, textTo: 0.66, band: 0.8, repeat: 2700 },
} as const;

/** The pitch's markings (uu, from the field's centre, the game's frame; ours: a football pitch's lines at 100 uu a metre
 *  where they fit, the boundary a rounded box inside the floor's edge): the boundary's half sizes and corner radius,
 *  a line's half width, the centre circle and spot, the penalty and goal areas (half width, depth from the end line),
 *  the penalty spot's place (from the end line: its arc's centre; no dot drawn there) and its arc, the corner arcs; the
 *  mown stripes' width */
export interface PitchLayout {
  readonly half: Pt;
  readonly cornerRadius: number;
  readonly lineHalf: number;
  readonly centreRadius: number;
  readonly spotRadius: number;
  readonly penalty: Pt;
  readonly goalArea: Pt;
  readonly penaltySpot: number;
  readonly arcRadius: number;
  readonly cornerArc: number;
  readonly stripe: number;
}

/** The pitch inside the floor's outline (the flat floor out to the wall's foot: src/render/arenaSurface.ts
 *  floorOutline), `inset` uu in from it */
export function pitchLayout(outline: readonly Pt[], inset = 110): PitchLayout {
  // (the side line's place on the side walls' straight, the end line's on the back walls' away from the goal mouths)
  const side = Math.min(...outline.filter(([, y]) => Math.abs(y) < 2000).map(([x]) => Math.abs(x)));
  const end = Math.min(...outline.filter(([x]) => Math.abs(x) > 1200 && Math.abs(x) < 2200).map(([, y]) => Math.abs(y)));
  const half: Pt = [side - inset, end - inset];
  // (the corners' radius keeping the boundary farthest inside the floor's edge: the arena's corners are curves of their
  // own, not circles)
  // (a point's distance in from the floor's edge, negative outside it)
  const edgeDistance = (x: number, y: number): number => {
    let best = Infinity;
    let inside = false;
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i] ?? [0, 0];
      const [bx, by] = outline[(i + 1) % outline.length] ?? [ax, ay];
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? best : -best;
  };
  // (the least of it along the boundary's corner and its straight edges' last 2000 uu before it)
  const clearance = (r: number): number => {
    let least = Infinity;
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * (Math.PI / 2);
      least = Math.min(least, edgeDistance(half[0] - r + r * Math.cos(a), half[1] - r + r * Math.sin(a)));
    }
    for (let d = 0; d <= 2000; d += 50) least = Math.min(least, edgeDistance(half[0], half[1] - r - d), edgeDistance(half[0] - r - d, half[1]));
    return least;
  };
  let cornerRadius = 600;
  for (let r = 600; r <= 2400; r += 25) if (clearance(r) > clearance(cornerRadius) + 0.5) cornerRadius = r;
  return {
    half,
    cornerRadius,
    lineHalf: 9,
    centreRadius: 915,
    spotRadius: 32,
    penalty: [2016, 1650],
    // (the goal area 550 past each post: the posts at |x| 893)
    goalArea: [1443, 550],
    penaltySpot: 1100,
    arcRadius: 915,
    cornerArc: 220,
    stripe: 640,
  };
}

/** The glass's chart at a point of the swept surface (the game's frame): on the walls (u the wall line's arc length
 *  from the side wall's middle, v up the wall and on round the ceiling's fillet by its arc), on the ceiling (its x, y;
 *  the third 1) */
export function glassChart(x: number, y: number, z: number): [number, number, number] {
  return z >= H - 0.5 ? [x, y, 1] : [...wallChart(x, y, z), 0];
}

/** The walls' chart at a point (the ceiling fillet's top edge too: its v the chart's top). The wall line ends at the
 *  goal's post (x 904 on the back wall): over the backboard, above and beside the mouth, u goes on along the back wall
 *  to its middle, stretched a little so the middle is one of the triangles' mirror lines (the two halves meet there
 *  without a seam, as at the side walls' middles, u 0) */
export function wallChart(x: number, y: number, z: number): [number, number] {
  const knee = H - R_CEIL;
  const v = z <= knee ? z : knee + R_CEIL * Math.asin(Math.min(1, (z - knee) / R_CEIL));
  const end = GOAL_X + CHAMFER;
  const ax = Math.abs(x);
  const onBackboard = ax < end && Math.abs(y) > BACK_Y - R_CEIL - 1;
  return [onBackboard ? backboardU(ax) : wallParam(x, y), v];
}

/** u over the backboard at |x| (< 904): from the wall line's end on to the middle, the middle at a multiple of half a
 *  pane (the triangles' mirror lines) */
function backboardU(ax: number): number {
  backboard ??= (() => {
    const end = GOAL_X + CHAMFER;
    const start = wallParam(end, BACK_Y);
    const half = GREENHOUSE.pane / 2;
    const middle = Math.ceil((start + end) / half) * half;
    return { start, scale: (middle - start) / end };
  })();
  return backboard.start + backboard.scale * (GOAL_X + CHAMFER - ax);
}
let backboard: { readonly start: number; readonly scale: number } | undefined;

/** The wall chart's top: the ceiling fillet's end, where the ceiling's own chart takes over (a bar along it) */
export const WALL_CHART_TOP = H - R_CEIL + (R_CEIL * Math.PI) / 2;

/** A piece of the surface (game frame) as Three's (y and z swapped, the winding kept facing the field), unindexed, each
 *  vertex's `chart` per triangle (a triangle all on the ceiling uses the ceiling's chart) */
export function glassGeometry(positions: ArrayLike<number>, triangles: readonly number[]): BufferGeometry {
  // (a wall triangle's vertex on the ceiling's edge on the walls' chart, at its top)
  const charts = new Map<number, [number, number]>();
  const chartOf = (v: number): [number, number] => {
    let c = charts.get(v);
    if (!c) {
      c = wallChart(positions[3 * v] ?? 0, positions[3 * v + 1] ?? 0, positions[3 * v + 2] ?? 0);
      charts.set(v, c);
    }
    return c;
  };
  const pos = new Float32Array(triangles.length * 3);
  const chart = new Float32Array(triangles.length * 3);
  for (let t = 0; t < triangles.length; t += 3) {
    // (Three's winding: two indices swapped)
    const tri = [triangles[t] ?? 0, triangles[t + 2] ?? 0, triangles[t + 1] ?? 0];
    const ceiling = tri.every((v) => (positions[3 * v + 2] ?? 0) >= H - 0.5);
    tri.forEach((v, k) => {
      const [x, y, z] = [positions[3 * v] ?? 0, positions[3 * v + 1] ?? 0, positions[3 * v + 2] ?? 0];
      pos.set([x, z, y], 3 * (t + k));
      chart.set(ceiling ? [x, y, 1] : [...chartOf(v), 0], 3 * (t + k));
    });
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("chart", new BufferAttribute(chart, 3));
  g.computeVertexNormals();
  return g;
}

/** The bars' GLSL: the distance (chart uu) to the nearest bar of the triangles' three families of lines (across the
 *  chart's v, and at 60 degrees either way), each a triangle's height apart, all three meeting at the lattice's points */
const BAR_GLSL = /* glsl */ `
  float barDistance(float c, float period) { return abs(fract(c / period + 0.5) - 0.5) * period; }
  float bars(vec2 p) {
    float h = ${GREENHOUSE.pane.toFixed(1)} * 0.8660254;
    float n1 = 0.5 * p.y + 0.8660254 * p.x;
    float n2 = 0.5 * p.y - 0.8660254 * p.x;
    return min(barDistance(p.y, h), min(barDistance(n1, h), barDistance(n2, h)));
  }`;

/** The glass: its panes clear (nothing drawn, near the ball too: the user's, 2026-10-17); its bars lit as Night's beams
 *  (notes/arena-visuals.md H-8, H-8b; src/render/cageBeams.ts): additive, coloured by the height on the wall towards the
 *  team on that side, rich at the walls' foot and dim and neutral over the ceiling, brightest at the bar's middle,
 *  flaring round the ball (within 8192 uu, most within 4096) with the scan stripes and the rings contracting towards it,
 *  the goal's shockwave ring passing through them; a pixel and a half wide at least, dimmer instead of thinner beyond,
 *  so a far bar keeps its hue; fog only dims it */
export class GreenhouseGlassMaterial extends ShaderMaterial {
  constructor(ballPosition: Vector3, blue: Color, orange: Color, clock: ArenaClock = { time: { value: 0 }, shockWave: { value: -0.25 } }) {
    const curves = beamCurves();
    super({
      vertexShader: /* glsl */ `
        attribute vec3 chart;
        varying vec3 vChart;
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_vertex>
        void main() {
          vChart = chart;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 ballPosition;
        uniform vec3 primary0;
        uniform vec3 primary1;
        uniform vec3 bright0;
        uniform vec3 bright1;
        uniform float time;
        uniform float shockWave;
        uniform sampler2D fire;
        uniform sampler2D smoke;
        varying vec3 vChart;
        varying vec3 vWorld;
        varying vec3 vNormal;
        float curve(sampler2D table, float v) { return texture2D(table, vec2(v, 0.5)).r; }
        #include <fog_pars_fragment>
        ${BAR_GLSL}
        void main() {
          vec2 p = vChart.xy;
          bool ceiling = vChart.z > 0.5;
          float d = bars(p);
          // (bars along the wall chart's top and the ceiling's edge: the two charts meet there)
          if (!ceiling) d = min(d, abs(p.y - ${WALL_CHART_TOP.toFixed(1)}));
          // (uu a pixel across the bar, as Night's beams measure it along their width: a bar at least minHalfPixels a side,
          // dimmer instead of thinner beyond)
          float px = max(fwidth(d), 1e-3);
          float w = max(${GREENHOUSE.barHalf.toFixed(1)}, ${GREENHOUSE.minHalfPixels.toFixed(2)} * px);
          float across = d / w;
          float profile = max(0.0, 1.0 - across * across);
          float fade = ${GREENHOUSE.barHalf.toFixed(1)} / w;
          // Night's beams away from the ball (H-8): the height on the wall w (1 at its foot, 0 on the ceiling), the team on
          // that side (the game's y, Three's z; the game's z, Three's y)
          float wall = clamp((2068.6 - vWorld.y) / 1816.0, 0.0, 1.0);
          #ifdef CARBALL_LQ
            float t = clamp(vWorld.z / 128.0 + 0.5, 0.0, 1.0);
          #else
            float t = clamp(vWorld.z / 256.0 + 0.5, 0.0, 1.0);
          #endif
          vec3 primary = mix(primary0, primary1, t);
          vec3 colour = vec3(0.0625) + wall * ((2.0 * mix(bright0, bright1, t) + primary) / 6.0 - vec3(0.0625));
          float netFar = 1.0 - smoothstep(${GREENHOUSE.neutralFade[0].toFixed(1)}, ${GREENHOUSE.neutralFade[1].toFixed(1)}, px);
          #ifdef CARBALL_LQ
            // (High Quality Shaders off, QG-10: Night's beams the colour alone, flat across them (I 1: no profile, ball
            // flare, stripes, rings or shockwave); its fill's faint net alone, its colour the team's in H-9's ring round the
            // ball (r ~312) and lighter over the tracker's hexagons (within 220): those colours on our bars' neutral)
            float cover = (1.0 - smoothstep(w - 0.5 * px, w + 0.5 * px, d)) * fade;
            float dist = distance(vWorld, ballPosition);
            float near = clamp(1.0 - 0.04 * (dist - 300.0), 0.0, 1.0);
            float ballRing = clamp(2.0 * (clamp(12.0 * (0.5 - near), 0.0, 1.0) * near - 0.001), 0.0, 1.0);
            float tracker = 0.4 * clamp((220.0 - dist) * 0.0015, 0.0, 1.0);
            vec3 net = mix(mix(vec3(1.0), 8.0 * primary, ballRing), vec3(2.4), tracker);
            vec3 rgb = ${GREENHOUSE.lowBarGain.toFixed(3)} * cover * colour + ${GREENHOUSE.lowNeutral.toFixed(4)} * cover * netFar * net;
          #else
          // (the beams' brightness, H-8: away from the ball 0.5625 (w + 0.5) p; round it (prox: 8192 uu, prox2: 4096) the scan
          // stripes up the walls (along y on surfaces facing up or down), the rings contracting towards it, the shockwave)
          float d2 = dot(vWorld - ballPosition, vWorld - ballPosition) / (16384.0 * 16384.0);
          float prox = max(0.0, 1.0 - 4.0 * d2);
          float prox2 = max(0.0, 0.75 - 12.0 * d2);
          float ring = 1.0 - abs(1.0 - 2.0 * max(0.0, 8.0 * (clamp(1.0 - d2 + shockWave, 0.0, 1.0) - 0.875)));
          float up = clamp(64.0 * (abs(normalize(vNormal).y) - 0.5), 0.0, 1.0);
          float F = mix(curve(fire, vWorld.y / 4.0 + fract(3.0 * time)), curve(fire, vWorld.z / 4.0 + fract(3.0 * time)), up);
          float S = curve(smoke, 128.0 * (1.0 - d2) - time);
          float intensity = 24.0 * (prox2 * prox2 + 0.09375) * (wall + 0.5)
            * ((1.0 - prox) * 0.25 * profile + prox * profile * (F * (S * (prox + 0.25) + 0.25) + 4.0 * ring * prox));
          intensity = clamp(${GREENHOUSE.barGain.toFixed(2)} * intensity, 0.0, 5.0) * fade;
          float neutral = ${GREENHOUSE.barNeutral.toFixed(4)} * profile * fade * netFar;
          vec3 rgb = intensity * colour + vec3(neutral);
          #endif
          // (the clear panes: nothing to add)
          if (max(rgb.r, max(rgb.g, rgb.b)) < 0.0004) discard;
          gl_FragColor = vec4(rgb, 1.0);
          #include <colorspace_fragment>
          // (fog only dims an additive line, as Night's beams: RV-70d)
          #ifdef USE_FOG
            #ifdef FOG_EXP2
              gl_FragColor.rgb *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
            #else
              gl_FragColor.rgb *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
            #endif
          #endif
        }`,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        ballPosition: { value: ballPosition },
        primary0: { value: blue },
        primary1: { value: orange },
        bright0: { value: linear(fullBright([blue.r, blue.g, blue.b])) },
        bright1: { value: linear(fullBright([orange.r, orange.g, orange.b])) },
        time: clock.time,
        shockWave: clock.shockWave,
        fire: { value: curves.fire },
        smoke: { value: curves.smoke },
      },
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: true,
    });
    // (High Quality Shaders off: its CARBALL_LQ branch, as Night's beams and fill)
    lowQualityPath(this);
  }
}

/** The boards' lettering (the user's, 2026-10-17: our site's address), its words between the dots */
export const BOARD_TEXT = ["CARBALL", "ZOLT", "TOP"] as const;

/** The lettering's dots (px on the canvas): squares on the baseline, larger than the face's own (under 5 px at this
 *  size), so they still read at a distance */
const BOARD_DOT = 8;

/** The boards' lettering (ours: our site's address, repeated), a canvas where the page has one (none in the unit tests):
 *  two phrases a canvas, each in a cell of 864 px (the 675 px phrase and the 191 px gap CARBALL's 512 px cell left) */
function boardsTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1728;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const texture = new CanvasTexture(canvas);
  const draw = (): void => {
    ctx.fillStyle = "#162030";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e8eef7";
    ctx.font = "44px Orbitron, Arial, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.letterSpacing = "10px";
    const middle = canvas.height / 2 + 2;
    // (each word's width with its trailing letter spacing; a dot, then the spacing again; the phrase centred in its cell)
    const widths = BOARD_TEXT.map((word) => ctx.measureText(word).width);
    const dotGap = BOARD_DOT + 10;
    const total = widths.reduce((a, b) => a + b, 0) + dotGap * (BOARD_TEXT.length - 1) - 10;
    const baseline = middle + ctx.measureText("L").actualBoundingBoxDescent;
    for (const centre of [432, 1296]) {
      let x = centre - total / 2;
      BOARD_TEXT.forEach((word, i) => {
        ctx.fillText(word, x, middle);
        x += widths[i] ?? 0;
        if (i < BOARD_TEXT.length - 1) {
          ctx.fillRect(Math.round(x), Math.round(baseline - BOARD_DOT), BOARD_DOT, BOARD_DOT);
          x += dotGap;
        }
      });
    }
    texture.needsUpdate = true;
  };
  draw();
  // (again once the bundled face is in)
  void document.fonts.load("44px Orbitron").then(draw, () => undefined);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}

/** The boards: dark panels with our name along them, the band at their top in each half's team colour (white at the
 *  halfway line), glowing a little; the ball's reticle on them as on every wall foot */
export function boardsMaterial(ballPosition: Vector3, blue: Color, orange: Color): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1, side: FrontSide });
  const map = boardsTexture();
  if (map) material.map = map;
  else material.color.set(0x162030);
  addBallReticle(material, ballPosition);
  const reticle = material.onBeforeCompile.bind(material);
  const { textFrom, textTo, band } = GREENHOUSE.boards;
  material.onBeforeCompile = (shader, renderer) => {
    reticle(shader, renderer);
    shader.uniforms["teamBlue"] = { value: blue };
    shader.uniforms["teamOrange"] = { value: orange };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 board;\nvarying vec2 vBoard;\nvarying float vEnd;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBoard = board;\nvEnd = (modelMatrix * vec4(transformed, 1.0)).z;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 teamBlue;\nuniform vec3 teamOrange;\nvarying vec2 vBoard;\nvarying float vEnd;")
      .replace(
        "#include <map_fragment>",
        /* glsl */ `
        #ifdef USE_MAP
          // (the lettering only within its band; the panel's colour above and below)
          float lettering = step(${textFrom.toFixed(2)}, vBoard.y) * step(vBoard.y, ${textTo.toFixed(2)});
          vec4 letters = texture2D(map, vec2(vBoard.x / ${GREENHOUSE.boards.repeat.toFixed(1)}, (vBoard.y - ${textFrom.toFixed(2)}) / ${(textTo - textFrom).toFixed(2)}));
          diffuseColor *= mix(vec4(0.0084, 0.0144, 0.0296, 1.0), letters, lettering);
        #endif
          float end = clamp(vEnd / 2400.0, -1.0, 1.0);
          vec3 team = mix(vec3(0.9), end < 0.0 ? teamBlue : teamOrange, abs(end));
          float topBand = smoothstep(${band.toFixed(2)}, ${(band + 0.03).toFixed(2)}, vBoard.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, team, topBand);`,
      )
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * topBand * 0.55;");
  };
  material.customProgramCacheKey = () => "greenhouseBoards";
  return material;
}

/** The pitch's GLSL: its colour at a floor point (the game's x, y) from the grass's under it */
const PITCH_GLSL = /* glsl */ `
  uniform vec2 pitchHalf;
  uniform float pitchCorner;
  uniform float pitchLine;
  uniform float pitchCentre;
  uniform float pitchSpot;
  uniform vec2 pitchPenalty;
  uniform vec2 pitchGoalArea;
  uniform float pitchPenaltySpot;
  uniform float pitchArc;
  uniform float pitchCornerArc;
  uniform float pitchStripe;
  uniform vec3 grassA;
  uniform vec3 grassB;
  uniform vec3 chalk;
  varying vec2 vPitch;
  float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  vec3 pitchColour(vec2 p) {
    float px = max(length(fwidth(p)), 1e-3);
    // (the mown stripes across the pitch, the middle one on the halfway line)
    float s = p.y / pitchStripe;
    float stripe = clamp((abs(fract(s * 0.5) * 2.0 - 1.0) - 0.5) / max(fwidth(s), 1e-4) + 0.5, 0.0, 1.0);
    vec3 grass = mix(grassA, grassB, stripe);
    vec2 e = abs(p);
    float yEnd = pitchHalf.y;
    float bound = sdRoundBox(p, pitchHalf, pitchCorner);
    float d = abs(bound);
    d = min(d, max(e.y, e.x - pitchHalf.x));
    d = min(d, abs(length(p) - pitchCentre));
    d = min(d, abs(sdBox(vec2(e.x, e.y - (yEnd - 0.5 * pitchPenalty.y)), vec2(pitchPenalty.x, 0.5 * pitchPenalty.y))));
    d = min(d, abs(sdBox(vec2(e.x, e.y - (yEnd - 0.5 * pitchGoalArea.y)), vec2(pitchGoalArea.x, 0.5 * pitchGoalArea.y))));
    vec2 spot = vec2(e.x, e.y - (yEnd - pitchPenaltySpot));
    d = min(d, max(abs(length(spot) - pitchArc), e.y - (yEnd - pitchPenalty.y)));
    vec2 corner = pitchHalf - vec2(pitchCorner * (1.0 - 0.70710678));
    d = min(d, max(abs(length(e - corner) - pitchCornerArc), bound));
    float line = 1.0 - smoothstep(pitchLine - 0.5 * px, pitchLine + 0.5 * px, d);
    // (the centre spot alone: no penalty spots, which read as a boost pad: the user's, 2026-10-17; their arcs kept)
    float dots = length(p) - pitchSpot;
    float fill = 1.0 - smoothstep(-0.5 * px, 0.5 * px, dots);
    return mix(grass, chalk, max(line, fill));
  }`;

/** The pitch: the floor's grass, mown in wide stripes, with its chalk markings; lit as any floor */
export function pitchMaterial(layout: PitchLayout, grassA: Color, grassB: Color, chalk: Color): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, side: FrontSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      pitchHalf: { value: new Vector2(...layout.half) },
      pitchCorner: { value: layout.cornerRadius },
      pitchLine: { value: layout.lineHalf },
      pitchCentre: { value: layout.centreRadius },
      pitchSpot: { value: layout.spotRadius },
      pitchPenalty: { value: new Vector2(...layout.penalty) },
      pitchGoalArea: { value: new Vector2(...layout.goalArea) },
      pitchPenaltySpot: { value: layout.penaltySpot },
      pitchArc: { value: layout.arcRadius },
      pitchCornerArc: { value: layout.cornerArc },
      pitchStripe: { value: layout.stripe },
      grassA: { value: grassA },
      grassB: { value: grassB },
      chalk: { value: chalk },
    });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vPitch;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPitch = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PITCH_GLSL}`)
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= pitchColour(vPitch);");
  };
  material.customProgramCacheKey = () => "greenhousePitch";
  return material;
}

/** The goal's light (ours: the user's "just a normal light wrapper", 2026-10-17): one ribbon round the mouth's white
 *  frame, from the floor up one post (on the back wall's r 96 fillet, then its face), over the 45 degree corner and
 *  the bar's top, down the other post to the floor; glowing from the frame's outer edge outward `width` uu, a little in
 *  front of the wall; the +y goal's (src/render/arena.ts mirrors it) */
export function goalOutline(width = 56): GlowRibbon {
  const f = WALL_FOOT.frame;
  const front = 2;
  // (the outline in the wall's (x, z), from the left post's foot round to the right's: the fillet's quarter, the post,
  // the corner's 45 degrees, the bar's top)
  const half: [number, number][] = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * (Math.PI / 2);
    half.push([f.outer, f.fillet.z - f.fillet.r * Math.cos(a)]);
  }
  half.push([f.outer, f.corner], [f.outer - (f.top - f.corner), f.top], [0, f.top]);
  const outline = [...half.map(([x, z]): [number, number] => [-x, z]), ...half.slice(0, -1).reverse()];
  // (where the outline is on the fillet: its y there, the wall's face above it)
  const yAt = (z: number): number => (z >= f.fillet.z ? BACK_Y : f.fillet.y + Math.sqrt(Math.max(0, f.fillet.r ** 2 - (f.fillet.z - z) ** 2))) - front;
  const attached: number[] = [];
  const free: number[] = [];
  outline.forEach(([x, z], i) => {
    // (outward: the outline's normal in the wall's plane, mitred at the corners; straight out sideways on the fillet)
    const [px, pz] = outline[Math.max(0, i - 1)] ?? [x, z];
    const [nx, nz] = outline[Math.min(outline.length - 1, i + 1)] ?? [x, z];
    const [tx, tz] = [nx - px, nz - pz];
    const l = Math.hypot(tx, tz) || 1;
    let [ox, oz] = [-tz / l, tx / l];
    if (ox * x + oz * (z - f.top / 2) < 0) [ox, oz] = [-ox, -oz];
    if (z < f.fillet.z) [ox, oz] = [Math.sign(x), 0];
    attached.push(x, yAt(z), z);
    free.push(x + ox * width, yAt(z), Math.max(0, z + oz * width));
  });
  return { attached, free, part: "mouth" };
}

/** The greenhouse's walls: the boards (the surface up to their height), the glass (the rest of it, above them), the
 *  white goal posts and bar */
export function greenhouseWalls(
  surface: ArenaSurface,
  ballPosition: Vector3,
  blue: Color,
  orange: Color,
  clock?: ArenaClock,
): { readonly group: Group; readonly glass: GreenhouseGlassMaterial } {
  const { positions } = surface;
  const indices = Array.from(surface.indices);
  // (the surface cut at the boards' height all the way round: the boards below, the glass and its bars above, ending
  // at the goal mouth's edge where the surface does, under the posts)
  const { top } = GREENHOUSE.boards;
  const below = clip(positions, indices, (_x, _y, z) => z - top);
  const above = clip(positions, indices, (_x, _y, z) => z - top, true);
  const glassMaterial = new GreenhouseGlassMaterial(ballPosition, blue, orange, clock);
  const glass = new Mesh(glassGeometry(above.positions, above.indices), glassMaterial);
  glass.name = "greenhouse glass";
  glass.renderOrder = ARENA_PRIORITY.base;
  // (the boards: each vertex's place along the wall, signed so the lettering reads left to right from inside on every
  // wall, and its height as a share of the boards' there)
  const boardsGeometry = glassGeometry(below.positions, below.indices);
  const chart = boardsGeometry.getAttribute("chart");
  const place = boardsGeometry.getAttribute("position");
  const board = new Float32Array(chart.count * 2);
  for (let i = 0; i < chart.count; i++) {
    // (Three's x the game's x, its z the game's y)
    const [x, y, z] = [place.getX(i), place.getZ(i), place.getY(i)];
    board.set([(x * y >= 0 ? 1 : -1) * chart.getX(i), z / top], 2 * i);
  }
  boardsGeometry.setAttribute("board", new BufferAttribute(board, 2));
  boardsGeometry.deleteAttribute("chart");
  const boards = new Mesh(boardsGeometry, boardsMaterial(ballPosition, blue, orange));
  boards.name = "greenhouse boards";
  // (the goal mouth's frame painted white: a football goal's posts and bar)
  const frame = framePieces();
  const postMaterial = new MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.35, metalness: 0.05, side: FrontSide });
  addBallReticle(postMaterial, ballPosition);
  const posts = new Mesh(fourWays(frame.positions, frame.indices), postMaterial);
  posts.name = "greenhouse posts";
  const group = new Group();
  group.add(glass, boards, posts);
  return { group, glass: glassMaterial };
}
