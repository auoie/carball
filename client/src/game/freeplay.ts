// Offline freeplay: one car, the ball, boost pads, goals. Runs the physics at a fixed 120 Hz and
// renders interpolated states.
import { Quaternion, Vector3 } from "three";
import { PlayerCamera } from "../camera/rlCamera";
import type { BodyState, CarState, World } from "../engine/world";
import type { Hud } from "../hud";
import { DEFAULT_BINDINGS } from "../input/bindings";
import type { InputDevices } from "../input/devices";
import { type HeldActions, readControls, readHeldActions } from "../input/mapping";
import { FixedStep, TICK_SECONDS } from "../loop/fixedStep";
import { type Rot3, ZERO, add, cross, dot, lerp, normalize, scale, sub, vec3 } from "../math/vec";
import { toThreeQuaternion, toThreeVector } from "../render/coords";
import { BALL_RADIUS, BallView, BoostPadsView, CarView } from "../render/entities";
import type { Renderer } from "../render/renderer";

const GOAL_RESET_SECONDS = 2;

/** Interpolates between the previous and current tick for rendering. */
class Interpolated<T extends BodyState> {
  previous: T;
  current: T;
  constructor(state: T) {
    this.previous = state;
    this.current = state;
  }
  push(state: T): void {
    this.previous = this.current;
    this.current = state;
  }
  position(alpha: number, out: Vector3): Vector3 {
    return toThreeVector(lerp(this.previous.pos, this.current.pos, alpha), out);
  }
  rotation(alpha: number, out: Quaternion): Quaternion {
    const a = toThreeQuaternion(this.previous.rot, tmpQuat);
    return toThreeQuaternion(this.current.rot, out).slerp(a, 1 - alpha);
  }
  /** The state with interpolated position, velocity and rotation (for the camera). */
  blended(alpha: number): T {
    return {
      ...this.current,
      pos: lerp(this.previous.pos, this.current.pos, alpha),
      vel: lerp(this.previous.vel, this.current.vel, alpha),
      rot: blendRotation(this.previous.rot, this.current.rot, alpha),
    };
  }
}
const tmpQuat = new Quaternion();

/** Interpolates two orientations by their axes, re-orthonormalized (right = up x forward in this frame). */
function blendRotation(a: Rot3, b: Rot3, t: number): Rot3 {
  const forward = normalize(lerp(a.forward, b.forward, t), b.forward);
  const upRaw = lerp(a.up, b.up, t);
  const up = normalize(sub(upRaw, scale(forward, dot(upRaw, forward))), b.up);
  return { forward, up, right: cross(up, forward) };
}

export class Freeplay {
  readonly #world: World;
  readonly #renderer: Renderer;
  readonly #input: InputDevices;
  readonly #hud: Hud;
  readonly #playerId: number;
  readonly #clock = new FixedStep();
  readonly #camera = new PlayerCamera();
  readonly #carView: CarView;
  readonly #ballView = new BallView();
  readonly #padsView: BoostPadsView;
  readonly #car: Interpolated<CarState>;
  readonly #ball: Interpolated<BodyState>;
  readonly #score: [number, number] = [0, 0];
  #held: HeldActions = { ballCam: false, reset: false, ballInFront: false, ballOnCar: false };
  #ballCam = false;
  #goalTimer = 0;
  #message: string | null = null;
  #kickoffSeed = 1;
  #fps = 60;
  readonly #pos = new Vector3();
  readonly #rot = new Quaternion();

  constructor(world: World, renderer: Renderer, input: InputDevices, hud: Hud) {
    this.#world = world;
    this.#renderer = renderer;
    this.#input = input;
    this.#hud = hud;
    this.#playerId = world.addCar(0);
    world.resetKickoff(this.#kickoffSeed);

    this.#carView = new CarView(world.carConfig(this.#playerId), 0);
    this.#padsView = new BoostPadsView(world.boostPads());
    renderer.scene.add(this.#carView.root, this.#ballView.root, this.#padsView.root);
    this.#car = new Interpolated(world.car(this.#playerId));
    this.#ball = new Interpolated(world.ball());
  }

  /** One animation frame. `frameSeconds`: real time since the previous frame. */
  frame(frameSeconds: number): void {
    const snapshot = this.#input.snapshot();
    this.#handleActions(readHeldActions(snapshot, DEFAULT_BINDINGS));
    const controls = readControls(snapshot, DEFAULT_BINDINGS);

    const ticks = this.#clock.advance(frameSeconds);
    for (let i = 0; i < ticks; i++) {
      this.#world.setControls(this.#playerId, controls);
      this.#world.step();
      this.#car.push(this.#world.car(this.#playerId));
      this.#ball.push(this.#world.ball());
      this.#handleEvents();
      this.#updateGoalTimer();
    }

    this.#draw(frameSeconds);
  }

  #handleActions(held: HeldActions): void {
    const pressed = (key: keyof HeldActions): boolean => held[key] && !this.#held[key];
    if (pressed("ballCam")) this.#ballCam = !this.#ballCam;
    if (pressed("reset")) this.#resetKickoff();
    if (pressed("ballInFront")) this.#placeBall(false);
    if (pressed("ballOnCar")) this.#placeBall(true);
    this.#held = held;
  }

  #handleEvents(): void {
    for (const event of this.#world.takeEvents()) {
      if (event.type === "goal" && this.#goalTimer <= 0) {
        this.#score[event.scoringTeam] += 1;
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
      this.#ball.push(this.#world.ball());
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

  /** Freeplay helpers: ball in front of the car, or dropped onto its roof. */
  #placeBall(onCar: boolean): void {
    const car = this.#world.car(this.#playerId);
    const flatForward = vec3(car.rot.forward.x, car.rot.forward.y, 0);
    const pos = onCar
      ? add(car.pos, vec3(0, 0, 200))
      : add(add(car.pos, scale(flatForward, 600)), vec3(0, 0, 300));
    this.#world.setBall({ pos, vel: onCar ? car.vel : ZERO, angVel: ZERO });
    this.#ball.push(this.#world.ball());
  }

  #snapViews(): void {
    this.#car.push(this.#world.car(this.#playerId));
    this.#car.push(this.#world.car(this.#playerId));
    this.#ball.push(this.#world.ball());
    this.#ball.push(this.#world.ball());
    this.#camera.reset();
  }

  #draw(frameSeconds: number): void {
    const alpha = this.#clock.alpha;
    const car = this.#car.current;
    this.#carView.update(this.#car.position(alpha, this.#pos), this.#car.rotation(alpha, this.#rot), car.boosting, car.demoed);
    this.#ballView.update(this.#ball.position(alpha, this.#pos), this.#ball.rotation(alpha, this.#rot));
    this.#padsView.update(this.#world.boostPads());

    const view = this.#camera.update(frameSeconds, this.#car.blended(alpha), this.#ball.blended(alpha).pos, this.#ballCam);
    this.#renderer.render(view);

    if (frameSeconds > 0) this.#fps += (1 / frameSeconds - this.#fps) * 0.05;
    this.#hud.update({
      boost: car.boost,
      speed: Math.hypot(car.vel.x, car.vel.y, car.vel.z),
      supersonic: car.supersonic,
      score: this.#score,
      ballCam: this.#ballCam,
      message: this.#message,
      fps: this.#fps,
    });
  }
}
