// Physics validation against Rocket League replays (notes/validation.md).
//
// Replays carry the server's physics states exactly as the game quantizes them every tick (positions and velocities
// in 0.01 steps), so a replay frame's states can be put into the engine as they were on the server. The engine then
// steps tick by tick and is compared with the replay's next frame. Replays don't say how many physics ticks lie
// between two frames (about 4 at 30 frames/s), so the tick count k is fitted (the best of 1..KMAX).
//
// Cases (consecutive replay frames, both with a ball state):
//   ball        no car near the ball. Split: free flight / touching the arena (from the engine's run)
//   car         exactly one car near the ball, its state in both frames, Octane hitbox (Octane, Fennec), its replicated
//               inputs unchanged between the frames and no jump/double jump/dodge active. Pitch/yaw/roll are not
//               replicated: cars in the air are simulated without air control and reported separately.
//               Split: ground / air, touching the ball in the engine's run or not, dribble (ball resting on the roof)
//
// Car–car cases (--carcar OUT.csv): two cars close together, far from the ball and the other cars, simulated together
// and each alone (an alone error far above the pair error: the engine's bump/contact explains the game's). With
// --demos DEMOS.csv (replay_extract --demos), demolitions between the frames are marked, and the attacker is also run
// with the victim leaving before the demo tick's contact is solved.
//
// Usage: replay_validate STATES.csv [--meshes DIR] [--cases OUT.csv] [--no-sensitivity] [--no-warmup] [--zero-ball-spin]
//                        [--limit N] [--carcar OUT.csv [--demos DEMOS.csv]]
//   STATES.csv from scripts/replay_extract.
#include "RocketSim.h"
#include "Sim/Quantize/Quantize.h"

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

static constexpr int KMAX = 30;
static constexpr float NEAR_BALL = 400;   // a car this close (centres) takes part in the case
static constexpr float FAR_BALL = 700;    // every other car at least this far
static constexpr float MAX_CAR_AGE = 0.3; // seconds: older car states are too stale to rule a car out

struct Body {
	Vec pos, vel, angVel;
	RotMat rot;
	bool sleeping = false;
};

struct CarRow {
	int actor = 0;
	Body b;
	int throttle = 128, steer = 128;
	bool handbrake = false, boosting = false, jump = false, doubleJump = false, dodge = false;
	int boostAmount = 0, body = 0, team = 0;
	float sensitivity = 1;
	float handbrakeVal = 0; // reconstructed from the handbrake history (rises 5/s while held, falls 2/s)
	Vec dodgeTorque;        // replicated DodgeTorque /100: roll, pitch (e.g. 1.84, 1.58)
	float jumpSince = -1, doubleJumpSince = -1, dodgeSince = -1; // seconds since that component became active
	bool supersonic = false; // reconstructed from the speed history (ReconstructSupersonic)
	float timeBelowSupersonic = 0;
};

struct Frame {
	int index = 0;
	double time = 0;
	bool hasBall = false;
	Body ball;
	std::vector<CarRow> cars;
};

struct Replay {
	std::string name;
	std::vector<Frame> frames;
};

static RotMat FromQuat(float x, float y, float z, float w) {
	return RotMat(
		Vec(1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)),
		Vec(2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)),
		Vec(2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)));
}

// Replays carry the game's input bytes (128 + q, see Quantize::InputAxisByte)
static float DecodeAxis(int b) {
	return Quantize::InputAxisValue((int8_t)(b - 128));
}

static bool g_haveRampColumn = false;

static std::vector<Replay> Load(const char* path) {
	std::ifstream in(path);
	if (!in) {
		fprintf(stderr, "cannot open %s\n", path);
		exit(1);
	}
	std::string line;
	std::getline(in, line); // header
	std::vector<Replay> replays;
	std::vector<std::string> f;
	while (std::getline(in, line)) {
		f.clear();
		size_t start = 0;
		for (;;) {
			size_t comma = line.find(',', start);
			f.push_back(line.substr(start, comma - start));
			if (comma == std::string::npos) break;
			start = comma + 1;
		}
		if (f.size() < 30) continue;
		if (replays.empty() || replays.back().name != f[0]) replays.push_back({ f[0], {} });
		Replay& r = replays.back();
		int index = std::stoi(f[1]);
		if (r.frames.empty() || r.frames.back().index != index) {
			r.frames.push_back({});
			r.frames.back().index = index;
			r.frames.back().time = std::stod(f[2]);
		}
		Frame& fr = r.frames.back();
		auto num = [&](int i) { return std::stof(f[i]); };
		Body b;
		b.pos = Vec(num(5), num(6), num(7));
		b.rot = FromQuat(num(8), num(9), num(10), num(11));
		b.vel = Vec(num(12), num(13), num(14));
		b.angVel = Vec(num(15), num(16), num(17)) / 100; // replicated as rad/s × 100
		b.sleeping = f[18] == "1";
		if (f[3] == "ball") {
			fr.hasBall = true;
			fr.ball = b;
		} else {
			CarRow c;
			c.actor = std::stoi(f[4]);
			c.b = b;
			c.throttle = std::stoi(f[19]);
			c.steer = std::stoi(f[20]);
			c.handbrake = f[21] == "1";
			c.boosting = f[22] == "1";
			c.jump = f[23] == "1";
			c.doubleJump = f[24] == "1";
			c.dodge = f[25] == "1";
			c.boostAmount = std::stoi(f[26]);
			c.body = f[27].empty() ? 0 : std::stoi(f[27]);
			c.sensitivity = f[28].empty() ? 1 : num(28);
			c.team = std::stoi(f[29]);
			if (f.size() > 30 && !f[30].empty()) {
				c.handbrakeVal = num(30); // from the extractor (frame-resolution history)
				g_haveRampColumn = true;
			}
			if (f.size() > 36) {
				c.dodgeTorque = Vec(num(31), num(32), num(33));
				c.jumpSince = f[34].empty() ? -1 : num(34);
				c.doubleJumpSince = f[35].empty() ? -1 : num(35);
				c.dodgeSince = f[36].empty() ? -1 : num(36);
			}
			fr.cars.push_back(c);
		}
	}
	return replays;
}

// The handbrake ramps (POWERSLIDE_RISE_RATE 5/s, FALL_RATE 2/s) and replays only carry whether it is held:
// integrate each car's history (coarse: at the car's own rows; the extractor does it per frame)
static void ReconstructHandbrake(std::vector<Replay>& replays) {
	for (Replay& r : replays) {
		struct Track { double time; float val; bool held; };
		std::map<int, Track> tracks;
		for (Frame& f : r.frames) {
			for (CarRow& c : f.cars) {
				auto it = tracks.find(c.actor);
				if (it == tracks.end()) {
					tracks[c.actor] = { f.time, c.handbrake ? 1.f : 0.f, c.handbrake };
				} else {
					Track& t = it->second;
					float dt = (float)(f.time - t.time);
					t.val = std::clamp(t.val + (t.held ? 5.f : -2.f) * dt, 0.f, 1.f);
					t.time = f.time;
					t.held = c.handbrake;
				}
				c.handbrakeVal = tracks[c.actor].val;
			}
		}
	}
}

// The game's supersonic flag (on from 2200; off after 1 s below that or under 2100), from each car's rows
static void ReconstructSupersonic(std::vector<Replay>& replays) {
	for (Replay& r : replays) {
		struct Track { double time; bool on; float below; };
		std::map<int, Track> tracks;
		for (Frame& f : r.frames) {
			for (CarRow& c : f.cars) {
				auto it = tracks.find(c.actor);
				Track t = it == tracks.end() ? Track{ f.time, false, 0 } : it->second;
				float speed = c.b.vel.Length();
				if (speed >= RLConst::SUPERSONIC_START_SPEED) {
					t.on = true;
					t.below = 0;
				} else if (t.on) {
					t.below += (float)(f.time - t.time);
					if (t.below >= RLConst::SUPERSONIC_MAINTAIN_MAX_TIME || speed < RLConst::SUPERSONIC_MAINTAIN_MIN_SPEED)
						t.on = false;
				}
				t.time = f.time;
				tracks[c.actor] = t;
				c.supersonic = t.on;
				c.timeBelowSupersonic = t.below;
			}
		}
	}
}

static std::vector<uint8_t> Snapshot(Arena* arena) {
	DataStreamOut out;
	arena->Serialize(out);
	return out.data;
}

static void Restore(Arena* arena, const std::vector<uint8_t>& bytes) {
	DataStreamIn in;
	in.data = bytes;
	if (!arena->DeserializeInPlace(in)) {
		fprintf(stderr, "in-place restore failed\n");
		exit(1);
	}
	arena->tickCount = 1000; // (ball hit cooldowns compare with tick counts)
}

static void SetBall(Arena* arena, const Body& b) {
	BallState s;
	s.pos = b.pos;
	s.rotMat = b.rot;
	s.vel = b.vel;
	s.angVel = b.angVel;
	arena->ball->SetState(s);
}

static float AngleBetween(const RotMat& a, const RotMat& b) {
	// rotation angle of a^T b
	float trace = a.forward.Dot(b.forward) + a.right.Dot(b.right) + a.up.Dot(b.up);
	return acosf(std::clamp((trace - 1) / 2, -1.f, 1.f));
}

struct Errors {
	float ballPos = 0, ballVel = 0, ballAng = 0;
	float carPos = 0, carVel = 0, carAng = 0, carRot = 0;
	float ballisticPos = 0; // the ball with gravity only, same k (context)
	int k = 0;
	int kBall = 0, kCar = 0; // the best tick counts for each body alone (in this run)
	int carTicks = 0; // the car's ticks from its first-frame state to the compared one (incl. any catch-up alone)
	float ballPosAlone = 0, carPosAlone = 0; // their errors there
	bool worldContact = false, ballTouch = false, carOnGround = false;
	int wheelsStart = 0; // wheels touching after the first tick
	int firstTouch = 0; // the tick the car first touched the ball (0: no touch)
	Vec ballVelDiff; // engine - replay
	Vec replayKick, engineKick; // the ball's velocity change over the interval beyond gravity: game, engine
	Vec carPosLocal, carVelLocal; // engine - replay, in the replay car's frame (forward, right, up)
	float carYawRateErr = 0; // engine - replay, about the car's up axis (rad/s)
};

struct Case {
	std::string replay;
	int frame = 0;
	double dt = 0;
	std::string category;
	Errors e;
	Errors blocked; // car cases: the extra hit impulse not allowed on the first tick (contact going on)
	int offset = 0, blockedOffset = 0; // car cases: ticks the car's state is ahead of the ball's in the first frame
	bool dribble = false;
	float relSpeed = 0;
	const CarRow* car = nullptr; // car cases: the car's first-frame row
	const CarRow* carNext = nullptr; // and its row in the compared frame
	Vec rel, relLocal; // ball - car centre at the first frame: world, car frame (forward, right, up)
	float relVelN = 0;  // ball - car velocity along the direction from car to ball (negative: approaching)
	float hbBest = 0, hbBestErr = 0; // car-alone with --fit-handbrake: the best ramp value and its error
	int flipShift = 0; float flipBestErr = 0; // car-alone with --fit-flip-time
	int switchTick = -1; // car-alone input changes: the fitted tick of the change
};

struct Arenas {
	Arena* ballOnly;
	std::vector<uint8_t> ballClean;
	Arena* withCar;
	Car* car;
	std::vector<uint8_t> carClean;
};

// Puts a replay car state into the car arena (and the ball). `warmup`: the wheels' forces use values from the previous
// tick (wheel carry), which a replay doesn't have: compute them with one tick from this state (ball out of the way),
// then put the state back.
static Body Parked(const Body& ball, const CarRow& car) {
	Body parked = ball;
	parked.pos = Vec(car.b.pos.x > 0 ? -3000 : 3000, car.b.pos.y > 0 ? -4000 : 4000, 1000);
	parked.vel = parked.angVel = Vec();
	return parked;
}

static float g_handbrakeOverride = -1; // (diagnostic: force a handbrake ramp value)
static float g_flipTimeShift = 0; // (diagnostic: added to the reconstructed flip time)
static int g_jumpPressAt = -1;
// Pre-dodge (diagnostic): the dodge starts during the run at this tick (0 = the first), with the stick direction that
// gives the replicated DodgeTorque; -1 = off
static int g_dodgePressAt = -1;
static Vec g_dodgeStick; // pitch, yaw // Run: jump pressed from this tick on (0 = the first), -1 = controls unchanged

// The jump component's flag can arrive before the car's state shows the jump (separate network actors): a car
// flagged as jumping that isn't moving up yet hasn't jumped in this state
static bool PreJump(const CarRow& c) {
	return c.jump && c.b.vel.Dot(c.b.rot.up) < 50;
}
static bool g_handbrakeHistory = true;
// Run: the controls change to g_switchControls from this tick on (0 = the first), -1 = unchanged (input changes
// between two replay frames happen at an unknown tick)
static int g_switchAt = -1;
static CarControls g_switchControls;
// Experiment (--warmup-previous): the wheel carry comes from simulating the car's previous row up to this state
// instead of one tick at this state. Set per case by the car-alone pass.
static const CarRow* g_warmupFrom = nullptr;
static int g_warmupTicks = 0;

static void SetupCar(Arenas& A, const CarRow& c0, const CarControls& controls, bool useSensitivity, bool warmup,
                     const Body& ball) {
	Restore(A.withCar, A.carClean);
	CarConfig config = A.car->config; // (the arena's car has its preset; only the player's sensitivity changes)
	config.steeringSensitivity = useSensitivity ? c0.sensitivity : 1.f;
	A.car->config = config;
	CarState s = A.car->GetState();
	s.pos = c0.b.pos;
	s.rotMat = c0.b.rot;
	s.vel = c0.b.vel;
	s.angVel = c0.b.angVel;
	bool flat = s.pos.z < 60 && s.rotMat.up.z > 0.95f;
	s.isOnGround = flat;
	for (bool& w : s.wheelsWithContact) w = flat;
	s.hasJumped = !flat;
	s.boost = std::max(c0.boostAmount / 255.f * 100.f, c0.boosting ? 1.f : 0.f);
	s.isBoosting = c0.boosting;
	s.boostingTime = c0.boosting ? 1.f : 0.f;
	s.handbrakeVal = g_handbrakeOverride >= 0 ? g_handbrakeOverride
	                 : g_handbrakeHistory     ? c0.handbrakeVal
	                                          : (c0.handbrake ? 1.f : 0.f);
	s.isSupersonic = c0.supersonic;
	s.supersonicTime = c0.supersonic ? c0.timeBelowSupersonic : 0;
	if (PreJump(c0)) { // the jump starts during the run (Run presses it at g_jumpPressAt)
		s.hasJumped = false;
		s.isJumping = false;
		s.jumpTime = 0;
	} else if (c0.jump && c0.jumpSince >= 0) { // the jump component is active: its force applies while the jump is held
		s.hasJumped = true;
		s.isJumping = true;
		s.jumpTime = c0.jumpSince;
	}
	if (c0.doubleJump || c0.doubleJumpSince >= 0) s.hasDoubleJumped = true;
	if (c0.dodge && c0.dodgeSince >= 0) { // flipping: torque for 0.65 s from the start, from the replicated DodgeTorque
		s.hasJumped = true;
		s.hasFlipped = true;
		s.flipTime = std::max(0.f, c0.dodgeSince + g_flipTimeShift);
		s.isFlipping = s.flipTime < RLConst::FLIP_TORQUE_TIME;
		s.flipRelTorque = Vec(c0.dodgeTorque.x * 100 / RLConst::FLIP_TORQUE_X, c0.dodgeTorque.y * 100 / RLConst::FLIP_TORQUE_Y, 0);
	}
	s.lastControls = controls;
	if (PreJump(c0)) s.lastControls.jump = false;
	A.car->SetState(s);
	A.car->controls = controls;
	if (PreJump(c0)) A.car->controls.jump = false; // (not during the warm-up)
	if (warmup) {
		SetBall(A.withCar, Parked(ball, c0));
		if (g_warmupFrom) { // the previous row with its own one-tick carry, then simulated up to this state
			auto place = [&](CarState q) {
				q.pos = g_warmupFrom->b.pos;
				q.rotMat = g_warmupFrom->b.rot;
				q.vel = g_warmupFrom->b.vel;
				q.angVel = g_warmupFrom->b.angVel;
				A.car->SetState(q);
			};
			place(s);
			A.withCar->Step(1);
			place(A.car->GetState());
			A.withCar->Step(g_warmupTicks);
		} else {
			A.withCar->Step(1);
		}
		CarState warm = A.car->GetState();
		warm.pos = s.pos;
		warm.rotMat = s.rotMat;
		warm.vel = s.vel;
		warm.angVel = s.angVel;
		warm.boost = s.boost;
		warm.ballHitInfo = s.ballHitInfo;
		warm.handbrakeVal = s.handbrakeVal;
		warm.isJumping = s.isJumping;
		warm.jumpTime = s.jumpTime;
		warm.hasJumped = s.hasJumped;
		warm.hasDoubleJumped = s.hasDoubleJumped;
		warm.hasFlipped = s.hasFlipped;
		warm.isFlipping = s.isFlipping;
		warm.flipTime = s.flipTime;
		warm.flipRelTorque = s.flipRelTorque;
		warm.lastControls = s.lastControls;
		A.car->SetState(warm);
	}
	SetBall(A.withCar, ball);
}

static CarControls ReplayControls(const CarRow& c) {
	CarControls controls;
	controls.jump = c.jump; // (held while the jump component is active)
	controls.throttle = DecodeAxis(c.throttle);
	controls.steer = DecodeAxis(c.steer);
	controls.handbrake = c.handbrake;
	controls.boost = c.boosting;
	return controls;
}

// A car mid-action (its state reconstructed from the replicated components)
static std::string Action(const CarRow& c) {
	if (c.dodge) return c.dodgeSince < RLConst::FLIP_TORQUE_TIME ? "flipping" : "after a flip";
	if (c.jump) return "jumping";
	if (c.doubleJump) return "double jump";
	return "";
}

// Distance from the ball's surface to the nearest flat arena surface (floor, ceiling, side walls, back walls)
static float ArenaGap(const Vec& p) {
	float g = std::min(p.z - 92.f, 2048.f - p.z - 92.f);
	g = std::min(g, 4096.f - fabsf(p.x) - 92.f);
	if (fabsf(p.x) > 893 || p.z > 642) g = std::min(g, 5120.f - fabsf(p.y) - 92.f);
	return g;
}

// Where a car is, for the car-alone report
static std::string Place(const CarRow& c) {
	const Vec& p = c.b.pos;
	if (fabsf(p.y) > 5120) return fabsf(p.x) > 750 ? "in goal by the side wall" : "in goal";
	if (p.z < 20 && c.b.rot.up.z > 0.99f) return "flat floor";
	return "walls/curves/ceiling";
}

static bool OctaneHitbox(int body);
static float Percentile(std::vector<float> v, float p);

// Steps up to KMAX ticks. The ball's errors are taken at its best tick count and the car's at its own: their states
// in a replay frame can be from server ticks a few apart. `ballTicksBefore`: ticks the ball was advanced alone first.
static Errors Run(Arena* arena, Car* car, const Frame& next, const CarRow* carNext, const Body& ballStart,
                  int ballTicksBefore = 0, int carTicksBefore = 0) {
	Errors best;
	float bestBall = 1e30f, bestCar = 1e30f;
	bool contact = false, touch = false, ground = false;
	int firstTouch = 0;
	BallState prev = arena->ball->GetState();
	uint64_t startTick = arena->tickCount;
	for (int k = 1; k <= KMAX; k++) {
		if (car && g_jumpPressAt >= 0) car->controls.jump = k > g_jumpPressAt;
		if (car && g_switchAt >= 0 && k == g_switchAt + 1) car->controls = g_switchControls;
		if (car && g_dodgePressAt >= 0) {
			bool press = k == g_dodgePressAt + 1;
			car->controls.jump = k > g_dodgePressAt;
			car->controls.pitch = press ? g_dodgeStick.x : 0;
			car->controls.yaw = press ? g_dodgeStick.y : 0;
		}
		arena->Step(1);
		BallState bs = arena->ball->GetState();
		bool touchedNow = car && car->_internalState.ballHitInfo.isValid &&
		                  car->_internalState.ballHitInfo.tickCountWhenHit >= startTick;
		// world contact: a velocity change beyond gravity and drag
		Vec expected = prev.vel + Vec(0, 0, -650.f / 120.f);
		if ((bs.vel - expected).Length() > 3 && !touchedNow) contact = true;
		prev = bs;
		float ballPos = (bs.pos - next.ball.pos).Length();
		if (ballPos < bestBall) {
			bestBall = ballPos;
			best.k = best.kBall = k;
			best.ballPos = ballPos;
			best.ballVel = (bs.vel - next.ball.vel).Length();
			best.ballAng = (bs.angVel - next.ball.angVel).Length();
			best.ballVelDiff = bs.vel - next.ball.vel;
			Vec gravity(0, 0, -650.f * (k + ballTicksBefore) / 120.f);
			best.replayKick = next.ball.vel - ballStart.vel - gravity;
			best.engineKick = bs.vel - ballStart.vel - gravity;
			float t = (k + ballTicksBefore) / 120.f;
			Vec ballistic = ballStart.pos + ballStart.vel * t + Vec(0, 0, -325.f * t * t);
			best.ballisticPos = (ballistic - next.ball.pos).Length();
		}
		if (car) {
			CarState cs = car->GetState(); // (refreshes the physical fields from the rigid body)
			if (k == 1) {
				ground = cs.isOnGround;
				best.wheelsStart = cs.wheelsWithContact[0] + cs.wheelsWithContact[1] + cs.wheelsWithContact[2] + cs.wheelsWithContact[3];
			}
			if (touchedNow && !touch) {
				touch = true;
				firstTouch = k;
			}
			float carPos = (cs.pos - carNext->b.pos).Length();
			if (carPos < bestCar) {
				bestCar = carPos;
				best.kCar = k;
				best.carTicks = k + carTicksBefore;
				best.carPos = carPos;
				best.carVel = (cs.vel - carNext->b.vel).Length();
				best.carAng = (cs.angVel - carNext->b.angVel).Length();
				best.carRot = AngleBetween(cs.rotMat, carNext->b.rot);
				const RotMat& m = carNext->b.rot;
				Vec dp = cs.pos - carNext->b.pos, dv = cs.vel - carNext->b.vel;
				best.carPosLocal = Vec(dp.Dot(m.forward), dp.Dot(m.right), dp.Dot(m.up));
				best.carVelLocal = Vec(dv.Dot(m.forward), dv.Dot(m.right), dv.Dot(m.up));
				best.carYawRateErr = (cs.angVel - carNext->b.angVel).Dot(m.up);
			}
		}
	}
	best.ballPosAlone = bestBall;
	best.carPosAlone = car ? bestCar : 0;
	best.worldContact = contact;
	best.firstTouch = firstTouch;
	best.ballTouch = touch && firstTouch <= best.kBall; // touched before the compared tick
	best.carOnGround = ground;
	return best;
}

static bool OctaneHitbox(int body) {
	return body == 23 || body == 4284; // Octane, Fennec
}

// ---- Other car bodies ----
// Cars whose body isn't on the Octane hitbox, alone and with unchanged inputs, run once with each of RocketSim's
// presets: the best fit names the body's preset, and its error says whether that preset matches the game.
static void BodiesPass(const std::vector<Replay>& replays, std::vector<Arenas>& presets, const std::string& outPath,
                       bool useSensitivity, bool warmup) {
	FILE* out = fopen(outPath.c_str(), "w");
	fprintf(out, "replay,frame,body,place,speed,throttle,steer,handbrake,boost,hb_ramp,octane,dominus,plank,breakout,hybrid,merc\n");
	size_t n = 0;
	for (const Replay& r : replays) {
		std::map<int, std::pair<CarRow, double>> lastCar;
		const Body* ball = nullptr;
		double ballTime = 0;
		for (size_t i = 0; i + 1 < r.frames.size(); i++) {
			const Frame& f0 = r.frames[i];
			for (const CarRow& c : f0.cars) lastCar[c.actor] = { c, f0.time };
			if (f0.hasBall) {
				ball = &f0.ball;
				ballTime = f0.time;
			}
			if (!ball || f0.time - ballTime > 0.1) continue;
			for (const CarRow& c0 : f0.cars) {
				if (c0.body == 0 || OctaneHitbox(c0.body) || c0.b.sleeping || c0.jump || c0.doubleJump || c0.dodge) continue;
				Vec ballPos = ball->pos + ball->vel * (float)(f0.time - ballTime);
				if ((ballPos - c0.b.pos).Length() < 900) continue;
				bool crowded = false;
				for (auto& [actor, entry] : lastCar) {
					double age = f0.time - entry.second;
					if (actor == c0.actor || age > 2) continue;
					Vec p = entry.first.b.pos + entry.first.b.vel * (float)age;
					if ((p - c0.b.pos).Length() < 600 + (float)age * 2300) crowded = true;
				}
				if (crowded) continue;
				const CarRow* c1 = nullptr;
				const Frame* fNext = nullptr;
				for (size_t j = i + 1; j < r.frames.size() && j <= i + 3 && !c1; j++) {
					if (r.frames[j].time - f0.time > 0.15) break;
					for (const CarRow& c : r.frames[j].cars) if (c.actor == c0.actor) c1 = &c;
					if (c1) fNext = &r.frames[j];
				}
				if (!c1 || c1->jump || c1->doubleJump || c1->dodge || c0.throttle != c1->throttle || c0.steer != c1->steer ||
				    c0.handbrake != c1->handbrake || c0.boosting != c1->boosting)
					continue;
				CarControls controls = ReplayControls(c0);
				Body parked = Parked(*ball, c0);
				fprintf(out, "%s,%d,%d,%s,%.1f,%d,%d,%d,%d,%.3f", r.name.c_str(), f0.index, c0.body, Place(c0).c_str(), c0.b.vel.Length(),
				        c0.throttle, c0.steer, (int)c0.handbrake, (int)c0.boosting, c0.handbrakeVal);
				for (Arenas& A : presets) {
					SetupCar(A, c0, controls, useSensitivity, warmup, parked);
					fprintf(out, ",%.4f", Run(A.withCar, A.car, *fNext, c1, parked).carPos);
				}
				fprintf(out, "\n");
				n++;
			}
		}
	}
	fclose(out);
	printf("bodies: %zu cases -> %s\n", n, outPath.c_str());
}

// ---- Car–car ----

struct Demo {
	int frame, attacker, victim;
};

// Replicated demolitions, each once (the attribute is sent again with later updates)
static std::map<std::string, std::vector<Demo>> LoadDemos(const std::string& path) {
	std::map<std::string, std::vector<Demo>> demos;
	std::ifstream in(path);
	if (!in) {
		fprintf(stderr, "cannot open %s\n", path.c_str());
		exit(1);
	}
	std::string line;
	std::getline(in, line);
	std::map<std::string, bool> seen;
	while (std::getline(in, line)) {
		std::vector<std::string> f;
		std::stringstream ss(line);
		for (std::string x; std::getline(ss, x, ',');) f.push_back(x);
		if (f.size() < 11 || f[3] == "-1") continue;
		std::string key = f[0] + "," + f[4];
		for (int i = 5; i < 11; i++) key += "," + f[i];
		if (seen[key]) continue;
		seen[key] = true;
		demos[f[0]].push_back({ std::stoi(f[1]), std::stoi(f[3]), std::stoi(f[4]) });
	}
	return demos;
}

static int g_bumps = 0, g_demos = 0;
static bool g_demoSkipsContact = false; // the victim leaves before the demo tick's contact is solved
// The first event with car a as the bumper: its supersonic flag, forward speed and the victim's direction (hitbox
// centres, start-of-tick) as yaw/pitch angles in its frame
struct BumpEvent {
	bool valid = false, supersonic = false;
	float fwdSpeed = 0, yaw = 0, pitch = 0;
};
static Car* g_eventCar = nullptr;
static BumpEvent g_event;
static void OnBump(Arena*, Car* bumper, Car* victim, bool isDemo, void*) {
	if (bumper == g_eventCar && !g_event.valid) {
		const PhysState &s = bumper->_oldState, &o = victim->_oldState;
		auto centre = [](const PhysState& st, const Vec& off) {
			return st.pos + st.rotMat.forward * off.x + st.rotMat.right * off.y + st.rotMat.up * off.z;
		};
		Vec d = (centre(o, victim->config.hitboxPosOffset) - centre(s, bumper->config.hitboxPosOffset)).Normalized();
		float fwd = s.vel.Dot(s.rotMat.forward);
		Vec f = fwd < 0 ? -s.rotMat.forward : s.rotMat.forward;
		g_event.valid = true;
		g_event.supersonic = bumper->_internalState.isSupersonic;
		g_event.fwdSpeed = fwd;
		g_event.yaw = atan2f(fabsf(d.Dot(s.rotMat.right)), d.Dot(f)) * 57.2958f;
		g_event.pitch = atan2f(fabsf(d.Dot(s.rotMat.up)), d.Dot(f)) * 57.2958f;
	}
	if (isDemo) {
		g_demos++;
		if (g_demoSkipsContact) victim->_rigidBody.m_collisionFlags |= btCollisionObject::CF_NO_CONTACT_RESPONSE;
	} else {
		g_bumps++;
	}
}

struct PairArena {
	Arena* arena;
	Car *a, *b;
	std::vector<uint8_t> clean;
};

struct PairErrors {
	float a = 1e9f, b = 1e9f; // position error at each car's best tick count (b: 0 when not compared)
	float aVel = 0, bVel = 0;
	int kA = 0, kB = 0;
	int bumps = 0, demos = 0;
	float aSpeed = 0; // the attacker's (a's) engine speed at its best tick
	BumpEvent event;
};

// Steps both cars up to KMAX ticks, comparing each with its next-frame row (b1 null: b not compared)
static PairErrors RunPair(PairArena& P, const CarState& sa, const CarState& sb, const CarControls& ca,
                          const CarControls& cb, const CarRow* a1, const CarRow* b1, const Body& ball) {
	Restore(P.arena, P.clean);
	P.a->SetState(sa);
	P.b->SetState(sb);
	P.a->controls = ca;
	P.b->controls = cb;
	SetBall(P.arena, ball);
	g_bumps = g_demos = 0;
	g_eventCar = P.a;
	g_event = {};
	PairErrors e;
	if (!b1) e.b = 0;
	for (int k = 1; k <= KMAX; k++) {
		P.arena->Step(1);
		CarState s = P.a->GetState();
		float d = (s.pos - a1->b.pos).Length();
		if (d < e.a) {
			e.a = d;
			e.kA = k;
			e.aVel = (s.vel - a1->b.vel).Length();
			e.aSpeed = s.vel.Length();
		}
		if (b1) {
			CarState t = P.b->GetState();
			float db = (t.pos - b1->b.pos).Length();
			if (db < e.b) {
				e.b = db;
				e.kB = k;
				e.bVel = (t.vel - b1->b.vel).Length();
			}
		}
	}
	e.bumps = g_bumps;
	e.demos = g_demos;
	e.event = g_event;
	return e;
}

struct CarCarCase {
	std::string replay;
	int frame = 0;
	double dt = 0;
	bool demo = false, sameTeam = false;
	const CarRow *a0 = nullptr, *b0 = nullptr, *a1 = nullptr, *b1 = nullptr; // a: the attacker in demo cases
	float dist0 = 0, distMin = 0, closing = 0;
	PairErrors pair, skip; // skip: demo cases, the victim leaving before the demo tick's contact is solved
	int offset = 0, skipOffset = 0;
	float aAlone = 0, bAlone = 0;
	bool ballNear = false, inputsChanged = false;
};

static void CarCarPass(const std::vector<Replay>& replays, Arenas& A, const std::string& outPath,
                       const std::string& demosPath, bool useSensitivity, bool warmup, size_t limit) {
	auto demos = demosPath.empty() ? std::map<std::string, std::vector<Demo>>() : LoadDemos(demosPath);
	PairArena diff, same;
	diff.arena = Arena::Create(GameMode::SOCCAR);
	diff.a = diff.arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	diff.b = diff.arena->AddCar(Team::ORANGE, CAR_CONFIG_OCTANE);
	same.arena = Arena::Create(GameMode::SOCCAR);
	same.a = same.arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	same.b = same.arena->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	for (PairArena* P : { &diff, &same }) {
		P->arena->SetCarBumpCallback(OnBump);
		P->clean = Snapshot(P->arena);
	}

	std::vector<CarCarCase> cases;
	std::map<std::string, int> skipped;
	for (const Replay& r : replays) {
		std::map<int, std::pair<CarRow, double>> lastCar;
		const Body* ball = nullptr;
		double ballTime = 0;
		const std::vector<Demo>& rd = demos[r.name];
		std::map<int, bool> repeated; // actor -> its row in this frame repeats its previous one (a stale state)
		for (size_t i = 0; i + 1 < r.frames.size() && cases.size() < limit; i++) {
			const Frame& f0 = r.frames[i];
			for (const CarRow& c : f0.cars) {
				auto it = lastCar.find(c.actor);
				repeated[c.actor] = it != lastCar.end() && c.b.vel.LengthSq() > 1 &&
				                    memcmp(&it->second.first.b.pos, &c.b.pos, sizeof(Vec)) == 0 &&
				                    memcmp(&it->second.first.b.vel, &c.b.vel, sizeof(Vec)) == 0;
				lastCar[c.actor] = { c, f0.time };
			}
			if (f0.hasBall) {
				ball = &f0.ball;
				ballTime = f0.time;
			}
			if (!ball || f0.time - ballTime > 0.1) continue;
			Vec ballPos = ball->pos + ball->vel * (float)(f0.time - ballTime);
			for (size_t ia = 0; ia < f0.cars.size(); ia++)
			for (size_t ib = ia + 1; ib < f0.cars.size(); ib++) {
				const CarRow* a0 = &f0.cars[ia];
				const CarRow* b0 = &f0.cars[ib];
				Vec p = b0->b.pos - a0->b.pos, v = b0->b.vel - a0->b.vel;
				float dist0 = p.Length();
				if (dist0 > 600) continue;
				float t = v.LengthSq() > 0 ? std::clamp(-p.Dot(v) / v.LengthSq(), 0.f, 0.15f) : 0.f;
				float distMin = (p + v * t).Length();
				if (distMin > 250) continue;
				// A demolition between these two in the next few frames: the attacker becomes car a
				const Demo* demo = nullptr;
				for (const Demo& d : rd)
					if (d.frame > f0.index && d.frame <= f0.index + 4 &&
					    ((d.attacker == a0->actor && d.victim == b0->actor) || (d.attacker == b0->actor && d.victim == a0->actor)))
						demo = &d;
				if (demo && demo->attacker == b0->actor) std::swap(a0, b0);
				auto skip = [&](const char* why) { skipped[std::string(demo ? "demo: " : "") + why]++; };
				if (!OctaneHitbox(a0->body) || !OctaneHitbox(b0->body)) {
					skip("car body not Octane/Fennec");
					continue;
				}
				if (repeated[a0->actor] || repeated[b0->actor]) {
					skip("a car state repeats its previous one (stale)");
					continue;
				}
				if (a0->b.sleeping || b0->b.sleeping || PreJump(*a0) || PreJump(*b0)) {
					skip("car asleep or jump starting");
					continue;
				}
				bool ballNear = false;
				for (const CarRow* c : { a0, b0 })
					if ((ballPos - c->b.pos).Length() - 0.15f * (ball->vel - c->b.vel).Length() < 300) ballNear = true;
				if (ballNear && !f0.hasBall) { // (near: simulated, from this frame's state)
					skip("ball near, no state in this frame");
					continue;
				}
				bool crowded = false;
				for (auto& [actor, entry] : lastCar) {
					double age = f0.time - entry.second;
					if (actor == a0->actor || actor == b0->actor || age > 2) continue;
					Vec q = entry.first.b.pos + entry.first.b.vel * (float)age;
					for (const CarRow* c : { a0, b0 })
						if ((q - c->b.pos).Length() < 500 + (float)age * 2300) crowded = true;
				}
				if (crowded) {
					skip("a third car near");
					continue;
				}
				// The next frame with both cars (demo: the attacker, at or after the demo frame)
				const CarRow *a1 = nullptr, *b1 = nullptr;
				const Frame* fNext = nullptr;
				for (size_t j = i + 1; j < r.frames.size() && j <= i + 3 && !fNext; j++) {
					const Frame& fj = r.frames[j];
					if (fj.time - f0.time > 0.15) break;
					const CarRow *x = nullptr, *y = nullptr;
					for (const CarRow& c : fj.cars) {
						if (c.actor == a0->actor) x = &c;
						if (c.actor == b0->actor) y = &c;
					}
					if (demo ? (x && fj.index >= demo->frame) : (x && y)) {
						a1 = x;
						b1 = demo ? nullptr : y;
						fNext = &fj;
					}
				}
				if (!fNext) {
					skip("car states missing in the next frames");
					continue;
				}
				auto changed = [](const CarRow& c0, const CarRow& c1) {
					return c0.jump != c1.jump || c0.doubleJump != c1.doubleJump || c0.dodge != c1.dodge ||
					       c0.throttle != c1.throttle || c0.steer != c1.steer || c0.handbrake != c1.handbrake ||
					       c0.boosting != c1.boosting;
				};
				bool inputsChanged = changed(*a0, *a1) || (b1 && changed(*b0, *b1));
				if (inputsChanged && !demo) { // (demos: kept and flagged, the frames' first inputs used)
					skip("inputs or jump/dodge changed between frames");
					continue;
				}

				CarCarCase cs;
				cs.replay = r.name;
				cs.frame = f0.index;
				cs.dt = fNext->time - f0.time;
				cs.demo = demo != nullptr;
				cs.sameTeam = a0->team == b0->team;
				cs.a0 = a0;
				cs.b0 = b0;
				cs.a1 = a1;
				cs.b1 = b1;
				cs.dist0 = dist0;
				cs.distMin = distMin;
				cs.closing = -(b0->b.vel - a0->b.vel).Dot((b0->b.pos - a0->b.pos).Normalized());
				cs.ballNear = ballNear;
				cs.inputsChanged = inputsChanged;

				// The ball out of the way: the ceiling corner farthest from both cars
				Body parked = *ball;
				parked.vel = parked.angVel = Vec();
				float bestGap = -1;
				for (float sx : { -3000.f, 3000.f })
					for (float sy : { -4000.f, 4000.f }) {
						Vec c(sx, sy, 1900);
						float gap = std::min((c - a0->b.pos).Length(), (c - b0->b.pos).Length());
						if (gap > bestGap) {
							bestGap = gap;
							parked.pos = c;
						}
					}
				if (ballNear) parked = f0.ball;

				// Each car alone
				CarControls ca = ReplayControls(*a0), cb = ReplayControls(*b0);
				SetupCar(A, *a0, ca, useSensitivity, warmup, parked);
				cs.aAlone = Run(A.withCar, A.car, *fNext, a1, parked).carPosAlone;
				if (b1) {
					SetupCar(A, *b0, cb, useSensitivity, warmup, parked);
					cs.bAlone = Run(A.withCar, A.car, *fNext, b1, parked).carPosAlone;
				}

				// Together, the older car's state advanced alone first (offset d > 0: b's state is newer)
				auto prepared = [&](const CarRow& c, const CarControls& controls, int ticks) {
					SetupCar(A, c, controls, useSensitivity, warmup, parked);
					if (ticks > 0) A.withCar->Step(ticks);
					return A.car->GetState();
				};
				PairArena& P = cs.sameTeam ? same : diff;
				for (int variant = 0; variant < (cs.demo ? 2 : 1); variant++) {
					g_demoSkipsContact = variant == 1;
					PairErrors& best = variant ? cs.skip : cs.pair;
					int& bestOffset = variant ? cs.skipOffset : cs.offset;
					float bestScore = 1e30f;
					for (int d = -6; d <= 6; d++) {
						CarState sa = prepared(*a0, ca, std::max(d, 0));
						CarState sb = prepared(*b0, cb, std::max(-d, 0));
						PairErrors e = RunPair(P, sa, sb, ca, cb, a1, b1, parked);
						float score = e.a + e.b;
						if (score < bestScore) {
							bestScore = score;
							best = e;
							bestOffset = d;
						}
					}
				}
				g_demoSkipsContact = false;
				cases.push_back(cs);
			}
		}
	}

	// Summary: by what happened (replay demo; the engine bumped; the replay shows an interaction the engine lacks)
	auto kind = [](const CarCarCase& c) -> std::string {
		if (c.demo) return std::string("demo") + (c.ballNear ? " (ball near)" : "");
		if (c.ballNear) return "ball near";
		bool replayContact = std::max(c.aAlone, c.bAlone) > 5;
		bool engineContact = c.pair.bumps > 0;
		if (engineContact) return replayContact ? "bump (engine and game)" : "bump (engine only)";
		return replayContact ? "contact (game only)" : "no contact";
	};
	std::map<std::string, std::vector<const CarCarCase*>> byKind;
	for (const CarCarCase& c : cases) byKind[kind(c)].push_back(&c);
	printf("\ncar-car: %zu cases\n%-24s %6s  %-26s %-26s %-26s\n", cases.size(), "kind", "n", "pair err a/b p50 (uu)",
	       "pair err a/b p90", "alone err a/b p50");
	for (auto& [k, list] : byKind) {
		std::vector<float> pa, pb, aa, ab;
		for (const CarCarCase* c : list) {
			pa.push_back(c->pair.a);
			aa.push_back(c->aAlone);
			if (c->b1) {
				pb.push_back(c->pair.b);
				ab.push_back(c->bAlone);
			}
		}
		auto pct = [](std::vector<float> v, float q) { return v.empty() ? 0.f : Percentile(v, q); };
		printf("%-24s %6zu  %8.3f / %-15.3f %8.3f / %-15.3f %8.3f / %-15.3f\n", k.c_str(), list.size(), pct(pa, .5f),
		       pct(pb, .5f), pct(pa, .9f), pct(pb, .9f), pct(aa, .5f), pct(ab, .5f));
	}
	if (byKind.count("demo") || byKind.count("demo (ball near)")) {
		std::vector<float> solved, skip;
		int skipBetter = 0, solvedBetter = 0, engineDemo = 0;
		for (const CarCarCase& cc : cases) {
			const CarCarCase* c = &cc;
			if (!c->demo) continue;
			solved.push_back(c->pair.a);
			skip.push_back(c->skip.a);
			if (c->skip.a < c->pair.a - 0.5f) skipBetter++;
			if (c->pair.a < c->skip.a - 0.5f) solvedBetter++;
			if (c->pair.demos > 0) engineDemo++;
		}
		printf("demos: attacker error p50 contact solved %.2f, victim leaves first %.2f (p90 %.2f / %.2f); better: "
		       "solved %d, leaves first %d; the engine demolished in %d of %zu\n",
		       Percentile(solved, .5f), Percentile(skip, .5f), Percentile(solved, .9f), Percentile(skip, .9f),
		       solvedBetter, skipBetter, engineDemo, solved.size());
	}
	printf("car-car skipped:\n");
	for (auto& [why, n] : skipped) printf("  %-44s %d\n", why.c_str(), n);

	FILE* out = fopen(outPath.c_str(), "w");
	fprintf(out, "replay,frame,dt,kind,same_team,demo,a_speed,b_speed,a_ground,b_ground,dist0,dist_min,closing,"
	             "a_err,b_err,a_vel_err,b_vel_err,a_alone,b_alone,k_a,k_b,offset,bumps,demos,"
	             "skip_a_err,skip_offset,skip_demos,a_speed_next,a_speed_engine,a_speed_skip,a_z,b_z,ball_near,inputs_changed,"
	             "a_boost,a_fwd_speed,b_fwd_speed,ev,ev_super,ev_fwd,ev_yaw,ev_pitch\n");
	for (const CarCarCase& c : cases) {
		bool ga = c.a0->b.pos.z < 60 && c.a0->b.rot.up.z > 0.95f, gb = c.b0->b.pos.z < 60 && c.b0->b.rot.up.z > 0.95f;
		fprintf(out, "%s,%d,%.4f,%s,%d,%d,%.1f,%.1f,%d,%d,%.1f,%.1f,%.1f,%.3f,%.3f,%.2f,%.2f,%.3f,%.3f,%d,%d,%d,%d,%d,"
		             "%.3f,%d,%d,%.1f,%.1f,%.1f,%.1f,%.1f,%d,%d,%d,%.1f,%.1f,%d,%d,%.1f,%.2f,%.2f\n",
		        c.replay.c_str(), c.frame, c.dt, kind(c).c_str(), c.sameTeam, c.demo, c.a0->b.vel.Length(),
		        c.b0->b.vel.Length(), ga, gb, c.dist0, c.distMin, c.closing, c.pair.a, c.pair.b, c.pair.aVel,
		        c.pair.bVel, c.aAlone, c.bAlone, c.pair.kA, c.pair.kB, c.offset, c.pair.bumps, c.pair.demos, c.skip.a,
		        c.skipOffset, c.skip.demos, c.a1->b.vel.Length(), c.pair.aSpeed, c.skip.aSpeed, c.a0->b.pos.z,
		        c.b0->b.pos.z, c.ballNear, c.inputsChanged, c.a0->boosting, c.a0->b.vel.Dot(c.a0->b.rot.forward),
		        c.b0->b.vel.Dot(c.b0->b.rot.forward), c.pair.event.valid, c.pair.event.supersonic, c.pair.event.fwdSpeed,
		        c.pair.event.yaw, c.pair.event.pitch);
	}
	fclose(out);
}

static float Percentile(std::vector<float> v, float p) {
	if (v.empty()) return NAN;
	std::sort(v.begin(), v.end());
	return v[std::min(v.size() - 1, (size_t)(p * (v.size() - 1) + 0.5f))];
}

int main(int argc, char** argv) {
	if (argc < 2) {
		fprintf(stderr, "usage: replay_validate STATES.csv [--meshes DIR] [--cases OUT.csv] [--no-sensitivity] [--limit N]\n");
		return 1;
	}
	std::string meshes = ARENA_MESH_DIR, casesPath, carcarPath, demosPath, bodiesPath;
	bool useSensitivity = true, warmup = true, zeroBallSpin = false, fitHandbrake = false;
	bool fitFlipTime = false, warmupPrevious = false;
	float minReplayKick = 0; // only car-ball cases where the game's ball changed velocity by more than this
	size_t limit = SIZE_MAX;
	for (int i = 2; i < argc; i++) {
		std::string a = argv[i];
		if (a == "--meshes" && i + 1 < argc) meshes = argv[++i];
		else if (a == "--cases" && i + 1 < argc) casesPath = argv[++i];
		else if (a == "--no-sensitivity") useSensitivity = false;
		else if (a == "--no-warmup") warmup = false;
		else if (a == "--no-handbrake-history") g_handbrakeHistory = false;
		else if (a == "--min-replay-kick" && i + 1 < argc) minReplayKick = std::stof(argv[++i]); // e.g. pinch mining
		else if (a == "--fit-handbrake") fitHandbrake = true; // diagnostic: car-alone cases also try every ramp value
		else if (a == "--fit-flip-time") fitFlipTime = true; // diagnostic: car-alone flips also try start times ±8 ticks
		else if (a == "--zero-ball-spin") zeroBallSpin = true; // experiment: ball cases start without spin
		else if (a == "--limit" && i + 1 < argc) limit = std::stoul(argv[++i]);
		else if (a == "--carcar" && i + 1 < argc) carcarPath = argv[++i];
		else if (a == "--warmup-previous") warmupPrevious = true; // experiment: wheel carry from the previous row
		else if (a == "--demos" && i + 1 < argc) demosPath = argv[++i];
		else if (a == "--bodies" && i + 1 < argc) bodiesPath = argv[++i]; // (only the other-bodies pass)
	}

	RocketSim::Init(meshes, true);
	std::vector<Replay> replays = Load(argv[1]);
	if (!g_haveRampColumn) ReconstructHandbrake(replays); // (older extracts: from the rows' handbrake flags)
	ReconstructSupersonic(replays);

	Arenas A;
	A.ballOnly = Arena::Create(GameMode::SOCCAR);
	A.ballClean = Snapshot(A.ballOnly);
	A.withCar = Arena::Create(GameMode::SOCCAR);
	A.car = A.withCar->AddCar(Team::BLUE, CAR_CONFIG_OCTANE);
	A.carClean = Snapshot(A.withCar);

	if (!bodiesPath.empty()) {
		std::vector<Arenas> presets;
		for (const CarConfig* config : { &CAR_CONFIG_OCTANE, &CAR_CONFIG_DOMINUS, &CAR_CONFIG_PLANK, &CAR_CONFIG_BREAKOUT,
		                                 &CAR_CONFIG_HYBRID, &CAR_CONFIG_MERC }) {
			Arenas P;
			P.ballOnly = A.ballOnly;
			P.ballClean = A.ballClean;
			P.withCar = Arena::Create(GameMode::SOCCAR);
			P.car = P.withCar->AddCar(Team::BLUE, *config);
			P.carClean = Snapshot(P.withCar);
			presets.push_back(P);
		}
		BodiesPass(replays, presets, bodiesPath, useSensitivity, warmup);
		return 0;
	}
	if (!carcarPath.empty()) { // (only the car-car pass)
		CarCarPass(replays, A, carcarPath, demosPath, useSensitivity, warmup, limit);
		return 0;
	}

	std::vector<Case> cases;
	std::map<std::string, int> skipped;
	for (const Replay& r : replays) {
		std::map<int, std::pair<CarRow, double>> lastCar; // actor -> latest state and its time
		for (size_t i = 0; i + 1 < r.frames.size() && cases.size() < limit; i++) {
			const Frame& f0 = r.frames[i];
			const Frame& f1 = r.frames[i + 1];
			for (const CarRow& c : f0.cars) lastCar[c.actor] = { c, f0.time };
			double dt = f1.time - f0.time;
			if (!f0.hasBall || !f1.hasBall || f1.index != f0.index + 1) {
				skipped["no ball state in both frames"]++;
				continue;
			}
			if (dt <= 0 || dt > 0.1) {
				skipped["frame gap"]++;
				continue;
			}
			if (f0.ball.sleeping || f1.ball.sleeping) {
				skipped["ball asleep"]++;
				continue;
			}

			// Which cars are near the ball (stale states extrapolated, with a margin for their age)
			const CarRow* nearCar = nullptr;
			int nearCount = 0, unclearCount = 0;
			for (auto& [actor, entry] : lastCar) {
				const CarRow& c = entry.first;
				double age = f0.time - entry.second;
				if (age > 2) continue; // gone (demolished, left)
				Vec pos = c.b.pos + c.b.vel * (float)age;
				float d = (pos - f0.ball.pos).Length();
				float margin = (float)age * 2300;
				if (age > MAX_CAR_AGE && d < FAR_BALL + margin) unclearCount++;
				else if (d < NEAR_BALL) {
					nearCount++;
					nearCar = &c;
				} else if (d < FAR_BALL + margin) unclearCount++;
			}
			if (unclearCount > 0) {
				skipped["a car neither near nor far"]++;
				continue;
			}

			Case cs;
			cs.replay = r.name;
			cs.frame = f0.index;
			cs.dt = dt;
			if (minReplayKick > 0 && (nearCount == 0 || (f1.ball.vel - f0.ball.vel).Length() < minReplayKick)) {
				skipped["below --min-replay-kick"]++;
				continue;
			}
			if (nearCount == 0) {
				Restore(A.ballOnly, A.ballClean);
				Body start = f0.ball;
				if (zeroBallSpin) start.angVel = Vec();
				SetBall(A.ballOnly, start);
				cs.e = Run(A.ballOnly, nullptr, f1, nullptr, f0.ball);
				cs.category = cs.e.worldContact ? "ball/arena contact" : "ball/free flight";
				cases.push_back(cs);
				continue;
			}
			if (nearCount > 1) {
				skipped["two or more cars near the ball"]++;
				continue;
			}

			// One car: its state in this frame and the next frame (within 3) holding both its state and the ball's
			const CarRow* c0 = nullptr;
			const CarRow* c1 = nullptr;
			const Frame* fNext = nullptr;
			for (const CarRow& c : f0.cars) if (c.actor == nearCar->actor) c0 = &c;
			for (size_t j = i + 1; c0 && j < r.frames.size() && j <= i + 3 && !c1; j++) {
				const Frame& fj = r.frames[j];
				if (fj.time - f0.time > 0.15 || !fj.hasBall) continue;
				for (const CarRow& c : fj.cars) if (c.actor == nearCar->actor) c1 = &c;
				if (c1) fNext = &fj;
			}
			if (!c0 || !c1) {
				skipped["car state missing in a frame"]++;
				continue;
			}
			cs.dt = fNext->time - f0.time;
			if (!OctaneHitbox(c0->body)) {
				skipped["car body not Octane/Fennec"]++;
				continue;
			}
			if (c0->jump != c1->jump || c0->doubleJump != c1->doubleJump || c0->dodge != c1->dodge) {
				skipped["car jump/dodge starts or ends between the frames"]++;
				continue;
			}
			if (c0->throttle != c1->throttle || c0->steer != c1->steer || c0->handbrake != c1->handbrake ||
			    c0->boosting != c1->boosting) {
				skipped["car inputs changed between frames"]++;
				continue;
			}
			if (c0->b.sleeping) {
				skipped["car asleep"]++;
				continue;
			}

			CarControls controls = ReplayControls(*c0);

			// A double jump flagged just now may not be in the state yet: also try it starting during the run
			bool preDoubleJump = c0->doubleJump && c0->doubleJumpSince >= 0 && c0->doubleJumpSince < 0.1f && !c0->dodge;
			CarRow beforeDoubleJump = *c0;
			beforeDoubleJump.doubleJump = false;
			beforeDoubleJump.doubleJumpSince = -1;
			auto setup = [&](bool doubleJumpDuringRun) {
				SetupCar(A, doubleJumpDuringRun ? beforeDoubleJump : *c0, controls, useSensitivity, warmup, f0.ball);
				if (doubleJumpDuringRun) {
					A.car->_internalState.hasJumped = true;
					A.car->_internalState.isJumping = false;
					A.car->_internalState.airTimeSinceJump = 0.3f;
					A.car->_internalState.lastControls.jump = false;
				}
			};
			// The car's and the ball's states can be from different server ticks: try offsets (the earlier body
			// advanced alone first) and keep the one that fits both bodies best
			auto runAligned = [&](bool blockImpulse, int& bestOffset) {
				Errors best;
				float bestScore = 1e30f;
				for (int press = PreJump(*c0) ? 0 : -1; press <= (PreJump(*c0) ? 8 : -1); press++)
				for (int djPress = -1; djPress <= (preDoubleJump ? 8 : -1); djPress++)
				for (int d = -6; d <= 6; d++) {
					g_jumpPressAt = press;
					setup(djPress >= 0);
					g_dodgePressAt = djPress;
					g_dodgeStick = Vec();
					int ballTicksBefore = 0;
					if (d > 0) { // the car's state is newer: the ball catches up alone
						Restore(A.ballOnly, A.ballClean);
						SetBall(A.ballOnly, f0.ball);
						A.ballOnly->Step(d);
						A.withCar->ball->SetState(A.ballOnly->ball->GetState());
						ballTicksBefore = d;
					} else if (d < 0) { // the ball's state is newer: the car catches up alone, the ball parked away
						SetBall(A.withCar, Parked(f0.ball, *c0));
						A.withCar->Step(-d);
						SetBall(A.withCar, f0.ball);
					}
					if (blockImpulse) { // contact going on: the extra impulse was applied last tick
						auto& hit = A.car->_internalState.ballHitInfo;
						hit.isValid = true;
						hit.tickCountWhenHit = hit.tickCountWhenExtraImpulseApplied = A.withCar->tickCount - 1;
					}
					Errors e = Run(A.withCar, A.car, *fNext, c1, f0.ball, ballTicksBefore, std::max(0, -d));
					g_jumpPressAt = -1;
					g_dodgePressAt = -1;
					float score = e.ballPos + e.carPos;
					if (score < bestScore) {
						bestScore = score;
						best = e;
						bestOffset = d;
					}
				}
				return best;
			};
			cs.e = runAligned(false, cs.offset);
			cs.blocked = runAligned(true, cs.blockedOffset);

			Vec rel = f0.ball.pos - c0->b.pos;
			Vec relLocal(rel.Dot(c0->b.rot.forward), rel.Dot(c0->b.rot.right), rel.Dot(c0->b.rot.up));
			cs.relSpeed = (f0.ball.vel - c0->b.vel).Length();
			cs.car = c0;
			cs.rel = rel;
			cs.relLocal = relLocal;
			cs.relVelN = (f0.ball.vel - c0->b.vel).Dot(rel.Normalized());
			cs.carNext = c1;
			cs.dribble = cs.e.carOnGround && relLocal.z > 90 && relLocal.z < 200 && fabsf(relLocal.x) < 110 &&
			             fabsf(relLocal.y) < 70 && cs.relSpeed < 600;
			std::string where = cs.e.carOnGround ? "ground" : "air (no air control)";
			std::string what = cs.dribble ? "dribble" : (cs.e.ballTouch ? "touch" : "no touch");
			std::string action = Action(*c0);
			if (!action.empty()) where = action;
			cs.category = "car " + where + "/" + what;
			// Pinch: the ball against an arena surface and kicked hard (game or engine)
			if (cs.e.ballTouch && ArenaGap(f0.ball.pos) < 40 &&
			    (cs.e.replayKick.Length() > 1500 || cs.e.engineKick.Length() > 1500))
				cs.category = "pinch/" + action + (action.empty() ? "no jump/flip" : "");
			cases.push_back(cs);
		}
	}

	// Cars alone: far from the ball and from the other cars (driving physics anywhere in the arena)
	const std::vector<Replay> noReplays;
	// (both lvalues: a conditional with a temporary would copy the replays, and the cases point into them)
	for (const Replay& r : minReplayKick > 0 ? noReplays : replays) {
		std::map<int, std::pair<CarRow, double>> lastCar;
		const Body* ball = nullptr;
		double ballTime = 0;
		for (size_t i = 0; i + 1 < r.frames.size() && cases.size() < limit; i++) {
			const Frame& f0 = r.frames[i];
			for (const CarRow& c : f0.cars) lastCar[c.actor] = { c, f0.time };
			if (f0.hasBall) {
				ball = &f0.ball;
				ballTime = f0.time;
			}
			if (!ball || f0.time - ballTime > 0.1) continue;
			for (const CarRow& c0 : f0.cars) {
				if (!OctaneHitbox(c0.body) || c0.b.sleeping) continue;
				Vec ballPos = ball->pos + ball->vel * (float)(f0.time - ballTime);
				if ((ballPos - c0.b.pos).Length() < 900) continue;
				bool crowded = false;
				for (auto& [actor, entry] : lastCar) {
					double age = f0.time - entry.second;
					if (actor == c0.actor || age > 2) continue;
					Vec p = entry.first.b.pos + entry.first.b.vel * (float)age;
					if ((p - c0.b.pos).Length() < 600 + (float)age * 2300) crowded = true;
				}
				if (crowded) continue;
				const CarRow* c1 = nullptr;
				const Frame* fNext = nullptr;
				for (size_t j = i + 1; j < r.frames.size() && j <= i + 3 && !c1; j++) {
					if (r.frames[j].time - f0.time > 0.15) break;
					for (const CarRow& c : r.frames[j].cars) if (c.actor == c0.actor) c1 = &c;
					if (c1) fNext = &r.frames[j];
				}
				if (!c1 || c0.jump != c1->jump || c0.doubleJump != c1->doubleJump || c0.dodge != c1->dodge)
					continue;
				// Inputs that change between the frames: switch at the fitted tick (0..8), no jump or dodge going on
				bool inputChange = c0.throttle != c1->throttle || c0.steer != c1->steer || c0.handbrake != c1->handbrake ||
				                   c0.boosting != c1->boosting;
				if (inputChange && (c0.jump || c0.doubleJump || c0.dodge || PreJump(c0)))
					continue;
				CarControls controls = ReplayControls(c0);
				Body parked = Parked(*ball, c0);
				g_warmupFrom = nullptr;
				if (warmupPrevious && i > 0) { // the previous frame's row, same inputs, ~4 ticks back
					const Frame& fp = r.frames[i - 1];
					for (const CarRow& c : fp.cars)
						if (c.actor == c0.actor && c.throttle == c0.throttle && c.steer == c0.steer &&
						    c.handbrake == c0.handbrake && c.boosting == c0.boosting && c.jump == c0.jump &&
						    c.dodge == c0.dodge && c.doubleJump == c0.doubleJump && f0.time - fp.time < 0.05) {
							g_warmupFrom = &c;
							g_warmupTicks = std::max(1, (int)lround((f0.time - fp.time) * 120));
						}
					if (!g_warmupFrom) continue;
				}
				SetupCar(A, c0, controls, useSensitivity, warmup, parked);
				Case cs;
				cs.replay = r.name;
				cs.frame = f0.index;
				cs.dt = fNext->time - f0.time;
				cs.e = Run(A.withCar, A.car, *fNext, c1, parked);
				if (inputChange) {
					g_switchControls = ReplayControls(*c1);
					for (int t = 0; t <= 8; t++) {
						SetupCar(A, c0, controls, useSensitivity, warmup, parked);
						g_switchAt = t;
						Errors e = Run(A.withCar, A.car, *fNext, c1, parked);
						g_switchAt = -1;
						if (t == 0 || e.carPos < cs.e.carPos) {
							cs.e = e;
							cs.switchTick = t;
						}
					}
				}
				if (PreJump(c0)) { // the jump starts during the interval: fit the tick
					for (int press = 0; press <= 8; press++) {
						SetupCar(A, c0, controls, useSensitivity, warmup, parked);
						g_jumpPressAt = press;
						Errors e = Run(A.withCar, A.car, *fNext, c1, parked);
						g_jumpPressAt = -1;
						if (press == 0 || e.carPos < cs.e.carPos) cs.e = e;
					}
				}
				cs.flipShift = 0;
				cs.flipBestErr = cs.e.carPos;
				// Like the jump flag, the double jump component's flag can arrive before the state shows the impulse:
				// also try the double jump (jump pressed, no stick) at each tick 0..8 of the run
				if (c0.doubleJump && c0.doubleJumpSince >= 0 && c0.doubleJumpSince < 0.1f && !c0.dodge) {
					CarRow pre = c0;
					pre.doubleJump = false;
					pre.doubleJumpSince = -1;
					g_dodgeStick = Vec();
					for (int d = 0; d <= 8; d++) {
						SetupCar(A, pre, controls, useSensitivity, warmup, parked);
						A.car->_internalState.hasJumped = true;
						A.car->_internalState.isJumping = false;
						A.car->_internalState.airTimeSinceJump = 0.3f;
						A.car->_internalState.lastControls.jump = false;
						g_dodgePressAt = d;
						Errors e = Run(A.withCar, A.car, *fNext, c1, parked);
						g_dodgePressAt = -1;
						if (e.carPos < cs.e.carPos) {
							cs.e = e;
							cs.flipShift = 200 + d; // 200 + tick: the double jump started during the run
							cs.flipBestErr = e.carPos;
						}
					}
				}
				if (fitFlipTime && c0.dodge && c0.dodgeSince >= 0) {
					for (int t = -8; t <= 8; t++) {
						g_flipTimeShift = t / 120.f;
						SetupCar(A, c0, controls, useSensitivity, warmup, parked);
						Errors e = Run(A.withCar, A.car, *fNext, c1, parked);
						if (e.carPos < cs.flipBestErr) {
							cs.flipBestErr = e.carPos;
							cs.flipShift = t;
						}
					}
					g_flipTimeShift = 0;
					if (c0.dodgeSince < 0.15f) { // or the dodge hasn't started in this state yet
						Vec dir(c0.dodgeTorque.y * 100 / RLConst::FLIP_TORQUE_Y, -c0.dodgeTorque.x * 100 / RLConst::FLIP_TORQUE_X, 0);
						g_dodgeStick = Vec(-dir.x, dir.y, 0);
						CarRow pre = c0;
						pre.dodge = false; // set up as before the dodge: jumped, not flipped
						pre.dodgeSince = -1;
						for (int d = 0; d <= 8; d++) {
							SetupCar(A, pre, controls, useSensitivity, warmup, parked);
							A.car->_internalState.hasJumped = true;
							A.car->_internalState.isJumping = false;
							A.car->_internalState.airTimeSinceJump = 0.3f;
							A.car->_internalState.lastControls.jump = false;
							g_dodgePressAt = d;
							Errors e = Run(A.withCar, A.car, *fNext, c1, parked);
							g_dodgePressAt = -1;
							if (e.carPos < cs.flipBestErr) {
								cs.flipBestErr = e.carPos;
								cs.flipShift = 100 + d; // 100 + tick: the dodge started during the run
							}
						}
					}
				}
				cs.hbBest = c0.handbrakeVal;
				cs.hbBestErr = cs.e.carPos;
				if (fitHandbrake && (c0.handbrake || c0.handbrakeVal > 0)) {
					for (int v = 0; v <= 20; v++) {
						g_handbrakeOverride = v / 20.f;
						SetupCar(A, c0, controls, useSensitivity, warmup, parked);
						Errors e = Run(A.withCar, A.car, *fNext, c1, parked);
						if (e.carPos < cs.hbBestErr) {
							cs.hbBestErr = e.carPos;
							cs.hbBest = g_handbrakeOverride;
						}
					}
					g_handbrakeOverride = -1;
				}
				g_warmupFrom = nullptr;
				cs.car = &c0;
				cs.carNext = c1;
				std::string action = Action(c0);
				cs.category = std::string("car alone/") +
				              (!action.empty() ? action + " " : (cs.e.carOnGround ? "" : "air (no air control) ")) + Place(c0);
				if (inputChange) {
					int changed = (c0.throttle != c1->throttle) + (c0.steer != c1->steer) + (c0.handbrake != c1->handbrake) +
					              (c0.boosting != c1->boosting);
					std::string what = changed > 1                    ? "several"
					                   : c0.throttle != c1->throttle ? "throttle"
					                   : c0.steer != c1->steer       ? "steer"
					                   : c0.handbrake != c1->handbrake ? "handbrake"
					                                                   : "boost";
					cs.category = "car alone input change/" + what + (cs.e.carOnGround ? " " : " air ") + Place(c0);
				}
				cases.push_back(cs);
			}
		}
	}

	// Summary
	std::map<std::string, std::vector<const Case*>> byCategory;
	for (const Case& c : cases) byCategory[c.category].push_back(&c);
	printf("%zu cases from %zu replays\n\n", cases.size(), replays.size());
	printf("%-34s %7s  %-24s %-24s %-24s %-22s %-18s\n", "category", "n", "ball pos p50/p90 (uu)",
	       "ball vel p50/p90 (uu/s)", "ball angvel p50/p90", "car pos p50/p90", "ballistic pos p50");
	for (auto& [cat, list] : byCategory) {
		std::vector<float> bp, bv, ba, cp, bl;
		for (const Case* c : list) {
			bp.push_back(c->e.ballPos);
			bv.push_back(c->e.ballVel);
			ba.push_back(c->e.ballAng);
			cp.push_back(c->e.carPos);
			bl.push_back(c->e.ballisticPos);
		}
		printf("%-34s %7zu  %8.3f / %-13.3f %8.2f / %-13.2f %8.4f / %-13.4f %7.3f / %-12.3f %8.2f\n", cat.c_str(),
		       list.size(), Percentile(bp, .5f), Percentile(bp, .9f), Percentile(bv, .5f), Percentile(bv, .9f),
		       Percentile(ba, .5f), Percentile(ba, .9f), Percentile(cp, .5f), Percentile(cp, .9f), Percentile(bl, .5f));
	}
	printf("\nskipped:\n");
	for (auto& [why, n] : skipped) printf("  %-40s %d\n", why.c_str(), n);

	if (!casesPath.empty()) {
		FILE* out = fopen(casesPath.c_str(), "w");
		fprintf(out, "replay,frame,dt,category,k,ball_pos,ball_vel,ball_ang,car_pos,car_vel,car_ang,car_rot,ballistic,"
		             "dvx,dvy,dvz,touch,dribble,rel_speed,blocked_k,blocked_ball_pos,blocked_ball_vel,blocked_car_pos,"
		             "blocked_dvx,blocked_dvy,blocked_dvz,k_ball,k_car,ball_pos_alone,car_pos_alone,offset,blocked_offset,throttle,steer,boost,handbrake,sensitivity,car_speed,car_z,car_up_z,car_kick_vz,dp_fwd,dp_right,dp_up,dv_fwd,dv_right,dv_up,replay_acc_fwd,replay_acc_right,yaw_rate,yaw_rate_err,car_ticks,v_fwd,rel_x,rel_y,rel_z,rel_fwd,rel_right,rel_up,first_touch,relvel_n,hb_recon,hb_best,hb_best_err,replay_kick,engine_kick,kick_angle,jump_since,dodge_since,wheels_start,flip_shift,flip_best_err,double_jump_since,switch_tick\n");
		for (const Case& c : cases) {
			fprintf(out, "%s,%d,%.5f,%s,%d,%.4f,%.3f,%.5f,%.4f,%.3f,%.5f,%.6f,%.3f,%.3f,%.3f,%.3f,%d,%d,%.2f,%d,%.4f,%.3f,%.4f,"
			             "%.3f,%.3f,%.3f,%d,%d,%.4f,%.4f,%d,%d,%d,%d,%d,%d,%.3f,%.2f,%.2f,%.4f,%.2f,%.3f,%.3f,%.3f,%.2f,%.2f,%.2f,%.2f,%.2f,%.4f,%.4f,%d,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%d,%.2f,%.3f,%.3f,%.4f,%.2f,%.2f,%.3f,%.4f,%.4f,%d,%d,%.4f,%.4f,%d\n",
			        c.replay.c_str(), c.frame, c.dt, c.category.c_str(), c.e.k, c.e.ballPos, c.e.ballVel, c.e.ballAng,
			        c.e.carPos, c.e.carVel, c.e.carAng, c.e.carRot, c.e.ballisticPos, c.e.ballVelDiff.x,
			        c.e.ballVelDiff.y, c.e.ballVelDiff.z, c.e.ballTouch, c.dribble, c.relSpeed, c.blocked.k,
			        c.blocked.ballPos, c.blocked.ballVel, c.blocked.carPos, c.blocked.ballVelDiff.x,
			        c.blocked.ballVelDiff.y, c.blocked.ballVelDiff.z, c.e.kBall, c.e.kCar, c.e.ballPosAlone,
			        c.e.carPosAlone, c.offset, c.blockedOffset, c.car ? c.car->throttle : 0, c.car ? c.car->steer : 0,
			        c.car ? (int)c.car->boosting : 0, c.car ? (int)c.car->handbrake : 0, c.car ? c.car->sensitivity : 0,
			        c.car ? c.car->b.vel.Length() : 0, c.car ? c.car->b.pos.z : 0, c.car ? c.car->b.rot.up.z : 0,
			        c.car ? c.car->b.vel.z : 0, c.e.carPosLocal.x, c.e.carPosLocal.y, c.e.carPosLocal.z,
			        c.e.carVelLocal.x, c.e.carVelLocal.y, c.e.carVelLocal.z,
			        c.car && c.e.carTicks ? (c.carNext->b.vel - c.car->b.vel).Dot(c.car->b.rot.forward) / (c.e.carTicks / 120.f) : 0,
			        c.car && c.e.carTicks ? (c.carNext->b.vel - c.car->b.vel).Dot(c.car->b.rot.right) / (c.e.carTicks / 120.f) : 0,
			        c.car ? c.car->b.angVel.Dot(c.car->b.rot.up) : 0, c.e.carYawRateErr, c.e.carTicks,
			        c.car ? c.car->b.vel.Dot(c.car->b.rot.forward) : 0, c.rel.x, c.rel.y, c.rel.z, c.relLocal.x,
			        c.relLocal.y, c.relLocal.z, c.e.firstTouch, c.relVelN, c.car ? c.car->handbrakeVal : 0, c.hbBest,
			        c.hbBestErr, c.e.replayKick.Length(), c.e.engineKick.Length(),
			        (c.e.replayKick.Length() > 1 && c.e.engineKick.Length() > 1)
			            ? acosf(std::clamp(c.e.replayKick.Normalized().Dot(c.e.engineKick.Normalized()), -1.f, 1.f)) * 57.2958f
			            : -1.f,
			        c.car && c.car->jump ? c.car->jumpSince : -1.f, c.car && c.car->dodge ? c.car->dodgeSince : -1.f,
			        c.e.wheelsStart, c.flipShift, c.flipBestErr,
			        c.car && c.car->doubleJump ? c.car->doubleJumpSince : -1.f, c.switchTick);
		}
		fclose(out);
	}
	return 0;
}
