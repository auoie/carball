# Netcode audit: Rocket League vs our server/client (static session, 2026-10-08)

Static analysis of the 2026-06-16 build (addresses); the live 2026-10-06 packages have the same netcode defaults and
the netcode scripts disassemble identically. Ours: `server/src` (game_loop.rs, input_buffer.rs, net.rs, protocol.rs,
game.rs), `client/src/net` (connection.ts, predictor.ts, updates.ts, protocol.ts) and the client's render loop. Read
only; findings sent to the live session, which owns `server/` and `client/`. Sub-agent files local in
`out/bsim/agents/N1/`. Lead-session checks: `RBActor_TA.NetworkSyncSettings` (LocationFixRate 4, AngularFixRate 5) and
the hitch reset in `NetworkInputBuffer_TA.ClientTick` (live scripts).

Corrections to `notes/netcode.md` (our server already behaves this way): while `bFillingBuffer` is set, ServerConsume
consumes on even `EngineShare.PhysicsFrame` only (half rate, `FUN_140f1e780`), it does not wait; late frames are not
dropped (`TrimInputFrames` drops only frames ≤ `LastProcessedReceivedFrame`, an empty tick advances only
`LastProcessedFrame`, and `Consume` sets it back to the consumed frame's number).

## Hypotheses (ranked by impact on online feel)

| # | What | Game | Ours | Suggestion / test | Impact |
|---|---|---|---|---|---|
| N-1 | Visual smoothing of corrections | Before the resim each body's pose is saved (ITickNotify +0x10 `FUN_140f1a9e0` → `ClientCorrectionRBState`); after it (+0x18 `FUN_140f16460` / vehicles `FUN_140f164d0` → `FUN_140eabb70`) `SyncErrorLocation += pre.loc − post.loc` and `pre·conj(post)` folds into `SyncErrorAngle/Axis`. Every render frame (`FUN_140f6a240`, all RBActors): pose = lerp(OldRBState, RBState, alpha) + error, error −= min(dt·LocationFixRate 4, 1)·error, snap to 0 below 0.1 uu²; angle the same with AngularFixRate 5, snap below 0.001 rad; actor and camera use the smoothed pose. Direct state applies (`FUN_140f45e80`) accumulate too and shift OldRBState. Teleports (replicated `TeleportCounter` → `bSkipNextErrorAccumulation`) are not smoothed | `predictor.ts:120-151` overwrites; `online.ts`, `game/interpolated.ts:41-68` only lerp between ticks; no error offset in `client/src` | Render-only error offsets per body with these constants; skip on teleports (kickoff, respawn, resync, reload) via a per-body teleport counter. Test: a 100 uu correction → ≤ 6.7 uu per frame at 60 fps, ~1.6 uu after 60 frames, 0 at ~83; teleports snap; e2e p99 per-frame render jump with jitter/loss | high |
| N-2 | Hitch reset of the jitter buffer | `NetworkInputBuffer_TA.ClientTick`: > 0.1 s between client ticks → "Hitch detected!", `SetTimer(2, 'ServerResetInputBuffer')` → server `JitterBuffer.Reset()` (mean 0.016, variance 0, size 7); the user's live log has 18 hitches of 100–318 ms | none (`net.rs:115`, `input_buffer.rs`) | One 300 ms gap: size 7 → 18, still 9 after 30 s, 7 after ~40 s (refill to size: ~150 ms of queue instead of 58). Client: detect > 100 ms, send a reliable reset 2 s later; server: reset the jitter buffer (keep `last_packet_time`). Unit test + e2e stall | medium-high |
| N-3 | Bandwidth / packet loss | Net_High: ReplicationRate 60, NetSpeed 15000 B/s (~250 B per update); compact RB state (`FUN_140e3e960`); actors replicate independently (a lost packet affects only its actors) | ~273–373 B per car, ~82 B ball, ~170–300 B pads (`NetState.cpp:110-151, 225-256`): 2v2 ≈ 1.6 KB per update (2 datagrams), 3v3 ≈ 2.3 KB, 95–140 KB/s; `UpdateAssembler` (`updates.ts:212-227`) drops a whole update if any part is lost (README says parts apply independently) | Measure; apply parts independently; trim / delta-code cars. e2e byte rate per player count and 2 % loss | medium |
| N-4 | Demolitions on clients | `Car_TA.ApplyCarImpactForces` checks `Role == ROLE_Authority` before `ShouldDemolish`: a client predicts a bump; the demo arrives via `ReplicatedDemolishExtended` → `QueueDemolish` (authority-only, also in `Ball_TA.RecordCarHit`) | the client engine demolishes in prediction (`Arena.cpp:524-540`) | Optionally server-confirmed demos (treat as bumps on clients); test: victim swerves only on the server, count demo-then-undo | medium-low |
| N-5 | Remote input fade re-anchoring (bug in ours) | the input check (`RBVehicleHistory` vtbl+0x288 `FUN_140f5eaf0`) runs only when that car's data arrives | `predictor.ts:138-140` (and `:169-171`) re-anchors `base` for all cars on every update, also far cars not in it (their own faded prediction), so their inputs persist longer | update `#remote` only for cars in the update (car list from `NetState::Read`); unit test near/far car | low-medium |
| N-6 | Remote car prediction (info) | only `ReplicatedThrottle/Steer/bReplicatedHandbrake` replicate; applied at full value each frame (`FUN_140f1a670` → `FUN_140f11c60`), refaded on mismatch (`value·(1 − min(1, (f − sf)/120/0.1))`); remote components (boost, jumps, dodge, air control, flip) not simulated on clients (`FUN_140f1c600` needs `Role > SimulatedProxy ‖ bSimulateComponent`; inferred); resim reuses stored contact planes (vehicle+0x48, `FUN_1402c47d0`); client CCD off | all axes fade over 12 frames, jump/boost/handbrake held, full engine | ours predicts better: keep; the game relies on N-1 to hide its mispredictions | info |
| N-7 | Boost pads / boost amount | server-only pickup; pad state via `NewReplicatedPickupData`; boost to the owner by `ClientGiveBoost`; consumption predicted and reconciled (`ServerConfirmBoostAmount` / `ClientFixBoostAmount`, tolerance 0.0001) | predicted pickups, pad state corrected every 8 ticks | design choice (ours feels better) | low |
| N-8 | Kickoff start | `Countdown` → `SetAllDriving` (replicated `bDriving`): the client learns "go" ~RTT/2 late, resim + smoothing | countdown in the predicted state (`game.rs:143-148`) | keep ours; don't smooth the reset teleport | low |
| N-9 | Input resend / scheduling | ack by timestamp (`ClientAckFrame`: pending frames with TimeStamp ≤ acked are dropped once *received*); at most one packet per render frame when 1/60 s accumulated | resend until *consumed* (`online.ts:186-194`, `Update.receivedFrame` unused though the protocol README says it is); send on every even physics frame (2 per rAF at low fps) | minor | low |
| N-10 | Ack older than the history | `UpdateReplicatedPhysicsFrame` `FUN_140f5e2f0` clamps to ≥ PhysicsFrame − 119 and still corrects; client behind: direct apply (smoothed) | ignored (`predictor.ts:126-128`); behind: `#resync` | edge case | low |
| N-11 | Substeps per render frame | 5, excess time dropped | client 12 and a 0.25 s cap (`fixedStep.ts:13`, `main.ts:113`); server 5 | info | – |

## Confirmed same / equivalent
ServerConsume is the default mode (no client time dilation; STS/CSTS opt-in) and `FUN_140f1e780` = `input_buffer.rs:189-209`
(repeat on empty, half-rate refill, double consume above size, under/over stats, zero input after 1 s); packet receive
(only newer timestamps update the jitter buffer, refill check before merge, sorted merge without duplicates, cap 60
frames); jitter buffer `ClientJitterBuffer_TA.UpdateBufferSize` (0.016–0.25 s gap clamp, 15 s window, 4σ, min 0.05 s,
size ceil(t·120)+1, initial 7) = ours; `Consume` (`FUN_140eb6f80`); input upload 60 Hz, ≤ 10 frames per packet; rollback
to the ack frame and replay of all predicted bodies (120-frame history, every received state dirty: `bUseNEQ` off);
server `ReplicatedRBState = RBState` every frame with the ack in the same packet; replication rates (net tick ≤ 57 Hz;
cars NetUpdateFrequency 15, forced within 1000 uu of the ball; ball 100, always relevant, forced after hits); replicated
RB state lossless against the per-tick quantisation (ours sends a superset); ball hits and bumps predicted on clients;
goals server-authoritative; render interpolation between the last two ticks; no input delay.

## Game netcode parameters
| Parameter | Value | Source |
|---|---|---|
| Physics rate / substeps / history | 120 Hz / 5 per render frame / 120 frames | EngineShare_TA; `FUN_140f4ec60`; `FUN_140f03070` |
| Input mode | ServerConsume (STS/CSTS opt-in) | NetworkSave_TA; `PlayerController_TA.GetInputBufferClass` |
| Client input rate / frames per packet | 60 Hz (20/40/60) / ≤ 10 | PlayerController_TA; NetworkConfig_TA.MaxClientUploadFrames |
| Server queue cap | 60 frames | `TrimInputFrames` |
| Jitter buffer | 0.016–0.25 s, 15 s, 4σ, ≥ 0.05 s, size ceil(t·120)+1, initial 7 | NetworkJitterSettings_TA; ClientJitterBuffer_TA |
| Input timeout | 1 s → zero input | `FUN_140f1e780` → `FUN_140eb31f0` |
| Hitch reset | client tick gap > 0.1 s → `ServerResetInputBuffer` after 2 s | NetworkInputBuffer_TA.ClientTick |
| STS / CSTS | 0.009 of real time, padding 2, max 10 / dilations 1.0256…0.9756 | PhysicsConfig_TA |
| Server net tick | ≤ 57 Hz (idle 20) | ServerConfig_X |
| Client rate / bandwidth | 60 Hz / 15000 B/s (Net_High; user's log) | TcpNetDriver via NetworkSave |
| NetUpdateFrequency | car 15 (prio 6), ball 100 (prio 10), components 30, pickups 1 | class defaults |
| Force update near ball | 1000 uu | NetworkConfig_TA; `FUN_140ee89f0` |
| RB state net format | loc ×100, vel ×100, ang vel ×10000, 18-bit quaternion, sleep bit | `FUN_140e3e960` |
| Remote input fade | 0.1 s (12 frames); throttle/steer/handbrake only | RBVehicleHistory_TA; `FUN_140f5eaf0` |
| Smoothing | location 4/s, angle 5/s, snap 0.1 uu² / 0.001 rad, welded lerp 18 | RBActor_TA.NetworkSyncSettings; `FUN_140f6a240`; `FUN_140eabb70` |
| Ping compensation | − (RealDeltaSeconds + 0.016)/2 | NetworkInputBuffer_TA.UpdatePing |

## Open
TcpNetDriver rate defaults (60 / 15000 from the user's log; per-connection enforcement not decoded); client roles
(AutonomousProxy / SimulatedProxy) inferred from gates; remote components not simulated on clients (inferred, can't
be tested offline); ack-before-state order in a packet (UE3 assumption).

## Review of the live session's fixes (2026-10-08, sub-agent N2; files local in `out/bsim/agents/N2/`)
N-2 (hitch reset) and N-5 (rebase only cars in the update) match the game; N-1 has the right constants and decay but:
- **NR-1** `online.ts:261` shifts only `previous.pos`; the game's direct apply (`FUN_140f45e80`) shifts all of
  OldRBState incl. `Old.q = (new.q ⊗ conj(pre.q)) ⊗ Old.q` → rotational corrections still pop by (1 − α)·|δ|.
- **NR-7** `syncError.ts:33` composes E′ = d·E (`premultiply`); the game (`FUN_140eabb70`) E′ = E⊗d, so drawn = E·pre.
- **NR-2** the "> 500 uu = teleport" test misfires both ways (unpredicted strong ball hits snap; kickoff moves under 500
  uu glide). In the game every correction is smoothed; soccar "teleports" are new actors (kickoff `ResetPlayers`, ball
  `Destroy` + `SpawnNewBall`, respawn); nothing native writes `TeleportCounter` (freeplay ball teleports only). Fix: a
  per-body spawn counter in state/snapshots/NetState.
- **NR-3** the camera uses the unsmoothed rotation (only `error.location` is applied); the game's camera follows the
  smoothed actor.
- **NR-4** a hidden tab piles up updates (thousands of resyncs on return); **NR-5** resync/reload snap and resync
  leaves stale interpolation; **NR-6** N-3 still discards older partial updates and late parts; **NR-8** a predicted
  respawn streaks one frame; **NR-9** no rate limit on the hitch reset (optional).
- Confirmed: smoothing runs per render frame (`FUN_140f6a240` = `RBActor_TA::physRigidBody`, from
  `APawn::performPhysics`); the hitch clock is a real-time per-frame stamp (`FUN_140394840`); the native `SetTimer`
  (`FUN_140889b60`) restarts an existing timer, so the 2 s reset follows the last hitch; the server resets only the
  jitter estimate (`ServerConsume.ResetInputBuffer` → `JitterBuffer.Reset`).

## Live build (2026-10-06) addresses

Checked 2026-10-08. Each function cited here was mapped through BinDiff (out/bsim/bindiff/function_map.tsv) and
semantic-diffed old vs live (out/bsim/scripts/semantic_diff.py; offsets, addresses and stack frames ignored);
key ones were re-decompiled in the live project out/bsim/rl-20261006.

Same apart from layout (old → live): `1402c47d0` → `1402c52d0` · `140394840` → `14039afb0` · `140889b60` → `14088eaf0` · `140e3e960` → `140e3ff20` · `140eabb70` → `140eaffe0` · `140ee89f0` → `140eed780` · `140f11c60` → `140f16f50` · `140f16460` → `140f1b890` · `140f164d0` → `140f1b900` · `140f1a670` → `140f1fab0` · `140f1a9e0` → `140f1fe20` · `140f1e780` → `140f23c10` · `140f45e80` → `140f4bac0` · `140f4ec60` → `140f54bd0` · `140f5e2f0` → `140f643f0` · `140f6a240` → `140f704b0`.

Changed:
- `140eb31f0` → `140eb7660`: zero-input action: the zeroed input struct is one dword larger (new input field); the caller 0x140f23c10 still zeroes input after 1.0 s (re-decompiled)
- `140eb6f80` → `140ebb410`: bAirRoll moved to bit 0 of a new word (see notes/bullet-diff.md "Live build")
- `140f03070` → `140f08340`: a flag bit moved (bitfield layout)
- `140f1c600` → `140f21a90`: struct stride 0x178 → 0x180 (layout)
- `140f5eaf0` → `140f64bf0`: struct stride 0x178 → 0x180 (layout)

---

## Netcode 2: sub-frame taps, demolitions, acks, corrections, wire size (NET-1..8, 2026-10-10)

Requested by the user (relayed by tmp-6f). Drafted by sub-agent NET1 (decompiles and a patched boxcars bit-size tool
local in out/bsim/agents/NET1/). The static session confirmed the server double-consume bug (NET-2) in
server/src/input_buffer.rs: `consume_one` runs twice on an over-buffer tick and each call overwrites `self.controls`.

Static analysis of the **live build (2026-10-06)**. Every address below is a live address, decompiled in a copy of
out/bsim/rl-20261006 (`agents/NET1/rl-live`, runs in `agents/NET1/runs/b1..b10`). Scripts come from the live TAGame
dump (`work/tagame_live_all.txt`, cited as TA:<line>). Two decode errors were fixed in a local decoder copy
(`agents/NET1/scripts/net_ubc.py`: RL's `new` takes 5 operands). Replay measurements come from a boxcars copy patched
to report bit positions (`agents/NET1/tools/{boxcars,netsize}`). It was run on 10 ranked 2v2 replays (net version 10,
30 fps, Sept 2025) and output to `agents/NET1/work/ns2v2/*.csv`.

Tags: [dec] decompiled, [scr] script, [cdo] class default, [rep] measured in replays, [sim] simulated from decoded
rules, [inf] inferred (UE3 behaviour not re-decoded).

### Summary

- **NET-1 (C-6, client).** These rules settle the client side; the clone already implements them (`JumpLatch`,
  `ButtonLatch`, `SendClientAck`-style send clock).
  - Button commands act at event time, before the frame's ticks.
  - Jump = held ‖ latch on each tick. A press sets the latch, and the first non-resim tick clears it (FUN_140f215f0).
  - Boost, powerslide and air roll take the state after the frame's last event, so a tap inside one frame is lost.
  - Every tick of a frame uses the same axes. `bActivateBoost` is recomputed per tick (`bHoldingBoost && boost > 0`).
  - [dec/scr], high.
- **NET-2 (C-6, server, a clone bug).** The game applies each consumed input frame as a `Car.SetVehicleInput` event
  (FUN_140ebb410 → FUN_140f24460).
  - When ServerConsume takes two frames in one tick (over-buffer), the first frame's jump press and release edges
    still fire (`OnJumpPressed` / `OnJumpReleased`). Only its axes, boost and handbrake are overwritten.
  - The clone server keeps only the second frame's controls (`server/src/input_buffer.rs:134-139, 158-167`). A jump
    tap consumed as the first of a pair is **lost on the server**, and so is a re-press (release in A, press in B).
  - [dec], high.
- **NET-3 (wire, client→server).** The game's input packet has its own serializer (`ClientPacketData`,
  FUN_140f16fe0):
  - timestamp f32, camera, frame count, first frame number;
  - per frame, 1 "changed" bit, then 7 axes as (nonzero bit + byte) and 7 button bits.
  - `bJumped` and per-frame timestamps are not sent.
  - A tap is lost on the wire only if every packet that carried its frame is lost: 2 packets at ≤ 24 fps, 2–3 at
    30 fps, up to 5 at ≥ 60 fps, fewer when acked sooner.
  - [dec], high.
- **NET-4 (N-4).** The client predicts a bump (the authority-only demolish branch is skipped).
  - When the replicated demolish arrives, `FinishDemo` runs at once:
    - an explosion at the victim's **current drawn location**;
    - the victim hidden, its collision off, `TerminateRBPhys`;
    - the victim removed from the tick notifies (no history or resim) and detached from its controller.
  - There is no position snap of the victim. The attacker gets no special handling: the next resim from the ack frame
    runs without the victim, and SyncError smooths it.
  - The demolish rides the victim car's **next regular net update**: no forced update was found in the demolish path.
  - [dec/scr], high (timing part [inf], medium).
- **NET-5 (cadence, correction to the audit).** Cars are **not** forced into every update near the ball.
  - `ForceNetPacketIfNearBall` (FUN_140eed780) is called only from the car components' impulse code (jump start,
    double jump, dodge and others; FUN_140eb9160 etc.). It forces the next update when a car applies an impulse
    within 1000 uu of a ball.
  - Otherwise cars use NetUpdateFrequency 15 and the ball 100 (Actor default). Each actor is considered at
    `now + 1/NUF + U(0, server tick)`.
  - Each connection is updated at `(0.5 + U)/ReplicationRate` (FUN_1407512c0).
  - [dec/cdo], high. Effective rates at a 57 Hz server ≈ 12/s per car and ≈ 35/s for the ball [sim].
- **NET-6 (N-9).** The game ack: the server's `PendingAdjustment.TimeStamp = PrimaryClient.LastPacketTimestamp` every
  physics tick (FUN_140f214e0).
  - So every `ClientAckFrame` repeats the newest received packet's timestamp.
  - The client drops pending frames with `TimeStamp ≤ ack`, i.e. once **received**.
  - Before each send the client trims its pending list to the newest 10. Older frames are dropped for good.
  - [dec/scr], high.
- **NET-7 (N-10).** `ReplicatedPhysicsFrame = ack > 0 ? max(ack, PhysicsFrame − 119) : PhysicsFrame`
  (FUN_140f643f0).
  - A stale state is written into the oldest history frame and resimmed.
  - A state at or ahead of the client's frame is applied directly (FUN_140f4bac0: SyncError + OldRBState shift), with
    no resim and no renumbering of the client's frames.
  - [dec], high.
- **NET-8 (wire, server→client).** Size of the state:
  - `ReplicatedRBState` = sleep bit + packed location ×100 + 56-bit quaternion + (if awake) packed velocity ×100 +
    packed angular velocity ×10000. The bit formula matches all 285k replay states exactly [rep].
  - Car: mean **229.6 bits (28.7 B)**, max 242; ball 235.2.
  - With the property header and the replicated inputs, a car update is ≈ 33–37 B, against **322–430 B** in the clone.
    The game sends no wheel state, timers, controls or inertia.
  - [dec/rep], high.

### C-6: sub-frame taps (continues controls-audit C-6 and client-loop-timing LT-4/LT-5)

| # | What | Game (live) | Ours | Rule / suggestion | Conf. |
|---|---|---|---|---|---|
| C-6a | Sampling vs ticks | Button commands (`ToggleJump/Boost/Handbrake`, `Button bRoll`, ball-cam press/release) run at key-event time in `UWindowsClient::Tick`, before `PlayerTick` and the substeps [dec, LT-1]. PlayerMove writes `PC.VehicleInput` (0x9c0, 36 B) once per frame. Each substep (FUN_140f30970, non-resim only) calls FUN_140f215f0, which copies it into the car and records the input frame. All n = 0–5 ticks of a frame get the same axes and button states, with two exceptions: the jump latch, and `bActivateBoost` = `bHoldingBoost && Boost.CurrentBoostAmount > 0`, recomputed per tick from the car's boost component (+0x338) | `freeplay.ts`/`online.ts`: same | none (done) | high |
| C-6b | Jump tap | `ToggleJump(true)`: `bJumpPressed = bJump = true; bJumped = true` (TA:77030). FUN_140f215f0 builds the tick's input with bJump (bit 1) = bJump ‖ bJumped (bit 4), clears PC.bJumped (mask 0xffffffeb), and keeps bit 4 in the recorded copy. Press and release in one frame give exactly **1 tick**, the first tick that frame runs, or the first tick of a later frame if this one has 0 ticks. A press and release in consecutive frames give all n ticks of the press frame (≥ 1). The jump component then enforces its minimum time | `JumpLatch` (`mapping.ts:184-198`), `online.ts:279` | none (done) | high |
| C-6c | Boost / powerslide / air roll taps | Press and release in one frame: the state after the last event is false at tick time, so **lost**. In consecutive frames: n ticks of the press frame. Pad: one XInput poll per frame, edges between polls; a press shorter than the poll interval is invisible | `ButtonLatch` (`mapping.ts:147-181`) | none (done) | high |
| C-6d | Ball cam | **Toggle** (pad default): each press toggles (`SetUsingSecondaryCamera(!current)`), so a sub-frame tap still toggles. **Hold** (KBM Modern default): press sets it; release clears it **unless the camera is transitioning into LookAtBall** (`ReleaseSecondaryCamera`, TA:76995). A release during the blend-in is ignored and ball cam stays on until the next press and release. Press and release in the same frame: the transition has not started yet (camera updates after the ticks) [inf], so the release applies and the tap is lost | `readHeldActions` keeps a tap as held for one frame (`mapping.ts:227-236`) | hold mode: ignore a release while the ball-cam blend is in progress (C-8); a same-frame tap does nothing | medium |
| C-6e | On the wire (client → server) | One input frame per tick (44 B in memory: VehicleInputs 36, Frame, TimeStamp). The tap is in exactly one frame as bJump = 1. Packets: see N-9a/b. A frame is resent in every packet until acked or pushed out of the newest 10. It is lost only if every packet carrying it is lost: at ≤ 24 fps (5 new frames/packet) **2 packets**; 30 fps 2–3; ≥ 60 fps up to 5 (≈ ceil(RTT·60) before the ack). Late frames are never dropped by the server unless ≤ the last consumed frame; the cap is 60 | sends frames after the last *consumed* frame, newest 10 | same loss bound; see N-9 | high |
| C-6f | Server consume of a tap | Consume (FUN_140ebb410) copies the frame to `PC.VehicleInput` and fires `Car.SetVehicleInput(frame)` through ProcessEvent (FUN_140f24460). The script detects `Input.bJump` edges then and there (`OnJumpPressed` → `JumpComponent.Activate`, or dodge / double jump with *this* frame's DodgeForward/Right; `OnJumpReleased` → `bDeactivate`; TA:20422-20460). **Over-buffer double consume** (FUN_140f23c10): frame A's edges fire, then frame B's; the step uses B's axes, boost and handbrake. So a 1-tick jump tap in A still jumps, but a 1-tick boost or handbrake tap in A is lost (game behaviour). **Under-buffer tick:** the previous input repeats with no new edge. A tap's bJump repeated over k empty ticks holds the jump k + 1 ticks, which stays inside the minimum jump time for k ≤ 2 (RocketSim's 0.025 s = 3 ticks; the game's minimum was not re-checked here) | `input_buffer.rs`: `consume_one()` twice keeps only B's controls, so the tick sees B.jump and **A's jump press (or a release+press) is lost** | Fix: on a double consume, if prev→A rises and A→B falls, set jump = true for this tick. If A falls and B rises, make the tick see a fresh press (lastControls.jump = false, jump = true). Optionally use A's pitch/yaw/roll for the dodge direction when A holds the press. Test: frames A{jump}, B{} consumed in one tick → the server car jumps; A{}, B{jump} after a held jump in the air → dodge | high |
| C-6g | bJumped on the wire | Not serialized (FUN_140f16fe0 sends bits 1, 2, 3, 0, 5, 6 and bAirRoll). bJump already contains the latch | the protocol sends the latched jump bit | none | high |

### N-4: server-confirmed demolitions

| # | What | Game (live) | Ours | Rule / suggestion | Conf. |
|---|---|---|---|---|---|
| N-4a | Client prediction | Collision events are collected after the Bullet step (FUN_140eddaa0) and dispatched to `Car_TA.OnRigidBodyCollision` → `ApplyCarImpactForces(OtherCar)` on every machine (TA:20160). The demolish branches need `Role == ROLE_Authority` (TA:20293 [0000], [02a0]). A client falls through to `BumpCar` if `OtherCar != LastHitCar ‖ PhysicsTime > LastHitTime + BumpInterval`. The bump impulse goes to the victim (`AddBumpImpulse`, applied to the next step). The attacker gets only the solver's contact response. Only the car approaching faster bumps (returns 2/3 otherwise) | `world.setDemolitions(false)` (`online.ts:184`, `bindings.cpp:253`) | same (RV-112) | high |
| N-4b | Server | `ShouldDemolish` → `OtherCar.Demolish(self)` (returns before `BumpCar`, so no bump impulse). `Demolish` fills `ReplicatedDemolishExtended {Attacker, AttackerPRI, AttackerVelocity = attacker.OldRBState.LinearVelocity, Victim, VictimVelocity}` and calls `QueueDemolish`. Inside the physics frame, `FinishDemo` is deferred to `EventPostPhysicsStep` (end of the same tick). The contact between the two cars was already solved in that step, so the attacker keeps the normal car–car contact response of that one tick and no bump | engine demolition on the server | same | high |
| N-4c | Client on the replicated demolish | `ReplicatedEvent('ReplicatedDemolishExtended')` → `QueueDemolish` → `FinishDemo` at once (not in a physics frame during TickDispatch) (TA:20622, decoded tail):<br>• `SetTimer(5, DemolishDestroyTimer)`;<br>• explosion `SpawnInstance(Location, Rotation)` at the victim's **current actor location**, i.e. its last drawn pose (lerp + SyncError);<br>• local victim: `SetViewTarget` + `Camera_TA.Demolished(Attacker)`;<br>• PitchTek decal at `Victim.Location`;<br>• `DemolishedCar_TA` stat object;<br>• `SetPhysics(PHYS_None)`, `SetHidden(true)`, `SetCollision(false, false)`, `TerminateRBPhys()`, `CollisionComponent = None`;<br>• detach VehicleSim, mesh, audio and nameplate; `ClearFX()`;<br>• `GameEvent.OnReplicatedDemolish`, `RemoveCar`;<br>• `EngineShare.SetTickNotify(self, false)` (out of history and resim);<br>• `DetachFromController()`.<br>The victim is **not snapped** to the server position: it vanishes wherever it is drawn | `ServerDemolitions` + Demo event: effect and shake at the victim's **recorded pose at the server's demo tick** (`online.ts:488-499`, RV-47); hidden from that frame; the body stays in the predicted world until a server state with `isDemoed` arrives | Fidelity: put the explosion at the victim's drawn position when the demolish is received, not at the recorded tick's pose. Take the victim out of the client's prediction (no collisions, no resim) at receipt | high |
| N-4d | Attacker reconciliation | Nothing special. The packet's ack sets `ReplicatedPhysicsFrame`. The received states mark it dirty and every predicted body is resimmed from there, now **without** the victim (removed at receipt). Frames before RPF keep the predicted contact. The correction glides with SyncError (location ×(1 − min(4·dt, 1)) per frame, angle ×5, snap 0.1 uu² / 0.001 rad). The attacker's own state may come in a different packet (cars replicate independently) | resim + SyncError (N-1) | same | high |
| N-4e | Timing | The predicted bump shows for: uplink + server input buffer (jitter buffer, ≥ 7 frames ≈ 58 ms) + **wait for the victim car's next net update** (`ReplicatedDemolishExtended` is a car property; cars are considered at 1/15 s + U(0, tick); nothing in Demolish / QueueDemolish / FinishDemo / RemoveCar forces an update) + downlink. That is ≈ RTT + 58 ms + 0–85 ms (mean ≈ 40 ms) | Demo event sent at once on the reliable stream; state at the next update | Fidelity would add the car's next-update delay; feel favours ours. A product decision | medium [inf for "no forced update": the `EventReplicatedDemolish` delegate's subscribers were not checked] |

### N-9: input packets, redundancy, acks

| # | What | Game (live) | Ours | Rule | Conf. |
|---|---|---|---|---|---|
| N-9a | Recording | Per non-resim tick (FUN_140f215f0, from FUN_140f30970 for local players): append `{Inputs (36 B), Frame = PhysicsFrame, TimeStamp = WorldInfo.RealTimeSeconds}` (+0x554 = this render frame's real time) to `ClientInputData.InputFrames` (Role < Authority only) | per tick | same | high |
| N-9b | Send schedule | `ClientTick` runs once per render frame **after** the substeps (FUN_140f54bd0, InputBuffers vtbl+0x6b0):<br>• `T += DeltaSeconds / TimeDilation`;<br>• if T < 1/InputRate (60 → 16.67 ms): no packet;<br>• else T = clamp(T − 1/InputRate, 0, 1/InputRate) and send one packet (TA:70977).<br>So at < 60 fps every frame sends; at > 60 fps the average is 60/s, never two in one frame. No packet when nothing is pending | `SendClock` (`cameraInput.ts:75`) | same (done) | high |
| N-9c | Packet content and redundancy | `ClientSendPacket` (TA:70994):<br>• if pending > `MaxInputFramesPerPacket` (10 = `NetworkConfig_TA.MaxClientUploadFrames`; STS: min(ReplicatedInputBufferSize + 2, 30)), **remove the oldest permanently**;<br>• send `{TimeStamp = RealTimeSeconds, CameraLoc/Rot = GetPlayerViewPoint, Frames = all pending}` as the unreliable RPC `ServerReceivePacket`;<br>• `SendPendingRPCs` flushes it at once.<br>Each frame rides every packet until acked: 2 per packet at ≥ 60 fps (≤ 5 packets), 4 at 30 fps (2–3 packets), 5 at ≤ 24 fps (2 packets) | newest 10 after the last *consumed* frame (`online.ts:368-376`) | Keep the newest 10. Drop frames once *received* (N-9e). `Update.receivedFrame` already carries it | high |
| N-9d | Wire format (FUN_140f16fe0, `ClientPacketData` custom serializer; FUN_140ed4120 axis) | Fields in order:<br>• `TimeStamp` f32 (32);<br>• CameraLoc: packed int vector, 1 uu (4–5 + 3·(B+2) bits);<br>• CameraRot: 3 × (1 bit + byte if nonzero), rotator >> 8;<br>• count: `SerializeInt(n, MaxUploadedClientFrames + 1 = 31)` (≤ 5 bits);<br>• if n > 0, first frame number (32); frame i = first + i.<br>Per frame:<br>• 1 bit "differs from the previous frame in the packet" (the first is compared with a zero input; axes \|Δ\| ≥ 1e-8 or any of the 7 bits). If 0, a copy of the previous frame;<br>• if 1, 7 axes (Throttle, Steer, Pitch, Yaw, Roll, DodgeForward, DodgeRight), each as 1 bit (\|v\| ≥ 1e-8) + if set a byte round_half_up(q + 128), q = v·127 (v ≥ 0, ≤ 127) or v·128 (≥ −128), read back (b − 128)/127 or /128 (the `SetVehicleInput` quantisation);<br>• then bJump, bActivateBoost, bHoldingBoost, bHandbrake, bGrab, bButtonMash, bAirRoll (7 bits).<br>Not sent: bJumped, per-frame timestamps (zero on the server).<br>A frame is 1 bit (unchanged) up to 71 bits | 7 B per frame (6 axis bytes + bits), u32 timestamp, u32 first frame, u8 count | info; ours is ≈ 2× larger and has no camera (not needed) | high |
| N-9e | Server receive | `ReceiveClientPacket`:<br>• newer timestamp only: camera, `LastPacketTimestamp`, `CurrentTimeStamp`, jitter-buffer sample (primary client);<br>• frames from every packet: `MergeFrames` (sorted, no duplicates), trim ≤ `LastProcessedReceivedFrame` (the last *consumed*), cap 60 (oldest out) | same | same | high |
| N-9f | Ack | Every server physics tick (FUN_140f214e0, Authority): ServerConsume (vtbl+0x6a8), then **`PrimaryClient.PC.PendingAdjustment.TimeStamp = PrimaryClient.LastPacketTimestamp`** (store at 0x140f21557). Per connection update (FUN_1407512c0, before that connection's actor replication), the PC event `SendClientAdjustment` (called while TimeStamp ≠ 0) → `SendClientAck(TimeStamp)` → unreliable `ClientAckFrame(TimeStamp, LastProcessedFrame, Stats)`, then TimeStamp = −1. The next tick rewrites it, so the ack **repeats the newest received timestamp**; −1 only when no physics tick ran in between | `Update.ackFrame/receivedFrame/echoTimestamp/echoDelay` per update | same idea; ours also echoes the hold time | high |
| N-9g | Client on ack | `ClientAckFrame` (TA:71042):<br>• TimeStamp ≥ 0: ping sample one frame later, `max(RealTime − TimeStamp − (RealDelta + 0.016)/2, 0)`;<br>• `EngineShare.UpdateReplicatedPhysicsFrame(ackFrame)` (N-10a), stats graph;<br>• for each local client: if TimeStamp > its `LastPacketTimestamp`, set it and **drop pending frames with TimeStamp ≤ ack**. Every frame recorded at or before that packet's frame was in it or already trimmed, so this means "received" | `#ackFrame = max(…, ackFrame)` (consumed) | Use `receivedFrame` (or the echoed timestamp) to drop pending frames | high |
| N-9h | Connection update rate | `NextUpdateTime = now + (0.5 + U[0,1))/ReplicationRate − min(max(now − NextUpdateTime, 0), 1/Rate)` (FUN_1407512c0 lines 362-379). ReplicationRate is the client's `NetRepRate` (Net_High 60, clamped to TcpNetDriver Min/Max, sent as control message 42; FUN_140b9d510). The server frame rate is ≤ 57 (`ServerConfig_X.NetServerMaxTickRate` 57, idle 20 [cdo]). So the ack and updates go out in ≈ 55 of 57 server frames [sim] | 60 Hz fixed (every 2 ticks) | info | high (57 Hz: [cdo], runtime override possible) |

### N-10: acks outside the history, client behind

| # | What | Game (live) | Ours | Rule | Conf. |
|---|---|---|---|---|---|
| N-10a | ReplicatedPhysicsFrame | FUN_140f643f0: RPF = (ack > 0) ? **max(ack, PhysicsFrame − MaxClientReplayFrames + 1)** : PhysicsFrame. MaxClientReplayFrames = 120, so the clamp is PF − 119, the oldest entry of a 120-frame history (ring size from notes/netcode.md, not re-decoded). A pending flag (EngineShare+0x170 bit 0x20) also dirties RPF here if RPF < PF | — | — | high |
| N-10b | Stale ack (older than the history) | The received state is written into history at the clamped RPF and is "different" (bUseNEQ off), so DirtyPhysicsFrame = RPF and 119 frames are resimmed **from a state that is really older**. Smoothed like any correction | `predictor.ts:133-138` ignores it (`ignoredOld`) | Match: apply it at the oldest frame and resim (or keep ignoring; it only happens with > 1 s of lag) | high |
| N-10c | Client behind (ack ≥ PF) | FUN_140f1eb20: if the body has a rigid body, bNewData is set and **PF ≤ RPF**, direct apply FUN_140f4bac0:<br>• pre = current; set the state;<br>• if LastRenderTime > 0 and !bSkipNextErrorAccumulation, SyncError += pre − new (FUN_140eaffe0);<br>• OldRBState loc / vel / angvel += new − pre, Old.q = (new.q ⊗ pre.q⁻¹) ⊗ Old.q.<br>History is not dirtied (only RPF < PF is), so no resim. **PhysicsFrame is not changed**: the client keeps its numbering. The server's acks drop back when it consumes the client's next frames (Consume sets LastProcessedFrame = frame; empty ticks only advanced it). Non-predicted bodies apply the same way on the next PreAsyncTick (FUN_140f1fa20 / FUN_140f1fab0) | `#resync`: jump the frame counter to the ack, wipe the history (`predictor.ts:196-210`); smoothed (NR-5) | Optional: apply directly and keep the frame numbering. Ours also works with the server (its trim uses the last *consumed* frame) | high |
| N-10d | Correction constants (unchanged from N-1) | LocationFixRate 4 /s, AngularFixRate 5 /s, snap \|e\|² < 0.1 uu², angle < 0.001 rad. Every received state dirties (bUseNEQ off; with it: 5 uu, 100 rotation units, 10 uu/s, sleep). Remote input fade 0.1 s (12 frames), throttle/steer/pitch/yaw/roll faded, handbrake copied | same | — | high |

### Wire size of the car state (server → client)

`ReplicatedRBState` net serializer FUN_140e3ff20 (live; versioned by the archive's net version; live replays are
version 10). The bits are verified against the replays: the formula below gives the measured payload of **every one of
the 285,157 RB updates** in the sample. Packed int vector (FUN_140386e40):
`B = clamp(ceil_log2(1 + max|c|), 1, 22) − 1`, then `SerializeInt(B, 22)` (5 bits if (B & 15) < 6, else 4) and
3 × (B + 2) bits, each `c + 2^(B+1)`.

| Field | Encoding | Bits (car, mean / typical) | Bits (ball) | Ours (`NetState.cpp`) |
|---|---|---|---|---|
| bSleeping | 1 bit (flags bit 0) | 1 | 1 | activation byte + deactivation f32 (40) |
| Location | ×100, round half up (FUN_140386fc0), packed | 63.5 (20 bits/comp in 65 %) | 63.8 | 3 × f32 (96) |
| Rotation | smallest-three: index `SerializeInt(·,4)` 2 + 3 × 18 (FUN_1403867d0) | 56 | 56 | 7 B packed (56) + valid byte (8) |
| Linear velocity (awake only) | ×100, truncate; read +sign·0.1/100 (FUN_140387090), packed | 60.1 (19 bits/comp in 57 %) | 60.2 | 3 × f32 (96) |
| Angular velocity (awake only) | ×10000, truncate; read +sign·0.1/10000, packed | 49.0 | 54.2 | 3 × f32 (96) |
| Replicated frame | not in the struct: every state in a packet is at the ack's frame (`ClientAckFrame` InClientFrame, int, in the same packet, sent first) | (ack ≈ 14 B per packet: f32 + int + 5 stat bytes + send bits [inf]) | | `ackFrame` u32 in the 25 B update header |
| Time, bNewData | not sent | 0 | 0 | — |
| Inverse inertia | not sent | 0 | 0 | 9 × f32 (288) |
| **RB total (awake)** | | **229.6 mean, 233 median, 242 max (28.7 B)** | 235.2 (29.4 B) | 85 B |
| RB total (sleeping) | | 120.6 | 114.4 | 85 B |
| Property header | RepIndex for Car_TA / Ball_TA (replay stream: 1 present + 6 id) | 7 | 7 | — |
| Remote inputs | `ReplicatedThrottle`, `ReplicatedSteer` (byte each), `bReplicatedHandbrake` (bit); only when changed and only to **non-owners** (`RemoteRole == SimulatedProxy`) | +0–31; mean 14 [rep] | — | controls + lastControls (42–50 B) to everyone |
| Car gameplay state | not in the car: components are separate actors (`ReplicatedActive` byte, `ReplicatedActivityTime`, `DodgeTorque`, `ReplicatedBoost` / amount byte to non-owners, NUF 30); boost to the owner by RPC | — | — | flags 4, 14 floats, wheels 96, normals 0–48, ball hit 52, misc 7–23 (≈ 230–330 B) |
| Actor framing | UE3 bunch header ≈ 26 bits [inf] (replay record: 15) | ≈ 26 | ≈ 26 | car id u32 |
| **Per car update** | | **≈ 33–37 B** (owner ≈ 33) | ball ≈ 34 B | **322–430 B** (ground + 4 normals ≈ 370; + ball hit 52) |
| Update rate | NUF 15, considered at now + 1/15 + U(0, 1/57) → **≈ 12/s per client** [sim]; forced on jump / double-jump / dodge impulses within 1000 uu of a ball, flip resets, teleports, `SetAllDriving(true)` | | ball NUF 100 → **≈ 35/s** [sim]; forced on every car hit (`Ball.ForceNetUpdatePacket`) | ball 60/s; cars within 1000 uu 60/s, others 15/s; pads 15/s |
| Relevancy / priority | RBActor_TA bAlwaysRelevant; NetPriority car 6, ball 10, components 5; NetSpeed 15000 B/s (Net_High) only matters when saturated | | | all to all |
| **Per client per second (3v3)** | cars 6 × 12 × 35 ≈ 2.4 KB; ball 35 × 34 ≈ 1.2 KB; acks 55 × ~18 ≈ 1.0 KB; UDP/IP + packet header ≈ 1.8 KB; components < 0.5 KB → **≈ 6.5 KB/s** (≈ 120 B/packet) [sim/inf] | | | 2v2 ≈ 45–60 KB/s (ball 121 B and car 370 B at the README rates) |

Client → server, per input packet: about 143 bits of fixed fields plus per frame 1 bit (repeat) to ≈ 40–71 bits
(changed). At 60 fps with ≈ 6 pending frames, half of them repeats, that is ≈ 35 B plus RPC and bunch header and
UDP/IP. Ours: 10 + 7·n B.

The replay sample shows car RB updates every 2–3 recorded frames at 30 fps (gap 1: 15 %, 2: 53 %, 3: 32 %; mean
≈ 13.8 Hz). There is no near-ball dependence (gap-1 share 0.150 at ≤ 500 uu vs 0.139 beyond 3000 uu), which agrees
with NUF 15. The ball updates every frame (97.5 %). These replays are recorded on clients, so they cannot show the
server-only forcing (FUN_140eed780 needs NetMode 1 or 2).

### Corrections

**controls-audit.md**
- C-6 is settled by C-6a–g above. Add the server side: a jump tap survives a double consume in the game, but not in
  ours (C-6f). Boost and handbrake taps inside one frame are lost (done), and a 1-tick boost or handbrake in the first
  frame of a double consume is lost on the game's server too.
- C-8 (ball-cam hold): a release during the blend into LookAtBall is ignored, so a short tap can leave ball cam on. A
  same-frame tap does nothing.
- "input sampled once per render frame and applied to each physics tick of that frame": true, except the jump latch
  (first tick) and bActivateBoost (per tick, needs boost > 0).
- Live PC flags `bJumpPressed / bBoostPressed / bHandbrakePressed` (0x9e4) mirror the press state in the Toggle
  commands (TA:77030). They don't feed the physics.

**netcode-audit.md**
- "cars NetUpdateFrequency 15, **forced within 1000 uu of the ball**" (Confirmed same, and Parameters
  "Force update near ball"): wrong. `ForceNetPacketIfNearBall` (FUN_140eed780) runs only from the component impulse
  code (FUN_140eb9160 Jump at ActiveTime 0, FUN_140eb8f20, FUN_140eb75a0, FUN_140eb70e0, FUN_140eb71d0, FUN_140eb6a30,
  FUN_140eb8630). It forces the *next* consideration when that car is within `ForcePacketSignificantDistance`
  (1000 uu) of a `Ball_TA`, on a server (NetMode 1 or 2). Our server's "cars near the ball every update" is more than
  the game sends.
- "ball 100, always relevant, forced after hits": the ball is *considered* at now + 1/100 + U(0, 1/57), i.e. every 1–2
  server frames (≈ 35/s), not every frame.
- "replication rates (net tick ≤ 57 Hz)": add per-connection gating `(0.5 + U)/ReplicationRate`. An actor considered
  in a frame where the connection isn't due waits for its next consideration [dec, consider-list per ready
  connection].
- N-3 "~250 B per update": the RB state is 28.7 B per car (mean), ≈ 33–37 B per car update with framing; ≈ 6.5 KB/s
  per client in 3v3.
- N-9: the ack timestamp is re-armed every server tick from `LastPacketTimestamp` (FUN_140f214e0), not only when a
  packet arrives. The client's pending list is trimmed to the newest 10 before each send (older frames are never
  resent). The input packet is delta-coded (N-9d).
- N-10: confirmed and extended (N-10a–c). With the 120-entry history the clamp to PF − 119 finds the oldest entry
  (FUN_140f1eb20 checks `frames[RPF % size] == RPF`).
- "Open: ack-before-state order in a packet (UE3 assumption)": settled. `SendClientAdjustment` is called per
  connection before that connection's actor replication in FUN_1407512c0.
- N-4: the client explodes the victim at its current drawn location and removes it from prediction at receipt
  (N-4c). There is no forced net update on demolish.

### Rules for the client and server (implementable)

1. **Per frame (client):** process events, then sample axes, then run the ticks (≤ 5, keep fmod), then ClientTick.
   Per tick: jump = held ‖ latch (clear the latch), bActivateBoost = holding ∧ boost > 0, record the frame. Done.
2. **Send:** `T += dt_undilated`. If T ≥ 1/60: `T = clamp(T − 1/60, 0, 1/60)`, pending = newest 10 (drop older for
   good), send all pending with `timestamp = now`. Done, except "drop older for good".
3. **On ack:** drop pending frames whose recording time ≤ the echoed timestamp, i.e. received (`receivedFrame`), not
   consumed. **To do.**
4. **Server tick:** consume per ServerConsume. On a double consume apply both frames' jump edges (C-6f). **To do (a
   bug).** Set the ack timestamp to the newest received packet every tick.
5. **Correction frame:** RPF = ack > 0 ? max(ack, PF − 119) : PF. If RPF < PF: write history at RPF, resim, smooth.
   If RPF ≥ PF: apply directly with SyncError and shift the previous tick; keep the frame number. Optional.
6. **Demolish on clients:** predict a bump. On the server's demolish: explode at the drawn position, hide the car,
   remove it from prediction and resim, switch the camera if it's the local car. The attacker is corrected normally.
   Explosion position: **to do** (ours uses the recorded pose at the server tick).
7. **Cadence (fidelity option):** cars at 15 Hz nominal (+ U(0, tick)), forced on jump / double-jump / dodge impulses
   within 1000 uu of the ball; ball at 100 Hz nominal, forced on car hits. Ours sends more, which is better for
   prediction. Product decision.

### Open
- Whether a subscriber of `GameEvent.EventReplicatedDemolish` (or RL native code) forces the victim's net update
  (N-4e timing).
- The setter of EngineShare+0x170 bit 0x20 (deferred dirtying in FUN_140f643f0), probably states received before the
  ack.
- UE3 bunch and packet framing in RL (≈ 26-bit bunch header, 14-bit packet id, acks, possible packet encryption) is
  not decoded; byte totals use the UE3 layout [inf].
- `NetServerMaxTickRate` 57 is a class default (`ServerConfig_X`, an online config); a live override would change the
  effective rates (at 120 Hz: cars ≈ 6.7/s, ball ≈ 27/s per client with the same gating [sim]).
- Ping: repeated ack timestamps produce stale ping samples (`UpdatePing`); PC.UpdatePing's filter not decoded.

### Live addresses
| Function | Live address |
|---|---|
| RB state net serializer / vector ×s round / vector ×s trunc / quat 18-bit / packed int vector | 0x140e3ff20 / 0x140386fc0 / 0x140387090 / 0x1403867d0 / 0x140386e40 |
| TAGame struct NetSerialize (ReplicatedRBState, ReplicatedRBStateNoQuat) / engine built-ins (Vector, Rotator, Quat, Plane, UniqueNetId) / TAGame struct NetSerialize 2 (ClientPacketData, LoadoutData, MessagePacket…) | 0x140e40180 / 0x1406b6ce0 / 0x140f17d80 |
| ClientPacketData serializer / input axis byte / camera vector / rotator | 0x140f16fe0 / 0x140ed4120 / 0x140386de0 / 0x140386cc0 |
| Per-tick input + latch + record (PC) / physics frame / EngineShare tick | 0x140f215f0 / 0x140f30970 / 0x140f54bd0 |
| Server per-tick consume dispatcher + ack timestamp / ServerConsume / Consume / SetVehicleInput event / idle-input tracker | 0x140f214e0 / 0x140f23c10 / 0x140ebb410 / 0x140f24460 / 0x140f607b0 |
| UpdateReplicatedPhysicsFrame (+exec) / RB receive (PostNetReceive) / direct apply / PreAsyncTick ball, vehicle / remote input compare | 0x140f643f0 (0x140e86e30) / 0x140f1eb20 / 0x140f4bac0 / 0x140f1fa20, 0x140f1fab0 / 0x140f64bf0 |
| Server RBActor tick (ReplicatedRBState = RBState) / ForceNetPacketIfNearBall / ForceNetUpdatePacket | 0x140f520b0 / 0x140eed780 / 0x1405a8fa0 |
| ServerTickClients (connection timer, SendClientAdjustment, actor consider) / NetRepRate command / collision collect | 0x1407512c0 / 0x140b9d510 / 0x140eddaa0 |
| FName globals: ReplicatedRBState / ReplicatedRBStateNoQuat / ClientPacketData / SendClientAdjustment | 0x1424c19f0 / 0x1424c19f8 / 0x1424c53e0 / 0x1424aaff0 |

Files: `agents/NET1/runs/b1..b10/c/*.c` (decompiles), `agents/NET1/work/repconds_net.txt` (replication conditions),
`agents/NET1/work/fname_globals.json` (FName globals → strings, 180), `agents/NET1/work/ns2v2/*.csv` (replay bits),
`agents/NET1/tools/netsize` (measuring tool).
