// The supersonic look, as the game's (notes/visual-timing.md VT-7): a short white streak from each rear wheel that
// touches the ground while the car is supersonic (the game's trail actors sit on the rear wheels only, each active by
// SetWheelEffectActive: contact, supersonic and the direction rule), a ribbon living 0.1 s, so it stops at once in
// the air. World space (Three.js frame); fed the wheels' contact points every frame.
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Vector3 } from "three";

/** How long a point of the trail lasts (SS_Default's ribbons: 0.1 s) */
export const TRAIL_SECONDS = 0.1;
/** At most this many points a ribbon (the game's 100) */
const MAX_SAMPLES = 100;
const WIDTH = 13; // at the head (uu)

const vertexShader = /* glsl */ `
attribute vec3 direction; // along the trail at this point
attribute float side; // -1 or 1: which edge of the ribbon
attribute float life; // 1 at the head, 0 at the tail
uniform float width;
varying float vLife;
varying float vEdge;
void main() {
  // A ribbon turned to face the camera, so it shows from behind as well as from the side
  vec3 toCamera = normalize(cameraPosition - position);
  vec3 across = cross(direction, toCamera);
  float l = length(across);
  across = l > 1e-4 ? across / l : vec3(0.0, 1.0, 0.0);
  vec3 world = position + across * side * width * (0.25 + 0.75 * life);
  vLife = life;
  vEdge = side;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying float vLife;
varying float vEdge;
void main() {
  // Bright down the middle, soft at the edges, fading towards the tail
  float core = 1.0 - abs(vEdge);
  float glow = core * core * vLife * vLife;
  gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * glow * 0.9, 1.0);
  #include <colorspace_fragment>
}
`;

/** Which rear wheels trail, back left and back right (SetWheelEffectActive's direction rule): with `forward` and `side`
 *  the car's speed along its forward and right axes, a car going mostly straight picks its rear wheels when going
 *  forwards (its front ones reversing, which have no trail); sliding sideways (side speed past 500 and past the forward
 *  speed), the wheel on the side it slides towards (which side the rule picks is our reading of "by the sign"). */
export function trailingRearWheels(forward: number, side: number): readonly [boolean, boolean] {
  if (Math.abs(side) <= 500 || Math.abs(side) <= forward) return forward > -50 ? [true, true] : [false, false];
  return side > 0 ? [false, true] : [true, false];
}

/** One streak: the points it passed through, newest first, as a camera-facing ribbon. */
export class Trail {
  readonly mesh: Mesh;
  readonly #samples: { point: Vector3; age: number }[] = [];
  readonly #positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  readonly #directions = new Float32Array(MAX_SAMPLES * 2 * 3);
  readonly #sides = new Float32Array(MAX_SAMPLES * 2);
  readonly #lives = new Float32Array(MAX_SAMPLES * 2);
  readonly #geometry = new BufferGeometry();

  constructor() {
    const g = this.#geometry;
    g.setAttribute("position", new BufferAttribute(this.#positions, 3));
    g.setAttribute("direction", new BufferAttribute(this.#directions, 3));
    g.setAttribute("side", new BufferAttribute(this.#sides, 1));
    g.setAttribute("life", new BufferAttribute(this.#lives, 1));
    const index: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const [a, b, c, d] = [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 3];
      index.push(a, b, c, b, d, c);
    }
    g.setIndex(index);
    for (let i = 0; i < MAX_SAMPLES; i++) this.#sides.set([-1, 1], i * 2);
    this.mesh = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { width: { value: WIDTH } },
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false; // (its vertices move every frame)
    this.mesh.visible = false;
  }

  /** How many points it has (0: nothing to draw). */
  get length(): number {
    return this.#samples.length;
  }

  /** A frame: `seconds` since the last one; while `active`, the trail grows from `point`; it always fades. */
  update(point: Vector3, active: boolean, seconds: number): void {
    const samples = this.#samples;
    for (const s of samples) s.age += seconds;
    while (samples.length > 0 && (samples.at(-1)?.age ?? 0) > TRAIL_SECONDS) samples.pop();
    // A jump (teleport, reset) breaks the trail rather than drawing a streak across the arena
    if (active && samples[0] && samples[0].point.distanceTo(point) > 400) samples.length = 0;
    if (active) {
      samples.unshift({ point: point.clone(), age: 0 });
      if (samples.length > MAX_SAMPLES) samples.length = MAX_SAMPLES;
    }
    this.#write();
  }

  #write(): void {
    const samples = this.#samples;
    const n = samples.length;
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    const direction = new Vector3();
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      if (!s) continue;
      const toward = samples[Math.min(n - 1, i + 1)]?.point ?? s.point;
      const from = samples[Math.max(0, i - 1)]?.point ?? s.point;
      direction.subVectors(from, toward).normalize();
      // Fades with age and towards the far end of the trail
      const life = Math.max(0, 1 - s.age / TRAIL_SECONDS) * (1 - i / n);
      for (let k = 0; k < 2; k++) {
        const v = i * 2 + k;
        this.#positions.set([s.point.x, s.point.y, s.point.z], v * 3);
        this.#directions.set([direction.x, direction.y, direction.z], v * 3);
        this.#lives[v] = life;
      }
    }
    for (const name of ["position", "direction", "life"]) this.#geometry.getAttribute(name).needsUpdate = true;
    this.#geometry.setDrawRange(0, (n - 1) * 6);
  }

  dispose(): void {
    this.#geometry.dispose();
  }
}
