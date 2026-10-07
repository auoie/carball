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

- **Scripted scenarios** (most useful): `physlog_run steer`, `physlog_run air`, `physlog_run jumps`, `physlog_run walls`,
  `physlog_run ball_roof`, `physlog_run powerslide`. Each places the car (and the ball), plays exact inputs, and
  stops when done. Keep your hands off the controller while one runs. Run `steer` again with each other car you
  have (Dominus, Batmobile/Plank, Breakout, Hybrid, Merc, and anything else): the file header records the body
  and its hitbox and wheels.
- **Free driving**: `physlog_start <name>` ... `physlog_stop`. Aerials, air rolls, flips and cancels, wall play:
  anything, a few minutes at a time.

Recordings go to `%APPDATA%\bakkesmod\bakkesmod\data\physlog\` as `<name>_<date>_<time>.csv`. Copy them into
`out/live/` in this repository.

## File format
A `#` header line (body id, collision extent and offset, each wheel's radius, rest position, ray start and travel),
then one row per tick: `tick`, `time` (the car's RBState time), car and ball state (quaternion x y z w, location,
linear velocity, angular velocity, sleeping), the input applied this tick, then the car state: on ground, wheel
contacts, jumped / double jumped / has flip, supersonic and time below supersonic speed, boost (0-1), jump, double
jump and dodge components (active, active time; dodge torque), the vehicle sim's output throttle/steer/handbrake,
the front wheels' steer, each wheel's contact and suspension distance. The state is taken when the game sets the
car's input for the tick, before that tick's physics, so the next row holds the tick's result.

## Scenario files
One command per line, `#` comments: `car x y z pitch yaw roll vx vy vz wx wy wz boost` (degrees, rad/s, boost
0-100), `ball x y z vx vy vz wx wy wz`, `wait N` (N ticks, no input), `input N throttle steer pitch yaw roll jump
boost handbrake` (held N ticks), `repeat K` ... `end`. New scenarios need no rebuild: drop the file into the
scenarios folder.
