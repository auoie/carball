#pragma once

// BulletLink.h: Includes most basic bullet headers, and defines some convenient typedefs/wrappers/etc.

// Bullet v3 (https://github.com/bulletphysics/bullet3)
#include "../libsrc/bullet3-3.24/LinearMath/btVector3.h"
#include "../libsrc/bullet3-3.24/LinearMath/btMatrix3x3.h"

#include <ostream>

//  BulletPhysics Units (1m) to Unreal Units (2cm) conversion scale
#define BT_TO_UU (50.f)

// Unreal Units (2cm) to BulletPhysics Units (1m) conversion scale
#define UU_TO_BT (1.f/50.f)

// RL PATCH: every collision object has a fixed sort key (btCollisionObject user index 3). Bullet processes
// contact pairs and solves contacts in key order instead of an order that depends on the world's history,
// so a world restored from a snapshot continues exactly like the original. Static world objects are keyed
// by the order they are added in (always the same), then the ball, then cars by ID.
enum : int {
	BT_SORT_KEY_STATIC = 0,
	BT_SORT_KEY_BALL = 1 << 20,
	BT_SORT_KEY_CAR = 1 << 21,
};

// Enum values for Bullet btCollisionObject userinfo usage
enum : int {
	BT_USERINFO_NONE,

	BT_USERINFO_TYPE_CAR,
	BT_USERINFO_TYPE_BALL,
	BT_USERINFO_TYPE_DROPSHOT_TILE,
};
