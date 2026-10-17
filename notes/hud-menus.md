# HUD and menus: spec (static session, 2026-10-08)

Live build (2026-10-06). From the Scaleform movies in the GFX_*.upk packages, parsed with our own SWF/GFx and AVM2
parsers (nothing downloaded was run), plus the scripts and archetypes. Tags: [G] GFx/SWF data, [S] UnrealScript,
[A] archetype/defaults, [I] inferred.

Sub-agent files, local in out/bsim/agents/HUD1/:
- notes.txt;
- parsers: extract_swf.py, swf.py, dump.py, avm2.py, decomp.py;
- outputs: dump/<movie>.{tree,chars,anim}.txt, dec_as3/*.txt (decompiled AS3), img/*.png;
- settings_table.md (all 188 settings rows with labels, defaults and ranges).

**Coordinates:** virtual stage px.
- Every movie is 1120×720 at 30 fps.
- The HUD re-anchors to the content stage W×H (ΔW = W − 1120, ΔH = H − 720).
- At 1080p (16:9) the content stage is 1280×720 and ContentScale is 1.5.

## In-match HUD
| # | Element | Game | Ours | Implement |
|---|---|---|---|---|
| HUD-1 | Stage, scaling, fonts, team colours | **Scaling** (NO_SCALE, top-left) [G projectx.core.UIScreen]: S = stageH/720 if stageW/stageH ≥ 1.5556, else stageW/1120; **ContentScale = max(0.5, S·UIScale·SafeZone)**; content stage = stage/ContentScale·SafeZone, inset by stage·(1 − SafeZone)/2. UIScale 0.5–1 (default 1); SafeZone ("Display Scale") 0.9–1 (default native).<br>**Fonts** [G]: $HeaderFont Bourgeois Medium; $HeaderThinFont Bourgeois Thin; $NumbersWideFont Dashboard Numbers Wide (only ` ()+-./0-9:`); $SmallFont Arial Narrow; $SmallBoldFont Arial Narrow Bold; $NormalFont Arial.<br>**Team colours** [A Team0/1 FontColor, verified]: blue (0, 0.18, 0.75) = #002DBF; orange (0.7, 0.24, 0) = #B23D00 (colour-blind #001972 / #FF6600).<br>**Text on team colour** [G TeamStyleManager]: brightness = (3R + 4G + B) >> 3; text = (c + 80)·3 clamped (≤ 120) or (c − 80)·0.3, giving blue #F0FFFF, orange #FFFFF0. Tints are **additive** (1, 1, 1, 1, r, g, b) | fixed CSS px, system-ui (`client/src/style.css:20`) | A 1120×720 (or W×720) container scaled by ContentScale, with the anchors below. Substitute fonts: condensed caps for Bourgeois, a wide digital font for the numbers. Don't redistribute the game fonts |
| HUD-2 | Scoreboard | [G HudMatchInfo matchInfoView] at x = W/2, y = 0. Relative to its top centre:<br>• **Clock box:** black notched MatchTimer_Background at x −90…90, y −18…72 (that is the bitmap; the **visible box is 135 × 56 at x −67.5…67.5, y −1…55**: see HUD-2a).<br>• **Clock text:** $NumbersWideFont 31, white, letterSpacing 2, in x −65…65, y 10…46 (centred, with a trailing-'1' NBSP pad: HT-12).<br>• **Score digits:** $NumbersWideFont 48 in the team text colour, glow #999999 blur 8, plus a duplicate at α 0.4. Left box x −136…−66, y 2…54; right mirrored at 68…138.<br>• **Score backgrounds:** dark rounded 90×90 TeamScoreView_Background (x −157…−67, y −17…73), additive team tint.<br>• **Caption:** match type (ranked/series), white pill, $HeaderFont 18 black, y 34.<br>• **3D:** rotationX 5, score views rotationY ±10, perspective focal 100 centred at (W/2, 80).<br>**Your own team is always on the left** (Team 1 swaps the views) | `index.html:14-18`, `style.css:54-90`: blue always left, solid pills, system font | Dark boxes with additive team tint and near-white digits; local team on the left; black clock box |
| HUD-3 | Clock and overtime | TimeRemaining = SecondsRemaining (int(t) + 1, notes/visual-timing.md VT-23) [S]. Format M:SS with unpadded minutes; "0:00" when ≥ 5000 (unlimited); "+" in overtime [G]. Overtime not yet active: the clock slot shows **"OVERTIME"** ($HeaderFont 32, two lines, leading −6, shrinks to fit); on Active it fades out (0.2 s) and "+M:SS" fades in (0.3 s) [G] | `matchClock.ts:7-11` ceil/floor; `:16` shows OVERTIME as a centre message | int(t) + 1; "OVERTIME" in the clock slot |
| HUD-4 | Scoreboard animation and visibility | **Intro** (1 s delay): y −20 → 0 over 1 s Back.easeOut; alpha 0 → 1 and rotationX 75 → 5 over 0.6 s Strong.easeOut; score views rotationY ±60 → ±10 over 0.6 s Strong.easeIn.<br>**Goal:** the scorer's additive TeamScoreView_Glow jumps to α 1, then fades over 0.6 s Power1.easeIn.<br>**Hidden** in WaitingForPlayers, PostGame, PrePodium/Podium, Finished, training and tutorial, and by HideHUD. **Visible during the replay** [G] | text only | The glow flash on a score change; the intro |
| HUD-5 | Boost meter: geometry | [G boostMeterView] bottom-right anchored, **centre at (W − 110, H − 110)**.<br>• Background disc 200×200 (thin grey ring with ticks); glow 180×180 at α 0.5.<br>• **Fill:** orange segments **clockwise from 6 o'clock to 12 o'clock** (0–80 %), then a separately tinted white segment **12 to 1:30** (80–100 %). **Total sweep 225°**; a 101-frame mask reveals 2.25° per frame.<br>• **Number:** $NumbersWideFont 54 in a 120×58 box at (−58, −28), black glow 6, #333333 duplicate behind; "BOOST" ($HeaderFont 16) at y + 16.<br>• **3D:** rotationY 15, rotationX −2, fills and number at z −20, FOV 120 | `ui/fuelGauge.ts` (3c8622b): **the user's own fuel-gauge design** in place of the game's meter (a needle −90° … +90° over 0–100); a deliberate deviation | — (own design) |
| HUD-6 | Boost meter: value and animation | Value = floor(pct·100) clamped 1–100 when > 0 (VT-21), sent only on change [S]. The shown integer tweens over 0.2 s (Quad.easeOut [I]). **Arc** = gotoAndStop(int(b·1.01)), i.e. **2.25°·(b − 1)** for b 1–99 (empty at 0 and 1), 225° at 100. **On an increase:** both fills flash white back to normal over 0.8 s Strong.easeOut; the glow scales 2 → 1 over 0.8 s [G] | `ui/fuelGauge.ts`: floor with minimum 1 (as the game); needle −90 / −63 / 0 / +90° at 0 / 15 / 50 / 100 (RX23 live) | — (own design; the 0.2 s number tween and the pickup flash not used) |
| HUD-7 | Boost meter: colour states | The "max" state is **> 80**, not 100 [G].<br>**Team-coloured meter** (setting, default on): number, glow, label and tinted segment get the additive team tint. ≤ 80: number #666666 + tint, glow α 0.5. > 80: number white, glow α 1, black text glow 8, "BOOST" blinks (α 0 ↔ 1 every 0.2 s: `TweenMax.to(label, 0.2, {autoAlpha: 1, yoyo: true, repeat: -1})`, default ease Power1.easeOut (GSAP 12.1.4): up α = 1 − (1 − s)², down (yoyo = same tween backwards) α = 1 − s²; leaving > 80 %: 0.2 s autoAlpha → 0). The label's colour never changes with the max state: it stays #666666 + the additive team tint (≈ (102, 147, 255) blue, (255, 163, 102) orange; non-team mode BOOST_MAX ≈ (255, 125, 114)); no parent alpha, blend or glow caps it; α runs the full 0 → 1 (item 29).<br>**Non-team meter:** number orange (BOOST_NORMAL (1, .38, .51 + 255, 127, 0)), > 80 BOOST_MAX (0, .6, .49 + 255, 64, 64); glow amber (255, 147, 67)·0.25, or red (255, 64, 64)·0.75 > 80; disc × (1, .43, 0) | `ui/fuelGauge.ts`: a low state at ≤ 15 and a max state at 100 (the game: > 80); hidden while demolished in both modes (HUD-16, RV-513) | — (own design) |
| HUD-8 | Kickoff countdown | Timing (VT-24): "3", "2", "1" at 1/2/3 s and "GO!" at 4 s, each with its sound [S/A]. Display [G GameMessageView at (W/2, 250)]: $HeaderThinFont **72**, #FFED83, orange glow #FF7F00 blur 10, uppercase, shrinks to fit. Each message pops from scale 1.4 → 1 with a white additive flash fading over **0.6 s Strong.easeOut**; it fades out (0.3 s) **4 s** after the last message, or at once on an empty message | beeps only (`online.ts:282-285`) | Digits and GO! with the pop (GO! stays about 4 s) |
| HUD-9 | Goal banner, stat popups | **Goal:** "{Player} scored!" (or the team name) in the HUD-8 style [A GoalScoredMessage].<br>**Stat popup** [G StatEventView at (W/2, 150); 80 frames = 2.667 s; one at a time]:<br>• icon fades in by 0.13 s, then grows 2 → 5.6× with a 4 px blur to α 0.5 (0.4–0.8 s);<br>• name ($HeaderFont 32, white, orange glow) rises in (0.4–0.6 s);<br>• "+N" ($HeaderFont 22, #FFED83) pops from 3× with a white flash in 0.23 s;<br>• all float up and fade 2.17–2.63 s.<br>Shown per StatEventDisplayLevel (default Primary) | "BLUE SCORES!" for 2 s (`online.ts:49,443`, `freeplay.ts:157`) | "PLAYER SCORED!" for 4 s; optional "GOAL +100" popup |
| HUD-10 | Other messages | HUD-8 style [S/A]: "Overtime!"; "One Minute Remaining!" (61 → 60); "30 Seconds Remaining!"; **"10" … "1"** each second while 0 < SecondsRemaining ≤ 10 (EndCounter sound); the pause message (by key `[Messages] GamePaused` / `GameUnPaused`; not cleared verbatim). A message shows if HUDMessageThreshold ≤ its level; the "Match Notifications" setting is All (default) / Game updates / Kickoff only | none | Add them, with the filter |
| HUD-11 | Replay banner | [G ScoreReplayView, ReplayPlayback]:<br>• **Letterbox:** black slanted bars α 0.6 at the top (y 0–90) and bottom (y 630–720), about 79 px tall at the edges and 30 in the middle.<br>• **REPLAY:** bottom-left at (26, H − 30): a 32 px red dot pulsing (α 1 → 0 by 0.33 s, back by 0.5 s); "REPLAY" $HeaderFont 32, #FF7752, glow #FF4343 8.<br>• **Info** at (W/2, H − 169): "SCORED BY" ($HeaderFont 14, #98DAFF, glow #016BF7), the scorer's banner and team glow (1 s), then assist, goal time M:SS and speed (round(ReplaySpeed·0.036) KPH, or MPH) in $HeaderFont 18, staggered 0.25 s with 0.3 s fade-and-slide.<br>• **Prompts** bottom-right: "PRESS {key} TO SKIP" ($HeaderFont 16) and the not-ready players ($HeaderThinFont 24, #FF4343) | centre "REPLAY" + hint (`online.ts:625`). **Bug:** `index.html:20` and `:49` both use `id="hint"` (verified); `style.css:242` overrides `:104`, so the replay hint renders top-right | Letterbox bars, blinking label, scorer/speed panel; fix the duplicate id |
| HUD-12 | Ball-cam indicator | [G BallCamIndicatorView at (50, 672 + ΔH)]: the same red dot; "BALL CAM" $HeaderFont 32, #FF7752, red glow; "PRESS {key} TO TOGGLE" ($HeaderFont 16, empty in hold mode) at y + 12. Shows by sliding +20 px with α 0 → 1 over 0.2 s; hides over 0.3 s. Shown when ball cam is on, the indicator setting is on (default) and HUD-16 holds | debug bar text (`hud.ts:154`) | Bottom-left indicator |
| HUD-13 | Nameplates | **Placement** [A]: a plane 60 uu above the car, Scale3D (1, 2, 1), DistanceScaleCurve 0 → 0.5 and 10000 → 9, FOVScaleCurve 0 → 0.1 and 90 → 1, × NameplateScale (0.5–2); never shown to the car's owner.<br>**Content** [G]: a 9-slice background with additive team tint, width = text + 32 clamped 100–264; the name in $SmallBoldFont 16 uppercase, team text colour; **"YOU"** for the local player.<br>**Modes** [S]: Default (always the full plate); Distance Fade (beyond **7000 uu** only an arrow); Simplified (arrow only); changes animate 0.3 s | none | Billboards with these rules |
| HUD-14 | Stat/kill feed | [G StatTickerView, top-right (W − 10, 10)]: rows 36 px apart, ≤ 6, each lives **4 s**, fade and slide 0.2 s. Row: receiver name pill, orange event icon, victim name | none | Optional (demolitions, goals) |
| HUD-15 | Chat | [G]: log at (10, 10), $SmallFont 18 white, 350×185, input ≤ 120 characters; fades in 0.3 s, hides **6 s** after the last message | none | Later |
| HUD-16 | Visibility rule | [G HudScreen.validateShownUIElements]: the boost meter and ball-cam indicator need: the local car's camera view (own car or ball cam; not replay or spectating); state ≠ Finished; the HUD on top (no menu); not replacing a bot; and, for the boost meter, not WaitingForPlayers (RH1, 2026-10-16) The Demolished, DemoSpawnSelect and Prespawn camera states leave bShowCarHUD False, so the boost meter and the ball-cam indicator hide while demolished (TA:45533) [S][A]. | always visible | Hide the boost meter in replays, menus and after the match |
| HUD-20 | Respawn view (ChooseRespawnView) (RH1, 2026-10-16) | **No seconds countdown for demolitions** (no "Respawning" string in Coalesced_INT). ChooseRespawnView is visible iff the local PRI.DemoSelectionData.SelectionState == 2 (m#9223) [G]. Only PlayerSpawnSystem_TA.CreateSpawnTicket sets it, in **Active only** (GameEvent_Soccar_TA.CanSelectDemoSpawn, TA:103563/103572), for a prespawn-qualified ticket (bPrespawnFeatureEnabled, bAllowPrespawn, RespawnDelaySeconds 3 ≥ MinRespawnDelayThreshold 3.0) of a human on a team [S][A]. Cleared at prespawn (2.5 s: state 1 then 0, TA:5766), at the respawn, on a team change, and **the moment the game leaves Active** (PostGoalScored, ReplayPlayback, Countdown, PrePodium/Podium/Finished lack PlayerSpawnState_TA, so the ticket is removed and ClearDemoSelectionData runs, TA:1271/78826/102942/103774) — hidden, never frozen. Not hidden by the scoreboard or the pause menu; hidden with the whole HUD (bHideHUD). **Display:** two progress bars (252 × 3 px each on the 1120 × 720 stage) shrinking toward a centre hourglass, at (0.5, 0.88) of the stage; pct = clamp(int(remaining/2.5·100), 0, 100) on server game time (TickSpawn TA:78840), replicated as an integer; fills white and the hourglass (151, 217, 254) tween to orange (255, 127, 0) over 0.35 s once pct ≤ 60 (≈ 0.975 s after the demolition); prompts "{0?KeyBinding} RESPAWN LEFT" / "RESPAWN RIGHT" upper-cased ($HeaderFont 22 white; PC "[A] -" style, pad icon), two spot circles per side, the chosen side glowing with wave-animated arrows; sounds ChooseRespawn_Toggle and _TimeUp. The only numeric respawn countdown (ReplicatedRespawnTicket_TA → SetRespawnTimeRemaining) is for replacing a bot or the split-screen join delay, never demolitions [S][G][A] | 247af31: the game's view (two shrinking bars, hourglass, RESPAWN LEFT/RIGHT, spot circles), shown only in active/timeUp; with pad bindings the prompts spell the stick in words and overlap (RV-512) | Show only in phases active/timeUp, for a car demolished there, while its timer > 0.5 s and on a team; hide (never freeze) at the lock, the respawn, any phase change out of active/timeUp, a team change; no seconds text: the two shrinking bars + prompts (or a neutral bar if side choice isn't built) |
| HUD-21 | Stat graphs (SG1, 2026-10-16) | A native Canvas overlay (not Scaleform): rows, windows 0/5/10 s at 60 samples/s, fixed ranges and thresholds [S][A]; drawing, layout and gates [N]. Details: section "HUD-21 Stat graphs" at the end of this file | 247af31: built per this section (top-right, scale rule, columns, colours, grid, polyline, F10); deviations: MaxBytesRate 150 KB/s (our downstream), TargetFPS from the measured frame rate (RV-514), no ultrawide X stretch, FPS Min over 1 s (RV-515) | The game's rows and model; our own layout until the native draw is decoded |

## Menus and settings
| # | Element | Game | Ours | Implement |
|---|---|---|---|---|
| MENU-1 | Main menu | [G RootMenu]: (Esports event), **Play**, Item Shop, Rocket Pass, (Play Now), **Garage**, Club, **Profile**, **Settings**, **Quit** (confirm) | – | Play / Garage / Settings / Quit |
| MENU-2 | Play | [G PlayMenuV4]:<br>• **Casual:** 1v1, 2v2, 3v3, 4v4, Arcade, Big Party.<br>• **Competitive:** 1v1, 2v2, 3v3, extra modes.<br>• **Tournaments.**<br>• **Offline:** Season, Exhibition, Workshop.<br>• **Training:** Free Play, Custom Training, Tutorial, packs.<br>• **Private Match**, LAN | – | Free Play, Online |
| MENU-3 | Garage, Profile | Customize Car, Presets, Inventory, Trade In, Blueprints, Rewards; Career, Match History, Banner, … | – | – |
| MENU-4 | Pause menu | [G MidGameMenu]: Resume, Settings, Show Controls, Change Team, Leave/Forfeit (vote), Pause (private), Restart, Report/Block, Exit to Main Menu, with confirms | Esc opens settings | Resume / Settings / Leave |
| MENU-5 | Settings tabs | (Training), Gameplay, Camera, Controls (+ Bindings), Interface, Stream Safe, Scoreboard, Video, Audio, Chat, Extras. Order within a tab = creation order in GFxData_Settings_TA.Init*. All 188 rows: out/bsim/agents/HUD1/settings_table.md<br>**Scoreboard tab:** see notes/scoreboard.md SB-17 (one group per mode × 4 column dropdowns, sorted by label, reset to defaults). | 4 tabs (`settingsPanel.ts:95-99`) | Add **Gameplay** and **Interface** |
| MENU-6 | Interface | Interface Scale 0.5–1 (1); Display Scale 0.9–1 (native); Nameplate Scale 0.5–2 (1); Nameplate Mode Distance Fade / **Default** / Simplified; Match Notifications **All** / Game updates / Kickoff; Connection Quality on; Color Blind off; **Team-Colored Boost Meter on**; Metric (native); **Ball Cam Indicator on**; **Ball Arrow on**; Center Dot None/Chevron/Dot (scale .3, opacity .6); Hide HUD off | – | Ties to HUD-1/7/10/12/13 |
| MENU-7 | Camera | FOV 60–110 (90); Distance 100–400 step 10 (270; Modern 290); Height 40–200 (100); Angle −15–0 (−3); Stiffness 0–1 step .05 (.5); Swivel 1–10 (2.5); Transition 1–2 (1); Shake (True; Modern off); Ball Camera Toggle/Hold; Demo Transition 0–.5 (.5); invert swivel per device (False); free look per device speed 1–10 (2.5), accel 1–15 (5.8), decel 1–15 (10.8); presets Default/Balanced/Wide/Legacy/**Modern**/Custom | `settings.ts:69-77` matches the limits | Add presets and Shake (consistent with CAM-3/4) |
| MENU-8 | Controls | Steering and aerial sensitivity 1–10 step .01 (1); controller deadzone 0–.75 (.2); free-look deadzone 0–.75 (.1); dodge deadzone .1–1 (.8); mouse sensitivity 1–100 (10); keyboard input acceleration 0–.25 (0); keyboard aerial safety on; vibration Disabled/**Default**/All, intensity 0–3 (1); control presets (Modern) | `settings.ts:80-87` matches | Keyboard input acceleration (C-7) |
| MENU-9 | Gameplay | Send rates/bandwidth High; Input buffer Default; Unlimited boost in free play on; Game Stat Display Level None/**Primary**/All; Flip Reset Indicator Off/Audio/Visual/**On**; Skip Goal Replay off; Force Default Team Colors off; Rank/MMR display; Cross-platform on | flip indicator, auto-skip (`settings.ts:138`) | Stat display level; flip-reset modes |
| MENU-10 | Audio | Master 1.0; Gameplay, Music-Playlists, Music-Gameplay, Ambient, Crowd 0.75; Voice 0.5; Controller 1.0; Output Speakers/Headphones; Dynamic Range Low/**Default**/High; anthems in matches; mute when unfocused on; standard boost sound off | master .8 / effects 1 / cars .7 / ambience .6 (`settings.ts:125`) | Optional: match categories and defaults |
| MENU-11 | Video, Chat, Stream Safe, Training | Render quality 100/85/70/55 %, detail presets, toggles; chat filters; stream-safe anonymising; Training game speed .5–1, boost recharge delay .5–3 (1.5), goal reset modes | – | – |
| MENU-12 | Pad input path (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | The menus are Scaleform CLIK: the D-pad and the left stick's virtual directions map to the arrow keys ([Scaleform.KeyMap], Engine/Config/BaseInput.ini:149-174) [C]; a movie counts a second key-down while still down as "held" (SHL InputDelegate m#8465) [G], so repeat timing is the engine's: **D-pad** (all pad buttons): InitialButtonRepeatDelay **0.2 s**, ButtonRepeatDelay **0.1 s** (client defaults set at 0x1406390d0, +0x70/+0x74; no ini overrides them), polled once per frame by the viewport's pad poll 0x140dc4ac0 (repeat loop 0x140dc5fb9–0x140dc60be: repeats land on the first frame at or after each deadline); the menus' key entry 0x140ce8570 → 0x140ce7f30 turns repeats into key-downs (_global.bIsKeyHold) [N]. **Left stick:** the menus' axis handler 0x140ce7630 (entry 0x140ce7c90; setup 0x140ce3870 copies Default__UIInteraction's emulation, AxisRepeatDelay 0.2, UIJoystickDeadZone 0.8): pressed when the raw axis (scaled to ±1, no deadzone) is **≥ 0.8**, released below 0.8, **no hysteresis**; first repeat 0.2 × 1.5 = **0.3 s**, then every 0.2 × 0.5 = **0.1 s**, checked every frame; one direction slot per player: **the first axis to reach 0.8 owns it** until it drops below 0.8 (AdjacentAxisInputKey is never effective), so 4-way by first come, not by the larger axis; a flick to the opposite side releases then presses on the next report [N] (MN1 Ghidra follow-up). Right-stick emulation off (bEmulateButtonPress False): the right stick does nothing in menus; only the chat log (within ±20° of vertical, \|v\| > 0.75, one line per 100 ms) and legal/ban popups (y¹²·line·0.015 per frame, dead below 0.3) scroll analog [A][G]. No acceleration on focus moves. The driving deadzones don't apply | 3fd3f13: implemented (D-pad 0.2/0.1 s, stick ≥ 0.8 raw with first-come ownership, 0.3/0.1 s, right stick ignored); repeats land a frame late every other time at 60 Hz (RV-493) | D-pad 0.2/0.1 (pending the native check); stick 0.8 on the dominant axis, 0.2 s repeat; right stick ignored |
| MENU-13 | Buttons (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | **A acts on release** (pressed art while held; CLIK Button m#7874/7894/7895), no repeat. **B on release** (UIMenu m#8296/8297): closes the top menu or modal (CANCEL), or a settings sub-page to its parent; at the main-menu root nothing, silent; no held-B behaviour. **Start** closes the pause menu (MGM m#9077). **LB/RB** = previous/next settings tab, on press and on hold repeat, **no wrap** (silent at the ends), the other bumper ignored while one is held; SWITCHTABS only when the tab changes; LT/RT/X/Y never switch tabs (SET m#9268/9294/9459/9463). Play menu: LB/RB on release, no wrap with the pad (PM4 m#10450). X in Settings = Default (a confirm), Y = Clear Keybinding (bindings page) [G] Settings' X (Default) and Y (Clear Keybinding) also act on **release** (SET m#9268; MS1, 2026-10-16). While a search runs, pad Y outside modal screens cancels it (MM-10). | 3fd3f13: A/B on release, LB/RB without wrap, X Default, Y Clear; deviations: Start still backs out (RV-475), no pressed look and B closes the whole pause menu (RV-478) | As the game |
| MENU-14 | Controls (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | **Slider:** the setting's own step × k per left/right event (press or repeat): k = 1 for events 1–7, 2 for 8–13, 3 for 14–19, 6 for 20–25, 11 from 26; the count resets on release; clamped, snapped to round(v/step)·step; BASIC_HOVER each change; A does nothing (SET m#7647/7980/7981/7991/7993). **Dropdown:** left/right do nothing; A (on release) opens ≤ 10 rows at 21 px pitch, up/down stop at the ends and repeat, A picks, B closes unchanged; in 0.2 s (+10 px slide), out 0.3 s (m#8943/9855/9595/9596). **Checkbox:** A toggles on release (SELECT); tick pops 1.2× white → 1× in 0.2 s; untick 0.8× and fades in 0.2 s (m#9456). **Cycler** (MenuOptionStepper m#11421/11426/11427, not in Settings): step 1, wraps, SELECT; the arrow nudges 6 px out fading (0.167 s) and back from 6 px in (0.133 s); arrows α 0.25 at an end without wrap; < 2 options disabled [G] | 3fd3f13: slider ×1/2/3/6/11 by event count; in-place cycler steps 1 with wrap but plays the move cue, checkbox toggles on left/right (RV-481) | Slider acceleration; one select model (the list, or cycler rules) |
| MENU-15 | Focus rules (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | **No wrap** anywhere (FocusHandler SHL m#597 loops only when a container asks; none does); stuck = silent. Left/right never leave a settings row (m#8218). **Per-menu focus memory** (UIMenu m#8279/8281/8283/8298): returning restores the last control. New menu: the first control; pause: RESUME GAME (MGM m#9073); **confirm modals: the last button (NO)** unless a default is set (ModalPopup m#10686/10700; Leave/Forfeit/Exit/Restart set none). Rebuilt menus keep focus on the same action (DynamicMenu m#10670/10673). Tabs not focusable; a tab switch focuses the page's first row; Settings always open on the first tab (m#9266). Focused row scrolled into view with 20 px to spare (region 680 × 385), pad mode only (m#8227) [G] | 3fd3f13: no wrap in lists, per-menu memory, re-renders keep focus; deviations: online Leave/Forfeit confirm on YES (RV-472), settings Default confirm reopens on YES (RV-473), revisits restore the old row (RV-476), choose-groups wrap (RV-477) | As the game |
| MENU-16 | Hint bar and device mode (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | **Contents:** main-menu root none; deeper pages B BACK (stack depth > 1, m#8004); Settings B BACK + X DEFAULT (+ Y CLEAR KEYBINDING on bindings); pause and modals none; **no "A Select"**. Order B, Select, X, Y, L3, LT, RT, R3, LB, RB, A, Start. Bottom-left, 20 px up (Settings: (0, 479) in the 700-wide panel, the focused setting's description to its right, 14 px white). Entry "glyph LABEL" 12 px white, black glow (blur 5, strength 2), glyph 1.6× the line height (baseline −2), entries abut from x 12, each text + 14 wide; background black α 0.25, 36 px tall, ≥ 250 wide (+8), pad mode only. Mouse mode: clickable text, no glyph; entries without an action vanish. LB/RB glyphs at the tab strip's ends (scale 0.875), pad mode, 0.2 s fade (ButtonLegend SET m#7995–8024, LegendElement m#7697–7706) [G]. **Device** [N, MN1 Ghidra]: any key, mouse button or pad button event requests its device's type (0x140ce8570 → 0x140e42050); an axis event requests a switch only when \|value\| > 0.5 (0x140e41eb0: sticks, triggers, and mouse motion deltas, so any mouse move switches to keyboard/mouse [I on the units]). A different type switches **at once** (0x140e53ce0, SHELL_onInputTypeChanged) and starts the 0.2 s InputTypeChangeCooldown [A]; a change requested during it is queued and applied at its end (tick 0x140e5e4a0) without restarting it, and dropped if the player returned to the current device: at most one switch per 0.2 s, the last device used wins; stick movement switches to pad except while free look owns the axes [S TA:106787-106793]; pad mode turns the mouse off and always shows focus; mouse mode: focus follows hover [G] | 3fd3f13: hint bar per screen (B; Settings B + X, + Y on Controls), device switching per the rule; deviations: no X on Gameplay/Chat/Video (RV-474), the bar hidden in mouse mode (RV-480), hover live in pad mode (RV-481) | As the game (own glyph art) |
| MENU-17 | Focus highlight (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | sRGB from the local menu-state bitmaps [A], rules [G]. **Main-menu buttons** (240 wide, 35 px pitch, parallelogram ~10°): normal black α 0.9; focused ice fill (199, 239, 255) top → (219, 246, 255) middle → (243, 251, 255) bottom, glow (24, 149, 202) ~4 px α ~0.5, text **#005F8E**; pressed plate ~4 % smaller, 1 px inset. **Pause/modal buttons** (260 wide at 33 px / 160; ~8°): normal (26, 73, 106) → (41, 111, 161), 1 px top edge (98, 142, 167); focused ice fill, #005F8E, glow #41AFFF α ~0.35; pressed flat (26, 72, 106), light bottom edge (180, 194, 205). **Tabs:** normal (26, 73, 106) → (35, 93, 136), bottom line (54, 122, 177); selected ice (196, 240, 255) edges → (249, 253, 255) centre, glow (24, 149, 202) ~3 px, #005F8E, a white chevron (~36 × 16) fading in 0.2 s; hover (194, 239, 255) → (230, 250, 255). **Settings controls:** checkbox/dropdown normal (8, 12, 16), focused (32, 72, 106) (dropdown ~(21, 46, 65)) with a light 1 px top edge and ~8 px blue glow; slider track 10 px, normal (0, 8, 16) + top edge (87, 134, 164), focused (24, 60, 90) + white edges; thumb (82, 129, 156) → white + #41AFFF glow; fill (156, 214, 255) → white, 4 px; dropdown rows #43AFFF, highlighted #41AFFF α 0.25, chosen white; row labels α 0.8 (0.3 disabled). **States cross-fade** in 0.2 s, out 0.3 s, no pulse; text colour instant (StateTweenButton m#8893) | 3fd3f13: colours as here, rows fade in 0.2 s; fade-out instant and the gradient doesn't animate (RV-479) | Fill and text swap with the cross-fade, own art |
| MENU-18 | Menu sounds and transitions (MN1, 2026-10-16; SET/SHL/MM/MGM/PM4 = HUD1 dec_as3 movies, m# = AS3 method) | Focus move ROLLOVER (UI_Basic_Hover); slider step BASIC_HOVER (same cue); button SELECT (UI_Basic_Select); modal button CONFIRM (UI_Basic_Confirm); back CANCEL (UI_Basic_Cancel); tab SWITCHTABS (UI_Basic_NextTab); pause PAUSE_MENU_OPEN/CLOSE [A][G]. Pages fade in 0.2 s, out 0.3 s; main-menu pages also slide 20 px [G] | 3fd3f13: synthesized move/select/tab/back cues; no CONFIRM, no pause open/close cue, nothing from the mouse; pages fade in only (RV-481) | Our own synthesized sounds for these events |
| MENU-19 | Video tab (PC) (GQ1, 2026-10-16; TA = live script dump, SET = HUD1 dec_as3 settings movie, INT = Coalesced_INT) | Three groups, headers upper-cased: **Window Settings** (Resolution "W x H a:b" largest first; Display Mode Fullscreen/Windowed/Borderless; Vertical Sync, off) applied only on **Apply**; **Basic Settings**: Anti-aliasing Off (default) / FXAA Low / FXAA Medium / FXAA High / MLAA / SMAA (after the tone map); **Render Quality** High Quality (100 %) / Quality (85) / Performance (70) / High Performance (55), shown as words, ScreenPercentage with upscale; **Render Detail** High Quality / Quality / Performance / Custom (MENU-20); **Frames Per Second**: the display's refresh rates plus 30, 50, 60, 90, 120, 144, 240, 360 as "N FPS", the highest display rate "N FPS (Recommended)", "Uncapped", a custom value; **Advanced Settings**: Texture Detail (High Quality / Quality / Performance / High Performance), World Detail (High Quality / Quality / Performance), Particle Detail (High Quality / Performance), Effect Intensity (Default / Low Intensity), and checkboxes High Quality Shaders, Ambient Occlusion, Depth of Field, Bloom, Light Shafts, Lens Flares, Dynamic Shadows, Motion Blur, Weather Effects (all on by default). Labels and descriptions: UserSettings.int (INT:27592-27665), options INT:27982-28045; rows TA:54900-54931, 55148-55199; layout SET:60313-60404. X Default resets the Video groups. Not offered on PC: Transparent Goalposts, Max FPS, Uncapped Framerate, MSAA (dev); console-only "Video" group (Video Quality Performance/Quality, default Performance = 70 %; HDR settings) [S][G][C] | none | Offer Render Quality and Render Detail (+ Custom) with the advanced rows that change what we build (notes/post-processing.md §13); omit or mark the no-op rows |
| MENU-20 | Render Detail presets (GQ1, 2026-10-16; TA = live script dump, SET = HUD1 dec_as3 settings movie, INT = Coalesced_INT) | SetRenderDetailValue (TA:55234-55282): High Quality = textures Higher, DetailMode 2, ParticleLODBias 0, HQ shaders on, AO/DOF/Bloom/Light Shafts/Lens Flares/Motion Blur on, Dynamic Shadows on, Weather on; **Quality** = textures High, DetailMode 1, LOD bias 0, HQ shaders on, AO/DOF/Bloom/Shafts/Flares/MB **off**, Dynamic Shadows on, Weather on; **Performance** = textures Medium, DetailMode 0 (StaticDecals off, cull ×0.5), LOD bias 1, HQ shaders **off**, everything off. Presets don't touch AA, Render Quality, the FPS cap, V-Sync or Effect Intensity. Any advanced change, AA or Render Quality switches to **Custom** (not Lens Flares, Weather or Effect Intensity). What each switch changes in our effects: notes/post-processing.md §13 QG-1..27 [S][C] | none | As the game, mapped through QG-1..27 |
| MENU-21 | First-run defaults (GQ1, 2026-10-16; TA = live script dump, SET = HUD1 dec_as3 settings movie, INT = Coalesced_INT) | PC: fixed (no hardware adaptation in script, ini or data): High Quality, Render Quality 100, AA Off, all toggles on, FPS cap = the display's highest refresh rate; [SystemSettingsBucket1..5] equal; UE3 compat-detection strings exist in the exe but whether they run is [N]. Consoles: Video Quality Performance (70 %) [S][C] | none | The game doesn't adapt on PC: an auto default for weak GPUs is ours to design (GQ1 suggested: integrated GPU → Render Quality Performance 70 % + Render Detail Quality; then a one-time frame-time guard stepping to 55 % and Performance; never mid-match) |

## HUD and menu text (HT-1..HT-10; static session, HT1, 2026-10-14)

Live build 2026-10-06 only. Extends HUD-1..16 and MENU-1..11 above (geometry and timing are not repeated) and
notes/scoreboard.md (SB-n), notes/match-intro-outro.md §5 and notes/match-rules-audit.md (cleared vote/leave text).

**Text rule (user decisions).** Quoted verbatim below: the in-match HUD messages (kickoff 3/2/1/GO!, OVERTIME in the
clock slot and Overtime!, One Minute Remaining!, 30 Seconds Remaining!, 10…1), BOOST, BALL CAM / PRESS {key} TO
TOGGLE, YOU, main menu Play / Garage / Settings / Quit and Free Play (`[Global] FreePlay`, user 2026-10-14, RV-285), pause menu Resume / Settings / Show Controls / Leave with the
leave/forfeit inquiries, the settings tab names, the Interface and Gameplay labels and options, the replay HUD and
banner, and stat/scoreboard text; plus strings cleared earlier (Yes/No, Exit to Main Menu and its inquiry: MIO §5;
vote/forfeit/leave and replay-skip text: match-rules-audit.md). Everything else is **by key only**; its English is in
the local file `out/bsim/agents/HT1/local_strings.txt`.

**Tags.** [A] package data (localization, archetypes, class defaults, ini); [S] UnrealScript; [M] movie / AS3 (the
same as [G] in the rows above); [I] inferred; [N] native, not decompiled.

**Citations.**
- `INT:n` = line in `out/bsim/agents/HUD1/Coalesced_INT.txt` (the decrypted Coalesced_INT). Each row names the file,
  section and key.
- AS3, in `out/bsim/agents/HUD1/dec_as3/`: `HUD:` GFX_Hud.HUD.all.txt; `HMI:` GFX_HudMatchInfo.HudMatchInfo.all.txt;
  `NP:` PlayerNameplatesRTX.all.txt; `MM:` GFX_MainMenu.MainMenu.all.txt; `MGM:` GFX_MidGameMenu.MidgameMenu.all.txt;
  `SET:` GFX_SettingsMenu.SettingsMenu.all.txt; `SHL:` GFX_UIShell.UIShell.all.txt. `m#` = AS3 method index.
- Movie symbols: HUD1 `dump/<movie>.{tree,chars}.txt`; `SC-chars:` = `dump/gfx_shared.SharedComponents.chars.txt`.
- `TA:` = `out/bsim/work/tagame_live_all.txt`; `PX:` = `out/bsim/agents/PNT1/projectx_live_all.txt`.
- Archetype and default dumps (`scripts/props.py` on the live decrypted packages), in `out/bsim/agents/HT1/`:
  `soccar_messages.txt` (GameInfo_Soccar_SF message archetypes), `nameplate_arch.txt`, `tagame_defaults1.txt`.
- AS3 `LOCTEXT('K', …)` reads UIText.int `[Global] K`; `NSLOCTEXT('S', 'K', …)` reads UIText.int `[S] K`. Every key
  below exists there unless marked "AS3 default only" [A][M].

### Summary
| # | Item | Finding | Conf. |
|---|---|---|---|
| HT-1 | Case and fonts | The fonts carry real lower case; all capitals on screen come from `toUpperCase()` at each call site. Dropdown values, modal bodies, the replay banner's names and KPH/MPH are not upper-cased | [M][A] |
| HT-2 | Verbatim strings | Table 1: key, localized string, displayed case, font | [A][M][S] |
| HT-3 | {key} token | `{0?KeyBinding}`, replaced by the binding's UI key token, then the whole line is upper-cased. Pad buttons and mouse buttons become inline icons; other keys are words from Keys.int | [M][S][A] |
| HT-4 | Pause-menu confirmations | Modal: title upper-cased, body as written, buttons YES / NO. Leave and 1v1 forfeit confirm; team votes do not | [M] |
| HT-5 | Settings tabs, rows, options | Tabs and labels upper-cased; option values shown as localized; full Interface and Gameplay tables with defaults | [M][S][A] |
| HT-6 | Replay banner | SCORED BY; assist, time and speed carry icons, not text labels; time = the round's age at the goal; speed rounding; Metric picks KPH/MPH | [M][S] |
| HT-7 | Match Notifications | Kickoff countdown, GO! and the goal message are Essential (always shown); overtime, 60 s, 30 s and 10…1 are GameUpdates; pause messages All. Sounds play regardless | [S][A] |
| HT-8 | Nameplates (HUD-13) | Plane 256×64 local, 512×64 uu under Scale3D (1, 2, 1), bottom edge 60 uu above the car; curve points; the combination is native and open | [A][S][N] |
| HT-9 | Stat and scoreboard text | Stat popup name upper-cased, "+N"; ticker names upper-cased, YOU; scoreboard per SB-3 | [M] |
| HT-10 | Corrections to rows above | HUD-3, 5/7, 9, 10, 11, 12, 13, MENU-4, 6, 9 | – |

### HT-1 Case and fonts [M][A]
- **Fonts.** `GFX_Fonts.Fonts_EFIGS` embeds distinct lower-case glyph outlines for Bourgeois Medium/Thin and Arial /
  Arial Narrow (Bold) (367–556 glyphs each; checked with HT1 `py/fonts.py`). No TextFormat or font forces capitals.
  So the case on screen is the string's case after AS3 processing.
- **Upper-casing is per call site:** `String.toUpperCase()` or `StringUtils.toUpperCase` (identical except for
  Turkish dotted i). Table 1 gives each site.
- **Shown as written (not upper-cased):** settings dropdown values (HT-5), modal popup bodies (HT-4), the replay
  banner's scorer and assist names and the not-ready names (HT-6), KPH / MPH (capitals in the .int), online playlist
  names in the pause title.

### HT-2 Verbatim strings (Table 1)
**In-match messages** (GameMessageView, HUD-8 style: $HeaderThinFont 72, #FFED83, glow #FF7F00 blur 10; set as
`message.toUpperCase()`, HUD:54450, m#9286):

| Where | Key | Localized string | Displayed | Evidence |
|---|---|---|---|---|
| Kickoff digits | TAGame.int `[Messages] CountdownSeconds` (INT:21440) | {Seconds} | 3, 2, 1 | [A] Countdown1..5, Key CountdownSeconds, Essential; [S] `BroadcastCountdownMessage` SetInt('Seconds', n) TA:1525-1530 |
| Kickoff GO | `[Messages] CountdownGo` (INT:21443) | Go! | GO! | [A] GoMessage; [S] TA:1520-1523 |
| Overtime starts | `[Messages] Overtime` (INT:21439) | Overtime! | OVERTIME! | [S] `StartOvertime` TA:3211-3215 |
| 60 s left | `[Messages] OneMinRemaining` (INT:21450) | One Minute Remaining! | ONE MINUTE REMAINING! | [S] `Active.UpdateGameTime` TA:4209-4211 (SecondsRemaining drops to 60) |
| 30 s left | `[Messages] ThirtySecondsRemaining` (INT:21451) | 30 Seconds Remaining! | 30 SECONDS REMAINING! | [S] TA:4214 |
| Last 10 s | `[Messages] CountdownSeconds` via SecondsRemainingMessage | {Seconds} | 10, 9 … 1 | [A] Key CountdownSeconds; [S] TA:3230-3234, 3242 |

**Clock, boost, ball cam, nameplate:**

| Where | Key | Localized string | Displayed | Font, colour | Evidence |
|---|---|---|---|---|---|
| Clock slot (OT not yet active) | UIText.int `[Hud] Overtime` (INT:26754) | Overtime | OVERTIME | $HeaderFont 32 white, centred, box 124×50, multiline, leading −6; the AS3 drops the size by 1 until lines ≤ words, so one line in English | HMI:49975-49984 m#8689; HMI tree d33 |
| Boost meter | `[Hud] Boost` (INT:26753) | Boost | BOOST | $HeaderFont 16, #666666 (+ additive team tint) | HUD:53277. Hidden at ≤ 80; blinks (α 0 ↔ 1, 0.2 s yoyo) at > 80 (HUD:53278-53279, 53400-53428) |
| Ball-cam indicator | `[Hud] BallCam` (INT:26752) | Ball Cam | BALL CAM | $HeaderFont 32 #FF7752, glow #FF4343 8 | HUD:53122, 53165 m#9173 |
| Ball-cam hint | `[Global] ToggleInstructions` (INT:26654) | Press {0?KeyBinding} to Toggle | PRESS ‹key› TO TOGGLE (HT-3) | $HeaderFont 16 white, glow #000000 blur 6 | HUD:53121, 53219 m#9179; empty in Hold mode |
| Nameplate, own car | `[Global] You` (INT:26735) | You | YOU | $SmallBoldFont 16, team text colour | NP:38710, 38824; only with one local player. Other plates show the name upper-cased |

**Main menu** (RootMenu; buttons `NewBasicMenuButtonWithIcon`, label $HeaderFont 18 white: MM:70311, SC-chars:1119):

| Button | Key | Localized string | Displayed | Evidence |
|---|---|---|---|---|
| Play | `[Global] Play` (INT:26437) | Play | PLAY | MM:75488, 75859 |
| Garage | `[Global] Garage` (INT:26263) | Garage | GARAGE | MM:75489, 75881 |
| Settings | `[Global] Settings` (INT:26579) | Settings | SETTINGS | MM:75493, 75896 |
| Quit | `[Global] Quit` (INT:26497) | Quit | QUIT | MM:75498, 75903 |

- Each button also has an upper-cased description line, by key: `PlayDesc`, `GaragesDesc`, `OptionsDesc`,
  `ExitGameDesc`.
- QUIT confirms: title `[Global] QuitGame`, body `[ModalPopups] QuitGameInquiry`, buttons YES / NO (by key, MM:75903).

**Pause menu** (MidGameMenu; buttons `NewModalMenuButton`, label $HeaderFont 18 white centred, SC-chars:1858 [I: default
class of `createButton`]):

| Button | Key | Localized string | Displayed | Evidence |
|---|---|---|---|---|
| Resume | `[Global] ResumeGame` (INT:26543) | Resume Game | RESUME GAME | MGM:59005, 59273 (replay viewer: ResumeReplay, by key) |
| Settings | `[Global] Settings` | Settings | SETTINGS | MGM:59013, 59363 |
| Show Controls | `[Global] Controls` (INT:26141) | Show Controls | SHOW CONTROLS | MGM:59061, 59380. **Only in the game editor, the replay viewer or spectating** |
| Leave | `[Global] LeaveMatch` (INT:26319) | Leave Match | LEAVE MATCH | MGM:59015; `getLeaveMatchButtonData` m#9108 |
| Forfeit (1v1) | `[Global] ForfeitMatch` (INT:26253) | Forfeit Match | FORFEIT MATCH (red button) | MGM:59035 (cleared, match-rules-audit) |
| Vote (teams) | `[Global] VoteForfeit` / `VoteConcede` (INT:26704 / 26703) | Vote to Forfeit / Vote to Concede | VOTE TO FORFEIT / VOTE TO CONCEDE | cleared, match-rules-audit MR-7.8 |
| Exit | `[Global] ExitMainMenu` (INT:26235) | Exit to Main Menu | EXIT TO MAIN MENU | replay viewer and training only; cleared, MIO §5 |

- The pause title is by key and upper-cased: `[Global] Paused`, `Exhibition`, `PrivateMatch`, `LANMatch`, the online
  free-play title (AS3 default only, key `OnlineFreePlay`), or the playlist name as-is when online (MGM:58999-59005,
  59240-59267). $HeaderThinFont 36 #666666 + additive (67, 175, 255).
- Other pause entries are by key: `RestartMatch` (offline), `ChangeTeam` (private/offline/LAN), `ChangeModeOrMatch`,
  `PlayerReport` (SB-12), `ShowMutators`, `AbandonMatch`.

**Settings** (title `[Global] Settings` → SETTINGS, $HeaderThinFont 36 tinted (67, 175, 255), SET:61042): tabs, row labels
and options in HT-5. **Replay HUD**: HT-6. **Stat/scoreboard**: HT-9.

### HT-3 The {key} token [M][S][A]
1. **Syntax.** `{0?KeyBinding}`: argument index 0; the name after `?` is only a hint. `StringUtils.formatLocalizedString`
   replaces every match of `/(\{0\?\w+\})+/` with the argument (HUD:1675 m#424, same in every movie). An already
   upper-cased format (`{0?KEYBINDING}`) still matches.
2. **Order.** Ball cam: format, then upper-case the whole line (HUD:53219). Replay prompts: the format is upper-cased in
   `cinit` and the result again after formatting (HMI:50793-50794, 50957-50958). So the key word is always capitals.
3. **Which binding.**
   - Ball cam: `ControlBindingsManager.getKeyForAction('SecondaryCamera', inputType != PC)` (HUD:34378 m#7331) → the
     bindings row's `UIKey`. Rows get it from `GFxData_Controls_TA.MapUIBinding` → `PlayerInput_X.GetUIKey(Key)`
     (TA:41362-41363).
   - Replay: `Shell.GetKeyForAction('ReadyUp' | 'ToggleScoreView', gamepad)` → `GFxShell_TA.GetKeyForAction` →
     `PlayerInput_TA.GetUIKeyForAction` → `GetUIKey` (TA:62997-62998, 78344-78346).
   - It is re-evaluated when the input type changes (HUD m#9178, HMI m#8756).
4. **`PlayerInput_X.GetUIKey(KeyName)`** [S PX:16327-16348]:
   - `None` → empty; `XboxTypeS_Back` → `GP_Select`.
   - Otherwise the key name with: `XboxTypeS_` → `GP_`, `Thumbstick` → `Thumb`, `Axis` → removed, `MouseButton` →
     `Mouse`, and, unless the key itself is Right/Left/Up/Down, `Right` → `R`, `Left` → `L`, `Up` → `U`, `Down` → `D`.
   - Then `Localize('Keys', token, 'Keys')` from Keys.int `[Keys]` (INT:1367-1422; English in the local file).
   - The tail after that call does not decode. Tokens with no Keys.int entry are used unchanged [I]: the icon table in
     step 5 is keyed by exactly such tokens (RMouse, LMouse, MiddleMouse, MouseScrollU/D). A per-key cache is read
     first (`GetCachedUIKey`); the store is presumably in the undecoded tail.
5. **Icons** [M HUD:1886-2330, `SystemIconManager` m#441-458]. The text field gets GFx image substitutions: each token
   below, as written, upper-cased or lower-cased, is drawn as a bitmap instead of text.
   - Tokens: GP_A, GP_B, GP_X, GP_Y, GP_LShoulder, GP_RShoulder, GP_LTrigger, GP_RTrigger, GP_LThumb, GP_RThumb,
     GP_DPad_U/D/L/R, GP_Start, GP_Select (PS4 pad on PC: Share), GP_LS/LX/LY/RS/RX/RY and the GP_P_/GP_N_ axis forms,
     plus PC LMouse, RMouse, MiddleMouse, MouseScrollU, MouseScrollD, BackspaceKey.
   - Glyph set per pad type: `GamepadIcon_<button>` with suffix _XB1 (Xbox One), _PS4 then _PS (PS4), _NX / _NXSingle
     (Switch), _XB (360; the PC fallback when the pad type is not one of these).
   - Size: icon height = the line height × 1.5, baseline shift −1.5 (HUD:53169; HMI:50841, 50846).
   - Every other token (keyboard keys) is drawn as a word in the field's font.
6. **Defaults** (DefaultInput.ini, `Default__ControlPreset_X`; the default preset is Modern, notes/controls-audit.md
   C-3):

   | Action | KBM Modern | KBM Standard / Legacy | Pad |
   |---|---|---|---|
   | SecondaryCamera (ball cam) | MiddleMouseButton → MiddleMouse → **icon** | SpaceBar → Keys.int `SpaceBar` → word | XboxTypeS_Y → GP_Y → **icon** |
   | ReadyUp (replay skip) | SpaceBar → word | RightMouseButton → RMouse → **icon** | XboxTypeS_A → GP_A → **icon** |
   | ToggleScoreView (replay view) | MiddleMouseButton → **icon** | SpaceBar → word | XboxTypeS_Y → **icon** |

   - Modern uses ball cam **Hold** on KBM (C-3), and in Hold mode the hint is empty (HUD:53219). So a default KBM
     player sees BALL CAM alone; a default pad player sees PRESS ‹Y icon› TO TOGGLE.
   - Other keys: e.g. LeftShift → LShift → Keys.int `LShift`; a letter key has no entry and shows the letter [I].
7. **Clone.** Build the hint as `format(key)` then upper-case. Draw our own glyphs for pad buttons and the mouse buttons
   (the game's icons are not shipped); keyboard keys as upper-cased words.

### HT-4 Pause-menu confirmations [M]
- **Modal popup** (`StandardModalPopup`):
  - Title: upper-cased (SHL:86077; base `ModalPopup.setTitleText` SHL:80180).
  - Body: as given, HTML with `{!…!}` highlight markup (SHL m#12407).
  - Button labels: upper-cased (SHL:80245).
  - Fonts: title $HeaderThinFont 36 #666666 + additive (67, 175, 255), black glow 8; body $HeaderFont 18 white
    (`ModalPopupMessage`); buttons `NewModalMenuButton` $HeaderFont 18 white centred, width 160.
  - Opening a modal outside the main menu calls `SetGamePaused(true)` (SHL:86097).
- **Buttons and confirmations** (`refreshButtons` MGM:59217, `getLeaveMatchButtonData` MGM:59740,
  `getCasualLeaveModalData` MGM:60108):

| Button | Shown when | Modal title | Body | Buttons |
|---|---|---|---|---|
| RESUME GAME | always | – (closes the menu) | – | – |
| SETTINGS | `Features.Options` | – (opens settings) | – | – |
| SHOW CONTROLS | game editor, replay viewer, spectating | – | – | – |
| LEAVE MATCH | default: offline, private, LAN, postgame, spectating, and online without a leave penalty or a running vote | LEAVE MATCH | `[ModalPopups] LeaveMatchInquiry`: "Are you sure you want to quit the match?" | YES / NO |
| FORFEIT MATCH (red) | MaxPlayers ≤ 2 and `bCanVoteToForfeit` | FORFEIT MATCH | `[ModalPopups] ForfeitMatchInquiry`: "Are you sure you want to forfeit the match?" | YES / NO |
| VOTE TO FORFEIT / VOTE TO CONCEDE | team playlists, forfeit vote allowed (MR-7.8) | none: votes at once | – | – |
| EXIT TO MAIN MENU | replay viewer, training | EXIT TO MAIN MENU | `[ModalPopups] ExitMainMenuInquiry`: "Are you sure you want to exit to the main menu?" | YES / NO |
| by key: RestartMatch | offline, primary player | `RestartMatch` | `RestartMatchInquiry` | YES / NO |
| by key: AbandonMatch | lobbies with a leave penalty | `Warning` (ranked) or `AbandonMatch` | `LeaverPenaltyInquiry` (ranked) or `ConcedeMatchLow/Med/HighInquiry` by quit severity | YES / NO |

- YES / NO: `[Global] Yes` / `No` (INT:26734 / 26381), upper-cased (MGM:59020-59021).
- YES on Leave/Forfeit runs `checkForReplay` (MGM m#9123). If a replay auto-save applies, a second modal asks first
  (by key: `[ModalPopups] SaveReplay`, `AutoSaveReplayInquiry`; then a name prompt).
- By key, not needed: Season (`LeaveMatchLoseProgressInquiry`), tournaments (`LeaveTournament*`), the replay viewer's
  `SaveReplayInquiry`. The abandon / leave-penalty texts stay out until leave penalties exist (match-rules-audit).
- The settings reset-to-defaults confirmation: `[SettingsMenu] ResetDefault` / `ResetDefaultDesc`, YES / NO, by key.

### HT-5 Settings tabs, rows and options [M][S][A]
**Tabs** (order SET:61025; label upper-cased in `setupTabButton` SET:61669 m#9313; `ModalCategoryButton` $HeaderFont 16
white, SC-chars:2980):

| Tab | Key | String | Displayed | Shown |
|---|---|---|---|---|
| Training | `[Global] Training` | Training | TRAINING | free play / training only |
| Gameplay | `[SettingsMenu] Gameplay` | Gameplay | GAMEPLAY | always |
| Camera | `[SettingsMenu] Camera` | Camera | CAMERA | always |
| Controls | `[SettingsMenu] Controls` | Controls | CONTROLS | when it has content |
| Interface | `[SettingsMenu] Interface` | Interface | INTERFACE | always |
| Stream Safe | `[SettingsMenu] StreamSafe` | Stream Safe | STREAM SAFE | when it has content |
| Scoreboard | `[SettingsMenu] CustomScoreboard` | Scoreboard | SCOREBOARD | `Features.CustomScoreboard` (SB-17) |
| Video | `[SettingsMenu] Video` | Video | VIDEO | always |
| Audio | `[SettingsMenu] Audio` | Audio | AUDIO | always |
| Chat | `[SettingsMenu] Chat` | Chat | CHAT | when it has content |
| Extras | `[Global] Extras` | Extras | EXTRAS | when it has content |

**Rows** (`UserSetting`, SET:41413):
- **Label:** UserSettings.int `[<Id>] Label`, upper-cased (SET:41490). $NormalFont 11 white, right-aligned, α 0.8
  (0.3 when disabled).
- **Help text:** `[<Id>] Description`, by key.
- **Dropdowns:**
  - Values are shown **as localized, not upper-cased** (SET:41605). The closed box uses $NormalFont 12 white; list
    items $NormalFont 12 #43AFFF (SC-chars:3285-3299).
  - Value text = UserSettings.int `[Values] <key>`: `AddEnumValue` → `AddValue` → `Localize('Values', key,
    'UserSettings')` (TA:54692-54700).
- **Checkboxes:** no text.
- **Slider readout** ($NormalFont 12, SET:41664-41671):
  - percentage mode: `round(v·100)` + "%";
  - degrees mode: v + "°";
  - otherwise `v.toFixed(decimals)`, decimals 2 by default (`Default__GFxData_UserSetting_TA`).
  - The mode is `CreateScalarUserSetting`'s last optional parameter (DisplayMode; params Group, Id, Default, Get, Set,
    Limits, bUserSetting, bEnabled, DisplayMode). The trailing `1` on UIScale, SafeZoneRatio, NameplateScale and
    CrosshairOpacity is that DisplayMode = percentage [S, I: the decoder drops skipped optional parameters].
- **Order** = creation order.

**Interface** (`InitInterfaceSettings` TA:56170-56214):

| Label (displayed upper-cased) | Control | Options as displayed (value) | Default |
|---|---|---|---|
| Interface Scale | slider 0.5–1, step .01 | "50%"…"100%" | 100% |
| Display Scale (primary player, PC) | slider 0.9–1, step .01 | "90%"…"100%" | native `GetDefaultSafeZone` (open, HUD-1) |
| Nameplate Scale | slider 0.5–2, step .1 | "50%"…"200%" | 100% |
| Nameplate Mode | dropdown | Nearby Only (0) · Default (1) · Simplified (2) | Default |
| Match Notifications | dropdown | All (0) · Time Updates Only (1) · Kickoffs Only (2) | All |
| Stat Graphs (when `UIConfig_TA.bShowStatGraphOptions`, default True, or a graph is on) | dropdown | None · Performance Summary · Performance Graph (short) · Performance Graph (long) · Network Summary · Network Graph (short) · Network Graph (long) · Speed Summary · Speed Graph (short) · Speed Graph (long) (0–9) | None |
| Connection Quality Indicators | checkbox | – | on |
| Color Blind Mode (primary) | checkbox | – | off |
| Social Notifications During Gameplay (primary) | checkbox | – | on |
| Item Shop Notifications (when the feature is on) | checkbox | – | account permission default |
| Team-Colored Boost Meter | checkbox | – | on |
| Metric | checkbox | – | on unless the build region is US (`GetMetricDefaultValue` TA:84230-84231) |
| Ball Cam Indicator | checkbox | – | on |
| Ball Arrow | checkbox | – | on |
| Center Dot Style | dropdown | None (0) · Chevron (1) · Dot (2); literal strings in the script, not localized (TA:56198) | None |
| Center Dot Scale | slider 0.1–1, step .1 | "0.10"…"1.00" | 0.30; disabled while the style is None |
| Center Dot Opacity | slider 0.1–1, step .05 | "10%"…"100%" | 60%; disabled while None |
| Hide In-Game HUD | checkbox | – | off |
| Convert Platform Friends | checkbox | – | off |

**Gameplay** (`InitGameplaySettings` TA:55962-56010, `InitNetworkSettings` TA:55926, `InitCrossPlaySetting` TA:55921):

| Label (displayed upper-cased) | Control | Options as displayed (value) | Default / shown |
|---|---|---|---|
| Unlimited Boost in Free Play | checkbox | – | on; offline free play with the Training tab off only |
| Splitscreen Layout | dropdown | Vertical ('0') · Horizontal ('1') | Vertical; primary player |
| Cross-Platform Play | checkbox | – | on; primary, not inside an online match |
| Client Send Rate | dropdown | Low · Medium · High | High; primary, not a listen server |
| Server Send Rate | dropdown | Low · Medium · High | High; same |
| Bandwidth Limit | dropdown | Low · Medium · High | High; same |
| Input Buffer | dropdown | Default (0) · STS (1) · CSTS (2) | Default; primary |
| Show Competitive Divisions | checkbox | – | on |
| Show Competitive Ranks | dropdown | None · Extra Modes Only · Standard Modes Only · All (Default) | All (Default); when `bRankedSportsEnabled` (True) |
| Show Competitive MMR | dropdown | None · Main Menu Only · In-Game Only · Everywhere | Everywhere |
| Force Default Team Colors | checkbox | – | off; primary, not in free play |
| Enable Autosave | checkbox | – | on; only while saving is disabled |
| Show in-match event visuals | checkbox | – | on |
| Game Stat Display Level | dropdown | No Stats (0) · Main Stats Only (1) · All Stats (2) | Main Stats Only |
| Suppressed Honor Duel Notifications | dropdown | None · Challenges · Spectate · All | None; primary, honor duels active |
| Display Party Leader Left Message | checkbox | – | on |
| Skip Drop Opening Animation | checkbox | – | off |
| Flip Reset Indicator | dropdown | Off (0) · Audio Only (1) · Visuals Only (2) · On (3) | On; primary |
| Skip Goal Replay | checkbox | – | off |
| Tournament Schedule Region | dropdown | the region labels from `RegionConfig_X` (server data), else "None" | the current tour region |

- Labels: UserSettings.int `[<Id>] Label` (INT:27591-28350).
- Values: `[Values]` (INT:27982-28154): Nearby Only `DistanceFade`, Default `Default`, Simplified `Simplified`,
  All `AllMessages`, Time Updates Only `GameUpdateMessages`, Kickoffs Only `KickoffMessages`, No Stats `NoStats`, Main
  Stats Only `PrimaryStats`, All Stats `AllStats`, Off/Audio Only/Visuals Only/On `FlipReset*`.
- Nameplate Mode value 1 uses key `Default`, not the unused `AlwaysVisible`.
- Defaults: HUD1 `defaults/*.txt` (class defaults; unset = 0 / False) and the create calls.

### HT-6 Replay banner (HUD-11) [M][S]
`ScoreReplayView` / `ScoreReplayInfoView` (HMI:50628-50960; HMI tree d7):

| Element | Key / source | Localized | Displayed | Font, colour | Evidence |
|---|---|---|---|---|---|
| Label, bottom-left | `[Global] Replay` (INT:26522) | Replay | REPLAY | $HeaderFont 32 #FF7752, glow #FF4343 8, shrink, v-centred | HMI:50832 |
| Scorer caption | `[Hud] ScoredBy` (INT:26755) | Scored By | SCORED BY | $HeaderFont 14 #98DAFF, glow #016BF7 6, centred | HMI:50660 |
| Scorer banner | player banner: name as written with `[CLUB] ` prefix; title upper-cased | – | – | shared PlayerBannerInfoComponent | HMI:44256 m#8162 |
| Assist | **no text label**: Icon_ScoreAssist + the assister's name as written | – | – | $HeaderFont 18 #CCCCCC + additive team tint, black glow 6 | HMI:50709-50717 |
| Goal time | **no text label**: Icon_ScoreTime + M:SS | – | e.g. 1:07 | $HeaderFont 18 #98DAFF, glow #016BF7 6 | HMI:50737, `formatScoreTime` m#8744 |
| Goal speed | Icon_ScoreSpeed + number + unit; `[Global] KPH` (INT:26307) / `MPH` (INT:26333) | KPH / MPH | 97 KPH / 60 MPH | number $HeaderFont 18; unit 12 px, `<font size='12'> KPH</font>` (the space is inside the small font) | HMI:50742-50745 |
| Skip prompt | `[Global] SkipInstructions` (INT:26597) | Press {0?KeyBinding} to Skip | PRESS ‹key› TO SKIP | $HeaderFont 16 white, right-aligned | HMI:50793, 50957 (action ReadyUp) |
| View prompt | `[Global] ToggleToChangeView` (INT:26655) | Press {0?KeyBinding} to Toggle View | PRESS ‹key› TO TOGGLE VIEW | same, 20 px above | HMI:50794, 50958 (action ToggleScoreView) |
| Not-ready list | player names only, joined ", " | – | names as written | others $HeaderThinFont 24 #FF4343; the local player in $HeaderFont white | HMI:50895-50932 |

- **Goal time** (`ScoreData.Time`, TA:84891-84893):
  - Value: `round(WorldInfo.TimeSeconds − ReplayStartGameTime)`, in game seconds.
  - `ReplayStartGameTime` is set when the replay director enters Recording (TA:85030-85033). That happens again at each
    countdown after a replay (MR-6.8).
  - So the banner shows **the round's age at the goal**, counted from the start of that round's kickoff countdown (the
    1 s + 3 s countdown included). It is **not the match clock** [S][I].
  - Online free play: seconds since the previous goal.
  - Format: `getFormattedTime(t, 0, TIME_MINUTES)` → minutes = floor(t/60), unpadded; seconds = t mod 60, padded to 2
    digits; joined with ":"; a "-" prefix if negative (HMI:6136-6197, 50753-50769).
- **Speed** (`ScoreData.Speed`, TA:84889):
  - Value: `Round(|ball linear velocity|)` in uu/s when the goal is scored.
  - KPH = `Math.round(Speed × 3600 × 0.01 / 1000)` = round(Speed × 0.036).
  - MPH = `Math.round(Speed × 36 / 1609.344)` = round(Speed × 0.0223694).
  - `UnitUtils.convert(v, from, to)` = v·from/to, HMI:6963-6994. AS3 `Math.round` = floor(x + 0.5).
- **Units:** the Interface **Metric** checkbox, `LocalPlayer.bMetric` ← `ProfileGameplaySave.bMetric`
  (TA:45835, 56351-56354). Default metric unless the build region is US.
- **Own goals:** `GFxHUD_Soccar_TA.UpdateReplayData` sets the scorer and assister to −1 when the scoring touch's team
  equals the goal's team (TA:61933-61943). Then there is no SCORED BY, banner, scorer glow or assist; time and speed
  still show.

### HT-7 Match Notifications [S][A]
- **The filter:** `GFxHUD_TA.ReceiveMessage` (TA:61602-61612).
  - The text is shown only if `HUDMessageThreshold ≤ Message.MessageLevel`.
  - The setting's value is the threshold: All 0, Time Updates Only 1, Kickoffs Only 2 (TA:56177).
  - Levels: `EHUDMessageLevel` All 0, GameUpdates 1, Essential 2 (HUD1 enums.txt:64). A message with no level is
    All (0).
  - **The message sounds play regardless** (same function, after the check).
- **Levels** ([A] `soccar_messages.txt`, GameInfo_Soccar_SF `Archetypes.GameEvent.GameEvent_Soccar.*`):

| Message | Archetype | Level | All | Time Updates Only | Kickoffs Only | Sound (primary player) |
|---|---|---|---|---|---|---|
| 3, 2, 1 | Countdown1..5 | Essential | shown | shown | shown | SFX_UI_Countdown_01..05 |
| GO! | GoMessage | Essential | shown | shown | shown | SFX_UI_Countdown_Go |
| goal scored (by key `GoalScored`) | GoalScoredMessage | Essential | shown | shown | shown | – |
| OVERTIME! | OvertimeMessage | GameUpdates | shown | shown | hidden | SFX_UI_Countdown_Overtime |
| ONE MINUTE REMAINING! | OneMinRemainingMessage | GameUpdates | shown | shown | hidden | SFX_UI_Countdown_Remaining_60sec |
| 30 SECONDS REMAINING! | ThirtySecondsRemainingMessage | GameUpdates | shown | shown | hidden | SFX_UI_Countdown_Remaining_30sec |
| 10 … 1 | SecondsRemainingMessage | GameUpdates | shown | shown | hidden | SFX_UI_Countdown_EndCounter |
| two-minute warning (max-time system only; by key `TwoMinRemaining`) | TwoMinRemainingMessage | GameUpdates | shown | shown | hidden | Remaining_30sec (as in the data) |
| pause / resume (by key `GamePaused`, `GameUnPaused`) | GamePausedMessage, GameUnPausedMessage | unset = All | shown | hidden | hidden | – |
| out of bounds (other modes; by key) | OutOfBoundsMessage | Essential | shown | shown | shown | NFL whistle (`Sound`, everyone) |

- **Stat popups:** events with `bCanMute` (Soccar: BallHit, CrossbarHits, the flip-reset events, …; STAT1
  `statevents_soccar.txt`) are hidden unless the setting is All (`GFxHUD_TA.HandleStatEvent` TA:61573-61582). Every
  popup also goes through Game Stat Display Level (`CanDisplayStatEvent` TA:61584-61591: No Stats none, Main Stats
  Only `bPrimaryStat`, All Stats all).
- **Clients do get the 10…1** (this closes the HUD "Seconds countdown" open item):
  - `Message_TA.Broadcast` calls `PlayerController_TA.ReceiveMessage` for every player (TA:32707-32714).
  - That is a **reliable client RPC**: flags 0x10201c3 = Net, NetReliable, Simulated, NetClient (TA:77124-77126).
- **Triggers:**
  - 10…1: authority only, not in overtime, `0 < SecondsRemaining ≤ SecondsRemainingCountdown` (10 [A]) and not
    unlimited time (TA:3226-3234, 3242).
  - 60 s / 30 s: when SecondsRemaining drops to 60 / 30 (TA:4199-4214).
  - Goal message:
    - the scorer, when the scoring touch was by the other team;
    - otherwise the scoring team's name (own goal; `bShowNoScorerGoalMessage` True [A]);
    - never in offline free play (TA:4087-4098, 4592-4595).
  - `bCountdownMessagesDisabled` suppresses the kickoff countdown and GO! (TA:1520-1530).

### HT-8 Nameplates (HUD-13) [A][S][N]
- **Mesh** `GFx_Meshes.NameplatePlane` (TAGame.upk; 4 vertices, read with HT1 `py/npmesh.py`; `scripts/staticmesh.py`
  misses its unaligned buffer):
  - a vertical quad in the local Y–Z plane: Y −128…+128, Z 0…+64, X 0;
  - UVs span 0–1: (Y +128, Z 0) → (0, 1); (−128, 0) → (1, 1); (+128, 64) → (0, 0); (−128, 64) → (1, 0) [A].
- **Base size** under Scale3D (1, 2, 1) (`Default__NameplateMeshComponent_TA`, also AbsoluteRotation True, bOwnerNoSee
  True): **512 uu wide × 64 uu tall** (8 : 1). The pivot is the centre of the bottom edge [A].
- **Offset** (archetype `GFxHUD_Soccar.NameplatesManager.NameplateMeshArchetype`, Translation (0, 0, 60)):
  - the bottom edge is **60 uu above the car actor's origin**; the top edge is at 124 uu at scale 1 [A];
  - attached to the car (`Owner.AttachComponent`), one instance per local viewer (`SetLocalViewer`)
    (TA:62778-62789).
- **Curves** (same archetype; all points linear):
  - DistanceScaleCurve (0 → 0.5), (10000 → 9);
  - FOVScaleCurve (0 → 0.1), (90 → 1);
  - constant beyond the end points (UE3 InterpCurve clamping [I]). So the FOV term is 1 at FOV ≥ 90 and 0.7 at FOV 60.
- **NameplateScale:** `PlayerOptionsScale = GameViewportClient_TA.NameplateScaleModifier` = Interface Nameplate Scale
  (0.5–2, default 1) (TA:70759-70772, 88206).
- **Combination: native, open.**
  - Where: `NameplateMeshComponent_TA.TickNameplate` (`execTickNameplate`, live 0x140e78d40, natives.csv:4102),
    called every tick from `GFxNameplatesManager_TA.Tick` (TA:62803-62813). Not decompiled (brief).
  - Expected [I]: scale = DistanceScale(d) × FOVScale(fov) × NameplateScale, applied uniformly about the bottom-edge
    pivot, with d = camera-to-plate distance and the plate turned to face the camera.
  - If so, at FOV ≥ 90 and NameplateScale 1: d 1000 → ×1.35 (691 × 86 uu); d 3000 → ×3.05; d ≥ 10000 → ×9.
- **Texture aspect, open:**
  - The 256×512 RTX movie renders into a 1024×1024 target (TA:62731).
  - It holds 8 slots of 256×64, stacked (NP:62709-62710).
  - The slot's UV mapping (scalar `PlayerIndex`) is compiled into `PlaneMat_Masked`; only its parameter expressions
    survive cooking.
  - Whether a 4:1 slot shows stretched on the 8:1 plane needs a screenshot.
- **Text:** the name upper-cased, or YOU (HT-2), $SmallBoldFont 16 in the team text colour (NP:38824-38832).
  Distance Fade is measured from the PlayerController's location (`GFxData_Nameplate_TA.Tick` TA:49390-49416,
  `HideFullNameplateDistance` 7000 [A]).
- **Not in HUD-13:** plates draw the car's boost amount (`bRenderBoostAmount`) for teammates (not in Knockout), and for
  everyone in replays or when spectating; never on the podium (TA:49417-49424). The RTX movie's MeterRing / MeterFill
  symbols.

### HT-9 Stat and scoreboard text [M]
- **Stat popup** (`StatEventPopUp.setData` m#8322):
  - event name = StatEvents.int `[Events.<Name> StatEvent_TA] Label`, upper-cased (HUD:44656);
  - points "+N", or a blank at 0 (HUD:44660).
- **Stat ticker:** receiver and victim names upper-cased with a `[CLUB] ` prefix; YOU for the local player
  (HMI:41462, 41490).
- **Scoreboard:** SB-3 / SB-6. The column headers in TAGame.int `[Scoreboard]` are already capitals (e.g. `MatchScore`
  SCORE); player names are shown as written.

### HT-10 Corrections and additions to the rows above
- **HUD-3:** in English the clock-slot OVERTIME is **one line**. The field is multiline, but the AS3 shrinks it 1 pt at
  a time until lines ≤ words.
- **HUD-5/7:** BOOST is hidden at ≤ 80 and appears, blinking, only above 80.
- **HUD-9:** the goal banner's English (TAGame.int `[Messages] GoalScored`) **is cleared** (verbatim decision:
  "GoalScored"). Own goals name the team.
- **HUD-10:**
  - The options show as All / Time Updates Only / Kickoffs Only.
  - The pause message HUD-10 quotes is by key (`[Messages] GamePaused`, level All); not cleared.
  - The seconds countdown reaches clients (HT-7).
  - Sounds ignore the filter.
- **HUD-11:** the assist, time and speed lines have icons, not text labels. The time is the round's age at the goal,
  not the clock. KPH = round(round(|v|) × 0.036).
- **HUD-12:** the hint has a black glow (6). It is empty under Hold, the KBM default with the Modern preset.
- **HUD-13:** geometry and open items in HT-8; add the teammate boost on plates.
- **MENU-4:** "Resume" is RESUME GAME. SHOW CONTROLS appears only in the editor, the replay viewer and spectating.
  Leave becomes FORFEIT MATCH (1v1) or VOTE TO … (teams) per HT-4.
- **MENU-6/9:** the displayed option names are those in HT-5 (Nearby Only, Time Updates Only, Kickoffs Only, Main Stats
  Only, Audio Only, Visuals Only, …), not the enum names.

### HT-11 Measurements for the HUD fixes (2026-10-14)
- **Red dot** (HUD-11/12): `gfx_shared.GlowingRedDot` 32×32 bitmap, centred, scale 1. Solid core #FF7752 α 1, ≈ 13 px
  across (50 % alpha at 14 px); halo #FF4141 α ≈ 0.29 at r 7–8 → 0 at r 16; ink = a 16 px solid disc. Label box at +12 px.
  Behind the label: Glow_LinearFade 256×64 × 1.953, tint (255, 67, 67), α 0.5 [A][G].
- **Fonts** (DefineFont3 outlines, GFX_Fonts.Fonts_EFIGS; EM 20480): Bourgeois Medium cap 0.5679 em, x-height 0.4258,
  ascent 0.7875, descent 0.2275, leading −0.15; Bourgeois Thin cap 0.5679, x 0.4209; Arial / Arial Narrow cap 0.7158,
  x 0.5186. Substitute size = size × 0.5679 / cap(substitute) [A].
- **Perspective:** MatchInfoView `fieldOfView 165; focalLength 100`, centre (W/2, 80) (HMI:49955-49963); boost meter
  `fieldOfView 120; focalLength 500`, centre (x − 50, y − 100) (HUD:53281-53286). Flash links the two
  (fov = 2·atan((W/2)/focal)), last write wins → effective focal 100 and 500 (CSS perspective in stage px) [M][I: Scaleform = Flash].
- **Scoreboard fills:** no clip alpha; textures carry it: MatchTimer_Background black α 0.80; TeamScoreView_Background
  (18, 19, 18) α 0.80 (0.85–0.89 band) + additive team tint (alpha unchanged); TeamName_Background α ≤ 0.98, mostly
  0.75–0.95; TeamScoreView_Glow (additive) hidden by default [A][M].

### HT-12 More measurements for the HUD fixes (2026-10-14)
- **Nameplate material** `GFx_Meshes.PlaneMat_Masked` (TAGame.upk) [A]: **BLEND_Masked** (alpha test,
  OpacityMaskClipValue 0.667, so hard edges and no partial transparency), unlit, `bAllowFog` false, **depth test on**
  (no bDisableDepthTest; a masked material also writes depth). The component (`Default__NameplateMeshComponent_TA`) sets
  no depth-priority group and isn't translucent, so no sort priority applies. **The ball, cars, goal frames and the
  world in front of a plate hide it**; the clone's draw-over-everything is a deviation.
- **Stat popup** (StatEventView at (W/2, 150); each popup is added at the view's origin) [G anim]:
  - Name (`EventNameLabel`): text box x −98…102, **y −17…25** ($HeaderFont 32), hold position (0, 0) from 0.6 s
    (rises from +20 over 0.4–0.6 s). Baseline ≈ y 10, caps ≈ y −8…10.
  - "+N" (`PointsLabel`): label at (0, **22**), its box y −12…18 inside, so **y 10…40** on the view ($HeaderFont 22);
    baseline ≈ y 29, caps ≈ y 17…29. Pops from 3× to 1× in 0.23 s about the label's origin (0, 22).
  - Icon: 32 px icon at scale 2, box (−32, −47)…(32, 17) while held still (0.13–0.37 s). It then grows to 5.625× at
    (−90, −100) (a 180 px faint orange icon behind, α 0.5, blur 4) over 0.4–0.8 s.
  - Exit 2.17–2.63 s: all rise (name to y −40, +N to −38, icon −30) and fade.
  - So on the stage: name caps y ≈ 142–160, "+N" caps y ≈ 167–179.
- **GameMessageView (W/2, 250)** [G]: the text box ($HeaderThinFont 72) is at (−228, −36), 460 × 76.3, so y 214…290.
  The anchor 250 is ≈ the **box's vertical centre** and ≈ the **cap-height centre** (baseline ≈ y 272, caps ≈ 231–272;
  Bourgeois Thin ascent 0.7775). It is neither the top nor the baseline. The message's caps start ≈ 52 px below the
  popup's "+N", so in the game they never overlap.
- **Dashboard Numbers Wide** (`$NumbersWideFont`, DefineFont3 in GFX_Fonts.Fonts_EFIGS; EM 20480) [A]:
  - **digit height 0.5781 em** ('1' 0.5864); ascent 0.7775, descent 0.2275, leading 0.05;
  - digits 0.736 em wide with **advance 0.796 em**, except **'1': advance 0.31** (proportional);
  - ':' 0.14 em advance (dots between 0.118 and 0.461 em); '+' 0.442 advance.
  - So the clock at 31 px has 17.9 px digits and a 24.7 px advance (+ letterSpacing 2); the score at 48 px has
    27.7 px digits and a 38.2 px advance.
  - A substitute font's size = size × 0.5781 / its digit height; match the advance with letter-spacing.
  - **Per-glyph ink (em; y up from the baseline)** [A]:

    | Glyph | xMin | xMax | Ink width | Advance | yMin | yMax |
    |---|---|---|---|---|---|---|
    | 0, 2–6, 8, 9 | 0.0298 | 0.7661 | 0.7363 | 0.7959 | 0 | 0.5781 |
    | 7 | 0.0298 | 0.7674 | 0.7376 | 0.7959 | 0 | 0.5781 |
    | 1 | 0.0249 | 0.2798 | 0.2549 | 0.3100 | 0 | 0.5868 |
    | : | 0.0298 | 0.1099 | 0.0801 | 0.1400 | 0.1182 | 0.4609 |
    | + | 0.0298 | 0.4121 | 0.3823 | 0.4419 | 0.0981 | 0.4800 |
    | NBSP (U+00A0) | – | – | 0 | 0.4860 | – | – |

    Side bearings are ≈ 0.03 em on both sides for every glyph ('1': 0.025 left, 0.030 right).
- **Label baselines** [M][G]; first baseline = top + 2 gutter + DefineFont3 ascent [I: Scaleform = Flash]:
  - BALL CAM: top-aligned (autoSize LEFT), baseline +11.2, caps' middle +2.1, so the dot (exactly centred: alpha
    centroid 15.5/15.5 in the 32 px bitmap; it pulses but never moves) sits ≈ 2 px above the caps' middle.
  - REPLAY: VALIGN_CENTER + shrink; one 32 px line fills the 32.5 px inner height, so again baseline ≈ +11.2.
- **OVERTIME in the clock slot** (HMI:49974-49984; box (−60, 4) 124 × 50, centred, multiline, leading −6): VALIGN_CENTER;
  shrinks by 1 until it fits one line. "OVERTIME" = 3.9147 em in Bourgeois Medium → **30 px** (31 = 121.4 px > 120 inner).
  Baseline = 4 + 2 + (46 − 1.015·30)/2 + 0.7875·30 ≈ **y 37.4** of matchInfoView (caps 20.4…37.4, middle 28.9, level with
  the clock digits' middle 29.2).
- **Number alignment** [G][M]:
  - **Clock** (`timeRemainingTextField`, box (−63, 12), 130 × 36.1, $NumbersWideFont 31): **centre-aligned**, no autoSize,
    no script x moves.
    - `onTimeRemainingChanged` (HMI:50222-50255) appends a **no-break space (U+00A0, advance 0.486 em) when the last
      character is '1'**. '1' (0.31) + NBSP (0.486) = 0.796, a wide digit's advance, so a trailing '1' takes a full digit
      cell (drawn at its left).
    - letterSpacing 2 goes on the whole text, or, when padded, on all but the last two characters ('1' and the NBSP).
    - Only the last character is compensated, so 1:10 → 1:11 doesn't move, but a '1' elsewhere (minutes, tens) makes
      the centred text shift: 1:19 → 1:20 widens by 0.486 em (15 px), moving every character ≈ 7.5 px.
    - The overtime "+" prefix is part of the same centred text.
  - **Score digits** (`scoreTextField` + its ghost `backgroundTextField`, 70 × 52, $NumbersWideFont 48): centre-aligned,
    set as plain `String(score)` (no padding, no autoSize). On a score increase the team glow flashes (visible, α 1 →
    0 over 0.6 s, Power1.easeIn; HMI TeamScoreView.onScoreChanged).
  - **Boost number** (`boostTextField` + ghost, 120 × 58.2, $NumbersWideFont 54): centre-aligned, plain text, no padding.
- **HUD-12 text x** [G]: the dot's centre is the view origin (50, 672 + ΔH). "BALL CAM" (box (12, −16), 120 × 42.4,
  left) and "PRESS {key} TO TOGGLE" (box (12, 12), 120 × 23.2, left) **share the left edge, 12 px right of the dot's
  centre** (glyphs start ≈ 14 px with Flash's 2 px gutter). Baselines ≈ y +11 (label, 32 px) and ≈ y +27 (hint, 16 px).
  The REPLAY label (HUD-11) uses the same 12 px offset.

### HUD-2a Scoreboard shapes, measured (2026-10-14)
The bitmaps carry transparent padding; the visible shapes are smaller than the 180 × 90 and 90 × 90 bitmaps [A][G].
Coordinates are relative to matchInfoView's origin (W/2, y). The timeline places it at y 9, but at runtime
`updateMatchInfoPosY` sets **y = m_offsetPosY = 0** (HMI:50048-50091); the intro tweens it −20 → 0 (HUD-4). While the player
is searching for a match (`OnlineMatchStatus.bSearching`, no split screen), y = MATCHMAKING_VIEW_HEIGHT = 26 instead (HMI:50077) [G]:
the board sits under the compact 26 px matchmaking banner (notes/matchmaking.md MM-5; the old expandable panel is unused).
- **Clock box** (MatchTimer_Background, 256 × 128 at 0.7031, placed at (−90, −18)): an opaque rectangle (tex x 32…223,
  y 24…103) → **135 × 56 at x −67.5…67.5, y −1.1…55.1**. Black, α 0.80, **hard edges** (no soft margin, shadow or
  glow), square corners. A shallow **notch at the bottom centre**: ≈ 41–44 px wide, ≈ 2 px deep, with 45° ends.
- **Score boxes** (TeamScoreView_Background, 128 × 128 at 0.7031, placed at (−90, −17) inside each score view; orange
  mirrored): an opaque shape (tex x 32…127, y 24…103) → **67.5 × 56 at x −67.5…0, y −0.1…56.1** of the score view.
  - The views sit at x ∓67 in matchInfoView, so the **blue box spans x −134.5…−67 and the orange 67…134.5**, joining
    the clock box (0.5 px overlap).
  - Corners: **rounded (r ≈ 5 px) on the outer side only**; the inner side, against the clock, is square. Hard edges,
    no shadow.
  - Fill: base (18, 19, 18) at α 0.80, **dark on the outer ~40 %, then a grey ramp toward the inner edge** (luminance
    ≈ 1, 10, 29, 48, 70 at 45, 55, 70, 80, 90 % of the width); α rises to 0.89 at the inner edge. The additive team tint
    makes it the team colour with a lighter inner side.
- **The whole board** is therefore **269 × 56 px** (x −134.5…134.5), from stage y ≈ −1 to 56 (flush with the top
  edge). The perspective centre (W/2, 80) is in stage coordinates (Flash: projectionCenter is relative to the stage
  top-left), i.e. 80 px below the board's origin [I: Scaleform = Flash]. The match-type caption
  and other parts hang below (HUD-2).

### HUD-17 Ball Arrow (Interface "Ball Arrow", `BallIndicator`, default on; static session 2026-10-14)
UserSettings.int `[BallIndicator]` (by key): an arrow above the car that always points to the ball.
- **What draws it: a 3D mesh, not the HUD movie.** `TargetIndicator_TA` is a StaticMeshComponent attached to the
  car (`Car_TA.HandleTargetAdded` → `AttachComponent`, TA:20736-20742). Defaults: `bOnlyOwnerSee` (only the car's
  owner sees it), `AbsoluteRotation`, `HiddenGame` true until native code shows it [A].
- **Archetype** `Archetypes.Component.BallIndicator` (TAGame.upk) [A]: StaticMesh `Gadget_BallLocatorArrow.BallLocatorArrow_SM`,
  `MinTranslationX` 75, `MaxTranslationX` 120, `MinDistance` 100, `MaxDistance` 10000, `ZTranslationOffset` 20,
  `TranslucencySortPriority` 1; no scale (1).
- **Mesh** [A]: a round 3D arrow along +X: shaft radius 2.25 uu from x −6.8 to 0.5, head (cone) radius 4.31 from x 0.5
  to the tip at 7.8 (14.6 uu long, 8.6 wide), plus a sphere of radius 12 uu round its origin (second section).
- **Materials** [A]: arrow `BallLocatorArrow_Mat`: unlit, translucent, **depth test off** (drawn over the car and the
  world), a scalar parameter `Throb` (a pulse; its driver is native). Sphere `BallLocatorArrow_Clarity_Mat`: unlit,
  translucent, depth test off. **Correction (user, watching the game, 2026-10-14): the sphere is visible as a dark haze
  round the arrow, and the arrow flashes**; the earlier "invisible" inference was wrong. Haze colour/falloff and the
  Throb pulse are decoded below (ARW1); CS1 found no native or script driver for Throb. The colours are in the compiled
  shader, not in the package data → use our own colour (e.g. white or the team colour).
- **Placement** [N, CS1: TargetIndicator_TA vtable slot 0x2a0 → 0x140f510c0, every tick; no smoothing of its own]:
  - delta = ball actor Location − the car's origin (both drawn, i.e. smoothed, poses); d = |delta|.
  - **Rotation: full 3D along delta** (pitch + yaw, roll 0; FVector::Rotation), absolute.
  - **Translation = normalize(delta) · r, then +20 uu in world Z**, with **r = 75 + 45·clamp((d − 100)/9900, 0, 1)**
    (linear: d 1000 → 79.1, 3000 → 88.2). So the arrow sits 20 uu above the car→ball line, parallel to it.
  - Visibility: HiddenGame is cleared on every update. MaxDisplayDistance and DistanceScaleMultiplier are 0 in the
    archetype, so there is no distance hide and no scaling. There is no on-screen check.
  - Once the ball's ExplosionTime ≠ 0 (goal), the update stops: the arrow freezes in place until the script removes it.
  - **Throb is set by no native or script code** (no "Throb" string in the exe): any flashing comes from the material
    itself (time-driven), being decoded from the shader data (ARW1).
- **One per ball**, its target = the ball's `BallCamTarget_TA`. In **multi-ball**, the ball the camera is locked on
  (`PlayerController.TargettedActor`) has no arrow (TA:20733-20737).
- **When** (`Car_TA.RefreshTargetIndicators` TA:20724-20732): setting on **and ball cam off** (with more than one ball:
  ball cam on or off) **and** `GameEvent.ShouldShowBallIndicator()`. That is true in the ActiveBase states:
  **Countdown, Active, PostGoalScored**. It is false in WaitingForPlayers, PreMatchLobby, **ReplayPlayback**,
  PrePodium/Podium/Finished, but true in the post-game lobby [S].
  - Soccar's ActiveBase override applies to Countdown/Active: the same pattern as `ShouldRecordReplay`, which must be
    true while playing [I, consistent].
  - Re-evaluated on a game-state change, ball cam toggle (`SetUsingSecondaryCamera`), controller/game-event change and
    `SetTargettedActor` (TA:19897-19925, 76755-76778).
  - It is **not** hidden while the ball is on screen (no such check in script; "always points").
  - Demolished: hidden with the car (the car actor is hidden); a respawned car re-creates it.
  - Spectators and other players never see it (owner-only).
- **Free play**: shown (the Active state family) [I].
- **HUD scale / Centre Dot**: unaffected (a world object, not the HUD movie; Interface Scale doesn't apply). Not a
  HUD element, so the Hide HUD option does not apply either [I].
- **Materials, decoded from the compiled shaders (ARW1, 2026-10-14; RefShaderCache of the live snapshot) [A unless marked]:**
  - **Haze** (Clarity_Mat on the r 12 sphere): translucent (dst = rgb·a + dst·(1 − a)), unlit, depth test off, black
    (no emissive), **alpha = (N·V)⁴**. The sphere's normals point inward, so only the far inner surface draws [I]. On
    screen this is a soft black disc of radius 12 uu round the mesh origin (the arrow head's base): **alpha = (1 − ρ²)²**
    for ρ = distance from the centre / disc radius (1, 0.83, 0.56, 0.26, 0.04, 0 at ρ 0, .3, .5, .7, .9, 1; half dark at
    ρ ≈ 0.54). No time term, texture or depth fade.
  - **Arrow** (BallLocatorArrow_Mat): translucent, unlit, depth test off, **neutral grey/white**, not team-coloured.
    - Emissive E on R = G = B (linear HDR): **E = 0.25 + 12·saturate(|fmod(4t − u/4 + 1, 2) − 1| − 0.75)**, from 0.25 up to 3.25.
    - t = game time [I]; u = the mesh texture coordinate, 0 at the tail → 1 at the tip.
    - So **twice a second (0.5 s period) a 125 ms triangle pulse** (62.5 ms up, 62.5 ms down) sweeps tail → tip in 62.5 ms.
      Otherwise it stays at the 0.25 base (75 % of the time).
    - **Opacity = min(4·N·V, 1)·(N·V² + 0.125)**: 0 at grazing (soft edges), 1.125 face-on.
    - Predicted on screen through the stadium tonemapper [I]: about 147/255 at base and 247/255 at the peak (over the haze).
  - **Throb** only drives a vertex "breathing" offset (2·Throb·(|fmod(8t + 1, 2) − 1| − 0.25) along the normal, 4 Hz).
    Its default is 0 and no code sets it (CS1), so the shape never pulses.
  - **Draw order:** the sphere first (index order, material slot 0), then the arrow over it [I, consistent with the user's
    view]. Both draw over everything, after the normal translucent objects.
  - **To confirm with a clip** (offline free play, ball cam off, car and ball 1500–3000 uu apart, 4–6 s at ≥ 60 fps,
    120 preferred, lossless):
    - per-frame brightness of a 3×3 patch on the arrow head: expect a 2.00 Hz flash, 125 ms peaks, R = G = B, and base/peak ≈ 147/247;
    - tail vs tip lag: 62.5 ms;
    - the haze's radial darkening 1 − (1 − ρ²)² against an even bright background, between pulses;
    - no 4 Hz outline breathing.

### HUD-18 Boost meter art, described for our own redraw (static session 2026-10-14)
Measured from the four bitmaps (`BoostMeter_Background`, `_Fill`, `_FillTintablePortion`, `_Glow`; decoded locally,
never shipped) and the movie's layers [A][G]. Our art must be drawn fresh from these numbers; no bitmap or path copies.
Units: stage px, origin = meter centre, the meter 200 px across; angles along the 225° sweep (0° = 6 o'clock, clockwise).
- **Layers, bottom → top:** background disc → glow (clip α 0.5) → orange bar (0–80 %) → white bar (80–100 %) →
  ghost number #333333 → "BOOST" label → number (black glow).
- **Background disc:** black, **α 0.75**, flat to r ≈ 56, then a wide soft edge: α 0.68 at r 66, 0.45 at 78,
  0.22 at 84, 0.07 at 88, 0 by ≈ 92 (half-alpha radius ≈ 77). No noise, scanlines or inner shadow.
- **Guide ring:** a thin grey line (≈ #424242, α 0.82, ≈ 1.7 px) at **r ≈ 61.5**, **only along the 225° sweep** (nothing
  on the empty quarter).
- **Ticks:** 6 radial ticks at 0/45/90/135/180/225° of the sweep (0/20/40/60/80/100 %), same grey, ≈ 1.5 px, from the
  ring out to the bar's outer edge at that angle: r 62–68, 62–72, 63–79, 64–82, 63–89, 62–89. Each has a small node
  (≈ 3 px) on the ring; the ring's two ends finish in a tick.
- **Orange bar (0–80 %):**
  - Shape: **36 bars on a 5° pitch** (bar ≈ 3.3°, transparent gap ≈ 1.7°), radial sides. Inner edge r ≈ 65, outer
    edge **tapering from r ≈ 69 at 0 % to ≈ 87 at 80 %**: a thin-to-thick wedge, the outer edge roughly linear in angle.
  - Colour: flat across each bar's width (no radial shading); **an angular ramp from deep orange (255, 130, 5) at the
    start → (255, 174, 49) around 40 % → (255, 212, 86) near 80 %**.
  - Edges: a soft orange halo (255, 126, 0) outside the outer edge, α ≈ 0.25 → 0.08 over ≈ 5 px. A ≈ 1 px dark-brown
    line (α ≈ 0.4) separates the bars from the ring.
  - Lit ring: along the filled part the ring and its nodes are drawn light cream (≈ (220, 212, 204), α 0.9), i.e. the
    guide line lights up as the bar fills.
- **White bar (80–100 %):** **9 bars on the same 5° pitch**, **full thickness r ≈ 65–88** (no taper), pure white α 1,
  separated by thin dark lines (not transparent gaps), with a thin dark edge (black α ≈ 0.2) instead of an orange halo.
  The bars look slightly skewed in the art. At runtime this layer is recoloured: the team tint in team mode, or
  BOOST_MAX (HUD-7).
- **Glow:** a round soft blob centred on the meter: α 1 at the centre, 0.5 at r ≈ 48, 0.25 at 59, 0.09 at 70, 0 by ≈ 76
  (Gaussian-like). Its base is black and the colour comes entirely from the additive tint (team colour, or amber/red
  in non-team mode); the clip α is 0.5 at ≤ 80 % and 1 at > 80 % (HUD-7).
- **Number and label:** $NumbersWideFont 54 (box 120×58 at (−58, −28)), #666666 + tint (white above 80 %), black glow
  blur 6 (8 above 80 %); a duplicate #333333 at the same spot behind it (a ghost). "BOOST" in $HeaderFont 16, #666666 +
  tint, centred 16 px below the meter centre, blinking above 80 % (HUD-7).
- **3D:** rotationY 15°, rotationX −2°; the bars and the number at z −20; perspective focal 500 with the vanishing point
  at (x − 50, y − 100) (HT-11).
- **Pickup flash** (HUD-6): both bars go white and ease back over 0.8 s; the glow scales 2 → 1.

### HUD-19 Flip reset indicator (Gameplay "Flip Reset Indicator"; static session 2026-10-14)
The game draws **no text**: it plays a particle effect under the car, a sound and a rumble.
- **Trigger** [S]: `Car_TA.UpdateDodgeAvailable` (authority). When the dodges become refreshed while the wheels touch
  an RBActor (the ball), `++DodgesRefreshedCounter` + ForceNetUpdate → `EventPerformedFlipReset` (TA:101283-101311).
  Clients get it through the replicated counter (`OnDodgeCounterReplicated`).
- **Who sees and hears it** [S] (`FXActor_FlipReset_TA.PlayFlipResetFx`, TA:100435-100445): only the car's own player
  (locally controlled), spectators, or replays. Other players in the match get nothing.
- **Setting** `GameplaySettingsSave_TA.FlipResetFxPref` (EFlipResetFxPref): 0 Off, 1 AudioOnly, 2 VisualOnly,
  3 Enabled (default On) [A]:
  - Off: nothing;
  - AudioOnly / Enabled: sound `SFX_Car_Movements.Car_Movement_FlipReset` on the car;
  - VisualOnly / Enabled: the particle effect;
  - any mode but Off, local car only: `FlipResetShake`, which is **rumble only** (FlipReset_FF: 30/60 then 60/30 for
    0.075 s each; no camera shake) → nothing in the clone (no rumble).
- **Visual** [A][S]: particle system `FX_FlipReset.FlipReset_P`, created once and **attached to the car** (follows it),
  restarted (SetActive false → true) at every reset.
  - TranslationOffset **(0, 0, −12)** in the car's frame (12 uu below the car's origin, archetype
    `Archetypes.Car.Car_Default.FlipResetFXActorArchetype`).
  - RotationOffset **pitch 16384 (90°)** (class default, not overridden).
  - SetDrawScale(car DrawScale) on the FX actor.
  - **Decoded (FR1, 2026-10-14):** `FX_FlipReset.FlipReset_P` is a forced export inside TAGame.upk (export 95088), with
    materials `M_FlipReset_Circle` / `_Gradient` / `_Mesh`, the mesh `SM_FlipReset_Dome` and 4 emitters. Material formulas
    come from the compiled shaders (live RefShaderCache); textures and mesh data stay local in `out/bsim/agents/FR1/work/`.
  - **All emitters** [A]: local space (they **follow and rotate with the car**, sparks in flight too); bursts only;
    lifetime U(0.15, 0.20) s; one colour, linear (0.574, 0.594, 0.996) × 3 (HDR) ≈ pale periwinkle #C8CBFF blooming
    near-white, alpha 1, **no fade** (particles vanish at the end of life); unlit.
  - **Orientation** [I, UE semantics, consistent across emitters]: the 90° pitch puts the effect's local X along the
    **car's up axis**, so the flat parts lie **parallel to the car's floor**, about 5 uu above the wheel contact plane,
    and tilt with the car (on the wheel side even when upside down on the ball).
  - **Glow disc** (additive sprite, axis-locked to that plane): 150 uu across, intensity (1 − r)⁴ (half at ≈ 12 uu radius,
    6 % at 37, ~0 beyond 55): a tight bright core.
  - **Ring** (additive sprite, same plane): a thin bright line ≈ 1.5 uu wide at ≈ 37 uu radius, sharp outer edge ≈ 38,
    soft glow inward to ≈ 30, empty centre; peak ≈ 0.34 × the colour.
  - **Dome** (alpha-blended mesh): a very shallow cap 145 uu across, 16 uu deep at full size, bulging toward the car's
    roof, rim toward the wheels/ball (rim ≈ 26.6 uu below the car origin, top ≈ 10.3). Opacity (1 − V)⁵, so a **bright
    blue band ≈ 10 uu wide at the rim** with an invisible centre; visible from both sides.
  - **Sparks** (additive velocity-aligned streaks): 25 at t = 0.05 s, from a 20 uu radius ring round the up axis
    (±5 uu), flying out at 240 uu/s in the plane and 50–100 uu/s toward the wheel side (12–23° below); 2–3 × 20–30 uu,
    shrinking to 0.4–0.6 × 2–3; ending at a radius ≈ 56–68 uu.
  - **Timing:** at t = 0 the glow, ring and dome appear at 10 % size and **grow linearly to 100 %** over their
    0.15–0.20 s life (ring radius 3.7 → 37 uu, dome 7.3 → 72.6 uu), then vanish; the sparks are gone by 0.20–0.25 s.
    **Visible ≈ 0.2–0.25 s in total.** A new reset kills and restarts it.
  - Open [I]: the axis-lock / mesh-rotation semantics; UE3's default camera near/far fades (10/150 and 2000/2100 uu) may or
    may not apply; the draw order among the four. A screenshot of a live flip reset would settle the plane.

### Open
- **Nameplate scale combination** (product assumed), the distance's origin and the billboard rotation: native
  `execTickNameplate` 0x140e78d40, not decompiled. Or measure from a screenshot series.
- **Nameplate texture aspect** on the 8:1 plane (RTT scale mode and material UVs): a screenshot.
- **GetUIKey fallback** for tokens without a Keys.int entry (assumed: the token itself): the tail of the function does
  not decode.
- **Default pause-menu button class** (`NewModalMenuButton` assumed; the decompiler drops default arguments).
- **Clearance:** GoalScored is cleared. The pause messages (`GamePaused` / `GameUnPaused`) are not; HUD-10 now cites
  the key only (2026-10-14).

## Open
- **Native parts:** the default SafeZone (GetDefaultSafeZone); how the nameplate distance and FOV curves combine;
  LinearColorToColor sRGB vs linear (assumed linear ×255, which matches the AS3 fallbacks).
- **Seconds countdown:** the "10…1" messages are broadcast only by the authority; whether clients see them centre-
  screen needs a live check.
- **Not traced:** the 0.2 s boost tween's ease (assumed Quad.easeOut); the end of a stat popup.
- **Not covered:** play-menu tile layout and garage geometry (the movies are parsed in dump/ if needed).

## HUD-21 Stat graphs (Interface "Stat Graphs"; static session SG1, 2026-10-16)

**Not Scaleform:** a native UE3 Canvas overlay (`StatGraphDrawer_TA`, no script functions). Script sets only titles, summaries,
good/bad thresholds and Y ranges; layout, colours, font, number formatting and the draw hook are native [N] (drawer vtable
0x141e98d28, ctor 0x140f10f40; StatGraph_TA vtable 0x141e98080; StatGraphSystem_TA 0x141e98f98; Perf 0x141e98818, Net
0x141e98590, RBActor 0x141e98aa0; SampleHistory_TA execAddSample 0x140e725d0, execTick 0x140e726b0, GetSummaryValue 0x140e72390).
TA = out/bsim/work/tagame_live_all.txt.

**Model** [S][A]: `StatGraphSystem_TA` (always created on clients, TA:27502-27506) holds groups of `SampleHistory_TA` rows; each
group records at **60 samples/s, 10 s deep** (600 slots), each slot a Low/High envelope of the samples in its 1/60 s [I].
Summaries `AddSummary(Type, MaxSampleAge, bAbs)`: 0 Latest, 1 Avg, 2 Min, 3 Max, 4 Sum (age 0 = the whole window [I]). **Fixed
Y ranges** (`SetGraphMaxMin`), changed only by TargetFPS, MaxBytesRate or the Metric setting. GoodValue > BadValue means higher
is better [I]. `SetGraphLevel` (TA:93737): the Summary levels (1/4/7) have window 0 (text only [I]); "short" (2/5/8) 5 s;
"long" (3/6/9) 10 s. Groups per level: 1–3 Perf; 4–6 Net then InputBuffer; 7–9 Speed. Console execs `StatGraphNext`,
`Graphtime <s>`. Layers Background, Text, Graph; drawer fields imply one row per history = title | coloured summaries | graph
with a grid, each sample a vertical Low→High line coloured by threshold [I].

| Group | Row (English script literal) | Summaries | Good / Bad | Y range |
|---|---|---|---|---|
| Perf | FPS | Avg (1 s), Min (whole window) | ≥ TargetFPS − 1 / ≤ 0.8·TargetFPS | 0..TargetFPS |
| Perf | Frame, Game, Render, GPU | Avg (1 s), Max (whole window) | ≤ 1000/(TargetFPS − 1) ms / ≥ 1.5× that | 0..50 ms |
| Net | Out Pkt, In Pkt | Latest, Max, Min | 3 / 6 | −5..5 about BaseValue = the expected packet rate |
| Net | Out Loss, In Loss | Latest, Max | 1 / 3 | 0..5 lost packets per second (a count, SG2) |
| Net | Out Bytes, In Bytes | Latest, Max | 0.75 / 0.9 × MaxBytesRate | 0..MaxBytesRate |
| Net | Latency | Avg (1 s), Max, Min | 75 / 120 | 0..200 ms |
| IBuf | IBuf | Min (1 s), Max, Min | 2 / 0.01 (higher better) | 0..20 frames |
| IBuf | IBuf Target | Latest, Max | 4 / 12 | 0..20 |
| IBuf | IBuf Miss | Sum of \|x\| over the window, Max, Min | 0 / 1 | −5..5 |
| IBuf | Phys Rate | Latest | 121.18 / 999 | 118.92..121.08 Hz (120·(1 ± 0.009)) |
| Speed | Car Speed, Car Speed (XY), Car Speed (Z), Ball Speed, Ball Speed (XY), Ball Speed (Z) | Latest | car 2200 / 2290 uu/s; ball 4000 / 5500 | car 0..2300; ball 0..6000 uu/s |

- Latency sample = `NetworkInputBuffer_TA.UpdatePing` raw RTT: RealTime − echoed send TimeStamp − (RealDeltaSeconds + 0.016)/2,
  clamped ≥ 0 (TA:71056-71066), not the PRI ping EMA. IBuf rows come from the server's InputBufferStats in every
  ClientAckFrame (Low/High queue length since the last ack, Over/Under frames, Target) (TA:71036-71047) [S].
- Speed: the viewed car (`GetViewedCar`) and the last ball, VSize, VSize2D, |v.z|; nothing sampled without a GameEvent (menus);
  units by the Interface Metric setting (×0.036 km/h, ×0.0223694 mph; ranges scale) [S][A].
- **Setting:** Interface "Stat Graphs", help "Toggle the display of stat graphs.", options None · Performance Summary ·
  Performance Graph (short) · … · Speed Graph (long), default None; one level at a time; stored locally
  (GameplaySettingsSave_TA.StatGraphLevel); shown when UIConfig_TA.bShowStatGraphOptions (True) or a level is on. **F10 "Toggle
  Stat Graphs"** (StatGraphNext, not remappable) cycles 0→9→0 without saving. Hide In-Game HUD has no script link to it [I:
  stays visible]. Row titles are hard-coded English literals (not localized); **the user cleared them for verbatim use (2026-10-16)**, and chose to include Out Loss and IBuf Miss (a protocol bump is OK).
- **Native draw (SG2, 2026-10-16) [N]:** UGameViewportClient::Draw 0x14081bbc0 → DrawStatsHUD 0x1406ae2b0 → GEngine (0x1424aa238)+0x90
  EngineShare_TA vtable[90] 0x140ee1510: every frame it ticks all StatGraphs (vt+0x278), then if a level is set draws layer 0
  background, 1 text and 2 graph (graph only when the window > 0) via 0x140ee11d0 → StatGraph vt+0x280 0x140ee0bc0 → a
  StatGraphDrawer_TA per history (Init 0x140f08d50, Draw 0x140ee0800). **No HUD, cinematic, pause, menu, replay or GFx gates:**
  drawn in menus, paused, replays, podium and with Hide HUD on, over the UI [I]; sampled every rendered frame for all graphs.
- **Layout [N]:** s = min(H·16/9/1600·UIScaleModifier, 1.8); YScale = max(s, 1); XScale = max(aspect·s, 1) (aspect = W/(H·16/9);
  ultrawide stretches text); inset = (1 − SafeZone)·H/2; anchored **top-right**: X = right edge − inset·aspect, first row at
  16·YScale + inset. Font GEngine.MediumFont = EngineFonts.SmallFont (a 16-px Arial bitmap) [A]; W = width("W") = 13 px. From the
  right: values 6W (left-aligned `" %3.2f"`, **no units, 2 decimals, every row**), labels 9W (right-aligned: the title in white for
  line 0, then "Latest"/"Avg"/"Min"/"Max"/"Sum" in (192, 192, 192)), then the graph N px wide (N = 60·window: 300 or 600, one px
  per sample at scale 1). Line L = 16·YScale; graph height = n·L (n = summaries); row pitch (n + 1)·L (a blank line between rows;
  Net and IBuf groups continue). Background per row: black α 0.333 tile over graph + columns (15W wide on summary levels).
  At 1280×720: L 16, W 13, label 117, value 78, graph 300/600, cell 60, first row 16, X 1280; a 16:9 screen of 900–1620 px
  tall is a constant ×0.8 in 720-stage units.
- **Graph [N]:** opaque black 1-px grid (verticals every 1 s, 5 horizontal cells); a 1-px polyline, newest at the right, of the
  worse side of each slot's envelope (High if lower-is-better, else Low), clamped to the range; colours on d = |v − Base|:
  good (64, 255, 64), mid (255, 255, 64), bad (255, 64, 64) (lower-better: green d ≤ Good, yellow d < Bad, else red;
  higher-better: green d ≥ Good, yellow d > Bad, else red); text values use the same rule. Init back-fills history mirrored for
  one window after a level change or resize (a quirk; don't copy).
- **Sources [N]:** TargetFPS = Engine.MaxSmoothedFrameRate (the Max FPS setting; Uncapped 10000). FPS = 1000/raw frame ms;
  Frame/Game/Render/GPU = raw unit-stat ms (DrawUnitStats 0x1406aec30). Net rows = raw counts per 1-s StatPeriod from the
  primary UNetConnection (packets, **lost packets — a count, not %** — and bytes), fed at 0x140bada29; expected out/in rate =
  ConfiguredClientInputRate / ConfiguredReplicationRate; MaxBytesRate = ConfiguredInternetSpeed (High 60 / 60 / 15000 B/s);
  offline the Net and IBuf rows sample 0. Latency = PacketReceived × 1000 ms. Summaries (GetSummaryValue 0x140f00060): Latest =
  the newest slot's midpoint, Avg = ΣHigh/count, Sum = ΣHigh, Min = min Low, Max = max High; text age = the summary's age if
  within the window, else the window (summary levels: the whole 10 s). Sampling clock real time, dt ≤ 0.05 s; a slot repeats
  the last pending value when nothing arrives.
