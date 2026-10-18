// The shaders' own functions (the GLSL the materials embed) agree with their TypeScript twins, which the unit tests
// check against the game's rules (RV-148): run on the GPU by the ?viewer=shaders probe.
import { expect, test } from "./fixtures";

interface Comparison {
  count: number;
  maxError: number;
  tolerance: number;
  worst: { i: number[]; j: number[]; gpu: number[]; cpu: number[] } | null;
}

test("each shader function matches its TypeScript twin on the GPU", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  const results = await page.evaluate(() => {
    const probe = (window as unknown as { carballShaderProbe: { names: () => string[]; compare: (name: string) => Comparison } }).carballShaderProbe;
    return probe.names().map((name) => ({ name, ...probe.compare(name) }));
  });
  expect(results.map((r) => r.name).sort()).toEqual(["display", "envG", "netSideUv"]);
  for (const r of results) {
    expect(r.count, r.name).toBeGreaterThan(10);
    // (float32 on the GPU: each within its probe's own tolerance, 2e-4 at most)
    expect(r.tolerance, r.name).toBeLessThanOrEqual(2e-4);
    expect(r.maxError, `${r.name}: ${JSON.stringify(r.worst)}`).toBeLessThanOrEqual(r.tolerance);
  }
  expect(errors).toEqual([]);
});

test("the post-processing chain (PP-1..10): a uniform grey at its display value, bloom round a bright patch only with Bloom on", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  for (const grey of [0.05, 0.18, 0.5]) {
    const r = await page.evaluate(
      (g) =>
        (
          window as unknown as { carballShaderProbe: { post: (grey: number) => { grey: number; expected: number; ringBloom: number; ringNoBloom: number } } }
        ).carballShaderProbe.post(g),
      grey,
    );
    // (8-bit output: within 2/255 of the tone map and remap's value; the depth of field leaves a uniform area as it is)
    expect(Math.abs(r.grey - r.expected), `grey ${String(grey)}: ${JSON.stringify(r)}`).toBeLessThan(2 / 255);
    expect(r.ringBloom, JSON.stringify(r)).toBeGreaterThan(0.05);
    expect(r.ringNoBloom, JSON.stringify(r)).toBeLessThan(0.01);
  }
});

test("the bloom's soft knee (PP-7, RV-161): nothing under linear 2; at 3 against 4 the colour times its weight, 0.375 (0.5 if it subtracted)", async ({
  page,
}) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  const sum = async (level: number): Promise<number> =>
    page.evaluate((l) => (window as unknown as { carballShaderProbe: { bloomSum: (level: number) => number } }).carballShaderProbe.bloomSum(l), level);
  expect(await sum(1.9)).toBe(0);
  const [three, four] = [await sum(3), await sum(4)];
  expect(four).toBeGreaterThan(0);
  expect(Math.abs(three / four - 0.375), `${String(three)} / ${String(four)}`).toBeLessThan(0.03);
});
