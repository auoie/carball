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
