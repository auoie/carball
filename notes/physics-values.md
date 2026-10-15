# Rocket League physics values (build 2026-06-16)

Every value below was read from the game's own data (decrypted `.upk` packages), and the
mechanics were checked against the decompiled exe. The last column compares with
RocketSim `src/RLConst.h`.

Units: uu (Unreal units, 1 uu = 1 cm). Bullet units = uu × 0.02 (the exe scales by 0.02 when
applying forces). Forces and impulses are in uu × mass. Divide by car mass 180 (ball 30) to get
uu/s² or uu/s.

✓ = matches RocketSim · ≈ = trivially different · ⚠ = real difference (see "Open items")

## Simulation

| Value | Data | Source object | RocketSim |
|---|---|---|---|
| Physics tick | 120 Hz | `TAGame.Default__EngineShare_TA.PhysicsFramerate` | ✓ 120 |
| Max substeps per frame | 5 | `EngineShare_TA.MaxPhysicsSubsteps` | – |
| Gravity Z | −650 | `Engine.Default__WorldInfo.DefaultGravityZ` (`bDisableGlobalGravityZ=True`, so the map's `GlobalGravityZ=-550` is ignored) | ✓ −650 |
| Physics state quantization | on | `PhysicsConfig_TA.bQuantizePhysics` | – |
| Gravity mutators (multipliers) | low 0.5, high 1.75, super 5, reverse −1 | `Mutators_SF: Mutator_Gravity_TA` | – |

## Car (`GameInfo_Soccar_SF: Archetypes.Car.Car_Default`)

| Value | Data | Derived | RocketSim |
|---|---|---|---|
| Mass | 180 | | ✓ `CAR_MASS_BT` 180 |
| Max linear speed | 2300 | | ✓ |
| Max angular speed | 5.5 rad/s | | ✓ |
| Sticky force | ground 0.5, wall 1.5 | blended by up-vector Z | ✓ (0.5 + (1 − abs(up.z))) |
| Auto-roll (`AutoFlip`) | torque 80, force 100 | | ✓ `CAR_AUTOROLL_*` |
| Dodge window after jump | 1.25 s (`MaxTimeForDodge`) | | ✓ `DOUBLEJUMP_MAX_DELAY` |
| Jump leave-ground time | 0.125 s (`PhysicsConfig_TA.JumpLeaveGroundTime`) | | – (not modelled) |
| Supersonic | 2200, turn-off buffer 100, turn-off time 1.0 s | | ✓ |
| Physical material | friction 0.3, restitution 0.1 | | ✓ |

## Vehicle sim (`Car_Default.DefaultVehicleSim`)

| Value | Data | Derived | RocketSim |
|---|---|---|---|
| DriveTorque | 288000 | code: × 0.25 per wheel = 72000 = 180 × 400 | ✓ `THROTTLE_TORQUE_AMOUNT` |
| Fewer than 3 wheels on ground | drive torque × 0.25 again (code) | | ✓ |
| DriveTorqueCurve (signed fwd speed) | −1400→0.1, 0→1, 1400→0.1, clamped beyond | | ✓ RocketSim's 1410→0 matches replays (see "Throttle top speed") |
| BrakeTorque | 10500 | × 0.25 per wheel = 2625 = 180 × 14.583 | ✓ `BRAKE_TORQUE_AMOUNT` |
| SteerAngleCurve (deg, **inner** wheel) | 0→35, 500→20, 1000→11, 1500→6.25, 1750→5, 3000→2 | Ackermann average = RocketSim exactly | ✓ (see note) |
| HandbrakeSteerAngleCurve (deg) | 0→25, 2500→7.5 | Ackermann average = RocketSim | ✓ |
| bUseAckermannSteering | true | | (RocketSim uses the average) |
| HandbrakeRate | rise 5 (class default), fall 2 | | ✓ `POWERSLIDE_*` |
| StopThreshold | 25 | | ✓ `STOPPING_FORWARD_VEL` |
| IdleBrakeFactor | 0.15 | | ✓ `COASTING_BRAKE_FACTOR` |
| OppositeBrakeFactor | 1.0 | | – |

**Steering note:** the curve is the inner front wheel's angle. The outer wheel is
`atan(L·tanθ / (L + W·tanθ))` with the Octane's wheelbase L = 85 and front track W = 51.8.
The average of the two equals RocketSim's radian curve to 5 decimals at every point. For full
authenticity, steer each front wheel separately.

## Wheels (`DefaultVehicleSim.FrontLeft/BackLeft`, identical except SteerFactor)

| Value | Data | RocketSim |
|---|---|---|
| SuspensionStiffness | 500 | ✓ |
| SuspensionDampingCompression / Relaxation | 25 / 40 | ✓ |
| SuspensionTravel | 12 | ✓ |
| SuspensionMaxRaise | 2.5 | – |
| LatFrictionCurve (slip) | 0→1, 1→0.2 | ✓ |
| HandbrakeLatFrictionCurve | 0→0.1 | ✓ |
| HandbrakeLongFrictionCurve | 0→0.5, 1→0.9 | ✓ |
| WallFrictionCurve (contact normal Z) | 0→0.1, 0.707→0.5, 1→1 | ≈ (0.7075) |
| AerialThrottleToVelocityFactor / AerialAccelerationFactor | 1000 / 1.3 | – |
| Octane front WheelRadius | 12.5 (`Body_Octane`) | ✓ |

## Car components (`Archetypes.CarComponents.*`)

| Component | Value | Data | Derived (÷180) | RocketSim |
|---|---|---|---|---|
| Boost | BoostForce | 178500 | 991.67 uu/s² | ✓ ground (air 1058.33 = boost + air throttle 66.67) |
| | BoostConsumptionRate | 0.333/s of max 1.0 | 33.3 boost/s | ✓ |
| | StartBoostAmount | 0.333 | 33.3 | ✓ |
| | MinBoostTime | 0.1 s | | ✓ |
| | Force formula (code) | forward × BoostForce × BoostModifier(1.0), plain force | | ✓ |
| Jump | JumpImpulse | 52500 | 291.67 uu/s | ✓ |
| | JumpForce / JumpForceTime | 262500 / 0.2 s | 1458.33 uu/s² | ✓ |
| | MinJumpTime | 0.0249 s | (3 ticks) | ≈ 0.025 (also 3 ticks) |
| Double jump | JumpImpulse | 52500 | 291.67 uu/s | ✓ |
| Dodge | Forward / Side / Backward impulse | 90000 / 90000 / 96000 | 500 / 500 / 533.3 | ✓ (533.3 = 500 × 16/15) |
| | Max-speed scales F/S/B | 1.0 / 1.9 / 2.5 | | ✓ |
| | Side / Forward torque | 260 / 224 (angular accel., code mode 5) | | ✓ |
| | DodgeTorqueTime | 0.65 s | | ✓ |
| | **MinDodgeTorqueTime** | **0.041 s** before opposing pitch can cancel the flip (verified) | | ⚠ RocketSim defines 0.41 but never uses it, so it allows cancelling from tick 0 |
| | Z damping / delay / up-time | 0.35 per tick / 0.15 s / 0.06 s | | ✓ |
| | DodgeInputThreshold | 0.5 | | ✓ |
| Air control | AirTorque (P, Y, R) | 130, 95, 400 × AirTorqueScalar 1000 | | ✓ |
| | AirDamping (P, Y, R) | 30, 20, 50 × AirDampingScalar 1000 | | ✓ |
| | ThrottleForce | 12000 | 66.67 uu/s² | ✓ |
| Flip car (turtle recovery) | FlipCarImpulse | 200 (velocity change, code mode 2) | 200 uu/s | ✓ |
| | FlipCarTime | 0.4 s | | ✓ |
| | **FlipCarTorque** | **1000, applied as angular-velocity change every tick (code mode 2), so it hits the 5.5 rad/s cap immediately** | | ⚠ RocketSim ramps at 50 rad/s² |

## Ball (`Archetypes.Ball.Ball_Default`, `PhysicalMaterials.Game.Physmat_Ball`)

| Value | Data | RocketSim |
|---|---|---|
| Mass | 30 | ✓ (180/6) |
| Max linear speed | 6000 | ✓ |
| Max angular speed | 6 rad/s | ✓ |
| **Collision sphere radius** | authored 92.0; Bullet shape 91.25 (+1.25 skin, −2 in the converter); gameplay `Radius` ≈ 94.5 — see below | ✓ 91.25 |
| Visual radius | 95 | – |
| Friction / restitution / linear damping | 0.35 / 0.6 / 0.03 | ✓ |
| Car-ball push factor curve | 0→0.65, 500→0.65, 1400→0.6, 2300→0.55, 4600→0.30 | ✓ (1400 point is collinear) |
| Push Z scale / forward scale | 0.35 / 0.65 | ✓ |
| Max relative speed | 4600 | ✓ |
| Car-ball friction | 2.0 | ✓ |

## Arena surfaces (`Startup.upk: PhysicalMaterials.*`)

| Material | Friction | Restitution | Notes |
|---|---|---|---|
| Collision_Sticky, Goalpost_Post, Goalpost_Crossbar, World.* | 1.0 | 0.3 (engine default) | `bStickyWheels = True` |

**Combine rule (inferred):** friction multiplies and restitution takes the max. Applied to the
data, this gives RocketSim's per-pair values: ball–world 0.35 / 0.6, car–world 0.3 / 0.3,
car–car 0.09 / 0.1. RocketSim's `ARENA_COLLISION_BASE_FRICTION = 0.6` is overridden per pair,
so it isn't a real conflict.

## Car–car (`TAGame.Default__PhysicsConfig_TA.CarInteractionSettings`)

| Value | Data | ÷180 | RocketSim |
|---|---|---|---|
| Bumper push, ground | 0→150, 1400→200000, 2200→275000 | 0.833, 1111.1, 1527.8 | ≈ 0.833, 1100, 1530 (rounded measurements) |
| Bumper push, air | 0→150, 1400→250000, 2200→350000 | 0.833, 1388.9, 1944.4 | ≈ 1390, 1945 |
| Z push | 0→50, 1400→50000, 2200→75000 | 0.278, 277.8, 416.7 | ≈ 0.333, 278, 417 |
| Bump interval | 0.25 s | | ✓ `BUMP_COOLDOWN_TIME` |
| Centre-of-mass angle check (enabled) | bump: yaw 70°, pitch 36.87°; demo: yaw 45.57°, pitch 36.87° | | ⚠ different method (RocketSim: `BUMP_MIN_FORWARD_DIST` 64.5) |
| Demolish condition | supersonic, other team (`Car_TA` defaults) | | ✓ |
| Other angle checks | VictimHitAngle, AttackerHitAngle, VictimHitAngleCurve, ImpactNormal (0.707 demo / 0.259 bump) | | all disabled in the package |
| Supersonic (`SuperSonicSettings`) | on from 2200; off after 1 s below 2200 (`TimeBelowSupersonicSpeed`) or under 2100 | | ⚠ RocketSim timed from becoming supersonic (patch 34) |

## Boost pads (`Stadium_P: Archetypes.VehiclePickup.*`)

| Pad | Amount | Respawn | Pickup cylinder | RocketSim |
|---|---|---|---|---|
| Small (`BoostPad`) | 0.12 (12) | 4 s | **r 128** (level instances; archetype 96), half-height 64 | ✓ amount/respawn; RocketSim cyl r 144 = 96 + 48 (patch 35: 176) |
| Big (`BoostPill`) | 9999 (full) | 10 s | r 160, half-height 64 | ✓; RocketSim cyl r 208 = 160 + 48 |

A pickup is the overlap of the pad's collision cylinder and the car's (`Default__Car_TA.CollisionCylinder`:
r 48, half-height 32): the car's origin within r + 48 horizontally and 64 + 32 = 96 vertically. All 28 small pads
in `Stadium_P` override CollisionRadius to 128, so small pads reach 176, not RocketSim's 144. Replays (805 small /
260 big pickups with the car's row in the pickup frame and the one before): the best radius is 174–178 for small
and 204–210 for big pads in every speed band; respawns are 4.0 / 10.0 s. Pad positions match RocketSim
(e.g. 2048, −1036).

## Car bodies and presets (body packages, local only)
How a body becomes a car (`CarMeshComponentBase_TA.InitBodyAsset`, `GetPhysicsAsset`; `VehicleSim_TA.SetupPresetAxle`
/ `SetupWheelPreset`; wheel setup `FUN_140f044e0`):
- The hitbox is the handling preset's physics asset when the body has a preset (the body's own `PhysicsAsset` only
  otherwise). Wheel radius and rest position come from the preset's axles; the body's axle settings (`WheelRadius`,
  `WheelOffsetForward/Side`, `WheelMeshRadius`) only place the visual wheels (bone names for the visual mesh; the physics
  wheels have no `PhysicsBoneName`, so the setup takes `PresetRestPosition`). Wheel radius, travel and the hitbox box
  are scaled by the mesh's scale (1 for the bodies checked).
- `CalculatePresetSuspensionOffset` (`FUN_140ecaeb0`) only lifts the mesh so its wheels sit on the physics wheels (mesh
  axle bones, preset axle heights, body wheel radii, `HandlingPresetZOffset`, `SuspensionTravelMin`, and
  `bUseLegacySuspensionOffsets` choosing which radius).
- `Car_TA.ApplyHitWallAdjustmentForces` (called on every car–world collision) is empty.
- 134 body assets decoded (168 of 218 packages decrypt). Presets used: MuscleCar (Dominus) 42, Octane 38, LongCar
  (Breakout) 16, Hybrid 14, Plank 8, Merc 6. Exceptions: `HandlingPresetXOffset` on body_aa (Breakout, 7.75), body_banjo
  (Merc, 5.0), body_skunkz (Hybrid, 6.5); no preset (own physics asset, wheels from mesh bones): Body_Darkcar and the
  mystery-body placeholder; `SteerScale` 0.449 on body_slime (not read by any car script; unknown whether physics).
- The game's variant presets look like baked X offsets: `LongCar_Aa`'s hitbox centre is 4.75 = LongCar's 12.5 − 7.75
  (body_aa's offset). How the offset moves the hitbox relative to the centre of mass is not confirmed (live game).
- Product IDs (the replays' body numbers) are not in the packages (the product template is filled in online), so the
  replay bodies are mapped by fitting (notes/validation.md finding 21). Per-body data does not explain the steering
  residual of the Dominus/Plank/Breakout bodies: they use their presets unchanged.

## Kickoffs (replays)
- Spawn spots and facing as RocketSim (±2048, ±2560 / ±256, ±3840 / 0, ±4608), cars at z 17.0 after landing (the
  game drops them from ~38.6).
- Ball: reappears at z 100.49, falls, and its velocity is cleared at its first floor contact (z 92.75); asleep 2 s
  later (patch 36). A rolling ball settles at 93.15 (= RocketSim's BALL_REST_Z).
- Cars get no input for 4.0 s after the reset (691 kickoffs: first movement 3.99–4.05 s; patch 37).
- After a goal: `PostGoalTime` 3.0 s, then the replay (skipped online here) and the reset.

## Netcode (`TAGame` config defaults)

| Setting | Value | Source |
|---|---|---|
| Client prediction | enabled | `EngineShare_TA.bEnableClientPrediction` |
| Max uploaded client frames | 30 | `EngineShare_TA` |
| Input frames per packet (redundancy) | up to 10 | `NetworkInputBuffer_TA.MaxInputFramesPerPacket`, `NetworkConfig_TA.MaxClientUploadFrames` |
| Input send rate | 60 Hz | `NetworkInputBuffer_TA.NetUpdateFrequency` |
| Jitter buffer | min 0.05 s, size 4 σ, rolling 15 s, max 10-frame adjustment, packet gap 0.016–0.25 s | `NetworkJitterSettings_TA` |
| Client sim-time scaling | time dilation 1.0256 / 1.0063 / 1.0 / 0.9938 / 0.9756, chosen by server input-buffer fill (starved 2, good 4, saturated 6, extremely saturated 14, max 20); fixed adjust rate 0.009 | `PhysicsConfig_TA.CSTS/STS` |
| Remote-body correction | location fix rate 4, angular fix rate 5, min Δloc 5, min Δrot 100, min Δvel 10, welded lerp 18, force-replication delay 0.35 s | `RBActor_TA.NetworkSyncSettings` |
| Force packet near ball | yes, within 1000 uu | `NetworkConfig_TA`, `AVehicle_TA::execForceNetPacketIfNearBall` |
| Connection quality | ping mediocre 0.25 / bad 0.35 s; jitter 0.04 / 0.06 s; loss 5% / 9% | `ConnectionQualityConfig_TA` |

## Verified by decompilation (native code + UnrealScript bytecode)

UnrealScript was disassembled with `scripts/ubytecode.py`. Rocket League reshuffles the bytecode
tokens; the mapping was recovered from the exe's GNatives registrations (see `notes/findings.md`).

### Dodge (`Car_TA.HasDodgeInput`, `CarComponent_Dodge_TA.Active.SetDodgeSettings`, native `FUN_140eb72b0`)
```
// dodge vs double jump
Threshold = PRI != None ? PRI.DodgeInputThreshold : DodgeComponent.DodgeInputThreshold  // 0.5 default
dodge if Abs(DodgeForward) + Abs(DodgeRight) + Abs(Roll) >= Threshold
// inputs (PlayerController_TA.PlayerMove): DodgeForward = -Pitch, DodgeRight = Yaw
DodgeDirection = Normal(DodgeForward, DodgeRight + Roll, 0)
DodgeTorque.Y = Round(ForwardDodgeTorque(224) * DodgeDirection.X * DodgeTorqueScale)
DodgeTorque.X = Round(SideDodgeTorque(260) * -DodgeDirection.Y * DodgeTorqueScale)   // rounded to integers
if GetGravityZ() > 0: DodgeDirection.Y *= -1                                          // reverse gravity
// every tick while active (native): angular accel = DodgeTorque (car frame) / Car.Mesh.Scale
// pitch part may be cancelled by opposing pitch input only once ActiveTime >= MinDodgeTorqueTime (0.041 s)
// Z damping: from 0.15 s, vz -= vz*0.35 per tick while falling; while rising only until 0.21 s
// (ActiveTime: the time active before this tick, 0 on the press tick; see "Timing within a tick" below)
```
The dodge-torque divisor `Car+0x438 → +0x238` is `Pawn.Mesh` → `PrimitiveComponent.Scale` (1.0 normally).
Keyboard/mouse-only: `ApplyAirPitchSafety` zeroes nose-down pitch in the air until the player has
pitched or rolled (an input aid, not physics).

### Car–ball hit (`Car_TA.ApplyBallImpactForces`, called from `Car_TA.OnHitBall`)
Applied at most every other physics frame while touching (`OnHitBall`: `CurrentFrame − LastBallImpactFrame > 1`).
RocketSim had the same formula but read the velocities during the step instead of at the start of the tick: fixed
(engine patch 28), confirmed by replays (`notes/validation.md`).
```
RelVel = Car.Vel - Ball.Vel                       // start-of-tick (OldRBState) values
RelSpeed = min(|RelVel|, 4600)
HitDir = Normal(Ball.Pos - Car.Pos); HitDir.Z *= 0.35 * (1 + AdditionalCarBounceScaleZ*0.5); HitDir = Normal(HitDir)
HitDir -= CarFwd * Dot(HitDir, CarFwd) * (1 - 0.65); HitDir = Normal(HitDir)
Impulse = HitDir * RelSpeed * PushFactorCurve(RelSpeed) * (1 + AddedCarBounceScale) + HitDirXY * GroundBounceScaleXY
Ball.AddForce(Impulse, VelocityChange)            // mutator terms are 0 in normal play
```

### Car–car (`Car_TA.ApplyCarImpactForces`, `GetBumpImpulse`, `IsBumperHit`, `ShouldDemolish`)
```
Speed = |Vel|; HitDir = Normal(Other.Pos - Pos); SpeedTowardsCar = Dot(HitDir, Vel)
no effect unless SpeedTowardsCar > 0 and Dot(Other.Vel, Vel/Speed) < SpeedTowardsCar
if ShouldDemolish: demolish                      // checked before (and regardless of) the bump cooldown
  requires bSupersonic AND |Dot(Vel, CarFwd)| >= 2200 - 100 = 2100   // bAllowBackwardsDemolitions = 1
  AND victim inside cone yaw <= 45.57 deg, pitch <= 36.87 deg around the direction of travel (Fwd or -Fwd)
  AND other team
else if Other != LastHitCar or time > LastHitTime + 0.25: BumpCar (sets LastHitCar/Time, fires EventBumpedCar)
  bumper hit = victim inside cone yaw <= 70 deg, pitch <= 36.87 deg (always the real forward)
  Speed = |Vel| of the attacker (the curves do NOT use SpeedTowardsCar)
  Impulse = (Vel/Speed) * (Other on ground ? GroundCurve(Speed) : AirCurve(Speed))
          + (Other on ground ? Other.Up * ZCurve(Speed) : 0)     // non-bumper hits: PushFactor = 0
All states are the start-of-tick OldRBState, except the demo cone (below).
```
Demo cone at the time of impact (`ShouldDemolish` → `GetTimeOfImpact`, native `FUN_140efc840`): for each car,
`FUN_140e9c2e0` takes OldRBState (quaternion +0x590, location +0x5a0, velocity +0x5ac, angular velocity +0x5b8)
and integrates it one tick back (negated velocities) and one tick forward (`btTransformUtil::integrateTransform`,
`FUN_1402a9680`). `FUN_140efc5c0` runs Bullet's `btContinuousConvexCollision` (Voronoi simplex solver, a
penetration-depth solver) between the compound children (the hitbox boxes) over that span, CastResult allowed
penetration 0.04, keeping the smallest fraction < 1. Impact: locations lerped, quaternions slerped at the fraction;
a missed sweep logs "ShouldDemolish() sweep check missed." and uses OldRBState (`InitTimeOfImpactFromOldRBState`).
The cone (`FUN_140f0c940`) uses the attacker's impact rotation and the hitbox centres at impact (location +
rotated `LocalCollisionOffset`, car +0x838). `IsBumperHit` always uses `InitTimeOfImpactFromOldRBState`.
The demo itself (`OtherCar.Demolish(self)`) leaves the contact to the solver: the attacker loses speed (replays,
notes/validation.md finding 17).
Cone test (native `FUN_140f0d620`): direction d from attacker's hitbox centre to victim's at time of
impact; pitch angle = angle(fwd, d with its right-axis component removed); yaw angle =
angle(fwd, d with its up-axis component removed). (It removes 1/1.01 of the component.)

### Speed limits (native `FUN_140eed9e0`, `FUN_140f17910`)
Linear and angular velocity are clamped by scaling the whole vector to MaxLinearSpeed / MaxAngularSpeed;
the limits are also pushed into the Bullet body. So FlipCar's per-tick Δω = 1000·fwd immediately
saturates at 5.5 rad/s (RocketSim ramps at 50 rad/s²).
Two clamps per tick: the game's Bullet caps each body at the start of every substep (`applyDamping` `FUN_1402c23a0`,
body +0x368 / +0x36c), after the car components' impulses and before the vehicle update; the RB-state read-back
(`FUN_140eed9e0`) caps the result again. A dodge or jump that takes the car over 2300 moves it from the cap (engine
patch 51); recorded speeds never exceed 2300.001 uu/s.

### Throttle/brake (native `FUN_140f1e830`, `FUN_140f5ff00`, friction solver `FUN_1402c49d0`)
- throttle against motion beyond 25 uu/s → brake = OppositeBrakeFactor (1.0); no throttle → brake 0.15
  while moving, 1.0 below 25 uu/s; any brake zeroes throttle; no brake in the air.
- drive force per wheel = DriveTorqueCurve(fwd speed) × throttle × 288000 × 0.25 (× 0.25 again with < 3 wheels).
- friction solver: forward impulse = engineForce × dt (or clamp(−v_fwd × 113.74, ±brake) × dt × 60 when
  braking) × long friction; side impulse = bilateral impulse × dt × 60 × lat friction.
- No writer of OutputThrottle (script or native) and nothing in the friction solver applies a speed cutoff,
  yet replays show zero throttle acceleration above ~1400 (see "Throttle top speed"). Where it comes from is unknown.

### Ball size (three different numbers in the game)
| Use | Value | Source |
|---|---|---|
| Authored collision sphere | 92.0 | `RB_BodySetup` sphere |
| Bullet collision sphere | 92 + 1.25 − 2 = **91.25** (UE3 skin +0.025 BT, then radius×0.02 − 0.04 BT; margin = radius) | `FUN_140967480` + converter `FUN_140409570` |
| Gameplay `Ball.Radius` (prediction, AI, stats, goal checks) | ≈ 94.5 | `Ball_TA.UpdateRadius` = mesh bounds Z (94.49) |
RocketSim uses 91.25 too (rest Z 93.15, see "Ball vs world contact").

### Air control (native `CarComponent_AirControl_TA` ApplyForces `0x140eb3400`) — matches RocketSim
```
// inputs: shaped = clamp(input * AirControlSensitivity, -1, 1); sensitivity >= 10 -> sign(input)
// pitch input forced to 0 while the dodge is active and for 0.3 s after it ends (ActivityTime < 0.3)
k = AirTorqueScalar(1000) * 2π/65536
torque  = (-pitch*AirTorque.Pitch(130))*Right + (yaw*AirTorque.Yaw(95))*Up + (-roll*AirTorque.Roll(400))*Fwd   [× k, angular accel]
damping = -( (1-|pitch|)*Dot(ω,Right)*30*Right + (1-|yaw|)*Dot(ω,Up)*20*Up + Dot(ω,Fwd)*50*Fwd ) × AirDampingScalar(1000)*2π/65536
air throttle = ThrottleForce(12000) * Fwd * (BoostComponent.bActive ? 1 : throttle)                    [force]
// stock RocketSim added throttle × 66.67 on top of its air boost (which already includes the 66.67): engine patch 27
```

### Input shaping (`FUN_140396ca0`)
`shaped = clamp(input * sensitivity, -1, 1)`, or `sign(input)` when sensitivity ≥ 10 (max).
Used for steering (`VehicleSim.SteeringSensitivity`, default 1.0) and aerials (`AirControlSensitivity`).

### Jump / double jump / dodge state machine (script `Car_TA.OnJumpPressed` etc. + natives)
```
OnJumpPressed:
  if auto-flip (FlipCar) can activate and no dodge active -> auto-flip instead
  grounded = wheels in contact >= NumWheelsForGrounded (3)       // any surface, incl. ball/cars
  if grounded and !bJumped: bJumped = true; Jump.Activate()
  else if airborne and a double jump is available
       and (!bJumped or within dodge window):                   // drove off a ledge: no time limit
      bJumped = bDoubleJumped = true
      HasDodgeInput ? Dodge.Activate() : DoubleJump.Activate()
OnJumpReleased: Jump.bDeactivate = true
dodge window: min(InactiveTime of Jump, Dodge, DoubleJump) <= MaxTimeForDodge (1.25 s)  // counts from jump end
landing (grounded becomes true): bJumped = bDoubleJumped = false
Jump: tick 0 impulse 52500·Up (291.67 uu/s); force 262500·Up while ActivityTime <= 0.2 s;
      ends on release once ActivityTime > MinJumpTime (0.0249) or at 0.2 s
DoubleJump: tick 0 impulse 52500·Up; component ends after 0.1 s
Boost: consumes 0.333/s; stays on >= MinBoostTime (0.1 s); recharge only if RechargeRate set (not in soccar)
```
Flip reset: landing 3+ wheels on the ball counts as grounded, which clears bJumped/bDoubleJumped, so the
next dodge has no time limit. `IsOnRBActor` = grounded with ≤ 1 wheel on world geometry (fires the flip-reset event).

Timing within a tick (live recordings, notes/validation.md finding 24; engine patches 39–41):
- The input handlers above and the car's pre-physics step (`Car_TA` `FUN_140f1c600`: auto-roll `FUN_140eb8560`,
  sticky force `FUN_140eb70a0`, supersonic; the components' ApplyForces: jump, dodge, air control, boost) run
  before the vehicle casts the tick's wheel rays. So "grounded", the sticky force, air control, boost (ground or air
  acceleration) all use the contacts the previous tick's rays found, and the vehicle's contact pass, suspension and
  friction see the impulses (on a jump's press tick the suspension gives no support: the car gains exactly
  291.67 + (1458.33 − 650 − 325)/120 uu/s).
- The jump force is the full 1458.33 uu/s² from the press tick (no ramp; RocketSim scaled it by 0.62 for 0.025 s).
- A component's ApplyForces gets the time it has been active before this tick: 0 on the press tick. The dodge torque
  starts on the press tick (pitch 224/120 = 1.867 rad/s that tick); pitch cancel from active time ≥ 0.041 (the 5th
  tick after the press); Z damping while active time ≥ 0.15 (18th tick) and the dodge active (< 0.65 s: up to the
  78th tick, since 78 float additions of 1/120 make 0.6499997), while rising only below 0.21 s. With the damping
  applied before gravity a falling dodge settles at vz = −(650/120)/0.35 = −15.48 uu/s.

### Car hitboxes and wheels (`Startup.upk: HandlingPresets.Presets.*`, physics assets `HandlingPresets.Physics.*`)
| Preset (body) | Hitbox box X×Y×Z | Box offset X | Front wheel (x, y, r) | Back wheel (x, y, r) |
|---|---|---|---|---|
| Octane | 118.0074 × 84.1994 × 36.1591 | 13.8757 | 51.25, 25.9, 12.5 | −33.75, 29.5, 15 |
| Dominus (MuscleCar) | 127.9268 × 83.28 × 31.3 | 9.0 | 50.3, 31.1, 12 | −34.75, 33, 13.5 |
| Plank | 128.8198 × 84.6704 × 29.3944 | 9.0086 | 49.97, 27.8, 12.5 | −35.43, 20.28, 17 |
| Breakout (LongCar) | 131.4924 × 80.521 × 30.3 | 12.5 | 51.5, 26.67, 13.5 | −35.75, 35, 15 |
| Hybrid | 127.0192 × 82.1879 × 34.1591 | 13.8757 | 51.25, 25.9, 12.5 | −34.0, 29.5, 15 |
| Merc | 120.7202 × 76.7103 × 41.6591 | 11.3757 | 51.25, 25.9, 15 | −33.75, 29.5, 15 |
Wheel positions/radii match RocketSim exactly. Hitbox boxes listed are the data (pre-skin) values; the game
inflates them by +2.5 on every axis (PhysX skin width, see below), giving RocketSim's numbers exactly.
Box offset Z and wheel suspension rest heights: see `out/handling_presets.txt` / `out/hitboxes.txt`.

### Suspension (Bullet vehicle `FUN_1402c2a40`, contact pass `FUN_1402c3360`, scale `FUN_1402c52a0`)
```
per wheel in contact:
  damping = relVel < 0 ? DampingCompression(25) : DampingRelaxation(40)
  force   = max(0, ((restLength - length) * Stiffness(500) * clippedInvContactDotSuspension - relVel*damping) * scale)
  scale   = mass * (other axle's |x|) / wheelbase / 2      // per-wheel weight share
  impulse = contactNormal * (force*dt + bottomOut) at the contact point
  bottomOut = 0.25 * single-contact impulse when trace < radius + rest − MaxRaise (opposite impulse to the ground body:
              static ground or cars only; vehicle mask 0xff7f excludes RBCC_Ball, so none on the ball)
```
**New:** the suspension scale is computed per car from its wheel positions (Octane 35.735 / 54.265; Dominus
36.77 / 53.23 …). RocketSim uses the Octane values for every car.

### Sticky force (`Vehicle` `FUN_140eb70a0`) — matches RocketSim (direction: sum of touching wheels' contact normals, normalized, `FUN_140eed3e0`; "throttling" = raw `Input.Throttle` ≠ 0, patch 32)
Only if a wheel touches a material with `bStickyWheels` (all arena surfaces).
`accel = contactUpDir * GravityZ * (Ground·|n.z| + S·(1−|n.z|))`, S = Wall (1.5) when throttling or
|fwd speed| > 25, else Ground (0.5). Flat floor: 325 uu/s²; wall while driving: 975 uu/s².

### Bullet world (`FUN_140403cc0`)
Axis-sweep broadphase (16,384 handles), stock dispatcher, sequential-impulse solver, discrete world.
Solver settings changed from Bullet defaults: **splitImpulse = 1, splitImpulsePenetrationThreshold = 1e30**
(always split impulse; RocketSim does the same) and **solverMode = 0 (warm starting off; RocketSim keeps it on)**.
Iterations stay at 10. Rigid bodies: inertia from the shape, damping/friction/restitution from the material.

### Collision details
- Sphere vs triangle uses Bullet's SphereTriangleDetector (no triangle margin), modified to be **one-sided**:
  a ball whose centre is behind a triangle gets no contact.
- Ball sphere in Bullet = (authored radius + 1.25 skin) − 2: 92 → **91.25**. Its bounding radius (for the contact
  threshold) is r + 0.04 + 0.04 BU: threshold 1.905 uu (read live).
- New contact points merge with a cached point within the threshold (stock `getCacheEntry`; engine patch 47).
- Restitution applies at every approach speed (2.82's `restitutionCurve` has no threshold; engine patch 48).
- Wheels on a dynamic body (ball, car): each pushes it with an impulse of 1.0 into its surface every tick and wakes
  it; the wheels' friction treats every ground as static and motionless (Bullet's fixed body, no ground velocity);
  the suspension's bottom-out impulse reaches a dynamic body only if its collision group is in the vehicle's mask
  (+0x30 = 0xff7f: every channel but 7, RBCC_Ball), so cars get it and the ball doesn't (engine patches 49, 50, 54, 97).
  Verified against the live build (FP1, 2026-10-14): all per-wheel impulses match; see "Wheels on dynamic bodies and
  the flip-cancel lock (FP1)".
- Convex vs plane (`FUN_1402944b0`, the algorithm for the finite planes): stock Bullet (the convex shape's deepest
  vertex, one point per call, no perturbation: the collision configuration `FUN_140281860` keeps the defaults 1 / 0)
  plus a bounds check: no contact unless that vertex lies within the plane's half extents (shape `+0x20`, `+0x24`)
  plus the breaking threshold. The arena's planes reach past everything a car or ball can touch, so the engine's
  infinite planes behave the same. Contact manifolds persist while the broadphase (axis sweep) keeps the pair: up to
  4 points per manifold (engine patch 43).
- Arena = flat planes (floor z 0, ceiling z 2048, side walls x ±4096) + `FieldCollision_Standard` curved meshes
  (SideTop, SideBot, Corner, Goal at y ±5120), mirrored by negative scale; one-sided triangles.

### Physics state quantization (`bQuantizePhysics = True`; `FUN_140eed9e0` → `FUN_140e45c10`)
Every tick each body's state is written through the network serializer and read back:
- location: `round(x*100)/100` (round half up)
- rotation: smallest-three quaternion, 2-bit index + 3 × 18 bits over ±1/√2
- linear velocity: `trunc(v*100)/100 + sign*0.001`
- angular velocity: `trunc(ω*10000)/10000 + sign*0.00001`
- sleeping → zero velocities
RocketSim does not do this.

## Resolved with code + replays (2026-10-06)

Replay measurements: `scripts/replay_extract` (Rust, boxcars) → `scripts/replay_measure.py`, run on
30 ranked replays from Sept 2025.

### PhysX "skin width" (+0.025 Bullet units = +1.25 uu per side) — explains RocketSim's sizes
UE3's shape builder (`FKAggregateGeom::InstanceNovodexGeom`, `FUN_140967480`) inflates every shape:
sphere radius `r·0.02 + 0.025`, box half-extents `X·0.5·0.02 + 0.025` (same for capsules).
Psyonix's Bullet converter then uses those sizes (spheres additionally `− 0.04`).
- **Ball Bullet sphere = 92 + 1.25 − 2 = 91.25 uu** (= RocketSim).
- **Car hitbox = data box + 2.5 uu on every axis** (Octane 120.507 × 86.6994 × 38.6591 = RocketSim);
  inertia comes from this inflated box. Data values are pre-skin.
- Read live (PhysLog's `_bullet.csv`, 2026-10-08): the car's Bullet box is exactly that (inner 58.3207 / 41.4167 /
  17.3966 uu + margin 1.9330 = 60.2537 / 43.3497 / 19.3295), inverse inertia 0.0184953 / 0.0104059 / 0.0075624
  (BU), contact threshold 2.0334 uu; RocketSim's box came out 0.068 uu smaller per half extent (engine patch 46).

### Ball vs world contact (custom "special" contact, `FUN_14040a5f0` → solver `FUN_1402b2720` / `FUN_1402be240`)
- Psyonix's contact-added callback: friction = product (× global scale 1.0), **restitution = max**,
  internal-edge smoothing, and flags sphere-vs-triangle / sphere-vs-plane contacts.
- Flagged contacts are not solved individually: per ball, count/friction/restitution/normal/distance
  are summed, then averaged (normal re-normalised) into **one** contact at `−normal × avgDistance`
  with zero separation (velocity-only). RocketSim copies this design (it does not re-normalise the normal).
- Floor, ceiling and flat walls are Psyonix finite planes (`bSimpleCollisionPlane`, shape type 28);
  curved pieces are one-sided triangle meshes.
- **Measured effective contact distance vs planes: 93.15** (ball rolling on floor: mode 93.15, n=5054;
  side walls 93.11–93.15; back walls 93.12–93.15). Curved meshes: ~91.3–92.5 (faceting makes this noisy).
- Ball vs car uses normal contacts (not flagged) with the 91.25 sphere.

### Throttle top speed — measured
Throttle-only acceleration on flat ground follows `1600 → 160 uu/s²` linearly to 1400 within 3–8%,
then **0 at ≥ 1400–1410** (median ≈ 0; slight −2 uu/s² drift above). RocketSim's
`0→1, 1400→0.1, 1410→0` curve is behaviourally correct. The game data/code clamp the curve at 0.1;
the mechanism producing the cutoff is still unidentified, but the behaviour is settled.

## Still open (minor; behaviour is measured, only the code location is unknown)
- The ~1.9 uu ball–plane resting gap: the ball settles just under its contact-breaking threshold (the velocity-only
  special contact stops it where the contact first appears). Live car–ball touches put that threshold at ~1.945 uu
  (sphere bounding radius r + 0.12 BU, engine patch 44); the resting height stays at the measured 93.15. Where the
  game's sphere gets that bounding radius is not located.
- Where the throttle cutoff above 1400 is implemented.

## Input quantization (`Vehicle_TA.SetVehicleInput`, native `FUN_140f30a70`)
For the server and the locally controlled car (`Role > ROLE_SimulatedProxy`), every input axis (throttle, steer,
pitch, yaw, roll, dodge forward, dodge strafe) is clamped to [−1, 1] and stored as a byte:
```
f = v < 0 ? max(v * 128, -128) : min(v * 127, 127)
b = round_half_even(2 * (f + 128) + 0.5) >> 1          // = round half up of f + 128
v = b < 128 ? (b - 128) * (1/128) : (b - 128) / 127    // what the physics reads
```
`ReplicatedThrottle` / `ReplicatedSteer` are these bytes. `InputRestriction == 1` turns positive dodge-forward (and
an AI's positive throttle) negative. Engine patch 29; the network protocol sends the same bytes.

## Validated against replays (2026-10-06)
See `notes/validation.md`: ball physics exact to the replays' precision (free flight and arena contacts); car driving
(coasting 525.8 uu/s², throttle, steering) within about 1%; steering sensitivity applied in the physics; car–ball
touches unbiased after patch 28.

## Sleeping (Bullet deactivation, stock `updateActivationState` `FUN_1402c14a0`)
`gDeactivationTime` = 2.0 (never written), `gDisableDeactivation` = false (only the debug drawer sets it). Bodies are
built with `btRigidBodyConstructionInfo` defaults (`FUN_140409570`): linear threshold 0.8 BU/s (40 uu/s), angular
1.0 rad/s, friction 0.5 and restitution 0 before the materials apply. Below both thresholds for 2 s a body falls asleep
and Bullet zeroes its velocities (and the per-tick quantization reports sleeping bodies with zero velocity). The ball
sleeps (replays: 2.0 s after a reset at rest); cars never do (`Car_Default.bDisableSleeping = True`). Resets wake the
ball (`WakeRigidBody`). Engine patch 30.

## Ball on the floor (replays, `notes/validation.md`)
Sliding: ~230 uu/s² friction plus the 3%/s drag. Rolling: 2.3%/s (drag acting through the rolling constraint,
0.03 × 5/7 for a solid sphere). Rolling is only possible below 6 rad/s × 91.25 = 547.5 uu/s.

## Vehicle update (the game's Bullet vehicle; engine patch 31)
Per tick (`FUN_1402c5340`): wheel hard points (`FUN_1402c38b0`), one broadphase query around all wheel rays
(`FUN_1402c1730`), each wheel's ray tested per candidate object (`FUN_1402c3b50`), contact pass (`FUN_1402c3360`),
the VehicleSim hook (`FUN_140eca840`: Wheel_TA updates, `FUN_140f1e830` throttle/brake, `FUN_140f5ff00` steering and
wheel friction values, wheel frames updated with this tick's steering), suspension (`FUN_1402c2a40`), friction
(`FUN_1402c49d0`).
- Wheel setup (`FUN_140f044e0`, ×0.02): radius = WheelRadius, rest = hard point height − LocalRestPosition.z (hard
  point at the hitbox centre height), travel = SuspensionTravel (12), max raise = SuspensionMaxRaise (2.5), friction
  point offset = ContactForceDistance (0), minimum hit distance = hitbox height (pre-skin) / 2 − 1.
- Ray: radius + rest + travel down the car's up axis; per object the closest hit, ignored if closer to the hard point
  than the minimum distance; the closest remaining hit wins.
- Contact pass: suspension length = trace − radius (no clamp); pushback reset to 0, and when trace < radius + rest −
  max raise: `resolveSingleCollision` (impulse only, not applied) with a static default `btContactSolverInfo` (1/60 s,
  erp 0.2), stored × 0.25 and added to the suspension impulse; on a dynamic ground body the opposite impulse goes to
  it: cars only, the vehicle mask 0xff7f excludes RBCC_Ball (modelled, engine patch 54; FP1 2026-10-14). Relative velocity and 1/(n·up) clipped at 0.1 → 10.
- Friction: lateral = `resolveSingleBilateral` against the fixed body along the wheel's axle (not projected) × dt ×
  60 × lat friction; longitudinal = engine force × dt, or clamp(v_contact·fwd × 113.74, ±brake) × dt × 60, × long
  friction, along normalize(normal × axle); applied at the contact point projected onto the plane through the car's
  centre (minus up × ContactForceDistance = 0).
- Inside `FUN_140f5ff00`, in this order: the steer angle (speed curve × shaped input) is written to each Bullet wheel
  (`+0xbc`, × the wheel's SteerFactor); `FUN_1402c58b0` rebuilds the wheels' bases from it (front-left: the chassis
  basis rotated about the chassis up axis by its angle, `FUN_1402c54b0`; front-right: a copy; rear: the chassis
  basis); then per wheel `FUN_140f584c0` caches the basis' second column as the lateral axis (longitudinal =
  contact normal × lateral) and `FUN_140f588f0` measures the slip along them for the friction curves. So the slip
  uses this tick's steer angle (engine patch 38; RocketSim used the ray pass's axles, last tick's angle).
- `PhysicsConfig_TA.bUseAckermannSteering` is false: at setup the car's Ackermann steering is turned off and its
  inner-wheel steering curves are converted to the inner/outer average for its geometry; both front wheels steer by it
  (engine patch 8; replays confirm, see validation.md).

---

## Car–car residual, rotator-built axes and per-body handling (CCR-1..7, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent CCR1. The proposed engine patch is
out/bsim/agents/CCR1/ccr-engine.patch (a diff against the working tree at the time; six files: Arena.cpp, Ball.cpp,
btVehicleRL.h/.cpp, a new GameRotator.h, rl_patch_tests.cpp); the live session owns the engine and applies it.
Proposed text for validation.md (findings 21, 40) and HANDOFF.md is in the draft; the live session owns those files.

Workspace: `out/bsim/agents/CCR1/` (local, git-ignored). Engine copies: `base/engine` (the repo's working tree as of
2026-10-10 06:1x, unchanged but for an absolute mesh path and two test targets in its CMakeLists), `fix/engine` (base
plus the proposed patch), `exp/engine` (instrumented, env-switched variants). Proposed patch: `ccr-engine.patch`
(`diff -ruN base/engine fix/engine`). Exe citations are the live build (2026-10-06, project copy `rl-live`).

### Summary

- **CCR-1 (root cause of `car_car` 0.43 / 3.0 uu/s).** The bot first diverges at tick 581 (2.11 uu/s), the
  roof landing: the player's two back wheels bottom out on the bot's roof before the bodies touch (582). Each wheel's
  bottom-out pushback is a `resolveSingleCollision` against the bot, which gets the opposite impulse at once, so the next
  wheel's pushback reads the bot's changed velocity: the order matters. The game runs its contact pass in its wheel
  order (front left, front right, back left, back right); RocketSim's array is right before left. And the game applies
  each wheel's 1.0 push on a dynamic ground inside the same pass, right after that wheel's pushback; the engine applied
  it after the whole pass. With both as the game: `car_car` per tick car 0.433 → 0.00014, bot 3.042 → 0.010 uu/s;
  continuous car 7.88 → 0.03–0.06, bot 8.27 → 0.010. Either change alone does not fix it (order alone: bot 0.09 with a
  systematic 0.03–0.07 left over 580–588; push alone: 3.08). Confidence: high.
- **CCR-2 (the last 0.09 in `car_car`, tick 110, a side bump).** `GetBumpImpulse` takes the victim's up as
  `GetRotatorAxis(QuatToRotator(OldRBState.Quaternion), 2)`: a rotator rounded to whole units (65536 a turn) and the
  axis rebuilt through UE3's 16384-entry sine table, not the body's exact up. Bump x: rotator 2.7896, exact 2.7003, the
  game 2.786 (± 0.01). Confidence: high.
- **CCR-3 (the car–ball residual: `ball_hits` 0.187, `ball_5050` 0.216 uu/s).** `ApplyBallImpactForces` takes the car's
  forward the same way (`GetRotatorAxis(QuatToRotator(OldRBState.Quaternion), 0)`) for the PushForwardScale adjustment.
  With it: `ball_hits` ball 0.187 → 0.00025 (per tick and continuous), `ball_5050` ball 0.216 → 0.020, `ball_roof`
  0.010 → 0.00002. Confidence: high.
- **CCR-4 (the bump/demo cone).** The cone native (`FUN_140f11c30`) builds each car's hitbox centre as the location plus
  `LocalCollisionOffset` multiplied by the rotator matrix's rows, i.e. by the *transpose* of the rotation (the script's
  debug draw uses `>>`, the native does not), with the axes from the rotator (sine table). `ShouldDemolish`'s
  `CarForward = Vector(QuatToRotator(q))`. Replays (602, car–car pass): the engine reproduces 63 more of the game's
  demolitions and loses 6, with 4 more demolitions where the game had none (1152 → 1187 of 1434 paired; false 44 → 47).
  The axes alone and the forward speed alone change nothing; the transposed centre is the effect. Confidence: high for
  the code reading, medium-high for the behaviour (replay-only evidence; a live check is listed below).
- **CCR-5 (exe order, ulp-level).** The game's suspension and friction passes add their impulses to the chassis in its
  wheel order, and the sticky force's up direction is summed in that order and normalised as `SafeNormal`
  (`FUN_140ef2170`: kept at |v|² = 1, else × 1/√, zero below 1e-8). In the patch; no live recording changes beyond the
  last bit except continuous runs that flip at thresholds (`steer_102550` ct 0.014 → 0.0001; `ball_5050` ct car
  0.146 → 0.149). Confidence: high (code), effect negligible.
- **CCR-6 (not proposed).** RS-9: the engine runs each car's components and then its vehicle before the next car, so a
  car's `_oldState` and components see the other car's wheel impulses of the same tick; the game takes every
  `OldRBState` and runs every car's components before the Bullet step's vehicle updates. Tested both ways
  (`exp`, `CCR_ORDER`): no live recording changes; car–car replays 2 cases differ (±1 demo). Exe-faithful but not
  measurable here.
- **CCR-7 (question 2).** Finding 21's steering residual does not reproduce with the current engine: on clean replays
  every non-Octane body fits its preset to the replay quantum (Dominus 403 steer 0.0003 uu, Breakout X 11505 0.010,
  Batmobile 803 0.0098, Centio 1919 0.0002–0.0005 in its clean replays). What is left is per replay, not per body: in
  some replays even the best of the six presets misses by ~1.8 uu at p75, interleaved with exact frames (1919 in 17
  of 20 replays, 403 in 1 of 11). No body uses the variant presets (`LongCar_aa`, `LongCar_Pete`, ...): the live
  build moves bodies with `HandlingPresetXOffset` instead, which (with the mesh `Origin.X`) only shifts the creation
  point. The Batmobile (2016) has no preset, but its own box is the Plank's and its bone wheels round to the Plank
  preset exactly. Per-body table: `bodies/body_table.tsv`. Confidence: high.

### 1. Where the bot diverges (question 1)

Per tick (`live_validate`, state set from the recording every tick), base engine, both `car_car` recordings (the two
are the same run twice and give the same numbers):

| tick | car uu/s | bot uu/s | bot dv (x y z) | what happens |
|---|---|---|---|---|
| 110 | 0.000 | 0.090 | −0.09 0.01 0 | side bump at 1400 (CCR-2) |
| 580 | 0.020 | 0.072 | −0.04 0 −0.06 | back wheels bottom out on the roof (wheel ray hits since 575) |
| 581 | 0.433 | 2.109 | −1.95 −0.07 −0.80 | first big divergence; no car–car contact point yet in either |
| 582 | 0.260 | 1.547 | −1.54 0.01 −0.15 | box–box contact, 2 points (game and engine: same depths, normal; the game's manifold is (car, bot), ours (bot, car)) |
| 583 | 0.099 | 3.042 | −2.90 −0.91 −0.08 | |
| 584–588 | ≤ 0.03 | 1.37 … 0.12 | | settles |

Every other tick ≤ 0.014 (car) / 0.09 (bot). So the residual is the roof landing, ticks 580–588, and it starts before the
bodies touch: not the box–box points, the solver order, the bump, its cooldown, the demolition check, the car–car friction
or restitution, or the hitbox/inertia (all unchanged by the fix, which makes every tick exact).

Decomposition (`exp` build, `CCR_DEBUG=580-584`, the bot's velocity after each phase of tick 581): the player's ray pass
takes the bot from (−10.04, −1.43, −18.05) to (−10.12, −1.33, −30.18) (the two bottom-out pushbacks), the push in the
suspension step to (−10.13, −1.32, −30.74), the bot's own vehicle (its brake against the contact velocity its pitch
rate gives) to (−2.32, −2.23, −9.30). The game ends at (−0.37, −2.16, −16.62) after gravity and sticky force: the split
of the pushback between the player's two back wheels sets the bot's pitch rate, and its brake friction turns that into
the x error.

#### Evidence in the exe (live addresses)
- Vehicle update `FUN_1402c5e40` (old 0x1402c5340): wheel transforms, candidate query, all rays (`FUN_1402c4650`), then
  the contact pass `FUN_1402c3e60` for wheel 0..n−1, the VehicleSim hook, then suspension `FUN_1402c3540`, which calls
  friction `FUN_1402c54d0`; every loop runs 0..n−1.
- Contact pass `FUN_1402c3e60`: if the wheel is bottomed out and the ground is static or in the vehicle's collision
  mask, `j = FUN_1402b96b0(...)` (resolveSingleCollision, computes only), `extraPushback = j × 0.25`, and for a rigid
  ground `applyImpulse(−j × normal)` at once (`FUN_1402b11d0`); then for any rigid ground `activate` and, if the wheel's
  +0xd0 > 0, `applyImpulse(−(+0xd0) × normal)` (the 1.0 push) — inside the same wheel's pass.
- Wheel order: `UWheel_TA::Init` `0x140f097c0` stores each wheel's index in `Vehicle.Wheels` (+0x158) and adds it to the
  btRaycastVehicle in that order; `VehicleSim_TA.OnAttached` sets up `Wheels[0], Wheels[1]` as the front axle's left and
  right (`SetupPresetAxle`: `LeftWheel.PresetRestPosition.Y *= −1`), `Wheels[2], Wheels[3]` the back. PhysLog's header
  (wheel0 at y −25.9) and `_wheels.csv` (`game_index`) agree. RocketSim's wheel 0 is front right (`Car.cpp` `left = i % 2`):
  the game's wheel i is ours i ^ 1 (as `live_validate` already maps it).
- Up-direction sum `FUN_140ef2170` (old 0x140eed3e0): sums the world wheels' normals over `VehicleSim.Wheels` in order,
  `SafeNormal`.

#### Experiments (`exp`, env-switched; per tick, both `car_car` recordings)
| variant | car max | bot max | bot 580–588 |
|---|---|---|---|
| base | 0.433 | 3.042 | 0.07–3.04 |
| contact pass in the game's order | 0.030 | 0.091 | 0.05–0.07 (systematic) |
| push inside the contact pass only | 0.413 | 3.083 | |
| both | 0.020 | 0.091 | ≤ 0.01 |
| both + suspension/friction loops in the game's order | 0.020 | 0.091 | ≤ 0.01 |
| + CCR-2 rotator up (all of the patch) | 0.00014 | 0.010 | ≤ 0.01 |

### 2. The rotators (CCR-2..4)
- `execQuatToRotator` `0x140364b80`: UE3's quaternion matrix, then `FMatrix::Rotator` `0x140385e40`: yaw
  `atan2f(X.y, X.x)`, pitch `atan2f(X.z, sqrt(X.x² + X.y²))`, each `× 32768 / 3.1415927f` and rounded with
  `(int)round(2f + 0.5) >> 1`; roll from the rotated pitch/yaw matrix's Y axis (`atan2f(Z·Y', Y·Y')`).
- `execGetRotatorAxis` `0x140358d10` and the cone use `FRotationTranslationMatrix` `0x140369b10`: sin/cos from the table
  at `0x142370780` (`TrigFLOAT[(angle >> 2) & 0x3fff]`, cos = angle + 0x4000), filled at startup by `0x140374fb0` with
  `sinf(((float)i + (float)i) × 3.1415927f × 6.1035156e-05f)`. So axes are quantised to 4 rotator units (0.022°).
- Script uses (`tagame_live_all.txt`): `GetBumpImpulse` UpDir (axis 2), `ApplyBallImpactForces` ForwardDir (axis 0),
  `ShouldDemolish` `CarForward = Vector(QuatToRotator(...))`, `InitTimeOfImpactFromOldRBState` `Impact.Rotation /
  OtherRotation = QuatToRotator(...)`; the sweep's `GetTimeOfImpact` core `0x140f01930` also goes through
  `FMatrix::Rotator` for the impact rotations.
- Cone `FUN_140f11c30` (called by `execIsCarWithinForwardEllipticalCone` `0x140e84500`): the matrices from
  `Impact.Rotation` / `OtherRotation`; each centre `= Location + (off·X, off·Y, off·Z)` (disassembly: the x component
  multiplies the offset by M00, M01, M02, row 0) with `off` = `LocalCollisionOffset` (car +0x858); the direction then
  `SafeNormal`ed; the core `FUN_140f12910` measures pitch (right axis removed /1.01) then yaw (up axis removed) against
  row 0 (negated when reversing), as the engine's `IsWithinForwardCone`.
- Effect of the transpose: for yaw ψ the Octane's 13.88 uu forward offset is rotated by −ψ instead of +ψ (for yaw 90 it
  lands 13.88 behind the origin); it cancels between two cars with the same yaw and matters up to ~28 uu between crossing
  cars, which moves the cone decision near its edge (bands ~12 uu wide in a grid search, `tests/cone_search.cpp`).

### 3. The proposed patch (`ccr-engine.patch`)
Files: `Sim/btVehicleRL/btVehicleRL.h/.cpp` (CCR-1, CCR-5), new `Sim/GameRotator/GameRotator.h` (the rotator helpers),
`Sim/Arena/Arena.cpp` (CCR-2, CCR-4), `Sim/Ball/Ball.cpp` (CCR-3), `tests/rl_patch_tests.cpp` (tests below). The repo's
engine sources are unchanged since my copy (only my CMake edit differs). Deterministic: `lrintf`, `det_sinf`,
`det_atan2f`, a double `sqrt`; native and WebAssembly identical (`determinism` 300 s, `arena_smoketest`, `netstate`,
`rollback`, `rl_patch_tests`, all compared byte for byte in the workspace).

Suggested README rows:
- 97: The vehicle's per-wheel passes in the game's wheel order (front left, front right, back left, back right; ours
  1, 0, 3, 2) and a wheel's 1.0 push on a dynamic ground inside the contact pass, right after its pushback; the
  up-direction sum in that order and normalised as the game's SafeNormal | `UWheel_TA::Init` 0x140f097c0, update
  0x1402c5e40, contact pass 0x1402c3e60, suspension 0x1402c3540, friction 0x1402c54d0, 0x140ef2170 |
  `btVehicleRL.cpp/.h`. Live `car_car` (a car landing across another's roof): car 0.433 → 0.00014, lower car 3.04 → 0.010.
- 98: The car scripts' rotations as rotators: the bump's up, the ball hit's forward, the demo's forward and the cone's
  axes from `QuatToRotator` (whole units) through the 16384-entry sine table; the cone's hitbox centres the location plus
  the offset times the transposed rotation | 0x140364b80, 0x140385e40, 0x140369b10, table 0x142370780 (0x140374fb0),
  cone 0x140f11c30 / 0x140f12910 | `GameRotator.h`, `Arena.cpp`, `Ball.cpp`. Live `ball_hits` 0.187 → 0.0003, `ball_5050`
  ball 0.216 → 0.020; replays +63 / −6 game demolitions reproduced.

#### Tests (in `fix/engine/tests/rl_patch_tests.cpp`; the same as public-API `tests/ccr_tests.cpp`, which also builds against
the unpatched engine)
- `TestGameRotator`: the table's ends; the bot of `car_car` row 110 → rotator (−101, 0, 0), up.x 0.00997033 (exact
  0.0096512); a yaw-90 cone centre lands 13.88 behind the origin.
- `TestRoofLanding` (CCR-1): both cars from `car_car` row 492 (recorded states), run on to rows 581–585, velocities vs the
  recording within 0.1 uu/s. Fix: 0.0000 at every row; base: car 0.23–0.43, lower car 1.5–2.95.
- `TestBumpUpRotator` (CCR-2): row 110 → 111, the bump's own Δv (bumps on minus bump force 0): x 2.772 vs the game's
  2.786 ± 0.015 (base 2.682).
- `TestBallHitForwardRotator` (CCR-3): `ball_hits` row 351 → 352: ball 0.023 uu/s off (base 0.183; a fresh arena leaves
  the car itself 0.02 off, so the bound is 0.05; per tick in `live_validate` it is 0.0003).
- `TestDemoConeCentres` (CCR-4): attacker 2250 uu/s at yaw 60 vs a parked victim at yaw 0 offset 86 uu sideways:
  demolished (RocketSim's cone: no); attacker yaw 30 vs victim yaw 90 at 91 uu: not (RocketSim's: demolished). Each is
  mid-band (bands 12 uu wide).
- Results: fix 3281 checks, 0 failed (native and WebAssembly, identical output); base fails 8 of the 10 CCR checks.

### 4. Before and after
Live (all 73 recordings, `runs/table_base_fix.md`; per tick and `--continuous`, max uu/s). Changed rows only; every other
recording is identical in all six columns:

| recording | per tick car | car2 | ball | continuous car | car2 | ball |
|---|---|---|---|---|---|---|
| ball_5050 | 0.070 → 0.028 | 0.051 → 0.010 | 0.216 → 0.020 | 0.146 → 0.149 | 0.051 → 0.010 | 0.216 → 0.022 |
| ball_hits (×2) | 0.010 | – | 0.187 → 0.00025 | 0.010 | – | 0.190 → 0.00025 |
| ball_roof (×2) | 0 | – | 0.010 → 0.00002 | 0 | – | 0.010 → 0.00002 |
| car_car2 | 0.010 | 0.070 → 0.051 | 0 | 0.077 → 0.076 | 0.070 → 0.077 | 0 |
| car_car_041358 | 0.433 → 0.00014 | 3.042 → 0.010 | 179.5 (see 6) | 7.88 → 0.061 | 8.27 → 0.010 | 179.5 |
| car_car_041729 | 0.433 → 0.00014 | 3.042 → 0.010 | 0 | 7.88 → 0.032 | 8.27 → 0.010 | 0 |
| steer_102550 | 0.014 | – | 0 | 0.022 → 0.014 | – | 0 |
| clock, uneven, exhibition, hands (human play) | | | | p99 only, max unchanged | | |

`car_car2` continuous: a 0.01 uu/s-quantum drift over the parked-on-roof stretch (ticks 493–579) that both builds show,
along slightly different paths; per tick it is better (tick 200: 0.070 → 0). Indeterminate ticks: unchanged everywhere.

Replays:
- `out/replays/states.csv` (90 replays, 648,870 cases, paired): 1,078 cases change; touches (ball velocity) 713 better,
  329 worse (median −0.007 uu/s); cars alone 32 cases by one 0.01 quantum (11 better, 21 worse); `replay_paired.py`
  (car or ball position) 13 better, 23 worse. Neutral, as expected at the replays' resolution.
- Car–car pass, the 602 replays in `out/replays/more` (`cc/base`, `cc/fix`): bumps both ways b_err p50 0.554 → 0.544
  (8 better, 4 worse); demos a_err p50 1.132 → 1.131 (25/20); game demolitions reproduced 1152 → 1187 of 1434 paired
  (per case: 63 gained, 6 lost), demolitions without the game's 44 → 47.

### 5. Other observations
- Contact lifetimes: our car–car points age 3 per tick (the compound algorithm refreshes the manifold, then the child
  again, plus the validator's restore), the game's 2 then 1. `m_lifeTime` feeds nothing in the solver (2.82 and 3.24
  source), so this is harmless.
- The body order (game (car, bot), ours (bot, car)) changes nothing, as finding 40 said: the fix is exact with it.
- `car_car_041358`'s ball (p50 114 uu/s, both builds): the ball sits in the net (y −5625) when the recording starts; the
  engine counts it scored and freezes it (patch 72), the game's freeplay ball rolls on. A validator artifact, not physics
  (the second recording parks the ball at (3000, −2000)).
- The vehicle's pushback uses a static default solver info (erp 0.2, 1/60 s): read again in `0x1402c3e60` (0x14235fa80),
  as the engine.

### 6. Per-body handling (question 2)
Method: `replay_validate --bodies` (current base engine) over the 602 replays (51,210 cases), every non-Octane body against
the six presets, flat floor, inputs unchanged, by straight/steering and per replay (`bodies/base`, `tools/bodies_report.py`);
body data from G4's `bodies_live.tsv`/`tz_live.tsv`, `mesh_origin_live.tsv`, the products dump; packages read with
`props.py`, bones with G4's `skel.py`.

Current fits (median position error after the fitted ticks, uu; best preset bold):

| body | label | package → preset | straight n / p50 | steering n / p50 |
|---|---|---|---|---|
| 403 | Dominus | Body_MuscleCar → MuscleCar | 8413 / **0.0002** | 3837 / **0.0003** |
| 4770 | Dominus (other id) | Body_MuscleCar → MuscleCar | 800 / 0.0001 | 380 / 0.0202 (2 replays) |
| 1286 | Aftershock | MuscleCar | 490 / 0.0002 | 187 / 0.0005 |
| 3426 | Diestro | MuscleCar | 268 / 0.0002 | 87 / 0.0005 |
| 1919 | Centio | body_pumpernickel → Plank | 6970 / 0.0100 | 3773 / 0.0424 |
| 803 | Batmobile (2016) | Body_Darkcar → none (own) | 1892 / **0.0002** (Plank) | 777 / 0.0098 |
| 11505 | Breakout X | body_crikey → LongCar | 2998 / 0.0002 | 2441 / 0.0100 |
| 11603 | Fennec ZR-F | body_zrf → Octane | 1102 / 0.0002 | 420 / 0.0005 |
| 6939 | Mach-E RLE | body_elm → Octane | 465 / 0.0002 | 225 / 0.0003 |

Per replay (1919): exact in 3 replays (straight 0.0001, steering 0.0002–0.0005), in the 17 others p75 1.2–2.2 uu with
bad and exact frames interleaved and the Plank still the best of the six in 311 of 338 cases: these cases fit no preset,
so it's the replay (stale or corrected states, or two players' cases mixed), not the body. 403 is likewise exact in 10
of 11 replays. Finding 21's 0.032 / 0.045 / 0.057 predate patches 38 and 80 and the body mapping above.

What the exe and packages say:
- Physics wheels for a preset body: `SetupWheelPreset` sets only `BoneName` (the visual bone, Wheel_TA+0x110), radius and
  `PresetRestPosition` from the preset; `UWheel_TA::Init` tests `PhysicsBoneName` (+0x118, None) and takes
  `PresetRestPosition`; radius and suspension travel are scaled by the component's scale (1). The body's own axle
  values (`WheelRadius` 12.75 on the Centio, offsets) are visual. `SuspensionTravelMin/Max` are only read by the car
  preview. So every preset body drives exactly as its preset.
- No-preset bodies: `SetupBoneAxle` → wheel at the bone + (`WheelOffsetForward`, ±`WheelOffsetSide`), rounded to 0.01,
  radius `Axle.WheelRadius`. Batmobile (2016): bones FL/FR (64.9726, ∓37.7953, −7.8267) + (−15, ±10) → (49.97, ±27.80,
  −7.83); BL/BR (−50.5821, ∓35.2803, −3.83) + (15.15, ±15) → (−35.43, ±20.28, −3.83); radii 12.5 / 17; own physics box
  128.8198 × 84.6704 × 29.3944 at (9.0086, 0, 12.0942): all the Plank preset's.
- Variant presets (`LongCar_aa` 4.75, `LongCar_Pete`, `LongCar_hero`, `LongCar_smoke`, `Merc_Tomato`, `Octane_Skunkz`,
  `Hybrid_Skunkz`, `Pixie`, `Plank_Cured`, `Octane_Lemonade`) are in Startup.upk but no body asset references them in the
  live build; body_aa uses `LongCar` with `HandlingPresetXOffset` 7.75.
- `HandlingPresetXOffset` (and the mesh `Origin.X`): `InitBodyAsset` → `SetTranslation(CalculatePresetSuspensionOffset() +
  (XOffset, 0, 0))` on the mesh component: the Bullet body is created at actor ⊗ T, so it moves the creation point only
  (spawn, kickoff, respawn). The box (`LocalCollisionOffset` is the box centre in body space: PhysLog's header reads
  13.8757, 0, 20.755 for the Fennec, whose Tz is 2.61) and the wheels are relative to the body origin, so nothing else
  changes. GA-6 is therefore complete for physics once the engine takes the offset per body, not per preset.
- 24 body products have a creation offset (X offset + Origin.X): Venom +5, Takumi +5, Scarab +7 (404, 5188), Takumi RX-T
  +5, Mantis +5, Formula 1 2021/2022 −12.5, Mazda RX-7 +3.25, Ace +7.75, Lightning McQueen +6.75, Primo +6.5, The
  Incredibile −5, 1966 Cadillac DeVille +10.25, The Mystery Machine +5, Hearse +5, AMG GT 63 S +3, BMW M4 GT3 EVO +2,
  Pizza Planet truck +5, Corvette +2, Cayenne +3, Rivian R1S +2, Chrysler Pacifica +2, Golf GTI +5. Spawn z = 36 + Tz
  per body (the reference bodies give the live values: 36.02, 36.01, 38.84, 36.00, 38.94 +5, 35.05, 38.61, 35.71 +5,
  39.06 +7).
- `SteerScale` 0.45 on body_slime (4155 Ecto-1, a MuscleCar body): no script reads it (natives not checked) and the 602
  replays have no Ecto-1, so it stays untested.
- Not readable with the baked keys (server-delivered content keys): 12779 Jeep Wrangler, 12781 Viper GTS-R, 12842
  Maserati, 12888 Gummi Ship, 12951 CT5-V, 12999 190E, 13000 Mona Car.

`bodies/body_table.tsv` (229 body products): id, label, package, asset, handling_preset, engine_config (OCTANE 48,
DOMINUS 84, PLANK 12, BREAKOUT 36, HYBRID 27, MERC 14, PSYCLOPS 1 (tritip), unknown 7), hitbox, wheels, x_offset,
mesh_origin_x, spawn_forward_offset, Tz, spawn_z, note. For the engine: `CarConfig` = the preset's, with
`spawnForwardOffset` and `spawnZ` from the row (Batmobile: Plank, Tz not computed: G4's calc needs a preset).

### 7. Corrections to the notes
- `notes/physics-values.md`
  - Car–ball (line ~229): `CarFwd` is `GetRotatorAxis(QuatToRotator(OldRBState.Quaternion), 0)`: whole rotator units and
    the 16384-entry sine table, not the body's exact forward.
  - Car–car (lines ~236–260): `Other.Up` is the rotator's axis 2 likewise; `CarForward` (demo speed and reverse test) the
    rotator's `Vector()`; the cone's axes are the rotator matrix's rows, and its hitbox centres are "location + rotated
    LocalCollisionOffset" only in the script's debug draw: the native `FUN_140f11c30` multiplies the offset by the rows
    (the transpose). `FUN_140f0c940`/`FUN_140f0d620` (old) → `FUN_140f11c30`/`FUN_140f12910` (live).
  - Car bodies and presets (lines ~153–175): "the physics wheels have no PhysicsBoneName" — confirmed: `PhysicsBoneName`
    is Wheel_TA+0x118, which `UWheel_TA::Init` 0x140f097c0 tests; `BoneName` (+0x110) holds the visual bone. Replace the
    three X-offset exceptions with the live list (18 body packages with `HandlingPresetXOffset`, 5 with a mesh `Origin.X`; 24 products, above) and say the offset only moves the creation point.
    "The game's variant presets look like baked X offsets": they are unreferenced in the live build. Replace "Per-body
    data does not explain the steering residual ..." with CCR-7 (no per-body residual with the current engine; per-replay
    outliers). The Batmobile: own box = Physics_Plank's, bone wheels = the Plank preset after rounding.
  - Add (vehicle): the game's wheel order FL, FR, BL, BR; the contact pass applies each wheel's pushback impulse and its
    1.0 push to a dynamic ground immediately, in that order.
- `notes/validation.md`
  - Finding 40: "Left: 1–3 uu/s for a few ticks once the two bodies touch in the roof landing (... the solver's order of
    contacts, probably)" → the wheels' contact pass order and the push's place (CCR-1); it starts a tick before the bodies
    touch.
  - Finding 21: superseded (CCR-7).
  - Finding 40's `ball_5050` "first 50/50's touch (20.06 uu/s ...; open)" and the 0.22 since: the rest was the ball hit's
    rotator forward (0.216 → 0.020).
  - `car_car_041358`'s ball error is the scored-ball freeze in the validator (section 5).
- `notes/gameside-audit.md`
  - "Car–car formulas = engine patches 5–7, 33, 34": add the rotator inputs and the cone's transposed offset (CCR-2..4).
  - Open: "Non-Octane steering residual (validation finding 21) is not explained by the curves" → closed (CCR-7).
  - RS-9 / the component-vs-vehicle order (CCR-6): measured, no effect in the recordings or replays.
- `HANDOFF.md` State: `car_car` 0.43 / bot 3.0 → 0.00014 / 0.010 (per tick), with the patch.

### 8. Open questions / live checks worth asking for
- CCR-4 live: a supersonic bot into a parked player car in the disagreement band (attacker yaw 60 → victim yaw 0, 86 uu
  to the side, 2250 uu/s; and the mirror case yaw 30 → 90 at 91 uu): demolition or not. One `ga_carcar`-style scenario;
  the replays already favour the game's rule 63 : 6.
- A `car_car` re-recording with `_wheels.csv` is no longer needed (every tick of the roof landing is exact).
- The 7 server-key bodies and the Batmobile's Tz (no preset: `calc_tz.py` needs the bone path) are not in the table.
- The rotator conversion uses `det_atan2f`/`det_sinf` (musl) where the game uses MSVC's `atan2f`/`sinf`: a 1-ulp
  difference can move a rotator across a rounding boundary (one unit) in rare cases; not seen in any recording.

## Demolition sweep (GetTimeOfImpact) — DSW1, 2026-10-10 [N][A]

Live: execGetTimeOfImpact 0x140e73ec0 → FUN_140f01930 → convex/compound sweep 0x140f016b0; integrator 0x140ea04f0.
- **Solver:** btGjkEpaPenetrationDepthSolver (vtable 0x141a53d60, calcPenDepth 0x1402a0320), inline VoronoiSimplexSolver
  (1e-4), CastResult (fraction 1, m_allowedPenetration 0.04), 4-argument btContinuousConvexCollision ctor 0x14029ac40,
  calcTimeOfImpact 0x1402a1030 (stock 2.82, 64 iterations). Hit = `1.0 > fraction`. Compound children recurse with
  btTransform::operator* arithmetic.
- **Inputs:** basis = setRotation(OldRBState.Quaternion); origin = Location × 0.02f; velocity ±LinearVelocity × 0.02f,
  ±AngularVelocity; dt = 1/120; integrateTransform 2.82. OldRBState holds the quantised uu state.
- **Location:** per component `(to·50f − from·50f)·f + from·50f` (body origins).
- **Rotation:** getRotation of both bases → **UE3 SlerpQuat 0x140388840** (raw = ((y1y2 + x1x2) + z1z2) + w1w2;
  |raw| ≥ 0.9999f → linear s0 = 1−t, s1 = t; else Ω = acosf(clamp|raw|), s0 = sin((1−t)Ω)/sinΩ, s1 = sin(Ωt)/sinΩ;
  s1 negated if raw < 0; q = s1·b + a·s0) → normalise (sum = ((x²+y²)+z²)+w²; > 1e-8 → × 1/sqrt, else identity) →
  FQuatRotationTranslationMatrix 0x14036f9c0 (x2 = x+x) → FMatrix::Rotator 0x140385e40 (appRound) → Impact.Rotation.
- **Miss:** InitTimeOfImpactFromOldRBState (Location = OldRBState.Location, Rotation = QuatToRotator(q)).
- **Bullet 2.82 vs 3.24 on this path:** equal except calcPenDepth (3.24 normalises the guess, retries 9×, zeroes
  witnesses) and EPA_MAX_VERTICES 64 (2.82) vs 128 (3.24): 1 hit flip / 100k, EPA normals ≤ 0.034° on overlapping starts.
- **Clone status (engine HEAD 2026-10-10):** RV-232..234. With game inputs, lerp, SlerpQuat and the x+x matrix plus the
  two 2.82 EPA details, a 100k-case harness is bit-identical to the game replica (detmath trig both sides; MSVC CRT trig
  may differ in the last bit [I]). Harness and proposed code: out/bsim/agents/DSW1/.
- The read-back getRotation is the **scalar** 2.82 branch (0x140ef2770 → 0x1402786f0); engine equal (2M cases).

## Wheels on dynamic bodies and the flip-cancel lock (FP1, live build, 2026-10-14) [N]
Sub-agent FP1; decompiles and probes local in `out/bsim/agents/FP1/` (decomp/r1..r8, probe/, engcopy/).

**Wheels on the ball or a car: every per-wheel impulse matches the engine now.** The old "not modelled" lines were stale.

| Impulse (ground = ball or car) | Game (live) | Engine | Match |
|---|---|---|---|
| (a) Push | Contact pass `0x1402c3e60`: any rigid-body ground (arena pieces are plain collision objects, skipped). Wake (`0x140270ef0`), then −PushForce·n at the contact (`0x1402b11d0`) once per substep, not dt-scaled. PushForce = PushForceConstant 1.0 × Vehicle+0x788→+0x1ec. No mask. Applied right after that wheel's bottom-out, wheels FL, FR, BL, BR | `btVehicleRL.cpp:266-272`, game wheel order | yes (probe: ≤ 0.0075 uu/s) |
| (b) Bottom-out | trace < radius + rest − maxRaise → resolveSingleCollision (`0x1402b96b0`, never applies) with a static default solver info (1/60 s, erp 0.2), against the fixed body (`0x1402c3cf0`) or a rigid ground whose broadphase group is in vehicle+0x30. **Mask 0xff7f**: ctor `0x1402c24b0` sets 0xffffffff, VehicleSim attach `0x140f1d170` clears channel 7 = RBCC_Ball. Cars (RBCC_Vehicle 3) are in. Chassis keeps r·0.25 (applied only if the suspension force ≠ 0); the ground gets −r·n at once | `btVehicleRL.cpp:232-258` (patches 31, 54) | yes (probe ≤ 0.0055 uu/s; bit-level summation order differs) |
| (c) Suspension | `0x1402c3540`: chassis only; ground velocity unused; no reaction on the ground | `btVehicleRL.cpp:357-392`, `:214-227` | yes |
| (d) Friction | `0x1402c54d0`: lateral resolveSingleBilateral (`0x1402b9260`) vs the fixed body; longitudinal from engine force / brake on the chassis-only contact velocity; chassis only | `btVehicleRL.cpp:395-479` (patch 50) | yes |
| (e) Order in one vehicle | `0x1402c5e40`: hard points → one broadphase query → rays → per wheel [bottom-out → opposite impulse → wake → push → contact velocity] → VehicleSim callback → suspension → friction | patches 31, 38, 97 | yes |
| (e) Order in the substep | `0x1402b8640`: gravity → caps and damping for every body → **all vehicles in the world's action-array order** (world+0x190; addAction `0x1402b04f0` appends at VehicleSim attach, removeAction `0x1402b90a0` swap-removes) → collision → solve → integrate | `Arena.cpp:1700-1719`: per car in **ID order**, its pre-physics + cap + vehicle; then the ball's cap; ball damped in Bullet's step | G1–G3 |

- **G2 (the one real gap):** vehicles run in car-ID order in the engine, but in action-array order in the game (creation
  order, reshuffled by swap-remove and respawns). For a car parked on another's roof, swapping the order changes the
  lower car by ≤ 0.73 uu/s per tick (0.15 at rest) and the upper by 0.25–0.64. The live `car_car` recordings match
  only because the upper car was created first and also has the lower ID. Fix: keep an action-order list in the Arena
  (append on body creation/respawn, swap-remove on removal). Open: exactly when the game removes and re-adds vehicles
  at a demolition and a kickoff reset.
  **Triggers (static session, 2026-10-14; [S] script, [N] native, [I] inferred):** a demolition swap-removes at FinishDemo
  (TerminateRBPhys + VehicleSim detach) and the respawn (a new Car_TA) appends at its VehicleSim attach; a kickoff reset
  (StartNewRound → ResetPlayers TA:3032 → 954) destroys every car (array emptied) then RestartPlayer in **Players = join
  order** (MRL-8), which also holds after a goal replay (StartReplay DestroyCars TA:4264, then ResetPlayers) and at match
  start (RestartPlayers TA:3801); a leaver is demolished (swap-remove); the podium restarts the winners in MVP-sorted
  order (TA:4409, 4420). [I]: removeAction's call site (vt+0x80, not traced) and a possibly async VehicleSim attach.
  **Placement and boxes (AB1, 2026-10-14):** moving a body (Teleport, SetPhysicsState, SetCurrentRBState, rollback
  restore) leaves its broadphase box until the next `updateAabbs`, which runs after the vehicles; the wheel rays pick
  candidates by one `aabbTest` of stored boxes (≤ 32), then ray-test current poses. Created bodies (kickoff, respawn,
  spawn) get a fresh box at once. Details and the engine's candidate-set gap: bullet-diff.md, "Broadphase boxes at
  placement".
- **G1 (negligible):** the engine damps the ball after the wheels' pushes, the game before: ≤ 0.04 uu/s measured.
- **G3 (negligible):** a later car's read-back / limits / forward speed see an earlier car's impulses of the same tick: ≤ 0.01 uu/s.
- **Tests to add** (none exist for patches 49, 50, 54):
  - T1, car on a car's roof: L's Δv = gravity + Σ(−nᵢ)(1 + 4·pushbackᵢ)/m within 0.011 uu/s. Later, with G2, the
    order in both creation orders and after a demolish/respawn.
  - T2, car on the ball:
    - (i) ball Δv = gravity + Σ(−nᵢ)·1.667 uu/s with every pushback 0;
    - (ii) spinning/moving ball: the car's friction impulses equal the ball-at-rest case;
    - (iii) a sleeping ball under a wheel is awake after the tick.

**Flip-cancel lock: settled; the engine matches** (patches 1, 39).
- Pre-physics `0x140f21a90`, per component: PrePhysicsStep → ApplyForces(ActivityTime) → ActivityTime (+0x298) += dt.
- SetActive `0x140f35090` zeroes +0x298/+0x2a0 on a change.
- The dodge ends (`0x140f20dc0`) on the ground or when ActivityTime > 0.65.
- ApplyForces `0x140eb8b60` → `0x140ebb700`: the cancel (Input.DodgeForward, Vehicle+0x810) scales the pitch torque
  only when t ≥ MinDodgeTorqueTime 0.041. The Z damping uses the same t: from t ≥ 0.15, while rising only until t < 0.21.
- Tick k after the press (t before the tick = k/120 in float): k 0 impulse + full torque; **k 1–4 the cancel is ignored;
  k 5 (t 0.041666668) is the first tick the cancel acts**. Z damping from k 18; damping while rising to k 25; the dodge
  deactivates at k 79.
- Engine `Car.cpp:266`, `:272` → `:904`, `:276` → `:1108-1112`: the same sequence (probe Δω_y −1.289 rad/s at k 5, 0 before).
- Live: `out/live/flip_cancel_20261008_011347.csv`, stick back from k 3–4 has no effect; at k 5, |ω| 5.5 → 5.368.
- `engine/README.md` "Cancel-lock timing" ("the 4th, not verified") is stale: it is the **5th tick after the press (k = 5)**,
  verified statically and live (engine/ is the live session's to edit).

**Recording notes (not chased):**
- **Goal-wall wobble** (validation finding 9).
  - Capture: offline free play, Octane, PhysLog + `_bullet.csv`, plugin placements at 2–3 of the scan's worst fillets
    (goal floor→back wall, floor→side wall). Park with no input 5 s; full throttle nose-first into a side wall at 90°
    and 45°, 5 s each; throttle 0.3 along the side fillet, 5 s (≈ 40 s).
  - Measure with `live_validate`: per hold, the per-wheel suspension tick-to-tick difference (p99), the car-frame
    roll/pitch rates (p99, sign flips/s) and the tilt range.
    - Game steady but engine alternating → engine bug.
    - Both alternating alike → faithful; close it.
  - Video and replay files can't settle it (aliasing, coarse).
- **Ball resting on a parked car's roof** (the existing `ball_roof` recordings roll off).
  - Capture: car parked on the flat floor, no input; the ball placed at rest on the roof at dx = +13.9, +6, 0 and −6 uu,
    8 s each, plus one drop from 200 uu onto the balance point (≈ 1 min).
  - Measure per tick: ball |v| and `bsleep`, drift along the car's x, the car's pitch and suspension lengths, the
    car–ball manifold points, ball Δv spikes.
  - If the game's ball sleeps on the roof, the engine needs B12 (the game wakes a sleeping body in an awake island only
    if it has velocity after the solve; stock 3.24 keeps the island awake).
