import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildRain, buildTraffic, layoutTowers, streetLines } from "./cityscape";
import { PLAYING_VOLUME } from "./theme";

const lines = streetLines();
const towers = layoutTowers(1234);

describe("the city", () => {
  it("keeps its towers out of the street corridors, where the traffic flies", () => {
    expect(towers.length).toBeGreaterThan(300);
    for (const t of towers) {
      for (const line of lines) {
        // A car (110 wide) flies 90 off the street's centre line
        expect.soft(Math.abs(t.x - line), `tower at ${Math.round(t.x)}, ${Math.round(t.z)}`).toBeGreaterThan(t.width / 2 + 150);
        expect.soft(Math.abs(t.z - line), `tower at ${Math.round(t.x)}, ${Math.round(t.z)}`).toBeGreaterThan(t.depth / 2 + 150);
      }
    }
  });

  it("flies its traffic along the streets", () => {
    const { mesh } = buildTraffic(99);
    const m = new Matrix4();
    const at = new Vector3();
    const onStreet = (v: number): boolean => lines.some((line) => Math.abs(Math.abs(v - line) - 90) < 1e-6);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      at.setFromMatrixPosition(m);
      // A lane along z sits on a street x, and the other way round (its cars move along their own z)
      const forward = new Vector3(0, 0, 1).transformDirection(m);
      const across = Math.abs(forward.z) > 0.5 ? at.x : at.z;
      expect.soft(onStreet(across), `car ${i} at ${at.toArray().map(Math.round).join(", ")}`).toBe(true);
      expect.soft(at.y, `car ${i}`).toBeGreaterThan(PLAYING_VOLUME.height + 500);
    }
  });

  it("rains outside the arena only", () => {
    const { lines: rain } = buildRain(5, 500, 16000);
    const position = rain.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      const outside = Math.abs(position.getX(i)) > PLAYING_VOLUME.halfX || Math.abs(position.getZ(i)) > PLAYING_VOLUME.halfZ;
      expect.soft(outside, `streak ${i}`).toBe(true);
    }
  });
});
