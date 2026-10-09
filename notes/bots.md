# Bots: spec (static session, 2026-10-08)

The offline bots of the live build (2026-10-06). Sources:
- TAGame bytecode;
- the GameInfo_Soccar_SF / TAGame / Stadium_P archetypes;
- live Ghidra decompiles; addresses are live.

Tags: [S] script, [A] archetype, [N] native, [I] inferred. Sub-agent files, local in out/bsim/agents/BOT1/:
- notes.txt;
- work/bt_tree.txt (the whole behaviour tree as data, from bt_tree.py), gis_ai_props.txt, tagame_bt_defaults.txt;
- decomp/.

**Summary.**
- The bot is a native-driven **behaviour tree**. The tree is data: 532 archetypes under Archetypes.AI.* in
  GameInfo_Soccar_SF.upk. Steering, the ball model and the tree engine are native; jumps, dodges, conditions and most
  actions are script.
- **Difficulty is one scalar, Skill** (verified):
  - BotConfig_TA.Skills = Intro 0, Rookie 0.33, Pro 0.66, All-Star 1.0, Unfair 1.0.
  - It lerps the archetype's SkillSteerError (Easy 0.1 → Hard 0), SkillSteerSpeed (10 → 50) and SkillThrottleSpeed
    (2 → 50).
  - It sets bCanUseBoost = Skill > CanUseBoostThreshold (0.4).
  - It scales ball lead and shot aiming.
  - It gates behaviours at 0, 0.33 and 0.75.
- **Bots never use air control or aerials.** Rookie never boosts, dodges or powerslides. Bots read the exact physics
  state with no noise.
- **We have no bot code yet** (client and server have only a test helper).

## Architecture
| # | What | Game | Implement |
|---|---|---|---|
| BOT-1 | Classes, creation | AIController_TA ← AIController_Soccar_TA; AIManager_TA holds the bot list and team-wide locks. GameEvent_Soccar.BotArchetype = Archetypes.AI.Soccar.AIController_Soccar [A]. SpawnBot → SpawnBotController → ChooseBotAsset (a random ProductAsset_Bot_TA whose label isn't a player name) → AddBot (name, loadouts, AddPlayer, Init, SetSkill(BotSkill)) [S]. PRI.bBot is set when the owner is an AIController. Team_TA.UpdateBotCount fills each team to MaxTeamSize (NumBots with unfair teams), one per 0.1 s, and removes extras when humans join. Freeplay's dummy bot sits in DoingNothing (no tree) | A server-side bot controller per bot car with skill; isBot in the player info; the fill-to-team-size rule |
| BOT-2 | Where the logic lives | Tree nodes = archetypes; node classes = TAGame BTNode subclasses; engine, condition caching, targeting, prediction and driving native [N]; jump, dodge, face, powerslide, block and condition results script [S]. Every reference to an archetype becomes its own instance per bot (0x140f4afd0), shared subtrees included | Port the tree as data (bt_tree.txt) plus a small interpreter; each reference gets its own state |
| BOT-3 | Node semantics | Status: 0 Fail, 1 Success, 2 Running [N].<br>• **ConditionalNode** (0x140ee3ce0): on start, all PreConditions then all Conditions must pass; while running, all Conditions must pass (else abort and fail); all SuccessConditions → abort and succeed; then Execute.<br>• **Selector** (0x140ee37a0): sticky, re-runs the running child, scans from 0 only when idle.<br>• **Evaluator** (0x140ee3030): pre-emptive, scans every tick in order; a higher child that starts aborts the running one.<br>• **Sequence** (0x140ee3890).<br>• **Executor** (0x140ee3100): runs all children, ignores failures, returns Success.<br>• **RandomSelector** (0x140ee31f0): picks by BTWeight (default 1) with rand()/32767, retries without failed children, sticks while running.<br>• **BTAction** (0x140ee4290): StartTime and OnStart/OnStarted; FinishTime > 0 → Success once elapsed; AbortTime → Fail; default OnExecute = Running.<br>• Abort (0x140eaffb0) aborts the running child. A selector used as a condition = OR | Implement exactly; the Evaluator's per-tick re-check is what makes bots react |
| BOT-4 | Condition cache ("reaction time") | BTCondition.Evaluate (0x140ee3c10) recomputes when dirty, or when UpdateDelay ≠ 0 and (forced, or UpdateDelay < 0, or now ≥ NextUpdateTime); then NextUpdateTime = now + UpdateDelay; bFlipResult inverts [N]. UpdateDelay: **0.1 s** for most conditions (no overrides in the tree); 0 (event-dirtied only) for GameState, Skill, Lock, TeamSize, HumanPlayerOnTeam, GameInfoType, AIPlayerIndex; 0.05 s for JumpHit/DodgeHit; 0.2 s for AreaClear [A] | A per-instance cache on world time. 0.1 s is the main decision latency at every difficulty |
| BOT-5 | Locks and decorators | BTLock (0x140ee4010): when its child returns Success or Running, AddNamedLock(Name, Time) sets release = now + Time; scope 0 = bot, 1 = AIManager; expired locks drop every AI tick. 'Jump' 0.75 s, 'Acting' 1.5 s. BTDeco_RandomSteer (ball welded): ±1 steer re-rolled every U(0, 0.5) s [S][A][N] | The Jump lock blocks a new jump or dodge, and the OffGround branch, for 0.75 s after a jump ends |
| BOT-6 | Proxies and targets | AIProxyData = {Location, Velocity, Gravity, Rotation, Radius, Bounce, Actor, Vehicle}. GetTargetData (0x140ef5ad0, cached per tick) adds LocalOffset × FieldScalar rotated by the proxy rotation, then WorldOffset [N].<br>**Proxies:**<br>• ball (with an attack rotation, the +field axis toward the enemy goal); BallLanding (PredictLanding);<br>• ball projected on the team/enemy goal lines; BallProjected (ball + 10000 × the 2D car→ball direction, clamped);<br>• Team/EnemyGoal = the GoalOrientation actors: blue (0, −5120, 320) yaw +90°, orange (0, 5120, 320) yaw −90° [A Stadium_P];<br>• MidField = FieldCenter (0, 0, 755); cars; boost pills.<br>**Targets** [A]: GoalForward50/1000, GoalBackward50/500, GoalMidLeft/Right (±500 local y), EnemyGoalShot (−100 local x, inside the net), EnemyGoalLeft/Right (±500), Positions.Defender = TeamGoal + 500 forward, Striker = EnemyGoal + 2500 forward, Mid = FieldCenter | These frames; a goal's local x points into the field |
| BOT-7 | Same physics as players | The bot reads actor and RB state directly, with no perception noise [N]. Inputs go through Car_TA.SetVehicleInput like a player's (boost → throttle 1 on the ground; jump edges). Dodge deadzone 0.5 for bots (notes/controls-audit.md) | Feed bots the authoritative state; route their inputs through the normal car input path |

## Per-tick input pipeline (AIController_TA::Tick 0x140f4c240, every rendered frame, dt = frame delta) [N]
1. **Housekeeping:** Super::Tick; update locks.
2. **Drive frame:** with wheel 0 in contact, GroundNormal = its contact normal and ForwardDir = car x projected onto
   that plane; otherwise the car's own axes.
3. **Reset:** save the previous Throttle and Steer, then reset Input to all zero. Nothing persists between ticks except
   through the rate limits.
4. **Obstacle cache:** refresh the world-obstacle cache when the car has moved more than its radius.
5. **Tree:** BT.Tick (0x140f4d6d0) → Root.Evaluate. Actions write Input fields.
6. **Steer quantisation:** q = int(SteerError × 100); if q > 1: s = clamp(round(Steer × 100), −100, 100), and
   Steer = (s − s % q)/100, truncating toward 0.
7. **Rate limits:** Steer += clamp(new − old, ±dt·SteerSpeed); Throttle += clamp(new − old, ±dt·ThrottleSpeed).
8. **Boost gate:** clear bActivateBoost if Throttle < 1.
9. **Send:** ProcessEvent(Car.SetVehicleInput, Input). Physics uses it for every 120 Hz substep of the frame.

## Prediction [N]
| # | What | Game | Implement |
|---|---|---|---|
| BOT-8 | Ball model | AdvancePhysics (0x140eb5c10): p += vt + ½gt², v += gt.<br>PredictLanding (0x140f23220): ballistic fall to z = GroundZ + R, GroundZ = Pylon.GroundZ 5.0 [A]; returns FallTime.<br>PredictPhysics (0x140f23360): at most **one** floor bounce (vz = \|vz\| × Bounce, Bounce = the physmat restitution), then ballistic, z ≥ GroundZ + R.<br>No walls, drag, spin or friction; grounded car proxies have g = 0 | The same crude model: bots misjudge wall and ceiling balls |
| BOT-9 | Timing helpers | GetClosestTime2D(A, B, T) = clamp(−dp·dv/\|dv\|², 0, 1)·T (constant 2D velocity). WillImpact2D: first time the 2D separation = rA + rB within 10 s. GetDriveTime(d) (0x140ef4360): 0.05 s steps, a = DriveTorque × DriveTorqueCurve(v)/mass, plus BoostForce/mass while t < boost amount (treated as seconds) when bCanUseBoost; speed ≤ MaxLinearSpeed; result ≤ 5 s | Port as is |
| BOT-10 | Jump constants | CacheJumpData [S]: MaxJumpHeight ≈ 232.6 uu (impulse + 0.2 s held + coast to apex); MaxJumpHeightTime ≈ 0.897 s [I numeric] | Derive from the car constants |

## Driving [N unless tagged]
| # | What | Game |
|---|---|---|
| BOT-11 | MoveTo tick (0x140f195f0; HitBall 0x140f194b0; CatchBall 0x140f19320) | Fail if ≥ 3 wheels off the ground for > 0.1 s. Success on reaching the target (2D distance < ReachDistance) or passing it (within rCar + rTarget, and the target goes from > 0.1 to ≤ 0.1 ahead). HitBall also succeeds on the frame the bot touches the ball. MaxSpeed = archetype MaxSpeed − U(0, RandomMaxSpeedModifier), drawn at start [S]. Then GetLeadDestination → PathTo |
| BOT-12 | Lead (0x140ef62d0) | r = flatten(car − target); target velocity flattened with its away-from-car part removed; t = min((\|r\| − rCar)/max(carFwdSpeed + closing, 1), 1); **lead = target + v·t·Skill**; falls back to the plain target if the lead point hits an obstacle. HitBall adds a random offset of length RandomTargetOffset (random yaw, drawn at start) |
| BOT-13 | Aimed approach | GetAimDir (0x140eee1d0) = flatten(FaceLocation − car).<br>**HitBall** (0x140eee410): aim yaw clamped to ±90° of the approach; Destination −= AimDir × (((rT + rCar) − rT/2)·2·\|Δyaw\|/65535 + rT/2) × **Skill**; outside the turning circle it is pulled back a further (dist − rT − rCar − 100) × AimOffsetScale (0.5) × (1 − \|Δyaw\|/65535) × **Skill**; then ClampToField.<br>**MoveTo** (0x140eee880): the destination becomes the tangent point to a circle of radius min(turning radius, MaxTurnRadius 750) beside the target, so the car arrives facing AimDir |
| BOT-14 | PathTo (0x140f1ab60), boost-pad detours | flatten → aimed destination (kept only if reachable within 500 and obstacle-free) → BTMoveModifiers → navmesh path when the destination or car moved more than rCar → DriveTo.<br>**Boost modifier** [S][A]: boost not full; every 0.15 s pick the nearest available pad within 5000 that is closer to the destination than the car, > 1500 from the destination, within 35° of the heading and 5° of the car→destination line; destination = pad + 0.25·\|pad − car\| along destination → pad. Positioning moves only |
| BOT-15 | DriveTo (0x140ee1c90) | Throttle = 1 if MaxSpeed < 0 or fwd ≤ 0, else clamp((MaxSpeed − fwd)/100, ±1) (mirrored in reverse). Up a slope steeper than about 45°, on the ground and slower than MinSpeed 300: throttle negated. Point turns (MoveTo default on, HitBall off): destination inside the turning circle → brake while fwd ≥ MinSpeed, else reverse with opposite steer. Otherwise SteerTowardsLocal. With fwd > 0: SeparateTeammates. **Boost** if bBoost && bCanUseBoost && Throttle ≥ 1 && \|Steer\| < 1 |
| BOT-16 | Steering law (0x140f4b090) | Steer = clamp(yaw of the local offset (degrees) / SteerAngleCurve(\|fwdSpeed\|) (degrees), ±1) |
| BOT-17 | Teammates | SeparateTeammates (0x140f31ae0): nearest teammate ahead within TeamSeparationDistance 300 (0 on kickoff) → DriveAwayFrom (throttle ≤ clamp(ahead/(R + buffer), 0, 1) − 1 when in the lane; steer to pass at R + buffer). SlowForObstacles has no effect (MaxSpeed reset next tick) [I] |
| BOT-18 | Other actions | **Face** [S]: within 15° → success; else full steer, throttle ±1 flipping every 100–150 uu, ≤ 500 uu/s; fails off the ground. **PowerSlide** [S]: throttle ±1, steer to target, handbrake; ends after 180° of yaw or within 11.25° of the target. **Stop**: brake ±1 against forward speed until \|v\| < 25. **WiggleTires**: Steer = sign(sin 2t). **BlockGoal** [S]: ball's closest 2D approach to the goal (10 s), within 900 − rCar of the goal centre. **CatchBall**: predicted landing point, velocity zeroed |

## Decision logic [A][S]
| # | What | Game |
|---|---|---|
| BOT-19 | Root (Evaluator) | Countdown → WiggleTires. Kickoff (Active, ball not yet hit) → the kickoff table. Active → BOT-20. PostGoalScored → zero input. Podium → random emotes |
| BOT-20 | Active, in priority order | 1. **OffGround** (Jump unlocked, wheels off ≥ 0.1 s; ends on landing): on the roof throttle 1, else Stop. **No air control.**<br>2. **OnWall** (grounded ≥ 0.1 s, normal.z < 0.3): MoveTo straight down the wall at 1000.<br>3. **Stuck** (\|fwd\| < 100, touching a car within ±45° of front or back): reverse 0.5 s toward own goal, then forward 0.5 s.<br>4. BallWelded (Spike Rush).<br>5. Intro roles (Skill ≤ 0).<br>6. **Tactics** (BOT-25).<br>7. **Behavior** = roles (BOT-21).<br>8. **Idle**: CatchBall toward the ball when > 500 away, else face the ball, else Stop |
| BOT-21 | Roles (first whose conditions hold) | 1. **Aggressor**: behind the ball relative to the attack direction (bearing from the ball > 100°), and no closer teammate behind the ball moving toward it (> 500 uu/s; my distance − 100).<br>2. **Striker**: ball 1 s ahead within 1000 of the enemy goal line and \|side\| > 1000 (enemy corner), position claimed → hold EnemyGoal + 2500.<br>3. **Mid**: ball within 4000 of the enemy goal line, claimed → hold FieldCenter.<br>4. **Goalie**: ball within 5000 of own goal line, claimed → ReturnToGoal, face the ball.<br>5. **Defender**: ball within 5000 and \|side\| > 1000, claimed → DefenseAttack if possible, else hold own goal + 500.<br>6. **IdleGrabBoost** (All-Star).<br>**Claim** = (within 250 of the spot and the nearest teammate to it) OR no teammate within 1500 of it (1000 for the goal), teammates predicted 1 s ahead.<br>**Hold**: reverse to the spot if it is behind (> 120°, < 1500), else drive with pad detours (ReachDistance 100, FinishTime 0.25, so it re-plans 4×/s).<br>This is the whole rotation logic; there is no communication |
| BOT-22 | Aggressor detail | Facing the ball (< 60°) and **CanAttackBall** (ball height at drive-time-to-landing < MaxJumpHeight):<br>• All-Star: HitBall_Offense = aimed dodge (at EnemyGoalShot) > JumpIntoBall > HitBall facing Mid (ball in my half) or EnemyGoalShot.<br>• Others: dodge (not Rookie) > jump > HitBall straight at the lead point.<br>Otherwise CatchBall to the landing point. Not facing: powerslide turns (NotEasy) or drive until < 45° |
| BOT-23 | Boost | Used only by bBoost actions (HitBall default true; ReturnToGoal far; Declutter; IdleGrabBoost); never while CatchBall or positioning. Needs Skill > 0.4, full throttle, \|steer\| < 1. **IdleGrabBoost** (Skill > 0.75): more than 1200 from own goal, the nearest available pad, I am 500 closer to it than any other car → drive over it boosting, then powerslide toward the ball. No conservation logic |
| BOT-24 | Jump and dodge | **JumpIntoBall**: Jump unlocked, (speed toward the ball > 1000 OR ball bounce height > 30), and JumpHit (0.05 s cache) predicts contact within MaxJumpHeight.<br>**Jump action**: hold; fail if not airborne by 0.1 s; release when the predicted own z at impact exceeds the target z; fail after MaxJumpHeightTime.<br>**DodgeIntoBall** (NotEasy): DodgeHit checks (jump 0.25 s + DodgeTime) reach; DodgeTime = DodgeTorqueTime 0.65 × max(0.25 + U(−0.2, 0.2)·(1 − Skill), 0.05). Sequence: jump, release, ≥ 0.05 s of jump-inactive, then dodge when contact is within DodgeTime. Direction: search ±67.5° in 1024-unit steps for the dodge whose resulting velocity best points at (ball + v·DodgeTime, shifted half a radius away from AimTarget); writes DodgeForward/DodgeRight. Then a 0.75 s Jump lock |
| BOT-25 | Tactics (all skills) | **GoalieSave**: behind my goal line or within 1000 of the goal, and the ball's closest approach to the goal within 3 s is < 1200. If the landing point is outside the goal (> 100) and hittable → hit (reverse hit if the ball is behind me); else jump-block if JumpHit, else BlockGoal.<br>**DivertBall**: ball between me and my goal, low (< 64), moving toward my goal line > 500 → dodge if alongside (< 128, relative speed < 300), else HitBall facing away from my goal |
| BOT-26 | Aerials / air control | None: no node writes pitch, yaw or roll; every hit is gated by MaxJumpHeight. Don't add aerials to "Psyonix-like" bots |
| BOT-27 | Defense attack | Defender: CanHitBall, ball not projected into own goal (now and 1 s ahead, > 1000), no teammate within 1200 going to the ball → HitBall facing out of own goal, AimOffsetScale 0 |
| BOT-28 | ReturnToGoal | **Inside the goal:** turn around and drive out to GoalForward1000.<br>**Near (< 2000):** goal behind → reverse to GoalBackward500 until behind the line; else drive to GoalForward50, turn around (slide when NotEasy), stop.<br>**Far:** turn, boost to the near post (by side) until about 0.65 s from GoalBackward50, then turn around |
| BOT-29 | Intro roles (Skill 0, tutorial) | EmergencyDefense (deliberate 500 random miss); EmergencyOffense; PlayerTeamDefender; Declutter |

## Kickoff (from the countdown's end until the first touch) [A][S]
| Spawn (blue) | Distance to own goal | Role (team ≥ 2) | Behaviour |
|---|---|---|---|
| (0, −4608) back centre | 512 | **Goalie** when every teammate is more than its own distance + 200 away (all other spots qualify) | ReturnToGoal: the goal is behind, so it **reverses into the net** until behind the line, faces the ball (> 15°), stops |
| (±256, −3840) back corner | 1305 | Goalie only when all teammates are > 1505 away; two back corners tie, so both attack | as above, else attacker |
| (±2048, −2560) diagonal | 3278 | never goalie with standard teammates; two diagonals both attack | attacker |
| any spot, 1v1 | – | always attacker | attacker |

Attackers: TeamSeparationDistance 0 (teammates not avoided); Land first (stop until the wheels are down).
- **Intro:** ball + 50 uu random offset; MaxSpeed 1300 − U(0, 600); no boost; may JumpIntoBall.
- **Rookie:** ball + 50 uu offset; full throttle; **no boost; no dodge**; may JumpIntoBall.
- **Pro / All-Star:** an Evaluator: DodgeIntoBall when DodgeHit fires, else a RandomSelector, 25 % each:
  - shot at EnemyGoalLeft (AimOffsetScale 0.5);
  - shot at EnemyGoalRight (0.1);
  - standard hit, ball offset 50 uu to one side;
  - standard hit, ball offset 50 uu to the other side.
  All with a 10 uu random offset and boost.
- **No fake, wait or delay rule.** The only randomness is the selector draws, the offsets, the Intro speed and the
  DodgeTime noise.

## Difficulty table
| Parameter | Intro | Rookie | Pro | All-Star | Unfair |
|---|---|---|---|---|---|
| Skill (BotConfig_TA.Skills, verified) | 0 | 0.33 | 0.66 | 1.0 | 1.0 (+ unfair teams) |
| Boost (Skill > 0.4) | no | **no** | yes | yes | yes |
| Steer quantisation step 0.1·(1 − s) (verified range) | 0.10 | 0.06 | 0.03 | none | none |
| Steer rate /s, 10 + 40·s (verified range) | 10 | 23.2 | 36.4 | 50 | 50 |
| Throttle rate /s, 2 + 48·s (verified range) | 2 | 17.84 | 33.68 | 50 | 50 |
| Ball lead and aim offsets (× Skill) | 0 | 0.33 | 0.66 | 1.0 | 1.0 |
| Dodges and powerslide turns (NotEasy, s > 0.33) | no | **no** | yes | yes | yes |
| DodgeTime (s) | – | – | 0.118–0.207 | 0.1625 | 0.1625 |
| Goal-aimed offense and dodge, IdleGrabBoost (Hard, s > 0.75) | no | no | no | yes | yes |
| Kickoff variant | Intro | Easy | Hard | Hard | Hard |
| Condition cache / jumps / aerials | 0.1 s / single jump / none (all difficulties) | | | | |

Other skill sources [S]: URL ?BotSkill= (default 1.0); Season mode min(Difficulty/3, 1); online bot fill
BotSkillByPlayerSkillCurve (0 → 0.33, 10 → 0.66, 20 → 1) on average MMR. The difficulty tags map to Skills[0..4]
(BotsIntro, BotsEasy, BotsMedium, BotsHard, BotsUnfair), verified in script.

## Implementing it here
- **BOT-30, core loop:** BOT-3/4/5 plus the pipeline. Tick the tree per frame (or per physics tick) with dt-based limits;
  zero Input each tick; then quantise, rate-limit, and clear boost when throttle < 1.
- **BOT-31, constants:**
  - condition cache 0.1 s (JumpHit 0.05); Jump lock 0.75 s;
  - MoveTo fails after 0.1 s with ≥ 3 wheels off the ground;
  - re-plan every 0.25 s; pad scan every 0.15 s; unstick 0.5 + 0.5 s;
  - jump/dodge start timeouts 0.1 s; ≥ 0.05 s between jump release and dodge;
  - horizons: goal-threat 3 s, claims 1 s, face 2 s, impact 10 s;
  - speed gain 1/100 per uu/s; MinSpeed 300; MaxTurnRadius 750; TeamSeparation 300; BlockGoal radius 900.
- **BOT-32, our side:** a new server-side module (it fits the authoritative server); the tree as a data file from
  bt_tree.txt; a deterministic RNG (the game uses C rand() and script Rand/FRand).

## Open
- **Difficulty labels:** the UI label ↔ tag mapping (Rookie = BotsEasy, Pro = BotsMedium, All-Star = BotsHard) is
  inferred; it's supported by the tag names and an achievement that checks BotSkill == 1. BotConfig_TA is an
  OnlineConfig, so online pushes could change Skills.
- **Unused or native:** BotBoostThreshold_vsAI (0.5) and SetBotSkillByTeam have no script callers.
- **Steer-angle curve:** which one VehicleSim+0xb0 holds at runtime (averaged vs inner wheel), which sets BOT-16's gain.
- **Not fully decoded:** the turning circle (0x140ef6f20 → 0x140ef70a0), obstacle queries (0x140ef8ee0 / 0x140ef9150),
  the navmesh UpdatePath (0x140f62710).
- **Tick timing:** the bot tick group and frame-vs-physics order are assumed equal to the player's (TG_PreAsyncWork);
  whether bot inputs skip byte quantisation is inferred.
- **Bot bodies:** the ProductAsset_Bot_TA packages were not located.
- **Live tests:** hook SetVehicleInput per bot:
  - Rookie steer in multiples of 0.06 and never boosting; Pro in multiples of 0.03;
  - Rookie slew rates 17.84 / 23.2 per second;
  - the All-Star kickoff spread across the four approaches;
  - the back-centre bot reversing into its net at a 2v2 kickoff;
  - both diagonals attacking.
