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
| HUD-2 | Scoreboard | [G HudMatchInfo matchInfoView] at x = W/2, y = 0. Relative to its top centre:<br>• **Clock box:** black notched MatchTimer_Background at x −90…90, y −18…72.<br>• **Clock text:** $NumbersWideFont 31, white, letterSpacing 2, in x −65…65, y 10…46.<br>• **Score digits:** $NumbersWideFont 48 in the team text colour, glow #999999 blur 8, plus a duplicate at α 0.4. Left box x −136…−66, y 2…54; right mirrored at 68…138.<br>• **Score backgrounds:** dark rounded 90×90 TeamScoreView_Background (x −157…−67, y −17…73), additive team tint.<br>• **Caption:** match type (ranked/series), white pill, $HeaderFont 18 black, y 34.<br>• **3D:** rotationX 5, score views rotationY ±10, perspective focal 100 centred at (W/2, 80).<br>**Your own team is always on the left** (Team 1 swaps the views) | `index.html:14-18`, `style.css:54-90`: blue always left, solid pills, system font | Dark boxes with additive team tint and near-white digits; local team on the left; black clock box |
| HUD-3 | Clock and overtime | TimeRemaining = SecondsRemaining (int(t) + 1, notes/visual-timing.md VT-23) [S]. Format M:SS with unpadded minutes; "0:00" when ≥ 5000 (unlimited); "+" in overtime [G]. Overtime not yet active: the clock slot shows **"OVERTIME"** ($HeaderFont 32, two lines, leading −6, shrinks to fit); on Active it fades out (0.2 s) and "+M:SS" fades in (0.3 s) [G] | `matchClock.ts:7-11` ceil/floor; `:16` shows OVERTIME as a centre message | int(t) + 1; "OVERTIME" in the clock slot |
| HUD-4 | Scoreboard animation and visibility | **Intro** (1 s delay): y −20 → 0 over 1 s Back.easeOut; alpha 0 → 1 and rotationX 75 → 5 over 0.6 s Strong.easeOut; score views rotationY ±60 → ±10 over 0.6 s Strong.easeIn.<br>**Goal:** the scorer's additive TeamScoreView_Glow jumps to α 1, then fades over 0.6 s Power1.easeIn.<br>**Hidden** in WaitingForPlayers, PostGame, PrePodium/Podium, Finished, training and tutorial, and by HideHUD. **Visible during the replay** [G] | text only | The glow flash on a score change; the intro |
| HUD-5 | Boost meter: geometry | [G boostMeterView] bottom-right anchored, **centre at (W − 110, H − 110)**.<br>• Background disc 200×200 (thin grey ring with ticks); glow 180×180 at α 0.5.<br>• **Fill:** orange segments **clockwise from 6 o'clock to 12 o'clock** (0–80 %), then a separately tinted white segment **12 to 1:30** (80–100 %). **Total sweep 225°**; a 101-frame mask reveals 2.25° per frame.<br>• **Number:** $NumbersWideFont 54 in a 120×58 box at (−58, −28), black glow 6, #333333 duplicate behind; "BOOST" ($HeaderFont 16) at y + 16.<br>• **3D:** rotationY 15, rotationX −2, fills and number at z −20, FOV 120 | `index.html:35-41`, `style.css:189-223`: 140 px, 360° from 12 o'clock, 32 px from the edges | A 225° arc from 6 o'clock clockwise, about 200/720 of the screen height, centred 110 virtual px from the right and bottom; the last 45° tinted separately |
| HUD-6 | Boost meter: value and animation | Value = floor(pct·100) clamped 1–100 when > 0 (VT-21), sent only on change [S]. The shown integer tweens over 0.2 s (Quad.easeOut [I]). **Arc** = gotoAndStop(int(b·1.01)), i.e. **2.25°·(b − 1)** for b 1–99 (empty at 0 and 1), 225° at 100. **On an increase:** both fills flash white back to normal over 0.8 s Strong.easeOut; the glow scales 2 → 1 over 0.8 s [G] | `hud.ts:145-147`: round, instant, linear over 360° | floor with minimum 1, the 0.2 s number tween, the b − 1 arc, the pickup flash |
| HUD-7 | Boost meter: colour states | The "max" state is **> 80**, not 100 [G].<br>**Team-coloured meter** (setting, default on): number, glow, label and tinted segment get the additive team tint. ≤ 80: number #666666 + tint, glow α 0.5. > 80: number white, glow α 1, black text glow 8, "BOOST" blinks (α 0 ↔ 1 every 0.2 s).<br>**Non-team meter:** number orange (BOOST_NORMAL (1, .38, .51 + 255, 127, 0)), > 80 BOOST_MAX (0, .6, .49 + 255, 64, 64); glow amber (255, 147, 67)·0.25, or red (255, 64, 64)·0.75 > 80; disc × (1, .43, 0) | single colour #ffb02e | Both modes and the > 80 state |
| HUD-8 | Kickoff countdown | Timing (VT-24): "3", "2", "1" at 1/2/3 s and "GO!" at 4 s, each with its sound [S/A]. Display [G GameMessageView at (W/2, 250)]: $HeaderThinFont **72**, #FFED83, orange glow #FF7F00 blur 10, uppercase, shrinks to fit. Each message pops from scale 1.4 → 1 with a white additive flash fading over **0.6 s Strong.easeOut**; it fades out (0.3 s) **4 s** after the last message, or at once on an empty message | beeps only (`online.ts:282-285`) | Digits and GO! with the pop (GO! stays about 4 s) |
| HUD-9 | Goal banner, stat popups | **Goal:** "{Player} scored!" (or the team name) in the HUD-8 style [A GoalScoredMessage].<br>**Stat popup** [G StatEventView at (W/2, 150); 80 frames = 2.667 s; one at a time]:<br>• icon fades in by 0.13 s, then grows 2 → 5.6× with a 4 px blur to α 0.5 (0.4–0.8 s);<br>• name ($HeaderFont 32, white, orange glow) rises in (0.4–0.6 s);<br>• "+N" ($HeaderFont 22, #FFED83) pops from 3× with a white flash in 0.23 s;<br>• all float up and fade 2.17–2.63 s.<br>Shown per StatEventDisplayLevel (default Primary) | "BLUE SCORES!" for 2 s (`online.ts:49,443`, `freeplay.ts:157`) | "PLAYER SCORED!" for 4 s; optional "GOAL +100" popup |
| HUD-10 | Other messages | HUD-8 style [S/A]: "Overtime!"; "One Minute Remaining!" (61 → 60); "30 Seconds Remaining!"; **"10" … "1"** each second while 0 < SecondsRemaining ≤ 10 (EndCounter sound); the pause message (by key `[Messages] GamePaused` / `GameUnPaused`; not cleared verbatim). A message shows if HUDMessageThreshold ≤ its level; the "Match Notifications" setting is All (default) / Game updates / Kickoff only | none | Add them, with the filter |
| HUD-11 | Replay banner | [G ScoreReplayView, ReplayPlayback]:<br>• **Letterbox:** black slanted bars α 0.6 at the top (y 0–90) and bottom (y 630–720), about 79 px tall at the edges and 30 in the middle.<br>• **REPLAY:** bottom-left at (26, H − 30): a 32 px red dot pulsing (α 1 → 0 by 0.33 s, back by 0.5 s); "REPLAY" $HeaderFont 32, #FF7752, glow #FF4343 8.<br>• **Info** at (W/2, H − 169): "SCORED BY" ($HeaderFont 14, #98DAFF, glow #016BF7), the scorer's banner and team glow (1 s), then assist, goal time M:SS and speed (round(ReplaySpeed·0.036) KPH, or MPH) in $HeaderFont 18, staggered 0.25 s with 0.3 s fade-and-slide.<br>• **Prompts** bottom-right: "PRESS {key} TO SKIP" ($HeaderFont 16) and the not-ready players ($HeaderThinFont 24, #FF4343) | centre "REPLAY" + hint (`online.ts:625`). **Bug:** `index.html:20` and `:49` both use `id="hint"` (verified); `style.css:242` overrides `:104`, so the replay hint renders top-right | Letterbox bars, blinking label, scorer/speed panel; fix the duplicate id |
| HUD-12 | Ball-cam indicator | [G BallCamIndicatorView at (50, 672 + ΔH)]: the same red dot; "BALL CAM" $HeaderFont 32, #FF7752, red glow; "PRESS {key} TO TOGGLE" ($HeaderFont 16, empty in hold mode) at y + 12. Shows by sliding +20 px with α 0 → 1 over 0.2 s; hides over 0.3 s. Shown when ball cam is on, the indicator setting is on (default) and HUD-16 holds | debug bar text (`hud.ts:154`) | Bottom-left indicator |
| HUD-13 | Nameplates | **Placement** [A]: a plane 60 uu above the car, Scale3D (1, 2, 1), DistanceScaleCurve 0 → 0.5 and 10000 → 9, FOVScaleCurve 0 → 0.1 and 90 → 1, × NameplateScale (0.5–2); never shown to the car's owner.<br>**Content** [G]: a 9-slice background with additive team tint, width = text + 32 clamped 100–264; the name in $SmallBoldFont 16 uppercase, team text colour; **"YOU"** for the local player.<br>**Modes** [S]: Default (always the full plate); Distance Fade (beyond **7000 uu** only an arrow); Simplified (arrow only); changes animate 0.3 s | none | Billboards with these rules |
| HUD-14 | Stat/kill feed | [G StatTickerView, top-right (W − 10, 10)]: rows 36 px apart, ≤ 6, each lives **4 s**, fade and slide 0.2 s. Row: receiver name pill, orange event icon, victim name | none | Optional (demolitions, goals) |
| HUD-15 | Chat | [G]: log at (10, 10), $SmallFont 18 white, 350×185, input ≤ 120 characters; fades in 0.3 s, hides **6 s** after the last message | none | Later |
| HUD-16 | Visibility rule | [G HudScreen.validateShownUIElements]: the boost meter and ball-cam indicator need: the local car's camera view (own car or ball cam; not replay or spectating); state ≠ Finished; the HUD on top (no menu); not replacing a bot; and, for the boost meter, not WaitingForPlayers | always visible | Hide the boost meter in replays, menus and after the match |

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
