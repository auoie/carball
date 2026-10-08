// For tests (Node): the generated arena's collision meshes, one .cmf per piece (scripts/arena_gen.py).
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const arenaDir = fileURLToPath(new URL("../../../out/arena/collision_meshes/soccar/", import.meta.url));

/** Every arena mesh file's bytes, in name order. */
export function arenaMeshes(): Uint8Array[] {
  return readdirSync(arenaDir)
    .filter((name) => name.endsWith(".cmf"))
    .sort()
    .map((name) => new Uint8Array(readFileSync(arenaDir + name)));
}
