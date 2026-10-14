// The server's input buffer (server/src/input_buffer.rs: NetworkInputBuffer_ServerConsume_TA and its
// ClientJitterBuffer_TA), ported for the client's network tests (notes/netcode-live.md §13.0: a server in process). The
// jitter estimate in single precision as the Rust one's f32 (Math.fround each step), so the two agree to the frame;
// serverConsume.vectors.json (written by the Rust tests) checks it.
import type { InputFrame } from "../net/protocol";
import { BIT_JUMP } from "../net/protocol";

const TICK_RATE = 120;
const f = Math.fround;
const MIN_TIME_BETWEEN_PACKETS = f(0.016);
const MAX_TIME_BETWEEN_PACKETS = f(0.25);
const BUFFER_STD_DEVIATIONS = f(4);
const MIN_BUFFER_TIME = f(0.05);
const ROLLING_AVERAGE_TIME = f(15);
const TICK_SECONDS = f(1 / TICK_RATE);
const MAX_BUFFERED_FRAMES = TICK_RATE / 2;
const INPUT_TIMEOUT = 1;

export class JitterBuffer {
  #lastPacketTime: number | null = null;
  #mean = f(0.016);
  #variance = 0;
  bufferTime = 0;
  bufferSize = 7;

  /** Back to the initial estimate, keeping the last packet's time */
  reset(): void {
    this.#mean = f(0.016);
    this.#variance = 0;
    this.bufferTime = 0;
    this.bufferSize = 7;
  }

  receivedPacket(now: number): void {
    if (this.#lastPacketTime !== null) {
      const gap = Math.min(MAX_TIME_BETWEEN_PACKETS, Math.max(MIN_TIME_BETWEEN_PACKETS, f(now - this.#lastPacketTime)));
      const rate = Math.min(f(gap / ROLLING_AVERAGE_TIME), 1);
      this.#mean = f(this.#mean + f(f(gap - this.#mean) * rate));
      const jitter = f(gap - this.#mean);
      this.#variance = f(this.#variance + f(f(f(jitter * jitter) - this.#variance) * rate));
      this.bufferTime = Math.max(f(this.#mean + f(f(Math.sqrt(this.#variance)) * BUFFER_STD_DEVIATIONS)), MIN_BUFFER_TIME);
      this.bufferSize = Math.ceil(f(this.bufferTime / TICK_SECONDS)) + 1;
    }
    this.#lastPacketTime = now;
  }
}

export interface ConsumeStats {
  over: number;
  under: number;
  repeated: number;
  zeroed: number;
  fillSkips: number;
  consumed: number;
  neverConsumed: number;
  /** Late, duplicate and trimmed frames */
  dropped: number;
}

const NONE: InputFrame = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, dodgeForward: 0, bits: 0 };

export class ServerConsume {
  /** Received, not consumed; sorted, no duplicates */
  readonly #frames: { number: number; frame: InputFrame }[] = [];
  #lastProcessed: number | null = null;
  #lastConsumed = 0;
  lastReceived = 0;
  #lastPacketTime = 0;
  #newestTimestamp: number | null = null;
  filling = false;
  readonly jitter = new JitterBuffer();
  /** The frame the car drives with (repeated when none is buffered; zeroed after a second without packets) */
  frame: InputFrame = NONE;
  repressJump = false;
  #givenJump = false;
  readonly stats: ConsumeStats = { over: 0, under: 0, repeated: 0, zeroed: 0, fillSkips: 0, consumed: 0, neverConsumed: 0, dropped: 0 };

  get ackFrame(): number {
    return this.#lastProcessed ?? 0;
  }

  get length(): number {
    return this.#frames.length;
  }

  /** A packet of consecutive frames from `first`; whether it was the newest so far */
  receive(timestamp: number, first: number, frames: readonly InputFrame[], now: number): boolean {
    const newest = this.#newestTimestamp === null || ((timestamp - this.#newestTimestamp) | 0) > 0;
    if (newest) {
      this.#newestTimestamp = timestamp;
      this.#lastPacketTime = now;
      this.jitter.receivedPacket(now);
      if (this.filling && this.#frames.length >= this.jitter.bufferSize) this.filling = false;
    }
    frames.forEach((frame, i) => {
      const number = first + i;
      this.lastReceived = Math.max(this.lastReceived, number);
      if (this.#lastProcessed !== null && number <= this.#lastConsumed) {
        this.stats.dropped++;
        return;
      }
      let at = this.#frames.findIndex((x) => x.number >= number);
      if (at < 0) at = this.#frames.length;
      if (this.#frames[at]?.number === number) this.stats.dropped++;
      else this.#frames.splice(at, 0, { number, frame });
    });
    while (this.#frames.length > MAX_BUFFERED_FRAMES) {
      this.#frames.shift();
      this.stats.dropped++;
    }
    return newest;
  }

  #consumeOne(): void {
    const next = this.#frames.shift();
    if (!next) return;
    if (this.stats.consumed > 0 && next.number > this.#lastConsumed + 1) this.stats.neverConsumed += next.number - this.#lastConsumed - 1;
    this.stats.consumed++;
    this.frame = next.frame;
    this.#lastProcessed = next.number;
    this.#lastConsumed = next.number;
  }

  #skipOne(): void {
    if (this.#lastProcessed !== null) this.#lastProcessed++;
  }

  /** One server tick; `oddTick`: the server's physics frame is odd. The frame the car drives with, its jump as given */
  tick(now: number, oddTick: boolean): { frame: InputFrame; jump: boolean } {
    this.repressJump = false;
    const jumpOf = (frame: InputFrame): boolean => (frame.bits & BIT_JUMP) !== 0;
    const previous = jumpOf(this.frame);
    let first: boolean | null = null;
    let second = false;
    if (this.#frames.length === 0) {
      if (now - this.#lastPacketTime > INPUT_TIMEOUT) {
        this.frame = NONE;
        this.stats.zeroed++;
      } else this.stats.repeated++;
      this.filling = true;
      this.#skipOne();
      this.stats.under++;
    } else {
      if (!this.filling || !oddTick) {
        this.#consumeOne();
        first = jumpOf(this.frame);
      } else {
        this.#skipOne();
        this.stats.fillSkips++;
      }
      if (this.jitter.bufferSize < this.#frames.length) {
        this.#consumeOne();
        this.stats.over++;
        second = true;
      }
    }
    const last = jumpOf(this.frame);
    let jump: boolean;
    let released: boolean;
    if (first === null && !second) [jump, released] = [last, false];
    else if (first !== null && second && !previous && first && !last) [jump, released] = [true, true];
    else if (first !== null && second) [jump, released] = [last, !previous || !first];
    else [jump, released] = [last, !previous];
    this.repressJump = jump && released && this.#givenJump;
    this.#givenJump = jump;
    return { frame: this.frame, jump };
  }
}
