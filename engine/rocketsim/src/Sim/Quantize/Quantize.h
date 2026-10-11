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
	// An input axis as Vehicle_TA.SetVehicleInput stores it (FUN_140f30a70): a byte 128 + q with q = round(v × 127)
	// for v >= 0 and round(v × 128) below (half up), read back as q / 127 or q × (1/128). Every axis the physics
	// reads goes through this, on the server and for the local player.
	int8_t InputAxisByte(float v); // q, -128..127
	float InputAxisValue(int8_t q);
	inline float InputAxis(float v) { return InputAxisValue(InputAxisByte(v)); }

	// UE3 appRound(): floor(x + 0.5), computed the same way as the game
	int RoundUE(float x);

	// Location in uu: nearest 0.01 (FUN_140380930, scale 100)
	float Location(float x);

	// Velocity component: truncated at 1/scale, then nudged 0.1/scale away from zero (FUN_140380a00).
	// Scale 100 for linear velocity (uu/s), 10000 for angular velocity (rad/s)
	float Velocity(float v, float scale);

	// A rotation as the network sends it: the index of the dropped (largest) component and the other three in 18 bits.
	// Kept per body after each tick, because recompressing the resulting rotation matrix is not always exact.
	struct PackedRotation {
		uint8_t largest = 0;
		uint32_t c[3] = {};
		bool valid = false; // false after a state was set directly (not by a tick)
	};

	// Rotation: "smallest three" quaternion, 18 bits per component (FUN_14037bf60 / FUN_1403738b0 / FUN_140380140)
	btQuaternion Rotation(const btQuaternion& q, PackedRotation* packed = nullptr);

	// The rotation a packed rotation stands for (the decompression half of Rotation())
	btQuaternion Unpack(const PackedRotation& packed);

	// Applies all of the above to a Bullet rigid body (Bullet units are uu / 50)
	// `maxSpeed` (uu/s) and `maxAngSpeed` (rad/s): the body's caps, applied as the game's read-back does (0: none)
	void QuantizeRigidBody(btRigidBody& rb, PackedRotation* packedRotation = nullptr, float maxSpeed = 0, float maxAngSpeed = 0);

	// The velocities' part of it alone (the position and rotation already rounded: re-rounding a rotation isn't always
	// exact): a body pushed between ticks, read back as the game's next physics frame reads it (RV-231)
	void QuantizeVelocities(btRigidBody& rb, float maxSpeed, float maxAngSpeed);
}

RS_NS_END
