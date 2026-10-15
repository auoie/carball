#pragma once
#include "../Framework.h"

RS_NS_START

enum class GameMode : byte {
	SOCCAR,
	HOOPS,
	HEATSEEKER,
	SNOWDAY,
	DROPSHOT,

	// I will not add rumble unless I am given a large amount of money, or, alternatively, a large amount of candy corn (I love candy corn)

	// Soccar but without goals, boost pads, or the arena hull. The cars and ball will fall infinitely.
	THE_VOID,
};

// RL PATCH: the modes by neutral names (shipped files name no game's modes: the user's decision, 2026-10-15); a mode's
// meshes load from its name's folder: the arena's from collision_meshes/arena/, the others (unused here) have none
constexpr const char* GAMEMODE_STRS[] = {
	"arena",
	"mode 1",
	"mode 2",
	"mode 3",
	"mode 4",
	"void"
};

RS_NS_END