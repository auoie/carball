// The services specs' fixtures (against the stacks of stacks.ts): the browser told to reach the stacks' game servers
// over QUIC and to take their self-signed certificate by its key's hash (Chrome's flags: production's servers have a
// public CA's), and each page's own account from the stack's e2e sign-in
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { test as base } from "../fixtures";
import { GAME_ORIGINS, SPKI_FILE } from "./stacks";

export { STACKS } from "./stacks";

export const test = base.extend({
  launchOptions: [
    async ({ launchOptions }, use) => {
      // (read as the worker starts: the setup project wrote it)
      const spki = readFileSync(SPKI_FILE, "utf8").trim();
      const flags = [`--origin-to-force-quic-on=${GAME_ORIGINS.join(",")}`, `--ignore-certificate-errors-spki-list=${spki}`];
      await use({ ...launchOptions, args: [...(launchOptions.args ?? []), ...flags] });
    },
    { scope: "worker" },
  ],
});

/** The context's browser signed in to a new account of its own (the stack's POST /api/e2e/sign-in, from a page on its
 *  origin as the page's writes go: an account as a sign-up makes one, `label` and a few random letters its name); its
 *  id and name */
export async function signIn(context: BrowserContext, label: string): Promise<{ account: string; name: string }> {
  const name = `${label} ${randomBytes(3).toString("hex")}`;
  const page = await context.newPage();
  await page.goto("/healthz");
  const answer = await page.evaluate(
    async (body) => {
      const response = await fetch("/api/e2e/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Carball": "1" },
        body: JSON.stringify(body),
      });
      return { status: response.status, account: ((await response.json()) as { account?: unknown }).account };
    },
    { subject: `e2e-${randomUUID()}`, name },
  );
  await page.close();
  if (answer.status !== 200 || typeof answer.account !== "string") throw new Error(`the e2e sign-in: HTTP ${String(answer.status)}`);
  return { account: answer.account, name };
}
