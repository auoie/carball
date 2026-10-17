// The wall foot's stack (AV-10, src/render/wallFoot.ts): the fillet frame's top round the walls (RV-462)
import { describe, expect, it } from "vitest";
import { STACK, frameTopAt, wallParam } from "./wallFoot";

describe("the wall foot's frame (AV-10)", () => {
  it("its top 140 along the side walls, 96 along the back wall to |x| 1344, then down to 57 by 960", () => {
    expect(STACK.frameTop).toMatchObject({ side: 140, corner: 128, back: 96, wing: [1344, 960], post: 57 });
    expect(frameTopAt(wallParam(4096, 0))).toBe(140);
    expect(frameTopAt(wallParam(4096, -2000))).toBe(140);
    expect(frameTopAt(wallParam(2000, 5120))).toBe(96);
    expect(frameTopAt(wallParam(1344, 5120))).toBeCloseTo(96, 0);
    expect(frameTopAt(wallParam(1152, 5120))).toBeCloseTo(76.5, 0);
    expect(frameTopAt(wallParam(960, 5120))).toBeCloseTo(57, 0);
  });
});
