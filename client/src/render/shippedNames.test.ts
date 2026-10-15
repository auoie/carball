// What ships names no game (the user's decision, 2026-10-15: notes/hitboxes.md): the built page (dist, its
// WebAssembly engine among it), public/, and the strings our modules hold (comments may name the game: they don't ship)
// carry none of the game's, its maker's, its cars' or its arenas' names (RV-388). Needs nothing local: it runs in CI and
// in the image build too (scripts/build_images.sh).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(SRC, "../dist");
const PUBLIC = join(SRC, "../public");
const INDEX = join(SRC, "../index.html");

/** Whole words, any case: the game, its maker, its car bodies and hitbox presets, its arenas */
const NAMES = [
  "rocket league",
  "rocketleague",
  "psyonix",
  "octane",
  "dominus",
  "plank",
  "breakout",
  "hybrid",
  "merc",
  "fennec",
  "batmobile",
  "takumi",
  "dfh stadium",
  "mannfield",
  "champions field",
  "urban central",
  "beckwith park",
  "utopia coliseum",
  "neo tokyo",
  "salty shores",
  "forbidden temple",
];
const PATTERN = new RegExp(`(?<![a-z0-9])(${NAMES.map((n) => n.replace(/ /g, "[ _-]?")).join("|")})(?![a-z0-9])`, "i");

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Modules that only a development build runs: the local car model's loader (the dev-only /local-assets route's files,
 *  never bundled: the built-page check below confirms none of it ships) */
const DEV_ONLY = new Set(["render/fennec.ts"]);

/** The first name in the text, with its surroundings */
function found(text: string): string | null {
  const m = PATTERN.exec(text);
  return m ? text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30) : null;
}

/** A module's string literals ('…', "…", `…`), its comments and import paths left out (a module's file name doesn't ship) */
function literals(source: string): string {
  source = source.replace(/\b(from|import)\s*\(?\s*(['"])[^'"\n]*\2/g, "$1");
  const out: string[] = [];
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g;
  for (const m of source.matchAll(re)) if (!m[0].startsWith("//") && !m[0].startsWith("/*")) out.push(m[0]);
  return out.join("\n");
}

describe("what ships names no game (RV-388)", () => {
  it("the name list matches what it should, whole words only", () => {
    expect(found('enum { Octane = 0 }')).not.toBeNull();
    expect(found("<title>Rocket League by Psyonix</title>")).not.toBeNull();
    expect(found("rocket_league")).not.toBeNull();
    expect(found("MERCHANTABILITY, FITNESS")).toBeNull();
    expect(found("Commercial use")).toBeNull();
  });

  it("our modules' strings (not their comments)", () => {
    const modules = files(SRC).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts") && !DEV_ONLY.has(relative(SRC, p).split("\\").join("/")));
    expect(modules.length).toBeGreaterThan(50);
    for (const path of modules) expect(found(literals(readFileSync(path, "utf8"))), relative(SRC, path)).toBeNull();
    expect(found(readFileSync(INDEX, "utf8")), "index.html").toBeNull();
  });

  it("public/, as it ships", () => {
    for (const path of files(PUBLIC)) expect(found(readFileSync(path, "latin1")), relative(PUBLIC, path)).toBeNull();
  });

  it.skipIf(!existsSync(DIST))("the built page: every file, the engine's WebAssembly too", () => {
    const built = files(DIST);
    expect(built.some((p) => p.endsWith(".wasm"))).toBe(true);
    for (const path of built) expect(found(readFileSync(path, "latin1")), relative(DIST, path)).toBeNull();
  });
});
