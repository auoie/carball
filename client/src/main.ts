// Entry point: load the WebAssembly engine and the arena, then run freeplay.
import createEngine from "@engine/rlengine_web.mjs";
import { Color } from "three";
import { World, initEngine } from "./engine/world";
import { Freeplay } from "./game/freeplay";
import { Online } from "./game/online";
import { Connection, devServerAddress } from "./net/connection";
import { GameAudio } from "./audio/audio";
import { Hud } from "./hud";
import { InputDevices } from "./input/devices";
import { ArenaView } from "./render/arena";
import { loadGameCage } from "./render/cage";
import { loadFennec } from "./render/fennec";
import { type ThemeName, createTheme, themeName } from "./render/themes";
import { loadSettings } from "./settings/settings";
import { SettingsPanel } from "./ui/settingsPanel";
import { Renderer } from "./render/renderer";
import "./style.css";

// Every arena collision mesh: scripts/arena_gen.py writes one file per piece (each its own static body, as in the game)
const arenaUrls = Object.values(
  import.meta.glob<string>("@arena/collision_meshes/soccar/*.cmf", { query: "?url", import: "default", eager: true }),
);

function required<T extends Element>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing ${selector}`);
  return el;
}

async function main(): Promise<void> {
  const status = required("#loading", HTMLElement);
  const canvas = required("#game", HTMLCanvasElement);

  status.textContent = "Loading physics engine…";
  const [engine, arenaMeshes] = await Promise.all([
    createEngine(),
    Promise.all(
      arenaUrls.map(async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`arena mesh ${url}: HTTP ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      }),
    ),
  ]);
  if (arenaMeshes.length === 0) throw new Error("no arena meshes (run scripts/arena_gen.py)");

  status.textContent = "Building arena…";
  initEngine(engine, arenaMeshes);
  // (the game's Fennec and cage, where the dev server has them: src/render/fennec.ts, src/render/cage.ts)
  await Promise.all([loadFennec(), loadGameCage()]);
  const world = World.create(engine);

  // Warm up: the first ticks after loading are slow while the browser compiles the module
  const warmup = World.create(engine);
  warmup.addCar(0);
  warmup.resetKickoff(0);
  warmup.step(240);
  warmup.dispose();

  // ?server=host:infoPort (or just ?server: this host, port 4434) plays online against an rl-server
  const params = new URLSearchParams(location.search);
  // ?viewer=car: the car model alone on a turntable (for comparing it with the game's)
  if (params.get("viewer") === "car") {
    const viewerWorld = World.create(engine);
    const id = viewerWorld.addCar(0);
    const { showCarViewer } = await import("./debug/carViewer");
    const view = showCarViewer(new Renderer(canvas), viewerWorld.carConfig(id), new Color(0xff7a1a));
    (window as unknown as { rlCarViewer?: unknown }).rlCarViewer = { view };
    view(-140, 15);
    status.hidden = true;
    return;
  }
  // ?viewer=arena: the arena alone under a free camera (for comparing it with the game's)
  if (params.get("viewer") === "arena") {
    const viewerWorld = World.create(engine);
    const id = viewerWorld.addCar(0);
    const { showArenaViewer } = await import("./debug/arenaViewer");
    const view = showArenaViewer(new Renderer(canvas), await createTheme(themeName(params.get("theme"))), viewerWorld.carConfig(id));
    (window as unknown as { rlArenaViewer?: unknown }).rlArenaViewer = { view };
    view({ eye: { x: 0, y: -4000, z: 600 }, target: { x: 0, y: 0, z: 600 } });
    status.hidden = true;
    return;
  }
  const server = params.get("server");

  // ?theme=meadow: the arena's look (src/render/themes/), and its soundscape
  const name = themeName(params.get("theme"));
  const theme = await createTheme(name);
  const renderer = new Renderer(canvas);
  renderer.scene.background = theme.background;
  renderer.scene.fog = theme.fog;
  const arena = new ArenaView(theme);
  renderer.scene.add(arena.root);
  const hud = new Hud(required("#hud", HTMLElement));
  const input = new InputDevices(canvas);
  let settings = loadSettings();
  const audio = new GameAudio(name);
  audio.apply(settings.audio, settings.options.muted);
  const panel = new SettingsPanel(document.body, settings, (next) => {
    settings = next;
    audio.apply(next.audio, next.options.muted);
  });
  // For the browser tests
  (window as unknown as { rlAudio?: () => unknown }).rlAudio = () => audio.stats;
  (window as unknown as { rlAmbienceLevels?: (theme: ThemeName, seconds: number) => Promise<unknown> }).rlAmbienceLevels = async (t, seconds) =>
    (await import("./audio/levels")).ambienceLevels(t, seconds);
  let game: { frame(dt: number): void };
  if (server === null) {
    const freeplay = new Freeplay(world, renderer, arena, input, hud, audio, () => settings, () => !panel.isOpen);
    // For screenshots and the browser tests
    (window as unknown as { rlFreeplay?: unknown }).rlFreeplay = {
      place: (car: { x: number; y: number; yaw: number }, ball?: { x: number; y: number; z: number }) => {
        freeplay.debugPlace(car, ball);
      },
    };
    game = freeplay;
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
      autoSkipReplay: settings.options.autoSkipReplay,
    });
    world.loadState(welcome.snapshot);
    const online = new Online(world, renderer, arena, input, hud, audio, connection, welcome, () => settings, () => !panel.isOpen);
    // For the browser tests
    (window as unknown as { rlOnline?: () => unknown }).rlOnline = () => online.stats;
    game = online;
  }

  window.addEventListener("keydown", (e) => {
    if (panel.isOpen) return;
    if (e.code === "KeyH") hud.toggleHelp(settings.bindings);
    if (e.code === "KeyM") panel.apply({ ...settings, options: { ...settings.options, muted: !settings.options.muted } });
  });

  status.hidden = true;
  let last = performance.now();
  const frame = (now: number): void => {
    // (the games clamp their world time, LT-3: 0.0005 .. 0.4 s)
    const dt = Math.min(0.4, (now - last) / 1000);
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
