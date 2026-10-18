// What ships names no game (the user's decision, 2026-10-15: notes/hitboxes.md): the built page (dist, its
// WebAssembly engine among it), public/, the strings our modules hold (comments may name the game: they don't ship) and,
// in the image build, the game server's and the accounts service's staged files (their binaries, the meshes, their
// images' Dockerfiles: SHIPPED_GAME_DIR, SHIPPED_API_DIR, scripts/build_images.sh) carry none of the game's, its maker's,
// its cars', its arenas' or its modes' names, nor its abbreviation, file names included (RV-388, RV-423). Needs nothing local: it runs in CI and in the image build too.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(SRC, "../dist");
const PUBLIC = join(SRC, "../public");
const INDEX = join(SRC, "../index.html");
const GAME = process.env["SHIPPED_GAME_DIR"];
const API = process.env["SHIPPED_API_DIR"];

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
/** The names no common word holds: found inside any word too, any case ("OCTANEBODY", "octanebody": RV-423); the game's
 *  bot projects', named after it, among them (rlbotpack, rlgym-compat in the bots' ids: RV-533) */
const DISTINCT = [
  "rocket league",
  "psyonix",
  "octane",
  "dominus",
  "fennec",
  "batmobile",
  "takumi",
  "mannfield",
  "soccar",
  "dropshot",
  "heatseeker",
  "snow day",
  "gridiron",
  "spike rush",
  "rlbot",
  "rlgym",
];
/** The game's abbreviation (renamed carball: the user's decision of 2026-10-15), case-sensitive: "rl" alone is a
 *  minifier's name (`var rl=`, `of rl)`) and random bytes spell it (RV-424). Anywhere: a separated compound or a phrase
 *  (rl-clone, rl_mode, RL_MODE, .rl-hud, "RL PATCH"), our old joined names in any case (rlengine, RLengine, rl.clone),
 *  a long camel-cased name (rlFreeplay, RLStats), the retired names themselves wherever they sit (RLOF, xRLOF,
 *  btVehicleRL, btWheelInfoRL: RV-436) */
const ABBREVIATIONS = new RegExp(
  [
    String.raw`(?<![A-Za-z0-9_$])(?:rl|RL|Rl)[-_][A-Za-z]`,
    String.raw`(?<![A-Za-z0-9_$])(?:rl|RL|Rl)[-_.]?(?:clone|server|engine|Clone|Server|Engine|CLONE|SERVER|ENGINE)`,
    String.raw`(?<![A-Za-z0-9_$])RL [A-Za-z]`,
    String.raw`(?<![A-Za-z0-9_$+/])(?:rl|Rl|RL)[A-Z][a-z]{3,}`,
    String.raw`RLOF|btVehicleRL|btWheelInfoRL`,
  ].join("|"),
);
/** In text alone (code, markup, notices: a binary's random bytes spell these, about 1 a MB, RV-435): a short camel-cased
 *  name (rlUI: four characters at least, past a minifier's three-letter names), a property (window.rl), a name ending in
 *  the abbreviation (CarRL, btVehicleRL; not URL or CRL, nor RLE's decodeRLE: RV-436) */
const TEXT_ABBREVIATIONS = new RegExp(
  [
    String.raw`(?<![A-Za-z0-9_$+/])(?:(?:rl|Rl)[A-Z][A-Za-z0-9_$]|RL[A-Z][a-z])`,
    String.raw`\.rl(?![A-Za-z0-9_$])`,
    String.raw`(?<![A-Za-z0-9_$])[A-Za-z][A-Za-z0-9]*[a-z]RL(?![A-Za-z0-9])`,
  ].join("|"),
);
const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ _-]?");
const PATTERN = new RegExp(`(?<![a-z0-9])(${NAMES.map(escape).join("|")})(?![a-z0-9])`, "i");
const INSIDE = new RegExp(`(${DISTINCT.map(escape).join("|")})`, "i");

/** The text with its compounds split (camelCase, letters and digits: "carOctane", "MannfieldNight", "octane2"), so a
 *  name inside one counts as a word (RV-413) */
function words(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2");
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** A shipped file's text, and whether it is binary (a NUL in its first 8 KB): then its printable runs of 4 or more
 *  alone, one a line, so random bytes rarely spell a name (RV-424) */
function shipped(path: string): { text: string; binary: boolean } {
  const bytes = readFileSync(path);
  const text = bytes.toString("latin1");
  const binary = bytes.subarray(0, 8192).includes(0);
  return { text: binary ? (text.match(/[\x20-\x7e]{4,}/g) ?? []).join("\n") : text, binary };
}

/** Vite's content hashes in the built page's file names ("index-Cc7XCyWW.js", where its code names them too): random
 *  letters, taken out first so none spells a name by chance (RV-435: about 2% of builds). Eight characters with a capital,
 *  a digit, - or _ (a lowercase word like "-rlengine." is a name, not a hash) */
function viteHashes(paths: readonly string[]): string[] {
  return paths.flatMap((path) => /-([A-Za-z0-9_-]{8})\.[A-Za-z0-9]+$/.exec(path)?.[1] ?? []).filter((hash) => /[A-Z0-9_-]/.test(hash));
}
const withoutHashes = (text: string, hashes: readonly string[]): string => hashes.reduce((t, hash) => t.split(hash).join(""), text);

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
/** The same in the accounts service's binary: Go's crypto/tls and crypto/hpke (the post-quantum "hybrid" key exchange's
 *  type and function names, each by its exact name: a game's name glued after one still found (RX28C); its error texts,
 *  run on into the next string: no boundary after them), x/text's ISO 15924
 *  script codes (Meroitic Cursive's "Merc" in its packed table, through pgx's password normalisation), and a root
 *  certificate's subject in the bundle built in (Izenpe's "R. Merc." registry entry) */
const THIRD_PARTY_GO =
  /(?:tls|hpke)\.(?:\(\*)?(?:hybridKeyExchange|hybridKEM|hybridPublicKey|NewHybridPublicKey)(?![A-Za-z])|PQ KEM for \S+ hybrid|\bhybrid key exchange|MendMercMero|RMerc\.Vitoria-Gasteiz/g;

/** Encoded data, base64 (a run of 64 or more with capitals, lowercase letters and digits: a MIME or PEM line at least):
 *  random letters that spell anything, left out (RV-435) */
const ENCODED = /[A-Za-z0-9+/]{64,}={0,2}/g;
const unencoded = (text: string): string => text.replace(ENCODED, (run) => (/[0-9]/.test(run) && /[A-Z]/.test(run) && /[a-z]/.test(run) ? " " : run));

interface Hit {
  source: string;
  index: number;
  length: number;
}
const first = (re: RegExp, source: string): Hit | null => {
  const m = re.exec(source);
  return m ? { source, index: m.index, length: m[0].length } : null;
};

/** A C++ name ending in the abbreviation, or starting with it camel-cased, as Itanium mangling writes it, its length then
 *  the name (`N9RocketSim11btVehicleRLE`, a lambda's `SetCallbacksP7RLArena`: RV-533), the length checked, so random
 *  bytes rarely make one (RV-420, RV-435); RLE's names not (`10RLEDecoder`) */
function mangledRL(text: string): Hit | null {
  for (const m of text.matchAll(/(?<!\d)(\d{1,3})(?=[A-Za-z_])/g)) {
    const length = Number(m[1]);
    const at = m.index + m[0].length;
    const name = text.slice(at, at + length);
    if (length >= 4 && name.length === length && /^(?:[A-Za-z_][A-Za-z0-9_]*[a-z]RL|RL[A-Z][a-z][A-Za-z0-9_]*)$/.test(name))
      return { source: text, index: at, length };
  }
  return null;
}

/** The first name (or abbreviation) in the text, with its surroundings: a binary's (its printable runs) by the rules random
 *  bytes rarely meet (RV-435) */
function found(raw: string, binary = false): string | null {
  const text = unencoded(raw);
  const hit =
    first(PATTERN, text) ??
    first(PATTERN, words(text)) ??
    first(INSIDE, text) ??
    first(ABBREVIATIONS, text) ??
    (binary ? null : first(TEXT_ABBREVIATIONS, text)) ??
    mangledRL(text);
  return hit ? hit.source.slice(Math.max(0, hit.index - 30), hit.index + hit.length + 30) : null;
}

/** Seeded random bytes (xorshift32), for the false-alarm check */
function randomBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
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
    for (const short of [
      "window.rlUI = x",
      "window.rl = x",
      "env.RL_MODE",
      "rl_mode",
      'class="rl-hud"',
      ".rl-hud{color:red}",
      '"RL_ARENA"',
      "RLOF\0\0",
      "// RL PATCH: x",
      "RL physics",
      '"RLStats"',
      "rlserver",
      "N9RocketSim11btVehicleRLE",
      "btWheelInfoRL&",
    ]) {
      expect(found(short), short).not.toBeNull();
    }
    expect(found("hoops.txt")).not.toBeNull();
    for (const fine of [
      "var rl=[1];for(let e of rl){}",
      "return rl.some(t=>t)",
      "rlA=1",
      "x.rlx",
      "RLIMIT_NOFILE",
      "RLEDecoder",
      "url,curl",
      "/rlAb",
      "TEXTURL_A",
      "CertificateURL",
      "CRLShutdown",
      "N9RocketSim16btVehicleCarballE",
    ]) {
      expect(found(fine), fine).toBeNull();
    }
  });

  it("RX17's gaps closed (RV-436), and no false alarms on encoded or random data, hashed names, RLE (RV-435)", () => {
    for (const text of ["CarRL", "RLengine", "RLENGINE", "rl.clone", "xRLOF", "breakoutCar", "isPlankLike", "rumbleMode"])
      expect(found(text), text).not.toBeNull();
    for (const bin of ["ARLOF", "N9RocketSim11btVehicleRLE", "N9RocketSim10CarModelRLE", "breakoutCar"]) expect(found(bin, true), bin).not.toBeNull();
    // (RV-533: the bot projects' names in ids and versions, any case; an abbreviation-first type in a lambda's mangled name)
    for (const both of [
      '"version": "rlbotpack-2022-05',
      '"schedule":"rlgym-compat-v1"',
      "RLGym",
      "rlgymcompat",
      "myrlbotpack",
      "ZL12SetCallbacksP7RLArenaE3$_0",
    ]) {
      expect(found(both), both).not.toBeNull();
      expect(found(both, true), both).not.toBeNull();
    }
    for (const fine of [
      "decodeRLE",
      "encodeRLE",
      "readRLE",
      "tgaRLE",
      "RLE_8",
      "gokRLL",
      "for(let e of rl){}",
      "toURL",
      "CRL",
      "10RLEDecoder",
      "ZL12SetCallbacksP12CarballArenaE3$_0",
      "x12RLArena",
    ]) {
      expect(found(fine), fine).toBeNull();
      expect(found(fine, true), fine).toBeNull();
    }
    // (base64 holding the rules' shapes, as one run and as MIME lines: left out)
    const encoded = "AGFzbQEAAAAB9x/CarRL+Qk7z/RLStats+" + "Ab3x".repeat(10);
    expect(found("x/CarRL+Qk"), "the shape alone").not.toBeNull();
    expect(found(encoded), "inside base64").toBeNull();
    // (vite's hash in a file name, and where the code names it)
    expect(found("assets/three-Rl_kQ2FM.js"), "a hash that spells one").not.toBeNull();
    expect(found(withoutHashes('import("./three-Rl_kQ2FM.js")', viteHashes(["assets/three-Rl_kQ2FM.js", "assets/three-rlengine.js"])))).toBeNull();
    expect(viteHashes(["assets/carball-rlengine.js"]), "a lowercase word isn't a hash").toEqual([]);
    // (seeded random data: 4 MB of bytes read as a binary, 1 MB of base64 as one run and as 76-character lines)
    const runs = (
      randomBytes(4_000_000, 20261015)
        .toString("latin1")
        .match(/[\x20-\x7e]{4,}/g) ?? []
    ).join("\n");
    expect(found(runs, true), "random bytes").toBeNull();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const base64 = Array.from(randomBytes(1_000_000, 7), (b) => alphabet[b & 63]).join("");
    expect(found(base64), "base64, one run").toBeNull();
    expect(found(base64.replace(/.{76}/g, "$&\n")), "base64, MIME lines").toBeNull();
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
      const { text, binary } = shipped(path);
      expect(found(text, binary), relative(PUBLIC, path)).toBeNull();
    }
  });

  it.skipIf(!existsSync(DIST))("the built page: every file and its name, the engine's WebAssembly too", () => {
    const built = files(DIST);
    expect(built.some((p) => p.endsWith(".wasm"))).toBe(true);
    const hashes = viteHashes(built);
    expect(hashes.length).toBeGreaterThan(5);
    const texts = built.map((path) => [posix(relative(DIST, path)), shipped(path)] as const);
    // (the old keys' prefix once, in the migration's code)
    expect(
      texts.flatMap(([, { text }]) => text.match(OLD_KEYS) ?? []),
      "the old keys' prefix",
    ).toHaveLength(1);
    for (const [name, { text, binary }] of texts) {
      expect(found(withoutHashes(name, hashes)), "file name").toBeNull();
      expect(found(withoutHashes(text.replace(OLD_KEYS, '""'), hashes), binary), name).toBeNull();
    }
  });

  it.skipIf(!GAME)("the game server's image files (its binary, meshes and Dockerfile: the image build)", () => {
    const staged = files(GAME ?? "");
    expect(staged.some((p) => p.endsWith("carball-server"))).toBe(true);
    for (const path of staged) {
      const name = posix(relative(GAME ?? "", path));
      expect(found(name), "file name").toBeNull();
      const { text, binary } = shipped(path);
      expect(found(text.replace(THIRD_PARTY, ""), binary), name).toBeNull();
    }
  });

  it.skipIf(!API)("the accounts service's image files (its binary and Dockerfile: the image build)", () => {
    const staged = files(API ?? "");
    expect(staged.some((p) => p.endsWith("carball-api"))).toBe(true);
    for (const path of staged) {
      const name = posix(relative(API ?? "", path));
      expect(found(name), "file name").toBeNull();
      const { text, binary } = shipped(path);
      expect(found(text.replace(THIRD_PARTY_GO, ""), binary), name).toBeNull();
    }
  });
});
