// The game's post-processing in a match (notes/post-processing.md PP-1..20: PostProcess.Standard_PP's Uber pass, DFH
// Stadium's settings): the scene drawn linear into a half-float target, the depth of field's soft layer (its minimum
// blur 0.25 everywhere, up to 0.6 far off), the bloom (a soft knee from 2, three Gaussian sizes), then one tone map
// and colour remap to display values. Scalars and closed forms only (PP-20).
import {
  DataUtils,
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

/** Tonemapper_Customizable (PP-4): from Range 8, ToeFactor 0.5, TonemapperScale 1: A = 0.22 / s, B = (Range + A) /
 *  Range, Z = sqrt(A B / s) - A (where the Reinhard part's slope is s), W = s, T = the toe */
export const TONEMAP = (() => {
  const [range, toe, s] = [8, 0.5, 1];
  const a = 0.22 / s;
  const b = (range + a) / range;
  return { a, b, z: Math.sqrt((a * b) / s) - a, w: s, t: Math.min(Math.max(toe, 0), 1) };
})();

/** The colour remap's parameters (PP-5: UE3's effect defaults, Stadium's overrides off): SceneShadows, HighLights,
 *  MidTones; desaturation 0, colorize 1, DisplayGamma 2.2 (identity) */
export const REMAP = { shadows: [0, 0, -0.003], highLights: 0.8, midTones: 1.3 } as const;

/** The bloom (PP-7..9): its soft knee on the max channel from Bloom_Threshold 2 (full at 4), the gather's taps (+-1.16
 *  half-res texels), BloomScale, its screen-blend threshold, the kernel base 32 and its sizes' scales (small, medium,
 *  large, clamped to [0, 1], [0.25, 2], [1, 8]) and weights (0.125, 0.375, 1, normalised) */
export const BLOOM = (() => {
  const base = 32;
  const sizes = [Math.min(Math.max(0.25, 0), 1), Math.min(Math.max(2, 0.25), 2), Math.min(Math.max(4, 1), 8)].map((k) => base * k);
  const raw = [0.125, 0.375, 1];
  const sum = raw.reduce((s, w) => s + w, 0);
  return { threshold: 2, knee: 0.5, tap: 1.16, scale: 1, screenBlend: 10, sizes, weights: raw.map((w) => w / sum) };
})();

/** The depth of field (PP-10): the focus and inner radius 16384, falloff 4, near 0, far 0.6, the minimum blur 0.25,
 *  its kernel size 4 */
export const DOF = { focus: 16384, inner: 16384, falloff: 4, maxNear: 0, maxFar: 0.6, minBlur: 0.25, kernel: 4 } as const;

/** MaxFilterBlurSampleCount (BaseSystemSettings.ini): the blurs' taps a side, less one */
export const MAX_FILTER_SAMPLES = 16;

/** The tone map, per channel, linear in, display out (PP-4) */
export function tonemap(x: number): number {
  const { a, b, z, w, t } = TONEMAP;
  const c = Math.min(Math.max(x, 0), 65503);
  const r = (b * c) / Math.abs(c + a);
  const g = (w * c) ** (1 / 2.2);
  const p = g + Math.min(Math.max((c - z) * 10000, 0), 1) * (r - g);
  return Math.min(Math.max(p + t * (r - p), 0), 1);
}

/** The remap's 16 nodes for a channel before storage (PP-5, §5.6: at g = i / 15, display space): sat(g - shadows) /
 *  highLights, to the midTones' power (over 1 from node 12) */
export function unclippedNodes(channel: 0 | 1 | 2): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const c = Math.min(Math.max(i / 15 - REMAP.shadows[channel], 0), 1) / REMAP.highLights;
    return Math.max(c, 1e-8) ** REMAP.midTones;
  });
}

/** The nodes as the LUT stores them: the camera's fade folded in (times 1 - fade), then clipped to 1 (an 8-bit LUT:
 *  §5.6; RV-159: the fade before the clip) */
export function remapNodes(channel: 0 | 1 | 2, fade = 0): number[] {
  return unclippedNodes(channel).map((v) => Math.min(v * (1 - fade), 1));
}

/** The remap of a display value (the LUT: per channel, linear between its 16 nodes), with the camera's fade */
export function remap(d: number, channel: 0 | 1 | 2, fade = 0): number {
  const nodes = remapNodes(channel, fade);
  const x = Math.min(Math.max(d, 0), 1) * 15;
  const i = Math.min(Math.floor(x), 14);
  return (nodes[i] ?? 0) + ((nodes[i + 1] ?? 0) - (nodes[i] ?? 0)) * (x - i);
}

/** Linear scene colour to the display (the tone map, then the remap; no bloom, no depth of field), with the camera's
 *  fade (0 clear .. 1 black) */
export function display(rgb: readonly [number, number, number], fade = 0): [number, number, number] {
  return [remap(tonemap(rgb[0]), 0, fade), remap(tonemap(rgb[1]), 1, fade), remap(tonemap(rgb[2]), 2, fade)];
}

/** The depth of field's blur amount at linear view depth `d` (PP-10, §6) */
export function dofBlur(d: number): number {
  const t = Math.min(Math.max(Math.abs(d - DOF.focus) / DOF.inner, 0), 1) ** DOF.falloff;
  return Math.max(Math.min(t, d < DOF.focus ? DOF.maxNear : DOF.maxFar), DOF.minBlur);
}

/** cvtss2si: round half to even */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1;
}

/** A Gaussian of variance `r` texels^2 as the game's bilinear taps (0x140a6c840, §5.4): pairs (i, i + 1) from -K to K
 *  merged into one offset each, the weights normalised; none for r <= 0.1 */
export function gaussTaps(r: number): { offsets: number[]; weights: number[] } {
  if (r <= 0.1) return { offsets: [], weights: [] };
  const n = Math.min(MAX_FILTER_SAMPLES, 16) - 1;
  const v = Math.min(Math.max(r, 1e-5), n);
  const k = Math.min(-(roundHalfEven(-0.5 - 2 * v) >> 1), n);
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = -k; i <= k; i += 2) {
    const w0 = Math.exp(-(i * i) / (2 * v));
    const w1 = i === k ? 0 : Math.exp(-((i + 1) * (i + 1)) / (2 * v));
    offsets.push(i + w1 / (w0 + w1));
    weights.push(w0 + w1);
  }
  const sum = weights.reduce((s, w) => s + w, 0);
  return { offsets, weights: weights.map((w) => w / sum) };
}

/** The blurs' variances at a view `width` (bScaleEffectsWithViewSize: s = width / 1280; each in its own buffer's
 *  texels^2): the depth of field's (a quarter res), and the bloom's small (quarter), medium (an eighth), large (a
 *  sixteenth) */
export function blurRadii(width: number): { dof: number; small: number; medium: number; large: number } {
  const s = width / 1280;
  const [sm = 8, md = 64, lg = 128] = BLOOM.sizes;
  return { dof: (DOF.kernel / 4) * s * s, small: (sm / 4) * s * s, medium: (((md - sm) * 0.5) / 4) * s * s, large: (((lg - sm) * 0.25) / 4) * s * s };
}

/** The tone map in GLSL (TONEMAP's constants) */
export const TONEMAP_GLSL = /* glsl */ `
vec3 carballTonemap(vec3 x) {
  x = clamp(x, 0.0, 65503.0);
  vec3 R = ${TONEMAP.b.toFixed(6)} * x / abs(x + ${TONEMAP.a.toFixed(6)});
  vec3 G = pow(${TONEMAP.w.toFixed(6)} * x, vec3(1.0 / 2.2));
  vec3 P = G + clamp((x - ${TONEMAP.z.toFixed(6)}) * 10000.0, 0.0, 1.0) * (R - G);
  return clamp(P + ${TONEMAP.t.toFixed(6)} * (R - P), 0.0, 1.0);
}
`;

/** The remap in GLSL with the camera's fade (remapNodes): needs uniforms remapR[16], remapG[16], remapB[16] (the
 *  unclipped nodes) */
export const REMAP_GLSL = /* glsl */ `
float carballRemap1(float d, float nodes[16], float keep) {
  float x = clamp(d, 0.0, 1.0) * 15.0;
  int i = int(min(floor(x), 14.0));
  return mix(min(nodes[i] * keep, 1.0), min(nodes[i + 1] * keep, 1.0), x - float(i));
}
vec3 carballRemap(vec3 d, float fade) {
  float keep = 1.0 - fade;
  return vec3(carballRemap1(d.r, remapR, keep), carballRemap1(d.g, remapG, keep), carballRemap1(d.b, remapB, keep));
}
`;

/** dofBlur in GLSL */
export const DOF_GLSL = /* glsl */ `
float dofBlur(float d) {
  float t = pow(clamp(abs(d - ${DOF.focus.toFixed(1)}) / ${DOF.inner.toFixed(1)}, 0.0, 1.0), ${DOF.falloff.toFixed(1)});
  return max(min(t, d < ${DOF.focus.toFixed(1)} ? ${DOF.maxNear.toFixed(3)} : ${DOF.maxFar.toFixed(3)}), ${DOF.minBlur.toFixed(3)});
}
`;

/** The video options that change the chain (PP-16: High, the default, has both on) */
export interface PostOptions {
  readonly bloom: boolean;
  readonly depthOfField: boolean;
}

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** The scene at half res: a 2x2 box, its linear view depth in alpha (the sky's 65504) */
const downsampleSceneFragment = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;
float viewDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x;
  return z >= 0.999999 ? 65504.0 : -perspectiveDepthToViewZ(z, cameraNear, cameraFar);
}
void main() {
  vec2 o = 0.5 * texel;
  vec2 t0 = vUv + vec2(-o.x, -o.y), t1 = vUv + vec2(o.x, -o.y), t2 = vUv + vec2(-o.x, o.y), t3 = vUv + vec2(o.x, o.y);
  vec3 c = 0.25 * (texture2D(tColor, t0).rgb + texture2D(tColor, t1).rgb + texture2D(tColor, t2).rgb + texture2D(tColor, t3).rgb);
  float d = 0.25 * (viewDepth(t0) + viewDepth(t1) + viewDepth(t2) + viewDepth(t3));
  gl_FragColor = vec4(c, d);
}
`;

/** The depth of field's gather at quarter res: a 2x2 box of the half-res scene, its colour times its blur amount */
const dofGatherFragment = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 texel;
varying vec2 vUv;
${DOF_GLSL}
void main() {
  vec2 o = 0.5 * texel;
  vec4 s = 0.25 * (texture2D(tHalf, vUv + vec2(-o.x, -o.y)) + texture2D(tHalf, vUv + vec2(o.x, -o.y)) + texture2D(tHalf, vUv + vec2(-o.x, o.y)) + texture2D(tHalf, vUv + vec2(o.x, o.y)));
  float b = dofBlur(s.a);
  gl_FragColor = vec4(s.rgb * b, b);
}
`;

/** The half-res composite (FUberHalfResPixelShader0010): the half-res scene and the blurred layer by the blur amount;
 *  alpha the full-res scene's share */
const halfCompositeFragment = /* glsl */ `
uniform sampler2D tHalf;
uniform sampler2D tDof;
varying vec2 vUv;
${DOF_GLSL}
void main() {
  vec4 s = texture2D(tHalf, vUv);
  vec4 d = texture2D(tDof, vUv);
  float w = 1.0 - dofBlur(s.a);
  gl_FragColor = vec4((s.rgb * w + d.rgb) / (d.a + w), w);
}
`;

/** The bloom's gather at quarter res: 4 taps of the half-res layer, each times its soft knee on the max channel */
const bloomGatherFragment = /* glsl */ `
uniform sampler2D tHalf;
uniform vec2 halfTexel;
varying vec2 vUv;
vec3 tap(vec2 uv) {
  vec3 c = texture2D(tHalf, uv).rgb;
  float w = clamp((max(c.r, max(c.g, c.b)) - ${BLOOM.threshold.toFixed(1)}) * ${BLOOM.knee.toFixed(2)}, 0.0, 1.0);
  return c * w;
}
void main() {
  vec2 o = ${BLOOM.tap.toFixed(2)} * halfTexel;
  vec3 acc = tap(vUv + vec2(-o.x, -o.y)) + tap(vUv + vec2(o.x, -o.y)) + tap(vUv + vec2(-o.x, o.y)) + tap(vUv + vec2(o.x, o.y));
  gl_FragColor = vec4(acc * 0.25 * ${BLOOM.scale.toFixed(2)}, 0.0);
}
`;

/** A 2x2 box downsample */
const boxFragment = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 o = 0.5 * texel;
  gl_FragColor = 0.25 * (texture2D(tSource, vUv + vec2(-o.x, -o.y)) + texture2D(tSource, vUv + vec2(o.x, -o.y)) + texture2D(tSource, vUv + vec2(-o.x, o.y)) + texture2D(tSource, vUv + vec2(o.x, o.y)));
}
`;

/** One direction of a Gaussian (gaussTaps' offsets in texels along `direction`); a tap outside the view counts as black
 *  (no GLSL built-in names: RV-158) */
const blurFragment = /* glsl */ `
uniform sampler2D tSource;
uniform vec2 direction;
uniform float offsets[16];
uniform float weights[16];
uniform int count;
varying vec2 vUv;
void main() {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 16; i++) {
    if (i >= count) break;
    vec2 uv = vUv + direction * offsets[i];
    if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) acc += weights[i] * texture2D(tSource, uv);
  }
  gl_FragColor = acc;
}
`;

/** The bloom's sizes combined at quarter res */
const bloomCombineFragment = /* glsl */ `
uniform sampler2D tSmall;
uniform sampler2D tMedium;
uniform sampler2D tLarge;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(${(BLOOM.weights[0] ?? 0).toFixed(6)} * texture2D(tSmall, vUv).rgb + ${(BLOOM.weights[1] ?? 0).toFixed(6)} * texture2D(tMedium, vUv).rgb
    + ${(BLOOM.weights[2] ?? 0).toFixed(6)} * texture2D(tLarge, vUv).rgb, 0.0);
}
`;

/** The full-res blend (FUberPostProcessBlendPixelShader02000): the soft layer by its share, the bloom added under the
 *  screen-blend factor, the tone map, the remap; the camera's fade through the remap's nodes, before their clip (PP-18,
 *  RV-159) */
const blendFragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tHalf;
uniform sampler2D tBloom;
uniform vec2 halfMin;
uniform vec2 halfMax;
uniform bool useHalf;
uniform bool useBloom;
uniform float fade;
uniform float remapR[16];
uniform float remapG[16];
uniform float remapB[16];
varying vec2 vUv;
${TONEMAP_GLSL}
${REMAP_GLSL}
void main() {
  vec3 S = texture2D(tScene, vUv).rgb;
  vec3 C1 = S;
  if (useHalf) {
    vec4 H = texture2D(tHalf, clamp(vUv, halfMin, halfMax));
    C1 = mix(H.rgb, S, H.a);
  }
  C1 = clamp(C1, 0.0, 65503.0);
  if (useBloom) {
    float k = clamp(${BLOOM.screenBlend.toFixed(1)} * exp2(-3.0 * dot(C1, vec3(0.30, 0.59, 0.11))), 0.0, 1.0);
    C1 += texture2D(tBloom, vUv).rgb * ${BLOOM.scale.toFixed(2)} * k;
  }
  gl_FragColor = vec4(carballRemap(carballTonemap(C1), fade), 1.0);
}
`;

const target = (w: number, h: number, depth = false): WebGLRenderTarget => {
  const t = new WebGLRenderTarget(w, h, { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: depth });
  if (depth) {
    t.depthTexture = new DepthTexture(w, h, FloatType);
    t.depthTexture.minFilter = t.depthTexture.magFilter = NearestFilter;
  }
  return t;
};

/** The chain's targets at one drawing-buffer size */
interface Targets {
  readonly width: number;
  readonly height: number;
  readonly scene: WebGLRenderTarget;
  readonly half: WebGLRenderTarget;
  readonly composite: WebGLRenderTarget;
  readonly dof: [WebGLRenderTarget, WebGLRenderTarget];
  readonly gather: WebGLRenderTarget;
  readonly bloom: [WebGLRenderTarget, WebGLRenderTarget];
  readonly medium: [WebGLRenderTarget, WebGLRenderTarget];
  readonly large: [WebGLRenderTarget, WebGLRenderTarget];
}

/** The post-processing chain on a renderer: `render` draws the scene through it to the canvas */
export class PostProcess {
  readonly #gl: WebGLRenderer;
  readonly #camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly #quad = new Mesh(new PlaneGeometry(2, 2));
  readonly #size = new Vector2();
  #targets: Targets | null = null;
  readonly #materials = {
    downsample: this.#material(downsampleSceneFragment, { tColor: null, tDepth: null, texel: new Vector2(), cameraNear: 1, cameraFar: 1 }),
    dofGather: this.#material(dofGatherFragment, { tHalf: null, texel: new Vector2() }),
    composite: this.#material(halfCompositeFragment, { tHalf: null, tDof: null }),
    gather: this.#material(bloomGatherFragment, { tHalf: null, halfTexel: new Vector2() }),
    box: this.#material(boxFragment, { tSource: null, texel: new Vector2() }),
    blur: this.#material(blurFragment, { tSource: null, direction: new Vector2(), offsets: new Array<number>(16).fill(0), weights: new Array<number>(16).fill(0), count: 0 }),
    combine: this.#material(bloomCombineFragment, { tSmall: null, tMedium: null, tLarge: null }),
    blend: this.#material(blendFragment, {
      tScene: null,
      tHalf: null,
      tBloom: null,
      halfMin: new Vector2(),
      halfMax: new Vector2(1, 1),
      useHalf: true,
      useBloom: true,
      fade: 0,
      remapR: unclippedNodes(0),
      remapG: unclippedNodes(1),
      remapB: unclippedNodes(2),
    }),
  };

  constructor(gl: WebGLRenderer) {
    this.#gl = gl;
    this.#quad.frustumCulled = false;
  }

  #material(fragmentShader: string, uniforms: Record<string, unknown>): ShaderMaterial {
    return new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader,
      uniforms: Object.fromEntries(Object.entries(uniforms).map(([k, value]) => [k, { value }])),
      depthTest: false,
      depthWrite: false,
    });
  }

  #ensureTargets(): Targets {
    this.#gl.getDrawingBufferSize(this.#size);
    const [w, h] = [Math.max(1, this.#size.x), Math.max(1, this.#size.y)];
    if (this.#targets?.width === w && this.#targets.height === h) return this.#targets;
    this.#disposeTargets();
    const at = (k: number): [number, number] => [Math.max(1, Math.ceil(w / k)), Math.max(1, Math.ceil(h / k))];
    const pair = (k: number): [WebGLRenderTarget, WebGLRenderTarget] => [target(...at(k)), target(...at(k))];
    this.#targets = {
      width: w,
      height: h,
      scene: target(w, h, true),
      half: target(...at(2)),
      composite: target(...at(2)),
      dof: pair(4),
      gather: target(...at(4)),
      bloom: pair(4),
      medium: pair(8),
      large: pair(16),
    };
    return this.#targets;
  }

  #disposeTargets(): void {
    const t = this.#targets;
    if (!t) return;
    for (const r of [t.scene, t.half, t.composite, t.gather, ...t.dof, ...t.bloom, ...t.medium, ...t.large]) {
      r.depthTexture?.dispose();
      r.dispose();
    }
    this.#targets = null;
  }

  /** One pass of `material` into `to` (the canvas when null) */
  #pass(material: ShaderMaterial, uniforms: Record<string, unknown>, to: WebGLRenderTarget | null): void {
    for (const [k, v] of Object.entries(uniforms)) {
      const u = material.uniforms[k];
      if (u) u.value = v;
    }
    this.#quad.material = material;
    this.#gl.setRenderTarget(to);
    this.#gl.render(this.#quad, this.#camera);
  }

  /** A separable Gaussian of variance `r` (its buffer's texels^2) from `pair[0]` back into it, via `pair[1]` */
  #blur(pair: [WebGLRenderTarget, WebGLRenderTarget], r: number): void {
    const { offsets, weights } = gaussTaps(r);
    if (offsets.length === 0) return;
    const [a, b] = pair;
    const fill = (v: number[]): number[] => [...v, ...new Array<number>(16 - v.length).fill(0)];
    const common = { offsets: fill(offsets), weights: fill(weights), count: offsets.length };
    this.#pass(this.#materials.blur, { ...common, tSource: a.texture, direction: new Vector2(1 / a.width, 0) }, b);
    this.#pass(this.#materials.blur, { ...common, tSource: b.texture, direction: new Vector2(0, 1 / a.height) }, a);
  }

  #box(from: Texture, fromWidth: number, fromHeight: number, to: WebGLRenderTarget): void {
    this.#pass(this.#materials.box, { tSource: from, texel: new Vector2(1 / fromWidth, 1 / fromHeight) }, to);
  }

  /** The scene through the chain to the canvas; `fade` the camera's fade to black (0..1) */
  render(scene: Scene, camera: PerspectiveCamera, options: PostOptions, fade = 0): void {
    const t = this.#ensureTargets();
    const gl = this.#gl;
    const autoClear = gl.autoClear;
    gl.setRenderTarget(t.scene);
    gl.clear();
    gl.render(scene, camera);
    gl.autoClear = false;
    const radii = blurRadii(t.width);
    // The half-res scene with its depth; the depth of field's layer
    this.#pass(this.#materials.downsample, { tColor: t.scene.texture, tDepth: t.scene.depthTexture, texel: new Vector2(1 / t.width, 1 / t.height), cameraNear: camera.near, cameraFar: camera.far }, t.half);
    let layer: Texture = t.half.texture;
    if (options.depthOfField) {
      this.#pass(this.#materials.dofGather, { tHalf: t.half.texture, texel: new Vector2(1 / t.half.width, 1 / t.half.height) }, t.dof[0]);
      this.#blur(t.dof, radii.dof);
      this.#pass(this.#materials.composite, { tHalf: t.half.texture, tDof: t.dof[0].texture }, t.composite);
      layer = t.composite.texture;
    }
    // The bloom: the gather, the medium and large sizes on smaller copies, combined, blurred with the small kernel
    if (options.bloom) {
      this.#pass(this.#materials.gather, { tHalf: layer, halfTexel: new Vector2(1 / t.half.width, 1 / t.half.height) }, t.gather);
      this.#box(t.gather.texture, t.gather.width, t.gather.height, t.medium[0]);
      this.#blur(t.medium, radii.medium);
      this.#box(t.medium[0].texture, t.medium[0].width, t.medium[0].height, t.large[0]);
      this.#blur(t.large, radii.large);
      this.#pass(this.#materials.combine, { tSmall: t.gather.texture, tMedium: t.medium[0].texture, tLarge: t.large[0].texture }, t.bloom[0]);
      this.#blur(t.bloom, radii.small);
    }
    // The blend, to the canvas (display values: no sRGB encode after it)
    const hw = t.half.width;
    const hh = t.half.height;
    this.#pass(
      this.#materials.blend,
      {
        tScene: t.scene.texture,
        tHalf: t.composite.texture,
        tBloom: t.bloom[0].texture,
        halfMin: new Vector2(0.5 / hw, 0.5 / hh),
        halfMax: new Vector2(1 - 0.5 / hw, 1 - 0.5 / hh),
        useHalf: options.depthOfField,
        useBloom: options.bloom,
        fade: Math.min(Math.max(fade, 0), 1),
      },
      null,
    );
    gl.autoClear = autoClear;
  }

  /** For the GPU tests: the last frame's bloom target (linear, unscaled), its width and height, RGBA floats */
  readBloom(): { width: number; height: number; data: Float32Array } | null {
    const t = this.#targets;
    if (!t) return null;
    const [w, h] = [t.bloom[0].width, t.bloom[0].height];
    // (a half-float target reads as half floats)
    const half = new Uint16Array(w * h * 4);
    this.#gl.readRenderTargetPixels(t.bloom[0], 0, 0, w, h, half);
    return { width: w, height: h, data: Float32Array.from(half, (v) => DataUtils.fromHalfFloat(v)) };
  }

  dispose(): void {
    this.#disposeTargets();
    for (const m of Object.values(this.#materials)) m.dispose();
    this.#quad.geometry.dispose();
  }
}
