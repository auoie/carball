// A deployment's page fails closed (RX29C, RV-680): on a host name that isn't this machine's, a config.json that's
// missing (404), the site's page in its place (HTML), unreadable or not answering means no search and no development
// server's in its place, as the deployment would see it; the other tests run on localhost, where a missing config.json
// is a development page (RX31). The page is served at http://carball.test by the preview server through a route (no
// name lookup), taken as a secure origin as a deployment's https one is.
import type { BrowserContext, Page, Route } from "@playwright/test";
import { expect, hideGamepads, test } from "./fixtures";

const SITE = "http://carball.test";

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", `--unsafely-treat-insecure-origin-as-secure=${SITE}`],
  },
});

/** The site's page, its files the preview server's, its config.json answered by `config` */
async function sitePage(context: BrowserContext, config: (route: Route) => Promise<void>, requests: string[]): Promise<Page> {
  await context.route(/^http:\/\/carball\.test\//, async (route) => {
    const url = route.request().url().replace(SITE, "http://localhost:4173");
    await route.fulfill({ response: await route.fetch({ url }) });
  });
  await context.route(`${SITE}/config.json`, config);
  const page = await context.newPage();
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(`${SITE}/?render=off`);
  await expect(page.locator("#loading")).toBeHidden({ timeout: 60_000 });
  return page;
}

test("off this machine, a config.json that can't be read is no search and no development server's (RX29C, RX31)", async ({ browser }) => {
  test.setTimeout(120_000);
  const cases: [string, (route: Route) => Promise<void>][] = [
    ["missing", (route) => route.fulfill({ status: 404, body: "" })],
    ["the site's page", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Carball</title>" })],
    ["unreadable", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{" })],
    ["not answering", (route) => route.abort("connectionfailed")],
  ];
  for (const [what, config] of cases) {
    const context = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await hideGamepads(context);
    const requests: string[] = [];
    const page = await sitePage(context, config, requests);
    const menu = page.locator("#main-menu");
    await menu.getByRole("button", { name: /^play$/i }).click({ timeout: 30_000 });
    await menu.getByRole("button", { name: /^find match$/i }).click();
    await expect(page.locator("#modal"), what).toContainText("The game's servers can't be reached right now. Try again later.");
    await expect(page.locator("#search-banner"), what).toBeHidden();
    // (nothing asked of a development server: its info port, its tickets)
    expect(
      requests.filter((u) => u.includes(":4434") || u.includes("/dev-ticket") || u.includes("/info")),
      what,
    ).toEqual([]);
    await context.close();
  }
});
