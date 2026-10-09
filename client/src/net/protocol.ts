// The game protocol: see protocol/README.md. Byte-exact samples in protocol/vectors.json (shared with the Rust
// server's tests).

// 2: kickoff countdown in the state; 3: the wheels' previous contacts; 4: the jump's release; 5: respawn spot selection
// and flip resets in the state; 6: spawn counters in the state, the match message; 7: the engine turns the ball (its
// orientation is simulated state: the network state's format is unchanged); 8: the bodies' inverse inertia tensors;
// 9: the goal replay (its phase, plan and skip votes; Hello's auto-skip)
export const PROTOCOL_VERSION = 9;
export const MAX_INPUT_FRAMES = 10;

export type GameEvent =
  | { readonly kind: "goal"; readonly team: number }
  | { readonly kind: "demo"; readonly attacker: number; readonly victim: number };

/** Where a match is (the game's GameEvent_Soccar_TA states) */
export type MatchPhase = "countdown" | "active" | "postGoal" | "timeUp" | "ended" | "replay";
const MATCH_PHASES: readonly MatchPhase[] = ["countdown", "active", "postGoal", "timeUp", "ended", "replay"];

/** A goal replay (server ticks; ReplayDirector_TA: notes/camera-respawn-goal.md GS-7..9) */
export interface ReplayPlan {
  /** First recorded tick shown (GetReplayStartTime) */
  readonly startTick: number;
  readonly goalTick: number;
  /** The recording's end: the goal + PostGoalTime */
  readonly endTick: number;
  readonly scoringTeam: number;
  /** Stretches played at 0.25 speed (from, to: exclusive), in order: round the scoring hit (-0.25, +0.1 s), and before
   *  the goal when a defender was close (-0.25 s) */
  readonly slomo: readonly (readonly [number, number])[];
  /** Whom the camera follows with the ball, until when: each run of touches by one car up to the scoring touch */
  readonly focus: readonly { readonly car: number; readonly tick: number }[];
}

/** The match's state: sent when it changes and each second while the clock runs */
export interface MatchState {
  readonly serverTick: number;
  readonly phase: MatchPhase;
  /** Sudden death: clockTicks counts up from the start of overtime */
  readonly overtime: boolean;
  readonly clockRunning: boolean;
  /** Regulation: ticks left (120 per second); overtime: ticks played */
  readonly clockTicks: number;
  readonly score: readonly [number, number];
  readonly winner: number | null;
  /** The match ended because the losing team left (none of its players remained) */
  readonly forfeit: boolean;
}

export type ControlMessage =
  | {
      readonly type: "hello";
      readonly version: number;
      readonly team: number; // 0 blue, 1 orange, 255 any
      readonly body: number;
      readonly dodgeDeadzone: number;
      readonly steeringSensitivity: number;
      readonly airControlSensitivity: number;
      /** Skips every goal replay (bAutoSkipGoalReplay) */
      readonly autoSkipReplay: boolean;
    }
  /** Skip the goal replay (ReadyUp: Space / pad A); counts only during one */
  | { readonly type: "readyUp" }
  /** The auto-skip setting changed (turned on during a replay, it readies the player) */
  | { readonly type: "autoSkipReplay"; readonly on: boolean }
  | {
      readonly type: "welcome";
      readonly version: number;
      readonly carId: number;
      readonly tickRate: number;
      readonly frame: number;
      readonly snapshot: Uint8Array;
    }
  /** The client had a hitch (over 0.1 s between its ticks) 2 s ago: the server resets its jitter buffer
   *  (NetworkInputBuffer_TA.ClientTick -> ServerResetInputBuffer) */
  | { readonly type: "resetInputBuffer" }
  | { readonly type: "world"; readonly frame: number; readonly snapshot: Uint8Array }
  | { readonly type: "event"; readonly serverTick: number; readonly event: GameEvent }
  | ({ readonly type: "match" } & MatchState)
  /** The goal replay starts: what to play from this client's own recording */
  | ({ readonly type: "replay" } & ReplayPlan)
  /** How many players are ready to skip the goal replay, of how many */
  | { readonly type: "replayReady"; readonly ready: number; readonly total: number };

/** One frame of inputs as sent: axes in 1/127 steps, bits for the buttons. */
export interface InputFrame {
  readonly throttle: number; // -127..127
  readonly steer: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
  /** The dodge's forward input: -pitch made a byte on its own (q(-p), not -q(p): VehicleInput.DodgeForward) */
  readonly dodgeForward: number;
  readonly bits: number;
}

export const BIT_JUMP = 1;
export const BIT_BOOST = 2;
export const BIT_HANDBRAKE = 4;
export const BIT_AIR_PITCH_SAFETY = 8;

export interface Update {
  readonly serverTick: number;
  readonly ackFrame: number;
  readonly receivedFrame: number;
  readonly echoTimestamp: number;
  readonly echoDelay: number;
  readonly bufferTarget: number;
  readonly bufferSize: number;
  readonly part: number;
  readonly parts: number;
  readonly state: Uint8Array;
}

export type DatagramMessage =
  | { readonly type: "inputs"; readonly timestamp: number; readonly firstFrame: number; readonly frames: readonly InputFrame[] }
  | ({ readonly type: "update" } & Update);

/** Round half to even (the game's float-to-int conversion) */
function roundHalfEven(x: number): number {
  const r = Math.round(x); // (half up)
  return x - Math.floor(x) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * An input axis as the game's input byte (Vehicle_TA.SetVehicleInput): q = round(v × 127) for v ≥ 0 and round(v × 128)
 * below, halves up, in 32-bit float arithmetic like the game. -128..127.
 */
export function quantizeAxis(v: number): number {
  const x = Math.fround(Math.max(-1, Math.min(1, v)));
  const f = x < 0 ? Math.max(Math.fround(x * 128), -128) : Math.min(Math.fround(x * 127), 127);
  const y = Math.fround(f + 128);
  const q = (roundHalfEven(Math.fround(Math.fround(y + y) + 0.5)) >> 1) - 128;
  return q === 0 ? 0 : q; // (no -0)
}

/** q / 127 (q ≥ 0) or q / 128 as a 32-bit float: exactly what the engine applies */
export function dequantizeAxis(q: number): number {
  return q < 0 ? Math.fround(q * 0.0078125) : Math.fround(q / 127);
}

export class DecodeError extends Error {}

class Writer {
  #bytes: number[] = [];
  #view = new DataView(new ArrayBuffer(4));
  u8(v: number): void {
    this.#bytes.push(v & 0xff);
  }
  i8(v: number): void {
    this.#bytes.push(v & 0xff);
  }
  u16(v: number): void {
    this.#view.setUint16(0, v, true);
    this.#push(2);
  }
  u32(v: number): void {
    this.#view.setUint32(0, v >>> 0, true);
    this.#push(4);
  }
  f32(v: number): void {
    this.#view.setFloat32(0, v, true);
    this.#push(4);
  }
  bytes(b: Uint8Array): void {
    for (const x of b) this.#bytes.push(x);
  }
  #push(n: number): void {
    for (let i = 0; i < n; i++) this.#bytes.push(this.#view.getUint8(i));
  }
  done(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

class Reader {
  #view: DataView;
  #pos = 0;
  constructor(readonly bytes: Uint8Array) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  #need(n: number): number {
    if (this.#pos + n > this.bytes.byteLength) throw new DecodeError("message truncated");
    const at = this.#pos;
    this.#pos += n;
    return at;
  }
  u8(): number {
    return this.#view.getUint8(this.#need(1));
  }
  i8(): number {
    return this.#view.getInt8(this.#need(1));
  }
  u16(): number {
    return this.#view.getUint16(this.#need(2), true);
  }
  u32(): number {
    return this.#view.getUint32(this.#need(4), true);
  }
  f32(): number {
    return this.#view.getFloat32(this.#need(4), true);
  }
  take(n: number): Uint8Array {
    const at = this.#need(n);
    return this.bytes.slice(at, at + n);
  }
  rest(): Uint8Array {
    return this.take(this.bytes.byteLength - this.#pos);
  }
}

/** A control message with its u16 length prefix, ready for the control stream. */
export function encodeControl(m: ControlMessage): Uint8Array {
  const w = new Writer();
  switch (m.type) {
    case "hello":
      w.u8(0x01);
      w.u16(m.version);
      w.u8(m.team);
      w.u8(m.body);
      w.f32(m.dodgeDeadzone);
      w.f32(m.steeringSensitivity);
      w.f32(m.airControlSensitivity);
      w.u8(m.autoSkipReplay ? 1 : 0);
      break;
    case "resetInputBuffer":
      w.u8(0x02);
      break;
    case "readyUp":
      w.u8(0x03);
      break;
    case "autoSkipReplay":
      w.u8(0x04);
      w.u8(m.on ? 1 : 0);
      break;
    case "replay":
      w.u8(0x85);
      w.u32(m.startTick);
      w.u32(m.goalTick);
      w.u32(m.endTick);
      w.u8(m.scoringTeam);
      w.u8(Math.min(m.slomo.length, 255));
      for (const [from, to] of m.slomo.slice(0, 255)) {
        w.u32(from);
        w.u32(to);
      }
      w.u8(Math.min(m.focus.length, 255));
      for (const { car, tick } of m.focus.slice(0, 255)) {
        w.u32(car);
        w.u32(tick);
      }
      break;
    case "replayReady":
      w.u8(0x86);
      w.u8(m.ready);
      w.u8(m.total);
      break;
    case "welcome":
      w.u8(0x81);
      w.u16(m.version);
      w.u32(m.carId);
      w.u8(m.tickRate);
      w.u32(m.frame);
      w.u32(m.snapshot.byteLength);
      w.bytes(m.snapshot);
      break;
    case "world":
      w.u8(0x82);
      w.u32(m.frame);
      w.u32(m.snapshot.byteLength);
      w.bytes(m.snapshot);
      break;
    case "event":
      w.u8(0x83);
      w.u32(m.serverTick);
      if (m.event.kind === "goal") {
        w.u8(0);
        w.u8(m.event.team);
      } else {
        w.u8(1);
        w.u32(m.event.attacker);
        w.u32(m.event.victim);
      }
      break;
    case "match":
      w.u8(0x84);
      w.u32(m.serverTick);
      w.u8(MATCH_PHASES.indexOf(m.phase));
      w.u8((m.overtime ? 1 : 0) | (m.clockRunning ? 2 : 0) | (m.forfeit ? 4 : 0));
      w.u32(m.clockTicks);
      w.u8(m.score[0]);
      w.u8(m.score[1]);
      w.u8(m.winner ?? 255);
      break;
  }
  const body = w.done();
  const framed = new Uint8Array(body.byteLength + 2);
  new DataView(framed.buffer).setUint16(0, body.byteLength, true);
  framed.set(body, 2);
  return framed;
}

/** Decodes one control message (without its length prefix). */
export function decodeControl(body: Uint8Array): ControlMessage {
  const r = new Reader(body);
  const type = r.u8();
  switch (type) {
    case 0x01:
      return {
        type: "hello",
        version: r.u16(),
        team: r.u8(),
        body: r.u8(),
        dodgeDeadzone: r.f32(),
        steeringSensitivity: r.f32(),
        airControlSensitivity: r.f32(),
        autoSkipReplay: r.u8() !== 0,
      };
    case 0x02:
      return { type: "resetInputBuffer" };
    case 0x03:
      return { type: "readyUp" };
    case 0x04:
      return { type: "autoSkipReplay", on: r.u8() !== 0 };
    case 0x85: {
      const startTick = r.u32();
      const goalTick = r.u32();
      const endTick = r.u32();
      const scoringTeam = r.u8();
      const slomo = Array.from({ length: r.u8() }, (): [number, number] => [r.u32(), r.u32()]);
      const focus = Array.from({ length: r.u8() }, () => ({ car: r.u32(), tick: r.u32() }));
      return { type: "replay", startTick, goalTick, endTick, scoringTeam, slomo, focus };
    }
    case 0x86:
      return { type: "replayReady", ready: r.u8(), total: r.u8() };
    case 0x81: {
      const version = r.u16();
      const carId = r.u32();
      const tickRate = r.u8();
      const frame = r.u32();
      return { type: "welcome", version, carId, tickRate, frame, snapshot: r.take(r.u32()) };
    }
    case 0x82: {
      const frame = r.u32();
      return { type: "world", frame, snapshot: r.take(r.u32()) };
    }
    case 0x83: {
      const serverTick = r.u32();
      const kind = r.u8();
      if (kind === 0) return { type: "event", serverTick, event: { kind: "goal", team: r.u8() } };
      if (kind === 1) return { type: "event", serverTick, event: { kind: "demo", attacker: r.u32(), victim: r.u32() } };
      throw new DecodeError(`unknown event kind ${String(kind)}`);
    }
    case 0x84: {
      const serverTick = r.u32();
      const phase = MATCH_PHASES[r.u8()];
      if (!phase) throw new DecodeError("unknown match phase");
      const flags = r.u8();
      const clockTicks = r.u32();
      const score = [r.u8(), r.u8()] as const;
      const winner = r.u8();
      return {
        type: "match",
        serverTick,
        phase,
        overtime: (flags & 1) !== 0,
        clockRunning: (flags & 2) !== 0,
        clockTicks,
        score,
        winner: winner === 255 ? null : winner,
        forfeit: (flags & 4) !== 0,
      };
    }
    default:
      throw new DecodeError(`unknown control message 0x${type.toString(16)}`);
  }
}

export function encodeDatagram(m: DatagramMessage): Uint8Array {
  const w = new Writer();
  if (m.type === "inputs") {
    w.u8(0x01);
    w.u32(m.timestamp);
    w.u32(m.firstFrame);
    w.u8(m.frames.length);
    for (const f of m.frames) {
      for (const axis of [f.throttle, f.steer, f.pitch, f.yaw, f.roll, f.dodgeForward]) w.i8(axis);
      w.u8(f.bits);
    }
  } else {
    w.u8(0x81);
    w.u32(m.serverTick);
    w.u32(m.ackFrame);
    w.u32(m.receivedFrame);
    w.u32(m.echoTimestamp);
    w.u16(m.echoDelay);
    w.u8(m.bufferTarget);
    w.u8(m.bufferSize);
    w.u8(m.part);
    w.u8(m.parts);
    w.bytes(m.state);
  }
  return w.done();
}

export function decodeDatagram(bytes: Uint8Array): DatagramMessage {
  const r = new Reader(bytes);
  const type = r.u8();
  if (type === 0x01) {
    const timestamp = r.u32();
    const firstFrame = r.u32();
    const count = r.u8();
    if (count > MAX_INPUT_FRAMES) throw new DecodeError("too many input frames");
    const frames: InputFrame[] = [];
    for (let i = 0; i < count; i++) {
      frames.push({ throttle: r.i8(), steer: r.i8(), pitch: r.i8(), yaw: r.i8(), roll: r.i8(), dodgeForward: r.i8(), bits: r.u8() });
    }
    return { type: "inputs", timestamp, firstFrame, frames };
  }
  if (type === 0x81) {
    return {
      type: "update",
      serverTick: r.u32(),
      ackFrame: r.u32(),
      receivedFrame: r.u32(),
      echoTimestamp: r.u32(),
      echoDelay: r.u16(),
      bufferTarget: r.u8(),
      bufferSize: r.u8(),
      part: r.u8(),
      parts: r.u8(),
      state: r.rest(),
    };
  }
  throw new DecodeError(`unknown datagram 0x${type.toString(16)}`);
}
