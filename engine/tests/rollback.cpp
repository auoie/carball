// Rollback check: an arena restored from a snapshot (or cloned) must continue bit for bit like the original.
// Rollback netcode depends on this: a client rewinds to a server snapshot and replays its inputs.
//
// 1. A scripted 2v2 (same inputs as tests/determinism.cpp). Every `interval` ticks it restores a snapshot into a new
//    arena, loads it into a long-lived arena (in place), clones the arena, steps all of them with the same inputs for
//    `window` ticks and compares snapshot bytes.
// 2. Scenarios with lasting contacts (ball on a roof, cars stacked, a pile, a car on its roof): a snapshot every tick,
//    then restores at each tick (new arena and in place), compared with the recording.
//
// Usage: rollback [collision_meshes dir] [seconds] [window ticks] [restore every N ticks]
#include "RocketSim.h"
#include "../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btCollisionDispatcher.h"
#include "../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btPersistentManifold.h"

#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>

using namespace RocketSim;

static uint32_t rngState = 12345;
static uint32_t Next() {
	rngState ^= rngState << 13;
	rngState ^= rngState >> 17;
	rngState ^= rngState << 5;
	return rngState;
}
static float NextAxis() { return (int)(Next() % 3) - 1; }

// A goal: the explosion's wave plays half a second, then the next kickoff, with its countdown (the wave in the
// scenario too: RV-223)
static void ResetAfterGoal(Arena* arena, uint64_t& scoredAt) {
	if (!arena->IsBallScored())
		return;
	if (scoredAt == 0)
		scoredAt = arena->tickCount;
	if (arena->tickCount >= scoredAt + 60) {
		arena->ResetToRandomKickoff((int)(Next() % 1000));
		arena->kickoffCountdownTicks = 480;
		scoredAt = 0;
	}
}

static void ScriptInputs(Arena* arena) {
	Vec ballPos = arena->ball->GetState().pos;
	for (Car* car : arena->GetCars()) {
		CarState s = car->GetState();
		Vec toBall = ballPos - s.pos;
		float side = s.rotMat.forward.x * toBall.y - s.rotMat.forward.y * toBall.x;
		CarControls& c = car->controls;
		c.throttle = (Next() % 8) ? 1.f : NextAxis();
		c.steer = (Next() % 4) ? (side > 0 ? 1.f : -1.f) : NextAxis();
		c.pitch = NextAxis();
		c.yaw = NextAxis();
		c.roll = (Next() % 4) ? 0.f : NextAxis();
		c.jump = (Next() % 10) == 0;
		c.boost = (Next() % 3) == 0;
		c.handbrake = (Next() % 12) == 0;
	}
}

static std::vector<uint8_t> Snapshot(Arena* arena) {
	DataStreamOut out;
	arena->Serialize(out);
	return out.data;
}

static Arena* Restore(const std::vector<uint8_t>& bytes) {
	DataStreamIn in;
	in.data = bytes;
	return Arena::DeserializeNew(in);
}

static bool LoadInPlace(Arena* arena, const std::vector<uint8_t>& bytes) {
	DataStreamIn in;
	in.data = bytes;
	return arena->DeserializeInPlace(in);
}

// Bodies touching each other: points in contact manifolds between cars, or between a car and the ball
static int DynamicContactPoints(Arena* arena) {
	auto* dispatcher = arena->_bulletWorld.getDispatcher();
	int points = 0;
	for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
		btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
		bool dynamic0 = m->getBody0()->getUserIndex() != -1, dynamic1 = m->getBody1()->getUserIndex() != -1;
		if (dynamic0 && dynamic1)
			points += m->getNumContacts();
	}
	return points;
}

// Names the car state fields that differ between two arenas (diagnostics)
#define CMP(field) if (memcmp(&sa.field, &sb.field, sizeof(sa.field)) != 0) printf(" " #field);
static void PrintDifference(Arena* a, Arena* b) {
	BallState ba = a->ball->GetState(), bb = b->ball->GetState();
	if (memcmp(&ba.pos, &bb.pos, sizeof(Vec)) || memcmp(&ba.vel, &bb.vel, sizeof(Vec)))
		printf("    ball differs: pos %.6g %.6g %.6g vs %.6g %.6g %.6g\n", ba.pos.x, ba.pos.y, ba.pos.z, bb.pos.x, bb.pos.y, bb.pos.z);
	for (Car* ca : a->GetCars()) {
		CarState sa = ca->GetState(), sb = b->GetCar(ca->id)->GetState();
		printf("    car%u fields:", ca->id);
		CMP(pos) CMP(rotMat) CMP(vel) CMP(angVel) CMP(isOnGround) CMP(wheelsWithContact) CMP(wheelCarry) CMP(hasJumped)
		CMP(hasDoubleJumped) CMP(hasFlipped) CMP(flipRelTorque) CMP(jumpTime) CMP(flipTime) CMP(isFlipping) CMP(isJumping)
		CMP(airTimeSinceJump) CMP(boost) CMP(timeSinceBoosted) CMP(isBoosting) CMP(boostingTime) CMP(isSupersonic)
		CMP(supersonicTime) CMP(handbrakeVal) CMP(isAutoFlipping) CMP(autoFlipTimer) CMP(autoFlipTorqueScale)
		CMP(worldContact.hasContact) CMP(worldContact.contactNormal) CMP(carContact.otherCarID)
		CMP(carContact.cooldownTimer) CMP(isDemoed) CMP(demoRespawnTimer) CMP(ballHitInfo.isValid) CMP(lastControls)
		printf("\n");
	}
	// The contact manifolds with points, by body keys (each point: distance, lifetime)
	for (Arena* arena : { a, b }) {
		auto* dispatcher = arena->_bulletWorld.getDispatcher();
		std::vector<std::string> lines;
		for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
			btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
			if (!m->getNumContacts())
				continue;
			char buf[512];
			int n = snprintf(buf, sizeof buf, "      %d-%d:", m->getBody0()->getUserIndex3(), m->getBody1()->getUserIndex3());
			for (int j = 0; j < m->getNumContacts() && n < 480; j++)
				n += snprintf(buf + n, sizeof buf - n, " %.9g/%d", m->getContactPoint(j).getDistance(),
				              m->getContactPoint(j).getLifeTime());
			lines.push_back(buf);
		}
		std::sort(lines.begin(), lines.end());
		printf("    %s contacts:\n", arena == a ? "original" : "copy");
		for (const std::string& l : lines) printf("%s\n", l.c_str());
	}
}
#undef CMP

// Scripted match: restore and clone every `interval` ticks, run `window` ticks side by side
static int CheckMatch(int seconds, int window, int interval) {
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	for (int i = 0; i < 4; i++)
		arena->AddCar(i < 2 ? Team::BLUE : Team::ORANGE, i % 2 ? CAR_CONFIG_DOMINUS : CAR_CONFIG_OCTANE);
	arena->ResetToRandomKickoff(7);

	int checks = 0, failures = 0, duringContact = 0, transientDifferences = 0;
	Arena* target = nullptr; // long-lived arena for in-place loads (its own history differs from the original's)
	uint64_t scoredAt = 0;
	for (int tick = 0; tick < seconds * 120; tick++) {
		if (tick % 8 == 0)
			ScriptInputs(arena);
		if (tick % interval != interval / 2) {
			arena->Step();
			ResetAfterGoal(arena, scoredAt);
			continue;
		}

		checks++;
		duringContact += DynamicContactPoints(arena) > 0;
		std::vector<uint8_t> snapshot = Snapshot(arena);
		Arena* restored = Restore(snapshot);
		Arena* cloned = arena->Clone(false);
		if (!target)
			target = Restore(snapshot);
		bool loaded = LoadInPlace(target, snapshot);
		// Right after loading, a snapshot can differ from the original's in contact bookkeeping the original drops
		// at its next collision pass (a manifold or pair made at the last step's start-of-tick positions that no
		// longer overlap, which a load doesn't recreate). What has to hold is the continuation: from the first
		// tick on, every copy is byte-identical to the original (the window below).
		bool ok = loaded;
		if (!ok)
			printf("match tick %d: the in-place load refused the snapshot\n", tick);
		transientDifferences += ok && (Snapshot(restored) != snapshot || Snapshot(target) != snapshot || Snapshot(cloned) != snapshot);
		Arena* copies[] = { restored, target, cloned };
		const char* names[] = { "restored", "in-place", "cloned" };
		for (int t = 0; t < window && ok; t++) {
			if ((tick + t) % 8 == 0 && t > 0)
				ScriptInputs(arena);
			for (Car* c : arena->GetCars())
				for (Arena* copy : copies)
					copy->GetCar(c->id)->controls = c->controls;
			arena->Step();
			for (Arena* copy : copies)
				copy->Step();
			std::vector<uint8_t> expected = Snapshot(arena);
			for (int k = 0; k < 3 && ok; k++) {
				if (Snapshot(copies[k]) != expected) {
					printf("match tick %d: %s arena diverged %d ticks later\n", tick, names[k], t + 1);
					PrintDifference(arena, copies[k]);
					ok = false;
				}
			}
		}
		failures += !ok;
		delete restored;
		delete cloned;
		tick += window;
		ResetAfterGoal(arena, scoredAt);
	}
	printf("match: %d restores, in-place loads and clones (%d during car-car or car-ball contact; %d differed only before "
		"the first tick), %d diverged\n", checks, duringContact, transientDifferences, failures);
	delete target;
	delete arena;
	return failures;
}

// Runs a scenario (fixed controls), recording a snapshot every tick. Then restores at each of `restores`
// consecutive ticks after `settle` and checks that the restored arena reproduces the recording for `window` ticks.
static int CheckScenario(const char* name, Arena* arena, int settle, int restores, int window) {
	arena->Step(settle);
	std::vector<std::vector<uint8_t>> recorded;
	std::vector<int> contacts;
	for (int t = 0; t < restores + window; t++) {
		recorded.push_back(Snapshot(arena));
		contacts.push_back(DynamicContactPoints(arena));
		arena->Step();
	}
	int duringContact = 0;
	Arena* target = Restore(recorded[restores / 2]); // long-lived arena for in-place loads
	for (int r = 0; r < restores; r++) {
		duringContact += contacts[r] > 0;
		Arena* copy = Restore(recorded[r]);
		bool loaded = LoadInPlace(target, recorded[r]);
		for (int t = 1; t < window; t++) {
			copy->Step();
			target->Step();
			const char* failed = Snapshot(copy) != recorded[r + t] ? "restore" :
				(!loaded || Snapshot(target) != recorded[r + t]) ? "in-place load" : nullptr;
			if (failed) {
				printf("%s: %s at tick %d diverged %d ticks later (%d contact points at the restore)\n",
					name, failed, settle + r, t, contacts[r]);
				delete copy;
				delete target;
				delete arena;
				return 1;
			}
		}
		delete copy;
	}
	delete target;
	printf("%s: %d restores and in-place loads identical for %d ticks each (%d during contact)\n",
		name, restores, window, duringContact);
	delete arena;
	return 0;
}

static CarState Placed(Vec pos, Vec forward, Vec up, Vec vel = {}) {
	CarState s;
	s.pos = pos;
	s.rotMat = RotMat(forward, up.Cross(forward), up);
	s.vel = vel;
	return s;
}

static int CheckScenarios() {
	int failures = 0;
	{ // Ball resting on a car's roof, the car creeping forward
		Arena* a = Arena::Create(GameMode::SOCCAR);
		Car* car = a->AddCar(Team::BLUE);
		car->SetState(Placed({ 0, -2000, 17.01f }, { 0, 1, 0 }, { 0, 0, 1 }));
		BallState b; b.pos = { 0, -2000, 140 }; b.vel = { 0, 0, -1 };
		a->ball->SetState(b);
		car->controls.throttle = 0.1f;
		failures += CheckScenario("ball on roof", a, 30, 40, 120);
	}
	{ // Two cars pushing nose to nose
		Arena* a = Arena::Create(GameMode::SOCCAR);
		Car* c1 = a->AddCar(Team::BLUE);
		Car* c2 = a->AddCar(Team::ORANGE);
		c1->SetState(Placed({ 0, -150, 17.01f }, { 0, 1, 0 }, { 0, 0, 1 }));
		c2->SetState(Placed({ 0, 150, 17.01f }, { 0, -1, 0 }, { 0, 0, 1 }));
		c1->controls.throttle = c2->controls.throttle = 1;
		failures += CheckScenario("cars pushing", a, 30, 40, 120);
	}
	{ // A car resting on another car's roof
		Arena* a = Arena::Create(GameMode::SOCCAR);
		Car* c1 = a->AddCar(Team::BLUE);
		Car* c2 = a->AddCar(Team::BLUE);
		c1->SetState(Placed({ 0, -1000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		c2->SetState(Placed({ 0, -1000, 75 }, { 0, 1, 0 }, { 0, 0, 1 }));
		failures += CheckScenario("car on car", a, 60, 40, 120);
	}
	{ // A pile: three cars stacked, the ball on top, a fourth car driving into it
		Arena* a = Arena::Create(GameMode::SOCCAR);
		Car* c1 = a->AddCar(Team::BLUE);
		Car* c2 = a->AddCar(Team::BLUE);
		Car* c3 = a->AddCar(Team::ORANGE);
		Car* c4 = a->AddCar(Team::ORANGE);
		c1->SetState(Placed({ 0, 1000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		c2->SetState(Placed({ 0, 1000, 75 }, { 0, 1, 0 }, { 0, 0, 1 }));
		c3->SetState(Placed({ 10, 1000, 135 }, { 1, 0, 0 }, { 0, 0, 1 }));
		c4->SetState(Placed({ -600, 1000, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }));
		c4->controls.throttle = 1;
		BallState b; b.pos = { 0, 1000, 290 }; b.vel = { 0, 0, -1 };
		a->ball->SetState(b);
		failures += CheckScenario("pile", a, 20, 120, 120);
	}
	{ // A car lying on its roof, rolling against the floor
		Arena* a = Arena::Create(GameMode::SOCCAR);
		Car* car = a->AddCar(Team::BLUE);
		car->SetState(Placed({ 0, 0, 60 }, { 1, 0, 0 }, { 0, 0, -1 }));
		car->controls.roll = 0.3f;
		failures += CheckScenario("car on roof", a, 30, 40, 120);
	}
	{ // A car driving into the side wall and up it
		Arena* a = Arena::Create(GameMode::SOCCAR);
		Car* car = a->AddCar(Team::BLUE);
		car->SetState(Placed({ 3900, 0, 17.01f }, { 1, 0, 0 }, { 0, 0, 1 }, { 500, 0, 0 }));
		car->controls.throttle = 1;
		failures += CheckScenario("car into wall", a, 30, 40, 120);
	}
	return failures;
}

// An in-place load must refuse a snapshot with different cars and leave the arena untouched
static int CheckInPlaceRejects() {
	Arena* a = Arena::Create(GameMode::SOCCAR);
	a->AddCar(Team::BLUE);
	a->AddCar(Team::ORANGE);
	Arena* b = Arena::Create(GameMode::SOCCAR);
	b->AddCar(Team::BLUE);
	b->Step(10);
	Arena* c = Arena::Create(GameMode::SOCCAR);
	c->AddCar(Team::BLUE, CAR_CONFIG_DOMINUS);
	c->AddCar(Team::ORANGE);
	std::vector<uint8_t> before = Snapshot(a);
	bool rejected = !LoadInPlace(a, Snapshot(b)) && !LoadInPlace(a, Snapshot(c)) && Snapshot(a) == before;
	printf("in-place load: %s\n", rejected ? "refuses other cars and changes nothing" : "FAILED to refuse other cars");
	delete a;
	delete b;
	delete c;
	return rejected ? 0 : 1;
}

int main(int argc, char** argv) {
	std::string meshes = argc > 1 ? argv[1] : ARENA_MESH_DIR;
	int seconds = argc > 2 ? atoi(argv[2]) : 300;
	int window = argc > 3 ? atoi(argv[3]) : 120;
	int interval = argc > 4 ? atoi(argv[4]) : 30;
	RocketSim::Init(meshes, true);

	int failures = CheckMatch(seconds, window, interval) + CheckScenarios() + CheckInPlaceRejects();
	printf(failures ? "rollback: %d FAILED\n" : "rollback: all identical\n", failures);
	return failures ? 1 : 0;
}
