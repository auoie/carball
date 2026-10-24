// The browser tests' service stacks (stack/compose.yaml), one for each group of the specs that search (their searches,
// matches and bans apart): the images built from the working tree first (scripts/build_images.sh --worktree --e2e,
// tag `e2e`; CARBALL_E2E_IMAGES=TAG runs images already built under that tag instead), the stacks' secrets and their
// game servers' certificate made fresh (self-signed, for localhost: the browser takes it by its key's hash), each stack
// brought up; after the run each one's logs kept (test-results/services/<stack>.log) and the stack taken down with its
// volumes. Only 127.0.0.1 ports: each stack's edge (the page and /api/ on one origin) and its game servers' UDP.
import { execFile, spawn } from "node:child_process";
import { X509Certificate, createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
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
}

const stack = (name: string, edgePort: number, servers: Stack["servers"], spare: number, subnet: string): Stack => ({
  name,
  origin: `http://localhost:${String(edgePort)}`,
  edgePort,
  servers,
  spare,
  subnet,
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
} as const satisfies Record<string, Stack>;

/** The game servers' origins (the browser's QUIC flag: services/fixtures.ts) */
export const GAME_ORIGINS: readonly string[] = Object.values(STACKS).flatMap((s) => s.servers.map((g) => `localhost:${String(g.port)}`));

const ROOT = new URL("../../", import.meta.url).pathname;
const OUT = `${ROOT}test-results/services`;
const SECRETS = `${OUT}/secrets`;
const CERTS = `${OUT}/certs`;
/** The certificate's key's hash (SHA-256 of its SubjectPublicKeyInfo, base64), as Chrome's flag takes it */
export const SPKI_FILE = `${OUT}/spki.txt`;
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
  const key = await run("docker", ["run", "--rm", "--network", "none", `carball-api-e2e:${TAG}`, "ticket-key", "e2e"]);
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

/** `docker compose` on the stack (its project carball-e2e-NAME), its settings in the environment */
async function compose(s: Stack, args: readonly string[]): Promise<string> {
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
  const { stdout } = await run("docker", ["compose", "-p", `carball-e2e-${s.name}`, "-f", COMPOSE, ...profile, ...args], {
    env,
    maxBuffer: 1 << 28,
  });
  return stdout;
}

/** The stack's logs kept, then the stack taken down with its volumes (one a run before left behind too) */
async function down(s: Stack, keepLogs: boolean): Promise<void> {
  if (keepLogs) writeFileSync(`${OUT}/${s.name}.log`, await compose(s, ["logs", "--no-color", "--timestamps"]).catch((e: unknown) => String(e)));
  await compose(s, ["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
}

/** The images, the credentials, and every stack up and healthy */
export async function upStacks(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await images();
  await credentials();
  await Promise.all(
    Object.values(STACKS).map(async (s) => {
      await down(s, false);
      try {
        await compose(s, ["up", "--detach", "--wait", "--wait-timeout", "180"]);
      } catch (e) {
        await down(s, true).catch(() => undefined);
        throw new Error(`the ${s.name} stack didn't come up (its logs: test-results/services/${s.name}.log)`, { cause: e });
      }
    }),
  );
}

/** Every stack's logs kept and the stack taken down */
export async function downStacks(): Promise<void> {
  await Promise.all(Object.values(STACKS).map((s) => down(s, true)));
}
