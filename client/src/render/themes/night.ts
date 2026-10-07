// The original look: a dark arena on dark ground, cool light from above.
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  FrontSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from "three";
import type { Theme } from "./theme";

export function nightTheme(): Theme {
  const root = new Group();
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(3000, 8000, 2000);
  root.add(new HemisphereLight(0xd6e4ff, 0x2a3a2a, 1.4), new AmbientLight(0xffffff, 0.25), sun);

  // Dark ground around the arena, so the see-through walls don't show a void
  const ground = new Mesh(
    new PlaneGeometry(40000, 40000),
    new MeshStandardMaterial({ color: 0x10151d, roughness: 1, side: FrontSide }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -40;
  root.add(ground);

  return {
    background: new Color(0x0d1117),
    fog: new Fog(0x0d1117, 9000, 22000),
    style: {
      floor: new Color(0x24402c),
      floorStripe: null,
      walls: {
        neutral: new Color(0x8fa6c8),
        blue: new Color(0x2a7fff),
        orange: new Color(0xff8a1f),
        lines: 0.2,
        ceilingLines: 0.06,
      },
    },
    root,
    update: () => undefined,
  };
}
