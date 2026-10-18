// Entry point: load the WebAssembly engine and the arena, then run freeplay.
import { setInterfaceScale } from "./ui/stage";
import { fitHudFonts, loadHudFonts } from "./ui/hudFont";
import createEngine from "@engine/carball_engine_web.mjs";
import { CarBody, World, initEngine } from "./engine/world";
import { Freeplay } from "./game/freeplay";
import { Online } from "./game/online";
import type { SessionEnd } from "./game/sessionEnd";
import { Matchmaking, OWN_SEARCH_TEXT, PLAYLISTS } from "./game/matchmaking";
import { Connection, type MatchSession, RefusedError, devServerAddress } from "./net/connection";
import { joinPreferences } from "./net/joinPreferences";
import { REFUSED_TOKEN } from "./net/protocol";
import { type MenuNotice, pageUrl, queueAddress, storeClaim, storeNotice, takeClaim, takeNotice } from "./net/pages";
import { Search } from "./net/search";
import { GameAudio } from "./audio/audio";
import { Hud } from "./hud";
import { InputDevices, readGamepad } from "./input/devices";
import { ArenaView } from "./render/arena";
import { loadDemolitionHusks } from "./render/demolition";
import { loadFennec } from "./render/fennec";
import { hasCarModel, loadCarModels } from "./render/carGlb";
import { TEAM_CAR_COLORS } from "./render/entities";
import { MAP_NAMES, type ThemeName, createTheme, themeOfMap } from "./render/themes";
import { CARS, carChoice, storedCar, storedTeam } from "./game/cars";
import type { BotListing } from "./bots/listing";
import { BOT_MATCH_TEXT } from "./local/botText";
import { GaragePreview } from "./ui/garagePreview";
import type { Theme } from "./render/themes/theme";
import { STAT_GRAPHS, type Settings, loadSettings, resolveSettings } from "./settings/settings";
import type { Vec3 } from "./math/vec";
import { AutoVideoGuard, RENDER_QUALITY_SCALE, guardStep, guardWanted, isWeakGpu } from "./settings/video";
import { applyWorldDetail, sceneDetail } from "./render/detail";
import { particleDetail } from "./render/particles";
import { applyShaderQuality } from "./render/shaderQuality";
import { migrateBrowserStorage } from "./settings/storageKeys";
import { SettingsPanel } from "./ui/settingsPanel";
import { MatchMenu } from "./ui/matchMenu";
import { ChatLog, QuickChatPanel } from "./ui/chatLog";
import { HeldScoreboard } from "./ui/scoreboard";
import { StatPopups, StatTicker } from "./ui/statFeed";
import { PlayersMenu, Toast } from "./ui/playersMenu";
import { EndScreen, PodiumTags, ScreenDimming, WinnerBanner } from "./ui/endOfMatch";
import { Nameplates } from "./ui/nameplates";
import { LoadingScreen, showLoadingFailure } from "./ui/loadingScreen";
import { TRAINING_TEXT, type TrainingKeys, TrainingHud } from "./ui/trainingHud";
import { type KeyGlyph, keyGlyph } from "./ui/keyGlyph";
import type { GamepadInput, KeyboardInput } from "./input/bindings";
import { type PackListing, listPacks, loadPack } from "./training/packs";
import { type TrainingPack, parsePack } from "./training/pack";
import { newPack } from "./training/myPacks";
import type { TrainingEditor } from "./ui/trainingEditor";
import { ShotSelect } from "./ui/shotSelect";
import { hasModifiers } from "./training/settings";
import { StatGraphsView } from "./ui/statGraphsView";
import { type StatContext, StatGraphData, levelView, speedUnit } from "./game/statGraphs";
import { RefreshMeter } from "./game/refreshRate";
import { EXPECTED_PACKETS, NetGraphFeed } from "./net/netStats";
import { MainMenu } from "./ui/mainMenu";
import { MODAL_TEXT, Modal } from "./ui/modal";
import { SearchView, cancelShown } from "./ui/searchView";
import { IdleTip } from "./ui/idleTip";
import { PauseMenu, TRAINING_PAUSE_TEXT } from "./ui/pauseMenu";
import { PadMenuNav } from "./ui/padNav";
import { PadReadout } from "./ui/padReadout";
import { Renderer } from "./render/renderer";
import "./style.css";

// Every arena collision mesh: scripts/arena_gen.py writes one file per piece (each its own static body, as in the game)
const arenaUrls = Object.values(import.meta.glob<string>("@arena/collision_meshes/arena/*.cmf", { query: "?url", import: "default", eager: true }));

function required<T extends Element>(selector: string, type: new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing ${selector}`);
  return el;
}

/** The match session once opened (to close it if the page then fails to start) */
let startedConnection: { close(): void } | null = null;

async function main(): Promise<void> {
  const loading = new LoadingScreen(required("#loading", HTMLElement));
  const canvas = required("#game", HTMLCanvasElement);
  // ?server=host:infoPort (or just ?server: this host, port 4434) plays online against a carball-server
  const params = new URLSearchParams(location.search);
  migrateBrowserStorage(); // (the old rl-clone.* keys to their carball.* names, once: before any is read)
  const server = params.get("server");
  // ?match: a queue match's page, its slot's claim handed over by the menu page (src/net/pages.ts)
  const claim = params.has("match") ? takeClaim() : null;
  if (params.has("match") && claim === null) {
    location.replace(pageUrl("menu", location));
    return;
  }
  // ?bots: the offline match against bots, its setup handed over by the menu page (local/botMatch.ts), hosted in a worker
  // (a build without bots: none, back to the menu)
  const botMatch = __CARBALL_BOTS__ && params.has("bots") ? (await import("./local/botMatch")).readBotMatch() : null;
  if (params.has("bots") && botMatch === null) {
    location.replace(pageUrl("menu", location));
    return;
  }
  const onlinePage = server !== null || claim !== null || botMatch !== null;
  let settings = loadSettings();
  // (the menu page's notice from a match page, read here)
  const menuNotice = onlinePage ? null : takeNotice();
  const playlistName = (teamSize: number): string | null => PLAYLISTS.find((p) => p.teamSize === teamSize)?.name ?? null;

  // The arena (src/render/themes/: its look and soundscape): Night, the one map (the user's decision of 2026-10-17); the
  // map and mode named on the loading screen from its start for a queue match (its claim), a development server's once it
  // welcomes
  if (claim?.map !== undefined) loading.place(MAP_NAMES[themeOfMap(claim.map)], playlistName(claim.playlist));

  loading.step("engine");
  // (the cars' Blender models fetched beside the engine and the arena, not after them: RV-583; each with its timeout)
  const carModels = loadCarModels();
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

  loading.step("arena");
  initEngine(engine, arenaMeshes);
  // (the game's Fennec and demolition husks, where the dev server has them: src/render/fennec.ts, src/render/demolition.ts)
  // (and the cars' Blender models, where client/cars has them: src/render/carGlb.ts; the Fennec only where Sport has none,
  // its model winning over it: RX26)
  await Promise.all([carModels.then(async () => (hasCarModel(0) ? false : loadFennec())), loadDemolitionHusks()]);
  const world = World.create(engine);

  // Warm up: the first ticks after loading are slow while the browser compiles the module
  const warmup = World.create(engine);
  warmup.addCar(0);
  warmup.resetKickoff(0);
  warmup.step(240);
  warmup.dispose();

  // ?viewer=car: the car model alone on a turntable (for comparing it with the game's); &team=1: orange; &body=N: another
  // hitbox preset (the Octane's wears the Fennec where the dev server has it)
  if (params.get("viewer") === "car") {
    const viewerWorld = World.create(engine);
    const team = params.get("team") === "1" ? 1 : 0;
    const bodies = [CarBody.Standard, CarBody.Flat, CarBody.Wide, CarBody.Long, CarBody.Mid, CarBody.Tall];
    // (&car=N: the garage's car N on its preset; else &body=N's hitbox with the Sport's look)
    const car = params.has("car") ? carChoice(Number(params.get("car"))) : null;
    const id = viewerWorld.addCar(team, car?.body ?? bodies[Number(params.get("body") ?? 0)] ?? CarBody.Standard);
    const { showCarViewer } = await import("./debug/carViewer");
    const view = showCarViewer(new Renderer(canvas), viewerWorld.carConfig(id), TEAM_CAR_COLORS[team], team, car?.id ?? 0);
    (window as unknown as { carballCarViewer?: unknown }).carballCarViewer = { view };
    view(-140, 15);
    loading.hide();
    return;
  }
  // ?viewer=shaders: the shaders' functions on the GPU against their TypeScript twins (the e2e suite's)
  if (params.get("viewer") === "shaders") {
    const { shaderProbe } = await import("./debug/shaderProbe");
    (window as unknown as { carballShaderProbe?: unknown }).carballShaderProbe = shaderProbe(canvas);
    loading.hide();
    return;
  }
  // ?viewer=arena: the arena alone under a free camera (for comparing it with the game's)
  if (params.get("viewer") === "arena") {
    const viewerWorld = World.create(engine);
    const id = viewerWorld.addCar(0);
    const { showArenaViewer } = await import("./debug/arenaViewer");
    const viewer = showArenaViewer(new Renderer(canvas), createTheme(), viewerWorld.carConfig(id));
    const { view } = viewer;
    (window as unknown as { carballArenaViewer?: unknown }).carballArenaViewer = viewer;
    view({ eye: { x: 0, y: -4000, z: 600 }, target: { x: 0, y: 0, z: 600 } });
    loading.hide();
    return;
  }
  const arenaAndSession = async (): Promise<{ name: ThemeName; theme: Theme; session: Awaited<ReturnType<typeof Connection.open>> | null }> => {
    if (!onlinePage) {
      loading.step("map");
      return { name: "night", theme: createTheme(), session: null };
    }
    loading.step("connecting");
    // (a development server's open match, ?server=host:infoPort; or the queue's match, its claim)
    let address;
    let match: MatchSession = { intent: "join" };
    if (claim) {
      address = await queueAddress(params, location.hostname);
      match = { intent: "claim", token: claim.token };
    } else if (__CARBALL_BOTS__ && botMatch) {
      // (the worker, its host and the bots' runtime in their own chunks, none in a build without bots)
      const [{ localServerAddress }, { BOTS_BASE }] = await Promise.all([import("./local/localTransport"), import("./bots/listing")]);
      address = localServerAddress(botMatch, arenaMeshes, BOTS_BASE);
    } else {
      const [host = location.hostname, port = "4434"] = server === "" || server === null ? [] : server.split(":");
      address = await devServerAddress(host, Number(port));
    }
    // (a claim that fails: back to the menu; the match gone, a search again with a warning line, MM-18; the server not
    // reached, the connection-lost modal)
    const opened = Connection.open(address, joinPreferences(settings), match);
    if (claim) {
      opened.catch((e: unknown) => {
        // (refused while still in its time: a match cancelled for someone else, so back to the queue's front, RV-367)
        const back = { token: claim.token, searchedAt: claim.searchedAt };
        storeNotice(
          e instanceof RefusedError && e.reason === REFUSED_TOKEN ? { search: claim.playlist, warning: OWN_SEARCH_TEXT.matchGone, back } : { modal: "lost" },
        );
        location.replace(pageUrl("menu", location));
      });
    }
    const session = await opened;
    startedConnection = session.connection;
    const name = themeOfMap(session.welcome.map);
    loading.place(MAP_NAMES[name], claim ? playlistName(claim.playlist) : botMatch ? BOT_MATCH_TEXT.play : null);
    loading.step("map");
    return { name, theme: createTheme(), session };
  };
  const { name, theme, session } = await arenaAndSession();
  const renderer = new Renderer(canvas);
  // (the browser tests that read no pixels: nothing drawn, software WebGL being most of their time)
  renderer.draws = params.get("render") !== "off";
  // The video settings' automatic default (settings/video.ts): a weak GPU starts lower, the player's own choice wins; the
  // browser tests say theirs (e2e/fixtures.ts: the maximum, no guard)
  const videoAuto = (window as unknown as { carballVideoAuto?: { readonly weak: boolean; readonly guard: boolean } }).carballVideoAuto;
  const weakGpu = videoAuto?.weak ?? isWeakGpu(renderer.gpuName);
  const resolve = (s: Settings): Settings => resolveSettings(s, weakGpu);
  settings = resolve(settings);
  renderer.renderScale = RENDER_QUALITY_SCALE[settings.video.renderQuality];
  renderer.scene.background = theme.background;
  renderer.scene.fog = theme.fog;
  const arena = new ArenaView(theme);
  // (World Detail's gates on the theme's pieces: QG-17)
  applyWorldDetail(theme.root, settings.video.worldDetail);
  sceneDetail.world = settings.video.worldDetail;
  particleDetail.performance = settings.video.particleDetail === "performance";
  renderer.scene.add(arena.root);
  let worldDetail = settings.video.worldDetail;
  const hud = new Hud(required("#hud", HTMLElement));
  const input = new InputDevices(canvas);
  const audio = new GameAudio(name);
  audio.apply(settings.audio, settings.options.muted);
  renderer.postOptions = settings.options;
  // HUD-21's stat graphs: every row sampled each frame, the level's drawn over everything; F10 cycles the level, unsaved
  const statData = new StatGraphData();
  const statView = new StatGraphsView(document.body);
  // (the display's refresh as the page's frames show it: the stat graphs' target, the video guard's cap)
  const refresh = new RefreshMeter();
  let statLevel = settings.interface.statGraphs;
  let savedStatLevel = statLevel;
  // (the Interface tab: the HUD's stage and its options; a change of Stat Graphs its level, F10's undone)
  const applyInterface = (s: Settings): void => {
    setInterfaceScale(s.interface.scale, s.interface.displayScale);
    if (s.interface.statGraphs !== savedStatLevel) statLevel = savedStatLevel = s.interface.statGraphs;
    hud.configure(s.interface);
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "F10") return;
      // (F10 "Toggle Stat Graphs": the next level, not saved, once a press, not a held key's repeats (RV-528); the
      // browser's own F10 not taken)
      e.preventDefault();
      if (e.repeat) return;
      statLevel = STAT_GRAPHS[(STAT_GRAPHS.indexOf(statLevel) + 1) % STAT_GRAPHS.length] ?? "none";
    },
    { capture: true },
  );
  applyInterface(settings);
  // (the HUD's fonts scaled to the game's capitals and digits, each number glyph's ink fitted: now, and again once
  // they're loaded)
  fitHudFonts();
  void loadHudFonts();
  const panel = new SettingsPanel(
    document.body,
    settings,
    (next) => {
      settings = next;
      audio.apply(next.audio, next.options.muted);
      renderer.postOptions = next.options;
      renderer.renderScale = RENDER_QUALITY_SCALE[next.video.renderQuality];
      if (next.video.worldDetail !== worldDetail) {
        worldDetail = next.video.worldDetail;
        applyWorldDetail(theme.root, worldDetail);
        sceneDetail.world = worldDetail;
      }
      particleDetail.performance = next.video.particleDetail === "performance";
      // (a changed branch compiled before it's drawn where the browser compiles in parallel)
      if (applyShaderQuality(renderer.scene, next.video.highQualityShaders) > 0) void renderer.prepare();
      applyInterface(next);
    },
    resolve,
  );
  // The menus (MENU-1/4): Escape brings up the pause menu, the settings over it; the main menu as freeplay's page opens
  let mainMenu: MainMenu | null = null;
  // (freeplay's session over again: leaving it for the main menu, RV-284)
  let freeplayRestart: (() => void) | null = null;
  // (the training editor left as its Escape leaves it, `then` once it has (its unsaved question answered): false when
  // there's no editor to leave, nor its test or a playtest of its pack; set once the editor's made)
  let leaveEditor: (then: () => void) => boolean = () => false;
  const pause: PauseMenu = new PauseMenu(document.body, {
    resume: () => {
      pause.close();
    },
    settings: () => {
      panel.open();
    },
    ...(!onlinePage
      ? {
          // (over the editor, its test or a playtest: the editor left first, as B leaves it; then free play's session
          // over again)
          exit: () => {
            pause.close();
            const toMenu = (): void => {
              freeplayRestart?.();
              mainMenu?.open();
            };
            if (!leaveEditor(toMenu)) toMenu();
          },
        }
      : {}),
  });
  // The error modal (a lost connection, an idle kick) and the search's panel and banner (the menu page's)
  const modal = new Modal(document.body);
  // (custom training's Select Shot over the game: set once it's made)
  let shotSelectOpen = (): boolean => false;
  const menusOpen = (): boolean => panel.isOpen || pause.isOpen || (mainMenu?.isOpen ?? false) || modal.isOpen || shotSelectOpen();
  // (the pad's Y releasing over the main or pause menu, no modal or settings over it: the search's cancel, MM-10; set by the
  // menu page's search)
  let cancelSearchByPad = (): boolean => false;
  // (the training editor open: Escape leaves it; set once it's made)
  let editorEscape = (): boolean => false;
  // (Select Shot open: Escape closes it)
  let shotSelectEscape = (): boolean => false;
  // (the training editor's menu while it's shown (its panel, SEQUENCE SETTINGS): the pad's, B backing out of it; set once
  // the editor's made)
  let editorPadMenu = (): HTMLElement | null => null;
  // (the online match menu's question, answered NO by B or Escape: set once that menu's made)
  let dismissMatchQuestion = (): boolean => false;
  // Escape: the modal's OK; back out of the settings or the main menu's page; a pause menu's question answered NO
  // (RV-478); else the pause menu opens or closes
  const escape = (): void => {
    if (modal.isOpen) modal.close();
    else if (panel.isOpen) panel.escape();
    else if (editorEscape()) return;
    else if (shotSelectEscape()) return;
    else if (mainMenu?.isOpen) mainMenu.back();
    else if (pause.isOpen && (pause.dismissQuestion() || dismissMatchQuestion())) return;
    else pause.toggle();
  };
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      escape();
    },
    { capture: true },
  );
  // The menus with a pad (src/ui/padNav.ts): the topmost open one; the end screen's menu when nothing is over it
  const visibleMenu = (selector: string): HTMLElement | null => {
    const el = document.querySelector<HTMLElement>(selector);
    return el && !el.hidden && el.getClientRects().length > 0 ? el : null;
  };
  // (?pad: what the browser reports for each pad, over everything)
  const padReadout = new URLSearchParams(location.search).has("pad") ? new PadReadout(document.body) : null;
  const padNav = new PadMenuNav({
    menu: () =>
      modal.isOpen
        ? visibleMenu("#modal")
        : panel.isOpen
          ? panel.confirming
            ? visibleMenu("#settings-confirm")
            : visibleMenu("#settings")
          : mainMenu?.isOpen
            ? visibleMenu("#main-menu")
            : pause.isOpen
              ? visibleMenu("#pause-menu")
              : shotSelectOpen()
                ? visibleMenu("#shot-select")
                : (editorPadMenu() ?? (document.querySelector("#end-screen .end-buttons button") && visibleMenu("#end-screen .end-menu"))),
    // (B backs out of an open menu, a level at a time: never opens the pause menu; at the main menu's top, nothing)
    back: () => {
      if (modal.isOpen) modal.close();
      else if (panel.isOpen) panel.escape();
      else if (mainMenu?.isOpen) return mainMenu.back();
      else if (pause.isOpen) {
        // (a question up answered NO, the menu kept: RV-478)
        if (!pause.dismissQuestion() && !dismissMatchQuestion()) pause.close();
      }
      // (under them, Select Shot and the training editor's menus: B closes or leaves them as Escape does, RX25)
      else if (!shotSelectEscape() && !(editorPadMenu() !== null && editorEscape())) return false;
      return true;
    },
    // (Start toggles the pause menu only, closing the settings over it with it: it never backs out of a page; on the main
    // menu or under a modal, nothing: RV-475)
    start: () => {
      if (modal.isOpen || (mainMenu?.isOpen ?? false)) return;
      // (its cue: the menu's select opening it, back closing it, RV-481)
      if (!pause.isOpen) {
        pause.open();
        audio.menu("select");
        return;
      }
      if (panel.isOpen) panel.close();
      pause.close();
      audio.menu("back");
    },
    // (a rebind waiting for a pad input takes every button, B and Start too: Escape still cancels it)
    capturing: () => panel.capturingGamepad,
    cancelSearch: () => cancelSearchByPad(),
    sound: (cue) => {
      audio.menu(cue);
    },
  });
  // (the games don't take input under a menu, nor a pad button a menu took that's still down)
  const inputEnabled = (): boolean => !menusOpen();
  input.menuOpen = menusOpen;
  // (the game's pad without a menu's presses still held: RV-289)
  input.padFilter = (pad) => padNav.mask(pad);
  // For the browser tests
  (window as unknown as { carballAudio?: () => unknown }).carballAudio = () => audio.stats;
  (window as unknown as { carballAmbienceLevels?: (theme: ThemeName, seconds: number) => Promise<unknown> }).carballAmbienceLevels = async (t, seconds) =>
    (await import("./audio/levels")).ambienceLevels(t, seconds);
  (window as unknown as { carballMap?: () => ThemeName }).carballMap = () => name;
  let game: {
    frame(dt: number): void;
    /** The viewed car's and the ball's velocities (the Stat Graphs' Speed rows) */
    speeds(): { readonly car: Vec3 | null; readonly ball: Vec3 | null };
    /** Each frame's network rows (online), at `now` (s) */
    netFrame?(now: number): void;
  };
  if (!onlinePage) {
    const freeplay = new Freeplay(world, renderer, arena, input, hud, audio, () => settings, inputEnabled, { car: storedCar(), team: storedTeam() });
    freeplayRestart = () => {
      freeplay.restart();
    };
    // The queue (notes/matchmaking.md): a search from the menu or free play; a match found, its claim to the match page
    const matchmaking = new Matchmaking({
      search: (playlist, token, handlers) => {
        let search: Search | null = null;
        let cancelled = false;
        queueAddress(params, location.hostname)
          .then((address) => {
            if (!cancelled) search = Search.start(address, playlist, token, handlers);
          })
          .catch((e: unknown) => {
            if (!cancelled) handlers.failed(e instanceof Error ? e.message : String(e));
          });
        return {
          cancel: () => {
            cancelled = true;
            search?.cancel();
          },
          finish: async () => {
            cancelled = true;
            await search?.finish();
          },
        };
      },
      sound: (cue) => {
        if (cue === "start") audio.searchStart();
        else if (cue === "cancel") audio.searchCancel();
        else audio.countdown(1);
      },
      join: (token, playlist, searchedFor, map) => {
        storeClaim({ token, playlist, searchedAt: Date.now() - searchedFor * 1000, map });
        location.assign(pageUrl("match", location));
      },
      // (the slot claimed and left at once: the match is cancelled now for its other players, RV-355)
      decline: (token) => {
        queueAddress(params, location.hostname)
          .then(async (address) => {
            const { connection } = await Connection.open(address, joinPreferences(settings), { intent: "claim", token });
            connection.close();
          })
          .catch(() => undefined);
      },
    });
    const view = new SearchView(document.body, () => {
      matchmaking.cancel();
    });
    // (the banner's cancel, the pad's Y too, where MM-10 has it: over the main or pause menu, nothing over them; never
    // while driving, Y the ball cam's)
    const cancelHere = (): boolean => cancelShown({ mainMenu: mainMenu?.isOpen ?? false, pause: pause.isOpen, panel: panel.isOpen, modal: modal.isOpen });
    cancelSearchByPad = () => {
      if (matchmaking.state === null || !cancelHere()) return false;
      matchmaking.cancel();
      return true;
    };
    // (the garage's preview: the cars' hitboxes from a world of its own, one car each)
    const garageWorld = World.create(engine);
    const garageConfigs = new Map(CARS.map((c) => [c.id, garageWorld.carConfig(garageWorld.addCar(0, c.body))]));
    // (the training editor: its panel over the arena, the shot held in free play's world, the camera orbiting it; a
    // playtest plays the pack in training, the pause menu's Back to Editor returning)
    let playtesting: { readonly pack: TrainingPack; readonly shot: number } | null = null;
    const refreshPacks = (): void => {
      void listPacks().then((packs) => {
        mainMenu?.setTrainingPacks(packs);
      });
    };
    // (the editor's code a chunk of its own, loaded when it first opens)
    let editor: TrainingEditor | null = null;
    const openEditor = async (pack: TrainingPack, shot = 0): Promise<void> => {
      if (!editor) {
        const { TrainingEditor: Editor } = await import("./ui/trainingEditor");
        editor = new Editor(document.body, canvas, {
          show: (editing, asPlaced) => {
            freeplay.showEditing(editing, asPlaced);
          },
          camera: (editorView) => {
            freeplay.editorCamera = editorView;
          },
          rayAt: (x, y) => renderer.rayAt(x, y),
          playtest: (tested, from) => {
            editor?.close();
            playtesting = { pack: tested, shot: from };
            freeplay.startTraining(tested, from);
          },
          exit: () => {
            refreshPacks();
            mainMenu?.showTraining();
          },
          notice: (title, body) => {
            modal.show(title, body);
          },
          choose: (title, body, choices, focus) => {
            modal.choose(title, body, choices, focus);
          },
          // (the free-camera mode's tests: Test Shot and Test Sequence, back to the editor on its key)
          test: (tested, from, kind) => {
            playtesting = null;
            freeplay.startTraining(tested, from, kind);
          },
          testing: () => (freeplay.training?.test ?? null) !== null,
          project: (p) => renderer.project(p),
          blocked: () => menusOpen(),
        });
      }
      editor.open(pack, shot);
    };
    editorEscape = () => {
      if (!editor?.isOpen) return false;
      editor.escape();
      return true;
    };
    editorPadMenu = () => editor?.padMenu ?? null;
    leaveEditor = (then) => {
      if (!editor || (!editor.isOpen && !editor.testing && playtesting === null)) return false;
      editor.leave(() => {
        playtesting = null;
        then();
      });
      return true;
    };
    mainMenu = new MainMenu(document.body, {
      garage: (choice) => {
        freeplay.setCar(choice);
      },
      preview: new GaragePreview(
        (car) => garageConfigs.get(car) ?? null,
        (team) => TEAM_CAR_COLORS[team],
      ),
      freePlay: () => {
        mainMenu?.close();
        freeplay.restart(); // (a fresh session, not the one left: RV-284)
      },
      // (the banner at once, no panel (MS1's in-game path); the Play page kept, its Free Play focused: free play next while
      // searching, the user's decision; while a search runs, Find Match only shows it: MM-2's SearchInProgress)
      findMatch: (playlist) => {
        matchmaking.start(playlist);
        mainMenu?.focusFreePlay();
      },
      // (Play vs Bots' Start: its own page, the player on the garage's team; a search closed first)
      // (none in a build without bots: its setup's chunk left out, RV-541)
      botMatch: (choices) => {
        if (!__CARBALL_BOTS__) return;
        const go = (): void => {
          void import("./local/botMatch").then(({ botMatchSetup, storeBotMatch }) => {
            storeBotMatch(botMatchSetup(choices, botListings, storedTeam(), Math.floor(Math.random() * 0x7fffffff)));
            location.assign(pageUrl("bots", location));
          });
        };
        if (!matchmaking.searching) go();
        else
          void matchmaking.finish().then((found) => {
            if (!found) go();
          });
      },
      settings: () => {
        panel.open();
      },
      // (custom training: the pack read and checked, then played here at once, free play's session its stage)
      training: (listing: PackListing) => {
        void loadPack(listing).then((pack) => {
          if (typeof pack === "string") {
            console.error(`training pack ${listing.id}: ${pack}`);
            return;
          }
          mainMenu?.close();
          playtesting = null;
          freeplay.startTraining(pack);
        });
      },
      // (the editor: a pack of the player's own, or a new one)
      editTraining: (listing: PackListing | null) => {
        void (listing ? loadPack(listing) : Promise.resolve(newPack())).then(async (pack) => {
          if (typeof pack === "string") return;
          mainMenu?.close();
          await openEditor(pack);
        });
      },
    });
    // (the training packs there are: Custom Training with one to play)
    refreshPacks();
    // (the bot packages there are: Play vs Bots with one to play, its page's code and the listing in chunks of their own,
    // loaded once the menu is up; none in a build without bots)
    let botListings: readonly BotListing[] = [];
    if (__CARBALL_BOTS__) {
      void Promise.all([import("./bots/listing"), import("./ui/botsPage")]).then(async ([listing, page]) => {
        const listings = await listing.listBots();
        botListings = listings;
        mainMenu?.setBots((body) => page.botsPage(body, listings));
      });
    }
    // (back from a match page: its modal, a search to start again)
    const notice = menuNotice;
    if (notice?.modal) modal.show(MODAL_TEXT.title, notice.modal === "idle" ? MODAL_TEXT.idleKicked : MODAL_TEXT.connectionLost);
    if (notice?.search !== undefined) {
      // (back from a match cancelled for someone else: its token, the queue's front again, and its search's clock: RV-367)
      const back = notice.back ? { token: notice.back.token, searchedFor: (Date.now() - notice.back.searchedAt) / 1000 } : undefined;
      matchmaking.start(notice.search, notice.warning, back);
    }
    (window as unknown as { carballMatchmaking?: unknown }).carballMatchmaking = () => ({ state: matchmaking.state });
    // For screenshots and the browser tests
    (window as unknown as { carballFreeplay?: unknown }).carballFreeplay = {
      place: (
        car: { x: number; y: number; yaw: number; boost?: number },
        ball?: { x: number; y: number; z: number },
        ballVelocity?: { x: number; y: number; z: number },
      ) => {
        freeplay.debugPlace(car, ball, ballVelocity);
      },
      car: () => freeplay.debugCar(),
      demolish: () => {
        freeplay.debugDemolish();
      },
      demolition: (at: { x: number; y: number; z: number }) => {
        freeplay.debugDemolition(at);
      },
      particles: () => freeplay.debugParticles(),
      pads: () => freeplay.debugPads(),
      // (custom training with a pack given as JSON, and its state: the browser tests')
      startTraining: (json: unknown) => {
        const pack = parsePack(json);
        if (typeof pack === "string") throw new Error(pack);
        mainMenu?.close();
        freeplay.startTraining(pack);
      },
      training: () => {
        const run = freeplay.training;
        return (
          run && {
            state: run.state,
            shot: run.shotIndex,
            timeLeft: run.timeLeft,
            completion: run.completion,
            status: [...run.status],
            shuffle: run.shuffle,
            mirror: run.mirror,
            result: run.result,
            test: run.test,
          }
        );
      },
      // (the training editor: open or not, its mode and the free-camera mode's state, the pack as it stands)
      editor: () => editor && { open: editor.isOpen, testing: editor.testing, ...editor.state, pack: editor.pack },
      // (the camera's fade as the post-processing draws it: RV-159, RV-175)
      cameraFade: () => renderer.cameraFade,
    };
    // (the automatic default's frame-rate guard: in free play only, never in a match; once ever, while the player hasn't
    // chosen and a lower level's left: settings/video.ts guardWanted)
    const guard = guardWanted(settings.video, renderer.draws, videoAuto?.guard) ? new AutoVideoGuard() : null;
    // (offline: the network and input-buffer rows read 0)
    NetGraphFeed.offline(statData);
    // (Select Shot: its binding opens it over the game, a shot chosen starts at once)
    const shotSelect = new ShotSelect(document.body, (index) => {
      freeplay.selectShot(index);
    });
    shotSelectOpen = () => shotSelect.isOpen;
    // (the reset's first-time warning during or after a shot: §2.7, TutorialMessage.RoundResetBody)
    freeplay.onResetWarning = (retry) => {
      modal.ask(TRAINING_TEXT.resetWarningTitle, TRAINING_TEXT.resetWarning, retry);
    };
    shotSelectEscape = () => {
      if (!shotSelect.isOpen) return false;
      shotSelect.close();
      return true;
    };
    // (the pause menu's training buttons while a pack plays: Restart Training, Reset Progress, Back to Editor in a
    // playtest)
    let trainingPauseShown = "";
    const trainingPause = (): void => {
      const run = freeplay.training;
      const shown = run ? `${run.pack.id}|${String(playtesting !== null)}|${String(run.test)}` : "";
      if (shown === trainingPauseShown) return;
      trainingPauseShown = shown;
      const button = (label: string, click: () => void): HTMLButtonElement => {
        const b = document.createElement("button");
        b.className = "pause-button";
        b.textContent = label;
        b.addEventListener("click", () => {
          if (pause.isOpen) pause.toggle();
          click();
        });
        return b;
      };
      const back = playtesting;
      pause.match.replaceChildren(
        ...(run?.test
          ? [
              // (the free-camera mode's test: the game's Restart Training, our Back to Editor as its key)
              button(TRAINING_PAUSE_TEXT.restart, () => {
                modal.ask(TRAINING_PAUSE_TEXT.restartTitle, TRAINING_PAUSE_TEXT.restartBody, () => {
                  freeplay.restartTraining(false);
                });
              }),
              button(TRAINING_PAUSE_TEXT.backToEditor, () => {
                editor?.endTest();
              }),
            ]
          : run
            ? [
                button(TRAINING_PAUSE_TEXT.restart, () => {
                  freeplay.restartTraining(false);
                }),
                button(TRAINING_PAUSE_TEXT.resetProgress, () => {
                  freeplay.restartTraining(true);
                }),
                ...(back
                  ? [
                      button(TRAINING_PAUSE_TEXT.backToEditor, () => {
                        playtesting = null;
                        void openEditor(back.pack, back.shot);
                      }),
                    ]
                  : []),
              ]
            : []),
      );
    };
    // (custom training's HUD, its keys the device's in use)
    const trainingHud = new TrainingHud(required("#hud-stage", HTMLElement));
    const trainingKeys = (): TrainingKeys => {
      const pad = input.usingGamepad;
      const glyph = (b: { readonly keyboard: KeyboardInput | null; readonly gamepad: GamepadInput | null }): KeyGlyph => keyGlyph(pad ? b.gamepad : b.keyboard);
      const { bindings } = settings;
      return {
        reset: glyph(bindings.reset),
        previous: glyph(bindings.trainingPrevious),
        next: glyph(bindings.trainingNext),
        shuffle: glyph(bindings.trainingShuffle),
        mirror: glyph(bindings.trainingMirror),
        select: glyph(bindings.trainingSelect),
        // (the editor's Test Shot key: Tab, the pad's View)
        editShot: keyGlyph(pad ? { kind: "padButton", button: 8 } : { kind: "key", code: "Tab" }),
      };
    };
    game = {
      speeds: () => freeplay.speeds(),
      frame(dt) {
        // (the editor first: its camera and shot for this frame's drawing)
        editor?.frame(dt);
        freeplay.frame(dt);
        trainingHud.update(freeplay.training, trainingKeys(), hasModifiers(settings.training), menusOpen());
        trainingPause();
        if (freeplay.takeSelectRequest()) shotSelect.toggle(freeplay.training);
        if (!freeplay.training) shotSelect.close();
        matchmaking.frame(performance.now() / 1000);
        view.update(matchmaking.state, { menuUp: cancelHere(), padMode: padNav.padMode, now: performance.now() / 1000 });
        // (a hidden tab's or a hitch's time not counted: AutoVideoGuard; the player's choice since wins: guardStep)
        if (guard && !guard.done && guard.frame(dt, document.visibilityState === "visible", refresh.hz)) {
          const stepped = guardStep(settings.video);
          if (stepped) panel.apply({ ...settings, video: stepped });
        }
      },
    };
  } else {
    if (!session) throw new Error("an online page without its session");
    const { connection, welcome } = session;
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
      nameplates: new Nameplates(),
    };
    // Back to the main menu (the menu's leave, the end screen's exit; a queue match's end), with what it should do there
    let left = false;
    const leave = (notice?: MenuNotice): void => {
      if (left) return;
      left = true;
      if (notice) storeNotice(notice);
      connection.close();
      location.assign(pageUrl("menu", location));
    };
    const endScreen = new EndScreen(
      hudRoot,
      {
        // (a queue match: Play Again searches its playlist again from the menu)
        ready: () => {
          if (claim) leave({ search: claim.playlist });
          else online.readyForNextMatch();
        },
        exit: () => {
          leave();
        },
        options: () => {
          panel.open();
        },
      },
      claim !== null,
    );
    const endUi = { banner: new WinnerBanner(hudRoot), dimming: dimmingUi, tags: new PodiumTags(hudRoot), endScreen };
    const online: Online = new Online(world, renderer, arena, input, hud, audio, connection, welcome, () => settings, inputEnabled, chat, statsUi, endUi);
    online.idleTip = new IdleTip(hudRoot);
    if (claim) {
      // (a queue match's session ending: back to the menu, with the kick's modal, a search again, or the lost connection's)
      const notices: Record<SessionEnd, MenuNotice | undefined> = {
        idle: { modal: "idle" },
        notAllJoined: { search: claim.playlist, warning: OWN_SEARCH_TEXT.notAllJoined, back: { token: claim.token, searchedAt: claim.searchedAt } },
        lost: { modal: "lost" },
        ended: undefined,
      };
      online.onSessionEnd = (why) => {
        leave(notices[why]);
      };
    } else if (botMatch) {
      // (the local host gone, its worker failing: the menu, with the lost connection's modal)
      online.onSessionEnd = (why) => {
        leave(why === "lost" ? { modal: "lost" } : undefined);
      };
    }
    const players = new PlayersMenu(pause.players, (car, what) => {
      online.togglePlayer(car, what);
    });
    // For the browser tests
    (window as unknown as { carballOnline?: () => unknown }).carballOnline = () => online.stats;
    (window as unknown as { carballNameplates?: () => unknown }).carballNameplates = () => statsUi.nameplates.shown;
    // The pause menu's match buttons: forfeit or vote (the server's), leave (back to the main menu)
    const menu = new MatchMenu(pause.match, (action) => {
      if (action === "leave") {
        leave();
        return;
      }
      online.voteForfeit();
      pause.close();
    });
    dismissMatchQuestion = () => menu.dismissQuestion();
    const netFeed = new NetGraphFeed(statData);
    online.statFeed = netFeed;
    game = {
      speeds: () => online.speeds(),
      netFrame: (now) => {
        netFeed.frame(now);
      },
      frame(dt) {
        online.frame(dt);
        menu.update(online.menuItems(), pause.isOpen);
        players.update(online.players(botMatch !== null), pause.isOpen);
      },
    };
  }

  window.addEventListener("keydown", (e) => {
    if (panel.isOpen || (mainMenu?.isOpen ?? false)) return;
    if (e.code === "KeyH") hud.toggleHelp(settings.bindings);
    if (e.code === "KeyM") panel.apply({ ...settings, options: { ...settings.options, muted: !settings.options.muted } });
  });

  // (High Quality Shaders: every material's branch set before they're compiled; the scene's shader programs compiled
  // while the loading line shows, not in the first frames: RV-458)
  applyShaderQuality(renderer.scene, settings.video.highQualityShaders);
  loading.step("shaders");
  await renderer.prepare();
  // (and the whole chain drawn once under the loading screen: the first frames seen don't stall, RV-483)
  loading.step("firstFrame");
  await renderer.warmUp();
  let last = performance.now();
  // (the stat graphs' context: the display's refresh as measured, ours having no cap; our downstream's budget, the
  // updates needing up to about 140 KB/s, not the game's 15000 B/s; the speeds' units)
  const statContext = (): StatContext => ({
    targetFps: refresh.hz ?? 60,
    maxBytesRate: 150_000,
    expectedOutPackets: EXPECTED_PACKETS.out,
    expectedInPackets: EXPECTED_PACKETS.in,
    metric: settings.interface.metric,
  });
  (window as unknown as { carballStatGraphs?: unknown }).carballStatGraphs = () => ({
    level: statLevel,
    rows: statData.view(statLevel, performance.now() / 1000, statContext()).map((row) => ({ ...row, graph: null })),
  });
  /** Each frame's rows sampled (FPS from the raw frame, the game's work less the render's, the render's, the speeds),
   *  the level drawn */
  const statFrame = (t: number, dt: number, gameMs: number): void => {
    if (dt > 0 && dt < 1) {
      statData.set("FPS", 1 / dt);
      statData.set("Frame", dt * 1000);
      refresh.add(dt * 1000);
    }
    statData.set("Render", renderer.lastRenderMs);
    statData.set("Game", Math.max(0, gameMs - renderer.lastRenderMs));
    // (the GPU's time only while a level is shown: its timer query's cost not paid at None)
    renderer.gpuTiming = statLevel !== "none";
    if (renderer.lastGpuMs !== null) statData.set("GPU", renderer.lastGpuMs);
    const { car, ball } = game.speeds();
    const unit = speedUnit(settings.interface.metric);
    for (const [body, v] of [
      ["Car", car],
      ["Ball", ball],
    ] as const) {
      if (!v) continue;
      statData.set(`${body} Speed`, Math.hypot(v.x, v.y, v.z) * unit);
      statData.set(`${body} Speed (XY)`, Math.hypot(v.x, v.y) * unit);
      statData.set(`${body} Speed (Z)`, Math.abs(v.z) * unit);
    }
    game.netFrame?.(t);
    statData.sample(t);
    const view = levelView(statLevel);
    // (drawn again as a new slot starts, the samples' rate, not every frame: RV-517)
    const key = `${statLevel}|${String(settings.interface.scale)}|${String(settings.interface.displayScale)}`;
    if (!view) statView.hide();
    else if (statView.due(t, key))
      statView.draw(statData.view(statLevel, t, statContext()), view.window, t, settings.interface.scale, settings.interface.displayScale, key);
  };
  const frame = (now: number): void => {
    // (raw: the games take their clamped real and world times from it, LT-3)
    const dt = (now - last) / 1000;
    last = now;
    padNav.frame(readGamepad(), now / 1000);
    padReadout?.update();
    const started = performance.now();
    game.frame(dt);
    statFrame(now / 1000, dt, performance.now() - started);
    // (the game's first frame drawn, its HUD and menus laid out: the loading screen fades into it)
    loading.done();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  // (a match's session not left open behind a page that failed: its slot not an idle car, RV-445)
  startedConnection?.close();
  // (a match's or the bots' page: Back to the menu; the menu's own has nowhere else to go)
  const query = new URLSearchParams(location.search);
  const away = query.has("bots") || query.has("match") || query.has("server");
  showLoadingFailure(
    document.querySelector("#loading"),
    err instanceof Error ? err.message : String(err),
    away
      ? () => {
          location.assign(pageUrl("menu", location));
        }
      : undefined,
  );
  console.error(err);
});
