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
  await page.waitForFunction(() => "rlShaderProbe" in window, null, { timeout: 30_000 });
  const results = await page.evaluate(() => {
    const probe = (window as unknown as { rlShaderProbe: { names: () => string[]; compare: (name: string) => Comparison } }).rlShaderProbe;
    return probe.names().map((name) => ({ name, ...probe.compare(name) }));
  });
  expect(results.map((r) => r.name).sort()).toEqual(["display", "envG", "grassReflection", "netSideUv", "overlayUv", "underGlassV"]);
  for (const r of results) {
    expect(r.count, r.name).toBeGreaterThan(10);
    // (float32 on the GPU: each within its probe's own tolerance, 2e-4 at most)
    expect(r.tolerance, r.name).toBeLessThanOrEqual(2e-4);
    expect(r.maxError, `${r.name}: ${JSON.stringify(r.worst)}`).toBeLessThanOrEqual(r.tolerance);
  }
  expect(errors).toEqual([]);
});

test("a taken boost pad renders at its dim look, its glow off (the instance colour reaches the fragment shader)", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "rlShaderProbe" in window, null, { timeout: 30_000 });
  const pads = await page.evaluate(() =>
    (window as unknown as { rlShaderProbe: { pads: () => { smallLit: number; smallTaken: number; bigLit: number; bigTaken: number; dim: number } } }).rlShaderProbe.pads(),
  );
  // (every disc found and lit by something)
  for (const v of Object.values(pads)) expect(v).toBeGreaterThan(0.02);
  // Taken: as the dim reference (within 10 %), far under the lit look
  expect(Math.abs(pads.smallTaken - pads.dim) / pads.dim, JSON.stringify(pads)).toBeLessThan(0.1);
  expect(Math.abs(pads.bigTaken - pads.dim) / pads.dim, JSON.stringify(pads)).toBeLessThan(0.1);
  expect(pads.smallTaken, JSON.stringify(pads)).toBeLessThan(0.5 * pads.smallLit);
  expect(pads.bigTaken, JSON.stringify(pads)).toBeLessThan(0.5 * pads.bigLit);
});

test("the post-processing chain (PP-1..10): a uniform grey at its display value, bloom round a bright patch only with Bloom on", async ({ page }) => {
  await page.goto("/?viewer=shaders");
  await page.waitForFunction(() => "rlShaderProbe" in window, null, { timeout: 30_000 });
  for (const grey of [0.05, 0.18, 0.5]) {
    const r = await page.evaluate(
      (g) => (window as unknown as { rlShaderProbe: { post: (grey: number) => { grey: number; expected: number; ringBloom: number; ringNoBloom: number } } }).rlShaderProbe.post(g),
      grey,
    );
    // (8-bit output: within 2/255 of the tone map and remap's value; the depth of field leaves a uniform area as it is)
    expect(Math.abs(r.grey - r.expected), `grey ${String(grey)}: ${JSON.stringify(r)}`).toBeLessThan(2 / 255);
    expect(r.ringBloom, JSON.stringify(r)).toBeGreaterThan(0.05);
    expect(r.ringNoBloom, JSON.stringify(r)).toBeLessThan(0.01);
  }
});
