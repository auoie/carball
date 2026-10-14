// Tests for the Rocket League patches applied to the vendored RocketSim (engine/rocketsim, "RL PATCH").
// Each test checks one verified difference from notes/physics-values.md.
//
// Usage: rl_patch_tests [collision_meshes dir]   (default: ARENA_MESH_DIR from CMake)
#include "RocketSim.h"
#include "Sim/Quantize/Quantize.h"
#include "Sim/GameRotator/GameRotator.h"

#include <cmath>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <functional>
#include <vector>
#include <string>

using namespace RocketSim;

static int failures = 0, checks = 0;

#define CHECK(cond, ...) do { \
	checks++; \
	if (!(cond)) { failures++; printf("    FAIL %s:%d: %s -- ", __FILE__, __LINE__, #cond); printf(__VA_ARGS__); printf("\n"); } \
} while (0)

static bool Near(float a, float b, float eps) { return fabsf(a - b) <= eps; }
static constexpr float DEG = (float)(M_PI / 180);

static CarState CarAt(Vec pos, Vec forward, Vec up, Vec vel = {}) {
	CarState s;
	s.pos = pos;
	s.rotMat = RotMat(forward, up.Cross(forward), up);
	s.vel = vel;
	return s;
}

static RotMat Upright(Vec forward) { return RotMat(forward, Vec(0, 0, 1).Cross(forward), Vec(0, 0, 1)); }

// --------------------------------------------------------------------------------------------
static void TestQuantize() {
	puts("quantization helpers");
	CHECK(Near(Quantize::Location(12.345f), 12.35f, 1e-5f), "%f", Quantize::Location(12.345f));
	CHECK(Near(Quantize::Location(-12.344f), -12.34f, 1e-5f), "%f", Quantize::Location(-12.344f));
	CHECK(Near(Quantize::Velocity(1.2345f, 100), 1.231f, 1e-6f), "%f", Quantize::Velocity(1.2345f, 100));
	CHECK(Near(Quantize::Velocity(-1.2345f, 100), -1.231f, 1e-6f), "%f", Quantize::Velocity(-1.2345f, 100));
	CHECK(Quantize::Velocity(0.004f, 100) == 0, "%f", Quantize::Velocity(0.004f, 100));
	CHECK(Near(Quantize::Velocity(5.43219f, 10000), 5.43211f, 2e-6f), "%f", Quantize::Velocity(5.43219f, 10000));

	btQuaternion q(btVector3(0.3f, -0.5f, 0.8f).normalized(), 1.234f);
	btQuaternion a = Quantize::Rotation(q), b = Quantize::Rotation(a);
	float angle = 2 * acosf(RS_MIN(fabsf(q.dot(a)), 1.f));
	CHECK(angle < 1e-4f, "quantization error %g rad", angle);
	CHECK(Near(a.x(), b.x(), 1e-6f) && Near(a.y(), b.y(), 1e-6f) && Near(a.z(), b.z(), 1e-6f) && Near(a.w(), b.w(), 1e-6f),
		"not idempotent");
}

static void TestQuantizeInSim(Arena* arena) {
	puts("state is quantized every tick");
	BallState bs;
	bs.pos = { 123.4567f, -765.4321f, 500.1234f };
	bs.vel = { 1234.5678f, -333.3333f, 77.7777f };
	bs.angVel = { 1.234567f, -2.345678f, 0.5f };
	arena->ball->SetState(bs);
	arena->Step(3);
	BallState s = arena->ball->GetState();
	for (int i = 0; i < 3; i++) {
		float p = s.pos[i] * 100;
		CHECK(fabsf(p - roundf(p)) < 0.02f, "pos[%d] = %.5f is not on the 0.01 grid", i, s.pos[i]);
		// velocity = trunc(v*100)/100 + sign*0.001 -> the third decimal is 1 (or 9 for negatives)
		float v = fabsf(s.vel[i]) * 1000;
		CHECK(fabsf(fmodf(v, 10) - 1) < 0.05f, "vel[%d] = %.5f lacks the 0.001 nudge", i, s.vel[i]);
	}
}

// --------------------------------------------------------------------------------------------
// Starts a flip in the air with the given stick, then calls `hold` every following tick.
static std::vector<Vec> FlipAngVels(Arena* arena, Car* car, CarControls start, std::function<void(CarControls&, int)> hold, int ticks) {
	car->SetState(CarAt({ 0, 0, 1000 }, { 1, 0, 0 }, { 0, 0, 1 }));
	car->controls = CarControls();
	arena->Step();
	car->controls = start;
	car->controls.jump = true;
	arena->Step();
	std::vector<Vec> out;
	for (int i = 1; i <= ticks; i++) {
		hold(car->controls, i);
		arena->Step();
		out.push_back(car->GetState().angVel);
	}
	return out;
}

static void TestFlipCancelLock(Arena* arena, Car* car) {
	puts("flip cancel: no pitch cancel before 0.041 s");
	CarControls front; front.pitch = -1;
	auto noCancel = FlipAngVels(arena, car, front, [](CarControls& c, int) { c.pitch = 0; }, 8);
	auto cancel = FlipAngVels(arena, car, front, [](CarControls& c, int) { c.pitch = 1; }, 8);
	// The dodge's active time on the i-th tick after the press is i/120 (0 on the press tick): 4/120 < 0.041 <= 5/120
	for (int i = 0; i < 4; i++)
		CHECK(Near(noCancel[i].y, cancel[i].y, 1e-4f), "torque tick %d: cancelled too early (%.4f vs %.4f)", i + 1, cancel[i].y, noCancel[i].y);
	// (by tick 5 the flip is already at the 5.5 rad/s cap, so the cancel shows as a small difference)
	CHECK(fabsf(cancel[4].y - noCancel[4].y) > 0.05f, "torque tick 5: cancel had no effect (%.4f vs %.4f)", cancel[4].y, noCancel[4].y);
}

static void TestDodgeTorque(Arena* arena, Car* car) {
	puts("dodge torque: Normal(-pitch, yaw + roll), rounded to whole numbers");
	CarControls diag; diag.pitch = -1; diag.yaw = 1;
	FlipAngVels(arena, car, diag, [](CarControls&, int) {}, 1);
	Vec t = car->_internalState.flipRelTorque;
	CHECK(Near(t.x * RLConst::FLIP_TORQUE_X, -184, 1e-3f) && Near(t.y * RLConst::FLIP_TORQUE_Y, 158, 1e-3f),
		"torque (%.4f, %.4f), expected (-184, 158)", t.x * RLConst::FLIP_TORQUE_X, t.y * RLConst::FLIP_TORQUE_Y);

	// Small but valid flip input: the game has no 0.1 deadzone on the torque direction
	CarControls small; small.pitch = -0.05f; small.yaw = 0.3f; small.roll = -0.22f;
	FlipAngVels(arena, car, small, [](CarControls&, int) {}, 1);
	t = car->_internalState.flipRelTorque;
	CHECK(car->_internalState.isFlipping, "expected a flip (|p|+|y|+|r| = 0.57 >= 0.5)");
	CHECK(fabsf(t.x) > 0.5f, "small-input flip has no torque (%.4f, %.4f)", t.x, t.y);
}

static void TestDodgeThreshold(Arena* arena, Car* car) {
	puts("dodge vs double jump: |pitch| + |yaw| + |roll| >= 0.5 (already in RocketSim)");
	CarControls weak; weak.pitch = -0.2f; weak.yaw = 0.29f;
	FlipAngVels(arena, car, weak, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasDoubleJumped && !car->_internalState.hasFlipped, "0.49 should double jump");
	CarControls ok; ok.pitch = -0.2f; ok.yaw = 0.3f;
	FlipAngVels(arena, car, ok, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasFlipped, "0.5 should flip");
}

// --------------------------------------------------------------------------------------------
// Runs `ticks` ticks from `state` with fixed controls.
static CarState Run(Arena* arena, Car* car, CarState state, CarControls c, int ticks) {
	state.refreshInertia = true; // (every run from the same start: its inertia tensor from this rotation, not the last run's)
	car->SetState(state);
	car->controls = c;
	arena->Step(ticks);
	return car->GetState();
}

static bool SameMotion(const CarState& a, const CarState& b) {
	return memcmp(&a.pos, &b.pos, sizeof(Vec)) == 0 && memcmp(&a.vel, &b.vel, sizeof(Vec)) == 0 &&
		memcmp(&a.angVel, &b.angVel, sizeof(Vec)) == 0;
}

static void TestSensitivity(Arena* arena, Car* car) {
	puts("sensitivity: steering and air control shape the input (scale, clamp; digital at 10); dodges use the raw input");
	CarState ground = CarAt({ 0, -2500, 17.01f }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 1000, 0 });
	CarControls full; full.throttle = 1; full.steer = 1;
	CarControls half = full; half.steer = 0.5f;
	CarControls tiny = full; tiny.steer = 0.1f;
	CarState ref = Run(arena, car, ground, full, 60);
	CHECK(!SameMotion(ref, Run(arena, car, ground, half, 60)), "steer 0.5 should differ from steer 1");
	car->config.steeringSensitivity = 2;
	CHECK(SameMotion(ref, Run(arena, car, ground, half, 60)), "steer 0.5 at sensitivity 2 should equal steer 1");
	car->config.steeringSensitivity = 10;
	CHECK(SameMotion(ref, Run(arena, car, ground, tiny, 60)), "steer 0.1 at sensitivity 10 should be full steer");
	car->config.steeringSensitivity = 1;

	CarState air = CarAt({ 0, 0, 1200 }, { 1, 0, 0 }, { 0, 0, 1 });
	CarControls a1; a1.pitch = 1; a1.yaw = -0.5f; a1.roll = 0.8f;
	CarControls a2; a2.pitch = 0.5f; a2.yaw = -0.25f; a2.roll = 0.4f;
	CarState airRef = Run(arena, car, air, a1, 20);
	car->config.airControlSensitivity = 2;
	CHECK(SameMotion(airRef, Run(arena, car, air, a2, 20)), "air input 0.5 at sensitivity 2 should equal input 1");

	// The dodge check sees the raw stick: 0.2 + 0.2 = 0.4 < 0.5 double jumps even though shaped it would be 0.8
	CarControls weak; weak.pitch = -0.2f; weak.yaw = 0.2f;
	FlipAngVels(arena, car, weak, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasDoubleJumped && !car->_internalState.hasFlipped, "raw 0.4 should double jump at sensitivity 2");
	car->config.airControlSensitivity = 1;
}

static void TestDodgeDeadzone(Arena* arena, Car* car) {
	puts("dodge deadzone: the player's DodgeInputThreshold");
	car->config.dodgeDeadzone = 0.8f;
	CarControls c; c.pitch = -0.4f; c.yaw = 0.39f;
	FlipAngVels(arena, car, c, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasDoubleJumped && !car->_internalState.hasFlipped, "0.79 should double jump at deadzone 0.8");
	c.yaw = 0.4f;
	FlipAngVels(arena, car, c, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasFlipped, "0.8 should flip at deadzone 0.8");

	// The dodge's forward input as its own byte (C-2): stick forward 0.8 is pitch q(-0.8) = -102/128 = -0.797, under
	// the deadzone, but DodgeForward q(0.8) = 102/127 = 0.803, over it: the game dodges
	CarControls forward; forward.pitch = -0.8f;
	FlipAngVels(arena, car, forward, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasDoubleJumped && !car->_internalState.hasFlipped, "pitch -0.8 alone should double jump at deadzone 0.8");
	forward.dodgeForward = 0.8f; forward.hasDodgeForward = true;
	FlipAngVels(arena, car, forward, [](CarControls&, int) {}, 1);
	CHECK(car->_internalState.hasFlipped && car->controls.dodgeForward == 102.f / 127, "DodgeForward 0.8 should flip at deadzone 0.8 (%.4f)",
		car->controls.dodgeForward);
	car->config.dodgeDeadzone = 0.5f;
}

static void TestAirPitchSafety(Arena* arena, Car* car) {
	puts("air pitch safety: air control ignores pitch, dodges still use it");
	CarState air = CarAt({ 0, 0, 1200 }, { 1, 0, 0 }, { 0, 0, 1 });
	CarControls none;
	CarControls held; held.pitch = -1; held.airPitchSafety = true;
	CHECK(SameMotion(Run(arena, car, air, none, 20), Run(arena, car, air, held, 20)), "safety should zero air pitch");

	CarControls front; front.pitch = -1;
	FlipAngVels(arena, car, front, [](CarControls&, int) {}, 1);
	Vec plain = car->_internalState.flipRelTorque;
	FlipAngVels(arena, car, held, [](CarControls&, int) {}, 1);
	Vec safe = car->_internalState.flipRelTorque;
	CHECK(car->_internalState.hasFlipped && plain.x == safe.x && plain.y == safe.y,
		"front flip changed by the safety ((%.3f, %.3f) vs (%.3f, %.3f))", safe.x, safe.y, plain.x, plain.y);
}

static void TestDodgePitchLockAfterLanding(Arena* arena, Car* car) {
	puts("pitch lock after a dodge that ends by landing: air control ignores pitch for 0.3 s more (GA-5)");
	using namespace RLConst;
	// A dodge still active as the car lands (a wavedash)
	CarState g = CarAt({ 0, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 });
	g.isOnGround = true; g.hasJumped = true; g.hasFlipped = true; g.isFlipping = true; g.flipTime = 0.2f;
	g.flipRelTorque = { 0, -1, 0 };
	car->SetState(g);
	car->controls = CarControls();
	arena->Step(1);
	float lock = car->GetState().dodgePitchLockTime;
	CHECK(!car->GetState().isFlipping && lock > 0.28f && lock < 0.3f, "landing during a dodge: lock %.4f s, expected 0.3 less a tick", lock);
	// In the air (jumped off at once): pitch does nothing until the lock runs out, 36 ticks after the landing
	auto pitchRate = [&](float lockLeft, int ticks) {
		CarState a = CarAt({ 0, 0, 800 }, { 1, 0, 0 }, { 0, 0, 1 });
		a.isOnGround = false; a.hasJumped = true; a.dodgePitchLockTime = lockLeft;
		car->SetState(a);
		CarControls c; c.pitch = 1;
		car->controls = c;
		arena->Step(ticks);
		return car->GetState().angVel.Dot(car->GetState().rotMat.right);
	};
	float locked = pitchRate(lock, 10), free = pitchRate(0, 10), after = pitchRate(lock, 40);
	CHECK(abs(locked) < 0.01f && abs(free) > 0.5f, "pitch rate with the lock %.3f, without %.3f", locked, free);
	CHECK(abs(after) > 0.2f, "after the lock (40 ticks): pitch rate %.3f, expected pitching", after);
}

static void TestAirThrottleWhileBoosting(Arena* arena, Car* car) {
	puts("air throttle: full while boosting whatever the throttle (boost + air throttle = 1058.33 uu/s^2)");
	auto accel = [&](float throttle, bool boost) {
		CarState s = CarAt({ 0, 0, 1500 }, { 1, 0, 0 }, { 0, 0, 1 });
		s.boost = 100;
		car->SetState(s);
		car->controls = CarControls();
		car->controls.throttle = throttle;
		car->controls.boost = boost;
		arena->Step(10);
		float v0 = car->GetState().vel.x;
		arena->Step(60);
		return (car->GetState().vel.x - v0) / 0.5f;
	};
	float full = accel(1, true), none = accel(0, true), back = accel(-1, true), coast = accel(1, false);
	CHECK(Near(full, 3175.f / 3, 2) && Near(none, 3175.f / 3, 2) && Near(back, 3175.f / 3, 2),
		"boosting: throttle 1 / 0 / -1 gave %.2f / %.2f / %.2f, expected 1058.33", full, none, back);
	CHECK(Near(coast, 200.f / 3, 1), "air throttle without boost %.2f, expected 66.67", coast);
}

static void TestAutoFlip(Arena* arena, Car* car) {
	puts("auto-flip: angular velocity jumps to the 5.5 rad/s cap");
	CarState s;
	s.pos = { 0, 0, 45 };
	s.rotMat = RotMat({ 1, 0, 0 }, { 0, -1, 0 }, { 0, 0, -1 }); // on its roof
	car->SetState(s);
	car->controls = CarControls();
	arena->Step(120);
	car->controls.jump = true;
	arena->Step();
	CHECK(car->_internalState.isAutoFlipping, "auto-flip did not start");
	float peakRollRate = 0;
	for (int i = 0; i < 90; i++) {
		arena->Step();
		CarState st = car->GetState();
		peakRollRate = RS_MAX(peakRollRate, fabsf(st.angVel.Dot(st.rotMat.forward)));
	}
	// Stock RocketSim's 50 rad/s^2 ramp loses against the roof contact and never turns the car over
	CHECK(peakRollRate > 5.4f, "peak roll rate %.3f rad/s", peakRollRate);
	CHECK(car->GetState().rotMat.up.z > 0, "car did not turn over (up.z %.3f)", car->GetState().rotMat.up.z);
	car->controls.jump = false;
}

static void TestAutoFlipContactNormal(Arena* arena, Car* car) {
	puts("auto-flip: needs the car's up within 15 degrees of the contact normal's opposite (FlipCar CanActivate)");
	// Roof down on the side wall's 30-degree curve (live ga_autoflip: the game flips; RocketSim's |roll| > 2.8 didn't)
	Vec n = { -0.5f, 0, 0.8660254f };
	car->SetState(CarAt({ 3946, 0, 73 }, { 0, 1, 0 }, n * -1));
	car->controls = CarControls();
	arena->Step();
	CHECK(car->_internalState.worldContact.hasContact, "roof down on the curve: no world contact");
	car->controls.jump = true;
	arena->Step();
	CHECK(car->_internalState.isAutoFlipping, "roof down on the curve: no auto-flip");
	// 162 degrees on the floor: 18 degrees off, so no auto-flip (the game double jumps; RocketSim flipped above 160.4)
	float r = 162 * DEG;
	car->SetState(CarAt({ 0, 0, 52 }, { 0, 1, 0 }, { sinf(r), 0, cosf(r) }));
	car->controls = CarControls();
	arena->Step();
	CHECK(car->_internalState.worldContact.hasContact, "162 degrees: no world contact");
	car->controls.jump = true;
	arena->Step();
	CHECK(!car->_internalState.isAutoFlipping && car->_internalState.hasDoubleJumped,
		"162 degrees: expected a double jump, not an auto-flip (auto-flipping %d)", (int)car->_internalState.isAutoFlipping);
	car->controls.jump = false;
}

static void TestBoostSetsThrottle(Arena* arena, Car* car) {
	puts("boost on the ground: the input throttle becomes 1 for everything (Car_TA.SetVehicleInput), on walls too");
	auto run = [&](CarState s, float throttle, int ticks) {
		s.boost = 100;
		CarControls c; c.throttle = throttle; c.boost = true;
		return Run(arena, car, s, c, ticks);
	};
	CarState floor = CarAt({ 0, -2500, 17.01f }, { 0, 1, 0 }, { 0, 0, 1 });
	CHECK(SameMotion(run(floor, 0, 60), run(floor, 1, 60)), "boost only on the floor should drive as boost + throttle");
	// On the side wall: without the override the wheels lose the sticky grip (x0.1 on a wall) and the car slides
	CarState wall = CarAt({ 4079, 0, 600 }, { 0, 1, 0 }, { -1, 0, 0 });
	CHECK(SameMotion(run(wall, 0, 120), run(wall, 1, 120)), "boost only on the side wall should hold as boost + throttle");
}

static void TestThrottleDeadzone(Arena* arena, Car* car) {
	puts("throttle deadzone: |throttle| <= 0.01 coasts (VehicleSim), so a throttle byte of +-1 does");
	CarState moving = CarAt({ 0, -2500, 17.01f }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 1000, 0 });
	CarControls coast, plus1, minus1, plus2;
	plus1.throttle = 1 / 127.f; minus1.throttle = -1 / 127.f; plus2.throttle = 2 / 127.f;
	CarState ref = Run(arena, car, moving, coast, 40);
	CHECK(SameMotion(ref, Run(arena, car, moving, plus1, 40)), "throttle byte +1 should coast");
	CHECK(SameMotion(ref, Run(arena, car, moving, minus1, 40)), "throttle byte -1 should coast");
	CHECK(!SameMotion(ref, Run(arena, car, moving, plus2, 40)), "throttle byte +2 should drive");
}

static void TestJumpRepress(Arena* arena, Car* car) {
	puts("jump: no new ground jump before a landing (bJumped); a release ends the jump even if pressed again");
	CarState floor = CarAt({ 0, -2500, 17.01f }, { 0, 1, 0 }, { 0, 0, 1 });
	auto run = [&](std::vector<int> pattern) { // n > 0: jump held n ticks, n < 0: released -n ticks
		car->SetState(floor);
		car->controls = CarControls();
		arena->Step(30);
		for (int n : pattern) {
			car->controls.jump = n > 0;
			arena->Step(abs(n));
		}
		car->controls.jump = false;
		return car->GetState();
	};
	// (the wheels still touch for a few ticks after a short jump: RocketSim jumped again)
	CHECK(SameMotion(run({ 3, -21 }), run({ 3, -1, 20 })), "a second press with the wheels still down jumped again");
	CHECK(SameMotion(run({ 1, -21 }), run({ 1, -1, 20 })), "a press after a release extended the jump");
	CarState again = run({ 3, -150, 3 });
	CHECK(again.vel.z > 200, "after landing a press should jump again (vz %.1f)", again.vel.z);
}

static void TestDodgeDirectionNormalised(Arena* arena, Car* car) {
	puts("dodge impulse: the direction normalised, then components of 0.1 or less zeroed (yaw 0.95 + roll -1 dodges sideways)");
	CarControls c; c.yaw = 0.95f; c.roll = -1;
	FlipAngVels(arena, car, c, [](CarControls&, int) {}, 0);
	CarState s = car->GetState();
	CHECK(car->_internalState.isFlipping && fabsf(s.vel.Dot(s.rotMat.right)) > 400,
		"expected a full side dodge (sideways %.1f uu/s)", s.vel.Dot(s.rotMat.right));
}

static void TestAirThrottleBoostLag(Arena* arena, Car* car) {
	puts("air throttle: follows the boost state of the tick before (AirControl runs before Boost)");
	CarState s = CarAt({ 0, 0, 1500 }, { 1, 0, 0 }, { 0, 0, 1 });
	s.boost = 100;
	car->SetState(s);
	car->controls = CarControls();
	arena->Step(2);
	auto accel = [&](bool boost) {
		float v0 = car->GetState().vel.x;
		car->controls.boost = boost;
		arena->Step();
		return (car->GetState().vel.x - v0) * 120;
	};
	float press = accel(true), held = accel(true);
	for (int i = 0; i < 20; i++) accel(true); // (past the boost's minimum time)
	float release = accel(false), after = accel(false);
	CHECK(Near(press, 2975.f / 3, 1), "press tick %.2f uu/s^2, expected 991.67 (the boost alone)", press);
	CHECK(Near(held, 3175.f / 3, 1), "held %.2f uu/s^2, expected 1058.33", held);
	CHECK(Near(release, 200.f / 3, 1), "release tick %.2f uu/s^2, expected 66.67 (the air throttle alone)", release);
	CHECK(Near(after, 0, 0.5f), "after the release %.2f uu/s^2, expected 0", after);
	car->controls.boost = false;
}

static void TestFlipResetCounter(Arena* arena, Car* car) {
	puts("flip reset counter: a landing after a jump with 3+ wheels, at most one on world geometry (DodgesRefreshedCounter)");
	BallState b;
	b.pos = { 0, 0, 92.75f };
	arena->ball->SetState(b);
	CarState s = CarAt({ 0, 0, 92.75f * 2 + 40 }, { 1, 0, 0 }, { 0, 0, 1 });
	s.hasJumped = true;
	s.isOnGround = false;
	car->SetState(s);
	car->controls = CarControls();
	for (int i = 0; i < 60 && car->GetState().flipResets == 0; i++)
		arena->Step();
	CHECK(car->GetState().flipResets == 1, "landing on the ball after a jump: %d flip resets, expected 1", car->GetState().flipResets);
	// The floor gives the jump back too, but isn't a flip reset
	s = CarAt({ 0, -2000, 60 }, { 1, 0, 0 }, { 0, 0, 1 });
	s.hasJumped = true;
	s.isOnGround = false;
	car->SetState(s);
	arena->Step(60);
	CHECK(car->GetState().isOnGround && car->GetState().flipResets == 0, "landing on the floor: %d flip resets, expected 0",
		car->GetState().flipResets);
	arena->ball->SetState(BallState());
}

// --------------------------------------------------------------------------------------------
struct BumpLog { int bumps = 0, demos = 0; };

static BumpLog RunImpact(Arena* arena, Car* attacker, Car* victim, CarState a, CarState v, int ticks, float* victimMaxVz = nullptr) {
	BumpLog log;
	arena->SetCarBumpCallback([](Arena*, Car*, Car*, bool isDemo, void* info) {
		auto* l = (BumpLog*)info;
		(isDemo ? l->demos : l->bumps)++;
	}, &log);
	// Mark the attacker supersonic if it is fast (the state flag is updated after a tick)
	a.isSupersonic = a.vel.Length() >= RLConst::SUPERSONIC_START_SPEED;
	attacker->SetState(a);
	victim->SetState(v);
	attacker->controls = victim->controls = CarControls();
	float maxVz = 0;
	for (int i = 0; i < ticks && !log.demos; i++) {
		arena->Step();
		maxVz = RS_MAX(maxVz, victim->GetState().vel.z);
	}
	if (victimMaxVz)
		*victimMaxVz = maxVz;
	arena->SetCarBumpCallback(nullptr);
	return log;
}

static void TestBumpCone(Arena* arena, Car* attacker, Car* victim) {
	puts("bumps: forward cone (yaw 70, pitch 36.87) instead of a contact-point distance");
	float vz;
	// Head-on into the side of a stationary car
	auto log = RunImpact(arena, attacker, victim,
		CarAt({ 0, 0, 17 }, { 1, 0, 0 }, { 0, 0, 1 }, { 1500, 0, 0 }),
		CarAt({ 250, 0, 17 }, { 0, 1, 0 }, { 0, 0, 1 }), 30, &vz);
	CHECK(log.bumps >= 1, "no bump");
	CHECK(vz > 150, "bumper hit gave no upward push (victim max vz %.1f)", vz);

	// Sliding sideways into a car beside us: inside the old 64.5 check's reach, outside the 70 deg cone
	log = RunImpact(arena, attacker, victim,
		CarAt({ 0, 0, 17 }, { 1, 0, 0 }, { 0, 0, 1 }, { 100, 1400, 0 }),
		CarAt({ 20, 130, 17 }, { 1, 0, 0 }, { 0, 0, 1 }), 30, &vz);
	CHECK(log.bumps >= 1, "side contact should still count as a (zero-push) bump");
	CHECK(vz < 60, "side contact pushed the victim up (max vz %.1f)", vz);
}

static void TestDemoBothWays(Arena* arena, Car* attacker, Car* victim) {
	puts("demos: the victim's own impact still counts that tick (mutual head-on demos; the victim bumps its attacker)");
	// Both supersonic, head-on (live ga_carcar L3: both demolished in the same tick)
	BumpLog log = RunImpact(arena, attacker, victim,
		CarAt({ 0, -300, 17 }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 2250, 0 }),
		[] { CarState v = CarAt({ 0, 300, 17 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, -2250, 0 }); v.isSupersonic = true; return v; }(), 30);
	CHECK(log.demos == 2 && attacker->GetState().isDemoed && victim->GetState().isDemoed,
		"mutual head-on: demos %d, attacker demoed %d, victim demoed %d", log.demos, (int)attacker->GetState().isDemoed,
		(int)victim->GetState().isDemoed);
	arena->Step(4 * 120);
	// A slower victim driving at its attacker (live ga_carcar L2): the victim is demolished and bumps the attacker
	log = RunImpact(arena, attacker, victim,
		CarAt({ 0, -300, 17 }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 2250, 0 }),
		CarAt({ 0, 300, 17 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, -1000, 0 }), 30);
	CHECK(log.demos == 1 && log.bumps == 1 && victim->GetState().isDemoed && !attacker->GetState().isDemoed,
		"slower victim: demos %d bumps %d", log.demos, log.bumps);
	arena->Step(4 * 120);
}

static void TestBumpCooldown(Arena* arena, Car* car, Car* other) {
	puts("bump cooldown: over strictly after 0.25 s (a repeat bump 30 ticks later is still blocked, 31 is not)");
	CarState s = CarAt({ 0, -2000, 17 }, { 0, 1, 0 }, { 0, 0, 1 });
	s.carContact.otherCarID = other->id;
	s.carContact.cooldownTimer = RLConst::BUMP_COOLDOWN_TIME; // (as set on a bump)
	car->SetState(s);
	other->SetState(CarAt({ 0, 2000, 17 }, { 0, 1, 0 }, { 0, 0, 1 }));
	car->controls = other->controls = CarControls();
	arena->Step(30);
	float t30 = car->GetState().carContact.cooldownTimer;
	CHECK(t30 > -RLConst::BUMP_COOLDOWN_EPSILON, "30 ticks after a bump the cooldown should still run (timer %g)", t30);
	arena->Step(1);
	float t31 = car->GetState().carContact.cooldownTimer;
	CHECK(t31 <= -RLConst::BUMP_COOLDOWN_EPSILON, "31 ticks after a bump the cooldown should be over (timer %g)", t31);
}

static void TestDemos(Arena* arena, Car* attacker, Car* victim) {
	puts("demos: supersonic, |forward speed| >= 2100, inside the 45.57 deg cone; backwards allowed");
	auto log = RunImpact(arena, attacker, victim,
		CarAt({ 0, 0, 17 }, { 1, 0, 0 }, { 0, 0, 1 }, { 2250, 0, 0 }),
		CarAt({ 300, 0, 17 }, { 0, 1, 0 }, { 0, 0, 1 }), 30);
	CHECK(log.demos == 1, "straight supersonic hit should demo (demos %d bumps %d)", log.demos, log.bumps);
	arena->Step(4 * 120); // respawn

	// Supersonic, but sliding 25 deg off the nose: forward speed 2039 < 2100
	Vec vel = Vec(cosf(25 * DEG), sinf(25 * DEG), 0) * 2250;
	log = RunImpact(arena, attacker, victim,
		CarAt({ 0, 0, 17 }, { 1, 0, 0 }, { 0, 0, 1 }, vel),
		CarAt(vel.Normalized() * 300 + Vec(0, 0, 17), { 0, 1, 0 }, { 0, 0, 1 }), 30);
	CHECK(log.demos == 0 && log.bumps >= 1, "sliding hit should bump, not demo (demos %d bumps %d)", log.demos, log.bumps);
	arena->Step(4 * 120);

	// Driving backwards at supersonic speed into a car behind us
	log = RunImpact(arena, attacker, victim,
		CarAt({ 0, 0, 17 }, { -1, 0, 0 }, { 0, 0, 1 }, { 2250, 0, 0 }),
		CarAt({ 300, 0, 17 }, { 0, 1, 0 }, { 0, 0, 1 }), 30);
	CHECK(log.demos == 1, "backwards supersonic hit should demo (demos %d bumps %d)", log.demos, log.bumps);
	arena->Step(4 * 120);

	// Same team: never a demo
	victim->team = attacker->team;
	log = RunImpact(arena, attacker, victim,
		CarAt({ 0, 0, 17 }, { 1, 0, 0 }, { 0, 0, 1 }, { 2250, 0, 0 }),
		CarAt({ 300, 0, 17 }, { 0, 1, 0 }, { 0, 0, 1 }), 30);
	CHECK(log.demos == 0, "team demo");
	victim->team = RS_OPPOSITE_TEAM(attacker->team);
	arena->Step(4 * 120);

	// The demo cone is tested at the time of impact (ShouldDemolish sweeps both cars): the victim, side-on, moves away
	// sideways. At the start of the tick its hitbox centre is 48 deg off the attacker's nose (a bump with the
	// start-of-tick states); at the impact, a fraction of a tick earlier, about 39 deg (a demo).
	CarState a = CarAt({ 0, 0, 17 }, { 1, 0, 0 }, { 0, 0, 1 }, { 2300, 0, 0 });
	CarState v = CarAt({ 98.3f, 81.1f, 17 }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 1500, 0 });
	const Vec& off = attacker->config.hitboxPosOffset;
	Vec dir = (v.pos + Vec(-off.y, off.x, off.z)) - (a.pos + off);
	float startYaw = atan2f(dir.y, dir.x) / DEG;
	CHECK(startYaw > RLConst::DEMO_CONE_YAW_DEG, "start-of-tick yaw %.1f deg should be outside the demo cone", startYaw);
	log = RunImpact(arena, attacker, victim, a, v, 2);
	CHECK(log.demos == 1, "hit inside the cone at the time of impact should demo (demos %d bumps %d)", log.demos, log.bumps);
	arena->Step(4 * 120);
}

// Boost pads: the car's collision cylinder (r 48, half-height 32) overlapping the pad's (small r 128, big r 160,
// half-height 64): origin within 176 / 208 horizontally and 96 vertically
static void TestSpawnCount() {
	puts("spawn counters: adding a car, a kickoff reset, a respawn and a ball reset are new placements (clients don't smooth them)");
	using namespace RLConst;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	CHECK(car->GetState().spawnCount == 1 && arena->ball->GetState().spawnCount == 0, "a new arena and car: car %d, ball %d, expected 1 and 0",
		car->GetState().spawnCount, arena->ball->GetState().spawnCount);
	arena->ResetToRandomKickoff(7);
	CHECK(car->GetState().spawnCount == 2 && arena->ball->GetState().spawnCount == 1, "a kickoff reset: car %d, ball %d, expected 2 and 1",
		car->GetState().spawnCount, arena->ball->GetState().spawnCount);
	arena->Step(10);
	car->Demolish();
	arena->Step((int)(DEMO_RESPAWN_TIME * 120) + 5);
	CHECK(!car->GetState().isDemoed && car->GetState().spawnCount == 3, "a respawn: car %d, expected 3", car->GetState().spawnCount);
	// Ticking and a clone keep it (a state set from outside the engine chooses its own)
	Arena* clone = arena->Clone(false);
	CHECK(clone->GetCar(car->id)->GetState().spawnCount == 3 && clone->ball->GetState().spawnCount == 1,
		"a clone: car %d, ball %d, expected 3 and 1", clone->GetCar(car->id)->GetState().spawnCount, clone->ball->GetState().spawnCount);
	delete clone;
	delete arena;
}

// The kickoff spot (blue's frame) a car stands on, or -1
static int KickoffSpotOf(Car* car) {
	using namespace RLConst;
	Vec p = car->GetState().pos;
	if (car->team == Team::ORANGE)
		p = { -p.x, -p.y, p.z };
	for (int i = 0; i < CAR_SPAWN_LOCATION_AMOUNT; i++)
		if (std::fabs(p.x - CAR_SPAWN_LOCATIONS_SOCCAR[i].x) < 0.01f && std::fabs(p.y - CAR_SPAWN_LOCATIONS_SOCCAR[i].y) < 0.01f)
			return i;
	return -1;
}

static void TestKickoffSequence() {
	puts("kickoff sequence: one order per match, +1 per kickoff, orange mirrored, teammates on consecutive spots (MR-4)");
	using namespace RLConst;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* blue[2] = { arena->AddCar(Team::BLUE), arena->AddCar(Team::BLUE) };
	Car* orange[2] = { arena->AddCar(Team::ORANGE), arena->AddCar(Team::ORANGE) };
	arena->StartKickoffSequence(12345);
	std::array<uint8_t, 5> order = arena->kickoffSequence.order[0];
	int seen[5] = {};
	for (int i = 0; i < CAR_SPAWN_LOCATION_AMOUNT; i++)
		seen[order[i]]++;
	CHECK(seen[0] == 1 && seen[1] == 1 && seen[2] == 1 && seen[3] == 1 && seen[4] == 1, "the order isn't a permutation");
	for (int n = 0; n < 7; n++) {
		arena->ResetToNextKickoff();
		for (int k = 0; k < 2; k++) {
			int want = order[(n + k) % 5];
			CHECK(KickoffSpotOf(blue[k]) == want && KickoffSpotOf(orange[k]) == want,
				"kickoff %d, car %d of each team: spots %d and %d, expected %d", n, k, KickoffSpotOf(blue[k]), KickoffSpotOf(orange[k]), want);
		}
		if (n == 2) { // a snapshot carries the sequence on
			DataStreamOut out;
			arena->Serialize(out);
			DataStreamIn in;
			in.data = out.data;
			Arena* copy = Arena::DeserializeNew(in);
			copy->ResetToNextKickoff();
			arena->ResetToNextKickoff();
			n++;
			bool same = true;
			for (Car* c : arena->GetCars())
				same &= KickoffSpotOf(c) == KickoffSpotOf(copy->GetCar(c->id));
			CHECK(same, "a restored snapshot's next kickoff differs");
			delete copy;
		}
	}
	// A car joining in the countdown: the kickoff again, the others where they were, the new car on the next spot
	{
		int before[2] = { KickoffSpotOf(blue[0]), KickoffSpotOf(blue[1]) };
		int next = arena->kickoffSequence.next;
		Car* late = arena->AddCar(Team::BLUE);
		arena->RedoKickoff();
		int n = (next + 4) % 5; // (the current kickoff's index)
		CHECK(KickoffSpotOf(blue[0]) == before[0] && KickoffSpotOf(blue[1]) == before[1] && KickoffSpotOf(late) == order[(n + 2) % 5]
			&& arena->kickoffSequence.next == next, "redo: cars on %d %d %d, expected %d %d %d", KickoffSpotOf(blue[0]),
			KickoffSpotOf(blue[1]), KickoffSpotOf(late), before[0], before[1], order[(n + 2) % 5]);
		arena->RemoveCar(late);
	}
	// Another seed, another order (the shuffle uses the seed)
	arena->StartKickoffSequence(54321);
	CHECK(arena->kickoffSequence.order[0] != order || arena->kickoffSequence.order[1] != order, "seeds 12345 and 54321 gave one order");
	delete arena;
}

static void TestFreeplayKickoff() {
	puts("freeplay's new round: S[k mod 10] over the session's shuffled spots, blue's then the mirror; ball at 100.49");
	using namespace RLConst;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	// The session's order: StartKickoffSequence shuffles the same way from the same seed
	arena->StartKickoffSequence(777);
	std::array<uint8_t, 5> order = arena->kickoffSequence.order[0];
	for (int k = 0; k < 12; k++) {
		arena->ResetToFreeplayKickoff(777, k);
		Vec p = car->GetState().pos;
		bool mirrored = k % 2 == 1;
		// (KickoffSpotOf mirrors orange's: the car is blue, so mirror the odd ones by hand)
		Vec own = mirrored ? Vec(-p.x, -p.y, p.z) : p;
		int spot = -1;
		for (int i = 0; i < CAR_SPAWN_LOCATION_AMOUNT; i++)
			if (std::fabs(own.x - CAR_SPAWN_LOCATIONS_SOCCAR[i].x) < 0.01f && std::fabs(own.y - CAR_SPAWN_LOCATIONS_SOCCAR[i].y) < 0.01f)
				spot = i;
		CHECK(spot == order[(k % 10) / 2], "reset %d: spot %d, expected %d", k, spot, order[(k % 10) / 2]);
		CHECK((p.y < 0) == !mirrored, "reset %d: y %.1f on the wrong half", k, p.y);
		float yaw = Angle::FromRotMat(car->GetState().rotMat).yaw;
		float want = CAR_SPAWN_LOCATIONS_SOCCAR[order[(k % 10) / 2]].yawAng + (mirrored ? (float)M_PI : 0.f);
		CHECK(Near(std::remainder(yaw - want, 2 * (float)M_PI), 0, 1e-4f), "reset %d: yaw %.4f, expected %.4f", k, yaw, want);
	}
	BallState b = arena->ball->GetState();
	CHECK(Near(b.pos.z, BALL_SPAWN_Z, 1e-3f) && b.pos.x == 0 && b.pos.y == 0 && b.vel.IsZero(), "ball at (%g, %g, %g)", b.pos.x, b.pos.y, b.pos.z);
	// Pads: taken, then back with the reset
	arena->GetBoostPads()[0]->SetState({ false, 4.f });
	arena->ResetToFreeplayKickoff(777, 0);
	CHECK(arena->GetBoostPads()[0]->GetState().isActive, "a taken pad stays taken through the reset");
	arena->GetBoostPads()[0]->SetState({ false, 4.f });
	arena->ResetBoostPads();
	CHECK(arena->GetBoostPads()[0]->GetState().isActive, "ResetBoostPads leaves a pad taken");
	delete arena;
}

static void TestNoPickupAtFullBoost() {
	puts("pads: a car at full boost leaves a pad (CanPickup: !IsFull; RocketSim's BoostPadGrid gate); below it takes it");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	arena->ball->SetState(BallState());
	BoostPad* pad = arena->GetBoostPads()[0];
	auto onPad = [&](float boost) {
		pad->SetState(BoostPadState());
		CarState s = CarAt(Vec(pad->config.pos.x, pad->config.pos.y, 17.01f), Vec(1, 0, 0), Vec(0, 0, 1));
		s.boost = boost;
		car->SetState(s);
		arena->Step(2);
	};
	onPad(100);
	CHECK(pad->GetState().isActive && car->GetState().boost == 100, "at 100: the pad was taken (active %d)", pad->GetState().isActive);
	onPad(99.9f);
	CHECK(!pad->GetState().isActive && car->GetState().boost == 100, "at 99.9: the pad is still there (active %d, boost %g)", pad->GetState().isActive, car->GetState().boost);
	delete arena;
}

// A car added after the ball moved alone still collides with it (the broadphase patch): the ball placed away from the
// centre in an arena without cars, left to rest, then a car driven into it
static void TestLateCarMeetsBall() {
	puts("a car added after the ball moved alone collides with it (broadphase registration patch)");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	BallState bs;
	bs.pos = { 2000, 1000, 93.15f };
	arena->ball->SetState(bs);
	arena->Step(120);
	Car* car = arena->AddCar(Team::BLUE);
	car->SetState(CarAt({ 1600, 1000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }, { 1500, 0, 0 }));
	arena->Step(40);
	CHECK(arena->ball->GetState().vel.x > 1000, "the ball wasn't hit: vx %.1f, the car at x %.1f", arena->ball->GetState().vel.x, car->GetState().pos.x);
	delete arena;
}

// The ball's own impacts (notes/impact-triggers.md §2b, RV-172): dropped on the floor, a world impact at its speed
// before the step, its normal up; resting, none; with a car, the car's event only
static void TestBallImpacts() {
	puts("the ball's impacts (RV-172): with the world its own, at |vz| before the step; with a car the car's only");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	arena->collectImpacts = true;
	BallState bs;
	bs.pos = { 2000, 1000, 600 };
	bs.vel = { 0, 0, -1500 };
	arena->ball->SetState(bs);
	const Arena::ImpactEvent* hit = nullptr;
	float vzBefore = 0;
	for (int t = 0; t < 60 && !hit; t++) {
		arena->impacts.clear();
		vzBefore = arena->ball->GetState().vel.z;
		arena->Step(1);
		for (const auto& e : arena->impacts)
			if (e.carId == Arena::IMPACT_BALL)
				hit = &e;
	}
	CHECK(hit != nullptr, "no ball impact");
	if (hit) {
		CHECK(hit->partnerKind == 0, "partner %d", hit->partnerKind);
		CHECK(hit->normal.z > 0.99f, "normal %g %g %g", hit->normal.x, hit->normal.y, hit->normal.z);
		// (its velocity as the solver's setup reads it: before the step's forces, after its drag, which Bullet applies
		// first, the game's 2.82 as here)
		float damped = fabsf(vzBefore) * powf(1 - arena->ball->_rigidBody.getLinearDamping(), 1 / 120.f);
		CHECK(Near(hit->speed, damped, 0.01f), "speed %.4f vs %.4f", hit->speed, damped);
	}
	// (at rest on the floor: none)
	bs.pos = { 2000, 1000, 93.15f };
	bs.vel = {};
	arena->ball->SetState(bs);
	for (int t = 0; t < 120; t++)
		arena->Step(1);
	arena->impacts.clear();
	arena->Step(30);
	int resting = 0;
	for (const auto& e : arena->impacts)
		if (e.carId == Arena::IMPACT_BALL)
			resting++;
	CHECK(resting == 0, "a resting ball gave %d", resting);
	// (a car driving into it: the car's ball impact, no ball event)
	Car* car = arena->AddCar(Team::BLUE);
	car->SetState(CarAt({ 1600, 1000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }, { 1500, 0, 0 }));
	int carSide = 0, ballSide = 0;
	for (int t = 0; t < 40; t++) {
		arena->impacts.clear();
		arena->Step(1);
		for (const auto& e : arena->impacts) {
			if (e.carId == car->id && e.partnerKind == 1)
				carSide++;
			if (e.carId == Arena::IMPACT_BALL && e.partnerKind != 0)
				ballSide++;
		}
	}
	CHECK(carSide > 0, "no car-ball impact");
	CHECK(ballSide == 0, "ball-side events with a car or ball: %d", ballSide);
	delete arena;
}

// The impacts' filters (RV-165, RV-175): a car driving into the ball gives a ball impact; none when the ball's body is
// disabled (as a sleeping one: Bullet's DISABLE_SIMULATION never wakes) or has no contact response
static void TestImpactFilters() {
	puts("impacts' filters (RV-165): a disabled body or one without contact response gives no event");
	auto ballHits = [](int mode) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		arena->collectImpacts = true;
		Car* car = arena->AddCar(Team::BLUE);
		car->SetState(CarAt({ 0, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }, { 1500, 0, 0 }));
		BallState bs;
		bs.pos = { 250, 0, 93.15f };
		arena->ball->SetState(bs);
		btRigidBody& body = arena->ball->_rigidBody;
		if (mode == 1)
			body.forceActivationState(DISABLE_SIMULATION);
		if (mode == 2)
			body.setCollisionFlags(body.getCollisionFlags() | btCollisionObject::CF_NO_CONTACT_RESPONSE);
		int hits = 0, before = 0;
		for (int t = 0; t < 30; t++) {
			arena->Step(1);
			for (const auto& e : arena->impacts)
				if (e.carId == car->id && e.partnerKind == 1)
					hits++;
			arena->impacts.clear();
			// (mode 3: the flag set once they touch, where a persisting point would keep its last setup's velocities; here
			// they part within a tick, so it gives none with or without the filter: RV-211a, a limit)
			if (mode == 3 && hits > 0 && before == 0) {
				before = hits;
				body.setCollisionFlags(body.getCollisionFlags() | btCollisionObject::CF_NO_CONTACT_RESPONSE);
			}
		}
		delete arena;
		return hits - before;
	};
	CHECK(ballHits(0) > 0, "no ball impact from a car driving into it");
	CHECK(ballHits(1) == 0, "a disabled ball gave %d", ballHits(1));
	// (without contact response there's no solver contact, so no point velocities either: none with or without that
	// filter)
	CHECK(ballHits(2) == 0, "a ball without contact response gave %d", ballHits(2));
	// (losing its response while in contact: the car's and the ball's points part within a tick here, a regression check)
	CHECK(ballHits(3) == 0, "a ball losing its contact response mid-contact gave %d more", ballHits(3));
	// (a ball sliding without spin on the floor, solved a few ticks, then losing its response between ticks: with it, a
	// slide of about 980 every tick; without, none. A regression check only: it gives none with or without the response
	// filter, as the car and ball above do (no persisting point reaches the scan with its last setup's velocities here),
	// so the filter stays a limit of these tests, RV-211a; the game's own case, the exploded ball, the disabled filter
	// catches too)
	auto slides = [](bool noResponse) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		arena->collectImpacts = true;
		BallState bs;
		bs.pos = { 0, 0, 92.75f };
		bs.vel = { 1000, 0, 0 };
		arena->ball->SetState(bs);
		arena->Step(3);
		btRigidBody& body = arena->ball->_rigidBody;
		if (noResponse)
			body.setCollisionFlags(body.getCollisionFlags() | btCollisionObject::CF_NO_CONTACT_RESPONSE);
		int events = 0;
		for (int t = 0; t < 5; t++) {
			arena->impacts.clear();
			arena->Step(1);
			for (const auto& e : arena->impacts)
				if (e.carId == Arena::IMPACT_BALL && e.partnerKind == 0 && e.slide >= 50)
					events++;
		}
		delete arena;
		return events;
	};
	CHECK(slides(true) == 0, "a sliding ball without response gave %d slide events", slides(true));
}

static void TestImpactSurfaceNormal() {
	puts("impacts against the static world: the normal and point are the surface's (the line check), not the contacts' average (RV-221)");
	// A car on its roof sliding up the goal's faceted back ramp: its contacts span facets, whose average is no facet's
	// normal. Each event's normal must be the surface's at its point (a ray through it along the normal: the same face)
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	arena->collectImpacts = true;
	Car* car = arena->AddCar(Team::BLUE);
	BallState far; far.pos = Vec(3000, -2000, 92.75f); arena->ball->SetState(far);
	car->SetState(CarAt({ 0, 5500, 60 }, { 0, -1, 0 }, { 0, 0, -1 }, { 0, 800, 0 }));
	int events = 0, onRamp = 0, missed = 0;
	float worst = 0;
	for (int t = 0; t < 120; t++) {
		arena->impacts.clear();
		arena->Step(1);
		for (const auto& e : arena->impacts) {
			if (e.carId != car->id || e.partnerKind != 0)
				continue;
			btVector3 n = (btVector3)e.normal, at = (btVector3)(e.pos * UU_TO_BT);
			btVector3 from = at + n * (10 * UU_TO_BT), to = at - n * (10 * UU_TO_BT);
			btCollisionWorld::ClosestRayResultCallback ray(from, to, &car->_rigidBody);
			arena->_bulletWorld.rayTest(from, to, ray);
			if (ray.hasHit())
				worst = RS_MAX(worst, (ray.m_hitNormalWorld.normalized() - n).length());
			else
				missed++;
			events++;
			if (abs(e.normal.y) > 0.2f)
				onRamp++;
		}
	}
	CHECK(events > 50 && onRamp > 10, "%d events, %d on the ramp: expected the slide up it", events, onRamp);
	// (the contacts' averaged normal, without the line check: 0.096 from the face under it here)
	CHECK(missed == 0 && worst < 1e-4f, "an event's normal is %.4f from the surface's at its point; %d with no surface", worst, missed);
	delete arena;
}

static void TestImpacts() {
	puts("impacts (IT-1..3): a ball into a resting car, a car onto its roof: the speed along the averaged normal and the partner; resting contact none");
	{
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		arena->collectImpacts = true;
		Car* car = arena->AddCar(Team::BLUE);
		car->SetState(CarAt({ 0, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		BallState bs;
		bs.pos = { 300, 0, 93.15f };
		bs.vel = { -2000, 0, 0 };
		arena->ball->SetState(bs);
		const Arena::ImpactEvent* hit = nullptr;
		for (int t = 0; t < 30 && !hit; t++) {
			arena->Step(1);
			for (const auto& e : arena->impacts)
				if (e.carId == car->id && e.partnerKind == 1)
					hit = &e;
		}
		CHECK(hit != nullptr, "no ball impact");
		if (hit) {
			// (the ball meets the nose's top edge: its normal tilted up, the speed 2000 times its x part)
			CHECK(hit->normal.x < -0.85f, "normal %g %g %g", hit->normal.x, hit->normal.y, hit->normal.z);
			CHECK(Near(hit->speed, 2000 * -hit->normal.x, 60), "speed %g (normal x %g)", hit->speed, hit->normal.x);
		}
		delete arena;
	}
	{
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		arena->collectImpacts = true;
		Car* car = arena->AddCar(Team::BLUE);
		arena->ball->SetState(BallState());
		car->SetState(CarAt({ 1000, 1000, 120 }, { 1, 0, 0 }, { 0, 0, -1 }, { 0, 0, -1500 }));
		const Arena::ImpactEvent* hit = nullptr;
		float vzBefore = 0;
		for (int t = 0; t < 30 && !hit; t++) {
			arena->impacts.clear();
			vzBefore = car->GetState().vel.z;
			arena->Step(1);
			// (the car's: the ball's own world events share the partner kind, RV-211)
			for (const auto& e : arena->impacts)
				if (e.carId == car->id && e.partnerKind == 0)
					hit = &e;
		}
		CHECK(hit != nullptr, "no world impact");
		// (the approach speed before this step's forces, as the game's setup reads it: RV-170)
		if (hit)
			CHECK(Near(hit->speed, fabsf(vzBefore), 0.01f), "speed %.4f vs %.4f", hit->speed, fabsf(vzBefore));
		if (hit) {
			CHECK(hit->normal.z > 0.95f, "normal %g %g %g", hit->normal.x, hit->normal.y, hit->normal.z);
			CHECK(hit->speed > 1450 && hit->speed < 1600, "speed %g", hit->speed);
		}
		// (resting on its roof: nothing 50 uu/s or more)
		arena->Step(240);
		arena->impacts.clear();
		arena->Step(120);
		size_t resting = 0;
		for (const auto& e : arena->impacts)
			resting += e.carId == car->id && e.partnerKind == 0;
		CHECK(resting == 0, "%zu impacts resting", resting);
		// (sliding on its roof at 1000 uu/s: little along the normal, the slide across it kept: RV-164)
		arena->collectImpacts = true;
		CarState sliding = car->GetState();
		sliding.vel = { 1000, 0, 0 };
		sliding.angVel = {};
		car->SetState(sliding);
		arena->impacts.clear();
		arena->Step(2);
		bool slid = false;
		for (const auto& e : arena->impacts)
			slid |= e.carId == car->id && e.partnerKind == 0 && e.speed < 50 && e.slide > 900 && e.slide < 1050;
		CHECK(slid, "no slide entry (%zu impacts)", arena->impacts.size());
		// (off, the default: nothing kept)
		arena->impacts.clear();
		arena->collectImpacts = false;
		car->SetState(CarAt({ 1000, 1000, 120 }, { 1, 0, 0 }, { 0, 0, -1 }, { 0, 0, -1500 }));
		arena->Step(30);
		CHECK(arena->impacts.empty(), "%zu impacts collected while off", arena->impacts.size());
		delete arena;
	}
	{
		// A car's corner into another's side, the first turned 45 degrees: no line check against a car (its collision
		// component is its skeletal mesh: RV-215), so the struck car's normal is the contacts' averaged one, its side's,
		// and the two cars' events agree: the same speed, opposite normals (a ray met the corner's turned face)
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		arena->collectImpacts = true;
		arena->SetMutatorConfig([&] { MutatorConfig m = arena->GetMutatorConfig(); m.demoMode = DemoMode::DISABLED; return m; }());
		Car* a = arena->AddCar(Team::BLUE);
		Car* b = arena->AddCar(Team::ORANGE);
		arena->ball->SetState(BallState());
		float c45 = cosf(45 * DEG);
		// (in the air, clear of the tyres' grip)
		a->SetState(CarAt({ 0, -400, 600 }, { c45, c45, 0 }, { 0, 0, 1 }, { 0, 1200, 0 }));
		b->SetState(CarAt({ 0, 0, 600 }, { 1, 0, 0 }, { 0, 0, 1 }));
		const Arena::ImpactEvent *struck = nullptr, *striking = nullptr;
		for (int t = 0; t < 60 && !struck; t++) {
			arena->impacts.clear();
			arena->Step(1);
			for (const auto& e : arena->impacts) {
				if (e.carId == b->id && e.partnerKind == 2)
					struck = &e;
				if (e.carId == a->id && e.partnerKind == 2)
					striking = &e;
			}
		}
		CHECK(struck != nullptr && striking != nullptr, "no car-car impact (struck %d, striking %d)", struck != nullptr, striking != nullptr);
		if (struck && striking) {
			CHECK(struck->partnerId == a->id, "partner %u", struck->partnerId);
			CHECK(fabsf(struck->normal.y) > 0.99f, "normal %g %g %g: expected the side's own", struck->normal.x, struck->normal.y, struck->normal.z);
			CHECK(fabsf(struck->speed - striking->speed) < 1e-3f * RS_MAX(1.f, struck->speed), "speeds %.4f vs %.4f", struck->speed, striking->speed);
			CHECK(struck->normal.Dot(striking->normal) < -0.9999f, "normals not opposite (dot %.6f)", struck->normal.Dot(striking->normal));
		}
		delete arena;
	}
	{
		// The normal from the contacts' sum: none when they cancel (RV-166)
		btVector3 n;
		CHECK(!Arena::_ImpactNormal(btVector3(0, 0, 1e-5f), n), "a near-zero sum gave a normal");
		CHECK(Arena::_ImpactNormal(btVector3(0, 0, 3), n) && Near(n.z(), 1, 1e-6f), "the sum's direction");
	}
}

static void TestKickoffUnevenTeams() {
	puts("kickoff with uneven teams: the short team's last car takes the most central of the full team's spots (MR-5)");
	using namespace RLConst;
	// distance from the centre, then x*y < 0 (SortPreferableSpawn)
	auto rank = [](int spot) {
		const CarSpawnPos& p = CAR_SPAWN_LOCATIONS_SOCCAR[spot];
		return (double)(p.x * p.x + p.y * p.y) + (p.x * p.y < 0 ? 0 : 0.5);
	};
	{ // By hand: 3v1, order (back centre, left diagonal, right diagonal, ...): the short team's window holds both
	  // diagonals (equally central), and the one with x*y < 0, (2048, -2560) in its own frame, wins
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		for (int i = 0; i < 3; i++)
			arena->AddCar(Team::BLUE);
		Car* alone = arena->AddCar(Team::ORANGE);
		arena->kickoffSequence.order[0] = arena->kickoffSequence.order[1] = { 4, 0, 1, 2, 3 };
		arena->kickoffSequence.kickoffs = 1;
		arena->ResetToNextKickoff();
		Vec p = alone->GetState().pos;
		CHECK(std::fabs(p.x + 2048) < 0.01f && std::fabs(p.y - 2560) < 0.01f, "3v1: the lone car at (%.0f, %.0f), expected (-2048, 2560)", p.x, p.y);
		arena->kickoffSequence.kickoffs = 0; // (at the match's first kickoff: no adjustment)
		arena->kickoffSequence.order[1] = { 4, 0, 1, 2, 3 };
		arena->kickoffSequence.next = 0;
		arena->ResetToNextKickoff();
		CHECK(KickoffSpotOf(alone) == 4, "3v1 at the first kickoff: the lone car on spot %d, expected 4 (back centre)", KickoffSpotOf(alone));
		delete arena;
	}
	{ // The live sitting (validation finding 48): a 1v2 exhibition, the match's order left diagonal, left off-centre,
	  // right diagonal, right off-centre, back centre; the lone car at its six kickoffs
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		Car* lone = arena->AddCar(Team::BLUE);
		arena->AddCar(Team::ORANGE);
		arena->AddCar(Team::ORANGE);
		arena->StartKickoffSequence(1, 2);
		arena->kickoffSequence.order[0] = arena->kickoffSequence.order[1] = { 0, 2, 1, 3, 4 };
		const int seen[6] = { 0, 1, 1, 3, 0, 0 }; // left diagonal, right diagonal, right diagonal, right off-centre, left diagonal x2
		for (int n = 0; n < 6; n++) {
			arena->ResetToNextKickoff();
			CHECK(KickoffSpotOf(lone) == seen[n], "1v2 kickoff %d: the lone car on spot %d, the game's %d", n + 1, KickoffSpotOf(lone), seen[n]);
		}
		delete arena;
	}
	// (the window: the match's team size, the playlist's MaxTeamSize, grown to the larger team; 0: the larger team)
	for (int teamSize : { 0, 3 })
	for (int shortSize = 1; shortSize <= 2; shortSize++) {
		for (int fullSize = shortSize + 1; fullSize <= 3; fullSize++) {
			for (int seed = 1; seed <= 20; seed++) {
				Arena* arena = Arena::Create(GameMode::SOCCAR);
				std::vector<Car*> shortTeam, fullTeam;
				for (int i = 0; i < fullSize; i++)
					fullTeam.push_back(arena->AddCar(Team::BLUE));
				for (int i = 0; i < shortSize; i++)
					shortTeam.push_back(arena->AddCar(Team::ORANGE));
				arena->StartKickoffSequence(seed, teamSize);
				int window = std::max(fullSize, teamSize);
				const std::array<uint8_t, 5> match = arena->kickoffSequence.order[1];
				const std::array<uint8_t, 5> full = arena->kickoffSequence.order[0];
				for (int n = 0; n < 6; n++) {
					arena->ResetToNextKickoff();
					std::array<uint8_t, 5> p = match; // (each kickoff from the match's order: the swap doesn't stay)
					// The full team: its order, unchanged
					for (int k = 0; k < fullSize; k++)
						CHECK(KickoffSpotOf(fullTeam[k]) == full[(n + k) % 5], "%dv%d seed %d kickoff %d: full team car %d on %d, expected %d",
							fullSize, shortSize, seed, n, k, KickoffSpotOf(fullTeam[k]), full[(n + k) % 5]);
					// The short team: from the second kickoff, the best of the window swapped into its last car's slot
					if (n > 0) {
						int best = n % 5;
						for (int k = 1; k < window; k++)
							if (rank(p[(n + k) % 5]) < rank(p[best]))
								best = (n + k) % 5;
						if ((best - n % 5 + 5) % 5 >= shortSize)
							std::swap(p[best], p[(n + shortSize - 1) % 5]);
					}
					for (int k = 0; k < shortSize; k++)
						CHECK(KickoffSpotOf(shortTeam[k]) == p[(n + k) % 5], "%dv%d seed %d kickoff %d: short team car %d on %d, expected %d",
							fullSize, shortSize, seed, n, k, KickoffSpotOf(shortTeam[k]), p[(n + k) % 5]);
				}
				delete arena;
			}
		}
	}
}

static void TestRespawnsHeld() {
	puts("respawns held: after a goal a demolished car waits for the kickoff (PostGoalScored, MR-6)");
	using namespace RLConst;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	arena->Step(10);
	car->Demolish();
	arena->respawnsHeld = true;
	arena->Step((int)(DEMO_RESPAWN_TIME * 120) + 60);
	CHECK(car->GetState().isDemoed, "held: the car respawned");
	// A snapshot keeps the hold
	DataStreamOut out;
	arena->Serialize(out);
	DataStreamIn in;
	in.data = out.data;
	Arena* copy = Arena::DeserializeNew(in);
	CHECK(copy->respawnsHeld, "a snapshot lost the hold");
	delete copy;
	// The kickoff puts it back (and drives again), and the hold off lets the next demolition respawn
	arena->StartKickoffSequence(3);
	arena->ResetToNextKickoff();
	arena->respawnsHeld = false;
	CHECK(!car->GetState().isDemoed && KickoffSpotOf(car) >= 0, "the kickoff didn't place the demolished car");
	car->controls.throttle = 1;
	Vec start = car->GetState().pos;
	arena->Step(60);
	CHECK((car->GetState().pos - start).Length() > 50, "after the kickoff the car doesn't drive");
	car->Demolish();
	arena->Step((int)(DEMO_RESPAWN_TIME * 120) + 5);
	CHECK(!car->GetState().isDemoed, "not held: no respawn");
	delete arena;
}

static void TestGoalExplosion() {
	puts("goal explosion: one push per car as the wave reaches it, away from the goal and up, 3000 uu at most (MR-6)");
	using namespace RLConst;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* near = arena->AddCar(Team::BLUE);
	Car* far = arena->AddCar(Team::BLUE);
	Car* demoed = arena->AddCar(Team::ORANGE);
	near->SetState(CarAt({ 0, 4000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	far->SetState(CarAt({ 0, 1500, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	demoed->SetState(CarAt({ 600, 4500, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	arena->Step(5);
	demoed->Demolish();
	BallState b;
	b.pos = { 0, 5250, 300 };
	b.vel = { 0, 1000, 0 };
	arena->ball->SetState(b);
	arena->Step(1);
	CHECK(arena->goalExplosion.active, "the goal didn't set off the explosion");
	// (KNB-7: where the ball was as the scoring step began, one tick short of the line)
	CHECK(arena->goalExplosion.origin.y == 5250 && arena->goalExplosion.origin.z == 300, "the explosion at (%.2f, %.2f, %.2f): expected the ball's start of the step",
		arena->goalExplosion.origin.x, arena->goalExplosion.origin.y, arena->goalExplosion.origin.z);
	int pushes = 0, pushTick = -1;
	Vec pushed, pushedAt, readBack;
	float maxMove = 0, oldSpeed = -1;
	Arena* copy = nullptr;
	for (int i = 0; i < 60; i++) {
		Vec before = near->GetState().vel;
		Vec at = near->GetState().pos;
		arena->Step(1);
		Vec dv = near->GetState().vel - before;
		maxMove = RS_MAX(maxMove, (near->GetState().pos - at).Length());
		// (the push away from the goal; the next tick's cap takes speed off along it, not a push)
		if (dv.y < -500) {
			pushes++;
			pushTick = i;
			readBack = near->GetState().vel; // (between ticks)
		}
		if (pushTick >= 0 && i == pushTick + 1) {
			pushed = near->GetState().vel;
			oldSpeed = near->_oldState.vel.Length();
		}
		if (i == 5) { // (mid-wave: a snapshot goes on the same)
			DataStreamOut out;
			arena->Serialize(out);
			DataStreamIn in;
			in.data = out.data;
			copy = Arena::DeserializeNew(in);
		}
	}
	// The front reaches the car's box (1228 uu away: KNB-9) at the end of loop step 14, 15 x 83.3 uu out
	CHECK(pushes == 1 && pushTick == 14, "%d pushes, at loop step %d (expected one, at 14)", pushes, pushTick);
	// (KNB-5: pushed between ticks, capped as the next one starts: no tick of the wave moves it more than the top speed
	// allows; pushed before a tick's physics, the push's tick moves it 39.5 uu: RV-218)
	CHECK(maxMove <= CAR_MAX_SPEED / 120 + 0.5f, "a tick of the wave moved the car %.2f uu (capped: %.2f at most)", maxMove, CAR_MAX_SPEED / 120);
	// (from 500 uu behind and below the ball, (0, 5750, -200), to the car: up about 0.12 of the push)
	CHECK(pushed.y < -1500 && pushed.z > 200 && pushed.Length() <= CAR_MAX_SPEED + 1,
		"pushed to (%.0f, %.0f, %.0f): expected away from the goal, up, capped", pushed.x, pushed.y, pushed.z);
	// (RV-231: the next frame reads the body back capped and quantised before anything sees it: read between ticks and
	// as the next tick's start-of-tick state, the push is never over the cap, 5291 uu/s raw)
	// (quantised: each component truncated to 0.01 and 0.001 out, so |v| x 100 is 0.1 past a whole number; read through
	// Bullet's units, within a float's step: 0.024 of that at 2300)
	auto quantizedAt = [](float v) { return fabsf(fmodf(fabsf(v) * 100, 1) - 0.1f) < 0.05f; };
	bool quantized = quantizedAt(readBack.x) && quantizedAt(readBack.y) && quantizedAt(readBack.z);
	CHECK(readBack.Length() <= CAR_MAX_SPEED + 0.001f && quantized && oldSpeed >= 0 && oldSpeed <= CAR_MAX_SPEED + 0.001f,
		"the push read between ticks: %.3f uu/s (%.5f, %.5f, %.5f; quantized %d), the next tick's start %.3f", readBack.Length(), readBack.x, readBack.y, readBack.z, quantized, oldSpeed);
	CHECK(far->GetState().vel.Length() < 1 && demoed->GetState().isDemoed, "the far car moved (%.1f uu/s)", far->GetState().vel.Length());
	CHECK(!arena->goalExplosion.active, "the wave should be over after 0.3 s");
	if (copy) {
		copy->Step(60 - 6);
		Vec a = arena->GetCar(near->id)->GetState().pos, c = copy->GetCar(near->id)->GetState().pos;
		CHECK(memcmp(&a, &c, sizeof(Vec)) == 0, "a snapshot taken mid-wave went on differently");
		delete copy;
	}
	delete arena;
}

static void TestGoalExplosionRespawn() {
	puts("goal explosion: a car respawning during the wave is a new car at its spawn, not pushed from where it was demolished (RV-217)");
	using namespace RLConst;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	// (demolished 1228 uu from the explosion's reach, which the wave passes at loop step 14; respawning at step 20, inside
	// the front: from its demolition spot it would be pushed in its respawn tick)
	car->SetState(CarAt({ 0, 4000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	arena->Step(5);
	car->Demolish();
	CarState s = car->GetState();
	s.demoRespawnTimer = 21.5f / 120; // (the 22nd tick on: the goal's, then loop step 20)
	car->SetState(s);
	BallState b;
	b.pos = { 0, 5250, 300 };
	b.vel = { 0, 1000, 0 };
	arena->ball->SetState(b);
	arena->Step(1);
	CHECK(arena->goalExplosion.active, "the goal didn't set off the explosion");
	float maxSpeed = 0, maxSpin = 0;
	bool respawned = false;
	for (int i = 0; i < 40; i++) {
		arena->Step(1);
		CarState now = car->GetState();
		if (!now.isDemoed) {
			respawned = true;
			maxSpeed = RS_MAX(maxSpeed, now.vel.Length());
			maxSpin = RS_MAX(maxSpin, now.angVel.Length());
		}
	}
	CHECK(respawned, "the car didn't respawn during the wave");
	CHECK(car->GetState().pos.y < 0, "respawned at y %.0f: expected its own half", car->GetState().pos.y);
	// (it settles onto the ground from its spawn height; pushed from its demolition spot, 4638 uu/s and a lever's spin)
	CHECK(maxSpeed < 300 && maxSpin < 1, "the respawned car was pushed: %.1f uu/s, %.2f rad/s", maxSpeed, maxSpin);
	delete arena;
}

static void TestGoalExplosionLocation() {
	puts("goal explosion: the push at the car's actor Location, a tick behind (a moving car spins, a resting one doesn't); its reach to that Location's cylinder box (KNB-6, KNB-9)");
	using namespace RLConst;
	// (the ball low through the goal mouth, a car side-on to it 1256 uu from the cylinder box, so the box (48, 48, 32)
	// and the hitbox are reached on different ticks)
	auto run = [](Vec carPos, Vec carVel, float yaw, int& pushTick, Vec& dAngVel) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		Car* car = arena->AddCar(Team::BLUE);
		CarState s = CarAt(carPos, { cosf(yaw), sinf(yaw), 0 }, { 0, 0, 1 });
		car->SetState(s);
		// (settled on its wheels first: a car still bouncing has a lever of its own)
		arena->Step(120);
		s = car->GetState();
		s.vel = carVel;
		car->SetState(s);
		BallState b;
		b.pos = { 0, 5250, 100 };
		b.vel = { 0, 1000, 0 };
		arena->ball->SetState(b);
		arena->Step(1);
		pushTick = -1;
		for (int i = 0; i < 40 && pushTick < 0; i++) {
			Vec v0 = car->GetState().vel, w0 = car->GetState().angVel;
			car->controls = CarControls();
			arena->Step(1);
			if ((car->GetState().vel - v0).y < -500) {
				pushTick = i;
				dAngVel = car->GetState().angVel - w0;
			}
		}
		delete arena;
	};
	int restTick = -1, moveTick = -1;
	Vec restSpin, moveSpin;
	// (yaw 90: the hitbox's 59 half length and 13.88 offset along y reach 25 uu nearer than the box's 48)
	run({ 0, 3947, 17.01f }, { 0, 0, 0 }, 1.5707964f, restTick, restSpin);
	const float box = sqrtf(1255.f * 1255.f + 51.f * 51.f);
	const int want = (int)ceilf(box / (10000.f / 120.f)) - 1; // (the radius at loop step i: (i + 1) x 83.3)
	CHECK(restTick == want, "a resting car pushed at loop step %d (the cylinder box at %.1f uu: %d)", restTick, box, want);
	// (no lever: its Location is its body's)
	CHECK(restSpin.Length() < 1e-3f, "a resting car spun by %.4f rad/s", restSpin.Length());
	// (moving 1000 uu/s across the push: its Location 8.3 uu behind, the impulse there turns it)
	run({ 0, 3947, 17.01f }, { 1000, 0, 0 }, 1.5707964f, moveTick, moveSpin);
	CHECK(moveTick >= 0 && moveSpin.Length() > 0.05f, "a moving car spun by %.4f rad/s (expected the lever's spin)", moveSpin.Length());
}

static void TestSpawnHeights() {
	puts("spawn heights and offsets per body: the reference bodies' (live: Octane 36.02, Paladin 38.84, Venom 38.94 and 5 uu ahead)");
	using namespace RLConst;
	struct { const CarConfig* config; float z, ahead; const char* name; } bodies[] = {
		{ &CAR_CONFIG_OCTANE, 36.02f, 0, "Octane" }, { &CAR_CONFIG_DOMINUS, 36.01f, 0, "Dominus" }, { &CAR_CONFIG_PLANK, 38.84f, 0, "Paladin" },
		{ &CAR_CONFIG_BREAKOUT, 36.00f, 0, "Breakout" }, { &CAR_CONFIG_HYBRID, 38.94f, 5, "Venom" }, { &CAR_CONFIG_MERC, 35.05f, 0, "Merc" } };
	for (auto& b : bodies) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		Car* car = arena->AddCar(Team::BLUE, *b.config);
		car->Demolish();
		for (int i = 0; i < 500 && car->GetState().isDemoed; i++)
			arena->Step(1);
		CarState s = car->GetState();
		// The spot: the respawn spot nearest, the car ahead of it along its forward axis by the offset
		Vec spot;
		float best = 1e9f;
		for (int i = 0; i < CAR_RESPAWN_LOCATION_AMOUNT; i++) {
			Vec p(CAR_RESPAWN_LOCATIONS_SOCCAR[i].x, CAR_RESPAWN_LOCATIONS_SOCCAR[i].y, 0);
			float d = Vec(s.pos.x - p.x, s.pos.y - p.y, 0).Length();
			if (d < best) { best = d; spot = p; }
		}
		Vec ahead = Vec(s.pos.x - spot.x, s.pos.y - spot.y, 0);
		CHECK(!s.isDemoed && abs(ahead.Dot(s.rotMat.forward) - b.ahead) < 0.05f, "%s: %.2f uu ahead of its spot, expected %.0f", b.name,
			ahead.Dot(s.rotMat.forward), b.ahead);
		// The respawn tick falls one tick from the creation height, as the game's row after the creation row (live:
		// 36.02 then 35.97 with vz -5.41 for the Octane)
		CHECK(abs(s.pos.z - (b.z - 650.f / 120 / 120)) < 0.01f && abs(s.vel.z + 650.f / 120) < 0.1f,
			"%s: z %.3f vz %.2f a tick after the respawn, expected %.3f and -5.42", b.name, s.pos.z, s.vel.z, b.z - 650.f / 120 / 120);
		delete arena;
	}
}

static void TestBallRotation() {
	puts("ball rotation: the ball turns as it moves (the game's does); the play the same as without it (noBallRot)");
	using namespace RLConst;
	// A ball spinning at the cap (6 rad/s) turns 0.5 rad in 10 ticks
	{
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		BallState b;
		b.pos = { 0, 0, 800 };
		b.angVel = { 0, 6, 0 };
		arena->ball->SetState(b);
		arena->Step(10);
		BallState after = arena->ball->GetState();
		float turned = acosf(RS_CLAMP(after.rotMat.forward.Dot(Vec(1, 0, 0)), -1.f, 1.f));
		CHECK(abs(turned - 0.5f) < 0.01f, "a ball spinning at 6 rad/s turned %.4f rad in 10 ticks, expected 0.5", turned);
		delete arena;
	}
	// The same play with and without the rotation: bounces off the floor, a wall and the ceiling, two cars driving into
	// it and jumping: bit for bit the same. (Later in a long roll the spin can differ in its last bits now and then: the
	// floor contact turns with the ball, as in the game's Bullet, which has no RocketSim no-rotation shortcut)
	ArenaConfig rot, noRot;
	rot.noBallRot = false;
	noRot.noBallRot = true;
	Arena* a = Arena::Create(GameMode::SOCCAR, rot);
	Arena* b = Arena::Create(GameMode::SOCCAR, noRot);
	for (Arena* arena : { a, b }) {
		Car* c1 = arena->AddCar(Team::BLUE);
		Car* c2 = arena->AddCar(Team::ORANGE);
		c1->SetState(CarAt({ -1500, -400, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		c2->SetState(CarAt({ 1500, 300, 17.01f }, { -1, 0, 0 }, { 0, 0, 1 }));
		BallState ball;
		ball.pos = { 0, 0, 600 };
		ball.vel = { 300, 2600, 900 };
		ball.angVel = { 2, -3, 5 };
		arena->ball->SetState(ball);
	}
	bool same = true;
	int firstDiff = -1;
	for (int t = 0; t < 1100 && same; t++) {
		for (Arena* arena : { a, b }) {
			int i = 0;
			for (Car* car : arena->GetCars()) {
				CarControls c;
				c.throttle = 1;
				c.boost = t < 200;
				c.steer = (i == 0 ? 0.3f : -0.2f) * ((t / 90) % 2 ? 1 : -1);
				c.jump = (t % 150) < 10;
				car->controls = c;
				i++;
			}
			arena->Step(1);
		}
		BallState ba = a->ball->GetState(), bb = b->ball->GetState();
		same &= memcmp(&ba.pos, &bb.pos, sizeof(Vec)) == 0 && memcmp(&ba.vel, &bb.vel, sizeof(Vec)) == 0 &&
			memcmp(&ba.angVel, &bb.angVel, sizeof(Vec)) == 0;
		auto ca = a->GetCars().begin(), cb = b->GetCars().begin();
		for (; ca != a->GetCars().end(); ++ca, ++cb) {
			CarState x = (*ca)->GetState(), y = (*cb)->GetState();
			same &= memcmp(&x.pos, &y.pos, sizeof(Vec)) == 0 && memcmp(&x.vel, &y.vel, sizeof(Vec)) == 0;
		}
		if (!same) firstDiff = t;
	}
	CHECK(same, "with the ball's rotation the play differs from tick %d", firstDiff);
	delete a;
	delete b;
}

static void TestRespawn() {
	puts("respawn: a deterministic spot (tick count and car ID), never on another car (static analysis GA-18)");
	using namespace RLConst;
	auto respawnAt = [](std::vector<int> parkedSpots) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		for (int i : parkedSpots) {
			Car* parked = arena->AddCar(Team::BLUE);
			const CarSpawnPos& p = CAR_RESPAWN_LOCATIONS_SOCCAR[i];
			parked->SetState(CarAt({ p.x, p.y, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		}
		Car* car = arena->AddCar(Team::BLUE);
		arena->Step(10);
		car->Demolish();
		arena->Step((int)(DEMO_RESPAWN_TIME * 120) + 5);
		CarState s = car->GetState();
		delete arena;
		return s;
	};
	CarState first = respawnAt({}), again = respawnAt({});
	CHECK(!first.isDemoed && memcmp(&first.pos, &again.pos, sizeof(Vec)) == 0,
		"two identical runs respawned at (%.1f, %.1f) and (%.1f, %.1f)", first.pos.x, first.pos.y, again.pos.x, again.pos.y);
	for (int free = 0; free < CAR_RESPAWN_LOCATION_AMOUNT; free++) {
		std::vector<int> parked;
		for (int i = 0; i < CAR_RESPAWN_LOCATION_AMOUNT; i++)
			if (i != free)
				parked.push_back(i);
		CarState s = respawnAt(parked);
		const CarSpawnPos& p = CAR_RESPAWN_LOCATIONS_SOCCAR[free];
		CHECK(Vec(s.pos.x - p.x, s.pos.y - p.y, 0).Length() < 5,
			"spots taken but %d: respawned at (%.1f, %.1f), the free spot is (%.1f, %.1f)", free, s.pos.x, s.pos.y, p.x, p.y);
	}
}

static void TestDemoSpawnSelection() {
	puts("respawn spot selection: left/right presses for 2.5 s pick that side's spot (inner first), locked 0.5 s before");
	using namespace RLConst;
	// presses: (tick after the demolition, -1 left / 1 right); `blocker`: a car parked on the locked spot after the lock
	auto respawn = [](std::vector<std::pair<int, int>> presses, float respawnDelay = DEMO_RESPAWN_TIME, bool blocker = false) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		MutatorConfig m = arena->GetMutatorConfig();
		m.respawnDelay = respawnDelay;
		arena->SetMutatorConfig(m);
		Car* car = arena->AddCar(Team::BLUE);
		Car* other = blocker ? arena->AddCar(Team::ORANGE) : nullptr;
		if (other) other->SetState(CarAt({ 0, 3000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		arena->Step(10);
		car->Demolish(respawnDelay);
		int ticks = (int)(respawnDelay * 120) + 5;
		for (int t = 0; t < ticks; t++) {
			car->controls = CarControls();
			for (auto& p : presses)
				if (p.first == t) car->controls.steer = (float)p.second;
			if (other && t == 330) { // locked at 300: put a car on the locked spot
				CarState s = car->GetState();
				other->SetState(CarAt(s.prespawnPos + Vec(0, 0, -19), { 1, 0, 0 }, { 0, 0, 1 }));
			}
			arena->Step();
		}
		CarState s = car->GetState();
		delete arena;
		return s;
	};
	auto at = [](const CarState& s, float x) { return !s.isDemoed && fabsf(s.pos.x - x) < 5 && fabsf(s.pos.y + 4608) < 5; };
	// Blue's own left is +x
	CarState s = respawn({ { 20, -1 } });
	CHECK(at(s, 2304), "left: expected the inner left spot (2304, -4608), got (%.1f, %.1f)", s.pos.x, s.pos.y);
	s = respawn({ { 20, -1 }, { 40, -1 } });
	CHECK(at(s, 2688), "left, left: expected the outer left spot (2688, -4608), got (%.1f, %.1f)", s.pos.x, s.pos.y);
	s = respawn({ { 20, -1 }, { 40, -1 }, { 60, -1 } });
	CHECK(at(s, 2304), "left x3: expected back to the inner left spot, got (%.1f, %.1f)", s.pos.x, s.pos.y);
	s = respawn({ { 20, 1 } });
	CHECK(at(s, -2304), "right: expected the inner right spot (-2304, -4608), got (%.1f, %.1f)", s.pos.x, s.pos.y);
	s = respawn({ { 20, -1 }, { 40, -1 }, { 60, 1 } });
	CHECK(at(s, -2304), "left, left, right: expected the inner right spot, got (%.1f, %.1f)", s.pos.x, s.pos.y);
	// After the lock (2.5 s) a press changes nothing: the same spot as with no press
	CarState none = respawn({});
	s = respawn({ { 320, 1 } });
	CHECK(memcmp(&s.pos, &none.pos, sizeof(Vec)) == 0, "a press after the lock moved the spot");
	// A respawn delay under 3 s: no selection
	CarState shortNone = respawn({}, 2.f);
	s = respawn({ { 20, shortNone.pos.x > 0 ? 1 : -1 } }, 2.f); // a press toward the other side
	CHECK(memcmp(&s.pos, &shortNone.pos, sizeof(Vec)) == 0, "selection with a 2 s respawn delay");
	// A car on the locked spot at the respawn: 192 uu away (an offset of the locked spot)
	CarState free = respawn({ { 20, -1 } }, DEMO_RESPAWN_TIME, false);
	s = respawn({ { 20, -1 } }, DEMO_RESPAWN_TIME, true);
	float d = Vec(s.pos.x - free.pos.x, s.pos.y - free.pos.y, 0).Length();
	CHECK(!s.isDemoed && fabsf(d - DEMO_SPAWN_OFFSET) < 5, "locked spot taken: respawned %.1f uu from it, expected 192", d);
}

static void TestBallExplodesOnGoal() {
	puts("goal: the ball explodes (frozen, no collision) until a reset, so it can't come back out and score again");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	int goals = 0;
	arena->SetGoalScoreCallback([](Arena*, Team, void* n) { ++*(int*)n; }, &goals);
	BallState b;
	b.pos = { 0, 5300, 300 };
	b.vel = { 0, -1500, 0 }; // in the goal, on its way back out
	arena->ball->SetState(b);
	arena->Step(1);
	BallState exploded = arena->ball->GetState();
	CHECK(exploded.isExploded, "the ball should have exploded on the goal");
	// A car driving into it: the ball neither moves nor pushes back
	car->SetState(CarAt({ 0, 5000, 300 }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 1500, 0 }));
	arena->Step(120);
	BallState after = arena->ball->GetState();
	CHECK((after.pos - exploded.pos).Length() == 0 && after.vel.Length() == 0, "the exploded ball moved from y %.1f to %.1f (vel %.1f)",
		exploded.pos.y, after.pos.y, after.vel.Length());
	CHECK(goals >= 1, "no goal reported");
	CHECK(arena->IsBallScored(), "the exploded ball should stay in the goal");
	// A reset brings it back, simulated again
	arena->ResetToRandomKickoff(1);
	arena->Step(10);
	CHECK(!arena->ball->GetState().isExploded && !arena->IsBallScored(), "a reset should bring the ball back");
	BallState up;
	up.pos = { 0, 0, 500 };
	arena->ball->SetState(up);
	arena->Step(10);
	CHECK(arena->ball->GetState().pos.z < 500, "after the reset the ball should fall again (z %.1f)", arena->ball->GetState().pos.z);
	delete arena;
}

static void TestBoostPads() {
	puts("boost pads: picked up within 176 (small) / 208 (big) uu and 96 uu of height");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	auto pickup = [&](Vec pos) {
		CarState s = CarAt(pos, { 1, 0, 0 }, { 0, 0, 1 });
		s.boost = 0;
		car->SetState(s);
		arena->Step(1);
		return car->GetState().boost;
	};
	using namespace RLConst::BoostPads;
	// one pad per case (each goes on cooldown)
	float b = pickup(Vec(0, -2816 + 170, 17));
	CHECK(Near(b, BOOST_AMOUNT_SMALL, 1e-3f), "small pad at 170 uu: boost %.2f", b);
	b = pickup(Vec(940 + 180, -3308, 17));
	CHECK(b == 0, "small pad at 180 uu: boost %.2f", b);
	b = pickup(Vec(3584 - 205, 0, 17));
	CHECK(Near(b, BOOST_AMOUNT_BIG, 1e-3f), "big pad at 205 uu: boost %.2f", b);
	b = pickup(Vec(-3584 + 212, 0, 17));
	CHECK(b == 0, "big pad at 212 uu: boost %.2f", b);
	b = pickup(Vec(1792, -4184, PAD_Z_SMALL + 95));
	CHECK(Near(b, BOOST_AMOUNT_SMALL, 1e-3f), "small pad 95 uu below: boost %.2f", b);
	b = pickup(Vec(-1792, -4184, PAD_Z_SMALL + 97));
	CHECK(b == 0, "small pad 97 uu below: boost %.2f", b);
	// The game's pads (static analysis RS-4): a small pad's reach ends at z 160.08 (z 64.082016 + 96), a big pad's at
	// 168 (72 + 96); the small pads by the midfield corners are at |y| 2302, so 177 uu from (1788, -2125)
	b = pickup(Vec(0, -1024, 160.0f));
	CHECK(Near(b, BOOST_AMOUNT_SMALL, 1e-3f), "small pad, car at z 160.0: boost %.2f", b);
	b = pickup(Vec(0, 1024, 160.2f));
	CHECK(b == 0, "small pad, car at z 160.2: boost %.2f", b);
	b = pickup(Vec(3072, 4096, 167.9f));
	CHECK(Near(b, BOOST_AMOUNT_BIG, 1e-3f), "big pad, car at z 167.9: boost %.2f", b);
	b = pickup(Vec(-3072, 4096, 168.1f));
	CHECK(b == 0, "big pad, car at z 168.1: boost %.2f", b);
	b = pickup(Vec(1788, -2125, 17));
	CHECK(b == 0, "small pad at (1788, -2302), car at (1788, -2125): boost %.2f", b);
	b = pickup(Vec(-1788, 2127, 17));
	CHECK(Near(b, BOOST_AMOUNT_SMALL, 1e-3f), "small pad at (-1788, 2302), car 175 uu away: boost %.2f", b);
	delete arena;
}

// Kickoff ball: at z 92.75 (where the game leaves it), at rest, asleep 2 s later
static void TestKickoffBall() {
	puts("kickoff ball: z 92.75, stays there, asleep after 2 s");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	arena->ResetToRandomKickoff(1);
	float z0 = arena->ball->GetState().pos.z;
	arena->Step(230);
	BallState b = arena->ball->GetState();
	bool awake = arena->ball->_rigidBody.isActive();
	arena->Step(30);
	// (uu -> Bullet units -> uu rounds 92.75 to 92.749992; quantized to 0.01 that is 92.75)
	CHECK(Near(z0, RLConst::BALL_KICKOFF_Z, 1e-4f) && Near(b.pos.z, RLConst::BALL_KICKOFF_Z, 1e-4f) && b.vel.IsZero(),
		"kickoff ball z %.6f -> %.6f, vel (%g, %g, %g)", z0, b.pos.z, b.vel.x, b.vel.y, b.vel.z);
	CHECK(awake && !arena->ball->_rigidBody.isActive(), "kickoff ball should sleep between 1.92 and 2.17 s");
	delete arena;
}

// Kickoff countdown: no input while it runs (a match server sets it after a kickoff reset); kept in snapshots
// RV-55: a jump held through the countdown doesn't fire at the release; a fresh press afterwards does
static void TestCountdownHeldJump() {
	puts("kickoff countdown: a jump held through it doesn't jump at the release (RV-55); a fresh press does");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	for (int ticks : { 2, 480 }) {
		arena->ResetToRandomKickoff(1);
		arena->kickoffCountdownTicks = ticks;
		CarControls held;
		held.jump = true;
		car->controls = held;
		for (int i = 0; i < ticks + 30; i++) {
			car->controls = held;
			arena->Step(1);
		}
		float vz = car->GetState().vel.z;
		CHECK(std::fabs(vz) < 1 && car->GetState().isOnGround, "countdown %d, jump held: vz %.2f after the release", ticks, vz);
		car->controls = CarControls();
		arena->Step(1);
		car->controls = held;
		arena->Step(3);
		CHECK(car->GetState().vel.z > 200, "a fresh press after the countdown %d: vz %.2f", ticks, car->GetState().vel.z);
	}
	{ // RV-93: one Step of several ticks through the countdown's end keeps the real input for the ticks after it
		arena->ResetToRandomKickoff(1);
		arena->kickoffCountdownTicks = 1;
		CarControls held;
		held.jump = true;
		held.throttle = 1;
		car->controls = held;
		Vec before = car->GetState().pos;
		arena->Step(10);
		CHECK(car->controls.jump && car->controls.throttle == 1, "the input survives the countdown's tick");
		CarState s = car->GetState();
		CHECK(s.isOnGround && std::fabs(s.vel.z) < 1, "no jump at the release within the step: vz %.2f", s.vel.z);
		CHECK((s.pos - before).Length() > 1 && s.vel.Length() > 50, "the ticks after the countdown drive on the real throttle: speed %.1f", s.vel.Length());
	}
	delete arena;
}

static void TestKickoffCountdown() {
	puts("kickoff countdown: cars get no input for its ticks; snapshots keep it");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	arena->ResetToRandomKickoff(1);
	arena->kickoffCountdownTicks = 480;
	DataStreamOut snap;
	arena->Serialize(snap);
	CarControls go;
	go.throttle = 1;
	go.boost = true;
	go.jump = true;
	Vec start = car->GetState().pos;
	for (int i = 0; i < 480; i++) {
		car->controls = go;
		arena->Step(1);
	}
	// (the car settles on its suspension after the spawn and creeps ~0.15 uu)
	float moved = (car->GetState().pos - start).Length();
	CHECK(moved < 1 && arena->kickoffCountdownTicks == 0, "moved %.3f uu during the countdown, ticks left %u", moved, arena->kickoffCountdownTicks);
	for (int i = 0; i < 12; i++) {
		car->controls = go;
		arena->Step(1);
	}
	CHECK(car->GetState().vel.Length() > 50, "car should drive after the countdown (speed %.1f)", car->GetState().vel.Length());
	DataStreamIn in;
	in.data = snap.data;
	CHECK(arena->DeserializeInPlace(in) && arena->kickoffCountdownTicks == 480, "restored countdown %u", arena->kickoffCountdownTicks);
	delete arena;
}

static void TestXYLockSnapshots() {
	puts("countdown XY lock: a snapshot restores and re-serializes to the same bytes (RV-297, RV-305); a car placed while "
		"held is held at its new spot in a snapshot, a clone and after a load (RV-303)");
	auto bytes = [](Arena* a) { DataStreamOut out; a->Serialize(out); return out.data; };
	auto restore = [](const std::vector<uint8_t>& data) { DataStreamIn in; in.data = data; return Arena::DeserializeNew(in); };
	auto xy = [](Car* c) { Vec p = c->GetState().pos; return Vec(p.x, p.y, 0); };
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	arena->ResetToRandomKickoff(1);
	arena->kickoffCountdownTicks = 480;
	arena->Step(5);
	{ // RV-305: restored during the countdown and serialized at once: the same bytes (the pending pin written)
		std::vector<uint8_t> a = bytes(arena);
		DataStreamIn in;
		in.data = a;
		CHECK(arena->DeserializeInPlace(in) && bytes(arena) == a, "a restore re-serializes to the same bytes");
	}
	// RV-303: placed while held, then a snapshot and a clone before the next tick
	CarState moved = car->GetState();
	moved.pos = moved.pos + Vec(800, -600, 0);
	car->SetState(moved);
	Arena* restored = restore(bytes(arena));
	Arena* cloned = arena->Clone(false);
	Vec spot = xy(car);
	for (int i = 0; i < 40; i++) {
		car->controls.throttle = 1;
		restored->GetCar(car->id)->controls.throttle = 1;
		cloned->GetCar(car->id)->controls.throttle = 1;
		arena->Step(1);
		restored->Step(1);
		cloned->Step(1);
	}
	CHECK((xy(car) - spot).Length() < 1, "the server's car held at its new spot: %.2f uu off", (xy(car) - spot).Length());
	CHECK((xy(restored->GetCar(car->id)) - spot).Length() < 1, "restored: %.2f uu off its new spot", (xy(restored->GetCar(car->id)) - spot).Length());
	CHECK((xy(cloned->GetCar(car->id)) - spot).Length() < 1, "cloned: %.2f uu off its new spot", (xy(cloned->GetCar(car->id)) - spot).Length());
	{ // A placement after a load beats the snapshot's pin
		DataStreamIn in;
		in.data = bytes(arena);
		CHECK(restored->DeserializeInPlace(in), "loads");
		Car* r = restored->GetCar(car->id);
		CarState again = r->GetState();
		again.pos = again.pos + Vec(-500, 300, 0);
		r->SetState(again);
		Vec placed = xy(r);
		restored->Step(40);
		CHECK((xy(r) - placed).Length() < 1, "placed after a load: %.2f uu off its new spot", (xy(r) - placed).Length());
	}
	delete restored;
	delete cloned;
	delete arena;
}

static void TestComponentsOff() {
	puts("another player's car on a client (components off): drives as any car, but a jump, boost, dodge or air roll does "
		"nothing between the server's states");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* on = arena->AddCar(Team::BLUE);
	Car* off = arena->AddCar(Team::ORANGE);
	off->_componentsOff = true;
	auto place = [&](Car* car, Vec pos) {
		CarState s = CarAt(pos, Vec(1, 0, 0), Vec(0, 0, 1));
		s.boost = 50;
		car->SetState(s);
	};
	place(on, Vec(-2000, -1000, 17));
	place(off, Vec(-2000, 1000, 17));
	arena->Step(30);
	// Driving: the same throttle and steer, the same motion (the vehicle isn't a component)
	CarControls drive;
	drive.throttle = 1;
	drive.steer = 0.4f;
	for (int i = 0; i < 90; i++) {
		on->controls = drive;
		off->controls = drive;
		arena->Step(1);
	}
	CarState a = on->GetState(), b = off->GetState();
	CHECK(Near(a.vel.Length(), b.vel.Length(), 1e-3f) && Near(a.pos.x, b.pos.x, 0.05f) && Near(a.pos.y + 2000, b.pos.y, 0.05f),
		"drives alike: %.3f vs %.3f uu/s, (%.3f, %.3f) vs (%.3f, %.3f)", a.vel.Length(), b.vel.Length(), a.pos.x, a.pos.y, b.pos.x, b.pos.y);
	// A jump and boost: none for the car with its components off
	CarControls jump = drive;
	jump.jump = true;
	jump.boost = true;
	float zOn = on->GetState().pos.z, zOff = off->GetState().pos.z, boostOff = off->GetState().boost;
	for (int i = 0; i < 20; i++) {
		on->controls = jump;
		off->controls = jump;
		arena->Step(1);
	}
	CHECK(on->GetState().pos.z > zOn + 20 && on->GetState().hasJumped, "the normal car jumped: z %.1f", on->GetState().pos.z);
	CHECK(Near(off->GetState().pos.z, zOff, 2) && !off->GetState().hasJumped && !off->GetState().isBoosting,
		"no jump nor boost: z %.2f -> %.2f", zOff, off->GetState().pos.z);
	CHECK(off->GetState().boost == boostOff, "no boost used: %.2f -> %.2f", boostOff, off->GetState().boost);
	// In the air: no air throttle, no air roll
	CarState air = CarAt(Vec(0, 3000, 800), Vec(1, 0, 0), Vec(0, 0, 1));
	off->SetState(air);
	CarControls roll;
	roll.throttle = 1;
	roll.roll = 1;
	for (int i = 0; i < 10; i++) {
		off->controls = roll;
		arena->Step(1);
	}
	CarState s = off->GetState();
	CHECK(fabsf(s.vel.x) < 1e-3f && s.angVel.Length() < 1e-3f, "falls straight: vx %.4f, spin %.4f", s.vel.x, s.angVel.Length());
	delete arena;
}

static void TestKickoffManyOnOneTeam() {
	puts("a kickoff with ten cars on one team: every car on a spot in the arena, none on another (SEC-1: RocketSim's "
		"respawn spots wrapped at 5 on a 4-entry table)");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	for (int i = 0; i < 10; i++)
		arena->AddCar(Team::BLUE);
	arena->AddCar(Team::ORANGE);
	arena->ResetToRandomKickoff(3);
	std::vector<Vec> spots;
	for (Car* car : arena->GetCars()) {
		Vec p = car->GetState().pos;
		bool inside = std::isfinite(p.x) && std::isfinite(p.y) && std::isfinite(p.z) && fabsf(p.x) < 4096 && fabsf(p.y) < 6000 && p.z > 0 && p.z < 2044;
		CHECK(inside, "car %u at (%.1f, %.1f, %.1f)", car->id, p.x, p.y, p.z);
		for (const Vec& q : spots)
			CHECK((p - q).Length() > 100, "car %u on another's spot (%.1f, %.1f)", car->id, p.x, p.y);
		spots.push_back(p);
	}
	delete arena;
}

// Supersonic: on from 2200; below that, kept for 1 s (TimeBelowSupersonicSpeed) while above 2100
static void TestSupersonic(Arena* arena, Car* car) {
	puts("supersonic: kept for 1 s below 2200 (above 2100), also after a long supersonic run");
	CarControls c;
	c.throttle = 1;
	c.boost = true;
	CarState s = Run(arena, car, CarAt({ 0, -4000, 17 }, { 0, 1, 0 }, { 0, 0, 1 }, { 0, 2300, 0 }), c, 180);
	CHECK(s.isSupersonic && s.supersonicTime == 0, "supersonic after 1.5 s at 2300 (time below %.3f)", s.supersonicTime);
	s.vel = s.rotMat.forward * 2150; // slower, throttle held (no acceleration and no coasting above 1410)
	c.boost = false;
	s = Run(arena, car, s, c, 90);
	float speed = s.vel.Length();
	CHECK(s.isSupersonic && speed > 2100 && speed < 2200, "still supersonic 0.75 s below 2200 (speed %.1f)", speed);
	s = Run(arena, car, s, c, 36);
	CHECK(!s.isSupersonic, "supersonic should end after 1 s below 2200 (time %.3f)", s.supersonicTime);
	s.vel = s.rotMat.forward * 2300;
	s = Run(arena, car, s, c, 2);
	CHECK(s.isSupersonic, "supersonic again at 2300");
	s.vel = s.rotMat.forward * 2050;
	s = Run(arena, car, s, c, 1);
	CHECK(!s.isSupersonic, "supersonic should end below 2100");
}

static void TestBumpCurves() {
	puts("bump curves: exact data values / 180");
	using namespace RLConst;
	CHECK(Near(BUMP_VEL_AMOUNT_GROUND_CURVE.GetOutput(1400), 200000.f / 180, 1e-2f), "ground");
	CHECK(Near(BUMP_VEL_AMOUNT_AIR_CURVE.GetOutput(2200), 350000.f / 180, 1e-2f), "air");
	CHECK(Near(BUMP_UPWARD_VEL_AMOUNT_CURVE.GetOutput(1800), (50000.f + 75000.f) / 2 / 180, 1e-2f), "z");
}

// --------------------------------------------------------------------------------------------
static void TestAckermann(Arena* arena, Car* car) {
	puts("steering: inner-wheel curves converted to the inner/outer average, same angle on both front wheels");
	car->SetState(CarAt({ 0, -2000, 17 }, { 1, 0, 0 }, { 0, 0, 1 }));
	car->controls = CarControls();
	car->controls.steer = 1;
	arena->Step();
	float L = car->config.frontWheels.connectionPointOffset.x - car->config.backWheels.connectionPointOffset.x;
	float W = car->config.frontWheels.connectionPointOffset.y * 2;
	float inner = 35 * DEG, outer = atanf(L / (W + L / tanf(inner)));
	float w0 = car->_bulletVehicle.m_wheelInfo[0].m_steerAngle, w1 = car->_bulletVehicle.m_wheelInfo[1].m_steerAngle;
	CHECK(Near(w0, (inner + outer) / 2, 1e-4f) && w0 == w1, "steer +1 at rest: %.5f %.5f, expected both %.5f", w0, w1,
		(inner + outer) / 2);
	CHECK(Near(w0, 0.53356f, 2e-4f), "Octane at rest %.5f, stock RocketSim's curve 0.53356", w0);
	car->controls.steer = -1;
	arena->Step();
	w0 = car->_bulletVehicle.m_wheelInfo[0].m_steerAngle; w1 = car->_bulletVehicle.m_wheelInfo[1].m_steerAngle;
	CHECK(Near(w0, -(inner + outer) / 2, 1e-4f) && w0 == w1, "steer -1: %.5f %.5f", w0, w1);
	car->controls = CarControls();
}

static void TestSuspensionScale(Arena* arena) {
	puts("suspension: per-car weight share");
	Car* octane = arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	Car* dominus = arena->AddCar(Team::BLUE, CAR_CONFIG_DOMINUS);
	auto& o = octane->_bulletVehicle.m_wheelInfo;
	auto& d = dominus->_bulletVehicle.m_wheelInfo;
	CHECK(Near(o[0].m_suspensionForceScale, 35.735f, 1e-3f) && Near(o[2].m_suspensionForceScale, 54.265f, 1e-3f),
		"Octane %.4f / %.4f", o[0].m_suspensionForceScale, o[2].m_suspensionForceScale);
	CHECK(Near(d[0].m_suspensionForceScale, 36.772f, 1e-3f) && Near(d[2].m_suspensionForceScale, 53.228f, 1e-3f),
		"Dominus %.4f / %.4f", d[0].m_suspensionForceScale, d[2].m_suspensionForceScale);
	arena->RemoveCar(octane);
	arena->RemoveCar(dominus);
}

// --------------------------------------------------------------------------------------------
static void TestSolverAndOneSided(Arena* arena) {
	puts("Bullet: warm starting off; one-sided ball vs triangle");
	CHECK(arena->_bulletWorld.getSolverInfo().m_solverMode == 0, "solverMode %d", arena->_bulletWorld.getSolverInfo().m_solverMode);

	// The back wall is a mesh. A ball overlapping it from behind passes through into the field.
	BallState bs;
	bs.pos = { 2000, 5160, 1000 };
	bs.vel = { 0, -1000, 0 };
	arena->ball->SetState(bs);
	arena->Step(30);
	float y = arena->ball->GetState().pos.y;
	CHECK(y < 5120 - 100, "ball behind the wall was pushed out (y %.1f)", y);

	// From the front it bounces
	bs.pos = { 2000, 4800, 1000 };
	bs.vel = { 0, 1000, 0 };
	arena->ball->SetState(bs);
	arena->Step(60);
	CHECK(arena->ball->GetState().vel.y < 0, "ball did not bounce off the back wall");
}

static void TestInputQuantization(Arena* arena, Car* car) {
	puts("inputs: every axis is a byte, q / 127 above zero and q / 128 below (Vehicle_TA.SetVehicleInput)");
	struct { float in, out; } cases[] = {
		{ 1, 1 }, { -1, -1 }, { 0.25f, 32 / 127.f }, { -0.5f, -0.5f }, { -0.7f, -90 / 128.f }, { 0.7f, 89 / 127.f },
		{ -63.5f / 128, -63 / 128.f }, { 63.5f / 127, 64 / 127.f }, // halves round up
	};
	for (auto& c : cases) {
		float q = Quantize::InputAxis(c.in);
		CHECK(q == c.out, "%.6f -> %.8f, expected %.8f", c.in, q, c.out);
		CHECK(Quantize::InputAxis(q) == q, "%.8f not stable", q);
	}
	CarState s = CarAt({ 0, 0, 1500 }, { 1, 0, 0 }, { 0, 0, 1 });
	car->SetState(s);
	car->controls = CarControls();
	car->controls.steer = -0.7f;
	car->controls.pitch = 0.3f;
	arena->Step(1);
	CHECK(car->controls.steer == -90 / 128.f && car->controls.pitch == 38 / 127.f, "after a tick: steer %.8f pitch %.8f",
		car->controls.steer, car->controls.pitch);
}

static void TestVehicleUpdate(Arena* arena, Car* car) {
	puts("vehicle update as the game's: friction with this tick's inputs, full-length wheel rays, rest height");
	BallState away;
	away.pos = { 3000, 4000, 93.15f };
	arena->ball->SetState(away);
	car->SetState(CarAt({ 0, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	car->controls = CarControls();
	arena->Step(240);
	float restZ = car->GetState().pos.z;
	CHECK(restZ >= 16.995f && restZ <= 17.015f, "resting height %.3f (replays: 17.00-17.01)", restZ);
	// Throttle acts on the tick it is pressed (RocketSim used the previous tick's engine force: nothing that tick)
	CarState rest = car->GetState();
	rest.vel = rest.angVel = Vec();
	car->SetState(rest);
	car->controls.throttle = 1;
	arena->Step(1);
	float v1 = car->GetState().vel.Dot(car->GetState().rotMat.forward);
	CHECK(v1 > 5, "forward speed after the first tick of full throttle: %.2f uu/s", v1);
	car->controls = CarControls();
	// Wheel rays reach radius + rest + travel: a car held 1.25 uu below full extension still touches with all wheels
	// (front: 12.5 + 26.755 + 12 = 51.255 uu from the hard point at 20.755 above the car's origin)
	CarState high = CarAt({ 0, 0, 51.255f - 1.25f - 20.755f }, { 1, 0, 0 }, { 0, 0, 1 });
	car->SetState(high);
	arena->Step(1);
	CarState h = car->GetState();
	int contacts = h.wheelsWithContact[0] + h.wheelsWithContact[1] + h.wheelsWithContact[2] + h.wheelsWithContact[3];
	CHECK(contacts == 4, "wheels touching 1.25 uu below full extension: %d", contacts);
}

static void TestBallHitStartOfTick(Arena* arena, Car* car) {
	puts("car-ball hit impulse from start-of-tick velocities (OldRBState): none for a ball landing at rest on a parked car");
	car->SetState(CarAt({ 0, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	car->controls = CarControls();
	BallState away;
	away.pos = { 3000, 4000, 93.15f };
	arena->ball->SetState(away);
	arena->Step(120); // the car settles
	CarState c = car->GetState();
	c.vel = c.angVel = Vec(); // both at rest at the start of the tick
	car->SetState(c);
	float roof = c.pos.z + car->config.hitboxPosOffset.z + car->config.hitboxSize.z / 2;
	BallState b;
	b.pos = { c.pos.x + car->config.hitboxPosOffset.x, c.pos.y, roof + 91.25f + 0.5f };
	arena->ball->SetState(b);
	arena->Step(1);
	const BallHitInfo& hit = car->GetState().ballHitInfo;
	bool touched = hit.isValid && hit.tickCountWhenHit == arena->tickCount - 1;
	// Velocities read during the step (stock RocketSim) hold this tick's gravity and suspension push: ~3.5 uu/s
	CHECK(touched && hit.extraHitVel.Length() < 0.01f, "touched %d, extra impulse %.3f uu/s", touched,
		hit.extraHitVel.Length());
}

static void TestSleeping(Arena* arena, Car* car) {
	puts("sleeping: the ball after 2 s below 40 uu/s and 1 rad/s (velocity zeroed); cars never");
	car->SetState(CarAt({ -3000, -3000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
	car->controls = CarControls();
	bool carSlept = false; // (cars never sleep: Car_Default bDisableSleeping; RocketSim keeps them active every tick)
	auto ticksUntilAsleep = [&](BallState b, int maxTicks) {
		arena->ball->SetState(b);
		for (int t = 1; t <= maxTicks; t++) {
			arena->Step(1);
			carSlept |= car->_rigidBody.getActivationState() == ISLAND_SLEEPING;
			if (arena->ball->_rigidBody.getActivationState() == ISLAND_SLEEPING) return t;
		}
		return -1;
	};
	BallState rest;
	rest.pos = { 0, 0, 93.15f };
	int restTicks = ticksUntilAsleep(rest, 600);
	CHECK(restTicks >= 240 && restTicks <= 243, "ball placed at rest fell asleep after %d ticks (replays: 2.0 s)", restTicks);
	BallState slow = rest;
	slow.vel = { 30, 0, 0 };
	slow.angVel = { 0, 30 / 91.25f, 0 }; // rolling
	int slowTicks = ticksUntilAsleep(slow, 600);
	BallState s = arena->ball->GetState();
	CHECK(slowTicks >= 240 && slowTicks <= 243 && s.vel.IsZero() && s.angVel.IsZero(),
		"ball rolling at 30 uu/s: asleep after %d ticks, velocity %.3f", slowTicks, s.vel.Length());
	BallState faster = rest;
	faster.vel = { 60, 0, 0 };
	faster.angVel = { 0, 60 / 91.25f, 0 };
	int fasterTicks = ticksUntilAsleep(faster, 600);
	CHECK(fasterTicks == -1 && arena->ball->GetState().vel.Length() > 50, "ball rolling at 60 uu/s fell asleep after %d ticks",
		fasterTicks);
	CHECK(!carSlept, "a parked car fell asleep");
	// A sleeping ball still gets hit
	ticksUntilAsleep(rest, 600);
	car->SetState(CarAt({ -400, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }, { 1000, 0, 0 }));
	car->controls.throttle = 1;
	arena->Step(60);
	CHECK(arena->ball->GetState().vel.x > 500, "sleeping ball hit at 1000 uu/s: velocity %.1f", arena->ball->GetState().vel.x);
	car->controls = CarControls();
}

// The static session's audit of RocketSim's own code against the exe (notes/rocketsim-audit.md): RS-1, 3, 5, 7, 10
static void TestRocketSimAudit(Arena* arena, Car* car) {
	puts("RS-1: the world inverse inertia tensor is the step's (from the rotation before its rounding), kept through placements");
	{
		CarState s = CarAt({ 0, 0, 600 }, { 1, 0, 0 }, { 0, 0, 1 });
		s.angVel = { 1.3f, -2.1f, 0.7f };
		s.refreshInertia = true;
		car->SetState(s);
		car->controls = CarControls();
		arena->Step(1);
		btRigidBody& rb = car->_rigidBody;
		const btMatrix3x3& b = rb.getInterpolationWorldTransform().getBasis();
		btMatrix3x3 fromStep = b.scaled(rb.getInvInertiaDiagLocal()) * b.transpose();
		const btMatrix3x3& w = rb.getWorldTransform().getBasis();
		btMatrix3x3 fromRounded = w.scaled(rb.getInvInertiaDiagLocal()) * w.transpose();
		auto same = [](const btMatrix3x3& x, const btMatrix3x3& y) {
			for (int i = 0; i < 3; i++)
				for (int j = 0; j < 3; j++)
					if (x[i][j] != y[i][j]) return false;
			return true;
		};
		CHECK(same(rb.m_invInertiaTensorWorld, fromStep), "after a tick: the tensor from the step's rotation, before its rounding");
		CHECK(!same(fromStep, fromRounded), "(the test's spin should make the rounding change the tensor)");
		btMatrix3x3 before = rb.m_invInertiaTensorWorld;
		CarState turned = CarAt({ 0, 0, 600 }, { 0, 1, 0 }, { 0, 0, 1 });
		car->SetState(turned);
		CHECK(same(rb.m_invInertiaTensorWorld, before), "a placement keeps it (the game's teleports don't recompute it)");
		turned.refreshInertia = true;
		car->SetState(turned);
		const btMatrix3x3& t = rb.getWorldTransform().getBasis();
		CHECK(same(rb.m_invInertiaTensorWorld, t.scaled(rb.getInvInertiaDiagLocal()) * t.transpose()), "refreshInertia recomputes it");
		CHECK(!car->GetState().refreshInertia, "refreshInertia is a request, not state");
		arena->Step(3);
		Arena* copy = arena->Clone(false);
		CHECK(same(copy->GetCar(car->id)->_rigidBody.m_invInertiaTensorWorld, rb.m_invInertiaTensorWorld), "a clone carries it");
		delete copy;
		// Kickoff resets and respawns spawn new cars in the game (InitBody -> setMassProps): computed from the spawn
		arena->Step(2);
		arena->ResetToRandomKickoff(7);
		const btMatrix3x3& k = rb.getWorldTransform().getBasis();
		CHECK(same(rb.m_invInertiaTensorWorld, k.scaled(rb.getInvInertiaDiagLocal()) * k.transpose()), "a kickoff reset computes it");
	}

	puts("RS-3: the wall friction curve breaks at 0.707 (the package's WallFrictionCurve)");
	CHECK(RLConst::NON_STICKY_FRICTION_FACTOR_CURVE.GetOutput(0.707f) == 0.5f, "0.707 -> %g", RLConst::NON_STICKY_FRICTION_FACTOR_CURVE.GetOutput(0.707f));

	puts("RS-10: the Octane's box exactly: 118.0074 + 2.5 long, offset (13.875660, 20.754988) as read live");
	CHECK(CAR_CONFIG_OCTANE.hitboxSize.x == 120.5074f && CAR_CONFIG_OCTANE.hitboxPosOffset.x == 13.875660f &&
	      CAR_CONFIG_OCTANE.hitboxPosOffset.z == 20.754988f, "size %g, offset %g %g", CAR_CONFIG_OCTANE.hitboxSize.x,
	      CAR_CONFIG_OCTANE.hitboxPosOffset.x, CAR_CONFIG_OCTANE.hitboxPosOffset.z);

	puts("RS-5: the speed cap as the game's read-back: in uu, the length summed y, x, z, then x (1 / sqrt) x cap");
	{
		CarState s = CarAt({ 0, 0, 800 }, { 1, 0, 0 }, { 0, 0, 1 }, { 1700.37f, -1600.41f, -300.13f });
		s.refreshInertia = true;
		car->SetState(s);
		car->controls = CarControls();
		arena->Step(1);
		// The velocity the step left (gravity only: no contacts), capped and rounded as the game does it
		btVector3 v = car->_rigidBody.getInterpolationLinearVelocity() * BT_TO_UU;
		float x = v.x(), y = v.y(), z = v.z(), l2 = y * y + x * x + z * z;
		CHECK(l2 > RLConst::CAR_MAX_SPEED * RLConst::CAR_MAX_SPEED, "(over the cap)");
		float inv = 1.f / sqrtf(l2);
		float cap = RLConst::CAR_MAX_SPEED;
		Vec expected(Quantize::Velocity(cap * (inv * x), 100), Quantize::Velocity(cap * (inv * y), 100), Quantize::Velocity(cap * (inv * z), 100));
		// (compared in Bullet units, as the body holds it: back in uu the last bit can move)
		btVector3 got = car->_rigidBody.m_linearVelocity;
		btVector3 want = btVector3(expected.x, expected.y, expected.z) * UU_TO_BT;
		CHECK(got.x() == want.x() && got.y() == want.y() && got.z() == want.z(), "velocity %.9g %.9g %.9g, expected %.9g %.9g %.9g",
		      got.x(), got.y(), got.z(), want.x(), want.y(), want.z());
	}

	puts("RS-7: the world contact rebuilt after the step, persisting contacts too (a car resting on its roof)");
	{
		// (the box's top, 40.08 above the origin, on the floor; settled for 30 ticks, then counted)
		CarState roof = CarAt({ 0, 2000, 40.5f }, { 1, 0, 0 }, { 0, 0, -1 });
		roof.refreshInertia = true;
		car->SetState(roof);
		car->controls = CarControls();
		arena->Step(30);
		int touching = 0;
		for (int i = 0; i < 60; i++) {
			arena->Step(1);
			touching += car->GetState().worldContact.hasContact;
		}
		CHECK(touching == 60, "in contact every tick while resting (%d of 60)", touching);
		Vec n = car->GetState().worldContact.contactNormal;
		CHECK(Near(n.z, 1, 1e-3f), "the floor's normal (towards the car): %g %g %g", n.x, n.y, n.z);
	}
}

// The presets' boxes as the game's (RV-88, read live: the _bullet.csv headers of the steer recordings): the inner half
// extents' and margin's bits, the box's offset, and the inverse inertia the game's body has (+0x1c0), which
// calculateLocalInertia makes from those floats exactly
static void TestPresetBoxes() {
	// ox, oz: the compound child's origin, the physics' input: the game's chain (x 0.02f, x 50f, x 0.02f; static analysis,
	// RV-95 settled: bit-exact for the six presets from the asset floats, HandlingPresets' BoxElems[0].TM)
	struct Want { const char* name; const CarConfig* preset; uint32_t x, y, z, margin; Vec offset; uint32_t ox, oz, ix, iy, iz; };
	const Want wants[] = {
		{ "Octane", &CAR_CONFIG_OCTANE, 0x3f954d13, 0x3f540dc2, 0x3eb22419, 0x3d1e58fa, { 13.875660f, 0, 20.754988f }, 0x3e8e1636, 0x3ed487f4, 0x3c978367, 0x3c2a7d85, 0x3bf7ce24 },
		{ "Dominus", &CAR_CONFIG_DOMINUS, 0x3fa29eaf, 0x3f52f1a0, 0x3e9bc01a, 0x3d0a71df, { 9.f, 0, 15.75f }, 0x3e3851eb, 0x3ea147ae, 0x3ca09d8a, 0x3c166b97, 0x3be01b54 },
		{ "Plank", &CAR_CONFIG_PLANK, 0x3fa401bf, 0x3f56fdbd, 0x3e92f82a, 0x3d02a3b4, { 9.008572f, 0, 12.0942f }, 0x3e387edc, 0x3e77b070, 0x3c9e775c, 0x3c1586b2, 0x3bdbd438 },
		{ "Breakout", &CAR_CONFIG_BREAKOUT, 0x3fa74fd3, 0x3f4c230f, 0x3e972474, 0x3d06594b, { 12.5f, 0, 11.75f }, 0x3e800000, 0x3e70a3d7, 0x3cab5856, 0x3c0f7e8b, 0x3bdbcdb0 },
		{ "Hybrid", &CAR_CONFIG_HYBRID, 0x3fa1179a, 0x3f4f6a8d, 0x3ea8eccd, 0x3d1627d3, { 13.875660f, 0, 20.754988f }, 0x3e8e1636, 0x3ed487f4, 0x3ca053bf, 0x3c16b4da, 0x3be40e87 },
		{ "Merc", &CAR_CONFIG_MERC, 0x3f989a16, 0x3f4089d3, 0x3ecd9d4d, 0x3d23d70a, { 11.375660f, 0, 21.504988f }, 0x3e68f938, 0x3edc3609, 0x3ca6031f, 0x3c1f60d4, 0x3bfe84c7 },
	};
	auto bitsOf = [](float f) { uint32_t u; memcpy(&u, &f, sizeof u); return u; };
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	for (const Want& w : wants) {
		Car* car = arena->AddCar(Team::BLUE, *w.preset);
		const btVector3& half = car->_childHitboxShape.getImplicitShapeDimensions();
		CHECK(bitsOf(half.x()) == w.x && bitsOf(half.y()) == w.y && bitsOf(half.z()) == w.z, "%s: box %08x %08x %08x", w.name, bitsOf(half.x()), bitsOf(half.y()), bitsOf(half.z()));
		CHECK(bitsOf(car->_childHitboxShape.getMargin()) == w.margin, "%s: margin %08x", w.name, bitsOf(car->_childHitboxShape.getMargin()));
		const Vec& o = car->config.hitboxPosOffset;
		CHECK(bitsOf(o.x) == bitsOf(w.offset.x) && bitsOf(o.z) == bitsOf(w.offset.z), "%s: offset %.6f %.6f", w.name, o.x, o.z);
		const btVector3& child = car->_compoundShape.getChildTransform(0).getOrigin();
		CHECK(bitsOf(child.x()) == w.ox && child.y() == 0 && bitsOf(child.z()) == w.oz, "%s: child origin %08x %08x %08x", w.name, bitsOf(child.x()), bitsOf(child.y()), bitsOf(child.z()));
		if (w.ix) {
			const btVector3& inv = car->_rigidBody.getInvInertiaDiagLocal();
			CHECK(bitsOf(inv.x()) == w.ix && bitsOf(inv.y()) == w.iy && bitsOf(inv.z()) == w.iz, "%s: inverse inertia %08x %08x %08x", w.name, bitsOf(inv.x()), bitsOf(inv.y()), bitsOf(inv.z()));
		}
		arena->RemoveCar(car);
	}
	// (an offset where the game's chain and a single x 0.02f differ: 10 and 20 uu give 0x3e4ccccb and 0x3ecccccb by the
	// chain, 0x3e4ccccc and 0x3ecccccc by x 0.02f: RV-148)
	CarConfig odd = CAR_CONFIG_OCTANE;
	odd.hitboxPosOffset = Vec(10, 0, 20);
	Car* car = arena->AddCar(Team::BLUE, odd);
	const btVector3& child = car->_compoundShape.getChildTransform(0).getOrigin();
	CHECK(bitsOf(child.x()) == 0x3e4ccccbu && bitsOf(child.z()) == 0x3ecccccbu, "child origin by the chain: %08x %08x", bitsOf(child.x()), bitsOf(child.z()));
	arena->RemoveCar(car);
	delete arena;
}

// The static bodies' origins as the game makes them from whole-uu locations (single precision: the PhysX actor's x 0.02,
// read back x 50, the Bullet body's x 0.02: 0x140969d20, 0x140972870). For the goal halves' 5120 uu that's
// +-0x42cccccb (102.399986 BU), 2 ulps below 102.4f; live (walls_goal_wheels, the game's cooked meshes): it makes all 65
// recorded car-mesh points exact (static analysis: notes/bullet-diff.md; scripts/arena_gen.py body_origin).
static float GameStaticBodyOrigin(float locationUU) { return (locationUU * 0.02f) * 50.0f * 0.02f; }
static void TestGoalBodyOrigins() {
	uint32_t want; float w = GameStaticBodyOrigin(5120.f); memcpy(&want, &w, 4);
	CHECK(want == 0x42cccccbu, "chain gives %08x", want);
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	int goals = 0;
	for (btRigidBody* rb : arena->_worldCollisionRBs) {
		// every static body (meshes and planes): each origin component as the game's chain makes it from a whole uu
		const btVector3& o = rb->getWorldTransform().getOrigin();
		for (int i = 0; i < 3; i++) {
			float uu = roundf(o[i] * 50.f), g = GameStaticBodyOrigin(uu);
			CHECK(memcmp(&g, &o[i], 4) == 0, "static body origin[%d] %a (%.6f uu), the game's chain gives %a", i, o[i], o[i] * 50.f, g);
		}
		goals += o.y() != 0;
	}
	CHECK(goals == 4, "%d bodies off y = 0, expected the 4 goal halves", goals);
	delete arena;
}

// --------------------------------------------------------------------------------------------
// RL PATCH tests (CCR1, the car-car residual): states recorded live (PhysLog), as live_validate sets them
struct Rec { float q[4], p[3], v[3], w[3]; };

// A body state as the game's RBState sets it (the rotation btMatrix3x3(btQuaternion(q)), as live_validate)
static CarState CarFrom(const Rec& r, CarState s, bool onGround, int wheels /* bit i: our wheel i touches */) {
	s.pos = Vec(r.p[0], r.p[1], r.p[2]);
	s.rotMat = RotMat(btMatrix3x3(btQuaternion(r.q[0], r.q[1], r.q[2], r.q[3])));
	s.vel = Vec(r.v[0], r.v[1], r.v[2]);
	s.angVel = Vec(r.w[0], r.w[1], r.w[2]);
	s.isOnGround = onGround;
	for (int i = 0; i < 4; i++) {
		s.wheelsWithContact[i] = (wheels >> i) & 1;
		s.wheelCarry.wheels[i].worldContact = s.wheelsWithContact[i] && onGround;
		s.wheelCarry.wheels[i].contactNormal = s.rotMat.up;
	}
	s.refreshInertia = true;
	return s;
}
static BallState BallFrom(const Rec& r) {
	BallState b;
	b.pos = Vec(r.p[0], r.p[1], r.p[2]);
	b.rotMat = RotMat(btMatrix3x3(btQuaternion(r.q[0], r.q[1], r.q[2], r.q[3])));
	b.vel = Vec(r.v[0], r.v[1], r.v[2]);
	b.angVel = Vec(r.w[0], r.w[1], r.w[2]);
	return b;
}
static float DistV(Vec a, Vec b) { return (a - b).Length(); }

// One tick from the recorded state first (the cars apart, the ball far), then the state set again: the wheels' values
// carried between ticks are then the ones this state gives, as in live_validate's per-tick runs
static void WarmUp(Arena* arena, Car* car, const Rec& r, bool onGround, int wheels, Vec shift = Vec()) {
	Rec w = r;
	for (int i = 0; i < 3; i++) w.p[i] += shift[i];
	car->SetState(CarFrom(w, car->GetState(), onGround, wheels));
}

// CCR-1: a car dropped across a parked car's roof (live `car_car` 2026-10-08 04:17, segment 4: rows 492 -> 585, run
// on from row 492 without resetting). Both back wheels bottom out on the lower car's roof: each wheel's pushback
// (resolveSingleCollision against the lower car, which gets the opposite impulse at once) and its 1.0 push read the
// lower car's velocity after the wheels before it, in the game's order (front left, front right, back left, back right).
static void TestRoofLanding() {
	puts("CCR-1: a car landing across another's roof (live car_car rows 492-585, run on)");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	Car* bot = arena->AddCar(Team::ORANGE, CAR_CONFIG_OCTANE);
	CarConfig c = car->config; (void)c;
	BallState far; far.pos = Vec(3000, -2000, 92.75f); arena->ball->SetState(far);
	arena->Step(4); // (ticks before the scenario: none of this tick-count dependent)
	const Rec carRow = { { 2.69739849e-06f, 2.69739849e-06f, 0.707106829f, 0.707106829f }, { 0, 0, 249.819992f }, { 0, 0, -13.5310001f }, { 0, 0, 0 } };
	const Rec botRow = { { 0.000126777712f, 0.000666257343f, -2.42765836e-05f, 0.999999762f }, { 0.00999999978f, 0, 17.039999f },
	                     { 1.51100004f, -0.0710000023f, 1.90100002f }, { 0.0120099997f, 0.0890099928f, -0.00160999992f } };
	car->SetState(CarFrom(carRow, car->GetState(), false, 0));
	bot->SetState(CarFrom(botRow, bot->GetState(), true, 15));
	car->controls = bot->controls = CarControls();
	// The recorded velocities (uu/s) at rows 581-585 (the landing: the back wheels bottom out from 580, the bodies
	// touch from 582)
	struct Want { int row; Vec carVel, botVel; };
	const Want want[] = {
		{ 581, { 1.671f, 36.0009995f, -282.381012f }, { -10.0410004f, -1.43099999f, -18.0509987f } },
		{ 582, { 1.66100001f, 38.0109978f, -267.181f }, { -0.370999992f, -2.16099977f, -16.6209984f } },
		{ 583, { 2.07099986f, 79.1009979f, -139.201004f }, { 2.02099991f, -41.4510002f, -125.480995f } },
		{ 584, { 1.98099995f, 81.1909943f, -101.431f }, { 2.01099992f, -42.230999f, -84.9710007f } },
		{ 585, { 1.671f, 83.8610001f, -70.3409958f }, { -0.550999999f, -40.8209991f, -53.5709991f } },
	};
	int row = 492;
	for (const Want& w : want) {
		arena->Step(w.row - row);
		row = w.row;
		float eCar = DistV(car->GetState().vel, w.carVel), eBot = DistV(bot->GetState().vel, w.botVel);
		printf("    row %d: car %.4f, lower car %.4f uu/s off\n", w.row, eCar, eBot);
		// (0.0000 at every row; the push before the contact pass gives 0.06-0.07 from row 581: RV-224)
		CHECK(eCar < 0.01f && eBot < 0.01f, "row %d: car %.4f, lower car %.4f uu/s from the game", w.row, eCar, eBot);
	}
	delete arena;
}

// CCR-2: the bump's up push along the victim's up as the game's GetBumpImpulse takes it,
// GetRotatorAxis(QuatToRotator(OldRBState.Quaternion), 2): the rotator's whole units and the 16384-entry sine table.
// Live `car_car` row 110 -> 111 (a side bump at 1400): the parked bot's up is 0.0097 off vertical in x; the exact axis
// pushes 2.70 uu/s along x, the rotator's 2.79 (the game: 2.751 + 0.035 from the step)
static void TestBumpUpRotator() {
	puts("CCR-2: the bump's up push through the victim's rotator (live car_car row 110 -> 111)");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	Car* bot = arena->AddCar(Team::ORANGE, CAR_CONFIG_OCTANE);
	BallState far; far.pos = Vec(3000, -2000, 92.75f); arena->ball->SetState(far);
	arena->Step(4);
	const Rec carRow = { { -0.00339062954f, 0.00339062954f, 0.707101345f, 0.707095981f }, { 0, -108.009995f, 17 }, { 0, 1410.01099f, 0.370999992f }, { 0, 0, 0 } };
	const Rec botRow = { { -1.88817903e-05f, 0.00482564606f, 1.34869933e-05f, 0.999988437f }, { 0.119999997f, 0, 17.0200005f },
	                     { -0.0109999999f, 0, 0.120999999f }, { 0.000309999974f, -0.000609999988f, 0 } };
	// The bump's own velocity change: the tick with bumps on, less the same tick with the bump force scaled to 0
	auto run = [&](float bumpScale) {
		MutatorConfig m = arena->GetMutatorConfig();
		m.bumpForceScale = bumpScale;
		arena->SetMutatorConfig(m);
		car->controls = CarControls(); car->controls.throttle = 1;
		bot->controls = CarControls();
		WarmUp(arena, car, carRow, true, 15);
		WarmUp(arena, bot, botRow, true, 15, Vec(1500, 0, 0));
		arena->Step(1);
		car->SetState(CarFrom(carRow, car->GetState(), true, 15));
		bot->SetState(CarFrom(botRow, bot->GetState(), true, 15));
		arena->Step(1);
		Vec v = bot->GetState().vel;
		car->SetState(CarFrom(carRow, car->GetState(), true, 15)); // (apart again for the next run's cooldown)
		bot->SetState(CarFrom(botRow, bot->GetState(), true, 15));
		car->SetState([&] { CarState s = car->GetState(); s.pos = s.pos + Vec(0, -2000, 0); return s; }());
		arena->Step(40);
		return v;
	};
	Vec without = run(0), with = run(1);
	Vec bump = with - without;
	// The game's: its velocity after the tick (2.751, 1890.171, 279.821) less what the engine's own step gives without
	// the bump in the per-tick validator (x -0.0351): x 2.786 +- 0.01 (rows are truncated to 0.01, then +0.001)
	printf("    bump (%.4f %.4f %.4f) uu/s; the game's x 2.786 (the rotator's 2.7896, the exact axis' 2.7003)\n", bump.x, bump.y, bump.z);
	CHECK(fabsf(bump.x - 2.786f) < 0.015f, "bump x %.4f", bump.x);
	CHECK(fabsf(bump.y - 1116.3f) < 0.2f && fabsf(bump.z - 279.79f) < 0.05f, "bump (%.3f %.3f %.3f)", bump.x, bump.y, bump.z);
	delete arena;
}

// CCR-3: the ball hit's forward adjustment along the car's forward as ApplyBallImpactForces takes it,
// GetRotatorAxis(QuatToRotator(OldRBState.Quaternion), 0). Live `ball_hits` row 351 -> 352 (boosting at 2221 into a
// resting ball): the ball's z velocity 0.18 uu/s off with the exact axis
static void TestBallHitForwardRotator() {
	puts("CCR-3: the ball hit's forward through the car's rotator (live ball_hits row 351 -> 352)");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	BallState far; far.pos = Vec(3000, -2000, 92.75f); arena->ball->SetState(far);
	arena->Step(4);
	const Rec carRow = { { -0.00341760367f, 0.00341220875f, 0.707101107f, 0.707095981f }, { 0, -1143.71997f, 17 }, { 0, 2221.26099f, 0.130999997f },
	                     { 0.000609999988f, 0.000109999994f, 0 } };
	const Rec ballRow = { { -0.488438636f, 0.605203867f, -0.426085323f, -0.462176681f }, { 0, -1000, 92.75f }, { 0, 0, 0 }, { 0, 0, 0 } };
	car->controls = CarControls(); car->controls.throttle = 1; car->controls.boost = true;
	WarmUp(arena, car, carRow, true, 15);
	arena->Step(1);
	CarState s = CarFrom(carRow, car->GetState(), true, 15);
	s.boost = 100;
	car->SetState(s);
	arena->ball->SetState(BallFrom(ballRow));
	car->controls = CarControls(); car->controls.throttle = 1; car->controls.boost = true;
	arena->Step(1);
	Vec cv = car->GetState().vel, cgame(0, 1963.10095f, -98.3509979f);
	printf("    car (%.4f %.4f %.4f), the game's (%.4f %.4f %.4f)\n", cv.x, cv.y, cv.z, cgame.x, cgame.y, cgame.z);
	Vec v = arena->ball->GetState().vel, game(-0.0109999999f, 2781.54102f, 927.300964f);
	printf("    ball (%.4f %.4f %.4f), the game's (%.4f %.4f %.4f)\n", v.x, v.y, v.z, game.x, game.y, game.z);
	CHECK(DistV(v, game) < 0.05f, "%.4f uu/s off", DistV(v, game)); // (the car itself 0.02 off in this fresh arena: per tick in live_validate the ball is 0.0003 off)
	delete arena;
}

// RV-232/233: the demolition sweep as the game's GetTimeOfImpact computes it: its start-of-tick inputs (L and V x 0.02,
// the quaternion), the location lerp, UE3's SlerpQuat and quaternion matrix, the 2.82 penetration solver. The static
// session's cases (DSW1 harness, game replica; exact bits): each gave the engine a different rotator, fraction, cone
// decision or hit before
static void TestDemoSweep() {
	puts("demolition sweep (GetTimeOfImpact) as the game's arithmetic: twelve of the static session's cases bit for bit (RV-232, RV-233, RV-245)");
	auto f = [](uint32_t u) { float x; memcpy(&x, &u, sizeof x); return x; };
	auto bitsOf = [](float x) { uint32_t u; memcpy(&u, &x, sizeof u); return u; };
	struct CarIn { int preset; uint32_t pos[3], vel[3], ang[3], q[4]; };
	struct Want { int id; bool hit; uint32_t fraction; int rot0[3], rot1[3]; bool cone; uint32_t loc0[3]; };
	struct Case { CarIn car[2]; Want want; };
	const Case cases[] = {
		// (slow rotation: Bullet's slerp kept the start orientation; ours [504, -17641, 179] / [-571, 3984, -121])
		{ { { 2, { 0xc460a147, 0xc4888947, 0x4461351e }, { 0xc4fa1bdf, 0xc4861bdf, 0x431da419 }, { 0x3cd1cc10, 0xbd7d9556, 0x3c586ec1 }, { 0x3cc06668, 0x3c1eca27, 0x3f3f8f48, 0xbf29b391 } },
		    { 0, { 0xc46b4999, 0xc47705c2, 0x44639999 }, { 0x44c3366e, 0xc4c3e578, 0x435ccd0e }, { 0xbce7ea5f, 0xbbd551d6, 0xbd186983 }, { 0x39cd0f9d, 0x3ce52b6b, 0x3e41fd06, 0x3f7b4326 } } },
		  { 435, true, 0x3f011780, { 501, -17640, 174 }, { -572, 3981, -119 }, false, { 0xc460aa60, 0xc4888bb8, 0x446135d6 } } },
		// (the location lerp: ours was 1 ulp off in x)
		{ { { 0, { 0x44bdb4cd, 0xc5818fc2, 0x44884f0a }, { 0x43f3ee35, 0xc4f3e2e9, 0xc2b99f3b }, { 0x3ed1f9f0, 0x404ae315, 0x40349bd0 }, { 0x3ce5b32d, 0x3bf108f7, 0xbf1d8e69, 0x3f49a2bb } },
		    { 0, { 0x44b5970a, 0xc58556f6, 0x4486d9eb }, { 0, 0, 0 }, { 0xb8e6afcc, 0x38e6afcc, 0xb8e6afcc }, { 0x3cd54dca, 0xbaddad90, 0x3f42d6df, 0xbf25eb2f } } },
		  { 17, true, 0x3edcf36d, { -467, -13860, -402 }, { 391, -18046, 379 }, true, { 0x44bda2fd, 0xc5817df4, 0x4488526d } } },
		// (the inputs' round trip moved the fraction most: ours 0x3f699946)
		{ { { 3, { 0x4523d199, 0xc57fcb85, 0x44a390a4 }, { 0x4369e6a8, 0xc3b7853f, 0xc299d26e }, { 0x3ea3a3ec, 0x3f1dd399, 0xbe59b66f }, { 0x3b9c5be7, 0xbbf9584e, 0x3e98f323, 0x3f744cb6 } },
		    { 3, { 0x45223f85, 0xc5828229, 0x449f5666 }, { 0xc4d22b3b, 0xc4868b8d, 0xc0cb8d4f }, { 0x3cce8534, 0x3e48198f, 0x3e6feef5 }, { 0xbb96b3bf, 0xbc6f0c06, 0x3f4cf847, 0xbf1952c3 } } },
		  { 32333, true, 0x3f7033ea, { 156, 6311, -94 }, { -257, -19355, 201 }, false, { 0x4523ecf0, 0xc57ff66b, 0x44a37ea9 } } },
		// (the game hits, f 0.0910, and demolishes; ours missed)
		{ { { 5, { 0xc41b4333, 0x4587cab8, 0x432a23d7 }, { 0x44e7694f, 0x44957712, 0xc2842e97 }, { 0, 0, 0 }, { 0xbc126a7e, 0x3c54e27d, 0x3e90d385, 0x3f758305 } },
		    { 3, { 0xc4128852, 0x458c0599, 0x432b3d70 }, { 0xc2e69a1c, 0x44579343, 0x42bba978 }, { 0x3f8e9b28, 0xbf3518d2, 0x3fa47b35 }, { 0xbba25e90, 0x3abd26ac, 0x3f5d7058, 0x3f0072e4 } } },
		  { 34002, true, 0x3dba7642, { -313, 5982, 102 }, { -149, 21712, -57 }, true, { 0xc41e6ac4, 0x45878984, 0x432a9728 } } },
		// (the cone: the game's 0, ours 1)
		{ { { 3, { 0x448a26b8, 0x45228b0a, 0x441880a4 }, { 0x423acdd3, 0x4297245a, 0xc0d85a1c }, { 0xbd244a62, 0x3d4302b3, 0x3ce4a383 }, { 0x3f590ba3, 0x3ef6dd8f, 0x3d969902, 0x3e55104b } },
		    { 4, { 0x44933b33, 0x4523ff0a, 0x441bf0a4 }, { 0xc4a50e6e, 0xc39519ba, 0x432a59db }, { 0xbc1bcfd4, 0xbd0cf17f, 0xbd6b8f9a }, { 0x3f086fda, 0x3e992c69, 0x3e7a248c, 0x3f40bace } } },
		  { 92490, true, 0x3eff24d1, { -793, 10610, -28190 }, { -1995, 8080, -13666 }, false, { 0x448a26ad, 0x45228b01, 0x441880a7 } } },
		// (an overlapping start: 2.82's EPA hits at 0, 3.24's missed)
		{ { { 2, { 0xc4cdba3d, 0xc58a6ab8, 0x44891666 }, { 0xc2b99a1c, 0xc3cf47cf, 0xc1102d0f }, { 0x3d9e2046, 0x3e0a8eb4, 0x3e510236 }, { 0x3c3252d0, 0xbcfa4b74, 0x3f47a86b, 0xbf200308 } },
		    { 0, { 0xc4d5e852, 0xc5893370, 0x448a4dc2 }, { 0xc4ceea45, 0x4415acdd, 0xc34e30e6 }, { 0, 0xb8e6afcc, 0xb8e6afcc }, { 0x3ca49a15, 0x3c9f1f2f, 0x3f7ddb01, 0x3e012215 } } },
		  { 38047, true, 0x00000000, { -217, -18698, 627 }, { 365, 30121, -455 }, false, { 0xc4cda17c, 0xc58a4f14, 0x448918cc } } },
		// (SlerpQuat's linear branch at |dot| >= 0.9999; also the normalisation by a reciprocal: RV-245)
		{ { { 3, { 0xc4017c29, 0x454649c2, 0x449662e1 }, { 0, 0, 0 }, { 0xbeec8c93, 0xbef02f30, 0x3e1f7271 }, { 0x3f135f4d, 0x3f473227, 0x3e5978de, 0x3e098d59 } },
		    { 0, { 0xc40927ae, 0x454d1452, 0x449a028f }, { 0x4422ac39, 0xc3ae7b02, 0xc393720c }, { 0xbdd49a56, 0xbe401cd6, 0xbdde6eeb }, { 0xbea16b21, 0xbe9f20ef, 0x3f634127, 0x3e016d0a } } },
		  { 10822, true, 0x3f49a332, { 341, 19585, -27465 }, { -5247, 27546, 8390 }, true, { 0xc4017c29, 0x454649c1, 0x449662e0 } } },
		{ { { 2, { 0xc488a852, 0x44d5e147, 0x43d4c3d7 }, { 0x440f67be, 0xc50a1a41, 0xc2832e97 }, { 0x3f0be187, 0x3e1eef5e, 0x3f00a47f }, { 0x3c2d052b, 0x3c23a6a9, 0xbf1c9fc2, 0x3f4a7666 } },
		    { 1, { 0xc470a1eb, 0x44d3751e, 0x43d350a4 }, { 0xc504adef, 0x43f3a168, 0xc3aa8021 }, { 0, 0, 0 }, { 0x3c8571eb, 0xbc375cc1, 0x3f79ee5d, 0xbe5cb86a } } },
		  { 5718, true, 0x3efb673d, { -299, -13735, -47 }, { 281, -28231, 301 }, false, { 0xc488ab11, 0x44d5ebdc, 0x43d4c519 } } },
		// (the normalisation as 1 / sqrt, times)
		{ { { 5, { 0x4445ef5c, 0x440178f6, 0x44769000 }, { 0xc4a60dca, 0x448e6a97, 0x3ed26e97 }, { 0xba8461f9, 0x3a54562e, 0x3ae02213 }, { 0xbbbe1fed, 0xbc8352c6, 0x3f700cec, 0x3eb1ae96 } },
		    { 1, { 0x4441270a, 0x44225eb8, 0x447780a3 }, { 0x4502a456, 0xc45a6c39, 0x4222d810 }, { 0x3f8f76b4, 0xbf0b6502, 0xbf83d0d0 }, { 0xbc5a1954, 0x3b2dc580, 0x3f5d1497, 0x3f010652 } } },
		  { 9109, true, 0x3e961ce2, { 3, 25374, 356 }, { -293, 21785, 55 }, true, { 0x44471469, 0x44007da0, 0x44768fe9 } } },
		// (the UE matrix's terms in their order)
		{ { { 1, { 0xc551b333, 0xc5896f33, 0x43f2a666 }, { 0, 0, 0 }, { 0x3deb2181, 0x3d982fd7, 0x4037ae3e }, { 0xbe9f4449, 0x3f2d8fa5, 0x3ef99998, 0x3ee85849 } },
		    { 0, { 0xc554b91e, 0xc58b627b, 0x43dbbd70 }, { 0xc41590b4, 0x4505282d, 0x43f999ba }, { 0xbf28cf18, 0xbfe16c0d, 0xbf0027fa }, { 0x3f4f5592, 0x3eeaabab, 0xbeb213b3, 0xbde9a936 } } },
		  { 11318, true, 0x3f06ed0c, { -12146, 32235, -19400 }, { -4971, 12308, 26492 }, false, { 0xc551b332, 0xc5896f32, 0x43f2a665 } } },
		// (location not given: not checked)
		{ { { 5, { 0x43bafc29, 0x44a73e14, 0x446a11eb }, { 0xc4114b95, 0x44fc6431, 0xc440a343 }, { 0xc088fc65, 0x3fa47e7c, 0xc0444356 }, { 0x3e5eaa38, 0x3f077f14, 0x3f176356, 0x3f1176af } },
		    { 1, { 0x43ebdc29, 0x449d0d1e, 0x446bd1eb }, { 0xc42bfaf1, 0x438303f8, 0x44843bdf }, { 0, 0, 0 }, { 0x3f65f427, 0xbb8ffc10, 0xbe06af5e, 0x3ed6af06 } } },
		  { 26253, true, 0x3ec70cc0, { -3594, 19349, -12407 }, { -2449, -1271, -23507 }, false, { 0, 0, 0 } } },
		// (the impact's matrix: Bullet's basis gave the second car yaw 23219)
		{ { { 0, { 0x44c18800, 0x452bc8f6, 0x435951eb }, { 0x43f743f8, 0x4507be18, 0xc23bb958 }, { 0x3d193b3a, 0x3d01797c, 0x3d806e19 }, { 0xbb9bd423, 0x3c1e9ce6, 0x3f1fa6c0, 0x3f48197b } },
		    { 3, { 0x44b25429, 0x452ccf33, 0x437bd1eb }, { 0x44ed3a45, 0xc3c19d91, 0x42d761ca }, { 0, 0, 0x38e6afcc }, { 0x3b88e9df, 0xbc10d334, 0x3f65a18e, 0x3ee244a6 } } },
		  { 4828, true, 0x3f693180, { -218, 14053, -51 }, { 160, 23220, 127 }, false, { 0x44c1f461, 0x452cb6f2, 0x4358ffa3 } } },
	};
	const CarConfig* presets[] = { &CAR_CONFIG_OCTANE, &CAR_CONFIG_DOMINUS, &CAR_CONFIG_PLANK, &CAR_CONFIG_BREAKOUT, &CAR_CONFIG_HYBRID, &CAR_CONFIG_MERC };
	for (const Case& c : cases) {
		Arena* arena = Arena::Create(GameMode::SOCCAR);
		Car* cars[2];
		for (int k = 0; k < 2; k++) {
			const CarIn& in = c.car[k];
			cars[k] = arena->AddCar(k == 0 ? Team::BLUE : Team::ORANGE, *presets[in.preset]);
			PhysState& s = cars[k]->_oldState;
			s.pos = Vec(f(in.pos[0]), f(in.pos[1]), f(in.pos[2]));
			s.vel = Vec(f(in.vel[0]), f(in.vel[1]), f(in.vel[2]));
			s.angVel = Vec(f(in.ang[0]), f(in.ang[1]), f(in.ang[2]));
			cars[k]->_oldQuat = btQuaternion(f(in.q[0]), f(in.q[1]), f(in.q[2]), f(in.q[3]));
			s.rotMat = UEQuatRotMat({ f(in.q[0]), f(in.q[1]), f(in.q[2]), f(in.q[3]) });
		}
		PhysState impact[2];
		float fraction = Arena::SweepToImpact(cars[0], cars[1], arena->tickTime, impact[0], impact[1]);
		bool cone = Arena::DemoConeAtImpact(cars[0], cars[1], arena->tickTime, false);
		const Want& w = c.want;
		GameRotator r0 = UERotatorFromMatrix(impact[0].rotMat), r1 = UERotatorFromMatrix(impact[1].rotMat);
		uint32_t loc[3] = { bitsOf(impact[0].pos.x), bitsOf(impact[0].pos.y), bitsOf(impact[0].pos.z) };
		bool unchecked = w.loc0[0] == 0 && w.loc0[1] == 0 && w.loc0[2] == 0;
		bool ok = (fraction < 1) == w.hit && bitsOf(fraction) == w.fraction && cone == w.cone &&
			r0.pitch == w.rot0[0] && r0.yaw == w.rot0[1] && r0.roll == w.rot0[2] && r1.pitch == w.rot1[0] && r1.yaw == w.rot1[1] && r1.roll == w.rot1[2] &&
			(unchecked || (loc[0] == w.loc0[0] && loc[1] == w.loc0[1] && loc[2] == w.loc0[2]));
		CHECK(ok, "case %d: fraction 0x%08x (want 0x%08x), rotators [%d, %d, %d] / [%d, %d, %d], cone %d, location {0x%08x, 0x%08x, 0x%08x}",
			w.id, bitsOf(fraction), w.fraction, r0.pitch, r0.yaw, r0.roll, r1.pitch, r1.yaw, r1.roll, cone, loc[0], loc[1], loc[2]);
		delete arena;
	}
}

// RV-232: the start-of-tick state (OldRBState) as the game's read-back makes it: the location rounded to 0.01 uu and the
// velocities quantised, in uu (exact fixed points of the rounding, not the body's x50 of its x0.02), the quaternion the
// quantised one, the rotation its UE matrix
static void TestOldStateReadBack() {
	puts("the start-of-tick state as the game's read-back: rounded location and velocities in uu, the quantised quaternion, the ball's velocity (RV-232, RV-244)");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	car->SetState(CarAt({ 100.37f, -1200.11f, 17.01f }, Vec(1, 0.3f, 0).Normalized(), { 0, 0, 1 }, { 830.3f, 410.7f, 0 }));
	car->controls.throttle = 1;
	car->controls.steer = 0.4f;
	car->controls.boost = true;
	BallState ball;
	ball.pos = { -300.37f, 200.11f, 400.5f };
	ball.vel = { 410.3f, -230.7f, 120.1f };
	arena->ball->SetState(ball);
	int ticks = 0, offLocation = 0, offVelocity = 0, offRotation = 0;
	for (int t = 0; t < 240; t++) {
		if (t == 60)
			car->controls.jump = true; // (into the air, spinning)
		if (t == 70) {
			car->controls.jump = false;
			car->controls.pitch = 0.5f;
			car->controls.yaw = 0.3f;
			car->controls.roll = 0.2f;
		}
		btQuaternion q = Quantize::Unpack(car->_netRotation); // (as the tick starts: the last tick's rounding)
		arena->Step(1);
		if (t < 1)
			continue; // (the first tick starts from a placed state)
		const PhysState& s = car->_oldState;
		for (int k = 0; k < 3; k++) {
			offLocation += Quantize::Location(s.pos[k]) != s.pos[k];
			offVelocity += Quantize::Velocity(s.vel[k], 100) != s.vel[k];
			offVelocity += Quantize::Velocity(s.angVel[k], 10000) != s.angVel[k];
		}
		RotMat m = UEQuatRotMat({ q.x(), q.y(), q.z(), q.w() });
		offRotation += memcmp(&m, &s.rotMat, sizeof m) != 0 || !(car->_oldQuat == q);
		// (the ball's too: its start-of-tick velocity for the hit, RV-244)
		for (int k = 0; k < 3; k++)
			offVelocity += Quantize::Velocity(arena->ball->_startOfTickVel[k], 100) != arena->ball->_startOfTickVel[k];
		ticks++;
	}
	// (the old capture, ((L x 0.02) x 50), missed the rounding's fixed point in about a quarter of the components)
	CHECK(offLocation == 0 && offVelocity == 0 && offRotation == 0, "over %d ticks: %d location, %d velocity components and %d rotations not the read-back's",
		ticks, offLocation, offVelocity, offRotation);
	delete arena;
}

// RV-245: the start-of-tick quaternion is the packed one the last rounding left, not the body's basis rounded again (a
// rotator 3 and 4 units apart for this one of the reviewer's 2M quaternions)
static void TestOldQuatFromPacked() {
	puts("the start-of-tick quaternion: the last rounding's packed one, not the basis rounded again (RV-245)");
	auto f = [](uint32_t u) { float x; memcpy(&x, &u, sizeof x); return x; };
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	btQuaternion q1(f(0x3e12531d), f(0x3f31898b), f(0x3e0828f6), f(0xbf3189a3));
	// (the packing that rounding left: y dropped, the largest before it; unpacked, w comes out a hair larger, so rounding
	// q1 again drops w instead)
	constexpr float ROT_MAX = 262143.f;
	Quantize::PackedRotation packed;
	packed.largest = 1;
	packed.valid = true;
	const float kept[3] = { q1.x(), q1.z(), q1.w() };
	for (int j = 0; j < 3; j++)
		packed.c[j] = (uint32_t)Quantize::RoundUE((kept[j] * 1.4142135f * 0.5f + 0.5f) * ROT_MAX);
	CHECK(Quantize::Unpack(packed) == q1, "the packing doesn't unpack to the quaternion");
	car->_netRotation = packed;
	car->_rigidBody.getWorldTransform().setBasis(btMatrix3x3(q1));
	car->_CaptureOldState();
	GameRotator r = UERotatorFromMatrix(car->_oldState.rotMat);
	CHECK(r.pitch == 16238 && r.yaw == 14335 && r.roll == 18428, "from the packed rotation: [%d, %d, %d] (expected [16238, 14335, 18428])", r.pitch, r.yaw, r.roll);
	car->_netRotation.valid = false; // (as after a placement: the basis rounded now)
	car->_CaptureOldState();
	r = UERotatorFromMatrix(car->_oldState.rotMat);
	CHECK(r.pitch == 16238 && r.yaw == 14338 && r.roll == 18432, "re-rounded: [%d, %d, %d] (the reviewer's [16238, 14338, 18432])", r.pitch, r.yaw, r.roll);
	delete arena;
}

// RV-232: QuatToRotator's matrix is UE's FQuatRotationTranslationMatrix (x2 = x + x), not Bullet's basis (2 / |q|^2): a
// unit apart in about 0.05 % of quaternions, as this one (found by a scan); the start-of-tick rotation and the sweep's
// impact rotation are made with it
static void TestUEQuatRotMat() {
	puts("QuatToRotator's matrix as UE's (x + x), not Bullet's (2 / |q|^2): a quaternion whose rotators differ (RV-232)");
	auto f = [](uint32_t u) { float x; memcpy(&x, &u, sizeof x); return x; };
	UEQuat q = { f(0x3ec1dbca), f(0x3bee773d), f(0xbf085dfc), f(0xbf41c171) };
	GameRotator ue = UERotatorFromMatrix(UEQuatRotMat(q));
	GameRotator bullet = UERotatorFromMatrix(RotMat(btMatrix3x3(btQuaternion(q.x, q.y, q.z, q.w))));
	CHECK(ue.pitch == -4206 && ue.yaw == 11279 && ue.roll == 7131, "UE's matrix: [%d, %d, %d] (expected [-4206, 11279, 7131])", ue.pitch, ue.yaw, ue.roll);
	CHECK(bullet.yaw == 11280 && bullet.roll == 7129, "Bullet's basis: [%d, %d, %d] (a unit or two off: [-4206, 11280, 7129])", bullet.pitch, bullet.yaw, bullet.roll);
}

// CCR-4: the demo cone as the game's (FUN_140f11c30 from Impact.Rotation = QuatToRotator): the hitbox centres are the
// location plus LocalCollisionOffset multiplied by the rotator matrix's rows (the transpose of the rotation), the axes
// from the rotator. A supersonic attacker (2250 uu/s) at yaw A, a parked victim at yaw B, (dx, dy) to the attacker's
// left and ahead: the two cases sit mid-way in 12 uu wide bands where the rules disagree
static void TestDemoConeCentres() {
	puts("CCR-4: the demo cone's hitbox centres with the offset times the transposed rotation");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* a = arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	Car* b = arena->AddCar(Team::ORANGE, CAR_CONFIG_OCTANE);
	BallState far; far.pos = Vec(3000, -4000, 92.75f); arena->ball->SetState(far);
	auto demolished = [&](float yawA, float yawB, float dx, float dy) {
		float ya = yawA * (float)M_PI / 180, yb = yawB * (float)M_PI / 180;
		Vec fa(cosf(ya), sinf(ya), 0), fb(cosf(yb), sinf(yb), 0), left = Vec(0, 0, 1).Cross(fa);
		CarState sa; sa.pos = Vec(0, 0, 17); sa.rotMat = RotMat(fa, left, Vec(0, 0, 1)); sa.vel = fa * 2250;
		sa.isSupersonic = true; sa.refreshInertia = true;
		CarState sb; sb.pos = Vec(0, 0, 17) + fa * dy + left * dx; sb.rotMat = RotMat(fb, Vec(0, 0, 1).Cross(fb), Vec(0, 0, 1));
		sb.refreshInertia = true;
		a->SetState(sa); b->SetState(sb);
		a->controls = b->controls = CarControls();
		for (int t = 0; t < 12 && !b->GetState().isDemoed; t++) arena->Step(1);
		bool d = b->GetState().isDemoed;
		arena->Step(1);
		CarState r = b->GetState(); r.isDemoed = false; b->SetState(r);
		r = a->GetState(); r.isDemoed = false; a->SetState(r);
		arena->Step(1);
		return d;
	};
	bool d1 = demolished(60, 0, -86, 180), d2 = demolished(30, 90, -91, 180);
	CHECK(d1, "attacker yaw 60, victim yaw 0, 86 uu to the right: the game's cone demolishes (RocketSim's: no)");
	CHECK(!d2, "attacker yaw 30, victim yaw 90, 91 uu to the right: the game's cone doesn't (RocketSim's: demolishes)");
	delete arena;
}


// RL PATCH (CCR-2..4): the game's rotators: QuatToRotator's whole units and FRotationMatrix's 16384-entry sine table
static void TestGameRotator() {
	puts("CCR-2..4: the game's rotators (QuatToRotator, the sine table)");
	CHECK(UESinTab(0) == 0 && UESinTab(0x4000) == 1.f && UESinTab(0x8000) == det_sinf(3.1415927f), "sine table ends");
	// The parked bot of live car_car row 110: rotator (-101, 0, 0); its up's x 0.00997033 (exact axis 0.0096512)
	RotMat m(btMatrix3x3(btQuaternion(-1.88817903e-05f, 0.00482564606f, 1.34869933e-05f, 0.999988437f)));
	GameRotator r = UERotatorFromMatrix(m);
	CHECK(r.pitch == -101 && r.yaw == 0 && r.roll == 0, "rotator (%d %d %d)", r.pitch, r.yaw, r.roll);
	RotMat g = GameRotatorBasis(m);
	CHECK(fabsf(g.up.x - 0.00997033f) < 1e-7f && g.up.y == 0, "up (%.8f %.8f %.8f)", g.up.x, g.up.y, g.up.z);
	// The cone's centre: the offset times the rows (yaw 90: the Octane's 13.88 forward lands behind the origin)
	RotMat yaw90 = UERotationMatrix({ 0, 0x4000, 0 });
	Vec c = GameConeCentre(Vec(0, 0, 17), yaw90, Vec(13.87566f, 0, 20.754988f));
	CHECK(fabsf(c.x) < 1e-5f && fabsf(c.y + 13.87566f) < 1e-4f && fabsf(c.z - 37.754988f) < 1e-4f, "centre (%f %f %f)", c.x, c.y, c.z);
}

static void TestMatchEndPatches() {
	puts("the match's end: a frozen arena simulates nothing (ticks count), a car placed on a podium spot; pickups and the scoring speed recorded");
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	CarState s = CarAt(Vec(0, -1000, 17), { 1, 0, 0 }, { 0, 0, 1 });
	s.vel = Vec(1000, 0, 0);
	car->SetState(s);
	BallState b;
	b.pos = Vec(0, 0, 500);
	b.vel = Vec(300, 0, 0);
	arena->ball->SetState(b);
	arena->frozen = true;
	uint64_t tick = arena->tickCount;
	arena->Step(100);
	CHECK(arena->tickCount == tick + 100, "ticks still count: %llu", (unsigned long long)(arena->tickCount - tick));
	Vec carAt = car->GetState().pos, ballAt = arena->ball->GetState().pos;
	CHECK(carAt.x == 0 && carAt.y == -1000 && carAt.z == 17 && ballAt.x == 0 && ballAt.z == 500, "nothing moved");
	arena->frozen = false;
	arena->Step(1);
	CHECK(car->GetState().pos.x > 0 && arena->ball->GetState().pos.x > 0, "runs again");
	// (InitPodiumCars' spot: the MVP's, yaw 16384 + 6248 units, full boost)
	float yaw = (16384 + 6248) * (float)(M_PI * 2 / 65536);
	car->_RespawnAt(Vec(-40, -1670, 0), yaw, 100);
	arena->Step(1);
	CarState placed = car->GetState();
	CHECK(Near(placed.pos.x, -40, 1) && Near(placed.pos.y, -1670, 1) && placed.boost == 100, "at (%.1f, %.1f) boost %.0f", placed.pos.x, placed.pos.y, placed.boost);
	Vec forward = placed.rotMat.forward;
	CHECK(Near(atan2f(forward.y, forward.x), yaw, 1e-3f), "facing %.4f, not %.4f", atan2f(forward.y, forward.x), yaw);
	// A pad picked up: recorded with its car and size for that tick only; none at full boost
	CarState onPad = CarAt(Vec(3584, 0, 17), { 1, 0, 0 }, { 0, 0, 1 });
	onPad.boost = 10;
	car->SetState(onPad);
	arena->Step(1);
	CHECK(arena->boostPickups.size() == 1 && arena->boostPickups[0].first == car->id && arena->boostPickups[0].second, "a big pad's pickup");
	arena->Step(1);
	CHECK(arena->boostPickups.empty(), "only the tick's");
	CarState full = CarAt(Vec(-3584, 0, 17), { 1, 0, 0 }, { 0, 0, 1 });
	full.boost = 100;
	car->SetState(full);
	arena->Step(1);
	CHECK(arena->boostPickups.empty(), "full: no pickup");
	// The ball's speed as it scored (before the explosion stops it)
	BallState shot;
	shot.pos = Vec(0, 5100, 300);
	shot.vel = Vec(0, 2500, 0);
	arena->ball->SetState(shot);
	for (int i = 0; i < 20 && !arena->ball->_internalState.isExploded; i++)
		arena->Step(1);
	CHECK(arena->ball->_internalState.isExploded && arena->goalBallSpeed > 2400 && arena->goalBallSpeed < 2600, "scored at %.1f", arena->goalBallSpeed);
	delete arena;
}

int main(int argc, char** argv) {
	std::string meshes = argc > 1 ? argv[1] : ARENA_MESH_DIR;
	RocketSim::Init(meshes, true);

	TestGoalBodyOrigins();
	TestPresetBoxes();
	TestQuantize();
	TestBumpCurves();
	TestBoostPads();
	TestImpacts();
	TestImpactSurfaceNormal();
	TestImpactFilters();
	TestLateCarMeetsBall();
	TestBallImpacts();
	TestRespawn();
	TestSpawnCount();
	TestSpawnHeights();
	TestKickoffSequence();
	TestKickoffUnevenTeams();
	TestFreeplayKickoff();
	TestNoPickupAtFullBoost();
	TestRespawnsHeld();
	TestGoalExplosion();
	TestGoalExplosionRespawn();
	TestGoalExplosionLocation();
	TestBallRotation();
	TestBallExplodesOnGoal();
	TestDemoSpawnSelection();
	TestKickoffBall();
	TestKickoffCountdown();
	TestCountdownHeldJump();
	TestXYLockSnapshots();
	TestComponentsOff();
	TestKickoffManyOnOneTeam();
	TestGameRotator();
	TestMatchEndPatches();
	TestRoofLanding();
	TestBumpUpRotator();
	TestBallHitForwardRotator();
	TestDemoConeCentres();
	TestDemoSweep();
	TestOldStateReadBack();
	TestUEQuatRotMat();
	TestOldQuatFromPacked();

	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE);
	arena->ball->SetState(BallState()); // ball at kickoff, out of the way

	TestQuantizeInSim(arena);
	arena->ball->SetState(BallState());
	TestFlipCancelLock(arena, car);
	TestDodgeTorque(arena, car);
	TestDodgeThreshold(arena, car);
	TestSensitivity(arena, car);
	TestDodgeDeadzone(arena, car);
	TestAirPitchSafety(arena, car);
	TestAirThrottleWhileBoosting(arena, car);
	TestDodgePitchLockAfterLanding(arena, car);
	TestAutoFlip(arena, car);
	TestAutoFlipContactNormal(arena, car);
	TestBoostSetsThrottle(arena, car);
	TestThrottleDeadzone(arena, car);
	TestJumpRepress(arena, car);
	TestDodgeDirectionNormalised(arena, car);
	TestAirThrottleBoostLag(arena, car);
	TestFlipResetCounter(arena, car);
	TestAckermann(arena, car);
	TestSuspensionScale(arena);
	TestVehicleUpdate(arena, car);
	TestBallHitStartOfTick(arena, car);
	TestInputQuantization(arena, car);
	TestSleeping(arena, car);
	TestSupersonic(arena, car);
	TestRocketSimAudit(arena, car);
	arena->ball->SetState(BallState());
	arena->ball->SetState(BallState());

	Car* victim = arena->AddCar(Team::ORANGE);
	arena->ball->SetState([] { BallState b; b.pos = { 0, -4000, 93.15f }; return b; }());
	TestBumpCone(arena, car, victim);
	TestDemos(arena, car, victim);
	TestDemoBothWays(arena, car, victim);
	TestBumpCooldown(arena, car, victim);
	arena->RemoveCar(victim);
	arena->RemoveCar(car);

	TestSolverAndOneSided(arena);

	printf("\n%d checks, %d failed\n", checks, failures);
	return failures ? 1 : 0;
}
