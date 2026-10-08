// PhysLog: records Rocket League's physics tick by tick in offline modes (freeplay, custom training), for checking
// our engine against the real game (notes/validation.md). A BakkesMod plugin; see README.md.
//
// Every physics tick, when the game sets the local car's input (Car_TA.SetVehicleInput, before the tick's physics),
// it writes one CSV row: the car's and the ball's rigid-body state at that moment, the input for the tick, and the
// car's jump/flip/boost state. The next row's state is the result of the tick.
//
// Console commands:
//   physlog_start [name]     record your own driving until physlog_stop
//   physlog_stop
//   physlog_run <scenario>   play a scripted scenario (data/physlog/scenarios/<scenario>.txt) and record it
//
// Scenario files, one command per line (# comments):
//   car x y z  pitch yaw roll  vx vy vz  wx wy wz  boost   place the car (degrees; rad/s; boost 0-100)
//   ball x y z  vx vy vz  wx wy wz                         place the ball
//   wait N                                                 N ticks with no input
//   input N throttle steer pitch yaw roll jump boost handbrake   hold these inputs for N ticks (jump/boost/handbrake 0/1)
//   repeat K ... end                                       (not nested) run the lines in between K times
//
// Next to each recording it writes <name>_bullet.csv: the game's own Bullet objects, read (never written) through the
// pointer chain from the static analysis (notes/bullet-diff.md): a header with the car's and the ball's collision shapes
// and rigid-body fields, then every tick the contact manifolds that touch the car or the ball.
//
// It never runs in online games, and it never touches EAC: load it in a game started without EAC (offline only).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include "bakkesmod/plugin/bakkesmodplugin.h"
#include "bakkesmod/wrappers/GameEvent/ServerWrapper.h"
#include "bakkesmod/wrappers/GameObject/BallWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/AirControlComponentWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/BoostWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/DodgeComponentWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/DoubleJumpComponentWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/JumpComponentWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/VehicleSimWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarComponent/WheelWrapper.h"
#include "bakkesmod/wrappers/GameObject/CarWrapper.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct ScriptLine {
	enum Kind { Car, Ball, Wait, Input } kind;
	float v[13] = {};
	int ticks = 0;
};

// Rotator units: 65536 per turn
int ToRotatorUnits(float degrees) { return (int)(degrees * 65536.f / 360.f); }

// --- The game's Bullet objects, read only. Offsets for the 2026-10-06 build (notes/bullet-diff.md); 1 BU = 50 uu
constexpr uintptr_t GWORLD_RVA = 0x24ae6d0;  // UWorld* GWorld
constexpr uintptr_t ACTOR_BODY = 0x780;      // RBActor_TA -> btRigidBody*
constexpr uintptr_t BODY_SHAPE = 0xd0;       // btCollisionObject -> btCollisionShape*
constexpr uintptr_t BODY_SIZE = 0x3e0;       // the game's btRigidBody (stock 2.82: 0x2c0)
constexpr int POINT_SIZE = 0x110;            // the game's btManifoldPoint (stock: 0xc0)
constexpr float BU = 50.f;
// Car_TA.WorldContact (rebuilt after each tick from the rigid-body collision notifications with world geometry, read by
// the next tick's auto-roll): flags (bit 0 bHasContact), location +0x04, velocity +0x10, normal +0x1c (2026-06-16 layout)
constexpr uintptr_t CAR_WORLD_CONTACT = 0x690;

// Copies n bytes from addr; false (and no crash) if any of it isn't readable
bool SafeRead(uintptr_t addr, void* out, size_t n) {
	if (addr < 0x10000) return false;
	__try {
		memcpy(out, (const void*)addr, n);
		return true;
	} __except (EXCEPTION_EXECUTE_HANDLER) {
		return false;
	}
}

template <class T> T Get(uintptr_t addr) {
	T v{};
	return SafeRead(addr, &v, sizeof v) ? v : T{};
}

} // namespace

class PhysLog : public BakkesMod::Plugin::BakkesModPlugin {
public:
	void onLoad() override;
	void onUnload() override;

private:
	bool Allowed();
	std::filesystem::path Folder();
	bool Open(const std::string& name);
	void Close(const char* why);
	void OnInput(CarWrapper car, void* params);
	void Header(CarWrapper car);
	void Row(CarWrapper car, const ControllerInput& in);
	bool LoadScenario(const std::string& name);
	void ApplyCar(CarWrapper car, const float* v);
	void ApplyBall(const float* v);
	bool FindBullet(CarWrapper car);
	void BulletHeader();
	void BulletShape(const char* who, uintptr_t shape, int depth);
	void BulletContacts();
	std::string BodyName(uintptr_t body);

	std::ofstream out_;
	std::ofstream bullet_;
	uintptr_t carBody_ = 0, ballBody_ = 0, world_ = 0, dispatcher_ = 0;
	std::string bulletInfo_;
	bool recording_ = false;
	bool headerWritten_ = false;
	unsigned long long tick_ = 0;
	std::vector<ScriptLine> script_;
	size_t scriptPos_ = 0;
	int ticksLeft_ = 0;
	bool scripted_ = false;
};

BAKKESMOD_PLUGIN(PhysLog, "PhysLog: physics recorder for engine validation", "1.0", PLUGINTYPE_FREEPLAY | PLUGINTYPE_CUSTOM_TRAINING)

void PhysLog::onLoad() {
	cvarManager->registerNotifier("physlog_start", [this](std::vector<std::string> args) {
		if (!Allowed()) { cvarManager->log("physlog: offline freeplay or custom training only"); return; }
		scripted_ = false;
		Open(args.size() > 1 ? args[1] : "free");
	}, "Record the local car and the ball every physics tick", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_stop", [this](std::vector<std::string>) { Close("stopped"); },
		"Stop recording", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_run", [this](std::vector<std::string> args) {
		if (!Allowed()) { cvarManager->log("physlog: offline freeplay or custom training only"); return; }
		if (args.size() < 2) { cvarManager->log("usage: physlog_run <scenario>"); return; }
		if (!LoadScenario(args[1])) return;
		scripted_ = true;
		scriptPos_ = 0;
		ticksLeft_ = 0;
		// Freeplay pauses when the window loses focus; the pause menu itself does not stop physics
		if (gameWrapper->IsPaused()) gameWrapper->ExecuteUnrealCommand("pause");
		Open(args[1]);
	}, "Play a scripted scenario and record it", PERMISSION_ALL);

	gameWrapper->HookEventWithCaller<CarWrapper>("Function TAGame.Car_TA.SetVehicleInput",
		[this](CarWrapper car, void* params, std::string) { OnInput(car, params); });
}

void PhysLog::onUnload() { Close("plugin unloaded"); }

bool PhysLog::Allowed() {
	return !gameWrapper->IsInOnlineGame() && (gameWrapper->IsInFreeplay() || gameWrapper->IsInCustomTraining());
}

std::filesystem::path PhysLog::Folder() { return gameWrapper->GetDataFolder() / "physlog"; }

bool PhysLog::Open(const std::string& name) {
	Close("restarted");
	std::filesystem::create_directories(Folder());
	std::time_t now = std::time(nullptr);
	char stamp[32];
	std::strftime(stamp, sizeof(stamp), "%Y%m%d_%H%M%S", std::localtime(&now));
	std::filesystem::path path = Folder() / (name + "_" + stamp + ".csv");
	out_.open(path);
	if (!out_) { cvarManager->log("physlog: cannot write " + path.string()); return false; }
	bullet_.open(Folder() / (name + "_" + stamp + "_bullet.csv"));
	recording_ = true;
	headerWritten_ = false;
	tick_ = 0;
	cvarManager->log("physlog: recording to " + path.string());
	return true;
}

void PhysLog::Close(const char* why) {
	if (!recording_) return;
	out_.close();
	bullet_.close();
	recording_ = false;
	scripted_ = false;
	cvarManager->log(std::string("physlog: ") + why + ", " + std::to_string(tick_) + " ticks");
}

bool PhysLog::LoadScenario(const std::string& name) {
	std::filesystem::path path = Folder() / "scenarios" / (name + ".txt");
	std::ifstream in(path);
	if (!in) { cvarManager->log("physlog: no scenario " + path.string()); return false; }
	script_.clear();
	std::vector<ScriptLine> block;
	int repeat = 0;
	std::string line;
	int lineNo = 0;
	while (std::getline(in, line)) {
		lineNo++;
		if (auto hash = line.find('#'); hash != std::string::npos) line.resize(hash);
		std::istringstream ss(line);
		std::string cmd;
		if (!(ss >> cmd)) continue;
		ScriptLine s;
		int count = 0;
		if (cmd == "car") { s.kind = ScriptLine::Car; count = 13; }
		else if (cmd == "ball") { s.kind = ScriptLine::Ball; count = 9; }
		else if (cmd == "wait") { s.kind = ScriptLine::Wait; ss >> s.ticks; }
		else if (cmd == "input") { s.kind = ScriptLine::Input; ss >> s.ticks; count = 8; }
		else if (cmd == "repeat") { ss >> repeat; block.clear(); continue; }
		else if (cmd == "end") {
			for (int k = 0; k < repeat; k++) script_.insert(script_.end(), block.begin(), block.end());
			repeat = 0;
			block.clear();
			continue;
		} else {
			cvarManager->log("physlog: " + path.string() + ":" + std::to_string(lineNo) + ": unknown command " + cmd);
			return false;
		}
		for (int i = 0; i < count; i++)
			if (!(ss >> s.v[i])) {
				cvarManager->log("physlog: " + path.string() + ":" + std::to_string(lineNo) + ": too few values");
				return false;
			}
		(repeat > 0 ? block : script_).push_back(s);
	}
	return true;
}

void PhysLog::ApplyCar(CarWrapper car, const float* v) {
	car.SetLocation(Vector(v[0], v[1], v[2]));
	car.SetRotation(Rotator(ToRotatorUnits(v[3]), ToRotatorUnits(v[4]), ToRotatorUnits(v[5])));
	car.SetVelocity(Vector(v[6], v[7], v[8]));
	car.SetAngularVelocity(Vector(v[9], v[10], v[11]), false);
	BoostWrapper boost = car.GetBoostComponent();
	if (!boost.IsNull()) boost.SetBoostAmount(v[12] / 100.f);
}

void PhysLog::ApplyBall(const float* v) {
	ServerWrapper server = gameWrapper->GetGameEventAsServer();
	if (server.IsNull()) return;
	BallWrapper ball = server.GetBall();
	if (ball.IsNull()) return;
	ball.SetLocation(Vector(v[0], v[1], v[2]));
	ball.SetVelocity(Vector(v[3], v[4], v[5]));
	ball.SetAngularVelocity(Vector(v[6], v[7], v[8]), false);
}

void PhysLog::OnInput(CarWrapper car, void* params) {
	if (!recording_ || car.IsNull() || !params) return;
	if (!Allowed()) { Close("left offline play"); return; }
	CarWrapper local = gameWrapper->GetLocalCar();
	if (local.IsNull() || local.memory_address != car.memory_address) return;
	ControllerInput* in = reinterpret_cast<ControllerInput*>(params);

	if (scripted_) {
		// Placement lines take effect now; wait/input lines hold for their ticks
		while (ticksLeft_ == 0 && scriptPos_ < script_.size()) {
			const ScriptLine& s = script_[scriptPos_];
			if (s.kind == ScriptLine::Car) { ApplyCar(car, s.v); scriptPos_++; }
			else if (s.kind == ScriptLine::Ball) { ApplyBall(s.v); scriptPos_++; }
			else ticksLeft_ = s.ticks;
		}
		if (ticksLeft_ == 0) { Close("scenario done"); return; }
		const ScriptLine& s = script_[scriptPos_];
		ControllerInput c{}; // the SDK struct has no initializers: wait lines would send garbage
		if (s.kind == ScriptLine::Input) {
			c.Throttle = s.v[0];
			c.Steer = s.v[1];
			c.Pitch = s.v[2];
			c.Yaw = s.v[3];
			c.Roll = s.v[4];
			c.DodgeForward = -s.v[2]; // as PlayerController_TA.PlayerMove sets them
			c.DodgeStrafe = s.v[3];
			c.Jump = s.v[5] != 0;
			c.ActivateBoost = c.HoldingBoost = s.v[6] != 0;
			c.Handbrake = s.v[7] != 0;
		}
		*in = c;
		if (--ticksLeft_ == 0) scriptPos_++;
	}
	if (!headerWritten_) {
		Header(car);
		bool found = FindBullet(car);
		bullet_ << "# " << bulletInfo_ << "\n";
		if (found) BulletHeader();
		else cvarManager->log("physlog: Bullet objects not found (" + bulletInfo_ + "); no _bullet.csv data");
	}
	Row(car, *in);
	if (world_) BulletContacts();
	tick_++;
}

void PhysLog::Header(CarWrapper car) {
	Vector ext = car.GetLocalCollisionExtent(), off = car.GetLocalCollisionOffset();
	out_ << "# body " << car.GetLoadoutBody() << " extent " << ext.X << " " << ext.Y << " " << ext.Z << " offset " << off.X
	     << " " << off.Y << " " << off.Z;
	// The player's sensitivities shape the inputs inside the physics (steering in VehicleSim, aerials in AirControl)
	VehicleSimWrapper sim = car.GetVehicleSim();
	AirControlComponentWrapper air = car.GetAirControlComponent();
	auto exact = [](float v) { char b[32]; std::snprintf(b, sizeof b, "%.9g", v); return std::string(b); };
	if (!sim.IsNull()) out_ << " steer_sensitivity " << exact(sim.GetSteeringSensitivity());
	if (!air.IsNull()) out_ << " air_sensitivity " << exact(air.GetAirControlSensitivity());
	if (!sim.IsNull()) {
		ArrayWrapper<WheelWrapper> wheels = sim.GetWheels();
		for (int i = 0; i < wheels.Count(); i++) {
			WheelWrapper w = wheels.Get(i);
			if (w.IsNull()) continue;
			Vector rest = w.GetLocalRestPosition(), ray = w.GetLocalSuspensionRayStart();
			out_ << " wheel" << i << " radius " << w.GetWheelRadius() << " rest " << rest.X << " " << rest.Y << " " << rest.Z
			     << " ray " << ray.X << " " << ray.Y << " " << ray.Z << " travel " << w.GetSuspensionTravel();
		}
	}
	out_ << "\n";
	out_ << "tick,time,cqx,cqy,cqz,cqw,cx,cy,cz,cvx,cvy,cvz,cwx,cwy,cwz,csleep,"
	        "bqx,bqy,bqz,bqw,bx,by,bz,bvx,bvy,bvz,bwx,bwy,bwz,bsleep,"
	        "throttle,steer,pitch,yaw,roll,dodge_fwd,dodge_strafe,handbrake,jump,activate_boost,holding_boost,jumped,"
	        "on_ground,wheel_world_contacts,b_jumped,b_double_jumped,has_flip,supersonic,time_below_supersonic,boost,"
	        "jump_active,jump_time,dj_active,dj_time,dodge_active,dodge_time,dodge_tx,dodge_ty,dodge_tz,"
	        "out_throttle,out_steer,out_handbrake,w0_steer,w1_steer,w0_contact,w1_contact,w2_contact,w3_contact,"
	        "w0_susp,w1_susp,w2_susp,w3_susp,wc_has,wc_nx,wc_ny,wc_nz\n";
	headerWritten_ = true;
}

void PhysLog::Row(CarWrapper car, const ControllerInput& in) {
	char buf[4096];
	int n = 0;
	auto put = [&](const char* fmt, auto... args) {
		if (n < (int)sizeof(buf)) n += std::snprintf(buf + n, sizeof(buf) - n, fmt, args...);
	};
	auto body = [&](RBState s) {
		put(",%.9g,%.9g,%.9g,%.9g", s.Quaternion.X, s.Quaternion.Y, s.Quaternion.Z, s.Quaternion.W);
		put(",%.9g,%.9g,%.9g", s.Location.X, s.Location.Y, s.Location.Z);
		put(",%.9g,%.9g,%.9g", s.LinearVelocity.X, s.LinearVelocity.Y, s.LinearVelocity.Z);
		put(",%.9g,%.9g,%.9g,%d", s.AngularVelocity.X, s.AngularVelocity.Y, s.AngularVelocity.Z, (int)s.bSleeping);
	};
	RBState cs = car.GetRBState();
	put("%llu,%.9g", tick_, cs.Time);
	body(cs);
	ServerWrapper server = gameWrapper->GetGameEventAsServer();
	BallWrapper ball = server.IsNull() ? BallWrapper(0) : server.GetBall();
	if (!ball.IsNull()) body(ball.GetRBState());
	else put(",,,,,,,,,,,,,,");
	put(",%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g", in.Throttle, in.Steer, in.Pitch, in.Yaw, in.Roll, in.DodgeForward, in.DodgeStrafe);
	put(",%d,%d,%d,%d,%d", (int)in.Handbrake, (int)in.Jump, (int)in.ActivateBoost, (int)in.HoldingBoost, (int)in.Jumped);
	put(",%d,%d,%d,%d,%d,%d,%.9g", (int)car.IsOnGround(), car.GetNumWheelWorldContacts(), (int)car.GetbJumped(),
		(int)car.GetbDoubleJumped(), (int)car.HasFlip(), (int)car.GetbSuperSonic(), car.GetTimeBelowSupersonicSpeed());
	BoostWrapper boost = car.GetBoostComponent();
	put(",%.9g", boost.IsNull() ? -1.f : boost.GetCurrentBoostAmount());
	JumpComponentWrapper jump = car.GetJumpComponent();
	DoubleJumpComponentWrapper dj = car.GetDoubleJumpComponent();
	DodgeComponentWrapper dodge = car.GetDodgeComponent();
	put(",%d,%.9g", jump.IsNull() ? -1 : (int)jump.GetbActive(), jump.IsNull() ? 0.f : jump.GetActiveTime());
	put(",%d,%.9g", dj.IsNull() ? -1 : (int)dj.GetbActive(), dj.IsNull() ? 0.f : dj.GetActiveTime());
	Vector torque = dodge.IsNull() ? Vector(0, 0, 0) : dodge.GetDodgeTorque();
	put(",%d,%.9g,%.9g,%.9g,%.9g", dodge.IsNull() ? -1 : (int)dodge.GetbActive(), dodge.IsNull() ? 0.f : dodge.GetActiveTime(),
		torque.X, torque.Y, torque.Z);
	VehicleSimWrapper sim = car.GetVehicleSim();
	if (!sim.IsNull()) {
		put(",%.9g,%.9g,%.9g", sim.GetOutputThrottle(), sim.GetOutputSteer(), sim.GetOutputHandbrake());
		ArrayWrapper<WheelWrapper> wheels = sim.GetWheels();
		float steer[2] = {}, susp[4] = {};
		int contact[4] = {};
		for (int i = 0; i < wheels.Count() && i < 4; i++) {
			WheelWrapper w = wheels.Get(i);
			if (w.IsNull()) continue;
			if (i < 2) steer[i] = w.GetSteer2();
			contact[i] = (int)w.GetbHadContact();
			susp[i] = w.GetSuspensionDistance();
		}
		put(",%.9g,%.9g,%d,%d,%d,%d,%.9g,%.9g,%.9g,%.9g", steer[0], steer[1], contact[0], contact[1], contact[2], contact[3],
			susp[0], susp[1], susp[2], susp[3]);
	} else {
		put(",,,,,,,,,,,,,");
	}
	// The game's WorldContact as the coming tick's auto-roll sees it (built after the previous tick)
	uintptr_t wc = car.memory_address + CAR_WORLD_CONTACT;
	put(",%d,%.6g,%.6g,%.6g", Get<int>(wc) & 1, Get<float>(wc + 0x1c), Get<float>(wc + 0x20), Get<float>(wc + 0x24));
	out_.write(buf, n < (int)sizeof(buf) ? n : (int)sizeof(buf) - 1);
	out_ << "\n";
}

// The car's and the ball's bodies, and the physics world that holds the car (checked: the world's dispatcher is the
// wrapper's, and the car's body is one of the world's collision objects)
bool PhysLog::FindBullet(CarWrapper car) {
	carBody_ = ballBody_ = world_ = dispatcher_ = 0;
	char b[256];
	uintptr_t actor = car.memory_address;
	carBody_ = Get<uintptr_t>(actor + ACTOR_BODY);
	ServerWrapper server = gameWrapper->GetGameEventAsServer();
	BallWrapper ball = server.IsNull() ? BallWrapper(0) : server.GetBall();
	if (!ball.IsNull()) ballBody_ = Get<uintptr_t>(ball.memory_address + ACTOR_BODY);
	uintptr_t gworld = Get<uintptr_t>((uintptr_t)GetModuleHandleW(nullptr) + GWORLD_RVA);
	uintptr_t scene = Get<uintptr_t>(gworld + 0x208);
	uintptr_t wrappers = Get<uintptr_t>(scene + 0xb0);
	int count = Get<int>(scene + 0xb8);
	int index = Get<uint8_t>(Get<uintptr_t>(actor + 0x208) + 0x80);
	uintptr_t wrapper = index < count ? Get<uintptr_t>(wrappers + 8 * index) : 0;
	uintptr_t world = Get<uintptr_t>(wrapper + 0x20), dispatcher = Get<uintptr_t>(wrapper + 0x08);
	bool sameDispatcher = world && Get<uintptr_t>(world + 0x28) == dispatcher;
	int objects = Get<int>(world + 0xc);
	uintptr_t objectData = Get<uintptr_t>(world + 0x18);
	bool carInWorld = false;
	for (int i = 0; i < objects && i < 100000 && !carInWorld; i++) carInWorld = Get<uintptr_t>(objectData + 8 * i) == carBody_;
	std::snprintf(b, sizeof b, "bullet gworld %p scene %p wrappers %d index %d world %p dispatcher %p (%s) objects %d car %s",
		(void*)gworld, (void*)scene, count, index, (void*)world, (void*)dispatcher, sameDispatcher ? "matches" : "MISMATCH",
		objects, carInWorld ? "in the world" : "NOT in the world");
	bulletInfo_ = b;
	if (!carBody_ || !sameDispatcher || !carInWorld) return false;
	world_ = world;
	dispatcher_ = dispatcher;
	return true;
}

std::string PhysLog::BodyName(uintptr_t body) {
	if (body == carBody_) return "car";
	if (body == ballBody_) return "ball";
	char b[64];
	std::snprintf(b, sizeof b, "shape%d", Get<int>(Get<uintptr_t>(body + BODY_SHAPE) + 0x8));
	return b;
}

// One shape (and a compound's children): type, local scaling, implicit dimensions and margin, all in uu
void PhysLog::BulletShape(const char* who, uintptr_t shape, int depth) {
	int type = Get<int>(shape + 0x8);
	auto vec = [&](uintptr_t a) { return std::to_string(Get<float>(a) * BU) + " " + std::to_string(Get<float>(a + 4) * BU) + " " +
		                                 std::to_string(Get<float>(a + 8) * BU); };
	auto raw = [&](uintptr_t a) { char b[96]; std::snprintf(b, sizeof b, "%.9g %.9g %.9g", Get<float>(a), Get<float>(a + 4),
		                                                   Get<float>(a + 8)); return std::string(b); };
	char b[64];
	std::snprintf(b, sizeof b, "%.9g", Get<float>(shape + 0x40) * BU);
	bullet_ << "# " << who << " shape " << (void*)shape << " type " << type << " scaling " << raw(shape + 0x20)
	        << " implicit_uu " << vec(shape + 0x30) << " margin_uu " << b << "\n";
	if (type == 31 && depth == 0) { // compound
		int n = Get<int>(shape + 0x1c);
		uintptr_t data = Get<uintptr_t>(shape + 0x28);
		std::snprintf(b, sizeof b, "%.9g", Get<float>(shape + 0x6c) * BU);
		bullet_ << "# " << who << " compound children " << n << " aabb_min_uu " << vec(shape + 0x40) << " aabb_max_uu "
		        << vec(shape + 0x50) << " margin_uu " << b << "\n";
		for (int i = 0; i < n && i < 8; i++) {
			uintptr_t c = data + 0x60 * i;
			bullet_ << "# " << who << " child " << i << " basis " << raw(c) << " | " << raw(c + 0x10) << " | " << raw(c + 0x20)
			        << " origin_uu " << vec(c + 0x30) << " child_type " << Get<int>(c + 0x48) << "\n";
			BulletShape(who, Get<uintptr_t>(c + 0x40), depth + 1);
		}
	}
}

// Once per recording: the shapes, every word of the car's and the ball's btRigidBody (as float and as int, to find
// fields like the inverse inertia), the CCD settings and the world's predictive-contact flag
void PhysLog::BulletHeader() {
	const std::pair<const char*, uintptr_t> bodies[2] = {{"car", carBody_}, {"ball", ballBody_}};
	for (auto [who, body] : bodies) {
		if (!body) continue;
		BulletShape(who, Get<uintptr_t>(body + BODY_SHAPE), 0);
		for (uintptr_t off = 0; off < BODY_SIZE; off += 16) {
			char b[256];
			int n = std::snprintf(b, sizeof b, "# %s body +0x%03x", who, (unsigned)off);
			for (uintptr_t k = 0; k < 16; k += 4)
				n += std::snprintf(b + n, sizeof b - n, " %.9g/%d", Get<float>(body + off + k), Get<int>(body + off + k));
			bullet_ << b << "\n";
		}
	}
	bullet_ << "# world predictive_flag(+0x1a5) " << (int)Get<uint8_t>(world_ + 0x1a5) << " predictive_manifolds "
	        << Get<int>(world_ + 0x1ac) << "\n";
	bullet_ << "tick,manifold,body0,body1,points,threshold,point,distance,lifetime,impulse,ax,ay,az,bx,by,bz,nx,ny,nz,"
	           "lax,lay,laz\n";
}

// Every tick (before its physics, like the main row): each contact manifold with the car or the ball in it, one line
// per point (point -1 for an empty manifold), from the dispatcher and from the world's predictive list. uu.
void PhysLog::BulletContacts() {
	const std::pair<uintptr_t, uintptr_t> lists[2] = {
		{Get<uintptr_t>(dispatcher_ + 0x20), (uintptr_t)Get<int>(dispatcher_ + 0x14)},
		{Get<uintptr_t>(world_ + 0x1b8), (uintptr_t)Get<int>(world_ + 0x1ac)}};
	for (int l = 0; l < 2; l++) {
		auto [data, count] = lists[l];
		for (uintptr_t m = 0; m < count && m < 10000; m++) {
			uintptr_t mf = Get<uintptr_t>(data + 8 * m);
			uintptr_t b0 = Get<uintptr_t>(mf + 0x450), b1 = Get<uintptr_t>(mf + 0x458);
			if (!mf || (b0 != carBody_ && b1 != carBody_ && b0 != ballBody_ && b1 != ballBody_)) continue;
			int points = Get<int>(mf + 0x460);
			float threshold = Get<float>(mf + 0x464) * BU;
			for (int i = points > 0 ? 0 : -1; i < points && i < 4; i++) {
				char b[512];
				int n = std::snprintf(b, sizeof b, "%llu,%s%p,%s,%s,%d,%.6g,%d", tick_, l ? "pred:" : "", (void*)mf,
					BodyName(b0).c_str(), BodyName(b1).c_str(), points, threshold, i);
				if (i >= 0) {
					uintptr_t p = mf + 0x10 + POINT_SIZE * i;
					auto v = [&](uintptr_t a) { n += std::snprintf(b + n, sizeof b - n, ",%.6f,%.6f,%.6f", Get<float>(a) * BU,
						                                              Get<float>(a + 4) * BU, Get<float>(a + 8) * BU); };
					n += std::snprintf(b + n, sizeof b - n, ",%.6f,%d,%.6g", Get<float>(p + 0x70) * BU, Get<int>(p + 0xb8),
						Get<float>(p + 0x9c));
					v(p + 0x30); // positionWorldOnA
					v(p + 0x20); // positionWorldOnB
					n += std::snprintf(b + n, sizeof b - n, ",%.6f,%.6f,%.6f", Get<float>(p + 0x40), Get<float>(p + 0x44),
						Get<float>(p + 0x48));
					v(p + 0x00); // localPointA
				}
				bullet_ << b << "\n";
			}
		}
	}
}
