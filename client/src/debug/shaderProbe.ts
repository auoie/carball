// ?viewer=shaders: the shaders' own functions run on the GPU against their TypeScript twins (RV-148: the unit tests
// check the twins; this checks the GLSL the materials embed), and the post-processing chain measured. The e2e suite calls
// window.carballShaderProbe.
import {
  Color,
  DataTexture,
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
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { PostProcess, REMAP_GLSL, TONEMAP_GLSL, display, unclippedNodes } from "../render/postProcess";
import { ENV_GLSL, NET_SIDE_GLSL, envG, netSideUv } from "../render/gameSurfaces";
import { CONST_TABLES_GLSL, tablesUniform } from "../render/constTables";

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
    inputs: () =>
      grid(-1.1, 1.1, 40).flatMap((u) =>
        grid(-1.1, 1.1, 40).map((v): [number[], number[]] => [
          [u, v, 0, 0],
          [0, 0, 0, 0],
        ]),
      ),
    tolerance: 2e-4,
  },
  netSideUv: {
    glsl: NET_SIDE_GLSL,
    call: "vec4(netSideUv(i.x, i.y), 0.0, 0.0)",
    twin: (i) => [...netSideUv(i[0] ?? 0, i[1] ?? 0), 0, 0],
    inputs: () =>
      grid(5120, 6000, 22).flatMap((ay) =>
        grid(0, 640, 16).map((z): [number[], number[]] => [
          [ay, z, 0, 0],
          [0, 0, 0, 0],
        ]),
      ),
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
          .map((e): [number[], number[]] => [
            [10 ** e, 0.7 * 10 ** e, 1.3 * 10 ** e, fade],
            [0, 0, 0, 0],
          ])
          .filter(([i]) => i.slice(0, 3).every((x) => Math.abs(x - 0.255447) > 2e-4)),
      ),
    tolerance: 2e-4,
  },
  // (the height fog from the cars' height, uncapped: distances 5k to 1000k all round, from 10 down to 80 up)
  // (the capture's sky through its top face: the game's dome's distance, capped at 31,887 uu)
};

const vertexShader = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Runs the probes on a renderer of its own */
export function shaderProbe(canvas: HTMLCanvasElement): {
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
    const lum = (px: Uint8Array, i: number, j: number): number =>
      (0.2126 * (px[4 * (j * w + i)] ?? 0) + 0.7152 * (px[4 * (j * w + i) + 1] ?? 0) + 0.0722 * (px[4 * (j * w + i) + 2] ?? 0)) / 255;
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
