#include "rlengine.h"

#include "NetState.h"
#include "RocketSim.h"

#include <algorithm>
#include <cstring>
#include <vector>

using namespace RocketSim;

struct RLArena {
	Arena* arena;
	std::vector<int32_t> events;
	bool goalReported = false;
};

static const CarConfig* BODIES[] = {
	&CAR_CONFIG_OCTANE, &CAR_CONFIG_DOMINUS, &CAR_CONFIG_PLANK, &CAR_CONFIG_BREAKOUT, &CAR_CONFIG_HYBRID, &CAR_CONFIG_MERC,
};

static size_t CopyOut(const std::vector<uint8_t>& data, uint8_t* out, size_t capacity) {
	if (out && data.size() <= capacity)
		memcpy(out, data.data(), data.size());
	return data.size();
}

extern "C" {

int rl_init(const char* collision_mesh_dir) {
	RocketSim::Init(collision_mesh_dir, true);
	return 1;
}

static void SetCallbacks(RLArena* a) {
	a->goalReported = a->arena->IsBallScored();
	a->arena->SetGoalScoreCallback([](Arena*, Team team, void* info) {
		RLArena* a = (RLArena*)info;
		if (!a->goalReported) // the arena reports a goal every tick the ball is in; report it once
			a->events.insert(a->events.end(), { RL_EVENT_GOAL, (int32_t)team, 0 });
		a->goalReported = true;
	}, a);
	a->arena->SetCarBumpCallback([](Arena*, Car* bumper, Car* victim, bool isDemo, void* info) {
		RLArena* a = (RLArena*)info;
		a->events.insert(a->events.end(), { isDemo ? RL_EVENT_DEMO : RL_EVENT_BUMP, (int32_t)bumper->id, (int32_t)victim->id });
	}, a);
}

RLArena* rl_arena_create(void) {
	RLArena* a = new RLArena();
	a->arena = Arena::Create(GameMode::SOCCAR);
	SetCallbacks(a);
	return a;
}

void rl_arena_destroy(RLArena* a) {
	if (!a)
		return;
	delete a->arena;
	delete a;
}

uint32_t rl_add_car(RLArena* a, int team, int body) {
	if (body < 0 || body >= (int)(sizeof(BODIES) / sizeof(BODIES[0])))
		body = 0;
	return a->arena->AddCar(team == 1 ? Team::ORANGE : Team::BLUE, *BODIES[body])->id;
}

int rl_remove_car(RLArena* a, uint32_t id) { return a->arena->RemoveCar(id) ? 1 : 0; }

void rl_set_controls(RLArena* a, uint32_t id, const RLControls* c) {
	Car* car = a->arena->GetCar(id);
	if (!car || !c)
		return;
	CarControls& out = car->controls;
	out.throttle = c->throttle; out.steer = c->steer; out.pitch = c->pitch; out.yaw = c->yaw; out.roll = c->roll;
	out.jump = c->jump; out.boost = c->boost; out.handbrake = c->handbrake; out.airPitchSafety = c->air_pitch_safety;
	out.dodgeForward = c->dodge_forward; out.hasDodgeForward = c->has_dodge_forward != 0;
}

void rl_set_car_preferences(RLArena* a, uint32_t id, float dodge, float steer, float air) {
	Car* car = a->arena->GetCar(id);
	if (!car)
		return;
	car->config.dodgeDeadzone = dodge;
	car->config.steeringSensitivity = steer;
	car->config.airControlSensitivity = air;
}

void rl_step(RLArena* a, int ticks) {
	for (int i = 0; i < ticks; i++) {
		a->arena->Step(1);
		if (!a->arena->IsBallScored())
			a->goalReported = false;
	}
}

void rl_reset_kickoff(RLArena* a, int seed) {
	a->arena->ResetToRandomKickoff(seed);
	a->goalReported = false;
}

void rl_start_match(RLArena* a, int seed, int team_size) { a->arena->StartKickoffSequence(seed, team_size); }

void rl_next_kickoff(RLArena* a) {
	a->arena->ResetToNextKickoff();
	a->goalReported = false;
}

void rl_redo_kickoff(RLArena* a) {
	a->arena->RedoKickoff();
	a->goalReported = false;
}

int64_t rl_last_ball_touch_tick(RLArena* a) {
	int64_t last = -1;
	for (Car* car : a->arena->GetCars()) {
		const BallHitInfo& hit = car->_internalState.ballHitInfo;
		if (hit.isValid) // (stamped during the tick, before the count steps: as rl_tick_count after it)
			last = std::max(last, (int64_t)hit.tickCountWhenHit + 1);
	}
	return last;
}

int rl_ball_on_ground(RLArena* a) {
	btRigidBody* ball = &a->arena->ball->_rigidBody;
	if (ball->getActivationState() == ISLAND_SLEEPING)
		return 1;
	btCollisionDispatcher* dispatcher = a->arena->_bulletWorld.getDispatcher();
	for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
		btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
		bool ballIs0 = m->getBody0() == ball, ballIs1 = m->getBody1() == ball;
		const btCollisionObject* other = ballIs0 ? m->getBody1() : m->getBody0();
		if ((!ballIs0 && !ballIs1) || !other->isStaticObject())
			continue;
		for (int j = 0; j < m->getNumContacts(); j++) {
			const btManifoldPoint& p = m->getContactPoint(j);
			// (the normal on body 1, pointing to body 0: up from the ground when the ball is body 0)
			float up = ballIs0 ? p.m_normalWorldOnB.z() : -p.m_normalWorldOnB.z();
			if (p.getDistance() <= 0.02f && up > 0.96f)
				return 1;
		}
	}
	return 0;
}

void rl_set_ball(RLArena* a, const float pos[3], const float vel[3]) {
	BallState s;
	s.pos = Vec(pos[0], pos[1], pos[2]);
	s.vel = Vec(vel[0], vel[1], vel[2]);
	s.spawnCount = a->arena->ball->_internalState.spawnCount + 1;
	a->arena->ball->SetState(s);
}

void rl_reset_ball(RLArena* a) {
	BallState s;
	s.pos.z = RLConst::BALL_KICKOFF_Z;
	s.spawnCount = a->arena->ball->_internalState.spawnCount + 1;
	a->arena->ball->SetState(s);
	a->goalReported = false;
}

void rl_set_kickoff_countdown(RLArena* a, uint32_t ticks) { a->arena->kickoffCountdownTicks = ticks; }
void rl_set_respawns_held(RLArena* a, int held) { a->arena->respawnsHeld = held != 0; }
uint32_t rl_kickoff_countdown(const RLArena* a) { return a->arena->kickoffCountdownTicks; }

uint64_t rl_tick_count(const RLArena* a) { return a->arena->tickCount; }

int rl_is_ball_scored(RLArena* a) { return a->arena->IsBallScored() ? 1 : 0; }

void rl_ball_position(RLArena* a, float out[3]) {
	Vec p = a->arena->ball->GetState().pos;
	out[0] = p.x; out[1] = p.y; out[2] = p.z;
}

int rl_car_position(RLArena* a, uint32_t id, float out[3]) {
	Car* car = a->arena->GetCar(id);
	if (!car)
		return 0;
	Vec p = car->GetState().pos;
	out[0] = p.x; out[1] = p.y; out[2] = p.z;
	return 1;
}

size_t rl_take_events(RLArena* a, int32_t* out, size_t max_ints) {
	size_t n = a->events.size() < max_ints ? a->events.size() : max_ints;
	n -= n % 3;
	if (out)
		memcpy(out, a->events.data(), n * sizeof(int32_t));
	a->events.erase(a->events.begin(), a->events.begin() + n);
	return n;
}

size_t rl_write_net_state(RLArena* a, int ball, const uint32_t* ids, size_t num, int pads, uint8_t* out, size_t capacity) {
	NetState::WriteOptions options;
	options.ball = ball != 0;
	options.boostPads = pads != 0;
	for (size_t i = 0; i < num; i++)
		if (a->arena->GetCar(ids[i]))
			options.carIds.push_back(ids[i]);
	DataStreamOut data;
	NetState::Write(a->arena, data, options);
	return CopyOut(data.data, out, capacity);
}

size_t rl_save_state(RLArena* a, uint8_t* out, size_t capacity) {
	DataStreamOut data;
	a->arena->Serialize(data);
	return CopyOut(data.data, out, capacity);
}

int rl_load_state(RLArena* a, const uint8_t* data, size_t size) {
	if (!data || size == 0)
		return 0;
	DataStreamIn in;
	in.data.assign(data, data + size);
	if (!a->arena->DeserializeInPlace(in)) {
		Arena* loaded = Arena::DeserializeNew(in);
		if (!loaded)
			return 0;
		delete a->arena;
		a->arena = loaded;
	}
	a->events.clear();
	SetCallbacks(a);
	return 1;
}

int rl_apply_net_state(RLArena* a, const uint8_t* data, size_t size) {
	if (!data || size == 0)
		return 0;
	DataStreamIn in;
	in.data.assign(data, data + size);
	return NetState::Read(a->arena, in) ? 1 : 0;
}

size_t rl_car_ids(RLArena* a, uint32_t* out, size_t max_ids) {
	size_t n = 0;
	for (Car* car : a->arena->GetCars()) {
		if (out && n < max_ids)
			out[n] = car->id;
		n++;
	}
	return n;
}

} // extern "C"
