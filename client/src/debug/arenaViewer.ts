// A free camera round the arena (?viewer=arena): the arena and its theme, the ball and a car placed anywhere, seen from
// anywhere (inside or out), for comparing it with the game's (screenshots: window.carballArenaViewer.view({eye, target,
// ball, car})). Not part of the game.
import { Quaternion } from "three";
import type { CarConfig } from "../engine/world";
import { type Vec3, normalize, sub, vec3 } from "../math/vec";
import { ArenaView } from "../render/arena";
import { buildCarModel } from "../render/carModel";
import { toThreeVector } from "../render/coords";
import { BallView, TEAM_CAR_COLORS } from "../render/entities";
import type { PostOptions } from "../render/postProcess";
import type { Renderer } from "../render/renderer";
import type { Theme } from "../render/themes/theme";
import { applyShaderQuality } from "../render/shaderQuality";

/** A view: the camera at `eye` looking at `target`, the ball and a car (yaw in radians from +x) placed (game frame). */
export interface ArenaShot {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly ball?: Vec3;
  readonly car?: Vec3 & { readonly yaw: number };
  readonly fov?: number;
  /** The camera's up (the game's frame; straight up if left out): a car camera's on a wall */
  readonly up?: Vec3;
  /** High Quality Shaders on or off for this view (the Video setting: the materials' CARBALL_LQ branches; kept if left
   *  out) */
  readonly highQualityShaders?: boolean;
  /** The ball run from `from` to the shot's ball over `seconds` at 60 frames a second first, its last touch `team`'s
   *  (null: none): its speed trail drawn (VT-10a) */
  readonly trail?: { readonly from: Vec3; readonly seconds: number; readonly team: 0 | 1 | null };
  /** World seconds since the ball exploded: the cage's shockwave then (none if left out) */
  readonly sinceExplosion?: number;
  /** Post-processing (bloom, depth of field) for this view: as the game's settings being compared (kept if left out) */
  readonly post?: PostOptions;
}

/** Shows the arena and returns the view setter */
export function showArenaViewer(renderer: Renderer, theme: Theme, config: CarConfig): { view: (shot: ArenaShot) => void } {
  renderer.scene.background = theme.background;
  renderer.scene.fog = theme.fog;
  const arena = new ArenaView(theme);
  const ball = new BallView();
  const car = buildCarModel(config, TEAM_CAR_COLORS[0], 0);
  renderer.scene.add(arena.root, ball.root, car);
  const view = (shot: ArenaShot): void => {
    const ballAt = toThreeVector(shot.ball ?? vec3(0, 0, -10_000));
    if (shot.trail && shot.ball) {
      const { from, seconds, team } = shot.trail;
      const frames = Math.max(1, Math.round(seconds * 60));
      ball.spawn();
      ball.trailTeam = team;
      for (let k = 0; k <= frames; k++) {
        const f = k / frames;
        ball.fade(false, 1 / 60);
        ball.update(
          toThreeVector(vec3(from.x + (shot.ball.x - from.x) * f, from.y + (shot.ball.y - from.y) * f, from.z + (shot.ball.z - from.z) * f)),
          new Quaternion(),
        );
      }
    }
    ball.update(ballAt, new Quaternion());
    arena.newBall();
    if (shot.sinceExplosion !== undefined) arena.explode();
    arena.update(ballAt, shot.sinceExplosion ?? 0);
    if (shot.post) renderer.postOptions = shot.post;
    if (shot.highQualityShaders !== undefined) applyShaderQuality(renderer.scene, shot.highQualityShaders);
    car.visible = shot.car !== undefined;
    if (shot.car) {
      toThreeVector(shot.car, car.position);
      car.rotation.set(0, -shot.car.yaw, 0); // (about Three's y, up; its z is the game's y: the turn reversed)
    }
    renderer.render({ position: shot.eye, forward: normalize(sub(shot.target, shot.eye)), up: shot.up ?? vec3(0, 0, 1), horizontalFov: shot.fov ?? 90 });
  };
  return { view };
}
