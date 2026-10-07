# Handoff: how to resume this project

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
`notes/arena.md`), which brought walls/curves to 0.046 uu, as on the game's own mesh. Next steps: `notes/roadmap.md` §7 "Next, in order". Car position error vs replays
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
