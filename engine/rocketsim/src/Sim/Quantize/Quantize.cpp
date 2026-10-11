#include "Quantize.h"

#include "../../BulletLink.h"
#include "../../../libsrc/bullet3-3.24/BulletDynamics/Dynamics/btRigidBody.h"

#include <cmath>

RS_NS_START

namespace Quantize {
	int8_t InputAxisByte(float v) {
		v = RS_CLAMP(v, -1.f, 1.f);
		float f = v < 0 ? RS_MAX(v * 128.f, -128.f) : RS_MIN(v * 127.f, 127.f);
		float y = f + 128.f;
		int b = (int)nearbyintf(y + y + 0.5f) >> 1; // (cvtss2si: round half to even)
		return (int8_t)(b - 128);
	}

	float InputAxisValue(int8_t q) {
		float v = (float)q;
		return q < 0 ? v * 0.0078125f : v / 127.f;
	}

	constexpr int ROT_BITS = 18;
	constexpr int ROT_MAX = (1 << ROT_BITS) - 1;

	int RoundUE(float x) {
		// appRound: cvtss2si(x + x + 0.5) >> 1 (round half up)
		return (int)lrintf(x + x + 0.5f) >> 1;
	}

	float Location(float x) {
		constexpr float SCALE = 100.f;
		return (1.f / SCALE) * (float)RoundUE(SCALE * x);
	}

	float Velocity(float v, float scale) {
		float invScale = 1.f / scale;
		float result = invScale * (float)(int)(scale * v);
		float sign = (result > 0) ? 1.f : ((result < 0) ? -1.f : 0.f);
		return sign * (invScale * 0.1f) + result;
	}

	btQuaternion Unpack(const PackedRotation& packed) {
		int largest = packed.largest;
		float out[4];
		for (int i = 0, j = 0; i < 4; i++) {
			if (i == largest)
				continue;
			float f = (float)packed.c[j++] / (float)ROT_MAX - 0.5f;
			out[i] = (f + f) * 0.70710677f;
		}
		{
			float rest = 1.f;
			for (int i = 0; i < 4; i++)
				if (i != largest)
					rest -= out[i] * out[i];
			out[largest] = (float)sqrt((double)RS_MAX(rest, 0.f));
		}

		float lengthSq = out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3];
		if (lengthSq <= 1e-8f)
			return btQuaternion(0, 0, 0, 1);
		float invLength = 1.f / sqrtf(lengthSq);
		return btQuaternion(out[0] * invLength, out[1] * invLength, out[2] * invLength, out[3] * invLength);
	}

	btQuaternion Rotation(const btQuaternion& qIn, PackedRotation* packedOut) {
		// Normalize (identity if degenerate)
		float q[4] = { qIn.x(), qIn.y(), qIn.z(), qIn.w() };
		float lengthSq = q[1] * q[1] + q[0] * q[0] + q[2] * q[2] + q[3] * q[3];
		if (lengthSq > 1e-8f) {
			float invLength = 1.f / sqrtf(lengthSq);
			for (float& c : q)
				c *= invLength;
		} else {
			q[0] = q[1] = q[2] = 0;
			q[3] = 1;
		}

		// Index of the largest component (ties: x over y, z over w, the x/y pair over the z/w pair)
		int bestXY = (fabsf(q[0]) < fabsf(q[1])) ? 1 : 0;
		int bestZW = (fabsf(q[2]) < fabsf(q[3])) ? 3 : 2;
		int largest = (fabsf(q[bestZW]) <= fabsf(q[bestXY])) ? bestXY : bestZW;

		// Compress the other three, flipped so the dropped component is positive
		float sign = (q[largest] < 0) ? -1.f : 1.f;
		PackedRotation packed;
		packed.largest = (uint8_t)largest;
		packed.valid = true;
		for (int i = 0, j = 0; i < 4; i++) {
			if (i == largest)
				continue;
			float val = (q[i] * sign * 1.4142135f * 0.5f + 0.5f) * (float)ROT_MAX;
			packed.c[j++] = (uint32_t)RS_CLAMP(RoundUE(val), 0, ROT_MAX);
		}
		if (packedOut)
			*packedOut = packed;

		return Unpack(packed);
	}

	// RL PATCH: the game's speed cap in its read-back of the body (FUN_140eed9e0), in uu after the x50: the squared
	// length summed y, x, z; strictly over the cap, the components times the inverse square root, then times the cap
	// (left as they are at length 1, zero below 1e-8) (static analysis RS-5)
	static void CapReadBack(btVector3& v, float max) {
		if (!(max > 0))
			return;
		float x = v.x(), y = v.y(), z = v.z();
		float lengthSq = y * y + x * x + z * z;
		if (!(max * max < lengthSq))
			return;
		if (lengthSq == 1.f) {
			// (unchanged)
		} else if (lengthSq >= 1e-8f) {
			float inv = 1.f / sqrtf(lengthSq);
			x = inv * x;
			y = inv * y;
			z = inv * z;
		} else {
			x = y = z = 0;
		}
		v = btVector3(max * x, max * y, max * z);
	}

	void QuantizeVelocities(btRigidBody& rb, float maxSpeed, float maxAngSpeed) {
		int activationState = rb.getActivationState();
		if (activationState == ISLAND_SLEEPING || activationState == DISABLE_SIMULATION) {
			rb.m_linearVelocity = btVector3(0, 0, 0);
			rb.m_angularVelocity = btVector3(0, 0, 0);
		} else {
			btVector3 vel = rb.m_linearVelocity * BT_TO_UU;
			btVector3 angVel = rb.m_angularVelocity;
			CapReadBack(vel, maxSpeed);
			CapReadBack(angVel, maxAngSpeed);
			for (int i = 0; i < 3; i++) {
				vel[i] = Velocity(vel[i], 100.f);
				angVel[i] = Velocity(angVel[i], 10000.f);
			}
			rb.m_linearVelocity = vel * UU_TO_BT;
			rb.m_angularVelocity = angVel;
		}
	}

	void QuantizeRigidBody(btRigidBody& rb, PackedRotation* packedRotation, float maxSpeed, float maxAngSpeed) {
		btTransform& transform = rb.getWorldTransform();

		btVector3 pos = transform.getOrigin() * BT_TO_UU;
		for (int i = 0; i < 3; i++)
			pos[i] = Location(pos[i]);
		transform.setOrigin(pos * UU_TO_BT);

		btQuaternion rot;
		transform.getBasis().getRotation(rot);
		transform.setBasis(btMatrix3x3(Rotation(rot, packedRotation)));

		QuantizeVelocities(rb, maxSpeed, maxAngSpeed);

		// RL PATCH: no inertia refresh: the game's write-back (FUN_140f2fb50) sets the position, the rotation and the
		// velocities only, so the world inverse inertia tensor stays as the step's integration left it (from the
		// rotation before this rounding). RocketSim (and our patch 12) recomputed it here (static analysis RS-1)
	}
}

RS_NS_END
