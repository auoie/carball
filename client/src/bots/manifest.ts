// A bot package's manifest (bot.json: the packages' FORMAT.md, version 1, from the static session's ports): who made it
// and under what licence, its policy (ONNX, one file per team size where the entity count differs), the observation
// builder, action parser, timing schedule, kickoff script and difficulty it names (each ours, in TypeScript, from the
// first package's SPEC.md: nothing of the original runs), its team sizes and test vectors. Packages are local and
// git-ignored (out/bsim/assets_local/bots/packages) unless a build is told to include them.

export type Controls8 = readonly [number, number, number, number, number, number, number, number];

/** beta 1: argmax (ties to the lowest), -1: argmin, 0: uniform, else drawn from softmax(logits · log₃((1 + β) / (1 − β)));
 *  the overrides in order, a later one winning */
export interface BetaPick {
  readonly mode: "beta";
  readonly beta: number;
  readonly overrides: readonly { readonly when: "kickoffPause" | "matchEnded"; readonly beta: number }[];
}

export interface PolicySpec {
  readonly opset: number;
  readonly file?: string;
  readonly files?: Readonly<Partial<Record<"1" | "2" | "3", { readonly file: string; readonly entities?: number }>>>;
  /** "N": the team size's entity count */
  readonly inputs: readonly { readonly name: string; readonly shape: readonly (number | "N")[] }[];
  readonly outputs: readonly { readonly name: string; readonly shape: readonly number[] }[];
  readonly pick: "argmax" | "sample" | BetaPick;
  readonly state?: unknown;
}

export interface LookupAction {
  readonly parser: "lookup-v1";
  readonly table: string;
}

export interface MultiDiscreteAction {
  readonly parser: "multidiscrete-v1";
  readonly heads: readonly number[];
  readonly columns: readonly string[];
  /** Each control: the product of its factors' values at their heads' picks (none: 0) */
  readonly controls: Readonly<Record<string, readonly { readonly head: number; readonly values: readonly number[] }[]>>;
}

export interface KickoffScript {
  readonly script: "rows-v1";
  readonly phases: readonly (readonly [number, Controls8])[];
  readonly totalTicks: number;
  readonly taker: "nearest-left-v1";
  readonly takerToleranceUu: number;
  readonly setsPrevAction: boolean;
}

export interface BotManifest {
  readonly format: number;
  readonly id: string;
  readonly name: string;
  readonly version?: string;
  readonly authors?: string;
  readonly licence: string;
  readonly licenceFile?: string;
  readonly credit?: string;
  readonly source?: string;
  readonly policy: PolicySpec;
  readonly observation: { readonly builder: string } & Readonly<Record<string, unknown>>;
  readonly action: LookupAction | MultiDiscreteAction;
  readonly tickSkip: number;
  readonly timing?: { readonly schedule: string; readonly applyAtCounter: number };
  readonly teamSizes: readonly number[];
  readonly kickoff?: KickoffScript;
  /** random-controls-v1: its default strength, and Nexto's own easier level where its package defines it */
  readonly difficulty?: { readonly kind: string; readonly defaultStrength: number; readonly nextoEzStrength?: number };
  readonly vectors?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiles = (v: unknown): boolean => isRecord(v) && Object.entries(v).every(([k, f]) => ["1", "2", "3"].includes(k) && isRecord(f) && typeof f["file"] === "string");
const isPick = (v: unknown): boolean => v === "argmax" || v === "sample" || (isRecord(v) && v["mode"] === "beta" && typeof v["beta"] === "number" && Array.isArray(v["overrides"]));

/** A manifest checked for what the client reads (else what's wrong) */
export function parseManifest(json: unknown): BotManifest | string {
  if (!isRecord(json)) return "not an object";
  const { id, name, licence, policy, observation, action, tickSkip, teamSizes } = json;
  if (typeof id !== "string" || !ID.test(id)) return "its id";
  if (typeof name !== "string" || name.length === 0 || name.length > 32) return "its name";
  if (typeof licence !== "string") return "its licence";
  if (!isRecord(policy) || !(typeof policy["file"] === "string" || isFiles(policy["files"])) || !Array.isArray(policy["inputs"]) || !Array.isArray(policy["outputs"]) || !isPick(policy["pick"])) return "its policy";
  if (!isRecord(observation) || typeof observation["builder"] !== "string") return "its observation builder";
  if (!isRecord(action) || typeof action["parser"] !== "string") return "its action parser";
  if (action["parser"] === "lookup-v1" && typeof action["table"] !== "string") return "its action table";
  if (action["parser"] === "multidiscrete-v1" && (!Array.isArray(action["heads"]) || !isRecord(action["controls"]))) return "its action heads";
  if (typeof tickSkip !== "number" || !Number.isInteger(tickSkip) || tickSkip < 1 || tickSkip > 120) return "its tick skip";
  if (!Array.isArray(teamSizes) || !teamSizes.every((n) => n === 1 || n === 2 || n === 3)) return "its team sizes";
  return json as unknown as BotManifest;
}

/** The policy's file and entity count for a team size (null: the package doesn't play it) */
export function policyFile(manifest: BotManifest, teamSize: number): { readonly file: string; readonly entities: number | null } | null {
  if (!manifest.teamSizes.includes(teamSize)) return null;
  const { file, files } = manifest.policy;
  const own = files?.[String(teamSize) as "1" | "2" | "3"];
  if (own) return { file: own.file, entities: own.entities ?? null };
  return file === undefined ? null : { file, entities: null };
}

/** The pick's beta for the moment (argmax: 1; sample: 0.5, plain softmax) */
export function pickBeta(pick: PolicySpec["pick"], moment: { readonly kickoffPause: boolean; readonly matchEnded: boolean }): number {
  if (pick === "argmax") return 1;
  if (pick === "sample") return 0.5;
  let beta = pick.beta;
  for (const o of pick.overrides) if (moment[o.when]) beta = o.beta;
  return beta;
}
