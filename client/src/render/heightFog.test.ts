// The height fog against the spec's values (notes/arena-surroundings.md FOG-5, 7, 13, 14), and how materials take it
// (FOG-10).
import { AdditiveBlending, type Blending, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, PerspectiveCamera, PlaneGeometry, ShaderMaterial } from "three";
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

describe("the capture's sky bands (FOG-13 T1, sky only: RV-193)", () => {
  it("each band's F and added luminance within 0.01 of T1's, each direction capped along its cube face's axis", () => {
    const t1: [number, number, number, number][] = [
      [0, 3, 0.15, 0.091],
      [3, 6, 0.183, 0.086],
      [6, 10, 0.225, 0.081],
      [10, 15, 0.276, 0.074],
      [15, 20, 0.33, 0.067],
      [20, 25, 0.378, 0.061],
      [25, 30, 0.419, 0.056],
      [30, 40, 0.47, 0.05],
      [40, 50, 0.531, 0.043],
      [50, 65, 0.602, 0.035],
      [65, 90, 0.656, 0.03],
    ];
    const cd = fogCd(927.9998);
    for (const [lo, hi, wantF, wantLum] of t1) {
      let [w, F, lum] = [0, 0, 0];
      for (let el = lo + 0.25; el < hi; el += 0.5) {
        for (let az = 0; az < 360; az += 2) {
          const d = dir(az, el);
          // (the face: its axis the direction's largest component)
          const k = d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)));
          const axis: [number, number, number] = [0, 0, 0];
          axis[k] = Math.sign(d[k] ?? 1);
          const fog = heightFog(opaqueDelta(skyDelta(d), axis, CUBE_FOG_CAP), cd);
          const c = Math.cos(el * deg);
          w += c;
          F += fog.F * c;
          lum += (0.3 * fog.add[0] + 0.59 * fog.add[1] + 0.11 * fog.add[2]) * c;
        }
      }
      expect(Math.abs(F / w - wantF), `el ${String(lo)}-${String(hi)} F ${(F / w).toFixed(3)}`).toBeLessThan(0.01);
      expect(Math.abs(lum / w - wantLum), `el ${String(lo)}-${String(hi)} add ${(lum / w).toFixed(3)}`).toBeLessThan(0.01);
    }
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
    const translucent = withHeightFog(shader(true), "translucent", { distance: 25000 });
    expect(translucent.vertexShader).toContain("vFog = rlHeightFog(normalize(vFogWorld - uFogCam) * 25000.000)");
    // (placed at a fraction of its distance from a point: its true vertices, RV-188)
    expect(withHeightFog(shader(true), "translucent", { scale: 4, about: [0, 928, 0] }).vertexShader).toContain("vec3(0.0000000, 928.00000, 0.0000000) + (vFogWorld - vec3(0.0000000, 928.00000, 0.0000000)) * 4.0000000 - uFogCam");
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

describe("the fog wherever it's drawn (RV-187, 190)", () => {
  it("a shader's early return can't skip it: its main renamed and called, the fog after (RV-190)", () => {
    const early = new ShaderMaterial({
      vertexShader: "void main() { gl_Position = vec4(position, 1.0); }",
      fragmentShader: "void main() { if (gl_FragCoord.x > 1.0) { gl_FragColor = vec4(1.0); return; } gl_FragColor = vec4(0.5); }",
    });
    const fragment = withHeightFog(early, "opaque").fragmentShader;
    expect(fragment).toContain("void rlFragmentMain()");
    const main = fragment.slice(fragment.lastIndexOf("void main()"));
    expect(main.indexOf("rlFragmentMain();")).toBeLessThan(main.indexOf("rlFog.a + rlFog.rgb"));
  });

  it("built-in materials too, at their compile (the arena's, the cars': RV-187)", () => {
    const basic = withHeightFog(new MeshBasicMaterial(), "opaque");
    const shader = { vertexShader: "void main() { gl_Position = vec4(position, 1.0); }", fragmentShader: "void main() { gl_FragColor = vec4(1.0); }", uniforms: {} as Record<string, unknown> };
    basic.onBeforeCompile(shader as never, null as never);
    expect(shader.fragmentShader).toContain("rlHeightFog(rlOpaqueDelta(vFogWorld))");
    expect(shader.uniforms["uFogCd"]).toBe(HEIGHT_FOG_UNIFORMS.uFogCd);
    expect(basic.customProgramCacheKey()).toContain("rlHeightFog:opaque");
  });

  it("the arena's far corner from a corner camera fogged as the game's: F 0.784 (12.9k off, from z 150)", () => {
    // (from (-3900, -5000, 150) to the field's corner (4096, 5120, 0); Three's axes)
    expect(heightFog([4096 + 3900, -150, 5120 + 5000], fogCd(150)).F).toBeCloseTo(0.784, 2);
  });
  it("built-in materials keep their own programs once fogged: the key from their onBeforeCompile as it was, or their own key (RV-209)", () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    b.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\n// b");
    };
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    withHeightFog(a, "opaque");
    withHeightFog(b, "opaque");
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    const c = new MeshStandardMaterial();
    c.customProgramCacheKey = () => "own";
    withHeightFog(c, "opaque");
    expect(c.customProgramCacheKey()).toMatch(/^own\|rlHeightFog:opaque/);
  });
});
