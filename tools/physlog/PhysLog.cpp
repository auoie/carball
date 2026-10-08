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
//   physlog_run <scenario> [bot]   play a scripted scenario (data/physlog/scenarios/<scenario>.txt) and record it;
//                            with `bot`, on the car spawned with physlog_spawn (the player's car is parked aside)
//   physlog_spawn <body> [bot], physlog_removebots, physlog_cars   a second car for two-car scenarios or other bodies
//   physlog_removebot <team>   remove one bot of that team (uneven teams in an offline match)
//   physlog_products [slot]    every car body product (id, label, package, unlocked, owned) to data/physlog/products.tsv;
//                            with a slot (a word of its label, e.g. goal for Goal Explosion), that slot's products to
//                            data/physlog/products_<slot>.tsv
//   physlog_vsim               the player's car's VehicleSim curves (steer, handbrake steer, drive torque) to the log
//   physlog_body <product>   drive another car body (BakkesMod's item mod, offline only): e.g. 23 Octane, 403 Dominus,
//                            24 Paladin (Plank), 22 Breakout, 31 Venom (Hybrid), 30 Merc; `physlog_body restore` puts
//                            the player's own item-mod settings back
//
// Scenario files, one command per line (# comments):
//   car x y z  pitch yaw roll  vx vy vz  wx wy wz  boost   place the car (degrees; rad/s; boost 0-100)
//   ball x y z  vx vy vz  wx wy wz                         place the ball
//   wait N                                                 N ticks with no input
//   input N throttle steer pitch yaw roll jump boost handbrake   hold these inputs for N ticks (jump/boost/handbrake 0/1)
//   target bot                                             script and record the spawned car (physlog_spawn ... bot)
//                                                          instead of the player's; the player's becomes the other car
//   car2 ...  / input2 throttle steer pitch yaw roll jump boost handbrake   place the other car / set its input (held
//                                                          until the next input2; no ticks pass). With another car in
//                                                          the game, every row also records it (o_ columns)
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
#include "bakkesmod/wrappers/AIControllerWrapper.h"
#include "bakkesmod/wrappers/MenuStackWrapper.h"
#include "bakkesmod/wrappers/items/ItemsWrapper.h"
#include "utils/parser.h"

#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct ScriptLine {
	enum Kind { Car, Ball, Wait, Input, Car2, Input2 } kind;
	float v[13] = {};
	int ticks = 0;
};

// Rotator units: 65536 per turn
int ToRotatorUnits(float degrees) { return (int)(degrees * 65536.f / 360.f); }

// BakkesMod's item-mod loadout code (base64, bits LSB first): version (6 bits, 4), size in bytes (10), CRC (8: 0xff
// xor the bytes after the header), then: both teams the same (1), item count (4), per item slot (5), product (13),
// paint (6), then the colours. Returns the code with the body (slot 0, the first item) replaced, or "" if the code
// doesn't have that layout.
std::string WithBody(const std::string& code, int product) {
	std::vector<BYTE> b = base64_decode_bytearr(code);
	auto bit = [&](int i) { return (b[i / 8] >> (i % 8)) & 1; };
	auto read = [&](int off, int n) { int v = 0; for (int i = 0; i < n; i++) v |= bit(off + i) << i; return v; };
	if (b.size() < 8 || read(0, 6) != 4 || read(6, 10) != (int)b.size() || read(29, 5) != 0) return "";
	for (int i = 0; i < 13; i++) {
		int at = 34 + i;
		if ((product >> i) & 1) b[at / 8] |= (BYTE)(1 << (at % 8));
		else b[at / 8] &= (BYTE)~(1 << (at % 8));
	}
	BYTE crc = 0xff;
	for (size_t i = 3; i < b.size(); i++) crc ^= b[i];
	b[2] = crc;
	return base64_encode(b.data(), (unsigned int)b.size());
}

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
	void Header(CarWrapper car, CarWrapper other);
	void Row(CarWrapper car, const ControllerInput& in, CarWrapper other, const ControllerInput& otherIn);
	CarWrapper OtherCar(CarWrapper not_this);
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
	uintptr_t carBody_ = 0, ballBody_ = 0, otherBody_ = 0, world_ = 0, dispatcher_ = 0;
	std::string bulletInfo_;
	std::string savedItemCode_, savedItemEnabled_; // the player's item-mod settings before physlog_body
	bool targetBot_ = false;                       // record the spawned car, not the player's (scenario: target bot)
	bool headerOther_ = false;                     // the header has the other car's columns
	bool parkOther_ = false;                       // park the other car aside at the start (physlog_run ... bot)
	ControllerInput input2_{};                     // the other car's scripted input
	ControllerInput targetInput_{};                // the scripted input for the recorded car this tick
	ControllerInput botApplied_{};                 // the input the spawned car last got
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
		if (args.size() > 2 && args[2] == "bot") {
			targetBot_ = true;
			parkOther_ = true; // the player's car out of the way, unless the scenario places it (car2)
		}
		scripted_ = true;
		scriptPos_ = 0;
		ticksLeft_ = 0;
		// Freeplay pauses when the window loses focus; the pause menu itself does not stop physics
		if (gameWrapper->IsPaused()) gameWrapper->ExecuteUnrealCommand("pause");
		Open(args[1]);
	}, "Play a scripted scenario and record it", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_body", [this](std::vector<std::string> args) {
		if (!Allowed()) { cvarManager->log("physlog: offline freeplay or custom training only"); return; }
		if (args.size() < 2) { cvarManager->log("usage: physlog_body <product id> | restore"); return; }
		CVarWrapper code = cvarManager->getCvar("cl_itemmod_code"), enabled = cvarManager->getCvar("cl_itemmod_enabled");
		if (code.IsNull() || enabled.IsNull()) { cvarManager->log("physlog: BakkesMod's item mod cvars not found"); return; }
		// The player's own settings are kept in a file too, so a plugin reload doesn't lose them
		std::filesystem::path savedPath = Folder() / "itemmod_saved.txt";
		if (savedItemCode_.empty()) {
			std::ifstream f(savedPath);
			std::getline(f, savedItemCode_);
			std::getline(f, savedItemEnabled_);
		}
		if (args[1] == "restore") {
			if (savedItemCode_.empty()) { cvarManager->log("physlog: nothing to restore"); return; }
			code.setValue(savedItemCode_);
			enabled.setValue(savedItemEnabled_);
			cvarManager->log("physlog: item mod restored (" + savedItemCode_ + ", enabled " + savedItemEnabled_ + ")");
			savedItemCode_.clear();
			std::filesystem::remove(savedPath);
			return;
		}
		if (savedItemCode_.empty()) {
			savedItemCode_ = code.getStringValue();
			savedItemEnabled_ = enabled.getStringValue();
			std::filesystem::create_directories(Folder());
			std::ofstream(savedPath) << savedItemCode_ << "\n" << savedItemEnabled_ << "\n";
		}
		std::string next = WithBody(savedItemCode_, std::stoi(args[1]));
		if (next.empty()) { cvarManager->log("physlog: unknown item-mod code layout: " + savedItemCode_); return; }
		code.setValue(next);
		enabled.setValue("1");
		cvarManager->log("physlog: body " + args[1] + " (item mod code " + next + ")");
	}, "Drive another car body through BakkesMod's item mod (offline)", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_spawn", [this](std::vector<std::string> args) {
		if (!Allowed()) { cvarManager->log("physlog: offline freeplay or custom training only"); return; }
		ServerWrapper server = gameWrapper->GetGameEventAsServer();
		if (server.IsNull() || args.size() < 2) { cvarManager->log("usage: physlog_spawn <body> [bot]"); return; }
		int body = std::stoi(args[1]);
		if (args.size() > 2 && args[2] == "bot") server.SpawnBot(body, "PhysLogBot");
		else server.SpawnCar(body, "PhysLogCar");
		cvarManager->log("physlog: spawned body " + args[1] + (args.size() > 2 ? " (bot)" : ""));
	}, "Spawn a second car (offline)", PERMISSION_ALL);
	// The player's car demolished: it respawns as a new car (which takes item mod's body)
	cvarManager->registerNotifier("physlog_demolish", [this](std::vector<std::string>) {
		if (!Allowed()) { cvarManager->log("physlog: offline freeplay or custom training only"); return; }
		CarWrapper car = gameWrapper->GetLocalCar();
		if (!car.IsNull()) car.Demolish();
		cvarManager->log("physlog: demolished the player's car");
	}, "Demolish the player's car (offline): it respawns", PERMISSION_ALL);
	// Heartbeat for scripts (tools/physlog/check_game.sh): the reply only appears if the game is processing commands
	cvarManager->registerNotifier("physlog_ping", [this](std::vector<std::string> args) {
		std::string menus;
		MenuStackWrapper stack = gameWrapper->GetMenuStack();
		if (!stack.IsNull())
			for (const std::string& m : stack.GetMenuStack()) menus += (menus.empty() ? "" : ",") + m;
		cvarManager->log("physlog: pong " + (args.size() > 1 ? args[1] : std::string("-")) + " freeplay " +
			std::to_string((int)gameWrapper->IsInFreeplay()) + " online " + std::to_string((int)gameWrapper->IsInOnlineGame()) +
			" paused " + std::to_string((int)gameWrapper->IsPaused()) + " menus [" + menus + "]");
	}, "Reply with the game's state (heartbeat)", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_removebots", [this](std::vector<std::string> args) {
		if (!Allowed()) return;
		if (args.size() > 1) { cvarManager->executeCommand("physlog_removebot " + args[1], false); return; } // one bot of a team
		ServerWrapper server = gameWrapper->GetGameEventAsServer();
		if (server.IsNull()) return;
		ArrayWrapper<CarWrapper> cars = server.GetCars();
		int removed = 0;
		for (int i = cars.Count() - 1; i >= 0; i--) {
			CarWrapper c = cars.Get(i);
			if (c.IsNull()) continue;
			AIControllerWrapper ai = c.GetAIController();
			if (!ai.IsNull()) { server.RemovePlayer(ai); removed++; }
		}
		cvarManager->log("physlog: removed " + std::to_string(removed) + " bots");
	}, "Remove the bots (offline)", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_removebot", [this](std::vector<std::string> args) {
		if (!Allowed()) return;
		ServerWrapper server = gameWrapper->GetGameEventAsServer();
		if (server.IsNull() || args.size() < 2) { cvarManager->log("usage: physlog_removebot <team 0|1>"); return; }
		int team = std::stoi(args[1]);
		ArrayWrapper<CarWrapper> cars = server.GetCars();
		for (int i = cars.Count() - 1; i >= 0; i--) {
			CarWrapper c = cars.Get(i);
			if (c.IsNull() || c.GetTeamNum2() != team) continue;
			AIControllerWrapper ai = c.GetAIController();
			if (ai.IsNull()) continue;
			server.RemovePlayer(ai);
			cvarManager->log("physlog: removed a bot of team " + args[1]);
			return;
		}
		cvarManager->log("physlog: no bot on team " + args[1]);
	}, "Remove one bot of a team (offline)", PERMISSION_ALL);
	// Read-only: the products the game knows, for picking car bodies (which ones this profile has)
	cvarManager->registerNotifier("physlog_products", [this](std::vector<std::string> args) {
		if (gameWrapper->IsInOnlineGame()) return;
		ItemsWrapper items = gameWrapper->GetItemsWrapper();
		if (items.IsNull()) { cvarManager->log("physlog: no items wrapper"); return; }
		std::set<int> unlocked, owned;
		ArrayWrapper<ProductWrapper> cached = items.GetCachedUnlockedProducts();
		for (int i = 0; i < cached.Count(); i++) {
			ProductWrapper p = cached.Get(i);
			if (!p.IsNull()) unlocked.insert(p.GetID());
		}
		ArrayWrapper<OnlineProductWrapper> online = items.GetOwnedProducts();
		for (int i = 0; i < online.Count(); i++) {
			OnlineProductWrapper p = online.Get(i);
			if (!p.IsNull()) owned.insert(p.GetProductID());
		}
		auto lower = [](std::string s) { for (char& ch : s) ch = (char)std::tolower((unsigned char)ch); return s; };
		// (a slot asked for: its products, matched on a word of the slot's label; else the car bodies)
		std::string want = args.size() > 1 ? lower(args[1]) : "";
		std::filesystem::create_directories(Folder());
		std::ofstream f(Folder() / (want.empty() ? "products.tsv" : "products_" + want + ".tsv"));
		f << "id\tslot\tlabel\tpackage\tunlocked\towned\n";
		ArrayWrapper<ProductWrapper> all = items.GetAllProducts();
		int bodies = 0, have = 0;
		std::string list;
		for (int i = 0; i < all.Count(); i++) {
			ProductWrapper p = all.Get(i);
			if (p.IsNull()) continue;
			// Car bodies: the "Body" slot, or a body_<name> asset package
			UnrealStringWrapper slotLabel = p.GetDisplayLabelSlot();
			std::string slot = slotLabel.IsNull() ? "" : slotLabel.ToString(), package = p.GetAssetPackageName();
			if (!want.empty() ? lower(slot).find(want) == std::string::npos
			                  : (lower(slot) != "body" && lower(package).rfind("body_", 0) != 0)) continue;
			int id = p.GetID();
			bool u = unlocked.count(id) > 0, o = owned.count(id) > 0;
			UnrealStringWrapper label = p.GetLabel();
			f << id << "\t" << slot << "\t" << (label.IsNull() ? "" : label.ToString()) << "\t" << package
			  << "\t" << (int)u << "\t" << (int)o << "\n";
			bodies++;
			if (u || o) { have++; list += " " + std::to_string(id) + ":" + p.GetAssetPackageName(); }
		}
		cvarManager->log("physlog: " + std::to_string(bodies) + (want.empty() ? " bodies, " : " products in slot " + want + ", ")
			+ std::to_string(have) + " unlocked or owned" + (want.empty() ? ":" + list : ""));
	}, "Write the car body products (or a slot's: physlog_products <slot>) to data/physlog/products*.tsv (read-only)", PERMISSION_ALL);
	// Read-only: the VehicleSim curves of the player's car (live layout 2026-10-06: TArrays of 0x1c-byte points,
	// InVal +0, OutVal +4)
	cvarManager->registerNotifier("physlog_vsim", [this](std::vector<std::string>) {
		if (gameWrapper->IsInOnlineGame()) return;
		CarWrapper car = gameWrapper->GetLocalCar();
		if (car.IsNull()) return;
		VehicleSimWrapper vsim = car.GetVehicleSim();
		if (vsim.IsNull()) return;
		uintptr_t base = vsim.memory_address;
		auto curve = [&](const char* name, uintptr_t offset) {
			uintptr_t data = *reinterpret_cast<uintptr_t*>(base + offset);
			int count = *reinterpret_cast<int*>(base + offset + 8);
			std::string line = std::string("physlog: vsim ") + name + " (" + std::to_string(count) + "):";
			if (data && count > 0 && count <= 64)
				for (int i = 0; i < count; i++) {
					float in = *reinterpret_cast<float*>(data + i * 0x1c), outv = *reinterpret_cast<float*>(data + i * 0x1c + 4);
					char b[64];
					std::snprintf(b, sizeof b, " (%.4f, %.4f)", in, outv);
					line += b;
				}
			cvarManager->log(line);
		};
		cvarManager->log("physlog: vsim body " + std::to_string(car.GetLoadoutBody()) + " flags+0x11c bit0 " +
			std::to_string(*reinterpret_cast<uint32_t*>(base + 0x11c) & 1));
		curve("SteerAngleCurve", 0xb0);
		curve("HandbrakeSteerAngleCurve", 0xf0);
		curve("DriveTorqueCurve", 0xd0);
	}, "Log the player's car's VehicleSim curves (read-only)", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_cars", [this](std::vector<std::string> args) {
		// (also `physlog_cars products` / `physlog_cars vsim`: the same as physlog_products / physlog_vsim, for an rcon
		// whitelist read before those commands existed)
		if (args.size() > 1 && (args[1] == "products" || args[1] == "vsim")) {
			cvarManager->executeCommand("physlog_" + args[1], false);
			return;
		}
		ServerWrapper server = gameWrapper->GetGameEventAsServer();
		if (server.IsNull()) return;
		ArrayWrapper<CarWrapper> cars = server.GetCars();
		CarWrapper local = gameWrapper->GetLocalCar();
		for (int i = 0; i < cars.Count(); i++) {
			CarWrapper c = cars.Get(i);
			if (c.IsNull()) continue;
			Vector l = c.GetLocation(), e = c.GetLocalCollisionExtent();
			char b[256];
			std::snprintf(b, sizeof b, "physlog: car %d body %d%s at %.0f %.0f %.0f extent %.4f %.4f %.4f", i, c.GetLoadoutBody(),
				c.memory_address == local.memory_address ? " (local)" : "", l.X, l.Y, l.Z, e.X, e.Y, e.Z);
			cvarManager->log(b);
		}
	}, "List the cars", PERMISSION_ALL);
	cvarManager->registerNotifier("physlog_resetplayers", [this](std::vector<std::string>) {
		if (!Allowed()) return;
		ServerWrapper server = gameWrapper->GetGameEventAsServer();
		if (!server.IsNull()) server.ResetPlayers();
		cvarManager->log("physlog: players reset");
	}, "Reset the players (offline)", PERMISSION_ALL);

	gameWrapper->HookEventWithCaller<CarWrapper>("Function TAGame.Car_TA.SetVehicleInput",
		[this](CarWrapper car, void* params, std::string) { OnInput(car, params); });
}

void PhysLog::onUnload() { Close("plugin unloaded"); }

bool PhysLog::Allowed() {
	// Offline only: freeplay, custom training, or an offline match (exhibition against bots)
	return !gameWrapper->IsInOnlineGame() &&
		(gameWrapper->IsInFreeplay() || gameWrapper->IsInCustomTraining() || gameWrapper->IsInGame());
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
	input2_ = targetInput_ = botApplied_ = ControllerInput{};
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
	targetBot_ = false;
	parkOther_ = false;
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
		if (cmd == "target") {
			std::string who;
			ss >> who;
			targetBot_ = who == "bot";
			continue;
		}
		if (cmd == "car") { s.kind = ScriptLine::Car; count = 13; }
		else if (cmd == "car2") { s.kind = ScriptLine::Car2; count = 13; }
		else if (cmd == "input2") { s.kind = ScriptLine::Input2; count = 8; }
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

// The first car that isn't `not_this` (a car spawned with physlog_spawn, or the player's)
CarWrapper PhysLog::OtherCar(CarWrapper not_this) {
	ServerWrapper server = gameWrapper->GetGameEventAsServer();
	if (server.IsNull()) return CarWrapper(0);
	ArrayWrapper<CarWrapper> cars = server.GetCars();
	for (int i = 0; i < cars.Count(); i++) {
		CarWrapper c = cars.Get(i);
		if (!c.IsNull() && c.memory_address != not_this.memory_address) return c;
	}
	return CarWrapper(0);
}

namespace {
ControllerInput ScriptInput(const float* v) {
	ControllerInput c{}; // the SDK struct has no initializers
	c.Throttle = v[0];
	c.Steer = v[1];
	c.Pitch = v[2];
	c.Yaw = v[3];
	c.Roll = v[4];
	c.DodgeForward = -v[2]; // as PlayerController_TA.PlayerMove sets them
	c.DodgeStrafe = v[3];
	c.Jump = v[5] != 0;
	c.ActivateBoost = c.HoldingBoost = v[6] != 0;
	c.Handbrake = v[7] != 0;
	return c;
}
} // namespace

void PhysLog::OnInput(CarWrapper car, void* params) {
	if (!recording_ || car.IsNull() || !params) return;
	if (!Allowed()) { Close("left offline play"); return; }
	CarWrapper local = gameWrapper->GetLocalCar();
	if (local.IsNull()) return;
	CarWrapper bot = OtherCar(local);
	ControllerInput* in = reinterpret_cast<ControllerInput*>(params);

	// A spawned car's input is set every rendered frame (several times per physics tick, and before the player's in a
	// tick): it only gets its scripted input here, and the input it really got is what its row records
	if (!bot.IsNull() && car.memory_address == bot.memory_address) {
		if (scripted_) *in = targetBot_ ? targetInput_ : input2_;
		botApplied_ = *in;
		return;
	}
	if (car.memory_address != local.memory_address) return;

	// The player's car: its input is set once per physics tick, so it is the clock for the script and the rows
	CarWrapper target = targetBot_ ? bot : local, other = targetBot_ ? local : bot;
	if (target.IsNull()) { Close("no spawned car to record (physlog_spawn <body> bot)"); return; }
	if (scripted_ && parkOther_ && !other.IsNull()) {
		const float park[13] = {-3500, 4300, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}; // a corner of the field
		ApplyCar(other, park);
		parkOther_ = false;
	}
	if (scripted_) {
		// Placement lines and input2 take effect now; wait/input lines hold for their ticks
		while (ticksLeft_ == 0 && scriptPos_ < script_.size()) {
			const ScriptLine& s = script_[scriptPos_];
			if (s.kind == ScriptLine::Car) { ApplyCar(target, s.v); scriptPos_++; }
			else if (s.kind == ScriptLine::Car2) { if (!other.IsNull()) ApplyCar(other, s.v); scriptPos_++; }
			else if (s.kind == ScriptLine::Input2) { input2_ = ScriptInput(s.v); scriptPos_++; }
			else if (s.kind == ScriptLine::Ball) { ApplyBall(s.v); scriptPos_++; }
			else ticksLeft_ = s.ticks;
		}
		if (ticksLeft_ == 0) { Close("scenario done"); return; }
		const ScriptLine& s = script_[scriptPos_];
		targetInput_ = s.kind == ScriptLine::Input ? ScriptInput(s.v) : ControllerInput{};
		*in = targetBot_ ? input2_ : targetInput_;
		if (--ticksLeft_ == 0) scriptPos_++;
	}
	if (!headerWritten_) {
		Header(target, other);
		bool found = FindBullet(target);
		bullet_ << "# " << bulletInfo_ << "\n";
		if (found) BulletHeader();
		else cvarManager->log("physlog: Bullet objects not found (" + bulletInfo_ + "); no _bullet.csv data");
	}
	if (targetBot_) Row(target, botApplied_, other, *in);
	else Row(target, *in, other, botApplied_);
	if (world_) BulletContacts();
	tick_++;
}

namespace {
// A car's columns after the ball's (the other car's get the prefix o_)
const char* CAR_COLUMNS =
	"throttle,steer,pitch,yaw,roll,dodge_fwd,dodge_strafe,handbrake,jump,activate_boost,holding_boost,jumped,"
	"on_ground,wheel_world_contacts,b_jumped,b_double_jumped,has_flip,supersonic,time_below_supersonic,boost,"
	"jump_active,jump_time,dj_active,dj_time,dodge_active,dodge_time,dodge_tx,dodge_ty,dodge_tz,"
	"out_throttle,out_steer,out_handbrake,w0_steer,w1_steer,w0_contact,w1_contact,w2_contact,w3_contact,"
	"w0_susp,w1_susp,w2_susp,w3_susp,wc_has,wc_nx,wc_ny,wc_nz";
const char* BODY_COLUMNS = "qx,qy,qz,qw,x,y,z,vx,vy,vz,wx,wy,wz,sleep";
std::string Prefixed(const std::string& prefix, const std::string& list) {
	std::string out;
	std::stringstream ss(list);
	for (std::string name; std::getline(ss, name, ',');) out += (out.empty() ? "" : ",") + prefix + name;
	return out;
}
} // namespace

void PhysLog::Header(CarWrapper car, CarWrapper other) {
	auto describe = [&](CarWrapper c, const std::string& prefix) {
		Vector ext = c.GetLocalCollisionExtent(), off = c.GetLocalCollisionOffset();
		out_ << prefix << "body " << c.GetLoadoutBody() << " " << prefix << "team " << (int)c.GetTeamNum2() << " " << prefix << "extent "
		     << ext.X << " " << ext.Y << " " << ext.Z
		     << " " << prefix << "offset " << off.X << " " << off.Y << " " << off.Z;
		// The player's sensitivities shape the inputs inside the physics (steering in VehicleSim, aerials in AirControl)
		VehicleSimWrapper sim = c.GetVehicleSim();
		AirControlComponentWrapper air = c.GetAirControlComponent();
		auto exact = [](float v) { char b[32]; std::snprintf(b, sizeof b, "%.9g", v); return std::string(b); };
		if (!sim.IsNull()) out_ << " " << prefix << "steer_sensitivity " << exact(sim.GetSteeringSensitivity());
		if (!air.IsNull()) out_ << " " << prefix << "air_sensitivity " << exact(air.GetAirControlSensitivity());
		if (!sim.IsNull()) {
			ArrayWrapper<WheelWrapper> wheels = sim.GetWheels();
			for (int i = 0; i < wheels.Count(); i++) {
				WheelWrapper w = wheels.Get(i);
				if (w.IsNull()) continue;
				Vector rest = w.GetLocalRestPosition(), ray = w.GetLocalSuspensionRayStart();
				out_ << " " << prefix << "wheel" << i << " radius " << w.GetWheelRadius() << " rest " << rest.X << " " << rest.Y
				     << " " << rest.Z << " ray " << ray.X << " " << ray.Y << " " << ray.Z << " travel " << w.GetSuspensionTravel();
			}
		}
	};
	out_ << "# ";
	describe(car, "");
	if (!other.IsNull()) {
		out_ << " ";
		describe(other, "o_");
	}
	out_ << "\n";
	out_ << "tick,time," << Prefixed("c", BODY_COLUMNS) << "," << Prefixed("b", BODY_COLUMNS) << "," << CAR_COLUMNS;
	headerOther_ = !other.IsNull();
	if (headerOther_) out_ << "," << Prefixed("o_c", BODY_COLUMNS) << "," << Prefixed("o_", CAR_COLUMNS);
	// The match's state (an offline match: the clock, the round, the scores; empty in freeplay's terms where the
	// game has none)
	out_ << ",m_time,m_seconds,m_countdown,m_round_active,m_ball_hit,m_overtime,m_match_ended,m_score0,m_score1";
	out_ << "\n";
	headerWritten_ = true;
}

void PhysLog::Row(CarWrapper car, const ControllerInput& in, CarWrapper other, const ControllerInput& otherIn) {
	char buf[8192];
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
	auto fields = [&](CarWrapper c, const ControllerInput& in) {
		put(",%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%.9g", in.Throttle, in.Steer, in.Pitch, in.Yaw, in.Roll, in.DodgeForward, in.DodgeStrafe);
		put(",%d,%d,%d,%d,%d", (int)in.Handbrake, (int)in.Jump, (int)in.ActivateBoost, (int)in.HoldingBoost, (int)in.Jumped);
		put(",%d,%d,%d,%d,%d,%d,%.9g", (int)c.IsOnGround(), c.GetNumWheelWorldContacts(), (int)c.GetbJumped(),
			(int)c.GetbDoubleJumped(), (int)c.HasFlip(), (int)c.GetbSuperSonic(), c.GetTimeBelowSupersonicSpeed());
		BoostWrapper boost = c.GetBoostComponent();
		put(",%.9g", boost.IsNull() ? -1.f : boost.GetCurrentBoostAmount());
		JumpComponentWrapper jump = c.GetJumpComponent();
		DoubleJumpComponentWrapper dj = c.GetDoubleJumpComponent();
		DodgeComponentWrapper dodge = c.GetDodgeComponent();
		put(",%d,%.9g", jump.IsNull() ? -1 : (int)jump.GetbActive(), jump.IsNull() ? 0.f : jump.GetActiveTime());
		put(",%d,%.9g", dj.IsNull() ? -1 : (int)dj.GetbActive(), dj.IsNull() ? 0.f : dj.GetActiveTime());
		Vector torque = dodge.IsNull() ? Vector(0, 0, 0) : dodge.GetDodgeTorque();
		put(",%d,%.9g,%.9g,%.9g,%.9g", dodge.IsNull() ? -1 : (int)dodge.GetbActive(), dodge.IsNull() ? 0.f : dodge.GetActiveTime(),
			torque.X, torque.Y, torque.Z);
		VehicleSimWrapper sim = c.GetVehicleSim();
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
		uintptr_t wc = c.memory_address + CAR_WORLD_CONTACT;
		put(",%d,%.6g,%.6g,%.6g", Get<int>(wc) & 1, Get<float>(wc + 0x1c), Get<float>(wc + 0x20), Get<float>(wc + 0x24));
	};
	RBState cs = car.GetRBState();
	put("%llu,%.9g", tick_, cs.Time);
	body(cs);
	ServerWrapper server = gameWrapper->GetGameEventAsServer();
	BallWrapper ball = server.IsNull() ? BallWrapper(0) : server.GetBall();
	if (!ball.IsNull()) body(ball.GetRBState());
	else put(",,,,,,,,,,,,,,");
	fields(car, in);
	if (!other.IsNull()) {
		body(other.GetRBState());
		fields(other, otherIn);
	} else if (headerOther_) { // the other car is gone (demolished): its columns empty
		for (int i = 0; i < 14 + 46; i++) put(",");
	}
	if (!server.IsNull()) {
		int score[2] = {};
		ArrayWrapper<TeamWrapper> teams = server.GetTeams();
		for (int i = 0; i < teams.Count() && i < 2; i++)
			if (!teams.Get(i).IsNull()) score[i] = teams.Get(i).GetScore();
		put(",%.6g,%d,%d,%d,%d,%d,%d,%d,%d", server.GetGameTimeRemaining(), server.GetSecondsRemaining(),
		    server.GetSecondsRemainingCountdown(), (int)server.GetbRoundActive(), (int)server.GetbBallHasBeenHit(),
		    (int)server.GetbOverTime(), (int)server.GetbMatchEnded(), score[0], score[1]);
	} else {
		put(",,,,,,,,,");
	}
	out_.write(buf, n < (int)sizeof(buf) ? n : (int)sizeof(buf) - 1);
	out_ << "\n";
}

// The car's and the ball's bodies, and the physics world that holds the car (checked: the world's dispatcher is the
// wrapper's, and the car's body is one of the world's collision objects)
bool PhysLog::FindBullet(CarWrapper car) {
	carBody_ = ballBody_ = otherBody_ = world_ = dispatcher_ = 0;
	char b[256];
	uintptr_t actor = car.memory_address;
	carBody_ = Get<uintptr_t>(actor + ACTOR_BODY);
	CarWrapper other = OtherCar(car);
	otherBody_ = other.IsNull() ? 0 : Get<uintptr_t>(other.memory_address + ACTOR_BODY);
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
	if (body && body == otherBody_) return "car2";
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
			auto ours = [&](uintptr_t b) { return b == carBody_ || b == ballBody_ || (b && b == otherBody_); };
			if (!mf || (!ours(b0) && !ours(b1))) continue;
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
