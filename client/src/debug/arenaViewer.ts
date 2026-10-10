// A free camera round the arena (?viewer=arena): the arena and its theme, the ball and a car placed anywhere, seen from
// anywhere (inside or out), for comparing it with the game's (screenshots: window.rlArenaViewer.view({eye, target,
// ball, car})). Not part of the game.
import { type Object3D, Quaternion } from "three";
import type { CarConfig } from "../engine/world";
import { type Vec3, normalize, sub, vec3 } from "../math/vec";
import { ArenaView } from "../render/arena";
import { buildCarModel } from "../render/carModel";
import { toThreeVector } from "../render/coords";
import { BallView, TEAM_CAR_COLORS } from "../render/entities";
import type { PostOptions } from "../render/postProcess";
import type { Renderer } from "../render/renderer";
import type { Theme } from "../render/themes/theme";

/** A view: the camera at `eye` looking at `target`, the ball and a car (yaw in radians from +x) placed (game frame). */
export interface ArenaShot {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly ball?: Vec3;
  readonly car?: Vec3 & { readonly yaw: number };
  readonly fov?: number;
  /** World seconds since the ball exploded: the cage's shockwave then (none if left out) */
  readonly sinceExplosion?: number;
  /** Post-processing (bloom, depth of field) for this view: as the game's settings being compared (kept if left out) */
  readonly post?: PostOptions;
}

/** Shows the arena and returns the view setter, the arena's reflection captures so far, the last capture's faces
 *  (base64 RGBA, Three's face order; null without a capture: for calibrating it against SUR-35) and a re-capture with
 *  the objects named by some prefixes hidden (what each part brings to the capture) */
export function showArenaViewer(
  renderer: Renderer,
  theme: Theme,
  config: CarConfig,
): {
  view: (shot: ArenaShot) => void;
  captures: () => number;
  cubeFaces: (raw?: boolean) => Promise<string[] | null>;
  recapture: (hide?: readonly string[]) => Promise<number>;
} {
  renderer.scene.background = theme.background;
  renderer.scene.fog = theme.fog;
  // (the theme's height fog, as the game view has it: comparing corner shots needs it, RV-203)
  renderer.heightFog = theme.heightFog ?? false;
  const arena = new ArenaView(theme);
  renderer.beforeNextFrame((gl, scene) => {
    arena.capture(gl, scene);
  });
  const ball = new BallView();
  const car = buildCarModel(config, TEAM_CAR_COLORS[0], 0);
  renderer.scene.add(arena.root, ball.root, car);
  const view = (shot: ArenaShot): void => {
    const ballAt = toThreeVector(shot.ball ?? vec3(0, 0, -10_000));
    ball.update(ballAt, new Quaternion());
    arena.newBall();
    if (shot.sinceExplosion !== undefined) arena.explode();
    arena.update(ballAt, shot.sinceExplosion ?? 0);
    if (shot.post) renderer.postOptions = shot.post;
    car.visible = shot.car !== undefined;
    if (shot.car) {
      toThreeVector(shot.car, car.position);
      car.rotation.set(0, -shot.car.yaw, 0); // (about Three's y, up; its z is the game's y: the turn reversed)
    }
    renderer.render({ position: shot.eye, forward: normalize(sub(shot.target, shot.eye)), up: vec3(0, 0, 1), horizontalFov: shot.fov ?? 90 });
  };
  let last: ArenaShot = { eye: vec3(0, -4000, 600), target: vec3(0, 0, 600) };
  const shown = (shot: ArenaShot): void => {
    last = shot;
    view(shot);
  };
  // (each face's linear RGBA floats, little-endian float32 as base64: stored, or as rendered with `raw`)
  const cubeFaces = (raw = false): Promise<string[] | null> =>
    new Promise((resolve) => {
      renderer.beforeNextFrame((gl) => {
        const faces = arena.readCapture(gl, raw);
        resolve(faces ? faces.map((f) => btoa(Array.from(new Uint8Array(f.buffer), (b) => String.fromCharCode(b)).join(""))) : null);
      });
      view(last);
    });
  // (the objects hidden while it captures, with their children (the capture shows its own group whatever it was), each
  // as it was after; the count of them named)
  const recapture = (hide: readonly string[] = []): Promise<number> =>
    new Promise((resolve) => {
      renderer.beforeNextFrame((gl, scene) => {
        const named: Object3D[] = [];
        // (by name, or by material class: the arena's pieces go unnamed)
        scene.traverse((o) => {
          const material = (o as { material?: unknown }).material;
          const kind = material && !Array.isArray(material) ? material.constructor.name : "";
          if (hide.some((prefix) => o.name.startsWith(prefix) || kind === prefix)) named.push(o);
        });
        const was = new Map<Object3D, boolean>();
        for (const o of named) for (const h of [o, ...o.children]) if (!was.has(h)) was.set(h, h.visible);
        for (const h of was.keys()) h.visible = false;
        arena.capture(gl, scene);
        for (const [h, visible] of was) h.visible = visible;
        resolve(named.length);
      });
      view(last);
    });
  return { view: shown, captures: () => arena.captures, cubeFaces, recapture };
}
