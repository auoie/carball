// ?viewer=shaders: the shaders' own functions run on the GPU against their TypeScript twins (RV-148: the unit tests
// check the twins; this checks the GLSL the materials embed), and materials rendered where a shader's defines decide
// what shows (the boost pads' taken look). The e2e suite calls window.rlShaderProbe.
import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  FloatType,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { BoostPadsView, PAD_LOOK } from "../render/entities";
import { PostProcess, REMAP_GLSL, TONEMAP_GLSL, display, unclippedNodes } from "../render/postProcess";
import { ENV_GLSL, ENV_RADIAL, ENV_SPREAD, NET_SIDE_GLSL, OVERLAY_UV_GLSL, envG, netSideUv, overlayUv } from "../render/gameSurfaces";
import { UNDER_GLASS_V_GLSL, underGlassV } from "../render/goalInterior";
import { GRASS_REFLECTION_GLSL, grassReflection } from "../render/stadiumField";

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
    glsl: `uniform float envRadial[9];\nuniform float envSpread[9];\n${ENV_GLSL}`,
    uniforms: { envRadial: { value: ENV_RADIAL }, envSpread: { value: ENV_SPREAD } },
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
    call: "vec4(rlRemap(rlTonemap(i.rgb), i.a), 0.0)",
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
  pads: () => { smallLit: number; smallTaken: number; bigLit: number; bigTaken: number; dim: number };
  /** The post-processing chain on two scenes (PP-1..10): a uniform linear grey filling the view (its display value at
   *  the centre, with the depth of field and bloom on), and a small patch at linear 50 on black (the mean display
   *  value in a ring round it, with bloom on and off) */
  post: (grey: number) => { grey: number; expected: number; ringBloom: number; ringNoBloom: number };
  /** The bloom target's sum (linear) for a large patch at linear `level` on black (RV-161: the soft knee from 2, the
   *  colour times its weight, no subtraction) */
  bloomSum: (level: number) => number;
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
  const pads = (): { smallLit: number; smallTaken: number; bigLit: number; bigTaken: number; dim: number } => {
    // (four pads in a row along the game's x, a dim reference disc after them; looked at straight down)
    const at = [-1600, -800, 0, 800, 1600];
    const view = new BoostPadsView([
      { pos: { x: at[0] ?? 0, y: 0, z: 0 }, big: false, active: true, cooldown: 0 },
      { pos: { x: at[1] ?? 0, y: 0, z: 0 }, big: false, active: false, cooldown: 2 },
      { pos: { x: at[2] ?? 0, y: 0, z: 0 }, big: true, active: true, cooldown: 0 },
      { pos: { x: at[3] ?? 0, y: 0, z: 0 }, big: true, active: false, cooldown: 5 },
    ]);
    const scene = new Scene();
    const sun = new DirectionalLight(0xffffff, 2);
    sun.position.set(0.3, 1, 0.2);
    scene.add(view.root, new AmbientLight(0xffffff, 0.5), sun);
    const reference = new Mesh(new CylinderGeometry(50, 55, 6, 24), new MeshStandardMaterial({ color: PAD_LOOK.dim, roughness: PAD_LOOK.roughness }));
    reference.position.set(at[4] ?? 0, 3, 0);
    scene.add(reference);
    const [w, h] = [400, 80];
    const top = new OrthographicCamera(-2000, 2000, 400, -400, 1, 1000);
    top.position.set(0, 500, 0);
    top.up.set(0, 0, -1);
    top.lookAt(0, 0, 0);
    const target = new WebGLRenderTarget(w, h);
    gl.setRenderTarget(target);
    gl.render(scene, top);
    gl.setRenderTarget(null);
    const px = new Uint8Array(w * h * 4);
    gl.readRenderTargetPixels(target, 0, 0, w, h, px);
    target.dispose();
    // (each disc's ring between r 30 and 45 uu: past a small pad's orb (r 18), inside its disc (r 50); a big pad's orb is
    // gone when taken, and over the ring when lit, which only adds to its light)
    const ring = (x: number): number => {
      let sum = 0;
      let n = 0;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const [ux, uz] = [((i + 0.5) / w) * 4000 - 2000, ((j + 0.5) / h) * 800 - 400];
          const r = Math.hypot(ux - x, uz);
          if (r < 30 || r > 45) continue;
          const k = 4 * (j * w + i);
          sum += (0.2126 * (px[k] ?? 0) + 0.7152 * (px[k + 1] ?? 0) + 0.0722 * (px[k + 2] ?? 0)) / 255;
          n++;
        }
      }
      return n > 0 ? sum / n : NaN;
    };
    return { smallLit: ring(at[0] ?? 0), smallTaken: ring(at[1] ?? 0), bigLit: ring(at[2] ?? 0), bigTaken: ring(at[3] ?? 0), dim: ring(at[4] ?? 0) };
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
  return {
    pads,
    post,
    bloomSum,
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
