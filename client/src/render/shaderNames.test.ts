// No shader declares a name GLSL already has (RV-158, RV-186): a variable, uniform or parameter called step, dot, mix ...
// shadows the built-in in its scope, which compiles on some drivers and not others.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });

const BUILT_INS = [
  "step", "dot", "mix", "length", "distance", "normalize", "clamp", "min", "max", "sign", "fract", "floor", "mod", "pow",
  "exp", "exp2", "log", "log2", "sin", "cos", "tan", "texture", "texture2D", "smoothstep", "reflect", "refract", "cross",
  "abs", "sqrt", "inversesqrt", "ceil", "round", "radians", "degrees", "atan", "asin", "acos", "faceforward", "equal",
  "any", "all", "not", "fwidth", "dFdx", "dFdy", "transpose", "inverse", "outerProduct", "trunc", "textureLod",
];
/** A declaration of a built-in's name: a type, then the name, then what follows a declared name */
const DECLARATION = new RegExp(`\\b(?:float|vec[234]|bool|int|mat[234]|sampler2D|samplerCube)\\s+(${BUILT_INS.join("|")})\\b\\s*[=;,)\\[]`, "g");

describe("the shaders' names (RV-158)", () => {
  it("none declares a GLSL built-in's name", () => {
    const found = files(SRC).flatMap((path) => [...readFileSync(path, "utf8").matchAll(DECLARATION)].map((m) => `${path.slice(SRC.length)}: ${m[0]}`));
    expect(found).toEqual([]);
  });

  it("the check finds one (a control)", () => {
    expect([..."uniform vec2 step;\nbool dot = true;".matchAll(DECLARATION)].map((m) => m[1])).toEqual(["step", "dot"]);
  });
});
