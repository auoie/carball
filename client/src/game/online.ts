// Online play against the game server: the world is predicted locally with the player's inputs and corrected by the
// server's updates (src/net/predictor.ts). Inputs go out at 60 Hz, two frames per packet plus the unacknowledged ones.
import { Quaternion, Vector3 } from "three";
import { PlayerCamera } from "../camera/rlCamera";
import type { BodyState, CarState, World } from "../engine/world";
import { type Vec3, add, sub } from "../math/vec";
import { type Hud, respawnHud } from "../hud";
import type { InputDevices } from "../input/devices";
import { AirPitchSafety, ButtonLatch, EMPTY_INPUT, type HeldActions, type LookInput, readControls, readHeldActions, readLook } from "../input/mapping";
import { FixedStep, TICK_RATE, TICK_SECONDS } from "../loop/fixedStep";
import type { Connection } from "../net/connection";
import { NO_INPUT, Predictor } from "../net/predictor";
import {
  BIT_AIR_PITCH_SAFETY,
  BIT_BOOST,
  BIT_HANDBRAKE,
  BIT_JUMP,
  type ControlMessage,
  type InputFrame,
  type MatchState,
  MAX_INPUT_FRAMES,
  type Update,
  quantizeAxis,
} from "../net/protocol";
import { type CompleteUpdate, UpdateAssembler } from "../net/updates";
import { BallView, BoostPadsView, CarView } from "../render/entities";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";
import type { Options, Settings } from "../settings/settings";
import { Interpolated } from "./interpolated";
import { SyncError } from "./syncError";
import { formatClock, matchMessage } from "./matchClock";
import { fromThreeQuaternion, rotateRl, toThreeQuaternion } from "../render/coords";

/** Client input packets: one per two physics ticks (60 Hz) */
const SEND_EVERY_FRAMES = 2;
const GOAL_MESSAGE_SECONDS = 2;
/** Each body's present state before a correction or reload (Online.#smooth) */
interface Captured {
  readonly cars: ReadonlyMap<number, CarState>;
  readonly ball: BodyState;
  readonly ballSpawns: number;
}

/** Update parts kept while no frame is drawn (a hidden tab): about a second's worth */
const MAX_QUEUED_UPDATES = 120;
/** A frame this long is a hitch: the server's jitter buffer is reset this long after the last one (the game:
 *  NetworkInputBuffer_TA.ClientTick, "Hitch detected!", SetTimer(2, ServerResetInputBuffer)) */
const HITCH_SECONDS = 0.1;
const HITCH_RESET_DELAY = 2;

interface CarEntry {
  readonly view: CarView;
  readonly state: Interpolated<CarState>;
  /** How far its drawn pose still is from its corrected one (src/game/syncError.ts) */
  readonly error: SyncError;
}

export interface OnlineStats {
  readonly ping: number | null; // ms, smoothed
  readonly ackFrame: number;
  readonly frame: number;
  readonly cars: readonly { readonly id: number; readonly pos: Vec3 }[];
  readonly corrections: number;
  readonly localMispredictions: number;
  readonly kickoffCountdown: number; // ticks left (cars get no input)
}

export class Online {
  readonly #world: World;
  readonly #renderer: Renderer;
  readonly #arena: ArenaView;
  readonly #input: InputDevices;
  readonly #hud: Hud;
  readonly #audio: GameAudio;
  #throttle = 0;
  readonly #flipTracker = new FlipTracker();
  #dodge: Dodge = { kind: "ground" };
  #flipReset = false; // since the last frame drawn
  readonly #connection: Connection;
  readonly #localCar: number;
  readonly #predictor: Predictor;
  readonly #clock = new FixedStep();
  readonly #camera = new PlayerCamera();
  readonly #cars = new Map<number, CarEntry>();
  readonly #ballView = new BallView();
  readonly #ball: Interpolated<BodyState>;
  readonly #ballError = new SyncError();
  #ballSpawns = 0; // the ball's spawn counter last tick (a reset places it: not interpolated)
  readonly #padsView: BoostPadsView;
  readonly #updates = new UpdateAssembler();
  readonly #received: Update[] = [];
  readonly #controlMessages: ControlMessage[] = [];
  /** The match's state, from the server */
  #match: MatchState | null = null;
  #held: HeldActions = { ballCam: false, rearCamera: false, reset: false, ballInFront: false, ballOnCar: false };
  #ballCam = false;
  #rear = false;
  #look: LookInput = { up: 0, right: 0 };
  readonly #pitchSafety = new AirPitchSafety();
  readonly #buttons = new ButtonLatch(); // (buttons as the game's press and release commands: C-4)
  #ackFrame = 0;
  #ping: number | null = null;
  #bufferText = "";
  #message: string | null = null;
  #messageTimer = 0;
  #countdownLeft = 0; // whole seconds of the kickoff countdown, for its beeps
  #disconnected: string | null = null;
  #hitchReset: number | null = null; // seconds until the server's input buffer is reset after a hitch
  #fps = 60;
  readonly #pos = new Vector3();
  readonly #rot = new Quaternion();
  readonly #q1 = new Quaternion();
  readonly #q2 = new Quaternion();

  /** `world` already holds the welcome snapshot. */
  constructor(
    world: World,
    renderer: Renderer,
    arena: ArenaView,
    input: InputDevices,
    hud: Hud,
    audio: GameAudio,
    connection: Connection,
    welcome: { readonly carId: number; readonly frame: number },
    private readonly settings: () => Settings,
    private readonly inputEnabled: () => boolean,
  ) {
    this.#world = world;
    this.#renderer = renderer;
    this.#arena = arena;
    this.#input = input;
    this.#hud = hud;
    this.#audio = audio;
    this.#connection = connection;
    this.#localCar = welcome.carId;
    this.#predictor = new Predictor(world, welcome.carId, welcome.frame);
    this.#padsView = new BoostPadsView(world.boostPads());
    this.#ball = new Interpolated(world.ball());
    this.#ballSpawns = world.ballSpawnCount();
    renderer.scene.add(this.#ballView.root, this.#padsView.root);
    this.#syncCars();

    connection.onUpdate = (u) => {
      // (a hidden tab doesn't draw frames: keep only the newest second of updates, not a backlog to replay at once)
      this.#received.push(u);
      if (this.#received.length > MAX_QUEUED_UPDATES) this.#received.splice(0, this.#received.length - MAX_QUEUED_UPDATES);
    };
    connection.onControl = (m) => this.#controlMessages.push(m);
    connection.onClose = (reason) => {
      this.#disconnected = reason;
    };
  }

  get stats(): OnlineStats {
    return {
      ping: this.#ping,
      ackFrame: this.#ackFrame,
      frame: this.#predictor.frame,
      cars: [...this.#cars].map(([id, entry]) => ({ id, pos: entry.state.current.pos })),
      corrections: this.#predictor.stats.corrections,
      localMispredictions: this.#predictor.stats.localMispredictions,
      kickoffCountdown: this.#world.kickoffCountdown(),
    };
  }

  /** One animation frame. `frameSeconds`: real time since the previous frame. */
  frame(frameSeconds: number): void {
    this.#handleControlMessages();
    this.#applyUpdates();
    this.#watchHitches(frameSeconds);

    const settings = this.settings();
    const snapshot = this.inputEnabled() ? this.#input.snapshot() : EMPTY_INPUT;
    const { bindings, controller, options } = settings;
    this.#handleActions(readHeldActions(snapshot, bindings, controller.deadzone), options);
    const raw = readControls(snapshot, bindings, controller.deadzone, this.#buttons);
    const local = this.#cars.get(this.#localCar)?.state.current;
    const safety = this.#pitchSafety.update(options.airPitchSafety, this.#input.usingGamepad, local?.onGround ?? true, raw);
    const input: InputFrame = {
      throttle: quantizeAxis(raw.throttle),
      steer: quantizeAxis(raw.steer),
      pitch: quantizeAxis(raw.pitch),
      yaw: quantizeAxis(raw.yaw),
      roll: quantizeAxis(raw.roll),
      dodgeForward: quantizeAxis(-raw.pitch), // (its own byte, from before the air pitch safety: C-2)
      bits:
        (raw.jump ? BIT_JUMP : 0) | (raw.boost ? BIT_BOOST : 0) | (raw.handbrake ? BIT_HANDBRAKE : 0) | (safety ? BIT_AIR_PITCH_SAFETY : 0),
    };
    const look = readLook(snapshot, bindings, controller.deadzone);
    this.#look = { up: options.invertSwivelPitch ? -look.up : look.up, right: look.right };
    this.#camera.settings = settings.camera;
    this.#throttle = Math.abs(raw.throttle);

    const ticks = this.#clock.advance(frameSeconds);
    for (let i = 0; i < ticks; i++) {
      // (after the match the server freezes every car: send it nothing then, so the prediction agrees)
      const frozen = this.#match?.phase === "ended";
      this.#predictor.advance(frozen ? NO_INPUT : this.#disconnected === null ? input : { ...input, throttle: 0, bits: 0 });
      this.#world.takeEvents(); // goals come from the server
      this.#pushStates();
      this.#trackFlip();
      if (this.#predictor.frame % SEND_EVERY_FRAMES === 0) this.#sendInputs();
    }
    if (this.#messageTimer > 0) {
      this.#messageTimer -= frameSeconds;
      if (this.#messageTimer <= 0) this.#message = null;
    }
    // The countdown beeps at 3, 2, 1 and go
    const left = Math.ceil(this.#world.kickoffCountdown() / TICK_RATE);
    if (left < this.#countdownLeft && left <= 3) this.#audio.countdown(left);
    this.#countdownLeft = left;
    this.#draw(frameSeconds, ticks * TICK_SECONDS);
  }

  /** After a hitch the gap inflated the server's jitter buffer (one 300 ms gap: 7 -> 18 frames, ~40 s to come back):
   *  2 s after the last hitch the server resets it */
  #watchHitches(frameSeconds: number): void {
    if (frameSeconds > HITCH_SECONDS) this.#hitchReset = HITCH_RESET_DELAY;
    else if (this.#hitchReset !== null) {
      this.#hitchReset -= frameSeconds;
      if (this.#hitchReset <= 0) {
        this.#hitchReset = null;
        this.#connection.resetInputBuffer();
      }
    }
  }

  /** The frames the server has not acknowledged yet, newest 10 at most */
  #sendInputs(): void {
    if (this.#disconnected !== null) return;
    const last = this.#predictor.frame;
    let first = Math.max(this.#ackFrame + 1, last - MAX_INPUT_FRAMES + 1);
    while (first <= last && !this.#predictor.inputAt(first)) first++; // (history before a world reload is gone)
    const frames: InputFrame[] = [];
    for (let f = first; f <= last; f++) frames.push(this.#predictor.inputAt(f) ?? NO_INPUT);
    if (frames.length > 0) this.#connection.sendInputs(Math.round(performance.now()), first, frames);
  }

  #applyUpdates(): void {
    for (const part of this.#received.splice(0)) {
      for (const update of this.#updates.add(part)) this.#applyUpdate(update);
    }
    for (const update of this.#updates.flush()) this.#applyUpdate(update); // (a part was lost: the others still apply)
  }

  #applyUpdate(update: CompleteUpdate): void {
    const u = update.update;
    this.#ackFrame = Math.max(this.#ackFrame, u.ackFrame);
    this.#bufferText = `buffer ${String(u.bufferSize)}/${String(u.bufferTarget)}`;
    if (u.echoTimestamp > 0) {
      const rtt = ((Math.round(performance.now()) - u.echoTimestamp) >>> 0) - u.echoDelay;
      if (rtt >= 0 && rtt < 10_000) this.#ping = this.#ping === null ? rtt : this.#ping + (rtt - this.#ping) * 0.1;
    }
    this.#correct(u.ackFrame, update.states);
  }

  /** A server correction, smoothed for drawing: each body's drawn pose keeps where it was and glides to the corrected
   *  one (SyncError); the interpolation's previous tick moves with the correction, so nothing jumps. A resync (the
   *  server's state ahead of this client) is smoothed the same way, as the game smooths every correction. */
  #correct(frame: number, states: readonly Uint8Array[]): void {
    const pre = this.#capture();
    this.#predictor.correct(frame, states);
    this.#smooth(pre);
  }

  /** Each body's present state, before a correction or reload */
  #capture(): Captured {
    return {
      cars: new Map([...this.#cars.keys()].map((id) => [id, this.#world.car(id)])),
      ball: this.#world.ball(),
      ballSpawns: this.#world.ballSpawnCount(),
    };
  }

  /** The world's present state changed from `pre`: carry the difference in each body's drawn pose */
  #smooth(pre: Captured): void {
    for (const [id, entry] of this.#cars) {
      const before = pre.cars.get(id);
      if (!before) continue; // (a car new in the world: drawn from its state)
      const after = this.#world.car(id);
      const moved = sub(before.pos, after.pos);
      // A new placement (a kickoff, a respawn: in the game a new actor) is drawn at once; every other correction,
      // however large, is smoothed (notes/netcode-audit.md NR-2)
      if (before.demoed || after.demoed || before.spawnCount !== after.spawnCount) {
        entry.error.clear();
        entry.state.previous = after;
      } else {
        entry.error.accumulate(before, after);
        // The previous tick moves with the correction, rotation included (prev' = post pre^-1 prev, as the game's
        // OldRBState): the drawn pose stays where it was
        const turn = toThreeQuaternion(after.rot, this.#q1).multiply(toThreeQuaternion(before.rot, this.#q2).invert());
        const prevRot = fromThreeQuaternion(turn.multiply(toThreeQuaternion(entry.state.previous.rot, this.#q2)));
        entry.state.previous = { ...entry.state.previous, pos: sub(entry.state.previous.pos, moved), rot: prevRot };
      }
      entry.state.current = after;
    }
    const ball = this.#world.ball();
    const moved = sub(pre.ball.pos, ball.pos);
    const teleport = this.#world.ballSpawnCount() !== pre.ballSpawns;
    if (teleport) {
      this.#ballError.clear();
      this.#ball.previous = ball;
    } else {
      // As a car's (NR-1): the error keeps the drawn pose, rotation included; the previous tick moves with the correction
      this.#ballError.accumulate(pre.ball, ball);
      const turn = toThreeQuaternion(ball.rot, this.#q1).multiply(toThreeQuaternion(pre.ball.rot, this.#q2).invert());
      const prevRot = fromThreeQuaternion(turn.multiply(toThreeQuaternion(this.#ball.previous.rot, this.#q2)));
      this.#ball.previous = { ...this.#ball.previous, pos: sub(this.#ball.previous.pos, moved), rot: prevRot };
    }
    this.#ball.current = ball;
    this.#ballSpawns = this.#world.ballSpawnCount();
  }

  #handleControlMessages(): void {
    for (const m of this.#controlMessages.splice(0)) {
      if (m.type === "world") {
        // (the set of cars changed: the cars in both worlds are smoothed from where they were drawn, as any correction)
        const pre = this.#capture();
        this.#predictor.reload(m.frame, m.snapshot);
        this.#syncCars();
        this.#smooth(pre);
      } else if (m.type === "match") {
        this.#match = m; // (the score too: the server's)
      } else if (m.type === "event" && m.event.kind === "goal") {
        const team = m.event.team === 1 ? 1 : 0;
        this.#audio.goal();
        this.#message = team === 0 ? "BLUE SCORES!" : "ORANGE SCORES!";
        this.#messageTimer = GOAL_MESSAGE_SECONDS;
      }
    }
  }

  /** Views for the cars in the world (after a join or leave) */
  #syncCars(): void {
    const ids = new Set(this.#world.carIds());
    for (const [id, entry] of this.#cars) {
      if (!ids.has(id)) {
        this.#renderer.scene.remove(entry.view.root);
        this.#cars.delete(id);
      }
    }
    for (const id of ids) {
      if (this.#cars.has(id)) continue;
      const state = this.#world.car(id);
      const view = new CarView(this.#world.carConfig(id), state.team);
      this.#renderer.scene.add(view.root);
      this.#cars.set(id, { view, state: new Interpolated(state), error: new SyncError() });
    }
  }

  #pushStates(): void {
    for (const [id, entry] of this.#cars) {
      // (a respawn or reset predicted here is drawn at once, not interpolated across the field for a tick: NR-8)
      const car = this.#world.car(id);
      entry.state.push(car, car.spawnCount !== entry.state.current.spawnCount);
    }
    const ballSpawns = this.#world.ballSpawnCount();
    this.#ball.push(this.#world.ball(), ballSpawns !== this.#ballSpawns);
    this.#ballSpawns = ballSpawns;
  }

  /** Whether the player's car can dodge, after this tick (the flip indicator). */
  #trackFlip(): void {
    const local = this.#cars.get(this.#localCar)?.state.current;
    if (!local) return;
    const { dodge, reset } = this.#flipTracker.tick(local, TICK_SECONDS);
    this.#dodge = dodge;
    if (reset) this.#flipReset = true;
  }

  #handleActions(held: HeldActions, options: Options): void {
    const pressed = (key: keyof HeldActions): boolean => held[key] && !this.#held[key];
    if (!options.ballCamToggle) this.#ballCam = held.ballCam;
    else if (pressed("ballCam")) this.#ballCam = !this.#ballCam;
    if (!options.rearCameraToggle) this.#rear = held.rearCamera;
    else if (pressed("rearCamera")) this.#rear = !this.#rear;
    this.#held = held; // (freeplay's reset and ball placement do nothing online)
  }

  /** `simulated`: seconds of physics run this frame. */
  #draw(frameSeconds: number, simulated: number): void {
    const alpha = this.#clock.alpha;
    for (const { view, state, error } of this.#cars.values()) {
      error.decay(frameSeconds);
      const { boosting, demoed, supersonic } = state.current;
      const pos = error.applyPosition(state.position(alpha, this.#pos));
      view.update(pos, error.applyRotation(state.rotation(alpha, this.#rot)), boosting, demoed, supersonic, frameSeconds);
    }
    this.#ballError.decay(frameSeconds);
    const ball = this.#ballError.applyPosition(this.#ball.position(alpha, this.#pos));
    this.#ballView.root.visible = !this.#world.ballExploded(); // (a goal explodes it until the reset)
    this.#ballView.update(ball, this.#ballError.applyRotation(this.#ball.rotation(alpha, this.#rot)));
    this.#arena.update(ball, frameSeconds);
    const pads = this.#world.boostPads();
    this.#padsView.update(pads);

    const local = this.#cars.get(this.#localCar);
    if (local) {
      // The camera follows the drawn (smoothed) car and ball, its rotation too
      const car = local.state.blended(alpha);
      const e = local.error.rotation;
      const rot = { forward: rotateRl(car.rot.forward, e), right: rotateRl(car.rot.right, e), up: rotateRl(car.rot.up, e) };
      const drawnCar = { ...car, pos: add(car.pos, local.error.location), rot };
      const drawnBall = add(this.#ball.blended(alpha).pos, this.#ballError.location);
      const view = this.#camera.update(frameSeconds, drawnCar, drawnBall, {
        ballCam: this.#ballCam,
        rear: this.#rear,
        lookUp: this.#look.up,
        lookRight: this.#look.right,
      });
      this.#renderer.render(view);
      this.#audio.frame({
        world: { cars: new Map([...this.#cars].map(([id, entry]) => [id, entry.state.current])), ball: this.#ball.current, pads },
        localCar: this.#localCar,
        throttle: this.#throttle,
        simulated,
        camera: view,
      });
    }

    if (frameSeconds > 0) this.#fps += (1 / frameSeconds - this.#fps) * 0.05;
    const car = local?.state.current;
    const ping = this.#ping === null ? "ping –" : `ping ${String(Math.round(this.#ping))} ms`;
    this.#hud.update({
      boost: car?.boost ?? 0,
      speed: car ? Math.hypot(car.vel.x, car.vel.y, car.vel.z) : 0,
      supersonic: car?.supersonic ?? false,
      score: this.#match?.score ?? [0, 0],
      clock: this.#match ? formatClock(this.#match) : null,
      ballCam: this.#ballCam,
      message:
        this.#disconnected !== null
          ? `Disconnected: ${this.#disconnected}`
          : (this.#message ?? (this.#match ? matchMessage(this.#match) : null)),
      fps: this.#fps,
      net: `${ping} · ${this.#bufferText} · ${String(this.#cars.size)} cars`,
      flip: this.settings().options.flipIndicator ? this.#dodge : null,
      flipReset: this.#flipReset,
      respawn: car ? respawnHud(car) : null,
    });
    if (this.#flipReset) this.#audio.flipReset();
    this.#flipReset = false;
  }
}
