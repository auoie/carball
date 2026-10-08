# Live-help sitting: what needs the user at the game (static session, 2026-10-08)

One batched sitting, about **45–50 minutes**. Offline only (game started without EAC, BakkesMod), game **windowed**,
PhysLog loaded. The live session drives everything over rcon from WSL (`tools/physlog/run_wsl.sh`, `physlog_*`); the
user only does what the game's menus require (starting modes, equipping bodies) and the few things that need hands on
the controller. Each step says what the user does, what the session runs, and why (the hypothesis it settles).

**PhysLog additions (live session, status 2026-10-08):** done — `physlog_products` (owned bodies:
`out/live/products_20261008.tsv`, local), `physlog_vsim` (checked on Fennec: the Octane-preset curves exactly),
`physlog_removebot <team>`, recording in offline matches (`Allowed()`: in game and not online). Until the next game
start they also run as `physlog_cars products`, `physlog_cars vsim`, `physlog_removebots <team>` (rcon whitelist is
read at start). Not done: match-state columns; no rows while the player's car is demolished (it is the row clock), so
the respawn spot shows on the first row after the respawn but the lock moment can't be seen. Optional: camera pose
columns for CAM-2 (⚙).

**GA-6 (spawn offset per body):** the user owns none of the 18 bodies with a nonzero `HandlingPresetXOffset` (checked
against all 73 owned bodies), so the X part stays **validated by code only** (InitBodyAsset → body created at the mesh
transform; G4); the 602 replays can't separate it either (every body there also fits a no-offset body by spawn height).
The Z part (creation height 35.774 + Tz) is confirmed by replays to 0.003 uu and is recorded again per body in step 2.

## 0. Setup (user, 3 min)
- Start the game without EAC, windowed; main menu → **Play → Free Play** (Stadium). Controller plugged in.
- Session: `tools/physlog/check_game.sh --freeplay`, `plugin load physlog` via rcon.
- User reads out the menu values (Settings → Camera): **Camera Preset**, **Invert Swivel** (Controller and KBM),
  **Free Look Camera** (Controller and KBM), **Ball Camera Mode** (toggle/hold). Settles C-1, CAM-3/4 (the keyboard
  layout is already decided: Modern).

## 1. Body IDs — done (live session, `out/live/products_20261008.tsv`)

## 2. Per-body runs (≈ 3–4 min per body; 6 bodies ≈ 20 min)
One body per handling preset, all owned: **Octane 23** (reference), **Dominus 403**, **Paladin 24** (Plank),
**Breakout 22**, **Venom 31** (Hybrid), **Merc 30**. The physics body is the garage loadout's: BakkesMod's item mod
(`physlog_body`) and bot spawns only change looks, not the hitbox or preset.
For each body:
1. **User: main menu → Garage → Body → equip it → Play → Free Play** (never `start <map>`).
2. Session (the recording header shows the preset and extents, so a wrong body is caught at once):
   - `run_wsl.sh steer` — non-Octane steering residual (validation finding 21);
   - ⚙ `physlog_vsim` — steering/drive curves vs `out/bsim/agents/G2/work/expected_steer_curves.txt` (G2 L5);
   - while recording (`physlog_start spawn_<body>` … `physlog_stop`): `physlog_resetplayers` twice
     (`GameEvent_TA.ResetPlayers` destroys every player's car and `RestartPlayer`s it: `SpawnCar` → body created at
     the mesh transform, with T) — the first RBState of the new car vs Octane's at the same freeplay spot:
     displacement along the car's forward axis = X offset, z0 = z + vz²/1300 = 35.774 + Tz (GA-6, LR-1);
3. User: Esc → Exit to Main Menu (for the next body).
- At the end the user may re-equip their usual body.

## 3. Hands on the controller (user, 5 min, in freeplay; session records with `physlog_start hands_<n>`)
1. **Right trigger at ~15 %** for 2 s, then fully pressed; then left trigger lightly (where air roll is on LT): throttle
   0.0556 at 15 % means trigger deadzone 0.1, 0 means 0.2; air roll's digital threshold is raw 30/255 (C-5).
2. **Right stick up** for 2 s (ball cam off): user says whether the camera looks up or down (C-1 / CAM-4 sign).
3. (optional, needs ⚙ 5) car still, ball off to the side: **toggle ball cam** 3 times, 2 s apart (CAM-2: EaseIn²).
4. (fallback only: the live session scripts GA-5 in freeplay first) free driving 1 min: **wavedash, then immediately jump and pull back**
   (pitch up), several times (GA-5: pitch ignored for 36 ticks after a dodge that ended by landing).

## 4. Offline exhibition vs bots (user ≈ 2 min of menus, then ≈ 15 min)
**User: main menu → Play → Offline → Exhibition → 2v2 (or 3v3), Stadium, bots any difficulty → Start.**
Session records the whole match (offline matches are allowed now).
1. **Demo spawn selection** (DS-1…DS-8, GA-18): session ⚙ `physlog_demolish` on the player's car (in Active play),
   then the user, during the 3 s respawn:
   - a) does nothing → one of the 4 secondary starts (random start, first free);
   - b) presses **left once** (A / left stick left) within the first 2.5 s → the inner left spot (|x| 2304, the
     player's own left) — **three times**: always the same spot (if the prespawn re-fired every frame with a random
     pick, DS-4's open question, it would vary);
   - c) presses **left twice** → the outer left spot (|x| 2688); d) **right once** → the inner right spot;
   - e) presses left only after ~2.6 s → ignored: a random spot as in a) (twice).
   The session reads the spot from the first row after the respawn (no rows while demolished).
2. **Uneven teams** (MR-5): session `physlog_removebot <team>` removes one opposing bot; the user plays on until a goal (either side); the
   kickoff after it shows the short team's spots (its last player takes the most central spot of the full team's
   window). If the game refills the bot, note it and skip.
3. While it runs anyway (no extra action): kickoff countdown 480 ticks, goal → reset timing (360 ticks, ball removed
   at the goal), respawn delay and height, kickoff spot order across kickoffs (MR-4: +1 per kickoff).
- User: leave the match from the menu when done (no `start <map>`).

## 5. Wrap-up (1 min)
- Session: copy recordings to `out/live/` (git-ignored), validate.
- User: back to the main menu or close the game.

## Not needed from the user
- Two-car tests (bots in freeplay): GA-15 done; GA-16 has no valid pin geometry (float proof + unit test).
- Arena, ball and single-car scripted scenarios: the live session runs them alone in freeplay.
- Netcode: can't be tested in the offline game (static audit only).
