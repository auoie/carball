// The player's camera, a frame at a time (notes/camera.md; the 2026-11-11 audit's design, in place of the paced grid).
// The game runs its camera's update once a frame with the frame's time, so its smoothing's lag behind a turning car is
// one thing at 60 frames a second and another at 144: its feel at a rate. Uneven frames (dropped ones, a busy browser's,
// a timer's jitter) change the lag frame by frame: the car wobbles on screen. Ours gives the game's feel at the player's
// own rate whatever the frames, two ways together:
// - whole updates across the frame: an update for each nominal frame (1 / the feel's rate) the frame spans, to the
//   nearest whole number, each on the car and ball as they were drawn at its moment: between the two physics ticks about
//   it, as a frame there would have drawn them (the ticks told as they run; their flags too, the car on the ground or
//   off it: on a straight line from the last frame's car to this one's, a take-off reached the camera up to a nominal
//   frame early, 2.7° of view in a jump with most frames doubled);
// - each update told what share of a nominal frame it spans, so its smoothers land where the game's updates at the
//   nominal length would (`drift` in carballCamera.ts: nothing at a share of 1).
// At even frames at the feel's rate it is the game's camera, update for update. Nothing here needs the screen's true
// refresh or its phase (a page can see neither: only when its own frames ran), and the car is drawn at the frame's
// moment, like everything else.
import { blendStates } from "../game/interpolated";
import type { CarState } from "../engine/world";
import { type Vec3, lerp } from "../math/vec";
import { type CameraControls, type CameraView, PlayerCamera, type RespawnState } from "./carballCamera";

/** What the camera follows, as drawn this frame: the car (online, its correction's offset on it), the ball, the respawn */
export interface Followed {
  readonly car: CarState;
  readonly ball: Vec3;
  readonly respawn: RespawnState | null;
}

/** A frame's times (s): the world's (slowed after a goal), the real one, and the world time the scene moved (the world's
 *  less what the physics clock dropped: FixedStep.dropped) */
export interface FrameSpan {
  readonly world: number;
  readonly real: number;
  readonly scene: number;
}

/** The most updates a frame runs (the physics clock runs 5 ticks at most a frame, 1/24 s: ten nominal frames at 240 Hz) */
const MAX_UPDATES = 8;
/** The ticks kept (a frame's are five at most) */
const KEPT_TICKS = 16;
/** A car further from the last frame's than this at its fastest (uu/s, and uu to spare) was put there, not driven: not
 *  blended across (a spawn's count says so too) */
const PLACED = { speed: 8000, slack: 100 } as const;

export class FrameCamera {
  /** The last frame's: what was followed, and where the scene was drawn (in ticks: the last tick but one's number and
   *  the frame's alpha). Null: none to step from (the first frame, after a reset, a frame another camera drew) */
  #last: { readonly followed: Followed; readonly at: number } | null = null;
  /** The ticks told of late, and how many in all */
  readonly #ticks: { readonly index: number; readonly followed: Followed }[] = [];
  #index = 0;

  constructor(readonly camera: PlayerCamera = new PlayerCamera()) {}

  /** A physics tick's car (as drawn: online, its correction's offset on it), ball and respawn */
  tick(followed: Followed): void {
    this.#index++;
    this.#ticks.push({ index: this.#index, followed });
    if (this.#ticks.length > KEPT_TICKS) this.#ticks.shift();
  }

  /** This frame's view. `feelHz`: the rate whose feel the camera has (the player's own: the page's frames' rate of late,
   *  a touch device's Frame Rate), `now`: what it follows as drawn this frame, `alpha`: where between the last two ticks
   *  that is */
  frame(span: FrameSpan, feelHz: number, now: Followed, controls: CameraControls, alpha = 1): CameraView {
    const at = this.#index - 1 + alpha;
    // (a car put where it is since the last frame, a spawn, a demolition, a teleport: stepped to all the same where the
    // ticks tell when, each update the scene as drawn at its moment and the car put there at its tick's, as a frame
    // there would have seen it (one update on the wreck for the whole frame was 2 degrees off for that frame, RV-1306).
    // With no ticks to tell when: this frame's update alone, nothing blended across)
    const jumped = this.#last !== null && placed(this.#last.followed.car, now.car, span.scene);
    const last = this.#last && (!jumped || this.#told(this.#last.at, at)) ? this.#last : null;
    this.#last = { followed: now, at };
    // (the nominal frames the scene's move spans: its world time undilated, at the feel's rate)
    const frames = span.world > 0 ? ((span.scene * span.real) / span.world) * feelHz : 0;
    if (!last || !(frames > 0)) return this.camera.update(span.scene, now.car, now.ball, controls, now.respawn, span.real);
    const updates = Math.min(MAX_UPDATES, Math.max(1, Math.round(frames)));
    let view: CameraView | null = null;
    for (let i = 1; i <= updates; i++) {
      const then = i === updates ? now : this.#drawnAt(last.at + ((at - last.at) * i) / updates, last.followed, now, i / updates);
      view = this.camera.update(span.scene / updates, then.car, then.ball, shared(controls, updates, i), then.respawn, span.real / updates, frames / updates);
    }
    return view ?? this.camera.update(span.scene, now.car, now.ball, controls, now.respawn, span.real);
  }

  /** What was followed as the scene would have been drawn at `at` (in ticks): between the two ticks about it, the later
   *  one's flags (as a frame's drawing is: game/interpolated.ts); a car put there by the later tick not blended to. No
   *  ticks kept there (none told): on the line from the last frame's to this one's, `share` of the way */
  #drawnAt(at: number, last: Followed, now: Followed, share: number): Followed {
    const base = Math.floor(at);
    const a = this.#ticks.find((t) => t.index === base)?.followed;
    const b = this.#ticks.find((t) => t.index === base + 1)?.followed;
    if (a && b) {
      if (placed(a.car, b.car, 0)) return b;
      return { car: blendStates(a.car, b.car, at - base), ball: lerp(a.ball, b.ball, at - base), respawn: b.respawn };
    }
    return { car: blendStates(last.car, now.car, share), ball: lerp(last.ball, now.ball, share), respawn: now.respawn };
  }

  /** Whether every tick about the scene's moments from `from` to `to` (in ticks) was told and is kept */
  #told(from: number, to: number): boolean {
    for (let k = Math.floor(from); k <= Math.ceil(to); k++) if (!this.#ticks.some((t) => t.index === k)) return false;
    return true;
  }

  /** A frame another camera draws (the garage's, the editor's, a replay's): the next of this one's starts from its own
   *  car, nothing stepped across the time away */
  idle(): void {
    this.#last = null;
  }

  /** Starts over (a new car behind which it starts again): its ticks forgotten */
  reset(): void {
    this.camera.reset();
    this.#last = null;
    this.#ticks.length = 0;
  }
}

/** Whether the car was put where it is since the last frame (a spawn, a reset, a teleport), not driven there */
function placed(last: CarState, now: CarState, sceneSeconds: number): boolean {
  if (last.spawnCount !== now.spawnCount || last.demoed !== now.demoed) return true;
  const moved = Math.hypot(now.pos.x - last.pos.x, now.pos.y - last.pos.y, now.pos.z - last.pos.z);
  return moved > PLACED.speed * sceneSeconds + PLACED.slack;
}

/** The frame's controls for the `index`th of its `updates`. The free look turns the view by whole rotator units, each
 *  update's offset truncated: the updates after the first carry in what the one before left over, so the frame's turn
 *  is truncated once, as the game's frame's is (two updates each lost up to a unit: a tenth of a slow mouse turn on a
 *  variable-refresh screen, RV-1304). The mouse's free look is its counts (camera/freeLook.ts), not a rate, so each
 *  update takes its share of them */
function shared(controls: CameraControls, updates: number, index: number): CameraControls {
  const look = controls.freeLook;
  if (updates === 1 || !look) return controls;
  const mouse = look.axes.source === "mouse";
  const axes = {
    ...look.axes,
    pitch: mouse ? look.axes.pitch / updates : look.axes.pitch,
    yaw: mouse ? look.axes.yaw / updates : look.axes.yaw,
    continued: index > 1,
  };
  return { ...controls, freeLook: { ...look, axes } };
}
