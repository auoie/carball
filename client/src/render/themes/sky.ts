// A daytime sky: a dome with a gradient from the horizon up, the sun, and drifting clouds (procedural, one draw call).
import { BackSide, type Color, Mesh, ShaderMaterial, SphereGeometry, type Vector3 } from "three";

const vertexShader = /* glsl */ `
varying vec3 vDirection;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDirection = world.xyz - cameraPosition; // (the dome is much bigger than the arena: as seen from the camera)
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunDirection;
uniform float time;
varying vec3 vDirection;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float clouds(vec2 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += noise(p) * amplitude;
    p = p * 2.03 + vec2(1.7, 9.2);
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}

void main() {
  vec3 d = normalize(vDirection);
  float up = d.y;
  vec3 color = mix(horizon, zenith, pow(smoothstep(-0.02, 0.55, up), 0.8));
  // Sun: a bright disc and a soft glow around it
  float toSun = max(dot(d, sunDirection), 0.0);
  color += vec3(1.0, 0.94, 0.8) * (smoothstep(0.9993, 0.9996, toSun) * 3.0 + pow(toSun, 24.0) * 0.35);
  // Clouds on a layer overhead, drifting; thinning towards the horizon
  if (up > 0.01) {
    vec2 uv = d.xz / (up + 0.12) * 1.6 + vec2(time * 0.012, time * 0.005);
    float cover = smoothstep(0.52, 0.78, clouds(uv)) * smoothstep(0.01, 0.25, up);
    float shade = 0.82 + 0.18 * smoothstep(0.5, 0.9, clouds(uv * 1.7 + 3.1));
    color = mix(color, vec3(shade), cover * 0.92);
  }
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  readonly mesh: Mesh;
  readonly #material: ShaderMaterial;

  constructor(options: { zenith: Color; horizon: Color; sunDirection: Vector3; radius: number }) {
    this.#material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        zenith: { value: options.zenith },
        horizon: { value: options.horizon },
        sunDirection: { value: options.sunDirection.clone().normalize() },
        time: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(options.radius, 32, 16), this.#material);
    this.mesh.renderOrder = -1; // behind everything
    this.mesh.frustumCulled = false;
  }

  update(seconds: number): void {
    const time = this.#material.uniforms["time"];
    if (time) time.value = seconds;
  }
}
