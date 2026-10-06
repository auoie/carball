// JavaScript bindings (embind) for the patched RocketSim engine.
//
//   import createEngine from "./rlengine.mjs";
//   const engine = await createEngine();
//   engine.init([new Uint8Array(cmfBytes)]);       // arena collision meshes (out/arena/...cmf)
//   const sim = new engine.Sim();
//   const id = sim.addCar(0, 0);                    // team (0 blue, 1 orange), car type (0 = Octane)
//   sim.setControls(id, 1, 0, 0, 0, 0, false, true, false);
//   sim.step(1);
//   const car = sim.carState(id);                   // Float32Array view, see CAR_* offsets
//
// State getters return new typed arrays (copies), so they stay valid after later calls.
#include "RocketSim.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

using namespace RocketSim;
using emscripten::val;

// Typed JS values, so the generated rlengine.d.ts has real types instead of `any`
EMSCRIPTEN_DECLARE_VAL_TYPE(Float32ArrayVal);
EMSCRIPTEN_DECLARE_VAL_TYPE(Int32ArrayVal);
EMSCRIPTEN_DECLARE_VAL_TYPE(Uint8ArrayVal);
EMSCRIPTEN_DECLARE_VAL_TYPE(NumberArrayVal); // ArrayLike<number>
EMSCRIPTEN_DECLARE_VAL_TYPE(ByteArrayListVal); // Uint8Array[]

namespace Layout {
	// Ball: position, velocity, angular velocity, rotation (forward, right, up)
	constexpr int BALL_POS = 0, BALL_VEL = 3, BALL_ANG_VEL = 6, BALL_ROT = 9, BALL_SIZE = 18;

	// Car: as the ball, then boost (0-100) and flags (0/1)
	constexpr int
		CAR_POS = 0, CAR_VEL = 3, CAR_ANG_VEL = 6, CAR_ROT = 9,
		CAR_BOOST = 18, CAR_ON_GROUND = 19, CAR_HAS_JUMPED = 20, CAR_HAS_DOUBLE_JUMPED = 21, CAR_HAS_FLIPPED = 22,
		CAR_IS_FLIPPING = 23, CAR_IS_JUMPING = 24, CAR_SUPERSONIC = 25, CAR_BOOSTING = 26, CAR_DEMOED = 27,
		CAR_DEMO_RESPAWN_TIMER = 28, CAR_HANDBRAKE = 29, CAR_WHEEL_CONTACT = 30 /* 4 values */,
		CAR_TEAM = 34, CAR_AUTO_FLIPPING = 35, CAR_LAST_BALL_HIT_TICK = 36 /* -1 = never */,
		CAR_GROUND_NORMAL = 37 /* 3 values: average contact normal of the wheels touching something, else up */,
		CAR_SIZE = 40;

	// Boost pad: position, isBig, isActive, cooldown
	constexpr int PAD_POS = 0, PAD_BIG = 3, PAD_ACTIVE = 4, PAD_COOLDOWN = 5, PAD_SIZE = 6;

	// Car configuration (carConfig): hitbox and wheels in the car's local frame (x forward, y right, z up).
	// Wheel offsets are the right-hand wheels; the left ones mirror y.
	constexpr int CFG_HITBOX_SIZE = 0, CFG_HITBOX_OFFSET = 3,
		CFG_FRONT_WHEEL_OFFSET = 6, CFG_FRONT_WHEEL_RADIUS = 9, CFG_FRONT_SUSPENSION_REST = 10,
		CFG_BACK_WHEEL_OFFSET = 11, CFG_BACK_WHEEL_RADIUS = 14, CFG_BACK_SUSPENSION_REST = 15, CFG_SIZE = 16;

	// Events from the last step() calls: [type, a, b] per event
	constexpr int EVENT_GOAL = 0 /* a = scoring team */, EVENT_BUMP = 1 /* a = bumper id, b = victim id */,
		EVENT_DEMO = 2 /* a = attacker id, b = victim id */;
}

static const CarConfig* CarConfigByIndex(int index) {
	static const CarConfig* configs[] = {
		&CAR_CONFIG_OCTANE, &CAR_CONFIG_DOMINUS, &CAR_CONFIG_PLANK, &CAR_CONFIG_BREAKOUT,
		&CAR_CONFIG_HYBRID, &CAR_CONFIG_MERC, &CAR_CONFIG_PSYCLOPS
	};
	return (index >= 0 && index < 7) ? configs[index] : configs[0];
}

static void InitMeshes(ByteArrayListVal meshes) {
	std::vector<RocketSim::FileData> files;
	int count = meshes["length"].as<int>();
	for (int i = 0; i < count; i++) {
		std::vector<uint8_t> bytes = emscripten::convertJSArrayToNumberVector<uint8_t>(meshes[i]);
		files.emplace_back(bytes.begin(), bytes.end());
	}
	RocketSim::InitFromMem({ { GameMode::SOCCAR, files } }, true);
}

template <typename Result, typename T>
static Result CopyToJS(const char* arrayType, const std::vector<T>& data) {
	val arr = val::global(arrayType).new_(data.size());
	arr.call<void>("set", val(emscripten::typed_memory_view(data.size(), data.data())));
	return Result(arr);
}

// Vehicle_TA.GetGroundNormal (native FUN_140ef00c0): the normalized average contact normal of the
// wheels in contact, or straight up when no wheel touches anything. Used by the camera.
static Vec GroundNormal(Car* car) {
	btVector3 sum(0, 0, 0);
	int contacts = 0;
	for (int i = 0; i < car->_bulletVehicle.getNumWheels(); i++) {
		const auto& wheel = car->_bulletVehicle.m_wheelInfo[i];
		if (wheel.m_raycastInfo.m_isInContact) {
			sum += wheel.m_raycastInfo.m_contactNormalWS;
			contacts++;
		}
	}
	if (contacts == 0)
		return Vec(0, 0, 1);
	float lengthSq = sum.length2() / (float)(contacts * contacts);
	if (lengthSq < 1e-8f)
		return Vec(0, 0, 0);
	return Vec(sum.normalized());
}

static void WriteVec(float* out, Vec v) {
	out[0] = v.x; out[1] = v.y; out[2] = v.z;
}

static void WriteRot(float* out, const RotMat& r) {
	WriteVec(out, r.forward); WriteVec(out + 3, r.right); WriteVec(out + 6, r.up);
}

static Vec ReadVec(const NumberArrayVal& arr, int offset) {
	return Vec(arr[offset].as<float>(), arr[offset + 1].as<float>(), arr[offset + 2].as<float>());
}

static RotMat ReadRot(const NumberArrayVal& arr, int offset) {
	return RotMat(ReadVec(arr, offset), ReadVec(arr, offset + 3), ReadVec(arr, offset + 6));
}

class Sim {
public:
	Sim() {
		_arena = Arena::Create(GameMode::SOCCAR);
		_SetCallbacks();
	}

	~Sim() { delete _arena; }

	int AddCar(int team, int carType) {
		return (int)_arena->AddCar(team ? Team::ORANGE : Team::BLUE, *CarConfigByIndex(carType))->id;
	}

	bool RemoveCar(int id) { return _arena->RemoveCar((uint32_t)id); }

	Int32ArrayVal CarIds() {
		_ints.clear();
		for (Car* car : _arena->GetCars())
			_ints.push_back((int)car->id);
		std::sort(_ints.begin(), _ints.end());
		return CopyToJS<Int32ArrayVal>("Int32Array", _ints);
	}

	void SetControls(int id, float throttle, float steer, float pitch, float yaw, float roll, bool jump, bool boost, bool handbrake) {
		Car* car = _arena->GetCar((uint32_t)id);
		if (!car)
			return;
		CarControls& c = car->controls;
		c.throttle = throttle; c.steer = steer; c.pitch = pitch; c.yaw = yaw; c.roll = roll;
		c.jump = jump; c.boost = boost; c.handbrake = handbrake;
	}

	void Step(int ticks) {
		for (int i = 0; i < ticks; i++) {
			_arena->Step(1);
			if (!_arena->IsBallScored())
				_goalReported = false; // the arena reports a goal every tick the ball is in; we report it once
		}
	}

	void ResetKickoff(int seed) {
		_arena->ResetToRandomKickoff(seed);
		_events.clear();
		_goalReported = false;
	}

	double TickCount() const { return (double)_arena->tickCount; }

	bool IsBallScored() const { return _arena->IsBallScored(); }

	Float32ArrayVal BallState() {
		RocketSim::BallState s = _arena->ball->GetState();
		_floats.assign(Layout::BALL_SIZE, 0);
		WriteVec(&_floats[Layout::BALL_POS], s.pos);
		WriteVec(&_floats[Layout::BALL_VEL], s.vel);
		WriteVec(&_floats[Layout::BALL_ANG_VEL], s.angVel);
		WriteRot(&_floats[Layout::BALL_ROT], s.rotMat);
		return CopyToJS<Float32ArrayVal>("Float32Array", _floats);
	}

	void SetBallState(NumberArrayVal arr) {
		RocketSim::BallState s;
		s.pos = ReadVec(arr, Layout::BALL_POS);
		s.vel = ReadVec(arr, Layout::BALL_VEL);
		s.angVel = ReadVec(arr, Layout::BALL_ANG_VEL);
		s.rotMat = ReadRot(arr, Layout::BALL_ROT);
		_arena->ball->SetState(s);
	}

	Float32ArrayVal CarState(int id) {
		_floats.assign(Layout::CAR_SIZE, 0);
		Car* car = _arena->GetCar((uint32_t)id);
		if (car) {
			RocketSim::CarState s = car->GetState();
			float* f = _floats.data();
			WriteVec(f + Layout::CAR_POS, s.pos);
			WriteVec(f + Layout::CAR_VEL, s.vel);
			WriteVec(f + Layout::CAR_ANG_VEL, s.angVel);
			WriteRot(f + Layout::CAR_ROT, s.rotMat);
			f[Layout::CAR_BOOST] = s.boost;
			f[Layout::CAR_ON_GROUND] = s.isOnGround;
			f[Layout::CAR_HAS_JUMPED] = s.hasJumped;
			f[Layout::CAR_HAS_DOUBLE_JUMPED] = s.hasDoubleJumped;
			f[Layout::CAR_HAS_FLIPPED] = s.hasFlipped;
			f[Layout::CAR_IS_FLIPPING] = s.isFlipping;
			f[Layout::CAR_IS_JUMPING] = s.isJumping;
			f[Layout::CAR_SUPERSONIC] = s.isSupersonic;
			f[Layout::CAR_BOOSTING] = s.isBoosting;
			f[Layout::CAR_DEMOED] = s.isDemoed;
			f[Layout::CAR_DEMO_RESPAWN_TIMER] = s.demoRespawnTimer;
			f[Layout::CAR_HANDBRAKE] = s.handbrakeVal;
			for (int i = 0; i < 4; i++)
				f[Layout::CAR_WHEEL_CONTACT + i] = s.wheelsWithContact[i];
			f[Layout::CAR_TEAM] = (float)car->team;
			f[Layout::CAR_AUTO_FLIPPING] = s.isAutoFlipping;
			f[Layout::CAR_LAST_BALL_HIT_TICK] = s.ballHitInfo.isValid ? (float)s.ballHitInfo.tickCountWhenHit : -1;
			WriteVec(f + Layout::CAR_GROUND_NORMAL, GroundNormal(car));
		}
		return CopyToJS<Float32ArrayVal>("Float32Array", _floats);
	}

	// Sets position, velocity, angular velocity, rotation and boost; flags reset to their defaults
	void SetCarState(int id, NumberArrayVal arr) {
		Car* car = _arena->GetCar((uint32_t)id);
		if (!car)
			return;
		RocketSim::CarState s;
		s.pos = ReadVec(arr, Layout::CAR_POS);
		s.vel = ReadVec(arr, Layout::CAR_VEL);
		s.angVel = ReadVec(arr, Layout::CAR_ANG_VEL);
		s.rotMat = ReadRot(arr, Layout::CAR_ROT);
		s.boost = arr[Layout::CAR_BOOST].as<float>();
		car->SetState(s);
	}

	Float32ArrayVal CarConfig(int id) {
		_floats.assign(Layout::CFG_SIZE, 0);
		Car* car = _arena->GetCar((uint32_t)id);
		if (car) {
			const RocketSim::CarConfig& c = car->config;
			float* f = _floats.data();
			WriteVec(f + Layout::CFG_HITBOX_SIZE, c.hitboxSize);
			WriteVec(f + Layout::CFG_HITBOX_OFFSET, c.hitboxPosOffset);
			WriteVec(f + Layout::CFG_FRONT_WHEEL_OFFSET, c.frontWheels.connectionPointOffset);
			f[Layout::CFG_FRONT_WHEEL_RADIUS] = c.frontWheels.wheelRadius;
			f[Layout::CFG_FRONT_SUSPENSION_REST] = c.frontWheels.suspensionRestLength;
			WriteVec(f + Layout::CFG_BACK_WHEEL_OFFSET, c.backWheels.connectionPointOffset);
			f[Layout::CFG_BACK_WHEEL_RADIUS] = c.backWheels.wheelRadius;
			f[Layout::CFG_BACK_SUSPENSION_REST] = c.backWheels.suspensionRestLength;
		}
		return CopyToJS<Float32ArrayVal>("Float32Array", _floats);
	}

	Float32ArrayVal BoostPads() {
		const auto& pads = _arena->GetBoostPads();
		_floats.assign(pads.size() * Layout::PAD_SIZE, 0);
		for (size_t i = 0; i < pads.size(); i++) {
			float* f = &_floats[i * Layout::PAD_SIZE];
			BoostPadState s = pads[i]->GetState();
			WriteVec(f + Layout::PAD_POS, pads[i]->config.pos);
			f[Layout::PAD_BIG] = pads[i]->config.isBig;
			f[Layout::PAD_ACTIVE] = s.isActive;
			f[Layout::PAD_COOLDOWN] = s.cooldown;
		}
		return CopyToJS<Float32ArrayVal>("Float32Array", _floats);
	}

	// Events since the last call: Int32Array of [type, a, b] triples
	Int32ArrayVal TakeEvents() {
		_ints = _events;
		_events.clear();
		return CopyToJS<Int32ArrayVal>("Int32Array", _ints);
	}

	// Full arena state (for rollback / replays). Returns a copy.
	Uint8ArrayVal SaveState() {
		DataStreamOut out;
		_arena->Serialize(out);
		return CopyToJS<Uint8ArrayVal>("Uint8Array", out.data);
	}

	void LoadState(Uint8ArrayVal bytes) {
		std::vector<uint8_t> data = emscripten::convertJSArrayToNumberVector<uint8_t>(bytes);
		DataStreamIn in;
		in.data.assign(data.begin(), data.end());
		Arena* loaded = Arena::DeserializeNew(in);
		delete _arena;
		_arena = loaded;
		_SetCallbacks();
		_events.clear();
	}

private:
	Arena* _arena;
	std::vector<float> _floats;
	std::vector<int> _ints;
	std::vector<int> _events;
	bool _goalReported = false;

	void _SetCallbacks() {
		_goalReported = _arena->IsBallScored();
		_arena->SetGoalScoreCallback([](Arena*, Team team, void* info) {
			Sim* sim = (Sim*)info;
			if (!sim->_goalReported)
				sim->_events.insert(sim->_events.end(), { Layout::EVENT_GOAL, (int)team, 0 });
			sim->_goalReported = true;
		}, this);
		_arena->SetCarBumpCallback([](Arena*, Car* bumper, Car* victim, bool isDemo, void* info) {
			Sim* sim = (Sim*)info;
			sim->_events.insert(sim->_events.end(), { isDemo ? Layout::EVENT_DEMO : Layout::EVENT_BUMP, (int)bumper->id, (int)victim->id });
		}, this);
	}
};

EMSCRIPTEN_BINDINGS(rlengine) {
	using namespace emscripten;
	using namespace Layout;

	register_type<Float32ArrayVal>("Float32Array");
	register_type<Int32ArrayVal>("Int32Array");
	register_type<Uint8ArrayVal>("Uint8Array");
	register_type<NumberArrayVal>("ArrayLike<number>");
	register_type<ByteArrayListVal>("Uint8Array[]");

	function("init", &InitMeshes);

	class_<Sim>("Sim")
		.constructor<>()
		.function("addCar", &Sim::AddCar)
		.function("removeCar", &Sim::RemoveCar)
		.function("carIds", &Sim::CarIds)
		.function("setControls", &Sim::SetControls)
		.function("step", &Sim::Step)
		.function("resetKickoff", &Sim::ResetKickoff)
		.function("tickCount", &Sim::TickCount)
		.function("isBallScored", &Sim::IsBallScored)
		.function("ballState", &Sim::BallState)
		.function("setBallState", &Sim::SetBallState)
		.function("carState", &Sim::CarState)
		.function("setCarState", &Sim::SetCarState)
		.function("carConfig", &Sim::CarConfig)
		.function("boostPads", &Sim::BoostPads)
		.function("takeEvents", &Sim::TakeEvents)
		.function("saveState", &Sim::SaveState)
		.function("loadState", &Sim::LoadState);

#define LAYOUT(name) constant(#name, name)
	LAYOUT(BALL_POS); LAYOUT(BALL_VEL); LAYOUT(BALL_ANG_VEL); LAYOUT(BALL_ROT); LAYOUT(BALL_SIZE);
	LAYOUT(CAR_POS); LAYOUT(CAR_VEL); LAYOUT(CAR_ANG_VEL); LAYOUT(CAR_ROT); LAYOUT(CAR_BOOST);
	LAYOUT(CAR_ON_GROUND); LAYOUT(CAR_HAS_JUMPED); LAYOUT(CAR_HAS_DOUBLE_JUMPED); LAYOUT(CAR_HAS_FLIPPED);
	LAYOUT(CAR_IS_FLIPPING); LAYOUT(CAR_IS_JUMPING); LAYOUT(CAR_SUPERSONIC); LAYOUT(CAR_BOOSTING); LAYOUT(CAR_DEMOED);
	LAYOUT(CAR_DEMO_RESPAWN_TIMER); LAYOUT(CAR_HANDBRAKE); LAYOUT(CAR_WHEEL_CONTACT); LAYOUT(CAR_TEAM);
	LAYOUT(CAR_AUTO_FLIPPING); LAYOUT(CAR_LAST_BALL_HIT_TICK); LAYOUT(CAR_GROUND_NORMAL); LAYOUT(CAR_SIZE);
	LAYOUT(PAD_POS); LAYOUT(PAD_BIG); LAYOUT(PAD_ACTIVE); LAYOUT(PAD_COOLDOWN); LAYOUT(PAD_SIZE);
	LAYOUT(EVENT_GOAL); LAYOUT(EVENT_BUMP); LAYOUT(EVENT_DEMO);
	LAYOUT(CFG_HITBOX_SIZE); LAYOUT(CFG_HITBOX_OFFSET); LAYOUT(CFG_FRONT_WHEEL_OFFSET); LAYOUT(CFG_FRONT_WHEEL_RADIUS);
	LAYOUT(CFG_FRONT_SUSPENSION_REST); LAYOUT(CFG_BACK_WHEEL_OFFSET); LAYOUT(CFG_BACK_WHEEL_RADIUS);
	LAYOUT(CFG_BACK_SUSPENSION_REST); LAYOUT(CFG_SIZE);
#undef LAYOUT
}
