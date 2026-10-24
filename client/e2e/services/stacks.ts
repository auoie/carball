// The browser tests' service stacks (stack/compose.yaml), one for each group of the specs that search (their searches,
// matches and bans apart): the images built from the working tree first (scripts/build_images.sh --worktree --e2e,
// tag `e2e`; CARBALL_E2E_IMAGES=TAG runs images already built under that tag instead), the stacks' secrets and their
// game servers' certificate made fresh (self-signed, for localhost: the browser takes it by its key's hash), each stack
// brought up; after the run each one's logs kept (test-results/services/<stack>.log) and the stack taken down with its
// volumes, an interrupted run's too (interrupts.ts). Loopback ports alone: each stack's edge (the page and /api/ on one
// origin) and its game servers' UDP (on ::1 too). One run at a time: a lock names the run whose stacks are up (RV-1047);
// the stacks' secrets and certificate in client/.e2e-services/, outside test-results (which each Playwright start wipes).
import { execFile, execFileSync, spawn } from "node:child_process";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GameServer {
  readonly id: string;
  readonly name: string;
  readonly port: number;
}

export interface Stack {
  readonly name: string;
  /** The page's origin, the edge's (http: localhost is a secure context, its __Host- cookies kept) */
  readonly origin: string;
  readonly edgePort: number;
  /** The page's game servers (config.json: id, name, WebTransport port), the second only in the regions stack */
  readonly servers: readonly [GameServer, ...GameServer[]];
  /** The second server's port (compose.yaml's GAME_B_PORT, given whether or not that server runs) */
  readonly spare: number;
  /** The stack's network (its edge's address the service believes CF-Connecting-IP from) */
  readonly subnet: string;
  /** A compose file over compose.yaml (stack/), if any */
  readonly override?: string;
}

const stack = (name: string, edgePort: number, servers: Stack["servers"], spare: number, subnet: string, override?: string): Stack => ({
  name,
  origin: `http://localhost:${String(edgePort)}`,
  edgePort,
  servers,
  spare,
  subnet,
  ...(override === undefined ? {} : { override }),
});

export const STACKS = {
  queue: stack("queue", 14460, [{ id: "local", name: "Local", port: 14461 }], 14462, "10.211.80.0/24"),
  edges: stack("edges", 14463, [{ id: "local", name: "Local", port: 14464 }], 14465, "10.211.81.0/24"),
  regions: stack(
    "regions",
    14466,
    [
      { id: "region-a", name: "Region A", port: 14467 },
      { id: "region-b", name: "Region B", port: 14468 },
    ],
    14468,
    "10.211.82.0/24",
  ),
  // (the real flows: a sign-up, a match's result, a leaver's ban, a rejoin across two servers; forfeit votes at once)
  flows: stack(
    "flows",
    14469,
    [
      { id: "region-a", name: "Region A", port: 14470 },
      { id: "region-b", name: "Region B", port: 14471 },
    ],
    14471,
    "10.211.83.0/24",
    "flows.yaml",
  ),
} as const satisfies Record<string, Stack>;

/** The game servers' origins (the browser's QUIC flag: services/fixtures.ts) */
export const GAME_ORIGINS: readonly string[] = Object.values(STACKS).flatMap((s) => s.servers.map((g) => `localhost:${String(g.port)}`));

const ROOT = new URL("../../", import.meta.url).pathname;
/** The run's logs (each stack's, the image build's) */
const OUT = `${ROOT}test-results/services`;
/** The stacks' own files: their secrets and certificate (bind-mounted while they run) and the run's lock */
const WORK = `${ROOT}.e2e-services`;
const SECRETS = `${WORK}/secrets`;
const CERTS = `${WORK}/certs`;
/** The run whose stacks are up: its Playwright runner's process id (the setup's parent), whose interrupt takes them down */
const LOCK = `${WORK}/lock`;
/** The certificate's key's hash (SHA-256 of its SubjectPublicKeyInfo, base64), as Chrome's flag takes it */
export const SPKI_FILE = `${WORK}/spki.txt`;
const COMPOSE = new URL("stack/compose.yaml", import.meta.url).pathname;
/** The images' tag: the working tree's build, or CARBALL_E2E_IMAGES's */
const TAG = process.env.CARBALL_E2E_IMAGES ?? "e2e";

/** The images the build tags (carball-NAME:TAG) */
const IMAGES = ["web", "game", "api", "game-e2e", "api-e2e"].map((name) => `carball-${name}:${TAG}`);

/** The ids of those images there are now */
async function imageIds(): Promise<string[]> {
  const { stdout } = await run("docker", ["image", "inspect", "--format", "{{.Id}}", ...IMAGES]).catch((e: unknown) => ({
    stdout: (e as { stdout?: string }).stdout ?? "",
  }));
  return stdout.split("\n").filter((id) => id !== "");
}

/** The images, built from the working tree unless CARBALL_E2E_IMAGES names ones already built (the build's output in
 *  test-results/services/build.log); the previous run's that this build left untagged removed, by their ids (one
 *  another tag still names stays) */
async function images(): Promise<void> {
  if (process.env.CARBALL_E2E_IMAGES !== undefined) return;
  const before = await imageIds();
  const log = openSync(`${OUT}/build.log`, "w");
  const code = await new Promise<number | null>((done) => {
    spawn(`${ROOT}../scripts/build_images.sh`, ["--worktree", "--e2e", TAG], { stdio: ["ignore", log, log] }).on("close", done);
  });
  closeSync(log);
  if (code !== 0) throw new Error(`scripts/build_images.sh --worktree --e2e ${TAG} failed: test-results/services/build.log`);
  const now = await imageIds();
  for (const old of before.filter((id) => !now.includes(id))) {
    // (only one no tag names now: by its id, rmi would take every tag of a single repository with it, a release's too)
    const tags = await run("docker", ["image", "inspect", "--format", "{{len .RepoTags}}", old]).catch(() => null);
    if (tags?.stdout.trim() === "0") await run("docker", ["rmi", old]).catch(() => undefined);
  }
}

/** A secret's file, readable by the containers' users (the stacks' throwaway secrets) */
function secret(name: string, value: string): void {
  writeFileSync(`${SECRETS}/${name}`, `${value}\n`);
  chmodSync(`${SECRETS}/${name}`, 0o644);
}

/** The stacks' secrets (the database's two passwords, the game servers' token, the deletion key, the ticket key: its
 *  seed and public line, from the service's own command) and the game servers' certificate (ECDSA P-256, localhost,
 *  ten days), its key's hash written for the browser's flag */
async function credentials(): Promise<void> {
  mkdirSync(SECRETS, { recursive: true });
  mkdirSync(CERTS, { recursive: true });
  for (const name of ["db_owner_password", "db_password"]) secret(name, randomBytes(18).toString("base64url"));
  secret("game_token", randomBytes(36).toString("base64url"));
  secret("deletion_key", randomBytes(48).toString("base64"));
  const key = await run("docker", ["run", "--rm", "--pull=never", "--network", "none", `carball-api-e2e:${TAG}`, "ticket-key", "e2e"]);
  secret("ticket_key", key.stdout.trim());
  secret("ticket_keys", key.stderr.trim());
  await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-keyout",
    `${CERTS}/privkey.pem`,
    "-out",
    `${CERTS}/fullchain.pem`,
    "-days",
    "10",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ]);
  chmodSync(`${CERTS}/privkey.pem`, 0o644);
  const spki = new X509Certificate(readFileSync(`${CERTS}/fullchain.pem`)).publicKey.export({ type: "spki", format: "der" });
  writeFileSync(SPKI_FILE, createHash("sha256").update(spki).digest("base64"));
}

/** `docker compose`'s arguments and environment for the stack (its project carball-e2e-NAME, its settings) */
function composeCall(s: Stack, args: readonly string[]): { args: string[]; env: NodeJS.ProcessEnv } {
  const env = {
    ...process.env,
    TAG,
    EDGE_PORT: String(s.edgePort),
    GAME_A_PORT: String(s.servers[0].port),
    GAME_B_PORT: String(s.spare),
    SUBNET: s.subnet,
    SECRETS,
    CERTS,
    GAME_SERVERS: s.servers.map((g) => `${g.id}|${g.name}|https://localhost:${String(g.port)}/play`).join(","),
  };
  const profile = s.servers.length > 1 ? ["--profile", "regions"] : [];
  const files = ["-f", COMPOSE, ...(s.override === undefined ? [] : ["-f", new URL(`stack/${s.override}`, import.meta.url).pathname])];
  return { args: ["compose", "-p", `carball-e2e-${s.name}`, ...files, ...profile, ...args], env };
}

/** `docker compose` on the stack */
async function compose(s: Stack, args: readonly string[]): Promise<string> {
  const call = composeCall(s, args);
  const { stdout } = await run("docker", call.args, { env: call.env, maxBuffer: 1 << 28 });
  return stdout;
}

/** The stack's logs kept, then the stack taken down with its volumes (one a run before left behind too) */
async function down(s: Stack, keepLogs: boolean): Promise<void> {
  if (keepLogs) writeFileSync(`${OUT}/${s.name}.log`, await compose(s, ["logs", "--no-color", "--timestamps"]).catch((e: unknown) => String(e)));
  await compose(s, ["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
}

/** Whether process `pid` is alive */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
}

/** The lock taken for the runner `owner` (the setup's parent process): refused while another live run holds it; one an
 *  ended run left (killed outright) taken over, its stacks the pre-clean's */
function lock(owner: number): void {
  mkdirSync(WORK, { recursive: true });
  const held = existsSync(LOCK) ? Number(readFileSync(LOCK, "utf8")) : NaN;
  if (Number.isInteger(held) && held !== owner && alive(held)) {
    throw new Error(`another run (process ${String(held)}) has the services' stacks up: wait for it, or stop it (${LOCK})`);
  }
  writeFileSync(LOCK, String(owner));
}

/** The stacks of an ended run (the same project names: killed, or interrupted before its take-down) gone first, then
 *  the images (theirs no longer in use), the credentials, and every stack up and healthy; one that doesn't come up: all
 *  of them taken down, its logs kept, once every start has settled (RV-1046) */
export async function upStacks(): Promise<void> {
  lock(process.ppid);
  mkdirSync(OUT, { recursive: true });
  await Promise.all(Object.values(STACKS).map((s) => down(s, false)));
  await images();
  await credentials();
  const started = await Promise.allSettled(Object.values(STACKS).map((s) => compose(s, ["up", "--detach", "--wait", "--wait-timeout", "180"])));
  const failed = Object.values(STACKS).filter((_, i) => started[i]?.status === "rejected");
  if (failed.length > 0) {
    await downStacks().catch(() => undefined);
    const names = failed.map((s) => s.name).join(", ");
    throw new Error(`the ${names} stack didn't come up (its logs: test-results/services/)`, {
      cause: started.find((r) => r.status === "rejected")?.reason,
    });
  }
}

/** Every stack's logs kept and the stack taken down; the lock let go */
export async function downStacks(): Promise<void> {
  await Promise.all(Object.values(STACKS).map((s) => down(s, true)));
  rmSync(LOCK, { force: true });
}

/** An interrupted run's take-down (interrupts.ts: Ctrl-C, SIGTERM), synchronous: the stacks down if this runner (`owner`)
 *  holds the lock, the lock let go; nothing if the run's own teardown came first, or it brought none up */
export function downStacksOnInterrupt(owner: number): void {
  if (!existsSync(LOCK) || Number(readFileSync(LOCK, "utf8")) !== owner) return;
  for (const s of Object.values(STACKS)) {
    const call = composeCall(s, ["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
    try {
      execFileSync("docker", call.args, { env: call.env, stdio: "ignore", timeout: 60_000 });
    } catch {
      // (the next run's pre-clean takes what's left)
    }
  }
  rmSync(LOCK, { force: true });
}
