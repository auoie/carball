// Our engine against recordings of the real game (tools/physlog, a BakkesMod plugin, offline modes only).
//
// A recording has one row per physics tick: the car's and the ball's state when the game sets the car's input (before
// the tick's physics), and that input. Every tick, the engine is given the recorded car and ball state (its own
// internal state carries on: wheel values, jump and flip timers, handbrake), steps with the recorded input, and is
// compared with the next row. --continuous lets the engine run on from its own state instead (resynced only where the
// recording jumps, e.g. a scenario placing the car again), to see how far it drifts.
//
// It first prints what the recording looks like: the tick spacing, the angular velocity units (from the change of the
// quaternions), and whether a row's state is the start of its tick (position change against the velocities).
//
// Usage: live_validate LOG.csv [--continuous] [--preset NAME] [--ticks OUT.csv] [--meshes DIR]
//        live_validate LOG.csv --fit-steer [--preset NAME]   (per grounded tick, the steer our engine needs)
//        live_validate --synth SCENARIO.txt OUT.csv [--preset NAME]   (a recording made by our own engine, for testing)
//   presets: octane dominus plank breakout hybrid merc (default: from the recording's hitbox)
//   --steer-sensitivity X, --air-sensitivity X: the player's settings (default: from the recording's header, else 1)
//   --contacts FROM-TO: print the car's contact points (depth, lifetime, applied impulse) after those ticks
#include "RocketSim.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using namespace RocketSim;

struct Body {
	Vec pos, vel, angVel;
	RotMat rot;
	float quat[4] = { 0, 0, 0, 1 };
};

struct Row {
	uint64_t tick = 0;
	double time = 0;
	Body car, ball;
	bool hasBall = false;
	CarControls in;
	bool onGround = false, jumped = false, doubleJumped = false, hasFlip = false, supersonic = false;
	int wheelContacts = 0;          // touching the arena
	bool wheelContact[4] = {};      // touching anything
	float boost = 0; // 0-1
	bool jumpActive = false, djActive = false, dodgeActive = false;
	float jumpTime = 0, djTime = 0, dodgeTime = 0;
};

struct Preset {
	const char* name;
	const CarConfig* config;
};
static const Preset PRESETS[] = {
	{ "octane", &CAR_CONFIG_OCTANE }, { "dominus", &CAR_CONFIG_DOMINUS }, { "plank", &CAR_CONFIG_PLANK },
	{ "breakout", &CAR_CONFIG_BREAKOUT }, { "hybrid", &CAR_CONFIG_HYBRID }, { "merc", &CAR_CONFIG_MERC },
};

static RotMat FromQuat(float x, float y, float z, float w) {
	return RotMat(
		Vec(1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)),
		Vec(2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)),
		Vec(2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)));
}

// The inverse of FromQuat (for writing recordings from our engine)
static void ToQuat(const RotMat& m, float q[4]) {
	// m.forward = (1-2(y²+z²), 2(xy+wz), 2(xz-wy)), m.right = (2(xy-wz), 1-2(x²+z²), 2(yz+wx)), m.up = (2(xz+wy), 2(yz-wx), 1-2(x²+y²))
	float trace = m.forward.x + m.right.y + m.up.z;
	float x, y, z, w;
	if (trace > 0) {
		float s = sqrtf(trace + 1) * 2;
		w = s / 4;
		x = (m.right.z - m.up.y) / s;
		y = (m.up.x - m.forward.z) / s;
		z = (m.forward.y - m.right.x) / s;
	} else if (m.forward.x > m.right.y && m.forward.x > m.up.z) {
		float s = sqrtf(1 + m.forward.x - m.right.y - m.up.z) * 2;
		w = (m.right.z - m.up.y) / s;
		x = s / 4;
		y = (m.right.x + m.forward.y) / s;
		z = (m.up.x + m.forward.z) / s;
	} else if (m.right.y > m.up.z) {
		float s = sqrtf(1 + m.right.y - m.forward.x - m.up.z) * 2;
		w = (m.up.x - m.forward.z) / s;
		x = (m.right.x + m.forward.y) / s;
		y = s / 4;
		z = (m.up.y + m.right.z) / s;
	} else {
		float s = sqrtf(1 + m.up.z - m.forward.x - m.right.y) * 2;
		w = (m.forward.y - m.right.x) / s;
		x = (m.up.x + m.forward.z) / s;
		y = (m.up.y + m.right.z) / s;
		z = s / 4;
	}
	q[0] = x; q[1] = y; q[2] = z; q[3] = w;
}

static float AngleBetween(const RotMat& a, const RotMat& b) {
	// rotation angle of a^T b from the matrices' difference: |a - b|_F = 2 sqrt(2) sin(angle / 2) (acos of the trace
	// loses small angles to float rounding, ~0.03 deg)
	float d = sqrtf((a.forward - b.forward).LengthSq() + (a.right - b.right).LengthSq() + (a.up - b.up).LengthSq());
	return 2 * asinf(std::min(1.f, d / (2 * sqrtf(2.f))));
}

static std::vector<std::string> Split(const std::string& line) {
	std::vector<std::string> f;
	size_t start = 0;
	for (;;) {
		size_t comma = line.find(',', start);
		f.push_back(line.substr(start, comma - start));
		if (comma == std::string::npos) break;
		start = comma + 1;
	}
	return f;
}

static bool Load(const char* path, std::string& header, std::vector<Row>& rows) {
	std::ifstream in(path);
	if (!in) return false;
	std::string line;
	std::map<std::string, int> col;
	while (std::getline(in, line)) {
		if (!line.empty() && line.back() == '\r') line.pop_back();
		if (line.empty()) continue;
		if (line[0] == '#') { header = line; continue; }
		std::vector<std::string> f = Split(line);
		if (col.empty()) {
			for (size_t i = 0; i < f.size(); i++) col[f[i]] = (int)i;
			continue;
		}
		auto num = [&](const char* name) {
			auto it = col.find(name);
			if (it == col.end() || it->second >= (int)f.size() || f[it->second].empty()) return 0.f;
			return std::stof(f[it->second]);
		};
		auto body = [&](const char* p) {
			std::string s(p);
			Body b;
			b.quat[0] = num((s + "qx").c_str()); b.quat[1] = num((s + "qy").c_str());
			b.quat[2] = num((s + "qz").c_str()); b.quat[3] = num((s + "qw").c_str());
			b.rot = FromQuat(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
			b.pos = Vec(num((s + "x").c_str()), num((s + "y").c_str()), num((s + "z").c_str()));
			b.vel = Vec(num((s + "vx").c_str()), num((s + "vy").c_str()), num((s + "vz").c_str()));
			b.angVel = Vec(num((s + "wx").c_str()), num((s + "wy").c_str()), num((s + "wz").c_str()));
			return b;
		};
		Row r;
		r.tick = (uint64_t)num("tick");
		r.time = num("time");
		r.car = body("c");
		r.ball = body("b");
		r.hasBall = col.count("bx") && !f[col["bx"]].empty();
		r.in.throttle = num("throttle");
		r.in.steer = num("steer");
		r.in.pitch = num("pitch");
		r.in.yaw = num("yaw");
		r.in.roll = num("roll");
		r.in.jump = num("jump") != 0;
		r.in.boost = num("activate_boost") != 0 || num("holding_boost") != 0;
		r.in.handbrake = num("handbrake") != 0;
		r.onGround = num("on_ground") != 0;
		r.wheelContacts = (int)num("wheel_world_contacts");
		for (int i = 0; i < 4; i++) r.wheelContact[i] = num(("w" + std::to_string(i) + "_contact").c_str()) != 0;
		r.jumped = num("b_jumped") != 0;
		r.doubleJumped = num("b_double_jumped") != 0;
		r.hasFlip = num("has_flip") != 0;
		r.supersonic = num("supersonic") != 0;
		r.boost = num("boost");
		r.jumpActive = num("jump_active") > 0;
		r.jumpTime = num("jump_time");
		r.djActive = num("dj_active") > 0;
		r.djTime = num("dj_time");
		r.dodgeActive = num("dodge_active") > 0;
		r.dodgeTime = num("dodge_time");
		rows.push_back(r);
	}
	// RBState.Time is only set by network replication, so offline recordings have 0 there: use the tick counter
	if (rows.size() > 1 && rows.front().time == rows.back().time)
		for (Row& r : rows) r.time = r.tick / 120.0;
	return true;
}

static float Percentile(std::vector<float> v, float p) {
	if (v.empty()) return 0;
	std::sort(v.begin(), v.end());
	return v[std::min(v.size() - 1, (size_t)(p * (v.size() - 1)))];
}

// The preset whose hitbox fits the recording's collision extent (2 x extent) and offset best
static const Preset* PresetFromHeader(const std::string& header) {
	std::istringstream ss(header);
	std::string word;
	Vec ext, off;
	bool haveExt = false;
	while (ss >> word) {
		if (word == "extent") { ss >> ext.x >> ext.y >> ext.z; haveExt = true; }
		else if (word == "offset") ss >> off.x >> off.y >> off.z;
	}
	if (!haveExt) return &PRESETS[0];
	const Preset* best = &PRESETS[0];
	float bestErr = 1e30f;
	for (const Preset& p : PRESETS) {
		Vec size = p.config->hitboxSize;
		float err = fabsf(size.x - 2 * ext.x) + fabsf(size.y - 2 * ext.y) + fabsf(size.z - 2 * ext.z) +
		            fabsf(p.config->hitboxPosOffset.x - off.x);
		if (err < bestErr) { bestErr = err; best = &p; }
	}
	return best;
}

static const Preset* PresetByName(const std::string& name) {
	for (const Preset& p : PRESETS) if (name == p.name) return &p;
	return nullptr;
}

static float HeaderValue(const std::string& header, const char* key, float fallback) {
	std::istringstream ss(header);
	for (std::string word; ss >> word;)
		if (word == key) {
			float v;
			if (ss >> v) return v;
		}
	return fallback;
}

// The player's sensitivities shape steering and aerial inputs inside the physics. PhysLog records them in the header;
// a negative value here means "from the header" (1 if the recording predates that).
struct Sensitivities {
	float steer = -1, air = -1;
};

static CarConfig ConfigFor(const Preset& preset, const std::string& header, const Sensitivities& given) {
	CarConfig c = *preset.config;
	c.steeringSensitivity = given.steer >= 0 ? given.steer : HeaderValue(header, "steer_sensitivity", 1);
	c.airControlSensitivity = given.air >= 0 ? given.air : HeaderValue(header, "air_sensitivity", 1);
	return c;
}

// What the recording looks like: tick spacing, angular velocity units, whether a row is the start of its tick
static void Describe(const std::vector<Row>& rows) {
	std::map<int, int> spacing;
	std::vector<float> ratio, startErr, endErr;
	for (size_t i = 0; i + 1 < rows.size(); i++) {
		const Row &a = rows[i], &b = rows[i + 1];
		double dt = b.time - a.time;
		int ticks = (int)lround(dt * 120);
		spacing[ticks]++;
		if (ticks != 1) continue;
		// rotation between the rows from the quaternions: q_rel = q_b * conj(q_a), angle = 2 acos(|w|)
		const float* qa = a.car.quat;
		const float* qb = b.car.quat;
		float w = qb[3] * qa[3] + qb[0] * qa[0] + qb[1] * qa[1] + qb[2] * qa[2];
		float angle = 2 * acosf(std::min(1.f, fabsf(w)));
		float rate = angle * 120;
		float logged = (a.car.angVel + b.car.angVel).Length() / 2;
		if (rate > 0.5f) ratio.push_back(logged / rate);
		// position step against the velocities (Bullet integrates the position with the tick's new velocity)
		if (a.car.vel.Length() > 100) {
			startErr.push_back((b.car.pos - (a.car.pos + b.car.vel / 120)).Length());
			endErr.push_back((b.car.pos - (a.car.pos + a.car.vel / 120)).Length());
		}
	}
	printf("%zu rows; tick spacing:", rows.size());
	for (auto& [t, n] : spacing) printf(" %d:%d", t, n);
	printf("\nangular velocity / rotation rate between rows: median %.3f (1 = rad/s, 57.3 = deg/s) over %zu rows\n",
	       Percentile(ratio, .5f), ratio.size());
	printf("position step: |next - (pos + next vel / 120)| median %.4f, with this row's velocity %.4f uu\n",
	       Percentile(startErr, .5f), Percentile(endErr, .5f));
}

// The car's state from a recording row. The row's wheel contacts are the game's previous-tick ray results, which the
// tick's pre-physics step uses (sticky force, air control, jump): where ours differ (after a placement), the row's.
static void SetBody(Car* car, CarState s, const Row& r) {
	s.pos = r.car.pos;
	s.rotMat = r.car.rot;
	s.vel = r.car.vel;
	s.angVel = r.car.angVel;
	s.boost = r.boost * 100;
	for (int i = 0; i < 4; i++)
		if (s.wheelsWithContact[i] != r.wheelContact[i]) {
			s.wheelsWithContact[i] = r.wheelContact[i];
			s.wheelCarry.wheels[i].worldContact = r.wheelContact[i] && r.wheelContacts > 0;
			s.wheelCarry.wheels[i].contactNormal = r.car.rot.up;
		}
	s.isOnGround = r.onGround;
	car->SetState(s);
}

static void SetBall(Arena* arena, const Body& b) {
	BallState s = arena->ball->GetState();
	s.pos = b.pos;
	s.rotMat = b.rot;
	s.vel = b.vel;
	s.angVel = b.angVel;
	arena->ball->SetState(s);
}

// The car's contact points after a tick (debugging contact differences): per manifold, each point's world position,
// normal, depth, lifetime and the impulse the solver applied
static void PrintContacts(Arena* arena, Car* car, uint64_t tick) {
	auto* dispatcher = arena->_bulletWorld.getDispatcher();
	for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
		btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
		if (m->getBody0() != &car->_rigidBody && m->getBody1() != &car->_rigidBody) continue;
		printf("  tick %llu manifold %d (%p): %d points, breaking threshold %.3f uu\n", (unsigned long long)tick, i,
		       (void*)m, m->getNumContacts(), m->getContactBreakingThreshold() * BT_TO_UU);
		for (int j = 0; j < m->getNumContacts(); j++) {
			const btManifoldPoint& p = m->getContactPoint(j);
			btVector3 pos = p.getPositionWorldOnB() * BT_TO_UU, n = p.m_normalWorldOnB;
			printf("  tick %llu contact %d.%d at (%.2f %.2f %.2f) n (%.3f %.3f %.3f) depth %.3f uu life %d impulse %.4f\n",
			       (unsigned long long)tick, i, j, pos.x(), pos.y(), pos.z(), n.x(), n.y(), n.z(), p.getDistance() * BT_TO_UU,
			       p.getLifeTime(), p.getAppliedImpulse());
		}
	}
	// The hitbox's four lowest corners: height and vertical velocity (v + w x r)
	CarState s = car->GetState();
	const CarConfig& c = car->config;
	struct Corner { float z, vz; Vec p; };
	std::vector<Corner> corners;
	for (int i = 0; i < 8; i++) {
		Vec local = c.hitboxPosOffset + Vec((i & 1 ? 1 : -1) * c.hitboxSize.x / 2, (i & 2 ? 1 : -1) * c.hitboxSize.y / 2,
		                                    (i & 4 ? 1 : -1) * c.hitboxSize.z / 2);
		Vec r = s.rotMat.forward * local.x + s.rotMat.right * local.y + s.rotMat.up * local.z;
		Vec v = s.vel + s.angVel.Cross(r);
		corners.push_back({ s.pos.z + r.z, v.z, s.pos + r });
	}
	// The ball's surface to the hitbox box (in the car's frame): the true car-ball gap
	{
		BallState bs = arena->ball->GetState();
		Vec d = bs.pos - (s.pos + s.rotMat.forward * c.hitboxPosOffset.x + s.rotMat.right * c.hitboxPosOffset.y +
		                  s.rotMat.up * c.hitboxPosOffset.z);
		Vec local = Vec(d.Dot(s.rotMat.forward), d.Dot(s.rotMat.right), d.Dot(s.rotMat.up));
		Vec half = c.hitboxSize / 2;
		Vec closest = Vec(RS_CLAMP(local.x, -half.x, half.x), RS_CLAMP(local.y, -half.y, half.y), RS_CLAMP(local.z, -half.z, half.z));
		printf("  tick %llu ball gap %.3f uu (ball z %.3f vz %.2f)\n", (unsigned long long)tick,
		       (local - closest).Length() - arena->ball->GetRadius(), bs.pos.z, bs.vel.z);
		// What Bullet's narrowphase itself computes for the pair (closest points up to 10 uu)
		struct Closest : btCollisionWorld::ContactResultCallback {
			float best = 1e30f;
			btScalar addSingleResult(btManifoldPoint& cp, const btCollisionObjectWrapper*, int, int, const btCollisionObjectWrapper*,
			                         int, int) override {
				best = std::min(best, (float)cp.getDistance());
				return 0;
			}
		} cb;
		cb.m_closestDistanceThreshold = 10 * UU_TO_BT;
		arena->_bulletWorld.contactPairTest(&car->_rigidBody, &arena->ball->_rigidBody, cb);
		printf("  tick %llu bullet car-ball distance %.3f uu (at the end of the tick)\n", (unsigned long long)tick, cb.best * BT_TO_UU);
		// The same against the floor plane (the static body whose plane normal is +z)
		for (btRigidBody* rb : arena->_worldCollisionRBs) {
			const btCollisionShape* shape = rb->getCollisionShape();
			if (shape->getShapeType() != STATIC_PLANE_PROXYTYPE ||
			    ((const btStaticPlaneShape*)shape)->getPlaneNormal().z() < 0.99f)
				continue;
			Closest floor;
			floor.m_closestDistanceThreshold = 10 * UU_TO_BT;
			arena->_bulletWorld.contactPairTest(&car->_rigidBody, rb, floor);
			printf("  tick %llu bullet car-floor distance %.3f uu (at the end of the tick)\n", (unsigned long long)tick,
			       floor.best * BT_TO_UU);
		}
	}
	std::sort(corners.begin(), corners.end(), [](const Corner& a, const Corner& b) { return a.z < b.z; });
	for (int i = 0; i < 4; i++)
		printf("  tick %llu corner (%.2f %.2f) z %.3f vz %.2f\n", (unsigned long long)tick, corners[i].p.x, corners[i].p.y,
		       corners[i].z, corners[i].vz);
}

static int Validate(const char* path, const std::string& presetName, const Sensitivities& sens, bool continuous,
                    const std::string& ticksPath, uint64_t contactsFrom = 1, uint64_t contactsTo = 0) {
	std::string header;
	std::vector<Row> rows;
	if (!Load(path, header, rows) || rows.size() < 2) {
		fprintf(stderr, "cannot read %s\n", path);
		return 1;
	}
	Describe(rows);
	const Preset* preset = presetName.empty() ? PresetFromHeader(header) : PresetByName(presetName);
	if (!preset) { fprintf(stderr, "unknown preset %s\n", presetName.c_str()); return 1; }
	CarConfig config = ConfigFor(*preset, header, sens);
	printf("preset %s (%s), steering sensitivity %g, air control sensitivity %g\n", preset->name,
	       presetName.empty() ? "from the recording's hitbox" : "given", config.steeringSensitivity,
	       config.airControlSensitivity);

	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE, config);
	FILE* ticksOut = ticksPath.empty() ? nullptr : fopen(ticksPath.c_str(), "w");
	if (ticksOut)
		fprintf(ticksOut, "tick,car_pos,car_vel,car_ang,car_rot_deg,ball_pos,ball_vel,on_ground_rec,on_ground_eng,"
		                  "wheels_rec,wheels_eng,jump_rec,jump_eng,dodge_rec,dodge_eng,resync,"
		                  "car_dvx,car_dvy,car_dvz,car_dwx,car_dwy,car_dwz,ball_dvx,ball_dvy,ball_dvz,ball_dwx,ball_dwy,ball_dwz\n");
		                  // (signed: engine - recording)

	std::vector<float> carPos, carVel, carAng, carRot, ballPos, ballVel;
	int groundMismatch = 0, wheelMismatch = 0, jumpMismatch = 0, dodgeMismatch = 0, compared = 0, resyncs = 0, placements = 0;
	bool started = false;
	for (size_t i = 0; i + 1 < rows.size(); i++) {
		const Row &a = rows[i], &b = rows[i + 1];
		int ticks = (int)lround((b.time - a.time) * 120);
		if (ticks < 1 || ticks > 4) { started = false; continue; } // a gap (pause, reset)
		// A placement between the rows (a scenario's "car" line, a freeplay reset): not physics
		// (the ball too: a scenario can place only the ball)
		bool ballPlaced = a.hasBall && b.hasBall &&
		                  ((b.ball.pos - a.ball.pos - a.ball.vel * (ticks / 120.f)).Length() > 60 ||
		                   (b.ball.vel - a.ball.vel).Length() > 6000 * ticks);
		// (and a car placed where it already was, turned: a rotation its angular velocity can't explain)
		bool carTurned = AngleBetween(a.car.rot, b.car.rot) > a.car.angVel.Length() * (ticks / 120.f) * 2 + 0.2f;
		if ((b.car.pos - a.car.pos - a.car.vel * (ticks / 120.f)).Length() > 60 ||
		    (b.car.vel - a.car.vel).Length() > 2000 + 1000 * ticks || ballPlaced || carTurned) {
			placements++;
			started = false;
			continue;
		}
		// Continuous mode resyncs only where the recording jumps (a placement)
		CarState ours = car->GetState();
		bool jump = (ours.pos - a.car.pos).Length() > 50 || (ours.vel - a.car.vel).Length() > 500;
		bool resync = !started || !continuous || jump;
		if (resync) {
			SetBody(car, ours, a);
			if (a.hasBall) SetBall(arena, a.ball);
			resyncs += continuous && started;
		}
		started = true;
		car->controls = a.in;
		arena->Step(ticks);
		if (a.tick >= contactsFrom && a.tick <= contactsTo) PrintContacts(arena, car, a.tick);
		CarState s = car->GetState();
		BallState bs = arena->ball->GetState();
		compared++;
		carPos.push_back((s.pos - b.car.pos).Length());
		carVel.push_back((s.vel - b.car.vel).Length());
		carAng.push_back((s.angVel - b.car.angVel).Length());
		carRot.push_back(AngleBetween(s.rotMat, b.car.rot) * 57.2958f);
		if (b.hasBall) {
			ballPos.push_back((bs.pos - b.ball.pos).Length());
			ballVel.push_back((bs.vel - b.ball.vel).Length());
		}
		int wheels = 0;
		for (bool w : s.wheelsWithContact) wheels += w;
		groundMismatch += s.isOnGround != b.onGround;
		wheelMismatch += wheels != b.wheelContacts;
		jumpMismatch += s.isJumping != b.jumpActive;
		dodgeMismatch += s.isFlipping != b.dodgeActive;
		if (ticksOut) {
			Vec dv = s.vel - b.car.vel, dw = s.angVel - b.car.angVel;
			Vec bdv = b.hasBall ? bs.vel - b.ball.vel : Vec(), bdw = b.hasBall ? bs.angVel - b.ball.angVel : Vec();
			fprintf(ticksOut, "%llu,%.5f,%.4f,%.6f,%.5f,%.5f,%.4f,%d,%d,%d,%d,%d,%d,%d,%d,%d,%.4f,%.4f,%.4f,%.5f,%.5f,%.5f,"
			                  "%.4f,%.4f,%.4f,%.5f,%.5f,%.5f\n",
			        (unsigned long long)a.tick, carPos.back(), carVel.back(), carAng.back(), carRot.back(),
			        b.hasBall ? ballPos.back() : 0.f, b.hasBall ? ballVel.back() : 0.f, b.onGround, s.isOnGround,
			        b.wheelContacts, wheels, b.jumpActive, s.isJumping, b.dodgeActive, s.isFlipping, resync, dv.x, dv.y,
			        dv.z, dw.x, dw.y, dw.z, bdv.x, bdv.y, bdv.z, bdw.x, bdw.y, bdw.z);
		}
	}
	if (ticksOut) fclose(ticksOut);
	printf("%d ticks compared (%s%s), %d placements skipped\n", compared,
	       continuous ? "continuous" : "state set from the recording every tick",
	       continuous ? (", " + std::to_string(resyncs) + " resyncs").c_str() : "", placements);
	auto line = [](const char* name, const std::vector<float>& v, const char* unit) {
		printf("  %-22s p50 %10.5f  p90 %10.5f  p99 %10.5f  max %10.5f %s\n", name, Percentile(v, .5f), Percentile(v, .9f),
		       Percentile(v, .99f), v.empty() ? 0.f : *std::max_element(v.begin(), v.end()), unit);
	};
	line("car position", carPos, "uu");
	line("car velocity", carVel, "uu/s");
	line("car angular velocity", carAng, "rad/s");
	line("car rotation", carRot, "deg");
	line("ball position", ballPos, "uu");
	line("ball velocity", ballVel, "uu/s");
	printf("  state mismatches: on ground %d, wheel contacts %d, jumping %d, flipping %d (of %d)\n", groundMismatch,
	       wheelMismatch, jumpMismatch, dodgeMismatch, compared);
	return 0;
}

// ---- --fit-steer: the steer input our engine needs on each grounded tick to reach the recording's next state ----

static int FitSteer(const char* path, const std::string& presetName, const Sensitivities& sens) {
	std::string header;
	std::vector<Row> rows;
	if (!Load(path, header, rows) || rows.size() < 2) {
		fprintf(stderr, "cannot read %s\n", path);
		return 1;
	}
	const Preset* preset = presetName.empty() ? PresetFromHeader(header) : PresetByName(presetName);
	if (!preset) { fprintf(stderr, "unknown preset %s\n", presetName.c_str()); return 1; }
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE, ConfigFor(*preset, header, sens));
	printf("tick,steer,fit,err_given,err_fit,speed\n");
	for (size_t i = 0; i + 1 < rows.size(); i++) {
		const Row &a = rows[i], &b = rows[i + 1];
		if (lround((b.time - a.time) * 120) != 1 || (b.car.pos - a.car.pos - a.car.vel / 120.f).Length() > 60) continue;
		CarState base = car->GetState();
		// Velocity and angular velocity (weighted to similar size) after one tick with this steer
		auto err = [&](float steer) {
			SetBody(car, base, a);
			if (a.hasBall) SetBall(arena, a.ball);
			car->controls = a.in;
			car->controls.steer = steer;
			arena->Step(1);
			CarState s = car->GetState();
			return (s.vel - b.car.vel).Length() + 100 * (s.angVel - b.car.angVel).Length();
		};
		if (a.onGround && b.onGround) {
			float best = 0, bestErr = 1e30f;
			for (int k = -100; k <= 100; k++)
				if (float e = err(k / 100.f); e < bestErr) bestErr = e, best = k / 100.f;
			for (float step = 0.005f; step > 1e-5f; step /= 2) // refine
				for (float c : {best - step, best + step})
					if (c >= -1 && c <= 1)
						if (float e = err(c); e < bestErr) bestErr = e, best = c;
			float given = err(a.in.steer);
			printf("%llu,%.4f,%.5f,%.4f,%.4f,%.1f\n", (unsigned long long)a.tick, a.in.steer, best, given, bestErr,
			       a.car.vel.Length());
		}
		// Advance with the recorded input from the recorded state, as the per-tick validation does
		SetBody(car, base, a);
		if (a.hasBall) SetBall(arena, a.ball);
		car->controls = a.in;
		arena->Step(1);
	}
	return 0;
}

// ---- --synth: run a PhysLog scenario in our engine and write a recording in PhysLog's format ----

static int Synth(const char* scenarioPath, const char* outPath, const std::string& presetName) {
	const Preset* preset = presetName.empty() ? &PRESETS[0] : PresetByName(presetName);
	if (!preset) { fprintf(stderr, "unknown preset %s\n", presetName.c_str()); return 1; }
	std::ifstream in(scenarioPath);
	if (!in) { fprintf(stderr, "cannot read %s\n", scenarioPath); return 1; }
	struct Line { std::string cmd; std::vector<float> v; };
	std::vector<Line> script, block;
	int repeat = 0;
	for (std::string line; std::getline(in, line);) {
		if (auto hash = line.find('#'); hash != std::string::npos) line.resize(hash);
		std::istringstream ss(line);
		Line l;
		if (!(ss >> l.cmd)) continue;
		for (float x; ss >> x;) l.v.push_back(x);
		if (l.cmd == "repeat") { repeat = (int)l.v.at(0); block.clear(); continue; }
		if (l.cmd == "end") {
			for (int k = 0; k < repeat; k++) script.insert(script.end(), block.begin(), block.end());
			repeat = 0;
			continue;
		}
		(repeat ? block : script).push_back(l);
	}

	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* car = arena->AddCar(Team::BLUE, *preset->config);
	FILE* out = fopen(outPath, "w");
	const CarConfig& c = *preset->config;
	fprintf(out, "# body synth-%s extent %g %g %g offset %g %g %g\n", preset->name, c.hitboxSize.x / 2, c.hitboxSize.y / 2,
	        c.hitboxSize.z / 2, c.hitboxPosOffset.x, c.hitboxPosOffset.y, c.hitboxPosOffset.z);
	fprintf(out, "tick,time,cqx,cqy,cqz,cqw,cx,cy,cz,cvx,cvy,cvz,cwx,cwy,cwz,csleep,bqx,bqy,bqz,bqw,bx,by,bz,bvx,bvy,bvz,"
	             "bwx,bwy,bwz,bsleep,throttle,steer,pitch,yaw,roll,dodge_fwd,dodge_strafe,handbrake,jump,activate_boost,"
	             "holding_boost,jumped,on_ground,wheel_world_contacts,b_jumped,b_double_jumped,has_flip,supersonic,"
	             "time_below_supersonic,boost,jump_active,jump_time,dj_active,dj_time,dodge_active,dodge_time\n");
	uint64_t tick = 0;
	auto body = [&](const PhysState& s) {
		float q[4];
		ToQuat(s.rotMat, q);
		fprintf(out, ",%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,0", q[0], q[1], q[2], q[3], s.pos.x,
		        s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.angVel.x, s.angVel.y, s.angVel.z);
	};
	for (const Line& l : script) {
		if (l.cmd == "car" && l.v.size() >= 13) {
			CarState s = CarState();
			s.pos = Vec(l.v[0], l.v[1], l.v[2]);
			float d = (float)M_PI / 180;
			s.rotMat = Angle(l.v[4] * d, l.v[3] * d, l.v[5] * d).ToRotMat();
			s.vel = Vec(l.v[6], l.v[7], l.v[8]);
			s.angVel = Vec(l.v[9], l.v[10], l.v[11]);
			s.boost = l.v[12];
			car->SetState(s);
			continue;
		}
		if (l.cmd == "ball" && l.v.size() >= 9) {
			BallState s;
			s.pos = Vec(l.v[0], l.v[1], l.v[2]);
			s.vel = Vec(l.v[3], l.v[4], l.v[5]);
			s.angVel = Vec(l.v[6], l.v[7], l.v[8]);
			arena->ball->SetState(s);
			continue;
		}
		CarControls controls;
		int n = l.v.empty() ? 0 : (int)l.v[0];
		if (l.cmd == "input" && l.v.size() >= 9) {
			controls.throttle = l.v[1]; controls.steer = l.v[2]; controls.pitch = l.v[3]; controls.yaw = l.v[4];
			controls.roll = l.v[5]; controls.jump = l.v[6] != 0; controls.boost = l.v[7] != 0; controls.handbrake = l.v[8] != 0;
		} else if (l.cmd != "wait") {
			fprintf(stderr, "unknown scenario line %s\n", l.cmd.c_str());
			return 1;
		}
		for (int k = 0; k < n; k++) {
			CarState s = car->GetState();
			BallState bs = arena->ball->GetState();
			int wheels = 0;
			for (bool w : s.wheelsWithContact) wheels += w;
			fprintf(out, "%llu,%.9g", (unsigned long long)tick, (double)arena->tickCount / 120);
			body(s);
			body(bs);
			fprintf(out, ",%g,%g,%g,%g,%g,%g,%g,%d,%d,%d,%d,0", controls.throttle, controls.steer, controls.pitch, controls.yaw,
			        controls.roll, -controls.pitch, controls.yaw, controls.handbrake, controls.jump, controls.boost, controls.boost);
			fprintf(out, ",%d,%d,%d,%d,%d,%d,%g,%g,%d,%g,0,0,%d,%g\n", s.isOnGround, wheels, s.hasJumped, s.hasDoubleJumped,
			        !s.hasFlipped, s.isSupersonic, s.supersonicTime, s.boost / 100, s.isJumping, s.jumpTime, s.isFlipping, s.flipTime);
			car->controls = controls;
			arena->Step(1);
			tick++;
		}
	}
	fclose(out);
	printf("wrote %llu ticks to %s\n", (unsigned long long)tick, outPath);
	return 0;
}

int main(int argc, char** argv) {
	std::string meshes = ARENA_MESH_DIR, preset, ticksPath;
	bool continuous = false;
	std::vector<std::string> positional;
	bool synth = false, fitSteer = false;
	Sensitivities sens;
	uint64_t contactsFrom = 1, contactsTo = 0;
	for (int i = 1; i < argc; i++) {
		std::string a = argv[i];
		if (a == "--meshes" && i + 1 < argc) meshes = argv[++i];
		else if (a == "--preset" && i + 1 < argc) preset = argv[++i];
		else if (a == "--ticks" && i + 1 < argc) ticksPath = argv[++i];
		else if (a == "--steer-sensitivity" && i + 1 < argc) sens.steer = std::stof(argv[++i]);
		else if (a == "--contacts" && i + 1 < argc) { // FROM-TO: print the car's contact points after these ticks
			std::string r = argv[++i];
			size_t dash = r.find('-');
			contactsFrom = std::stoull(r.substr(0, dash));
			contactsTo = dash == std::string::npos ? contactsFrom : std::stoull(r.substr(dash + 1));
		}
		else if (a == "--air-sensitivity" && i + 1 < argc) sens.air = std::stof(argv[++i]);
		else if (a == "--continuous") continuous = true;
		else if (a == "--synth") synth = true;
		else if (a == "--fit-steer") fitSteer = true;
		else positional.push_back(a);
	}
	if (positional.size() < (synth ? 2u : 1u)) {
		fprintf(stderr, "usage: live_validate LOG.csv [--continuous] [--preset NAME] [--ticks OUT.csv]\n"
		                "                     [--steer-sensitivity X] [--air-sensitivity X]   (default: the recording's)\n"
		                "       live_validate LOG.csv --fit-steer [--preset NAME]\n"
		                "       live_validate --synth SCENARIO.txt OUT.csv [--preset NAME]\n");
		return 1;
	}
	RocketSim::Init(meshes, true);
	if (synth) return Synth(positional[0].c_str(), positional[1].c_str(), preset);
	if (fitSteer) return FitSteer(positional[0].c_str(), preset, sens);
	return Validate(positional[0].c_str(), preset, sens, continuous, ticksPath, contactsFrom, contactsTo);
}
