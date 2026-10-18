# Custom training editor (live build 2026-10-06): spec (static session, 2026-10-17)

Requested by the main session (Carball's training editor). Drafted by sub-agent TE1 (decodes and movie dumps local in
out/bsim/agents/TE1/). Companion to notes/custom-training.md (data model §1, `.Tem` §1.4, play §2, variance §4,
settings §5): this file covers the **editor** only (create, edit, shot list, editing a shot, test-play, back).
Publishing, codes and online browsing are out of scope.

Tags: **[A]** package data (TAGame.upk defaults, GameInfo_TrainingEditor_SF archetypes, Stadium_P, DefaultInput.ini),
**[S]** UnrealScript (TA:n = line in the shared TAGame dump, taken from CTR1's index `CTR1/work/ta_lines.txt`;
functions without a TA number are cited by name, decoded in `TE1/dec_s/`), **[G]** AS3 of the live movies
(GFx_TrainingEditorMenu = TEM, GFX_TrainingBrowserMenu = TBM, GFX_MidGameMenu = MGM, GFX_ControllerLayout = CL;
decompiles in `TE1/as3/`, HUD1's for MGM), **[L]** localization (`Section.Key`, English from Coalesced_INT),
**[I]** inferred. No native code was needed (no Ghidra run): every clamp below is in script.

Units as in custom-training.md: uu, uu/s, rotator units (65536 = 360°, 182.044/°), s. Field axes: goals at y = ±5120.

---------------------------------------------------------------------------------------------------------------------

## 1. Flow and states

### 1.1 Entry
- **Create** (Training → Custom Training browser, tab "CREATED" only) [G TBM `menus.TrainingBrowserMenu`]:
  button "+ CREATE NEW SEQUENCE" [L Global.CreateNewSequence] → the Sequence Settings dialog (§5.1) prefilled with
  name "New Sequence" [L Global.NewSequence], the first type (Striker), the first difficulty (Easy = "Rookie"), no
  tags and the map stepper on `TrainingModeConstants.DefaultMap` = **Park_P** [A].
  - Accept → `GFxData_TrainingModeBrowser_TA.CreateNew` [S]: `new TrainingEditorData_TA` + `Init` (fresh `TM_Guid`),
    name/type/difficulty/map/tags set, **saved at once** to `MyTraining\<guid>.Tem` (owned) with autoplay →
    `HandleAutoplay` → `LoadFile(file, map, bPlaytest = false)` → the editor loads (§1.2) [S].
  - On load the pack has 0 shots: `Load` → `SwitchToRoundNumber(0)` grows `Rounds` to 1, builds the default shot
    (custom-training.md CTR-3) and, because the pack had none, **saves again** (`SaveInternal`) [S TA:35532, 35773].
- **Edit** an own pack: browser "CREATED" tab → select → "EDIT" (gamepad X) → `TrainingModeRow.Play(MapName,
  false)` → `LoadFile` [G TBM `TrainingSequenceDetailsPanel.handleAction`; S TA:59723]. Only owned packs open in
  the editor: `LoadFile` adds `?Playtest` when `bInPlaytest || !bOwned`, so a downloaded/favourited pack always plays.
- `LoadFile` command: `Start <map>?Game=TAGame.GameInfo_TrainingEditor_TA?Offline?LoadSave=<file>` (no `?Playtest`),
  playlist `UGCTrainingEditor`; the map is validated against the map list, else Park_P [A S TA:59723, 60217].
- Other owned-pack actions in the details panel: "PLAY" (A), "DELETE" (Start) with a confirmation (§5.3) [G TBM].

### 1.2 State machine
Two machines run together: the game event (`GameEvent_TrainingEditor_TA`, archetype `InitialEventState =
'ShotSelection'` [A]) and the player controller (`PlayerController_TA`, state from the PRI's `PawnType`:
0 → `Driving`, 2 → `Editing` [S `PlayerController_TA.HandlePawnTypeChanged`]).
```
           load (GameInfo_GameEditor_TA.PostLogin → Load; SetupPlayer → SwitchToEditPawn)
                                   │
                                   ▼
   ┌──────────────── SHOTSELECTION (shot list menu) ◀──────── StopEditing ──────┐
   │      │ EDIT (click shot / A)            ▲                                  │
   │      ▼ StartEditing                     │                                  │
   │   EDITORMODE (shot editor) ─────────────┘                                  │
   │      │                                                                     │
   │      │ Test Shot  (EditorTestShot → ToggleEditorRound → StartPlayTest(0))  │
   │      │ Test Sequence (shot list only → TestSequence → StartPlayTest(2))    │
   │      ▼                                                                     │
   │   COUNTDOWN → ACTIVE → POSTGOALSCORED → (REPLAYPLAYBACK) → next round ...   │
   │      │  (custom-training.md §2.2–2.6, with the editor differences of §1.4) │
   │      └── EditorTestShot again (any playtest state) → EndPlayTest ──────────┘
   │             → GotoGameState(PrePlaytestState) = the state the test started from
   └── Pause → "SAVE AND EXIT" / "EXIT TO MAIN MENU" / "CHANGE MODE/MATCH" (§6.3)
```
- `GameEvent_TrainingEditor_TA` states used by the editor: `ShotSelection`, `EditorMode`, then the play states
  `Countdown`, `Active`, `PostGoalScored`, `ReplayPlayback` while testing. `IsInEditorMode()` = EditorMode or
  ShotSelection [S `GameEvent_GameEditor_TA.IsInEditorMode`].
- `ShotSelection` ↔ `EditorMode`: `ShotSelection.StartEditing` → `EditorMode` (TA:35877); `EditorMode.StopEditing`
  → `ReleaseActor` + `ShotSelection` (TA:36023). Both `BeginState`s record `PrePlaytestState` (TA:35862, 35918).
- **Test Shot**: `ToggleEditorRound` in `EditorMode` or `ShotSelection` → `StartPlayTest(0)` (TA:35986, 35873); in
  `Countdown`/`Active`/`PostGoalScored`/`ReplayPlayback` → `EndPlayTest` (TA:36074, 36148, 36257, 36284).
- **Test Sequence** (shot list legend only): `GFxData_TrainingModeEditor_TA.TestSequence` → `SetActiveRound(0)` +
  `StartPlayTest(2)` (TA:60318).
- `PlayTestType` [S `OnCurrentShotCompleted` TA:35842]: **0 = Test Shot**: after the shot ends nothing advances,
  so the same shot starts again; **2 = Test Sequence**: `IncrementRound()` with `bLoop` → next playable shot,
  wrapping forever; 1 = real play (not from the editor). There is no pack end in a test.
- `StartPlayTest` (TA:35419): `ReleaseActor`, `StartCountDown`, `SwitchToRoundNumber`, `ResetSpawnLocations`,
  hide car spawn meshes, `ServerChangeTeam(0)` (→ a car, `PawnType` 0, PC `Driving`), `EventPlaytestStarted`.
  Leaving `EditorMode`/`ShotSelection` runs `UpdateActiveRoundData`, so the edits are kept in memory (not on disk).
- `EndPlayTest` (TA:35449): destroy ball and car, clear timer/score, `GotoGameState(PrePlaytestState)`, show the
  spawn meshes, `ZeroAllInput`, `SwitchToEditPawn` (PawnType 2 → `Editing`), reload the shot from data (which also
  restores the shot's saved camera pose).
- `RestartPlayTest` (pause "RESTART TRAINING" while testing): `EndPlayTest`; Test Sequence restarts at shot 1;
  `StartPlayTest(same type)` (TA:35469).

### 1.3 What the world shows in each state
| State | View / pawn | Ball | Car spawn | Car | HUD (§6) |
|---|---|---|---|---|---|
| ShotSelection | editor pawn (`GameEditor_Pawn_TA`: invisible, flies, no gravity [A]); camera at the shot's saved pose; mouse cursor shown | the selected shot's ball, **asleep** (floats, no gravity), with the path preview | spawn mesh shown | none | shot list menu |
| EditorMode, free cam | fly camera (`Camera_GameEditor_TA` state `Edit`) | as above | as above | none | shot editor HUD, no strength meter |
| EditorMode, ball or car selected | camera locked behind the selected actor (§2.3) | edited live; still asleep | edited live | none | + strength meter at the actor |
| EditorMode after "Preview Trajectory" | — | **fired**: real physics with the launch velocity; not editable while awake (`CanEdit` = asleep and 0.02 s after a reset); resets when it enters a goal or on the next press | — | none | unchanged |
| Playtest (Countdown…Replay) | normal car camera; PC `Driving`, game input class | play rules of custom-training.md §2 | **hidden** | spawned at the spawn point | play HUD (TrainingView, §6.4) |
[S `PlayerController_TA.Editing.*`, `CameraState_GameEditor_TA.UpdateFlyPOV`, `Ball_GameEditor_TA.Fire/Reset/CanEdit`
TA:12187, 12199, 12332, `GameEvent_GameEditor_TA.EditorMode.HandleHitGoal`, `PlayerController_TA.Interact`; A archetypes]
- Visuals [A]: car spawn = static `Body_Octane.Body_OctaneWheels_SM` at z −25 from the spawn origin, collision
  cylinder r 50, half-height 25; its start-speed arrow (`CarVelocityPreviewComponent_TA`) when speed > 0. Ball path
  preview: `BallTrajectoryComponent_Mesh_TA` (8 s, 80 points, `BallVisualizer_SM` at 0.25 scale, grey #323232 →
  #7D7D7D → white by speed; the full path in the editor, 10 % in play); hidden when speed is 0
  (`ShouldDrawTrajectory`, TA:12155). The non-target goal shows the "disabled goal" hologram in the editor too.
- Sounds [A]: moving the car spawn loops `Car_Movement_InAirWhoosh_Loop`, the ball `Ball_Flying_Loop`; speed
  changes `UI_Training_BallStrength_Loop`/`_DirectionChange`; preview `UI_Training_TestTrajectory`; test
  `UI_Training_TestShot`; HUD: select ball/car `SWITCH_TO_BALL`/`SWITCH_TO_CAR`, free cam `SELECT`, shot list
  `TUTORIAL_MINIMIZE` [G TEM].

### 1.4 Test-play differences from real play [S]
- **No variance and no forced grounding**: `Countdown.OnBallSpawned`/`OnCarSpawned` skip `ModifyActorSpawn` and the
  "Spawn Vehicle On Ground" step when `IsEditing()` (TA:36103, 36055). The car starts exactly where the spawn was
  placed (in the air it falls, XY-held); the nudge-out-of-ground and the start-speed freeze still apply.
  Quirk: the HUD may still say "to Randomize Shot" when modifiers are set (`SetCanRandomizeShot(HasModifiers)`
  runs anyway, TA:100907) although nothing is randomized.
- **No points, no reset modal**: `Active.CanAwardPoints` = `bNoEditor` (TA:36185); `ShowPenaltyMessage` only when
  `bNoEditor` (TA:35686). No navigator/shuffle/mirror (created only when playtesting, TA:35340).
- Boost settings (Unlimited Boost, Starting Boost) do apply (the CustomTrainingSave subscription is unconditional).

## 2. Controls

### 2.1 Bindings (defaults) [A DefaultInput.ini; S `PlayerInput_TA.GetDefaultActions`]
Editor input class `PlayerInput_GameEditor_TA` removes the Driving, AirControl, Camera, Chat, Spectator,
SpectatorBase and Misc categories; the playtest uses `PlayerInput_Game_TA`, which removes Editor (keeps EditorBase,
so Test Shot works in play) [S `OnActiveBindingsChanged`].

| Action (Controls.int label) [L] | Command [S] | Keyboard/mouse | Gamepad | Effect |
|---|---|---|---|---|
| EditorCycleActor "Edit Object" | `EditorCycleActor` | Left Mouse | A | select ball → car → ball (§2.2) |
| EditorReleaseActor "Fly Cam" | `EditorReleaseActor` | Right Mouse | Y | deselect, camera back to the free-cam pose |
| StopEditing "Return to Shotlist" | `StopEditing` | Left Shift | B | EditorMode → shot list |
| EditorTestShot "Test Shot" | `ToggleEditorRound` | Tab (tap) | Back/View (tap) | start / end the test |
| EditorPreviewTrajectory "Preview Trajectory" | `Interact` | T | L3 | fire the ball / reset it (§1.3) |
| EditorToggleCamera "Toggle Camera Position" | `ToggleCameraPosition` | Middle Mouse | R3 | camera to the ball's other side |
| EditorIncreaseTime / EditorDecreaseTime "Increase/Decrease Time Limit" | `EditorIncrease/DecreaseRoundTime` | Up / Down | D-pad Up / Down | time limit ±1 s |
| EditorUndo / EditorRedo "Undo" / "Redo" | `EditorUndo` / `EditorRedo` | Z / X | D-pad Left / Right | §2.6 |
| EditorIncreasePower / EditorDecreasePower "Increase/Decrease Shot Power" | same | Mouse Wheel Up / Down | — | ±1 step per notch |
| EditorIncreasePowerToggle / …DecreasePowerToggle (same labels) | `…PowerToggle true \| onrelease …PowerToggle false` | **none** | RB / LB (held) | ±1 step, auto-repeat (§2.4) |
| EditorToggleRotatePitch "Toggle Lock Car Pitch" | same | R (press) | X (press) | car pitch lock on/off |
| EditorResetPitch "Reset Car Rotation" | same | R (hold) | X (hold) | lock pitch again, pitch = 0 |
| ReplayMoveForward/Backward/Right/Left "Move Forward/Backward/Right/Left" | axes aForward/aStrafe | W / S / D / A | left stick | move camera or selected actor |
| ReplayMoveUp/Down "Move Up/Down" | axis aUp | Spacebar / Left Ctrl | RT / LT (analog) | vertical |
| LookUp/Down/Left/Right "Spectator Look …" | aLookUp / aTurn | mouse | right stick | look; rotates the selected actor |
| ToggleMidGameMenu "Pause" | | Escape | Start | pause menu (§6.3) |
- Defined but **inert** in the editor: EditorShowControls (C / X) has no action entry; `EditorNextRound`/
  `EditorPrevRound`, `SpawnSelectedArchetype`, `RemoveActor`, `ToggleGrabActor`/`ToggleRotateActor` exist as
  functions with no binding [S A]. So no adding or deleting balls/cars, no shot switching from the editor view.
- Gamepad overlaps: RB is also ResetTraining (tap; no-op in EditorMode: `GameEvent_GameEditor_TA.ResetRound` empty);
  X press vs hold; Back tap = Test Shot (and Test Sequence in the shot list menu, §4) [A S].
- Tap/hold threshold is native; config has `TapTime=0.5`, `DoubleTapTime=0.25` [A]; tap < 0.5 s, hold ≥ 0.5 s [I].

### 2.2 Selecting
- `EditorMode.CycleActor` (TA:36017): if the ball is selected → select the first car spawn
  (`DynamicSpawnPointMesh`), else → select the first ball. From free cam it first saves the camera pose
  (`BackupEditorPawnOrientation`); else it closes the previous selection (history entry). The camera **snaps** behind
  the new actor. There is no click-to-pick: the crosshair trace is off in the training editor
  (`EditorMode.ShouldUpdateCrosshair` returns false, TA:35916) and the selection only cycles.
- `EditorMode.ReleaseActor` (TA:36011): drop the selection, restore the saved free-cam pose.
- HUD selection value `Editing` = 1 ball / 2 car / 0 free cam (`GFxHUD_GameEditor_TA.UpdateCarData`) [S].

### 2.3 Camera (`PlayerController_TA.Editing`, `PlayerControllerBase_TA.UpdateSpectatorLocation`) [S A]
- **Free cam**: horizontal move along the camera's yaw (`Normal2D` of forward/right), vertical along world Z.
  Max speed `SpectatorCameraSpeed` **2000** uu/s horizontal, **1000** vertical (×0.5); acceleration
  `SpectatorCameraAccel` **4000** (2000 vertical); `Brake = min(10·dt, 1)` removes the off-input velocity each frame
  and all of it with no input. Keys give full speed; a stick scales it by its deflection. Delta time is real time
  (divided by time dilation). [A PlayerController archetype; S]
- Look: mouse = raw `aLookUp`/`aTurn`; gamepad = axis × `GamepadLookScale` 20 × dt × 1000 (≈ 20000 units/s ≈ 110°/s
  at full tilt) [A S `GetSpectatorViewRotationDeltaRotation`]. Pitch clamp **±90°**, no roll [S].
- **Selected actor**: the movement keys move the **actor** (same flight model, relative to the camera yaw) and the
  look input **rotates the actor**; the camera follows: location = actor + `GetCameraPositionOffset` rotated by the
  view, rotation = the actor's `GetDesiredRotation`, blended with `RInterpTo`/`VInterpTo` at speed 3 (snap on
  selection) [S `Editing.UpdateRotatedActorOrientation`].
  - Ball: offset (−550, ±200, 0) (550 behind, 200 to the side; side starts at −1, "Toggle Camera Position" flips it);
    view = launch rotation with **pitch × 0.5** [A Ball_GameEditor archetype; S TA:12256].
  - Car spawn: offset (−300, 0, 25), view = yaw only; Toggle Camera Position does nothing (side offset 0) [A S].
- Camera and actor positions are clamped by `ClampSpectatorLocation` (§3.1).
- Each shot stores its camera pose (`IsPC` JSON, custom-training.md §1.1); entering a shot restores it. A new pack's
  first camera: spawn point + (−700, 600, 500) rotated by its yaw, pitch −15°, yaw −25°
  (`GameEvent_GameEditor_TA.SetupInitialPawnOrientation`, TA:33179) [S].

### 2.4 Ball and car parameters while selected [S]
| Parameter | Input | Rule |
|---|---|---|
| Ball position | move keys/stick | `EditorMoveToLocation`: `z = max(z, 100)`; no world collision (ball `bCollideWorld` false) (TA:12233) |
| Ball launch direction | look input | `AddVelocityStartRotation(delta)`: pitch clamped ±90°, yaw unbounded (not normalized), roll untouched (TA:12166) |
| Ball speed | wheel / RB-LB | `AddVelocityStartSpeed(±50)`, clamp [0, MaxLinearSpeed **6000**]; only while the ball is asleep (TA:12175, 77856) |
| Car position | move keys/stick | `MoveSmooth` (stopped by walls, floor, ceiling, goal frame: cylinder r 50, hh 25) (`GameEditor_Actor_TA.EditorMoveToLocation`) |
| Car yaw | look X | added, unbounded |
| Car pitch | look Y | 0 while locked (archetype `bModifiyPitchOnEditorSetRotation` **false**); unlocked: clamp ±90° (`MaxRotatePitch` 90) [A] |
| Car start speed | wheel / RB-LB | `±50`, clamp [0, MaxStartSpeed **2300**] (TA:104387) |
- **Repeat on RB/LB** (`EditorIncreasePowerToggle`, `BallVelocityIncrement*` [A]): one step on press, then a step every
  **0.25 s** (`BallVelocityIncrementSpeedDefault`); after 2 more such steps (count reaches
  `BallVelocityIncrementFireCountMax` 2, i.e. at 0.75 s) every **0.02 s** (`…SpeedMax`) = 2500 uu/s; release stops
  it. Full ball range 0 → 6000 ≈ 3.1 s; car 0 → 2300 ≈ 1.6 s. The wheel has no acceleration (one step per notch).
- No grid snapping, no numeric entry, no slow/fine modifier [S: none exists].
- Every change fires `EventTrainingEditorActorModified` → unsaved flag; a history entry 0.5 s after the last change
  (`SaveDelayTime`) [S TA:35953]. **Moving or turning the free camera also sets the unsaved flag** (the camera is
  saved per shot) [S `Editing.PlayerMove`, `UpdateSpectatorViewRotation`].

### 2.5 Time limit [S TA:35974–35980]
- Up/Down (D-pad) in EditorMode only: `FClamp(t ± 1, MinRoundTime 1, MaxRoundTime 59)`; default 10 (struct default).

### 2.6 Undo / redo [S `GameEvent_GameEditor_TA` TA:33394–33530]
- Per-actor JSON snapshots, `MaxUndoHistory` 1000; identical consecutive entries are dropped; undo re-selects the
  actor and restores it. **History is cleared on every shot switch** (`SwitchToRoundNumber` → `ClearAllHistory`).

### 2.7 Pad navigation in the editor's menus [S N] (TE2, 2026-10-18)
- The editor screen is part of the same UI movie as every other menu (`TAGameShell.validateUIState` opens `TrainingEditorMenu`),
  so MENU-12 (notes/hud-menus.md) applies unchanged: the D-pad and the left stick both arrive as arrow keys
  ([Scaleform.KeyMap]: `XboxTypeS_DPad_*` and `Gamepad_LeftStick_*` → Left/Right/Up/Down), and the movie can't tell them apart.
  - Stick: pressed at |axis| ≥ 0.8 (no deadzone), released below; the first axis to reach 0.8 owns the direction; repeat
    after 0.3 s, then every 0.1 s.
  - D-pad: repeat after 0.2 s, then every 0.1 s.
  - The stick-to-arrow switch is on for every player (0x140cd5780), in game too.
- **Shot list (ShotSelection):** `ShotSelectionMenu` sets receiveInput and captureAllInput (→ SetMovieCanReceiveInput,
  SetCaptureAllInput, FlushPlayerInput).
  - Up/Down moves the selected shot, and each move loads it (INDEX_CHANGE → SetActiveRound).
  - Left/Right moves across the row: SHOT n → duplicate → delete.
  - A held direction keeps scrolling (KEY_HOLD).
  - While the list is up, no pad input reaches the game: no camera move or look; the right stick and triggers are consumed
    (0x140ce7630).
- **Sequence Settings (§5.1):** focus opens on the name field. There Left/Right move the caret while it can move, and Up/Down
  leave the field. Elsewhere both axes move focus; an open dropdown takes Up/Down; B closes.
- **SAVE AND EXIT, DELETE SEQUENCE, the pause menu:** the first direction focuses the default button, the next ones move
  between buttons.
- **EditorMode:** the list is closed and the movie takes no input, so there is no menu navigation. The pad goes to
  PlayerInput: left stick = move (§2.1), D-pad Up/Down = time ±1 (§2.5), D-pad Left/Right = undo/redo (§2.6).

## 3. Limits and clamps

### 3.1 Placement bounds [S A]
- `ClampSpectatorLocation` (camera, ball and car alike): in pylon space `|x| ≤ FieldExtent.X + 1000`,
  `|y| ≤ FieldExtent.Y + 1000`; `z ≥ Pylon.GroundZ + 10` and `KillZ ≤ z ≤ StallZ` (unless the map has
  `PylonExtentOverride`, then that box). Stadium_P [A]: FieldExtent (5936, 4037, 750) with `FieldOrientation` yaw
  16384 → **|y| ≤ 6936, |x| ≤ 5037**; GroundZ 5 → **z ≥ 15**; `StallZ` 4096 (WorldInfo default) → **z ≤ 4096**.
  Park_P (the default editor map) was not decoded.
- **Ball**: additionally `z ≥ 100`; it passes through walls, the goal and the ceiling (only the box above limits it),
  so a ball can be placed inside the goal (seen in real packs) or even outside the arena.
- **Car spawn**: blocked by world collision, so it stays inside the arena, but may float at any height; real play
  forces it to the ground by default, the editor test does not (§1.4).
- Default shot placement drops both actors to the floor (custom-training.md §1.3 `AdjustToFloorLocation`): car
  spawn origin = floor + 25.

### 3.2 Ranges
| Item | Range, step | Default | Where |
|---|---|---|---|
| Ball speed | 0–6000, 50 | 1500 (new shot) | §2.4 |
| Ball launch pitch | ±90° | 45° (new shot) | §2.4 |
| Car start speed | 0–2300, 50 | 0 | §2.4 |
| Car pitch | 0 locked; ±90° unlocked | locked | §2.4 |
| Time limit | 1–59 s, 1 | 10 | §2.5 |
| Shots per pack | 1–50 (`MaxRounds`) | 1 | §4 |
| Name | 3–30 chars (trimmed) | "New Sequence" | §5.1 |
| Tags | 0–4 of 19 | none | §5.1 |
| Undo steps | 1000 | | §2.6 |

### 3.3 What the editor refuses
| Case | Behaviour | Text |
|---|---|---|
| Name shorter than 3 after trim | modal, dialog stays | "INVALID NAME" / "Please enter a valid name." / "OK" [L Global.InvalidNameTitle, Global.InvalidName, Global.OK] [G] |
| Name over 30 | the field stops accepting input (`maxChars` 30) | — |
| 5th tag | click ignored | — |
| 51st shot (create or duplicate) | nothing happens (`RoundData.Length < MaxRounds`, TA:60311, 60336) | — |
| Delete the only shot | trash button hidden; `DeleteRound` refuses (TA:35517) | — |
| Speeds, pitch, time, ball height out of range | clamped silently | — |
| Unplayable/corrupt file on test | modal then exit | "Error" / "Invalid or corrupted file loaded. Exiting now." / "OK" [L UIStrings_TA.Error, TrainingEditorMessages.InvalidTrainingMode] [S TA:35419] |
| Save to disk fails | browser path: save error modal "Retry" / "Cancel" [S `GFxData_TrainingMode_TA.HandleSaveError`]; editor "Save and Exit": the exit is skipped (`handleSaveTrainingSequenceResult(false)`) [G MGM] | error text from the save system |

## 4. The shot list (state ShotSelection) [G TEM `menus.ShotSelectionMenu`, `controls.ShotMenuListItem`; S]
- Rows "SHOT n" [L Global.ShotLabel "Shot %0", upper-cased] with the time limit right-aligned as **M:SS**
  ("0:10"); up to 17 rows visible, then a scroll bar.
- **Select**: hovering a row (mouse) or moving the selection loads that shot into the world at once
  (`SetActiveRound` → `SwitchToRoundNumber`), camera included.
- **Edit**: click the row's shot button (A) → `EditCurrentRound` → EditorMode.
- **Add**: "CREATE NEW SHOT" [L Global.CreateNewShot] button under the list (PC) or the hint "(Y) CREATE NEW SHOT"
  (gamepad, Y on key-up) → `CreateRound` → a new default shot appended and selected (stays in the list).
- **Duplicate**: row button on the selected row (always shown) → the copy is inserted after it and selected.
- **Delete**: trash button on the selected row, shown only when the pack has > 1 shot; **no confirmation**; the
  selection moves to the last shot if it was past the end.
- **Reorder**: a reorder button and `ReorderRound` (swap with the next, wrapping) exist, but the button is hidden
  in `configUI` and never shown → **no reordering in the live UI**.
- Row hints in the context area: "Modify the selected shot." / "Duplicate the selected shot." / "Delete the
  selected shot." [L Global.ModifyShotDesc, DuplicateShotDesc, DeleteShotDesc].
- Header: type icon, "<DIFFICULTY> <TYPE>" (e.g. "ROOKIE STRIKER") and the pack name in upper case.
- Button legend: "SEQUENCE SETTINGS" (X, key-up), "TEST SEQUENCE" (Back/View, key-down), "OPEN MENU" (Start; Escape on
  PC) [L Global.SequenceSettings, TestSequence, OpenMenu].
- **Per-shot settings: the time limit only** (set in EditorMode); the rest of a shot is its ball, car spawn and
  camera. A new shot is CTR-3's default (ball 1000 uu in front of the target goal, 45°, 1500 uu/s; car spawn at
  centre facing it; goalie variant) with time limit 10; the camera is not moved [I].

## 5. Pack details

### 5.1 Sequence Settings dialog [G TBM/TEM `tagame.controls.SequenceSettingsView`]
- Title "SEQUENCE SETTINGS"; fields: **name** (text input, placeholder "NAME", focused on open), **type** dropdown,
  **difficulty** dropdown, **tags** multi-select ("Select Tags" when empty, else the names joined by ","), and only in
  the create dialog a **map** stepper (map friendly names, upper case). Buttons "ACCEPT" / "CANCEL" (B closes).
  [L Global.SequenceSettings, Name, Accept, Cancel; TrainingTags.Tags]
- Types offered: **Striker, Goalie** (`GFxData_TrainingModeConstants_TA.Types` [A]); labels "Striker" / "Goalie"
  [L Training.*]. Aerial exists in the enum but is not offered.
- Difficulties: Easy / Medium / Hard shown as **"Rookie" / "Pro" / "All-Star"** [L Difficulties.Rookie, Pro, AllStar].
- Tags (enum order, index → label) [A enum; L TrainingTags.*]: 0 "Aerials", 1 "Bounces", 2 "Shots", 3 "Saves",
  4 "Clears", 5 "Rebounds", 6 "Redirects", 7 "Freestyles", 8 "Dribbles", 9 "Air Dribbles", 10 "Kickoffs",
  11 "Wall Shots", 12 "Long Shots", 13 "Close Shots", 14 "Angle Shots", 15 "Backwards Shots", 16 "Offense",
  17 "Defense", 18 "Pinch Shots". Max **4** selected (`NUM_MAX_SELECTED_TAGS`). ("Wall Bounces" has a string but
  no enum value.)
- In the editor ("SEQUENCE SETTINGS" in the shot list) the same dialog without the map: changing the type moves the
  hologram to the other goal but **does not move existing shots** [S `ShotSelection.SetMetaData` TA:35886].
- **Description**: no field anywhere in the UI (never stored, consistent with custom-training.md §1.4).
- Required: only the name (≥ 3 chars). Everything else has a default.

### 5.2 Saving [S G]
- Disk writes happen at pack creation, at the first shot of an empty pack, and on **save from the pause menu**
  ("SAVE AND EXIT", or "CHANGE MODE/MATCH" → Yes). There is no autosave on shot switch or test; edits live in
  memory until then. While saving: a processing modal "Saving" [L TrainingMode.SavingTrainingMessage].
- On save (`SaveInternal`, TA:35815): `UpdatedAt` = now for own packs; success clears the unsaved flag and re-inits
  the pack's progress.

### 5.3 Confirmations (verbatim) [G MGM, TBM; L]
| Trigger | Title | Body | Buttons |
|---|---|---|---|
| "SAVE AND EXIT" (unsaved) | "SAVE AND EXIT" | "Save changes to this sequence before exiting?" | "YES" (save, then exit) / "NO" (exit, changes lost) / "CANCEL" |
| "CHANGE MODE/MATCH" (unsaved) | "SAVE AND EXIT" | same | "YES" (save, then the play menu) / "NO" / "CANCEL" |
| "EXIT TO MAIN MENU" (no unsaved changes) | "EXIT TO MAIN MENU" | "Are you sure you want to exit to the main menu?" | "YES" / "NO" |
| "RESTART TRAINING" (test only; pack never uploaded) | "RESTART TRAINING" | "Restarting a created sequence will also reset any training progress made.\n\nAre you sure you want to restart this training session?" | "YES" / "NO" |
| same, uploaded pack | "RESTART TRAINING" | "Are you sure you want to restart this training session?" | "YES" / "NO" |
| Browser "DELETE" (own pack) | "DELETE SEQUENCE" | "Are you sure you want to delete this sequence?" | "DELETE" / "CANCEL" |
[L Global.SaveExit, ModalPopups.SaveExitInquiry, Global.ExitMainMenu, ModalPopups.ExitMainMenuInquiry,
Global.RestartTraining, ModalPopups.RestartTrainingInquiry(NonPublished), Global.DeleteModalTitle/DeleteModalDesc,
Global.Yes/No/Cancel/Delete]. Deleting a shot has no confirmation (§4).

## 6. HUD and menus

### 6.1 Shot editor HUD (EditorMode) [G TEM `ShotEditorView`, `ShotTimeView`, `ShotStrengthMeter`; layout at 1120×720]
- Top left: "SHOT" (HeaderFont 25, #43AFFF) at (46, 36); "n/total" (HeaderThin 55, white, blue glow) at (42, 59).
- Top right: clock icon, time "0:10" (HeaderFont 42, #49ACF5) and "TIME LIMIT" (SmallFont 15) at (1046, 62),
  anchored to the right edge.
- Left column at (41, 138), one row per 24 px: "<key> <label>", the key tinted #7BFCFF (key names from Keys.int or
  button icons). Rows, in order:
  1. "Test Shot" (EditorTestShot)
  2. "Edit Ball" or "Edit Car" (EditorCycleActor; shows the **next** target: "Edit Car" while the ball is selected,
     else "Edit Ball")
  3. car selected only: "Toggle Pitch Lock" (EditorToggleRotatePitch), "Reset Pitch (Hold)" (EditorResetPitch)
  4. not in free cam: "Free Cam" (EditorReleaseActor)
  5. "Shot List" (StopEditing)
  6. "Increase Timer", "Decrease Timer"
  [L Global.TestShot, EditBall, EditCar, RotatePitch, ResetPitch, FreeCam, ShotList, TimerIncrease, TimerDecrease]
- **Strength meter** (ball or car selected): placed at the actor's screen position; a 180×45 power bar 80 px below
  it, an arrow on an arc from +39° (speed 0, left) to −39° (max, right) = speed / max (6000 ball, 2300 car), the
  decrease/increase key glyphs (LB / RB actions) left and right, "STRENGTH" [L Global.Strength] under it.
  **No number is shown.** On PC the ±key labels are probably empty (the toggle actions have no PC key) [I].
- Left/right vignette backgrounds; no crosshair.
- Show Controls (pause menu) opens the controller layout screen listing every Editor, EditorBase and
  SpectatorMovement action with its key [G CL].

### 6.2 Shot list screen (ShotSelection) [G TEM]
- Left panel: type icon (15, 22), "<DIFFICULTY> <TYPE>" (HeaderFont 22, #43AEFF) at (100, 31), name (HeaderThin 55)
  at (100, 46), list at (20, 117), create button/hint under the list, context hint at (20, 650); the shot editor HUD
  is hidden and the mouse cursor shown.

### 6.3 Pause menu in the editor [G MGM `refreshButtons`]
Title "PAUSED" [L Global.Paused]. Entries in order (upper case):
| Entry | Shot list / editor | Test |
|---|---|---|
| "RESUME GAME" | yes | yes |
| "RESTART TRAINING" | — | yes (§5.3) |
| "CHANGE MODE/MATCH" | yes (offline) | yes |
| "SETTINGS" | yes | yes |
| "SHOW CONTROLS" | yes | yes |
| "SAVE AND EXIT" if unsaved, else "EXIT TO MAIN MENU" | yes | yes |
"Reset Progress", "End Training" and the playlist entries are play-only (they need the navigator) [G].

### 6.4 HUD while testing [G HUD TrainingView; custom-training.md §6]
- TrainingView with the **pack name** instead of the type label; timer (hidden for Goalie); "SHOT n/total".
- Controls panel: "{key} to Reset Shot" (or "{key} to Randomize Shot", §1.4 quirk) and **"{key} to Edit Shot"**
  [L Training.ExitTestInstructions] (EditorTestShot). No navigate/select/shuffle/mirror lines.

---------------------------------------------------------------------------------------------------------------------

## 7. Correction to custom-training.md §4.1
- The ball's aim is set by the **look input applied to the selected actor**
  (`Editing.UpdateRotatedActorOrientation` → `EditorSetRotation(delta)` → `AddVelocityStartRotation`), not by
  `EditorSetRotationFromInput` (250 units per input unit): that path belongs to the unbound grab mode. Power on PC is
  the mouse wheel only; RB/LB auto-repeat is gamepad-only. "T / L3" fires the ball (a physics preview), it is not the
  static path preview, which is always on.

## 8. Summary (TE-n)
| # | Item | Confidence |
|---|---|---|
| TE-1 | Editor = game states ShotSelection ↔ EditorMode, test = Countdown…Replay; PC Editing (PawnType 2) ↔ Driving (0); return to the state the test started from | high |
| TE-2 | Test Shot repeats one shot; Test Sequence loops all shots from shot 1; no points, no variance, no forced grounding, no navigator | high |
| TE-3 | Selection cycles ball ↔ car (LMB/A), RMB/Y back to free cam; camera locks behind the selection, look input rotates it, move input moves it | high |
| TE-4 | Fly camera 2000 uu/s (vertical 1000), accel 4000, brake 10/s, pitch ±90°; camera pose saved per shot | high |
| TE-5 | Ball z ≥ 100, no collision; everything clamped to the field box +1000 uu (stadium: abs x ≤ 5037, abs y ≤ 6936, 15 ≤ z ≤ 4096); car spawn collides with the world | high (Park_P box: open) |
| TE-6 | Speeds ±50 per wheel notch; RB/LB repeat 0.25 s ×3 then 0.02 s; ball 0–6000, car 0–2300; time 1–59 ±1 | high |
| TE-7 | Shot list: add, duplicate, delete (no confirm, not the last); no reorder in the UI; max 50; hover selects | high |
| TE-8 | Pack: name 3–30, Striker/Goalie, Rookie/Pro/All-Star, ≤ 4 of 19 tags, map at creation only, no description | high |
| TE-9 | Saves only at creation and from the pause menu (Save and Exit); verbatim modals §5.3 | high |
| TE-10 | HUD §6.1 (SHOT n/total, TIME LIMIT, prompts, strength meter without a number); pause menu §6.3 | high |

## 9. What Carball's editor needs
- **game** — States shot list ↔ shot editor ↔ test, test returns to where it started: the core loop players know.
- **game** — Test Shot (repeat one shot) and Test Sequence (loop from shot 1), toggled by one key (Tab): fast iteration.
- **game** — Test without variance or forced grounding: the test shows exactly what was placed.
- **game** — Ball ↔ car cycling plus free cam, camera locked behind the selection, look = aim, move = position: this is
  how shots are built in the game; keyboard/mouse bindings of §2.1.
- **game** — Clamps: ball z ≥ 100, pitch ±90°, ball speed 0–6000 and car 0–2300 in 50s, time 1–59 (default 10),
  50 shots, car pitch locked by default: the data must stay loadable by the play mode.
- **game** — Default new shot per type (CTR-3) and per-shot camera pose: new shots start playable.
- **game** — Pack settings (name 3–30, Striker/Goalie, Rookie/Pro/All-Star, ≤ 4 tags) and the save/exit prompt with
  verbatim texts: user-facing strings follow the game.
- **simplify** — Placement box: clamp the ball inside the arena (walls, ceiling) instead of the field box +1000,
  but keep allowing the goal interior: nobody needs balls outside the arena.
- **simplify** — Mouse-and-keyboard first; gamepad bindings (RB/LB repeat, X tap/hold) later: the editor is a
  desk tool.
- **simplify** — Undo/redo optional at first (history is per shot and cleared on switch anyway).
- **simplify** — Skip the physics "Preview Trajectory" fire (T); keep the always-on path preview: the test covers it.
- **simplify** — No map stepper (one arena), no reorder (the game has none), no upload/codes.
- **simplify** — Autosave or an explicit Save button is acceptable; the game's save-on-exit only is easy to lose work
  with (deviation: say so in the UI).

## 10. Open questions (live checks)
1. Tap/hold threshold for Tab, R and X (assumed 0.5 s = `TapTime`).
2. Shot list on PC: does Tab test the selected shot (menu `captureAllInput`), and which keys trigger "SEQUENCE
   SETTINGS" / "TEST SEQUENCE" besides clicking the legend?
3. Strength meter on PC: are the ±key labels empty?
4. Park_P's pylon box and StallZ (the default editor map).
5. Camera FOV in the editor (`Camera.DefaultFOV` vs the user's FOV setting).

## Work files
`out/bsim/agents/TE1/`: `dec/` (decrypted movie and GameInfo packages), `swf/`, `as3/` (decompiled movies),
`cls/` (split classes), `dec_s/` (script decodes: `editor.txt`, `pc_all.txt`, `getdefaultactions.txt`,
`onactive.txt`, defaults and archetype dumps), `tree/` (editor movie layout), `tools/` (copies of HUD1's movie tools,
`dumpsel.py`, `listclasses.py`, `listexports.py`, `whichexport.py`).
