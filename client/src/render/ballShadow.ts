// The ball's shadow on lit surfaces besides the flat floor (whose marker is its own mesh: src/render/entities.ts):
// the trim on the wall's foot and the goals' floors. As the game's: straight below the ball, a dark disc the ball's
// size with a light rim, fainter the higher the ball is over the surface (the floor marker's look: markerFade).
import type { MeshStandardMaterial, Vector3 } from "three";

const SHADOW = /* glsl */ `
{
  float r = length(vShadowWorld.xz - shadowBall.xz) / shadowRadius; // 1 at the ball's radius
  float above = step(vShadowWorld.y, shadowBall.y);
  float height = max(0.0, shadowBall.y - shadowRadius - vShadowWorld.y);
  float fade = max(0.45, 1.0 - height / 3000.0) * above;
  float core = (1.0 - smoothstep(0.5, 1.0, r)) * 0.6 * fade;
  // (the rim at least a pixel and a half wide however far away)
  float width = max(0.09, fwidth(r) * 1.5);
  float rim = (1.0 - smoothstep(width * 0.5, width, abs(r - 0.97))) * 0.8 * (0.4 + 0.6 * fade) * above;
  gl_FragColor.rgb = mix(gl_FragColor.rgb * (1.0 - core), vec3(1.0, 0.97, 0.9), rim);
}
`;

/** Adds the ball's shadow to `material`: `ballPosition` (Three.js frame) is read every frame. */
export function addBallShadow(material: MeshStandardMaterial, ballPosition: Vector3, ballRadius: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["shadowBall"] = { value: ballPosition };
    shader.uniforms["shadowRadius"] = { value: ballRadius };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vShadowWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvShadowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vShadowWorld;\nuniform vec3 shadowBall;\nuniform float shadowRadius;")
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${SHADOW}`);
  };
  material.customProgramCacheKey = () => "ballShadow";
}
