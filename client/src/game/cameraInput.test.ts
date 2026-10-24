// The camera switches and the input packets' clock (review findings RV-4, RV-9, RV-10).
import { describe, expect, it } from "vitest";
import { frameTimes, worldSeconds } from "../loop/fixedStep";
import type { CameraButton } from "../input/mapping";
import { SendClock, newCar, updateSwitches } from "./cameraInput";
import { postGoalDilation } from "./goalSequence";

/** A key's: `presses` this frame, held after them */
const key = (presses: number, down: boolean): CameraButton => ({ keyPresses: presses, keyDown: down, padDown: false });
const UP = { ballCam: key(0, false), rearCamera: key(0, false) };
/** Pressed this frame, held */
const BALL = { ...UP, ballCam: key(1, true) };
const REAR = { ...UP, rearCamera: key(1, true) };
/** Held from before, no new press */
const BALL_HELD = { ...UP, ballCam: key(0, true) };
const REAR_HELD = { ...UP, rearCamera: key(0, true) };
const OPTIONS = { ballCamToggle: true, rearCameraToggle: false, blocked: false };

describe("camera switches", () => {
  it("RV-9: in the goal replay and after the match the ball cam ignores its button", () => {
    const off = { ballCam: false, rear: false };
    expect(updateSwitches(off, BALL, UP, OPTIONS).ballCam).toBe(true);
    expect(updateSwitches(off, BALL, UP, { ...OPTIONS, blocked: true }).ballCam).toBe(false);
    expect(updateSwitches(off, BALL, UP, { ...OPTIONS, ballCamToggle: false, blocked: true }).ballCam).toBe(false);
  });

  it("RV-20: held, a press while blocked doesn't count even held on after; a release while blocked does", () => {
    const hold = { ...OPTIONS, ballCamToggle: false };
    const off = { ballCam: false, rear: false };
    const pressedBlocked = updateSwitches(off, BALL, UP, { ...hold, blocked: true });
    expect(updateSwitches(pressedBlocked, BALL_HELD, BALL, hold).ballCam).toBe(false);
    const on = updateSwitches(off, BALL, UP, hold);
    expect(on.ballCam).toBe(true);
    expect(updateSwitches(on, BALL_HELD, BALL, hold).ballCam, "held on").toBe(true);
    expect(updateSwitches(on, UP, BALL_HELD, { ...hold, blocked: true }).ballCam).toBe(false);
  });

  it("RV-10: a new car turns the rear camera off; held, it stays off until the button is pressed again", () => {
    const toggled = updateSwitches({ ballCam: false, rear: false }, REAR, UP, { ...OPTIONS, rearCameraToggle: true });
    expect(toggled.rear).toBe(true);
    expect(newCar(toggled).rear).toBe(false);
    const holding = updateSwitches({ ballCam: false, rear: false }, REAR, UP, OPTIONS);
    expect(holding.rear).toBe(true);
    const after = newCar(holding);
    expect(updateSwitches(after, REAR_HELD, REAR, OPTIONS).rear).toBe(false); // (still held: no new press)
    expect(updateSwitches(updateSwitches(after, UP, REAR_HELD, OPTIONS), REAR, UP, OPTIONS).rear).toBe(true);
  });

  it("WHEEL1 (RV-1137): a toggle flips on each press, N taps in a frame N times, taps in frames back to back each", () => {
    const off = { ballCam: false, rear: false };
    const taps = (n: number) => ({ ...UP, ballCam: key(n, false), rearCamera: key(n, false) });
    const both = { ...OPTIONS, rearCameraToggle: true };
    expect([1, 2, 3].map((n) => updateSwitches(off, taps(n), UP, both))).toEqual([
      { ballCam: true, rear: true },
      { ballCam: false, rear: false },
      { ballCam: true, rear: true },
    ]);
    const first = updateSwitches(off, taps(1), UP, both);
    expect(updateSwitches(first, taps(1), taps(1), both), "the next frame's tap").toEqual(off);
    // (blocked: the ball cam's taps ignored, the rear camera's not)
    expect(updateSwitches(off, taps(3), UP, { ...both, blocked: true })).toEqual({ ballCam: false, rear: true });
  });

  it("WHEEL1: held mode, a press and release in the frame (a tap, a wheel's notch) leaves it off", () => {
    const off = { ballCam: false, rear: false };
    const hold = { ...OPTIONS, ballCamToggle: false };
    expect(updateSwitches(off, { ballCam: key(2, false), rearCamera: key(1, false) }, UP, hold)).toEqual(off);
  });

  it("a key held over frames, as before: toggled once at its press, kept through the hold and the release; held mode on to the release", () => {
    const off = { ballCam: false, rear: false };
    const frames = [BALL, BALL_HELD, BALL_HELD, UP];
    const run = (o: typeof OPTIONS) =>
      frames.reduce<{ state: typeof off; before: typeof UP; seen: boolean[] }>(
        (acc, now) => {
          const state = updateSwitches(acc.state, now, acc.before, o);
          return { state, before: now, seen: [...acc.seen, state.ballCam] };
        },
        { state: off, before: UP, seen: [] },
      ).seen;
    expect(run(OPTIONS), "toggle").toEqual([true, true, true, true]);
    expect(run({ ...OPTIONS, ballCamToggle: false }), "hold").toEqual([true, true, true, false]);
  });

  it("the pad's button: a press its edge, once, held after", () => {
    const off = { ballCam: false, rear: false };
    const pad = { ...UP, ballCam: { keyPresses: 0, keyDown: false, padDown: true } };
    const on = updateSwitches(off, pad, UP, OPTIONS);
    expect(on.ballCam).toBe(true);
    expect(updateSwitches(on, pad, pad, OPTIONS).ballCam, "held: no new press").toBe(true);
  });
});

describe("input packets (RV-4)", () => {
  it("go out every 1/60 s of real time, however slowed the ticks after a goal", () => {
    const clock = new SendClock();
    let sinceSend = 0;
    let worst = 0;
    let gameTime = 0;
    for (let frame = 0; frame < 300; frame++) {
      const real = 1 / 60;
      gameTime += worldSeconds(real, postGoalDilation(Math.floor(gameTime * 120) + 1));
      sinceSend += real;
      if (clock.due(real)) {
        worst = Math.max(worst, sinceSend);
        sinceSend = 0;
      }
    }
    expect(worst).toBeLessThanOrEqual(1 / 60 + 1e-12);
  });

  it("at 144 fps about 60 a second", () => {
    const clock = new SendClock();
    let sent = 0;
    for (let frame = 0; frame < 144 * 10; frame++) if (clock.due(1 / 144)) sent++;
    expect(Math.abs(sent - 600)).toBeLessThanOrEqual(2);
  });

  it("RV-22: count the world time undilated (DeltaSeconds / TimeDilation): 2 ms frames at 0.1875 send about 79 a second", () => {
    const clock = new SendClock();
    let sent = 0;
    for (let frame = 0; frame < 500; frame++) {
      const dilation = 0.1875;
      if (clock.due(frameTimes(0.002, dilation).world / dilation)) sent++;
    }
    expect(sent).toBeGreaterThanOrEqual(78);
    expect(sent).toBeLessThanOrEqual(81);
  });
});
