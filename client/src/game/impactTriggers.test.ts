// The impact and landing triggers' rules (notes/impact-triggers.md IT-1..5) on made-up inputs: the shake's curve and
// its local-car rule, the effects' cooldowns per slot, the car–ball and car–car sound sides, re-simulated ticks
// skipped, and the landings' edge and speed.
import { describe, expect, it } from "vitest";
import { BALL_IMPACT, type CarConfig, type Impact } from "../engine/world";
import { IDENTITY_ROT, type Vec3, vec3 } from "../math/vec";
import { IMPACT_SCALES, ImpactTriggers, type Trigger, type TriggerCar, hardPoint, impactShakeScale, triggerSounds } from "./impactTriggers";

const CONFIG: CarConfig = {
  hitboxSize: vec3(118, 84, 36),
  hitboxOffset: vec3(13.9, 0, 20.8),
  frontWheel: { offset: vec3(51.3, 25.9, 20.8), radius: 12.5, suspensionRest: 38.8 },
  backWheel: { offset: vec3(-33.8, 29.5, 20.8), radius: 15, suspensionRest: 37 },
};
const UP = vec3(0, 0, 1);

const impact = (tick: number, car: number, partner: Impact["partner"], speed: number, partnerId = 0): Impact => ({ tick, car, partner, partnerId, speed, pos: vec3(0, 0, 0), normal: UP });
const kinds = (out: readonly Trigger[]): string[] => out.map((t) => t.kind);

describe("the impact triggers (IT-1..4)", () => {
  it("the shake's curve: none to 200, 0.1 just past it, 1 from 4000", () => {
    expect(impactShakeScale(200)).toBe(0);
    expect(impactShakeScale(201)).toBeCloseTo(0.1, 9);
    expect(impactShakeScale(2100.5)).toBeCloseTo(0.55, 3);
    expect(impactShakeScale(5000)).toBe(1);
  });

  it("shakes the local car only, over 200; sparks and sounds from 50, a world partner's", () => {
    const t = new ImpactTriggers();
    expect(kinds(t.frame(0.01, [impact(1, 7, "world", 1000)], new Map(), new Map(), 7))).toEqual(["shake", "sparks", "carImpact"]);
    const u = new ImpactTriggers();
    expect(kinds(u.frame(0.01, [impact(1, 7, "world", 150), impact(1, 8, "world", 1000)], new Map(), new Map(), 7))).toEqual(["sparks", "carImpact", "sparks", "carImpact"]);
    expect(kinds(new ImpactTriggers().frame(0.01, [impact(1, 7, "world", 40)], new Map(), new Map(), 7))).toEqual([]);
  });

  it("the effects' cooldown: 0.15 s of game time per slot (world, actor), the shake none", () => {
    const t = new ImpactTriggers();
    t.frame(0.01, [impact(1, 7, "world", 1000)], new Map(), new Map(), 7);
    // (0.1 s later: the world slot still cooling, the actor slot free; the shake restarts regardless)
    expect(kinds(t.frame(0.1, [impact(13, 7, "world", 1000), impact(13, 7, "car", 1000, 3)], new Map(), new Map(), 7))).toEqual(["shake", "shake", "sparks", "carImpact"]);
    expect(kinds(t.frame(0.06, [impact(20, 7, "world", 1000)], new Map(), new Map(), 7))).toEqual(["shake", "sparks", "carImpact"]);
  });

  it("a car–ball hit sounds the ball's, on its own cooldown; a car–car pair sounds once (the larger index)", () => {
    const t = new ImpactTriggers();
    expect(kinds(t.frame(0.01, [impact(1, 7, "ball", 800)], new Map(), new Map(), null))).toEqual(["sparks", "ballImpact"]);
    // (another car on the ball 0.05 s later: its sparks, the ball still cooling)
    expect(kinds(t.frame(0.05, [impact(7, 8, "ball", 800)], new Map(), new Map(), null))).toEqual(["sparks"]);
    const u = new ImpactTriggers();
    expect(kinds(u.frame(0.01, [impact(1, 3, "car", 900, 5), impact(1, 5, "car", 900, 3)], new Map(), new Map(), null))).toEqual(["sparks", "sparks", "carImpact"]);
  });

  it("the ball's own off the arena (RV-172): Impact_Ball from 50 uu/s on its world slot (0.15 s), its car slot apart; a bounce sound", () => {
    const t = new ImpactTriggers();
    const own = (tick: number, speed: number): Impact => ({ ...impact(tick, BALL_IMPACT, "world", speed), car: BALL_IMPACT });
    expect(t.frame(0.01, [own(1, 800)], new Map(), new Map(), null)).toEqual([{ kind: "ballImpact", at: vec3(0, 0, 0), speed: 800, partner: "world" }]);
    // (0.1 s on: the world slot still cooling; a car's hit on it sounds on the actor slot)
    expect(kinds(t.frame(0.1, [own(13, 800), impact(13, 7, "ball", 800)], new Map(), new Map(), null))).toEqual(["sparks", "ballImpact"]);
    expect(kinds(t.frame(0.06, [own(20, 40)], new Map(), new Map(), null))).toEqual([]);
    expect(kinds(t.frame(0.01, [own(21, 600)], new Map(), new Map(), null))).toEqual(["ballImpact"]);
    expect(triggerSounds([{ kind: "ballImpact", at: vec3(0, 0, 0), speed: 650, partner: "world" }])).toEqual([{ kind: "ballBounce", at: vec3(0, 0, 0), strength: 0.5 }]);
  });

  it("skips ticks already handled (a prediction's re-simulation)", () => {
    const t = new ImpactTriggers();
    t.frame(0.01, [impact(10, 7, "world", 1000)], new Map(), new Map(), 7);
    expect(t.frame(0.5, [impact(9, 7, "world", 1000), impact(10, 7, "world", 1000)], new Map(), new Map(), 7)).toEqual([]);
    expect(kinds(t.frame(0.01, [impact(11, 7, "world", 1000)], new Map(), new Map(), 7))).toEqual(["shake", "sparks", "carImpact"]);
  });
});

describe("the landing trigger (IT-5)", () => {
  const car = (z: number, vz: number, contact: boolean, spawnCount = 1, angVel: Vec3 = vec3(0, 0, 0)): TriggerCar => ({
    pos: vec3(0, 0, z),
    vel: vec3(0, 0, vz),
    angVel,
    rot: IDENTITY_ROT,
    wheelContact: [contact, contact, contact, contact],
    wheelNormals: [UP, UP, UP, UP],
    spawnCount,
    demoed: false,
  });
  const configs = new Map([[1, CONFIG]]);

  it("each wheel's contact edge, at last frame's speed into the surface at its hard point: over 50, every wheel", () => {
    const t = new ImpactTriggers();
    t.frame(0.01, [], new Map([[1, car(60, -300, false)]]), configs, 1);
    const out = t.frame(0.01, [], new Map([[1, car(17, 0, true)]]), configs, 1);
    expect(kinds(out)).toEqual(["landing", "landing", "landing", "landing"]);
    for (const l of out) if (l.kind === "landing") expect(l.speed).toBeCloseTo(300, 6);
    // (already down: no edge)
    expect(t.frame(0.01, [], new Map([[1, car(17, 0, true)]]), configs, 1)).toEqual([]);
  });

  it("50 uu/s or less, a new placement, or a new car: none", () => {
    const t = new ImpactTriggers();
    t.frame(0.01, [], new Map([[1, car(30, -50, false)]]), configs, 1);
    expect(t.frame(0.01, [], new Map([[1, car(17, 0, true)]]), configs, 1)).toEqual([]);
    const u = new ImpactTriggers();
    u.frame(0.01, [], new Map([[1, car(60, -300, false)]]), configs, 1);
    expect(u.frame(0.01, [], new Map([[1, car(17, 0, true, 2)]]), configs, 1)).toEqual([]);
    expect(new ImpactTriggers().frame(0.01, [], new Map([[1, car(17, 0, true)]]), configs, 1)).toEqual([]);
  });

  it("the chassis' spin counts at each hard point, |v . n| either way: a roll of 10 rad/s lands each wheel at 10 |y|", () => {
    // (rolling about the forward axis, otherwise still: the right side (+y) moving down, the left up, each at 10 |y|;
    // all four touching in these made-up states)
    const t = new ImpactTriggers();
    t.frame(0.01, [], new Map([[1, car(40, 0, false, 1, vec3(10, 0, 0))]]), configs, 1);
    const out = t.frame(0.01, [], new Map([[1, car(17, 0, true)]]), configs, 1);
    const wheels = out.flatMap((l) => (l.kind === "landing" ? [l.wheel] : []));
    expect(wheels).toEqual([0, 1, 2, 3]);
    for (const l of out) if (l.kind === "landing") expect(l.speed).toBeCloseTo(10 * Math.abs(hardPoint(CONFIG, l.wheel).y), 6);
  });
});

describe("the triggers' sounds (SND-5, 6)", () => {
  it("a sound for each wheel landing: four landings of one car, four (RV-171)", () => {
    const landing = (wheel: number): Trigger => ({ kind: "landing", car: 1, wheel, at: vec3(0, 0, 0), speed: 600 });
    expect(triggerSounds([0, 1, 2, 3].map(landing)).map((s) => s.kind)).toEqual(["land", "land", "land", "land"]);
  });

  it("Impact_Body one scale for both partners: a car-world and a car-car hit at 2000 as strong (RV-173); the ball's full at 1300", () => {
    const [wall, bump, ball] = triggerSounds([
      { kind: "carImpact", car: 1, at: vec3(0, 0, 0), speed: 2000, partner: "world" },
      { kind: "carImpact", car: 1, at: vec3(0, 0, 0), speed: 2000, partner: "car" },
      { kind: "ballImpact", at: vec3(0, 0, 0), speed: 1300, partner: "car" },
    ]);
    const strength = (s: unknown): number => (s as { strength: number }).strength;
    expect(strength(wall)).toBe(strength(bump));
    expect(strength(wall)).toBe(1);
    expect(strength(ball)).toBe(1);
    expect(IMPACT_SCALES.body).toBe(2000);
  });
});
