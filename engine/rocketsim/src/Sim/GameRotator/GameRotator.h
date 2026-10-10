#pragma once
// RL PATCH: the game's rotators (UE3 FRotator, 65536 units a turn) as its car scripts use them: QuatToRotator
// (execQuatToRotator 0x140364b80: the quaternion's matrix, then FMatrix::Rotator 0x140385e40: atan2f, appRound) and
// GetRotatorAxis / Vector(R) / the cone's matrix (FRotationTranslationMatrix 0x140369b10: the 16384-entry sine table
// FGlobalMath::TrigFLOAT at 0x142370780, filled by 0x140374fb0 with sinf((i + i) * 3.1415927f * (1 / 16384.f)))
#include "../../Math/MathTypes/MathTypes.h"
#include <cmath>

RS_NS_START

struct GameRotator { int pitch = 0, yaw = 0, roll = 0; };

inline int UERound(float f) { return (int)lrintf(f + f + 0.5f) >> 1; } // (int)ROUND(f + f + 0.5) >> 1

inline float UESinTab(int angle) {
	static float* table = [] {
		static float t[16384];
		for (int i = 0; i < 16384; i++) {
			float a = (float)i;
			a = a + a;
			a = a * 3.1415927f;
			a = a * 6.1035156e-05f;
			t[i] = det_sinf(a);
		}
		return t;
	}();
	return table[(angle >> 2) & 0x3fff];
}

// FRotationTranslationMatrix(R): rows X (forward), Y (right), Z (up), as RotMat's forward/right/up
inline RotMat UERotationMatrix(const GameRotator& r) {
	float SR = UESinTab(r.roll), SP = UESinTab(r.pitch), SY = UESinTab(r.yaw);
	float CR = UESinTab(r.roll + 0x4000), CP = UESinTab(r.pitch + 0x4000), CY = UESinTab(r.yaw + 0x4000);
	RotMat m;
	m.forward = Vec(CY * CP, CP * SY, SP);
	m.right = Vec(SP * SR * CY - CR * SY, CY * CR + SP * SR * SY, -SR * CP);
	m.up = Vec(-(CR * SP * CY + SY * SR), CY * SR - CR * SP * SY, CP * CR);
	return m;
}

// FMatrix::Rotator() of a rotation's axes (X = forward, Y = right, Z = up)
inline GameRotator UERotatorFromMatrix(const RotMat& m) {
	const Vec &X = m.forward, &Y = m.right, &Z = m.up;
	GameRotator r;
	float yaw = det_atan2f(X.y, X.x);
	yaw = (yaw * 32768.0f) / 3.1415927f;
	float s = X.y * X.y + X.x * X.x;
	float pitch = det_atan2f(X.z, (float)sqrt((double)s));
	pitch = (pitch * 32768.0f) / 3.1415927f;
	r.pitch = UERound(pitch);
	r.yaw = UERound(yaw);
	r.roll = 0;
	Vec SYa = UERotationMatrix(r).right;
	float roll = det_atan2f(Z.y * SYa.y + Z.x * SYa.x + Z.z * SYa.z, Y.y * SYa.y + Y.x * SYa.x + Y.z * SYa.z);
	roll = (roll * 32768.0f) / 3.1415927f;
	r.roll = UERound(roll);
	return r;
}

// The axes the game's scripts see for a body rotation: Rotation(QuatToRotator(q)) through the sine table
inline RotMat GameRotatorBasis(const RotMat& m) { return UERotationMatrix(UERotatorFromMatrix(m)); }

// The cone's hitbox centre (FUN_140f11c30): the location plus the offset multiplied by the rotator matrix's rows,
// (off . X, off . Y, off . Z): the transpose of the rotation (InverseTransformNormal), not R * off
inline Vec GameConeCentre(const Vec& pos, const RotMat& rm, const Vec& off) {
	return Vec(off.y * rm.forward.y + off.x * rm.forward.x + off.z * rm.forward.z + pos.x,
	           off.y * rm.right.y + off.x * rm.right.x + off.z * rm.right.z + pos.y,
	           off.y * rm.up.y + off.x * rm.up.x + off.z * rm.up.z + pos.z);
}


RS_NS_END
