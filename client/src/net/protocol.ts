// The game protocol: see protocol/README.md. Byte-exact samples in protocol/vectors.json (shared with the Rust
// server's tests).

// 2: kickoff countdown in the state; 3: the wheels' previous contacts; 4: the jump's release; 5: respawn spot selection
// and flip resets in the state; 6: spawn counters in the state, the match message; 7: the engine turns the ball (its
// orientation is simulated state: the network state's format is unchanged); 8: the bodies' inverse inertia tensors;
// 9: the goal replay (its phase, plan and skip votes; Hello's auto-skip); 10: forfeit votes, the match type, a leaver's
// car, no contest; 11: quick chat, players' names (the roster), a leave's reason; 12: whether a leaver's car explodes
export const PROTOCOL_VERSION = 12;
/** A name's bytes at most (UTF-8) */
export const MAX_NAME_BYTES = 32;
export const MAX_INPUT_FRAMES = 10;

export type GameEvent =
  | { readonly kind: "goal"; readonly team: number }
  | { readonly kind: "demo"; readonly attacker: number; readonly victim: number }
  /** A player left; `lost`: their connection timed out (the chat log's "lost connection"); `explode`: their car explodes
   *  where it is (Car.Demolish(None): no demolition counted), not when already demolished or in the goal replay */
  | { readonly kind: "left"; readonly car: number; readonly lost: boolean; readonly explode: boolean };

/** A player's quick-chat filter (EChatFilter, CHAT-18) */
export type ChatFilter = "everyone" | "team" | "friends" | "off";
const CHAT_FILTERS: readonly ChatFilter[] = ["everyone", "team", "friends", "off"];

/** A player as the others know them */
export interface RosterEntry {
  readonly car: number;
  readonly team: number;
  readonly name: string;
}

/** The match type (MatchType_TA): the forfeit rules and the vote's label */
export type MatchType = "casual" | "ranked" | "private";
const MATCH_TYPES: readonly MatchType[] = ["casual", "ranked", "private"];

/** A team's forfeit vote as one of its players sees it (Team_TA.ForfeitVote) */
export interface ForfeitVote {
  /** A finished vote stays 5 game s */
  readonly state: "running" | "passed" | "failed" | "none";
  readonly yes: number;
  /** The votes it needs: the team's players (unanimous) */
  readonly required: number;
  /** Game seconds left of its 20 (TimeRemaining) */
  readonly secondsLeft: number;
  /** This player voted */
  readonly voted: boolean;
  /** This player may start a vote (one start each, until every teammate has started one) */
  readonly canStart: boolean;
}
const VOTE_STATES: readonly ForfeitVote["state"][] = ["running", "passed", "failed", "none"];

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
  /** The match ended by a forfeit: a team voted to, or left (none of its players remained) */
  readonly forfeit: boolean;
  /** Forfeit votes are allowed now (bCanVoteToForfeit: no winner yet, 60 s (casual) or 90 s of the clock gone, or
   *  overtime) */
  readonly canVoteForfeit: boolean;
  /** The match ended with no contest: every team left (ForceNoContest) */
  readonly noContest: boolean;
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
      /** The key the server gave this client before (its Welcome's), kept across its reconnects (who started a forfeit
       *  vote: ForfeitInitiatorIDs); 0 for none */
      readonly key: number;
      /** The player's name (MAX_NAME_BYTES of UTF-8 at most; the server tidies it) */
      readonly name: string;
    }
  /** A quick-chat preset (ServerSay_TA with bPreset): its index in the 76, to the team or all */
  | { readonly type: "quickChat"; readonly preset: number; readonly team: boolean }
  /** The player's chat filters (ServerSetQuickChatFilter, ServerSetTacticalChatFilter) */
  | { readonly type: "chatFilter"; readonly quickChat: ChatFilter; readonly blockNonTactical: boolean }
  /** Skip the goal replay (ReadyUp: Space / pad A); counts only during one */
  | { readonly type: "readyUp" }
  /** The auto-skip setting changed (turned on during a replay, it readies the player) */
  | { readonly type: "autoSkipReplay"; readonly on: boolean }
  /** Vote to forfeit (PRI.ServerVoteToForfeit): starts the team's vote, or joins it as a yes */
  | { readonly type: "voteForfeit" }
  | {
      readonly type: "welcome";
      readonly version: number;
      readonly carId: number;
      readonly tickRate: number;
      readonly frame: number;
      readonly matchType: MatchType;
      /** The playlist's team size */
      readonly teamSize: number;
      /** This player's key (Hello's again if it was this server's and no one here has it, else a new one) */
      readonly key: number;
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
  | { readonly type: "replayReady"; readonly ready: number; readonly total: number }
  /** This player's team's forfeit vote, when it changes */
  | ({ readonly type: "forfeitVote" } & ForfeitVote)
  /** The players: each one's car, team and name, when it changes */
  | { readonly type: "roster"; readonly players: readonly RosterEntry[] }
  /** A quick-chat line (ChatMessage_TA): the sender's car, the preset, team or all, the clock's shown seconds at relay */
  | { readonly type: "chat"; readonly car: number; readonly preset: number; readonly team: boolean; readonly seconds: number }
  /** This player's chat is blocked by the spam filter for this long (ClientNotifyChatDisabled) */
  | { readonly type: "chatBlocked"; readonly seconds: number }
  /** The join was refused (0: the match has its most players), instead of a welcome; the session ends */
  | { readonly type: "refused"; readonly reason: number };

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
  /** A short UTF-8 string: its byte count, then its bytes (MAX_NAME_BYTES at most, cut at a character) */
  name(s: string): void {
    let b = new TextEncoder().encode(s);
    if (b.byteLength > MAX_NAME_BYTES) {
      let end = MAX_NAME_BYTES;
      while (end > 0 && ((b[end] ?? 0) & 0xc0) === 0x80) end--; // (a continuation byte: back to the character's start)
      b = b.slice(0, end);
    }
    this.u8(b.byteLength);
    this.bytes(b);
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
  name(): string {
    return new TextDecoder().decode(this.take(this.u8()));
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
      w.u32(m.key);
      w.name(m.name);
      break;
    case "quickChat":
      w.u8(0x06);
      w.u8(m.preset);
      w.u8(m.team ? 1 : 0);
      break;
    case "chatFilter":
      w.u8(0x07);
      w.u8(CHAT_FILTERS.indexOf(m.quickChat));
      w.u8(m.blockNonTactical ? 1 : 0);
      break;
    case "roster":
      w.u8(0x88);
      w.u8(Math.min(m.players.length, 255));
      for (const p of m.players.slice(0, 255)) {
        w.u32(p.car);
        w.u8(p.team);
        w.name(p.name);
      }
      break;
    case "chat":
      w.u8(0x89);
      w.u32(m.car);
      w.u8(m.preset);
      w.u8(m.team ? 1 : 0);
      w.u16(m.seconds);
      break;
    case "chatBlocked":
      w.u8(0x8a);
      w.f32(m.seconds);
      break;
    case "refused":
      w.u8(0x8b);
      w.u8(m.reason);
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
    case "voteForfeit":
      w.u8(0x05);
      break;
    case "forfeitVote":
      w.u8(0x87);
      w.u8(VOTE_STATES.indexOf(m.state));
      w.u8(m.yes);
      w.u8(m.required);
      w.u8(m.secondsLeft);
      w.u8((m.voted ? 1 : 0) | (m.canStart ? 2 : 0));
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
      w.u8(MATCH_TYPES.indexOf(m.matchType));
      w.u8(m.teamSize);
      w.u32(m.key);
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
      } else if (m.event.kind === "demo") {
        w.u8(1);
        w.u32(m.event.attacker);
        w.u32(m.event.victim);
      } else {
        w.u8(2);
        w.u32(m.event.car);
        w.u8((m.event.lost ? 1 : 0) | (m.event.explode ? 2 : 0));
      }
      break;
    case "match":
      w.u8(0x84);
      w.u32(m.serverTick);
      w.u8(MATCH_PHASES.indexOf(m.phase));
      w.u8((m.overtime ? 1 : 0) | (m.clockRunning ? 2 : 0) | (m.forfeit ? 4 : 0) | (m.canVoteForfeit ? 8 : 0) | (m.noContest ? 16 : 0));
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
        key: r.u32(),
        name: r.name(),
      };
    case 0x06:
      return { type: "quickChat", preset: r.u8(), team: r.u8() !== 0 };
    case 0x07: {
      const quickChat = CHAT_FILTERS[r.u8()];
      if (!quickChat) throw new DecodeError("unknown chat filter");
      return { type: "chatFilter", quickChat, blockNonTactical: r.u8() !== 0 };
    }
    case 0x88: {
      const players = Array.from({ length: r.u8() }, () => {
        const car = r.u32();
        const team = r.u8();
        return { car, team, name: r.name() };
      });
      return { type: "roster", players };
    }
    case 0x89: {
      const car = r.u32();
      const preset = r.u8();
      const team = r.u8() !== 0;
      return { type: "chat", car, preset, team, seconds: r.u16() };
    }
    case 0x8a:
      return { type: "chatBlocked", seconds: r.f32() };
    case 0x8b:
      return { type: "refused", reason: r.u8() };
    case 0x02:
      return { type: "resetInputBuffer" };
    case 0x03:
      return { type: "readyUp" };
    case 0x04:
      return { type: "autoSkipReplay", on: r.u8() !== 0 };
    case 0x05:
      return { type: "voteForfeit" };
    case 0x87: {
      const state = VOTE_STATES[r.u8()];
      if (!state) throw new DecodeError("unknown vote state");
      const yes = r.u8();
      const required = r.u8();
      const secondsLeft = r.u8();
      const flags = r.u8();
      return { type: "forfeitVote", state, yes, required, secondsLeft, voted: (flags & 1) !== 0, canStart: (flags & 2) !== 0 };
    }
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
      const matchType = MATCH_TYPES[r.u8()];
      if (!matchType) throw new DecodeError("unknown match type");
      const teamSize = r.u8();
      const key = r.u32();
      return { type: "welcome", version, carId, tickRate, frame, matchType, teamSize, key, snapshot: r.take(r.u32()) };
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
      if (kind === 2) {
        const car = r.u32();
        const flags = r.u8();
        return { type: "event", serverTick, event: { kind: "left", car, lost: (flags & 1) !== 0, explode: (flags & 2) !== 0 } };
      }
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
        canVoteForfeit: (flags & 8) !== 0,
        noContest: (flags & 16) !== 0,
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
