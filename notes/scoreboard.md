# Held scoreboard, block/mute, stat icons, Scoreboard settings, replay counters: spec (static session, SB1, 2026-10-11)

Live build 2026-10-06 only (snapshot `rocketleague-20261006`). Extends notes/match-stats.md (STAT-17, §5.2, §5.4, §6),
notes/hud-menus.md (HUD-1/2/9/14, MENU-5) and notes/quick-chat.md §4.5 (CHAT-19); does not repeat them.

**Text.** Column headers and stat names are verbatim (stat text). Mute / Unmute, Block / Unblock and their direct
confirmations are verbatim by user decision (2026-10-11). Report and its sub-entries are by key only and are **not
implemented** (no report system). Everything else is by key; its English is in the local file
`out/bsim/agents/SB1/local_strings.txt`.

**Tags.** [A] package data (archetypes, defaults, localization, ini); [S] UnrealScript; [M] movie / AS3; [N] native
(none needed); [I] inferred.

**Citations.**
- `HUD:<line>` = `out/bsim/agents/HUD1/dec_as3/GFX_Hud.HUD.all.txt`; `MGM:` = `.../GFX_MidGameMenu.MidgameMenu.all.txt`;
  `SET:` = `.../GFX_SettingsMenu.SettingsMenu.all.txt`; `LIB:` = `.../GFX_Shared_CodeLibrary.CodeLibrary.all.txt`.
- `PIM:<line>` = `out/bsim/agents/SB1/dec_as3/GFX_PlayerInteractionMenu.PlayerInteractionMenu.all.txt` (this agent's
  decrypt + HUD1's parsers).
- `SC-tree:` / `SC-chars:` / `SC-anim:` = `out/bsim/agents/HUD1/dump/gfx_shared.SharedComponents.{tree,chars,anim}.txt`.
  The scoreboard symbols live in SharedComponents (`Startup.upk`); the HUD's `MidGameScoreboardViewMovie` links them.
- `TA:<line>` = `out/bsim/work/tagame_live_all.txt`. `m#` = AS3 method index.

**Local files** (git-ignored), in out/bsim/agents/SB1/:
- `local_strings.txt`: English for every key below.
- `dec/`, `swf/`, `dec_as3/`, `dump/`: the PlayerInteractionMenu and PlayerReportMenu movies.
- `img/`: scoreboard textures (strip, shadow, glows, MVP badge, ping bars, avatar frames).
- `scoreboard_defaults.txt`: `Default__CustomScoreboardConfig_TA` and `Default__ProfileScoreboardSave_TA`.
- `pri_dump/`: a boxcars 0.12 tool; `pri_updates.csv` and `pri_summary.txt` (contain player names and IDs).
- `py/layout.py`: the layout calculator behind SB-5.
- Icons: `out/bsim/assets_local/stat_icons/*.png` (32 icons, 128×128, dev reference only).

## Summary
| # | Item | Game | Conf. |
|---|---|---|---|
| SB-1 | Stage | Virtual stage 1120×720, re-anchored to the content stage W×H (HUD-1). The scoreboard view is centred by code: x = (W − w)/2, y = (H − h)/2 | [M] |
| SB-2 | Structure | One dark backdrop; **blue (team 0) always on top, orange (team 1) below**, never swapped for the local team (unlike HUD-2) | [M] |
| SB-3 | Team header line | Team score, team name, five column headers and PING on one line; additive team glow behind it | [M] |
| SB-4 | Rows | 38 px pitch; a solid team-colour strip; avatar, name, MVP slot, five values, ping | [M] |
| SB-5 | Screen layout | Computed per team size (table) | [M][I] |
| SB-6 | Colours, fonts, alignment | Values centred; local player white, others pale team colour | [M] |
| SB-7 | Ping | min(ping, 999), four bars and the number, colour bands 100/200/250 | [M][S] |
| SB-8 | Who is listed | Only present players, sorted; no empty slots; disconnected players kept at α 0.4 in public matches | [M][S] |
| SB-9 | Columns | SCORE + 4 per-mode columns from the viewer's settings; **default Goals, Assists, Saves, Shots, also in 1v1** | [S][A] |
| SB-10 | Show/hide | Hold Tab / gamepad LB; fade in 0.2 s; at least 0.35 s; not in podium, end, lobby, training | [S][A][M] |
| SB-11 | MVP icon | Slams in 1.75 s after the MVP is set | [M] |
| SB-12 | Block | Not on the scoreboard: pause menu → player list → Block / Unblock | [M][S] |
| SB-13 | Mute | **No in-match Mute UI in the live build**; Mute / Unmute exist only for voice-chat members in the friends panel | [M][S] |
| SB-14 | Feedback | No chat-log line; a toast confirmation; later chat from a blocked player is dropped | [S] |
| SB-15 | Icon rendering | White glyph with a soft black halo; the HUD tints the halo orange | [M][A] |
| SB-16 | Icon shapes | Shape descriptions for drawing our own vector icons | [A] |
| SB-17 | Scoreboard settings | One group per mode × 4 column dropdowns; reset to defaults | [S][M][A] |
| SB-18 | Replays | Carry MatchScore/Goals/Assists/Saves/Shots, Score, Car/SelfDemolitions, Ping; not MatchDemolishes or BallTouches | [A] |

## 1. Geometry (virtual px)

### SB-1 Stage and placement [M]
- **Container.** `MidGameScoreboardViewManager` (HUD:839) adds the HUD's `MidGameScoreboardViewMovie` (HUD #101), which
  holds the shared `ScoreboardViewMovie` (SC-tree:512) and a server-name line.
- **Position** (`MidGameScoreboardView.handleStageResized` / `handleScoreboardChanged`, m#9377–9378, HUD:55617):
  - x = (W − w)/2, where w = `team0View.width`. With private-match mutators listed: x = min(that, W − w − 250).
  - y = (H − h)/2, where h = `tfSpectators.y + textHeight` = background height − 120 (+ one line with spectators).
  - It recentres whenever the layout changes.
- **Width caveat** [I]. w is the team panel's bounds:
  - 879.6 if hidden children count (Flash semantics: the invisible ranked-MMR label reaches x −182.5);
  - 832.7 if they do not.
  - The visible panel is centred at view x ≈ 405, so it sits **≈ 35 px (or 11 px) left of W/2**. A screenshot settles
    which one.
- **Server line:** top-left (12, 10) of the screen, $HeaderFont 16 white, black glow 6. Shown only online with a server
  name (key `Server`). Optional.

### SB-2 Panel structure (ScoreboardView coordinates, origin = view x, y) [M SC-tree:512–640, `reflowLayout` m#9560]
- **Backdrop** (`Scoreboard_Background_Scale9`): x −70…880 (950 wide), y −35…(−35 + Hb).
  - Hb = team1.y + H1 + 90.
  - Look: dark navy (0, 13, 24), centre α ≈ 0.46–0.48.
  - Soft edges, from its 9-slice: a 150 px fade on the left and right, about 95 px at the top, and a long ~210 px fade
    at the bottom.
- **Team order.** `team0View` (blue) at (62, 22); `team1View` (orange) at y = 22 + H0 − 20.
  - Hn = max(105, 72.5 + 42·n) for n rows.
  - `sortTeams` (winner on top) is used only by the end-of-match screen (MIO-27).
- **Seam glows** (`Scoreboard_TeamBackgroundGlow`, per team, normal blend, solid team colour):
  - x 0…800, height = that team's Hn; alpha ≤ 0.37.
  - Horizontal profile: a bell, peak at x 400.
  - Vertical profile: rises toward the seam between the two panels and fades away from it.
  - Top team: ends at its panel bottom − 15. Bottom team: starts at its panel top + 10, mirrored.
- **Team-name glow** (`Glow_ThreeQuartersFade`, **additive** blend, team colour, clip α 0.5): in team coordinates x −136…464,
  y −12…48. It peaks (α ≈ 0.65 × 0.5) at x ≈ 14, y 18 and fades to the right.
- **Other children** (skip in the clone):
  - title (ranked/tournament caption, $HeaderThinFont 48, keys `Competitive`, `Solo`);
  - spectators line (y = Hb − 120, $HeaderFont 18 #CCCCCC, key `Spectating`);
  - winner stamp (end screen only, MIO-27);
  - team logo and verified icon (clubs);
  - team rank icons (season).

### SB-3 Team header line (team coordinates; team origin = view (62, team.y)) [M SC-tree:536–572, m#9918–9927]
| Element | Box | Font | Colour / notes |
|---|---|---|---|
| Team score | x −20…30, y 0…44 | $NumbersWideFont 36, centred, shrink | white + additive team tint (stays white); glow #444444 blur 16 ×2. Shown when the mode splits by teams (Soccar: yes) |
| Team name | x 30…290, y 0…40.5 | $HeaderThinFont 36, left, vertical centre, shrink | upper-cased team name; white + additive tint; glow #999999 blur 8 |
| Column headers | SCORE x 293–359, then +69 each: 362–428, 431–497, 500–566, 569–635; y 2…37 | $SmallBoldFont 11, centred, **bottom-aligned**, multiline (long labels wrap) | white α 0.8 |
| PING header | x 638–693, y 2…37 | $SmallBoldFont 11, **left**, bottom-aligned | white α 0.8 |

**Header text:**
- The first column is `Localize('Scoreboard', 'MatchScore')`; the custom columns are `Localize('Scoreboard', 'CSStat_<Stat>')`
  (TAGame.int `[Scoreboard]`), set by `GFxHUD_TA.UpdateScoreboardStatNames` (TA:61136). PING is AS3 LOCTEXT `Ping`.
- Verbatim (stat text): **SCORE, GOALS, ASSISTS, SAVES, SHOTS, PING**.
- The other selectable columns (SB-17): EPIC SAVES, CENTERS, CLEARS, AERIAL HITS, BICYCLE HITS, JUGGLES, DEMOS,
  FIRST TOUCHES, POOL SHOTS, LOW FIVES, HIGH FIVES, FLIP RESETS, DAMAGE, BALL HITS, BOOMS (times demolished), DODGES,
  CROSSBAR HITS, CAR BUMPS, BOOST PICKUPS, POWERUPS USED.

**Team name** [S TA:104533]:
- By default `[Team_TA] TeamName0/1`, upper-cased.
- With custom team colours: UIText `[Global] Home/Away`.
- A playlist's team names override both.
- **The team's goal count shows** in the team-score box.

### SB-4 Row (renderer `ScoreboardRenderer`, SC-chars:842; row origin in team coordinates = (−8, 33 + 38·i)) [M m#8506–8542]
| Element | Row-local box | Notes |
|---|---|---|
| Strip | x 0…705; texture 50 tall, visible core y ≈ 9…41 (≈ 32 px), soft 2–3 px top/bottom, rounded ends | **solid team colour** (`getColorTransformFromHex` with no mode sets offsets = colour, multipliers 0, HUD:2784); α ≈ 0.88 at the left fading to ≈ 0.79 at the right end |
| Avatar | frame drawn ≈ x 8…42, y 8…42 (50×50 clip) | frame: **white ("personal") for the local player**, dark + additive team tint for others. Content: platform avatar, or a team-tinted default silhouette, or an "AI" glyph for bots |
| Name | x 46…276 (width = MVP x − name x − 15 = 230), y 13…38 when there is no title | $HeaderFont 20, left, vertical centre, shrink; `[CLUBTAG] ` prefix in the club colour. With a player title the name moves up to y 6…30 and the title ($SmallBoldFont 11) sits below (skip) |
| MVP | centre (291, 24) | SB-11 |
| Values 1–5 | x 304–364, 373–433, 442–502, 511–571, 580–640; y 13…38 | $HeaderFont 20, **centred**, vertical centre, shrink. Centres line up with the header centres (team x 326, 395, 464, 533, 602) |
| Ping | label at (645, 13): bars 0…20 × 1…21; number x 17…47 | SB-7 |
| Ready check, MMR, party, speaking, viral border | – | end screen, ranked, parties, voice: skip |

### SB-5 Computed screen layout, W×H = 1280×720, w = 879.6 [M formulas; I for w]
| Teams | View origin | Backdrop (screen) | Blue header y / rows y | Orange header y / rows y |
|---|---|---|---|---|
| 1v1 | (200.2, 259.5) | x 130–1080, y 224.5–545.5 | 281.5 / 314.5 | 376 / 409 |
| 2v2 | (200.2, 217.5) | y 182.5–587.5 | 239.5 / 272.5, 310.5 | 376 / 409, 447 |
| 3v3 | (200.2, 175.5) | y 140.5–629.5 | 197.5 / 230.5, 268.5, 306.5 | 376 / 409, 447, 485 |
| 4v4 | (200.2, 133.5) | y 98.5–671.5 | 155.5 / 188.5 … 302.5 | 376 / 409 … 523 |

- Row y is the top of the row clip; the strip core is +9…+41.
- With equal team sizes the orange header always lands at H/2 + 16.

## 2. Fonts, colours, alignment

### SB-6 [M m#8537, m#9919; A HUD-1]
- **Value and name colour.** Local player: white. Others: `multiplyColor(teamColour, 2, 80)` = clamp((c + 80)·2) per
  channel.
  - Blue #002DBF → **#A0FAFF**; orange #B23D00 → **#FFFFA0**.
  - Colour-blind: #A0D2FF / #FFFFA0.
  - This is the only local-row distinction besides the white avatar frame. There is **no highlight bar**.
- **Fonts.** Team score: $NumbersWideFont 36. Team name: $HeaderThinFont 36. Headers: $SmallBoldFont 11. Names and
  values: $HeaderFont 20. Ping: $SmallBoldFont 16. Substitutes per HUD-1.
- **Alignment.** Values and headers centred, except PING (left). Names left.

### SB-7 Ping [M `setPing` m#8525, `validateConnectionIndicator` m#8527, SC-anim:1714; S `PRI_TA.GetPing` TA:81134]
- **Value.**
  - Humans: min(ceil(ExactPing·1000), 999), or Ping·4 when there is no exact ping.
  - Bots: 0 online. In an offline bot match the game fakes it: max(Ping ± 2, 10), else random 10–100.
  - Shown as plain digits.
- **Bands.** Strength 1: > 250. Strength 2: 201–250. Strength 3: 101–200. Strength 4: ≤ 100.
- **Drawing.** The whole label (bar icon and number) gets an additive tint over black art, so both render exactly in the
  band colour:
  - 1 = red (255, 0, 0); 2 = orange (255, 103, 0); 3 = yellow (255, 248, 0); 4 = green (137, 255, 0).
- **Bar icon.** 20×20 px: four ascending bars (x 5–8, 11–14, 17–20, 23–26 of 32; heights rising left to right).
  - The first N bars are solid; the rest are at α 0.2 in the same colour.
- **Connection problem** (`WorstConnectionQualityStateBeyondLatency` > 0): the label switches to a blinking
  warning-triangle icon (0.47 s fade loop), red (q 1) or orange (q 2).
- **Disconnected:** the ping is hidden.

## 3. Content, show and hide

### SB-8 Who is listed [M m#9917, m#9559; S TA:54108, 61369, 67577/67734]
- **Rows.** One row per PRI with `ShowOnScoreboard()` (not a spectator) and a team.
  - Each team panel creates exactly as many rows as it has players. **No placeholder rows for empty slots**; the panel
    just gets shorter (Hn; the minimum header-only height is 105).
- **Order.** `ScoreboardSort` = MVPSort per team (STAT §5.2). Bots are listed like humans.
- **Disconnected humans:** kept in their team at row α 0.4 (0.2 s tween), ping hidden, while
  `ShouldShowDisconnectedPlayersOnScoreboard`. That is true for public / ranked / tournament and **false for private,
  LAN and offline** (`MatchType_Custom_TA`), where the row is removed. Bots that leave are always removed.
- **Spectators:** the text line under the panels (skip).

### SB-9 Columns [S TA:106807–106875, 81148–81156; A `Default__ProfileScoreboardSave_TA`, `Default__CustomScoreboardConfig_TA`]
- **Values.** `MatchScore` + the viewer's 4 columns for the current mode.
  - Column order and choice come from the **viewer's own** profile save (`GetModeIDForGameInfo` → Soccar/Hoops/SnowDay/
    Rumble/DropShot/Heatseeker).
  - Defaults: Goals, Assists, Saves, Shots. Dropshot: Goals, Assists, Saves, Damage.
- **1v1 refinement of STAT-17.** The Assists → Demolitions swap in 1v1 (`GetAssistScoreboardStat`) only happens on the
  fallback path. That path runs when there is no profile save or the PRI doesn't support custom columns. The normal path
  (a local profile) shows **ASSISTS in 1v1 too**.
- **Replays.** In a replay the HUD reads the column set through the replay's PRI (TA:61136).
- **Clone.** Send the 5 values per player (or the counters); format as integers.

### SB-10 Show / hide [S TA:61618–61627, 78398; A DefaultInput.ini:90, 256, `Default__ControlPreset_X`; M HUD:839–950]
- **Binding** `ToggleScoreboard` (label key `[ToggleScoreboard] Label`), category Misc, command
  `OpenScoreboard | OnRelease CloseScoreboard`, so it is **held**.
  - Defaults: keyboard **Tab**; gamepad **XboxTypeS_LeftShoulder (LB / L1)**, bRequired, remappable. Steam Input: the
    same.
  - Tab is shared with `PostMatchRequeue` (post-match only).
- **Minimum time.** Open sets CloseScoreboardTime = now + **0.35 s** (real time). Releasing earlier polls every 0.01 s
  until then, so a tap shows it for 0.35 s.
- **Fade.**
  - Open: alpha 0 → 1 over **0.2 s** (TweenMax default ease, Quad.easeOut).
  - Close: alpha → 0.2 over 0.2 s, then the view is removed (the last 0.2 alpha pops off).
  - No slide or scale.
- **Allowed phases.**
  - Disabled (and force-closed) in PostGame, **PrePodiumSpotlight, PodiumSpotlight, Finished**, Intro, SeasonIntro and
    PreMatchLobby.
  - Allowed in WaitingForPlayers, Countdown, Active, PostGoalScored and **ReplayPlayback** (goal replays).
  - Same as the MIO-5 table.
- **Match types.** Disabled in **Training (free play and online free play: MatchTypeName 'Training')**, Tutorial and
  the training editor. Enabled in online, private, LAN, offline exhibition and tournament.
- **Match end.** It does not auto-show. At Finished the end-of-match screen opens with the same `ScoreboardView`
  (MIO-26/27).
- **Side effects while open:**
  - the chat log shows, and hides 4 s after closing (CHAT §4.2);
  - the private-match mutator list shows at the right (250 px; the panel shifts left to make room);
  - all connection-quality indicators show (not just the first);
  - UI sound state `Scoreboard` is pushed;
  - no cursor (`showCursor = false`); the panel is **not interactive** (`mouseEnabled` false).
- **Driving continues** (it is not a menu).

### SB-11 MVP icon [M m#8530, m#8536, SC-anim:1722, SC-chars:771]
- **Trigger.** When the row's `bMvp` becomes true (`bMatchMVP`, repnotify at EndGame, so in practice on the end screen),
  a **1.75 s** timer starts.
- **Animation.** The badge then plays an 8-frame slam (0.233 s at 30 fps):
  - scale 3.75 → 0.94 (final ≈ 30×30 px) at row (291, 24);
  - colour from pure white to (1, 0.5, 0.5) + (255, 127, 0), i.e. white parts end pale yellow #FFFE7F and dark parts end
    orange;
  - sound `SLAMIN_MVP`.
- **Shape.** A round badge: a white ring around a laurel wreath and a five-point star. Own vector version in the clone.

## 4. Mute and block

### SB-12 Block (live UI) [M MGM:59313–59318, 59638 (m#9095), 59846 (m#9109); PIM:40271 (m#7392–7423), 58916 (m#8916–8941), 61572 (m#9158–9167); S TA:51625]
- **Not on the held scoreboard** (SB-10: not interactive).
- **Pause-menu entry.** The pause menu (Esc / Start) has an entry, key **`PlayerReport`** (by key: its label names
  Report).
  - Shown in Online, Private, LAN, Tournament, FaceIt, Honor Duel and online free play, with `Features.PlayerReporting`.
  - Not in offline matches or the replay viewer.
  - Enabled when the player list has more than one entry.
- **The list.** The entry opens the modal `PlayerInteractionMenu` (`GFX_PlayerInteractionMenu`):
  - Centred on screen; modal panel background α 0.95.
  - Title: key `PlayerReport`, $HeaderThinFont 36, tinted light cyan (#666666 + (67, 175, 255)).
  - Player list at (10, 51): rows **33 px** apart, 8 visible, then a scroll bar.
  - Rows: this match's human, non-local players first, then the remaining recent players. Bots excluded.
- **Each row** (`PlayerInteractionComponentMovie`):
  - name: $NormalFont 15 white α 0.8, `[CLUBTAG] ` prefix;
  - **Report** button at x 165 (key `Report`; disabled on LAN). **Not implemented** (no report system);
  - **Block / Unblock** toggle at x 303.
- **The toggle.** Label **"Block"**; once blocked, **"Unblock"** plus a small red X icon (16×16, pure red) inside the
  button. Disabled for bots.
- **Navigation.**
  - Gamepad: left/right moves between the two buttons, up/down between rows.
  - Footer: Back (key `Back`, pad B). With text moderation: key `TextModeration.ReportTextConversation` (pad X), not
    implemented.
- **Action.**
  - `SetBlocked(!bBlocked)` → `GFxData_Friends_TA.BlockPlayer` / `UnblockPlayer` (TA:43602, 43629).
  - The online friends service is the store of record. `bBlocked` comes back through the persona (TA:51567).

### SB-13 Mute [M LIB:123645 (VoiceListView m#21219–21236), HUD:46412; S TA:51620–51623, 77199, 77410]
- **No in-match Mute UI in the live build.**
  - The scoreboard row has no mute icon or element: `ScoreboardRenderer` has none, and only a voice "speaking" icon.
  - `GFxData_PRI_TA.SetMuted` has no body. `bMuted` (`IsExplictlyMuted`) is read but drawn nowhere in the HUD.
- **Where "Mute" / "Unmute" exist.** Only in the friends panel's voice-chat list (EOS voice rooms).
  - Context menu entries there: View Player Profile (key), Report Player (key, not implemented), **Mute** / **Unmute**.
  - It mutes voice.
- **The text/quick-chat mute** (`VoiceMuteList`, `ClientMutePlayer`) is fed by voice and online-service paths, not by a
  scoreboard control (CHAT-19).
- **Clone recommendation** [I] (our feature, not the game's):
  - Put **Mute / Unmute** beside Block / Unblock in the SB-12 list. Optionally add a small muted marker in the row at
    the voice-icon slot (row x 115, y 13).
  - Semantics per CHAT-19: mute = the server stops relaying that sender's chat to you (`CanChatWith`); block = your
    client drops their chat (`ShouldDeliverMessage`).

### SB-14 Feedback [S TA:43608–43700, 39888, 60845]
- **No chat-log line** for mute or block.
- **Block success.**
  - A pop-up toast notification: title = the player's name, body **"You have blocked [PlayerName]."** (key
    `[Friends] NowBlocked`).
  - Unblock: **"You have unblocked [PlayerName]."** (`NowUnblocked`).
  - Also: notifications from that player are removed, and the direct-message history (channel 3, Individual) is erased.
  - **Match chat lines already in the log stay.** Later chat from the blocked player is dropped on receipt (CHAT §4.5,
    step 4).
- **Failure:** an error alert (key `[Errors] ActionFailed`).
- **Platform friends:** a platform-friend info modal (keys `[GFxData_PlatformFriendBlockInfo]` /
  `[GFxData_UnblockedPlatformBlockInfo]`). Not applicable to the clone.

## 5. Stat icons

### SB-15 Rendering [A STAT1 `statevents_tagame.txt`; M HUD #97 (HUD1 dump GFX_Hud.HUD.anim.txt:31), HudMatchInfo #41/#42]
- **Art.** Each StatEvent's `Texture` is `StatEvents.Events.<Name>` in TAGame.upk: 128×128 DXT5.
  - The glyph is **solid white**, filling about x/y 10…118.
  - It has a soft **black halo** (≈ 6 px, α 0.4–0.7) and black interior detail lines.
- **Mapping.** Shot uses the `BulletGoal` art; Demolish uses `Demolition`; Extermination uses `StatEvents.Extermination`;
  Juggle uses `Juggler`.
- **Popup** (HUD-9) is 64×64 px at (−32, −37) from the popup centre, tinted additive (255, 127, 0):
  - 0–0.13 s: from solid orange to **white glyph with an orange halo** (alpha 0 → 1);
  - 0.4–0.8 s: the same clip grows to 5.6× (180 px), blurs 4 px, fades to α 0.5 and turns to a **solid orange
    silhouette**, which stays behind the label until the float-out.
- **Ticker** (HUD-14): a 46×46 icon centred at row x 80, y 20, additive (255, 127, 0), so a white glyph with an orange
  halo, over a darkened radial glow.

### SB-16 Shapes (for our own vector drawings; white fill, ~6 px dark halo, 128-unit canvas) [A icons exported locally]
| Event | Shape |
|---|---|
| **Goal** | Soccer ball (white, dark pentagon pattern) at the centre of a jagged 12–14-point starburst whose spikes are uneven (longest to the left and the lower right) |
| **Assist** | Two open hands, palms facing out, fingers up, overlapping: a large solid right hand in front, a second hand outlined behind and to the upper right (a high-five pass) |
| **Save** | Soccer ball with a flat elliptical halo ring floating above it |
| **EpicSave** | Ball with a halo ring above, tilted, plus 4–5 speed streaks trailing to the lower left (ball flying up-right) |
| **Shot** (BulletGoal art) | Ball in the lower right with 3–4 wavy flame tongues trailing to the upper left (a comet) |
| **Demolish** (Demolition art) | Classic round bomb: large solid sphere, a small cap at the upper right, a curled fuse ending in a small 8-point spark |
| **MVP** | Laurel wreath (two leafy branches meeting at a bottom ribbon) around a large five-point star |
| **Win** | Trophy: round cup with a five-point star cut-out, a short stem with side handles, a wide stepped base |
| AerialGoal | Ball with a pair of feathered wings at its upper sides and a small flame jet under it |
| BackwardsGoal | Gear-shift gate (1-3-5 on top, 2-4 below, H-pattern lines) with a circled "R" at the lower right |
| BicycleGoal / BicycleHit | Bicycle side view; the Hit variant sits on a starburst |
| TurtleGoal | Turtle shell (dome with spikes) on its back, head at the left |
| LongGoal | Crosshair: a circle with four ticks, a centre dot and a goal-frame bracket |
| OvertimeGoal | Stopwatch: round face, a top button, two small side lugs, hands at 4 o'clock |
| HatTrick | Top hat with a band, a rabbit's head and ears popping out |
| Playmaker | Tactics: "O" and "X" side by side, a bent arrow below pointing right |
| Savior | Ball with a small crown above and striped wing-like fans at both sides |
| PoolShot | 8-ball (circle with an "8" in a white disc) on a starburst |
| Extermination | Gas mask: skull-like face, two big eye holes, a filter canister |
| LowFive | Two hands meeting low, a small star at the contact, radiating ticks above and below |
| HighFive | Two raised hands touching, a star and spark ticks above |
| FlipReset | Ball upper left, car upside down below it touching it, an impact burst |
| Clear | Car at the lower left knocking a ball up and away to the upper right with motion lines |
| Center | A goal-frame outline with an arrow pair converging into it from both sides |
| FirstTouch | Foam finger "#1" |
| AerialHit | Boosting car (flames from the rear) above wavy jet trails |
| Juggle | Car with three small balls arcing over it |

Primary events (popup at the default level and ticker) are bold. The others appear at display level All, or never on
the HUD (FirstTouch, AerialHit, Juggle, Clear, Center: popup at All only).

## 6. Settings

### SB-17 Scoreboard tab [S TA:105885–105970, 106355–106364; M SET:65332 (m#9656–9662), SET:61025; A `scoreboard_defaults.txt`]
- **Tab.** Key `SettingsMenu.CustomScoreboard`, shown when `Features.CustomScoreboard` is set. It sits between Stream
  Safe and Video (MENU-5).
- **Groups.** One per mode, in order Soccar, Hoops, Snow Day, Rumble, Dropshot, Heatseeker.
  - Title: `[GameModes] GameInfo_*_TA`, upper-cased.
  - Each group has **4 dropdowns**, columns 1–4, dropdown width 176.
  - `MatchScore` is always column 0 and is not configurable.
- **Options.** All 24 `ECustomScoreboardStat` values with their `[Scoreboard] CSStat_*` labels, **sorted alphabetically
  by label**, filtered per mode:
  - DAMAGE only in Dropshot;
  - SHOTS and CENTERS not in Dropshot;
  - BOOST PICKUPS not in Dropshot or Heatseeker.
- **Defaults.** Goals, Assists, Saves, Shots for every mode (Dropshot: Damage instead of Shots).
  - A "reset to defaults" legend action (key `SettingsMenu.ResetToDefaults`) restores them.
  - Duplicate columns are not prevented [I, no check found].
- **Storage.** The local profile (`ProfileScoreboardSave_TA`, JSON save). Clone: localStorage, Soccar group only.
- **Nothing else** is on this tab.

## 7. Replays

### SB-18 PRI counters in the dataset [A boxcars 0.12 dump, `pri_dump/`; 2 replays: one 2v2 (5471 frames), one 1v1 (8722 frames)]
- **Build.** All 690 local replays (out/replays, out/replays/more) are **build 250811 (Sept 2025)**, 13 months older than
  the live build.
- **PRI net cache.** It holds `MatchScore`, `MatchGoals`, `MatchAssists`, `MatchSaves`, `MatchShots`,
  `MatchBreakoutDamage`, `bMatchMVP`, `CarDemolitions`, `BallDemolitions`, `SelfDemolitions`, `PrimaryTitle`,
  `SecondaryTitle`, `Title`, `SkillTier`, plus engine `Score` and `Ping`.
- **Absent** (so never recorded): `MatchDemolishes`, `BallTouches`, `MatchEpicSaves`, `MatchCenters`, `MatchClears`,
  the aerial/bicycle/juggle/first-touch counters, `CarTouches`, `BoostPickups`, `Dodges`.
  - Demolitions are recoverable from `CarDemolitions` (attacker) and `SelfDemolitions` (victim).
  - STAT §7 lists more counters as replicated in the live build. The live list could not be checked against a
    live-build replay.
- **Update pattern.** Each counter appears on the frame it changes (30 fps recording, ≈ 33 ms resolution).
  - Every PRI property is also re-sent at replay keyframes (every ~10 s, and after goal resets) with unchanged values,
    so take changes, not updates.
  - 2v2 sample: MatchScore 91 changes, 71 re-sends. MatchShots 9 / 42. MatchSaves 4 / 28. MatchGoals 3 / 15 (equal to
    engine `Score`). MatchAssists 1. CarDemolitions 2. Ping 31 changes.
  - 1v1 sample: MatchScore 127 / 66; MatchShots 16; MatchSaves 6; MatchGoals 8; Ping 134 changes.
  - The assist counter arrived 0.28 s after the goal counter in the 2v2 sample.
- **MatchScore steps** observed in the two samples (per player, per change): +2 (133×), +10 (32), +20 (12), +12 (8),
  +100 (4), +22 / +52 / +50 (4–5 each), +77 (3), +125 (2), +112 (2), +4, +102, +120, +145. All are sums of STAT-2 points
  landing in one 33 ms frame (e.g. 77 = epic save 75 + ball hit 2; 120 = goal + aerial goal). Usable for a deterministic
  stat test (older build: the point values may have changed since).
- **Header `PlayerStats`.** Final per-player Score/Goals/Assists/Saves/Shots, plus bBot (and account IDs: keep local).

## Open
- **w and hidden children (SB-1):** a screenshot of a held 2v2 scoreboard at 1080p settles the ≈ 35 vs 11 px left
  offset. The row and header geometry does not depend on it.
- **Glow tint order:** whether the additive team tint applies to the glow filters of the team name and score (assumed
  yes).
- **Gamepad default:** the data says LB (`XboxTypeS_LeftShoulder`) in `DefaultInput.ini` and `Default__ControlPreset_X`.
  No other preset overrides it in the packages.
- **Live replication of extra counters:** confirmable only with a live-build replay or packet capture (we have none).
