// The arena's reflection capture (AV-3): drawn with only the arena, into the target the materials aren't reading.
import { Group, Scene, type Texture, WebGLCoordinateSystem, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { GRASS_CUBE_AT, GrassCube } from "./grassCube";
import { stadiumTheme } from "./themes/stadium";
import { HOTSPOTS, TEAM_HOTSPOTS } from "./themes/stadiumSurroundings";

/** A stand-in for the WebGL renderer: records what each cube face draws */
function fakeRenderer(scene: Scene): { gl: WebGLRenderer; faces: { target: unknown; visible: string[] }[] } {
  const faces: { target: unknown; visible: string[] }[] = [];
  let target: unknown = null;
  const gl = {
    coordinateSystem: WebGLCoordinateSystem,
    isWebGLRenderer: false,
    reversedDepthBuffer: false,
    autoClear: true,
    xr: { enabled: false },
    getRenderTarget: () => null,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget: (t: unknown) => {
      target = t;
    },
    render: () => {
      faces.push({ target, visible: scene.children.filter((c) => c.visible).map((c) => c.name) });
    },
  };
  return { gl: gl as unknown as WebGLRenderer, faces };
}

describe("the arena's reflection capture (GrassCube)", () => {
  it("six faces from above the centre spot, only the arena drawn; the rest shown again after", () => {
    const scene = new Scene();
    const arena = Object.assign(new Group(), { name: "arena" });
    const car = Object.assign(new Group(), { name: "car" });
    const ball = Object.assign(new Group(), { name: "ball" });
    scene.add(arena, car, ball);
    const cube = new GrassCube();
    const { gl, faces } = fakeRenderer(scene);
    cube.capture(gl, scene, arena);
    expect(faces).toHaveLength(6);
    for (const face of faces) expect(face.visible).toEqual(["arena"]);
    expect([car.visible, ball.visible]).toEqual([true, true]);
    expect(GRASS_CUBE_AT).toEqual({ x: 0, y: 0, z: 928 });
  });

  it("the capture-only hotspots (SUR-33): drawn in each face, hidden again after; the stadium's theme has them", () => {
    const scene = new Scene();
    const arena = Object.assign(new Group(), { name: "arena" });
    const hotspots = Object.assign(new Group(), { name: "hotspots" });
    hotspots.visible = false;
    arena.add(hotspots);
    scene.add(arena);
    const seen: boolean[] = [];
    const { gl } = fakeRenderer(scene);
    const render = gl.render.bind(gl);
    (gl as unknown as { render: (s: Scene) => void }).render = (s: Scene) => {
      seen.push(hotspots.visible);
      render(s, null as never);
    };
    new GrassCube().capture(gl, scene, arena, hotspots);
    expect(seen).toEqual([true, true, true, true, true, true]);
    expect(hotspots.visible).toBe(false);
    const theme = stadiumTheme();
    expect(theme.captureOnly?.visible).toBe(false);
    expect(theme.captureOnly?.children).toHaveLength(HOTSPOTS.length + TEAM_HOTSPOTS.length);
  });

  it("drawn into the target the materials aren't sampling; then they sample it (two in turn)", () => {
    const scene = new Scene();
    const arena = new Group();
    scene.add(arena);
    const cube = new GrassCube();
    const { gl, faces } = fakeRenderer(scene);
    const sampled: Texture[] = [cube.uniform.value];
    for (let k = 0; k < 3; k++) {
      faces.length = 0;
      const before = cube.uniform.value;
      cube.capture(gl, scene, arena);
      const drawn = faces[0]?.target as { texture: Texture } | undefined;
      expect(drawn?.texture).not.toBe(before);
      expect(cube.uniform.value).toBe(drawn?.texture);
      sampled.push(cube.uniform.value);
    }
    expect(new Set(sampled).size).toBe(2);
    expect(cube.captures).toBe(3);
  });

  it("its upper hemisphere's mean, solid-angle weighted (SUR-32's G_env): only the +y face lit, a third", () => {
    const cube = new GrassCube();
    const gl = {
      readRenderTargetPixels: (_t: unknown, _x: number, _y: number, w: number, h: number, out: Uint8Array, face: number) => {
        out.fill(face === 2 ? 255 : 0, 0, w * h * 4);
      },
    } as unknown as WebGLRenderer;
    const [r, g, b] = cube.upperMean(gl);
    expect(r).toBeCloseTo(1 / 3, 2);
    expect(g).toBeCloseTo(1 / 3, 2);
    expect(b).toBeCloseTo(1 / 3, 2);
  });

  it("an environment for the reflective surfaces while capturing: a constant cube, the capture's own after", () => {
    const scene = new Scene();
    const arena = Object.assign(new Group(), { name: "arena" });
    scene.add(arena);
    const cube = new GrassCube();
    const { gl, faces } = fakeRenderer(scene);
    const cleared: unknown[] = [];
    let sampledWhileDrawing: Texture | null = null;
    Object.assign(gl, {
      getClearColor: (c: unknown) => c,
      getClearAlpha: () => 1,
      setClearColor: () => undefined,
      clear: () => cleared.push(faces.length),
      render: () => {
        sampledWhileDrawing ??= cube.uniform.value;
        faces.push({ target: null, visible: [] });
      },
    });
    cube.capture(gl, scene, arena, null, [0.47, 0.49, 0.49]);
    // (six faces cleared to it, the capture drawn sampling it, then the capture's own texture)
    expect(cleared).toHaveLength(6);
    expect(sampledWhileDrawing).not.toBeNull();
    expect(cube.uniform.value).not.toBe(sampledWhileDrawing);
  });
});
