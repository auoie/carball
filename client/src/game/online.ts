// Online play against the game server: the world is predicted locally with the player's inputs and corrected by the
// server's updates (src/net/predictor.ts). Inputs go out at 60 Hz, two frames per packet plus the unacknowledged ones.
// After a goal the clock slows with the game's (src/game/goalSequence.ts, keyed to the goal's server tick as the
// server's is), then the goal replay plays from this client's own recording of what it drew, until it ends or every
// player skips it (Space / pad A).
import { Quaternion, Vector3 } from "three";
import { PlayerCamera } from "../camera/rlCamera";
import type { BodyState, CarState, World } from "../engine/world";
import { type Vec3, add, sub } from "../math/vec";
import { type Hud, respawnHud } from "../hud";
import type { InputDevices } from "../input/devices";
import { AirPitchSafety, ButtonLatch, EMPTY_INPUT, type HeldActions, type InputSnapshot, JumpLatch, type LookInput, readControls, readHeldActions } from "../input/mapping";
import { FixedStep, TICK_SECONDS, frameTimes } from "../loop/fixedStep";
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
import { BallView, BoostPadsView, CarView, trailGround } from "../render/entities";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";
import { SendClock, cameraInputs, newCar, updateSwitches } from "./cameraInput";
import type { FreeLookControls } from "../camera/rlCamera";
import type { Options, Settings } from "../settings/settings";
import { Interpolated } from "./interpolated";
import { SyncError } from "./syncError";
import { countdownStep, formatClock, matchMessage } from "./matchClock";
import { fromThreeQuaternion, rotateRl, toThreeQuaternion } from "../render/coords";
import { postGoalDilation } from "./goalSequence";
import { type RecordedCar, ReplayRecorder, recordCar } from "./replayRecorder";
import { ReplayPlayback } from "./replayPlayback";
import { Fade } from "../render/fade";
import { SceneEffects } from "../render/effects";
import { EXPLOSION_LARGE, EXPLOSION_MEDIUM } from "../camera/shake";
import { ShakeTriggers } from "./shakeTriggers";


/** A banner message stays this long after the last one (HUD-8: then a 0.3 s fade, not yet drawn) */
const BANNER_SECONDS = 4;
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

/** Samples of server tick − client frame kept (one per update: 20 s) */
const MAX_TICK_OFFSETS = 1200;

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
  /** The match's phase changes as they arrived: when (performance.now(), ms) and at which client frame */
  readonly phases: readonly { readonly phase: MatchState["phase"]; readonly at: number; readonly frame: number }[];
  /** A goal replay is playing */
  readonly replaying: boolean;
  /** The last goal: the client frame its slow motion is keyed to (the server's goal tick), the first frame its recorded
   *  history has the ball exploded in, and the slowest dilation its clock has run at since */
  readonly goal: { readonly frame: number | null; readonly explodedFrame: number | null; readonly minDilation: number };
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
  #drawnBallSpawns = 0; // the ball's spawn counter last drawn (a new ball fades in)
  #serverExploded = false; // the server's goal event exploded the ball, until the next ball
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
  #freeLook: FreeLookControls | null = null;
  readonly #pitchSafety = new AirPitchSafety();
  readonly #buttons = new ButtonLatch(); // (buttons as the game's press and release commands: C-4)
  readonly #jump = new JumpLatch(); // (a jump press is a tick of jump however short: LT-4)
  readonly #sendClock = new SendClock();
  #ackFrame = 0;
  #ping: number | null = null;
  #bufferText = "";
  #message: string | null = null;
  #messageTimer = 0;
  #countdownLeft = 0; // whole seconds of the kickoff countdown, for its beeps
  #disconnected: string | null = null;
  #hitchReset: number | null = null; // seconds until the server's input buffer is reset after a hitch
  /** Server tick − client frame (the update's ackFrame was consumed at its serverTick), oldest first */
  readonly #tickOffsets: { readonly serverTick: number; readonly offset: number }[] = [];
  /** The client frame of the last goal's server tick (the slow motion after it) */
  #goalFrame: number | null = null;
  readonly #recorder = new ReplayRecorder();
  #replay: ReplayPlayback | null = null;
  #replayReady: { readonly ready: number; readonly total: number } | null = null;
  #skipped = false; // asked to skip this replay
  #skipHeld = true; // the skip button down last frame (a press skips)
  #autoSkipSent: boolean;
  readonly #fade = new Fade();
  readonly #effects: SceneEffects;
  readonly #shakeTriggers = new ShakeTriggers({ demolitions: false }); // (the server's Demo events: RV-47)
  #localSpawns: number; // the local car's spawn counter last drawn (a kickoff's new car: the camera starts over)
  readonly #phases: { phase: MatchState["phase"]; at: number; frame: number }[] = [];
  #minDilation = 1;
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
    this.#drawnBallSpawns = this.#ballSpawns;
    this.#serverExploded = world.ballExploded(); // (joining after a goal: already gone)
    if (!this.#serverExploded) this.#ballView.spawn(); // (the ball fades in for a joining player too: RV-37)
    this.#autoSkipSent = settings().options.autoSkipReplay;
    this.#localSpawns = world.car(welcome.carId).spawnCount;
    renderer.scene.add(this.#ballView.root, this.#padsView.root);
    this.#effects = new SceneEffects(renderer.scene);
    this.#syncCars();
    this.#predictor.onFrame = (frame) => {
      this.#recordFrame(frame);
    };

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
      phases: this.#phases,
      replaying: this.#replay !== null,
      goal: { frame: this.#goalFrame, explodedFrame: this.#explodedFrame(), minDilation: this.#minDilation },
    };
  }

  /** One animation frame. `rawSeconds`: time since the previous frame, unclamped. */
  frame(rawSeconds: number): void {
    this.#handleControlMessages();
    this.#applyUpdates();
    this.#watchHitches(rawSeconds);

    const settings = this.settings();
    const polled = this.#input.snapshot(); // (every frame: a menu's presses mustn't wait for it to close)
    const snapshot = this.inputEnabled() ? polled : EMPTY_INPUT;
    const { bindings, controller, options } = settings;
    const camera = cameraInputs(settings, snapshot, this.#input, this.#camera.fov);
    this.#handleActions(readHeldActions(snapshot, bindings, controller.deadzone), options, camera.device.ballCamToggle);
    const raw = readControls(snapshot, bindings, controller.deadzone, this.#buttons);
    this.#jump.frame(this.#buttons);
    const local = this.#cars.get(this.#localCar)?.state.current;
    const safety = this.#pitchSafety.update(options.airPitchSafety, this.#input.usingGamepad, local?.onGround ?? true, raw);
    const input: InputFrame = {
      throttle: quantizeAxis(raw.throttle),
      steer: quantizeAxis(raw.steer),
      pitch: quantizeAxis(raw.pitch),
      yaw: quantizeAxis(raw.yaw),
      roll: quantizeAxis(raw.roll),
      dodgeForward: quantizeAxis(-raw.pitch), // (its own byte, from before the air pitch safety: C-2)
      bits: (raw.boost ? BIT_BOOST : 0) | (raw.handbrake ? BIT_HANDBRAKE : 0) | (safety ? BIT_AIR_PITCH_SAFETY : 0),
    };
    this.#look = camera.look;
    this.#freeLook = camera.freeLook;
    this.#camera.settings = settings.camera;
    this.#camera.shake = options.cameraShake;
    this.#throttle = Math.abs(raw.throttle);
    this.#watchSkip(snapshot);
    if (options.autoSkipReplay !== this.#autoSkipSent) {
      this.#autoSkipSent = options.autoSkipReplay;
      this.#connection.setAutoSkipReplay(options.autoSkipReplay);
    }

    // The frame's world time: slowed after a goal (the dilation the next tick has, as the game applies the curve's
    // value from the frame after)
    const dilation = this.#goalFrame === null ? 1 : postGoalDilation(this.#predictor.frame + 1 - this.#goalFrame);
    const { world, real } = frameTimes(rawSeconds, dilation);
    this.#minDilation = Math.min(this.#minDilation, dilation);
    const ticks = this.#clock.advance(world);
    for (let i = 0; i < ticks; i++) {
      // (after the match the server freezes every car, and in the goal replay the cars are gone: send it nothing then,
      // so the prediction agrees)
      const frozen = this.#match?.phase === "ended" || this.#match?.phase === "replay";
      const jumped = { ...input, bits: input.bits | (this.#jump.tick(raw.jump) ? BIT_JUMP : 0) };
      this.#predictor.advance(frozen ? NO_INPUT : this.#disconnected === null ? jumped : { ...input, throttle: 0, bits: 0 });
      this.#world.takeEvents(); // goals come from the server
      this.#pushStates();
      this.#trackFlip();
    }
    // Input packets at 60 Hz of real time, once a frame (slowed ticks after a goal don't stretch them: RV-4)
    // (DeltaSeconds / TimeDilation: the world time undilated, RV-22)
    if (this.#sendClock.due(world / dilation)) this.#sendInputs();
    if (this.#messageTimer > 0) {
      this.#messageTimer -= real;
      if (this.#messageTimer <= 0) this.#message = null;
    }
    // The countdown: 3, 2, 1 and GO!, a second apart from a second in, each with its beep (VT-24)
    const { left, say } = countdownStep(this.#countdownLeft, this.#world.kickoffCountdown());
    if (say !== null) {
      this.#audio.countdown(left);
      this.#message = say;
      this.#messageTimer = BANNER_SECONDS;
    }
    this.#countdownLeft = left;
    this.#fade.update(real);
    if (this.#replay) this.#drawReplay(real, this.#replay);
    else this.#draw(world, ticks * TICK_SECONDS, real);
  }

  /** Skip the goal replay: a press of Space or the pad's A (ReadyUp, ReplaySkip bindings), once */
  #watchSkip(snapshot: InputSnapshot): void {
    const held = snapshot.keys.has("Space") || (snapshot.pressedKeys?.has("Space") ?? false) || (snapshot.gamepad?.buttons[0] ?? 0) > 0.5;
    if (held && !this.#skipHeld && this.#replay && !this.#skipped) {
      this.#skipped = true;
      this.#connection.readyUp();
    }
    this.#skipHeld = held;
  }

  /** The first frame the recording (the history as corrections settled it) has the ball exploded in, near the last
   *  goal's (for the browser tests) */
  #explodedFrame(): number | null {
    if (this.#goalFrame === null) return null;
    for (let f = this.#goalFrame - 120; f <= this.#goalFrame + 120; f++) if (this.#recorder.at(f)?.ballExploded) return f;
    return null;
  }

  /** The client frame that was consumed at a server tick (by the update nearest it) */
  #frameAt(serverTick: number): number {
    let best = this.#tickOffsets.at(-1);
    for (const sample of this.#tickOffsets) {
      if (!best || Math.abs(sample.serverTick - serverTick) < Math.abs(best.serverTick - serverTick)) best = sample;
    }
    return serverTick - (best?.offset ?? 0);
  }

  /** What a frame drew, for the goal replay (not while one plays: its frames must stay) */
  #recordFrame(frame: number): void {
    if (this.#replay) return;
    const cars = new Map<number, RecordedCar>();
    for (const id of this.#world.carIds()) cars.set(id, recordCar(this.#world.car(id)));
    this.#recorder.record(frame, { cars, ball: this.#world.ball(), ballExploded: this.#world.ballExploded() });
  }

  /** After a hitch the gap inflated the server's jitter buffer (one 300 ms gap: 7 -> 18 frames, ~40 s to come back):
   *  2 s after the last hitch the server resets it */
  #watchHitches(rawSeconds: number): void {
    const frameSeconds = Math.max(0, rawSeconds);
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
    if (u.ackFrame > 0) {
      this.#tickOffsets.push({ serverTick: u.serverTick, offset: u.serverTick - u.ackFrame });
      if (this.#tickOffsets.length > MAX_TICK_OFFSETS) this.#tickOffsets.splice(0, this.#tickOffsets.length - MAX_TICK_OFFSETS);
    }
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
        // The replay over (its end, or everyone skipped): the next camera cuts in from black
        if (this.#replay && m.phase !== "replay") {
          this.#replay = null;
          this.#fade.fromBlack();
        }
        if (m.phase !== this.#match?.phase) {
          this.#phases.push({ phase: m.phase, at: performance.now(), frame: this.#predictor.frame });
          if (this.#phases.length > 16) this.#phases.shift();
        }
        this.#match = m; // (the score too: the server's)
      } else if (m.type === "event" && m.event.kind === "goal") {
        const team = m.event.team === 1 ? 1 : 0;
        this.#audio.goal();
        this.#message = team === 0 ? "BLUE SCORES!" : "ORANGE SCORES!";
        this.#messageTimer = BANNER_SECONDS;
        this.#goalFrame = this.#frameAt(m.serverTick);
        this.#serverExploded = true;
        // (where the ball was at the goal's tick, as this client drew it: RV-52h)
        const at = this.#recorder.before(Math.floor(this.#goalFrame))?.ball.pos ?? this.#world.ball().pos;
        this.#effects.goal(at, team);
        this.#arena.explode();
        this.#camera.shakes.play(EXPLOSION_LARGE, at);
        this.#minDilation = 1;
      } else if (m.type === "event" && m.event.kind === "demo") {
        // A demolition as the server says (QueueDemolish from the replicated demolish): its effect and shake where the
        // victim was at that tick, as this client drew it (RV-47)
        const recorded = this.#recorder.before(Math.floor(this.#frameAt(m.serverTick)))?.cars.get(m.event.victim);
        const at = recorded?.pos ?? this.#cars.get(m.event.victim)?.state.current.pos;
        if (at) {
          this.#effects.demolition(at);
          this.#camera.shakes.play(EXPLOSION_MEDIUM, at);
        }
      } else if (m.type === "replay") {
        // (the cut in from black: LiveReplay's Begin)
        this.#replay = new ReplayPlayback(m, this.#recorder, (tick) => this.#frameAt(tick));
        this.#ballView.spawn(true);
        this.#arena.newBall();
        this.#replayReady = null;
        this.#skipped = false;
        this.#skipHeld = true;
        this.#message = null;
        this.#fade.fromBlack();
      } else if (m.type === "replayReady") {
        this.#replayReady = { ready: m.ready, total: m.total };
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
      const view = new CarView(this.#world.carConfig(id), state.team, this.#effects.particles);
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

  #handleActions(held: HeldActions, options: Options, ballCamToggle: boolean): void {
    const phase = this.#match?.phase;
    const blocked = phase === "replay" || phase === "ended";
    const next = updateSwitches({ ballCam: this.#ballCam, rear: this.#rear }, held, this.#held, { ballCamToggle, rearCameraToggle: options.rearCameraToggle, blocked });
    this.#ballCam = next.ballCam;
    this.#rear = next.rear;
    this.#held = held; // (freeplay's reset and ball placement do nothing online)
  }

  /** `frameSeconds`: the frame's world time (slowed after a goal); `simulated`: seconds of physics run this frame;
   *  `realSeconds`: real time since the last frame. */
  #draw(frameSeconds: number, simulated: number, realSeconds: number): void {
    const alpha = this.#clock.alpha;
    for (const [id, { view, state, error }] of this.#cars) {
      error.decay(frameSeconds);
      const { boosting, demoed, supersonic } = state.current;
      const pos = error.applyPosition(state.position(alpha, this.#pos));
      const throttling = (id === this.#localCar ? this.#throttle : Math.abs(this.#world.carControls(id).throttle)) > 0;
      view.update(pos, error.applyRotation(state.rotation(alpha, this.#rot)), boosting, demoed, supersonic, frameSeconds, trailGround(state.current), throttling);
    }
    this.#ballError.decay(frameSeconds);
    const ball = this.#ballError.applyPosition(this.#ball.position(alpha, this.#pos));
    // (a goal explodes it, as the server says, until the reset: it dissolves; a kickoff's new ball fades in. Not the
    // prediction's explosion: a mispredicted goal would dissolve it for a round trip, RV-32)
    if (this.#world.ballSpawnCount() !== this.#drawnBallSpawns) {
      this.#drawnBallSpawns = this.#world.ballSpawnCount();
      this.#serverExploded = false;
      this.#ballView.spawn();
      this.#arena.newBall();
    }
    this.#ballView.fade(this.#serverExploded, frameSeconds);
    this.#ballView.update(ball, this.#ballError.applyRotation(this.#ball.rotation(alpha, this.#rot)));
    this.#arena.update(ball, frameSeconds);
    this.#effects.update(frameSeconds);
    const pads = this.#world.boostPads();
    const states = new Map([...this.#cars].map(([id, entry]) => [id, entry.state.current]));
    this.#shakeTriggers.frame(this.#camera.shakes, this.#cars.get(this.#localCar)?.state.current, states, pads, () => undefined);
    this.#padsView.update(pads, frameSeconds);

    const local = this.#cars.get(this.#localCar);
    // A kickoff's new car (the game destroys the cars and spawns new ones): the camera starts over behind it (GS-16);
    // a respawn after a demolition blends as usual
    const spawns = local?.state.current.spawnCount;
    if (spawns !== undefined && spawns !== this.#localSpawns) {
      this.#localSpawns = spawns;
      if (this.#world.kickoffCountdown() > 0) this.#camera.reset();
      this.#rear = newCar({ ballCam: this.#ballCam, rear: this.#rear }).rear;
    }
    if (local) {
      // The camera follows the drawn (smoothed) car and ball, its rotation too
      const car = local.state.blended(alpha);
      const e = local.error.rotation;
      const rot = { forward: rotateRl(car.rot.forward, e), right: rotateRl(car.rot.right, e), up: rotateRl(car.rot.up, e) };
      const drawnCar = { ...car, pos: add(car.pos, local.error.location), rot };
      const drawnBall = add(this.#ball.blended(alpha).pos, this.#ballError.location);
      // Demolished: the respawn cameras follow the spot picked (respawns wait after a goal: CAM-29)
      const { demoed, spawnSelection: pick, team } = local.state.current;
      const phase = this.#match?.phase;
      const respawn = demoed
        ? {
            held: phase === "postGoal" || phase === "replay",
            selected: pick.side === null ? null : (this.#world.respawnSpots(team, pick.side)[pick.index] ?? null),
          }
        : null;
      const controls = { ballCam: this.#ballCam, rear: this.#rear, lookUp: this.#look.up, lookRight: this.#look.right, freeLook: this.#freeLook };
      const view = this.#camera.update(frameSeconds, drawnCar, drawnBall, controls, respawn, realSeconds);
      if (this.#camera.takeBallCamExit()) this.#ballCam = false; // (free look left the toggled ball cam)
      this.#renderer.render(view);
      this.#effects.camera = view.position; // (the husks collide near it)
      this.#audio.frame({
        world: { cars: new Map([...this.#cars].map(([id, entry]) => [id, entry.state.current])), ball: this.#ball.current, pads },
        localCar: this.#localCar,
        throttle: this.#throttle,
        simulated,
        camera: view,
      });
    }

    this.#updateHud(null, realSeconds);
  }

  /** The HUD; `message`: what it says instead of the match's messages (null: those); `hint`: a line under it */
  #updateHud(message: string | null, realSeconds: number, hint: string | null = null): void {
    if (realSeconds > 0) this.#fps += (1 / realSeconds - this.#fps) * 0.05;
    const car = this.#cars.get(this.#localCar)?.state.current;
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
          : (message ?? this.#message ?? (this.#match ? matchMessage(this.#match) : null)),
      fps: this.#fps,
      net: `${ping} · ${this.#bufferText} · ${String(this.#cars.size)} cars`,
      flip: this.settings().options.flipIndicator ? this.#dodge : null,
      flipReset: this.#flipReset,
      respawn: car ? respawnHud(car) : null,
      hint,
    });
    if (this.#flipReset) this.#audio.flipReset();
    this.#flipReset = false;
  }

  /** The goal replay (src/game/replayPlayback.ts) over this client's recording. `realSeconds`: real time since the
   *  last frame. */
  #drawReplay(realSeconds: number, playback: ReplayPlayback): void {
    const cars = [...this.#cars].map(([id, entry]) => [id, entry.view] as const);
    playback.frame(realSeconds, {
      renderer: this.#renderer,
      arena: this.#arena,
      effects: this.#effects,
      audio: this.#audio,
      ballView: this.#ballView,
      cars,
    });
    const ready = this.#replayReady;
    const count = ready ? ` · ${String(ready.ready)}/${String(ready.total)} ready` : "";
    this.#updateHud("REPLAY", realSeconds, `${this.#skipped ? "Waiting for the others" : "Space / (A) to skip"}${count}`);
  }
}
