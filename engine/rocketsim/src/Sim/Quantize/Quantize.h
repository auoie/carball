#pragma once
#include "../../BaseInc.h"

class btRigidBody;
class btQuaternion;

RS_NS_START

// RL PATCH: Rocket League's per-tick physics state quantization (PhysicsConfig_TA.bQuantizePhysics).
// After every physics tick each body's state goes through the network serializer and back
// (FUN_140eed9e0 -> FUN_140e45c10 -> FUN_140e3e960), so the simulation only ever continues from
// states a client could receive exactly.
namespace Quantize {
	// UE3 appRound(): floor(x + 0.5), computed the same way as the game
	int RoundUE(float x);

	// Location in uu: nearest 0.01 (FUN_140380930, scale 100)
	float Location(float x);

	// Velocity component: truncated at 1/scale, then nudged 0.1/scale away from zero (FUN_140380a00).
	// Scale 100 for linear velocity (uu/s), 10000 for angular velocity (rad/s)
	float Velocity(float v, float scale);

	// Rotation: "smallest three" quaternion, 18 bits per component (FUN_14037bf60 / FUN_1403738b0 / FUN_140380140)
	btQuaternion Rotation(const btQuaternion& q);

	// Applies all of the above to a Bullet rigid body (Bullet units are uu / 50)
	void QuantizeRigidBody(btRigidBody& rb);
}

RS_NS_END
