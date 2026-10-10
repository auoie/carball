// The reflection capture's chain as the exe's (notes/arena-surroundings.md SUR-32 CAP1, notes/post-processing.md PP-31
// §17): each face rendered in linear HDR, then on its own (never across faces) box-downsampled to 64², blurred by a
// separable 9-tap Gaussian (variance 3.2 texels², taps off the face counting nothing), upsampled bilinearly to 256²,
// clamped and stored as the game's 8-bit gamma-2.2 encode read back through an sRGB decode. No mips, no prefilter: the
// materials sample it at level 0.
import {
  type CubeTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  WebGLCubeRenderTarget,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

/** The blur's 9 taps' weights, the centre's first (exp(-i² / 6.4), normalised: the exe's r = 3.2 kernel) */
export const CUBE_BLUR_WEIGHTS = [0.22546, 0.19285, 0.12068, 0.05524, 0.01851] as const;
/** The face, the blur's working size */
export const CUBE_FACE = 256;
export const CUBE_BLUR_SIZE = 64;

/** The store's transfer (FGammaCorrectionPixelShader into an sRGB texture): linear in, what a material samples out */
export function cubeStore(c: number): number {
  const byte = Math.round(255 * Math.min(Math.max(c, 0), 1) ** (1 / 2.2)) / 255;
  return byte <= 0.04045 ? byte / 12.92 : ((byte + 0.055) / 1.055) ** 2.4;
}

/** A direction for face `f` (GL's order: +x, -x, +y, -y, +z, -z) at its texture coordinates (s, t), 0 to 1 */
export function faceDirection(f: number, s: number, t: number): [number, number, number] {
  const [sc, tc] = [2 * s - 1, 2 * t - 1];
  const table: [number, number, number][] = [
    [1, -tc, -sc],
    [-1, -tc, sc],
    [sc, 1, tc],
    [sc, -1, -tc],
    [sc, -tc, 1],
    [-sc, -tc, -1],
  ];
  return table[f] ?? [1, 0, 0];
}

/** One face's 64² blur with its weight channel (the shader's, for tests): rows of RGB, the taps off the face nothing;
 *  the weight divided out, or (`divide` false) kept as a fourth channel, as the GPU passes it on */
export function blurFace(face: readonly (readonly number[])[], size = CUBE_BLUR_SIZE, divide = true, half: (v: number) => number = (v) => v): number[][] {
  const w = (i: number): number => CUBE_BLUR_WEIGHTS[Math.abs(i)] ?? 0;
  const pass = (src: readonly (readonly number[])[], horizontal: boolean): number[][] =>
    src.map((_, k) => {
      const [x, y] = [k % size, Math.floor(k / size)];
      let [r, g, b, a] = [0, 0, 0, 0];
      for (let i = -4; i <= 4; i++) {
        const [u, v] = horizontal ? [x + i, y] : [x, y + i];
        if (u < 0 || v < 0 || u >= size || v >= size) continue;
        const c = src[v * size + u] ?? [0, 0, 0, 0];
        r += w(i) * (c[0] ?? 0);
        g += w(i) * (c[1] ?? 0);
        b += w(i) * (c[2] ?? 0);
        a += w(i) * (c[3] ?? 1);
      }
      return [r, g, b, a].map(half);
    });
  const blurred = pass(pass(face, true), false);
  return divide ? blurred.map(([r = 0, g = 0, b = 0, a = 1]) => [r / a, g / a, b / a]) : blurred;
}

/** The whole chain on the CPU (the GPU's twin, for its test): six raw faces (CUBE_FACE² RGBA, rows from the bottom, as
 *  read back) to the stored faces' values (what the materials sample), each step's half floats as the GPU's targets */
export function chainTwin(raw: readonly Float32Array[]): Float32Array[] {
  const half = (v: number): number => DataUtils.fromHalfFloat(DataUtils.toHalfFloat(v));
  const [n, m] = [CUBE_FACE, CUBE_BLUR_SIZE];
  return raw.map((face) => {
    // (the 4 x 4 mean)
    const small = Array.from({ length: m * m }, (_, k) => {
      const [X, Y] = [k % m, Math.floor(k / m)];
      const sum = [0, 0, 0];
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const at = 4 * ((4 * Y + j) * n + 4 * X + i);
          for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (face[at + c] ?? 0);
        }
      }
      return [...sum.map((v) => half(v / 16)), 1];
    });
    const blurred = blurFace(small, m, false, half);
    // (bilinear at each face texel's centre, clamped at the edges; the weight divided out, then the store)
    const out = new Float32Array(n * n * 4);
    const texel = (x: number, y: number): number[] => blurred[Math.min(Math.max(y, 0), m - 1) * m + Math.min(Math.max(x, 0), m - 1)] ?? [0, 0, 0, 1];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const [u, v] = [((x + 0.5) / n) * m - 0.5, ((y + 0.5) / n) * m - 0.5];
        const [x0, y0] = [Math.floor(u), Math.floor(v)];
        const [fx, fy] = [u - x0, v - y0];
        const s = [0, 1, 2, 3].map((c) => {
          const at = (dx: number, dy: number): number => texel(x0 + dx, y0 + dy)[c] ?? 0;
          return (1 - fy) * ((1 - fx) * at(0, 0) + fx * at(1, 0)) + fy * ((1 - fx) * at(0, 1) + fx * at(1, 1));
        });
        const a = Math.max(s[3] ?? 1, 1e-6);
        for (let c = 0; c < 3; c++) out[4 * (y * n + x) + c] = cubeStore((s[c] ?? 0) / a);
        out[4 * (y * n + x) + 3] = 1;
      }
    }
    return out;
  });
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FACE_GLSL = /* glsl */ `
uniform int face;
vec3 faceDirection(vec2 st) {
  vec2 c = 2.0 * st - 1.0;
  if (face == 0) return vec3(1.0, -c.y, -c.x);
  if (face == 1) return vec3(-1.0, -c.y, c.x);
  if (face == 2) return vec3(c.x, 1.0, c.y);
  if (face == 3) return vec3(c.x, -1.0, -c.y);
  if (face == 4) return vec3(c.x, -c.y, 1.0);
  return vec3(-c.x, -c.y, -1.0);
}
`;

/** The chain on the GPU: `run` takes a raw HDR cube (the six faces as rendered) to a stored one */
export class CubeChain {
  readonly #gl: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly #quad: Mesh;
  readonly #small: [WebGLRenderTarget, WebGLRenderTarget];
  readonly #down: ShaderMaterial;
  readonly #blur: ShaderMaterial;
  readonly #store: ShaderMaterial;

  constructor(gl: WebGLRenderer) {
    this.#gl = gl;
    // (half floats: filterable in core WebGL2, where 32-bit floats need OES_texture_float_linear (without it the bilinear
    // upsample reads black: RV-200); 11 bits of mantissa, ample before the 8-bit store)
    const small = (): WebGLRenderTarget =>
      new WebGLRenderTarget(CUBE_BLUR_SIZE, CUBE_BLUR_SIZE, { type: HalfFloatType, format: RGBAFormat, minFilter: NearestFilter, magFilter: LinearFilter, depthBuffer: false, generateMipmaps: false });
    this.#small = [small(), small()];
    // (the 4 x 4 mean of the face's texels about each 64² texel, sampled at the texels' centres: weight 1)
    this.#down = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform samplerCube raw;
        varying vec2 vUv;
        ${FACE_GLSL}
        void main() {
          vec2 corner = floor(vUv * ${CUBE_BLUR_SIZE.toFixed(1)}) * 4.0;
          vec3 sum = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) sum += textureLod(raw, faceDirection((corner + vec2(float(i), float(j)) + 0.5) / ${CUBE_FACE.toFixed(1)}), 0.0).rgb;
          }
          gl_FragColor = vec4(sum / 16.0, 1.0);
        }`,
      uniforms: { raw: { value: null }, face: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    // (9 taps along the axis, the off-face ones nothing: colour and weight summed)
    this.#blur = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D source;
        uniform vec2 axis;
        varying vec2 vUv;
        void main() {
          float weights[5] = float[5](${CUBE_BLUR_WEIGHTS.map((w) => w.toFixed(5)).join(", ")});
          vec2 texel = floor(vUv * ${CUBE_BLUR_SIZE.toFixed(1)});
          vec4 sum = vec4(0.0);
          for (int i = -4; i <= 4; i++) {
            vec2 at = texel + axis * float(i);
            if (any(lessThan(at, vec2(0.0))) || any(greaterThanEqual(at, vec2(${CUBE_BLUR_SIZE.toFixed(1)})))) continue;
            sum += weights[abs(i)] * texelFetch(source, ivec2(at), 0);
          }
          gl_FragColor = sum;
        }`,
      uniforms: { source: { value: null }, axis: { value: new Vector2(1, 0) } },
      depthTest: false,
      depthWrite: false,
    });
    // (bilinear up to the face, the weight divided out, clamped, through the 8-bit gamma 2.2 encode and the sRGB
    // decode: cubeStore)
    this.#store = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: /* glsl */ `
        uniform sampler2D blurred;
        varying vec2 vUv;
        vec3 decode(vec3 b) {
          return mix(b / 12.92, pow((b + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), b));
        }
        void main() {
          vec4 s = texture2D(blurred, vUv);
          vec3 c = clamp(s.rgb / max(s.a, 1e-6), 0.0, 1.0);
          gl_FragColor = vec4(decode(floor(255.0 * pow(c, vec3(1.0 / 2.2)) + 0.5) / 255.0), 1.0);
        }`,
      uniforms: { blurred: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    this.#quad = new Mesh(new PlaneGeometry(2, 2), this.#down);
    this.#quad.frustumCulled = false;
    this.#scene.add(this.#quad);
  }

  /** The raw faces (`raw`: the capture as rendered, linear HDR) blurred and stored into `out`'s faces */
  run(raw: CubeTexture | Texture, out: WebGLCubeRenderTarget): void {
    const gl = this.#gl;
    const previous = gl.getRenderTarget();
    const [a, b] = this.#small;
    for (let face = 0; face < 6; face++) {
      this.#draw(this.#down, { raw, face }, a);
      this.#draw(this.#blur, { source: a.texture, axis: new Vector2(1, 0) }, b);
      this.#draw(this.#blur, { source: b.texture, axis: new Vector2(0, 1) }, a);
      this.#quad.material = this.#store;
      this.#store.uniforms["blurred"] = { value: a.texture };
      gl.setRenderTarget(out, face);
      gl.render(this.#scene, this.#camera);
    }
    gl.setRenderTarget(previous);
  }

  #draw(material: ShaderMaterial, values: Record<string, unknown>, target: WebGLRenderTarget): void {
    for (const [k, v] of Object.entries(values)) {
      const u = material.uniforms[k];
      if (u) u.value = v;
    }
    this.#quad.material = material;
    this.#gl.setRenderTarget(target);
    this.#gl.render(this.#scene, this.#camera);
  }

  dispose(): void {
    for (const t of this.#small) t.dispose();
    for (const m of [this.#down, this.#blur, this.#store]) m.dispose();
    this.#quad.geometry.dispose();
  }
}

/** A stored cube: 256² RGBA half floats, no mips, filtered linearly (the materials sample it at level 0) */
export function storedCube(): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(CUBE_FACE, { type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
}

/** The raw capture's cube: 256² RGBA half floats (linear HDR), sampled texel by texel */
export function rawCube(): WebGLCubeRenderTarget {
  return new WebGLCubeRenderTarget(CUBE_FACE, { type: HalfFloatType, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter });
}
