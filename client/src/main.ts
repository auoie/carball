// Entry point: load the WebAssembly engine and the arena, then run freeplay.
import { setInterfaceScale } from "./ui/stage";
import createEngine from "@engine/rlengine_web.mjs";
import { CarBody, World, initEngine } from "./engine/world";
import { Freeplay } from "./game/freeplay";
import { Online } from "./game/online";
import { Connection, devServerAddress } from "./net/connection";
import { GameAudio } from "./audio/audio";
import { Hud } from "./hud";
import { InputDevices } from "./input/devices";
import { ArenaView } from "./render/arena";
import { loadGameCage } from "./render/cage";
import { loadGameFieldPlan } from "./render/stadiumFieldRules";
import { loadDemolitionHusks } from "./render/demolition";
import { loadFennec } from "./render/fennec";
import { TEAM_CAR_COLORS } from "./render/entities";
import { type ThemeName, createTheme, themeName } from "./render/themes";
import { type Settings, loadSettings } from "./settings/settings";
import { SettingsPanel } from "./ui/settingsPanel";
import { MatchMenu } from "./ui/matchMenu";
import { ChatLog, QuickChatPanel } from "./ui/chatLog";
import { HeldScoreboard } from "./ui/scoreboard";
import { StatPopups, StatTicker } from "./ui/statFeed";
import { PlayersMenu, Toast } from "./ui/playersMenu";
import { EndScreen, PodiumTags, ScreenDimming, WinnerBanner } from "./ui/endOfMatch";
import { Nameplates } from "./ui/nameplates";
import { MainMenu } from "./ui/mainMenu";
import { PauseMenu } from "./ui/pauseMenu";
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
  await Promise.all([loadFennec(), loadGameCage(), loadDemolitionHusks(), loadGameFieldPlan()]);
  const world = World.create(engine);

  // Warm up: the first ticks after loading are slow while the browser compiles the module
  const warmup = World.create(engine);
  warmup.addCar(0);
  warmup.resetKickoff(0);
  warmup.step(240);
  warmup.dispose();

  // ?server=host:infoPort (or just ?server: this host, port 4434) plays online against an rl-server
  const params = new URLSearchParams(location.search);
  // ?viewer=car: the car model alone on a turntable (for comparing it with the game's); &team=1: orange; &body=N: another
  // hitbox preset (the Octane's wears the Fennec where the dev server has it)
  if (params.get("viewer") === "car") {
    const viewerWorld = World.create(engine);
    const team = params.get("team") === "1" ? 1 : 0;
    const bodies = [CarBody.Octane, CarBody.Dominus, CarBody.Plank, CarBody.Breakout, CarBody.Hybrid, CarBody.Merc];
    const id = viewerWorld.addCar(team, bodies[Number(params.get("body") ?? 0)] ?? CarBody.Octane);
    const { showCarViewer } = await import("./debug/carViewer");
    const view = showCarViewer(new Renderer(canvas), viewerWorld.carConfig(id), TEAM_CAR_COLORS[team], team);
    (window as unknown as { rlCarViewer?: unknown }).rlCarViewer = { view };
    view(-140, 15);
    status.hidden = true;
    return;
  }
  // ?viewer=shaders: the shaders' functions on the GPU against their TypeScript twins (the e2e suite's)
  if (params.get("viewer") === "shaders") {
    const { shaderProbe } = await import("./debug/shaderProbe");
    (window as unknown as { rlShaderProbe?: unknown }).rlShaderProbe = shaderProbe(canvas);
    status.hidden = true;
    return;
  }
  // ?viewer=arena: the arena alone under a free camera (for comparing it with the game's)
  if (params.get("viewer") === "arena") {
    const viewerWorld = World.create(engine);
    const id = viewerWorld.addCar(0);
    const { showArenaViewer } = await import("./debug/arenaViewer");
    const viewer = showArenaViewer(new Renderer(canvas), await createTheme(themeName(params.get("theme"))), viewerWorld.carConfig(id));
    const { view } = viewer;
    (window as unknown as { rlArenaViewer?: unknown }).rlArenaViewer = viewer;
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
  renderer.heightFog = theme.heightFog ?? false;
  const arena = new ArenaView(theme);
  renderer.scene.add(arena.root);
  // (the arena's reflection capture, once: before the first frame, the cars and ball not yet drawn in it)
  renderer.beforeNextFrame((gl, scene) => {
    arena.capture(gl, scene);
  });
  const hud = new Hud(required("#hud", HTMLElement));
  const input = new InputDevices(canvas);
  let settings = loadSettings();
  const audio = new GameAudio(name);
  audio.apply(settings.audio, settings.options.muted);
  renderer.postOptions = settings.options;
  // (the Interface tab: the HUD's stage and its options)
  const applyInterface = (s: Settings): void => {
    setInterfaceScale(s.interface.scale, s.interface.displayScale);
    hud.configure(s.interface);
  };
  applyInterface(settings);
  const panel = new SettingsPanel(document.body, settings, (next) => {
    settings = next;
    audio.apply(next.audio, next.options.muted);
    renderer.postOptions = next.options;
    applyInterface(next);
  });
  // The menus (MENU-1/4): Escape brings up the pause menu, the settings over it; the main menu as freeplay's page opens
  let mainMenu: MainMenu | null = null;
  const pause: PauseMenu = new PauseMenu(document.body, {
    resume: () => {
      pause.close();
    },
    settings: () => {
      panel.open();
    },
    ...(server === null
      ? {
          exit: () => {
            pause.close();
            mainMenu?.open();
          },
        }
      : {}),
  });
  const menusOpen = (): boolean => panel.isOpen || pause.isOpen || (mainMenu?.isOpen ?? false);
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      if (panel.isOpen) panel.escape();
      else if (mainMenu?.isOpen) mainMenu.back();
      else pause.toggle();
    },
    { capture: true },
  );
  // For the browser tests
  (window as unknown as { rlAudio?: () => unknown }).rlAudio = () => audio.stats;
  (window as unknown as { rlAmbienceLevels?: (theme: ThemeName, seconds: number) => Promise<unknown> }).rlAmbienceLevels = async (t, seconds) =>
    (await import("./audio/levels")).ambienceLevels(t, seconds);
  let game: { frame(dt: number): void };
  if (server === null) {
    const freeplay = new Freeplay(world, renderer, arena, input, hud, audio, () => settings, () => !menusOpen());
    mainMenu = new MainMenu(document.body, {
      freePlay: () => {
        mainMenu?.close();
      },
      join: (address) => {
        const query = new URLSearchParams(location.search);
        query.set("server", address);
        location.assign(`${location.pathname}?${query.toString()}`);
      },
      settings: () => {
        panel.open();
      },
    });
    // For screenshots and the browser tests
    (window as unknown as { rlFreeplay?: unknown }).rlFreeplay = {
      place: (car: { x: number; y: number; yaw: number; boost?: number }, ball?: { x: number; y: number; z: number }) => {
        freeplay.debugPlace(car, ball);
      },
      car: () => freeplay.debugCar(),
      demolition: (at: { x: number; y: number; z: number }) => {
        freeplay.debugDemolition(at);
      },
      particles: () => freeplay.debugParticles(),
      pads: () => freeplay.debugPads(),
      // (the camera's fade as the post-processing draws it: RV-159, RV-175)
      cameraFade: () => renderer.cameraFade,
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
      name: settings.chat.name,
      quickChat: settings.chat.quickChatFilter,
      blockNonTactical: settings.chat.blockNonTactical,
    });
    world.loadState(welcome.snapshot);
    // (a closed tab leaves at once, not when the session times out)
    window.addEventListener("pagehide", () => {
      connection.close();
    });
    const hudRoot = required("#hud", HTMLElement);
    const chat = { log: new ChatLog(hudRoot), panel: new QuickChatPanel(hudRoot) };
    // (the dimming under everything else on the HUD)
    const dimmingUi = new ScreenDimming(hudRoot);
    hudRoot.prepend(...hudRoot.querySelectorAll(".screen-filter, .podium-vignette"));
    const statsUi = {
      scoreboard: new HeldScoreboard(hudRoot),
      popups: new StatPopups(hudRoot),
      ticker: new StatTicker(hudRoot),
      toast: new Toast(hudRoot),
      nameplates: new Nameplates(hudRoot),
    };
    // Back to the main menu (the menu's leave, the end screen's exit)
    const leave = (): void => {
      connection.close();
      const query = new URLSearchParams(location.search);
      query.delete("server");
      location.assign(`${location.pathname}${query.size > 0 ? `?${query.toString()}` : ""}`);
    };
    const endScreen = new EndScreen(hudRoot, {
      ready: () => {
        online.readyForNextMatch();
      },
      exit: leave,
      options: () => {
        panel.open();
      },
    });
    const endUi = { banner: new WinnerBanner(hudRoot), dimming: dimmingUi, tags: new PodiumTags(hudRoot), endScreen };
    const online: Online = new Online(world, renderer, arena, input, hud, audio, connection, welcome, () => settings, () => !menusOpen(), chat, statsUi, endUi);
    const players = new PlayersMenu(pause.players, (car, what) => {
      online.togglePlayer(car, what);
    });
    // For the browser tests
    (window as unknown as { rlOnline?: () => unknown }).rlOnline = () => online.stats;
    // The pause menu's match buttons: forfeit or vote (the server's), leave (back to the main menu)
    const menu = new MatchMenu(pause.match, (action) => {
      if (action === "leave") {
        leave();
        return;
      }
      online.voteForfeit();
      pause.close();
    });
    game = {
      frame(dt) {
        online.frame(dt);
        menu.update(online.menuItems(), pause.isOpen);
        players.update(online.players(), pause.isOpen);
      },
    };
  }

  window.addEventListener("keydown", (e) => {
    if (panel.isOpen || (mainMenu?.isOpen ?? false)) return;
    if (e.code === "KeyH") hud.toggleHelp(settings.bindings);
    if (e.code === "KeyM") panel.apply({ ...settings, options: { ...settings.options, muted: !settings.options.muted } });
  });

  status.hidden = true;
  let last = performance.now();
  const frame = (now: number): void => {
    // (raw: the games take their clamped real and world times from it, LT-3)
    const dt = (now - last) / 1000;
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
