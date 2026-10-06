// Field-of-view conversion for the renderer.

/** Rocket League's FOV is horizontal; Three.js cameras take the vertical FOV. */
export function horizontalToVerticalFov(horizontalDeg: number, aspect: number): number {
  const h = (horizontalDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
}
