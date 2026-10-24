// The page's /version.json (vite.config.ts writes it at the build): its protocol the page's own, so a page reads its
// deployment's against its own and asks for a reload only when they differ (RV-1030, RV-1064). Run after a build (the
// image's client stage runs it beside the shipped-data guards); skipped without one
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "./protocol";

const FILE = new URL("../../dist/version.json", import.meta.url);

describe.skipIf(!existsSync(FILE))("the build's version.json", () => {
  it("names the page's own protocol, nothing else", () => {
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual({ protocol: PROTOCOL_VERSION });
  });
});
