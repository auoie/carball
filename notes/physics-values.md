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
  bottomOut = 0.25 * single-contact impulse when compressed beyond travel (opposite impulse to the ground body)
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
  (+0x30), which the ball's isn't (engine patches 49, 50).
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
  it (not modelled: wheels on cars/ball). Relative velocity and 1/(n·up) clipped at 0.1 → 10.
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

