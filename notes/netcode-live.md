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

## 11. Replication and the Connection Quality indicator
(Pending: sub-agent NL2.)

## 12. Gap list against our server and client
(Pending: sub-agent NL3.)

## 13. Test plan (in-process network tests)
(Pending: sub-agent NL3.)
