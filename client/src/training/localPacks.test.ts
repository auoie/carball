// The user's own packs (other creators' work, converted locally: out/bsim/assets_local/training/packs/, git-ignored)
// never end up in what's committed: no three numbers in a row in the client's sources, tests or public files within 0.01
// of a shot's ball or car position, one of them telling (with decimals, or past 200 and no multiple of 50: a copied
// position's; round ones like 0, 0, 30 or -1500, 2000, 100 are anyone's) (RX25: a test's fixture was one, rounded to
// 0.01). Skipped where the packs aren't (any
// other machine, CI); it reads them and reports a match by its file alone, never the numbers.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PACKS = new URL("../../../out/bsim/assets_local/training/packs", import.meta.url).pathname;
const CLIENT = new URL("../..", import.meta.url).pathname;
const SCANNED = ["src", "e2e", "public", "maps", "cars"].map((d) => join(CLIENT, d));

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|js|mjs|json|html|css|md|txt)$/.test(name) ? [path] : [];
  });
}

/** Each shot's ball and car positions in the local packs */
function positions(): number[][] {
  const out: number[][] = [];
  for (const name of readdirSync(PACKS).filter((n) => n.endsWith(".json"))) {
    const pack = JSON.parse(readFileSync(join(PACKS, name), "utf8")) as { shots?: { ball?: { location?: unknown }; car?: { location?: unknown } }[] };
    for (const shot of pack.shots ?? [])
      for (const at of [shot.ball?.location, shot.car?.location]) if (Array.isArray(at) && at.length === 3 && at.every((v) => typeof v === "number")) out.push(at);
  }
  return out;
}

describe("the user's packs stay local", () => {
  it.skipIf(!existsSync(PACKS))("no shot position of theirs in the client's sources, tests or public files", () => {
    const wanted = positions();
    expect(wanted.length).toBeGreaterThan(0);
    // (every run of three numbers, overlapping: a lookahead's captures)
    const TRIPLE = /(?=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?))/g;
    const near = (t: readonly number[]): boolean => wanted.some((p) => p.every((v, i) => Math.abs(v - (t[i] ?? NaN)) <= 0.01));
    const telling = (v: string | undefined): boolean => v !== undefined && (v.includes(".") || (Math.abs(Number(v)) > 200 && Number(v) % 50 !== 0));
    const copied = (m: RegExpMatchArray): boolean => [m[1], m[2], m[3]].some(telling) && near([Number(m[1]), Number(m[2]), Number(m[3])]);
    const hits = SCANNED.flatMap(files).filter((path) => [...readFileSync(path, "utf8").matchAll(TRIPLE)].some(copied));
    expect(hits.map((path) => relative(CLIENT, path))).toEqual([]);
  });
});
