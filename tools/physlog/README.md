# PhysLog: recording the real game's physics

A BakkesMod plugin that records Rocket League tick by tick in **offline modes only** (freeplay, custom training).
Each tick it writes the car's and the ball's exact rigid-body state, the full input (throttle, steer, pitch, yaw,
roll, jump, boost, handbrake), and the car's jump, flip, boost and wheel state. Our engine then replays the same
inputs and is compared tick by tick (`engine/tools`; notes/validation.md). This gives what replays can't: every
tick, every input (air control, flip cancels, exact timing), and controlled experiments.

Rules: offline play only, in a game started without EAC (as BakkesMod requires). The plugin refuses to record outside
freeplay/custom training and stops if you leave. It doesn't touch EAC. Recordings stay local (`out/live/`, git-ignored).

## Build (Windows)
1. Install BakkesMod (bakkesmod.com) and check it works in freeplay. It installs its SDK in
   `%APPDATA%\bakkesmod\bakkesmod\bakkesmodsdk`.
2. Install Visual Studio 2022 Community with "Desktop development with C++".
3. Open "x64 Native Tools Command Prompt for VS 2022", go to this folder and run `build.bat`. It builds `PhysLog.dll`,
   copies it to BakkesMod's plugins folder, and copies `scenarios\*.txt` to
   `%APPDATA%\bakkesmod\bakkesmod\data\physlog\scenarios\`.

## Record
In freeplay, open the BakkesMod console (F6) and load the plugin: `plugin load physlog`.

- **Scripted scenarios** (most useful): `physlog_run steer`, `physlog_run steer_sweep`, `physlog_run air`,
  `physlog_run jumps`, `physlog_run flip_cancel`, `physlog_run body_drops`, `physlog_run ball_hits`,
  `physlog_run walls`, `physlog_run ball_roof`, `physlog_run powerslide`, `physlog_run wheel_ball`,
  `physlog_run dodge_fast`, `physlog_run ball_curves`, and with a bot spawned first (`physlog_spawn 23 bot`)
  `physlog_run car_car`, `physlog_run car_car2`. Each places the car (and the ball), plays exact inputs, and
  stops when done. Keep your hands off the controller while one runs. Run `steer` again with each other car you
  have (Dominus, Batmobile/Plank, Breakout, Hybrid, Merc, and anything else): the file header records the body
  and its hitbox and wheels.
- **Free driving**: `physlog_start <name>` ... `physlog_stop`. Aerials, air rolls, flips and cancels, wall play:
  anything, a few minutes at a time.

Recordings go to `%APPDATA%\bakkesmod\bakkesmod\data\physlog\` as `<name>_<date>_<time>.csv`. Copy them into
`out/live/` in this repository.

## Driving it from WSL (no hands on the game)
Claude Code in WSL can build, load and run everything while the game sits in freeplay:
- Run Windows programs from a Windows path (`cd /mnt/c` first): started from the shared Linux drive they fail with
  "Invalid argument". `bash tools/physlog/build_wsl.sh` builds with MSVC and installs the DLL and the scenarios.
- BakkesMod's rcon listens on 127.0.0.1:9002 (with WSL's mirrored networking): `python3 tools/physlog/rcon.py
  "plugin load physlog"` (password: `rcon_password` in BakkesMod's `cfg/config.cfg`, or `BAKKES_RCON_PASSWORD`).
  Rcon only runs allowed commands: add `physlog_start`, `physlog_stop`, `physlog_run`, `physlog_ping`,
  `physlog_body`, `physlog_spawn`, `physlog_removebots`, `physlog_cars` and `physlog_resetplayers` as lines to
  `%APPDATA%\bakkesmod\bakkesmod\data\rcon_commands.cfg`, then send `rcon_refresh_allowed`. Rcon sends no console
  output back: read `%APPDATA%\bakkesmod\bakkesmod\bakkesmod.log`.
- Play the game **windowed** (e.g. on a second monitor) and don't bring it to the front from a script (a fullscreen
  game covers everything). A minimized game doesn't tick. Freeplay pauses when its window loses focus; `physlog_run`
  unpauses it (the pause menu stays on screen, the physics runs normally).
- `tools/physlog/check_game.sh [--freeplay]` checks that the game is answering (`physlog_ping`, whose reply carries
  the freeplay/online/paused state and the open menus). If it isn't, or isn't in offline freeplay with `--freeplay`,
  it saves a screenshot of the game window to `out/live/screens/` (`game_window.ps1`: `PrintWindow`, read-only; it
  never activates the window) so the cause (a dialog, the main menu, a loading screen) can be seen. `run_wsl.sh` runs
  it before every scenario.
- **Never load a map from a script** (`start <map>`, from freeplay or the main menu): this offline game then reports
  "Duplicate login detected", drops to the main menu and asks to reconnect to its servers (answer No). Only the menu's
  own Free Play button starts freeplay cleanly, so starting it is the player's job. That dialog isn't in the menu stack
  (`physlog_ping` still answers): a screenshot shows it.
- Other cars: `physlog_spawn <body> bot` adds a bot (whose input PhysLog scripts and records: `o_` columns; scenario
  lines `car2`, `input2`), `physlog_removebots`, `physlog_cars`. A spawned bot's hitbox doesn't follow the body asked
  for (always 66.9962 / 41.5105 / 16.4 half extents), so other bodies need the player's own car: `physlog_body
  <product>` sets BakkesMod's item mod to that body (it takes effect when the car is next created, e.g. when freeplay is
  started again) and `physlog_body restore` puts the player's own item-mod settings back.

## File format
A `#` header line (body id, collision extent and offset, the player's `steer_sensitivity` and `air_sensitivity`,
each wheel's radius, rest position, ray start and travel), then one row per tick: `tick`, `time` (the car's
RBState time; 0 offline, where only replication sets it), car and ball state (quaternion x y z w, location,
linear velocity, angular velocity, sleeping), the input applied this tick, then the car state: on ground, wheel
contacts, jumped / double jumped / has flip, supersonic and time below supersonic speed, boost (0-1), jump, double
jump and dodge components (active, active time; dodge torque), the vehicle sim's output throttle/steer/handbrake,
the front wheels' steer, each wheel's contact and suspension distance. The sensitivities matter: the game shapes
steering and air control inputs with them inside the physics (`clamp(input × s, −1, 1)`), so `live_validate` applies
them from the header. The state is taken when the game sets the
car's input for the tick, before that tick's physics, so the next row holds the tick's result. The game numbers the
wheels front left, front right, back left, back right (RocketSim: right before left).

Next to each recording, `<name>_<date>_<time>_bullet.csv` holds the game's own Bullet objects, read (never written)
through the pointer chain from the static analysis (notes/bullet-diff.md; offsets for one game build, in
`PhysLog.cpp`). `#` lines first: how the physics world was found (checked: the world's dispatcher is the wrapper's,
and the car's body is one of the world's objects), the car's and the ball's collision shapes (type, scaling, inner
dimensions and margin in uu; a compound's children and AABB), and every word of both `btRigidBody`s as float/int
(to find fields such as the inverse inertia at +0x1c0). Then one line per contact point every tick, written with
the main row (before the tick's physics, so a row holds the contacts the previous tick's collision pass made):
`tick, manifold (address), body0, body1 (car, ball or shape<type>: 28 plane, 21 mesh), points, threshold,
point (−1: an empty manifold), distance, lifetime, impulse, positionWorldOnA, positionWorldOnB, normal, localPointA`
(uu). `live_validate --contacts` prints them under the engine's own. If the chain doesn't check out (another game
build), the file says so and stays empty.

## Scenario files
`check_scenarios.py` checks every line's value count (the plugin stops a scenario at a bad line, mid-run);
`run_wsl.sh` runs it first.

One command per line, `#` comments: `car x y z pitch yaw roll vx vy vz wx wy wz boost` (degrees, rad/s, boost
0-100), `ball x y z vx vy vz wx wy wz`, `wait N` (N ticks, no input), `input N throttle steer pitch yaw roll jump
boost handbrake` (held N ticks), `repeat K` ... `end`. New scenarios need no rebuild: drop the file into the
scenarios folder.
