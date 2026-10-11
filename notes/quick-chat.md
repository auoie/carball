# Quick chat and text-chat rules: spec (static session, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent CHAT1. The static session re-checked the spam bucket
against the script (PlayerController_TA.ApplyChatSpamFilter, TA:77356) and all 76 verbatim strings against the
decrypted English localization ([ChatPresets]).

**Quick-chat strings are shipped verbatim by user decision (2026-10-10); other game text follows the existing rules.**
The category names are confirmed (user, 2026-10-10), and so is the chat UI text listed under "Chat UI text" below.
The crossplay and honor-duel chat hints are skipped: the clone has neither feature.

Live build 2026-10-06. Everything comes from the snapshot `rocketleague-20261006/` (packages decrypted with keys baked
into the exe), the TAGame script dump, the Scaleform movies parsed by HUD1, and the snapshot's `DefaultInput.ini`.
No Ghidra decompiles were needed: the whole chat path is UnrealScript plus AS3. `[N]` items cite the native table
(`out/bsim/live-20261006/natives.csv`) only.

**Tags**
- `[A]` package data: archetypes, class defaults, localization, ini.
- `[S]` UnrealScript. `TA:<line>` = `out/bsim/work/tagame_live_all.txt`. `+resync` = the line was recovered past a
  decode error with `out/bsim/agents/CHAT1/py/resync_many.py` (output in `resync1.txt`), so offsets are approximate.
- `[G]` GFx/AS3. `HUD:<line>` = `out/bsim/agents/HUD1/dec_as3/GFX_Hud.HUD.all.txt`; `SET:<line>` =
  `.../GFX_SettingsMenu.SettingsMenu.all.txt`; tree = `out/bsim/agents/HUD1/dump/*.tree.txt`.
- `[N]` native (table address only). `[I]` inferred.

**Local files** (git-ignored, in `out/bsim/agents/CHAT1/`):
- `raw_strings.txt`: the raw English strings.
- `msg_table.md`: the generated message table.
- `defaults1.txt` and `controlpreset_cdo.txt`: the class defaults.
- `resync1.txt`: the recovered bytecode.
- `py/`: scripts, including the spam simulator `spam_sim.py`.
- `swf/`: the spectator HUD movie.

## Summary
- **Messages are IDs, not text.** The wire carries a preset key such as `Group2Message1`. Each receiver looks it up in
  its own locale (`TAGame.int [ChatPresets]`).
- **76 presets in 6 categories.** Four are in-match categories. Two are context sets: post-game, which replaces
  category 1 once the match has ended, and pre-game, which replaces it in the pre-match lobby.
- **24 rebindable slots:** 4 in-match categories × 4, plus 4 post-game and 4 pre-game.
- **Two presses.** The first press (1–4, or D-pad Up/Left/Right/Down) opens a category. The second press with the same
  four keys picks message 1–4.
  - The window is 0.25 s of fade-in plus 1.5 s.
  - Category 1 ("Information") is team-only. Everything else, the context sets included, goes to all.
- **Spam.** The server keeps one leaky bucket per player, shared by quick chat and text and by team and all.
  - It allows a 3-message burst from rest, then about one message per 1.2 s.
  - When it blocks, it tells the sender "chat disabled for ⌈N⌉ s".
- **Display.** Messages go to the top-left chat log as `[M:SS] [TEAM] NAME: message`, with the name in a lightened
  team colour.
  - The log shows for 6 s after the last message (0.3 s fades).
  - Every player message plays a notification sound.
- **No quick chat** in offline (standalone) games, training, tutorial, online freeplay, the end-of-match screen,
  spectator HUD, saved-replay viewer, or menus. **Bots never chat.**

## 1. Message set
### 1.1 Categories (groups)
Localization: `TAGame.int [ChatPresetGroups] GroupN` [A]. The labels are part of the quick-chat set, so they are
verbatim here (see the hand-back).

| Group | Label (verbatim) | Role | Team flag | When it is shown |
|---|---|---|---|---|
| Group1 | Informational | In-match category 1 | **team** (`GFxData_Chat_TA.PresetGroups[0].bTeam = True` [A defaults1.txt]) | In-match |
| Group2 | Compliments | In-match category 2 | all | In-match |
| Group3 | Reactions | In-match category 3 | all | In-match |
| Group4 | Apologies | In-match category 4 | all | In-match |
| Group5 | Post Game | `PostGameGroupOverride` = {GroupIndex 0, GroupName 'Group5', MessageIDOffset **16**, bTeam False} [A] | all | Replaces category 1 once `GameEvent.bMatchEnded` (RefreshQuickChat TA:39751, HandleGameEnded TA:39774) |
| Group6 | Pre Game | `PreGameGroupOverride` = {GroupIndex 0, GroupName 'Group6', MessageIDOffset **20**, bTeam False} [A] | all | Replaces category 1 while the game state is `PreMatchLobby` (RefreshQuickChat TA:39758, HandleStateChanged TA:39764). Its rebinding row shows only with `Features.PreMatchLobby` (SET:59830, 59871) |

**Building the four visible groups** (GFxData_Chat_TA.UpdateChatGroups TA:39802) [S]:
- MaxNumGroups is **4** and MaxNumMessagesPerGroup is **4** [A].
- For each group g (0–3):
  - **Label:** the override's GroupName if g == override.GroupIndex, else `GroupN` with N = g + 1.
  - **Messages:** for message k (0–3), `Id = QuickChatBindings[BindingID]`, where BindingID = override.MessageIDOffset +
    k for the overridden group, else 4g + k.
  - **Team flag:** the override's bTeam for the overridden group, else `PresetGroups[g].bTeam`.
- The default override argument is the struct default, GroupIndex −1, which means "no override" (struct default
  [A]; initialization semantics [I]).

**Team or all belongs to the slot's group, not to the message.** A compliment rebound into category 1 goes team-only.
"I got it!" rebound into category 2 goes to everyone.

### 1.2 Messages
- **IDs:** `GroupNMessageM`, localized from `TAGame.int [ChatPresets]` [A].
- **Pools:** the rebinding menu offers three pools [A `GFxData_QuickChatBindings_TA` defaults]:
  - `QuickChats` (in-match: Group1 1–22, Group2 1–11, Group3 1–18, Group4 1–8, plus **Group6Message4**);
  - `PostGameQuickChats` (Group5 1–9);
  - `PreGameQuickChats` (Group6 1–8).
- **Tactical** = the ID contains `Group1`, `Group5` or `Group6` (GetMessageRecipients TA:77317). It matters only for
  the "Block Non-Tactical Quick Chat" filter. Group6Message4 counts as tactical even when it is bound in-match.
- **Default slot** (`ProfileQuickChatSave_TA.QuickChatBindings` defaults [A]): slot i = Group(i/4 + 1)Message(i%4 + 1).
  Keys: first press, then second press.

| Key (ChatPresets.) | Category | English string (verbatim) | Pool | Tactical | Default slot (first press, second press) |
|---|---|---|---|---|---|
| Group1Message1 | Informational | I got it! | in-match | yes | slot 0: 1/Up then 1/Up |
| Group1Message2 | Informational | Need boost! | in-match | yes | slot 1: 1/Up then 2/Left |
| Group1Message3 | Informational | Take the shot! | in-match | yes | slot 2: 1/Up then 3/Right |
| Group1Message4 | Informational | Defending... | in-match | yes | slot 3: 1/Up then 4/Down |
| Group1Message5 | Informational | Go for it! | in-match | yes | - |
| Group1Message6 | Informational | Centering! | in-match | yes | - |
| Group1Message7 | Informational | All yours. | in-match | yes | - |
| Group1Message8 | Informational | In position. | in-match | yes | - |
| Group1Message9 | Informational | Incoming! | in-match | yes | - |
| Group1Message10 | Informational | Faking. | in-match | yes | - |
| Group1Message11 | Informational | Bumping! | in-match | yes | - |
| Group1Message12 | Informational | On your left. | in-match | yes | - |
| Group1Message13 | Informational | On your right. | in-match | yes | - |
| Group1Message14 | Informational | Passing! | in-match | yes | - |
| Group1Message15 | Informational | Rotating up! | in-match | yes | - |
| Group1Message16 | Informational | Rotating back! | in-match | yes | - |
| Group1Message17 | Informational | You have time! | in-match | yes | - |
| Group1Message18 | Informational | One more! | in-match | yes | - |
| Group1Message19 | Informational | Back post! | in-match | yes | - |
| Group1Message20 | Informational | Leaving. | in-match | yes | - |
| Group1Message21 | Informational | Oops, wrong quick chat! | in-match | yes | - |
| Group1Message22 | Informational | Rotating! | in-match | yes | - |
| Group2Message1 | Compliments | Nice shot! | in-match | no | slot 4: 2/Left then 1/Up |
| Group2Message2 | Compliments | Great pass! | in-match | no | slot 5: 2/Left then 2/Left |
| Group2Message3 | Compliments | Thanks! | in-match | no | slot 6: 2/Left then 3/Right |
| Group2Message4 | Compliments | What a save! | in-match | no | slot 7: 2/Left then 4/Down |
| Group2Message5 | Compliments | Nice one! | in-match | no | - |
| Group2Message6 | Compliments | What a play! | in-match | no | - |
| Group2Message7 | Compliments | Great clear! | in-match | no | - |
| Group2Message8 | Compliments | Nice block! | in-match | no | - |
| Group2Message9 | Compliments | Nice bump! | in-match | no | - |
| Group2Message10 | Compliments | Nice demo! | in-match | no | - |
| Group2Message11 | Compliments | We got this. | in-match | no | - |
| Group3Message1 | Reactions | OMG! | in-match | no | slot 8: 3/Right then 1/Up |
| Group3Message2 | Reactions | Noooo! | in-match | no | slot 9: 3/Right then 2/Left |
| Group3Message3 | Reactions | Wow! | in-match | no | slot 10: 3/Right then 3/Right |
| Group3Message4 | Reactions | Close one! | in-match | no | slot 11: 3/Right then 4/Down |
| Group3Message5 | Reactions | No way! | in-match | no | - |
| Group3Message6 | Reactions | Holy cow! | in-match | no | - |
| Group3Message7 | Reactions | Whew. | in-match | no | - |
| Group3Message8 | Reactions | Siiiick! | in-match | no | - |
| Group3Message9 | Reactions | Calculated. | in-match | no | - |
| Group3Message10 | Reactions | Brutal! | in-match | no | - |
| Group3Message11 | Reactions | Okay. | in-match | no | - |
| Group3Message12 | Reactions | Yes! | in-match | no | - |
| Group3Message13 | Reactions | Unlucky! | in-match | no | - |
| Group3Message14 | Reactions | This isn't Rocket League! | in-match | no | - |
| Group3Message15 | Reactions | Oof. | in-match | no | - |
| Group3Message16 | Reactions | ... | in-match | no | - |
| Group3Message17 | Reactions | Be careful! | in-match | no | - |
| Group3Message18 | Reactions | Let's lock in. | in-match | no | - |
| Group4Message1 | Apologies | $#@%! | in-match | no | slot 12: 4/Down then 1/Up |
| Group4Message2 | Apologies | No problem. | in-match | no | slot 13: 4/Down then 2/Left |
| Group4Message3 | Apologies | Whoops... | in-match | no | slot 14: 4/Down then 3/Right |
| Group4Message4 | Apologies | Sorry! | in-match | no | slot 15: 4/Down then 4/Down |
| Group4Message5 | Apologies | My bad... | in-match | no | - |
| Group4Message6 | Apologies | Oops! | in-match | no | - |
| Group4Message7 | Apologies | My fault. | in-match | no | - |
| Group4Message8 | Apologies | All good! | in-match | no | - |
| Group5Message1 | Post Game | gg | post-game | yes | slot 16: 1/Up (match ended) then 1/Up |
| Group5Message2 | Post Game | Well played. | post-game | yes | slot 17: 1/Up (match ended) then 2/Left |
| Group5Message3 | Post Game | That was fun! | post-game | yes | slot 18: 1/Up (match ended) then 3/Right |
| Group5Message4 | Post Game | Rematch! | post-game | yes | slot 19: 1/Up (match ended) then 4/Down |
| Group5Message5 | Post Game | One. More. Game. | post-game | yes | - |
| Group5Message6 | Post Game | What a game! | post-game | yes | - |
| Group5Message7 | Post Game | Nice moves. | post-game | yes | - |
| Group5Message8 | Post Game | Everybody dance! | post-game | yes | - |
| Group5Message9 | Post Game | Party up? | post-game | yes | - |
| Group6Message1 | Pre Game | Good luck! | pre-game | yes | slot 20: 1/Up (pre-match lobby) then 1/Up |
| Group6Message2 | Pre Game | Have fun! | pre-game | yes | slot 21: 1/Up (pre-match lobby) then 2/Left |
| Group6Message3 | Pre Game | Get ready. | pre-game | yes | slot 22: 1/Up (pre-match lobby) then 3/Right |
| Group6Message4 | Pre Game | This is Rocket League! | in-match, pre-game | yes | slot 23: 1/Up (pre-match lobby) then 4/Down |
| Group6Message5 | Pre Game | Let's do this! | pre-game | yes | - |
| Group6Message6 | Pre Game | Here. We. Go. | pre-game | yes | - |
| Group6Message7 | Pre Game | Nice cars! | pre-game | yes | - |
| Group6Message8 | Pre Game | I'll do my best. | pre-game | yes | - |

### 1.3 Context, options and custom slots
- **No moment-specific sets.** There is no special set after a goal, save or kickoff, and none at match start, in an
  ordinary online match. The only context switches are post-game (`bMatchEnded`) and pre-game (the `PreMatchLobby`
  state, a feature-flagged lobby) [S TA:39751-39776].
  - Once the match has ended (podium included), first-press 1/Up opens **Post Game**.
  - First presses 2–4 still open Compliments, Reactions and Apologies.
- **Rebinding** [S TA:53041-53090, 84411-84420; G SET:47552-47700, 59814-59880]:
  - `ProfileQuickChatSave_TA.QuickChatBindings` is a 24-entry name array saved in the profile.
  - The Chat menu shows six rows of four dropdowns. Rows 1–4 draw from the in-match pool, row 5 from post-game, and row
    6 (Features.PreMatchLobby only) from pre-game.
  - ChangeBinding(row·4 + k, ID) writes slot row·4 + k.
  - "Reset" restores the defaults.
  - A save shorter than the default array is padded by the save-version delegate.
  - The dropdown entries are sorted ascending by localized text (SortQuickChat).
  - The rows are titled by `SettingsMenu.ChatPresetGroup1–6`; row 1's title marks the category as team-only.
- **Receiver filters** (settings; defaults from `Default__GameplaySettingsSave_TA` [A]):
  - **Quick Chat** (`QuickChatFilter`, enum EChatFilter): Everyone = ChatFilter_Preset (3, **default**), Teammates only
    = ChatFilter_TeamPreset (4), Friends only = ChatFilter_Friends (2), Off = ChatFilter_None (6).
  - **Block Non-Tactical Quick Chat** (`bFilterNonTacticalQuickChat`, default **false**): hides incoming quick chat
    that is not tactical (Group2–4) during a match.
  - **Match Chat** (text, `MatchChatFilter`): Everyone 0 (default), Friends & team 1, Friends 2, Off 6.
  - **Party Chat**: 0 / 2 / 6.
  - **Filter Mature Language** (`FilterTextChat`): default true.
  - The old single "quick chat only" filter survives as these EChatFilter values (Preset, TeamPreset, TacticalPreset).
    `GameplaySettingsSave_TA.ConvertVoiceFilterToChatFilter` (TA:37597) maps the legacy voice-filter values onto them.
- **Mode switch.** `GameEvent_Soccar_TA.bDisableQuickChat` is set only by online freeplay
  (`Mutator_OnlineFreeplay_TA.Init`, TA:70602-70606). It blocks the first press (`GFxHUD_TA.ChatPreset`, TA:61660).

## 2. Bindings and the two-press scheme
### 2.1 Default bindings
Bindings come from the cooked `ProjectX.Default__ControlPreset_X` [A controlpreset_cdo.txt]. The snapshot's
`TAGame/Config/DefaultInput.ini` lines 95–97, 135–138 and 264–267 are identical. Whether the exe also reads that ini
at runtime is unknown; the cooked defaults make it moot.

| Action | Keyboard | Gamepad (also SteamInput) | Console command (`PlayerInput_TA.GetDefaultActions`, TA:78407-78413) |
|---|---|---|---|
| ChatPreset1 | `One` (1) | D-pad Up | `ChatPreset 0` |
| ChatPreset2 | `Two` (2) | D-pad Left | `ChatPreset 1` |
| ChatPreset3 | `Three` (3) | D-pad Right | `ChatPreset 2` |
| ChatPreset4 | `Four` (4) | D-pad Down | `ChatPreset 3` |
| Chat (text, all) | `T` | – | `OpenChat` |
| TeamChat | `Y` | – | `OpenTeamChat` |
| PartyChat | `U` | – | `OpenPartyChat` |

Notes:
- The numbers 1–4 are also bound to freeplay commands and the replay-viewer camera. Those actions belong to other
  modes; quick chat is off in freeplay.
- The binding labels are `Controls.int [ChatPreset1–4] Label`, roughly "Quick Chat – <category>". The ChatPreset1
  label names both Information and Post Game.

### 2.2 Two-press state machine
From `QuickChatView`, HUD:56262-56410 [G].

```
state: showing=false, timer=Timer(1500 ms)
onPress(i in 0..3):                                   # GFxHUD_TA.ChatPreset(i) → ChatData.OnPressChatPreset(i)
  if quickChatFilter == Off or game.bDisableQuickChat: return            # [S TA:61660]
  if !active or MidGameMenu open: return
  if !showing:                                        # first press = category i
     timer.reset(); title = upper(group[i].label); rows = 4 messages of group i
     showing = true; fade alpha → 1 over 0.25 s; on complete: timer.start()
  else:                                               # second press = message i of the open category
     row[i].setSelected()  (bold white); send(row[i].Id, row[i].bTeam)
     hide(0.8 s fade)
onTimer (1.5 s after the fade-in ends): hide(0.2 s fade)
hide(d): timer.reset(); showing = false; fade alpha → 0 over d
```

- **Window:** 1.75 s from the first press (0.25 s fade plus 1.5 s timer).
- The second press is accepted at once, even during the fade-in.
- A press during a fade-out starts a new menu, because `showing` is already false.
- Same key twice gives message 1 of category 1 by default (1,1 or Up,Up).
- No message is sent until the second press. There is no cancel key other than the timeout.

### 2.3 Where quick chat works

| Situation | Works? | Source |
|---|---|---|
| Online match: countdown, play, goal replay, overtime | yes | HudScreen.onGameStateChanged HUD:71128-71300. ACTIVE, INTRO, COUNTDOWN, PODIUM and other states call setInputActions(true); REPLAY_PLAYBACK leaves the actions as they were [G] |
| Podium (PrePodium/Podium spotlight) | yes, with the post-game category | same, plus bMatchEnded [G][S] |
| End-of-match screen (state FINISHED) | **no**: ChatPreset1–4 are disabled (setInputActions(false)). The chat log stays visible and typed chat is allowed | HUD:71144-71146, 71640-71655 [G] |
| Pre-match lobby | yes (setChatInputActions(true)), with the pre-game category | [G][S] |
| Pause/mid-game menu open | no: the view is hidden and presses are ignored | HUD:56329, 71584-71600 [G] |
| Typing in the text chat box | no: the chat box captures all input | HUD:71663 handleChatFocus [G][I] |
| Offline games (NetMode Standalone: exhibition vs bots, local splitscreen), training, tutorial | **no**: `quickChatView.setIsActive(MatchType ∉ {Training, Tutorial} && GameEvent.bOnline)`, and bOnline = NetMode ≠ Standalone | HUD:71284; TA:60962 [G][S] |
| Online freeplay | no (`bDisableQuickChat`) | TA:70604 [S] |
| Spectating (spectator HUD) | no. The spectator movie has a chat log (`HudChatLogView`) but no `QuickChatView`, so it receives chat but cannot quick chat | `swf/GFX_SpectatorHud.SpectatorHUD.swf` string scan [G] |
| Saved-replay viewer, main menu | no (no QuickChatView in those movies) | HUD1 as3 scan [G] |

The clone's offline freeplay and "Online" modes map onto this table as follows: offline freeplay has no quick chat;
online matches have it.

## 3. Spam limits
### 3.1 Rule
Server-side, per PlayerController (`ApplyChatSpamFilter` TA:77356, `CanSendMessage` TA:77349) [S].

```
struct Bucket { Value=0, LastChatTime=0, RiseAmount, RiseMultiplier, DecayRate, MaxValue }
ChatSpam      = { RiseAmount 1.2, RiseMultiplier 0.75, DecayRate 1.0, MaxValue 4.0 }   # [A] Archetypes.Controller.PlayerController
ChatSpamHarsh = { RiseAmount 9.0, RiseMultiplier 0.35, DecayRate 1.0, MaxValue 4.0 }   #     (GameInfo_Soccar_SF.upk; it is
                                                  # GameInfo_Soccar.PlayerControllerArchetype)

CanSendMessage(isQuickChat):                      # called by GetMessageRecipients on the authority
  if chatBanned (BanType_Chat) or socialBanned (BanType_Social):
      if !isQuickChat: notify ban (timed or permanent); return false   # text is refused
      return !Apply(ChatSpamHarsh)                                     # quick chat allowed, harshly limited
  return !Apply(ChatSpam)

Apply(b):                                         # returns true = blocked
  now = WorldInfo.RealTimeSeconds                 # real time: unaffected by pause or time dilation
  b.Value = max(b.Value - b.DecayRate * (now - b.LastChatTime), 0); b.LastChatTime = now
  if b.Value > b.MaxValue:
      ClientNotifyChatDisabled((b.Value - b.MaxValue) / b.DecayRate)    # seconds until allowed again
      return true                                 # message dropped; Value NOT increased
  b.Value = b.Value + b.RiseAmount + b.Value * b.RiseMultiplier
  return false
```

- **Shared bucket.** One bucket for quick chat and text, and for all, team and party channels. Text reaches the same
  check through `TextChatActor_TA.ServerSendMessageToPlayers` → `GetMessageRecipients` → `CanSendMessage(false)`
  (TA:95304-95316).
- **Server only.** The client never pre-checks. The sender learns about a block only through the notice.
- **Lifetime** [I]: the bucket lives on the PlayerController, so it resets on reconnect.
- **Blocked attempts** update LastChatTime and apply decay but add nothing. Retrying does not extend the block.
- **Notice:** `GFxHUD_TA.NotifyChatDisabled` (TA:61665) shows `GFxHUD_TA.ChatDisabledMessage` with [Time] =
  **⌈seconds⌉**. It is a transient system line in the chat log, roughly "chat disabled for N second(s)". The client
  shows it only if its platform text-communication privilege is "allowed" (CanCommunicateText == 3, TA:77337).

### 3.2 Derived behaviour
From `py/spam_sim.py`; the formula above is normative [I].
- **From rest,** 3 messages go through at once: Value 1.2 → 3.3 → 6.975.
  - The 4th is blocked with "2.975 s", shown as "3 seconds".
- **Steady rate:** at most one message per **1.2 s**. Sending exactly every 1.2 s keeps the pre-send value at 0.
  Anything faster diverges and blocks.
- **Sending as soon as allowed** (pre-value 4) costs 4 + 1.2 + 3.0 = 8.2, so the next send is 4.2 s later.
  - The pattern is 3 at t=0, then t = 2.975, 7.175, 11.375, …
  - At most 5 messages in any 10 s window.
- **No explicit strike counter or escalation table.** The multiplier gives escalation implicitly: chatting while "hot"
  costs more.
- **Chat-banned quick chat (harsh):** the first message is free (Value 9).
  - The next is possible after 5 s; it takes Value to 14.4, so the one after waits 10.4 s.
  - Sustainable at most one per 9 s.

## 4. Display
### 4.1 Quick chat panel
`QuickChatViewMovie`, tree GFX_Hud.HUD d244; HUD:44507-44640, 56262-56410 [G].
- **Position:** x = 24, left-anchored, in virtual stage px (notes/hud-menus.md HUD-1). Vertically centred:
  y = (ContentStageHeight − height)/2. The content spans about y 8–148 of the movie, so the height is about 140 and
  y ≈ 290 at 720 [I].
- **Background:** `QuickChat_Background_Scale9` at α 0.8.
- **Title:** at (7, 10). $HeaderFont 16, #43AFFF, uppercase. Text key `QuickChat.QuickChat` ("Quick Chat").
- **Category:** at (7, 25). $HeaderFont 20, white, glow #43AFFF blur 4, uppercase group label. Both titles
  shrink-to-fit.
- **Four rows** at y = 48, 72, 96 and 120 (24 px apart):
  - **Key glyph:** 30×28 box. The PC digit of the bound key, or the gamepad icon, depending on the last input device.
  - **Message:** in a 200×22 box at x + 33. $SmallFont 16 #43AFFF. The selected row switches to $SmallBoldFont 16
    white.
- **Timing:** shows over 0.25 s. Hides over 0.2 s on timeout, or 0.8 s after a selection.

### 4.2 Chat log
SharedComponents `ChatLogViewMovie` inside the HUD's `chatLogViewContainer` at (10, 10); notes/hud-menus.md HUD-15;
HUD:59840-60130, 72227-72480 [G].
- **Text box:** at (22, 20) in the view. 350×185, $SmallFont 18, white, leading 1, black glow (blur 6, strength 2),
  HTML, word wrap.
- **Line limit:** after each append, the first visual line is removed while textHeight > 185. That leaves about 8
  lines [I], and long messages lose their top lines first.
- **The data model** keeps the last 10 messages (`GFxData_Chat_TA.MaxMessages`) [A]. Per-channel histories keep 50
  player text messages (`TextModerationConfig_TA.MaxVisibleMessages`) [A]. The HUD log itself is the text field.
- **Scale:** the view scale is clamp(1/ContentScale, 0.75, M). M = 1, or 0.9 / 0.75 on the end-of-match screen
  (0.75 when a vote is showing). So the log stays near native pixel size instead of growing with the HUD.
- **Show:** on any message, fade in over 0.3 s.
- **Hide:** fade out over 0.3 s, **6 s after the last message**. Each new message restarts the timer.
- **Stays visible:**
  - while typing;
  - while the scoreboard is held: shown, and hidden 4 s after the scoreboard closes;
  - in the pause menu (online);
  - on the end-of-match screen (online, primary player).
- **Text input** (only while typing):
  - field at (22, 203), 348×24, $SmallFont 18;
  - background fades to α 0.8 over 0.2 s;
  - channel label before the field: `TEAM`, `PARTY` or `SPECTATOR`, $SmallBoldFont 16;
  - max **120** characters.
- **Hidden** in the tutorial. The spectator HUD has its own copy of the log.

### 4.3 Line format and colours
`ChatManager.formatMessageEvent` HUD:38031-38170. The HUD passes the flags NO_ANONYMIZE | EVENT_AS_WARNING [G].

Line = `[timestamp]␣` + `[channel]␣` + `NAME:␣` + `message`. Each part is omitted when empty. All parts use the log's
font size (18).

| Part | Rule |
|---|---|
| Timestamp | `[M:SS]` in #CCCCCC, $SmallFont. It is the server's `SecondsRemaining` when the server relayed the message (GetMessageTimestamp TA:77314). The receiver formats it in `HUDBase_TA.FormatTimeStamp` (TA:60924): M = ⌊T/60⌋, S = T − 60M, two-digit seconds, a `+` prefix in overtime, **empty once the match has ended** |
| Channel | Team → `[TEAM]`, or `[SPECTATOR]` if the viewer is a spectator (Team < 0). Party → `[PARTY]`. Match (all) → nothing. Default colour (white) |
| Name | Uppercase sender name in $SmallBoldFont. **Own messages:** the word for "YOU", white. **Team players:** team colour c (the team's FontColor → `GFxData_TeamInfo_TA.TeamColor`, TA:57832) mapped as min(255, 2·c) + (0x55, 0x22, 0x55), per channel clamped. That gives blue **#557CFF** and orange **#FF9C55**; colour-blind #5554FF / #FFEE55 [G formula; values I, from HUD-1's #002DBF / #B23D00 / #001972 / #FF6600]. **No team** (spectator): #CCCCCC. **Party:** #43D7FF. **Warning / voice / honor-duel messages:** their colours below |
| Message | **Own:** #CCCCCC. **Others:** white. **Party:** #43AFFF. **System lines without a sender name** (spam notice, bans, crossplay hints): #FFED83. **Voice notifications:** #3FFF00. **Honor duel:** #DF4802. HTML-escaped |

- **Text sent:** quick chat is shown as the receiver's localized preset string. An April "display override" table can
  replace it: `AprilConfig.QuickChatDisplayOverrides`, delivered by the server and not needed (AddPresetMessage
  TA:39907 +resync).
- **Empty messages** are dropped.
- **Stream-safe:** names are replaced by `AnonymizedName` when `ShouldAnonymize` (InternalAddMessage TA:39919).

### 4.4 Sound
- Every received line **with a sender name** plays HUD sound event `CHATMESSAGE` (HUD:72390). That covers quick chat,
  text, and the player's own echoed messages; system notices are silent.
- `GameInfo_Soccar_SF.GFxSounds_HUD` maps the event to `SFX_UI_InGame.UI_Notification_ChatMessage` [A].
- The quick-chat menu itself plays no sound [G].

### 4.5 Mute, block, filters (who receives)
Order of checks [S]:
1. **Sender client, `PlayerController_TA.Say_TA` (TA:77287):**
   - If the sender's own filter is team-only (QuickChatFilter TeamPreset for presets, MatchChatFilter
     FriendsAndTeam for text), an all-chat message is **downgraded to team**.
   - If the sender's filter is Friends, `bFriendsOnly`.
2. **Sender client, `PlayerControllerBase_TA.Say_TA` (TA:75960 +resync):**
   - Drops empty messages, and drops everything if the platform text privilege ≠ allowed.
   - Guests and cabined accounts may send presets only.
   - Builds `ForbiddenPlayers`, a set of UniqueNetIds from non-bot PRIs:
     - with bFriendsOnly: everyone who is not a friend or a local player;
     - for text under a restricted permission level: everyone outside friends (plus party and team for
       FriendsAndTeam).
   - In honor-duel mode a spectator's message goes to team.
   - Presets go to `ServerSay_TA`; text goes to the signed-message path.
3. **Server, `GetMessageRecipients` (TA:77317 +resync):** for every PlayerController_TA (bots have none):
   - skip anyone in ForbiddenPlayers [S+resync, I];
   - channel: Match = everyone, Team = same GetTeamNum (spectators share one), Party = same PartyLeader;
   - deliver to self always; deliver to others only if `CanChatWith` (TA:77271), which fails when any of these hold:
     - the recipient has **explicitly muted** the sender (`VoiceMuteList`). The reverse direction counts only with
       `bAllowAsymmetricalMute`, which defaults to false [A];
     - the recipient's filter rejects the message (`IsCommunicationFiltered`, TA:77480): QuickChatFilter for presets,
       MatchChatFilter for text. It rejects Off (6); non-tactical presets when bFilterNonTacticalQuickChat;
       Teammates-only (TeamPreset for presets, Team for text) across teams; and crossplay-disabled platform groups;
     - the sender's own filter, checked the same way without the non-tactical rule, rejects the message.
4. **Receiver client, `HUDBase_TA.ShouldDeliverMessage` (TA:60845):**
   - only the primary local player shows it;
   - platform text privilege must be "allowed";
   - Friends-only filter: drop if the sender is neither a local player nor a friend (party channel exempt);
   - text: the platform `CanPlayersTextChat` check;
   - drop if the sender is **blocked** (`Persona.bBlockedStatus`);
   - presets are then accepted; text also needs `OnlineGame.CanSeeChatMessage`.

**Mute and block in the UI.** The scoreboard row shows `bMuted` (`GFxData_PRI_TA.UpdateMuted`, TA:51620). Block goes
through the friends system (`SetBlocked`, TA:51625).
- How an explicit mute reaches the server's `VoiceMuteList` is not visible in script: `GFxData_PRI_TA.SetMuted` has
  no body [open].
- "Gameplay" mutes (`Team_TA.MutePlayer` / `MuteOtherTeam`) affect **voice only**; they are not consulted for chat
  (TA:31943-31965, 77491).

## 5. Network

| RPC | Direction, reliability | Parameters | Notes |
|---|---|---|---|
| `PlayerController_TA.ServerSay_TA` (TA:77293) | client → server, reliable | `string Message` (preset **ID**), `byte EChatChannel` (0 Match, 1 Team, 2 Party, 3 Individual), `PlayerIdArray ForbiddenPlayers` (UniqueNetIds), `optional bool bPreset` | **Returns unless bPreset**, so text never uses it. Then Left(Message, 128); LastActiveTime = now (resets the idle timer); `ServerSayInternal_TA` |
| `ServerSayInternal_TA` (TA:77301) | server | – | SanitizeWhitespace; TimeStamp = SecondsRemaining; recipients = GetMessageRecipients (spam and ban check first; none if blocked); `ChatMessage_TA` to each; fires `EventChatMessage` (feeds the server-side `QuickChatTracker_TA` usage counters: natives execIncrementQuickChat 0x140e6fa70, execGetQuickChatGroups 0x140e6fc80 [N table]; telemetry only) |
| `PlayerController_TA.ChatMessage_TA` (TA:77331) | server → each recipient, reliable | `PRI InPRI` (sender), `string Message`, `byte ChatChannel`, `bool bPreset`, `int TimeStamp` | Returns unless bPreset. Then HUD.Message_TA → OnChatMessage → ShouldDeliverMessage → AddPresetMessage (localize, append) |
| `ClientNotifyChatDisabled` (TA:77337) | server → sender, reliable | `float Time` | Spam notice |
| `ClientNotifyChatBanned` / `…Permanently` (TA:77341/77345) | server → sender | `QWORD ChatBanExpiration` (epoch) / – | Ban notices |
| `ServerSetQuickChatFilter` (TA:77421), `ServerSetTacticalChatFilter` (TA:77425), `ServerSetMatchChatFilter` (TA:77429) | client → server, reliable | `byte EChatFilter` / `bool` / `byte EChatFilter` | Sent when the settings save loads or changes (HandleGameplaySettingsSave TA:76446). The server stores them on the PC and uses them in CanChatWith |
| `PRI_TA.ServerSetDistracted` (TA:79837) | client → server | `bool` | Text chat open/closed, which drives the nameplate's "busy" icon. Quick chat does **not** set it |
| Text chat: `TextChatActor_TA.ServerSendMessagePayload / ServerSendSignature / ServerSendPublicKey` → `Client…` (TA:95203-95350) | both | signed payload, MessageId, key in ≤350-char pieces (≤6) | EOS-signed moderation path; at most 3 staged messages per actor. Clone: replace with a plain text RPC through the same server checks |

**What the server validates for quick chat:**
- bPreset must be set;
- Left(Message, 128) and whitespace sanitizing;
- ban and spam bucket;
- recipient filters and mutes;
- channel ∈ {0, 1, 2}; any other channel reaches nobody, not even the sender;
- honor-duel restriction.

It does **not** check that the ID is a real preset [S, by absence]. The receiver localizes whatever arrives.

**Clone protocol** [I]:
- `QuickChat { slotMessageId: u8 index into the 76-entry table above, team: bool }` client → server.
- The server validates the index, applies the §3 bucket and the §4.5 filters, and relays
  `QuickChatMsg { senderPlayerId, messageId, team, secondsRemaining }` reliably to every recipient, the sender
  included. There is no local echo: the sender sees its own line only after the round trip, as in RL.
- Spam notice: `ChatBlocked { seconds: f32 }`.

## 6. Bots
- **Offline bots never quick chat or text chat** [S][A].
  - Bots are `AIController_TA`. The only senders of chat are `PlayerController_TA` (`Say_TA` / `ServerSay_TA`), whose
    callers are the HUD and GFx (TA:39857, 39894).
  - Nothing in the AI behaviour tree, BT script or exe strings refers to chat (bt_tree.txt and exe scans: no chat
    nodes or preset IDs).
- Bots are also excluded as recipients (only PlayerController_TA are iterated) and from ForbiddenPlayers (bBot).
- Offline games have no quick chat UI anyway (§2.3).
- notes/bots.md has no chat item; add "BOT: no chat" if useful.

## 7. Text chat rules (around quick chat)
- **Opening:** T / Y / U open all / team / party text.
- **Availability:** `GFxHUD_TA.CanOpenChatByFilter` (TA:61547) requires all of:
  - online (NetMode ≠ Standalone);
  - no local player chat-restricted;
  - on consoles, not FINISHED;
  - the Match/Party filter not Off.
- **Party chat** also needs party members.
- **Typing:**
  - the input takes 120 characters (the console keyboard has the same limit);
  - Say_TA truncates to 128;
  - Esc cancels;
  - Enter sends (`ChatTextInput`, HUD:75773-75860).
- **Text refused** for guests and cabined accounts, and when the chat permission level is Nobody. Presets are still
  allowed.
- **Mature-language filter:** received text runs through `OnlineGameWordFilter_X.Sanitize`
  (WordFilterUsage_MatchChat or PartyChat; AddChatMessage TA:39896 +resync). The setting applies to party channels;
  game channels are always filtered (its description).
- **Same spam bucket and recipient rules** as quick chat. Banned players get a ban notice instead of sending.
- **Channel history:** player text is kept per channel, up to 50 messages.
- **Honor duel** (not needed): during an honor duel, text from non-spectators is suppressed with a notice.

## Numbered summary

| # | Item | Rule | Confidence |
|---|---|---|---|
| CHAT-1 | Message IDs and strings | 76 presets `Group{1–6}Message{n}`, localized from `TAGame.int [ChatPresets]`; the strings are verbatim in §1.2 [A] | high |
| CHAT-2 | Categories | Group1 Informational (team), Group2 Compliments, Group3 Reactions, Group4 Apologies (all); Group5 Post Game and Group6 Pre Game are context sets (all) [A][S] | high |
| CHAT-3 | Team or all | Decided by the slot's group (only in-match category 1 is team) plus the sender's own Teammates-only filter, which downgrades all to team [S] | high |
| CHAT-4 | Context switch | bMatchEnded → category 1 shows Post Game (slots 16–19); PreMatchLobby state → Pre Game (slots 20–23); nothing special for goals, saves or kickoff [S] | high |
| CHAT-5 | Custom slots | 24 profile slots; in-match pool of 60 IDs (incl. Group6Message4), post-game 9, pre-game 8; reset to the defaults [A][S][G] | high |
| CHAT-6 | Keys | ChatPreset1–4 = keys 1–4 / D-pad Up, Left, Right, Down; text chat T / Y / U (cooked defaults) [A] | high |
| CHAT-7 | Two presses | The first press opens category i; the second picks message i; the same four keys both times [G] | high |
| CHAT-8 | Window | 0.25 s fade-in, then a 1.5 s timer: 1.75 s total. Hide 0.2 s (timeout) or 0.8 s (after a pick) [G] | high |
| CHAT-9 | Availability | Online matches incl. goal replays and the podium; not the end screen (FINISHED), the pause menu, typing, offline or standalone, training, tutorial, online freeplay, spectating, the replay viewer or menus [G][S] | medium-high (state-switch decompile is lossy) |
| CHAT-10 | Spam rule | Per-player leaky bucket, Rise 1.2, Mult 0.75, Decay 1/s, Max 4; blocked → notice ⌈(V−4)/1⌉ s; harsh bucket 9 / 0.35 / 1 / 4 for chat-banned quick chat [S][A] | high |
| CHAT-11 | Spam scope | Shared by quick chat and text and by all channels; enforced only on the server; real time [S] | high |
| CHAT-12 | Spam outcomes | Burst of 3; sustained 1 per 1.2 s; edge-sending gives 4.2 s spacing; no strike counter [I from the formula] | high (math) |
| CHAT-13 | Quick chat panel | Left middle at x 24; title, category and 4 rows 24 px apart; #43AFFF text, white bold when selected [G] | high |
| CHAT-14 | Chat log | Top-left (10, 10) + (22, 20), 350×185, Arial Narrow 18, about 8 lines, oldest lines trimmed; 0.3 s fade in, hidden 6 s after the last line [G] | high (line count I) |
| CHAT-15 | Line format | `[M:SS] [TEAM] NAME: msg`; YOU for self; team-lightened name colours #557CFF / #FF9C55; own text #CCCCCC; notices #FFED83 [G][I] | high (colour values I) |
| CHAT-16 | Timestamp | Server SecondsRemaining at relay; `+` in overtime; none after the match ends [S] | high |
| CHAT-17 | Sound | UI_Notification_ChatMessage on every named line (own lines too) [A][G] | high |
| CHAT-18 | Filters | Quick Chat Everyone (default) / Team / Friends / Off; Block Non-Tactical (off); Match Chat Everyone / Friends & team / Friends / Off; checked on the server (team, off, non-tactical) and the client (friends, block) [S][A] | medium-high |
| CHAT-19 | Mute and block | Explicit mute stops chat from that sender on the server; block is filtered on the receiver; gameplay mutes are voice only [S] | medium (the mute → server path is open) |
| CHAT-20 | Network | ServerSay_TA(ID string ≤128, channel byte, ForbiddenPlayers, bPreset) → ChatMessage_TA(senderPRI, ID, channel, bPreset, int timestamp) to each recipient incl. the sender; reliable; no ID validation [S] | high |
| CHAT-21 | Bots | Never chat; never receive [S][A] | high |
| CHAT-22 | Text chat | Online only; 120 characters typed, 128 on the server; signed and moderated (clone: plain RPC); word filter; same spam bucket and recipients [S][G] | medium |

## Chat UI text (shipped verbatim by user decision, 2026-10-10)

Checked against the decrypted English localization (Coalesced_INT) and the HUD's AS3 (LOCTEXT defaults). The AS3 tags
are upper-cased in code (`.toUpperCase()`).

| Where | Key | Verbatim string |
|---|---|---|
| Quick-chat panel title | `[QuickChat] QuickChat` | Quick Chat |
| Category names | `[ChatPresetGroups] Group1–6` | Informational · Compliments · Reactions · Apologies · Post Game · Pre Game |
| Chat-log tags (shown upper-case) | AS3 `ChatLogView` LOCTEXT `Team` / `Party` / `Spectator` / `You` | Team · Party · Spectator · You → TEAM · PARTY · SPECTATOR · YOU |
| Chat input hint (shown upper-case) | AS3 LOCTEXT `EnterChatMessage` | Enter chat message → ENTER CHAT MESSAGE |
| Chat input prompts | `[GFxHUD_TA] ChatTitle / TeamChatTitle / PartyChatTitle` | Send Chat Message · Send Team Chat Message · Send Party Chat Message |
| Player joined (chat log) | `[GFxHUD_TA] PlayerJoinString` | joined the match |
| Player left (chat log) | `[GFxHUD_TA] PlayerLeaveString` | left the match |
| Player lost connection (chat log) | `[GFxHUD_TA] PlayerTimedOutString` | lost connection |
| Spam notice | `[GFxHUD_TA] ChatDisabledMessage` | Chat disabled for [Time] second(s). |
| Chat-ban notice | `[GFxHUD_TA] ChatBannedMessage` | Chat is restricted for [Hours] hour(s), [Minutes] minute(s). |
| Permanent ban notice | `[GFxHUD_TA] ChatBannedPermanentlyMessage` | Chat is permanently restricted. |
| Binding names (Controls) | `[Chat] / [TeamChat] / [PartyChat] Label` | Text Chat · Team Text Chat · Party Text Chat |
| Binding names (Controls) | `[ChatPreset1–4] Label` | Quick Chat - Information/Post Game · Quick Chat - Compliments · Quick Chat - Reactions · Quick Chat - Apologies |
| Rebinding row titles (Settings) | `SettingsMenu ChatPresetGroup1–6` | Information (Team) · Compliments · Reactions · Apologies · Post Game · Pre Game |
| Filter setting | `[QuickChatFilter] Label / Description` | Quick Chat / Controls what types of Quick Chat messages from other players are visible. |
| Filter setting | `[NonTacticalQuickChatFilter] Label / Description` | Block Non-Tactical Quick Chat / Hides incoming non-tactical Quick Chat messages from other players during a match. Does not filter out Pre-game or Post-game Quick Chat. |
| Filter setting | `[MatchChatFilter] Label / Description` | Match Chat / Controls what types of text messages from other players are visible in Match Chat. |
| Filter setting | `[PartyChatFilter] Label / Description` | Party Chat / Controls what types of text messages from other players are visible in Party Chat. |
| Filter setting | `[FilterTextChat] Label / Description` | Filter Mature Language / This setting lets you filter mature language in text chat messages in Party Channels. The Mature Language filter will always be on in Game Channels, for players under 13, or if any splitscreen user has this setting enabled. |
| Filter options | `[Values] QuickChatPresetsEveryone / QuickChatTeamPresetsOnly / QuickChatFriendsPresetsOnly / QuickChatDisabled` | Allow Quick Chat with Everyone · Allow Quick Chat with Teammates Only · Allow Quick Chat with Friends Only · Off |
| Filter options | `[Values] MatchChatEveryone / MatchChatFriendsAndTeamOnly / MatchChatFriendsOnly / MatchChatDisabled` | Allow Text Chat with Everyone · Allow Text Chat with Friends and Teammates Only · Allow Text Chat with Friends Only · Off |
| Filter options | `[Values] PartyChatEveryone / PartyChatFriendsOnly / PartyChatDisabled` | Allow Party Text Chat with Everyone · Allow Party Text Chat with Friends Only · Off |

**Skipped** (user decision; the clone has neither feature): `CrossPlay.CrossPlayChatFilterHint` /
`CrossPlayChatFriendsFilterHint`, `HonorDuelChatRestriction`.

**Still by key only** (the voice-chat filter and party-chat errors stay by key because the clone lacks those features,
user 2026-10-10; the send-failure errors are not covered by the decision):
- `TAErrors.TextChatDisabled` / `SigningMessageFailed` (send-failure errors);
- `[VoiceChatFilter]` (voice chat);
- `PartyChatBlocked*` errors.

## Status in the clone (main session, 2026-10-10, protocol 11, uncommitted)
- **Done:**
  - CHAT-1..8: the 76 presets verbatim, the four categories with the post-game swap once the match has ended, the 24
    slots in settings with their pools, the four bindings (1-4 / D-pad; verbatim labels; never conflicting with
    freeplay's 1 and 2), the two-press menu and its timings.
  - CHAT-9: online only; not with the menu up, the filter Off or disconnected.
  - CHAT-10..12: the spam bucket on the server, per player, real time, shared by every channel; the notice.
  - CHAT-13..17: the panel, the log (lines, colours, [M:SS] at relay with + in overtime and none once ended, YOU), the
    join, leave and lost-connection lines from the roster, the chat sound on named lines.
  - CHAT-18: the Quick Chat filter (Everyone, Teammates Only, Friends Only, which reaches nobody else since the clone
    has no friends, Off) and Block Non-Tactical, on both sides on the server. The sender's team-only filter downgrades
    all to team.
  - CHAT-20: protocol 11 (`QuickChat`, `ChatFilter`, `Roster`, `Chat`, `ChatBlocked`; Hello's name); validated preset
    index.
  - CHAT-21: no bots yet.
- **Not done:** text chat (CHAT-22), mute and block (CHAT-19: needs the scoreboard), the harsh bucket (no bans), the
  party channel, the spectator tag (no spectators).
- **Tests:** server 4 (roster and names, channels and the clock, the spam bucket, both sides' filters); client unit
  (the lines, the roster lines, the settings, the menu); e2e (`forfeit.spec.ts`: the two presses, all and team, names,
  join and leave lines).

## Open
- **The mute path.** How the scoreboard Mute reaches the server's `VoiceMuteList`: `GFxData_PRI_TA.SetMuted` has no
  script body, and no ServerMutePlayer exists in script or exe strings. A clone can use an explicit `Mute{playerId}`
  RPC.
- **Unverified live:** the exact `GetMessageRecipients` ForbiddenPlayers test, and parts of the client `Say_TA`
  permission logic (recovered past decode errors).
- **Unclear:** whether `Features.QuickChatTimeStamp`, a feature flag that exists in the data API, gates timestamps
  anywhere. No AS3 or script reader was found, so timestamps are always shown before the match ends.
- **Line count** (~8) is computed from font metrics; a screenshot of a full log would confirm it.
