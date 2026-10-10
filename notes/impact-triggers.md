# Impact and landing triggers: spec (static session, 2026-10-10)

Live build 2026-10-06. Answers the live session's Q-RMB-a, which the impact camera shake (notes/camera-shakes.md) and
the impact/landing sounds (notes/sound-behaviour.md) depend on. Drafted by sub-agent RMB1 (decompiles and asm local in
out/bsim/agents/RMB1/e1..e26). The static session re-checked the v ≤ 200 early-out in the asm
(0x140f1b351 curve eval → 0x140f1b35f JBE → exit before any StopShake/PlayShake). Tags [N] native (live addresses),
[S] script, [I] inferred. Controller rumble is not implemented (user decision); notes/rumble.md is reference only.

**Summary**
- **IT-1. Cadence.** Impacts are processed every 120 Hz physics step while a pair touches; there is no touch-start
  debounce. The impact shake skips v ≤ 200 (no restart), so resting contact never cuts a hit short.
- **IT-2. Speed.** v = |(v̄_self − v̄_other)·n|: averaged point velocities (v + ω×r) taken before the step's forces and impulses, over all contact points
  with that partner in the step; n is the averaged normal. It is replaced by a line-check hit normal only for static
  world partners (±10 uu) and for a ball partner (per-polygon, toward its centre); **never for a car partner**
  (corrected 2026-10-10, CBL1; see §1).
- **IT-3. Batching.** One HandleCollision per (car, partner actor) per physics step; the last restart in a frame wins.
- **IT-4. Paths.** Car–ball, car–car and car–world share the chain. The ball's SoundPriority 100 means car–ball hits
  play only Impact_Ball; car–car plays one body sound. Sparks and sound need v ≥ 50 and a 0.15 s game-time cooldown,
  with separate world and actor slots.
- **IT-5. Landing.** Checked once per render frame per wheel on the contact bit's rising edge. v = |prev-frame chassis
  velocity at the wheel's hard point · ray-hit normal| > 50. It posts Impact_Wheel (RTPC v) on every car with no
  cooldown. The landing camera shake has duration 0, so there is no camera motion.

For the outputs on these triggers:
- the **Impact_Medium camera shake** (notes/camera-shakes.md);
- the **impact sound and sparks** (ImpactEffectsComponent_TA: MinImpactMomentum 50, MinImpactDelay 0.15);
- the **landing sound** (FXActor_Car_TA.AkWheelImpactSound).

Live addresses throughout. Field names come from the class layouts:
- ImpactEffectsComponent_TA: SoundPriority +0xa8, AkImpactSound +0xb8, AkImpactTypeKey +0xd0,
  AkImpactIntensityKey +0xd8, MinImpactMomentum +0xe0, MinImpactDelay +0xe4, ImpactCameraShake +0xe8,
  ShakeScaleCurve +0xf8, LastWorldImpactTime +0x110, LastActorImpactTime +0x114, ShakeComponent +0x130,
  LastCollisionEffectData +0x138.
- Wheel_TA: VehicleSim +0x150, WheelIndex +0x158, Contact +0x160 (bHasContact bit 0, bHasContactWithWorldGeometry
  bit 1, HasContactChangeTime +0x164, Actor +0x168, Component +0x170, Location +0x178, Normal +0x184).

**Clarifications (2026-10-10)**
- **The sleeping/disabled filter covers rigid bodies only** [N 0x140eddaa0]: the activation test (+0xf4 == 2 or 5) runs
  only when the object's internal-type byte (+0x108) has bit 2 (CO_RIGID_BODY). RL's arena statics are plain
  btCollisionObjects (activation state 5, CF_STATIC_OBJECT; notes/bullet-diff.md), so they are never filtered. In an
  engine whose statics are btRigidBody (ISLAND_SLEEPING at insertion), apply the filter to non-static bodies only.
  The equivalent effect: a sleeping ball or car (state 2) still suppresses the event.
- **Impact component values** [A GameInfo_Soccar_SF; TAGame class defaults]:
  - Ball_Default: SoundPriority 100, AkImpactSound Impact_Ball, MinImpactMomentum 50, MinImpactDelay 0.15 (class
    default);
  - Car_Default: SoundPriority 0 (class default), Impact_Body, MinImpactMomentum 50, MinImpactDelay 0.15 (class default),
    Impact_Medium_CameraShake;
  - Default__ImpactEffectsComponent_TA: MinImpactMomentum 1.0, MinImpactDelay 0.15.

## 1. Where impacts come from: one physics step (120 Hz) [N]

`FUN_140f30970` is one fixed physics step of RL's physics manager (DAT_1424c4038). It runs once per 120 Hz step, so
N times per render frame:

```
FUN_140f30970(physMgr, dt):
  scene.PendingCollisionNotifies.Empty()                 # scene = GWorld+0x208, list +0x60 (stride 0x60)
  physMgr.frame (+0x1a0) += 1
  for obj in physMgr.stepObjects: obj->PrePhysicsStep(dt)    # iface +0x28; RBActor_TA: 0x140f21850
        -> RBActor.RBCollisions (+0x6f8, count +0x700) = 0   # cleared every step
  FUN_14041f6f0(btWorld, dt)                              # Bullet stepSimulation (one substep)
  FUN_140eddaa0()                                         # manifold scan -> notifies -> dispatch (below)
  for obj in physMgr.stepObjects: obj->PostPhysicsStep(dt)   # iface +0x30; RBActor: 0x140f1eee0/0x140f1f080
        -> 0x140f1ef70 -> 0x140f5b120 (collision dispatch, below)
```

**Manifold scan `FUN_140eddaa0`** (every step, every Bullet persistent manifold):

```
for m in dispatcher.manifolds:                            # getNumManifolds +0x40 / getManifoldByIndexInternal +0x48
  if m.numPoints (+0x460) == 0: skip
  if either collision object has CF_NO_CONTACT_RESPONSE (+0xe8 & 4): skip
  if either rigid body's activation state (+0xf4) is 2 (sleeping) or 5 (disabled): skip
  call0 = body0 owner actor valid and (actor+0xf8 & 1) == 0   # likewise call1 for body1 (static actors get no event)
  if !call0 && !call1: skip
  if min over points of distance (+0x70) <= m.processingThreshold (+0x468) or max of point+0x100 > 0:
    record FCollisionNotifyInfo{call0, call1, Info0, Info1, ImpactData}
    for each point with distance <= threshold or point+0x100 > 0:
      ContactInfo = { Position   = point.positionWorldOnA(+0x30) * 50,     # uu
                      Normal     = point.normalWorldOnB(+0x40),            # unit, from body1 toward body0
                      Penetration= point.distance(+0x70),                  # BU, unscaled
                      Velocity[0]= point+0xe0 * 50, Velocity[1] = point+0xf0 * 50,   # uu/s
                      PhysMat[0/1] }
      TotalNormalForce   += point.appliedImpulse(+0x9c) * normal
      TotalFrictionForce += lateral impulses(+0xa0/+0xa4) * lateralDir1/2(+0xc0/+0xd0)
DispatchRigidBodyCollisionNotifies (FUN_1409ad0e0):
  call0: Actor0->OnRigidBodyCollision(Info0, Info1, Data)          # vtable +0x4a0
  swap: Velocity[0] <-> Velocity[1], PhysMat swap, Normal = -Normal
  call1: Actor1->OnRigidBodyCollision(Info1, Info0, Data)
```

**What point+0xe0 / +0xf0 / +0x100 are.** They are written every step by the solver's contact setup
`FUN_1402bb8c0` (Psyonix's setupContactConstraint; see the btManifoldPoint layout in notes/bullet-diff.md):
- +0xe0 = vel1 = v_lin(A) + ω(A) × r_A, body A's **point velocity at the contact** (BU/s);
- +0xf0 = vel2, the same for body B;
- +0x100 = max(0, −n·(vel1 − vel2) · combinedRestitution(+0x7c)).

Timing (corrected 2026-10-10): these are the rigid bodies' own velocities (rb+0x160/+0x170) read at solver setup, i.e.
**before this step's forces and gravity and before its contact impulses**. In Bullet 2.82 predictUnconstraintMotion does
not integrate velocities ("it happens in the constraint solver", out/bsim/bullet-2.82 btDiscreteDynamicsWorld.cpp); the
step's forces enter the solver separately as m_externalForceImpulse. So they are the previous step's end velocities,
not the post-bounce ones. The earlier "after this step's force and gravity integration" was wrong (RVV, 674f3ef).

**The processing threshold.** It is the min of the two objects' m_contactProcessingThreshold. RL appears to keep
Bullet's default BT_LARGE_FLOAT [I], so every cached point counts. Points exist while within the contact breaking
threshold (bullet-diff: 0.02 BU scaled per shape).

**Per-actor accumulation**, ARBActor_TA::OnRigidBodyCollision `FUN_140f190b0`, once per manifold per step:

```
entry = RBCollisions.FindOrAdd(key = OtherInfo.Actor)      # 0x80-byte entries; one per partner actor per step
entry.otherComp = OtherInfo.Component; entry.mat = ContactInfos[0].PhysMat[1]
entry.nManifolds += 1; entry.forceSums += (TotalNormalForce, TotalFrictionForce)
for c in ContactInfos: entry.nPoints += 1
    entry.pos += c.Position; entry.normal += c.Normal; entry.vSelf += c.Velocity[0]; entry.vOther += c.Velocity[1]
```

**Post-step dispatch** `FUN_140f5b120` (RBActor = self):

```
for entry in RBCollisions:
    pos, vSelf, vOther /= nPoints; normal = normalize(sum of normals); forces /= nManifolds
    script event (DAT_1424c5680) with the entry; world partners also feed WorldContact (+0x690)
if self.lastCollisionFrame (+0x718) < physMgr.frame:      # at most once per physics frame number (rollback re-sims skip)
    lastCollisionFrame = physMgr.frame
    if ImpactEffectsComponent (+0x6f0) attached:
        for entry in RBCollisions: HandleCollision(comp, entry)   # 0x140f03160
```

**HandleCollision** `0x140f03160`:

```
self = comp.Owner   # a car or the ball; the early-outs are generic Actor/RBActor_TA fields
return if !self.WorldInfo (+0x130) or !WorldInfo.MyEmitterPool (+0x790) or self.bHidden (+0xf8 bit 1)
return if the hit component is null or not attached (warning)
return if self and partner are welded (RBActor_TA.WeldedActor +0x750)
dv = entry.vSelf - entry.vOther                            # uu/s
if |dv.x|, |dv.y| and |dv.z| are all < 1e-4: return       # nothing at all
n, loc, mat = entry.normal, entry.pos, entry.mat
if partner owner is bMovable (+0xfc bit 18, 0x40000):          # a car or a ball
    if Cast<SkeletalMeshComponent>(partner component) (0x140460fb0): no check   # a car (CarMeshComponent_TA): n stays
    else: hit = partner component LineCheck(Result, End = component.Bounds.Origin (+0xa4), Start = loc,
                                             Extent 0, flags 0x220df)          # vtable +0x350; the ball: per-polygon
else:                                                          # static world geometry
    hit = SingleLineCheck(start = loc + 10 n, end = loc - 10 n, source = self, flags 0x220d3)
if hit (Time < 1): n, loc, mat = hit.Normal, hit.Location, hit.PhysMaterial   # the hit replaces the contact normal
v  = |dv · n|                                              # "impact speed", uu/s
vt = |dv| - v                                              # stored, used by slide effects
comp.LastCollisionEffectData = {mat, matProp, effectsMapEntry(ImpactEffectsMap, mat), loc, n, dv, v, vt, frame, partner}
soundSide = true
if partner has an ImpactEffectsComponent_TA:               # first one in partner.Components (iterated from the end)
    if comp.SoundPriority < other.SoundPriority or (equal and comp(+0x38) < other(+0x38)):
        soundSide = false
ImpactShake(comp, data)               # 0x140f1b2d0: camera shake
ImpactEffects(comp, data, soundSide)  # 0x140f1b080: sparks and sound
```

`+0x38` is a per-object integer, probably the object index [I].

**ImpactShake** `0x140f1b2d0` (Impact_Medium camera shake):

```
return unless ImpactCameraShake or ImpactForceFeedback set
return unless car's top controller is a local PlayerController       # 0x5d0 -> 0x6a0
s = ShakeScaleCurve(v)              # linear (0,0) (200,0) (201,0.1) (4000,1); 1 above 4000
if s <= 0: return                   # v <= 200: NO restart, the playing shake continues untouched
create the per-car ShakeComponent_X once (Receiver Local)
StopShake(0); ShakeParams = Impact_Medium_CameraShake; AmplitudeScale = Constant(s); FFScale = s; PlayShake()   # restart
```

**ImpactEffects** `0x140f1b080` (sparks and sound):

```
if v < MinImpactMomentum (50): return                     # MinImpactMomentum <= v passes
slot = (partner == None or partner.bWorldGeometry (+0xf8 & 0x100)) ? LastWorldImpactTime : LastActorImpactTime
now = car.WorldInfo.TimeSeconds (+0x550)                  # dilated game time, advances per frame
if now - slot < MinImpactDelay (0.15): return
slot = now
if effectsMapEntry.template: spawn the impact particle at loc, rotation from n; PSC float param = v   # sparks
if soundSide and AkImpactSound:
    car Ak component: switch AkImpactTypeKey ("MaterialType") = surface; RTPC AkImpactIntensityKey ("ImpactIntensity") = v
    slapback hook (+0x1f8) with v if enabled; post AkImpactSound
```

## 2. Answers

**Q1. Cadence.** [N; high]
- HandleCollision fires **every 120 Hz physics step while the pair touches**, i.e. while the manifold holds at least
  one point. It is not only on touch-start, and there is no per-pair debounce.
- The only filters are:
  - CF_NO_CONTACT_RESPONSE;
  - a sleeping or disabled body;
  - a static owner actor (no event for it);
  - the per-point gate (distance ≤ processing threshold, or restitution velocity > 0);
  - the once-per-physics-frame-number gate (rollback).
- A car resting on a wall or the ball gets HandleCollision every step with v ≈ 0 (gravity alone adds ≈ 5.4 uu/s per
  step).
- **v ≤ 200 skips the shake**: ShakeScaleCurve(v) = 0 → return before StopShake/PlayShake. A strong hit's shake is
  never cut by resting contact.
- It is restarted every step in which v > 200, e.g. a multi-step violent contact, or a car pushed into a moving
  partner. The newest restart wins, even when weaker.
- Sound and sparks need v ≥ 50 and the 0.15 s game-time cooldown. There are two cooldown slots: world/no-actor
  partners, and actor partners (cars, ball). The cooldown is shared across all partners of the same kind.

**Q2. Velocity, point and normal.** [N; high, except as noted]
- All points of all manifolds with the same partner actor in that step are **averaged**: position mean, normalised
  normal sum, mean self and partner velocities. There is no deepest, first or max selection.
- The velocities are **point velocities v + ω × r** of each body at each contact point. They are taken at the solver's
  contact setup: **before** the step's forces and gravity (Bullet 2.82 applies them inside the solver) and before its
  impulses, i.e. the previous step's end velocities. Units uu/s (BU × 50). (Corrected 2026-10-10.)
- The normal is the averaged contact normal (partner → self). **Corrected 2026-10-10 (CBL1, live asm 0x140f03335–
  0x140f03504) [N]:** it is replaced by a hit normal only when a check hits:
  - **static world:** SingleLineCheck from loc + 10 n to loc − 10 n (flags 0x220d3);
  - **a car partner: no check at all.** The car's collision component is its Mesh (CarMeshComponent_TA, a
    SkeletalMeshComponent), and HandleCollision skips the LineCheck for skeletal meshes (0x140f03351/59). n stays the
    averaged normal;
  - **a ball partner:** the ball's StaticMeshComponent LineCheck along the segment from the contact point to the
    component's Bounds.Origin (≈ 4.3 uu off the centre), per-polygon on the grooved LOD0 mesh (radius 88.1–94.8). A hit
    gives a facet normal a median 3–4° off radial; with a sphere the clone's equivalent is the radial normal;
  - on a miss: the averaged normal, the averaged position and the entry's material (or the partner's
    PhysMaterialOverride if that is null).
- v = |(v̄_self − v̄_other) · n|.
- Processing-threshold value: BT_LARGE_FLOAT assumed [I; medium].

**Q3. Batching.** [N; high]
- One notify per manifold per step, accumulated into one entry per partner actor.
- One HandleCollision per (self, partner actor) per physics step.
- Several steps in one render frame each call it. The shake restart of the last step with v > 200 wins.
- The sound/spark cooldown uses WorldInfo.TimeSeconds, which only advances per frame, so at most one sound per slot
  per frame anyway.
- Where the physics steps sit relative to the component tick in a frame (the shake's first-sample time) was not
  traced [I].

**Q4. Paths.** [N; high]
- Car–ball, car–car and car–world all use the same chain (manifold scan → OnRigidBodyCollision → HandleCollision).
- **Car–world:** world-impact cooldown slot. The car plays Impact_Body plus sparks, and the shake if the car is local.
- **Car–ball:**
  - The ball has its own ImpactEffectsComponent (SoundPriority 100, AkImpactSound Impact_Ball, no shake, no effects
    map).
  - The car side (SoundPriority 0) therefore plays **no body sound**. It still does sparks (actor-impact cooldown) and
    the shake (local car).
  - The ball side plays Impact_Ball with its own cooldown.
  - The ball-touch gameplay event (hit registration, stats) is a separate path, not traced here.
- **Car–car:**
  - Both cars run it with swapped velocities and negated normal, with no line check (cars are skeletal meshes), so
    both get **exactly the same** \|Δv·n\| (corrected 2026-10-10, CBL1).
  - Both spawn sparks; each local car shakes.
  - Only one body sound: equal SoundPriority 0, so the side with the larger +0x38 integer plays it [I on the field].
- **Early-outs:** a hidden/flagged car (+0xf8 & 2), linked actors (+0x750), and missing car sub-objects.

**Q5. Landing.** [N; high]
- **Where it runs.** `FUN_140f66850` runs **once per render frame**, not per physics step:
  - AActor::Tick 0x1407537d0 calls vtable +0x378 = FXActor_X::TickSpecial 0x140e61270;
  - that calls +0x6a0 = FXActor_Car_TA::TickFX 0x140f52b60, which calls 0x140f66850.
- **Contact bit.** Wheel_TA.Contact.bHasContact is rewritten every physics step by 0x140f5e390 (from the vehicle hook
  0x140ecef40):
  - set when the wheel's **suspension ray hit an object** (btWheelInfo ground object +0x48);
  - Contact.Normal = btWheelInfo +0x00, the **ray-hit normal**;
  - Contact.Location = +0x10 × 50;
  - HasContactChangeTime = frame/120 on change.
- **Trigger, per wheel, per frame** (FX state per wheel at FX+0x470: bit +0x14, velocity +0x08):

```
if Contact.bHasContact != stored bit: stored bit = Contact.bHasContact
    if now 1 (rising edge seen this frame):
        v = |storedVel · Contact.Normal|
        if v > MinImpactMomentum (FX+0x3a0 = 50, strict):
            PlayWheelLandCameraShake(v)     # 0x140f1b580: local car only, restart; Land_CameraShake has D = 0, NO camera motion
            car Ak: switch (FX+0x3a4) = surface [I]; RTPC (FX+0x3ac) = v; post AkWheelImpactSound (Impact_Wheel)
storedVel = ChassisPointVel(wheel)          # 0x140ef6650, every frame, after the check
```

- **storedVel** = (v_lin + ω × (hardPoint − COM)) × 50, uu/s. It is the chassis rigid body's velocity at the wheel's
  **hard point** (btWheelInfo +0x30: the suspension anchor at the hitbox-centre height), **sampled at the previous
  render frame**. It is not the suspension speed (+0xd8), not the contact-point velocity, and not a wheel velocity.
- So the live session's reading is right except:
  - the point is the hard point, not the wheel or contact point;
  - "prev" is the previous **frame** (the previous FX tick), not the previous physics step;
  - n is the ray-hit normal.
- **Consequences:**
  - A touchdown and lift-off between two frames is missed.
  - At high fps several frames share one physics state.
  - The landing sound has **no cooldown and no local gate**: every car, every wheel, so up to 4 posts in one frame.
  - The landing camera shake produces no camera motion (D = 0); it only carried force feedback, which the clone does not implement.

## 2b. The ball's own impacts (2026-10-10, RMB1 follow-up) [N][S]

**A ball–world hit plays Impact_Ball; in a car–ball hit the ball makes the sound.** HandleCollision runs on the ball's
ImpactEffectsComponent (Ball_Default: SoundPriority 100, AkImpactSound Impact_Ball, MinImpactMomentum 50,
MinImpactDelay 0.15, no camera shake, no effects map). Ball_TA has no native override (vtable 0x141e8cd08 uses the
shared OnRigidBodyCollision 0x140f190b0).

**Ball–world chain:**
1. The contact scan notifies only the ball side (static arena actors get no event).
2. 0x140f5b120 first runs the script event Ball_TA.OnRigidBodyCollision (TA:11385): OnHitWorld, EventHitWorld, and
   EventHitGround for a ground hit on a ground material. Inside a GoalCrossbarVolume_TA the volume manager's
   TriggerHit (TA:63676ff) sets Ball.ImpactEffectsComponent.ImpactModifier = PostImpactModifier with HitMat =
   Goalpost_Crossbar or Goalpost_Post, sets the global RTPCs Goalpost_Corner and Goalpost_Angle, and fires
   EventCrossbarHit.
3. HandleCollision on the ball: v = |v_ball · n| with the static-world line check. ImpactModifier (+0x1f0) →
   ModifyImpact 0x140f16b50 replaces the impact's PhysMaterial with HitMat (**the goalpost sound switch**), then
   clears the modifier.
4. ImpactShake 0x140f1b2d0 returns at once (no shake or waveform on the ball).
5. The SoundPriority comparison skips static partners, so the ball keeps the sound.
6. ImpactEffects 0x140f1b080: v ≥ 50; the **LastWorldImpactTime** slot, 0.15 s game time; switch MaterialType from
   the material (+0x60), RTPC ImpactIntensity = v; post Impact_Ball. No sparks.

**Car–ball, ball side:** the same chain, **with no line check** (the car's component is a skeletal mesh; corrected
2026-10-10, CBL1): n is the averaged contact normal, so v equals the car side's raw value exactly, and the car side's
event may stand in when it uses its own raw normal. The car's SoundPriority 0 <
the ball's 100, so the ball plays Impact_Ball on its **LastActorImpactTime** slot and the car side is silent. Not
traced: whether the separate ball-touch path also plays a sound.

**Other:**
- Ball–ball: both have SoundPriority 100, so one side plays [I].
- Ball–world contact points carry velocities: the sphere-vs-world points still go through the per-point setup
  0x1402bb8c0 (in 0x1402b3220), so the |Δv| < 1e-4 return doesn't silence them.
- The ball's impacts stop once the goal explosion hides it (bHidden).

**Clone:** collect impacts for the ball as well as the cars, and drive Impact_Ball from them (v ≥ 50, the world/actor
slots, the goalpost material switch). This replaces the client's guessed ball-impact rule (RV-172).

## 3. Confidence
- **High:** step cadence and its filters; the v ≤ 200 skip; per-partner averaging; pre-impulse point velocities;
  the cooldown slots and gates; the paths and SoundPriority; the per-frame landing check, hard-point velocity and
  ray-hit normal.
- **Medium:** processing threshold = BT_LARGE_FLOAT; the +0x38 tie-break field; the landing sound's surface switch
  source (FX+0x460).
- **Not traced:** slide sound/sparks (AkSlideSound Body_Slide, AkSlideMomentumMin 200, AkSlideSoundDelay 0.15; they
  use the stored tangential speed); the shake's tick order within a frame.
