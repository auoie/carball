import { describe, expect, it } from "vitest";
import { keyGlyph } from "./keyGlyph";

describe("the prompts' {key} token (HT-3, RV-282)", () => {
  it("draws mouse and pad buttons as icons, keys as words", () => {
    expect(keyGlyph({ kind: "mouse", button: 1 })).toEqual({ kind: "mouse", button: 1 });
    expect(keyGlyph({ kind: "padButton", button: 3 })).toEqual({ kind: "pad", button: 3, text: "Y" });
    expect(keyGlyph({ kind: "padButton", button: 0 })).toEqual({ kind: "pad", button: 0, text: "A" });
    expect(keyGlyph({ kind: "padButton", button: 4 })).toEqual({ kind: "pad", button: 4, text: "LB" });
    expect(keyGlyph({ kind: "key", code: "Space" })).toEqual({ kind: "word", text: "Space" });
    expect(keyGlyph(null)).toEqual({ kind: "word", text: "—" });
  });
});
