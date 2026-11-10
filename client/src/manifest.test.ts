// The web app manifest (public/manifest.json; notes/mobile.md): the icons Chrome's install wants (192 and 512 px, a
// maskable one), each a PNG in public/ of the size it says (RV-1228)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PUBLIC = new URL("../public/", import.meta.url);

/** A PNG's width and height (its IHDR chunk) */
function pngSize(path: string): [number, number] {
  const bytes = readFileSync(new URL(path.replace(/^\//, ""), PUBLIC));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe("the web app manifest", () => {
  it("lists 192 and 512 px PNG icons and a maskable one, each the size it says", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", PUBLIC), "utf8")) as {
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
      display: string;
      orientation: string;
    };
    expect([manifest.display, manifest.orientation]).toEqual(["fullscreen", "landscape"]);
    const png = manifest.icons.filter((i) => i.type === "image/png");
    for (const icon of png) {
      const [w, h] = icon.sizes.split("x").map(Number);
      expect(pngSize(icon.src), icon.src).toEqual([w, h]);
    }
    const sizes = png.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(png.some((i) => i.purpose === "maskable")).toBe(true);
  });
});
