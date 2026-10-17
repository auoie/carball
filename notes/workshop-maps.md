# Workshop maps: package format, contents, how the game loads them (static session, 2026-10-17)

Requested by the user (custom maps for Carball). Drafted by sub-agent WM1 (scripts and dumps local in
out/bsim/agents/WM1/). Input: the user's 24 subscribed workshop maps (other creators' work, parsed as bytes only,
never run or opened in a tool that runs content), the live exe (2026-10-06) and its decrypted script packages.
**Format and structure only:** no coordinates, layouts, graphs, mesh data or text from the maps are recorded here.

Tags: **[A]** package data (the maps' headers and tagged properties; the game's packages), **[S]** UnrealScript
(decoded from the live TAGame/ProjectX/OnlineSubsystemSteamworks packages), **[N]** native (live exe addresses),
**[I]** inferred.

Maps are named by workshop item ID. Representative set: rings course 2104185189, dribble challenge 964271505
(814218628 alike), obstacle course 814207936, aim training 1906378036; class census over all 24.

---------------------------------------------------------------------------------------------------------------------

## 1. The .udk package
- **Stock UE3, uncooked, unencrypted, uncompressed** [A]: tag 0x9E2A83C1, licensee 0, CookerVersion 0,
  CompressionFlags 0, no compressed chunks, FolderName "None", one generation, TextureAllocations empty.
- **Versions** [A]: file version 867 with engine build 10897 (7 maps) or 10907 (2); file version 868 with build 12791
  (15). Old and new builds were in use side by side: 867 items run from the oldest IDs to ~2021 ones [I: dates from IDs].
  - 10897 is the game's own engine build: `GEngineVersion` = 10897 at 0x142264100 [N].
  - So the 867 maps come from the UDK build the game branched from. Which UDK release that was (and 10907) can't be
    read from the files [I]. 12791 is the last UDK line (usually given as UDK 2015) [I].
- **PackageFlags** [A]: 0x00020001 = AllowDownload | ContainsMap. 5 maps also set 0x20000000 (NoExportAllowed).
  No Cooked flag and no 0x80 (the game's "header encrypted" bit, §4.2).
- **Summary layout (stock)** [A]: Tag, u16 FileVersion, u16 Licensee, TotalHeaderSize, FolderName, PackageFlags,
  then Name/Export/Import count and offset pairs, DependsOffset, ImportExportGuidsOffset, ImportGuidsCount,
  ExportGuidsCount, ThumbnailTableOffset, Guid, Generations, EngineVersion, CookerVersion, CompressionFlags,
  CompressedChunks (int32 entries), PackageSource, AdditionalPackagesToCook, TextureAllocations.
  - There are none of the game's tail fields (GarbageSize, CompressedChunkInfoOffset, LastBlockSize; scripts/upk.py
    expects them).
- **Tables** [A]:
  - Names: FString + u64 flags (all 0x0007001000000000).
  - Imports: 28 B.
  - Exports: Class, Super, Outer, FName, Archetype, u64 ObjectFlags, SerialSize, **int32** SerialOffset, ExportFlags,
    NetObjectCount array, PackageGuid, PackageFlags.
  - Order: names → imports → exports → depends map; the tables are contiguous.
  - Header sizes: 0.19–6.6 MB.
- **Thumbnails** [A]: a ThumbnailTable (class name, object path, offset) in 19 of 24 maps (6–222 entries). Each
  thumbnail is 256×256 PNG data, for StaticMesh, MaterialInstanceConstant and Texture2D.
- **Object data** [A]:
  - Tagged properties as in the game's v868 packages: bool as a byte, enum values as FNames, StructName on structs.
    The repo's props.py tag reader applies (the WM1 copy adds bounds checks).
  - Native tails: StaticMesh, Model, Polys, BrushComponent, ModelComponent, Level, Texture.
  - Editor-only data is still there: Kismet ObjPos/ObjComment, SourceFilePath, BookMarks, GroupActor, Polys, and
    BrushComponent `CachedPhysBrushDataVersion`.
- **The game's cooked maps** for comparison [A] (`Labs_Underpass_P.upk`):
  - v868, licensee 34 (32 in older SF packages), engine 10897, cooker 136.
  - PackageFlags 0x228a0289: Cooked | 0x80 | 0x200 | ContainsMap | DisallowLazyLoading | RequireImportsAlreadyLoaded
    | StoreCompressed | NoExportAllowed.
  - Header AES-256-ECB from NameOffset; zlib chunks; Psyonix tail fields; no thumbnails.
  - AdditionalPackagesToCook names its sublevels (Underpass: 2).
  - Cooked actors are merged (StaticMeshCollectionActor, StaticLightCollectionActor).

## 2. What the maps are made of (24 maps)
### 2.1 Census [A]
- **Every map**: World, Level, WorldInfo, a level Model (BSP), Brush, BrushComponent, Model + Polys per brush,
  CylinderComponent, and at least one Sequence.
- **Common classes** (maps where present / total objects):

  | Class | Maps | Total |
  |---|---|---|
  | StaticMeshActor | 22 | 25,637 |
  | StaticMesh exports | 21 | 1,036 |
  | TriggerVolume | 21 | 6,705 |
  | SeqEvent_Touch | 21 | 6,884 |
  | SeqAct_Teleport | 21 | 1,221 |
  | SeqAct_AddGameBall_TA | 19 | 885 |
  | PlayerStart_TA | 18 | 36 |
  | PhysicalMaterialProperty_TA | 15 | 20 |
  | InterpActor | 13 | 969 |
  | SeqAct_Interp | 10 | 351 |
  | Pylon_Soccar_TA | 9 | 9 |
  | KActor | 8 | 368 |
  | BlockingVolume | 8 | 455 |
  | DynamicTriggerVolume | 6 | 125 |

- **Rare**:

  | Class | Maps | Total |
  |---|---|---|
  | VehiclePickup_Boost_TA | 3 | 65 |
  | SeqAct_GiveBoost_TA | 3 | 261 |
  | GoalVolume_TA + Goal_TA | 2 | 4 + 6 |
  | GravityVolume | 1 | 5 |
  | LevelStreamingKismet | 1 | 2 |

  - GFx movies (GFxAction_OpenMovie with an embedded SwfMovie): 5 maps.
  - PrefabInstance: 1 map (918).
  - SkeletalMeshActor, InstancedFoliageActor, LensFlareSource: 1 map each.
- **Not found**: Terrain, Landscape, PhysicsVolume, KillZVolume, mutator objects, WorldInfo gravity or
  time-dilation fields.
- **Kismet size**: 1–9,470 sequence objects per map; subsequences nest up to 3 deep. Five rings courses have 20 level
  subsequences at depth 2.
- **Kinds of map**:
  - BSP-only courses: 3 maps (no static mesh but a sky).
  - Mesh courses: rings, dribble, aim.
  - Soccar-like arenas: 2 maps with Pylon and goals (pads in one), and 1–3 Kismet objects.
  - Multi-event hubs: 2 maps with 9k+ Kismet objects and GFx UIs. One other map streams sublevels by Kismet.

### 2.2 Collision geometry
- **BSP** [A]: the BSP-only obstacle course (814207936) drives entirely on the level Model plus BlockingVolumes.
  - Obstacle course: 20,557 BSP nodes, 891 surfaces, 213 brushes, 26 BlockingVolumes.
  - Dribble course 814218628: 7,317 nodes, 1,184 surfaces, 84 BlockingVolumes.
  - Brush CsgOper is CSG_Add or CSG_Subtract.
  - The game cooks BSP physics at load (§4.2).
- **Static meshes** [A]:
  - Most meshes are embedded in the map: 19,872 component references; 3,190 point to the game's cooked map packages
    (OOB, street and park sets); 108 to engine/editor packages.
  - **Collision per mesh**: `UseSimpleRigidBodyCollision` is False on 119 of 363 embedded meshes (8 maps measured).
    Without an RB_BodySetup with ConvexElems, collision is per-poly through the kDOP tree (FkDOPCollisionTriangle:
    3 × u16 + material). RB_BodySetup: 195 in 12 maps.
  - **Collision triangles** (upper bound: kDOP triangles × instances whose component doesn't turn collision off;
    8 maps measured):

    | Map | Triangles |
    |---|---|
    | Dribble challenge | 36.6k |
    | Small soccar-like | 48k |
    | Aim training | 86.6k |
    | Hub | 0.97M |
    | Large soccar-like | 1.9M |
    | Mesh dribble course | 2.5M |
    | Rings courses (2) | 3.2M–4.3M |

    For scale, the soccar arena is 10,904 triangles.
  - **Unique kDOP triangles per map** (8 maps): 10k–296k. Largest single mesh: 46k triangles.
- **Component collision settings** [A] (StaticMeshComponent overrides):
  - BlockRigidBody, CollideActors=False (visual only), HiddenGame=True (invisible colliders), bDisableAllRigidBody.
  - **RBChannel = RBCC_VehicleBlocker** with RBCollideWithChannels {Vehicle, VehicleBlocker}: blocks cars, not the
    ball.
  - RBCollideWithChannels {Ball, Vehicle} or {Ball, Default, Vehicle}.
  - The channel names (RBCC_VehicleBlocker, RBCC_BlockingVolume, Ball, VehicleBlocker) are the game's Engine enum,
    not stock UE3 (`RBCC_VehicleBlocker` is in the game's Engine.upk). So the creators' editor setup carried the
    game's Engine enum and struct field names [I].
- **Sticky (drivable) surfaces** [A]:
  - `PhysicalMaterialProperty_TA` fields: bStickyWheels, TireFrictionScale, GroundToleranceZ, bConsiderForGround,
    AkSwitchValue.
  - All 20 instances in the maps set bStickyWheels=True; TireFrictionScale is 1.0 or 0.9 (5 maps); bConsiderForGround
    is set in 1 map.
  - Assigned through StaticMeshComponent.PhysMaterialOverride (most), MaterialInstanceConstant.PhysMaterial (1 map),
    or by referencing the game's own physical materials in Startup (1 map, 79 components).
  - 4 of the 7 rings courses assign no sticky material at all (pure aerial).
  - Non-sticky PhysicalMaterials (Density/LinearDamping/AngularDamping 100000, Friction, Restitution) sit on KActors.
  - The game: sticky force and wall friction only on bStickyWheels materials (notes/physics-values.md).

### 2.3 Gameplay objects and Kismet patterns [A]
Patterns are counted as `Src.OutputLink → Dst.InputLink` and `Op.VarLink ← variable class`.
- **Teleport, checkpoint and reset**:
  - `SeqEvent_Touch(Originator TriggerVolume).Touched → SeqAct_Teleport.In`, with Target ← the event's
    `Instigator` (SeqVar_Object) or SeqVar_Player, and Destination ← SeqVar_Object holding a PathNode, InterpActor or
    PathNode_Dynamic. 974× in 9 maps.
  - `SeqEvent_LevelLoaded."Loaded and Visible" → SeqAct_Teleport` places the player at the start (8 maps).
  - The obstacle course is nothing but Touch → Teleport (152) plus DrawText.
- **Rings and levels**:
  - Ring meshes are solid StaticMeshActors; a TriggerVolume per ring or fail zone.
  - `SeqEvent_Touch → SeqAct_FinishSequence` is a level subsequence's output (3,281× in 7 maps).
  - Per level: `SeqEvent_SequenceActivated → SeqCond_CompareInt (level index) → SeqAct_AddGameBall_TA.DestroyAll
    → SeqAct_Destroy → SeqAct_Teleport → SeqAct_AddGameBall_TA.Add (SpawnTransform ← PathNode)`.
  - Then `SeqAct_GetLocationAndRotation → SeqAct_SetLocation` (ball placement).
- **Counters and timers**:
  - SeqVar_Int/Float/Bool/String/Vector/Named/External; SeqAct_Set*/Add*/Subtract*/Multiply*/Divide*;
    SeqCond_Compare{Int,Float,Bool,Object}; SeqCond_CompareString_TA.
  - Timers are `SeqAct_Delay.Finished → SeqAct_Delay.Start` loops plus AddInt/AddFloat → ConvertToString → DrawText,
    or GFx movies driven by GFxAction_SetVariable.
  - `SeqAct_GetProperty` reads WorldInfo.TimeSeconds.
- **Input**: `SeqAct_IsActionPressed_TA.ActionName` (7 maps) uses the game's actions: ResetTraining, UsePickup,
  ChatPreset1–4, SecondaryCamera, Boost. SeqEvent_Input with key names: 1 map.
- **Reflection reads**: `SeqAct_GetProperty.PropertyName` (7 maps) on game objects:
  - BoostComponent → CurrentBoostAmount;
  - ball Radius, Touches, LastHitWorldTime, HitTeamNum;
  - PRI, GameEvent, BallArchetype, PlayerController, PlayerCamera, bOnGround;
  - WorldInfo.GameSpeed / WorldGravityZ / TimeSeconds.
- **Moving platforms**:
  - InterpActor + `SeqAct_Interp` (Data ← InterpData → InterpGroup → InterpTrackMove PosTrack/EulerTrack,
    MoveFrame IMF_RelativeToInitial; bLooping, bRewindOnPlay, PlayRate).
  - Started by `SeqEvent_SequenceActivated` or by a Delay.
  - InterpActor with Physics PHYS_Rotating (RotationRate): 1 map.
  - KActor rigid bodies with `SeqEvent_RigidBodyCollision` (3 maps, bPlayerOnly).
- **Other events**: SeqEvent_RemoteEvent / SeqAct_ActivateRemoteEvent (7 maps, 1,305), SeqEvent_CarSpawned_TA
  (5 maps), SeqEvent_PlayerSpawned (7), SeqEvent_GameEventStateChanged_TA (1), GFxEvent_FSCommand (3).
- **Other actions**: ToggleHidden, Toggle, Gate, SetMaterial, ChangeCollision (COLLIDE_BlockAll / NoCollision),
  SetPhysics, AttachToActor, SetBallCamTarget_TA, ExplodeGameBall_TA, GetGameBall_TA, DisplayMessage_TA,
  MultiLevelStreaming (1 map streams two of the game's cooked level packages), AkPlaySound, prefabs.

### 2.4 Spawns, ball, boost pads [A][S]
- **Car spawns**:
  - `PlayerStart_TA` (18 maps; no fields of its own, TeamIndex from Engine.PlayerStart, bPrimaryStart once),
    `Engine.PlayerStart` (4), DynamicPlayerStart_TA (2).
  - `Pylon_Soccar_TA` (9 maps): SpawnPoints, Goals, FieldCenter/Extent/Size, GroundZ, ExpansionVolumes.
  - Workshop free play uses each team's PrimaryStarts (§4.1).
- **Ball**: `SeqAct_AddGameBall_TA` (19 maps), from its decoded `Activated` [S].
  - Inputs: [0] Add → GameEvent.SpawnBall(SpawnTransform.Location, bWake, BallArchetype); [1] Destroy SpawnedBall;
    [2] DestroyAll → GameEvent.DestroyBalls; [3] freeze (SetPhysics + PutRigidBodyToSleep);
    [4] AddGameBall(PlacedBall).
  - No map overrides BallArchetype. Placed Ball_TA actors: 2 maps.
  - Explode (SeqAct_ExplodeGameBall_TA): Ball.Explode at goal 0/1.
- **Pads**: `VehiclePickup_Boost_TA` (3 maps, 65) with BoostAmount (0.12, −1, 9999, −9999 as set), RespawnDelay
  (2/4/10 s), BoostType (BoostType_Pad / BoostType_Pill) and an FXActor_TA.
  - Boost by script: `SeqAct_GiveBoost_TA` [S]: input 0 gives BoostAmount (> 0); input 1 sets MaxBoostAmount = 10000
    and gives full boost.

### 2.5 Physics overrides [A][S]
- **WorldInfo**: no DefaultGravityZ, GlobalGravityZ or TimeDilation in any map. Set: KillZ (17 maps), SoftKill (6),
  fog/lighting/post fields, MyMapInfo (2), DefaultGameType (1: tagame.GameInfo_Soccar_TA).
- **GravityVolume**: 1 map (GravityZ 700, 5 volumes). No other volume physics.
- **By script**:
  - `SeqAct_SetVelocity` (10 maps, 183: VelocityDir + VelocityMag; launch pads, resets).
  - SeqAct_Teleport / SetLocation.
  - `SeqAct_ControlCarMovement_TA` (input 1 → Car.TerminateRBPhys, else ReInitRBPhys: freezes the car) [S].
  - SeqAct_SetPhysics, SeqAct_ChangeCollision.
  - KActor bLimitMaxPhysicsVelocity / MaxPhysicsVelocity.
  - Per-surface friction via TireFrictionScale.
- Nothing mutator-like lives in the maps (mutators are GameEvent settings).

### 2.6 Lighting, materials, sky (renderer view) [A]
- **Lights**: SkyLight (19 maps), DominantDirectionalLight (13), PointLight (4), SpotLightMovable (2),
  ExponentialHeightFog (9) or HeightFog (1), SceneCaptureCubeMapActor (5), Emitters (3).
- **Baked lighting** in 6–8 maps (LightMapTexture2D 90, ShadowMap1D 6,707); LevelLightingQuality is Preview in 9.
- **Materials**: 449 MaterialInstanceConstants (21 maps).
  - Their parents are almost all simple engine materials that the game ships cooked in Startup.upk
    (EngineDebugMaterials.TexturePaint_2Tex_Color, VertexPaint_2Tex_Color, LevelColorationLitMaterial,
    EngineMaterials.DefaultMaterial). Startup.upk holds EngineMaterials 58 / EngineDebugMaterials 99 / PostProcess 33
    exports.
  - So the game already has the shaders [I]. New Material exports: 1 map (5).
  - Texture2D: 525.
- **Sky**: UDK MapTemplates procedural sky materials or the game's out-of-bounds meshes.
- MapTemplates and editor packages are not shipped with the game; one item ships MapTemplates.upk and
  EditorLandscapeResources.upk next to its .udk.

## 3. Dummy classes: what a map needs from the game [A][I]
- Classes are imported from the package `tagame` (always lower-case) and `projectx`: 30 distinct game classes across
  the 24 maps.
  - Placeable: PlayerStart_TA, DynamicPlayerStart_TA, Pylon_Soccar_TA, VehiclePickup_Boost_TA, GoalVolume_TA,
    Goal_TA, Ball_TA, DynamicMeshActor_TA, PointInSpace_TA, MapInfo_TA, InMapScoreboard_TA, FXActor_TA,
    PhysicalMaterialProperty_TA.
  - Kismet: SeqAct_*_TA, SeqEvent_*_TA, SeqCond_CompareString_TA.
  - Also GameInfo_Soccar_TA and Car_TA as references.
- Class-default subobjects are imported **by name**, so the stubs must reproduce them:
  - `Default__PlayerStart_TA.CollisionCylinder`;
  - `Default__Pylon_Soccar_TA.{CollisionCylinder, DrawPylonRadius0, NavMeshRenderer}`;
  - `Default__DynamicMeshActor_TA.StaticMeshComponent0`;
  - `Default__GoalVolume_TA.{BrushComponent0, DefaultGoal}`;
  - `Default__Ball_TA.{DefaultMesh, DefaultBallCamTarget, ReplayComponent0, LegacyTakeDamageComponent0,
    CollisionCylinder}`;
  - `Default__VehiclePickup_Boost_TA.DefaultCollisionCylinder`.
- Tagged properties match by name and type, so the stubs need only the properties the creator sets.
- No map script or GameInfo is required: the workshop route sets the game type itself (§4.1). A spawn (PlayerStart or
  PlayerStart_TA) is the only must [I].

## 4. How the game loads them
### 4.1 Official workshop route (Steam only, offline)
- **Menu** [A]: `Archetypes.Menu.MenuTreeBuilder.Workshop` (MenuTreeNode_ExternalScreen_TA) under OfflineModes.
  - ScreenToOpen = WorkshopMenu (GFX_WorkshopMenu_SF).
  - `PlatformAvailability`: include list [OnlinePlatform_Steam].
  - Loc: [PlayMenuV4] WorkshopTitle/WorkshopDescription, [UIText] WorkshopMaps/NoWorkshopMapsDescription.
- **Playlist** [A]: `PsyNetStaticData.Workshop` (PlaylistSettings_TA): PlaylistId 19, PlayerCount 8, bHidden.
- **UGC privilege** [S]: GFxData_Privileges_TA.TryToUseUGC → OnlineGamePrivileges_X.AddUGCChecks: RequirePrivilege(4).
  On failure: Errors_X.UGCRestricted.
- **Listing** [S]: `GFxData_Workshop_TA.LoadAllWorkshopMapData` → OnlineSub.CommunityContentInterface
  .DownloadAllWorkshopData(HandleWorkshopData).
  - HandleWorkshopData keeps Items; an empty Title becomes ItemRemoved; it fetches PreviewURL images and author
    personas.
- **Natives** [N]: `UOnlineCommunityContentInterfaceSteamworks::execDownloadAllWorkshopData` 0x140cff920 → 0x140d1be30.
  - ISteamUGC (interface pointer at 0x1424bc7e0, `STEAMUGC_INTERFACE_VERSION010`).
  - `GetSubscribedItems` (vtbl+0x1d0) with **at most 50 items** (0x32) → `GetItemState` & 4 (installed) →
    CreateQueryUGCDetailsRequest (+0x10) → SendQueryUGCRequest (+0x18).
  - Logs: "Workshop subscribed item count: %d", "Number of Installed Items: %d".
  - Call result → 0x140d2ec40 → 0x140d1ea20 → FOnlineAsyncEventUgcDetails → **0x140d31230**:
    - GetQueryUGCResult (+0x20), GetQueryUGCPreviewURL (+0x28), **GetItemInstallInfo** (+0x1e0, folder ≤ 1024
      chars);
    - lists the folder's files (0x14039b690) and keeps those whose extension is `udk` or `umap` (`_wcsicmp`, strings
      0x141dce940 / 0x141dce948).
  - Result: `OnlineSubsystem.DownloadedWorkshopData` {ItemID, Title, Description, PreviewURL, AuthorNetID,
    AuthorName, Avatar, Preview, ItemPath, Filename, FullPath} → OnDownloadedWorkshopData.
- **Load** [S]: `GFxData_Workshop_TA.LoadWorkshopMap(FullPath)`.
  - The extension must be `.udk` or `.umap` (else "File not a udk or umap!").
  - `GRI_X.SetOfflineGameData('Workshop')` (sets the current playlist).
  - Then `TravelManager_TA.SetWorkshopMap(true).SetMapName(path).SetGameInfoClass("TAGame.GameInfo_Soccar_TA")
    .AddOptionsArray(["easy", "Workshop"]).AddGameTags("Freeplay").Start()`.
  - `BuildURL` = `MapName?Game=…?easy?Workshop?GameTags=Freeplay`; `Start` = ConsoleCommand("Start " $ URL).
  - `bWorkshopMap` only skips the official-map lookup: `GameData_TA.MapList.GetMap`, its MapData != none check and
    its AdditionalGameTags.
- **In game** [A][S]:
  - GameInfo_Soccar_TA's GameEventArchetypes: MainGame → `Archetypes.GameEvent.GameEvent_Soccar`
    (GameInfo_Soccar_SF).
  - GameTags Freeplay → Mutator_Freeplay_TA. For playlist Workshop, `HandlePlayerAdded` skips the free play setup
    (boost fill, goal reset) unless the command line has `-EnableWorkshopFreeplayCommands`.
  - `Mutator_Freeplay_Base_TA.HandleTeams` uses the teams' PrimaryStarts. With no spawn at all: a
    DynamicSpawnPoint_TA at FieldCenter + 300 z.
  - MatchType_Tutorial_TA.GetOfflinePlaylistName returns 'Workshop' when the URL has the Workshop option.
  - The loading screen uses the generic background; the music is training music.
- **Side files** [A]:
  - `.vdf` = a steamcmd workshop_build_item script (appid 252950, publishedfileid, contentfolder, previewfile,
    visibility, title, description, changenote). The game never reads it.
  - **WorkshopItemInfo.JSON** = a serialized `OnlineCommunityContentInterfaceSteamworks.WorkshopItemData` {Title,
    Description, MetaData, Content, Preview, Tags, AddPairs, RemovePairs, Visibility, ItemID, bIsUploading,
    UpdateHandle}.
    - Psyonix's uploader `Binaries\WorkshopUploader.exe` (.NET; "run this program in the directory where Rocket
      League's exe exists") writes it.
    - The game's upload commandlet reads it: "WORKSHOP" → OnlineSubsystemSteamworks.SteamWorkshopCommandlet, Main =
      vtable slot 78 0x140d2dd30 → 0x140d4af50 reads `<Content>\WorkshopItemInfo.JSON` ("COULD NOT OPEN WORKSHOP
      INFO FILE!") [N].
    - It ships in downloads only because it sits in the uploaded folder. The download path ignores it.
  - Upload natives: execCreateWorkshopItem 0x140cff8e0, execUpdateWorkshopItemUploadProgress 0x140cffc70 [N].

### 4.2 The Labs_Underpass replacement
- **Underpass is an ordinary official map** [A]: `MapList.Maps.Labs_Underpass_P` (MapData_TA, WeatherVariant_Lab, no
  RandomWeight); [MapBase] Labs_Underpass_P=Underpass; file `CookedPCConsole\Labs_Underpass_P.upk`.
- **The lookup**: picking it in free play builds `Labs_Underpass_P?Game=TAGame.GameInfo_Soccar_TA?…?GameTags=Freeplay`.
  The MapData lookup succeeds, and the engine resolves the package **by name** through its package file cache: ini
  keys [Core.System] Paths / SeekFreePCPaths / SeekFreePCExtensions and [URL] MapExt, all in the exe [I: values not
  in the shipped inis]. So whatever file carries that name loads.
- **Why a .udk loads there** (no special case for it; every check passes):
  - **Version check** [N] 0x140387e50:
    - FileVersion < 491 (`GPackageFileMinVersion` 0x142264114) → Core.OldVersionFile;
    - FileVersion > 868 (0x142264110) or Licensee > 34 (0x142264118) → Core.FileVersionDump.
    - 867/868 with licensee 0 pass.
  - **Decryption** [N] 0x140315a70: `test byte [Summary.PackageFlags], 0x80` at 0x140315b5d gates the key lookup
    (0x1402ebeb0) and AES (0x1402dbe50; 0x1402dbd40 when flags & 0x800). UDK packages lack 0x80, so they are read
    plain. CompressionFlags 0 means no chunk inflation.
  - **Uncooked content is cooked at load** [N] (log strings):
    - "No Cached Per-Tri StaticMesh Physics Data Found Or Out Of Date (%s) (Owner: %s) - Cooking Now." 0x141ca7ee0;
    - "No Cached Brush Physics Data …" 0x141ca8260;
    - "No Cached BSP Physics Data Found Or Out Of Date - Cooking Now." 0x141cabc20 (in 0x1409b1550); convex BSP
      0x141cabcf0;
    - "Building per-poly collision kDOP trees for '%s'" (in 0x140908820).
  - No hash or signature check was found on this path [I].
- **The exe's own `Labs_Underpass_P` strings are replay compatibility, not this route** [N]:
  - `UReplay_TA::execGetMapToLoad` 0x140e71840 maps Labs_Underpass_P → Labs_Underpass_v0_P (also Farm_UpsideDown_P →
    Farm_Night_P, TrainStation_Spooky_P → TrainStation_Night_P) when a replay field at +0x84 (a version [I]) < 11.
  - 0x140eea590 rewrites object paths of old replays.
- **Differences from the workshop route** [S][I]:
  - The playlist isn't Workshop, so the free play commands work.
  - Underpass's loading screen and name show.
  - Any official map name would work the same way.
  - It stays local: online servers load their own Underpass.

## 5. A Carball map format: proposal
- **Package**: one archive: `map.json` (format/engine versions, name, author, licence), `collision/*.cmf`, optional
  `render/*.glb`, `rules.json`. The lobby carries its SHA-256; the server simulates, clients render.
- **Collision**: our CMF (int32 triangle count, int32 vertex count, int32×3 indices, float×3 vertices in BU = uu × 0.02,
  optional "CBOF" body offset), placed as instances (position, rotation, scale incl. mirror) so each BVH is built once;
  explicit planes and boxes for floors and BlockingVolume-like walls.
  - Budget: ≤ 64k vertices per mesh, ≤ 250k unique triangles, ≤ 4k instances (arena 10,904; workshop rings courses
    reach 3–4M instance triangles and would need collision proxies).
  - Per-mesh flags: collides with {car, ball} (the RBCC_VehicleBlocker / RBCollideWithChannels cases), sticky
    (bStickyWheels), tire friction scale, restitution, one-sided.
- **Spawns and pads**: car spawns {position, yaw, team, primary}, named ball spawns, kickoff sets; pads {position,
  big/small or amount, respawn s}; goals optional (goal volumes or none).
- **Volumes**: box, sphere, cylinder, convex; filter car / ball / both; enter / exit / inside events per entity.
- **Rules (replaces Kismet)**: declarative `when → if → do`, run in tick order with an operation cap per tick.
  - Events: mapLoaded, enter/exit(volume), timer, input(reset, usePickup, chat1–4), carSpawned, ballTouched, goal,
    levelStarted. Conditions: compare(var, op, value), isCar / isBall, level == n.
  - Actions: teleport(entity, spawn, keepVelocity), setVelocity(dir, speed, relative), boost(add / full / unlimited),
    ball(spawn / destroyAll / freeze), set/add var, timer(start / stop / split), show(text id, vars), mover(play /
    stop), toggle(visible / collidable), checkpoint(save / restore), finish(level, result).
  - Typed variables (int, float, bool, vector, entity), global or per player; levels = named rule groups.
- **Movers**: keyframed transforms (linear/cubic, loop/ping-pong) and constant rotation, evaluated from the tick count
  (deterministic, server-authoritative).
- **Physics overrides**: map gravity and game speed, per-volume gravity and boost multiplier, launch velocities, in
  validated ranges (RocketSim MutatorConfig-like).
- **Timers and checkpoints**: first-class (start / stop / split, per-level best times on the client); a checkpoint
  stores a spawn pose; the reset input restores it.
- **Validation** (server and map tool): JSON schema, size caps, finite coordinates, no degenerate triangles, bounds
  ≤ ±65,536 uu, the budgets, a rule-graph check (no unbounded same-tick chains), limits on vars, volumes and rules.
- **Engine today**: `rl_init` loads every `arena/*.cmf` as one sticky world (GameMode SOCCAR, 16 pieces + 4 goal
  halves); fixed soccar pads (≤ 64, `rl_pads_active` bitmask) and goal line; car/ball state set/read; MutatorConfig.
- **Engine needs**: a mesh list with instances and per-mesh flags (sticky, collision mask, friction); data-driven
  pads, spawns and goal volumes; trigger overlaps reported per tick; kinematic movers (Bullet kinematic bodies);
  per-volume gravity; a no-goal mode; teleport/velocity actions that bump the spawn counter for netcode.
- **Leave out**: arbitrary code (UnrealScript, Kismet reflection such as GetProperty, JS/Lua), custom shaders, GFx/UI
  movies, streaming sublevels, skeletal meshes, free rigid props (KActor) at first, prefabs, imports from game
  packages.
