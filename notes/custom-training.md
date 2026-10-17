# Custom training (live build 2026-10-06): spec (static session, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent CTR1 (patched re-decode and decompiles local in
out/bsim/agents/CTR1/). The static session re-checked the goal rule (GameEvent_TrainingEditor_TA.Active.HandleHitGoal:
the target goal counts only if Ball_GameEditor_TA.FirstHitTime > 0, or the pack type is Goalie) and the absence of any
rewind in the TAGame script.

Scope: RL's **Custom Training** (user/shared training packs, `GameInfo_TrainingEditor_TA` +
`GameEvent_TrainingEditor_TA`) as played ("playtest" in RL's code), enough to build a practice mode. The editor is
covered only where it shapes the data. The legacy Rookie/Pro/All-Star training is a separate system (§8).

Tags: **[A]** package data (TAGame.upk defaults, GameInfo_TrainingEditor_SF archetypes, DefaultInput.ini),
**[S]** UnrealScript (TA:n = `out/bsim/work/tagame_live_all.txt` line n; PX:n = PNT1 ProjectX dump),
**[N]** native (live addresses, Ghidra copy `out/bsim/agents/CTR1/rl-live`), **[G]** AS3 (HUD1 `GFX_Hud.HUD.all.txt`
= HUD:n, `GFX_MidGameMenu…` = MGM:n), **[L]** localization keys, **[I]** inferred.

Units: uu (Unreal units, cm), uu/s, Unreal rotator units (65536 = 360°, 182.044 per degree), game seconds (dilated
by game speed). Field axes as in the clone's arena: goals at y = ±5120, blue (team 0) at −y.

Script decoding notes: the shared dump fails on token `0x4B` (interface cast: `0x4B <class obj> <expr>`) and on some
array ops. I re-decoded the training classes with a patched copy of the G3 decoder
(`work/ubc/ubc.py`, output `work/te_patched.txt`) and hand-decoded the rest from raw bytes (cited as [S raw]).

---------------------------------------------------------------------------------------------------------------------

## 1. Data model

### 1.1 Where it lives in RL
- **Pack** = `TrainingEditorData_TA` [S/A classprops]: `TM_Guid`, `Code`, `TM_Name`, `Type`, `Difficulty`, `Tags`
  (`int[]` of `ETrainingTag` indices: the array's inner property is an IntProperty [A]), `Description`, `CreatorName`,
  `CreatorPlayerID`, `MapName`, `NumRounds` (CPF_Transient: never in the file), `CreatedAt`, `UpdatedAt` (QWord, Unix
  seconds UTC), `Rounds: EditorRoundData[]`. `Init` sets `TM_Guid = CreateGuid()` (TA:97338). On-disk form: §1.4.
- **Shot** = `_Types_TA.EditorRoundData { SerializedArchetypes: string[]; TimeLimit: float }`. Struct default
  **TimeLimit = 10.0** [A raw struct defaults].
- Each `SerializedArchetypes[i]` is a **JSON string** for one editor actor [S]:
  - **Ball** (`Ball_GameEditor_TA.Serialize`, TA:12270):
    `ObjectArchetype` (path of `Archetypes.Ball.Ball_GameEditor`), `StartLocationX/Y/Z` (float),
    `VelocityStartRotationP/Y/R` (int rotator), `VelocityStartSpeed` (float).
  - **Car spawn** (`GameEditor_Actor_TA.Serialize` TA:27025 + `DynamicSpawnPointMesh_TA.SerializeClassSpecific`
    TA:104379): `ObjectArchetype` (`Archetypes.GameEditor.DynamicSpawnPointMesh`), `LocationX/Y/Z`,
    `RotationP/Y/R`, `VelocityStartSpeed` (key optional on load: `HasKey`, TA:104382; absent in all 455 car spawns
    of the 20 real packs examined, §1.4).
  - **Editor camera** (`PlayerController_TA.Editing.EditorPawnSerialize`, TA:77892): `IsPC: true`, `LocationX/Y/Z`,
    `RotationP/Y/R`. Appended when the shot has any actor (`GetCurrentRoundData`, TA:35511 [S patched]). Not used in
    play; `DeserializeAndSpawn` diverts it to the editor pawn (TA:33373).
- **No spin field exists.** The ball is launched with linear velocity only (`Ball_GameEditor_TA.Fire`, TA:12187:
  `SetRBLinearVelocity(vector(VelocityStartRotation) · VelocityStartSpeed)`); no angular velocity is set [S].
  Confirmed on 20 real packs: every ball JSON (455) has exactly the 8 keys above, and no actor JSON (1,365) has any
  other key (§1.4) [A data].
- **Save wrapper** `SaveData_GameEditor_Training_TA` [A Default__]: `TrainingData`, `PlayerTeamNumber` (never
  written by script → always 0 = blue; never stored in the 20 files), `bUnowned`, `ShotsCompleted`,
  `bPerfectCompleted` (never stored in the 20 files), `LoadedSaveName` (CPF_Transient: never in the file).
  Files `..\..\TAGame\Training\<platform id>\{MyTraining\|Favorities\|Downloaded\}\<guid>.Tem` (sic "Favorities");
  `<guid>` = `TM_Guid` as 32 upper-case hex digits (4 × `%08X`); the Downloaded copies seen are named `Temp(n).Tem`.
- **Per-user progress** `TrainingProgressSave_TA.AllPacksProgress: TrainingPackProgress_TA[]`, each
  `{ PackCode, TimeLastPlayed, Progress: { RoundNumber, Status: NotAttempted 0 | Attempted 1 | Completed 2 }[] }`
  (TA:97599–97672).
- **Enums** [A]: `ETrainingType` None 0, **Aerial 1, Goalie 2, Striker 3**; `EDifficulty` Easy 0, Medium 1, Hard 2;
  `ETrainingTag` (19): Aerials, Bounces, Shots, Saves, Clears, Rebounds, Redirects, Freestyles, Dribbles,
  AirDribbles, Kickoffs, WallShots, LongShots, CloseShots, AngleShots, BackwardsShots, Offense, Defense, PinchShots.
  The create dialog offers **Striker and Goalie only** (`GFxData_TrainingModeConstants_TA.Types`, default map
  **Park_P**) [A]. Aerial survives in the enum and the HUD; play logic treats every type ≠ Goalie like Striker [S].

### 1.2 Clone type definition (proposed)
```ts
/** RL ETrainingType. Only Goalie (2) changes the rules; Aerial plays exactly like Striker. */
export const enum TrainingType { Aerial = 1, Goalie = 2, Striker = 3 }
export const enum Difficulty { Easy = 0, Medium = 1, Hard = 2 } // metadata only
export type Vec3 = { x: number; y: number; z: number };          // uu
export type Rotator = { pitch: number; yaw: number; roll: number }; // Unreal units, 65536 = 360°

export interface TrainingPack {
  id: string;                 // RL TM_Guid (local identity) — needed
  name: string;               // TM_Name — needed
  type: TrainingType;         // needed: picks the target goal and the success rule
  difficulty: Difficulty;     // display only
  tags?: number[];            // ETrainingTag indices, display/search only
  description?: string;
  creatorName?: string;
  code?: string;              // RL's server-assigned share code; optional in the clone
  mapName?: string;           // RL validates against its map list, default "Park_P"; the clone has one arena
  createdAt?: number; updatedAt?: number;
  shots: Shot[];              // 1..50 (MaxRounds)
}

export interface Shot {
  timeLimit: number;          // s (float); editor clamp [1, 59], step 1; default 10. 0 (hand-made data) = no timeout
  ball: BallSpawn;            // exactly one in packs made with the public editor
  car: CarSpawn;              // exactly one (RL picks randomly if a shot holds several)
}

export interface BallSpawn {
  location: Vec3;             // ball centre; editor keeps z >= 100
  launch: Rotator;            // direction = vector(launch) (pitch, yaw; roll unused); |pitch| <= 16384 (90°)
  speed: number;              // uu/s, editor range [0, 6000] (Ball.MaxLinearSpeed), step 50; 0 = floats until touched
}

export interface CarSpawn {
  location: Vec3;             // car origin
  rotation: Rotator;          // pitch 0 unless "lock car pitch" was turned off (then |pitch| <= 90°); roll 0
  startSpeed: number;         // uu/s along vector(rotation), [0, 2300], step 50; absent = 0
}

/** Per player and pack: what the progress pips and "completion %" show. */
export const enum ShotStatus { NotAttempted = 0, Attempted = 1, Completed = 2 }
export interface PackProgress { packId: string; lastPlayed: number; status: ShotStatus[] } // index = shot number
```
Packs in the clone (**user decision 2026-10-17**): Carball's own pack format (JSON, the fields of §1.2 / §1.4). The
`.Tem` converter stays local (`out/`, git-ignored), never in the repo or a build; the game's save key never ships.
The format is in §1.4 (decoder and writer local in `out/bsim/agents/TP1/`).

### 1.3 Ranges, defaults and limits
| Item | Value | Tag |
|---|---|---|
| Shots per pack | **max 50** (`MaxRounds`; `CreateRound`/`DuplicateRound` refuse beyond, TA:60311, 60336); min 1 (`DeleteRound` refuses the last, TA:35517) | A S |
| Time limit | float s; editor `±1` per press, clamp **[MinRoundTime 1, MaxRoundTime 59]** (TA:35980); default **10** | A S |
| Ball speed | **[0, MaxLinearSpeed 6000]** (`AddVelocityStartSpeed`, TA:12175); editor step **50** uu/s (`BallVelocityIncrementAmount`; held: first repeat after 0.25 s, then every 0.02 s after 2 repeats) | A S |
| Ball launch pitch | clamp **±90°** (`AddVelocityStartRotation` MaxDegrees 90, TA:12166) | S |
| Ball height | `z ≥ 100` (`EditorMoveToLocation`, TA:12233) | S |
| Car start speed | **[0, MaxStartSpeed 2300]**, step **50** (`VehicleVelocityIncrementAmount`) (TA:104387, 77856) | A S |
| Car pitch | locked to 0 by default (archetype `bModifiyPitchOnEditorSetRotation` false; TA:35998); unlocked: ±90° (`MaxRotatePitch` 90) | A S |
| Objects per shot (editor table) | Ball 3, car spawn 6, switch 6, ring 10, player ring 5 (`SpawnableArchetypes`) — but `SpawnArchetype` has **no caller** in script: public packs have exactly the default ball + car spawn | A S |
| Playable shot | needs ≥ 1 ball and ≥ 1 car spawn (`CanPlayTestRound`, TA:35484); unplayable shots are skipped; none playable → "Invalid or corrupted file loaded. Exiting now." [L TrainingEditorMessages.InvalidTrainingMode] | S |

**Default (new) shot** (`SetupDefaultRound` TA:35559, `SpawnBallAndStartPointAt` TA:35596) [S]:
- Striker/Aerial: ball at target-goal `Location + GoalDir·1000` = **(0, 4120, ·)** (orange goal, dir (0,−1,0)),
  launch yaw toward the field centre, **pitch 45°, speed 1500**; car spawn at the field centre facing the ball.
- Goalie: ball at the field centre, launch toward the player's own (blue) goal, pitch 45°, speed 1500; car spawn at
  the blue goal location facing the ball.
- Both actors are dropped to the floor: trace down 10000 with the actor extent (z extent 1), z = hit.z + half-height
  (`AdjustToFloorLocation`, TA:35619); the ball then gets z ≥ 100.

### 1.4 The `.Tem` file format (TP1, 2026-10-17)
Decoded from 20 real packs (other creators' packs from the user's install, 2.4–35 KB, created 2017–2025; local only,
never in the repo) and the live exe's save code. Scripts in `out/bsim/agents/TP1/`: `temfmt.py` (codec),
`temwrite.py` (writer from plain values), `temdump.py` (dump + checks). Both directions are byte-exact on all 20
files (decode → encode, and plain values → file). Little-endian throughout. **[N]** addresses are the live exe.

**Container** [N, verified 20/20]
| Offset | Type | Field |
|---|---|---|
| 0 | u32 | `PayloadSize` = file size − 8, a multiple of 16 |
| 4 | u32 | `Crc` = `appMemCrc(Payload, seed 0xEFCBF201)`: MSB-first CRC-32, poly 0x04C11DB7, inverted in and out (the keys/ report's `MemCrc`), over the **encrypted** payload |
| 8 | `PayloadSize` bytes | `Payload` = AES-256-**ECB**(plaintext + zero padding) |
- **Key**: the same key as `Coalesced_*.bin`: `Deobf(8 obfuscated dwords inline in 0x1402d85a0, seed 0xC1832A9E,
  salt "TA")` (06-16 build: `FUN_1402d45b0`). Derivation: `out/bsim/agents/keys/coalesced.py` (key never written
  out). It is neither the package key nor a content-key table entry. ECB, no IV (the first cipher block is identical
  in every file with the same header).
- **Padding**: zeros up to a multiple of 16 (0–15 bytes; 0 in 4 files), not PKCS#7.
- **Load** `0x140edc0e0`: `0x140e05e40` reads Size + Crc, fails if Size > the bytes left or the CRC
  (`0x1403a0a90`) differs; zero-pad (`0x1402e53c0`); decrypt (`0x1402dbe50`, key from `0x1402d85a0`); check the two
  magic words (wrong first word → load error 3); set the archive versions; deserialize the objects (`0x140e50810`).
- **Save** `0x140f33750`: serialize (`0x140f33800`; header writer at `0x140f339b5`), zero-pad, encrypt
  (`0x1402dc0b0`), prepend Size + Crc (`0x140e44450`, seed 0xEFCBF201). `0x140edf9b0` has the same tail behind a
  per-save "encrypt" flag.

**Plaintext** [N `0x140edc4d1`, `0x140f339b5`, `0x140e50810`, `0x140e0ab40`]
| Offset | Type | Field |
|---|---|---|
| 0x00 | u32 | Magic **0xF005BA11** (`.data 0x142338d40`) |
| 0x04 | u32 | **0x7FFFFFFF** (`0x142338d44`). Any other value: the loader assumes version 868 / licensee 20 (old layout, not seen) |
| 0x08 | u32 | FileVersion = `GPackageFileVersion` **868** |
| 0x0C | u32 | LicenseeVersion = `GPackageFileLicenseeVersion`: **32** in 19 files (older builds), **34** in 1 (the live build's value, `0x142264118`) |
| 0x10 | u32 | runtime global `0x1424a0bf0` (zero-initialized `.data`), read into the archive's version slot +0x14; 0 in all files; meaning unknown |
| 0x14 | i32 | `TableOffset`, relative to **base = 0x14** |
| 0x18 | object | root object = the save wrapper `SaveData_GameEditor_Training_TA` (class known to the caller, not stored) |
| … | objects | the referenced objects, in table order (always one: the pack) |
| base + TableOffset | table | i32 Count; Count × { FString ClassPath; i32 Offset (from base); i32 ObjectIndex } |
- Seen in all 20: one table entry `{ "TAGame.TrainingEditorData_TA", Offset, 0 }`; the file ends right after the table.
- **Object** = i32 NetIndex (−1) + tagged properties ending with the name "None" (UObject::Serialize).
- Saving writes the root, then each object it references (appended to the table as `<<UObject*` meets it), recording
  its Offset, then the table, then patches TableOffset [N `0x140e50b97`–`0x140e50cf2`].
- **ObjectProperty** value = i32 ObjectIndex (−1 = None) [N `0x140e0af20`, load side; save side I].

**Tagged properties** (UE3 v868 layout, names as strings) [N; A data]
- **FString**: i32 n; n > 0: n bytes Latin-1 incl. the NUL; n < 0: −n UTF-16LE units incl. the NUL; 0 = "".
  All 4,564 strings in the 20 files are ASCII (n > 0); no UTF-16 and no empty strings seen. Writer rule assumed:
  UTF-16 iff a char > 0x7F [I].
- **FName** = an FString of the name text (no name table): property names, type names, struct and enum names,
  NameProperty values, enum values [N `<<FName` `0x1403123f0`: reads an FString, then `FName(str, FNAME_Add)`].
- **Tag** = FString Name, FString Type, i32 Size, i32 ArrayIndex (0 in all files), type extras, value. Size counts
  the value only (not the extras).
  - `BoolProperty`: Size 0; one u8 value right after ArrayIndex (no trailing u32).
  - `ByteProperty`: extra FString EnumName; value = FString enum value name (`Training_Striker`, `D_Hard`,
    `OnlinePlatform_Steam`), or a u8 when EnumName is "None" (not seen).
  - `StructProperty`: extra FString StructName; `Guid` = 16 raw bytes (u32 A, B, C, D); any other struct = a nested
    tagged list + "None".
  - `ArrayProperty`: i32 Count + elements, element type from the class (not stored): struct → tagged list +
    "None" each (no struct name); string → FString; int → i32.
  - `IntProperty` i32, `FloatProperty` f32, `QWordProperty` u64, `StrProperty`/`NameProperty` FString,
    `ObjectProperty` i32.
- **Defaults omitted**: an object's properties equal to its class default are not written (no stored value equals the
  default in 20 files: Difficulty Easy, ShotsCompleted 0, bUnowned false, empty Tags/Description never appear).
  Struct-array elements (`EditorRoundData`) are written in full (TimeLimit 10 is stored).
- **Order** = the class's property order (TAGame export order reversed) [A]: wrapper `TrainingData,
  PlayerTeamNumber, bUnowned, bPerfectCompleted, ShotsCompleted`; pack `TM_Guid, Code, TM_Name, Type, Difficulty,
  CreatorName, Description, Tags, MapName, CreatedAt, UpdatedAt, CreatorPlayerID, Rounds`; shot `TimeLimit,
  SerializedArchetypes`; UniqueNetId `Uid, Platform`. (Places of Description, PlayerTeamNumber, bPerfectCompleted:
  from the class only, never seen.)

**Stored fields** (counts = files of 20 that store the field)
| Field | On disk | Values seen | Absent → | Clone (§1.2) |
|---|---|---|---|---|
| wrapper `TrainingData` | Object, i32 0 | table object 0 | — | — |
| wrapper `bUnowned` | Bool | true in 20 (packs of other creators) | false | — |
| wrapper `ShotsCompleted` | Int | best score of one run (`OnCurrentShotCompleted`, TA:35842); 13 files, 1–31 | 0 | progress, optional |
| wrapper `PlayerTeamNumber`, `bPerfectCompleted` | Int, Bool | never stored | 0, false | — |
| `TM_Guid` | Struct Guid | = the file name (§1.1) for the 18 non-Downloaded copies | zero GUID | `id` |
| `Code` | Str | `XXXX-XXXX-XXXX-XXXX`, upper-case hex, 20 | "" | `code` |
| `TM_Name` | Str | 6–30 chars, 20 | "" | `name` |
| `Type` | Byte `ETrainingType` | `Training_Striker` in 20 | `Training_None` | `type` |
| `Difficulty` | Byte `EDifficulty` | `D_Hard` 13, `D_Medium` 1, absent 6 | `D_Easy` | `difficulty` |
| `CreatorName` | Str | 4–16 chars, 20 | "" | `creatorName` |
| `Description` | Str | never stored | "" | `description` |
| `Tags` | Array of i32 (`ETrainingTag` index, §1.1) | 11 files, 1–4 tags each; 12 of the 19 tags used | [] | `tags` |
| `MapName` | Name | 11 different maps, mixed case (FName) | None | `mapName` (one arena in the clone) |
| `CreatedAt`, `UpdatedAt` | QWord | Unix seconds UTC, 2017–2025; Updated ≥ Created in all | 0 | `createdAt`, `updatedAt` (× 1000 for JS ms) |
| `CreatorPlayerID` | Struct `UniqueNetId`: `Uid` QWord (platform account id), `Platform` Byte `OnlinePlatform` (Steam, PS4, Dingo = Xbox) | 18 (absent in both Downloaded copies); NpId, EpicAccountId, SplitscreenID never stored | Uid 0, Unknown | not imported (account data) |
| `Rounds` | Array of `EditorRoundData` | 2–50 shots per pack, 455 in all, 3 packs at the max 50 | [] | `shots` |
| shot `TimeLimit` | Float, s | always stored; 1–59, whole seconds; 10 in 355 of 455 | (always present) | `timeLimit` |
| shot `SerializedArchetypes` | Array of FString (JSON) | exactly 3 per shot, in the order ball, car spawn, camera (455 of 455) | — | `ball`, `car` |

**Actor JSON** [S: `Ball_GameEditor_TA.Serialize`/`Deserialize` TA:12270/12285, `GameEditor_Actor_TA.Serialize`/
`Deserialize` TA:27025/27040, `DynamicSpawnPointMesh_TA.*ClassSpecific` TA:104379/104382,
`PlayerController_TA.Editing.EditorPawnSerialize` TA:77892; A data]
- Text: one object, no whitespace, keys in a fixed order, floats `%.4f` (`1500.0000`), ints plain, `true`.
  Re-printing all 1,365 strings from their parsed values with this rule gives the same text.
- Numbers: the script writes rotators with `SetIntValue` and reads them with `GetIntValue`, but 2 packs (26 shots)
  hold integer-valued **float** yaws (`n.0000` form) for ball and car, and 2 packs hold an all-zero **int**
  camera. A reader must accept int or float for every numeric key (the game truncates to int [I]).
- **Ball** (`ObjectArchetype` = `Archetypes.Ball.Ball_GameEditor`):
  - `StartLocationX/Y/Z` float uu, ball centre → `ball.location`. Seen: |x| ≤ 3991, y −4998…+5487, z 100.0…1938.
  - `VelocityStartRotationP/Y/R` int rotator units → `ball.launch`; direction `vector(P, Y)`, R has no effect.
    Seen: P within ±16383; **Y not normalized** (−456,351…+196,950, i.e. several turns in 5 packs: wrap mod 65536);
    R ≠ 0 in 1 pack (−399…+1798).
  - `VelocityStartSpeed` float uu/s → `ball.speed`. Seen 0–5900; 0 in 19 shots.
- **Car spawn** (`Archetypes.GameEditor.DynamicSpawnPointMesh`): `LocationX/Y/Z` float uu (z 16.5–52.3, i.e. the
  spawn mesh origin above the floor), `RotationP/Y/R` int (Y not normalized, −61,079…+141,520; P and R ≠ 0 only in
  the 2 Downloaded packs, |P| ≤ 1058 = 5.8°, |R| ≤ 538 = 3.0°), `VelocityStartSpeed` float uu/s: **absent in all
  455** (likely shots made before the car start speed existed [I]) → `car.startSpeed` 0.
- **Camera** (`IsPC: true`, `LocationX/Y/Z`, `RotationP/Y/R`): editor only, drop on import; all zeros in the 2
  Downloaded packs.
- **Missing keys**: only the car's `VelocityStartSpeed` is optional (`HasKey`, TA:104382; → class default 0). Every
  other key is read unconditionally with `GetFloatValue`/`GetIntValue`, i.e. 0 when missing [S; 0 = UE3
  `JsonObject` behaviour, I]. So a ball without `VelocityStartSpeed` gets 0 (frozen until touched), not the class
  default 2500.
- **Other actors**: none in 20 packs. `DeserializeAndSpawn` (TA:33373) would spawn any `ObjectArchetype` path that
  loads as an Actor of the requested class, but the public editor only creates the ball and the car spawn (§1.3).

**Sanity check** (all 455 shots, `temdump.py`)
- Every ball and car is inside the arena box (|x| ≤ 4096, |y| ≤ 5120 + goal depth, 0 < z ≤ 2044) and inside the
  corner planes; every ball has z ≥ 100 (the editor clamp; nothing below 92.75); ball speeds ≤ 6000; car start
  speed never stored; time limits 1–59; launch pitch within ±90°.
- Outliers, all legitimate editor output:
  - 3 balls (3 packs) placed **inside the orange goal** (|y| > 5120, |x| < 893, z < 643). The editor lets the ball be
    moved there, and a striker goal only counts after a car touch (§2.5). The clone must accept a spawn inside the
    goal volume and count it only after the first touch [I].
  - Unnormalized yaws (26 ball, 14 car spawns), ball launch roll (50 shots, 1 pack, no effect), small car pitch and
    roll (21 and 18 shots, 2 packs).
  - Balls next to a surface (not errors): 163 on the floor (z ≤ 103), 3 next to a side wall, 2 near a back wall, 2
    near a corner, 2 under the ceiling (gap < 60 uu).

**Converting into the clone's format** [I] (offline, with the local converter only; nothing of this ships)
- Decode as above; map `TM_Guid`, `TM_Name`, `Type` (value name → enum; anything but Goalie plays as Striker),
  `Difficulty` (absent = Easy), `Tags`, `Code`, `Description`, `CreatedAt/UpdatedAt`, and per shot `TimeLimit`, the
  ball and the car spawn. Drop the camera, `CreatorPlayerID`, `bUnowned`, `ShotsCompleted`, `MapName`.
- Wrap yaws into [0, 65536); clamp pitch to ±16384; ignore the ball's roll. Units are already uu, uu/s, s.
- Export (clone → `.Tem`) follows the same rules (`TP1/temwrite.py` rebuilds all 20 files byte for byte from plain
  values; a new file was not tried in the game). The loader rejects a file whose size, CRC or magic is wrong.

## 2. Play flow

### 2.1 Entry
`GFxData_TrainingMode_TA.LoadFile` (TA:59723): `Start <map>?Game=TAGame.GameInfo_TrainingEditor_TA?Offline?LoadSave=<file>?Playtest`,
playlist `UGCTraining` (editor: `UGCTrainingEditor`). The map is validated against the map list, else **Park_P**
(TA:60217). `OnInit` (TA:35340): playtesting → `TrainingEditorNavigation_TA` (if `bEnablePlaylistOverride`, default
**true**), `TrainingEditorMirror_TA` (if `bEnableMirroring` **true** and the map's `bCanMirrorTraining`, default
**true**), initial state `WaitingToPlayTest` → when the pack and loading movie are done, `StartPlayTest(1)`
(`PlayTest_IncrementRound`) (TA:35804). The player is always **team 0 (blue)** (`ServerChangeTeam(0)`, TA:35419).
Config defaults are `OnlineConfig_X` objects (server-overridable): `TrainingEditorNavigationConfig_TA`
(PlaylistOverride, Shuffling true), `TrainingEditorManipulationConfig_TA` (Mirroring true), `TrainingConfig_TA`
(`bEnableTrainingUIV2` true) [A].

**Target goal** (`GetBallGoalScoreNumber`, TA:35680): Striker/Aerial → `Goals[1]` (orange, opponent's);
Goalie → `Goals[0]` (own, blue). The *other* goal gets a **"disabled goal" hologram**
(`GoalMeshBlocker` = `FX_TrainingModeAdvanced.DisabledGoal.DisabledGoal_SM`, a plane ≈1990 × 678 uu at the goal's
Location/Rotation, `bDisableAllRigidBody` → **no collision**) (`UpdateGoalMeshBlocker`, TA:35719) [S A].

### 2.2 State machine
```
                 ┌──────────── Reset (re-roll variance, no penalty) ───────────┐
                 ▼                                                             │
StartNewRound(r) ─▶ COUNTDOWN (held, waits for input) ──────────────────────────┘
   ▲   ▲                 │ input (throttle≠0 | steer≠0 | jump | boost) after RestartRoundInputDelay,
   │   │                 │ or the car touches the ball
   │   │                 ▼
   │   │             ACTIVE (shot running, timer counting) ── Reset ─▶ [first time: warning modal] retry r
   │   │                 │ success: goal (striker) / save (goalie)        (ShotAttempt+1, variance kept)
   │   │                 │ fail:    own goal (goalie) / timeout + ball touches ground
   │   │                 ▼
   │   │             POSTGOALSCORED (3.0 game s, slow-mo) ── Reset ─▶ retry r (this shot's points removed)
   │   │                 │ unless "Skip Goal Replay"
   │   │                 ▼
   │   │             REPLAYPLAYBACK ── Reset ─▶ retry r
   │   │                 │ end
   │   └──── OnCurrentShotCompleted: r = next in playlist (wraps); ShotAttempt = 0
   │
   └── Next / Previous / Select shot / Mirror: from any state, StartNewRound(new r) at once (current shot abandoned)

All shots Completed for the first time ─▶ bShouldEndTraining ─▶ next StartNewRound ─▶ FINISHED
```
Note: RL's state-scoped variables (`Active.bFiredBalls`, `Active.BallExplosionCount`,
`PostGoalScored.bRedoingRound`, `ReplayPlayback.bSkipRoundIncrement`) are never cleared in script, yet every shot
fires its ball, so they **must reset on state entry** [I strong: `bFiredBalls` is only written in `FireBalls`, TA:36238].

### 2.3 StartNewRound(r) (TA:35378), in order
1. If `bShouldEndTraining` → `EndTraining` (destroy ball and car, `Finished`). Stop.
2. `StartCountDown` → enter **Countdown** (`Countdown.BeginState`, TA:36030): destroy ball and car;
   `PointsScoredThisRound = 0`; `GameTimeRemaining = Rounds[r].TimeLimit`, `SecondsRemaining = int(TimeLimit)`;
   `CountdownStartTime = now`; apply settings (`HandleCustomSettingsChanged`); **if r ≠ the last cached round →
   clear the variance cache**. Base Countdown: `SetAllDriving(false)` (TA:1858); `InitCountDown` is overridden to
   nothing (TA:36072), so **no 3-2-1 and no timer: Countdown lasts until input**. No GO! message
   (`BroadcastGoMessage` empty, TA:36319). (Leaving PostGoalScored/ReplayPlayback here runs their EndState, which
   advances r — §2.6.)
3. `SwitchToRoundNumber(r)` → `LoadRound`: delete old editor actors, spawn the shot's actors from JSON (TA:35532,
   35626). Ball: spawned **asleep** (`PutRigidBodyToSleep`, frozen in the air, no gravity) (TA:12130); ball variance
   (§4.2) applied in `Countdown.OnBallSpawned` (TA:36103).
4. `ResetSpawnLocations`; hide the car spawn meshes; `ResetPickups` (boost pads reset every shot); `ResetPlayers`
   → `RestartPlayer` → car spawned at a spawn point picked by `Rand(n)` (n = 1 in practice) at its exact
   Location/Rotation (`GetSpawnLocationAndRotation`, TA:33214).
5. Car setup in `Countdown.OnCarSpawned` (TA:36055):
   - car variance (§4.2), **force onto the ground** if "Spawn Vehicle On Ground" (default **on**): trace down 5000 uu
     with the car's bounding cylinder, origin z = hit − half-height + 13 (`RBActor_TA.ForceOnGround`,
     TA:101739; `GroundOffsetDistance` −13), then **pitch set to 0** (roll kept);
   - `NudgeCarOutOfGround` (only if pitch ≠ 0): trace the four bottom corners, lift by max penetration + 0.2
     (TA:103977);
   - car held: XY-locked 6-DOF constraint (`SetConstrained2D(true)`: linear X/Y locked, Z and rotation free —
     [N] `ARBActor_TA::execSetConstrained2D` 0x140e73cf0 → 0x140f35330) and not driving (no throttle, steer, jump,
     boost; see notes/camera-respawn-goal.md "Freeplay after a goal" step 5); a car above the ground falls straight
     down while it waits;
   - **start velocity freeze** if the spawn's `VelocityStartSpeed > 0` and the shot isn't mirrored:
     `Set3DConstraint(true)` = all 6 axes locked and velocities zeroed ([N] `execSetConstrained3D` 0x140e73d90 →
     0x140f35510), plus a velocity arrow (`CarVelocityPreviewComponent_TA`: length ∝ speed/2300, max scale 750)
     (TA:107718).
   - Boost (`OnVehicleSetup`, TA:103964): Unlimited Boost on (default) → unlimited; off →
     `SetBoostAmount(StartingBoost/100)`, except slider value 33 → exactly 0.333 (`DefaultStartingBoostInt` 33 →
     `DefaultStartingBoost` 0.333) [S A]. The car is a fresh car every shot (no carried boost/flip state).
6. `EventRoundStarted` → mirror applied if on (§2.8).

### 2.4 Countdown → Active (shot start)
- `Countdown.Tick` (TA:36087): once `now − CountdownStartTime ≥ RestartRoundInputDelay` (setting, default **0**;
  `RestartRoundCooldown` 0.1 only without a settings object), any player with **Throttle ≠ 0, Steer ≠ 0, Jump or
  Boost** starts the shot. Pitch/yaw/roll and handbrake don't [S].
- `Countdown.HandleCarTouch` (TA:36129): the car touching the ball also starts it.
- Start = `OnGameStateTimeLapsed` → `StartEvent` → **Active** in the same tick [S TA:1884].
- `Countdown.EndState` (TA:36043): ball listeners off, randomize flag off, 3D freeze off, velocity arrow removed.
- `Active.BeginState` (TA:36132): base `StartRound` → **car driving** (XY lock off); `ApplyStartingImpulse`:
  `AddForce(vector(car.Rotation) · VelocityStartSpeed, ForceMode_Velocity)` = Δv of that vector (TA:104010; [N]
  0x140e737c0 → 0x140eb27a0 → 0x140984560: mode 2 scales by mass → velocity change); **`FireBalls`**:
  `Ball.Fire()` (TA:12187): if asleep → wake, sleep again, and if `speed > 0` set linear velocity
  `vector(launch) · speed` (zero spin). **Speed 0 → the ball stays frozen until touched.** If the ball is already
  awake (touched during Countdown) `Fire` calls `Reset` instead: back to its start, asleep [S]. Progress for r is
  raised to **Attempted** (`EventRoundAttempted(r, 1)`).
- The input that starts the shot: a **jump** pressed while held is consumed (`Car_TA.OnJumpPressed` returns when not
  driving, TA:20440) [S]; whether the starting press itself jumps depends on intra-frame order [open, live check].
  Held boost/throttle/steer act from the first driving tick [I].
- Before the start the HUD shows a **ball-path preview** limited to the first 10 % of the trajectory
  (`TrajectoryPlayTestScale` 0.1 of 8 s / 80 points → ~16 small ball meshes, colour by speed/6000)
  (`BallTrajectoryComponent_Mesh_TA.GetTrajectoryScale`, TA:13192; archetype `TrajectorySettings`) [S A]; hidden in
  Active.

### 2.5 Active: timer, success, failure
**Timer** [S]: counts only in Active (`CanUpdateGameTime = GameTimeRemaining > 0`, TA:36165), on **game time**
(`GetDesiredDeltaTime = DeltaTime`, TA:36182, so it slows with Game Speed), from the shot start (not the first touch).
`SecondsRemaining = int(t) + 1` (TA:4199). At t ≤ 0: `WaitForEndRound` attaches `EndRoundComponent_TrainingEditor`
(TA:4216): if the ball is asleep (never fired/touched) → **fail now**; else **fail at the ball's next ground hit**
(`Ball_TA.OnHitWorld` with a ground normal and ground material, TA:11276) → `DestroyBall` (TA:27156). Goals still
count until then. A shot with `timeLimit = 0` never times out. Side effect of the shared Soccar clock: a shot
longer than 30 s broadcasts the archetype's "30 Seconds Remaining" message when SecondsRemaining steps to 30
(TA:4199) [S; not seen live].

**Striker / Aerial** (`Active.HandleHitGoal`, TA:36193):
- ball enters the **target goal** **and** the car has touched it (`FirstHitTime > 0`, set on the first car touch,
  TA:12160) → **success**: progress **Completed**, `PointsScoredThisRound++`, then the normal Soccar goal
  (TA:4061): the player's goal explosion, team score +1, **PostGoalScored**. No "scored" banner
  (`ShowScorerGoalMessage` false).
- ball enters the target goal **untouched** → ignored (no explosion), play continues.
- the other goal: ignored (it has no collision blocker; the ball can roll into its net).
- **no** "ball stopped" or "out of reach" check: the only failure is the timeout above.

**Goalie** (TA:36168, 36193, 36207):
- ball enters the **own goal** (touched or not) → **failure**: Soccar goal explosion, PostGoalScored.
- **save**: each tick, a ball touched by the car more than **1.0 s** ago that is **not moving toward the goal**
  → progress **Completed**, `DestroyBall` (red "no goal" burst `BallExplosion_RedTUT_FXActor`), PostGoalScored.
  `IsBallMovingTowardsGoal(goal, ball, minSpeed 200, depth 870)` (TA:34644):
  ```
  if |v| ≤ 200: false
  B = ball.xy; G = goal.xy; back = G − goalDir·870          # goalDir: the goal's facing (into the field)
  d = norm2D(back − B); m = norm2D(v.xy)
  R = G + goalY·halfWidth; L = G − goalY·halfWidth          # halfWidth = Goal.LocalExtent.Y = 960
  toward = d·m > min(d·norm2D(R − B), d·norm2D(L − B))
  ```
- an **untouched** ball that misses: fails at timeout + ground hit (the timer is hidden on the Goalie HUD but runs).
- Goalie score: `bShouldAwardGoaliePoint` is never set, so `GoalieScore` stays 0 (dead code); UI V2 shows progress
  instead [S raw].

**Failure presentation**: `DestroyBall` (TA:36207) swaps in the **NoGoal explosion** (red tutorial burst), calls
`ReplayDirector.GoalScored(ball, target goal, −1, −1)` and enters **PostGoalScored** — the same 3.0 s slow-mo and
replay path as a success [S]; whether a failed shot really shows a replay is a live check [open].

### 2.6 After the shot
- **PostGoalScored**: `PostGoalTime` **3.0** game s with `ScoreSlomoCurve` (0.125, 1), (0.225, 0.1875),
  (0.625, 1) [A archetype; GS-2]. Then `StartReplay`: destroy ball and car; **ReplayPlayback unless the training
  setting "Skip Goal Replay"** (`PostGoalScored.ShouldPlayReplayPlayback`, TA:36247 — the profile "Skip Goal
  Replay" is not consulted), else `StartNewRound`.
- `OnCurrentShotCompleted` (on PostGoalScored exit without replay, or ReplayPlayback exit; TA:35842):
  `PlayTest_IncrementRound` → `IncrementRound(false)`: with the navigator, next index in the active playlist,
  **wrapping** to the first (TA:97564 [S raw]); without it, past the last shot → `EndTraining`. Then `ShotAttempt = 0`.
  **Success and failure both advance to the next shot.**
- Pack end: when the last un-completed shot becomes Completed (status array goes all-Completed for the first time)
  and playlist override is on, `bShouldEndTraining = true` (`GFxData_Training_TA.HandleProgressUpdated`, TA:59356) →
  the next `StartNewRound` → **Finished** (+ challenge RPC with `bModifiersUsed`, TA:100917). What the Finished
  screen shows is not decoded [open].

### 2.7 Reset (retry / randomize), attempts, progress
- **Reset Shot** (`ResetTraining` → `PlayerResetTraining` → `ResetRound(bForceReset=false, bResetModifiers=true)`,
  TA:33157):
  - **Countdown** (TA:36078): event `ResetTrainingRound(bCanRandomizeShot)`, **re-roll variance**, restart the
    shot. HUD: "{key} to Randomize Shot" when any modifier is non-zero, else "{key} to Reset Shot"; randomize plays
    `TRAINING_RANDOMIZE` [L Training.RandomizeShotInstructions / ResetShotInstructions, G HUD TrainingView].
  - **Active / PostGoalScored / ReplayPlayback** (TA:36152, 36261, 36289): the **first time ever** (per user,
    `UISavedValues` `UserTrainingResetRoundWarning`) a modal "By resetting, you will not earn points by completing
    the round. Would you like to continue?" Yes/No [L TutorialMessage.RoundResetBody]; then `CommitRedoRound`:
    `ShotAttempt++`, `RedoTotal++`, points of this shot removed (post-goal states), same shot again, **variance
    kept** (cache not cleared). No cooldown [S].
- **Progress** (`TrainingPackProgress_TA`, TA:97599–97672): per shot NotAttempted → Attempted (shot started) →
  Completed (success); `SetAttemptByRoundNumber` only raises the status [S raw]. At pack start, statuses below
  Completed reset to NotAttempted (`ClearUncompletedShots`). "Reset Progress" in the pause menu re-inits all [G MGM].
- `ShotAttempt`/`RedoTotal`: telemetry only. Legacy `ShotsCompleted` = best team score, saved to the pack file.

### 2.8 Navigation, shuffle, mirror (playtest commands, any state)
- Playlist (`TrainingEditorNavigation_TA`, TA:97493–97592): `UnshuffledPlaylist` = the playable shots in pack order
  (from progress); `ActivePlaylist` = that list or a shuffled copy.
- **Next / Previous** (`GameEventCommand TrainingNavigationCommand_NextShot|PreviousShot`): active index ±1,
  **wrapping** both ways; starts that shot immediately; `ShotAttempt = 0` [S].
- **Select Shot** menu (`OpenShotSelectionMenu`): `StartAtUnshuffledPlaylistIndex(i)` [S TA:59437].
- **Shuffle** toggle (`ToggleShuffle`): off at every pack start; on → `ActivePlaylist` = Fisher–Yates shuffle of
  the pack order (`ArrayFuncs__ShuffleArray__Int`, TA:30437: `for i = n; i > 0;) { j = Rand(i); --i; swap(a[i], a[j]) }`),
  then the active index moves to the current shot's new position (current shot unchanged); off → pack order,
  same shot [S raw TA:97574]. HUD shuffle icon fades 0.2 s.
- **Mirror** (`TrainingManipulationCommand_MirrorShot`, TA:97414): toggles `bMirrorShot`, then
  `ResetRound(bForceReset=true, bResetModifiers=false)` (variance kept). Mirror stays on for this shot until the shot
  number changes (then cleared). Applied on round start: plane through `Pylon.FieldCenter`; for the stadium
  (`MapInfo_TA` default `MirrorFieldType = MFT_XY`) angle yaw 16384 → normal (−1, 0, 0) → **x ↦ 2·cₓ − x** with
cₓ = FieldCenter.x (0 in the stadium [I]), y and z kept: ball start location and
  launch yaw `yaw' = 32768 − yaw`, car location and yaw likewise; car re-grounded if "Spawn on Ground" and its
  velocity freeze re-applied (`OnMirroredCar`, TA:100850; `MirrorUtils_X`, PX:8289) [S A]. Goals swap only on
  maps with `bMirrorTrainingSwapsGoals` (default false).

### 2.9 Default bindings [A DefaultInput.ini]
| Action | Keyboard | Gamepad |
|---|---|---|
| Reset / Randomize Shot (`ResetTraining`) | Backspace | RB (tap) (single Joy-Con: LT+RT [G]) |
| Previous / Next shot | Left / Right | D-pad Left / Right |
| Toggle Shuffle | Up | D-pad Up |
| Mirror Shot | Down | D-pad Down |
| Select Shot menu | Enter | Back/View |

## 3. Rewind
**RL 2026-10-06 has no rewind in custom training (or freeplay)** [S N A L, high]:
- no script symbol (no function, state, property or class containing "Rewind" in TAGame/ProjectX/Engine dumps
  except `Actor.PostDemoRewind`, `WorldInfo.GetDemoRewindPoints`, particle `RewindEmitterInstance(s)`);
- no native beyond those demo/particle ones (natives.csv); exe strings: only demo playback ("Demo playback wrote rewind
  point", `DEMOREWIND`) and libcurl;
- no input action: the only "Rewind" label is the **replay viewer's** `ReplayScrubBackward` [L];
- no training setting or HUD element (InitTrainingSettings TA:56001; TrainingView HUD).
- The editor's Undo/Redo (`UndoHistory`, `MaxUndoHistory` 1000, TA:33394–33530) records object edits only.

The nearest RL features are Reset Shot (restart the current shot, §2.7) and the goal replay. A rewind would be a
clone-only invention; I have not specified one. Decision for the user (open question Q1).

## 4. Ball placement and variance
### 4.1 Editor controls that shape the data
- Ball: grab/move (`EditorMoveToLocation`, z ≥ 100); aim = launch rotation from the camera/stick
  (`EditorSetRotationFromInput` 250 units per input unit, pitch clamp ±90°); power ±50 uu/s (mouse wheel / RB-LB
  held); trajectory preview (T / left stick). [S A]
- Car spawn: move/rotate (yaw from the camera; pitch only after "Toggle Lock Car Pitch" R / X; hold R / X resets the
  rotation); start speed ±50 uu/s up to 2300. [S A]
- Time limit ±1 s (Up/Down, D-pad Up/Down), clamp 1–59. [S A]

### 4.2 Training variance ("Actor Modifiers"; `CustomTrainingSave_TA`)
Applied during Countdown only, when playtesting, to the shot's spawned actors. `U(a, b) = a + (b − a)·FRand()`,
`FRand = rand() / 32767.0` (MSVC CRT `rand`, 15-bit, both ends inclusive) [S Object.RandRange; N
`UObject::execFRand` 0x140361230]; `Rand(n) = int(rand() · 2⁻¹⁵ · n)` [N 0x14035f510].

**Position/rotation** (`Countdown.ModifyActorSpawn`, TA:100855), for actor A with modifiers (L, H, R, ground):
```
if L == H == R == 0 and not ground: return
ext = (r, r, h) from A's bounding cylinder
repeat up to MaxOffsetAttempts = 8:
  if cache[A.class] exists: P, Q = cached location, rotation           # same values on retry
  else:
    P = capped(A.loc,  (U(−L, L), 0, 0)); P = capped(P, (0, U(−L, L), 0)); P = capped(P, (0, 0, U(−H, H)))
    Q = A.rot + (0, U(−R, R)·182.044, 0)                                # yaw only
  if A.SetLocationAndRotation(P, Q):
    if ground: A.ForceOnGround()
    if any of L, H, R ≠ 0: cache[A.class] = (P, Q)
    return
capped(from, d) = swept trace of ext from `from` to `from + d`: stop at the first hit, else `from + d`
```
World axes (not shot-relative). Each axis is drawn uniformly and independently; the draws use 4 `FRand` per
attempt (x, y, z, yaw — zero-width ranges still draw).
- **Ball**: L = Ball Location Modifier, H = Ball Height Modifier, R = 0, no grounding. Then
  **speed** (`Countdown.OnBallSpawned`, TA:36103): `s = U(−S, S)` (or the cached s), `speed' = speed·(1 + s)`
  (no clamp in script; the ball's MaxLinearSpeed 6000 still caps physics) [S]. Direction and spin: **no variance**.
- **Car**: L = Vehicle Location Modifier, H = 0 (the call passes an empty parameter, [S raw]), R = Vehicle Rotation
  Modifier (degrees), ground = Spawn Vehicle On Ground. Car pitch and start speed: no variance.
- **Cache lifetime** (`CachedLocationModifiers` / `CachedSpeedModifiers`, keyed by actor class): kept across
  retries of the same shot (Active/post-goal resets, mirror) and **cleared** by a Countdown reset ("Randomize")
  or by moving to a different shot number (TA:36030, 100846).
- `bCanRandomizeShot` (HUD hint) = any modifier ≠ 0 (`HasModifiers`, TA:100400), only during Countdown.

| Setting (key) | Range, step | Default | Tag |
|---|---|---|---|
| Ball Speed Modifier (`TrainingBallSpeedModifier`) | 0–1 (fraction; shown as %), 0.01 | 0 | A L |
| Ball Location Modifier | 0–1000 uu, 10 | 0 | A |
| Ball Height Modifier | 0–1000 uu, 10 | 0 | A |
| Vehicle Location Modifier | 0–1000 uu, 10 | 0 | A |
| Vehicle Rotation Modifier | 0–100°, 1 | 0 | A |
| Spawn Vehicle On Ground (`TrainingVehicleForceGround`) | bool | **on** | A |

## 5. Training settings
Created by `GFxData_Settings_TA.InitTrainingSettings` (TA:56001); limits from `Default__GFxData_Settings_TA`,
defaults from `Default__CustomTrainingSave_TA` / `Default__GameplaySettingsSave_TA` [A]. Saved per user
(`CustomTrainingSave_TA` JSON save object) [I].

| Setting (localization key) | Values | Default | Shown in | Effect |
|---|---|---|---|---|
| Game Speed (`TrainingGameSpeed`) | 0.5–1.0, step 0.05 | 1.0 | freeplay, custom training (play) | `SetTimeDilation(speed)` on the event and world (TA:35370); timer and physics slow together |
| Controls Display (`TrainingControlsDisplay`) | Visible / Hidden / Fade Out | Visible | freeplay, custom training | HUD controls panel; Fade Out = visible 5 s, then 2 s fade [G HUD TrainingView] |
| Round Start Input Delay (`TrainingRestartRoundInputDelay`) | 0–0.1 s, 0.01 | 0 | custom training | min time in Countdown before input can start the shot (§2.4) |
| Skip Goal Replay (`TrainingSkipGoalReplay`) | bool | off | custom training | skip ReplayPlayback after every shot (§2.6) |
| Ball/Vehicle modifiers, Spawn On Ground | §4.2 | §4.2 | custom training | §4.2 |
| Unlimited Boost (`TrainingUnlimitedBoost`) | bool | **on** | custom training (play and editor) | unlimited boost |
| Starting Boost (`TrainingStartingBoost`) | 0–100, 1 (disabled while unlimited) | 33 | custom training | boost at spawn = value/100 (33 → 0.333) |

**Not offered in custom training** [S]: Goal Reset / Disable Goal Reset (`TrainingDisableGoals`,
`TrainingGoalResetOptions`), Boost Options (Unlimited/Standard/Auto-Refill) and Boost Recharge Delay, Use Default
Team Colors, Draw Vehicle Hitbox — all freeplay-only. Shuffle and Mirror are runtime toggles, not settings
(shuffle resets to off each pack start). There is no rewind setting. The legacy "limited boost" equals Unlimited Boost
off + Starting Boost.

## 6. Differences from freeplay (notes/camera-respawn-goal.md GS-14 and "Freeplay after a goal")
| Aspect | Freeplay | Custom training |
|---|---|---|
| Stats / stat popups | none (STAT-23) | none (no StatFactory; STAT-23) [A] |
| Round start | Countdown 0 → released after 0.01 s without input | Countdown waits for throttle/steer/jump/boost (after 0–0.1 s delay) or a car–ball touch; no GO!, no 3-2-1 [S] |
| Ball before start | (0, 0, 100.49) at rest, XY-locked | frozen asleep at the shot's position (no gravity), path preview shown [S] |
| Ball release | free physics | launched at shot start with `dir·speed`, no spin; speed 0 = frozen until touched [S] |
| Car spawn | 10 alternating kickoff spots | the shot's spawn (+ variance), forced to ground by default, optional start velocity (frozen until start) [S] |
| Reset key | `FreeplayCommands_TA.ResetTraining`, 1.0 game-s cooldown → kickoff reset | Reset Shot: re-roll (Countdown) or retry the shot (Active; first-time modal); no cooldown [S] |
| Goals | either goal scores; Disable Goal Reset option | only the target goal; striker needs a car touch; goalie = own goal is a failure; other goal shows a non-colliding hologram [S A] |
| After goal | PostGoalScored 3.0 s slow-mo → replay unless **profile** Skip Goal Replay → kickoff | same 3.0 s slow-mo → replay unless **training** Skip Goal Replay → next shot (also after failures) [S] |
| Timer | none | per shot (default 10 s), game time, timeout + ground hit = fail [S] |
| Boost | Boost Options (Unlimited default / Standard 33.3 / Auto-Refill 1.5 s delay) | Unlimited (default) or Starting Boost 0–100 each shot; pads reset each shot [S] |
| Camera | car camera; resets on the new car each reset (CAM-27) | same camera; the car is destroyed and respawned every shot, so it resets every shot [I] |
| HUD | scoreboard hidden (HUD-4); freeplay controls hints | scoreboard hidden; **TrainingView** (below) |

**TrainingView HUD** [G HUD:56643–57296]: type label (STRIKER / GOALIE / AERIAL; the pack name when testing from
the editor) with icon (BulletGoal / Clear / AerialGoal); **"SHOT n /total"** where n = position in pack order + 1
(UI V2, TA:59380); **timer** M:SS (hidden for Goalie), from ≤ 3 s in Active the digits flash blue (scale 1.1–1.2 →
1 over 0.4 s) with a countdown beep at 3, 2, 1; **completion pip bar** 275 × 18: one pip per shot in pack
order, lit when Completed (Attempted looks like NotAttempted), a highlight head over the current shot
(`PipProgressBar.SetData`), and "COMPLETION x %" = round(100·completed/total); shuffle on/off icon; controls panel at (10, 104), 350 wide,
24 px rows: Reset/Randomize Shot, Navigate Shots, Select Shot, Shuffle, Mirror (key names tinted #7BFCFF). Shot change
pops the shot number (glow 4× → 1, 0.8 s) with a tab sound. Pause menu adds Reset Progress, Restart Training,
End Training, Change Training [G MGM].

## 7. Physics identity
The training ball archetype is the match ball (`Ball_DefaultBall00`, `Physmat_Ball`, mass 30, MaxLinearSpeed 6000,
MaxAngularSpeed 6, same car–ball push curve) [A]; the car is `Archetypes.Car.Car_Default` with the player's body [A I].
So the clone's engine needs no training-specific physics beyond: sleeping (frozen) ball, the XY hold and full 3D
freeze constraints, and a velocity-change impulse.

## 8. Official Rookie / Pro / All-Star training
Separate system, **not** the custom-training data model [S A]: `GFxData_Training_TA.PlayTraining` (TA:59389) loads
**Park_P** with `GameInfo_Tutorial_TA` and options (Striker/Goalie/Aerial, difficulty). `GameEvent_Training_*_TA`
(TA:34400–35307) generate shots procedurally: per difficulty a list of "waves" of spawn extents for car and ball,
random picks without repetition, a ball cannon, velocities from aim points (`GetRandomGoalAimLocation`,
`PredictInitialVelocity`). **10 shots**; pass marks 4 / 6 / 8 for Rookie / Pro / All-Star
(`TotalGameEventRoundsToWin`) [A]. Shared pieces only: the TrainingView HUD, the retry-penalty modal flag and
`IsBallMovingTowardsGoal`. A clone could ship its own Psyonix-style packs as ordinary custom packs instead [I].

---------------------------------------------------------------------------------------------------------------------

## Summary (CTR-n)
| # | Item | Confidence |
|---|---|---|
| CTR-1 | Pack = metadata (name, type Striker/Goalie(/Aerial), difficulty, tags, description, creator, code, map, dates) + 1–50 shots; only type changes play rules | high |
| CTR-2 | Shot = time limit (float s, default 10, editor 1–59) + ball {location, launch rotator, speed 0–6000} + car spawn {location, rotation, start speed 0–2300}; **no spin**; JSON keys in §1.1 | high |
| CTR-3 | Default shot: ball 1000 uu in front of the target goal (goalie: field centre), pitch 45°, 1500 uu/s; car at the field centre (goalie: own goal) facing it; both floored | high |
| CTR-4 | Player is always blue; striker/aerial target = orange goal, goalie defends blue goal; the other goal shows a non-colliding "disabled goal" hologram | high (collision: medium) |
| CTR-5 | Countdown has no timer: car held (XY lock, not driving), ball frozen asleep, path preview; shot starts on throttle/steer/jump/boost after the input delay (default 0) or a car–ball touch | high |
| CTR-6 | Shot start: car released + start-velocity Δv; ball launched `vector(rot)·speed`; speed 0 → frozen until touched; progress → Attempted | high |
| CTR-7 | Timer runs from shot start on game time; at 0 the shot fails at the ball's next ground hit (immediately if the ball is still asleep) | high |
| CTR-8 | Striker success = ball in the target goal after a car touch (untouched entries ignored) | high |
| CTR-9 | Goalie failure = ball in own goal; success = ball touched > 1 s ago and not heading goalward (or slower than 200 uu/s); formula §2.5 | high |
| CTR-10 | Success and failure both: explosion (player's / red), 3.0 s slow-mo, replay unless training Skip Goal Replay, then the next shot (wrapping) | high (replay after a failure: medium) |
| CTR-11 | Reset in Countdown re-rolls variance; during/after a shot it retries the same shot (first-time penalty modal, variance kept); no cooldown | high |
| CTR-12 | Progress per shot NotAttempted/Attempted/Completed, only rises; uncompleted reset at pack start; pack ends (Finished) when all shots become Completed | high (Finished screen: low) |
| CTR-13 | Next/Prev wrap and start at once; Select Shot; Shuffle = Fisher–Yates keeping the current shot; Mirror = x ↦ −x, yaw ↦ 32768 − yaw, kept until the shot changes | high |
| CTR-14 | Variance: ball XY ±L, Z ±H, speed ×(1 ± S); car XY ±L, yaw ±R°; uniform per axis via `rand()/32767`, swept-trace capped, ≤ 8 attempts, cached per shot until re-roll/shot change; ranges §4.2 | high |
| CTR-15 | Settings and defaults (§5): Game Speed 0.5–1 (1), Controls Display, Input Delay 0–0.1 (0), Skip Goal Replay (off), modifiers (0), Spawn On Ground (on), Unlimited Boost (on), Starting Boost 0–100 (33 → 0.333); no goal-reset or boost-options settings | high |
| CTR-16 | **No rewind** exists in the live build (the user confirmed live: no rewind button). The clone matches: no rewind for now | high |
| CTR-17 | Freeplay differences table §6; no stats in either | high |
| CTR-18 | Ball/car physics identical to matches; needs frozen-ball, XY-hold, 3D-freeze, Δv impulse | high |
| CTR-19 | Rookie/Pro/All-Star = separate procedural system (10 shots, pass 4/6/8), not this data model | high |
| CTR-20 | Bindings: Backspace/RB reset; ←/→ (D-pad) navigate; ↑ shuffle; ↓ mirror; Enter/Back select | high |
| CTR-21 | `.Tem` = u32 size + u32 CRC (seed 0xEFCBF201, over the cipher text) + AES-256-ECB (the Coalesced key) of a magic/version header and a tagged-property object graph (wrapper + pack); fields, defaults and JSON rules §1.4; decoder and writer byte-exact on 20 real packs | high (header word at 0x10: unknown, always 0) |

## Possible future addition (clone-only)

**Rewind** (user, 2026-10-10): RL has none, and the clone matches that for now. The user may want an optional rewind
later as a clone-only extra. It would need state snapshots of the ball and car (the engine's existing rollback
snapshots could serve) and an input binding. Off by default; not part of RL fidelity.

## Open questions
1. **Rewind**: RL has none. Does the user want a clone-only rewind anyway (would deviate from the live game)?
2. Does the starting **jump** press make the car jump (intra-frame order of PC input vs GameEvent tick)? Live check:
   start a shot with only jump.
3. Does a **failed** shot show a replay when Skip Goal Replay is off (code path says yes)? Live check.
4. The **Finished** (pack complete) screen and its options were not decoded (GFX_TrainingMenu/Browser movies not
   decompiled).
5. Car bounding cylinder used by ForceOnGround/variance traces (`AActor::execGetBoundingCylinder` 0x140692230 is a
   virtual dispatch; not followed). Proposal: use the hitbox's bounding cylinder; resulting rest height ≈ 13 uu above
   ground then suspension settles [I].
6. `RestartRoundInputDelay` default 0 is the class default of the save object; a user's saved value may differ (I
   did not read the user's Documents; reading their `CustomTrainingSave` would confirm their current values).
7. ~~RL's `.Tem` file encoding~~ **Resolved** (TP1, 2026-10-17): §1.4 (container, cipher, CRC, serialization, fields;
   decoder and writer round-trip 20 real packs byte for byte).

## Actions outside the brief
- None. Read-only use of the snapshot's `TAGame/Config/DefaultInput.ini` and `RocketLeague.exe` strings (game files
  from the 20261006 snapshot). Ghidra ran on my copy (`rl-live`) under the memory cap. Work files:
  `work/` (package copies of GameInfo_TrainingEditor_SF / GameInfo_Tutorial_SF, patched decoder, decodes, defaults),
  `dec1`–`dec4` (native decompiles).
- TP1 (§1.4): none. The 20 packs were parsed as bytes by TP1's own scripts (never opened in the game or any tool
  that runs them); the live exe was read with objdump and the repo's PE helpers (no Ghidra); the live `TAGame.upk`
  was decrypted into TP1's workspace for class, enum and function decodes. Pack dumps (with names, codes and creator
  ids) stay in `out/bsim/agents/TP1/dump/`, git-ignored.
