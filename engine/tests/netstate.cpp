// Network state check: a client arena that applies the server's state (net/NetState) must hold exactly the server's
// bodies, car state and boost pads, and then continue like the server.
//
// The compact form (what the server sends) at the same updates: a client that tracked the server exactly must be left
// exactly as it was (a right prediction isn't corrected), and the drifted one must take the server's bodies bit for
// bit (its own timers and wheel values stay: how far it then drifts is reported, as the game's client would).
//
// A server arena plays a scripted 2v2. Every `interval` ticks a client arena that drifted away (it started from the
// same snapshot but drove with other inputs) applies the server's state. Then:
//  - every car, the ball and the pads must equal the server's, bit for bit (contact points aside);
//  - both step with the same inputs for `window` ticks and must stay identical, except when bodies were touching at
//    that moment (Bullet's contact points are not sent, as in the game); those runs report how far they drift.
//
// Usage: netstate [collision_meshes dir] [seconds] [window ticks] [interval ticks]
#include "RocketSim.h"
#include "NetState.h"
#include "Sim/PhysState/RawBodyState.h"
#include "../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btCollisionDispatcher.h"
#include "../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btPersistentManifold.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace RocketSim;

static uint32_t rngState = 4242;
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

// Everything NetState carries, as bytes: each car (controls, config, state, exact body), the ball, the pads
static std::vector<uint8_t> NetVisibleState(Arena* arena) {
	DataStreamOut out;
	for (Car* car : arena->GetCars())
		car->Serialize(out);
	arena->ball->GetState().Serialize(out);
	RawBodyState::From(arena->ball->_rigidBody, arena->ball->_netRotation).Serialize(out);
	for (BoostPad* pad : arena->GetBoostPads())
		pad->GetState().Serialize(out);
	return out.data;
}

// The bodies' transforms and velocities, bit for bit (not the inverse inertia, which the compact form leaves the client's)
static bool SameBodies(Arena* a, Arena* b) {
	auto same = [](const btRigidBody& x, const btRigidBody& y) {
		const btTransform& tx = x.getWorldTransform();
		const btTransform& ty = y.getWorldTransform();
		float fx[18], fy[18];
		for (int i = 0; i < 3; i++) {
			fx[i] = tx.getOrigin()[i], fy[i] = ty.getOrigin()[i];
			fx[3 + i] = x.getLinearVelocity()[i], fy[3 + i] = y.getLinearVelocity()[i];
			fx[6 + i] = x.getAngularVelocity()[i], fy[6 + i] = y.getAngularVelocity()[i];
			for (int c = 0; c < 3; c++)
				fx[9 + 3 * i + c] = tx.getBasis()[i][c], fy[9 + 3 * i + c] = ty.getBasis()[i][c];
		}
		return memcmp(fx, fy, sizeof(fx)) == 0;
	};
	if (!same(a->ball->_rigidBody, b->ball->_rigidBody))
		return false;
	for (Car* car : a->GetCars())
		if (!same(car->_rigidBody, b->GetCar(car->id)->_rigidBody))
			return false;
	return true;
}

static bool Touching(Arena* arena) {
	auto* dispatcher = arena->_bulletWorld.getDispatcher();
	for (int i = 0; i < dispatcher->getNumManifolds(); i++)
		if (dispatcher->getManifoldByIndexInternal(i)->getNumContacts() > 0)
			return true;
	return false;
}

static float MaxPositionDifference(Arena* a, Arena* b) {
	float worst = (a->ball->GetState().pos - b->ball->GetState().pos).Length();
	for (Car* car : a->GetCars())
		worst = fmaxf(worst, (car->GetState().pos - b->GetCar(car->id)->GetState().pos).Length());
	return worst;
}

int main(int argc, char** argv) {
	std::string meshes = argc > 1 ? argv[1] : ARENA_MESH_DIR;
	int seconds = argc > 2 ? atoi(argv[2]) : 300;
	int window = argc > 3 ? atoi(argv[3]) : 120;
	int interval = argc > 4 ? atoi(argv[4]) : 37;
	RocketSim::Init(meshes, true);

	Arena* server = Arena::Create(GameMode::SOCCAR);
	for (int i = 0; i < 4; i++)
		server->AddCar(i < 2 ? Team::BLUE : Team::ORANGE, i % 2 ? CAR_CONFIG_DOMINUS : CAR_CONFIG_OCTANE);
	server->ResetToRandomKickoff(11);

	int checks = 0, exactFailures = 0, continued = 0, continuedExact = 0, touchingRuns = 0;
	size_t maxBytes = 0;
	float worstDrift = 0;
	int compactFailures = 0, compactIdentical = 0;
	size_t compactMax = 0, compactTotal = 0, compactCarsOnly = 0;
	float compactWorstDrift = 0;
	uint64_t scoredAt = 0;
	for (int tick = 0; tick < seconds * 120; tick++) {
		if (tick % 8 == 0)
			ScriptInputs(server);
		if (tick % interval != interval / 2) {
			server->Step();
			ResetAfterGoal(server, scoredAt);
			continue;
		}

		// A client that drifted: same snapshot 20 ticks ago, then its own guesses at the inputs
		checks++;
		std::vector<uint8_t> earlier = Snapshot(server);
		Arena* client = Restore(earlier);
		uint32_t savedRng = rngState;
		for (int t = 0; t < 20; t++) {
			for (Car* car : client->GetCars()) {
				car->controls = CarControls();
				car->controls.throttle = (float)(t % 3) - 1;
				car->controls.steer = 1;
			}
			client->Step();
		}
		rngState = savedRng;
		for (int t = 0; t < 20; t++) { // the server plays those 20 ticks for real
			if ((tick + t) % 8 == 0)
				ScriptInputs(server);
			server->Step();
		}
		tick += 20;

		// The server's update
		NetState::WriteOptions options;
		options.exact = true;
		for (Car* car : server->GetCars())
			options.carIds.push_back(car->id);
		DataStreamOut update;
		NetState::Write(server, update, options);

		// The compact form, onto a client that tracked the server exactly and onto the drifted one
		NetState::WriteOptions compact;
		compact.carIds = options.carIds;
		DataStreamOut compactUpdate;
		NetState::Write(server, compactUpdate, compact);
		{
			NetState::WriteOptions carsOnly;
			carsOnly.carIds = options.carIds;
			carsOnly.ball = carsOnly.boostPads = false;
			DataStreamOut out;
			NetState::Write(server, out, carsOnly);
			compactCarsOnly += out.data.size();
		}
		compactMax = std::max(compactMax, compactUpdate.data.size());
		compactTotal += compactUpdate.data.size();
		Arena* tracked = Restore(Snapshot(server));
		std::vector<uint8_t> trackedBefore = NetVisibleState(tracked);
		DataStreamIn compactIn;
		compactIn.data = compactUpdate.data;
		if (!NetState::Read(tracked, compactIn) || NetVisibleState(tracked) != trackedBefore) {
			printf("tick %d: the compact update changed a client that had the server's state\n", tick);
			compactFailures++;
		}
		delete tracked;
		Arena* drifted = Restore(Snapshot(client));
		compactIn.pos = 0;
		if (!NetState::Read(drifted, compactIn) || !SameBodies(drifted, server)) {
			printf("tick %d: after the compact update the drifted client's bodies differ from the server's\n", tick);
			compactFailures++;
		}
		maxBytes = std::max(maxBytes, update.data.size());
		DataStreamIn in;
		in.data = update.data;
		if (!NetState::Read(client, in)) {
			printf("tick %d: the update did not apply\n", tick);
			exactFailures++;
			delete client;
			delete drifted;
			continue;
		}
		if (NetVisibleState(client) != NetVisibleState(server)) {
			printf("tick %d: after the update the client's state differs from the server's\n", tick);
			exactFailures++;
		}

		// Continue side by side with the server's inputs
		bool touching = Touching(server);
		bool identical = true;
		for (int t = 0; t < window; t++) {
			if ((tick + t) % 8 == 0 && t > 0)
				ScriptInputs(server);
			for (Car* car : server->GetCars()) {
				client->GetCar(car->id)->controls = car->controls;
				drifted->GetCar(car->id)->controls = car->controls;
			}
			server->Step();
			client->Step();
			drifted->Step();
			if (identical && NetVisibleState(client) != NetVisibleState(server))
				identical = false;
		}
		continued++;
		float compactDrift = MaxPositionDifference(server, drifted);
		compactIdentical += compactDrift == 0;
		compactWorstDrift = fmaxf(compactWorstDrift, compactDrift);
		delete drifted;
		if (identical) {
			continuedExact++;
		} else {
			touchingRuns += touching;
			worstDrift = fmaxf(worstDrift, MaxPositionDifference(server, client));
			if (!touching)
				printf("tick %d: diverged without contacts at the update (drift %.3f uu)\n", tick, MaxPositionDifference(server, client));
		}
		tick += window;
		delete client;
		ResetAfterGoal(server, scoredAt);
	}

	printf("netstate: %d updates (max %zu bytes for ball + 4 cars + pads), %d not exact after applying\n", checks, maxBytes, exactFailures);
	printf("netstate: continued %d, identical for %d ticks: %d; the others had contacts at the update: %d (worst drift %.3f uu)\n",
		continued, window, continuedExact, touchingRuns, worstDrift);
	printf("netstate compact: %d updates, mean %zu bytes for ball + 4 cars + pads (max %zu), cars alone %zu bytes a car; "
		"%d failed; the drifted client after %d ticks: identical %d, worst drift %.3f uu\n",
		checks, checks ? compactTotal / checks : 0, compactMax, checks ? compactCarsOnly / checks / 4 : 0, compactFailures, window,
		compactIdentical, compactWorstDrift);
	int failures = exactFailures + compactFailures + (continued - continuedExact - touchingRuns);
	printf(failures ? "netstate: FAILED\n" : "netstate: ok\n");
	delete server;
	return failures ? 1 : 0;
}
