// ?viewer=shaders: the shaders' own functions run on the GPU against their TypeScript twins (RV-148: the unit tests
// check the twins; this checks the GLSL the materials embed), and materials rendered where a shader's defines decide
// what shows (the boost pads' taken look). The e2e suite calls window.carballShaderProbe.
import {
  Color,
  DataTexture,
  DataUtils,
  FloatType,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { BoostPadsView } from "../render/boostPads";

/** The pads' probe: the mean luminance of a small pad's middle (r <= 9) lit, taken and its base alone; of a big pad's
 *  ring (r 30-45) lit, just taken and its base alone; of a big pad's centre 8 s into its warm-up and its base alone */
interface PadsProbe {
  readonly smallLit: number;
  readonly smallTaken: number;
  readonly smallBase: number;
  readonly bigLit: number;
  readonly bigTaken: number;
  readonly bigBase: number;
  readonly bigWarm: number;
  readonly bigWarmBase: number;
}
import { CUBE_FOG_CAP, HEIGHT_FOG_GLSL, fogCd, heightFog, opaqueDelta, skyDelta } from "../render/heightFog";
import { PostProcess, REMAP_GLSL, TONEMAP_GLSL, display, unclippedNodes } from "../render/postProcess";
import { ENV_GLSL, NET_SIDE_GLSL, OVERLAY_UV_GLSL, envG, netSideUv, overlayUv } from "../render/gameSurfaces";
import { CONST_TABLES_GLSL, tablesUniform } from "../render/constTables";
import { UNDER_GLASS_V_GLSL, underGlassV } from "../render/goalInterior";
import { GRASS_REFLECTION_GLSL, grassReflection } from "../render/stadiumField";
import { CUBE_FACE, CubeChain, chainTwin, rawCube, storedCube } from "../render/cubeChain";

/** One function under test: its GLSL (with any uniforms it reads), the call from the inputs `i`, `j` (two vec4s) to a
 *  vec4, the twin on the same inputs, the inputs to try, and how near the two must agree (float32 on the GPU) */
interface Probe {
  readonly glsl: string;
  readonly uniforms?: Record<string, { value: unknown }>;
  readonly call: string;
  readonly twin: (i: readonly number[], j: readonly number[]) => readonly number[];
  readonly inputs: () => [number[], number[]][];
  readonly tolerance: number;
}

const grid = (from: number, to: number, steps: number): number[] => Array.from({ length: steps + 1 }, (_, k) => from + ((to - from) * k) / steps);

export const PROBES: Readonly<Record<string, Probe>> = {
  envG: {
    // (its rings in the shared tables' texture, row 2: render/constTables.ts)
    glsl: `${CONST_TABLES_GLSL}\n${ENV_GLSL}`,
    uniforms: { constTables: tablesUniform() },
    call: "vec4(envG(i.xy), 0.0, 0.0, 0.0)",
    twin: (i) => [envG(i[0] ?? 0, i[1] ?? 0), 0, 0, 0],
    inputs: () => grid(-1.1, 1.1, 40).flatMap((u) => grid(-1.1, 1.1, 40).map((v): [number[], number[]] => [[u, v, 0, 0], [0, 0, 0, 0]])),
    tolerance: 2e-4,
  },
  grassReflection: {
    glsl: GRASS_REFLECTION_GLSL,
    call: "vec4(grassReflection(i.x, vec3(i.y), i.z), 0.0)",
    twin: (i) => {
      const r = grassReflection(i[0] ?? 0, i[1] ?? 0, i[2] ?? 0);
      return [r, r, r, 0];
    },
    inputs: () => grid(0, 1, 20).flatMap((cos) => grid(0, 3, 30).map((cube): [number[], number[]] => [[cos, cube, 0.185, 0], [0, 0, 0, 0]])),
    tolerance: 1e-5,
  },
  overlayUv: {
    glsl: OVERLAY_UV_GLSL,
    call: "vec4(overlayUv(i.xyz, j.xyz), 0.0, 0.0)",
    twin: (i, j) => [...overlayUv([i[0] ?? 0, i[1] ?? 0, i[2] ?? 0], [j[0] ?? 0, j[1] ?? 0, j[2] ?? 0]), 0, 0],
    inputs: () => {
      // (every branch: the roof, back and side walls, the midfield fillet strip, the vertical corners either side of
      // their seam, the fillets)
      const normals = [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0.6, 0, 0.8], [0, 0.6, 0.8], [0.72, 0.69, 0.05], [0.69, 0.72, 0.05], [0.5, 0.45, 0.74], [0.45, 0.5, 0.5], [0.55, 0.54, 0.636], [0.32, 0.7, 0.636], [0.7071, 0.7071, 0], [0.7081, 0.7061, 0]];
      const points = [[3000, 4000, 1500], [-3843, 4226, 700], [4000, -100, 100], [1000, -5100, 300], [-200, 60, 200], [3500, 4500, 1900]];
      return normals.flatMap((n) => points.map((p): [number[], number[]] => [[...p, 0], [...n, 0]]));
    },
    tolerance: 1e-4,
  },
  netSideUv: {
    glsl: NET_SIDE_GLSL,
    call: "vec4(netSideUv(i.x, i.y), 0.0, 0.0)",
    twin: (i) => [...netSideUv(i[0] ?? 0, i[1] ?? 0), 0, 0],
    inputs: () => grid(5120, 6000, 22).flatMap((ay) => grid(0, 640, 16).map((z): [number[], number[]] => [[ay, z, 0, 0], [0, 0, 0, 0]])),
    tolerance: 2e-5,
  },
  display: {
    glsl: `uniform float remapR[16];\nuniform float remapG[16];\nuniform float remapB[16];\n${TONEMAP_GLSL}\n${REMAP_GLSL}`,
    uniforms: { remapR: { value: unclippedNodes(0) }, remapG: { value: unclippedNodes(1) }, remapB: { value: unclippedNodes(2) } },
    call: "vec4(carballRemap(carballTonemap(i.rgb), i.a), 0.0)",
    twin: (i) => [...display([i[0] ?? 0, i[1] ?? 0, i[2] ?? 0], i[3] ?? 0), 0],
    // (linear 0 to 10, log spaced, each channel apart, at fades 0, 0.5 and 0.9; off the tone map's 1e-4-wide step at Z)
    inputs: () =>
      [0, 0.5, 0.9].flatMap((fade) =>
        grid(-4, 1, 60)
          .map((e): [number[], number[]] => [[10 ** e, 0.7 * 10 ** e, 1.3 * 10 ** e, fade], [0, 0, 0, 0]])
          .filter(([i]) => i.slice(0, 3).every((x) => Math.abs(x - 0.255447) > 2e-4)),
      ),
    tolerance: 2e-4,
  },
  // (the height fog from the cars' height, uncapped: distances 5k to 1000k all round, from 10 down to 80 up)
  heightFog: {
    glsl: HEIGHT_FOG_GLSL,
    uniforms: { uFogCd: { value: fogCd(17) }, uFogCam: { value: new Vector3(0, 17, 0) }, uFogCap: { value: 1e30 }, uFogAxis: { value: new Vector3(0, 0, -1) } },
    call: "carballHeightFog(i.xyz)",
    twin: (i) => {
      const fog = heightFog([i[0] ?? 0, i[1] ?? 0, i[2] ?? 0], fogCd(17));
      return [...fog.add, fog.F];
    },
    inputs: () =>
      [5000, 12000, 20000, 40000, 1e6].flatMap((d) =>
        grid(0, 330, 11).flatMap((az) =>
          grid(-10, 80, 9).map((el): [number[], number[]] => {
            const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
            return [[d * Math.cos(e) * Math.cos(a), d * Math.sin(e), d * Math.cos(e) * Math.sin(a), 0], [0, 0, 0, 0]];
          }),
        ),
      ),
    tolerance: 2e-4,
  },
  // (the capture's sky through its top face: the game's dome's distance, capped at 31,887 uu)
  heightFogCapture: {
    glsl: HEIGHT_FOG_GLSL,
    uniforms: { uFogCd: { value: fogCd(927.9998) }, uFogCam: { value: new Vector3(0, 927.9998, 0) }, uFogCap: { value: CUBE_FOG_CAP }, uFogAxis: { value: new Vector3(0, 1, 0) } },
    call: "carballHeightFog(carballOpaqueDelta(uFogCam + carballSkyDelta(normalize(i.xyz))))",
    twin: (i) => {
      const fog = heightFog(opaqueDelta(skyDelta([i[0] ?? 0, i[1] ?? 0, i[2] ?? 0]), [0, 1, 0], CUBE_FOG_CAP), fogCd(927.9998));
      return [...fog.add, fog.F];
    },
    inputs: () =>
      grid(0, 330, 11).flatMap((az) =>
        grid(50, 89, 13).map((el): [number[], number[]] => {
          const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
          return [[Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a), 0], [0, 0, 0, 0]];
        }),
      ),
    tolerance: 2e-4,
  },
  underGlassV: {
    glsl: UNDER_GLASS_V_GLSL,
    call: "vec4(underGlassV(i.x), 0.0, 0.0, 0.0)",
    twin: (i) => [underGlassV(i[0] ?? 0), 0, 0, 0],
    // (off the strips' edges, where fract jumps 0 to 1 and float32 may land either side)
    inputs: () => grid(0.5, 767.5, 767).map((ax): [number[], number[]] => [[ax + 0.25, 0, 0, 0], [0, 0, 0, 0]]),
    tolerance: 1e-5,
  },
};

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Runs the probes on a renderer of its own */
export function shaderProbe(canvas: HTMLCanvasElement): {
  /** The pads' discs rendered from above, lit and taken, each size, and a reference disc in the dim look (no glow):
   *  their mean luminance where the disc shows round the orb */
  pads: () => PadsProbe;
  /** The post-processing chain on two scenes (PP-1..10): a uniform linear grey filling the view (its display value at
   *  the centre, with the depth of field and bloom on), and a small patch at linear 50 on black (the mean display
   *  value in a ring round it, with bloom on and off) */
  post: (grey: number) => { grey: number; expected: number; ringBloom: number; ringNoBloom: number };
  /** The bloom target's sum (linear) for a large patch at linear `level` on black (RV-161: the soft knee from 2, the
   *  colour times its weight, no subtraction) */
  bloomSum: (level: number) => number;
  /** The capture's chain (CAP1: box, blur, bilinear up, store) on the GPU against its CPU twin (chainTwin) on a pattern
   *  of ramps and an HDR spot per face: the share of stored 8-bit codes equal, and the largest difference in codes
   *  (RV-201) */
  chain: () => { texels: number; exact: number; maxCodes: number };
  names: () => string[];
  compare: (name: string) => { count: number; maxError: number; tolerance: number; worst: { i: number[]; j: number[]; gpu: number[]; cpu: number[] } | null };
} {
  const gl = new WebGLRenderer({ canvas });
  const camera = new OrthographicCamera();
  const run = (probe: Probe, inputs: readonly [number[], number[]][]): number[][] => {
    const n = inputs.length;
    const data = new Float32Array(n * 2 * 4);
    inputs.forEach(([i, j], k) => {
      data.set(i.slice(0, 4), 4 * k);
      data.set(j.slice(0, 4), 4 * (n + k));
    });
    const texture = new DataTexture(data, n, 2, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.needsUpdate = true;
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D inputs;
        ${probe.glsl}
        void main() {
          int k = int(gl_FragCoord.x);
          vec4 i = texelFetch(inputs, ivec2(k, 0), 0);
          vec4 j = texelFetch(inputs, ivec2(k, 1), 0);
          gl_FragColor = ${probe.call};
        }`,
      uniforms: { inputs: { value: texture }, ...(probe.uniforms ?? {}) },
    });
    const scene = new Scene();
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    scene.add(quad);
    const target = new WebGLRenderTarget(n, 1, { type: FloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    const out = new Float32Array(n * 4);
    gl.readRenderTargetPixels(target, 0, 0, n, 1, out);
    for (const d of [texture, material, quad.geometry, target]) d.dispose();
    return Array.from({ length: n }, (_, k) => Array.from(out.subarray(4 * k, 4 * k + 4)));
  };
  const pads = (): PadsProbe => {
    // (five pads in a row along the game's x, looked at straight down: drawn whole, then their bases alone, a taken pad
    // the same both ways, its base: RV-33; a big one just taken (its warm-up nothing yet), one 8 s into its warm-up)
    const at = [-1600, -800, 0, 800, 1600];
    const view = new BoostPadsView([
      { pos: { x: at[0] ?? 0, y: 0, z: 0 }, big: false, active: true, cooldown: 0 },
      { pos: { x: at[1] ?? 0, y: 0, z: 0 }, big: false, active: false, cooldown: 2 },
      { pos: { x: at[2] ?? 0, y: 0, z: 0 }, big: true, active: true, cooldown: 0 },
      { pos: { x: at[3] ?? 0, y: 0, z: 0 }, big: true, active: false, cooldown: 10 },
      { pos: { x: at[4] ?? 0, y: 0, z: 0 }, big: true, active: false, cooldown: 2 },
    ]);
    const scene = new Scene();
    scene.add(view.root);
    const [w, h] = [1600, 320];
    const top = new OrthographicCamera(-2000, 2000, 400, -400, 1, 1000);
    top.position.set(0, 500, 0);
    top.up.set(0, 0, -1);
    top.lookAt(0, 0, 0);
    const target = new WebGLRenderTarget(w, h);
    const draw = (): Uint8Array => {
      gl.setRenderTarget(target);
      gl.render(scene, top);
      gl.setRenderTarget(null);
      const out = new Uint8Array(w * h * 4);
      gl.readRenderTargetPixels(target, 0, 0, w, h, out);
      return out;
    };
    const whole = draw();
    view.fxVisible = false;
    const bases = draw();
    target.dispose();
    // (a small pad's middle, r <= 9: its inlay at its brightest; a big pad's ring between r 30 and 45: over its windows,
    // its orb (r 18.6) inside it; its centre, r <= 18, warming up)
    const ring = (px: Uint8Array, x: number, [r0, r1]: readonly [number, number]): number => {
      let sum = 0;
      let n = 0;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const [ux, uz] = [((i + 0.5) / w) * 4000 - 2000, ((j + 0.5) / h) * 800 - 400];
          const r = Math.hypot(ux - x, uz);
          if (r < r0 || r > r1) continue;
          const k = 4 * (j * w + i);
          sum += (0.2126 * (px[k] ?? 0) + 0.7152 * (px[k + 1] ?? 0) + 0.0722 * (px[k + 2] ?? 0)) / 255;
          n++;
        }
      }
      return n > 0 ? sum / n : NaN;
    };
    const [middle, centre, windows] = [[0, 9], [0, 18], [30, 45]] as const;
    return {
      smallLit: ring(whole, at[0] ?? 0, middle),
      smallTaken: ring(whole, at[1] ?? 0, middle),
      smallBase: ring(bases, at[1] ?? 0, middle),
      bigLit: ring(whole, at[2] ?? 0, windows),
      bigTaken: ring(whole, at[3] ?? 0, windows),
      bigBase: ring(bases, at[3] ?? 0, windows),
      bigWarm: ring(whole, at[4] ?? 0, centre),
      bigWarmBase: ring(bases, at[4] ?? 0, centre),
    };
  };
  const post = (grey: number): { grey: number; expected: number; ringBloom: number; ringNoBloom: number } => {
    const [w, h] = [320, 180];
    gl.setSize(w, h, false);
    gl.setPixelRatio(1);
    const chain = new PostProcess(gl);
    const view = new PerspectiveCamera(60, w / h, 5, 40000);
    view.position.set(0, 0, 1000);
    view.lookAt(0, 0, 0);
    const read = (): Uint8Array => {
      const px = new Uint8Array(w * h * 4);
      const ctx = gl.getContext();
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      return px;
    };
    const lum = (px: Uint8Array, i: number, j: number): number => (0.2126 * (px[4 * (j * w + i)] ?? 0) + 0.7152 * (px[4 * (j * w + i) + 1] ?? 0) + 0.0722 * (px[4 * (j * w + i) + 2] ?? 0)) / 255;
    // A wall of linear grey (unlit) filling the view
    const uniform = new Scene();
    uniform.background = new Color(0, 0, 0);
    uniform.add(new Mesh(new PlaneGeometry(10000, 10000), new MeshBasicMaterial({ color: new Color().setRGB(grey, grey, grey) })));
    chain.render(uniform, view, { bloom: true, depthOfField: true });
    const greyOut = lum(read(), w / 2, h / 2);
    // A small patch at linear 50 on black: bloom round it, or none
    const patch = new Scene();
    patch.background = new Color(0, 0, 0);
    const bright = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial({ color: new Color().setRGB(50, 50, 50) }));
    patch.add(bright);
    const ring = (options: { bloom: boolean; depthOfField: boolean }): number => {
      chain.render(patch, view, options);
      const px = read();
      let sum = 0;
      let n = 0;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const r = Math.hypot(i - w / 2, j - h / 2);
          if (r < 12 || r > 30) continue;
          sum += lum(px, i, j);
          n++;
        }
      }
      return sum / n;
    };
    const ringBloom = ring({ bloom: true, depthOfField: false });
    const ringNoBloom = ring({ bloom: false, depthOfField: false });
    chain.dispose();
    const [r, g, b] = display([grey, grey, grey]);
    return { grey: greyOut, expected: 0.2126 * r + 0.7152 * g + 0.0722 * b, ringBloom, ringNoBloom };
  };
  const bloomSum = (level: number): number => {
    const [w, h] = [320, 180];
    gl.setSize(w, h, false);
    gl.setPixelRatio(1);
    const chain = new PostProcess(gl);
    const view = new PerspectiveCamera(60, w / h, 5, 40000);
    view.position.set(0, 0, 1000);
    view.lookAt(0, 0, 0);
    const scene = new Scene();
    scene.background = new Color(0, 0, 0);
    scene.add(new Mesh(new PlaneGeometry(240, 240), new MeshBasicMaterial({ color: new Color().setRGB(level, level, level) })));
    chain.render(scene, view, { bloom: true, depthOfField: false });
    const bloom = chain.readBloom();
    chain.dispose();
    let sum = 0;
    for (let k = 0; k < (bloom?.data.length ?? 0); k += 4) sum += bloom?.data[k] ?? 0;
    return sum;
  };
  const chain = (): { texels: number; exact: number; maxCodes: number } => {
    const raw = rawCube();
    const out = storedCube();
    // (per face: ramps across and up, an HDR spot moving face to face; written at each texel's centre)
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform int face;
        void main() {
          vec2 st = gl_FragCoord.xy / ${CUBE_FACE.toFixed(1)};
          float f = float(face);
          float spot = 3.0 * exp(-(pow(st.x - 0.3 - 0.05 * f, 2.0) + pow(st.y - 0.6, 2.0)) / 0.004);
          gl_FragColor = vec4(0.1 + 0.8 * st.x + spot, 0.05 + 0.5 * st.y + 0.3 * spot, 0.2 + 0.6 * st.x * (1.0 - st.y) + 0.1 * f, 1.0);
        }`,
      uniforms: { face: { value: 0 } },
    });
    const scene = new Scene();
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    scene.add(quad);
    for (let face = 0; face < 6; face++) {
      material.uniforms["face"] = { value: face };
      gl.setRenderTarget(raw, face);
      gl.render(scene, camera);
    }
    const runner = new CubeChain(gl);
    runner.run(raw.texture, out);
    gl.setRenderTarget(null);
    const read = (target: typeof raw, face: number): Float32Array => {
      const halves = new Uint16Array(CUBE_FACE * CUBE_FACE * 4);
      gl.readRenderTargetPixels(target, 0, 0, CUBE_FACE, CUBE_FACE, halves, face);
      return Float32Array.from(halves, (h) => DataUtils.fromHalfFloat(h));
    };
    const faces = [0, 1, 2, 3, 4, 5];
    // (the twin from the raw faces as the GPU holds them: its half floats)
    const twin = chainTwin(faces.map((f) => read(raw, f)));
    const code = (v: number): number => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
    let [texels, exact, maxCodes] = [0, 0, 0];
    faces.forEach((f) => {
      const gpu = read(out, f);
      const cpu = twin[f] ?? new Float32Array(0);
      for (let k = 0; k < gpu.length; k++) {
        if (k % 4 === 3) continue;
        const d = Math.abs(code(gpu[k] ?? 0) - code(cpu[k] ?? 0));
        texels++;
        if (d === 0) exact++;
        maxCodes = Math.max(maxCodes, d);
      }
    });
    runner.dispose();
    for (const d of [raw, out, material, quad.geometry]) d.dispose();
    return { texels, exact: exact / texels, maxCodes };
  };
  return {
    pads,
    post,
    bloomSum,
    chain,
    names: () => Object.keys(PROBES),
    compare: (name) => {
      const probe = PROBES[name];
      if (!probe) throw new Error(`no probe ${name}`);
      const inputs = probe.inputs();
      const gpu = run(probe, inputs);
      let maxError = 0;
      let worst: { i: number[]; j: number[]; gpu: number[]; cpu: number[] } | null = null;
      inputs.forEach(([i, j], k) => {
        const cpu = [...probe.twin(i, j)];
        const g = gpu[k] ?? [];
        const error = Math.max(...cpu.map((c, m) => Math.abs(c - (g[m] ?? NaN))));
        if (!(error <= maxError)) {
          maxError = Number.isNaN(error) ? Infinity : error;
          worst = { i, j, gpu: g, cpu };
        }
      });
      return { count: inputs.length, maxError, tolerance: probe.tolerance, worst };
    },
  };
}
