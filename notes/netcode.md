# Rocket League netcode (decoded)

Sources: UnrealScript from `TAGame.upk` (`scripts/ubytecode.py`; full disassembly in `out/decomp/netcode_script*.txt`,
local only) and native code (Ghidra, `out/decomp/`). Tuning values: `notes/physics-values.md` "Netcode".

## The model in one paragraph
The server is authoritative and simulates at 120 Hz. Each client simulates **ahead** of the server: it runs its
own physics at 120 Hz, numbers its frames, and uploads its inputs per frame. The server buffers each client's input
frames and consumes **one per server tick** (the client's frame numbers travel with them). The server replicates
rigid-body states (cars, ball) and acknowledges the last client frame it processed; the client treats all server
states in that packet as belonging to **that client frame**. If the server state differs from the client's history,
the client **rewinds** every predicted body to that frame (up to 120 frames back), puts in the server's states, and
**replays** to the present, re-applying its own recorded inputs and a fading guess of the other cars' inputs. The
client keeps the server's input buffer at a good size by running its clock slightly faster or slower.

## Frames and the physics loop (`EngineShare_TA`, native `FUN_140f4ec60`, every render frame, client and server)
```
dt = 1 / PhysicsFramerate                                        // 1/120
if DirtyPhysicsFrame != -1 (a correction is pending; client only, bEnableClientPrediction):
    PreClientCorrectionNotify(NumResimFrames = PhysicsFrame - DirtyPhysicsFrame)
    target = PhysicsFrame; PhysicsFrame = DirtyPhysicsFrame
    every predicted body (TickNotifies): restore its history snapshot at PhysicsFrame   // RBHistory vtbl+0x290
    while PhysicsFrame < target:
        every body: apply its history entry for PhysicsFrame+1 (inputs, component states)  // vtbl+0x298
        RunPhysicsFrame(dt)                                       // PhysicsFrame++
    DirtyPhysicsFrame = -1
every body: PreAsyncTick(DeltaTime); EventPreAsyncTick(DeltaTime)
scaled = DeltaTime; on a client: scaled = InputBuffer.ModifyDeltaTime(DeltaTime)   // sim-time scaling (below)
steps = min(fixed-step accumulator(scaled), MaxPhysicsSubsteps = 5); RenderAlpha = leftover / dt
repeat steps: RunPhysicsFrame(dt)
every input buffer: ServerTick() on the server, ClientTick() on a client
```
`MaxClientReplayFrames` = round(PhysicsFramerate) = 120 (set at startup, `FUN_140f03070`).

## Client → server: input upload (`NetworkInputBuffer_TA`)
- Each physics frame the client records an input frame `{VehicleInputs (32 bytes), Frame, TimeStamp}`.
- `ClientTick`: at `ConfiguredClientInputRate` per second (60 by default; settings Low/Medium/High = 20/40/60),
  sends the **unacknowledged** frames, at most `MaxInputFramesPerPacket` (10 = `NetworkConfig_TA.MaxClientUploadFrames`;
  STS: replicated buffer size + 2, at most `MaxUploadedClientFrames` 30), oldest dropped first, plus the camera
  location/rotation and `TimeStamp = RealTimeSeconds`, as the unreliable RPC `ServerReceivePacket`.
- Client hitch > 0.1 s between ticks → `ServerResetInputBuffer` 2 s later.
- Server, per packet: newer timestamp → updates the player's camera and `CurrentTimeStamp`; frames are merged into the
  player's buffer in frame order (`InputBufferUtil_TA.MergeFrames`: sorted, duplicates dropped), frames already
  processed are dropped, and the buffer is capped at PhysicsFramerate × 0.5 = 60 frames (oldest dropped).
- Server ack (each net update, `SendClientAdjustment` → `ClientAckFrame(TimeStamp, LastProcessedFrame, Stats)`): the
  client computes ping from echoed timestamps, sets `ReplicatedPhysicsFrame` from `LastProcessedFrame`, and drops
  acknowledged frames.

## Server: consuming inputs (one call per server physics tick per player; `FUN_140f1c080` → mode-specific)
`Consume` (`FUN_140eb6f80`): pops the oldest frame, `Car.SetVehicleInput(frame.Inputs)`,
`LastProcessedFrame = frame.Frame`. When no frame is available the car **keeps its previous input** and
`LastProcessedFrame += 1` (so late frames for that slot are dropped). No packet for > 1 s → all-zero input.
Splitscreen players follow the primary player's frame numbers.

Three modes, chosen by the player (`NetworkSave.NetworkInputBuffer`; menu "Default" / STS / CSTS):

**Default = `ServerConsume`** (`FUN_140f1e780`)
```
if buffer empty: bFillingBuffer = true; keep previous input; LastProcessedFrame++ (under-buffer)
else:
    if !bFillingBuffer: Consume                   // while filling, wait (keep previous input)
    if buffer > JitterBuffer.BufferSize: Consume again   // catch up: 2 frames this tick (over-buffer)
packet received: JitterBuffer.ReceivedPacket(); if filling and buffer >= BufferSize: bFillingBuffer = false
```
**STS (server-told sim time)** (`FUN_140f1e5e0`): always one frame per tick.
- Buffer empty (and the client is still sending, last packet < 0.25 s ago, no adjustment in the last second):
  tell the client to add **+1 frame** of sim time (`NotifyClientAdjustSimTime(1)`).
- Every 10 s (`InputBufferTightenUpSizeFrequency`), with no miss and no adjustment in that window: if the lowest
  buffer level seen exceeds 2 frames, tell the client −(low − 2) frames.
- Jitter-buffer size changes by a frame or more → tell the client the difference.
- Client (`ModifyDeltaTime`): runs its clock `FixedAdjustSimTimeRate` (0.009, clamped 0.001–0.05) faster or slower
  until the requested frames are gained or lost, then `ServerFinishedSimTimeAdjust`.

**CSTS (continuous sim-time scaling)** (`FUN_140f1e510`): one frame per tick; two when the buffer is at least
`Inputs_Max` (20) + ExtraBuffer. Every ack carries a saturation level computed on (buffer − ExtraBuffer):
≥14 → 4, ≥6 → 3, ≥4 → 2, ≥2 → 1, else 0; the client scales its frame time by
`TimeDilations[level]` = {1.0256, 1.0063, 1.0, 0.9938, 0.9756}. ExtraBuffer: every second, record
(lowest buffer level − ExtraBuffer), where misses count as −(consecutive misses); over the last 30 s,
ExtraBuffer = clamp(−min, 0, 8).

**Jitter buffer** (`ClientJitterBuffer_TA`, per packet received):
```
gap = clamp(now - lastPacket, 0.016, 0.25); rate = min(gap / 15, 1)
mean = lerp(mean, gap, rate); var = lerp(var, (gap - mean)^2, rate)
BufferTime = max(mean + 4 * sqrt(var), 0.05); BufferSize = ceil(BufferTime * 120) + 1      // start: 7 frames
```
(STS keeps a new size only if it grew or the buffer time moved by at least one frame.)

## Server → client: state replication
- Replicated per body: `ReplicatedRBState {Quaternion, Location, LinearVelocity, AngularVelocity, Time, bSleeping,
  bNewData}` (quantized like every tick: `bQuantizePhysics`), car components' active state, remote cars' inputs.
- Rates: server net tick ≤ 57 Hz (`ServerConfig_X.NetServerMaxTickRate`). Cars `NetUpdateFrequency` **15 Hz**, but a
  car within **1000 uu of the ball** is forced into every update (`ForceNetPacketIfNearBall`,
  `NetworkConfig_TA.bForceNetPackets`, `ForcePacketSignificantDistance`). The ball uses the default rate (every tick).
  (The client's incoming replication-rate options come from `TcpNetDriver` ini values not in this install.)

## Client: prediction and correction (`RBHistory_TA`, `RBVehicleHistory_TA`)
Every predicted body keeps a ring buffer of per-frame snapshots: rigid-body state, world contact, physics volume;
cars also store their inputs, the four wheels' contact data, car-interaction data, handbrake output, last ball-hit
frame and each component's active/time. Snapshots are recorded every frame.

When a server state arrives (`FUN_140f196e0`): find the history entry for `ReplicatedPhysicsFrame`; overwrite it
with the server state; if it **differs** (see below) and the frame is in the past, `DirtyPhysicsFrame =
min(DirtyPhysicsFrame, ReplicatedPhysicsFrame)`. Differs: by default (`PhysicsConfig.bUseNEQ` off) **any** received
state counts; with `bUseNEQ` the state must differ by more than `NetworkSyncSettings`: location 5 uu, any rotation
axis 100 units (0.55°), velocity 10 uu/s, or the sleeping flag. Component states that differ from history are
patched from that frame on and also mark the frame dirty.

**Other players' cars** (`RBVehicleHistory_TA` vtbl+0x288): when a remote car's replicated input differs from its
history at the server frame, its throttle, steer, pitch, yaw and roll for every later frame become the replicated
value × (1 − min(1, (frame − serverFrame) / 120 / `InputFadeTime`)) with `InputFadeTime` = 0.1 s: they fade to zero
over 12 frames. Handbrake is copied without fading. The local car replays its own recorded inputs exactly.

Visual smoothing: `RBActor_TA.SyncErrorLocation` / `SyncErrorAngle` with `NetworkSyncSettings.LocationFixRate` 4 and
`AngularFixRate` 5 (not decoded in detail).

## What this means for our version
Our engine already has what this design needs: bit-exact snapshots and in-place loads in microseconds (rollback),
and native == WebAssembly determinism (so a client replaying the server's inputs gets the server's result exactly).
- Server: authoritative 120 Hz, one input frame per player per tick, the game's buffering (default mode first).
- Client: run ahead, upload inputs (60 Hz, up to 10 unacked frames per packet), keep a snapshot ring (120 frames),
  rewind on server data and replay; remote cars' inputs faded over 0.1 s.
- Sim-time scaling: CSTS or STS keeps the server buffer near target.

Implemented (step 3): `server/` (input buffer, update rates) and `client/src/net/predictor.ts` (history, rewind and
replay, input fading). One consequence of `ServerConsume` worth knowing: when the buffer is empty the server repeats
the last input and still advances `LastProcessedFrame`; when it catches up it consumes two frames in one tick. Either
way the server's state for a frame number is then one tick off the client's, so the next correction changes the
local car once, after which the two timelines line up again.

Client resync (ours): when a client falls behind real time (a stalled or background tab), the server keeps moving its
`LastProcessedFrame` on with repeated input, so updates arrive for frames the client hasn't simulated. The predictor
then takes the server's state as the present and continues from that frame (`Predictor` `#resync`; unit test "catches
up after stalling"). Before this, the client ignored those updates and never caught up.

From the static session's netcode audit (notes/netcode-audit.md), 2026-10-08:
- **Corrections are smoothed for drawing (N-1).** As the game's RBActor sync error: a correction adds
  (predicted − corrected) to a per-body offset that the body (and the camera following it) is drawn with, decaying
  each frame by min(dt × 4, 1) of itself for the position and × 5 for the rotation, snapping to 0 below 0.1 uu² and
  0.001 rad (`RBActor_TA.NetworkSyncSettings`). The interpolation's previous tick moves with the correction, so the
  drawn pose doesn't jump. Teleports (over 500 uu: kickoffs, respawns), demolitions, resyncs and world reloads aren't
  smoothed. `client/src/game/syncError.ts` (unit test: a 100 uu correction moves at most 6.7 uu in the first frame at
  60 fps, 1.6 uu are left after 60 frames, none after 83).
- **Hitch reset (N-2).** After a frame over 0.1 s the client sends `ResetInputBuffer` 2 s later (2 s after the last
  of several), and the server's jitter buffer starts over from its initial estimate (mean 0.016 s, variance 0, size
  7; `NetworkInputBuffer_TA.ClientTick` → `ServerResetInputBuffer`). Before, one 300 ms gap kept the buffer at
  ~18 frames, still 9 after 30 s.
- **Lost parts (N-3).** An update split over several datagrams applies the parts that came when one is lost (each
  part is a complete state for its bodies; at the end of the client's frame). Before, the whole update was dropped.
  Not done: the size of the car state (~273–373 B per car; the game's is ~250 B per update in all).
- **Remote cars' input basis (N-5, a bug).** A correction re-anchored every other car's predicted inputs, also cars
  not in that update (their own faded prediction), so their inputs never faded out; now only the cars in the update
  (`NetState::Read` reports them).
- Not done: server-confirmed demolitions (N-4, the game's clients predict only a bump), resending until received
  rather than consumed (N-9), correcting from an ack older than the history (N-10).

