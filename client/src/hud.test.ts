// The HUD's numbers as the game's (notes/visual-timing.md).
import { describe, expect, it } from "vitest";
import { boostShown } from "./hud";

describe("the boost meter's number (VT-21)", () => {
  it("is floor(pct · 100), at least 1 while any boost is left", () => {
    expect(boostShown(0)).toBe(0);
    expect(boostShown(0.4)).toBe(1);
    expect(boostShown(33.333)).toBe(33);
    expect(boostShown(99.6)).toBe(99);
    expect(boostShown(100)).toBe(100);
  });
});
