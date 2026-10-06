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

## Boost pads (`Stadium_P: Archetypes.VehiclePickup.*`)

| Pad | Amount | Respawn | Pickup cylinder | RocketSim |
|---|---|---|---|---|
| Small (`BoostPad`) | 0.12 (12) | 4 s | r 96, h 64 | ✓ amount/respawn; RocketSim cyl r 144 = 96 + 48 |
| Big (`BoostPill`) | 9999 (full) | 10 s | r 160, h 64 | ✓; RocketSim cyl r 208 = 160 + 48 |

RocketSim's pad radii are the data radius + 48, which looks like a correction for testing the
car's origin point instead of its hitbox. Pad positions match RocketSim (e.g. 2048, −1036).

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
```
The dodge-torque divisor `Car+0x438 → +0x238` is `Pawn.Mesh` → `PrimitiveComponent.Scale` (1.0 normally).
Keyboard/mouse-only: `ApplyAirPitchSafety` zeroes nose-down pitch in the air until the player has
pitched or rolled (an input aid, not physics).

### Car–ball hit (`Car_TA.ApplyBallImpactForces`) — matches RocketSim exactly
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
All states are the start-of-tick OldRBState (the demo check sweeps to the time of impact first).
```
Cone test (native `FUN_140f0d620`): direction d from attacker's hitbox centre to victim's at time of
impact; pitch angle = angle(fwd, d with its right-axis component removed); yaw angle =
angle(fwd, d with its up-axis component removed). (It removes 1/1.01 of the component.)

### Speed limits (native `FUN_140eed9e0`, `FUN_140f17910`)
Linear and angular velocity are clamped by scaling the whole vector to MaxLinearSpeed / MaxAngularSpeed;
the limits are also pushed into the Bullet body. So FlipCar's per-tick Δω = 1000·fwd immediately
saturates at 5.5 rad/s (RocketSim ramps at 50 rad/s²).

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
air throttle = ThrottleForce(12000) * Fwd * (boosting ? 1 : throttle)                                  [force]
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

### Sticky force (`Vehicle` `FUN_140eb70a0`) — matches RocketSim
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
- Ball sphere in Bullet = (authored radius + 1.25 skin) − 2: 92 → **91.25**.
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
- Exact source of the ~1.9 uu ball–plane resting gap (depends on Bullet's contact-breaking
  threshold and settling with the velocity-only special contact). Use RocketSim's implementation
  or the measured 93.15.
- Where the throttle cutoff above 1400 is implemented.
