// Headless test of the WebAssembly engine module in Node.
//   node engine/wasm/test_node.mjs [engine/build-wasm/rlengine.mjs] [out/arena/collision_meshes/soccar/soccar_arena.cmf]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../../", import.meta.url);
const modulePath = process.argv[2] ?? new URL("engine/build-wasm/rlengine.mjs", root).pathname;
const meshPath = process.argv[3] ?? new URL("out/arena/collision_meshes/soccar/soccar_arena.cmf", root).pathname;

const { default: createEngine } = await import(pathToFileURL(resolve(modulePath)).href);
const E = await createEngine();
E.init([new Uint8Array(readFileSync(meshPath))]);

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log("  FAIL", msg); } };
const vec = (a, i) => [a[i], a[i + 1], a[i + 2]].map((v) => v.toFixed(2)).join(", ");

const sim = new E.Sim();
const blue = sim.addCar(0, 0);   // Octane
const orange = sim.addCar(1, 1); // Dominus
sim.resetKickoff(3);
check(sim.carIds().length === 2, "two cars");
check(sim.boostPads().length / E.PAD_SIZE === 34, "34 boost pads");

// Both cars drive at the ball with boost; someone should touch it within 3 s
const drive = () => {
  for (const id of [blue, orange]) {
    const c = sim.carState(id), b = sim.ballState();
    const dx = b[0] - c[E.CAR_POS], dy = b[1] - c[E.CAR_POS + 1];
    const side = c[E.CAR_ROT] * dy - c[E.CAR_ROT + 1] * dx; // forward x toBall (z)
    sim.setControls(id, 1, side > 0 ? 1 : -1, 0, 0, 0, false, true, false, false);
  }
};
const t0 = performance.now();
for (let i = 0; i < 360; i++) { drive(); sim.step(1); }
const ms = performance.now() - t0;
const ball = sim.ballState();
console.log(`after 3 s: ball (${vec(ball, E.BALL_POS)}) speed ${Math.hypot(ball[3], ball[4], ball[5]).toFixed(1)}`);
for (const id of [blue, orange]) {
  const c = sim.carState(id);
  console.log(`  car ${id}: pos (${vec(c, E.CAR_POS)}) boost ${c[E.CAR_BOOST].toFixed(1)} last ball hit tick ${c[E.CAR_LAST_BALL_HIT_TICK]}`);
}
check(Math.hypot(ball[3], ball[4], ball[5]) > 100, "ball was hit");
console.log(`  360 ticks with state reads: ${ms.toFixed(1)} ms (${(ms / 360 * 1000).toFixed(0)} us/tick)`);

// Rollback: save, simulate, restore, simulate again with the same inputs -> identical state
const saved = sim.saveState();
const runInputs = () => {
  for (let i = 0; i < 240; i++) {
    sim.setControls(blue, 1, Math.sin(i / 20) > 0 ? 1 : -1, -1, 0, 0, i % 50 === 0, i % 3 === 0, false, false);
    sim.setControls(orange, 1, 0.5, 0, 1, 0, i % 70 === 0, true, i % 40 < 10, false);
    sim.step(1);
  }
  return [...sim.ballState(), ...sim.carState(blue), ...sim.carState(orange)];
};
const a = runInputs();
sim.loadState(saved);
check(sim.carIds().length === 2, "cars lost on load");
const b = runInputs();
const maxDiff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
// Not exactly 0: Bullet's cached contact points are not part of the snapshot (see engine/README.md)
check(maxDiff < 1, `restored replay drifted ${maxDiff} uu`);
console.log(`rollback replay after 2 s: max difference ${maxDiff.toFixed(3)} (${saved.length} byte snapshot)`);

// Events: a car driving into the other at supersonic speed demolishes it
sim.resetKickoff(3);
sim.takeEvents();
const s = new Float32Array(E.CAR_SIZE);
s.set([1, 0, 0, 0, 1, 0, 0, 0, 1], E.CAR_ROT);
s.set([0, 0, 17], E.CAR_POS); s.set([2250, 0, 0], E.CAR_VEL); s[E.CAR_BOOST] = 100;
sim.setCarState(blue, s);
const v = new Float32Array(E.CAR_SIZE);
v.set([0, 1, 0, -1, 0, 0, 0, 0, 1], E.CAR_ROT);
v.set([400, 0, 17], E.CAR_POS);
sim.setCarState(orange, v);
for (let i = 0; i < 60; i++) { sim.setControls(blue, 1, 0, 0, 0, 0, false, true, false, false); sim.step(1); }
const events = [...sim.takeEvents()];
const demos = [];
for (let i = 0; i < events.length; i += 3) if (events[i] === E.EVENT_DEMO) demos.push(events.slice(i, i + 3));
check(demos.length === 1 && demos[0][1] === blue && demos[0][2] === orange, `expected one demo, got ${JSON.stringify(events)}`);
check(sim.carState(orange)[E.CAR_DEMOED] === 1, "victim demoed flag");
console.log(`demo event: ${JSON.stringify(demos)}`);

sim.delete();
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
