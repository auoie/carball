// Unreal's interpolation helpers, which Rocket League's camera rates are written for.
import { type Vec3, add, dot, scale, sub } from "../math/vec";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** FMath::FInterpTo: move a fraction (dt * speed, at most all) of the remaining distance. */
export function fInterpTo(current: number, target: number, dt: number, speed: number): number {
  if (speed <= 0) return target;
  const dist = target - current;
  if (dist * dist < 1e-8) return target;
  return current + dist * clamp01(dt * speed);
}

/** FMath::VInterpTo. */
export function vInterpTo(current: Vec3, target: Vec3, dt: number, speed: number): Vec3 {
  if (speed <= 0) return target;
  const dist = sub(target, current);
  if (dot(dist, dist) < 1e-8) return target;
  return add(current, scale(dist, clamp01(dt * speed)));
}

/** Rocket League's FOV is horizontal; Three.js cameras take the vertical FOV. */
export function horizontalToVerticalFov(horizontalDeg: number, aspect: number): number {
  const h = (horizontalDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}
