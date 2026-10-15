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

/** Whole words, any case: the game, its maker, its car bodies and hitbox presets, its arenas, its modes */
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
  "soccar",
  "hoops",
  "heatseeker",
  "snow day",
  "snowday",
  "dropshot",
];
/** The game's abbreviation in our own names (renamed carball: the user's decision of 2026-10-15): rl-clone.*, rl-server,
 *  rlengine, and camel-cased rlSomething (a minifier never makes those) */
const ABBREVIATIONS = /(?<![a-z0-9])rl[-_]?(clone|server|engine)|(?<![A-Za-z0-9_$])rl[A-Z][a-z]{2,}/i;
const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERN = new RegExp(`(?<![a-z0-9])(${NAMES.map((n) => escape(n).replace(/ /g, "[ _-]?")).join("|")})(?![a-z0-9])`, "i");

/** The text with its compounds split (camelCase, letters and digits: "carOctane", "MannfieldNight", "octane2"), so a
 *  name inside one counts as a word (RV-413) */
function words(text: string): string {
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])([0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2");
}

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

/** The one abbreviation that ships on purpose: the old storage keys' prefix, which the one-time migration must name to
 *  read them (settings/storageKeys.ts; it goes with the migration) */
const OLD_KEYS = /["'`]rl-clone\.["'`]/g;

/** The first name (or abbreviation) in the text, with its surroundings */
function found(text: string): string | null {
  const m = PATTERN.exec(text) ?? PATTERN.exec(words(text)) ?? ABBREVIATIONS.exec(text.replace(OLD_KEYS, '""'));
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
    expect(found('fetch("soccar_corner.cmf")')).not.toBeNull();
    expect(found('localStorage.getItem("rl-clone.settings.v1")')).not.toBeNull();
    expect(found("window.rlFreeplay = x")).not.toBeNull();
    expect(found("rlengine_web-ab12.wasm")).not.toBeNull();
    expect(found("var rl=1,url=2;curlFoo()")).toBeNull();
    // Compounds (RX15's G4, G4b)
    expect(found('const carOctane = 1')).not.toBeNull();
    expect(found('"MannfieldNight"')).not.toBeNull();
    expect(found("octane2")).not.toBeNull();
    expect(found("isOctaneLike")).not.toBeNull();
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
