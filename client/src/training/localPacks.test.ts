// The user's own packs (other creators' work, converted locally: out/bsim/assets_local/training/packs/, git-ignored)
// never end up in what's committed: no three numbers in a row (a list, a table's row or keyed: RV-604) in any of the
// repository's text files (committed or would be) near a shot's ball or car position or its car's rotator (RX25, RV-586):
// - within 0.01 with one of them telling (decimals, or past 200 and no multiple of 50 nor of 1024, a rotator's
//   sixty-fourth of a turn: a copied value's; round ones like 0, 0, 30, -1500, 2000, 100 or 0, 16384, 0 are anyone's);
// - within 0.5 with two telling (a copy rounded to a decimal).
// Skipped where the packs aren't (any other machine, CI); it reads them and reports a match by its file alone, never the
// numbers.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../..", import.meta.url).pathname;
const PACKS = join(ROOT, "out/bsim/assets_local/training/packs");
/** A text file's largest size scanned (bytes) */
const MAX_BYTES = 4_000_000;

/** The repository's files (committed or would be: git's own list, nothing ignored), text ones only */
function textFiles(): string[] {
  const listed = execSync("git ls-files -co --exclude-standard -z", { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return listed
    .map((name) => join(ROOT, name))
    .filter((path) => {
      if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size > MAX_BYTES) return false;
      return !readFileSync(path).subarray(0, 8192).includes(0);
    });
}

/** Each shot's ball and car positions and its car's rotator, in the local packs */
function packTriples(): number[][] {
  const out: number[][] = [];
  const triple = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number");
  for (const name of readdirSync(PACKS).filter((n) => n.endsWith(".json"))) {
    const pack = JSON.parse(readFileSync(join(PACKS, name), "utf8")) as {
      shots?: { ball?: { location?: unknown }; car?: { location?: unknown; rotation?: { pitch?: unknown; yaw?: unknown; roll?: unknown } } }[];
    };
    for (const shot of pack.shots ?? []) {
      for (const at of [shot.ball?.location, shot.car?.location]) if (triple(at)) out.push(at);
      const r = shot.car?.rotation;
      const rotator = [r?.pitch, r?.yaw, r?.roll];
      if (triple(rotator)) out.push(rotator);
    }
  }
  return out;
}

/** A number as written: telling when it has decimals, or is past 200 and no multiple of 50 nor of 1024 (a rotator's round
 *  turns) */
export const telling = (v: string): boolean => v.includes(".") || (Math.abs(Number(v)) > 200 && Number(v) % 50 !== 0 && Number(v) % 1024 !== 0);

/** Every run of three numbers in a text (overlapping: a lookahead's captures), however they're written: a list
 *  (1, 2, 3), a table's row (spaces, semicolons, bars), or keyed ({ x: 1, y: 2, z: 3 }, JSON's "pitch": …, a = …: RV-604);
 *  each number whole (never a longer one's piece) */
const NUM = String.raw`(-?\d+(?:\.\d+)?)`;
const SEP = String.raw`(?:\s*[,;|]\s*|\s+)(?:["']?[A-Za-z_]\w{0,11}["']?\s*[:=]\s*)?`;
export const TRIPLE = new RegExp(String.raw`(?<![\w.-])(?=${NUM}(?![\d.])${SEP}${NUM}(?![\d.])${SEP}${NUM}(?!\d|\.\d))`, "g");

/** A matcher of written triples against the packs' (bucketed by the first number, whole) */
export function copiedFrom(triples: readonly (readonly number[])[]): (written: readonly string[]) => boolean {
  const buckets = new Map<number, (readonly number[])[]>();
  for (const t of triples) {
    const key = Math.round(t[0] ?? 0);
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  return (written) => {
    const n = written.map(Number);
    const count = written.filter(telling).length;
    if (count === 0) return false;
    const tolerance = count >= 2 ? 0.5 : 0.01;
    const key = Math.round(n[0] ?? 0);
    for (const k of [key - 1, key, key + 1]) for (const t of buckets.get(k) ?? []) if (t.every((v, i) => Math.abs(v - (n[i] ?? NaN)) <= tolerance)) return true;
    return false;
  };
}

describe("the user's packs stay local", () => {
  it("the matcher: a copy exact or rounded to 0.01 with a telling number, rounded to 0.5 with two; round numbers anyone's", () => {
    // (invented numbers, none of anyone's pack)
    const copied = copiedFrom([
      [-611.2371, 1733.5482, 412.8806],
      [0, 0, 63.371],
      [-1337, 2741.2, 25],
      [-1500, 2000, 100],
      [0, 16384, 0],
    ]);
    expect(copied(["-611.24", "1733.55", "412.88"])).toBe(true);
    expect(copied(["-611.2", "1733.5", "413"])).toBe(true);
    expect(copied(["-1337", "2741", "25"])).toBe(true);
    expect(copied(["0", "0", "63"])).toBe(false);
    expect(copied(["0", "16384", "0"])).toBe(false);
    expect(copied(["-1500", "2000", "100"])).toBe(false);
    expect(copied(["-611", "1734", "413"])).toBe(true);
    expect(copied(["-600", "1750", "400"])).toBe(false);
  });

  it("the reader: three numbers in a list, a table's row or keyed, each whole (RV-604)", () => {
    const read = (text: string): string[][] => [...text.matchAll(TRIPLE)].map((m) => [m[1] ?? "", m[2] ?? "", m[3] ?? ""]);
    expect(read("[-611.24, 1733.55, 412.88]")).toEqual([["-611.24", "1733.55", "412.88"]]);
    expect(read("{ x: -611.24, y: 1733.55, z: 412.88 }")).toEqual([["-611.24", "1733.55", "412.88"]]);
    expect(read('{"pitch": -611.24, "yaw": 1733.55, "roll": 412.88}')).toEqual([["-611.24", "1733.55", "412.88"]]);
    expect(read("| -611.24 | 1733.55 | 412.88 |")).toEqual([["-611.24", "1733.55", "412.88"]]);
    expect(read("-611.24 1733.55 412.88\n")).toEqual([["-611.24", "1733.55", "412.88"]]);
    expect(read("-611.24; 1733.55; 412.88")).toEqual([["-611.24", "1733.55", "412.88"]]);
    // (no number split into pieces, none read from inside a name)
    expect(read("4128806")).toEqual([]);
    expect(read("v2 3 4")).toEqual([]);
    expect(read("1, 2, 3, 4").length).toBe(2);
  });

  it.skipIf(!existsSync(PACKS))(
    "no shot position or rotator of theirs in the repository's text files",
    () => {
      const triples = packTriples();
      expect(triples.length).toBeGreaterThan(0);
      const copied = copiedFrom(triples);
      const hits = textFiles().filter((path) => [...readFileSync(path, "utf8").matchAll(TRIPLE)].some((m) => copied([m[1] ?? "", m[2] ?? "", m[3] ?? ""])));
      expect(hits.map((path) => path.slice(ROOT.length))).toEqual([]);
    },
    60_000,
  ); // (every text file of the repository: a few seconds alone, longer beside the other tests)
});
