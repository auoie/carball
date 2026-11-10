// The touch controls' input (src/input/touch.ts, src/input/mapping.ts; notes/mobile.md): the stick's vector and its
// throttle, the stick as a pad's left stick (merged with a real pad's), and the buttons through the game's own reading
// of controls and commands (a tap shorter than a frame too)
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS, type Action } from "./bindings";
import { withTouchStick } from "./devices";
import { ButtonLatch, type InputSnapshot, JumpLatch, actionEvents, readControls, readHeldActions, stickThrottle } from "./mapping";
import { STICK_RADIUS, TOUCH_ACTIONS, stickVector } from "./touch";

const DZ = 0.2;

/** A frame's input from the touch controls alone: the stick (as InputDevices puts it, on the pad's left stick too) */
function touch(stick: { x: number; y: number } | null, held: Action[] = [], pressed: Action[] = []): InputSnapshot {
  return {
    keys: new Set(),
    mouseButtons: new Set(),
    events: [],
    gamepad: withTouchStick(null, stick),
    touch: { stick, held: new Set(held), pressed: new Set(pressed) },
  };
}

describe("the stick", () => {
  it("is the finger's offset over the travel, clamped to the unit disc", () => {
    expect(stickVector(STICK_RADIUS / 2, 0)).toEqual({ x: 0.5, y: 0 });
    expect(stickVector(0, -STICK_RADIUS * 3)).toEqual({ x: 0, y: -1 });
    const corner = stickVector(STICK_RADIUS, STICK_RADIUS);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1, 12);
  });

  it("drives forward at its tilt past the deadzone, reverses only in its bottom quarter: full lock still drives", () => {
    expect(stickThrottle(0, -1, DZ)).toBeCloseTo(1, 12);
    expect(stickThrottle(0, -0.6, DZ)).toBeCloseTo(0.5, 12);
    expect(stickThrottle(0.1, -0.1, DZ)).toBe(0);
    expect(stickThrottle(1, 0, DZ)).toBeCloseTo(1, 12); // (full lock sideways)
    expect(stickThrottle(-0.7, 0.69, DZ)).toBeGreaterThan(0); // (just above the reverse wedge)
    expect(stickThrottle(0.3, 0.9, DZ)).toBeLessThan(0);
    expect(stickThrottle(0, 1, DZ)).toBeCloseTo(-1, 12);
  });

  it("is a pad's left stick: a virtual pad's alone, else the tilt further from centre winning on a real pad's", () => {
    expect(withTouchStick(null, null)).toBeNull();
    expect(withTouchStick(null, { x: 0.5, y: -0.25 })).toEqual({ axes: [0.5, -0.25, 0, 0], buttons: Array.from({ length: 17 }, () => 0) });
    const real = { axes: [0.8, 0.1, 0.3, -0.3], buttons: [1, 0] };
    expect(withTouchStick(real, { x: -0.2, y: -0.9 })).toEqual({ axes: [0.8, -0.9, 0.3, -0.3], buttons: [1, 0] });
  });

  it("steers, pitches and yaws as the pad's stick does (its deadzone too), throttling as above", () => {
    const c = readControls(touch({ x: 0.6, y: -0.6 }), DEFAULT_BINDINGS, DZ);
    expect(c.steer).toBeCloseTo(0.5, 12);
    expect(c.yaw).toBeCloseTo(0.5, 12);
    expect(c.pitch).toBeCloseTo(-0.5, 12); // (stick pushed forward: nose down)
    expect(c.throttle).toBeCloseTo(stickThrottle(0.6, -0.6, DZ), 12);
    expect(readControls(touch({ x: 0, y: 0.8 }), DEFAULT_BINDINGS, DZ).throttle).toBeCloseTo(-0.75, 12);
    expect(readControls(touch(null), DEFAULT_BINDINGS, DZ).throttle).toBe(0);
  });
});

describe("the buttons", () => {
  it("hold their actions, not pad buttons: Slide is powerslide and air roll (yaw becomes roll), never Reverse", () => {
    const held = (b: keyof typeof TOUCH_ACTIONS): Action[] => [...TOUCH_ACTIONS[b]];
    const c = readControls(touch({ x: 1, y: 0 }, [...held("jump"), ...held("boost"), ...held("slide")]), DEFAULT_BINDINGS, DZ);
    expect(c).toMatchObject({ jump: true, boost: true, handbrake: true, yaw: 0, roll: 1 });
    expect(c.throttle).toBeGreaterThan(0); // (the default pad's LT, Reverse and Air roll both, never pressed)
  });

  it("a jump tapped within a frame still jumps, for one tick (the latch's): as a key's tap", () => {
    const latch = new ButtonLatch();
    const jump = new JumpLatch();
    const c = readControls(touch(null, [], ["jump"]), DEFAULT_BINDINGS, DZ, latch);
    jump.frame(latch);
    expect(c.jump).toBe(false);
    expect(jump.tick(c.jump)).toBe(true);
    expect(jump.tick(false)).toBe(false);
  });

  it("commands as a key's: a press, a tap within a frame, the release when let go; Jump skips the replay", () => {
    const at = (s: InputSnapshot) => readHeldActions(s, DEFAULT_BINDINGS, DZ);
    const idle = at(touch(null));
    const pressed = at(touch(null, ["ballCam"], ["ballCam"]));
    expect(actionEvents(pressed.ballCam, idle.ballCam)).toEqual([true]);
    const held = at(touch(null, ["ballCam"]));
    expect(actionEvents(held.ballCam, pressed.ballCam)).toEqual([]);
    expect(actionEvents(idle.ballCam, held.ballCam)).toEqual([false]);
    expect(actionEvents(at(touch(null, [], ["reset"])).reset, idle.reset)).toEqual([true, false]);
    expect(at(touch(null, [...TOUCH_ACTIONS.jump])).readyUp).toBe(true);
    expect(at(touch(null, [...TOUCH_ACTIONS.scoreboard])).scoreboard).toBe(true);
  });
});
