import { Mesh, MeshStandardMaterial, Quaternion, ShaderLib, Vector3, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { BALL_RADIUS, BallView, GOAL_LINE, goalLine, patchedBallGeometry } from "./entities";
import { sceneDetail } from "./detail";
import { TEAM_PRIMARY_LINEAR, fullBright } from "./teamColors";

describe("ball", () => {
  it("has twelve five-triangle patches, so its spin shows", () => {
    const geometry = patchedBallGeometry();
    const colors = geometry.getAttribute("color");
    const positions = geometry.getAttribute("position");
    let dark = 0;
    for (let i = 0; i < colors.count; i += 3) if (colors.getX(i) < 0.1) dark++;
    expect(dark).toBe(12 * 5);
    for (let i = 0; i < positions.count; i++) {
      const r = Math.hypot(positions.getX(i), positions.getY(i), positions.getZ(i));
      expect(r).toBeCloseTo(BALL_RADIUS, 3);
    }
  });
});

describe("the ball's floor reticle (VT-30a)", () => {
  it("stays under the ball, its inner ring drawn for the height of the ball's centre", () => {
    const view = new BallView();
    const at = (x: number, y: number, z: number): { x: number; z: number; altitude: number } => {
      view.update(new Vector3(x, y, z), new Quaternion());
      return view.marker;
    };
    expect(at(500, BALL_RADIUS, -800)).toEqual({ x: 500, z: -800, altitude: BALL_RADIUS });
    expect(at(-1200, 1800, 300)).toEqual({ x: -1200, z: 300, altitude: 1800 });
  });
});

describe("the ball's FX actor's other pieces (VT-30a)", () => {
  it("the far ring and the clarity sphere 1 s after a spawn, the beam's first particle at 2 s; all gone at once on the explosion; again after a reset", () => {
    const view = new BallView();
    view.spawn();
    const step = (seconds: number, exploded = false): void => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) view.fade(exploded, 1 / 60);
    };
    step(0.9);
    expect(view.fxShown).toEqual({ beam: false, ring: false, sphere: false });
    step(0.2);
    expect(view.fxShown).toEqual({ beam: false, ring: true, sphere: true });
    step(1);
    expect(view.fxShown).toEqual({ beam: true, ring: true, sphere: true });
    view.fade(true, 1 / 60);
    expect(view.fxShown).toEqual({ beam: false, ring: false, sphere: false });
    // (a reset makes a new FX actor: its timer from 0)
    view.spawn(true);
    view.fade(false, 1 / 60);
    expect(view.fxShown).toEqual({ beam: false, ring: false, sphere: false });
  });
});

describe("the goal line's effect on the ball (VT-31)", () => {
  it("in the ball's shader: the white-hot line 96 x, the shake 1 + 4 g uu (VT-31's measures, RV-462)", () => {
    expect([GOAL_LINE.line, GOAL_LINE.shake.base, GOAL_LINE.shake.inside]).toEqual([96, 1, 4]);
    const materials: MeshStandardMaterial[] = [];
    new BallView().root.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) materials.push(o.material);
    });
    const ball = materials[0];
    if (!ball) throw new Error("no ball material");
    const shader = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
    ball.onBeforeCompile(shader, {} as WebGLRenderer);
    expect(shader.vertexShader).toContain("glW.xyz += glOn * (1.0 + 4.0 * glG) * glProximity");
    expect(shader.fragmentShader).toContain("totalEmissiveRadiance += glD3 * (96.0 * glLine + glFlicker)");
  });

  it("the plane where the ball crosses a mouth's face, by its centre's side and its radius; the goals' nearness from 2048 uu", () => {
    // (on the field side, less than a radius from the +y face: its normal toward the field, -y)
    expect(goalLine(0, 5120 - 50, 300).plane).toEqual({ y: 5120, n: -1 });
    expect(goalLine(500, -5120 + 80, 100).plane).toEqual({ y: -5120, n: 1 });
    // (more than a radius off, outside the face, or above it: none)
    expect(goalLine(0, 5120 - BALL_RADIUS - 1, 300).plane).toBeNull();
    expect(goalLine(961, 5120 - 50, 300).plane).toBeNull();
    expect(goalLine(0, 5120 - 50, 689).plane).toBeNull();
    // (past the line, still crossing until it explodes)
    expect(goalLine(0, 5120 + 300, 300).plane).toEqual({ y: 5120, n: -1 });
    expect(goalLine(0, 0, 93).proximity).toBe(0);
    expect(goalLine(0, 5120, 312).proximity).toBe(1);
    expect(goalLine(0, 5120 - 1024, 312).proximity).toBeCloseTo(0.5, 9);
  });

  it("on with the ball, off while it dissolves (a spawn's fade-in, the explosion)", () => {
    const view = new BallView();
    view.spawn();
    view.fade(false, 1 / 60);
    expect(view.goalLineState.on).toBe(false);
    for (let i = 0; i < 70; i++) view.fade(false, 1 / 60);
    expect(view.goalLineState.on).toBe(true);
    view.update(new Vector3(0, 300, 5120 - 50), new Quaternion());
    expect(view.goalLineState.normalZ).toBe(-1);
    view.fade(true, 1 / 60);
    expect(view.goalLineState.on).toBe(false);
  });
});

describe("the ball's look on a goal and at a kickoff (VT-15, VT-30)", () => {
  it("dissolves in 0.333 s once exploded (each frame's time capped at 1/30), its marker gone at once", () => {
    const view = new BallView();
    view.fade(true, 1 / 60);
    expect(view.opacity).toBeCloseTo(1 - 3 / 60, 9);
    expect(view.alpha).toBe(1); // (the dissolve keeps it solid at first: RV-31)
    // (mid-way, alpha = clamp((D - 0.5) / 0.214): after 8 frames D 0.6, alpha 0.467)
    for (let i = 0; i < 7; i++) view.fade(true, 1 / 60);
    expect(view.opacity).toBeCloseTo(0.6, 9);
    expect(view.alpha).toBeCloseTo(0.1 / 0.214, 9);
    for (let i = 0; i < 12; i++) view.fade(true, 1 / 60);
    expect(view.opacity).toBe(0);
    const slow = new BallView();
    slow.fade(true, 0.2); // (a long frame counts 1/30)
    expect(slow.opacity).toBeCloseTo(0.9, 9);
  });

  it("a new ball fades in over a second; a replay's is shown at once", () => {
    const view = new BallView();
    view.spawn();
    expect(view.opacity).toBe(0);
    view.fade(false, 0.5); // (a long frame counts 1/30: RV-30)
    expect(view.opacity).toBeCloseTo(1 / 30, 9);
    for (let i = 0; i < 57; i++) view.fade(false, 1 / 60);
    expect(view.opacity).toBeCloseTo(1 / 30 + 57 / 60, 9);
    view.fade(false, 1 / 60);
    view.fade(false, 1 / 60);
    expect(view.opacity).toBe(1);
    view.spawn(true);
    expect(view.opacity).toBe(1);
  });
});

describe("the ball's speed trail (VT-10, VT-10a)", () => {
  const run = (ball: BallView, frames: number, step = 60): void => {
    const at = new Vector3(0, 93, 0);
    for (let k = 0; k < frames; k++) {
      ball.fade(false, 1 / 60);
      at.z += step;
      ball.update(at, new Quaternion());
    }
  };

  it("its new points in the last touch's team colour at full brightness, white before any; its speed the ball's travel", () => {
    const ball = new BallView();
    run(ball, 30);
    expect(ball.trail.points.at(-1)?.colour).toEqual([1, 1, 1]);
    // (60 uu a 1/60 s: 3600 uu/s, over 2000: its opacity rising)
    expect(ball.trail.opacity).toBeGreaterThan(0.5);
    ball.trailTeam = 1;
    run(ball, 10);
    expect(ball.trail.points.at(-1)?.colour).toEqual(fullBright(TEAM_PRIMARY_LINEAR[1] ?? [1, 1, 1]));
  });

  it("gone at once at the explosion; begun again unseen at a spawn; none while not shown (the podium)", () => {
    const ball = new BallView();
    run(ball, 30);
    expect(ball.trail.points.length).toBeGreaterThan(0);
    ball.fade(true, 1 / 60);
    expect(ball.trail.points).toHaveLength(0);
    run(ball, 30);
    ball.spawn();
    expect([ball.trail.points.length, ball.trail.opacity]).toEqual([0, 0]);
    ball.trailShown = false;
    run(ball, 30);
    expect(ball.trail.points).toHaveLength(0);
  });

  it("its four side ribbons at World Detail High alone, from 72 uu off the ball's centre along its own y and z, turning with it (RV-536)", () => {
    const ball = new BallView();
    run(ball, 30);
    expect(ball.sideTrails.map((s) => s.drawn)).toEqual([true, true, true, true]);
    // (the ball held still, unturned: the game's ±y Three's ±z, its ±z Three's ±y; the newest points dropped there)
    const centre = new Vector3(500, 400, 1000);
    const hold = (rotation: Quaternion): Vector3[] => {
      for (let k = 0; k < 10; k++) {
        ball.fade(false, 1 / 60);
        ball.update(centre, rotation);
      }
      return ball.sideTrails.map((t) => (t.points.points.at(-1)?.at ?? new Vector3()).clone().sub(centre));
    };
    expect(hold(new Quaternion()).map((p) => p.toArray().map(Math.round))).toEqual([
      [0, 0, 72],
      [0, 0, -72],
      [0, 72, 0],
      [0, -72, 0],
    ]);
    // (a quarter turn about the vertical: the game's y offset now along Three's x)
    expect(hold(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))[0]?.toArray().map(Math.round)).toEqual([72, 0, 0]);
    // (World Detail Quality or Performance: none)
    sceneDetail.world = "performance";
    try {
      run(ball, 10);
      expect(ball.sideTrails.every((s) => !s.drawn && s.points.points.length === 0)).toBe(true);
    } finally {
      sceneDetail.world = "highQuality";
    }
  });
});

