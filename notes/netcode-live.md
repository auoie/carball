# Rocket League netcode, live build (2026-10-06): the implementable spec

Static session, 2026-10-14. One consolidated, live-verified spec for the netcode step (real-internet play). It
supersedes the old-build model in `notes/netcode.md` (kept as history) and collects the live parts of
`notes/netcode-audit.md` (N-/NR-/NET- items, "Correction smoothing (live build)" CS-1..15, the ping filter, N-4e).

Sources: sub-agents NL1 (client and server simulation side; the existing live decompiles NET1 runs b1–b10 and CS1
runs, `objdump` of the live exe, live script dumps, class defaults) and NL2 (replication and the Connection Quality
UI; section 11). Every address is a live address. Script lines: TA = `out/bsim/work/tagame_live_all.txt`,
PX = `out/bsim/agents/PNT1/projectx_live_all.txt`, ENG = `out/bsim/agents/K1/work/live_engine_ubc.txt`.

Tags: [N] native disassembly or decompile, [S] script, [A] package data, [I] inferred (incl. stock UE3 behaviour).
Status column: verified (live = old notes), changed, new.

## 0. The model in one paragraph (default settings)
The client simulates its own car, the ball and every other car at 120 Hz and records one input frame per new physics
tick. Once per render frame it sends the server up to the newest 10 unacknowledged input frames (a send clock at
60 Hz, Net_High). The server queues each player's frames in a jitter buffer sized from the packet-gap statistics
(minimum 7 frames) and consumes one frame per server physics tick (two when over target, half rate while refilling).
After every tick it re-arms an ack carrying the last consumed frame number; each connection update sends that ack
before the replicated actor states. On the client, every received state of any predicted body dirties the history at
the acked frame and the whole world is re-simulated from there (≤ 119 frames) in the same render frame, with remote
cars' inputs taken from the replicated throttle/steer/handbrake and faded to zero over 0.1 s inside the resim window.
The visible difference is smoothed (CS-1..15). There is **no client time scaling by default** (ServerConsume's
ModifyDeltaTime is the identity); STS / CSTS exist as opt-in "Input Buffer" settings.

## 1. Client input upload
| Rule | Live address / line | Constants | Conf | Status |
|---|---|---|---|---|
| One input frame per **non-resim** physics tick, for local players with Role < Authority, after `PF++`: `{VehicleInputs 36 B (bJumped bit kept), Frame = PF, TimeStamp = WorldInfo.RealTimeSeconds (+0x554)}`. Resim ticks record nothing. | 0x140f215f0, from RunPhysicsFrame 0x140f30970 when bClientPhysicsUpdate is clear | frame stride 0x2c | N | verified |
| **Send clock**, once per render frame after the substeps (dispatch 0x140f1b830: Role ≥ 3 → ServerTick event, else ClientTick; only with PrimaryClient): `T += DeltaSeconds/TimeDilation`; if `T ≥ 1/rate`: `T = clamp(T − 1/rate, 0, 1/rate)` and one packet per client with pending frames, then SendPendingRPCs. **At most one packet per frame.** | TA:70969/70977/70986 | rate = ConfiguredClientInputRate: Low 20 / Medium 40 / **High 60** (default Net_High); clamped to [20, 60] locally (TA:78011); not sent to the server | S | verified |
| **Packet:** if more than MaxInputFramesPerPacket frames are pending, the oldest are removed for good; then `{TimeStamp = RealTimeSeconds, CameraLoc/Rot, Frames = all pending}` as the unreliable RPC ServerReceivePacket (flags 0x220043). | TA:70994 | **10** (NetworkConfig_TA.MaxClientUploadFrames); STS: min(ReplicatedInputBufferSize + 2, 30) | S/A | verified |
| **Redundancy:** a frame rides every packet until acked or pushed out of the newest 10 (≈ 2 new frames per packet at 60 Hz). | as above | – | S | verified |
| **Ack (server):** every server physics tick re-arms `PrimaryClient.PC.PendingAdjustment.TimeStamp (+0x560) = LastPacketTimestamp`. On each connection update, **before** that connection's actor replication, PC_TA.SendClientAdjustment (NetPlayerIndex 0, while TimeStamp ≠ 0) sends `ClientAckFrame(TimeStamp, LastProcessedFrame, Stats)` (unreliable, 0x1020142) and sets TimeStamp = −1. A −1 ack is still sent and still moves RPF. | 0x140f214e0; 0x1407512c0; TA:76841, 71032 | – | N/S | verified |
| **Ack (client)** `ClientAckFrame` (TA:71042): if TS ≥ 0 a ping sample one tick later (ping filter below); `EngineShare.UpdateReplicatedPhysicsFrame(frame)` on **every** ack, no monotonic guard; only when `TS > LastPacketTimestamp`: update it and drop pending frames with `TimeStamp ≤ TS`. | TA:71042 | ping −(RealDelta + 0.016)/2 | S | verified |
| Packet layout: NET-3 / `FUN_140f16fe0` (ClientPacketData serializer); bit widths in notes/netcode-audit.md NET-3 / N-9. | 0x140f16fe0 | – | N | pointer |

## 2. Sim-time scaling (STS / CSTS): off by default
The "Input Buffer" setting defaults to 0 = **ServerConsume** (GetInputBufferClass TA:76418; NetworkSave default 0),
whose ModifyDeltaTime (vtbl+0x698) is the identity 0x140618a20. STS and CSTS are opt-in; the server switches mode 1 s
after a change (ServerInitInputBuffer TA:76401). For the clone: implement ServerConsume only (default); STS/CSTS are
documented for completeness.

| Rule | Address | Constants | Conf | Status |
|---|---|---|---|---|
| EngineShare tick scales dt only when NetMode == Client and InputBuffers is non-empty: `scaled = InputBuffers[0].ModifyDeltaTime(dt)`; stores LastPhysicsDeltaTimeScale (+0x210). | 0x140f54bd0 | – | N | verified |
| Input-buffer vtables: +0x698 ModifyDeltaTime (SC 0x140618a20, STS 0x140efb420, CSTS 0x140efb410); +0x6a0 per physics tick 0x140f214e0 (all); +0x6a8 consume (SC 0x140f23c10, STS 0x140f23a70, CSTS 0x140f239a0); +0x6b0 per frame 0x140f1b830. | vtables 0x141e79070 / 0x141e79728 / 0x141e789b8 | – | N | new |
| **STS server, empty tick** (0x140f23a70): if CanTell → `ClientAdjustSimTime(+1)` (reliable), bAdjustingSimTime = 1, TimeLastSimTimeAdjustment = now, LowWatermark = −1. Always: TimeLastMissedInput = now; zero input if `now − LastPacketTime > 1 s`; LastProcessedFrame++; Under++. Each tick LowWatermark = min(·, queue). A non-empty tick consumes exactly 1 (no double consume). | 0x140f23a70 | – | N | verified / new detail |
| CanTell = !bAdjustingSimTime ∧ BufferSize ≥ 1 ∧ `now − TimeClientAckdAdjustSimTime ≥ 1.0` ∧ `now − JitterBuffer.LastPacketTime < MaxTimeBetweenPackets`. | 0x140e8f390 | 1.0 s; 0.25 s | N | new |
| NotifyClientAdjustSimTime(N): N clamped to ±MaxSingleAdjustmentFrames, then the RPC and flags as above. | 0x140f18490 | 10 | N | new |
| STS ServerTick (per server frame): every InputBufferTightenUpSizeFrequency, if no miss and no adjustment in the window and LowWatermark > 2 → notify −(LowWatermark − 2); a BufferSize change ≥ 1 frame → notify the difference; bAdjustingSimTime cleared after 15 s without a client ack. | TA:71165/71174/24726 | 10 s; padding 2; 15 s | S | verified |
| **STS client:** ClientAdjustSimTime(N) (exec 0x140e8f4c0): `ExtraSimTimeRemaining = N/120` s. ModifyDeltaTime (0x140efb420): `rate = clamp(FixedAdjustSimTimeRate, 0.001, 0.05)` (0.009 without PhysicsConfig); `step = clamp(±rate·dt toward remaining)`; when \|step\| ≥ \|remaining\| → step = remaining, done, event ServerFinishedSimTimeAdjust. Returns `dt + step` (one frame ≈ 0.93 s at 0.009). | 0x140efb420, 0x140e8f4c0 | 0.009 | N | new detail |
| **CSTS server** (0x140f239a0): non-empty → consume, and again if `queue ≥ Inputs_Max + ExtraBuffer` (Over++); SeqMissed = 0; LowWatermark = min(·, queue). Empty → SeqMissed++, LowWatermark = min(·, −SeqMissed), zero input if > 1 s, LastProcessedFrame++. Each ack carries `SatLevel(queue − ExtraBuffer)`: ≥ 14 → 4, ≥ 6 → 3, ≥ 4 → 2, ≥ 2 → 1, else 0. ExtraBuffer every 1 s (from 5 s after spawn) = clamp(−min(history of 30), 0, 8). | 0x140f239a0; TA:71078–71129 | Inputs 2/4/6/14/20, ExtraMax 8, 30 s, 1 s | N/S/A | verified |
| **CSTS client:** `dt × CurrentTimeDilation`, set from `TimeDilations[SatLevel]` on every (unreliable) ClientAckFrame_CSTS. | 0x140efb410; TA:71126 | {1.0256, 1.0063, 1.0, 0.9938, 0.9756} | N/S/A | verified |

## 3. Rewind and replay (client)
| Rule | Address | Constants | Conf | Status |
|---|---|---|---|---|
| History only on clients: RB init creates an RBHistory when NetMode == Client, RBHistoryClass set, no -DisablePhysicsSim. bReplayActor bodies get none. | 0x140f1fd10, 0x140f1eb20 | – | N | verified |
| **Ring of 120** (MaxClientReplayFrames = round(PhysicsFramerate)). Init fills all 120 with the spawn state, frames PF−119..PF present and flagged as server snapshots. | 0x140f08340 (+0x19c), init 0x140f089e0, vehicle 0x140f08c50 | 120 | N | verified + new (init) |
| History vtables: +0x278 init, +0x280 record, +0x288 compare, +0x290 restore, +0x298 apply. Base 0x140f089e0 / 0x140f310d0 / 0x140f64b60 / 0x140f30550 / 0x140ebb2f0; vehicle 0x140f08c50 / 0x140f311b0 / 0x140f64bf0 / 0x140f305c0 / 0x140ebb310, plus +0x2a0 0x140f1fe90, +0x2a8 0x140f1b980. | vtables 0x141e8de40 / 0x141e8e0f0 | – | N | new |
| **Record** at the end of every RunPhysicsFrame (resim frames too): `frames[PF%120] = PF`; a new entry clears its ServerSnapshot flag. The RB state (q, loc, linvel, angvel, flags; 0x40 B) is written **unless the entry holds a server state and bOverrideServerPhysicsState is off** (server states survive later resims). Contact block actor+0x690 (0x28 B), PhysicsVolume (new frames only). Vehicle: 4 wheel contact blocks (0x50 each), vehicle-sim +0x12c, car +0x848 (16 B) and +0x874; **inputs (36 B) and component {bActive, ActivityTime, ComponentData} only on new frames.** | 0x140f310d0 / 0x140f311b0 | snapshot 0x70 B; vehicle 0x180 B | N | verified / new |
| **Trigger:** `DirtyPhysicsFrame ≠ −1` at the start of the EngineShare tick with prediction on; set by the RB receive (§5). Debug-only dirtiers: ForceCorrectionFrames (+0x1b0, CDO 0), bForceClientCorrection (+0x170 bit 0x20). | 0x140f54bd0 | – | N | verified |
| **Resim:** PreClientCorrectionNotify(PF − Dirty); set bClientPhysicsUpdate (bit 0x2); pre-hooks (ClientCorrectionRBState; vehicle history backs up component states, inputs only if bBackupVehicleInputs); PF = Dirty; restore each body from history[Dirty] (RB state, contacts, wheels, component active/time/data). Then `while PF < target`: apply history[PF+1] (PhysicsVolume; vehicle inputs; a component's bActive copied from history, ActivityTime/ComponentData reset to 0 when it changes) and RunPhysicsFrame. Clear the bit, Dirty = −1, post-hooks (SyncError CS-1; **component states restored to their pre-resim values**, so a resim never changes components' present state). | 0x140f54bd0; 0x140f30550/0x140f305c0; 0x140ebb2f0/0x140ebb310; 0x140f1fe90/0x140f1b980 | – | N | verified / new |
| During a resim: no input recording, no server consume, no component activation decisions (component +0x6a0 skipped); only active components apply forces. SimulatedProxy cars reuse stored wheel contacts when !bPredictContacts. | 0x140f30970, 0x140f21a90 | – | N | verified |
| **No cost limit** beyond the history: ≤ 119 frames resimmed, all inside one render frame, before that frame's own ≤ 5 substeps. MaxPhysicsSubsteps does not cap a resim. | 0x140f54bd0 | ≤ 119 + 5 | N | verified |
| **Beyond the history (N-10):** `RPF = ack > 0 ? max(ack, PF − 119) : PF`; a stale state is written into the oldest entry and resimmed from there. If `PF ≤ RPF` (client behind / no ack yet) the state is applied directly with no resim and PF is not renumbered. If `frames[RPF%120] ≠ RPF` the history write is skipped. | 0x140f643f0, 0x140f1eb20 | 119 | N | verified live |

## 4. Remote-car inputs (prediction and fade)
| Rule | Address | Constants | Conf | Status |
|---|---|---|---|---|
| Replicated to non-owners only: ReplicatedThrottle (byte), ReplicatedSteer (byte), bReplicatedHandbrake. Decode: b < 128 → (b − 128)/128, else (b − 128)/127. | 0x140f16f50 | – | N | verified |
| **Every render frame** (car PreAsyncTick 0x140f1fab0, after any resim, before the new substeps) a SimulatedProxy car's Input.Throttle/Steer/bHandbrake = the decoded replicated values. Pitch, Yaw, Roll, Dodge, Jump, Boost are never set from the network (they keep whatever the last history apply left). | 0x140f1fab0 | – | N | verified |
| **On that car's RB receive** (history compare 0x140f64bf0, Role == 1 only): re-decode; compare history[RPF] with the current Input (handbrake bit, or \|Δ\| ≥ 1e-8 in throttle, steer, pitch, yaw, roll). If different, every entry with frame ≥ RPF gets: handbrake copied; throttle, steer, pitch, yaw, roll = `(1 − min(1, (f − RPF)/120/InputFadeTime)) × current Input`; return "differs" (dirties RPF even without an RB state). | 0x140f64bf0 | InputFadeTime **0.1 s** (12 frames) | N/A | verified; **corrects the audit table** (5 axes fade, handbrake copied; only throttle/steer/handbrake replicated) |
| Effect: the fade shapes **only the resimmed window** RPF..PF; new frames use the full replicated throttle/steer again. Remote components are not simulated (§9), so pitch/yaw/roll, jump and boost have no effect on remote cars. | – | – | N/I | new |

## 5. When a correction triggers
| Rule | Address | Constants | Conf | Status |
|---|---|---|---|---|
| RB receive (PostNetReceive) for each arriving body with a history: `differs = bNewData ? (bUseNEQ ? NEQ(...) : 1) : 0`; vehicles OR the remote-input mismatch (§4). If `differs ∧ RPF < PF ∧ (Dirty == −1 ∨ RPF < Dirty) ∧ !bDisableClientCorrections` → Dirty = RPF. **Any received state of any predicted body (ball, own car, other cars) resims all bodies.** The state is copied into history[RPF] with the ServerSnapshot flag. | 0x140f1eb20; base compare 0x140f64b60 | bUseNEQ off (PhysicsConfig +0x1ac bit 0x20) | N/A | verified |
| NEQ (only with bUseNEQ): differs if the sleep flag differs, \|Δloc\|² > 5², max \|Δrotator component\| > 100 (wrapped ±32768), or \|Δlinvel\|² > 10². Angular velocity not compared. | 0x140f16c30 | 5 / 100 / 10 | N/A | verified |
| **Prediction needs a pawn:** effective bEnableClientPrediction is recomputed on every ack = CDO flag (True) ∧ some local PC has a Pawn. Off → the tick forces Dirty = −1 and states go through the direct apply in PreAsyncTick. So **while demolished (until respawn) or spectating, the client does not predict**: it applies states directly, smoothed by SyncError. | 0x140f643f0, 0x140f54bd0, 0x140f1fa20/0x140f1fab0 | – | N | **new** |
| bDisableClientCorrections (bit 0x4) blocks dirtying; set only by PlayerController_TA.ClientUseItem (offline teleport, TA:77137); cleared by the EngineShare map reset 0x140f163b0 (which also sets PF = RPF = 0, Dirty = −1). | 0x140f163b0 | – | N/S | new |
| Bit 0x20 = **bForceClientCorrection** (debug): consumed in UpdateRPF; no writer in native code or script. | 0x140f643f0 | – | N | **settled** |
| Smoothing of the visible difference: CS-1..15 (notes/netcode-audit.md "Correction smoothing (live build)"): rates 4 / 5 per s, snaps 0.1 uu² / 0.001 rad, game-time dt, no large-error snap, all bodies alike. | – | – | N | verified (CS1) |

## 6. Server input buffer (ServerConsume, the default)
| Rule | Address | Constants | Conf | Status |
|---|---|---|---|---|
| Per server **physics tick** (RunPhysicsFrame → InputBuffer +0x6a0 = 0x140f214e0, Authority only): Stats.High = max; consume (+0x6a8); Stats.Low = min; re-arm the ack TimeStamp. Splitscreen clients follow the primary's LastProcessedFrame (equal → consume; ahead → wait; behind → consume up to 2). | 0x140f214e0 | – | N | verified |
| **Empty queue:** if `RealTime − JitterBuffer.LastPacketTime > 1.0` the car gets an all-zero SetVehicleInput (PC.VehicleInput untouched); otherwise no call, **the car repeats its last input**. Either way bFillingBuffer = 1, LastProcessedFrame++ (LastProcessedReceivedFrame unchanged), Under++. | 0x140f23c10, zero 0x140eb7660 | 1.0 s | N | verified |
| **Non-empty:** if `!bFillingBuffer ∨ (server PF & 1) == 0` → Consume; else LastProcessedFrame++ (**half rate while filling**, on the server's PF parity). Then if `queue > BufferSize` → Consume again, Over++ (**double consume**; NET-2: the first frame's jump edges still fire). | 0x140f23c10 | – | N | verified |
| Consume: PC.VehicleInput = frame; idle tracker (matchmaking MM-35a); `Car.SetVehicleInput(frame)` event; LastProcessedFrame = LastProcessedReceivedFrame = frame.Frame; pop. | 0x140ebb410 | – | N | verified |
| **Leaving fill mode** only on a newer-timestamp packet from the primary client: JitterBuffer.ReceivedPacket(); InputBufferTarget = BufferSize; if filling and `queue ≥ BufferSize` (checked **before** merging this packet's frames) → bFillingBuffer = 0. | TA:71134 | – | S | verified |
| **Jitter buffer:** the first packet only stamps the time. Then `gap = clamp(now − last, 0.016, 0.25)`, `r = min(gap/15, 1)`, `mu = lerp(mu, gap, r)`, `var = lerp(var, (gap − mu)², r)` (new mu), `T = max(mu + 4·sqrt(var), 0.05)`, `BufferSize = ceil(T·120) + 1`. | TA:24704–24718 | init mu 0.016, var 0, size 7; minimum 7 | S/A | verified |
| **Hitch reset:** client ClientTick gap > 0.1 s real time (first tick excluded) → SetTimer(2, 'ServerResetInputBuffer') (restarts on every hitch) → reliable RPC → ResetInputBuffer = JitterBuffer.Reset() (mu, var, BufferTime, BufferSize to defaults; LastPacketTime kept). No-op under STS. | TA:70969, 71142 | 0.1 s, 2 s | S | verified |
| **Queue cap 60** frames, oldest dropped (TrimInputFrames); the effective target is ≤ 60 although BufferSize could compute up to ≈ 144. | TA:71023 | 0.5·120 | S | verified |

## 7. Packet loss and reordering (RL layer)
| Rule | Where | Conf | Status |
|---|---|---|---|
| Inputs: frames from **every** packet are merged, older-timestamp packets included; MergeFrames sorts and drops duplicates (keeps the existing copy); Trim drops frames ≤ the last *consumed* frame and caps at 60. Late frames for a slot an empty tick skipped are still consumed later, and Consume moves LastProcessedFrame **back**, so the ack can go backwards. Only newer timestamps update the camera, LastPacketTimestamp and the jitter sample. | TA:71007–71023, 64512; 0x140ebb410 | S/N | verified |
| Acks: unreliable, one per connection update (a lost one is replaced by the next). A reordered old ack moves RPF back (no guard); the states in the same packet are written at that older frame (consistent per packet). The pending-input drop and LastPacketTimestamp are guarded by `TS > last`. | TA:71042, 0x140f643f0 | S/N | new detail |
| States: each received ReplicatedRBState pairs with the RPF of the latest-processed ack; the ack RPC goes before actor replication, so normally both are in one packet. Underneath, stock UE3: unreliable bunches applied in arrival order (no staleness check); lost unreliable property bunches re-sent after a NAK; reliable bunches retransmitted in order; out-of-order packets processed, not dropped. | 0x1407512c0 | I (stock UE3) | inf |

## 8. Timeouts and disconnect detection
| Rule | Address / line | Constants | Conf | Status |
|---|---|---|---|---|
| NetDriver config properties are registered natively (no script class, no ini in exe or packages): ConnectionTimeout +0xec, KeepAliveTime +0xf0, RelevantTimeout +0xf4, SpawnPrioritySeconds +0xf8, ServerTravelPause +0xfc, Min/Max/MedianClientRate +0x100/+0x104/+0x108, Min/Max/MedianReplicationRate +0x10c/+0x110/+0x114, NetServerMaxTickRate +0x118, MatchFailureSeconds +0x70. **No InitialConnectTimeout** (replaced by per-platform MapLoadTime). The constructor sets no values. | 0x140bac170, ctor 0x140b96850 | config only | N | new |
| **Connection-timeout deadline** = LastReceiveTime (+0x1e8, double) + 2.0 if PC.bPendingDestroy; + ConnectionTimeout if PC.bShortConnectTimeOut and State ≠ Pending; else + GEngine.MapLoadTime{PC, PS4, XboxOne, Switch}. On timeout: log and close. bShortConnectTimeOut is set on the client's first PlayerTick and on the server by the reliable ServerShortTimeout (stock UE3). | 0x140b9ef70, 0x140badac3; ENG:10655, 9575 | MapLoadTime 25/25/25/30 s [A]; ConnectionTimeout value not in exe/packages (UE3 stock 15 s [I]) | N/A/I | new |
| **Reliable data blocked:** a channel's oldest unacked reliable older than ConnectionTimeout → log, EngineShare.OnReliablePacketsBlocked (metrics only), disconnect with error "ConnectionTimeout" (`[Errors]` key, "Error: 71"). | 0x140baca20…0x140bacbe5 → 0x140f29920 | ConnectionTimeout | N | new |
| The server stops replicating to a connection whose last receive was ≥ 1.5 s ago (stock). | 0x1407512c0 | 1.5 s | N | verified |
| **NetStats**, once per second per connection: PRI.NetStats gets CurrentReceiveTime = now − LastReceiveTime, CurrentAckTime = now − LastRecvAckTime (+0x208), packet loss / in-out totals, ping min/max, per-second loss min/max. A "Bad connection" log after 5 s from PC creation if receive/ack ≥ conn+0xb1ec or ping ≥ conn+0xb1e8. | 0x140bad500–0x140bada0b | StatPeriod 1.0; 5 s | N | new |
| **Client "connection issues":** ClientConnectionTracker_TA starts 15 s after attach and polls every 0.35 s; `bDisconnectedFromServer = CurrentAckTime ≥ 0.8 ∨ CurrentReceiveTime ≥ 0.8`; latency / jitter / loss statuses with thresholds 0.25/0.35 s, 0.04/0.06 s (2 s rolling), 5 %/9 % (5 s rolling). GFxData_ConnectionStats proxies it to the UI (section 11). PRI.ReplicatedWorstNetQualityBeyondLatency is replicated to the other players. | TA:497–615, 41051, 80636 | ConnectionQualityConfig_TA [A] | S/A | new |
| Dedicated server: AllPlayersHaveNetworkIssues = every primary PC ≥ 5 s old has GetConnectionTimeSinceLastReceived ≥ 20 s; while true, leavers aren't banned and Tour games are flagged. | PX:9556; 0x140df3c70; TA:1031 | 5 s, 20 s | S/N/A | new |
| A join that never readies shows a connection error after BadPRIReadyTime; MatchFailureSeconds (8, online config) is registered at driver +0x70 (reader not found). | TA:64947 | 5 s; 8 s | S/A | partial |

## 9. Rates, roles, remote components (settled open items)
- **Client rates:** "NetRepRate N" is clamped to [MinRR, MaxRR] (≤ 0 → MedianRR) and sent as NMT 42; "NetSpeed" clamped to
  [MinClientRate, MaxClientRate] (≤ 0 → Median) (0x140b9d510). Net_High picks Max (user log: 60 / 15000).
- **Server enforcement per connection (settled [N]):** NMT 42 → `conn.ReplicationRate (+0x308) = clamp(server Min/Max,
  ≤ 0 → Median)`, which drives the (0.5 + U)/Rate update timer; NetSpeed → `conn.CurrentNetSpeed (+0x80) =
  clamp(server Min/MaxClientRate)` (0x14094ad2e, 0x140b9e5e0/0x140b9e600). Saturation by CurrentNetSpeed: stock UE3 [I].
  The static default values are config-only (online NetworkConfig_TA can override).
- **Roles (settled):** Vehicle_TA.PossessedBy sets RemoteRole = AutonomousProxy online for player controllers
  (TA:18368); non-owners see SimulatedProxy (stock downgrade [I]); bots and the ball are SimulatedProxy; components copy
  Car.RemoteRole (TA:21916).
- **Remote components (settled [N/A]):** the component loop needs Vehicle Role > 1 or bSimulateComponent (0x140f21a90);
  Jump, DoubleJump, Dodge, Boost, FlipCar, AirControl archetypes don't set it (only Default__CarComponent_Torque_TA
  does); AirControl's RemoteRole is None (created locally). **Remote boost, jump, dodge and air control are not
  simulated on clients.**
- **Ack before state (settled, NET1):** PC_TA.SendClientAdjustment script order in 0x1407512c0.
- **EngineShare+0x170 bit 0x20:** bForceClientCorrection, debug only (§5).
- **EngineShare tick caller (CS-8, settled):** UWorld::Tick 0x1407544b4 calls GEngine+0x90 (EngineShare) vtbl+0x2b0 =
  0x140f22c90 → 0x140f54bd0 (vtable 0x141e64730), after the TG_PreAsyncWork tick group (0x140754486); skipped while
  WorldInfo.bPlayersOnly.
- **Still open:** the ConnectionTimeout and KeepAliveTime values (config only); MatchFailureSeconds's reader; UE3
  packet framing [I].

## 10. Tick and frame model
- **Physics** [N/A, verified]: 120 Hz fixed step 1.0f/120; accumulator 0x1402b0460; substeps = min(n, MaxPhysicsSubsteps
  5) per render frame; whole steps beyond 5 are **dropped** (only the remainder kept), so below 24 fps the game runs slower
  than real time. RenderAlpha = clamp(acc/step, 0, 1).
- **One frame counter** [N]: EngineShare.PhysicsFrame, incremented at the start of each RunPhysicsFrame; the state after
  step N and input frame N share the number N; reset to 0 at map reset (0x140f163b0). The server has its own counter and
  uses only its parity (fill mode). Client numbers reach the server in ClientInputData.LastProcessedFrame (the ack).
  Render frames are unnumbered and run 0–5 physics frames each.
- **Server frame rate** [N/A]: GetMaxTickRate 0x140ef6d90 on a dedicated server = ServerConfig_X.NetServerMaxTickRate
  (**57**, +0x88) with a NetDriver, else Idle (20, +0x8c), else driver+0x118. ServerConfig_X is an online config [I: can be
  overridden].
- **Per server frame:** TickDispatch (merge inputs, jitter sample) → TG_PreAsyncWork → EngineShare tick (≈ 2.1 physics
  steps; each consumes one input frame per player and re-arms the ack; ReplicatedRBState = RBState per step, NET1
  0x140f520b0) → ServerTick events → TickFlush / ServerTickClients (per due connection: ack RPC, then actors).

## Differences from the old notes (netcode.md / netcode-audit.md)
1. netcode.md's "the client keeps the server's buffer at size by running its clock faster or slower" applies only to
   STS/CSTS; the default is the identity.
2. "Consumes one per server tick" = one per server **physics** tick (≈ 2.1 per 57 Hz server frame); fill mode consumes on
   even server PF and advances LastProcessedFrame on odd PF (already fixed in the audit).
3. Remote fade: 5 axes fade, only over the resim window; live frames use the full replicated throttle/steer; pitch/yaw/
   roll come from leftover Input. The audit's "throttle/steer/handbrake only" mixed up what is replicated with what fades.
4. New: prediction is active only while a local PC has a Pawn.
5. New: components and inputs are recorded only on new frames; a resim replays components from history then restores
   their pre-resim state; stored server states are never overwritten by resim results.
6. New: STS native details (CanTell gates, ±10 clamp, rate clamp [0.001, 0.05]); a CSTS dilation change applies on each
   unreliable ack.
7. New: the timeout model (MapLoadTime 25/30 s, then ConnectionTimeout, 2 s when pending destroy; reliable-blocked
   disconnect; 1.5 s replication stop; NetStats 1 s; tracker 0.8 s).
8. NET1's N-9 timing, NET-6/NET-7 and CS-1..15 re-confirmed unchanged.

## Pseudo-code (default mode)
```ts
// Server, per physics tick, per player (ServerConsume)
function serverTick(c, serverPF) {
  if (c.queue.length === 0) {
    if (realNow - jitter.lastPacketTime > 1.0) car.setInput(ZERO);   // otherwise the last input repeats
    filling = true; c.lastProcessed++; stats.under++;
  } else {
    if (!filling || (serverPF & 1) === 0) consume(c); else c.lastProcessed++;
    if (c.queue.length > jitter.bufferSize) { consume(c); stats.over++; }   // apply A's jump edges (NET-2)
  }
  pc.pendingAck.ts = c.lastPacketTimestamp;                // re-armed every tick
}
function consume(c) { const f = c.queue.shift(); car.setInput(f.in); c.lastProcessed = c.lastProcessedReceived = f.frame; }
function onPacket(c, p) {                                  // primary client
  if (p.ts > c.lastPacketTimestamp) { c.lastPacketTimestamp = p.ts; jitter.received(realNow);
    if (filling && c.queue.length >= jitter.bufferSize) filling = false; }      // before the merge
  c.queue = mergeSortedDedup(c.queue, p.frames)
              .filter(f => f.frame > c.lastProcessedReceived).slice(-60);
}
// Client, per render frame
function clientFrame(dt) {
  receive();                                               // acks set RPF; RB receive writes history and dirties
  if (!predictionOn /* no pawn */) dirty = -1;
  if (dirty >= 0) resim(dirty);                            // ≤ 119 frames
  for (const b of bodies) b.preAsyncTick();                // remote: throttle/steer/hb = replicated; direct applies
  const n = Math.min(acc.step(dt), 5);
  for (let i = 0; i < n; i++) { PF++; recordInput(PF); step(); recordHistory(PF, true); }
  sendClock(dt);                                           // ≤ 1 packet/frame at 60 Hz, newest 10 pending frames
}
function onRBReceive(b, s) {
  if (PF <= RPF) { directApply(b, s); return; }
  const i = RPF % 120; if (b.frames[i] !== RPF) return;
  b.serverSnap[i] = true; b.snap[i] = s;
  let differs = true;                                      // bUseNEQ off
  if (b.isRemoteCar) differs = fadeRemoteInputs(b, i) || differs;
  if (differs && RPF < PF && (dirty < 0 || RPF < dirty)) dirty = RPF;
}
function fadeRemoteInputs(car, i) {
  car.in.throttle = dec(car.repThrottle); car.in.steer = dec(car.repSteer); car.in.hb = car.repHb;
  if (!changed(car.hist[i].in, car.in)) return false;      // hb, thr, steer, pitch, yaw, roll; |Δ| ≥ 1e-8
  for (const e of car.hist) if (e.frame >= car.frames[i]) {
    const k = 1 - Math.min(1, (e.frame - car.frames[i]) / 120 / 0.1);
    e.in.hb = car.in.hb; for (const a of ['throttle','steer','pitch','yaw','roll']) e.in[a] = k * car.in[a];
  }
  return true;
}
function resim(from) {
  const target = PF; preHooks(); PF = from; for (const b of bodies) b.restore(from);
  while (PF < target) { for (const b of bodies) b.apply(PF + 1); PF++; step(/*no input record, no component activation*/); recordHistory(PF, false); }
  dirty = -1; postHooks(/* SyncError; components back to pre-resim state */);
}
// STS client (opt-in): onAdjust(N) => rem = N/120; dt' = dt + clamp(±clamp(0.009,0.001,0.05)*dt toward rem)
// CSTS client (opt-in): dt' = dt * [1.0256, 1.0063, 1, 0.9938, 0.9756][satLevel from the last ack]
```

## 11. Replication and the Connection Quality indicator (NL2)
Sources: script, package data (class defaults), AS3 and NET1's 10 ranked 2v2 replays (`out/bsim/agents/NL2/work/`).
Tags here also: [G] AS3, [M] movie dump, [rep] measured in replays, [sim] simulated. Inherited defaults: Engine Actor
(NUF 100, prio 1, RemoteRole None), Pawn (SimulatedProxy, prio 2), Info (NUF 10, dirty-only), ReplicationInfo
(SimulatedProxy, bAlwaysRelevant). NUF = NetUpdateFrequency.

### 11.1 Per actor class
| Class | NUF / prio | Relevancy and role | Key properties and conditions | Status |
|---|---|---|---|---|
| Car_TA | 15 / 6 | bAlwaysRelevant (RBActor_TA); bReplicateMovement False (no Actor Location/Velocity). PossessedBy sets RemoteRole = AutonomousProxy for a PC in a net game, Simulated for bots (TA:18372) | `ReplicatedRBState` **if true** (whenever changed); `TeleportCounter` / `bFrozen` / `WeldedInfo` if bNetDirty; `ReplicatedThrottle` / `ReplicatedSteer` (bytes, 128 = neutral) and `bReplicatedHandbrake` if bNetDirty && RemoteRole == SimulatedProxy, i.e. **non-owners only**; `bDriving`, `ReplicatedDemolishExtended`, `DodgesRefreshedCounter`, `MaxNumJumps`, `bUnlimitedJumps`, `MaxTimeForDodge` if bNetDirty; `bOverrideHandbrakeOn/BoostOn` owner only | NUF/prio verified; owner mechanism new |
| Ball_TA | 100 / 10 | bAlwaysRelevant, SimulatedProxy | RB state as cars; `HitTeamNum` byte (255 default); explosion data; scales and Magnus bNetInitial | verified |
| CarComponent_TA (jump, double jump, dodge, flip, boost) | 30 / 5 | bAlwaysRelevant, bOnlyDirtyReplication; `Create` copies the car's RemoteRole (TA:21927) | `ReplicatedActive` byte counter (odd = active, `ClientUpdateActive` TA:21907), non-owners only; `ReplicatedActivityTime` needs bSimulateComponent (never seen); Dodge `DodgeTorque`, DoubleJump `DoubleJumpImpulse`, AirActivate `AirActivateCount` (→ ForceNetUpdate), FlipCar `FlipCarTime` + `bFlipRight` if bNetDirty | verified / new |
| Boost amount | – | – | Owner: `ClientGiveBoost` / `ClientFixBoostAmount` RPCs (tolerance 0.0001). Non-owners: `ReplicatedBoost` (32-bit struct; BoostAmount = FloatToRangeByteUnsigned(percent), written in `Active.EndState`). While a remote car boosts, **non-owners predict its consumption** (`ShouldPredictBoostConsumption`: Role == SimulatedProxy && !unlimited, TA:22304) | new |
| PRI_TA | 1 / 1 | ReplicationInfo, always relevant | `Ping` byte if bNetDirty && !bNetOwner; `ReplicatedWorstNetQualityBeyondLatency` byte (everyone); stats ints if bNetDirty; ForceNetUpdate on score/stat changes | new |
| GameEvent_Soccar_TA | 100 / 10 | bAlwaysRelevant; SimulatedProxy (GameEvent_TA.Init TA:851) | `SecondsRemaining`, `ReplicatedStateName`, `bBallHasBeenHit`, `ReplicatedServerPerformanceState` (byte) if bNetDirty | new |
| GRI_TA / Team_TA | 10 / 2 | ReplicationInfo | Team `Score` / `GameScore`, `ClubColors` if bNetDirty | new |
| VehiclePickup_TA (pads) | 1 / 1 | bNoDelete level actor, bAlwaysRelevant, bSkipActorPropertyReplication; **RemoteRole None until the first pickup** → SimulatedProxy + ForceNetUpdate (TA:99077); `bNetRelevant` false while idle, true while picked up | `NewReplicatedPickupData {Instigator, PickedUp byte}` if bNetDirty; PickedUp is a counter (+1 pickup, +1 respawn); clients run the respawn timer themselves; a missed cycle (even delta ≥ 2) → `DeltaFix` (TA:101647) | new |
| CameraSettingsActor_TA | 30 / 1 | ReplicationInfo | camera profile, `bUsingSecondaryCamera`, pitch/yaw bytes to non-owners; upload: unreliable `ServerSetCameraRotation` at most every 0.0333 s + a reliable resend after 0.1 s idle (TA:15262) | new |
| NetworkInputBuffer_TA | 60 | bOnlyRelevantToOwner, AutonomousProxy | – | new |
| PlayerController | prio 3 | bOnlyRelevantToOwner | – | – |

### 11.2 Relevancy, priority, rates
- **Relevancy:** every gameplay actor is always relevant (RB actors, components, events, PRIs). No distance culling in
  script or data [A] (a native IsNetRelevantFor override was not checked [I]).
- **Forced updates** [S][A]: the ball after each car hit (`ApplyBallImpactForces` → `Ball.ForceNetUpdatePacket`, TA:20255);
  cars on `SetAllDriving(true)` (TA:1370), `Teleport` (TA:20538) and flip resets (TA:101291); component impulses near the
  ball (`NetworkConfig_TA.bForceNetPackets` True, `ForcePacketSignificantDistance` 1000; NET-5 semantics).
  netcode.md's "a car within 1000 uu of the ball is forced into every update" is wrong.
- **Server tick:** `NetServerMaxTickRate` 57, idle 20 (online config). Also `FlatbufferPacketSendRate` 30,
  `MinSecondsForUnstableConnection` 20, `MinSecondsUntilConnectionCheck` 5 [A].
- **Measured car update rate** [rep]: median **13.4/s per car** (p25–p75 13.0–13.7); gaps of 1/2/3 server frames = 14/53/32 %.
  The 120 Hz-frame model (≈ 6.7/s) is rejected; the 57 Hz-frame model (≈ 12–13/s) fits. Replays hold the **received**
  RB cadence (the recorder's own car shows the same gap distribution).
- **Ball:** ≈ 35/s modelled; replays show 29/s (the 30 fps recorder cap). **Components:** ≈ 3.8 update records/s per car.
- **Priority** matters only when saturated: Net_High asks for 15000 B/s; the 2v2 state stream is ≈ 3.1 KB/s, so it never
  saturates. GameInfo `TotalNetBandwidth` 32000, `MinDynamicBandwidth` 4000, `MaxDynamicBandwidth` 7000 exist [A], use unknown.

### 11.3 Bits per update ([rep] payloads; framing [I])
| Update | Content | Bits |
|---|---|---|
| Car → non-owner, awake | RB 229.6 (112–242) + property header 7 + inputs 14.0 on average (steer 8+7 in 62 % of updates, throttle 8+7 in 28 %, handbrake 1+7 in 5 %) | **250.6** (+ framing ≈ 34–35 B) |
| Car → owner | RB + header | 236.6 (≈ 32 B) |
| Car, sleeping | – | 120.6 + 7 |
| Ball | RB 235.0 + 7 | **242** |
| Rare car properties | DemolishExtended 237 + 8; TeamPaint 88; DodgesRefreshedCounter 32 | – |
| Components (own channels) | ReplicatedActive 8+6; AirActivateCount 32+6; ReplicatedBoost 32+6; DodgeTorque 31.1 (11–34)+6; DoubleJumpImpulse 55+6; FlipCarTime 32 + bFlipRight 1 | records: Boost 58.0, Jump 35.4, Dodge 66.3, DoubleJump 82.9, FlipCar 54.2 |
| Pickup | NewReplicatedPickupData 18.7 (9 without instigator, 41 with) + 6 | record ≈ 62–66 |
| PRI / GameEvent / camera | Ping 8+8, stat ints 32+8; SecondsRemaining 32+7 per second; camera pitch/yaw 8+6 | – |
| **2v2 total** | car 1.63, ball 0.75, PRI 0.19, components 0.13, pickups 0.07, other 0.05, camera 0.03 KB/s | **≈ 3.1 KB/s** (no acks, headers, UDP) |
The property header is the RepIndex (7–8 bits for car/ball/PRI, 6 for others); the RB quaternion is 2 + 3·18 = 56 bits. With acks and UDP/IP that is ≈ 5–6 KB/s per client [sim]. Car RB states go to the owner too, at the same cadence as to others [rep].

### 11.4 Connection Quality indicator
- **Setting:** Interface `UserSettings.int [ConnectionQualityIndicators]`, checkbox, **default on**
  (`ConnectionQualitySave_TA.bShowConnectionQualityIndicators`) [A][S TA:56179].
- **Tracker:** `ClientConnectionTracker_TA`, primary player in networked games only (TA:76494–76530); starts **15 s** after
  attach, polls every **0.35 s** [A]; `GFxData_ConnectionStats_TA` proxies `bDisconnectedFromServer`,
  `bShowConnectionQualityIndicators`, `LatencyStatus`, `JitterStatus`, `PacketStatus` to AS3.
- **Thresholds** (`ConnectionQualityConfig_TA`, online config; status 0 good / 1 mediocre / 2 bad, ≥ comparisons, TA:547–612):

  | Indicator | Input | Mediocre | Bad |
  |---|---|---|---|
  | Disconnected (bad only) | `NetStats.CurrentAckTime` or `CurrentReceiveTime` | – | ≥ 0.8 s (no hysteresis) |
  | High latency | `NetStats.CurrentLatency` (the filtered ExactPing, s) | ≥ 0.25 | ≥ 0.35 |
  | Latency variation | EMA of `CurrentJitter` (= \|ping sample − ExactPing\|), weight 0.175 per poll (0.35/2.0) | ≥ 0.04 | ≥ 0.06 |
  | Packet loss % | EMA(new lost) / EMA(new packets) × 100, weight 0.07 (5 s) | ≥ 5 | ≥ 9 |
  | Server health | dedicated servers: `ServerPerformanceTracker_TA` (TA:90230) fps = 1/dt, Rolling = lerp(Rolling, fps, min(dt, 1)), start 60; replicated as `GameEvent_Soccar_TA.ReplicatedServerPerformanceState` (TA:61973) | ≤ 50 fps | ≤ 40 fps |

- **Hysteresis** (`ShouldUpdateMetric`): a worse status applies at once; any other change only after > `ClientUpdateDelay`
  **1.5 s** since that metric's last change.
- **Display** [G][M]: `connectionQualityView` (HUD d88) at **(1010, 220)**, right-anchored (x += ΔW), above the boost meter;
  not in the replay viewer.
  - Entries [Disconnected, Server, Packet, Jitter, Latency], sorted worst first (keep this priority order for ties).
  - Normally only entry 0 shows (status > 0). With the scoreboard open, or any top screen other than the HUD, every bad
    or mediocre entry shows, with labels.
  - Entry 0 at y 0, flashing; entry i > 0 at y = 54 + (i − 1)·48, no flash, icon scale 0.6; moves tween 0.2 s.
  - Icons by key: Icon_Disconnected, Icon_ServerPerformance, Icon_PacketLoss, Icon_LatencyVariation, Icon_LatencyHigh;
    128 px art at 0.75 = 96 px, centred (our own icons).
  - Fade: autoAlpha 0.2 s. Additive tint: bad (255, 0, 0); mediocre (255, 103, 0) (renders orange).
  - Flash: 0.25 s to white and scale 1.1, then a yoyo between the status colour at 1.0 and white at 1.1, 0.25 s per leg.
  - Labels `[ConnectionQuality] Disconnected / ServerHealth / PacketLoss / LatencyVariation / HighLatency` (by key; not on
    the verbatim list), upper-cased, $SmallBoldFont 12 white, centred in a 120 px box at x −123…−3, bottom ≈ y 31.6,
    black glow (blur 5, strength 2), 0.3 s fade.
- **Scoreboard:** on the server a tracker per remote player sets `PRI.ReplicatedWorstNetQualityBeyondLatency = max(PacketStatus,
  JitterStatus)` (TA:80637), shown as the SB-7 warning triangle; its inputs come from `ServerUpdatePing` (every ≥ 4 s:
  latency = the client's ExactPing, jitter = |ping_k − ping_{k−1}|).
- **Post-match help modal** (menu level; medium confidence): rolling "bad time" ±0.35 s per poll per metric (0–900 s);
  opens if bad time / 900 reaches 35 % (ping), 10 % (jitter) or 5 % (loss) and the last notice was ≥ 5 days ago. Suggest
  skipping it in the clone.
- The join-time connection check is off by default (`bJoinGameConnectionCheckEnabled` false). The separate network stat
  graph uses latency good/bad 75/120 ms and loss 1/3 **lost packets per second** (a count per 1-s StatPeriod, not %: SG2, UNetConnection stat block fed at 0x140bada29; TA:70874–70897).

### 11.5 Packet-level settings
- Low/Medium/High map to TcpNetDriver Min/Median/MaxReplicationRate and Min/Median/MaxClientRate, and to 20/40/60 for the
  input rate (TA:71206–71242), applied as `NetRepRate`, `NetSpeed`, `NetClientInputRate`; NetworkConfig_TA (online) can
  override the min/max. TcpNetDriver has no default object in any package; the only known High values are the user's
  log: 60 / 15000 / 60. Server-side clamping per connection: §9.
- Open (native, not needed for the clone): the units/writers of PRI.NetStats fields on client and server (NL1 §8 gives the
  per-second NetStats update); FloatToRangeByte formulas (the throttle/steer decode is in §4); whether a native
  IsNetRelevantFor exists for RB actors.

## 12. Gap list against our server and client (NL3, code reading at 9b99b97)
**Already done** (earlier audit items): N-1 (as CS-1..15), N-2, N-5, N-11 (5 substeps on client and server), NR-1..9,
NET-1, NET-2 (caveat G10). Partly: N-3 (parts independent, size unchanged), N-4 (no client demo prediction; explosion
position and timing differ, G9). Not done: N-9 (keep, G12), N-10 / NET-7 (G7), NET-5 cadence and NET-8 state size (G1).

**Matches** (summary): one input frame per new tick, the 60 Hz send clock with ≤ 1 packet per frame, the newest 10
frames, acks in every update (same datagram as the states, so atomic), correction at each update's own ack with no
monotonic guard, no STS/CSTS; history only on the client (128-slot ring), every frame recorded, server states survive
resims, inputs recorded only on new frames; any update dirties a full-world resim; the **whole server input buffer**
(ServerConsume: repeat / zero after 1 s, half-rate fill on server PF parity, double consume, NET-2 jump edges, fill exit
before the merge, the jitter formula, hitch reset, cap 60); loss/reorder merging; client ≤ 5 substeps with drop; CS-1..15
and NR-1..9 (minor G13).

**Ranked gaps** (effect on online feel at 30–150 ms RTT, jitter, 1–5 % loss):

| # | Gap | Ours (file:line) | Game | Effect | Change | Risk |
|---|---|---|---|---|---|---|
| G1 | **Downstream state size and cadence vs QUIC congestion control** | cars ≈ 322–430 B each (`engine/net/NetState.cpp:122-173`: body 85 B incl. inverse inertia 36 B, two control sets 50 B, wheels, hit info); ball and cars within 1000 uu every update (60/s), others and pads 15/s (`server/src/game.rs:14-20, 1438-1495`): 2v2 ≈ 45–60 KB/s, 3v3 ≈ 95–140 KB/s per client; `send_datagram` errors ignored (`net.rs:134-136`) | car ≈ 33–37 B at ≈ 13.4/s, ball ≈ 34 B at ≈ 35/s: ≈ 3.1 KB/s (2v2), 6.5 KB/s (3v3) | **HIGH [I]**: QUIC datagrams are congestion-controlled; a loss-based controller sustains ≈ 1.22·1200/(R·√p): ≈ 146 KB/s at 100 ms/1 %, 65 KB/s at 100 ms/5 %, 44 KB/s at 150 ms/5 %, at or below our rates; queued datagrams (quinn's send buffer [I]) can add seconds of latency or drops; 2–3 datagrams per update multiply loss exposure | in order: (1) measure (T1); (2) never queue stale updates (small datagram send buffer / check space and skip; consider BBR; depends on wtransport 0.7's API [I]); (3) the game's cadence: cars ≈ 15/s + a forced update on jump/dodge/double-jump impulses within 1000 uu of the ball, ball 35–60/s, acks 60/s; (4) shrink the car state (packed RB fields only if the per-tick read-back stays lossless; drop inverse inertia if recomputable; gameplay fields only on change or as a delta against an acked update); (5) client stale-input datagram policy (`outgoingMaxAge`) [I] | (2) low; (3) medium (bigger remote errors: T5); (4) high (determinism; gate on T3: 0 local mispredictions on a clean network) |
| G2 | **Remote-car inputs** (§4) | every frame, resim or new, uses the last server controls with throttle/steer/pitch/yaw/roll × (1 − min(1, (f − base)/12)); jump, boost, handbrake, dodgeForward held (`client/src/net/predictor.ts:101-113, 178-184`) | new frames: full replicated throttle/steer/handbrake; pitch/yaw/roll keep the last history value; the fade rewrites only history ≥ RPF, on that car's receive, when inputs differ; jump/boost never set; remote components don't run | **MEDIUM**: when resim depth > 12 (RTT ≳ 50 ms) remote cars coast at the present with zero steer/throttle, under-turn every update, every update is a correction | record remote controls per frame; new frames use full base throttle/steer/handbrake and pitch/yaw/roll from the previous record; on a car's receive, if its controls changed (\|Δ\| ≥ 1e-8), fade-rewrite entries ≥ ack (handbrake copied); remote jump/boost: product decision | medium (decide with T5) |
| G3 | **One resim per update; a fresh snapshot per frame** | each update / late part does load + resim at depth ≈ RTT·120 + 7 (`client/src/game/online.ts:610-639`, `predictor.ts:132-163`); `saveState` allocates per frame (`engine/wasm/bindings.cpp:458-462`) | one resim per render frame from the minimum dirty frame | **MEDIUM**: a jitter burst of 3–6 updates at 150 ms ≈ 80–160 steps + snapshots in one frame; the spike can even trip the hitch reset (> 0.1 s) | `Predictor.stage(frame, states)` writes states into history and tracks the minimum frame; `resimulate()` once per frame with one SyncError capture around it; pool snapshot buffers | low–medium (keep the NR-6 "either order" test) |
| G4 | **Connection Quality indicator and the 0.8 s "disconnected" icon** | only the debug `#net` line (`online.ts:1067, 1088`) and "Disconnected" when the transport closes | §11.4 | MEDIUM (UX) | client tracker (15 s start, 0.35 s poll): disconnected = time since the last Update ≥ 0.8 s; latency ExactPing ≥ 0.25/0.35; jitter EMA 0.175 ≥ 0.04/0.06; loss from serverTick/part gaps EMA 0.07 ≥ 5/9 %; server health byte; 1.5 s hysteresis; default on; server sets max(packet, jitter) per player for the scoreboard triangle | low |
| G5 | **Prediction needs a pawn** (§5) | keeps predicting while the local car is demolished | applies states directly + smoothing (the shown world steps back by ≈ RTT + buffer, forward again at respawn) | LOW–MEDIUM (fidelity) | `Predictor.predicting = false` while `#drawnDemoed(local)` (`online.ts:569`); `correct()` applies at the present without replay and records the present frame; smoothing as now; re-enable at respawn (spawn counter changed and not demoed) | medium |
| G6 | **Ping filter and display** | client EMA 0.1 with echo-delay compensation (`online.ts:625-628`); scoreboard = server QUIC RTT sampled each second, broadcast every 2 s in 1 ms steps, own ping included (`net.rs:172-177`, `game.rs:598-602, 1126-1146`) | PRI.UpdatePing (0.99/0.01 EMA, spike clamp 3·ExactPing, cap 1.5 s, first sample min(N, 0.3)); own = ceil(1000·ExactPing); others = 4·ceil(0.255·ms), refreshed ≤ every 4 s | LOW | implement the filter; an `UpdatePing` report every > 4 s; server stores min(ceil(255·s), 255) | low |
| G7 | **Acks outside the history, ack 0, ack ahead** (N-10) | ignore beyond 127 frames; ack 0 resims from the welcome frame; ack > PF triggers a resync that renumbers frames and wipes the history (`predictor.ts:133-141, 196-209`) | clamp to PF − 119 and resim; ack 0 → apply at the present; ack > PF → apply directly without renumbering | LOW | optional | low–medium |
| G8 | **No 1.5 s replication stop to a silent client** | sends to everyone (`game.rs:1471`) | stop replicating after 1.5 s without receive | LOW | skip a player whose last packet is ≥ 1.5 s old; count `send_datagram` errors | low |
| G9 | **Demolish explosion position** | recorded pose at the server's tick (`online.ts:734-745`) | the victim's drawn location at receipt (N-4c, CS-11) | LOW | use blended pose + `error.location` | low (revisits RV-47) |
| G10 | **Dodge direction on a double consume** | B's axes (`server/src/input_buffer.rs:157-162`) | A's DodgeForward/Right at the press | LOW | pass A's dodge axes with the tap/repress | low–medium (engine API) |
| G11 | **Component state after a resim** (by design) | full snapshots: the server's component timeline wins | components replay bActive from history, skip activation decisions; the pre-resim present state is restored | INFO: a correction can shift or cancel a predicted local jump/dodge when the server's state differs | keep; measure (T3) | high if changed |
| G12 | **Resend until consumed** (N-9; keep) | `online.ts:600-608`: more redundancy (≈ 5 packets per frame-span at 60 fps) | drop once received (TS-guarded) | – | keep; fix `protocol/README.md`, which says `receivedFrame` stops resends (unused) | – |
| G13 | CS details (negligible) | `client/src/game/syncError.ts:39-45`: snap before draw; quaternion store; no FRotator quantisation | snap after draw; angle+axis (decays the long way past π); FRotator | negligible | optional | – |

**Intentional design differences (fine):** WebTransport datagrams instead of UE3 bunches (ack and states atomic in one
datagram; ≈ 55–75 B overhead per datagram; the real cost is congestion control, G1); full engine state per car (buys exact
resims, i.e. 0 local mispredictions on a clean network; it is the source of the ≈ 10× size, so any shrinking must keep
that exactness); remote cars follow the game's rule since 8c8df8a (G2 option (b): jump, boost, dodge and air control not
simulated on the client); pads predicted; boost amount in the state, but a remote car's boost consumption isn't predicted
between updates (the game predicts it for SimulatedProxy, ShouldPredictBoostConsumption, §11.1; display only); the
demo event at once on the reliable stream (faster than the game); LPF counted from the first input; the 128-slot ring;
echo-compensated RTT (the display should still use the game's filter, G6); no STS/CSTS (matches the
game's default; since 3885154 there is no resync renumbering: ack 0, an ack ahead and no pawn apply directly at
the present, G5/G7). Remote cars recompute wheel contacts instead of reusing stored ones; components re-decide during a resim
(G11).

## 13. Test plan (in-process network tests; NL3)
### 13.0 Prerequisites
- **NetSim** (shared): seeded PCG; a JSON profile per direction (base_ms; jitter normal / AR(1) ρ / path stalls; loss
  i.i.d. or Gilbert–Elliott; duplicate p); reordering emerges from the delays. Virtual-time versions in Rust (a
  `server/src/` test module) and TS (`client/src/testing/netsim.ts`); a real-time tokio UDP relay for QUIC tests
  (`server/tests/`).
- **Metric hooks.** Server: extend `input_buffer::Stats` with repeated, zeroed, fill_skips, trimmed, late_dropped,
  duplicates, consumed; per-tick `jitter.buffer_size` and `len()`; bytes from `Outgoing::Datagram` in `send_updates`;
  `send_datagram` error count in `net.rs`; optionally under/over (u16) in the Update header (protocol bump). Client:
  `predictor.correct()`'s depth into a histogram; |pre − post| per body class in `#smooth`; per-frame |eₖ − eₖ₋₁| in
  `#draw`; ack lag, RTT samples, serverTick/part gaps (loss), resim time p99, all via `window.rlOnline()`.
- **Refactor for testability:** move online.ts's network core (`#sendInputs`, `#applyUpdates` / `#correct` / `#capture` /
  `#smooth`, `#watchHitches`, ping) into a DOM-free `client/src/net/session.ts` so T3/T4 run production code; the
  server side the server's own match since 2026-10-23 (design 5: the local host's module, `carball_host.wasm`, its input
  buffer, replication and compact state compiled from `server/src`), the client paced as a page (online.ts: 60 Hz frames
  of real time, the fixed step, the goal's slow motion), in place of a TS port of ServerConsume kept in parity through
  JSON vectors, whose opposite tick parity had hidden the refill below (§6: a 60 Hz client whose packets land just before
  odd ticks never ends its refill; the game's own rule).

### 13.1 Tests, ranked by value
| # | Test | Setup / profile | Measure | Expected values or bounds |
|---|---|---|---|---|
| T1 | **QUIC transport under loss** (finds G1) | game loop + `net::accept_loop` + 4/6 headless wtransport clients (`server/tests/end_to_end.rs` pattern) through the UDP relay; RTT {30, 100, 150} ms × loss {0, 1, 5} % × {2v2, 3v3}; all cars near the ball; 5 s warm-up + 60 s | server bytes/s per client; bytes received; update age above the run minimum `t_recv − (t0 + Δtick/120)` p50/p99/max and its trend; delivered update loss; `send_datagram` errors; input packets lost | delivered loss = configured ± 1 %; age p99 above minimum ≤ jitter p99 + 17 ms with **no growth**; steady bytes/s; report-only: the game's budget (2v2 ≤ 15 KB/s) fails until G1 |
| T2 | **Server input buffer** (deterministic Rust, `game.rs:2127-2196` pattern; virtual time; a client model sending the newest 10 frames from the consumed ack at 60/144/30 fps; NetSim upstream) | profiles (a)–(i) below | under, over, repeated, zeroed; buffer_size(t); queue length; ack lag; frames never consumed; jump taps applied | (a) constant 50 ms, no loss: after 2 s under = over = 0 for 60 s, size 7, queue 5–9, ack lag 7 ± 2. (b) 144/30 fps clients: size 7, under = over = 0 **after the jitter warm-up** (at 30 fps the 33 ms gaps raise the target to ≈ 9–12 for ≈ 20–30 s; the before-merge queue can't reach it, so refill skips and double consumes alternate ≈ 40/s each until the target is back to 7; the game's own rule, TA:24704–24718 + TA:71134; measured by the main session's T2). (c) i.i.d. jitter σ = 5/10/20 ms: size equal to a reference JitterBuffer fed the same newest-timestamp arrivals; ≈ 7 / 8 / ≈ 13 ± 2; under ≤ 1 per minute after the 30 s warm-up for σ ≤ 10 ms. (d) a 150 ms stall per minute: size 7 → 11 at once, ≈ 13 repeated ticks, then the burst (skip ticks leave LastProcessedReceivedFrame alone, so all held frames are consumed: queue ≈ 25 vs 11) gives **over ≈ 10–14** (measured 10), back to 7 in ≈ 25–30 s, no hitch reset. (e) loss 1/5 %: frames never consumed 0 at 60 fps; at 30 fps ≈ 0.36 / 9.5 per minute; size 7; under ≈ 0 / ≤ 1 per minute. (f) reorder/duplication 5 %: consumption sequence = the clean run; jitter sampled only on newer timestamps. (g) 300 ms client hitch: size 18, reset 2 s later → 7 at the next packet (without it > 7 after 30 s); rate limit holds. (h) 1.2 s upstream outage: the zero-input timeout counts from the last packet's **arrival** (RealTime − LastPacketTime > 1.0), but repeats start only when the ≈ 7–8 queued frames run out, so **repeated ≈ 112** (measured), the rest zeroed, then fill mode. (i) 1-tick jump taps under σ = 20: server jumps = taps (NET-2) |
| T3 | **Client prediction and correction** (vitest + Node engine; extend `client/src/net/predictor.test.ts:50-124`; TS ServerConsume; NetSim both ways; `session.ts`; 2 bot cars; 60 s) | RTT 30/100/150; loss; reorder/dup | local mispredictions per minute; resim depth histogram; CS-1 error at capture p50/p99 per class; ignoredOld, resyncs; local component flips per correction (G11); resim ms p99 | no loss, constant RTT: **0 local mispredictions** after warm-up, local error exactly 0; depth in [RTT·120 + 5, RTT·120 + 12] (100 ms → 17–24), always ≤ 119; ignoredOld = resyncs = 0. Generally: local mispredictions = under episodes + over events + lost input frames (model). Downstream loss 1/5 %: local mispredictions unchanged. Reordered/duplicated updates: the same final world (NR-6) |
| T4 | **Smoothing invariants** (CS) | the T3 correction stream at 60 and 144 fps | drawn pose at correction; per-frame steps | the drawn pose is unchanged by a correction before the decay (≤ 1e-3 uu, 1e-5 rad); per-frame step = min(dt·4, 1)·\|e\| and min(dt·5, 1)·angle (6.67 % / 8.33 % at 60 fps, 2.78 % / 3.47 % at 144 fps), so drawn-jump p99 ≤ 0.0667·p99(\|e\|); TV-1/2/5 exact except the last frame (ours 0 vs the game's 0.304 uu, G13); a spawn-counter change is not smoothed; dt dilated after a goal |
| T5 | **Remote input model A/B** (decides G2 and G1-3) | remote inputs from replay streams or human logs; RTT 50/100/150; our cadence vs the game's (cars 13.4/s, ball 35/s); models (a) ours, (b) the game's rule, (c) the game's rule + our remote components | remote and ball CS error at capture p50/p99; drawn-jump p99 | decide by the numbers (the spec gives no bound) |
| T6 | **Bandwidth and cadence gate** (deterministic Rust; 4/6 players near and away from the ball; `game.rs:1438-1495`) | – | per-actor send rates; datagram sizes; KB/s | today: ball 60/s, near cars 60/s, far cars and pads 15/s, no datagram > 1100 B, 2v2 ≈ 45–60 KB/s, 3v3 ≈ 95–140 KB/s; after G1: car ≤ ~40 B, 2v2 ≤ 15 KB/s |
| T7 | **Stalls, direct applies, hidden tab** | client stalls 0.3 / 2 / 10 s | direct applies (formerly resyncs); queued parts; resets; server buffer | one run of direct applies per stall longer than ≈ (queue + 5)/120 s (ack ahead), then normal acks; ≤ 120 queued parts (NR-4); one reset 2 s later; server buffer 7 → 18 → 7 |
| T8 | **Timeouts** | outages | zero input; icon timing; lost connection; recovery | zero input exactly 1.0 s after the last packet; disconnected icon at 0.8 s (+ ≤ 0.35 s poll), never before 15 s, cleared within one poll of resumed updates; QUIC idle "lost connection" (already `server/tests/end_to_end.rs:111`); a 3 s two-way outage recovers with one smoothed correction and no resync storm |
| T9 | **Ack, RTT and ping** | RTT profiles; reordered acks | ping; corrections | our ping in [RTT, RTT + 17 ms] at 60 fps; an old reordered ack still corrects consistently; after G6 the filter vectors (first sample min(N, 0.3); clamp at 3× when N > 2×; time constant ≈ 100 samples; others' pings multiples of 4, refreshed ≤ every 4 s) |
| T10 | **Connection Quality** (after G4) | scripted stats | statuses | every threshold; 1.5 s hysteresis (worse at once); entry order [Disconnected, Server, Packet, Jitter, Latency]; default on |
| T11 | **No-pawn prediction** (after G5) | demolition at RTT 100 | resim depth | depth 0 while demolished with smoothing on; after respawn back to RTT·120 + 7 |
| T12 | **Nightly end-to-end smoke** | Playwright + a Node UDP relay (the fixture serves its own `/info` with the relay port and the real certificate hash); 100 ms RTT, 10 ms jitter, 2 % loss | ping; mispredictions; buffer; errors | ping 100–140 ms; local mispredictions / corrections < 5 %; buffer target ≤ 9; no page errors |

Unverified [I]: the wtransport 0.7 / quinn defaults for datagram send buffering and congestion control (their source is in
the cargo registry outside the repo; check them in the repo's vendored or documented API before G1-2).
