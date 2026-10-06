// Smoke tests of the generated arena mesh (scripts/arena_gen.py) in stock RocketSim.
//
//   git clone --depth 1 https://github.com/ZealanL/RocketSim && cmake -S RocketSim -B RocketSim/build -DCMAKE_BUILD_TYPE=Release
//   make -C RocketSim/build -j
//   g++ -O2 -std=c++20 -w -IRocketSim/src scripts/arena_smoketest.cpp RocketSim/build/libRocketSim.a -o arena_smoketest -lpthread
//   ./arena_smoketest out/arena/collision_meshes
#include "RocketSim.h"
#include <cstdio>
#include <cmath>
#include <random>
using namespace RocketSim;

static Arena* arena;
static BallState ballAt(Vec p, Vec v) { BallState s; s.pos = p; s.vel = v; return s; }

int main(int argc, char** argv) {
	RocketSim::Init(argv[1], true);
	arena = Arena::Create(GameMode::SOCCAR);

	// 1. ball shot into the goal: deepest point reached vs back of goal (y 6000)
	arena->ball->SetState(ballAt({0, 4000, 300}, {0, 3000, 0}));
	float maxY = 0, maxZ = 0;
	for (int i = 0; i < 240; i++) { arena->Step(); auto s = arena->ball->GetState(); maxY = std::max(maxY, s.pos.y); }
	printf("ball into goal: max y %.1f (back of goal 6000 -> gap %.1f)\n", maxY, 6000 - maxY);

	// 2. ball against the goal post beside the mouth: must bounce back
	arena->ball->SetState(ballAt({960, 4700, 150}, {0, 2000, 0}));
	maxY = 0;
	for (int i = 0; i < 120; i++) { arena->Step(); maxY = std::max(maxY, arena->ball->GetState().pos.y); }
	printf("ball at post: max y %.1f, final vy %.0f\n", maxY, arena->ball->GetState().vel.y);

	// 3. ball rolling up the side wall and back
	arena->ball->SetState(ballAt({2500, 0, 93.15f}, {2500, 0, 0}));
	float maxSideZ = 0, maxX = 0;
	for (int i = 0; i < 480; i++) { arena->Step(); auto s = arena->ball->GetState(); maxSideZ = std::max(maxSideZ, s.pos.z); maxX = std::max(maxX, s.pos.x); }
	printf("ball up side wall: max z %.1f, max x %.1f (wall gap %.1f)\n", maxSideZ, maxX, 4096 - maxX);

	// 4. random ball barrage: nothing may escape the arena
	std::mt19937 rng(1);
	std::uniform_real_distribution<float> U(-1, 1);
	int escapes = 0, deep = 0; float worst = -1e9;
	for (int n = 0; n < 500; n++) {
		arena->ball->SetState(ballAt({U(rng) * 3000, U(rng) * 4000, 1000 + U(rng) * 800}, {U(rng) * 6000, U(rng) * 6000, U(rng) * 6000}));
		bool esc = false, dp = false;
		for (int i = 0; i < 1200; i++) {
			arena->Step();
			Vec p = arena->ball->GetState().pos;
			// how far the ball centre is past each outer surface (negative = inside)
			float out = std::max({std::fabs(p.x) - 4096, std::fabs(p.y) - 6000, p.z - 2048, -p.z, std::fabs(p.x) + std::fabs(p.y) - 8064});
			worst = std::max(worst, out);
			if (out > 0) esc = true;
			if (out > -45) dp = true;
		}
		escapes += esc; deep += dp;
	}
	printf("ball barrage (500 balls x 10 s): %d escaped, %d came within 45 uu of the outside, closest centre-to-outside %.1f\n", escapes, deep, -worst);

	// 5. car drives into the goal: ride height on the ramp
	Car* car = arena->AddCar(Team::BLUE);
	CarState cs; cs.pos = {0, 4600, 17}; cs.rotMat = RotMat::LookAt({0, 1, 0}, {0, 0, 1}); cs.vel = {0, 600, 0};
	car->SetState(cs);
	car->controls.throttle = 0.4f;
	arena->ball->SetState(ballAt({3000, -3000, 93.15f}, {0, 0, 0}));
	printf("car into goal (y, z, z - ramp):\n");
	for (int i = 0; i < 360; i++) {
		arena->Step();
		auto s = car->GetState();
		if (i % 30 == 0) {
			float ly = s.pos.y - 5120, ramp = ly < 236 ? 0 : (ly < 640 ? 16 * (ly - 236) / 404 : 16);
			printf("   %7.1f %6.1f %6.2f  onGround %d\n", s.pos.y, s.pos.z, s.pos.z - ramp, s.isOnGround);
		}
	}

	// 6. car drives up the side wall
	cs = CarState(); cs.pos = {2800, 0, 17}; cs.rotMat = RotMat::LookAt({1, 0, 0}, {0, 0, 1}); cs.vel = {1400, 0, 0};
	car->SetState(cs);
	car->controls.throttle = 1; car->controls.boost = true;
	float carMaxZ = 0;
	for (int i = 0; i < 120; i++) { arena->Step(); carMaxZ = std::max(carMaxZ, car->GetState().pos.z); }
	auto s = car->GetState();
	printf("car up side wall: max z %.0f, now z %.0f x %.1f up (%.2f %.2f %.2f) onGround %d\n", carMaxZ, s.pos.z, s.pos.x, s.rotMat.up.x, s.rotMat.up.y, s.rotMat.up.z, s.isOnGround);

	// 7. car drives into the corner along the back wall
	cs = CarState(); cs.pos = {1500, 4900, 17}; cs.rotMat = RotMat::LookAt({1, 0, 0}, {0, 0, 1}); cs.vel = {1000, 0, 0};
	car->SetState(cs);
	car->controls.boost = false;
	bool lost = false;
	for (int i = 0; i < 360; i++) {
		arena->Step(); auto t = car->GetState();
		if (std::fabs(t.pos.x) + std::fabs(t.pos.y) > 8064 || t.pos.y > 5120) lost = true;
	}
	s = car->GetState();
	printf("car into corner: now (%.0f, %.0f, %.0f) onGround %d escaped %d\n", s.pos.x, s.pos.y, s.pos.z, s.isOnGround, lost);
	return 0;
}
