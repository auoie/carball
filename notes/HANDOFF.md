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
- **RocketSim's own code against the exe (2026-10-08, engine patches 82–89, validation finding 50):** the static
  session's audit `notes/rocketsim-audit.md` (RS-1 to RS-12) adopted: exact hitbox constants, wall friction 0.707, the
  game's pad heights and the four moved pads, deterministic maths in respawns and the goal explosion, the speed cap in
  the game's read-back, the BVH's stackless walk, the world contact rebuilt from the manifolds, and the inertia
  tensor kept through the rounding and placements (in snapshots and the network state: format 8, protocol 8;
  `CarState::refreshInertia` for placements with no pose before, as the validators'). Validate with the live
  recordings per tick and the replays: continuous wall runs flip at contact thresholds (finding 50). Left: RS-6
  (broadphase: plane AABB sign bug, island/sleep risks), RS-8/RS-9 (edge cases), RS-12's walls_021027 t125
  per-wheel error (needs per-wheel PhysLog columns and a re-recording), and whether the game's own teleports keep the
  stale tensor.
- **The user's "feel" round (2026-10-08), the static session's specs:**
  - **Done:** the client loop (`notes/client-loop-timing.md`: the f32 accumulator, 5 ticks a frame at most, the
    dilated and clamped frame time, the jump latch, lost button taps, released axis keys; LT-2..6, 8); the goal
    sequence (`notes/camera-respawn-goal.md` §3: the slow motion on the server's ticks and every client's clock,
    protocol 9's goal replay with the client playing its own recording through the LiveReplay camera, skip votes,
    auto-skip, the kickoff camera cut, fades; freeplay's 3.0 game s; GS-1..10, 12..14, 16); the respawn cameras
    (CAM-20..29) and free look (CAM-10..18: per-input camera settings, the Modern preset for new profiles, old saved
    settings migrated with free look off, Pointer Lock mouse, the device owner by key and button events).
  - **Left:** GS-11 (the scorer view) and CAM-19 (remote free look, for spectators) not needed yet; the replay's own
    sounds wait for the sound spec.
  - **Specs waiting (not started):** `notes/visual-timing.md` (VT-2..30), `notes/sound-behaviour.md` (SND-1..17),
    `notes/hud-menus.md` (HUD-1..16, MENU-1..11), `notes/arena-visuals.md` (HEX-1..4: the lower glass's hex tiling,
    18 columns per 576 uu panel; AV-1..22, and the shader formulas H-1..11 the user released), `notes/bots.md`
    (BOT-1..32: a behaviour-tree interpreter on the server). Shader-derived values may be used as values and formulas
    only (the user's condition); the unpacked caches, the decoder and exported assets stay local.
  - **Car paint (`notes/car-paint.md`):** done for both models: the game's team paint (linear), the Glossy finish
    (paint × 0.734, clear coat), the rubber trim, the lights' colours; on the dev server the static session's painted
    Fennec per team (`fennec_body_painted_*.glb`). Not done: the windows' environment reflection, the chassis boost
    glow (PNT-12).
  - **Reviews:** the static session reviews committed snapshots only (RV-n findings); tell it "ready for review: <ids>
    @ <commit>" once the user has committed. RV-1..22 committed (354e481, 505b41a); RV-23..25, 27..33, 36, 37 and the
    event-list test gaps in 2f7dd07, with visual timing part 2.
    The final freeplay rule (`notes/camera-respawn-goal.md` "Freeplay after a goal", 2026-10-09) is in 2f7dd07:
    RV-26 (released after 2 ticks), RV-38 (no scored message; either net scores for the player), RV-39 (the session's
    kickoff spots S[k mod 10], engine patch 90; the ball from z 100.49, held one tick, then it bounces (RV-57); pads reset twice),
    RV-40 (no pad pickup at full boost, engine patch 91: matches too), RV-41 (freeplay's nets are TeamNum 1: the
    explosion in the player's colour, the replay camera on a team-1 net's side), Backspace's 1.0 game s cooldown,
    Unlimited boost (freeplay's default), and the goal replay in freeplay unless "Skip goal replays" is on (Q-1: the
    user's in-game setting is on, hence no replay seen; no freeplay special case). Committed in 2f7dd07; its reviews
    (RV-42..70) and the live sitting's follow-ups are in f8b7e2c: RV-54 (the free-look rate reset when the car
    cam ends), RV-55 (engine patch 92: a jump held through a countdown doesn't fire), RV-56 (patch 91 withdrawn:
    BoostPadGrid already skips full cars), RV-57 (the freeplay ball held a tick, then it bounces: validation finding
    51), RV-58 (sky domes inside the far plane, every theme tested), RV-42..53 (particles: local-space exhaust, the
    Fennec's per-socket trail size and spawn rate, the smoke materials' grey fade, unclamped additive intensity, the
    data's own curve knots, cube-biased directions, teleports not filled, a demolished car's puffs killed, dual
    exhausts always, the cone's delay, online demolitions and the goal explosion from the server's events; table tests
    against the local fx JSONs), RV-59..70 (stadium: glow sheets on the wall line, textures decoded from sRGB, the
    glass's ENVPack colour as a radial statistic, crossed beam quads, metal goal floors, the goal-side glass polygon and
    UVs, the net's UV axes, the overlay's charts and extent, FullBright quantised, the sky's sun-side pull). Left:
    RV-52c (spark collision), RV-64's single global tone map (with AV-21's bloom), RV-68's directional fog (nothing in
    the stadium is beyond 10240 uu yet), RV-70g. Left: RV-16
    (the tail lights' brake glow: needs a brake signal), RV-18 (the masks' zero alpha: only off Chrome), RV-34/35 (HUD).
  - **Visual timing part 2 (done, 2f7dd07):** particles (`client/src/render/particles.ts`, `effects.ts`) with the
    game's emitter values: the boost trail by distance and the idle exhaust, the goal explosion (no ribbons), a
    demolition from the static session's export (`client/src/render/demolition.ts`: every emitter's values, the spark
    streams from 8 moving sources, the flipbooks' colour, size and fade measured as values, "BOOM!", the husks as
    Cascade mesh particles: their motion matches the export's simulation, rest distance p50 834 vs 842 uu; colliding
    only within 1000 uu of the camera; the game's husk meshes on the dev server); camera shakes
    (`notes/camera-shakes.md`, `client/src/camera/shake.ts`) off by default (the Modern preset), on with Default. Left:
    the ball-hit sparks (the impact triggers give their moments: no impact particle yet), pickup bursts, wheel dust, the ball
    trail, the explosion's ribbons.
  - **Arena visuals (in progress, committed through 02cf5c4; `notes/arena-visuals.md`):** a `stadium` theme (`?theme=stadium`, not
    the default) with the game's arena materials, switched on by the theme's `walls.game`: cage beams per H-8/H-8b
    (additive, 8 uu, the scan stripes and contracting rings from the measured Curve_Fire/Smoke profiles, the
    shockwave from the goal explosion: `ArenaView.explode()` / `newBall()`), the wall overlay per H-9 (the ball
    tracker is CS_FX Hexagons_Pack_01_T, the static session's answer), the lower glass per H-6 beside the goal mouths
    and as the nets (replacing the cage cells carried down there, for this theme only), glow sheets per H-5, the
    teams' linear primaries and FullBright (AV-2), the sky (H-10), sun and fog (AV-17..19). The hex textures are a
    procedural grid fitted to the game's (offset (0, 0.25), across flats / edge 1.5) with 32-step channel profiles
    measured by `scripts/hex_profile.py` (values only). Next: the floor regions (AV-5), markings (H-2), panels (H-3),
    frames (H-4), generators (H-7), the advert band and grate (AV-10, H-11), goal floors as metal (AV-13), tone mapping
    and bloom (AV-21); then ask the user whether `stadium` becomes the default.
  - **Live sitting 2026-10-09 (validation finding 51):** the per-wheel/per-contact PhysLog columns recorded
    (`walls_goal_wheels`: three nose-contact ticks a facet's point a tick apart: ill-conditioned GJK, flipped by
    ulps), Takumi +5.00 / Scarab +7.00 uu spawn offsets, the freeplay ball bouncing (RV-57). Then (f8b7e2c):
    engine patches 93 (the Octane box's exact floats) and 94 (the GJK distance sum's order), `live_validate`'s
    rotation as the game's write-back, its `--jitter` indeterminate ticks (on by default) and its opt-in `--meshes`
    for a local copy of the game's cooked meshes (the user's decision: exactness checks only, never committed or
    shipped; `out/arena_local/cooked_meshes2` is that copy with the goal halves' body offsets). The 72 live
    recordings: better or the same; the replay validation unchanged. Committed in f8b7e2c (reviewed: all fixed).
  - **In 02cf5c4 (bee7a7c amended by the user to drop RV-99's game data; reviewed: RV-94..99 fixed):** the goal halves' body origins as the game's (README row 95, validation finding
    52: on the cooked meshes, now `out/arena_local/cooked_meshes3`, every walls tick matches); every preset's exact box
    (RV-88); the countdown keeping the real input over a multi-tick Step (RV-93); `live_validate`'s jitter reworked
    (RV-91); PhysLog's bounded lines (RV-94). Client: the stadium's field (`render/stadiumField.ts`); review fixes RV-72..75, 79, 81, 82, 84, 85,
    87, 90, 92.
  - **Field shapes (the user's decision, 2026-10-09):** shapes traced from the game's meshes are local only.
    `scripts/field_plan.py` (committed: reads local data, contains none) writes them to
    `out/bsim/assets_local/arena/field_plan.json` (git-ignored); the dev server serves it at /local-assets/ and the client
    draws it when present (`loadGameFieldPlan`; `?field=rules` to compare). Builds and fresh clones draw the plan built
    from measurements and rules in `render/stadiumFieldRules.ts` (`FIELD_MEASURES`, `shippableFieldPlan`): the regions,
    markings, frame lines, goal glows and the glass beside each goal. Statistics (the lightmap tables, `FIELD_LIGHT`;
    `--light` regenerates them) ship. RV-71: the user chose (c), our own smooth environment (`ENV_GLSL`: each ring's
    mean and spread, one smooth cosine).
  - **Known e2e flake:** `e2e/online.spec.ts` "a goal: the game slows down ..." can miss its 8-frame tolerance between
    the goal's frame and the explosion's under load (seen once at 9 in a full run; 3 of 3 alone pass). Software
    rendering stalls shift the server tick to client frame mapping; it's the default theme, unaffected by the stadium.
    `e2e/freeplay.spec.ts` "freeplay loads, drives and resets" missed its reset once under load (Backspace inside its
    1.0 game s cooldown: the slowed game hadn't run a second since the spawn); it now presses again until it takes.
  - **Also in 02cf5c4:** the arena's reflection capture (`render/grassCube.ts`: GrassCube, once before the first frame,
    `Renderer.beforeNextFrame`); the field's materials as the game's (H-1, H-3, H-4, Reflective_Floor_B; baked light
    only: each piece's lightmap statistics from the static session, `FIELD_LIGHT`; the frame's glowing (E) and
    team-coloured (D) lines traced from FrameTexture_PACK's stripes through the meshes' UVs); the goals' glows (RV-77:
    `GOAL_GLOW` ribbons) and see-through layered floors (RV-76: `render/goalInterior.ts`); RV-83's data and shake
    tests; RV-86's soft particles (the floor as the scene behind). RV-71 since settled ((c), above); the markings' light
    and the surroundings spec (`notes/arena-surroundings.md`, SUR-1..44) have arrived.
  - **Also in 02cf5c4:** the surroundings (`render/themes/stadiumSurroundings.ts`: GrassCube as the game's capture,
    the hotspots, the stands from tier rules, the structures as low-order fits, the crowd, screens, props, the far
    layer), RV-94..98 (wasm smoketest path, the child origin's bits, PhysLog's SafeRead and `origin_bu`,
    `live_validate`'s option values, docs), RV-99 (the shipped-data guard, `render/shippedData.test.ts`).
  - **In a1ab6a0, the static session's RV-100..132:**
    - field and goals: the grass's reflection as H-1's (RV-100) and its light by x and |y| (RV-105a); the centre disc
      and trims to the game's radii (RV-102); RV-103a, c, d (the centre arc's legs, 16.3 hatch bars, the strip's flat
      end; b, e, f wait on extents from the static session); OOBFloor under each goal, a hex slope in its own light
      (RV-104); the tire-mark factors on the frames (RV-105b); the vent baked-only (RV-106); the goal glows (RV-108,
      and `field_plan.py` pairs free edges within a piece); the overlay's corner charts (RV-109); the net's charts
      (RV-110); the goal floor's opaque strips and lower glass chart (RV-111);
    - online: the client predicts no demolitions (`World.setDemolitions(false)`, a new engine binding: the server's
      alone, as the game's), the drawn and recorded demolished state the server's (RV-112);
    - RV-113: the particle constant and comment, the far-plane test over each theme's animation (the city's
      searchlights shortened), BOOM soft against the floor, value tests (envG's rings, the sky's v and q);
    - RV-95: the child origin by the game's chain (x 0.02f x 50f x 0.02f, `Car.cpp`; the same bits);
    - shipped-data guard (RV-114, RV-131): strings and shaders scanned, every number form, transposed pairs and
      triples, the surroundings' meshes (`scripts/reference_vertices.py` exports a local reference to
      `out/arena_local/reference/`), their (r, z) statistics, imported JSON, the bundle; controls built from the local
      data prove each form is caught; it found two copied glow points, now named measures;
    - RV-115..118 (comment, triangle-sampled cage test, `live_validate` value ranges, these notes);
    - surroundings (RV-119..128, 132): the hotspots as the game's ellipses, the +X one unfogged above the horizon, all
      placed inside the dome; the high screens facing down; the crowd's light (HL2 basis, warm); the tiers seated where
      the game's are (per-tier spans, the top tier's rows, the +X ends' cut, the -X corner's section); the -X plaza
      open; the floodlights' bulbs on the middle row; per-placement panel light, the logo at 14 %, two-row TV strips,
      brighter windows, the banners' texture term; ribs to the roof's edge; sunk cards hidden; the bob phase shared.
      The crowd and the screens and props now in `stadiumCrowd.ts` and `stadiumProps.ts`.
  - **In c222307 (since a1ab6a0):**
    - the SUR-35 calibration: the dev arena viewer's `cubeFaces()` (`GrassCube.readCapture`) reads the capture back;
      a script bins it as the game's reflection profile (`reflection_profile.json`, local): RMS luminance 0.148 ->
      0.089 over 180 cells. What moved it: the capture in two passes, the second with a constant cube of the first's
      upper hemisphere's mean (SUR-32's G_env); the apron round the cage and the -X plaza's sidewalk (SUR-4); the +X
      ends' stands starting at their first seated row; the hotspots drawn after the canopy; the +X hotspot's fade
      smoothstep(8, 25). Open with the static session: the corner flags' seen colour, what occludes az 180 below el 7
      (the statue), the grass at grazing (G_env applies or not);
    - `render/themes/stadiumLights.ts`: the team uplight beams and the floodlights' flare sheets (SUR-13), the team
      light bulbs, the canopy's mullions with their light dots, the StadiumFog haze and the near fog sheets (RV-130);
    - the floodlights as the game's 42 fixtures a bank (RV-125: two halves, the v-profile statistic, the lens rows at
      the fixtures);
    - RV-103b, e, f: the goal end's side with its jogs, Goal_Lines' and Field_Side_Lines' open pieces with their hooks,
      stroke rows and clusters, the E trim line's real path (one a quadrant), from the static session's named measures;
    - RV-113: the particle comment (the demolition's draws were right);
    - the -X plaza (RV-133: the plinth, the statue, the poplars as named measures; the roof to az 176, low city beyond)
      and the corner flags (five poles a corner on r 6185, banners with their strips, the static session's measures);
    - the capture in three passes (the game re-captures over its first 2 s), calibrated against CAL1's corrected
      profile: RMS 0.082;
    - RV-141..146: the centre arc's legs and downs with rounded joins (raster IoU 0.928 against Field_Center_Lines,
      local), the advert strip's second bar and Glass_Outer's V, the goal glows as two loops (round the mouth on the back
      wall, and the field side's round the mouth piece's front: lines and fillets, every traced point within 10 uu),
      the low beside-glow's profile, H-4's tire marks inside the saturate, OOBFloor's slope-only light and the bevels'
      own, the grass light's bins on 256's;
    - RV-109/110: the overlays' charts (the 45-degree diagonal the back walls' u, the diagonal corners' top fillet row
      the roof's) within 0.028 UV of FF_Goal/Side/Roof at every vertex, the net side walls within 0.0033 (local tests);
    - RV-138..140: the shipping guard by stride (1-8, every phase), with UV rows and per-azimuth columns matched in
      order, (az, value) pairs, the crowd tiers, decimals without trailing zeros, written integers (index lists), the
      cage topology's own index arrays blanked (it's pinned as topology), JSON through the build's aliases, dist's HTML
      and CSS; controls for every form in the static session's battery (scripts/reference_vertices.py writes the local
      reference);
    - RV-148: the shaders' functions as exported GLSL (overlayUv, netSideUv, underGlassV, grassReflection, envG), run on
      the GPU against their TypeScript twins (`?viewer=shaders`, e2e `shaders.spec.ts`); engine test for RV-95's chain at
      a 10/20 uu offset;
    - the boost pads' taken look: the dim mix tested USE_INSTANCING_COLOR in the fragment shader, which three defines
      only for the vertex shader (the fragment's is USE_COLOR), so taken pads drew lit; now a GPU render check (taken =
      the dim reference, under half the lit). A full car takes no pad (CanPickup: !IsFull), freeplay's Unlimited too;
    - "Unlimited boost in free play" (MENU-9) in the settings' Controller tab, on by default as the game's: off, the tank
      at a round's 33 (BOOST_SPAWN_AMOUNT), drained by boosting, pads taken (engine setUnlimitedBoost; turning it off
      mid-session sets the tank to 33 at once). e2e: on, a full car leaves the pad; off via the panel, the pad is taken
      (+12) and its pixels go dark.
    - the post-processing (notes/post-processing.md PP-1..20; `render/postProcess.ts`): the scene linear HDR into a
      half-float target, the depth of field's soft layer (0.25 everywhere, to 0.6 far off), the bloom (soft knee from 2,
      the three Gaussian sizes by the game's tap rule), then the tone map and the 16-node remap to display values (no
      three.js tone mapping or sRGB encode; no anti-aliasing, the game's default); a 1 s fade-in from black. The
      per-material 1 - exp(-c) curves are gone (RV-64), the translucent blends linear (RV-107). Video tab: Bloom, Depth
      of Field (on). Tests: the twins against the spec's tables and taps; on the GPU the GLSL against the twins, a
      uniform grey through the whole chain at its display value, bloom only with Bloom on;
    - the sky in full (H-10 detail, `themes/stadiumSky.ts`): the clouds and stars on our own noises (made at load from
      the textures' quantiles, correlations, feature sizes and neighbour correlation; stored 8-bit sRGB, mipmapped, as
      the game's), each elevation band's mean within 15 % of the game's sky (tested). The capture's zenith stays 0.01:
      its 256 mips average the sub-texel stars, where the static session's profile samples them full-res.
    Left: RV-129 (with SUR-24's fog constants), trees (SUR-11), the far fog sheets and the searchlights; motion blur,
    SSAO, sun shafts and lens flares (PP-11..14).
    - the impact triggers' engine half (engine patch 96, notes/impact-triggers.md IT-1..3): per step, each car's
      contacts with each partner averaged as the game's (the solver setup's point velocities kept on btManifoldPoint),
      the line check's normal, speed |dv . n| (50 or more kept); `takeImpacts` (collection on in the browser engine
      only: the server and tools don't take them; capped); each wheel's ray-hit normal in the car state for the landing
      trigger (IT-5). Tests: TestImpacts (native and WASM).
  - **Since c222307 (uncommitted):** the impact triggers' client half (`game/impactTriggers.ts`): the local car's
    Impact_Medium shake (restarted by every hit over 200 uu/s, scaled by the curve), the sparks' and body sound's gate (50
    uu/s, 0.15 s game-time cooldowns per world/actor slot; car–ball sounds the ball's Impact_Ball on its own cooldown;
    car–car one side, the larger index [I]), the landings per wheel per frame (the previous frame's chassis velocity at
    the hard point along the ray-hit normal, over 50; every car, no cooldown); re-simulated ticks skipped online. They
    replace audio/detect.ts's guessed impacts, landings, bumps and car–ball hits (the ball's bounces off the arena stay
    guessed). Sparks aren't drawn yet (no impact particle). The sky's noise is made once (memoised, ~0.5 s).
    The engine's review fixes RV-162..166 (native and WASM 3256/0). The client's review fixes RV-149..161, 167..169:
    hotspots' tilt to the line of sight; banners and corner flags lit per placement (flags as rotations, poles beside
    the cloth, a two-tone cloth so the capture's per-pixel clip matches CAL1); supports onto their ring past 145 (no
    rib at 173); aisles 576 uu wide through all rows; the plaza (wider plinth, the statue as its outline seen from C,
    spindle poplars, the city by rule from az 180.5); 26 team beams at the game's mean alpha; the camera fade folded
    into the remap's nodes before their clip (the replay's fade now drawn there, not by a CSS overlay); the sky's
    noise to the textures' correlations (~0.4 s); the goal floor's trim strip and V offset; the field glow loop from
    its own measures; a Gameplay settings tab. The shipped-data guard: every import form scanned (glob, ?raw, ?url,
    import(), new URL), the arena's .cmf pinned to out/arena, exponent forms, signed UV pairs, strides to 16, small
    integers on longer runs, and a texture check against `out/arena_local/reference/textures.f32`
    (scripts/reference_textures.py: rows along one stream place, bending; ramps are profiles and allowed).
  - **In 674f3ef:** all of the above. **Since 674f3ef (uncommitted):** the plaza statue as a rule (CAL1's bbox, its
    width 220 -> 600 up it, fitted to the coverage statistics; RV-154c: az 181's first open sky only a plausibility
    range, ruled), the large poplar back to 1800 (named measures aren't tuned to tests), the poplars' cover 41.6 %; the
    exe's height fog (notes/arena-surroundings.md FOG-1..15: `client/src/render/heightFog.ts`): three's fog off in the
    stadium, every theme material fogged by `fogAll` (opaque per pixel, translucent/additive per vertex, the sky at
    the game's dome's distance, the far layer's city at 100k and its FogCylinder band at 57.3k, the hotspots at their
    game distances; the capture's faces capped at 31,887 uu of view depth), the GLSL checked against the TS twin on the
    GPU (`?viewer=shaders`: heightFog, heightFogCapture; a series where float32 cancels at level sight lines).
    WIP, untracked: `game/quickChat.ts` and `ui/chatLog.ts` (+ tests): the presets, slots, menu, spam bucket, log format.
    Next: post-processing part 2 (notes/post-processing.md PP-21..32: the render split opaque -> AO -> translucent,
    SSAO, shafts, flares, motion blur; the cube blur after the static session's capture recompute), quick chat's wiring
    (protocol, server bucket and relay, input, settings), match stats (STAT-1..24), custom training, mutators, the
    match intro/outro (its text cleared verbatim) and the car's look (notes/car-paint.md PNT-16..33).
  - **Decided (user, 2026-10-10): no controller rumble.** notes/rumble.md stays as a reference spec only. The contact
    detection it asked about (the static session's Q-RMB-a: HandleCollision's cadence, the contact's point and normal,
    the landing speed) is still wanted, for the Impact_Medium camera shake and the impact and landing sounds; don't
    assume per-step firing until the answer comes.
  - **Local assets from the static session** (dev-only, git-ignored, load when present like the Fennec; each with a
    README and manifest): `out/bsim/assets_local/fx/` (ball GLB and material formula, the boost trail and the goal
    explosion as emitter JSON, schema rl-fx/1), `cars/` (six cars painted per team with their hitbox presets and
    wheels), `sound/` (1098 Ogg files and a Wwise manifest: events, containers, curves). Not used yet. `notes/wheel-kick-t125.md` (walls_021027
    t125: a hitbox nose contact, not a wheel) needs per-wheel and per-manifold PhysLog columns and a recording of
    `walls_goal_wheels.txt`, with the user in freeplay.
  - **Settled with the static session:** the game's jitter buffer measures in real time too (it widens after a goal,
    as ours); `bSlomoForDefender` stays set for the match (one replay director per game event); the replay's earliest
    start is the round's countdown, when the ball spawns.
  - **Browser tests:** under 24 fps (software WebGL here: about 11 fps at 1280×720) the game's 5-tick cap runs the
    simulation slower than real time, so tests wait for outcomes instead of timing them; the goal test uses a second
    server (`--test-goal-after 1`, ports 14435/14436).
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
  - **Cage pattern (done 2026-10-08):** builds draw the game's lattice laid out from the shippable topology
    (`client/src/render/cageLayout.ts`, a port of `scripts/cage_layout.py`; `scripts/cage_topology.json`, user-approved
    derived data); the dev server prefers the static session's local export (`out/bsim/assets_local/cage/`;
    `?cage=topology` skips it). Left: the lower glass. Ours carries the cage's wall cells down to the trim beside the
    goals (the user's ask); the game's is a separate, smaller hex texture on a few panels (UV mappings in the static
    session's message of 2026-10-08; the tiling factor needs a screenshot count of hex columns across a 576 uu panel).
- **The live game updated on 2026-10-06; decompile the live build** (the user's standing rule, for this and any later
  update). Static reads (exe, packages, texture caches) use the user's snapshot of it,
  `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague-20261006/` (identical to the Steam folder;
  exe sha256 bfeba09f0e82db0b…); the Steam install (`/mnt/c/Program Files (x86)/Steam/steamapps/common/rocketleague`)
  only for live recordings, since the game runs from it. Each update gets its own snapshot folder
  (`rocketleague-YYYYMMDD`), made before analysing it; the old build stays at `rocketleague/`. Its Ghidra project is
  `out/bsim/rl-20261006` (project RocketLeague, fully analysed, natives named from the live exe), its dumps
  `out/bsim/live-20261006/` (natives.csv, gnatives.csv, classes.csv), the old→live function map
  `out/bsim/bindiff/function_map.tsv`. The old 2026-06-16 project (`ghidra/RocketLeague`, `out/bsim/rl-20260616`,
  `out/decomp`) is older evidence only; leave `out/bsim/rl-20260616` untouched (shared with the Arch desktop). Physics
  functions look unchanged (finding 25), but trust the live recordings over the decompile where they disagree.
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
| Live build snapshot (2026-10-06): static reads | `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague-20261006` |
| Live game (Steam): recordings only | `/mnt/c/Program Files (x86)/Steam/steamapps/common/rocketleague` |
| Old build (2026-06-16) | `/mnt/primary/home/arch/documents/binaries/rocket-league/rocketleague` |
| Exe | `<build>/Binaries/Win64/RocketLeague.exe` (image base 0x140000000) |
| Packages | `<build>/TAGame/CookedPCConsole/*.upk` (decrypt from the live snapshot) |
| Replay dataset (116 GB zip, ~120k replays 2021–Sep 2025, `1v1/ 2v2/ 3v3/` + `metadata.jsonl`) | `/mnt/primary/home/arch/documents/rocket_league_replays/high-level-rocket-league-replay-dataset.zip` |
| Ghidra project, live build 2026-10-06 (fully analysed, natives named): use this one | `out/bsim/rl-20261006` (git-ignored) |
| Ghidra project, old build 2026-06-16 | `ghidra/RocketLeague` (git-ignored) |
| Decrypted packages | `out/decrypted/` (git-ignored): TAGame, GameInfo_Soccar_SF, GameInfo_Default_SF, Body_Octane_SF, Stadium_P, Engine, Core, ProjectX, Mutators_SF, Startup |
| Package AES key | `out/rlupktool_key.bin` (public RLUPKTool key; git-ignored) |
| Decompiled C | `out/decomp/<name>@<addr>.c` (git-ignored) |
| Extracted arena meshes (measurement only, never ship) | `out/arena_local/*.obj` (git-ignored) |

Scratchpad copies (RocketSim and RLUPKTool clones, extracted replays, `states.csv`) are temporary.
Regenerate: `git clone --depth 1 https://github.com/ZealanL/RocketSim`; replays via Python `zipfile`
from the dataset zip (newest by `metadata.jsonl` `data.date`).

## Tools (run Python scripts from `scripts/`; plain `python3`, not `-I`)
```sh
# Ghidra on the live build. -readOnly still locks the project: work on a copy per job, and cap its memory.
# DecompAt decompiles the functions containing the addresses, plus their callers to DEPTH, into OUTDIR.
cp -r out/bsim/rl-20261006 JOB/rl-live
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=1G env MAXMEM=8G \
  /opt/ghidra/support/analyzeHeadless JOB/rl-live RocketLeague -process RocketLeague.exe -noanalysis -readOnly \
  -scriptPath out/bsim/work/ghidra_scripts -postScript DecompAt.java OUTDIR DEPTH 0x140f54bd0
# Old build (older evidence): the same with project ghidra/RocketLeague and -scriptPath scripts -postScript Decomp.java
# ADDR.. (-> out/decomp/).
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
- Never wait for a run to finish with `pgrep -f` on command names (`while pgrep -f "npm run chec[k]"; do sleep`):
  the bracket only keeps the pattern from matching its own text. A waiting shell whose command line also holds the
  real command it launches next (`...; npm run check ...`) matches itself forever, and so do other waiting shells
  (2026-10-08: three such loops deadlocked, so client runs 28–30 never started). Wait on the job instead: a single
  background job (`run_in_background`, notified when it exits) or `$!` / `wait`, or poll a status file the job writes.
  Type check and unit tests after each change; the full build and e2e (5–8 min) once at the end of a batch.
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
