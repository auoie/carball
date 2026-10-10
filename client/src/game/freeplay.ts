// Offline freeplay: one car, the ball, boost pads, goals. Runs the physics at a fixed 120 Hz and
// renders interpolated states.
import { Quaternion, Vector3 } from "three";
import { Interpolated } from "./interpolated";
import { PlayerCamera } from "../camera/rlCamera";
import { BOOST_SPAWN_AMOUNT, type BodyState, type CarState, type World } from "../engine/world";
import { type Hud, respawnHud } from "../hud";
import type { InputDevices } from "../input/devices";
import { AirPitchSafety, ButtonLatch, EMPTY_INPUT, type HeldActions, JumpLatch, type LookInput, readControls, readHeldActions } from "../input/mapping";
import type { ControllerSettings, Options, Settings } from "../settings/settings";
import { FixedStep, TICK_SECONDS, frameTimes } from "../loop/fixedStep";
import { type Vec3, ZERO, add, scale, vec3 } from "../math/vec";
import { BallView, BoostPadsView, CarView, trailGround } from "../render/entities";
import { SceneEffects } from "../render/effects";
import { EXPLOSION_LARGE } from "../camera/shake";
import { ShakeTriggers } from "./shakeTriggers";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";
import { cameraInputs, newCar, updateSwitches } from "./cameraInput";
import type { FreeLookControls } from "../camera/rlCamera";
import type { ReplayPlan } from "../net/protocol";
import { Fade } from "../render/fade";
import { TouchLog, planReplay } from "./replayPlan";
import { ReplayPlayback, explosionTeam } from "./replayPlayback";
import { ReplayRecorder, recordCar } from "./replayRecorder";
import {
  FREEPLAY_BALL_HOLD_TICKS,
  FREEPLAY_COUNTDOWN_TICKS,
  FREEPLAY_NET_TEAM,
  FREEPLAY_PAD_RESET_TICKS,
  FREEPLAY_RESET_COOLDOWN,
  PostGoalClock,
} from "./goalSequence";

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
  readonly #effects: SceneEffects;
  readonly #shakeTriggers = new ShakeTriggers();
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
  /** The session's kickoff spots' shuffle (the game's: random per session) */
  readonly #sessionSeed = 1 + Math.floor(Math.random() * 0x7ffffffe);
  /** NextSpawnIndex: the next round's spot, S[k mod 10]; steps when a round's countdown ends */
  #spawnIndex = 0;
  /** Ticks to freeplay's second pad reset (0: none due) */
  #padResetTicks = 0;
  #unlimitedBoost: boolean;
  /** The new ball held at its spawn this many more ticks, and where that is */
  #ballHold = 0;
  #ballSpawn: Vec3 = ZERO;
  /** Game seconds since the player's last reset (Backspace: a cooldown) */
  #sinceReset = Infinity;
  /** The goal replay (no freeplay special case: unless the player skips goal replays): what each tick drew, the
   *  round's touches and the ball's spawn tick for its plan, the plan of the goal waiting, the replay playing */
  readonly #recorder = new ReplayRecorder();
  readonly #touches = new TouchLog();
  #ballSpawnTick = 0;
  #replayPlan: ReplayPlan | null = null;
  #replay: ReplayPlayback | null = null;
  readonly #fade = new Fade();
  #skipHeld = true;
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
    // (Unlimited boost in free play: on by default, as the game's; off, 33 each round, used up, and pads taken)
    this.#unlimitedBoost = settings().options.unlimitedBoost;
    world.setUnlimitedBoost(this.#unlimitedBoost);
    this.#startRound();

    this.#effects = new SceneEffects(renderer.scene);
    this.#carView = new CarView(world.carConfig(this.#playerId), 0, this.#effects.particles);
    this.#padsView = new BoostPadsView(world.boostPads());
    renderer.scene.add(this.#carView.root, this.#ballView.root, this.#padsView.root);
    this.#car = new Interpolated(world.car(this.#playerId));
    this.#ball = new Interpolated(world.ball());
    this.#ballSpawns = world.ballSpawnCount();
    this.#ballView.spawn(); // (the first ball fades in too: RV-37)
  }

  /** One animation frame. `rawSeconds`: time since the previous frame, unclamped. */
  frame(rawSeconds: number): void {
    this.#applyBoostSetting();
    let replay = this.#replay;
    if (!replay) {
      // The frame's times (slowed after a goal); PostGoalTime up: the goal replay, or a new round (RV-21)
      const { world, real, done } = this.#postGoal.frame(rawSeconds);
      if (done) replay = this.#replay = this.#endPostGoal();
      if (!replay) {
        this.#play(world, real);
        return;
      }
    }
    this.#playReplay(rawSeconds, replay);
  }

  /** PostGoalTime up (StartReplay): the replay unless the player skips them (ShouldPlayReplayPlayback: no freeplay
   *  case), cutting in from black; else (null) the new round in the same tick */
  #endPostGoal(): ReplayPlayback | null {
    const plan = this.#replayPlan;
    this.#replayPlan = null;
    if (!plan || this.settings().options.autoSkipReplay) {
      this.#resetKickoff();
      return null;
    }
    this.#postGoal.stop();
    this.#ballView.spawn(true);
    this.#arena.newBall();
    this.#fade.fromBlack();
    this.#skipHeld = true; // (a key already down doesn't skip it)
    return new ReplayPlayback(plan, this.#recorder, undefined, FREEPLAY_NET_TEAM);
  }

  /** A frame of the goal replay: skipped by Space or the pad's A (ReadyUp), else to its end; then the new round, its
   *  camera cutting in from black */
  #playReplay(rawSeconds: number, replay: ReplayPlayback): void {
    const { real } = frameTimes(rawSeconds, 1);
    this.#fade.update(real);
    const snapshot = this.inputEnabled() ? this.#input.snapshot() : EMPTY_INPUT;
    const held = snapshot.keys.has("Space") || (snapshot.pressedKeys?.has("Space") ?? false) || (snapshot.gamepad?.buttons[0] ?? 0) > 0.5;
    const skipped = held && !this.#skipHeld;
    this.#skipHeld = held;
    replay.frame(real, {
      renderer: this.#renderer,
      arena: this.#arena,
      effects: this.#effects,
      audio: this.#audio,
      ballView: this.#ballView,
      cars: [[this.#playerId, this.#carView]],
    });
    this.#updateHud(this.#car.current, real, "REPLAY", "Space / (A) to skip");
    if (!skipped && !replay.done) return;
    this.#replay = null;
    this.#fade.fromBlack();
    this.#resetKickoff(); // (the skip's jump press, held into the countdown, doesn't jump: the engine, RV-55)
  }

  /** A frame of play: `world` its world time (slowed after a goal), `real` its real time */
  #play(world: number, real: number): void {
    this.#sinceReset += world;
    this.#fade.update(real);
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
    this.#camera.shake = options.cameraShake;

    this.#throttle = Math.abs(controls.throttle);

    const ticks = this.#clock.advance(world);
    for (let i = 0; i < ticks; i++) {
      const held = this.#world.kickoffCountdown() > 0;
      this.#world.setControls(this.#playerId, { ...controls, jump: this.#jump.tick(controls.jump) });
      this.#world.step();
      this.#roundTick(held);
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
    if (pressed("reset") && this.#sinceReset >= FREEPLAY_RESET_COOLDOWN) {
      this.#sinceReset = 0;
      this.#resetKickoff();
    }
    if (pressed("ballInFront")) this.#placeBall(false);
    if (pressed("ballOnCar")) this.#placeBall(true);
    this.#held = held;
  }

  /** After a tick: the round's countdown ending (the spot index steps), the second pad reset, the new ball's hold; the
   *  ball's touches and the frame recorded for a replay */
  #roundTick(heldBefore: boolean): void {
    const tick = this.#world.tick;
    const car = this.#world.car(this.#playerId);
    this.#touches.update(this.#playerId, car.team, this.#world.carLastBallTouchTick(this.#playerId));
    // (the new ball held first, so the frame recorded is the one drawn: RV-92)
    if (this.#ballHold > 0) {
      this.#ballHold -= 1;
      this.#world.setBall({ pos: this.#ballSpawn, vel: ZERO, angVel: ZERO });
    }
    this.#recorder.record(tick, {
      cars: new Map([[this.#playerId, recordCar(car)]]),
      ball: this.#world.ball(),
      ballExploded: this.#world.ballExploded(),
    });
    if (heldBefore && this.#world.kickoffCountdown() === 0) this.#spawnIndex += 1;
    if (this.#padResetTicks > 0) {
      this.#padResetTicks -= 1;
      if (this.#padResetTicks === 0) this.#world.resetBoostPads();
    }
  }

  #handleEvents(): void {
    for (const event of this.#world.takeEvents()) {
      if (event.type === "goal" && !this.#postGoal.active) {
        // (either net scores for the player's team; no scored message offline: ShowScorerGoalMessage, RV-38)
        this.#score[0] += 1;
        this.#audio.goal();
        this.#postGoal.start();
        this.#replayPlan = planReplay(this.#touches.touches, this.#world.tick, event.scoringTeam, this.#ballSpawnTick, false);
        this.#effects.goal(this.#world.ball().pos, explosionTeam(FREEPLAY_NET_TEAM)); // (the player's colour at either net)
        this.#arena.explode();
        this.#camera.shakes.play(EXPLOSION_LARGE, this.#world.ball().pos);
      }
    }
  }

  /** A new round (a goal's end, or the player's reset: StartNewRound → ResetPlayers, ResetBalls, ResetPickups): the
   *  car on the session's next kickoff spot, held through freeplay's 0.01 s countdown, a new ball fading in */
  #resetKickoff(): void {
    this.#startRound();
    this.#postGoal.stop(); // (a reset ends the goal's wait)
    this.#ballView.spawn(); // (a new ball fades in)
    this.#arena.newBall();
    this.#snapViews();
  }

  /** The new round in the world (notes/camera-respawn-goal.md "Freeplay after a goal"): the car at S[k mod 10], the
   *  ball at its spawn to fall, the pads back now and again 0.1 s later, the countdown */
  #startRound(): void {
    this.#world.resetFreeplay(this.#sessionSeed, this.#spawnIndex);
    this.#world.setKickoffCountdown(FREEPLAY_COUNTDOWN_TICKS);
    this.#padResetTicks = FREEPLAY_PAD_RESET_TICKS;
    this.#ballHold = FREEPLAY_BALL_HOLD_TICKS;
    this.#ballSpawn = this.#world.ball().pos;
    this.#ballSpawnTick = this.#world.tick;
    this.#touches.clear();
    this.#replayPlan = null;
  }

  /** For screenshots and browser tests: the car on the floor at (x, y) facing `yaw` (rad, the game's), at rest, and
   *  the ball at `ball` if given. */
  debugPlace(car: { readonly x: number; readonly y: number; readonly yaw: number; readonly boost?: number }, ball?: Vec3): void {
    const forward = vec3(Math.cos(car.yaw), Math.sin(car.yaw), 0);
    const rot = { forward, right: vec3(-forward.y, forward.x, 0), up: vec3(0, 0, 1) };
    // (100 with Unlimited boost, at which a car takes no pads (CanPickup: !IsFull); else a round's 33; or as given)
    this.#world.setCar(this.#playerId, { pos: vec3(car.x, car.y, 17.01), vel: ZERO, angVel: ZERO, rot, boost: car.boost ?? (this.#unlimitedBoost ? 100 : BOOST_SPAWN_AMOUNT) });
    if (ball) {
      this.#ballHold = 0;
      this.#world.setBall({ pos: ball, vel: ZERO, angVel: ZERO });
    }
    this.#snapViews();
  }

  /** For the browser tests: where the car is and how fast it goes */
  debugCar(): { readonly pos: Vec3; readonly speed: number } {
    const car = this.#world.car(this.#playerId);
    return { pos: car.pos, speed: Math.hypot(car.vel.x, car.vel.y, car.vel.z) };
  }

  /** For screenshots: a demolition's effect at `at` (game frame) */
  debugDemolition(at: Vec3): void {
    this.#effects.demolition(at);
  }

  /** For screenshots and tests: live particles */
  debugParticles(): number {
    return this.#effects.particles.count;
  }

  /** For the browser tests: the pads (taken or not) and the car's boost */
  debugPads(): { readonly pads: readonly { readonly x: number; readonly y: number; readonly big: boolean; readonly active: boolean }[]; readonly boost: number } {
    return {
      pads: this.#world.boostPads().map((p) => ({ x: p.pos.x, y: p.pos.y, big: p.big, active: p.active })),
      boost: this.#world.car(this.#playerId).boost,
    };
  }

  /** The Unlimited boost setting changed: on fills the tank (the engine's), off leaves it as a new round would */
  #applyBoostSetting(): void {
    const unlimited = this.settings().options.unlimitedBoost;
    if (unlimited === this.#unlimitedBoost) return;
    this.#unlimitedBoost = unlimited;
    this.#world.setUnlimitedBoost(unlimited);
    if (!unlimited) {
      const car = this.#world.car(this.#playerId);
      this.#world.setCar(this.#playerId, { pos: car.pos, vel: car.vel, angVel: car.angVel, rot: car.rot, boost: BOOST_SPAWN_AMOUNT });
    }
  }

  /** Freeplay helpers: ball in front of the car, or dropped onto its roof. */
  #placeBall(onCar: boolean): void {
    const car = this.#world.car(this.#playerId);
    const flatForward = vec3(car.rot.forward.x, car.rot.forward.y, 0);
    const pos = onCar
      ? add(car.pos, vec3(0, 0, 200))
      : add(add(car.pos, scale(flatForward, 600)), vec3(0, 0, 300));
    this.#ballHold = 0;
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
      trailGround(car),
      this.#throttle > 0,
    );
    const ball = this.#ball.position(alpha, this.#pos);
    this.#ballView.fade(this.#world.ballExploded(), frameSeconds); // (a goal explodes it until the reset: it dissolves)
    this.#effects.update(frameSeconds);
    const own = this.#car.current;
    this.#shakeTriggers.frame(this.#camera.shakes, own, new Map([[this.#playerId, own]]), this.#world.boostPads(), (c) => {
      this.#effects.demolition(c.pos);
    });
    this.#ballView.update(ball, this.#ball.rotation(alpha, this.#rot));
    this.#arena.update(ball, frameSeconds);
    const pads = this.#world.boostPads();
    this.#padsView.update(pads, frameSeconds);

    const controls = { ballCam: this.#ballCam, rear: this.#rear, lookUp: this.#look.up, lookRight: this.#look.right, freeLook: this.#freeLook };
    const view = this.#camera.update(frameSeconds, this.#car.blended(alpha), this.#ball.blended(alpha).pos, controls, null, realSeconds);
    if (this.#camera.takeBallCamExit()) this.#ballCam = false; // (free look left the toggled ball cam)
    this.#renderer.render(view);
    this.#effects.camera = view.position; // (the husks collide near it)
    this.#audio.frame({
      world: { cars: new Map([[this.#playerId, car]]), ball: this.#ball.current, pads },
      localCar: this.#playerId,
      throttle: this.#throttle,
      simulated,
      camera: view,
    });

    this.#updateHud(car, realSeconds);
  }

  /** The HUD; `message` and `hint`: what it says (a replay's) */
  #updateHud(car: CarState, realSeconds: number, message: string | null = null, hint: string | null = null): void {
    if (realSeconds > 0) this.#fps += (1 / realSeconds - this.#fps) * 0.05;
    this.#hud.update({
      boost: car.boost,
      speed: Math.hypot(car.vel.x, car.vel.y, car.vel.z),
      supersonic: car.supersonic,
      score: this.#score,
      clock: null,
      ballCam: this.#ballCam,
      message, // (no scored message in offline freeplay: RV-38)
      hint,
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
