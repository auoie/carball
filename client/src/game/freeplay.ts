// Offline freeplay: one car, the ball, boost pads, goals. Runs the physics at a fixed 120 Hz and
// renders interpolated states.
import { flipAudio, flipVisual } from "../hud";
import { Quaternion, Vector3 } from "three";
import { Interpolated } from "./interpolated";
import { PlayerCamera } from "../camera/carballCamera";
import { BOOST_SPAWN_AMOUNT, type BodyState, type CarConfig, type CarState, type Team, type World } from "../engine/world";
import { DEFAULT_CAR, carChoice } from "./cars";
import { type Hud, type ReplayGoal, type ReplayHud, replaySpeed, replayTime, respawnView } from "../hud";
import { keyGlyph } from "../ui/keyGlyph";
import type { InputDevices } from "../input/devices";
import {
  AirPitchSafety,
  ButtonLatch,
  type CommandAction,
  EMPTY_INPUT,
  type HeldActions,
  JumpLatch,
  type LookInput,
  NO_HELD_ACTIONS,
  presses,
  readControls,
  readHeldActions,
} from "../input/mapping";
import type { ControllerSettings, Options, Settings } from "../settings/settings";
import { FixedStep, TICK_SECONDS, frameTimes } from "../loop/fixedStep";
import { type Vec3, ZERO, add, scale, sub, vec3 } from "../math/vec";
import { type CommandCar, defendVelocity, passVelocity, poppedUp, teleportAllowed, teleportTarget, teleportedBall } from "./freeplayCommands";
import { rotationAxes, vectorToRotator } from "../camera/unreal";
import { BallView, CarView, trailGround } from "../render/entities";
import type { PadsView } from "../render/tokenPads";
import { SceneEffects } from "../render/effects";
import { EXPLOSION_LARGE, IMPACT_MEDIUM } from "../camera/shake";
import { ImpactTriggers, triggerSounds } from "./impactTriggers";
import { ShakeTriggers } from "./shakeTriggers";
import type { ArenaView } from "../render/arena";
import type { Renderer } from "../render/renderer";
import type { GameAudio } from "../audio/audio";
import { type Dodge, FlipTracker } from "./flipTracker";
import { cameraInputs, newCar, updateSwitches } from "./cameraInput";
import type { FreeLookControls } from "../camera/carballCamera";
import type { ReplayPlan } from "../net/protocol";
import { Fade } from "../render/fade";
import { LOAD_FADE_IN } from "./matchSequence";
import { TouchLog, planReplay } from "./replayPlan";
import { ReplayPlayback } from "./replayPlayback";
import { ReplayRecorder, freeplayTouchTeam, recordCar } from "./replayRecorder";
import { BallArrow, ballArrowShown } from "../render/ballArrow";
import { FlipResetFx } from "../render/flipResetFx";
import { fromThreeVector } from "../render/coords";
import { BALL_PATH, BallPathView, EDITOR_PATH } from "../render/ballPath";
import type { CameraView } from "../camera/carballCamera";
import { DisabledGoalView } from "../render/disabledGoal";
import { type Shot, type TrainingPack, rotatorAxes } from "../training/pack";
import { type ShotResult, type TestKind, TrainingRun, launchVelocity } from "../training/run";
import { resetWarned, startingBoost, storeProgress, storeResetWarned, storedProgress } from "../training/settings";
import { applyVariance, rollVariance } from "../training/variance";
import {
  FREEPLAY_BALL_HOLD_TICKS,
  FREEPLAY_COUNTDOWN_TICKS,
  FREEPLAY_NET_TEAM,
  FREEPLAY_PAD_RESET_TICKS,
  FREEPLAY_RESET_COOLDOWN,
  PostGoalClock,
} from "./goalSequence";

/** The garage's stand (showGarage): the car's spot (on the field's floor, off the ball's kickoff and the pads' rows) and
 *  its facing (rad: toward the orange goal), the camera off its front left by `angle` (rad), `distance` and `height`
 *  away (uu, the least), looking at `lookAt` uu up beside the car, its horizontal field of view (°) */
const GARAGE = {
  at: vec3(-1200, -1600, 17.01),
  yaw: Math.PI / 2,
  angle: (40 * Math.PI) / 180,
  distance: 430,
  height: 95,
  lookAt: 30,
  fov: 55,
  /** (the car's width on screen at `distance`, a share of the view's: past `fill` of the space beside the menu's page,
   *  the camera backs off) */
  width: 0.33,
  fill: 0.8,
} as const;

/** Custom training: the countdown's hold (ticks: until the shot starts), the car's rest height on the floor (uu), the
 *  ball on the ground at or under this height (uu: the timer's run-out fails the shot then), the path preview's span (game
 *  s: a tenth of its 8) */
const TRAINING_HOLD = 1_000_000_000;
const CAR_REST_Z = 17.01;
const BALL_GROUND_Z = 95;
const TRAINING_PATH_SECONDS = 0.8;
/** The editor's path predicted at most this often (real s) while its shot keeps changing (the last change's always) */
const EDITOR_PATH_EVERY = 0.1;

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
  #playerId: number;
  readonly #clock = new FixedStep();
  readonly #camera = new PlayerCamera();
  #carView: CarView;
  readonly #effects: SceneEffects;
  readonly #shakeTriggers = new ShakeTriggers();
  /** The engine's contacts as the game's impact and landing triggers (notes/impact-triggers.md) */
  readonly #impactTriggers = new ImpactTriggers();
  #carConfigs: ReadonlyMap<number, CarConfig>;
  readonly #ballView = new BallView();
  /** The garage's team: the car's colour, the ball trail's after its touch (the engine's car is team 0 whatever it is) */
  #team: Team = 0;
  /** The garage's car (src/game/cars.ts) */
  #carId: number;
  /** The ball arrow by the car (HUD-17) */
  readonly #ballArrow = new BallArrow();
  /** The flip reset's effect on the car (HUD-19) */
  readonly #flipFx = new FlipResetFx();
  readonly #padsView: PadsView;
  #car: Interpolated<CarState>;
  readonly #ball: Interpolated<BodyState>;
  #ballSpawns = 0; // the ball's spawn counter last tick (a reset places it: not interpolated)
  readonly #score: [number, number] = [0, 0];
  #held: HeldActions = NO_HELD_ACTIONS;
  /** Whether the game took input last frame (back from a menu: what's held then is no press) */
  #inputOn = false;
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
  /** The ball's speed in the tick before the last goal (uu/s), the round's age then (game s): the replay's banner */
  #goalSpeed: number | null = null;
  #goalTime: number | null = null;
  #roundAge = 0;
  readonly #fade = new Fade();
  #skipHeld = true;
  #fps = 60;
  /** Custom training (null: free play): the pack's run and its settings; the ball-path preview, the prediction's own
   *  arena and points; the car's last touch seen; whether goals score now (only while an entry would count) */
  #training: TrainingRun | null = null;
  /** The shot as placed (mirrored and varied: its launch, its start speed) */
  #shot: Shot | null = null;
  readonly #ballPath = new BallPathView();
  /** The training editor's shot (null: not editing): the world holds it as placed, its whole path shown; the editor's
   *  camera (null: the car's) */
  #editing: Shot | null = null;
  /** The edited car held where it's placed, in the air too (the free-camera editor's), not put on the ground */
  #editAsPlaced = false;
  readonly #editorPath = new BallPathView(EDITOR_PATH.points);
  #editorPoints: { readonly pos: Vec3; readonly speed: number }[] | null = null;
  /** Real s since the editor's path was last predicted; whether the shot changed since */
  #sincePath = Infinity;
  #pathDue = false;
  editorCamera: CameraView | null = null;
  /** The garage's camera while its page shows (showGarage), else null */
  #garageCamera: CameraView | null = null;
  /** The goal that doesn't count, shown so (the striker's own, the goalie's opponent's: CTR-4) */
  readonly #disabledGoal = new DisabledGoalView();
  #predictor: World | null = null;
  #pathPoints: { readonly pos: Vec3; readonly speed: number }[] | null = null;
  #touchTick: number | null = null;
  #goalScoring = true;
  /** The signed-in account's name (the free-play replay's scorer); null: "Player" */
  accountName: string | null = null;
  /** Select Shot asked for since the page last took it */
  #selectRequested = false;
  /** The reset's first-time warning during or after a shot (§2.7: RoundResetBody), asked by the page: `retry` once
   *  answered Yes; null: none asked (the shot retried at once) */
  onResetWarning: ((retry: () => void) => void) | null = null;
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
    /** The garage's car and team colour (src/game/cars.ts) */
    garage: { readonly car: number; readonly team: Team } = { car: DEFAULT_CAR, team: 0 },
  ) {
    this.#world = world;
    this.#renderer = renderer;
    this.#arena = arena;
    this.#input = input;
    this.#hud = hud;
    this.#audio = audio;
    this.#playerId = world.addCar(0, carChoice(garage.car).body);
    this.#carId = garage.car;
    this.#team = garage.team;
    // (Unlimited boost in free play: on by default, as the game's; off, 33 each round, used up, and pads taken)
    this.#unlimitedBoost = settings().options.unlimitedBoost;
    world.setUnlimitedBoost(this.#unlimitedBoost);
    this.#startRound();

    this.#effects = new SceneEffects(renderer.scene);
    this.#fade.fromBlack(LOAD_FADE_IN); // (MIO-2: the arena fades in from black as it first draws)
    this.#carView = new CarView(world.carConfig(this.#playerId), garage.team, this.#effects.particles, garage.car);
    this.#carConfigs = new Map([[this.#playerId, world.carConfig(this.#playerId)]]);
    this.#padsView = arena.createPads(world.boostPads());
    renderer.scene.add(
      this.#carView.root,
      this.#ballView.root,
      this.#padsView.root,
      this.#ballArrow.root,
      this.#ballPath.root,
      this.#disabledGoal.root,
      this.#editorPath.root,
    );
    this.#car = new Interpolated(world.car(this.#playerId));
    this.#ball = new Interpolated(world.ball());
    this.#ballSpawns = world.ballSpawnCount();
  }

  /** One animation frame. `rawSeconds`: time since the previous frame, unclamped. */
  /** The viewed car's and the ball's velocities (uu/s, game frame: the Stat Graphs' Speed rows, HUD-21) */
  speeds(): { readonly car: Vec3 | null; readonly ball: Vec3 | null } {
    return { car: this.#car.current.vel, ball: this.#ball.current.vel };
  }

  frame(rawSeconds: number): void {
    this.#applyBoostSetting();
    let replay = this.#replay;
    if (!replay) {
      // The frame's times (slowed after a goal); PostGoalTime up: the goal replay, or a new round (RV-21)
      const { world, real, done } = this.#postGoal.frame(rawSeconds);
      if (done) replay = this.#replay = this.#endPostGoal();
      if (!replay) {
        // (training's Game Speed: the world slowed, its timer with it; real time as it is)
        this.#play(this.#training ? world * this.settings().training.gameSpeed : world, real);
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
    // (training: its own Skip Goal Replay, then the next shot: CTR-10)
    const skip = this.#training ? this.settings().training.skipReplay : this.settings().options.autoSkipReplay;
    if (!plan || skip) {
      this.#nextRound();
      return null;
    }
    this.#postGoal.stop();
    this.#ballView.spawn();
    this.#arena.newBall();
    this.#fade.fromBlack();
    this.#skipHeld = true; // (a key already down doesn't skip it)
    this.#carView.teleport(); // (the replay's first frame: the car back where it was, its sway fresh: RV-597)
    return new ReplayPlayback(plan, this.#recorder, undefined, FREEPLAY_NET_TEAM, this.#team);
  }

  /** A frame of the goal replay: skipped by Space or the pad's A (ReadyUp), else to its end; then the new round, its
   *  camera cutting in from black */
  #playReplay(rawSeconds: number, replay: ReplayPlayback): void {
    const { real } = frameTimes(rawSeconds, 1);
    this.#ballArrow.update(null, null); // (not in a replay: HUD-17)
    this.#fade.update(real);
    this.#renderer.cameraFade = this.#fade.opacity;
    const snapshot = this.inputEnabled() ? this.#input.snapshot() : EMPTY_INPUT;
    const actions = readHeldActions(snapshot, this.settings().bindings, this.settings().controller.deadzone);
    const held = actions.readyUp;
    const skipped = held && !this.#skipHeld;
    this.#skipHeld = held;
    // (training's commands in the replay too: reset retries the shot, the others move on at once: §2.7, §2.8)
    if (this.#training) {
      const acted = this.#trainingCommands(actions);
      this.#held = actions;
      if (acted) return;
    }
    replay.frame(real, {
      renderer: this.#renderer,
      arena: this.#arena,
      effects: this.#effects,
      audio: this.#audio,
      ballView: this.#ballView,
      cars: [[this.#playerId, this.#carView]],
      flipReset: { visual: flipVisual(this.settings().gameplay.flipResetIndicator), audio: flipAudio(this.settings().gameplay.flipResetIndicator) },
    });
    // (SkipInstructions, as online; the scorer is the player, no clock)
    const goal: ReplayGoal = {
      scorer: { name: this.accountName ?? "Player", team: this.#team },
      assister: null,
      time: this.#goalTime === null ? null : replayTime(this.#goalTime),
      speed: this.#goalSpeed === null ? null : replaySpeed(this.#goalSpeed, this.settings().interface.metric),
    };
    const { bindings } = this.settings();
    const skipKey = keyGlyph(this.#input.usingGamepad ? bindings.readyUp.gamepad : bindings.readyUp.keyboard);
    this.#updateHud(this.#car.current, real, { prompt: skipKey, waiting: null, goal });
    if (!skipped && !replay.done) return;
    replay.dispose();
    this.#replay = null;
    this.#fade.fromBlack();
    this.#nextRound(); // (the skip's jump press, held into the countdown, doesn't jump: the engine, RV-55)
  }

  /** After a goal's wait or replay: free play's next kickoff, or training's next shot (OnCurrentShotCompleted) */
  #nextRound(): void {
    this.#training?.advance();
    this.#resetKickoff();
  }

  /** A frame of play: `world` its world time (slowed after a goal), `real` its real time */
  #play(world: number, real: number): void {
    this.#sinceReset += world;
    this.#roundAge += world;
    this.#fade.update(real);
    this.#renderer.cameraFade = this.#fade.opacity;
    const settings = this.settings();
    this.#applyPreferences(settings.controller);
    const polled = this.#input.snapshot();
    // (the editor's: nothing driven; its path again once due)
    const snapshot = this.inputEnabled() && !this.#editing ? polled : EMPTY_INPUT;
    this.#sincePath += real;
    if (this.#editing && this.#pathDue && this.#sincePath >= EDITOR_PATH_EVERY) this.#predictEditorPath(this.#editing);
    const { bindings, controller, options } = settings;
    const camera = cameraInputs(settings, snapshot, this.#input, this.#camera.fov);
    if (this.#editing) this.#input.capturePointer = false; // (the editor's clicks place things: the pointer free)
    // (input back after a menu or a question: a key still down from it (Enter that picked the pack or answered Yes) is no
    // press, no Select Shot opened by it: RX25)
    const actions = readHeldActions(snapshot, bindings, controller.deadzone);
    const on = snapshot !== EMPTY_INPUT;
    if (on && !this.#inputOn) this.#held = actions;
    this.#inputOn = on;
    this.#handleActions(actions, options, camera.device.ballCamToggle);
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

    // (training's shot starts on throttle, steer, jump or boost: CTR-5)
    const inputActive = controls.throttle !== 0 || controls.steer !== 0 || controls.jump || controls.boost;
    const wantsStart = this.#training?.state === "countdown" && inputActive;
    const ticks = this.#clock.advance(world);
    for (let i = 0; i < ticks; i++) {
      const held = this.#world.kickoffCountdown() > 0;
      this.#world.setControls(this.#playerId, { ...controls, jump: this.#jump.tick(controls.jump) });
      this.#updateGoalScoring();
      this.#world.step();
      this.#roundTick(held, wantsStart);
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
    const count = (key: CommandAction): number => presses(held[key], this.#held[key]);
    const next = updateSwitches({ ballCam: this.#ballCam, rear: this.#rear }, held, this.#held, {
      ballCamToggle,
      rearCameraToggle: options.rearCameraToggle,
      blocked: false,
    });
    this.#ballCam = next.ballCam;
    this.#rear = next.rear;
    // (training: its own commands, no ball helpers or kickoff reset)
    if (this.#training) {
      this.#trainingCommands(held);
      this.#held = held;
      return;
    }
    if (count("reset") > 0 && this.#sinceReset >= FREEPLAY_RESET_COOLDOWN) {
      this.#sinceReset = 0;
      this.#resetKickoff();
    }
    // (the game's free-play ball commands, each once a press, the ball moving or not: FP3; N presses in a frame N times,
    // the wheel's notches too: FreeplayCommand → HandleFreeplayCommand → ActivateFreeplayCommand, the TAGame dump's 77100
    // and 29833, no cooldown, RV-1146)
    for (let i = count("ballInFront"); i > 0; i--) this.#teleportBall("possession");
    for (let i = count("ballOnCar"); i > 0; i--) this.#teleportBall("dribble");
    for (let i = count("passBall"); i > 0; i--) this.#launchBall("pass");
    for (let i = count("launchBall"); i > 0; i--) this.#launchBall("pop");
    for (let i = count("defendShot"); i > 0; i--) this.#launchBall("defend");
    this.#held = held;
  }

  /** After a tick: the round's countdown ending (the spot index steps), the second pad reset, the new ball's hold; the
   *  ball's touches and the frame recorded for a replay */
  #roundTick(heldBefore: boolean, wantsStart = false): void {
    const tick = this.#world.tick;
    const car = this.#world.car(this.#playerId);
    this.#touches.update(this.#playerId, car.team, this.#world.carLastBallTouchTick(this.#playerId));
    // (training's tick first: a touch lets the frozen ball go before its hold would place it again)
    if (this.#training) this.#trainingTick(this.#training, wantsStart);
    // (the free-camera editor's car held where it's placed, in the air too)
    if (this.#editing && this.#editAsPlaced) this.#placeCar(this.#editing, true);
    // (the new ball held first, so the frame recorded is the one drawn: RV-92)
    if (this.#ballHold > 0) {
      this.#ballHold -= 1;
      this.#world.setBall({ pos: this.#ballSpawn, vel: ZERO, angVel: ZERO });
    }
    this.#recorder.record(tick, {
      // (a Blender model's wheels as live: RV-581)
      cars: new Map([[this.#playerId, recordCar(car, this.#carView.posesWheels ? this.#world.carWheels(this.#playerId) : null)]]),
      ball: this.#world.ball(),
      ballExploded: this.#world.ballExploded(),
      lastTouchTeam: freeplayTouchTeam(this.#world, this.#team),
    });
    if (heldBefore && this.#world.kickoffCountdown() === 0 && !this.#training) this.#spawnIndex += 1;
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
        const vel = this.#recorder.before(this.#world.tick - 1)?.ball.vel;
        this.#goalSpeed = vel ? Math.hypot(vel.x, vel.y, vel.z) : null;
        this.#goalTime = this.#roundAge;
        this.#effects.goal(this.#world.ball().pos, this.#team); // (the player's colour at either net: the garage's team)
        this.#arena.explode();
        this.#camera.shakes.play(EXPLOSION_LARGE, this.#world.ball().pos);
        // (training: the striker's goal a success, a goal against the goalie a failure)
        if (this.#training) this.#trainingEnded(this.#training.pack.type === "goalie" ? "failure" : "success");
      }
    }
  }

  /** A new round (a goal's end, or the player's reset: StartNewRound → ResetPlayers, ResetBalls, ResetPickups): the
   *  car on the session's next kickoff spot, held through freeplay's 0.01 s countdown, a new ball fading in */
  #resetKickoff(): void {
    this.#startRound();
    this.#roundAge = 0;
    this.#postGoal.stop(); // (a reset ends the goal's wait)
    this.#ballView.spawn(); // (a new ball: solid at once, its trail begun again)
    this.#arena.newBall();
    this.#snapViews();
  }

  /** The new round in the world (notes/camera-respawn-goal.md "Freeplay after a goal"): the car at S[k mod 10], the
   *  ball at its spawn to fall, the pads back now and again 0.1 s later, the countdown */
  #startRound(): void {
    if (this.#editing) {
      this.#placeWorld(this.#editing, this.#editAsPlaced);
      return;
    }
    if (this.#training) {
      this.#placeShot(this.#training);
      return;
    }
    this.#world.resetFreeplay(this.#sessionSeed, this.#spawnIndex);
    this.#world.setKickoffCountdown(FREEPLAY_COUNTDOWN_TICKS);
    this.#padResetTicks = FREEPLAY_PAD_RESET_TICKS;
    this.#ballHold = FREEPLAY_BALL_HOLD_TICKS;
    this.#ballSpawn = this.#world.ball().pos;
    this.#ballSpawnTick = this.#world.tick;
    this.#touches.clear();
    this.#replayPlan = null;
  }

  /** The garage shown, framed, or left (the menu's page; the user's request, 2026-10-18: the game's garage). Shown: the
   *  car standing still on the garage's spot, at rest, the camera on it from three-quarters front (its nose to the
   *  screen's left), the car centred in the space beside the menu's page (`frame`: that space's left edge and width, shares
   *  of the view's; framed again as the window changes); its changes swapped in place there (setCar). Left (null): the
   *  camera behind it again (Free Play starts its own session) */
  showGarage(frame: { readonly left: number; readonly width: number } | null): void {
    if (!frame) {
      if (this.#garageCamera === null) return;
      this.#garageCamera = null;
      this.#snapViews();
      return;
    }
    const { at, yaw, angle, height, lookAt, fov } = GARAGE;
    const forward = vec3(Math.cos(yaw), Math.sin(yaw), 0);
    if (this.#garageCamera === null) {
      const rot = { forward, right: vec3(-forward.y, forward.x, 0), up: vec3(0, 0, 1) };
      this.#world.setCar(this.#playerId, { pos: at, vel: ZERO, angVel: ZERO, rot, boost: this.#world.car(this.#playerId).boost });
      this.#snapViews();
    }
    // (far enough for the car to fit the space; aimed beside it so it stands at the space's middle: the view's centre
    // `aside` off is tan(half fov)·distance away at the view's edge)
    const distance = GARAGE.distance * Math.max(1, GARAGE.width / (GARAGE.fill * Math.max(0.05, frame.width)));
    const centre = frame.left + frame.width / 2;
    const aside = distance * Math.tan((fov * Math.PI) / 360) * (2 * centre - 1);
    // (off the car's front left, `angle` from straight on)
    const left = vec3(forward.y, -forward.x, 0);
    const toCamera = add(scale(forward, Math.cos(angle)), scale(left, Math.sin(angle)));
    const position = vec3(at.x + toCamera.x * distance, at.y + toCamera.y * distance, height * (distance / GARAGE.distance));
    const across = vec3(-toCamera.y, toCamera.x, 0);
    const axes = rotationAxes(vectorToRotator(sub(vec3(at.x + across.x * aside, at.y + across.y * aside, lookAt), position)));
    this.#garageCamera = { position, forward: axes.forward, up: axes.up, horizontalFov: fov };
  }

  /** The garage's car and colour (its choice changed, in the menu): swapped in place, as the game's garage swaps its
   *  model (the user's report, 2026-10-18): another body made where the car stands, at rest, its boost kept, the round
   *  and the kickoff spots' order untouched (Free Play starts its own session); a colour alone only repainted */
  setCar(garage: { readonly car: number; readonly team: Team }): void {
    const scene = this.#renderer.scene;
    scene.remove(this.#carView.root);
    this.#carView.dispose();
    if (garage.car !== this.#carId) {
      const was = this.#world.car(this.#playerId);
      this.#world.removeCar(this.#playerId);
      this.#playerId = this.#world.addCar(0, carChoice(garage.car).body);
      this.#world.setUnlimitedBoost(this.#unlimitedBoost);
      this.#world.setCar(this.#playerId, { pos: was.pos, vel: ZERO, angVel: ZERO, rot: was.rot, boost: was.boost });
      this.#carConfigs = new Map([[this.#playerId, this.#world.carConfig(this.#playerId)]]);
      this.#car = new Interpolated(this.#world.car(this.#playerId));
    }
    this.#carId = garage.car;
    this.#team = garage.team;
    this.#carView = new CarView(this.#world.carConfig(this.#playerId), garage.team, this.#effects.particles, garage.car);
    scene.add(this.#carView.root);
  }

  /** The session over again (Exit to Main Menu, then Free Play: MENU-1, RV-284): any goal replay and its banner gone, a
   *  new round from the kickoff, the goals back to 0-0 (a new free play: RV-287) */
  restart(): void {
    this.#stopTraining();
    this.#replay?.dispose();
    this.#replay = null;
    this.#score[0] = 0;
    this.#score[1] = 0;
    this.#hud.say("");
    this.#resetKickoff();
    this.#updateHud(this.#car.current, 0, null);
  }

  /** Custom training: this pack from this shot (the first by default; its kept progress, short of Completed started
   *  over), until free play again (`restart`); `test`: the editor's test of it (no variance, the car as placed, nothing
   *  kept) */
  startTraining(pack: TrainingPack, shot = 0, test: TestKind | null = null): void {
    this.#editing = null;
    this.#editorPoints = null;
    this.editorCamera = null;
    this.#replay?.dispose();
    this.#replay = null;
    this.#hud.say("");
    this.#training = new TrainingRun(pack, test ? [] : storedProgress(pack.id), test);
    if (shot > 0) this.#training.select(shot);
    this.#disabledGoal.show(pack.type === "goalie" ? 1 : -1);
    this.#resetKickoff();
  }

  /** The shot again (Reset during or after it), its variance kept */
  retryShot(): void {
    const run = this.#training;
    if (!run) return;
    run.retry();
    this.#replay?.dispose();
    this.#replay = null;
    this.#resetKickoff();
  }

  /** Whether Select Shot was asked for (its binding pressed) since the last call */
  takeSelectRequest(): boolean {
    const asked = this.#selectRequested;
    this.#selectRequested = false;
    return asked;
  }

  /** The shot at this place in the pack, at once (Select Shot) */
  selectShot(index: number): void {
    const run = this.#training;
    if (!run || run.state === "finished") return;
    run.select(index);
    this.#replay?.dispose();
    this.#replay = null;
    this.#resetKickoff();
  }

  /** The pack from its first shot again (Restart Training), its progress cleared too (Reset Progress) */
  restartTraining(clearProgress: boolean): void {
    const run = this.#training;
    if (!run) return;
    run.restart(clearProgress);
    if (!run.test) storeProgress(run.pack.id, run.status);
    this.#replay?.dispose();
    this.#replay = null;
    this.#resetKickoff();
  }

  /** The training's run (its HUD's: the shot, the timer, the progress); null in free play */
  get training(): TrainingRun | null {
    return this.#training;
  }

  /** The training editor: this shot shown as placed (the car on its spawn, the ball at its start, its whole path), the
   *  car held and not driven; null: the editor closed, free play again. `asPlaced`: the car where it is, in the air too
   *  (the free-camera editor's; else on the ground with the setting). The path predicted at once the first time, then at
   *  most every EDITOR_PATH_EVERY while the shot keeps changing */
  showEditing(shot: Shot | null, asPlaced = false): void {
    if (!shot) {
      if (!this.#editing) return;
      this.#editing = null;
      this.#editorPoints = null;
      this.editorCamera = null;
      // (free play's goals, as set, and boost again)
      this.#setGoalScoring(this.settings().gameplay.freePlayGoals);
      this.#world.setUnlimitedBoost(this.#unlimitedBoost);
      this.restart();
      return;
    }
    this.#stopTraining();
    this.#replay?.dispose();
    this.#replay = null;
    this.#postGoal.stop();
    const first = this.#editing === null;
    this.#editing = shot;
    this.#editAsPlaced = asPlaced;
    this.#setGoalScoring(false);
    this.#world.setKickoffCountdown(TRAINING_HOLD);
    this.#placeWorld(shot, asPlaced);
    if (first || this.#sincePath >= EDITOR_PATH_EVERY) this.#predictEditorPath(shot);
    else this.#pathDue = true;
    if (first) this.#ballView.spawn();
    this.#snapViews();
  }

  #predictEditorPath(shot: Shot): void {
    this.#editorPoints = this.#predictPath(shot, EDITOR_PATH.seconds, EDITOR_PATH.points);
    this.#sincePath = 0;
    this.#pathDue = false;
  }

  /** Training over: free play's goals and boost again */
  #stopTraining(): void {
    if (!this.#training) return;
    this.#training = null;
    this.#pathPoints = null;
    this.#disabledGoal.show(null);
    this.#setGoalScoring(this.settings().gameplay.freePlayGoals);
    this.#world.setUnlimitedBoost(this.#unlimitedBoost);
  }

  /** The shot's start (StartNewRound, notes/custom-training.md §2.3): the car on its spawn (on the ground by default,
   *  its pitch 0), held and not driving through the countdown (the engine's kickoff hold: X and Y locked); the ball
   *  frozen at its start; the pads back; no goal until an entry would count; the path's preview. Finished: the ball
   *  gone, the car held */
  #placeShot(run: TrainingRun): void {
    this.#touches.clear();
    this.#replayPlan = null;
    this.#padResetTicks = 0;
    this.#setGoalScoring(false);
    this.#world.setKickoffCountdown(TRAINING_HOLD);
    if (run.state === "finished") {
      this.#ballHold = 0;
      this.#pathPoints = null;
      this.#world.hideBall();
      return;
    }
    const settings = this.settings().training;
    // (its variance as drawn for it, else drawn now: kept through a retry and the mirror; an editor's test none, the car as
    // placed: §1.4)
    const shot = (this.#shot = run.test
      ? run.shot
      : applyVariance(
          run.shot,
          run.variance(() => rollVariance(settings, Math.random)),
        ));
    this.#placeWorld(shot, run.test !== null);
    this.#pathPoints = this.#predictPath(shot, TRAINING_PATH_SECONDS, BALL_PATH.points);
  }

  /** A shot in the world, held: the car on its spawn (on the ground with the setting, unless `asPlaced`), the ball frozen
   *  at its start, the pads back */
  #placeWorld(shot: Shot, asPlaced = false): void {
    const settings = this.settings().training;
    this.#world.setUnlimitedBoost(settings.unlimitedBoost);
    this.#placeCar(shot, asPlaced);
    this.#world.resetBoostPads();
    this.#ballSpawn = shot.ball.location;
    this.#ballHold = TRAINING_HOLD;
    this.#world.setBall({ pos: shot.ball.location, vel: ZERO, angVel: ZERO });
    this.#ballSpawnTick = this.#world.tick;
    this.#touchTick = this.#world.carLastBallTouchTick(this.#playerId);
  }

  /** The car on the shot's spawn, still (on the ground with the setting, unless `asPlaced`) */
  #placeCar(shot: Shot, asPlaced: boolean): void {
    const settings = this.settings().training;
    const ground = settings.spawnOnGround && !asPlaced;
    const { location, rotation } = shot.car;
    this.#world.setCar(this.#playerId, {
      pos: ground ? vec3(location.x, location.y, CAR_REST_Z) : location,
      vel: ZERO,
      angVel: ZERO,
      rot: rotatorAxes(ground ? { ...rotation, pitch: 0 } : rotation),
      boost: settings.unlimitedBoost ? 100 : startingBoost(settings),
    });
  }

  /** The launch's path over `seconds` (the engine's own prediction in its own arena: training's first tenth of its 8 s,
   *  the editor's longer), `count` points along it; none for a ball that floats until touched */
  #predictPath(shot: Shot, seconds: number, count: number): { readonly pos: Vec3; readonly speed: number }[] | null {
    if (shot.ball.speed <= 0) return null;
    const predictor = (this.#predictor ??= this.#world.sibling());
    predictor.setBall({ pos: shot.ball.location, vel: launchVelocity(shot), angVel: ZERO });
    const every = Math.max(1, Math.round(seconds / count / TICK_SECONDS));
    const points: { pos: Vec3; speed: number }[] = [];
    for (let k = 1; k <= count * every && !predictor.ballExploded(); k++) {
      predictor.step();
      if (k % every !== 0) continue;
      const ball = predictor.ball();
      points.push({ pos: ball.pos, speed: Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) });
    }
    // (its events and impacts never read: let go, not kept piling up, RX25)
    predictor.takeEvents();
    predictor.takeImpacts();
    return points;
  }

  /** A tick of the shot (after the physics step): the car's touch (in the countdown it starts the shot, the ball back
   *  to its start; later it lets a frozen ball go), input starting it, its timer, the goalie's save, the timer's run-out
   *  (the shot fails now if the ball is still frozen, else at its next ground contact: CTR-7) */
  #trainingTick(run: TrainingRun, wantsStart: boolean): void {
    const touchTick = this.#world.carLastBallTouchTick(this.#playerId);
    const touched = touchTick !== this.#touchTick;
    this.#touchTick = touchTick;
    if (touched && run.state === "countdown") this.#beginShot(run, true);
    else if (touched) {
      run.touch();
      this.#ballHold = 0;
    } else if (wantsStart && run.canStart(this.settings().training.inputDelay)) this.#beginShot(run, false);
    run.tick(TICK_SECONDS);
    if (run.state !== "active") return;
    const ball = this.#world.ball();
    if (run.saved(ball)) this.#destroyBall("success");
    else if (run.timedOut && (this.#ballHold > 0 || ball.pos.z <= BALL_GROUND_Z)) this.#destroyBall("failure");
  }

  /** The shot started (Active: §2.4): the car driving from the next tick, its start speed a velocity change along its
   *  facing; the ball launched at its speed, or left frozen (a speed of 0, or touched in the countdown: Fire resets an
   *  awake ball) until touched */
  #beginShot(run: TrainingRun, byTouch: boolean): void {
    run.begin();
    this.#world.setKickoffCountdown(0);
    const shot = this.#shot ?? run.shot;
    if (shot.car.startSpeed > 0) {
      const car = this.#world.car(this.#playerId);
      this.#world.setCar(this.#playerId, { ...car, vel: add(car.vel, scale(car.rot.forward, shot.car.startSpeed)) });
    }
    if (shot.ball.speed > 0 && !byTouch) {
      this.#ballHold = 0;
      this.#world.setBall({ pos: shot.ball.location, vel: launchVelocity(shot), angVel: ZERO });
    }
    this.#pathPoints = null;
  }

  /** The ball destroyed (DestroyBall: the goalie's save, the timer's run-out): its burst, the shot's end */
  #destroyBall(result: ShotResult): void {
    const pos = this.#world.ball().pos;
    this.#world.hideBall();
    // (the game's red "no goal" burst: the orange team's explosion stands in)
    this.#effects.goal(pos, 1);
    this.#postGoal.start();
    this.#replayPlan = planReplay(this.#touches.touches, this.#world.tick, 0, this.#ballSpawnTick, false);
    this.#goalSpeed = null;
    this.#goalTime = this.#roundAge;
    this.#trainingEnded(result);
  }

  /** The shot's end (its goal's or its destruction's): the run told, its progress kept, goals off */
  #trainingEnded(result: ShotResult): void {
    const run = this.#training;
    if (!run) return;
    run.end(result);
    if (!run.test) storeProgress(run.pack.id, run.status);
    this.#setGoalScoring(false);
  }

  /** Goals score only for the ticks an entry would count (before each step): into the target goal (the ball in its
   *  half), the striker's once touched, any into the goalie's own (CTR-8, CTR-9); free play's as its setting (the editor's
   *  never) */
  #updateGoalScoring(): void {
    const run = this.#training;
    if (!run) {
      if (!this.#editing) this.#setGoalScoring(this.settings().gameplay.freePlayGoals);
      return;
    }
    const goal = run.state === "active" ? run.scoringGoal() : null;
    this.#setGoalScoring(goal !== null && this.#world.ball().pos.y * goal > 0);
  }

  #setGoalScoring(on: boolean): void {
    if (on === this.#goalScoring) return;
    this.#goalScoring = on;
    this.#world.setGoalScoring(on);
  }

  /** Training's commands (any state, §2.7-2.8): reset retries the shot (re-rolls in the countdown; the pack again once
   *  finished), next and previous move on at once, shuffle reorders the playlist (the shot kept), mirror flips the shot;
   *  an editor's test the reset alone, never asked first (§1.4); whether one acted */
  #trainingCommands(held: HeldActions): boolean {
    const run = this.#training;
    if (!run) return false;
    // (each command once a press, N in a frame N times: the toggles flip each, the shots step each; RV-1146)
    const count = (key: CommandAction): number => presses(held[key], this.#held[key]);
    if (run.test) {
      if (count("reset") === 0) return false;
      run.retry();
      this.#replay?.dispose();
      this.#replay = null;
      this.#fade.update(Infinity);
      this.#resetKickoff();
      return true;
    }
    for (let i = count("trainingShuffle"); i > 0; i--) run.toggleShuffle();
    if (count("trainingSelect") > 0) this.#selectRequested = true;
    let restart = true;
    const [reset, next, previous, mirror] = [count("reset"), count("trainingNext"), count("trainingPrevious"), count("trainingMirror")];
    if (reset > 0 && (run.state === "active" || run.state === "ended") && this.onResetWarning && !resetWarned()) {
      // (the first time ever: asked first, the shot retried on Yes)
      this.onResetWarning(() => {
        storeResetWarned();
        this.retryShot();
      });
      return false;
    } else if (reset > 0) {
      if (run.state === "finished") run.restart();
      else run.retry();
    } else if (next > 0 || previous > 0) {
      for (let i = next; i > 0; i--) run.navigate(1);
      for (let i = previous; i > 0; i--) run.navigate(-1);
    } else if (mirror > 0) {
      for (let i = mirror; i > 0; i--) run.toggleMirror();
    } else restart = false;
    if (!restart) return false;
    this.#replay?.dispose();
    this.#replay = null;
    this.#fade.update(Infinity); // (a replay's fade cut off: the new shot at once)
    this.#resetKickoff();
    return true;
  }

  /** For screenshots and browser tests: the car on the floor at (x, y) facing `yaw` (rad, the game's), at rest, and
   *  the ball at `ball` if given. */
  debugPlace(car: { readonly x: number; readonly y: number; readonly yaw: number; readonly boost?: number }, ball?: Vec3, ballVelocity: Vec3 = ZERO): void {
    const forward = vec3(Math.cos(car.yaw), Math.sin(car.yaw), 0);
    const rot = { forward, right: vec3(-forward.y, forward.x, 0), up: vec3(0, 0, 1) };
    // (100 with Unlimited boost, at which a car takes no pads (CanPickup: !IsFull); else a round's 33; or as given)
    this.#world.setCar(this.#playerId, {
      pos: vec3(car.x, car.y, 17.01),
      vel: ZERO,
      angVel: ZERO,
      rot,
      boost: car.boost ?? (this.#unlimitedBoost ? 100 : BOOST_SPAWN_AMOUNT),
    });
    if (ball) {
      this.#ballHold = 0;
      this.#world.setBall({ pos: ball, vel: ballVelocity, angVel: ZERO });
    }
    this.#snapViews();
  }

  /** For the browser tests: where the car is and how fast it goes */
  /** For screenshots and browser tests: this car demolished (the respawn view's, HUD-20) */
  debugDemolish(): void {
    this.#world.demolishCar(this.#playerId);
  }

  /** For the browser tests: the ball's position and velocity now */
  debugBall(): { readonly pos: Vec3; readonly vel: Vec3 } {
    const ball = this.#world.ball();
    return { pos: ball.pos, vel: ball.vel };
  }

  debugCar(): { readonly pos: Vec3; readonly speed: number; readonly hitbox: Vec3; readonly onGround: boolean } {
    const car = this.#world.car(this.#playerId);
    const speed = Math.hypot(car.vel.x, car.vel.y, car.vel.z);
    return { pos: car.pos, speed, hitbox: this.#world.carConfig(this.#playerId).hitboxSize, onGround: car.onGround };
  }

  /** For screenshots: a demolition's effect at `at` (game frame) */
  debugDemolition(at: Vec3): void {
    this.#effects.demolition(at);
  }

  /** For the browser tests: the goal explosions so far in each team's colour (blue, orange) */
  debugGoalColours(): readonly [number, number] {
    return [...this.#effects.goals];
  }

  /** For the browser tests: whether the ball's goal-line effect (its darkening and shake in a goal) is on */
  debugGoalLineOn(): boolean {
    return this.#ballView.goalLineState.on;
  }

  /** For screenshots and tests: live particles */
  debugParticles(): number {
    return this.#effects.particles.count;
  }

  /** For the browser tests: the pads (taken or not) and the car's boost */
  debugPads(): {
    readonly pads: readonly { readonly x: number; readonly y: number; readonly big: boolean; readonly active: boolean }[];
    readonly boost: number;
  } {
    return {
      pads: this.#world.boostPads().map((p) => ({ x: p.pos.x, y: p.pos.y, big: p.big, active: p.active })),
      boost: this.#world.car(this.#playerId).boost,
    };
  }

  /** The Unlimited boost setting changed: on fills the tank (the engine's), off leaves it as a new round would */
  #applyBoostSetting(): void {
    if (this.#training) return; // (training's own Unlimited Boost)
    const unlimited = this.settings().options.unlimitedBoost;
    if (unlimited === this.#unlimitedBoost) return;
    this.#unlimitedBoost = unlimited;
    this.#world.setUnlimitedBoost(unlimited);
    if (!unlimited) {
      const car = this.#world.car(this.#playerId);
      this.#world.setCar(this.#playerId, { pos: car.pos, vel: car.vel, angVel: car.angVel, rot: car.rot, boost: BOOST_SPAWN_AMOUNT });
    }
  }

  /** The free-play commands' view of the player's car (its hitbox, the last tick's velocity), or none while it's
   *  demolished (FP3: each command needs a car) */
  #commandCar(): CommandCar | null {
    const car = this.#world.car(this.#playerId);
    if (car.demoed) return null;
    const config = this.#world.carConfig(this.#playerId);
    return { ...car, hitboxSize: config.hitboxSize, hitboxOffset: config.hitboxOffset, lastVel: this.#car.previous.vel };
  }

  /** Take Possession and Start Dribble: the ball teleported to its spot, moving with the car, half its spin, its
   *  rotation kept; refused where it can't go (a goal, through the static world), the ball unchanged (FP3; our own
   *  sounds for UI_Training_Teleport and its refusal) */
  #teleportBall(kind: "possession" | "dribble"): void {
    const car = this.#commandCar();
    if (!car) return;
    const ray = (from: Vec3, to: Vec3): number | null => this.#world.rayToStatic(from, to);
    const spot = teleportTarget(kind, car, ray);
    if (!teleportAllowed(spot, car, ray)) {
      this.#audio.menu("back");
      return;
    }
    this.#ballHold = 0;
    this.#world.setBall(teleportedBall(this.#world.ball(), car, spot));
    this.#pushBall();
    this.#audio.menu("confirm");
  }

  /** Launch Ball, Pass Ball and Defend Shot: the ball's velocity set, where it is, its spin kept (FP3) */
  #launchBall(kind: "pop" | "pass" | "defend"): void {
    const car = this.#commandCar();
    if (!car) return;
    const ball = this.#world.ball();
    const vel = kind === "pop" ? poppedUp(ball.vel) : kind === "pass" ? passVelocity(ball.pos, car) : defendVelocity(ball.pos, car.pos, Math.random);
    this.#ballHold = 0;
    this.#world.setBall({ ...ball, vel });
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
    this.#carView.teleport(); // (its sway and wheels a new car's: RV-597)
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
    const carDrawn = fromThreeVector(this.#car.position(alpha, this.#pos));
    // (a Blender model's wheels: the vehicle's suspension and steering)
    if (this.#carView.posesWheels) this.#carView.wheels = { ...this.#world.carWheels(this.#playerId), contact: car.wheelContact };
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
    // (the ball's trail in the last touch's team colour, its points quicker in the goal's slow motion: VT-10, VT-17)
    this.#ballView.trailTeam = freeplayTouchTeam(this.#world, this.#team);
    // (free play's goals off: the ball plain in a net, no goal line's darkening or shake; training's and the editor's kept)
    this.#ballView.goalLineEffect = this.#training !== null || this.#editing !== null || this.settings().gameplay.freePlayGoals;
    this.#ballView.fade(this.#world.ballExploded(), frameSeconds, realSeconds > 0 ? frameSeconds / realSeconds : 1); // (a goal explodes it until the reset: it dissolves)
    this.#effects.update(frameSeconds);
    const own = this.#car.current;
    this.#shakeTriggers.frame(this.#camera.shakes, own, new Map([[this.#playerId, own]]), this.#world.boostPads(), (c) => {
      this.#effects.demolition(c.pos);
    });
    // The impacts and landings: the local car's Impact_Medium restarts, the sounds
    const impacts = this.#world.takeImpacts();
    this.#recorder.ballImpacts(impacts); // (the goal replay's ball hits: the recording's frames are the world's ticks after each step, RX30C)
    const triggers = this.#impactTriggers.frame(frameSeconds, impacts, new Map([[this.#playerId, own]]), this.#carConfigs, this.#playerId);
    for (const t of triggers) if (t.kind === "shake") this.#camera.shakes.play(IMPACT_MEDIUM, null, t.scale, `impact:${String(t.car)}`);
    // The ball arrow (HUD-17): the setting on, the ball cam off, the car alive (free play's round always runs); none in
    // the garage
    const arrow = this.#garageCamera === null && ballArrowShown(this.settings().interface.ballArrow, this.#ballCam, !car.demoed, true);
    this.#ballArrow.update(arrow ? carDrawn : null, fromThreeVector(ball), frameSeconds, this.#world.ballExploded());
    this.#carView.attach(this.#flipFx.root);
    this.#flipFx.update(frameSeconds);
    this.#ballView.update(ball, this.#ball.rotation(alpha, this.#rot));
    this.#ballPath.update(this.#training?.state === "countdown" ? this.#pathPoints : null);
    this.#editorPath.update(this.#editing ? this.#editorPoints : null);
    this.#arena.update(ball, frameSeconds);
    const pads = this.#world.boostPads();
    this.#padsView.update(pads, frameSeconds);

    const controls = { ballCam: this.#ballCam, rear: this.#rear, lookUp: this.#look.up, lookRight: this.#look.right, freeLook: this.#freeLook };
    const view =
      this.#garageCamera ??
      (this.#editing && this.editorCamera
        ? this.editorCamera
        : this.#camera.update(frameSeconds, this.#car.blended(alpha), this.#ball.blended(alpha).pos, controls, null, realSeconds));
    if (this.#camera.takeBallCamExit()) this.#ballCam = false; // (free look left the toggled ball cam)
    // The sounds before the render: started as soon as the frame knows them, not after drawing it (its sounds kept for a
    // goal replay to hear again: RA1 §1)
    const played = this.#audio.frame({
      world: { cars: new Map([[this.#playerId, car]]), ball: this.#ball.current, pads },
      localCar: this.#playerId,
      throttle: this.#throttle,
      simulated,
      camera: view,
      triggered: triggerSounds(triggers),
    });
    this.#recorder.sounds(played);
    this.#renderer.render(view);
    this.#effects.camera = view.position; // (the husks collide near it)

    this.#updateHud(car, realSeconds);
  }

  /** The HUD; `replay`: the goal replay's banner (null: not in one) */
  #updateHud(car: CarState, realSeconds: number, replay: ReplayHud | null = null): void {
    if (realSeconds > 0) this.#fps += (1 / realSeconds - this.#fps) * 0.05;
    const settings = this.settings();
    const pad = this.#input.usingGamepad;
    const toggles = (pad ? settings.cameraPad : settings.cameraKbm).ballCamToggle;
    this.#hud.update({
      boost: car.boost,
      speed: Math.hypot(car.vel.x, car.vel.y, car.vel.z),
      supersonic: car.supersonic,
      score: this.#score,
      clock: null,
      ballCam: this.#ballCam,
      ballCamKey: toggles ? keyGlyph(pad ? settings.bindings.ballCam.gamepad : settings.bindings.ballCam.keyboard) : null,
      carView: replay === null,
      menuOpen: !this.inputEnabled(),
      message: null, // (no scored message in offline freeplay: RV-38)
      replay,
      // (training: no scoreboard, HUD-4)
      // (demolished: no car's HUD, the boost meter and the ball cam indicator gone: HUD-16's bShowCarHUD, RV-513)
      parts: { scoreboard: false, boost: !car.demoed && !this.#editing, ballCamIndicator: !car.demoed && !this.#editing },
      fps: this.#fps,
      net: null,
      flip: flipVisual(this.settings().gameplay.flipResetIndicator) ? this.#dodge : null,
      flipReset: this.#flipReset,
      respawn: respawnView(car, null, {
        left: keyGlyph(pad ? settings.bindings.steerLeft.gamepad : settings.bindings.steerLeft.keyboard),
        right: keyGlyph(pad ? settings.bindings.steerRight.gamepad : settings.bindings.steerRight.keyboard),
      }),
    });
    if (this.#flipReset && flipAudio(this.settings().gameplay.flipResetIndicator)) this.#audio.flipReset();
    if (this.#flipReset && flipVisual(this.settings().gameplay.flipResetIndicator)) this.#flipFx.trigger();
    this.#flipReset = false;
  }
}
