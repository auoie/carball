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
//   --meshes DIR: the arena's meshes (default: the generated ones; a local copy of the game's cooked ones, with the goal
//     halves' body offsets, for exactness checks only: never committed or shipped). The run prints which.
//   --jitter K: per tick with a car-mesh contact (or the game's world contact), K re-runs with the vertices of the
//     triangles the car can touch jittered 1-4 ulps, or the car's origin moved 0.001 uu: a tick whose contact set
//     varies and one run matches the game is indeterminate (an ill-conditioned contact), listed with the unjittered
//     run's error and not counted; --ticks keeps its row, flagged (default 8: on, so the stats leave these ticks out;
//     0: off, every tick counted)
//   --contacts FROM-TO: print the car's and the ball's contact points (depth, lifetime, applied impulse) after those
//     ticks, and the game's own for the same ticks from the recording's _bullet.csv (PhysLog reads the game's Bullet
//     manifolds) when there is one
#include "RocketSim.h"
#include "../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btBvhTriangleMeshShape.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace RocketSim;

struct Body {
	Vec pos, vel, angVel;
	RotMat rot;
	float quat[4] = { 0, 0, 0, 1 };
};

// One car's columns in a row (the recorded car's, or the other car's with the prefix o_)
struct CarRow {
	Body car;
	CarControls in;
	bool onGround = false, jumped = false, doubleJumped = false, hasFlip = false, supersonic = false;
	int wheelContacts = 0;          // touching the arena
	int worldContact = -1;          // the game's WorldContact after the tick before this row (-1: not recorded)
	Vec worldContactNormal;
	bool wheelContact[4] = {};      // touching anything, in our wheel order (the game's wheel i is our i ^ 1: it numbers
	                                // front left, front right, back left, back right; RocketSim right before left)
	float boost = 0; // 0-1
	bool jumpActive = false, djActive = false, dodgeActive = false;
	float jumpTime = 0, djTime = 0, dodgeTime = 0;
};

struct Row : CarRow {
	uint64_t tick = 0;
	double time = 0;
	Body ball;
	bool hasBall = false;
	bool hasOther = false; // a second car (PhysLog's o_ columns)
	CarRow other;
};

struct Preset {
	const char* name;
	const CarConfig* config;
};
static const Preset PRESETS[] = {
	{ "octane", &CAR_CONFIG_OCTANE }, { "dominus", &CAR_CONFIG_DOMINUS }, { "plank", &CAR_CONFIG_PLANK },
	{ "breakout", &CAR_CONFIG_BREAKOUT }, { "hybrid", &CAR_CONFIG_HYBRID }, { "merc", &CAR_CONFIG_MERC },
};

// A recording's rotation as the game sets its body from it: RBActor's write-back builds btMatrix3x3(btQuaternion(q))
// (0x140f35870 -> setRotation 0x14027efd0: 2 / |q|^2 and its own order of products, not this formula's), the same
// matrix to the last bits only (static analysis F2)
static RotMat FromQuatAsGame(float x, float y, float z, float w) {
	btMatrix3x3 m(btQuaternion(x, y, z, w));
	return RotMat(Vec(m[0][0], m[1][0], m[2][0]), Vec(m[0][1], m[1][1], m[2][1]), Vec(m[0][2], m[1][2], m[2][2]));
}

// The inverse of FromQuatAsGame (for writing recordings from our engine)
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
			b.rot = FromQuatAsGame(b.quat[0], b.quat[1], b.quat[2], b.quat[3]);
			b.pos = Vec(num((s + "x").c_str()), num((s + "y").c_str()), num((s + "z").c_str()));
			b.vel = Vec(num((s + "vx").c_str()), num((s + "vy").c_str()), num((s + "vz").c_str()));
			b.angVel = Vec(num((s + "wx").c_str()), num((s + "wy").c_str()), num((s + "wz").c_str()));
			return b;
		};
		auto carRow = [&](const std::string& p) {
			auto n = [&](const char* name) { return num((p + name).c_str()); };
			CarRow c;
			c.car = body((p + "c").c_str());
			c.in.throttle = n("throttle");
			c.in.steer = n("steer");
			c.in.pitch = n("pitch");
			c.in.yaw = n("yaw");
			c.in.roll = n("roll");
			if (col.count(p + "dodge_fwd")) { // (the game's own DodgeForward: its byte, C-2)
				c.in.dodgeForward = n("dodge_fwd");
				c.in.hasDodgeForward = true;
			}
			c.in.jump = n("jump") != 0;
			c.in.boost = n("activate_boost") != 0 || n("holding_boost") != 0;
			c.in.handbrake = n("handbrake") != 0;
			c.onGround = n("on_ground") != 0;
			c.wheelContacts = (int)n("wheel_world_contacts");
			if (col.count(p + "wc_has") && !f[col[p + "wc_has"]].empty()) {
				c.worldContact = (int)n("wc_has");
				c.worldContactNormal = Vec(n("wc_nx"), n("wc_ny"), n("wc_nz"));
			}
			for (int i = 0; i < 4; i++) c.wheelContact[i ^ 1] = n(("w" + std::to_string(i) + "_contact").c_str()) != 0;
			c.jumped = n("b_jumped") != 0;
			c.doubleJumped = n("b_double_jumped") != 0;
			c.hasFlip = n("has_flip") != 0;
			c.supersonic = n("supersonic") != 0;
			c.boost = n("boost");
			c.jumpActive = n("jump_active") > 0;
			c.jumpTime = n("jump_time");
			c.djActive = n("dj_active") > 0;
			c.djTime = n("dj_time");
			c.dodgeActive = n("dodge_active") > 0;
			c.dodgeTime = n("dodge_time");
			return c;
		};
		Row r;
		static_cast<CarRow&>(r) = carRow("");
		r.tick = (uint64_t)num("tick");
		r.time = num("time");
		r.ball = body("b");
		r.hasBall = col.count("bx") && col["bx"] < (int)f.size() && !f[col["bx"]].empty();
		r.hasOther = col.count("o_cx") && col["o_cx"] < (int)f.size() && !f[col["o_cx"]].empty(); // (empty: demolished)
		if (r.hasOther) r.other = carRow("o_");
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
static const Preset* PresetFromHeader(const std::string& header, const std::string& prefix = "") {
	std::istringstream ss(header);
	std::string word;
	Vec ext, off;
	bool haveExt = false;
	while (ss >> word) {
		if (word == prefix + "extent") { ss >> ext.x >> ext.y >> ext.z; haveExt = true; }
		else if (word == prefix + "offset") ss >> off.x >> off.y >> off.z;
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

static CarConfig ConfigFor(const Preset& preset, const std::string& header, const Sensitivities& given,
                           const std::string& prefix = "") {
	CarConfig c = *preset.config;
	c.steeringSensitivity = given.steer >= 0 ? given.steer : HeaderValue(header, (prefix + "steer_sensitivity").c_str(), 1);
	c.airControlSensitivity = given.air >= 0 ? given.air : HeaderValue(header, (prefix + "air_sensitivity").c_str(), 1);
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
// tick's pre-physics step uses (sticky force, air control, jump): where ours differ, or after a placement (`placed`:
// the touching wheels' normals are from before it), the row's.
// `refreshInertia`: the body's world inverse inertia tensor from this rotation (else it keeps its own, as the game's
// placements do: Car::SetState).
static void SetBody(Car* car, CarState s, const CarRow& r, bool placed = false, bool refreshInertia = false) {
	s.refreshInertia = refreshInertia;
	s.pos = r.car.pos;
	s.rotMat = r.car.rot;
	s.vel = r.car.vel;
	s.angVel = r.car.angVel;
	s.boost = r.boost * 100;
	for (int i = 0; i < 4; i++)
		if (s.wheelsWithContact[i] != r.wheelContact[i] || placed) {
			s.wheelsWithContact[i] = r.wheelContact[i];
			s.wheelCarry.wheels[i].worldContact = r.wheelContact[i] && r.wheelContacts > 0;
			s.wheelCarry.wheels[i].contactNormal = r.car.rot.up;
		}
	s.isOnGround = r.onGround;
	if (r.worldContact >= 0) { // what this tick's auto-roll sees
		s.worldContact.hasContact = r.worldContact != 0;
		s.worldContact.contactNormal = r.worldContactNormal;
	}
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
// The game's contact points from a recording's _bullet.csv, by the row they were written with
static std::map<uint64_t, std::vector<std::vector<std::string>>> LoadGameContacts(const std::string& path) {
	std::map<uint64_t, std::vector<std::vector<std::string>>> out;
	std::ifstream in(path);
	std::string line;
	while (std::getline(in, line)) {
		if (line.empty() || line[0] == '#' || line.rfind("tick", 0) == 0) continue;
		std::vector<std::string> f;
		std::stringstream ss(line);
		for (std::string x; std::getline(ss, x, ',');) f.push_back(x);
		if (f.size() >= 7) out[std::stoull(f[0])].push_back(f);
	}
	return out;
}
static std::map<uint64_t, std::vector<std::vector<std::string>>> gameContacts;

static Car* g_car2 = nullptr; // the second car, in two-car recordings

static const char* BodyName(Arena* arena, Car* car, const btCollisionObject* o) {
	if (o == &car->_rigidBody) return "car";
	if (g_car2 && o == &g_car2->_rigidBody) return "car2";
	if (o == &arena->ball->_rigidBody) return "ball";
	switch (o->getCollisionShape()->getShapeType()) {
	case STATIC_PLANE_PROXYTYPE: return "plane";
	case TRIANGLE_MESH_SHAPE_PROXYTYPE: return "mesh";
	default: return "other";
	}
}

static void PrintContacts(Arena* arena, Car* car, uint64_t tick) {
	auto* dispatcher = arena->_bulletWorld.getDispatcher();
	for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
		btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
		const btCollisionObject* ball = &arena->ball->_rigidBody;
		const btCollisionObject* c2 = g_car2 ? &g_car2->_rigidBody : nullptr;
		if (m->getBody0() != &car->_rigidBody && m->getBody1() != &car->_rigidBody && m->getBody0() != ball &&
		    m->getBody1() != ball && (!c2 || (m->getBody0() != c2 && m->getBody1() != c2)))
			continue;
		printf("  tick %llu manifold %d (%s-%s): %d points, breaking threshold %.3f uu\n", (unsigned long long)tick, i,
		       BodyName(arena, car, m->getBody0()), BodyName(arena, car, m->getBody1()), m->getNumContacts(),
		       m->getContactBreakingThreshold() * BT_TO_UU);
		for (int j = 0; j < m->getNumContacts(); j++) {
			const btManifoldPoint& p = m->getContactPoint(j);
			btVector3 pos = p.getPositionWorldOnB() * BT_TO_UU, n = p.m_normalWorldOnB;
			printf("  tick %llu contact %d.%d at (%.2f %.2f %.2f) n (%.3f %.3f %.3f) depth %.3f uu life %d impulse %.4f tri %d/%d\n",
			       (unsigned long long)tick, i, j, pos.x(), pos.y(), pos.z(), n.x(), n.y(), n.z(), p.getDistance() * BT_TO_UU,
			       p.getLifeTime(), p.getAppliedImpulse(), p.m_index0, p.m_index1);
		}
	}
	// The game's, from the same state: PhysLog writes them with the next row (before that tick's physics)
	auto game = gameContacts.find(tick + 1);
	if (game != gameContacts.end()) {
		std::string last;
		for (const auto& f : game->second) {
			// tick,manifold,body0,body1,points,threshold,point,distance,lifetime,impulse,ax,ay,az,bx,by,bz,nx,ny,nz,...
			auto name = [](const std::string& b) { return b == "shape28" ? std::string("plane") : b.rfind("shape", 0) == 0 ? "mesh" : b; };
			if (f[1] != last)
				printf("  tick %llu game manifold %s (%s-%s): %s points, breaking threshold %s uu\n", (unsigned long long)tick,
				       f[1].substr(f[1].size() - 4).c_str(), name(f[2]).c_str(), name(f[3]).c_str(), f[4].c_str(), f[5].c_str());
			last = f[1];
			// (recordings since 2026-10-09 add the pre-solve velocities, part and triangle indices: tri index0/index1)
			std::string tri = f.size() >= 32 ? " tri " + f[30] + "/" + f[31] : "";
			if (f[6] != "-1" && f.size() >= 19)
				printf("  tick %llu game contact %s.%s at (%.2f %.2f %.2f) n (%.3f %.3f %.3f) depth %.3f uu life %s impulse %.4f%s\n",
				       (unsigned long long)tick, f[1].substr(f[1].size() - 4).c_str(), f[6].c_str(), std::stof(f[13]),
				       std::stof(f[14]), std::stof(f[15]), std::stof(f[16]), std::stof(f[17]), std::stof(f[18]), std::stof(f[7]),
				       f[8].c_str(), std::stof(f[9]), tri.c_str());
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

// --- Ill-conditioned contacts (static analysis, notes/bullet-diff.md: the car's box nearly parallel to a facet, where
// GJK converges to a corner or a mid-edge witness on the last bits). Per tick with a car-mesh contact, the tick is run
// again from the same state with the nearby mesh vertices jittered a few ulps, or the car's origin by 0.001 uu: if the
// car's contact set (each point's triangle, after the cache's merges) differs between runs and one of them matches the
// game, the tick is indeterminate: not counted as a physics error.
static int g_jitter = 8;

// The car's contact points with the arena's meshes after a tick: each point's mesh piece and triangle, sorted (the piece
// too: the same triangle index on two pieces is two triangles, RV-91e)
using MeshPoint = std::pair<uintptr_t, int>;
static std::vector<MeshPoint> MeshContacts(Arena* arena, Car* car) {
	std::vector<MeshPoint> out;
	auto* dispatcher = arena->_bulletWorld.getDispatcher();
	for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
		btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
		bool carFirst = m->getBody0() == &car->_rigidBody;
		const btCollisionObject* other = carFirst ? m->getBody1() : (m->getBody1() == &car->_rigidBody ? m->getBody0() : nullptr);
		if (!other || other->getCollisionShape()->getShapeType() != TRIANGLE_MESH_SHAPE_PROXYTYPE) continue;
		for (int j = 0; j < m->getNumContacts(); j++) {
			const btManifoldPoint& p = m->getContactPoint(j);
			out.push_back({ (uintptr_t)other, carFirst ? p.m_index1 : p.m_index0 });
		}
	}
	std::sort(out.begin(), out.end());
	return out;
}

// Jitters every vertex of the triangles the car can touch this tick (those whose bounds meet the car's, grown by
// `reach` uu: the candidates the tree query finds, the contacted ones among them, RV-91d) by 1-4 ulps per float
// (seeded); returns how to put them back
struct JitteredFloat { float* at; float was; };
struct TriangleIds : btTriangleCallback {
	std::vector<std::pair<int, int>> ids; // (part, triangle)
	void processTriangle(btVector3*, int part, int triangle) override { ids.push_back({ part, triangle }); }
};
static std::vector<JitteredFloat> JitterVertices(Arena* arena, Car* car, float reach, uint32_t seed) {
	std::vector<JitteredFloat> undo;
	std::minstd_rand0 random(seed);
	btVector3 carMin, carMax;
	car->_rigidBody.getCollisionShape()->getAabb(car->_rigidBody.getWorldTransform(), carMin, carMax);
	btVector3 grow(reach * UU_TO_BT, reach * UU_TO_BT, reach * UU_TO_BT);
	carMin -= grow;
	carMax += grow;
	for (btRigidBody* rb : arena->_worldCollisionRBs) {
		auto* bvh = dynamic_cast<btBvhTriangleMeshShape*>(rb->getCollisionShape());
		if (!bvh) continue;
		// (the car's bounds in the mesh's frame: its eight corners)
		btTransform toLocal = rb->getWorldTransform().inverse();
		btVector3 lo(BT_INFINITY, BT_INFINITY, BT_INFINITY), hi = -lo;
		for (int k = 0; k < 8; k++) {
			btVector3 c = toLocal * btVector3(k & 1 ? carMax.x() : carMin.x(), k & 2 ? carMax.y() : carMin.y(), k & 4 ? carMax.z() : carMin.z());
			lo.setMin(c);
			hi.setMax(c);
		}
		TriangleIds near;
		bvh->processAllTriangles(&near, lo, hi);
		if (near.ids.empty()) continue;
		btStridingMeshInterface* mesh = bvh->getMeshInterface();
		for (int part = 0; part < mesh->getNumSubParts(); part++) {
			unsigned char* vertices; int numVerts, stride;
			unsigned char* indices; int indexStride, numFaces;
			mesh->getLockedVertexIndexBase(&vertices, numVerts, stride, &indices, indexStride, numFaces, part);
			std::vector<int> touched;
			for (auto [p, t] : near.ids) {
				if (p != part) continue;
				const int* tri = reinterpret_cast<const int*>(indices + t * indexStride); // (int indices: RocketSim's meshes)
				touched.insert(touched.end(), tri, tri + 3);
			}
			std::sort(touched.begin(), touched.end());
			touched.erase(std::unique(touched.begin(), touched.end()), touched.end());
			for (int v : touched) { // (floats: RocketSim's meshes)
				float* f = reinterpret_cast<float*>(vertices + v * stride);
				for (int c = 0; c < 3; c++) {
					undo.push_back({ f + c, f[c] });
					int ulps = 1 + (int)(random() % 4);
					bool up = random() % 2;
					for (int k = 0; k < ulps; k++) f[c] = std::nextafter(f[c], up ? INFINITY : -INFINITY);
				}
			}
			mesh->unLockVertexBase(part);
		}
	}
	return undo;
}

static void Unjitter(const std::vector<JitteredFloat>& undo) {
	for (auto it = undo.rbegin(); it != undo.rend(); ++it) *it->at = it->was;
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
	std::string side = path;
	if (side.size() > 4 && side.substr(side.size() - 4) == ".csv") side = side.substr(0, side.size() - 4);
	if (contactsTo >= contactsFrom) {
		gameContacts = LoadGameContacts(side + "_bullet.csv");
		if (!gameContacts.empty()) printf("the game's contacts: %s_bullet.csv\n", side.c_str());
	}
	const Preset* preset = presetName.empty() ? PresetFromHeader(header) : PresetByName(presetName);
	if (!preset) { fprintf(stderr, "unknown preset %s\n", presetName.c_str()); return 1; }
	CarConfig config = ConfigFor(*preset, header, sens);
	printf("preset %s (%s), steering sensitivity %g, air control sensitivity %g\n", preset->name,
	       presetName.empty() ? "from the recording's hitbox" : "given", config.steeringSensitivity,
	       config.airControlSensitivity);

	Arena* arena = Arena::Create(GameMode::SOCCAR);
	auto team = [&](const char* key) { return HeaderValue(header, key, 0) == 1 ? Team::ORANGE : Team::BLUE; };
	Car* car = arena->AddCar(team("team"), config);
	// A second car (PhysLog's o_ columns: a bot in two-car scenarios): its own preset and team from the header
	Car* car2 = nullptr;
	if (rows[0].hasOther) {
		const Preset* preset2 = PresetFromHeader(header, "o_");
		CarConfig config2 = ConfigFor(*preset2, header, Sensitivities{}, "o_");
		car2 = arena->AddCar(team("o_team"), config2);
		g_car2 = car2;
		printf("second car: preset %s, team %d (the recorded car's: %d), steering sensitivity %g\n", preset2->name,
		       (int)car2->team, (int)car->team, config2.steeringSensitivity);
	}
	FILE* ticksOut = ticksPath.empty() ? nullptr : fopen(ticksPath.c_str(), "w");
	if (ticksOut)
		fprintf(ticksOut, "tick,car_pos,car_vel,car_ang,car_rot_deg,ball_pos,ball_vel,on_ground_rec,on_ground_eng,"
		                  "wheels_rec,wheels_eng,jump_rec,jump_eng,dodge_rec,dodge_eng,resync,"
		                  "car_dvx,car_dvy,car_dvz,car_dwx,car_dwy,car_dwz,ball_dvx,ball_dvy,ball_dvz,ball_dwx,ball_dwy,ball_dwz,"
		                  "world_contact_rec,world_contact_eng,car2_vel,car2_dvx,car2_dvy,car2_dvz,indeterminate\n");
		                  // (signed: engine - recording)

	std::vector<float> carPos, carVel, carAng, carRot, ballPos, ballVel, car2Pos, car2Vel, car2Ang;
	std::vector<std::string> demos; // the second car demolished: by the game (its columns go empty) and by the engine
	std::vector<std::pair<uint64_t, float>> indeterminateTicks; // ill-conditioned contacts, not counted: tick, unjittered residual
	int groundMismatch = 0, wheelMismatch = 0, touchMismatch = 0, worldContactMismatch = 0, worldContactCompared = 0, jumpMismatch = 0, dodgeMismatch = 0, compared = 0, resyncs = 0, placements = 0;
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
		auto placed = [&](const CarRow& ra, const CarRow& rb) {
			bool turned = AngleBetween(ra.car.rot, rb.car.rot) > ra.car.angVel.Length() * (ticks / 120.f) * 2 + 0.2f;
			return (rb.car.pos - ra.car.pos - ra.car.vel * (ticks / 120.f)).Length() > 60 ||
			       (rb.car.vel - ra.car.vel).Length() > 2000 + 1000 * ticks || turned;
		};
		bool car2Placed = car2 && a.hasOther && b.hasOther && placed(a.other, b.other);
		if (placed(a, b) || ballPlaced || car2Placed) {
			placements++;
			started = false;
			continue;
		}
		// Continuous mode resyncs only where the recording jumps (a placement)
		CarState ours = car->GetState();
		bool jump = (ours.pos - a.car.pos).Length() > 50 || (ours.vel - a.car.vel).Length() > 500;
		bool resync = !started || !continuous || jump;
		if (resync) {
			// The boost component's state after the previous tick (this tick's air throttle reads it: Car::_PreTickUpdate)
			// is ours, unless that tick wasn't simulated (a placement): then from its input
			if (!started && i > 0 && ours.isBoosting != (rows[i - 1].in.boost && rows[i - 1].boost > 0)) {
				ours.isBoosting = !ours.isBoosting;
				ours.boostingTime = ours.isBoosting ? 1 / 120.f : 0;
			}
			// The inertia tensor: from the placed rotation at a placement (the recording's tick after it fits that
			// exactly, where the game's tensor before its first step, which its _bullet.csv header dumps, is a
			// different one: validation finding 50); kept from our own step at the per-tick resets, as the game keeps
			// its own through the tick's rounding (Quantize)
			SetBody(car, ours, a, !started, !started);
			if (car2 && a.hasOther) SetBody(car2, car2->GetState(), a.other, !started, !started);
			if (a.hasBall) SetBall(arena, a.ball);
			resyncs += continuous && started;
		}
		started = true;
		car->controls = a.in;
		if (car2 && a.hasOther) car2->controls = a.other.in;
		// Ill-conditioned contacts: the tick again from the same state with tiny jitters (per-tick mode only)
		bool indeterminate = false;
		float unjittered = 0;
		if (g_jitter > 0 && !continuous) {
			DataStreamOut snapshot;
			arena->Serialize(snapshot);
			auto restore = [&]() {
				DataStreamIn in;
				in.data = snapshot.data;
				arena->DeserializeInPlace(in);
				car->controls = a.in;
				if (car2 && a.hasOther) car2->controls = a.other.in;
			};
			arena->Step(ticks);
			std::vector<MeshPoint> first = MeshContacts(arena, car);
			unjittered = (car->GetState().vel - b.car.vel).Length();
			float best = unjittered;
			bool varies = false;
			// (where the engine touches a mesh, or the game touches the world and the engine may have missed it: RV-91f)
			if (!first.empty() || b.worldContact > 0) {
				for (int v = 0; v < g_jitter; v++) {
					restore();
					std::vector<JitteredFloat> undo;
					if (v % 2 == 0) {
						undo = JitterVertices(arena, car, 30, (uint32_t)(a.tick * 131 + v));
					} else { // (the car's origin, 0.001 uu along a seeded direction; the draws in order: RV-91c)
						std::minstd_rand0 random((uint32_t)(a.tick * 977 + v));
						float dx = (float)random() / random.max() - 0.5f;
						float dy = (float)random() / random.max() - 0.5f;
						float dz = (float)random() / random.max() - 0.5f;
						Vec d(dx, dy, dz);
						CarState cs = car->GetState();
						cs.pos += d * (0.001f / std::max(d.Length(), 1e-6f));
						car->SetState(cs);
						car->controls = a.in;
					}
					arena->Step(ticks);
					varies |= MeshContacts(arena, car) != first;
					best = std::min(best, (car->GetState().vel - b.car.vel).Length());
					Unjitter(undo);
				}
			}
			// (indeterminate only where one of the runs matches the game: a tick every variant misses is a real error)
			indeterminate = varies && best < 1.0f;
			restore();
		}
		arena->Step(ticks);
		if (a.tick >= contactsFrom && a.tick <= contactsTo) PrintContacts(arena, car, a.tick);
		CarState s = car->GetState();
		BallState bs = arena->ball->GetState();
		// (an indeterminate tick: listed, its row written with a flag, not counted: RV-91a)
		if (indeterminate) indeterminateTicks.push_back({ a.tick, unjittered });
		const float ePos = (s.pos - b.car.pos).Length(), eVel = (s.vel - b.car.vel).Length(),
		            eAng = (s.angVel - b.car.angVel).Length(), eRot = AngleBetween(s.rotMat, b.car.rot) * 57.2958f;
		const float eBallPos = b.hasBall ? (bs.pos - b.ball.pos).Length() : 0.f, eBallVel = b.hasBall ? (bs.vel - b.ball.vel).Length() : 0.f;
		if (!indeterminate) {
		compared++;
		carPos.push_back(ePos);
		carVel.push_back(eVel);
		carAng.push_back(eAng);
		carRot.push_back(eRot);
		if (b.hasBall) {
			ballPos.push_back(eBallPos);
			ballVel.push_back(eBallVel);
		}
		CarState s2 = car2 ? car2->GetState() : CarState();
		if (car2 && a.hasOther && (s2.isDemoed || !b.hasOther)) {
			char d[128];
			std::snprintf(d, sizeof d, "tick %llu: game %s, engine %s", (unsigned long long)a.tick, b.hasOther ? "no" : "yes",
			              s2.isDemoed ? "yes" : "no");
			demos.push_back(d);
		}
		if (car2 && b.hasOther) {
			car2Pos.push_back((s2.pos - b.other.car.pos).Length());
			car2Vel.push_back((s2.vel - b.other.car.vel).Length());
			car2Ang.push_back((s2.angVel - b.other.car.angVel).Length());
		}
		// The game's count is of wheels touching the world (not the ball or a car): compare like with like, and each
		// wheel's touching anything (its bHadContact) on its own
		int wheels = 0;
		for (const auto& w : s.wheelCarry.wheels) wheels += w.worldContact;
		groundMismatch += s.isOnGround != b.onGround;
		wheelMismatch += wheels != b.wheelContacts;
		for (int i = 0; i < 4; i++) touchMismatch += s.wheelsWithContact[i] != b.wheelContact[i];
		jumpMismatch += s.isJumping != b.jumpActive;
		dodgeMismatch += s.isFlipping != b.dodgeActive;
		if (b.worldContact >= 0) {
			worldContactCompared++;
			worldContactMismatch += s.worldContact.hasContact != (b.worldContact != 0);
		}
		}
		if (ticksOut) {
			int wheels = 0;
			for (const auto& w : s.wheelCarry.wheels) wheels += w.worldContact;
			CarState s2 = car2 ? car2->GetState() : CarState();
			const float e2Vel = car2 && b.hasOther ? (s2.vel - b.other.car.vel).Length() : 0.f;
			Vec dv = s.vel - b.car.vel, dw = s.angVel - b.car.angVel;
			Vec bdv = b.hasBall ? bs.vel - b.ball.vel : Vec(), bdw = b.hasBall ? bs.angVel - b.ball.angVel : Vec();
			fprintf(ticksOut, "%llu,%.5f,%.4f,%.6f,%.5f,%.5f,%.4f,%d,%d,%d,%d,%d,%d,%d,%d,%d,%.4f,%.4f,%.4f,%.5f,%.5f,%.5f,"
			                  "%.4f,%.4f,%.4f,%.5f,%.5f,%.5f,%d,%d,%.4f,%.4f,%.4f,%.4f,%d\n",
			        (unsigned long long)a.tick, ePos, eVel, eAng, eRot, eBallPos, eBallVel, b.onGround, s.isOnGround,
			        b.wheelContacts, wheels, b.jumpActive, s.isJumping, b.dodgeActive, s.isFlipping, resync, dv.x, dv.y,
			        dv.z, dw.x, dw.y, dw.z, bdv.x, bdv.y, bdv.z, bdw.x, bdw.y, bdw.z, b.worldContact, (int)s.worldContact.hasContact,
			        e2Vel, car2 && b.hasOther ? s2.vel.x - b.other.car.vel.x : 0.f,
			        car2 && b.hasOther ? s2.vel.y - b.other.car.vel.y : 0.f, car2 && b.hasOther ? s2.vel.z - b.other.car.vel.z : 0.f,
			        (int)indeterminate);
		}
	}
	if (ticksOut) fclose(ticksOut);
	printf("%d ticks compared (%s%s), %d placements skipped\n", compared,
	       continuous ? "continuous" : "state set from the recording every tick",
	       continuous ? (", " + std::to_string(resyncs) + " resyncs").c_str() : "", placements);
	if (!indeterminateTicks.empty()) {
		std::string list;
		for (auto [t, residual] : indeterminateTicks) {
			char one[64];
			std::snprintf(one, sizeof one, "%s%llu (%.2f)", list.empty() ? "" : " ", (unsigned long long)t, residual);
			list += one;
		}
		printf("%zu indeterminate ticks (ill-conditioned contacts, not counted; in brackets the unjittered run's car velocity "
		       "error, uu/s): %s\n", indeterminateTicks.size(), list.c_str());
	}
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
	for (const std::string& d : demos) printf("  second car demolished, %s\n", d.c_str());
	if (car2) {
		line("car2 position", car2Pos, "uu");
		line("car2 velocity", car2Vel, "uu/s");
		line("car2 angular velocity", car2Ang, "rad/s");
	}
	printf("  state mismatches: on ground %d, wheels on the world %d, wheel touches %d, jumping %d, flipping %d (of %d)\n",
	       groundMismatch, wheelMismatch, touchMismatch, jumpMismatch, dodgeMismatch, compared);
	if (worldContactCompared)
		printf("  world contact (the car's body on world geometry, after the tick): %d mismatches of %d\n", worldContactMismatch,
		       worldContactCompared);
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
		// (each trial from this row's rotation's inertia tensor, so all start alike)
		auto err = [&](float steer) {
			SetBody(car, base, a, false, true);
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
		SetBody(car, base, a, false, true);
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
	// (an option's number, all of it: garbage or a value out of range is an error, not an abort or a prefix: RV-97)
	auto number = [](const std::string& s, auto parse) {
		size_t used = 0;
		auto v = parse(s, &used);
		if (used != s.size()) throw std::invalid_argument(s);
		return v;
	};
	// (and in range: a sensitivity a finite number >= 0, the jitter's count >= 0, the contacts' FROM <= TO: RV-117)
	auto toFloat = [&](const std::string& s) {
		float v = number(s, [](const std::string& t, size_t* u) { return std::stof(t, u); });
		if (!std::isfinite(v) || v < 0) throw std::out_of_range(s);
		return v;
	};
	auto toInt = [&](const std::string& s) {
		int v = number(s, [](const std::string& t, size_t* u) { return std::stoi(t, u); });
		if (v < 0) throw std::out_of_range(s);
		return v;
	};
	auto toTick = [&](const std::string& s) {
		if (s.empty() || s[0] == '-') throw std::invalid_argument(s);
		return number(s, [](const std::string& t, size_t* u) { return std::stoull(t, u); });
	};
	for (int i = 1; i < argc; i++) {
		std::string a = argv[i];
		try {
		if (a == "--meshes" && i + 1 < argc) meshes = argv[++i];
		else if (a == "--preset" && i + 1 < argc) preset = argv[++i];
		else if (a == "--ticks" && i + 1 < argc) ticksPath = argv[++i];
		else if (a == "--steer-sensitivity" && i + 1 < argc) sens.steer = toFloat(argv[++i]);
		else if (a == "--contacts" && i + 1 < argc) { // FROM-TO: print the car's contact points after these ticks
			std::string r = argv[++i];
			size_t dash = r.find('-');
			contactsFrom = toTick(r.substr(0, dash));
			contactsTo = dash == std::string::npos ? contactsFrom : toTick(r.substr(dash + 1));
			if (contactsTo < contactsFrom) throw std::out_of_range(r);
		}
		else if (a == "--air-sensitivity" && i + 1 < argc) sens.air = toFloat(argv[++i]);
		else if (a == "--continuous") continuous = true;
		else if (a == "--jitter" && i + 1 < argc) g_jitter = toInt(argv[++i]); // (0: no indeterminate ticks)
		else if (a == "--synth") synth = true;
		else if (a == "--fit-steer") fitSteer = true;
		else if (a.rfind("--", 0) == 0) { // (an option misspelt, or its value missing, isn't ignored)
			fprintf(stderr, "live_validate: unknown option or missing value: %s\n", a.c_str());
			return 1;
		}
		else positional.push_back(a);
		} catch (const std::logic_error&) { // (std::invalid_argument, std::out_of_range)
			fprintf(stderr, "live_validate: bad value for %s: %s\n", a.c_str(), argv[i]);
			return 1;
		}
	}
	if (positional.size() > (synth ? 2u : 1u)) {
		fprintf(stderr, "live_validate: unexpected argument: %s\n", positional.back().c_str());
		return 1;
	}
	if (positional.size() < (synth ? 2u : 1u)) {
		fprintf(stderr, "usage: live_validate LOG.csv [--continuous] [--preset NAME] [--ticks OUT.csv]\n"
		                "                     [--steer-sensitivity X] [--air-sensitivity X]   (default: the recording's)\n"
		                "                     [--meshes DIR]        (default: the generated arena; the cooked meshes: local only)\n"
		                "                     [--jitter N]          (default 8; 0: no indeterminate ticks)\n"
		                "                     [--contacts FROM[-TO]] (print the car's contact points after these ticks)\n"
		                "       live_validate LOG.csv --fit-steer [--preset NAME]\n"
		                "       live_validate --synth SCENARIO.txt OUT.csv [--preset NAME]\n");
		return 1;
	}
	// (the generated arena by default; --meshes out/arena_local/cooked: the game's cooked meshes, local only, for exactness)
	printf("arena meshes: %s\n", meshes.c_str());
	RocketSim::Init(meshes, true);
	if (synth) return Synth(positional[0].c_str(), positional[1].c_str(), preset);
	if (fitSteer) return FitSteer(positional[0].c_str(), preset, sens);
	return Validate(positional[0].c_str(), preset, sens, continuous, ticksPath, contactsFrom, contactsTo);
}
