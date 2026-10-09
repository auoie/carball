// The camera switches and the input packets' clock (review findings RV-4, RV-9, RV-10).
import { describe, expect, it } from "vitest";
import { worldSeconds } from "../loop/fixedStep";
import { SendClock, newCar, updateSwitches } from "./cameraInput";
import { postGoalDilation } from "./goalSequence";

const UP = { ballCam: false, rearCamera: false };
const BALL = { ballCam: true, rearCamera: false };
const REAR = { ballCam: false, rearCamera: true };
const OPTIONS = { ballCamToggle: true, rearCameraToggle: false, blocked: false };

describe("camera switches", () => {
  it("RV-9: in the goal replay and after the match the ball cam ignores its button", () => {
    const off = { ballCam: false, rear: false };
    expect(updateSwitches(off, BALL, UP, OPTIONS).ballCam).toBe(true);
    expect(updateSwitches(off, BALL, UP, { ...OPTIONS, blocked: true }).ballCam).toBe(false);
    expect(updateSwitches(off, BALL, UP, { ...OPTIONS, ballCamToggle: false, blocked: true }).ballCam).toBe(false);
  });

  it("RV-10: a new car turns the rear camera off; held, it stays off until the button is pressed again", () => {
    const toggled = updateSwitches({ ballCam: false, rear: false }, REAR, UP, { ...OPTIONS, rearCameraToggle: true });
    expect(toggled.rear).toBe(true);
    expect(newCar(toggled).rear).toBe(false);
    const holding = updateSwitches({ ballCam: false, rear: false }, REAR, UP, OPTIONS);
    expect(holding.rear).toBe(true);
    const after = newCar(holding);
    expect(updateSwitches(after, REAR, REAR, OPTIONS).rear).toBe(false); // (still held: no new press)
    expect(updateSwitches(updateSwitches(after, UP, REAR, OPTIONS), REAR, UP, OPTIONS).rear).toBe(true);
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
});
