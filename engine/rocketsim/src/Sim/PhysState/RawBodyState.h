#pragma once
#include "../../BaseInc.h"
#include "../../DataStream/DataStreamIn.h"
#include "../../DataStream/DataStreamOut.h"

#include "../../../libsrc/bullet3-3.24/BulletDynamics/Dynamics/btRigidBody.h"
#include "../Quantize/Quantize.h"

RS_NS_START

// RL PATCH: a rigid body's exact state, in Bullet units. CarState and BallState hold game units, and
// converting back (x 0.02) does not always give the same float, so snapshots carry these too: a restored
// arena then continues bit for bit like the original.
struct RawBodyState {
	float origin[3] = {}, basis[9] = {}, linVel[3] = {}, angVel[3] = {};
	int32_t activationState = 0;
	float deactivationTime = 0;
	Quantize::PackedRotation netRotation; // the rotation as last quantized (what the network sends)

	static RawBodyState From(const btRigidBody& rb, const Quantize::PackedRotation& netRotation) {
		RawBodyState s;
		s.netRotation = netRotation;
		const btTransform& t = rb.getWorldTransform();
		for (int i = 0; i < 3; i++) {
			s.origin[i] = t.getOrigin()[i];
			s.linVel[i] = rb.getLinearVelocity()[i];
			s.angVel[i] = rb.getAngularVelocity()[i];
			for (int j = 0; j < 3; j++)
				s.basis[i * 3 + j] = t.getBasis()[i][j];
		}
		s.activationState = rb.getActivationState();
		s.deactivationTime = rb.getDeactivationTime();
		return s;
	}

	void ApplyTo(btRigidBody& rb, Quantize::PackedRotation& netRotationOut) const {
		netRotationOut = netRotation;
		btTransform t;
		t.setOrigin(btVector3(origin[0], origin[1], origin[2]));
		t.setBasis(btMatrix3x3(basis[0], basis[1], basis[2], basis[3], basis[4], basis[5], basis[6], basis[7], basis[8]));
		rb.setWorldTransform(t);
		rb.setInterpolationWorldTransform(t);
		rb.setLinearVelocity(btVector3(linVel[0], linVel[1], linVel[2]));
		rb.setAngularVelocity(btVector3(angVel[0], angVel[1], angVel[2]));
		rb.setInterpolationLinearVelocity(rb.getLinearVelocity());
		rb.setInterpolationAngularVelocity(rb.getAngularVelocity());
		rb.updateInertiaTensor();
		rb.forceActivationState(activationState);
		rb.setDeactivationTime(deactivationTime);
	}

	void Serialize(DataStreamOut& out) const {
		for (float f : origin) out.Write(f);
		for (float f : basis) out.Write(f);
		for (float f : linVel) out.Write(f);
		for (float f : angVel) out.Write(f);
		out.Write(activationState);
		out.Write(deactivationTime);
		out.Write(netRotation.largest);
		for (uint32_t c : netRotation.c) out.Write(c);
		out.Write(netRotation.valid);
	}

	void Deserialize(DataStreamIn& in) {
		for (float& f : origin) in.Read(f);
		for (float& f : basis) in.Read(f);
		for (float& f : linVel) in.Read(f);
		for (float& f : angVel) in.Read(f);
		in.Read(activationState);
		in.Read(deactivationTime);
		in.Read(netRotation.largest);
		for (uint32_t& c : netRotation.c) in.Read(c);
		in.Read(netRotation.valid);
	}
};

RS_NS_END
