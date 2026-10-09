// Offline freeplay: one car, the ball, boost pads, goals. Runs the physics at a fixed 120 Hz and
// renders interpolated states.
import { Quaternion, Vector3 } from "three";
import { Interpolated } from "./interpolated";
import { PlayerCamera } from "../camera/rlCamera";
import type { BodyState, CarState, World } from "../engine/world";
import { type Hud, respawnHud } from "../hud";
import type { InputDevices } from "../input/devices";
import { AirPitchSafety, ButtonLatch, EMPTY_INPUT, type HeldActions, JumpLatch, type LookInput, readControls, readHeldActions } from "../input/mapping";
import type { ControllerSettings, Options, Settings } from "../settings/settings";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import { type Vec3, ZERO, add, scale, vec3 } from "../math/vec";
import { BALL_RADIUS, BallView, BoostPadsView, CarView } from "../render/entities";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";
import { cameraInputs, newCar, updateSwitches } from "./cameraInput";
import type { FreeLookControls } from "../camera/rlCamera";
import { PostGoalClock } from "./goalSequence";

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
  #freeLook: FreeLookControls | null = null;
  readonly #pitchSafety = new AirPitchSafety();
  readonly #buttons = new ButtonLatch(); // (buttons as the game's press and release commands: C-4)
  readonly #jump = new JumpLatch(); // (a jump press is a tick of jump however short: LT-4)
  #preferences: ControllerSettings | null = null;
  /** After a goal, until the ball's reset (PostGoalScored: 3.0 game s, slowed at first, on game time: RV-1) */
  readonly #postGoal = new PostGoalClock();
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

  /** One animation frame. `rawSeconds`: time since the previous frame, unclamped. */
  frame(rawSeconds: number): void {
    // The frame's times (slowed after a goal); PostGoalTime up: the ball goes back to the centre
    const { world, real, done } = this.#postGoal.frame(rawSeconds);
    if (done) this.#resetBall();
    const settings = this.settings();
    this.#applyPreferences(settings.controller);
    const polled = this.#input.snapshot();
    const snapshot = this.inputEnabled() ? polled : EMPTY_INPUT;
    const { bindings, controller, options } = settings;
    const camera = cameraInputs(settings, snapshot, this.#input, this.#camera.fov);
    this.#handleActions(readHeldActions(snapshot, bindings, controller.deadzone), options, camera.device.ballCamToggle);
    const raw = readControls(snapshot, bindings, controller.deadzone, this.#buttons);
    this.#jump.frame(this.#buttons);
    const onGround = this.#car.current.onGround;
    const safety = this.#pitchSafety.update(options.airPitchSafety, this.#input.usingGamepad, onGround, raw);
    const controls = { ...raw, airPitchSafety: safety, dodgeForward: -raw.pitch }; // (its own byte: C-2)
    this.#look = camera.look;
    this.#freeLook = camera.freeLook;
    this.#camera.settings = settings.camera;

    this.#throttle = Math.abs(controls.throttle);

    const ticks = this.#clock.advance(world);
    for (let i = 0; i < ticks; i++) {
      this.#world.setControls(this.#playerId, { ...controls, jump: this.#jump.tick(controls.jump) });
      this.#world.step();
      const car = this.#world.car(this.#playerId);
      const placed = car.spawnCount !== this.#car.current.spawnCount;
      if (placed) this.#rear = newCar({ ballCam: this.#ballCam, rear: this.#rear }).rear;
      this.#car.push(car, placed);
      this.#pushBall();
      this.#trackFlip();
      this.#handleEvents();
    }

    this.#draw(world, ticks * TICK_SECONDS, real);
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

  #handleActions(held: HeldActions, options: Options, ballCamToggle: boolean): void {
    const pressed = (key: keyof HeldActions): boolean => held[key] && !this.#held[key];
    const next = updateSwitches({ ballCam: this.#ballCam, rear: this.#rear }, held, this.#held, {
      ballCamToggle,
      rearCameraToggle: options.rearCameraToggle,
      blocked: false,
    });
    this.#ballCam = next.ballCam;
    this.#rear = next.rear;
    if (pressed("reset")) this.#resetKickoff();
    if (pressed("ballInFront")) this.#placeBall(false);
    if (pressed("ballOnCar")) this.#placeBall(true);
    this.#held = held;
  }

  #handleEvents(): void {
    for (const event of this.#world.takeEvents()) {
      if (event.type === "goal" && !this.#postGoal.active) {
        this.#score[event.scoringTeam] += 1;
        this.#audio.goal();
        this.#message = event.scoringTeam === 0 ? "BLUE SCORES!" : "ORANGE SCORES!";
        this.#postGoal.start();
      }
    }
  }

  /** After a goal (PostGoalTime 3.0 game s, the first of them slowed) the ball goes back to the centre; the car stays
   *  where it is (as in freeplay). */
  #resetBall(): void {
    this.#world.setBall({ pos: vec3(0, 0, BALL_RADIUS + 1.9), vel: ZERO, angVel: ZERO });
    this.#pushBall();
    this.#message = null;
  }

  #resetKickoff(): void {
    this.#kickoffSeed += 1;
    this.#world.resetKickoff(this.#kickoffSeed);
    this.#postGoal.stop(); // (a reset ends the goal's wait)
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
    this.#rear = newCar({ ballCam: this.#ballCam, rear: this.#rear }).rear; // (a reset: a new car)
    this.#car.push(this.#world.car(this.#playerId));
    this.#car.push(this.#world.car(this.#playerId));
    this.#pushBall();
    this.#pushBall();
    this.#camera.reset();
  }

  /** `frameSeconds`: the frame's world time (slowed after a goal); `simulated`: seconds of physics run this frame;
   *  `realSeconds`: real time since the last frame. */
  #draw(frameSeconds: number, simulated: number, realSeconds: number): void {
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

    const controls = { ballCam: this.#ballCam, rear: this.#rear, lookUp: this.#look.up, lookRight: this.#look.right, freeLook: this.#freeLook };
    const view = this.#camera.update(frameSeconds, this.#car.blended(alpha), this.#ball.blended(alpha).pos, controls, null, realSeconds);
    if (this.#camera.takeBallCamExit()) this.#ballCam = false; // (free look left the toggled ball cam)
    this.#renderer.render(view);
    this.#audio.frame({
      world: { cars: new Map([[this.#playerId, car]]), ball: this.#ball.current, pads },
      localCar: this.#playerId,
      throttle: this.#throttle,
      simulated,
      camera: view,
    });

    if (realSeconds > 0) this.#fps += (1 / realSeconds - this.#fps) * 0.05;
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
