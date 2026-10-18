# Web client

Browser freeplay and online play: Three.js rendering on top of the WebAssembly physics engine (`engine/`), in the
arena we generated (`out/arena/`). TypeScript (strict) + Vite. Online play connects to the game server (`server/`)
over WebTransport.

## Run
```sh
# 1. Build the engine for the web (once, and after engine changes); see engine/README.md
PATH=/usr/lib/emscripten:$PATH emcmake cmake -S engine -B engine/build-wasm -DCMAKE_BUILD_TYPE=Release
PATH=/usr/lib/emscripten:$PATH emmake make -C engine/build-wasm -j

# 2. The client
cd client
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/ (typechecks first)
npm run preview:fast # build without the typecheck (~0.5 s; writes dist/), then serve it at http://localhost:4173
```
Online: start the server (`cd server && cargo run --release`), then open `http://localhost:5173/?server` (or
`?server=host:infoPort`). Every player who opens it joins the same match; teams are balanced.

Map: Night, the only one (the user's decision of 2026-10-17): our glasshouse arena and football pitch under Night's dark
sky (`src/render/themes/night.ts`, `src/render/greenhouse.ts`). Play → Free Play starts free play on it; every online
match is on it (map 0 on the wire: protocol/README.md "Maps"). The other maps are in the history (3cb78f8).

Custom training (offline; notes/custom-training.md): Play → Custom Training lists the player's own packs, Carball's
starter packs (`src/training/starterPacks.ts`, ours) and, on the dev server alone, the user's own packs converted locally
(other creators' work: `out/bsim/assets_local/training/packs/`, git-ignored, never in a build). A pack is Carball's JSON
format (`src/training/pack.ts`: metadata and 1-50 shots, each the ball's start, launch rotator and speed, the car's start,
the time limit). Played as the game's rules (`src/training/run.ts`, wired into free play's session): the countdown until
input with the ball frozen and its path previewed, the timer, the striker's goal after a touch or the goalie's save, then
the next shot; reset, previous/next, shuffle and mirror; per-shot progress kept by pack; the Training settings tab (game
speed, input delay, the variance's modifiers, boost, Skip Goal Replay). Create Training opens the editor
(`src/ui/trainingEditor.ts`): the shots' ball, launch, car and time limit, placed by clicking the field under an orbiting
camera, saved in the browser, exported and imported as pack files, playtested. Its other mode, Free camera (the player's
choice, kept), is the game's (`src/ui/flyEditor.ts`, rules in `src/training/editorControls.ts`; notes/training-editor.md):
the shot list, a fly camera, the ball and car selected in turn and moved and aimed with the movement keys and the look,
the speeds on the wheel or the bumpers, the strength meter, Test Shot and Test Sequence on Tab or the pad's View.

Car models (`cars/README.md`): a garage car wears `cars/<type>.glb` (sport, flat, tall) where it's there, made in
Blender to that folder's contract, else its generated model; its paint the team's, its wheels where the model has them
along and across the car, their height and steering the physics' (`World.carWheels`), turning as it moves
(`src/render/carGlb.ts`). Sport, Flat and Tall wear theirs (approved 2026-10-18).

The game's Fennec (testing only): with the static session's local export in `out/bsim/assets_local/fennec/`
(Psyonix assets: git-ignored, never copied into client/, never shipped), `npm run dev` serves it at `/local-assets/`
and cars of the Octane hitbox wear it, painted in the team's colour (`src/render/fennec.ts`), but only while Sport has no
model of its own: with `cars/sport.glb` there (as now) it isn't even loaded. Builds, `vite preview` and the e2e tests never
see it. Likewise a demolition's husks: the game's meshes (`out/bsim/assets_local/fx/demolition/meshes/`)
on the dev server, boxes and wheels of their size in builds (`src/render/demolition.ts`).

## Correctness checks
```sh
npm run check        # tsc (3 projects) + ESLint (strict type-aware) + Prettier's check + Vitest
npm run format       # Prettier over the client (pinned: package.json; .prettierrc, .prettierignore)
npm run build && npm run e2e   # Playwright in the installed Chrome: load, drive, ball cam, reset, settings, and
                               # two players online against a local carball-server (built and started by the config)
                               # (e2e/fixtures.ts hides real gamepads from the page)
```
- **TypeScript** (`tsconfig.app.json`): `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no unused
  code, no implicit returns or fallthrough. Tests (`tsconfig.test.json`) and config/e2e files (`tsconfig.node.json`) are
  separate projects, so Node APIs can't leak into browser code.
- **ESLint**: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, exhaustive switches, no `any`; zero warnings allowed.
- **Prettier** (exact-pinned, 160 columns): the layout, checked by `npm run check`; `eslint-config-prettier` keeps ESLint
  out of it. Comments keep their own wrapping (Prettier doesn't reflow them).
- **Engine types**: `engine/build-wasm/carball_engine*.d.mts` are generated by Emscripten from the C++ bindings, so the
  client is type-checked against the real engine API.
- **Vitest**: pure modules (input mapping, deadzones, fixed-step clock, camera maths, coordinate conversion, the
  protocol against the byte vectors shared with the server) plus integration tests against the real WebAssembly
  module: the engine wrapper (`src/engine/world.test.ts`) and client prediction against a simulated server with
  latency and loss (`src/net/predictor.test.ts`: the local car is predicted exactly, frame by frame).

## Layout
| Path | |
|---|---|
| `src/engine/world.ts` | typed wrapper around the engine (`World`: cars, ball, pads, events, snapshots) |
| `src/engine/cmf.ts` | reads the arena collision mesh (also used for rendering) |
| `src/input/` | actions + default bindings from Rocket League's `DefaultInput.ini`, deadzones, sensitivity, devices → controls; buttons act on their press and release events, before the frame's ticks (a boost tap within a frame is lost, a jump press is one tick of jump however short, a keyboard axis key counts the frame it's let go: `notes/client-loop-timing.md` LT-4..6); the free look's device is the last key or button event's |
| `src/settings/`, `src/ui/` | player settings (bindings, camera with per-input camera settings, controller), storage, settings menu; a new profile's camera is the game's Modern preset (keyboard and mouse: free look, ball cam held), one saved before is migrated as the game's old profiles (free look off) |
| `src/loop/fixedStep.ts` | physics at 120 ticks per game second, as the game's loop (`notes/client-loop-timing.md`): each frame's world time (real time × the time dilation, clamped to 0.0005–0.4 s) into a 32-bit accumulator, at most 5 ticks a frame (the rest dropped: under 24 fps the game runs slower than real time); rendering interpolates between ticks |
| `src/camera/` | the game's cameras, ported from its UnrealScript (`notes/camera.md`, `notes/camera-respawn-goal.md`): car cam, ball cam and their blends; free look (`freeLook.ts`: rate control with the game's smoothing; the mouse through Pointer Lock, or the stick; the view turns only by it, focus and distance follow the car-facing frame, the free-look ball cam and its exit rules); after a demolition the wreck view, the spot selection and the prespawn view, each with the game's blend; the goal replay's camera (`replayCamera.ts`, LiveReplay); camera shakes (`shake.ts`: the game's ShakeComponent_X oscillators, summed after the swivel, scaled by distance from your car; goal, demolition, pad pickups, your jumps and dodges; only with the camera shake option, which the Default preset turns on and Modern, the default, leaves off) |
| `src/render/themes/` | the map's look: Night (`night.ts`: its dark sky, light and ground round the glasshouse arena, its team colours), the theme types (`theme.ts`); scenery stays out of the playing volume (tested) |
| `src/render/` | Three.js scene: the car (`carModel.ts`: a Fennec-style body built around each hitbox, with angular flared arches, black cladding and side vent, roof spoiler, the tail 10 uu past the hitbox; on the dev server, with the game's own Fennec exported locally, cars of its hitbox wear that instead: `fennec.ts`, see below), the ball (drawn with the engine's orientation: the engine turns it, as the game does) with its shadow on the floor, the trim and the goals' floors (`ballShadow.ts`), the boost pads (`tokenPads.ts`: our low pucks and round pedestals with a floating ball), and the arena (`arena.ts`): walls and ceiling one continuous swept surface (`arenaSurface.ts`, from the collision mesh's rules) as our glasshouse (`greenhouse.ts`: clear panes in a triangular lattice of team-coloured glass bars lit round the ball with the game's beam curves and goal shockwave (`cageBeams.ts`), lettered boards along the wall's foot from the game's frame measures (`wallFoot.ts`), white goal frames with a glow round each mouth, a football pitch in a shader); the goals' insides (`goalSurface.ts`) with the game's hex glass as their nets (`gameSurfaces.ts`, procedural, values only); in the teams' linear primaries (`teamColors.ts`, AV-2). Effects with the game's emitter values and our own sprites (`particles.ts`: spawning by rate, bursts and distance, curves over life, HDR colours tone-mapped; `effects.ts`: the boost trail by distance from each exhaust, the idle exhaust, the goal explosion in the scoring team's colour with its electric sphere, a demolition (`demolition.ts`: the game's emitters, the spark streams from 8 moving sources, the flipbooks' colour, size and fade as measured values, "BOOM!", the husks as Cascade mesh particles: flung at 3 x their base velocity, freezing or bouncing on the world only within 1000 uu of the camera); the supersonic trails from the rear wheels touching the ground) |
| `src/debug/` | `?viewer=car`: the car model alone on a turntable (`window.carballCarViewer.view(azimuth, elevation, distance)`); `?viewer=arena`: the arena under a free camera, with the ball and a car placed anywhere (`window.carballArenaViewer.view({eye, target, ball, car, fov, sinceExplosion})`, game frame; `sinceExplosion`: the cage's shockwave that many seconds after a goal); both for comparing with the game's. In freeplay `window.carballFreeplay.place(car, ball)` places the car and ball (screenshots, tests) |
| `src/game/freeplay.ts` | freeplay rules (`notes/camera-respawn-goal.md` "Freeplay after a goal"): a goal in either net scores for the player, in its colour, with no message; 3.0 game s slowed at first, then the goal replay unless "Skip goal replays" is on (`replayPlan.ts`: the server's planner; `replayPlayback.ts`: shared with online), then the new round: the session's kickoff spots in turn, alternating halves (S[k mod 10]), the ball dropping from its spawn, the pads back (and again 0.1 s later), the car released after 0.01 s; Backspace starts one (at most once a game second); Unlimited boost; ball-in-front / ball-on-car |
| `src/game/goalSequence.ts` | the goal's slow motion (`ScoreSlomoCurve`, 3.53 s for its 360 ticks) and the replay's speed |
| `src/game/online.ts` | online play: inputs out at 60 Hz, server updates in, prediction, HUD ping/buffer; after a goal the clock slows with the server's, then the goal replay from this client's own recording (`replayRecorder.ts`: each frame as corrections settle it), Space / pad A to skip, fades from black in and out, the camera starting over at the kickoff |
| `src/net/protocol.ts` | protocol codec (`protocol/README.md`) |
| `src/net/connection.ts` | WebTransport connection: control stream + datagrams; dev certificate hash from the info endpoint |
| `src/net/predictor.ts` | prediction and rollback: snapshot per frame, rewind to the acknowledged frame, apply the server state, replay; other cars' inputs fade over 0.1 s |
| `src/net/updates.ts` | reassembles updates split over several datagrams |

Coordinates: the game's frame (x, y horizontal, z up, left-handed) maps to Three.js as `(x, z, y)`
(`src/render/coords.ts`). Blue defends −y, orange +y.

## Controls and settings
Esc opens the settings menu (`src/ui/settingsPanel.ts`): rebind every action (one keyboard/mouse and one gamepad
input each; gamepad buttons, triggers and stick directions all bindable), the game's camera settings, and the
controller settings (controller deadzone, dodge deadzone, steering and aerial sensitivity), all with the game's
defaults and slider ranges, plus its options (ball/rear camera toggle or hold, invert swivel pitch, keyboard air
pitch safety). Saved in localStorage (`src/settings/settings.ts`, validated field by field on load). H shows the
current bindings.

Input follows the game (`notes/input.md`): the deadzone applies per stick axis; holding air roll turns yaw into
roll and replaces directional roll; the sensitivities and dodge deadzone are applied by the engine
(`World.setCarPreferences`), as the game applies them on the server; the right stick swivels the camera. With an
action on both devices, their axes add up before the control is clamped, and a button is a press and a release
command (the last one wins: releasing either of two held inputs releases it; `ButtonLatch`). A gamepad button or
trigger bound to a button action is down past raw 30/255 of its travel (the game's digital threshold); a trigger
driving an axis (throttle, reverse) has the triggers' 0.1 deadzone (measured live). The dodge's forward
input goes as its own byte (-pitch made a byte on its own, as the game's DodgeForward).

Defaults follow the live game's "Modern" layout (its default since the 2026-10-06 update): W/S throttle (and pitch
in the air), A/D steer/yaw, Q/E air roll, Space jump (left mouse too: the alternative jump), Left Shift boost, right
mouse powerslide/air roll, middle mouse ball cam, Left Ctrl rear camera, Backspace reset, 1/2 ball in front / on car.
Gamepad (the game's Modern controller layout): RT throttle, LT reverse and air roll (one input on both, as the game
binds it), left stick, A jump, B boost, X powerslide, Y ball cam, RB reset, D-pad down/up. Saved bindings keep what
was saved (air roll stays on X for a player who saved it there).
Demolished online: steer left or right (A/D, left stick) picks the respawn spot for the first 2.5 s.
