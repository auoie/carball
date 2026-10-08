# Handoff: how to resume this project

## Next (2026-10-08)
- **Where:** the repository is on the data drive, `/mnt/primary/home/arch/rocket-league-reverse-engineering`, the
  same path from Arch and WSL. `engine/build` and `engine/build-wasm` were rebuilt at this path (the old ones are
  renamed `*-old-documents-path`, and `engine/build-wsl`, `engine/build-wasm-wsl` are leftovers: all can be deleted).
  `~/Documents/rocket-league-reverse-engineering` on the Arch NVMe is an old backup.
- **Live game (Windows, WSL) works:** `tools/physlog/run_wsl.sh SCENARIO...` plays scenarios in freeplay over rcon,
  copies the recordings (and their `_bullet.csv`) to `out/live/` and validates them (`tools/physlog/README.md`
  "Driving it from WSL": game windowed on the second monitor, never focused by scripts; rcon whitelist, which
  includes `plugin`, so `plugin unload physlog` / build / `plugin load physlog` works from WSL).
- **PhysLog reads the game's own Bullet objects** (`_bullet.csv`: shapes, body words, every contact manifold of the
  car and the ball each tick) through the static session's pointer chain; `live_validate --contacts A-B` prints the
  game's manifolds under ours. Offsets are for the 2026-10-06 build. Use it first when a contact question comes up.
- **State (findings 27–44, engine patches 45–71):** every live recording is exact or nearly so, per tick: `jumps`,
  `flip_cancel`, `body_drops`, `steer`, `air`, `powerslide`, `ball_roof`, `dodge_fast`, `wheel_ball`, `car_car2`,
  `ga_boost`, `ga_jump`, `ga_throttle` ≤ 0.14 uu/s; `ball_5050` (50/50s, kickoff, pinch) cars 0.07, ball 0.22; `car_car`
  0.43 / bot 3.0. Today: the car components against the static session's audit (GA-1 boost sets the input throttle,
  GA-2 jump re-press, GA-3 auto-flip, GA-4 throttle deadzone, GA-7 dodge direction, GA-8 air throttle timing:
  patches 57–62, replays 1,745 better / 474 worse), car–car demolitions both ways and the strict bump cooldown
  (GA-15/16, patches 65/66), the arena as the game's 16 pieces (56), the GJK wheel-ray cast (55), Bullet 2.82's
  manifold solve order, edge info and tree quantization (69–71), and the current game's respawn spot selection
  (64: steer left/right while demolished, locked 0.5 s before the respawn; deterministic, in snapshots and the
  network state) plus the flip reset counter (68). `live_validate` fixes: the "2.71 uu/s teleport artifact"
  was stale wheel normals after a placement (finding 43).
- **Netcode (today, from the static session's audit `notes/netcode-audit.md`):** corrections smoothed for drawing
  (`client/src/game/syncError.ts`), hitch reset of the server's jitter buffer (protocol `ResetInputBuffer`), lost
  update parts no longer drop the whole update, remote cars' input basis only from the cars in an update; then the
  static session's review of those (NR-1 to NR-9, all done): rotation corrections shift the previous tick and compose
  as the game's, a spawn counter per body (engine patch 74, network state format 6, protocol 6) replaces the 500 uu
  teleport guess, the camera follows the smoothed rotation, resyncs and reloads are smoothed, older and late update
  parts apply (the predictor keeps applied server states in its history), hidden-tab queue capped, server reset rate
  limit; see `notes/netcode.md` (end). Client: boost pad warm-up (last second pulsing), respawn picker in the HUD, flip reset
  toast from the engine's counter, gamepad camera swivel direction fixed (C-1).
- **Driving the game:** `tools/physlog/check_game.sh` (heartbeat + read-only screenshot to `out/live/screens/`; look
  at the screenshot when the game doesn't answer or isn't in freeplay). Never load maps from scripts (the game drops
  to the menu and asks to reconnect online): starting freeplay is the user's job. Bots: `physlog_spawn 23 bot`,
  `physlog_removebots`, `physlog_cars`. Other car bodies can't be switched from a script (item mod is visual; a bot's
  hitbox ignores the body asked for): they need the user's loadout.
- **Static analysis runs in a second session** (Ghidra BSim, stock Bullet vs the exe; it writes only `out/bsim/` and
  `notes/bullet-diff.md` and sends numbered hypotheses to test live). This session owns the game, PhysLog, `engine/`,
  scenarios, tests, client and server. Batch 2: B6, B7, B9, B10 adopted; B11 (car–car through an AABB tree) worse as
  tried: the static session says the body order is probably the issue (2.82: body0 = the car added to the world
  first, by broadphase handle; try both orders); B8 (internal-edge choice) after the arena rework below.
- **Arena (findings 41, 44, 45):** the generated arena is now the game's 16 meshes triangle for triangle: our own
  vertices (`scripts/arena_layout.py`: rules plus a few constants measured on the game's mesh) and the game's
  triangles in its cooked order (`scripts/arena_topology.json`, indices only; re-derive with
  `scripts/arena_topology_derive.py out/arena_local/cooked` after changing a pool: it needs the local extraction,
  `out/bsim/agents/S1/tools/cooked.py out/arena_local/cooked --local`). The goal halves are written in their own
  frame with a body offset (`.cmf` trailer, engine patch 73). `ball_curves` and `walls` now match (0.04 / 0.20 uu/s).
  Left approximate: the skirts below the floor and above the ceiling (hidden), the post-base ring and mouth-arc ends
  (≤ 0.40 uu). A Python venv with numpy and scipy is at `.venv` (git-ignored) for fitting.
- **Open:**
  - (the live sitting is done: finding 48; respawn spot choice, held respawns, kickoff order, uneven teams, the clock
    and 0:00, per-body spawn heights, all six presets' steering confirmed or fixed)
  - (GA-5, the pitch lock after a wavedash: patch 79, confirmed live, finding 47; GA-6, spawn height and offset per
    body: patch 80, measured live, finding 48)
  - controls audit (`notes/controls-audit.md`): C-6 sub-frame taps; the default pad layout's air roll (the audit:
    Standard/Modern pads put it on LT; ours on X) (done: C-2 DodgeForward as its own byte, patch 78; C-3 the Modern
    keyboard layout, the user's choice; C-4 several inputs per action; C-5 the trigger deadzone 0.1, measured live, and
    the digital press threshold 30/255);
  - netcode N-4 (server-confirmed demos), N-9, N-10; the car state's size on the wire;
  - match rules (`notes/match-rules-audit.md`): done MR-1 (clock, 0:00 ball-on-ground, overtime, end and a new
    match: `server/README.md`), MR-2 (one goal per round: patch 72), MR-4 and MR-5 (the kickoff order per match and
    uneven teams: patch 75; the live uneven-teams check is in the user's sitting, `notes/live-sitting.md`), MR-3 (the
    3 s warm-up before a match's first countdown, a joiner in a countdown on a kickoff spot), MR-6 (the
    demolished wait for the kickoff after a goal: patch 76; the goal explosion's knockback: patch 77, direction and
    timing confirmed by replays, its size not settled by them: finding 46), MR-7 in part (a team left empty
    forfeits); open: slow motion and the goal replay, forfeit votes;
  - camera (`notes/camera-update-audit.md`): free look (CAM-1) and the live Modern camera preset (CAM-3/4: a
    decision like the keyboard layout), respawn cameras (CAM-6); CAM-2/7/8 are fixed;
  - `steer` once per other car body (finding 21), `HandlingPresetXOffset`.
- **The live game updated on 2026-10-06:** the static analysis (Ghidra project, `out/decomp`, layouts, packages) is
  from the 2026-06-16 build in `documents/binaries`; the live exe is in
  `/mnt/c/Program Files (x86)/Steam/steamapps/common/rocketleague`. Physics functions look unchanged (finding 25),
  but trust the live recordings over the decompile where they disagree.
- **Done by the static session (2026-10-08):** stock Bullet 2.82 diffed against the executable function by function
  (BSim); its findings are in `notes/bullet-diff.md` and `out/bsim/reports/`, adopted ones in engine patches 46–53.

**Goal:** a web game cloning Rocket League's physics, camera, controls and competitive multiplayer.
**Plan:** forked RocketSim (`engine/`) with verified patches → native game server + WebAssembly clients
(bit-identical); own arena mesh; Three.js browser client (`client/`).
**Status (2026-10-06):** physics reverse engineering complete; our arena mesh is generated and validated
(`out/arena/`); RocketSim is forked into `engine/` with every verified patch and tests (`engine/README.md`).
The engine also builds to WebAssembly with a JS API (`engine/build-wasm/rlengine.mjs`). Native and WebAssembly
builds simulate bit-identically (the game server will be native, the clients WebAssembly).
Browser freeplay works (`client/`, TypeScript + Vite + Three.js; see `client/README.md`). The camera is the
game's own: decompiled from UnrealScript and ported (`client/src/camera/rlCamera.ts`, algorithm in `notes/camera.md`).
**Last state (2026-10-06):** multiplayer step 1 done: snapshot restore is exact (engine patches 23–26,
`engine/tests/rollback.cpp`; in-place load ~5 µs). Step 2 done: the game's netcode is decoded (`notes/netcode.md`).
Step 3 done: native server (`server/`, Rust, WebTransport; `server/README.md`), protocol v1 (`protocol/`), browser
online mode with prediction and rollback (`client/src/game/online.ts`, `client/src/net/`); step 4's core (the
predictor) is in and exact for the local car. Next: step 5.
Replay validation (§7) done (`notes/validation.md`, `engine/build/replay_validate`): ball physics exact, driving within
~1%; fixed the car–ball hit impulse (start-of-tick velocities, patch 28: the ball was bouncy on the car) and added the
game's input bytes (patch 29). Then: the ball sleeps like in the game (patch 30); car wobble at goal walls traced to
the vehicle model (same on the game's mesh); the client predictor resyncs when the server is ahead (stalled tab). Then the vehicle update decompiled
and matched to the game's Bullet vehicle (patch 31; replays: wall/curve error 3× lower). Then: powerslide,
jumps, flips and pinches checked (all match; their errors were replay timing, now reconstructed or fitted by the
validator); steering reverted to the game's average angle (patch 8 revised: the earlier replay test was confounded);
wall-grip condition (patch 32). Car–car checked with a new validator pass (`--carcar`, extractor `--demos`): bumps
match; the demo cone is now tested at the time of impact (patch 33) and supersonic lasts 1 s below 2200 (patch 34),
both from the code and confirmed by replay demos. The arena mesh now uses the game's tessellation (Bézier arcs;
`notes/arena.md`), which brought walls/curves to 0.046 uu, as on the game's own mesh. Then: double jumps (start
timing), boost pad pickup radius (patch 35), kickoff ball height and the 4 s kickoff countdown (patches 36, 37;
server waits 3.0 s after a goal; protocol version 2), other bodies (`--bodies`) and input changes checked.
Open points: `notes/roadmap.md` §7 "Open". Car position error vs replays
now ~0.010 uu flat, 0.046 walls/curves, 0.020 goals (median after ~4 ticks; `notes/validation.md`). A second Claude
session did client visuals (ball spin, hex walls, placeholder car models) in client/src.
Agreed multiplayer plan: (1) exact restore ✓, (2) decode the
game's netcode (input buffer, client sim-time adjustment, remote car/ball correction), (3) native authoritative
server + browser transport, (4) client prediction + rollback, (5) in-process network tests with scripted
latency/jitter/loss. Then replay validation (§7) with numbers, then the competitive layer (§9). The user wants
accuracy settled by deterministic, verifiable tests, not by their perception.

Read in this order: `notes/roadmap.md` (what's left) → `notes/physics-values.md` (all values, formulas,
RocketSim comparison) → `notes/arena.md` → `notes/camera.md` → `notes/findings.md` (binary/package internals, addresses)
→ `notes/input.md` → `notes/netcode.md` → `notes/validation.md` → `engine/README.md` → `client/README.md`.

## Locations
| What | Where |
|---|---|
| Game install (Windows copy) | `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague` |
| Exe | `.../Binaries/Win64/RocketLeague.exe` (build 2026-06-16, image base 0x140000000) |
| Packages | `.../TAGame/CookedPCConsole/*.upk` |
| Replay dataset (116 GB zip, ~120k replays 2021–Sep 2025, `1v1/ 2v2/ 3v3/` + `metadata.jsonl`) | `/mnt/primary/home/arch/documents/rocket_league_replays/high-level-rocket-league-replay-dataset.zip` |
| Ghidra project (fully analysed, natives named) | `ghidra/RocketLeague` (git-ignored) |
| Decrypted packages | `out/decrypted/` (git-ignored): TAGame, GameInfo_Soccar_SF, GameInfo_Default_SF, Body_Octane_SF, Stadium_P, Engine, Core, ProjectX, Mutators_SF, Startup |
| Package AES key | `out/rlupktool_key.bin` (public RLUPKTool key; git-ignored) |
| Decompiled C | `out/decomp/<name>@<addr>.c` (git-ignored) |
| Extracted arena meshes (measurement only, never ship) | `out/arena_local/*.obj` (git-ignored) |

Scratchpad copies (RocketSim and RLUPKTool clones, extracted replays, `states.csv`) are temporary.
Regenerate: `git clone --depth 1 https://github.com/ZealanL/RocketSim`; replays via Python `zipfile`
from the dataset zip (newest by `metadata.jsonl` `data.date`).

## Tools (run Python scripts from `scripts/`; plain `python3`, not `-I`)
```sh
# Ghidra: decompile functions (addresses or Class::func or re:REGEX) -> out/decomp/
GHIDRA_HEADLESS_MAXMEM=24G /opt/ghidra/support/analyzeHeadless ghidra RocketLeague -process RocketLeague.exe \
  -noanalysis -readOnly -scriptPath scripts -postScript Decomp.java 0x140eb72b0 0x140f5ff00
# other Ghidra scripts (same invocation): FindDisp.java <disp..> [min=N]  (functions using offsets)
#   FindStore.java <disp..> [lo= hi=] (stores to [reg+disp]); FindCallArg.java <target> <disp..>
#   (calls whose RCX = lea [reg+disp]); Refs.java <addr..> (all xrefs); ApplyNatives.java (names)
# zsh does not word-split $VAR: use ${=VAR} when passing address lists.

python3 decrypt_upk.py ../out/rlupktool_key.bin ../out/decrypted <pkg.upk...>   # decrypt+decompress
python3 props.py <pkg> <export path suffix...>       # tagged properties (defaults/archetypes)
python3 layout.py <pkg> <Class...>                   # native field offsets (checks vs exe sizeof)
python3 ubytecode.py <pkg> <Class.Function...>       # UnrealScript -> pseudo-code (RL token map)
python3 search_props.py '<regex>' <pkg...>           # grep property names across all objects
python3 scan_exports.py ../out/rlupktool_key.bin <CookedPCConsole dir> <Name...>  # which pkg exports X
python3 staticmesh.py <pkg> <mesh path> --obj out.obj  # mesh verts/tris (measurement only)
python3 export_constants.py ../out/decrypted ../out/rl_physics_constants.json
python3 dump_natives.py / dump_classes.py / dump_tokens.py   # regenerate out/*.csv from the exe
cargo build --release --manifest-path replay_extract/Cargo.toml
replay_extract/target/release/replay_extract states.csv replays/*.replay   # ball/car states + inputs
python3 replay_measure.py states.csv                 # ball rest/wall gaps, throttle accel curve
python3 arena_gen.py ../out/arena                    # our arena mesh (.obj + RocketSim .cmf), no Psyonix data
python3 arena_check.py ../out/arena/soccar_arena.obj ../out/arena_local   # deviation vs game meshes (local only)
cmake -S ../engine -B ../engine/build -DCMAKE_BUILD_TYPE=Release && make -C ../engine/build -j
../engine/build/rl_patch_tests && ../engine/build/arena_smoketest ../out/arena/collision_meshes
# WebAssembly: Emscripten is at /usr/lib/emscripten (not on PATH in non-login shells)
PATH=/usr/lib/emscripten:$PATH emcmake cmake -S ../engine -B ../engine/build-wasm -DCMAKE_BUILD_TYPE=Release
PATH=/usr/lib/emscripten:$PATH emmake make -C ../engine/build-wasm -j && node ../engine/wasm/test_node.mjs
../engine/tests/check_native_wasm.sh 600     # native == WebAssembly, bit for bit (must stay identical)
../engine/build/rollback ../out/arena/collision_meshes 300   # restored snapshots continue bit for bit
cd ../client && npm run check && npm run build && npm run e2e   # web client: types, lint, tests, browser tests
cd ../server && cargo test && cargo clippy --all-targets -- -D warnings   # game server (cargo run --release to play)
python3 replay_pull.py ../out/replays && replay_extract/target/release/replay_extract ../out/replays/states.csv ../out/replays/*.replay
../engine/build/replay_validate ../out/replays/states.csv --cases ../out/replays/cases.csv && python3 validation_report.py ../out/replays/cases.csv
```

## Session conventions and decisions
- The user commits work themselves. Don't commit, and don't touch the git index (no `git rm --cached`, no staging).
- RocketSim was forked knowingly, despite its README's request. The server will be native, the clients WebAssembly,
  and they must stay bit-identical: run `engine/tests/check_native_wasm.sh` after engine changes.
- The user values strict static analysis and tests: keep `cd client && npm run check` and `npm run e2e` green.
- Decompiled game code stays local (`out/decomp/`, git-ignored): camera script in `out/decomp/camera_script.txt`
  and `camera_base_script.txt`.

## Gotchas
- Units: uu; Bullet = uu × 0.02. Forces/impulses in data are uu × mass (car 180, ball 30).
- UE3 shapes get PhysX skin +0.025 BT (+1.25 uu/side); spheres then −0.04 in Psyonix's converter.
- Package quirks: UProperty has an extra FString name; Context/ClassContext tokens have an extra flag
  byte; bytecode tokens are shuffled (map in findings.md); imported structs live in ProjectX/Core.
- KSphereElem `TM` matrix reads as a permutation = identity (FPlane stored W-first).
- Replays: angular velocity is rad/s × 100; car states replicate every ~0.067–0.1 s (not every frame);
  high-speed bounce samples can be extrapolated past walls; use slow/sustained contact.
- Level actors with `RF_HasStack` have an FStateFrame before NetIndex (props.py handles it).
- Addresses are valid for this exe build only.
- Keep Psyonix material local: decrypted packages, key, meshes, decompiled code are git-ignored.
- The user commits work themselves; leave changes uncommitted unless asked.
- `pkill -f PATTERN` kills its own shell if PATTERN appears anywhere in the same command line. Use a bracket
  trick (`pkill -f 'vite previe[w]'`) and don't start the process in the same command.
- Emscripten: `PATH=/usr/lib/emscripten:$PATH` (not on PATH in non-login shells). Bindings generate TS types
  (`--emit-tsd *.d.mts`; typed arrays via `EMSCRIPTEN_DECLARE_VAL_TYPE`). After changing `engine/wasm/bindings.cpp`,
  rebuild `engine/build-wasm` (targets `rlengine`, `rlengine_web`) before running the client.
- Determinism pitfalls (native vs WebAssembly): platform libm (fixed: `engine/detmath`), Bullet SSE paths (fixed:
  `BT_DISABLE_SIMD`), `std::` random distributions/shuffle/`default_random_engine`, function-argument evaluation
  order, uninitialized fields. Never `-ffast-math`.
- UnrealScript disassembly: Rocket League's extended-native tokens are 0x70–0x7F (fixed in `ubytecode.py`).
  Unknown tokens `0x52`, `0x5b` remain. Most game-feel logic (camera, car impacts) is script, not native.
- Playwright's system Chrome reads real gamepads plugged into the machine (the user's controller once reset the
  car mid-test). `client/e2e/fixtures.ts` stubs `navigator.getGamepads`; import `test` from there.
- Playwright uses the system Chrome (`channel: "chrome"`, swiftshader). Screenshots via a temporary spec file in
  `client/e2e/` (delete after). Headless Chrome CLI screenshots also work (`--use-angle=swiftshader`).
- The user chose to fork RocketSim despite its README's request (2026-10-06); don't re-ask.
- Engine changes are marked `RL PATCH`; regenerate `engine/rocketsim-rl-patches.diff` after changing them.
