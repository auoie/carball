// The local match's bots: each a player of the host's match (it joins with a hello, as a client does) whose controls a
// brain gives after every tick from the whole match's state, loaded into a world of its own (the engine's: the cars'
// flags, the pads' timers, as a client's prediction sees them). A brain keeps its own schedule (a package's: its tick
// skip, its tracker of every tick, bots/driver.ts). Brains: a bot package's policy (bots/), or the built-in ball chaser
// (the tests', and a stand-in while no package is there).
import type { World } from "../engine/world";
import type { Vec3 } from "../math/vec";
import { PROTOCOL_VERSION, encodeControl } from "../net/protocol";
import type { BotControls, LocalHost } from "./host";
import type { BotSlot } from "./hostMessages";

/** A car as a bot sees it (world.ts CarState's names and units) */
export interface BotCar {
  readonly pos: Vec3;
  readonly vel: Vec3;
  readonly angVel: Vec3;
  readonly rot: { readonly forward: Vec3; readonly up: Vec3 };
  readonly team: 0 | 1;
  readonly boost: number;
  readonly onGround: boolean;
  readonly doubleJumped: boolean;
  readonly hasFlipped: boolean;
  readonly demoed: boolean;
}

/** The match after a tick as the bots see it: every car in index order (the match's, by car id), the ball, the pads in
 *  our arena's order; the kickoff's pause (from "go" until the ball's first touch: the packages' SPEC §6) and the match's
 *  end (the winner shown, the podium, the end screen) */
export interface BotState {
  readonly cars: readonly BotCar[];
  readonly ball: { readonly pos: Vec3; readonly vel: Vec3; readonly angVel: Vec3 };
  readonly pads: readonly { readonly active: boolean }[];
  readonly kickoffPause: boolean;
  readonly matchEnded: boolean;
}

/** What a brain is given after a tick: the state, its own car's index in it, the tick (its calls from 0) */
export interface BotView {
  readonly state: BotState;
  readonly self: number;
  readonly tick: number;
}

export interface BotBrain {
  /** After each tick of the match: its controls for the next */
  tick(view: BotView): BotControls | Promise<BotControls>;
}

/** The match's phases (protocol's Phase numbers) a brain reads */
const PHASE_ACTIVE = 1;
const ENDED_PHASES: ReadonlySet<number> = new Set([4, 7, 8]);

/** The match's moments a brain reads, from its phase and the ball: the kickoff's pause while play is on and the ball
 *  hasn't been touched (it rests on its spot, still, until then; not the countdown's), the match's end (its pre-podium,
 *  podium and after) */
export function matchMoments(phase: number | null, ball: Pick<BotState["ball"], "pos" | "vel">): { readonly kickoffPause: boolean; readonly matchEnded: boolean } {
  const untouched = ball.pos.x === 0 && ball.pos.y === 0 && ball.vel.x === 0 && ball.vel.y === 0 && ball.vel.z === 0;
  return { kickoffPause: phase === PHASE_ACTIVE && untouched, matchEnded: phase !== null && ENDED_PHASES.has(phase) };
}

/** The bots' state from the world after a tick, and the match's phase (matchMoments) */
export function botState(world: World, phase: number | null): { readonly state: BotState; readonly ids: readonly number[] } {
  const ids = world.carIds().sort((a, b) => a - b);
  const ball = world.ball();
  const state: BotState = { cars: ids.map((id) => world.car(id)), ball, pads: world.boostPads(), ...matchMoments(phase, ball) };
  return { state, ids };
}

export const IDLE: BotControls = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, handbrake: false };

/** The built-in ball chaser: turns toward the ball and drives at it, boosting when it faces it; deciding every 8 ticks */
export function chaser(): BotBrain {
  let held = IDLE;
  return {
    tick(view) {
      if (view.tick % 8 === 0) held = chase(view);
      return held;
    },
  };
}

function chase({ state, self }: BotView): BotControls {
  const c = state.cars[self];
  if (!c) return IDLE;
  const ball = state.ball;
  const to = { x: ball.pos.x - c.pos.x, y: ball.pos.y - c.pos.y };
  // (the angle from its nose to the ball, in the ground plane: + to its right, the arena's axes being left-handed)
  const forward = Math.atan2(c.rot.forward.y, c.rot.forward.x);
  let angle = Math.atan2(to.y, to.x) - forward;
  angle = Math.atan2(Math.sin(angle), Math.cos(angle));
  const steer = Math.max(-1, Math.min(1, angle * 3));
  return { ...IDLE, throttle: 1, steer, boost: Math.abs(angle) < 0.3 && c.onGround, handbrake: Math.abs(angle) > 1.8 };
}

/** A bot's hello: its team and name, no reconnect key, replays skipped (it never waits on one) */
export function botHello(slot: BotSlot): Uint8Array {
  return encodeControl({
    type: "hello",
    version: PROTOCOL_VERSION,
    team: slot.team,
    model: 0,
    dodgeDeadzone: 0.5,
    steeringSensitivity: 1,
    airControlSensitivity: 1,
    autoSkipReplay: true,
    key: 0n,
    name: slot.name,
    quickChat: "everyone",
    blockNonTactical: false,
    intent: "join",
    playlist: 0,
    token: 0n,
  });
}

interface Bot {
  readonly id: number;
  readonly brain: BotBrain;
  /** Its brain threw: it idles from then (said once) */
  failed: boolean;
}

/** The match's bots: joined at its start; before each tick, every brain given the state after the last (loaded once for
 *  all of them), from the first tick every car is there (a package's policy sees every car, as in the bots' own game: its
 *  calls count from then) */
export class LocalBots {
  readonly #bots: Bot[] = [];
  readonly #world: World;
  readonly #cars: number;
  #tick = 0;

  /** `cars`: the match's when full (both teams') */
  constructor(world: World, cars: number) {
    this.#world = world;
    this.#cars = cars;
  }

  /** Joins a bot as player `id` with this brain (its controls idle until its first decision) */
  join(host: LocalHost, id: number, slot: BotSlot, brain: BotBrain, now: number): void {
    host.connect(id);
    host.control(id, botHello(slot), now);
    host.bot(id, IDLE);
    this.#bots.push({ id, brain, failed: false });
  }

  get ids(): readonly number[] {
    return this.#bots.map((b) => b.id);
  }

  /** Each brain's controls for the host's next tick, from the state after its last (none till the match is full) */
  async beforeTick(host: LocalHost): Promise<void> {
    const first = this.#bots[0];
    if (!first) return;
    const snapshot = host.state(first.id);
    if (snapshot.byteLength === 0) return;
    this.#world.loadState(snapshot);
    const { state, ids } = botState(this.#world, host.phase(first.id));
    if (state.cars.length < this.#cars) return;
    const tick = this.#tick++;
    for (const bot of this.#bots) {
      const car = host.car(bot.id);
      const self = car === null ? -1 : ids.indexOf(car);
      if (self < 0 || bot.failed) continue;
      try {
        host.bot(bot.id, await bot.brain.tick({ state, self, tick }));
      } catch (e) {
        bot.failed = true;
        host.bot(bot.id, IDLE);
        console.error(`bot ${String(bot.id)}'s brain failed, it idles: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
}
