// Offline freeplay: one car, the ball, boost pads, goals. Runs the physics at a fixed 120 Hz and
// renders interpolated states.
import { Quaternion, Vector3 } from "three";
import { Interpolated } from "./interpolated";
import { PlayerCamera } from "../camera/rlCamera";
import type { BodyState, CarState, World } from "../engine/world";
import { type Hud, respawnHud } from "../hud";
import type { InputDevices } from "../input/devices";
import { AirPitchSafety, ButtonLatch, EMPTY_INPUT, type HeldActions, type LookInput, readControls, readHeldActions, readLook } from "../input/mapping";
import type { ControllerSettings, Options, Settings } from "../settings/settings";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import { type Vec3, ZERO, add, scale, vec3 } from "../math/vec";
import { BALL_RADIUS, BallView, BoostPadsView, CarView } from "../render/entities";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";

const GOAL_RESET_SECONDS = 2;

export class Freeplay {
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
  readonly #playerId: number;
  readonly #clock = new FixedStep();
  readonly #camera = new PlayerCamera();
  readonly #carView: CarView;
  readonly #ballView = new BallView();
  readonly #padsView: BoostPadsView;
  readonly #car: Interpolated<CarState>;
  readonly #ball: Interpolated<BodyState>;
  #ballSpawns = 0; // the ball's spawn counter last tick (a reset places it: not interpolated)
  readonly #score: [number, number] = [0, 0];
  #held: HeldActions = { ballCam: false, rearCamera: false, reset: false, ballInFront: false, ballOnCar: false };
  #ballCam = false;
  #rear = false;
  #look: LookInput = { up: 0, right: 0 };
  readonly #pitchSafety = new AirPitchSafety();
  readonly #buttons = new ButtonLatch(); // (buttons as the game's press and release commands: C-4)
  #preferences: ControllerSettings | null = null;
  #goalTimer = 0;
  #message: string | null = null;
  #kickoffSeed = 1;
  #fps = 60;
  readonly #pos = new Vector3();
  readonly #rot = new Quaternion();

  constructor(
    world: World,
    renderer: Renderer,
    arena: ArenaView,
    input: InputDevices,
    hud: Hud,
    audio: GameAudio,
    /** Current settings, and whether the player's input drives the car (false while a menu is open). */
    private readonly settings: () => Settings,
    private readonly inputEnabled: () => boolean,
  ) {
    this.#world = world;
    this.#renderer = renderer;
    this.#arena = arena;
    this.#input = input;
    this.#hud = hud;
    this.#audio = audio;
    this.#playerId = world.addCar(0);
    world.resetKickoff(this.#kickoffSeed);

    this.#carView = new CarView(world.carConfig(this.#playerId), 0);
    this.#padsView = new BoostPadsView(world.boostPads());
    renderer.scene.add(this.#carView.root, this.#ballView.root, this.#padsView.root);
    this.#car = new Interpolated(world.car(this.#playerId));
    this.#ball = new Interpolated(world.ball());
    this.#ballSpawns = world.ballSpawnCount();
  }

  /** One animation frame. `frameSeconds`: real time since the previous frame. */
  frame(frameSeconds: number): void {
    const settings = this.settings();
    this.#applyPreferences(settings.controller);
    const polled = this.#input.snapshot();
    const snapshot = this.inputEnabled() ? polled : EMPTY_INPUT;
    const { bindings, controller, options } = settings;
    this.#handleActions(readHeldActions(snapshot, bindings, controller.deadzone), options);
    const raw = readControls(snapshot, bindings, controller.deadzone, this.#buttons);
    const onGround = this.#car.current.onGround;
    const safety = this.#pitchSafety.update(options.airPitchSafety, this.#input.usingGamepad, onGround, raw);
    const controls = { ...raw, airPitchSafety: safety, dodgeForward: -raw.pitch }; // (its own byte: C-2)
    const look = readLook(snapshot, bindings, controller.deadzone);
    // PlayerController_TA.SwivelPitchDir
    this.#look = { up: options.invertSwivelPitch ? -look.up : look.up, right: look.right };
    this.#camera.settings = settings.camera;

    this.#throttle = Math.abs(controls.throttle);

    const ticks = this.#clock.advance(frameSeconds);
    for (let i = 0; i < ticks; i++) {
      this.#world.setControls(this.#playerId, controls);
      this.#world.step();
      const car = this.#world.car(this.#playerId);
      this.#car.push(car, car.spawnCount !== this.#car.current.spawnCount);
      this.#pushBall();
      this.#trackFlip();
      this.#handleEvents();
      this.#updateGoalTimer();
    }

    this.#draw(frameSeconds, ticks * TICK_SECONDS);
  }

  /** The engine applies the sensitivities and dodge deadzone, like the game's PRI car preferences. */
  #applyPreferences(c: ControllerSettings): void {
    if (c === this.#preferences) return;
    this.#preferences = c;
    this.#world.setCarPreferences(this.#playerId, {
      dodgeDeadzone: c.dodgeDeadzone,
      steeringSensitivity: c.steeringSensitivity,
      airControlSensitivity: c.aerialSensitivity,
    });
  }

  #handleActions(held: HeldActions, options: Options): void {
    const pressed = (key: keyof HeldActions): boolean => held[key] && !this.#held[key];
    // PressSecondaryCamera / PressRearCamera: toggle on press, or follow the button
    if (!options.ballCamToggle) this.#ballCam = held.ballCam;
    else if (pressed("ballCam")) this.#ballCam = !this.#ballCam;
    if (!options.rearCameraToggle) this.#rear = held.rearCamera;
    else if (pressed("rearCamera")) this.#rear = !this.#rear;
    if (pressed("reset")) this.#resetKickoff();
    if (pressed("ballInFront")) this.#placeBall(false);
    if (pressed("ballOnCar")) this.#placeBall(true);
    this.#held = held;
  }

  #handleEvents(): void {
    for (const event of this.#world.takeEvents()) {
      if (event.type === "goal" && this.#goalTimer <= 0) {
        this.#score[event.scoringTeam] += 1;
        this.#audio.goal();
        this.#message = event.scoringTeam === 0 ? "BLUE SCORES!" : "ORANGE SCORES!";
        this.#goalTimer = GOAL_RESET_SECONDS;
      }
    }
  }

  /** After a goal the ball goes back to the centre; the car stays where it is (as in freeplay). */
  #updateGoalTimer(): void {
    if (this.#goalTimer <= 0) return;
    this.#goalTimer -= TICK_SECONDS;
    if (this.#goalTimer <= 0) {
      this.#world.setBall({ pos: vec3(0, 0, BALL_RADIUS + 1.9), vel: ZERO, angVel: ZERO });
      this.#pushBall();
      this.#message = null;
    }
  }

  #resetKickoff(): void {
    this.#kickoffSeed += 1;
    this.#world.resetKickoff(this.#kickoffSeed);
    this.#goalTimer = 0;
    this.#message = null;
    this.#snapViews();
  }

  /** For screenshots and browser tests: the car on the floor at (x, y) facing `yaw` (rad, the game's), at rest, and
   *  the ball at `ball` if given. */
  debugPlace(car: { readonly x: number; readonly y: number; readonly yaw: number }, ball?: Vec3): void {
    const forward = vec3(Math.cos(car.yaw), Math.sin(car.yaw), 0);
    const rot = { forward, right: vec3(-forward.y, forward.x, 0), up: vec3(0, 0, 1) };
    this.#world.setCar(this.#playerId, { pos: vec3(car.x, car.y, 17.01), vel: ZERO, angVel: ZERO, rot, boost: 33 });
    if (ball) this.#world.setBall({ pos: ball, vel: ZERO, angVel: ZERO });
    this.#snapViews();
  }

  /** Freeplay helpers: ball in front of the car, or dropped onto its roof. */
  #placeBall(onCar: boolean): void {
    const car = this.#world.car(this.#playerId);
    const flatForward = vec3(car.rot.forward.x, car.rot.forward.y, 0);
    const pos = onCar
      ? add(car.pos, vec3(0, 0, 200))
      : add(add(car.pos, scale(flatForward, 600)), vec3(0, 0, 300));
    this.#world.setBall({ pos, vel: onCar ? car.vel : ZERO, angVel: ZERO });
    this.#pushBall();
  }

  /** Whether the car can dodge, after this tick (the flip indicator). */
  #trackFlip(): void {
    const { dodge, reset } = this.#flipTracker.tick(this.#car.current, TICK_SECONDS);
    this.#dodge = dodge;
    if (reset) this.#flipReset = true;
  }

  /** The ball's latest state (its orientation the engine's); a reset places it, not interpolated across the field */
  #pushBall(): void {
    const spawns = this.#world.ballSpawnCount();
    this.#ball.push(this.#world.ball(), spawns !== this.#ballSpawns);
    this.#ballSpawns = spawns;
  }

  #snapViews(): void {
    this.#car.push(this.#world.car(this.#playerId));
    this.#car.push(this.#world.car(this.#playerId));
    this.#pushBall();
    this.#pushBall();
    this.#camera.reset();
  }

  /** `simulated`: seconds of physics run this frame. */
  #draw(frameSeconds: number, simulated: number): void {
    const alpha = this.#clock.alpha;
    const car = this.#car.current;
    this.#carView.update(
      this.#car.position(alpha, this.#pos),
      this.#car.rotation(alpha, this.#rot),
      car.boosting,
      car.demoed,
      car.supersonic,
      frameSeconds,
    );
    const ball = this.#ball.position(alpha, this.#pos);
    this.#ballView.root.visible = !this.#world.ballExploded(); // (a goal explodes it until the reset)
    this.#ballView.update(ball, this.#ball.rotation(alpha, this.#rot));
    this.#arena.update(ball, frameSeconds);
    const pads = this.#world.boostPads();
    this.#padsView.update(pads);

    const view = this.#camera.update(frameSeconds, this.#car.blended(alpha), this.#ball.blended(alpha).pos, {
      ballCam: this.#ballCam,
      rear: this.#rear,
      lookUp: this.#look.up,
      lookRight: this.#look.right,
    });
    this.#renderer.render(view);
    this.#audio.frame({
      world: { cars: new Map([[this.#playerId, car]]), ball: this.#ball.current, pads },
      localCar: this.#playerId,
      throttle: this.#throttle,
      simulated,
      camera: view,
    });

    if (frameSeconds > 0) this.#fps += (1 / frameSeconds - this.#fps) * 0.05;
    this.#hud.update({
      boost: car.boost,
      speed: Math.hypot(car.vel.x, car.vel.y, car.vel.z),
      supersonic: car.supersonic,
      score: this.#score,
      clock: null,
      ballCam: this.#ballCam,
      message: this.#message,
      fps: this.#fps,
      net: null,
      flip: this.settings().options.flipIndicator ? this.#dodge : null,
      flipReset: this.#flipReset,
      respawn: respawnHud(car),
    });
    if (this.#flipReset) this.#audio.flipReset();
    this.#flipReset = false;
  }
}
