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
| Client input rate / frames per packet | 60 Hz (20/40/60) / ≤ 10; a per-render-frame accumulator, ≤ 1 packet a frame (PERF1, below) | PlayerController_TA; NetworkConfig_TA.MaxClientUploadFrames |
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
TcpNetDriver rate defaults (60 / 15000 from the user's log; the per-connection throttle now decoded: "Packet framing"
below); client roles
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

### Packet loss as the game counts it (RV-1154, WHEEL1, 2026-10-24)
- **In:** `UNetConnection::ReceivedPacket` (0x140ba5ea0): `id = MakeRelative(ReadInt(0x4000), InPacketId, 0x4000)`; a
  newer id adds `id − InPacketId − 1` to InPacketsLost (+0x35c; the driver's +0x188) at once and becomes InPacketId; an
  older one is still processed, counted out of order (+0x364), never taken off the lost count; no reorder window (RL's
  addition: with a flag at +0x1030, a 30-slot window drops packets more than 30 behind and exact duplicates).
- **Out:** UE3's virtual NAKs: a newer ack (`OutAckPacketId` +0x1028) NAKs each skipped id (ReceivedNak 0x140ba5da0)
  and counts it in OutPacketsLost (+0x360); a later older ack ignored; the peer acks every packet twice (SendAck
  0x140ba9100, PurgeAcks 0x140ba1790), so one lost return doesn't count, two in a row do.
- **The HUD's rows** (`NetStatGraph_TA.Construct`, TA 70878; fed once a second from the connection's Tick, 0x140bad250,
  FUN_140f1f6e0): Out Loss is the client's own OutPacketsLost (from the server's ack gaps), In Loss its InPacketsLost;
  counts per second. The connection-quality percentage (`ClientConnectionTracker_TA.ComputeRollingPacketLossPercent`,
  TA 567) is both directions' lost over both directions' packets, measured at the client.
- **Carball counts the same way** (`InputBuffer::note_sequence`: a gap past the newest counted at once, a late one
  not taken back), so reordering counted as loss is the game's too. Differences, kept: Carball's Out Loss is the
  server's input-datagram gaps reported back, the game's the client's ack gaps (the same on a normal path); a jump of
  1000 or more is taken as the client's count starting again, where the game's 14-bit ids count any gap within ±8192.

### Open
- ~~Whether anything forces the victim's net update on a demolish (N-4e)~~: **settled, nothing does** (see
  "Correction smoothing (live build)" → N-4e).
- The setter of EngineShare+0x170 bit 0x20 (deferred dirtying in FUN_140f643f0), probably states received before the
  ack.
- ~~UE3 bunch and packet framing in RL~~: **the packet framing is decoded** ("Packet framing" below: 512 B packets, a
  14-bit packet id, acks sent twice, one datagram per connection a tick, encryption when set); still inferred: the bunch
  header (≈ 26 bits [inf]), the cipher's overhead, KeepAliveTime (UE3's 0.2 s [inf]); byte totals keep the UE3 bunch
  layout.
- `NetServerMaxTickRate` 57 is a class default (`ServerConfig_X`, an online config); a live override would change the
  effective rates (at 120 Hz: cars ≈ 6.7/s, ball ≈ 27/s per client with the same gating [sim]).
- Ping: repeated ack timestamps produce stale ping samples (`UpdatePing`); **PC.UpdatePing's filter: settled** (see
  "Correction smoothing (live build)" → Ping filter).

### Packet framing and the client's input rate (PERF1 item 4, WHEEL1, 2026-10-24)
Tags: [S] script (WHEEL1's dumps, the TA: lines as above), [A] class defaults, [N] native (the live build's copy), [I]
inferred.
- **The client's input packets** [S, A]: `ShouldSendClientMovePackets` (TA 70977), run from `ClientTick` once a render
  frame: `T += dt / TimeDilation; if T ≥ 1/rate { T = clamp(T − 1/rate, 0, 1/rate); send }`, so at most one packet a
  frame (every 2–3 frames at 144 fps, every 4th–5th at 240, every frame under 60). `Default__PlayerController_TA`:
  Min/Median/Max 20/40/60, configured 60 (Net_High, `NetworkSave_TA`, TA 71206–71215), client-side only. At 120 Hz
  physics, about 2 new frames a packet.
- **Batching and redundancy** [S, A]: `ClientSendPacket` (TA 70994) drops the oldest frames past
  `MaxInputFramesPerPacket` = `NetworkConfig_TA.MaxClientUploadFrames` 10 (online-overridable; under STS
  min(ReplicatedInputBufferSize + 2, 30)) and sends every pending frame, the camera and `RealTimeSeconds` as the
  unreliable `ServerReceivePacket`, then `SendPendingRPCs`. `ClientAckFrame` (TA 71042) drops frames once the server has
  received them (by the ack's timestamp): a frame rides every packet until acked, ≈ RTT·120 + 2 frames (10 from ~70 ms).
- **Encoding** [N] (FUN_140f16fe0 / FUN_140ed4120, as N-9d): a fixed ≈ 143 bits (TimeStamp 32, the camera's packed
  vector and rotator, the frame count via SerializeInt max 31, the first frame's number 32), then per frame a "changed"
  bit and, if changed, 7 axes (a bit and an optional byte each) and 7 buttons: 1–71 bits a frame.
- **Server → client** [A, N]: ≤ 57 server frames a second (`ServerConfig_X.NetServerMaxTickRate` 57, idle 20); per
  connection a timer `(0.5 + U)/ReplicationRate` (NetRepRate 60 at Net_High): ≈ 55 datagrams a second with the ack RPC,
  then the actors (ball ≈ 35/s, car ≈ 13.4/s, N-9h).
- **Packets** [N]: MaxPacket 0x200 (512 B) and PacketOverhead 0x2e (46 B), TcpipConnection InitConnection
  (0x140c1ec00), stored at +0x184 by the base (0x140b9fc10); the default when a caller passes 0, the value in use
  inferred. PreSend (0x140ba1270) flushes before an item that wouldn't fit, so a large tick splits into several
  datagrams.
- **Header** [N]: an optional 3-byte prefix (flag +0xb1dc, a session id [I]), then `WriteInt(OutPacketId, 0x4000)`: a
  14-bit packet id.
- **Acks** [N] (SendAck 0x140ba9100): a bit and the 14-bit id, piggybacked on the next outgoing packet and sent twice
  (QueuedAcks → ResendAcks, PurgeAcks 0x140ba1790); not TimeSensitive, so a client's ride its 60 Hz input packets (the
  receive side not checked).
- **Flush** [N]: the connection's Tick (0x140bad250) flushes once a tick if TimeSensitive or past KeepAliveTime;
  FlushNet (0x140b9e320) adds the end bit and padding, encrypts through `NetConnectionEncryptor` when one is set
  (FUN_14051a6a0), and sends: one tick's traffic a connection shares one datagram, split only past 512 B.
- **Throttle** [N]: QueuedBytes (+0x200) decays by CurrentNetSpeed bytes a second, floored at −NetSpeed/4; NetSpeed
  15000 B/s at Net_High (the user's log; TcpNetDriver's values config only).
- **Against Carball** (nothing new to change): the same 120 Hz tick (game.rs), 60 packets a second on a per-frame
  accumulator, ≤ 1 a frame (`SendClock`, cameraInput.ts; online.ts), ≤ 10 frames with the oldest dropped (protocol.ts,
  session.ts), the actors' cadence (replication.rs), acks equivalent (ackFrame / receivedFrame / echo; packet acks by
  QUIC). Known and kept: resends dropped once consumed rather than received (G12), frames a fixed 7 B and a 12 B header
  rather than delta bits (N-9d), server → client a fixed 60/s rather than ≈ 55 jittered, 1100 B parts rather than 512,
  QUIC's congestion control rather than a 15 KB/s throttle, QUIC's TLS rather than NetConnectionEncryptor; no 20/40 Hz
  option.

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

## Correction smoothing (live build)

Static analysis of the **live build (2026-10-06)** by sub-agent CS1 (2026-10-14). The decompiles were made in a copy of
out/bsim/rl-20261006 (`out/bsim/agents/CS1/rl-live`, runs `out/bsim/agents/CS1/runs/b1..b17`). Scripts are cited as TA:<line>
(`out/bsim/work/tagame_live_all.txt`). The Engine script is from `agents/K1/work/live_engine_ubc.txt`. Class defaults come from
`scripts/props.py` on `live-20261006/decrypted`. The reference model and the vector generator are in
`out/bsim/agents/CS1/scripts/cs_ref.py` (float32).

Tags: [N] native decompile, [S] script, [A] package data, [I] inferred.

Field offsets in RBActor_TA (live = old):
- 0x56c flags: 0x2 bReplayActor, 0x10 bIgnoreSyncing, 0x40 bSkipNextErrorAccumulation [A, export order].
- 0x570 NetworkSyncSettings.
- 0x590 OldRBState, 0x5d0 RBState, 0x610 ReplicatedRBState, 0x650 ClientCorrectionRBState.
- 0x6b8 SyncErrorLocation, 0x6c4 SyncErrorAngle, 0x6c8 SyncErrorAxis.
- 0x710 RBHistory, 0x750 WeldedActor, 0x758 WeldedTo.
- From Actor: 0x130 WorldInfo, 0x140 LastRenderTime [A].
- RB state layout: q (x, y, z, w), loc, linvel, angvel.

### Summary

- **The error is stored per body.**
  - Location: a vector.
  - Rotation: an angle plus a unit axis, not a quaternion.
- **When the error grows.** It grows at every correction of a body that has already been drawn:
  - after a resim (the error grows by pre − post);
  - on a direct apply when the client is behind (the error grows by pre − new).
- **How it decays.** Once per render frame, in the body's own tick, with the game-time dt:
  - k = min(dt·4, 1) for location and min(dt·5, 1) for the angle;
  - the decayed error is drawn on top of the interpolated pose (lerp / slerp of OldRBState → RBState);
  - after drawing, the error snaps to 0 when |e|² < 0.1 uu² or |angle| < 0.001 rad.
- **No size limit.** There is no large-error snap or cap.
- **Same for every body.** The local car, remote cars and the ball are smoothed the same way. No class or archetype
  overrides the rates.
- **What is drawn at once (no smoothing):**
  - new actors (kickoff, respawn, ball reset);
  - bodies whose TeleportCounter changed (only the free-play ball teleport);
  - bodies never rendered (direct apply only);
  - received states while the game is paused, for bodies with no prediction history.

### Rows

| # | Rule | Evidence (live) | Conf. |
|---|---|---|---|
| CS-1 | **Resim capture.** Before the rollback, every TickNotify body saves its current RB state into ClientCorrectionRBState. After the resim to the same PhysicsFrame:<br>• if bSkipNextErrorAccumulation is set: clear it and add nothing;<br>• else Accumulate(pre = ClientCorrectionRBState, post = current).<br>There is **no LastRenderTime gate** on this path. The dispatcher calls +0x10 when EngineShare+0x170 bit 2 (resimming) is set and +0x18 otherwise. EngineShare calls it before and after the resim loop. | Pre-correction hook 0x140f1fe20 (ITickNotify +0x10). Post-correction hooks 0x140f1b890 (RBActor/Ball) and 0x140f1b900 (Car, which also clears the "reuse contact planes" flag). Dispatcher 0x140f18520. EngineShare tick 0x140f54bd0. Vtables 0x141e8aa68 (RBActor) and 0x141e8de08 (Car) [N] | high |
| CS-2 | **Direct-apply capture** (client behind: PF ≤ RPF in the RB receive; or a body without history, in its PreAsyncTick):<br>• if bIgnoreSyncing is set, **nothing happens** (the state is not applied either);<br>• else pre = current, then SetRBState(new);<br>• if LastRenderTime > 0: if skip is set, clear it; else Accumulate(pre, new). If LastRenderTime ≤ 0: no error, and the skip flag stays set;<br>• then shift the interpolation start: Old.loc/linvel/angvel += new − pre, and Old.q = (new.q ⊗ conj(pre.q)) ⊗ Old.q (not renormalized). | Direct apply 0x140f4bac0. RB receive 0x140f1eb20. PreAsyncTick 0x140f1fa20 (ball) and 0x140f1fab0 (car) [N] | high |
| CS-3 | **Accumulate(pre, post):**<br>• SyncErrorLocation += pre.loc − post.loc;<br>• d = pre.q ⊗ conj(post.q); if d.w < 0 then d = −d; normalize (\|d\|² ≤ 1e-8 → identity);<br>• E = (axis·sin(a/2), cos(a/2)); E′ = **E ⊗ d**;<br>• store E′ as angle + axis: angle = 2·acos(clamp(w, −1, 1)); s = sqrt(max(1 − w², 0)); axis = xyz/s normalized when s ≥ 1e-4, else (1, 0, 0).<br>The composite E′ gets **no** hemisphere fix, so the stored angle is in [0, 2π]. Quaternion products are the standard Hamilton product, (x, y, z, w). The sign masks were read from .rdata: M0 (1, −1, 1, −1), M1 (1, 1, −1, −1), M2 (−1, 1, 1, −1). | 0x140eaffe0. ToAxisAndAngle 0x140389010. Mask init 0x140255050..78 ← 0x141a561d0..ff [N] | high |
| CS-4 | **Per-frame decay and draw** (physRigidBody, every PHYS_RigidBody actor, every frame). α = EngineShare.RenderAlpha (+0x1a4) = clamp(accumulator / (1/120), 0, 1) after this frame's substeps.<br>• loc = lerp(Old.loc, RB.loc, α);<br>• q = normalize(Slerp(Old.q, RB.q, α)). Slerp takes the shortest arc and falls back to a linear blend when \|cos\| ≥ 0.9999;<br>• Velocity and AngularVelocity = lerp(Old, RB, α), with no error added;<br>• if WeldedTo ≠ None: zero both errors and skip the rest (the parent places this body);<br>• else, if e ≠ 0: e −= min(dt·LocationFixRate, 1)·e; loc += e; then if \|e\|² < 0.1: e = 0;<br>• if angle ≠ 0: angle −= min(dt·AngularFixRate, 1)·angle; q = Qaxis,angle ⊗ q (the error is on the left, in the world frame); then if \|angle\| < 0.001: angle = 0;<br>• MoveActor(actor, loc − Location, Rotator(q)). The rotation goes through FRotator, which is quantised to 65536 units per turn (0.0055°). | 0x140f704b0. Slerp 0x140388840 (α in XMM3, loaded from +0x1a4 at 0x140f70574). Quat→matrix→rotator 0x14036f9c0 / 0x140385e40. MoveActor 0x14072f2f0. Called from performPhysics 0x14082a160 case 9 (vtable +0x470) [N] | high |
| CS-5 | **Constants** (RBActor_TA.NetworkSyncSettings):<br>• LocationFixRate 4, AngularFixRate 5, WeldedLerpRate 18;<br>• MinDeltaLocation 5, MinDeltaRotation 100, MinDeltaLinearVelocity 10 (bUseNEQ only, which is off);<br>• ForceReplicationDelay 0.35, bDebug false.<br>The snaps 0.1 (uu²) and 0.001 (rad) are code literals. No override in Car_TA, Ball_TA, Vehicle_TA, Archetypes.Ball.Ball_Default or Archetypes.Car.Car_Default. GameInfo_Soccar_SF.upk does not contain the name `NetworkSyncSettings` at all. | Default__RBActor_TA [A] | high |
| CS-6 | **dt is game time.** physRigidBody gets the actor tick's DeltaSeconds = real frame time × WorldInfo.TimeDilation (× DemoPlayTimeDilation in replays). The camera scripts undo the dilation (`DeltaTime /= WorldInfo.TimeDilation`, TA:14877, TA:15839). TimeDilation drops during the post-goal slow motion (`PostGoalScored.Tick`: ScoreSlomoCurve × MatchTimeDilation, TA:4272) and with game-speed mutators, so smoothing slows with them. | [S] + UE3 actor tick [I] | medium-high |
| CS-7 | **No large-error snap or cap.** Any size of correction is smoothed. The only clamp is k ≤ 1: one frame with dt ≥ 0.25 s clears the location error, and dt ≥ 0.2 s clears the angle error. A composite angle above π decays the long way round (example: 150° plus another 60° on the same axis is stored as 210°). | CS-3, CS-4 [N] | high |
| CS-8 | **Order inside a frame:**<br>1. network receive (RB receive: history write and dirty, or direct apply);<br>2. EngineShare tick: resim + CS-1, PreAsyncTick direct applies, substeps, RenderAlpha;<br>3. RBActor ticks (TickGroup TG_PostAsyncWork [A]): CS-4;<br>4. camera.<br>So the **first drawn frame after a correction already shows (1 − k)·e**. Even if the tick order were different, physRigidBody always decays before it draws. | TickGroup [A]. EngineShare tick reached only through vtable 0x141e649e0 (caller not found) [I] | medium-high |
| CS-9 | **OldRBState / RBState per step.** In the pre-step hook (0x140f21850) Old = RB = current. In the post-step hook (0x140f1ef70) RB = current. In a resim, a frame that holds a server state is snapped to it, unless bOverrideServerPhysicsState is set. Resim steps update Old too, so after a resim the drawn jump is (1 − α)·[(Old′ − Old) − (post − pre)], about 0. A direct apply leaves the drawn pose unchanged exactly (CS-2 shift). | [N] | high |
| CS-10 | **Which bodies smooth.** On a client every RBActor gets an RBHistory at RB init (0x140f1fd10: NM_Client and RBHistoryClass set). So the **local car, remote cars and the ball are all predicted and resimmed, and all are smoothed the same way**. There is no role gate in CS-1 to CS-4. bReplayActor bodies (replay playback) have no history and get direct applies. | 0x140f1fd10, 0x140f1eb20 [N] | high |
| CS-11 | **Where the smoothed pose goes:**<br>• the actor's Location and Rotation, so the mesh and every attached component (wheels, nameplate, boost, trail, Ball Arrow; see below), the attached FX actors and the camera (ViewTarget = car actor) follow it;<br>• the demolish explosion spawns at the victim's drawn Location (N-4c).<br>The wheels' suspension visuals have their own smoothing (corrected 2026-10-18, SU1) [N]:<br>• Each frame, CarMeshComponent_TA::Tick (0x140f4dbd0; wheels 0x140f664a0) moves each WheelTranslation bone's Z toward −clamp(d, SuspensionTravelMin, SuspensionTravelMax).<br>• d is how far the last physics tick's contact point (Wheel_TA.Contact.Location) plus WheelRadius·up lies below LocalRestPosition, placed by the drawn mesh's LocalToWorld. With no contact, d = Min + (Max − Min)·(up.z + 1)/2: full droop upright, Min upside down.<br>• A touching wheel whose target is higher than its current offset snaps to it. Otherwise it eases with α = min(DeltaTime·WheelSteerBlendRate (10/s), 1); WheelSuspensionBlendRate (3) is never read.<br>• Steering eases the same way (× SteerScale), and the chassis bone is a SimpleSpringComponent_TA mass-spring (ChassisSpring*).<br>So the drawn wheels follow the physics contact from the smoothed pose. The physics itself jumps to full extension in one tick with no carry-over into the landing, as ours does (SU1). Actor Velocity is the lerp only. | [N] + [I] for the components | medium-high |
| CS-12 | **Spawn, kickoff, respawn, demolish.** RB init (0x140f1fd10 and 0x140f1cd50) sets RBState from the actor pose and **OldRBState = RBState**. SyncError starts at 0. Soccar "teleports" are new actors, so nothing glides:<br>• kickoff: `ResetPlayers` = DestroyCars + RestartPlayer (TA:954);<br>• ball reset: `ResetBall` / `ResetBalls` = Destroy + SpawnNewBall (TA:3099, TA:3116);<br>• respawn: `RestartPlayer` destroys the pawn (TA:1092);<br>• goal: `DestroyBalls` + `DestroyCars` (TA:4262).<br>A demolished car is taken off the tick notifies (N-4c) and keeps its last drawn pose until destroyed. | [N] + [S] | high |
| CS-13 | **Teleports.** TeleportCounter (byte, RepNotify, `if bNetDirty`) → `SetTeleportCount` sets bSkipNextErrorAccumulation (TA:11046). Only the **next** accumulation is skipped; it is consumed by CS-1 or by CS-2 with LastRenderTime > 0. The only script writer is `FreeplayCommands_TA.ConditionalTeleportBallToCar` → `Ball.RegisterTeleport()` (TA:29882), and native code never writes the counter. | [S] + N2 [N] | high |
| CS-14 | **Paused game.** When the RB receive still has bNewData set after the history step and WorldInfo.**Pauser** ≠ None (WorldInfo+0x570, confirmed by AWorldInfo::SetPauser 0x1407355d0), the state is **hard-set**: SetRBState, **OldRBState = new**, Rotation, Velocity and AngularVelocity set, then SetLocation. There is no smoothing and the error is untouched.<br>With client prediction on (EngineShare+0x170 bit 0), predicted bodies clear bNewData first. So in online play this only reaches bodies without history. | 0x140f1eb20 [N] | high (scope: info) |
| CS-15 | **Welded bodies (WeldedLerpRate 18).** The parent's physRigidBody places its WeldedActor at the parent's drawn transform combined with the weld offset and rotation. The child's location moves toward it by min(dt·18, 1) of the gap each frame, and its rotation is set directly. The child (WeldedTo ≠ None) zeroes its own errors (CS-4). This is for welding modes (for example Spike Rush), not soccar. | 0x140f704b0 tail [N] | medium-high |

### Reference pseudo-code

```ts
// Per body: errLoc: Vec3 = 0; errAngle = 0; errAxis = (1,0,0); skipNext = false; lastRendered = false
// Quaternions (x,y,z,w), Hamilton product mul(a,b); conj(q) = (-x,-y,-z,w).

function accumulate(b, pre: RBState, post: RBState) {          // 0x140eaffe0
  b.errLoc = b.errLoc + (pre.loc - post.loc);
  let d = mul(pre.q, conj(post.q));
  if (d.w < 0) d = neg(d);
  d = (dot(d,d) <= 1e-8) ? IDENTITY : scale(d, 1/sqrt(dot(d,d)));
  const E = axisAngleQuat(b.errAxis, b.errAngle);                // (axis*sin(a/2), cos(a/2))
  const Ep = mul(E, d);                                          // no hemisphere fix here
  b.errAngle = 2 * acos(clamp(Ep.w, -1, 1));                     // 0..2π
  const s = sqrt(max(1 - Ep.w * Ep.w, 0));
  b.errAxis = (s >= 1e-4 && normalizable(Ep.xyz / s)) ? normalize(Ep.xyz / s) : vec(1,0,0);
}

function afterResim(b, pre: RBState) {                           // 0x140f1b890 / 0x140f1b900
  if (b.skipNext) b.skipNext = false; else accumulate(b, pre, b.current);
}

function directApply(b, s: RBState) {                            // 0x140f4bac0 (client behind, or no history)
  if (b.ignoreSyncing) return;
  const pre = b.current; b.setState(s);
  if (b.lastRendered) { if (b.skipNext) b.skipNext = false; else accumulate(b, pre, s); }
  b.old.loc += s.loc - pre.loc; b.old.linVel += s.linVel - pre.linVel; b.old.angVel += s.angVel - pre.angVel;
  b.old.q = mul(mul(s.q, conj(pre.q)), b.old.q);
}

function drawPose(b, dt /* game-time frame delta */, alpha /* RenderAlpha */) {   // 0x140f704b0
  let loc = lerp(b.old.loc, b.rb.loc, alpha);
  let q = slerpUE3(b.old.q, b.rb.q, alpha);                      // shortest arc, linear if |cos| >= 0.9999
  q = (dot(q,q) <= 1e-8) ? IDENTITY : normalize(q);
  if (b.weldedTo) { b.errLoc = 0; b.errAngle = 0; return; }      // the parent places it
  if (b.errLoc != 0) {
    const k = min(dt * 4, 1);
    b.errLoc = b.errLoc - k * b.errLoc;
    loc = loc + b.errLoc;                                         // the decayed value is drawn this frame
    if (lengthSq(b.errLoc) < 0.1) b.errLoc = 0;
  }
  if (b.errAngle != 0) {
    const k = min(dt * 5, 1);
    b.errAngle = b.errAngle - k * b.errAngle;
    q = mul(axisAngleQuat(b.errAxis, b.errAngle), q);             // error on the left (world frame)
    if (abs(b.errAngle) < 0.001) b.errAngle = 0;
  }
  b.actor.setPose(loc, q); b.lastRendered = true;                 // mesh, camera, nameplate, FX follow
}
// New actor (spawn, kickoff, respawn, ball reset): old = rb = spawn state, err = 0, lastRendered = false.
```

### Test vectors (from `out/bsim/agents/CS1/scripts/cs_ref.py`, float32)

**TV-1: a 100 uu location correction at 60 fps.** pre.loc = (100, 0, 0), post.loc = (0, 0, 0), dt = 1/60, so
k = 0.0666667. The drawn offset per frame is 93.333336, 87.111115, 81.303703, 75.883453, 70.824554 (frames 1–5),
then:

| Frame | Drawn offset (uu) |
|---|---|
| 10 | 50.161179 |
| 30 | 12.621275 |
| 60 | 1.592966 |
| 80 | 0.400813 |
| 83 | 0.325876 |
| 84 | **0.304151** (drawn, then snapped) |
| 85 | 0 |

The biggest step is 6.67 uu, in frame 1. At 144 fps the error lasts 205 frames (97.222221, 94.521606, …, last
0.310411).

**TV-2: a 30° yaw correction at 144 fps.** post.q = 30° about +Z, pre.q = identity, dt = 1/144, so k = 0.0347222.

| Frame | Stored angle (rad) | Drawn offset from the corrected pose |
|---|---|---|
| 1 | 0.5054184 | 28.95835° |
| 2 | 0.4878692 | 27.95285° |
| 10 | 0.3677239 | 21.06902° |
| 50 | 0.0894569 | 5.12551° |
| 100 | 0.0152837 | 0.87570° |
| 177 | 0.0010057 | 0.05762° |
| 178 | 0 | 0.05562° drawn, then snapped |
| 179 | | 0 |

At 60 fps the same correction lasts 72 frames (27.500°, 25.208°, …).

**TV-3: composition** (a check of E′ = E ⊗ d). The existing error is 10° about +Z, pre.q = identity and post.q = 20°
about +X:
- the stored result is axis (−0.8930559, −0.0781323, 0.4431100), angle 0.3898700 rad (22.3379°);
- E′ = (−0.1729874, −0.0151344, 0.0858316, 0.9810603);
- E′ ⊗ post = (0, 0, 0.0871557, 0.9961947) = E ⊗ pre. The drawn rotation is unchanged at the moment of correction.

**TV-4: direct apply** (location only, α = 0.5, E = 0):
- before: Old.loc = 0, pre = 10, drawn before decay = 5;
- the server says 15: Old′ = 5, RB = 15, lerp = 10, e = 10 − 15 = −5, drawn = 5 (unchanged);
- then the usual decay.

**TV-5: hitch and large angle.**
- e = (100, 0, 0) with 30°:
  - dt = 0.1: 60 uu and 0.261799 rad (15°) remain;
  - dt = 0.25: both errors are cleared in that frame.
- 150° plus a further 60° on the same axis is stored as 210° about +Z and decays through 180°, 90°, …

### Differences from the earlier N-1 / NR text

1. **The snap happens after drawing.** The last drawn offset is up to 0.316 uu or 0.001 rad, and only then does it
   snap. At 60 fps a 100 uu error is drawn for 84 frames (0.304 uu in frame 84) and is 0 from frame 85; N-1 said
   "0 at ~83".
2. **Direct apply has gates N-1 left out:**
   - bIgnoreSyncing skips the whole apply;
   - the error is only accumulated when LastRenderTime > 0;
   - a never-rendered body consumes no skip flag.
   The resim path has no LastRenderTime gate.
3. **The rotation error is angle + axis without a hemisphere fix on the composite.** The stored angle can exceed π
   and then decays the long way. Only the new delta d is hemisphere-fixed and normalized. NR-7's E′ = E ⊗ d is
   confirmed, and so is the Hamilton product (sign masks read from .rdata, not assumed).
4. **The rotation interpolation is a UE3 Slerp** (shortest arc; linear when |cos| ≥ 0.9999), then normalized. It is
   not a lerp or nlerp. The drawn rotation is quantised through FRotator (65536 units per turn).
5. **dt is game time** (dilated by TimeDilation, for example in the post-goal slow motion), not real time.
6. **No large-error snap exists.** The k ≤ 1 clamp clears the error in a single frame of ≥ 0.25 s (location) or
   ≥ 0.2 s (angle).
7. **New: a paused game hard-sets** received states with no smoothing (CS-14). In online play this reaches only
   bodies without history.
8. **NR-1 confirmed:** Old.q = (new ⊗ pre⁻¹) ⊗ Old.q, with no renormalization. **NR-2 confirmed on live:** the
   TeleportCounter writer is only the free-play ball teleport; kickoff, respawn and ball reset are new actors with
   Old = RB.
9. **Welded lerp 18 is the WeldedActor placement rate** (Spike-Rush-style welding), not part of correction smoothing.

### Ping filter (PC.UpdatePing), item 5a

1. **Sample.** For each `ClientAckFrame` with TimeStamp ≥ 0 (TA:71042), the client queues the timestamp and runs
   `UpdatePing` one tick later (`SetTimer(0.001)`). For each queued timestamp:
   `s = max(RealTimeSeconds − ts − (RealDeltaSeconds + 0.016)/2, 0)` (TA:71058).
2. **Filter.** Each local `PC.UpdatePing(s)` (Engine `PlayerController.UpdatePing`) calls the native
   **PRI.UpdatePing** (0x14065d2f0, exec 0x14066e830) [N]:
   ```
   N = min(s, 1.5)
   if ExactPing >= 0.004:
       if N > 2·ExactPing: N = min(N, 3·ExactPing)        // spike clamp
       ExactPing = min(0.99·ExactPing + 0.01·N, 0.99)
   else:
       ExactPing = min(N, 0.3)                            // first sample
   NetStats.CurrentLatency = ExactPing; NetStats.CurrentJitter = |N − ExactPing|
   Ping (byte) = min(ceil(255·ExactPing), 255)
   ```
3. **Report to the server.** If `TimeSeconds − LastPingUpdate > 4` (game time), `PC.UpdatePing` calls
   `ServerUpdatePing(int(1000·ExactPing))`, an unreliable server RPC (flags 0x220043). On the server, that RPC sets:
   - CurrentJitter = |s − CurrentLatency|;
   - CurrentLatency = s;
   - **Ping = min(ceil(255·s), 255)**.
4. **Replication.** `Ping` replicates `if (bNetDirty && !bNetOwner)`, i.e. to the other players [repcond on
   Engine.upk]. ExactPing does not replicate.
5. **Display.** The scoreboard uses `PRI_TA.GetPing` (TA:81134) = `min(ExactPing != 0 ? ceil(1000·ExactPing) : 4·Ping, 999)`.
   - Your own ping is the filtered ExactPing in ms (time constant ≈ 100 samples ≈ 1.8 s at ~55 acks/s).
   - Other players' pings are 4·ceil(0.255·ms): a multiple of 4, about 2 % high, and refreshed at most every 4 s.
   - GetPing's caller is native or GFx (not traced) [I].
6. **Repeated ack timestamps** (NET-6) give stale, growing samples. The spike clamp limits one sample to
   3·ExactPing, and the weight per sample is 1 %.

### N-4e (forced net update on demolish), item 5b

**Settled: nothing forces the victim's update.** The demolish rides the car's next regular consideration.
- The only subscriber of `GameEvent.EventReplicatedDemolish` is `CrowdSoundManager_TA.HandleDemolish` (bound at
  TA:25883, body at TA:25987). It is a crowd-audio relevance check.
- **Script, scanned for direct calls:**
  - ForceNetUpdate: 60 callers in all of TAGame (positive control `RBActor_TA.SetFrozen`).
  - ForceNetUpdatePacket: 2 callers (`SetAllDriving`, `ApplyBallImpactForces`).
  - None of them is on the demolish path (Car_TA Demolish, DemolishFromSource, QueueDemolish*, FinishDemo and its
    delegate classes, `OnReplicatedDemolish`, `RemoveCar`, HandleDemolish).
- **Native:** the ForceNetUpdate implementation (0x1405a8f60: NetUpdateTime = TimeSeconds − 1, bForceNetUpdate,
  bNetDirty, the UE3 semantics) has three native callers:
  - SpawnActor 0x1407376e0;
  - AWorldInfo::SetPauser 0x1407355d0;
  - car-component SetActive 0x140f35090 (on the component actors, not the car).
- Confidence high. Script calls through variables or delegates are not covered by the bytecode scan.
