// A bot package's manifest (bot.json, format 1): who made it and under what licence, its policy (one ONNX file for
// every team size it plays), the observation builder, action parser, mask, mirror, timing schedule and moments it names
// (each ours, in TypeScript: nothing of the original runs), its team sizes. The packages: client/bots/ (Wisp's built by
// scripts/wisp_package.py).

export type Controls8 = readonly [number, number, number, number, number, number, number, number];

export interface PolicySpec {
  readonly opset: number;
  readonly file: string;
  readonly inputs: readonly { readonly name: string; readonly shape: readonly number[] }[];
  readonly outputs: readonly { readonly name: string; readonly shape: readonly number[] }[];
  /** argmax: the likeliest row (ties to the lowest); sample: drawn from the softmax */
  readonly pick: "argmax" | "sample";
  readonly state?: unknown;
}

export interface LookupAction {
  readonly parser: "lookup-v1";
  readonly table: string;
  /** The rows allowed at a decision (a rule of ours by name; its table's first `groundRows` the ground's): the others'
   *  logits set to -1e10 before the pick, none allowed meaning all */
  readonly mask?: { readonly rule: string; readonly groundRows: number };
  /** The row picked in a mirrored view turned back (a rule of ours by name) */
  readonly mirror?: string;
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
  readonly action: LookupAction;
  readonly tickSkip: number;
  readonly timing?: { readonly schedule: string; readonly applyAtCounter: number };
  readonly teamSizes: readonly number[];
  /** Scripted controls for the moments it doesn't play (a goal's aftermath, the match's end: a rule of ours by name),
   *  its schedule held meanwhile */
  readonly moments?: string;
}

/** A bot's id (a package's folder, the built-in brains'): checked before any fetch names it */
export const BOT_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A licence file's name: one file beside bot.json (no folders) */
const LICENCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** A manifest checked for what the client reads (else what's wrong) */
export function parseManifest(json: unknown): BotManifest | string {
  if (!isRecord(json)) return "not an object";
  const { id, name, licence, policy, observation, action, tickSkip, teamSizes } = json;
  if (typeof id !== "string" || !BOT_ID.test(id)) return "its id";
  if (typeof name !== "string" || name.length === 0 || name.length > 32) return "its name";
  if (typeof licence !== "string") return "its licence";
  const { licenceFile } = json;
  if (licenceFile !== undefined && (typeof licenceFile !== "string" || !LICENCE_FILE.test(licenceFile))) return "its licence file";
  if (!isRecord(policy) || typeof policy["file"] !== "string" || !Array.isArray(policy["inputs"]) || !Array.isArray(policy["outputs"]) || !(policy["pick"] === "argmax" || policy["pick"] === "sample")) return "its policy";
  if (!isRecord(observation) || typeof observation["builder"] !== "string") return "its observation builder";
  if (!isRecord(action) || typeof action["parser"] !== "string") return "its action parser";
  if (action["parser"] === "lookup-v1" && typeof action["table"] !== "string") return "its action table";
  if (typeof tickSkip !== "number" || !Number.isInteger(tickSkip) || tickSkip < 1 || tickSkip > 120) return "its tick skip";
  if (!Array.isArray(teamSizes) || !teamSizes.every((n) => n === 1 || n === 2 || n === 3)) return "its team sizes";
  return json as unknown as BotManifest;
}

/** The policy's file for a team size (null: the package doesn't play it) */
export function policyFile(manifest: BotManifest, teamSize: number): string | null {
  return manifest.teamSizes.includes(teamSize) ? manifest.policy.file : null;
}

/** The pick's beta (bots/actions.ts pickIndex): argmax 1; sample 0.5, the plain softmax */
export function pickBeta(pick: PolicySpec["pick"]): number {
  return pick === "argmax" ? 1 : 0.5;
}
