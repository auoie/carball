// The game's translucent order (SUR-32, TRN1): priority first, then the view-space depth of the bounds origin, farthest
// first, behind the camera last; the true depth for a sprite drawn nearer than it is.
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Scene, ShaderMaterial, Vector3, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { PRIORITY, type SortItem, drawnNearer, gameTranslucentSort, sortFor, useGameTranslucentSort, viewDepth, withTrueDepth } from "./translucentSort";

/** A camera at the origin looking down -z (Three's), and a box whose geometry sits at `at` (its mesh at the origin:
 *  the bounds origin is the geometry's, not the object's place) */
const camera = new PerspectiveCamera(90, 1, 1, 40000);
camera.updateMatrixWorld(true);
const boxAt = (at: [number, number, number], renderOrder = 0): Mesh => {
  const mesh = new Mesh(new BoxGeometry(10, 10, 10).translate(...at));
  mesh.renderOrder = renderOrder;
  mesh.updateMatrixWorld(true);
  return mesh;
};
const item = (mesh: Mesh, id: number): SortItem => ({ id, object: mesh, groupOrder: 0, renderOrder: mesh.renderOrder });
const order = (meshes: Mesh[]): number[] =>
  meshes
    .map(item)
    .sort(gameTranslucentSort)
    .map((i) => i.id);

describe("the game's translucent order (TRN1)", () => {
  it("the priorities as the game's: the big hotspots first, then the FogCylinder, the fog sheets, the canopy, the fog bowl ... the team hotspots last", () => {
    const P = PRIORITY;
    const chain = [P.bigHotspot, P.fogCylinder, P.bigFogSheet, P.canopy, P.fogBowl, P.lowFogSheet, P.haze, P.base, P.teamHotspot];
    expect(chain).toEqual([-16, -14, -10, -9, -8, -5, -4, 0, 4]);
    expect([P.glassSupports, P.flares]).toEqual([P.fogBowl, P.haze]);
  });

  it("within a priority, farthest first by the bounds origin's view depth (the geometry's centre, not the object's place)", () => {
    sortFor(camera);
    const [near, far] = [boxAt([0, 0, -100]), boxAt([0, 0, -5000])];
    expect(viewDepth(far)).toBeCloseTo(5000, 6);
    expect(order([near, far])).toEqual([1, 0]);
  });

  it("the priority before the depth", () => {
    sortFor(camera);
    expect(order([boxAt([0, 0, -100], PRIORITY.bigHotspot), boxAt([0, 0, -5000], PRIORITY.haze)])).toEqual([0, 1]);
  });

  it("an origin behind the camera nearest of all (drawn last), however far behind: its view depth, not a projected z", () => {
    sortFor(camera);
    const [ahead, behind] = [boxAt([0, 0, -20]), boxAt([0, 0, 30000])];
    expect(viewDepth(behind)).toBeLessThan(0);
    expect(order([behind, ahead])).toEqual([1, 0]);
  });

  it("each view sorted for its own camera: the scene's camera set before the render, the renderer given the sort", () => {
    const scene = new Scene();
    let sort: unknown = null;
    const gl = { setTransparentSort: (f: unknown) => (sort = f) } as unknown as WebGLRenderer;
    useGameTranslucentSort(gl, scene);
    expect(sort).toBe(gameTranslucentSort);
    const turned = new PerspectiveCamera(90, 1, 1, 40000);
    turned.lookAt(0, 0, 1); // (now looking down +z)
    turned.updateMatrixWorld(true);
    scene.onBeforeRender(gl, scene, turned, new BoxGeometry(), new ShaderMaterial(), new Group());
    expect(viewDepth(boxAt([0, 0, 700]))).toBeCloseTo(700, 6);
  });

  it("a mesh drawn nearer about each view's camera (RV-198): each vertex at k of its true distance from that camera, along its true direction; never culled by its last view", () => {
    const mesh = boxAt([0, 0, -30000]);
    const placer = drawnNearer(mesh, 0.25, new Vector3(0, 928, 0));
    expect(mesh.frustumCulled).toBe(false);
    for (const eye of [new Vector3(0, 928, 0), new Vector3(3000, 200, -4000)]) {
      const cam = new PerspectiveCamera(90, 1, 1, 40000);
      cam.position.copy(eye);
      cam.updateMatrixWorld(true);
      mesh.onBeforeRender(null as never, new Scene(), cam, mesh.geometry, mesh.material as ShaderMaterial, new Group());
      const drawn = new Vector3(0, 0, -30000).applyMatrix4(placer.matrixWorld);
      const want = eye.clone().add(new Vector3(0, 0, -30000).sub(eye).multiplyScalar(0.25));
      expect(drawn.distanceTo(want)).toBeLessThan(1e-6 * 30000);
    }
  });

  it("a sprite drawn nearer than it is: its fragments' depth as at its true place, scaled back out from the point it's placed toward, past the far plane just short of it", () => {
    const material = withTrueDepth(
      new ShaderMaterial({ vertexShader: "void main() { gl_Position = vec4(0.0); }", fragmentShader: "void main() { gl_FragColor = vec4(1.0); }" }),
      3.5,
      [0, 928, 0],
    );
    expect(material.vertexShader).toContain(
      "vTrueClip = projectionMatrix * viewMatrix * vec4(vec3(0.000, 928.000, 0.000) + (carballWorld - vec3(0.000, 928.000, 0.000)) * 3.500000, 1.0);",
    );
    expect(material.fragmentShader).toContain("gl_FragDepth = min(0.5 * vTrueClip.z / vTrueClip.w + 0.5, 0.999999762);");
    // (the old mains still run first)
    expect(material.fragmentShader.indexOf("void carballTrueDepthMain()")).toBeLessThan(material.fragmentShader.indexOf("void main()"));
    expect(material.userData["trueDepth"]).toBe(3.5);
  });
});
