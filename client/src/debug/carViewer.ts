// A turntable for the car model (?viewer=car): the model alone under plain lights, seen from a chosen angle, for
// comparing it with the game's (screenshots: window.carballCarViewer.view(azimuth, elevation, distance)). Not part of the
// game.
import { AmbientLight, Color, DirectionalLight } from "three";
import type { CarConfig } from "../engine/world";
import { normalize, sub, vec3 } from "../math/vec";
import { buildCarModel } from "../render/carModel";
import type { Renderer } from "../render/renderer";

/** Shows the model and returns the view setter: azimuth from the car's front (degrees, towards its right), elevation
 *  above the horizon (degrees), distance from its centre (uu). */
export function showCarViewer(
  renderer: Renderer,
  config: CarConfig,
  paint: Color,
  team = 0,
  car = 0,
): (azimuth: number, elevation: number, distance?: number) => void {
  renderer.scene.background = new Color(0x8a9099);
  renderer.scene.add(new AmbientLight(0xffffff, 0.9));
  const sun = new DirectionalLight(0xffffff, 2.4);
  sun.position.set(300, 500, 200);
  renderer.scene.add(sun);
  renderer.scene.add(buildCarModel(config, paint, team, car));
  const target = vec3(0, 0, 8);
  return (azimuth, elevation, distance = 240) => {
    const a = (azimuth * Math.PI) / 180;
    const e = (elevation * Math.PI) / 180;
    // (the game's frame: x forward, y right, z up; the model sits at the origin facing +x)
    const position = vec3(Math.cos(a) * Math.cos(e) * distance, Math.sin(a) * Math.cos(e) * distance, target.z + Math.sin(e) * distance);
    renderer.render({ position, forward: normalize(sub(target, position)), up: vec3(0, 0, 1), horizontalFov: 50 });
  };
}
