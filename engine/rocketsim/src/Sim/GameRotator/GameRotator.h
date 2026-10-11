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

// RL PATCH (RV-232): UE3's quaternion maths where the game's car scripts take a rotator from a quaternion
// (QuatToRotator, GetTimeOfImpact FUN_140f01930)
struct UEQuat { float x = 0, y = 0, z = 0, w = 1; };

// FQuat SlerpQuat (0x140388840): the dot ((y1y2 + x1x2) + z1z2) + w1w2; at |dot| >= 0.9999 linear (1 - t, t), else
// through acos and sin; b's weight negated when the dot is negative
inline UEQuat UESlerpQuat(const UEQuat& a, const UEQuat& b, float t) {
	float raw = a.y * b.y + a.x * b.x + a.z * b.z + a.w * b.w;
	float cosom = raw < 0 ? -raw : raw;
	float s0, s1;
	if (cosom < 0.9999f) {
		float omega = det_acosf(cosom > 1.f ? 1.f : cosom);
		float invSin = 1.f / det_sinf(omega);
		s0 = det_sinf((1.f - t) * omega) * invSin;
		s1 = det_sinf(omega * t) * invSin;
	} else {
		s0 = 1.f - t;
		s1 = t;
	}
	if (raw < 0)
		s1 = -s1;
	return { s1 * b.x + a.x * s0, s1 * b.y + a.y * s0, s1 * b.z + a.z * s0, s1 * b.w + a.w * s0 };
}

// GetTimeOfImpact's normalisation: the sum ((x2 + y2) + z2) + w2 over 1e-8 times 1 / sqrt, else the identity
inline UEQuat UENormalized(const UEQuat& q) {
	float sum = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
	if (!(sum > 1e-8f))
		return {};
	float s = 1.f / sqrtf(sum);
	return { q.x * s, s * q.y, s * q.z, s * q.w };
}

// FQuatRotationTranslationMatrix (0x14036f9c0: x2 = x + x, ...): the matrix QuatToRotator hands FMatrix::Rotator
// (Bullet's basis from a quaternion scales by 2 / |q|^2: a rotator off by a unit in about 0.05 % of cases)
inline RotMat UEQuatRotMat(const UEQuat& q) {
	float x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
	float xx = x2 * q.x, yy = y2 * q.y, zz = z2 * q.z;
	float xy = y2 * q.x, xz = z2 * q.x, yz = z2 * q.y;
	float wx = x2 * q.w, wy = y2 * q.w, wz = z2 * q.w;
	RotMat m;
	m.forward = Vec(1.f - (zz + yy), wz + xy, xz - wy);
	m.right = Vec(xy - wz, 1.f - (zz + xx), wx + yz);
	m.up = Vec(wy + xz, yz - wx, 1.f - (yy + xx));
	return m;
}

// The cone's hitbox centre (FUN_140f11c30): the location plus the offset multiplied by the rotator matrix's rows,
// (off . X, off . Y, off . Z): the transpose of the rotation (InverseTransformNormal), not R * off
inline Vec GameConeCentre(const Vec& pos, const RotMat& rm, const Vec& off) {
	return Vec(off.y * rm.forward.y + off.x * rm.forward.x + off.z * rm.forward.z + pos.x,
	           off.y * rm.right.y + off.x * rm.right.x + off.z * rm.right.z + pos.y,
	           off.y * rm.up.y + off.x * rm.up.x + off.z * rm.up.z + pos.z);
}


RS_NS_END
