// A free camera round the arena (?viewer=arena): the arena and its theme, the ball and a car placed anywhere, seen from
// anywhere (inside or out), for comparing it with the game's (screenshots: window.rlArenaViewer.view({eye, target,
// ball, car})). Not part of the game.
import { Quaternion } from "three";
import type { CarConfig } from "../engine/world";
import { type Vec3, normalize, sub, vec3 } from "../math/vec";
import { ArenaView } from "../render/arena";
import { buildCarModel } from "../render/carModel";
import { toThreeVector } from "../render/coords";
import { BallView, TEAM_CAR_COLORS } from "../render/entities";
import type { Renderer } from "../render/renderer";
import type { Theme } from "../render/themes/theme";

/** A view: the camera at `eye` looking at `target`, the ball and a car (yaw in radians from +x) placed (game frame). */
export interface ArenaShot {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly ball?: Vec3;
  readonly car?: Vec3 & { readonly yaw: number };
  readonly fov?: number;
}

/** Shows the arena and returns the view setter. */
export function showArenaViewer(renderer: Renderer, theme: Theme, config: CarConfig): (shot: ArenaShot) => void {
  renderer.scene.background = theme.background;
  renderer.scene.fog = theme.fog;
  const arena = new ArenaView(theme);
  const ball = new BallView();
  const car = buildCarModel(config, TEAM_CAR_COLORS[0], 0);
  renderer.scene.add(arena.root, ball.root, car);
  return (shot) => {
    const ballAt = toThreeVector(shot.ball ?? vec3(0, 0, -10_000));
    ball.update(ballAt, new Quaternion());
    arena.update(ballAt, 0);
    car.visible = shot.car !== undefined;
    if (shot.car) {
      toThreeVector(shot.car, car.position);
      car.rotation.set(0, -shot.car.yaw, 0); // (about Three's y, up; its z is the game's y: the turn reversed)
    }
    renderer.render({ position: shot.eye, forward: normalize(sub(shot.target, shot.eye)), up: vec3(0, 0, 1), horizontalFov: shot.fov ?? 90 });
  };
}
