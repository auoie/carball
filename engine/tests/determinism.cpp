// Determinism check: a fixed 2v2 match with scripted ball-chasing inputs, hashed every second.
// Two runs of the same build (e.g. two WebAssembly runs, or WebAssembly in different engines) must
// print identical lines. Native and WebAssembly builds differ: they use different libm
// implementations (glibc vs musl), which round sin/cos/atan differently in the last bit.
//
// Usage: determinism [collision_meshes dir] [seconds] [trace]   (trace: print every body each tick of second 1)
#include "RocketSim.h"

#include <cstdio>
#include <cstring>
#include <string>

using namespace RocketSim;

// Own generator so every platform produces the same inputs
static uint32_t rngState = 12345;
static uint32_t Next() {
	rngState ^= rngState << 13;
	rngState ^= rngState >> 17;
	rngState ^= rngState << 5;
	return rngState;
}
static float NextAxis() { return (int)(Next() % 3) - 1; } // -1, 0 or 1

struct Hasher {
	uint64_t h = 1469598103934665603ULL;
	void Add(const void* data, size_t size) {
		auto* p = (const uint8_t*)data;
		for (size_t i = 0; i < size; i++)
			h = (h ^ p[i]) * 1099511628211ULL;
	}
	void Add(Vec v) { Add(&v.x, 4); Add(&v.y, 4); Add(&v.z, 4); }
	void Add(const RotMat& r) { Add(r.forward); Add(r.right); Add(r.up); }
};

int main(int argc, char** argv) {
	std::string meshes = argc > 1 ? argv[1] : ARENA_MESH_DIR;
	int seconds = argc > 2 ? atoi(argv[2]) : 60;
	bool trace = argc > 3 && std::string(argv[3]) == "trace";
	RocketSim::Init(meshes, true);

	Arena* arena = Arena::Create(GameMode::SOCCAR);
	Car* cars[4];
	for (int i = 0; i < 4; i++)
		cars[i] = arena->AddCar(i < 2 ? Team::BLUE : Team::ORANGE, i % 2 ? CAR_CONFIG_DOMINUS : CAR_CONFIG_OCTANE);
	arena->ResetToRandomKickoff(7);

	for (int sec = 1; sec <= seconds; sec++) {
		for (int tick = 0; tick < 120; tick++) {
			if (tick % 8 == 0) { // new inputs every 8 ticks: chase the ball, with random actions
				Vec ballPos = arena->ball->GetState().pos;
				for (Car* car : cars) {
					CarState s = car->GetState();
					Vec toBall = ballPos - s.pos;
					// steer towards the ball using only + - * (no libm, so inputs match everywhere)
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
			arena->Step();
			if (trace && sec == 1) { // per-tick values of every body, to find the first divergence
				for (Car* car : cars) {
					CarState s = car->GetState();
					printf("t%03d car%u pos %.9g %.9g %.9g vel %.9g %.9g %.9g ang %.9g %.9g %.9g fwd %.9g %.9g %.9g\n",
						tick, car->id, s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z,
						s.angVel.x, s.angVel.y, s.angVel.z, s.rotMat.forward.x, s.rotMat.forward.y, s.rotMat.forward.z);
				}
			}
			if (arena->IsBallScored())
				arena->ResetToRandomKickoff((int)(Next() % 1000));
		}

		Hasher h;
		BallState b = arena->ball->GetState();
		h.Add(b.pos); h.Add(b.vel); h.Add(b.angVel); h.Add(b.rotMat);
		for (Car* car : cars) {
			CarState s = car->GetState();
			h.Add(s.pos); h.Add(s.vel); h.Add(s.angVel); h.Add(s.rotMat); h.Add(&s.boost, 4);
		}
		printf("%3d %016llx  ball %.4f %.4f %.4f\n", sec, (unsigned long long)h.h, b.pos.x, b.pos.y, b.pos.z);
	}
	return 0;
}
