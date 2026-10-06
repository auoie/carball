# RocketLeague.exe findings

Build: `TAGame-Win64-Shipping`, compiled 2026-06-16, image base `0x140000000`. No PDB.
All addresses are VAs for this build only. They will move on the next patch.

## Binary layout

| Section | VA | Size | Notes |
|---|---|---|---|
| .text | 0x140001000 | 0x1a37000 | code, entropy 6.5 (not packed) |
| .rdata | 0x141a38000 | 0x816000 | strings, consts, vtables |
| .data | 0x14224e000 | 0x2b0000 | native tables; GNames/GObjects live in its bss tail |

- MSVC, x64, ~135 RTTI type descriptors (CryptoPP + std only; game classes have none).
- Bullet physics statically linked, version >= 2.83 (`btGearConstraint`, `btDynamicsWorldFloatData`).
- Easy Anti-Cheat installed. Everything here is static analysis of files on disk.

## UE3 core globals

| Name | VA | How found |
|---|---|---|
| `GNames` (`TArray<FNameEntry*>`) | 0x142493698 | `FName::AppendString` @ 0x14039e700 reads `GNames.Data[Index]`, string at `+0x18` |
| `GObjObjects` (`TArray<UObject*>`) | 0x1424936e0 (Num at +8) | 580+ code refs; bounds check vs `[+8]` then `Data[i]` |
| `GNatives` (bytecode dispatch table) | 0x14237ff40 | inline `Stack.Step`: `call [GNatives + op*8]` in every exec thunk |
| `UPackage::StaticClass` cache | 0x14237fb78 | lazy init with `L"Core"` in GetPathName |

`GObjObjects = GNames + 0x48`.

### Structures

```
FNameEntry   +0x18  wchar_t Name[]
FName        +0x00  int32 Index      +0x04  int32 Number  (printed as Name_<Number-1>)
UObject      +0x38  int32 ObjectInternalInteger (-1 = "<uninitialized>")
             +0x40  UObject* Outer
             +0x48  FName    Name
             +0x50  UClass*  Class
FFrame       +0x20  UObject* Object
             +0x28  uint8*   Code
```

### Core functions

| Function | VA |
|---|---|
| `UObject::GetPathName(StopOuter, FString&)` (inner, recursive) | 0x1403a4790 |
| `UObject::GetPathName` (wrapper returning FString) | 0x1403a48e0 |
| `FName::AppendString` | 0x14039e700 |
| `UObject::execPathName` | 0x14035fc20 |
| `UObject::execFindObject` | 0x14035e7a0 |
| `UObject::execDynamicLoadObject` | 0x14035e660 |

## Native function tables

`.data` holds UE3 native registration tables: `{ const char* "ClassexecFunc", void* fn }`, ending with `{0, 0}`.
`scripts/dump_natives.py` extracts **4,145 natives across 613 classes** to `out/natives.csv`.
`scripts/ApplyNatives.java` names them in Ghidra (`Class::execFunc`).

Gameplay-relevant natives (full list in the CSV):

- `AVehicle_TA` (22): `SetVehicleInput`, `IsOnGround`, `IsOnWall`, `GetGroundNormal`, `GetNumWheelContacts`, `GetForwardSpeed`, `ForceNetPacketIfNearBall`, ...
- `ARBActor_TA` (19): `AddForce`, `AddTorque`, `GetCurrentRBState`/`SetCurrentRBState`, `GetPhysicsFrame`, `GetPhysicsTime`, `SetMaxLinearSpeed`, `SetMaxAngularSpeed`, `EnableCCD`, `GetTimeOfImpact`
- `ACarComponent_*_TA`: Boost, AirControl, Dodge, Jump, DoubleJump, FlipCar, Torque
- `UVehicleSim_TA`: `GetMaxTurningCircle(At)`, `Add/RemoveTireFrictionScale`
- `UWheel_TA`: `GetSuspensionDistance`, `GetSteer`, `GetLinearVelocity`, ...
- `ABall_TA`: `PredictPosition`, `PredictGroundPosition`
- `ANetworkInputBuffer_STS_TA`: `ClientAdjustSimTime`, `NotifyClientAdjustSimTime`, `CanTellClientToAdjustSimTime`
- `UEngineShare_TA::execGetBulletFixedDeltaTime`

Shared thunks: the `ApplyForces` (0x140e78d80) and `PrePhysicsStep` (0x140e77fc0) natives for every
car component point at one generic thunk that calls a C++ virtual. The real per-component physics is
in each class's vtable, which needs the decompiler to resolve.

## Where the physics numbers live

None of the well-known tuning values appear in the exe, either in data or as instruction immediates:
max car speed 2300, supersonic 2200, boost accel 991.67, ball max speed 6000, ball radius 91.25/92.75,
gravity 650, jump impulse 291.67, 1/120 s tick.

So the exe holds the **algorithms** (how forces are computed), but the **values** are UnrealScript
default properties and archetypes inside the `.upk` packages (e.g. `TAGame.upk`), which are partly
encrypted. RocketSim already has these values.

Config files: `TAGame/Config/DefaultRLBot.ini` has `PacketSendRate=60`. Nothing else physics-related.

## Class registrations and vtables

`IMPLEMENT_CLASS` → `GetPrivateStaticClass<T>()` calls the static `UClass` ctor (0x140322cb0) with
`TEXT(#T)+1` (name without the A/U prefix), package, config, `sizeof(T)` in r8d, and
`InternalConstructor` at `[rsp+0x48]`. The constructor's last vtable store is T's vtable.
`scripts/dump_classes.py` recovers **2,404 classes** to `out/classes.csv` (name, sizeof, ctor, vtable).

Worked example, `ACarComponent_Boost_TA`:
GetPrivateStaticClass 0x140f35690 → PrivateStaticClass cache 0x1424b71b8, sizeof 0x398,
InternalConstructor 0x140f06e50 → vtable **0x141e4a6a8** (base AActor vtable 0x141b23f80).

### Car component physics (virtual slots)

The `execPrePhysicsStep` / `execApplyForces` natives are shared thunks that call
`this->vtbl[0x6a0/8]` (slot 212, `PrePhysicsStep(DeltaTime)`) and
`this->vtbl[0x6a8/8]` (slot 213, `ApplyForces(ActiveTime)`).
`0x14026f5c0` is the shared empty function (no override).

| Component | sizeof | vtable | PrePhysicsStep | ApplyForces |
|---|---|---|---|---|
| CarComponent_TA (base) | 0x2e8 | 0x141e49948 | (empty) | (empty) |
| Boost_TA | 0x398 | 0x141e4a6a8 | 0x140f1b760 | 0x140eb45d0 |
| Boost_KO_TA | 0x3a0 | 0x141e4ad60 | 0x140f1b760 | 0x140eb41b0 |
| AirControl_TA | 0x328 | 0x141e4d5c0 | 0x140f1b480 | 0x140eb3400 |
| AirControl_Robin_TA | 0x340 | 0x141e4dc70 | 0x140f1b480 | 0x140eb3380 |
| Dodge_TA / Dodge_KO_TA | 0x3c8 / 0x3f0 | 0x141e4b418 / 0x141e4bad8 | 0x140f1b970 | 0x140eb46e0 |
| Jump_TA | 0x310 | 0x141e4e9d0 | 0x140f1ba60 | 0x140eb4ce0 |
| Jump_Robin_TA | 0x328 | 0x141e4f080 | 0x140f1ba60 | 0x140eb4aa0 |
| DoubleJump_TA / _KO_TA | 0x340 / 0x348 | 0x141e4c198 / 0x141e4c850 | 0x140f1b9d0 | 0x140eb4800 |
| DoubleJump_Robin_TA | 0x358 | 0x141e4cf08 | 0x140f1b9d0 | 0x140eb4720 |
| FlipCar_TA | 0x2f8 | 0x141e4e320 | 0x140f1ba00 | 0x140eb48a0 |
| Torque_TA | 0x300 | 0x141e4fde0 | (empty) | 0x140eb4ef0 |
| TerritoryDemolish_TA | 0x310 | 0x141e4f730 | 0x140f1bac0 | (empty) |

Other: `Vehicle_TA` sizeof 0x8d0, vtable 0x141e80c00; `VehicleSim_TA` sizeof 0x178, vtable 0x141e8f588;
`Ball_TA` sizeof 0xb30; `RBActor_TA` sizeof 0x7c0 (vtable not recovered by the heuristic yet).
"Robin" and "KO" variants are alternate mechanics, probably for special game modes.

## Packages (.upk)

- Header from `NameOffset` is AES-256-ECB encrypted (RLUPKTool format, still valid for licensee 32).
  The public RLUPKTool key still decrypts this build. The key is not stored as plain bytes in the
  exe (obfuscated or built at runtime). Local copy: `out/rlupktool_key.bin`.
- Real chunk table sits inside the decrypted header at `CompressedChunkInfoOffset`. Chunks are zlib.
- Export entries: the standard v868 layout with 64-bit SerialOffset (72 bytes + 4 per NetObject).
- Psyonix addition: every `UProperty` stores an `FString` copy of its name after
  ArraySizeEnum / RepOffset and before the type-specific refs.
- Level actors with `RF_HasStack` start with an FStateFrame (Node, StateNode, ProbeMask,
  uint16 LatentAction, [Offset]) before NetIndex. Component templates have 4 or 12 extra header bytes.
- Field memory order = class `Children` → `Next` chain. `scripts/layout.py` computes offsets
  (validated against exe `sizeof` for VehicleSim_TA, Wheel_TA, FlipCar/Jump/AirControl).

Scripts: `decrypt_upk.py`, `package.py` (tables), `props.py` (tagged properties),
`layout.py` (native offsets), `search_props.py`, `scan_names.py` / `scan_exports.py` (cross-package
search), `export_constants.py` (→ `out/rl_physics_constants.json`).
Physics values and the RocketSim comparison: `notes/physics-values.md`.

## Decompiled mechanics (Ghidra, `out/decomp/`)

| Function | VA | Notes |
|---|---|---|
| `AddForce`-style helper | 0x14097f5c0 | ×0.02 to Bullet units; mode 0 force, 1 impulse, 2 velocity change (×mass), 5 acceleration |
| `AddTorque`-style helper | 0x140981560 | mode 2 = Δω (via inertia), mode 5 = angular accel |
| btRigidBody::applyTorqueImpulse / applyImpulse / applyForce | 0x1402b0800 / 0x1402b06d0 / 0x140999f50 | |
| `FInterpCurveFloat::Eval` | 0x140366850 | clamps outside range |
| VehicleSim update (steer, drive, brake) | 0x140f5ff00 | drive ×0.25/wheel, ×0.25 again if <3 wheels; Ackermann helper 0x140eca900 |
| Wheel friction + engine/brake force | 0x140f588f0 | lat/long/handbrake/wall friction curves |
| Dodge ApplyTorqueForces | 0x140eb72b0 | flip cancel only after MinDodgeTorqueTime; Z damping |
| FlipCar ApplyForces | 0x140eb48a0 | impulse Δv 200 along −up, torque Δω 1000/tick |

## UnrealScript bytecode (Rocket League token layout)

`scripts/ubytecode.py` disassembles functions to pseudo-code. Token handlers were identified from the
GNatives static registrations (`scripts/dump_tokens.py` → `out/gnatives.csv`) and by reading each
handler. Differences from stock UE3:

| Token | Meaning (stock value) |
|---|---|
| 0x2B | LocalVariable (0x00) |
| 0x46 / 0x47 / 0x48 / 0x49 | LocalOutVariable (0x48) / DefaultParmValue (0x49) / EmptyParmValue (0x4A) / InstanceDelegate (0x4B) |
| 0x4C | EndOfScript (0x53) |
| 0x19, 0x12 | Context / ClassContext with an extra leading flag byte (skip None check) |
| 0x57 xx | dynamic-array op family; sub-op table (64 entries) filled by `FUN_140367990`; 0x01 = Length |
| 0x5E | pass-through wrapper (clears the None-check flag) |
| 0x60+ | (0x60 is an 8-byte constant); native calls use stock indices ≥ 0x70 |
Native function indices are stock (e.g. 171 `*`, 174 `+`, 186 `Abs`, 206 `!=` objects).
Psyonix also stores an `FString` name after FunctionFlags in each UFunction.

Script functions read so far: `Car_TA.{HasDodgeInput, ApplyBallImpactForces, ApplyCarImpactForces,
GetBumpImpulse, IsBumperHit, ShouldDemolish}`, `CarComponent_Dodge_TA.Active.SetDodgeSettings`,
`PlayerController_TA.{PlayerMove, ApplyAirPitchSafety}`, `Ball_TA.{UpdateRadius, SetBallScale}`,
`PhysicsConfig_TA.GetSpeedRequiredForDemo`.
