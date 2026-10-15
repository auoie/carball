// What ships names no game (the user's decision, 2026-10-15: notes/hitboxes.md): the built page (dist, its
// WebAssembly engine among it), public/, the strings our modules hold (comments may name the game: they don't ship) and,
// in the image build, the game server's staged files (its binary, its meshes, its image's Dockerfile: SHIPPED_GAME_DIR,
// scripts/build_images.sh) carry none of the game's, its maker's, its cars', its arenas' or its modes' names, nor its
// abbreviation, file names included (RV-388, RV-423). Needs nothing local: it runs in CI and in the image build too.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(SRC, "../dist");
const PUBLIC = join(SRC, "../public");
const INDEX = join(SRC, "../index.html");
const GAME = process.env["SHIPPED_GAME_DIR"];

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
  "rumble",
  "gridiron",
  "knockout",
  "spike rush",
];
/** The names no common word holds: found inside any word too, any case ("OCTANEBODY", "octanebody": RV-423) */
const DISTINCT = ["rocket league", "psyonix", "octane", "dominus", "fennec", "batmobile", "takumi", "mannfield", "soccar", "dropshot", "heatseeker", "snow day", "gridiron", "spike rush"];
/** The game's abbreviation (renamed carball: the user's decision of 2026-10-15), case-sensitive: "rl" alone is a
 *  minifier's name (`var rl=`, `of rl)`) and random bytes spell it (RV-424). In a separated compound or a phrase
 *  (rl-clone, rl_mode, RL_MODE, .rl-hud, "RL PATCH"), our old joined names (rlengine, rlserver), camel-cased
 *  (rlFreeplay, rlUI, RLStats: four characters at least, past a minifier's three-letter names, and not inside base64), a
 *  short capital run (RLOF, not RLIMIT or RLEDecoder), a property (window.rl: RV-423) or a name's suffix (a C++ type
 *  name, btVehicleRL in `N9RocketSim11btVehicleRLE`, after three lowercase letters: not URL or CRL, RV-420) */
const ABBREVIATIONS = new RegExp(
  [
    String.raw`(?<![A-Za-z0-9_$])(?:rl|RL|Rl)[-_][A-Za-z]`,
    String.raw`(?<![A-Za-z0-9_$])rl(?:clone|server|engine)`,
    String.raw`(?<![A-Za-z0-9_$])RL [A-Za-z]`,
    String.raw`(?<![A-Za-z0-9_$+/])(?:(?:rl|Rl)[A-Z][A-Za-z0-9_$]|RL[A-Z][a-z])`,
    String.raw`(?<![A-Za-z0-9_$+/])RL[A-Z]{1,3}(?![A-Za-z0-9])`,
    String.raw`\.rl(?![A-Za-z0-9_$])`,
    String.raw`[a-z]{3}RL(?![a-z])`,
  ].join("|"),
);
const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ _-]?");
const PATTERN = new RegExp(`(?<![a-z0-9])(${NAMES.map(escape).join("|")})(?![a-z0-9])`, "i");
const INSIDE = new RegExp(`(${DISTINCT.map(escape).join("|")})`, "i");

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

/** A shipped file's text: a binary one's (a NUL in its first 8 KB) printable runs of 4 or more alone, one a line, so
 *  random bytes rarely spell a name (RV-424) */
function shipped(path: string): string {
  const bytes = readFileSync(path);
  const text = bytes.toString("latin1");
  return bytes.subarray(0, 8192).includes(0) ? (text.match(/[\x20-\x7e]{4,}/g) ?? []).join("\n") : text;
}

const posix = (path: string): string => path.split("\\").join("/");

/** Modules that only a development build runs: the local car model's loader (the dev-only /local-assets route's files,
 *  never bundled: the built-page check below confirms none of it ships) */
const DEV_ONLY = new Set(["render/fennec.ts"]);

/** The one abbreviation that ships on purpose: the old storage keys' prefix, which the one-time migration must name to
 *  read them. In that module alone, and once in the built page (RV-423) */
const OLD_KEYS = /["'`]rl-clone\.["'`]/g;
const OLD_KEYS_MODULE = "settings/storageKeys.ts";

/** Third-party words that hold a name by chance, in the game server's binary: rustls's key exchange API (a post-quantum
 *  hybrid's `hybrid_component()`) */
const THIRD_PARTY = /\bhybrid_component\b/g;

/** The first name (or abbreviation) in the text, with its surroundings */
function found(text: string): string | null {
  for (const [re, source] of [
    [PATTERN, text],
    [PATTERN, words(text)],
    [INSIDE, text],
    [ABBREVIATIONS, text],
  ] as const) {
    const m = re.exec(source);
    if (m) return source.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
  }
  return null;
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
    expect(found("enum { Octane = 0 }")).not.toBeNull();
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
    expect(found("const carOctane = 1")).not.toBeNull();
    expect(found('"MannfieldNight"')).not.toBeNull();
    expect(found("octane2")).not.toBeNull();
    expect(found("isOctaneLike")).not.toBeNull();
  });

  it("the gaps RX16 found are closed (RV-423), a minifier's names and other abbreviations aside (RV-424)", () => {
    for (const mode of ["Rumble", "Gridiron", "Knockout", "Spike Rush", "spikeRush", "SPIKE_RUSH"]) expect(found(mode), mode).not.toBeNull();
    for (const all of ["OCTANEBODY", "octanebody", "CARCONFIGDOMINUS"]) expect(found(all), all).not.toBeNull();
    for (const short of ["window.rlUI = x", "window.rl = x", "env.RL_MODE", "rl_mode", 'class="rl-hud"', ".rl-hud{color:red}", '"RL_ARENA"', "RLOF\0\0", "// RL PATCH: x", "RL physics", '"RLStats"', "rlserver", "N9RocketSim11btVehicleRLE", "btWheelInfoRL&"]) {
      expect(found(short), short).not.toBeNull();
    }
    expect(found("hoops.txt")).not.toBeNull();
    for (const fine of ["var rl=[1];for(let e of rl){}", "return rl.some(t=>t)", "rlA=1", "x.rlx", "RLIMIT_NOFILE", "RLEDecoder", "url,curl", "/rlAb", "TEXTURL_A", "CertificateURL", "CRLShutdown", "N9RocketSim16btVehicleCarballE"]) {
      expect(found(fine), fine).toBeNull();
    }
  });

  it("our modules' strings (not their comments)", () => {
    const modules = files(SRC).filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts") && !DEV_ONLY.has(posix(relative(SRC, p))));
    expect(modules.length).toBeGreaterThan(50);
    for (const path of modules) {
      const name = posix(relative(SRC, path));
      let strings = literals(readFileSync(path, "utf8"));
      if (name === OLD_KEYS_MODULE) {
        expect(strings.match(OLD_KEYS), name).toHaveLength(1);
        strings = strings.replace(OLD_KEYS, '""');
      }
      expect(found(strings), name).toBeNull();
    }
    expect(found(readFileSync(INDEX, "utf8")), "index.html").toBeNull();
  });

  it("public/, as it ships, its file names too", () => {
    for (const path of files(PUBLIC)) {
      expect(found(posix(relative(PUBLIC, path))), "file name").toBeNull();
      expect(found(shipped(path)), relative(PUBLIC, path)).toBeNull();
    }
  });

  it.skipIf(!existsSync(DIST))("the built page: every file and its name, the engine's WebAssembly too", () => {
    const built = files(DIST);
    expect(built.some((p) => p.endsWith(".wasm"))).toBe(true);
    const texts = built.map((path) => [posix(relative(DIST, path)), shipped(path)] as const);
    // (the old keys' prefix once, in the migration's code)
    expect(texts.flatMap(([, text]) => text.match(OLD_KEYS) ?? []), "the old keys' prefix").toHaveLength(1);
    for (const [name, text] of texts) {
      expect(found(name), "file name").toBeNull();
      expect(found(text.replace(OLD_KEYS, '""')), name).toBeNull();
    }
  });

  it.skipIf(!GAME)("the game server's image files (its binary, meshes and Dockerfile: the image build)", () => {
    const staged = files(GAME ?? "");
    expect(staged.some((p) => p.endsWith("carball-server"))).toBe(true);
    for (const path of staged) {
      const name = posix(relative(GAME ?? "", path));
      expect(found(name), "file name").toBeNull();
      expect(found(shipped(path).replace(THIRD_PARTY, "")), name).toBeNull();
    }
  });
});
