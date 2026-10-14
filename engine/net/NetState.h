// The game state the server sends each update: the ball, some cars and the boost pads.
//
// Two forms. The compact one (COMPACT_VERSION, what the server sends: about the game's size, ~35-45 B a car) carries
// each body as the game's ReplicatedRBState (exact: the bodies were rounded to it at their last tick) and the gameplay
// state the game replicates (flags, boost, the controls, the dodge's torque, counters, the XY lock); a client lays it
// over its own state at that frame, so a client that predicted right is left exactly as it was, and one that didn't
// takes the server's bodies and those fields, keeping its own timers and wheel values (as the game's client does).
// The exact one (VERSION, ~370 B a car) carries everything: a client that applies it holds, for those bodies, the
// server's state bit for bit (the engine's netstate check). Neither has Bullet's contact points, which the client
// keeps from its own simulation (as the game does).
//
// Shared by the native server (writes) and the WebAssembly client (reads), so both sides run the same code.
#pragma once

#include "RocketSim.h"

#include <cstdint>
#include <vector>

namespace NetState {
	// 2: kickoff countdown; 3: the wheels' previous contacts; 4: the jump's release; 5: respawn spot selection, flip
	// resets, the ball exploded after a goal; 6: the bodies' spawn counters; 7: respawns held (after a goal), the
	// dodge's forward input, the goal explosion's wave, the pitch lock after a dodge that ended by landing; 8: each
	// body's world inverse inertia tensor (the game doesn't recompute it after the tick's rounding or a placement)
	constexpr uint8_t VERSION = 8;
	// 9: the compact form (above)
	constexpr uint8_t COMPACT_VERSION = 9;

	struct WriteOptions {
		bool ball = true;
		std::vector<uint32_t> carIds; // cars to include
		bool boostPads = true;
		bool exact = false; // the exact form (else the compact one)
	};

	void Write(RocketSim::Arena* arena, RocketSim::DataStreamOut& out, const WriteOptions& options);

	// Applies a state written by Write() (either form). Every included car must exist in the arena. Returns false, leaving the
	// arena unchanged, when the data is malformed or names an unknown car. `carIds`, if given, gets the cars it held.
	bool Read(RocketSim::Arena* arena, RocketSim::DataStreamIn& in, std::vector<uint32_t>* carIds = nullptr);

	// Bodies the compact form has written raw (placed since their tick: not on the network's grid), for the checks
	uint64_t CompactRawBodies();
}
