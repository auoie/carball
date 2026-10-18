// The site's third-party notices (public/THIRD_PARTY_NOTICES.txt, and the bots' after it: bots/NOTICES.txt, with
// onnxruntime's own beside them): every runtime dependency the page ships has its section, so one added can't ship without
// its licence's notice.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("the third-party notices", () => {
  it("name every runtime dependency (package.json's dependencies)", () => {
    const dependencies = Object.keys((JSON.parse(read("package.json")) as { dependencies: Record<string, string> }).dependencies);
    const notices = `${read("public/THIRD_PARTY_NOTICES.txt")}\n${read("bots/NOTICES.txt")}`;
    // (three's section names it three.js)
    const named = (dependency: string): boolean => notices.includes(dependency === "three" ? "three.js" : dependency);
    expect(dependencies.filter((d) => !named(d))).toEqual([]);
  });
});
