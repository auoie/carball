// Online play against the game server: the world is predicted locally with the player's inputs and corrected by the
// server's updates (src/net/predictor.ts). Inputs go out at 60 Hz, two frames per packet plus the unacknowledged ones.
import { Quaternion, Vector3 } from "three";
import { PlayerCamera } from "../camera/rlCamera";
import type { BodyState, CarState, World } from "../engine/world";
import type { Vec3 } from "../math/vec";
import type { Hud } from "../hud";
import type { InputDevices } from "../input/devices";
import { AirPitchSafety, EMPTY_INPUT, type HeldActions, type LookInput, readControls, readHeldActions, readLook } from "../input/mapping";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import type { Connection } from "../net/connection";
import { NO_INPUT, Predictor } from "../net/predictor";
import {
  BIT_AIR_PITCH_SAFETY,
  BIT_BOOST,
  BIT_HANDBRAKE,
  BIT_JUMP,
  type ControlMessage,
  type InputFrame,
  MAX_INPUT_FRAMES,
  type Update,
  quantizeAxis,
} from "../net/protocol";
import { UpdateAssembler } from "../net/updates";
import { BallSpin } from "../render/ballSpin";
import { BallView, BoostPadsView, CarView } from "../render/entities";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { Options, Settings } from "../settings/settings";
import { Interpolated } from "./interpolated";

/** Client input packets: one per two physics ticks (60 Hz) */
const SEND_EVERY_FRAMES = 2;
const GOAL_MESSAGE_SECONDS = 2;

interface CarEntry {
  readonly view: CarView;
  readonly state: Interpolated<CarState>;
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
  readonly #connection: Connection;
  readonly #localCar: number;
  readonly #predictor: Predictor;
  readonly #clock = new FixedStep();
  readonly #camera = new PlayerCamera();
  readonly #cars = new Map<number, CarEntry>();
  readonly #ballView = new BallView();
  readonly #ball: Interpolated<BodyState>;
  readonly #ballSpin = new BallSpin();
  readonly #padsView: BoostPadsView;
  readonly #updates = new UpdateAssembler();
  readonly #received: Update[] = [];
  readonly #controlMessages: ControlMessage[] = [];
  readonly #score: [number, number] = [0, 0];
  #held: HeldActions = { ballCam: false, rearCamera: false, reset: false, ballInFront: false, ballOnCar: false };
  #ballCam = false;
  #rear = false;
  #look: LookInput = { up: 0, right: 0 };
  readonly #pitchSafety = new AirPitchSafety();
  #ackFrame = 0;
  #ping: number | null = null;
  #bufferText = "";
  #message: string | null = null;
  #messageTimer = 0;
  #disconnected: string | null = null;
  #fps = 60;
  readonly #pos = new Vector3();
  readonly #rot = new Quaternion();

  /** `world` already holds the welcome snapshot. */
  constructor(
    world: World,
    renderer: Renderer,
    arena: ArenaView,
    input: InputDevices,
    hud: Hud,
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
    this.#connection = connection;
    this.#localCar = welcome.carId;
    this.#predictor = new Predictor(world, welcome.carId, welcome.frame);
    this.#padsView = new BoostPadsView(world.boostPads());
    this.#ball = new Interpolated(this.#ballSpin.advance(world.ball(), 0));
    renderer.scene.add(this.#ballView.root, this.#padsView.root);
    this.#syncCars();

    connection.onUpdate = (u) => this.#received.push(u);
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

    const settings = this.settings();
    const snapshot = this.inputEnabled() ? this.#input.snapshot() : EMPTY_INPUT;
    const { bindings, controller, options } = settings;
    this.#handleActions(readHeldActions(snapshot, bindings, controller.deadzone), options);
    const raw = readControls(snapshot, bindings, controller.deadzone);
    const local = this.#cars.get(this.#localCar)?.state.current;
    const safety = this.#pitchSafety.update(options.airPitchSafety, this.#input.usingGamepad, local?.onGround ?? true, raw);
    const input: InputFrame = {
      throttle: quantizeAxis(raw.throttle),
      steer: quantizeAxis(raw.steer),
      pitch: quantizeAxis(raw.pitch),
      yaw: quantizeAxis(raw.yaw),
      roll: quantizeAxis(raw.roll),
      bits:
        (raw.jump ? BIT_JUMP : 0) | (raw.boost ? BIT_BOOST : 0) | (raw.handbrake ? BIT_HANDBRAKE : 0) | (safety ? BIT_AIR_PITCH_SAFETY : 0),
    };
    const look = readLook(snapshot, bindings, controller.deadzone);
    this.#look = { up: options.invertSwivelPitch ? -look.up : look.up, right: look.right };
    this.#camera.settings = settings.camera;

    const ticks = this.#clock.advance(frameSeconds);
    for (let i = 0; i < ticks; i++) {
      this.#predictor.advance(this.#disconnected === null ? input : { ...input, throttle: 0, bits: 0 });
      this.#world.takeEvents(); // goals come from the server
      this.#pushStates();
      if (this.#predictor.frame % SEND_EVERY_FRAMES === 0) this.#sendInputs();
    }
    if (this.#messageTimer > 0) {
      this.#messageTimer -= frameSeconds;
      if (this.#messageTimer <= 0) this.#message = null;
    }
    this.#draw(frameSeconds);
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
      const update = this.#updates.add(part);
      if (!update) continue;
      const u = update.update;
      this.#ackFrame = Math.max(this.#ackFrame, u.ackFrame);
      this.#bufferText = `buffer ${String(u.bufferSize)}/${String(u.bufferTarget)}`;
      if (u.echoTimestamp > 0) {
        const rtt = ((Math.round(performance.now()) - u.echoTimestamp) >>> 0) - u.echoDelay;
        if (rtt >= 0 && rtt < 10_000) this.#ping = this.#ping === null ? rtt : this.#ping + (rtt - this.#ping) * 0.1;
      }
      this.#predictor.correct(u.ackFrame, update.states);
    }
  }

  #handleControlMessages(): void {
    for (const m of this.#controlMessages.splice(0)) {
      if (m.type === "world") {
        this.#predictor.reload(m.frame, m.snapshot);
        this.#syncCars();
      } else if (m.type === "event" && m.event.kind === "goal") {
        const team = m.event.team === 1 ? 1 : 0;
        this.#score[team] += 1;
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
      this.#cars.set(id, { view, state: new Interpolated(state) });
    }
    this.#pushStates();
    this.#pushStates();
  }

  #pushStates(): void {
    for (const [id, entry] of this.#cars) entry.state.push(this.#world.car(id));
    this.#ball.push(this.#ballSpin.advance(this.#world.ball(), TICK_SECONDS));
  }

  #handleActions(held: HeldActions, options: Options): void {
    const pressed = (key: keyof HeldActions): boolean => held[key] && !this.#held[key];
    if (!options.ballCamToggle) this.#ballCam = held.ballCam;
    else if (pressed("ballCam")) this.#ballCam = !this.#ballCam;
    if (!options.rearCameraToggle) this.#rear = held.rearCamera;
    else if (pressed("rearCamera")) this.#rear = !this.#rear;
    this.#held = held; // (freeplay's reset and ball placement do nothing online)
  }

  #draw(frameSeconds: number): void {
    const alpha = this.#clock.alpha;
    for (const { view, state } of this.#cars.values()) {
      view.update(state.position(alpha, this.#pos), state.rotation(alpha, this.#rot), state.current.boosting, state.current.demoed);
    }
    const ball = this.#ball.position(alpha, this.#pos);
    this.#ballView.update(ball, this.#ball.rotation(alpha, this.#rot));
    this.#arena.update(ball, frameSeconds);
    this.#padsView.update(this.#world.boostPads());

    const local = this.#cars.get(this.#localCar)?.state;
    if (local) {
      const view = this.#camera.update(frameSeconds, local.blended(alpha), this.#ball.blended(alpha).pos, {
        ballCam: this.#ballCam,
        rear: this.#rear,
        lookUp: this.#look.up,
        lookRight: this.#look.right,
      });
      this.#renderer.render(view);
    }

    if (frameSeconds > 0) this.#fps += (1 / frameSeconds - this.#fps) * 0.05;
    const car = local?.current;
    const ping = this.#ping === null ? "ping –" : `ping ${String(Math.round(this.#ping))} ms`;
    this.#hud.update({
      boost: car?.boost ?? 0,
      speed: car ? Math.hypot(car.vel.x, car.vel.y, car.vel.z) : 0,
      supersonic: car?.supersonic ?? false,
      score: this.#score,
      ballCam: this.#ballCam,
      message: this.#disconnected === null ? this.#message : `Disconnected: ${this.#disconnected}`,
      fps: this.#fps,
      net: `${ping} · ${this.#bufferText} · ${String(this.#cars.size)} cars`,
    });
  }
}
