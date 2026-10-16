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
  expect(results.map((r) => r.name).sort()).toEqual(["display", "envG", "grassReflection", "heightFog", "heightFogCapture", "netSideUv", "overlayUv", "underGlassV"]);
  for (const r of results) {
    expect(r.count, r.name).toBeGreaterThan(10);
    // (float32 on the GPU: each within its probe's own tolerance, 2e-4 at most)
    expect(r.tolerance, r.name).toBeLessThanOrEqual(2e-4);
    expect(r.maxError, `${r.name}: ${JSON.stringify(r.worst)}`).toBeLessThanOrEqual(r.tolerance);
  }
  expect(errors).toEqual([]);
});

test("a taken boost pad renders as its base alone, its FX faded out, and a big one warms up (VT-11c: the instance colours reach the shaders)", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  const pads = await page.evaluate(() =>
    (window as unknown as { carballShaderProbe: { pads: () => Record<"smallLit" | "smallTaken" | "smallBase" | "bigLit" | "bigTaken" | "bigBase" | "bigWarm" | "bigWarmBase", number> } })
      .carballShaderProbe.pads(),
  );
  // (every pad found: its dark metal and underglow are something)
  for (const v of Object.values(pads)) expect(v).toBeGreaterThan(0.002);
  // Taken: its base drawn alone (within 2 %), far under the lit look
  expect(Math.abs(pads.smallTaken - pads.smallBase) / pads.smallBase, JSON.stringify(pads)).toBeLessThan(0.02);
  expect(Math.abs(pads.bigTaken - pads.bigBase) / pads.bigBase, JSON.stringify(pads)).toBeLessThan(0.02);
  expect(pads.smallTaken, JSON.stringify(pads)).toBeLessThan(0.5 * pads.smallLit);
  expect(pads.bigTaken, JSON.stringify(pads)).toBeLessThan(0.5 * pads.bigLit);
  // A big pad 8 s into its warm-up: its cream copies revealed over most of its centre (VT-11c)
  expect(pads.bigWarm, JSON.stringify(pads)).toBeGreaterThan(2 * pads.bigWarmBase);
});

test("the post-processing chain (PP-1..10): a uniform grey at its display value, bloom round a bright patch only with Bloom on", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  for (const grey of [0.05, 0.18, 0.5]) {
    const r = await page.evaluate(
      (g) => (window as unknown as { carballShaderProbe: { post: (grey: number) => { grey: number; expected: number; ringBloom: number; ringNoBloom: number } } }).carballShaderProbe.post(g),
      grey,
    );
    // (8-bit output: within 2/255 of the tone map and remap's value; the depth of field leaves a uniform area as it is)
    expect(Math.abs(r.grey - r.expected), `grey ${String(grey)}: ${JSON.stringify(r)}`).toBeLessThan(2 / 255);
    expect(r.ringBloom, JSON.stringify(r)).toBeGreaterThan(0.05);
    expect(r.ringNoBloom, JSON.stringify(r)).toBeLessThan(0.01);
  }
});

test("the bloom's soft knee (PP-7, RV-161): nothing under linear 2; at 3 against 4 the colour times its weight, 0.375 (0.5 if it subtracted)", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  const sum = async (level: number): Promise<number> =>
    page.evaluate((l) => (window as unknown as { carballShaderProbe: { bloomSum: (level: number) => number } }).carballShaderProbe.bloomSum(l), level);
  expect(await sum(1.9)).toBe(0);
  const [three, four] = [await sum(3), await sum(4)];
  expect(four).toBeGreaterThan(0);
  expect(Math.abs(three / four - 0.375), `${String(three)} / ${String(four)}`).toBeLessThan(0.03);
});

test("the reflection capture's chain on the GPU stores what its CPU twin does (RV-201: CAP1's box, blur, bilinear up and 8-bit store)", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "carballShaderProbe" in window, null, { timeout: 30_000 });
  const r = await page.evaluate(() => (window as unknown as { carballShaderProbe: { chain: () => { texels: number; exact: number; maxCodes: number } } }).carballShaderProbe.chain());
  expect(r.texels).toBe(6 * 256 * 256 * 3);
  // (never more than one 8-bit code apart, and the same code in most texels: one off at a rounding edge, where the GPU's
  // float32 sums and its bilinear weights (about 8 bits of sub-texel precision) land the other side; smooth ramps sit on
  // edges often, 95 % exact here)
  expect(r.exact, JSON.stringify(r)).toBeGreaterThanOrEqual(0.9);
  expect(r.maxCodes, JSON.stringify(r)).toBeLessThanOrEqual(1);
});
