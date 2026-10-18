// The goal replay's playback (ReplayDirector_TA, CameraState_LiveReplay_TA): the recorded frames from its start, at
// its speed (slowed round the scoring hit), seen from the replay camera, the goal's effects again at the goal's tick.
// Online plays the server's plan over its own recording (frames mapped from server ticks), freeplay its own.
import { Quaternion, Vector3 } from "three";
import type { GameAudio } from "../audio/audio";
import { ReplayCamera } from "../camera/replayCamera";
import type { BodyState } from "../engine/world";
import { TICK_RATE } from "../loop/fixedStep";
import { type Vec3, add, scale, sub } from "../math/vec";
import type { ReplayPlan } from "../net/protocol";
import type { ArenaView } from "../render/arena";
import type { SceneEffects } from "../render/effects";
import { type BallView, type CarView, trailGround } from "../render/entities";
import { FlipResetFx } from "../render/flipResetFx";
import type { Renderer } from "../render/renderer";
import { replayDilation } from "./goalSequence";
import { Interpolated } from "./interpolated";
import type { RecordedCar, RecordedFrame, ReplayRecorder } from "./replayRecorder";

/** Camera_TA.ClipToField: the camera stays this far above the floor */
const GROUND_CLAMP_Z = 10;

/** The goal explosion's team for a goal in a net of `netTeamNum` (Ball_TA.SetExplosionFXActor: TeamIndex =
 *  (ExplosionGoal.TeamNum == 0) ? 1 : 0) */
export function explosionTeam(netTeamNum: number): number {
  return netTeamNum === 0 ? 1 : 0;
}

/** What the replay draws with */
export interface ReplayScene {
  readonly renderer: Renderer;
  readonly arena: ArenaView;
  readonly effects: SceneEffects;
  readonly audio: GameAudio;
  readonly ballView: BallView;
  /** Every car's view, by id (one without a recording is hidden) */
  readonly cars: Iterable<readonly [number, CarView]>;
  /** The Flip Reset Indicator setting's parts: replays show every car's flip resets (HUD-19: PlayFlipResetFx plays for
   *  replays), as the live game the player's own */
  readonly flipReset: { readonly visual: boolean; readonly audio: boolean };
}

/** The cars between two recorded frames, as the replay draws them (game coordinates), not the demolished: their
 *  nameplates track them (HT-8, RV-279) */
export function replayCarPositions(a: RecordedFrame, b: RecordedFrame, alpha: number): Map<number, { readonly pos: Vec3; readonly team: number }> {
  const out = new Map<number, { readonly pos: Vec3; readonly team: number }>();
  for (const [id, from] of a.cars) {
    const to = b.cars.get(id) ?? from;
    if (!to.demoed) out.set(id, { pos: add(from.pos, scale(sub(to.pos, from.pos), alpha)), team: to.team });
  }
  return out;
}

/** The cars whose flip-reset count went up in `frame` since the counts last seen (`last`, brought up to date): a car
 *  first seen only starts its count; the demolished aside (HUD-19: the replay plays PlayFlipResetFx for any car) */
export function flipResetCars(last: Map<number, number>, frame: RecordedFrame): Set<number> {
  const out = new Set<number>();
  for (const [id, car] of frame.cars) {
    const before = last.get(id);
    last.set(id, car.flipResets);
    if (before !== undefined && car.flipResets > before && !car.demoed) out.add(id);
  }
  return out;
}

export class ReplayPlayback {
  readonly plan: ReplayPlan;
  /** Where it is (the plan's ticks, fractional) */
  tick: number;
  readonly #recorder: ReplayRecorder;
  readonly #frameAt: (tick: number) => number;
  readonly #camera: ReplayCamera;
  /** The explosion's colour: Ball_TA.SetExplosionFXActor, the team other than the net's TeamNum */
  readonly #explosionTeam: number;
  #goalShown = false;
  /** Each car's flip-reset count as last drawn, and its effect (made at its first reset in the replay) */
  readonly #flipCounts = new Map<number, number>();
  readonly #flipFx = new Map<number, FlipResetFx>();
  readonly #pos = new Vector3();
  readonly #rot = new Quaternion();

  /** `frameAt`: the recorded frame of a plan tick (online: the client frame consumed at that server tick);
   *  `netTeamNum`: the TeamNum of the net scored into (a match's: its team's; freeplay's: 1 for both) */
  constructor(
    plan: ReplayPlan,
    recorder: ReplayRecorder,
    frameAt: (tick: number) => number = (tick) => tick,
    netTeamNum = plan.scoringTeam === 0 ? 1 : 0,
  ) {
    this.plan = plan;
    this.tick = plan.startTick;
    this.#recorder = recorder;
    this.#frameAt = frameAt;
    this.#camera = new ReplayCamera(plan.scoringTeam, netTeamNum);
    this.#explosionTeam = explosionTeam(netTeamNum);
  }

  /** Played to its end (the goal + PostGoalTime) */
  get done(): boolean {
    return this.tick >= this.plan.endTick;
  }

  /** Over (ended, skipped or left): the flip resets' effects off the cars */
  dispose(): void {
    for (const fx of this.#flipFx.values()) fx.dispose();
    this.#flipFx.clear();
  }

  /** One frame: on by `realSeconds` at the replay's speed, drawn */
  frame(realSeconds: number, scene: ReplayScene): void {
    const { plan } = this;
    const dilation = replayDilation(plan, this.tick);
    this.tick = Math.min(plan.endTick, this.tick + realSeconds * TICK_RATE * dilation);
    if (!this.#goalShown && this.tick >= plan.goalTick) {
      this.#goalShown = true; // (TriggerGoalScoreEvent: the goal's effects again)
      scene.audio.goal();
      const at = this.#recorder.before(Math.floor(this.#frameAt(plan.goalTick)));
      if (at) scene.effects.goal(at.ball.pos, this.#explosionTeam);
      scene.arena.explode();
    }
    const at = this.#frameAt(this.tick);
    const base = Math.floor(at);
    const alpha = at - base;
    // (a replay beginning before this page's recording did, its page still loading as the match went on: the cars held
    // as first recorded till then, not an empty field; ours, the game records on its server)
    const a = this.#recorder.before(base) ?? this.#recorder.after(base, Math.ceil(this.#frameAt(plan.endTick) - base) + 1);
    const b = this.#recorder.at(base + 1) ?? a;
    if (a && b) this.#drawRecorded(scene, a, b, alpha, realSeconds * dilation, dilation);
    // The camera's focus: the next car to touch the ball, with the ball; after the scoring touch the ball alone; once
    // it has exploded, the field's centre
    const next = plan.focus.find((f) => this.tick < f.tick);
    const pose = (from: RecordedCar | BodyState | undefined, to: RecordedCar | BodyState | undefined): { pos: Vec3; vel: Vec3 } | null =>
      from && to ? { pos: add(from.pos, scale(sub(to.pos, from.pos), alpha)), vel: to.vel } : null;
    const car = next ? pose(a?.cars.get(next.car), b?.cars.get(next.car)) : null;
    const ball = a && b && !b.ballExploded ? pose(a.ball, b.ball) : null;
    const view = this.#camera.update(realSeconds, { car, ball, carId: car ? (next?.car ?? null) : null }, dilation);
    const clipped = { ...view, position: { ...view.position, z: Math.max(view.position.z, GROUND_CLAMP_Z) } };
    scene.renderer.render(clipped);
    // (the cars' engines and boosts as replayed, heard from the replay's camera: not the live state the replay began in)
    if (b) scene.audio.replayFrame(b.cars, clipped);
  }

  /** The cars as this frame draws them (replayCarPositions): their nameplates (HT-8, RV-279) */
  cars: ReadonlyMap<number, { readonly pos: Vec3; readonly team: number }> = new Map();

  /** The cars and the ball between two recorded frames */
  #drawRecorded(scene: ReplayScene, a: RecordedFrame, b: RecordedFrame, alpha: number, seconds: number, dilation: number): void {
    this.cars = replayCarPositions(a, b, alpha);
    const resets = flipResetCars(this.#flipCounts, b);
    for (const [id, view] of scene.cars) {
      const from = a.cars.get(id);
      const to = b.cars.get(id) ?? from;
      if (!from || !to) {
        view.root.visible = false;
        continue;
      }
      const between = new Interpolated<RecordedCar>(from);
      between.push(to);
      // (a Blender model's wheels: as recorded with the vehicle's, else at rest by the recorded contact: RV-581)
      if (view.posesWheels) {
        if (to.wheels) view.wheels = { ...to.wheels, contact: to.wheelContact };
        else view.replayWheels(to.wheelContact);
      }
      view.update(between.position(alpha, this.#pos), between.rotation(alpha, this.#rot), to.boosting, to.demoed, to.supersonic, seconds, trailGround(to));
      // (a flip reset in the replayed window: its effect on that car, as live, and its sound, by the setting: HUD-19)
      if (resets.has(id)) {
        if (scene.flipReset.audio) scene.audio.flipReset();
        if (scene.flipReset.visual) {
          let fx = this.#flipFx.get(id);
          if (!fx) {
            fx = new FlipResetFx();
            this.#flipFx.set(id, fx);
          }
          view.attach(fx.root);
          fx.trigger();
        }
      }
    }
    // (at the replay's speed, as the cars)
    for (const fx of this.#flipFx.values()) fx.update(seconds);
    const ball = new Interpolated<BodyState>(a.ball);
    ball.push(b.ball);
    const position = ball.position(alpha, this.#pos);
    scene.ballView.trailTeam = b.lastTouchTeam;
    scene.ballView.fade(b.ballExploded, seconds, dilation); // (no fade in: the replay's ball is shown as recorded)
    scene.ballView.update(position, ball.rotation(alpha, this.#rot));
    scene.arena.update(position, seconds);
    scene.effects.update(seconds);
  }
}
