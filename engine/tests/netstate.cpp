// Network state check: a client arena that applies the server's state (net/NetState) must hold exactly the server's
// bodies, car state and boost pads, and then continue like the server.
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
	for (int tick = 0; tick < seconds * 120; tick++) {
		if (tick % 8 == 0)
			ScriptInputs(server);
		if (tick % interval != interval / 2) {
			server->Step();
			if (server->IsBallScored())
				{ server->ResetToRandomKickoff((int)(Next() % 1000)); server->kickoffCountdownTicks = 480; } // (with the kickoff countdown)
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
		for (Car* car : server->GetCars())
			options.carIds.push_back(car->id);
		DataStreamOut update;
		NetState::Write(server, update, options);
		maxBytes = std::max(maxBytes, update.data.size());
		DataStreamIn in;
		in.data = update.data;
		if (!NetState::Read(client, in)) {
			printf("tick %d: the update did not apply\n", tick);
			exactFailures++;
			delete client;
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
			for (Car* car : server->GetCars())
				client->GetCar(car->id)->controls = car->controls;
			server->Step();
			client->Step();
			if (identical && NetVisibleState(client) != NetVisibleState(server))
				identical = false;
		}
		continued++;
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
		if (server->IsBallScored())
			{ server->ResetToRandomKickoff((int)(Next() % 1000)); server->kickoffCountdownTicks = 480; } // (with the kickoff countdown)
	}

	printf("netstate: %d updates (max %zu bytes for ball + 4 cars + pads), %d not exact after applying\n", checks, maxBytes, exactFailures);
	printf("netstate: continued %d, identical for %d ticks: %d; the others had contacts at the update: %d (worst drift %.3f uu)\n",
		continued, window, continuedExact, touchingRuns, worstDrift);
	int failures = exactFailures + (continued - continuedExact - touchingRuns);
	printf(failures ? "netstate: FAILED\n" : "netstate: ok\n");
	delete server;
	return failures ? 1 : 0;
}
