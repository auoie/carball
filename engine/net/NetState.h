// The game state the server sends each update: the ball, some cars and the boost pads, encoded exactly.
// A client that applies it to its own arena then holds, for those bodies, the server's state bit for bit:
// bodies as quantized every tick (raw Bullet-unit floats and the packed rotation the network form uses), all car
// state including the wheel values carried between ticks, and the controls. Not included: Bullet's contact
// points, which the client keeps from its own simulation (as the game does).
//
// Shared by the native server (writes) and the WebAssembly client (reads), so both sides run the same code.
#pragma once

#include "RocketSim.h"

#include <cstdint>
#include <vector>

namespace NetState {
	// 2: kickoff countdown; 3: the wheels' previous contacts; 4: the jump's release; 5: respawn spot selection, flip
	// resets, the ball exploded after a goal; 6: the bodies' spawn counters; 7: respawns held (after a goal), the
	// dodge's forward input, the goal explosion's wave, the pitch lock after a dodge that ended by landing
	constexpr uint8_t VERSION = 7;

	struct WriteOptions {
		bool ball = true;
		std::vector<uint32_t> carIds; // cars to include
		bool boostPads = true;
	};

	void Write(RocketSim::Arena* arena, RocketSim::DataStreamOut& out, const WriteOptions& options);

	// Applies a state written by Write(). Every included car must exist in the arena. Returns false, leaving the
	// arena unchanged, when the data is malformed or names an unknown car. `carIds`, if given, gets the cars it held.
	bool Read(RocketSim::Arena* arena, RocketSim::DataStreamIn& in, std::vector<uint32_t>* carIds = nullptr);
}
