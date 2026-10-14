import { describe, expect, it } from "vitest";
import { NUMBERS_INK, cellOffsets, glyphKey, inkFit, numberAdvance, numberCells } from "./numberCells";

describe("the HUD's numbers at Dashboard Numbers Wide's advances (HT-12, the user's finding 21)", () => {
  it("gives every digit but 1 the same cell, so the clock holds still as they change", () => {
    const width = (text: string): number => numberCells(text).reduce((sum, cell) => sum + cell.advance, 0);
    expect(width("4:59")).toBeCloseTo(width("4:58"), 9);
    expect(width("0:00")).toBeCloseTo(width("9:87"), 9);
    expect(numberAdvance("1")).toBe(0.31);
    expect(numberAdvance(":")).toBe(0.14);
    expect(numberCells("+1:05").map((cell) => cell.c)).toEqual(["+", "1", ":", "0", "5"]);
  });

  it("pads the clock's trailing 1 to a digit's cell, so 1:10 to 1:11 doesn't move (HT-12, the user's finding 22)", () => {
    const spacing = 2 / 31; // (letterSpacing 2 at 31 px)
    const at = (text: string): readonly number[] => cellOffsets(numberCells(text, true), spacing);
    expect(numberCells("1:11", true).map((cell) => cell.c)).toEqual(["1", ":", "1", "1", "\u00a0"]);
    expect(at("1:11").slice(0, 4)).toEqual(at("1:10").slice(0, 4).map((x) => expect.closeTo(x, 9) as unknown as number));
    // (a 1 in the tens moves it, as the game's: 0.486 em narrower)
    expect(at("1:19")[0]).not.toBeCloseTo(at("1:20")[0] ?? 0, 3);
    // (no padding for the scores and boost)
    expect(numberCells("11").map((cell) => cell.c)).toEqual(["1", "1"]);
  });

  it("stretches a stand-in glyph's ink to the game's and starts it where the game's does (the user's \"10 0\")", () => {
    // (a stand-in '0' with ink from 0.05 to 0.55 em, drawn at 0.9 of the game's size: 0.45 wide, to fill 0.7363)
    const zero = NUMBERS_INK["0"] ?? { xMin: 0, xMax: 0 };
    const fit = inkFit(zero, { left: 0.05, right: 0.55 }, 0.9);
    const drawn = (x: number): number => fit.shift + fit.scale * x * 0.9;
    expect(drawn(0.05)).toBeCloseTo(zero.xMin, 9);
    expect(drawn(0.55)).toBeCloseTo(zero.xMax, 9);
    // (the '1' its narrow ink, at its cell's left; no ink: left as it is)
    const one = NUMBERS_INK["1"] ?? { xMin: 0, xMax: 0 };
    expect(one.xMax - one.xMin).toBeCloseTo(0.2549, 4);
    expect(inkFit(one, { left: 0.1, right: 0.1 }, 1)).toEqual({ scale: 1, shift: 0 });
    expect([glyphKey("7"), glyphKey(":"), glyphKey("+"), glyphKey("\u00a0")]).toEqual(["7", "colon", "plus", null]);
  });
});
