// Entry point: load the WebAssembly engine and the arena, then run freeplay.
import createEngine from "@engine/rlengine_web.mjs";
import arenaUrl from "@arena/collision_meshes/soccar/soccar_arena.cmf?url";
import { parseCmf } from "./engine/cmf";
import { World, initEngine } from "./engine/world";
import { Freeplay } from "./game/freeplay";
import { Online } from "./game/online";
import { Connection, devServerAddress } from "./net/connection";
import { Hud } from "./hud";
import { InputDevices } from "./input/devices";
import { buildArena } from "./render/arena";
import { loadSettings } from "./settings/settings";
import { SettingsPanel } from "./ui/settingsPanel";
import { Renderer } from "./render/renderer";
import "./style.css";

function required<T extends Element>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing ${selector}`);
  return el;
}

async function main(): Promise<void> {
  const status = required("#loading", HTMLElement);
  const canvas = required("#game", HTMLCanvasElement);

  status.textContent = "Loading physics engine…";
  const [engine, arenaBytes] = await Promise.all([
    createEngine(),
    fetch(arenaUrl).then(async (r) => {
      if (!r.ok) throw new Error(`arena mesh: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }),
  ]);

  status.textContent = "Building arena…";
  initEngine(engine, [arenaBytes]);
  const world = World.create(engine);

  // Warm up: the first ticks after loading are slow while the browser compiles the module
  const warmup = World.create(engine);
  warmup.addCar(0);
  warmup.resetKickoff(0);
  warmup.step(240);
  warmup.dispose();

  // ?server=host:infoPort (or just ?server: this host, port 4434) plays online against an rl-server
  const server = new URLSearchParams(location.search).get("server");

  const renderer = new Renderer(canvas);
  renderer.scene.add(buildArena(parseCmf(arenaBytes)));
  const hud = new Hud(required("#hud", HTMLElement));
  const input = new InputDevices(canvas);
  let settings = loadSettings();
  const panel = new SettingsPanel(document.body, settings, (next) => {
    settings = next;
  });
  let game: { frame(dt: number): void };
  if (server === null) {
    game = new Freeplay(world, renderer, input, hud, () => settings, () => !panel.isOpen);
  } else {
    status.textContent = "Connecting to the server…";
    const [host = location.hostname, port = "4434"] = server === "" ? [] : server.split(":");
    const address = await devServerAddress(host, Number(port));
    const { controller } = settings;
    const { connection, welcome } = await Connection.open(address, {
      team: 255,
      body: 0,
      dodgeDeadzone: controller.dodgeDeadzone,
      steeringSensitivity: controller.steeringSensitivity,
      airControlSensitivity: controller.aerialSensitivity,
    });
    world.loadState(welcome.snapshot);
    const online = new Online(world, renderer, input, hud, connection, welcome, () => settings, () => !panel.isOpen);
    // For the browser tests
    (window as unknown as { rlOnline?: () => unknown }).rlOnline = () => online.stats;
    game = online;
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyH" && !panel.isOpen) hud.toggleHelp(settings.bindings);
  });

  status.hidden = true;
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    game.frame(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  const status = document.querySelector("#loading");
  if (status) status.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
