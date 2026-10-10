// The height fog against the spec's values (notes/arena-surroundings.md FOG-5, 7, 13, 14), and how materials take it
// (FOG-10).
import { AdditiveBlending, type Blending, Group, Mesh, NormalBlending, PerspectiveCamera, PlaneGeometry, ShaderMaterial } from "three";
import { describe, expect, it } from "vitest";
import { CUBE_FOG_CAP, HEIGHT_FOG, HEIGHT_FOG_UNIFORMS, fogAll, fogCd, heightFog, opaqueDelta, skyDelta, updateHeightFog, withHeightFog } from "./heightFog";

const deg = Math.PI / 180;
/** A direction at (az, el), three's axes (az = atan2(game y, x)) */
const dir = (az: number, el: number): [number, number, number] => [Math.cos(el * deg) * Math.cos(az * deg), Math.sin(el * deg), Math.cos(el * deg) * Math.sin(az * deg)];

describe("the height fog (FOG-1..15)", () => {
  it("its constants: Cd 1.6890e-4 at the capture, 1.916e-4 at z 17; p from the exe's mixed logs", () => {
    expect(fogCd(927.9998)).toBeCloseTo(1.689e-4, 7);
    expect(fogCd(17)).toBeCloseTo(1.916e-4, 7);
    expect(-0.30103 / Math.log(0.5 - 0.5 * Math.cos(22.5 * deg))).toBeCloseTo(HEIGHT_FOG.p, 6);
    expect(Math.hypot(...HEIGHT_FOG.light)).toBeCloseTo(1, 5);
  });

  it("the orange's weight by angle from the light: 0.47 along it, 0.26 at 22.5, 0.06 at 90; overhead 95 % the opposite colour", () => {
    const L = HEIGHT_FOG.light;
    const t = (cos: number): number => Math.abs(0.5 - 0.499 * cos) ** HEIGHT_FOG.p;
    expect(1 - t(1)).toBeCloseTo(0.47, 2);
    expect(1 - t(Math.cos(22.5 * deg))).toBeCloseTo(0.26, 2);
    expect(1 - t(0)).toBeCloseTo(0.06, 2);
    expect(t(L[1])).toBeCloseTo(0.954, 3);
  });

  it("nothing within 10240 uu; at the cars' height F 0.85 at 12k, 0.59 at 16k, 0.41 at 20k, 0.26 at 25k, the floor 0.1 far off", () => {
    const cd = fogCd(17);
    const F = (d: number): number => heightFog([d, 0, 0], cd).F;
    expect(F(10000)).toBe(1);
    expect(F(12000)).toBeCloseTo(0.85, 2);
    expect(F(16000)).toBeCloseTo(0.59, 2);
    expect(F(20000)).toBeCloseTo(0.41, 2);
    expect(F(25000)).toBeCloseTo(0.26, 2);
    expect(F(60000)).toBeCloseTo(0.1, 6);
  });

  it("the sky at the zenith from the kickoff camera (z 130): F 0.52 (the game's dome's distance)", () => {
    expect(heightFog(skyDelta([0, 1, 0]), fogCd(130)).F).toBeCloseTo(0.52, 2);
  });

  it("in the cube capture, el 65-90 (capped at 31,887 along the top face): the fog adds (0.0259, 0.0307, 0.0348), the sky seen x 0.656", () => {
    const cd = fogCd(927.9998);
    let w = 0;
    let F = 0;
    const add = [0, 0, 0];
    for (let el = 65.25; el < 90; el += 0.5) {
      for (let az = 0; az < 360; az += 2) {
        const c = Math.cos(el * deg);
        const fog = heightFog(opaqueDelta(skyDelta(dir(az, el)), [0, 1, 0], CUBE_FOG_CAP), cd);
        w += c;
        F += fog.F * c;
        fog.add.forEach((v, k) => (add[k] = (add[k] ?? 0) + v * c));
      }
    }
    expect(F / w).toBeCloseTo(0.656, 2);
    [0.0259, 0.0307, 0.0348].forEach((want, k) => {
      expect((add[k] ?? 0) / w).toBeCloseTo(want, 3);
    });
  });
});

describe("the fog in the materials (FOG-10)", () => {
  const shader = (transparent = false, blending: Blending = NormalBlending): ShaderMaterial =>
    new ShaderMaterial({
      vertexShader: "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      transparent,
      blending,
    });

  it("each mode its own application, after the colour; the uniforms shared; once", () => {
    const opaque = withHeightFog(shader(), "opaque");
    expect(opaque.fragmentShader).toContain("rlHeightFog(rlOpaqueDelta(vFogWorld))");
    expect(opaque.fragmentShader.indexOf("gl_FragColor = vec4(1.0)")).toBeLessThan(opaque.fragmentShader.indexOf("rlFog.a + rlFog.rgb"));
    expect(opaque.uniforms["uFogCd"]).toBe(HEIGHT_FOG_UNIFORMS.uFogCd);
    expect(withHeightFog(shader(), "sky").fragmentShader).toContain("rlSkyDelta");
    const translucent = withHeightFog(shader(true), "translucent", 25000);
    expect(translucent.vertexShader).toContain("vFog = rlHeightFog(normalize(vFogWorld - uFogCam) * 25000.000)");
    expect(translucent.fragmentShader).toContain("gl_FragColor.rgb * vFog.a + vFog.rgb");
    expect(withHeightFog(shader(true, AdditiveBlending), "additive").fragmentShader).toContain("gl_FragColor.rgb *= vFog.a");
    const before = translucent.fragmentShader;
    expect(withHeightFog(translucent, "opaque").fragmentShader).toBe(before);
    const none = withHeightFog(shader(), "none");
    expect(none.fragmentShader).not.toContain("rlHeightFog");
  });

  it("fogAll: opaque, translucent or additive by the blending, unless set; the uniforms from the camera drawing", () => {
    const root = new Group();
    const [a, b, c, d] = [shader(), shader(true), shader(true, AdditiveBlending), withHeightFog(shader(), "sky")];
    root.add(...[a, b, c, d].map((m) => new Mesh(new PlaneGeometry(), m)));
    fogAll(root);
    expect([a, b, c, d].map((m) => (m.userData as { heightFog?: string }).heightFog)).toEqual(["opaque", "translucent", "additive", "sky"]);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 17, 0);
    camera.userData["fogCap"] = CUBE_FOG_CAP;
    camera.updateMatrixWorld();
    updateHeightFog(camera, 1);
    expect(HEIGHT_FOG_UNIFORMS.uFogCd.value).toBeCloseTo(fogCd(17), 12);
    expect(HEIGHT_FOG_UNIFORMS.uFogCap.value).toBe(CUBE_FOG_CAP);
    expect(HEIGHT_FOG_UNIFORMS.uFogAxis.value.z).toBeCloseTo(-1, 9);
  });
});
