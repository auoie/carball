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
	constexpr uint8_t VERSION = 3; // 2: kickoff countdown; 3: the wheels' previous contacts

	struct WriteOptions {
		bool ball = true;
		std::vector<uint32_t> carIds; // cars to include
		bool boostPads = true;
	};

	void Write(RocketSim::Arena* arena, RocketSim::DataStreamOut& out, const WriteOptions& options);

	// Applies a state written by Write(). Every included car must exist in the arena. Returns false, leaving the
	// arena unchanged, when the data is malformed or names an unknown car.
	bool Read(RocketSim::Arena* arena, RocketSim::DataStreamIn& in);
}
