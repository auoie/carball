// Tests for the Rocket League patches applied to the vendored RocketSim (engine/rocketsim, "RL PATCH").
// Each test checks one verified difference from notes/physics-values.md.
//
// Usage: rl_patch_tests [collision_meshes dir]   (default: ARENA_MESH_DIR from CMake)
#include "RocketSim.h"
#include "Sim/Quantize/Quantize.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
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
	for (int i = 0; i < 3; i++)
		CHECK(Near(noCancel[i].y, cancel[i].y, 1e-4f), "torque tick %d: cancelled too early (%.4f vs %.4f)", i + 1, cancel[i].y, noCancel[i].y);
	// (by tick 4 the flip is already at the 5.5 rad/s cap, so the cancel shows as a small difference)
	CHECK(fabsf(cancel[3].y - noCancel[3].y) > 0.05f, "torque tick 4: cancel had no effect (%.4f vs %.4f)", cancel[3].y, noCancel[3].y);
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
	puts("steering: per-wheel Ackermann angles");
	car->SetState(CarAt({ 0, -2000, 17 }, { 1, 0, 0 }, { 0, 0, 1 }));
	car->controls = CarControls();
	car->controls.steer = 1;
	arena->Step();
	float L = car->config.frontWheels.connectionPointOffset.x - car->config.backWheels.connectionPointOffset.x;
	float W = car->config.frontWheels.connectionPointOffset.y * 2;
	float inner = 35 * DEG, outer = atanf(L / (W + L / tanf(inner)));
	float w0 = car->_bulletVehicle.m_wheelInfo[0].m_steerAngle, w1 = car->_bulletVehicle.m_wheelInfo[1].m_steerAngle;
	CHECK(Near(w0, inner, 1e-4f) && Near(w1, outer, 1e-4f), "steer +1: %.4f %.4f, expected %.4f %.4f", w0, w1, inner, outer);
	CHECK(Near(outer, 26.157f * DEG, 1e-3f), "Octane outer wheel %.3f deg", outer / DEG);
	CHECK(Near((inner + outer) / 2, 0.53356f, 2e-4f), "average %.5f should equal stock RocketSim's 0.53356", (inner + outer) / 2);
	car->controls.steer = -1;
	arena->Step();
	w0 = car->_bulletVehicle.m_wheelInfo[0].m_steerAngle; w1 = car->_bulletVehicle.m_wheelInfo[1].m_steerAngle;
	CHECK(Near(w0, -outer, 1e-4f) && Near(w1, -inner, 1e-4f), "steer -1: %.4f %.4f", w0, w1);
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

int main(int argc, char** argv) {
	std::string meshes = argc > 1 ? argv[1] : ARENA_MESH_DIR;
	RocketSim::Init(meshes, true);

	TestQuantize();
	TestBumpCurves();

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
	TestAutoFlip(arena, car);
	TestAckermann(arena, car);
	TestSuspensionScale(arena);

	Car* victim = arena->AddCar(Team::ORANGE);
	arena->ball->SetState([] { BallState b; b.pos = { 0, -4000, 93.15f }; return b; }());
	TestBumpCone(arena, car, victim);
	TestDemos(arena, car, victim);
	arena->RemoveCar(victim);
	arena->RemoveCar(car);

	TestSolverAndOneSided(arena);

	printf("\n%d checks, %d failed\n", checks, failures);
	return failures ? 1 : 0;
}
