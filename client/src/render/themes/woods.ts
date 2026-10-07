// A mixed forest around a clearing: tall pines and broadleaf trees (thick near the clearing, thinning with distance,
// with glades), bushes, ferns that sway, toadstools, fallen logs and stumps, a signpost where the path leaves the
// clearing, sunbeams slanting through the trees, and pollen drifting in the air. Three.js frame: ground in x/z, y up.
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type InstancedMesh,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { type Area, type Land, free, scatter } from "./nature";
import { seededRandom, valueNoise } from "./random";
import { type Placement, animate, combine, instances, part } from "./shapes";

/** Trees from the edge of the clearing out to `outer` (uu from the arena), on a jittered grid `spacing` apart. */
export function buildForest(land: Land, seed: number, options: { spacing: number; outer: number }): Group {
  const random = seededRandom(seed);
  const glades = valueNoise(seed + 1);
  const mix = valueNoise(seed + 2);
  const edge = valueNoise(seed + 3);
  const pines: (Placement & { tint: Color })[] = [];
  const broadleaves: (Placement & { tint: Color })[] = [];
  const { spacing, outer } = options;
  for (let gx = -outer; gx <= outer; gx += spacing) {
    for (let gz = -outer; gz <= outer; gz += spacing) {
      const x = gx + (random() - 0.5) * spacing * 0.9;
      const z = gz + (random() - 0.5) * spacing * 0.9;
      const fromClearing = land.flatDistance(x, z);
      // A ragged forest edge, a few hundred uu into the rough
      if (fromClearing < 900 + 700 * (edge(x / 2500, z / 2500) * 0.5 + 0.5)) continue;
      if (!free(land, x, z, 250)) continue;
      // Dense near the clearing, thinner far away (where the fog hides it), with glades
      const density = 0.95 - 0.6 * Math.min(1, fromClearing / 16000);
      if (random() > density || glades(x / 6000, z / 6000) > 0.45) continue;
      const pine = mix(x / 5000, z / 5000) + (random() - 0.5) * 0.8 > -0.1;
      const s = (pine ? 0.85 : 0.8) + random() * 0.7;
      (pine ? pines : broadleaves).push({
        position: [x, land.height(x, z) - 20, z],
        rotation: [0, random() * Math.PI * 2, 0],
        scale: [s, s * (0.85 + random() * 0.35), s],
        tint: new Color().setScalar(0.8 + random() * 0.3),
      });
    }
  }
  const pine = combine([
    part(new CylinderGeometry(38, 58, 600, 6), 0x5e4029, { position: [0, 300, 0] }),
    part(new ConeGeometry(440, 950, 8), 0x2d6a37, { position: [0, 800, 0] }),
    part(new ConeGeometry(350, 820, 8), 0x347a3d, { position: [0, 1240, 0] }),
    part(new ConeGeometry(240, 660, 8), 0x3c8743, { position: [0, 1640, 0] }),
  ]);
  const broadleaf = combine([
    part(new CylinderGeometry(55, 80, 800, 6), 0x6b4a2e, { position: [0, 400, 0] }),
    part(new SphereGeometry(470, 7, 5), 0x3f8a37, { position: [0, 1050, 0] }),
    part(new SphereGeometry(380, 7, 5), 0x4a9a3e, { position: [260, 1250, 120] }),
    part(new SphereGeometry(360, 7, 5), 0x448f3a, { position: [-250, 1200, -160] }),
  ]);
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const group = new Group();
  group.add(instances(pine, material, pines), instances(broadleaf, material, broadleaves));
  return group;
}

/** Leafy bushes at the forest's edge. */
export function buildBushes(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  const bush = combine([
    part(new SphereGeometry(110, 7, 5), 0x3e7d38, { position: [0, 70, 0], scale: [1, 0.75, 1] }),
    part(new SphereGeometry(85, 7, 5), 0x4a8d3f, { position: [80, 60, 30], scale: [1, 0.8, 1] }),
    part(new SphereGeometry(80, 7, 5), 0x43853b, { position: [-70, 55, -40], scale: [1, 0.8, 1] }),
  ]);
  const placements = scatter(random, land, area).map(([x, z]): Placement & { tint: Color } => {
    const s = 0.8 + random() * 1.2;
    return {
      position: [x, land.height(x, z) - 10, z],
      rotation: [0, random() * Math.PI * 2, 0],
      scale: [s, s, s],
      tint: new Color().setScalar(0.85 + random() * 0.25),
    };
  });
  return instances(bush, new MeshLambertMaterial({ vertexColors: true, flatShading: true }), placements);
}

/** Ferns: arching fronds in a ring, swaying a little. Returns the mesh and its animation clock. */
export function buildFerns(land: Land, seed: number, area: Area): { mesh: InstancedMesh; time: { value: number } } {
  const random = seededRandom(seed);
  const fronds: BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const frond = new BufferGeometry();
    // An arching leaf: wide in the middle, rising then drooping to the tip (along +z)
    frond.setAttribute(
      "position",
      new Float32BufferAttribute(
        [-5, 0, 0, 5, 0, 0, -22, 55, 60, 5, 0, 0, 22, 55, 60, -22, 55, 60, -22, 55, 60, 22, 55, 60, 0, 30, 150],
        3,
      ),
    );
    frond.computeVertexNormals();
    const placed = part(frond, 0xffffff, { rotation: [0, (i / count) * Math.PI * 2 + random() * 0.5, 0] });
    const colors = placed.getAttribute("color");
    const pos = placed.getAttribute("position");
    for (let v = 0; v < colors.count; v++) {
      const c = new Color(0x2f6b2c).lerp(new Color(0x6fbf55), Math.min(1, pos.getY(v) / 55));
      colors.setXYZ(v, c.r, c.g, c.b);
    }
    fronds.push(placed);
  }
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  const uniforms = animate(
    material,
    /* glsl */ `
      vec3 rooted = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float sway = sin(time * 1.1 + rooted.x * 0.0013 + rooted.z * 0.0009);
      transformed.x += sway * position.y * 0.08;`,
    "",
    {},
  );
  const placements = scatter(random, land, area).map(([x, z]): Placement => {
    const s = 1.2 + random() * 1.3;
    return { position: [x, land.height(x, z) - 4, z], rotation: [0, random() * Math.PI * 2, 0], scale: [s, s, s] };
  });
  return { mesh: instances(combine(fronds), material, placements), time: uniforms.time };
}

/** Toadstools in little rings: red caps with white spots. */
export function buildToadstools(land: Land, seed: number, area: Area): InstancedMesh {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [
    part(new CylinderGeometry(9, 12, 36, 7), 0xf3ead8, { position: [0, 18, 0] }),
    part(new SphereGeometry(30, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0xd8392b, { position: [0, 32, 0], scale: [1, 0.62, 1] }),
  ];
  // Spots on the cap's surface (a squashed hemisphere: radius 30, 18.6 high, from y = 32)
  const capY = (r: number): number => 32 + 18.6 * Math.sqrt(1 - (r / 30) ** 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const r = i % 2 === 0 ? 14 : 21;
    parts.push(part(new SphereGeometry(4.5, 5, 4), 0xffffff, { position: [Math.cos(a) * r, capY(r), Math.sin(a) * r] }));
  }
  parts.push(part(new SphereGeometry(5, 5, 4), 0xffffff, { position: [0, capY(0), 0] }));
  const placements = scatter(random, land, area).map(([x, z]): Placement => {
    const s = 1.4 + random() * 1.8;
    return {
      position: [x, land.height(x, z) - 2, z],
      rotation: [(random() - 0.5) * 0.25, random() * Math.PI * 2, (random() - 0.5) * 0.25],
      scale: [s, s, s],
    };
  });
  return instances(combine(parts), new MeshLambertMaterial({ vertexColors: true }), placements);
}

/** Fallen logs, stumps and a signpost by the path (one draw call). `signpost`: where, facing the clearing. */
export function buildDeadwood(
  land: Land,
  seed: number,
  area: Area,
  signpost: { readonly x: number; readonly z: number; readonly facing: number },
): Mesh {
  const random = seededRandom(seed);
  const parts: BufferGeometry[] = [];
  scatter(random, land, area).forEach(([x, z], i) => {
    const y = land.height(x, z);
    const yaw = random() * Math.PI;
    if (i % 2 === 0) {
      // A log lying on its side, its cut ends paler
      const length = 500 + random() * 700;
      const radius = 60 + random() * 45;
      // (on its side along x, then turned about y: placements turn about z first, then y)
      const along: [number, number, number] = [0, yaw, Math.PI / 2];
      parts.push(part(new CylinderGeometry(radius, radius * 1.1, length, 9), 0x6b4a2e, { position: [x, y + radius * 0.8, z], rotation: along }));
      parts.push(part(new CylinderGeometry(radius * 0.86, radius * 0.86, length + 4, 9), 0xc9a26b, { position: [x, y + radius * 0.8, z], rotation: along }));
    } else {
      const radius = 70 + random() * 50;
      const height = 70 + random() * 80;
      parts.push(part(new CylinderGeometry(radius, radius * 1.25, height, 9), 0x6b4a2e, { position: [x, y + height / 2 - 10, z] }));
      parts.push(part(new CylinderGeometry(radius * 0.88, radius * 0.88, 4, 9), 0xd4b07a, { position: [x, y + height - 8, z] }));
    }
  });
  // The signpost: a post and a board on a little roof, facing the clearing
  const { x, z, facing } = signpost;
  const y = land.height(x, z);
  const at = (dx: number, dy: number, dz: number): [number, number, number] => [
    x + dx * Math.cos(facing) + dz * Math.sin(facing),
    y + dy,
    z - dx * Math.sin(facing) + dz * Math.cos(facing),
  ];
  parts.push(part(new CylinderGeometry(14, 16, 300, 6), 0x7a5a38, { position: at(0, 150, 0) }));
  parts.push(part(new BoxGeometry(260, 130, 14), 0xc79a5e, { position: at(0, 260, 12), rotation: [0, facing, 0] }));
  parts.push(part(new BoxGeometry(220, 92, 4), 0xe9d6ac, { position: at(0, 260, 21), rotation: [0, facing, 0] }));
  parts.push(part(new BoxGeometry(290, 16, 40), 0x6b4a2e, { position: at(0, 333, 12), rotation: [0, facing, 0] }));
  return new Mesh(combine(parts), new MeshLambertMaterial({ vertexColors: true }));
}

/**
 * Sunbeams slanting down through the trees around the clearing: soft additive shafts along the sun's direction, on
 * the side where they lean away from the arena. One draw call.
 */
export function buildSunbeams(land: Land, seed: number, sunDirection: Vector3, count: number): Mesh {
  const random = seededRandom(seed);
  const axis = sunDirection.clone().normalize();
  const tilt = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
  const parts: BufferGeometry[] = [];
  const outward = new Vector3();
  for (let made = 0, tries = 0; made < count && tries < count * 50; tries++) {
    const angle = random() * Math.PI * 2;
    const x = Math.cos(angle) * (6200 + random() * 3000);
    const z = Math.sin(angle) * (8000 + random() * 3000);
    // Only where the beam leans out, away from the field
    if (outward.set(x, 0, z).normalize().dot(axis) < 0.25 || land.flatDistance(x, z) < 600) continue;
    const length = 3600 + random() * 1500;
    const width = 260 + random() * 420;
    const base = new Vector3(x, land.height(x, z), z);
    const centre = base.clone().addScaledVector(axis, length / 2);
    for (const turn of [0, Math.PI / 2]) {
      // Two crossed planes, so the beam has width from any side
      const plane = new PlaneGeometry(width, length);
      plane.rotateY(turn);
      plane.applyQuaternion(tilt);
      plane.translate(centre.x, centre.y, centre.z);
      parts.push(plane);
    }
    made++;
  }
  const geometry = combine(parts);
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      varying float vDistance;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vec3 toCamera = cameraPosition - world.xyz;
        vDistance = length(toCamera);
        vFacing = abs(dot(normalize(mat3(modelMatrix) * normal), toCamera / vDistance));
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying float vFacing;
      varying float vDistance;
      void main() {
        // Soft at the sides, fading in above the ground and out towards the canopy; and faded where a plane is seen
        // edge on (no hard streaks) or close up (a haze, not a wall of light)
        float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float seen = smoothstep(0.15, 0.7, vFacing) * smoothstep(500.0, 3000.0, vDistance);
        gl_FragColor = vec4(vec3(1.0, 0.95, 0.75) * across * across * along * seen * 0.09, 1.0);
        #include <colorspace_fragment>
      }`,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  return new Mesh(geometry, material);
}

/** Pollen (or spores) drifting in the air: soft specks, slowly wandering. Returns them and their clock. */
export function buildPollen(
  land: Land,
  seed: number,
  options: {
    readonly count: number;
    readonly within: number;
    readonly beyond: (x: number, z: number) => boolean;
    readonly color?: number; // default pale gold
    readonly size?: number; // default 16 uu
    readonly height?: number; // how high above the ground they float, at most (default 1360 uu)
  },
): { points: Points; time: { value: number } } {
  const random = seededRandom(seed);
  const positions: number[] = [];
  while (positions.length < options.count * 3) {
    const x = (random() * 2 - 1) * options.within;
    const z = (random() * 2 - 1) * options.within * 1.25;
    if (!options.beyond(x, z)) continue;
    positions.push(x, land.height(x, z) + 60 + random() * ((options.height ?? 1360) - 60), z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  // A soft round speck
  const size = 32;
  const texels = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot(i + 0.5 - size / 2, j + 0.5 - size / 2) / (size / 2);
      texels.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - r) ** 2)], (j * size + i) * 4);
    }
  }
  const speck = new DataTexture(texels, size, size);
  speck.magFilter = LinearFilter;
  speck.minFilter = LinearFilter;
  speck.needsUpdate = true;
  const material = new PointsMaterial({
    color: options.color ?? 0xfff4c8,
    map: speck,
    size: options.size ?? 16,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
  });
  const uniforms = animate(
    material,
    /* glsl */ `
      transformed.x += sin(time * 0.23 + position.z * 0.004) * 60.0;
      transformed.y += sin(time * 0.31 + position.x * 0.005) * 40.0;
      transformed.z += cos(time * 0.19 + position.x * 0.003) * 60.0;`,
    "",
    {},
  );
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return { points, time: uniforms.time };
}
