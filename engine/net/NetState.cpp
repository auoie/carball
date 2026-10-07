#include "NetState.h"

#include "Sim/PhysState/RawBodyState.h"

#include <cstring>

using namespace RocketSim;

namespace NetState {

// Tick counts differ between arenas (the client numbers its own frames), so ticks travel as ages
constexpr uint64_t NEVER = ~0ULL;
constexpr int64_t NEVER_AGE = INT64_MIN;

static int64_t Age(const Arena* arena, uint64_t tick) {
	return tick == NEVER ? NEVER_AGE : (int64_t)(arena->tickCount - tick);
}
static uint64_t FromAge(const Arena* arena, int64_t age) {
	return age == NEVER_AGE ? NEVER : (uint64_t)((int64_t)arena->tickCount - age);
}

static void WriteVec(DataStreamOut& out, const Vec& v) { out.Write(v.x); out.Write(v.y); out.Write(v.z); }
static void ReadVec(DataStreamIn& in, Vec& v) { in.Read(v.x); in.Read(v.y); in.Read(v.z); }

// --- bodies --------------------------------------------------------------------------------------------------

struct Body {
	float origin[3], linVel[3], angVel[3];
	Quantize::PackedRotation rotation; // when valid; otherwise the raw basis
	float basis[9];
	uint8_t activationState;
	float deactivationTime;
};

static void WriteBody(DataStreamOut& out, const btRigidBody& rb, const Quantize::PackedRotation& rotation) {
	const btTransform& t = rb.getWorldTransform();
	out.Write<uint8_t>(rotation.valid ? 1 : 0);
	for (int i = 0; i < 3; i++) out.Write((float)t.getOrigin()[i]);
	for (int i = 0; i < 3; i++) out.Write((float)rb.getLinearVelocity()[i]);
	for (int i = 0; i < 3; i++) out.Write((float)rb.getAngularVelocity()[i]);
	if (rotation.valid) {
		// 2 bits for the dropped component, 3 x 18 bits: 7 bytes
		uint64_t packed = (uint64_t)rotation.largest | ((uint64_t)rotation.c[0] << 2) | ((uint64_t)rotation.c[1] << 20) |
			((uint64_t)rotation.c[2] << 38);
		for (int i = 0; i < 7; i++) out.Write<uint8_t>((uint8_t)(packed >> (8 * i)));
	} else {
		for (int r = 0; r < 3; r++)
			for (int c = 0; c < 3; c++) out.Write((float)t.getBasis()[r][c]);
	}
	out.Write<uint8_t>((uint8_t)rb.getActivationState());
	out.Write((float)rb.getDeactivationTime());
}

static void ReadBody(DataStreamIn& in, Body& b) {
	uint8_t packedValid = in.Read<uint8_t>();
	for (float& f : b.origin) in.Read(f);
	for (float& f : b.linVel) in.Read(f);
	for (float& f : b.angVel) in.Read(f);
	b.rotation = {};
	if (packedValid) {
		uint64_t packed = 0;
		for (int i = 0; i < 7; i++) packed |= (uint64_t)in.Read<uint8_t>() << (8 * i);
		b.rotation.largest = (uint8_t)(packed & 3);
		b.rotation.c[0] = (uint32_t)((packed >> 2) & 0x3FFFF);
		b.rotation.c[1] = (uint32_t)((packed >> 20) & 0x3FFFF);
		b.rotation.c[2] = (uint32_t)((packed >> 38) & 0x3FFFF);
		b.rotation.valid = true;
	} else {
		for (float& f : b.basis) in.Read(f);
	}
	in.Read(b.activationState);
	in.Read(b.deactivationTime);
}

static void ApplyBody(const Body& b, btRigidBody& rb, Quantize::PackedRotation& netRotation) {
	btTransform t;
	t.setOrigin(btVector3(b.origin[0], b.origin[1], b.origin[2]));
	if (b.rotation.valid)
		t.setBasis(btMatrix3x3(Quantize::Unpack(b.rotation))); // exactly how the tick that quantized it built it
	else
		t.setBasis(btMatrix3x3(b.basis[0], b.basis[1], b.basis[2], b.basis[3], b.basis[4], b.basis[5], b.basis[6], b.basis[7], b.basis[8]));
	rb.setWorldTransform(t);
	rb.setInterpolationWorldTransform(t);
	rb.setLinearVelocity(btVector3(b.linVel[0], b.linVel[1], b.linVel[2]));
	rb.setAngularVelocity(btVector3(b.angVel[0], b.angVel[1], b.angVel[2]));
	rb.setInterpolationLinearVelocity(rb.getLinearVelocity());
	rb.setInterpolationAngularVelocity(rb.getAngularVelocity());
	rb.updateInertiaTensor();
	rb.forceActivationState(b.activationState);
	rb.setDeactivationTime(b.deactivationTime);
	netRotation = b.rotation;
}

// --- cars --------------------------------------------------------------------------------------------------

struct CarData {
	uint32_t id;
	Body body;
	CarState state; // gameplay fields only (body fields come from `body`)
	CarControls controls;
};

static void WriteControls(DataStreamOut& out, const CarControls& c) {
	out.Write(c.throttle); out.Write(c.steer); out.Write(c.pitch); out.Write(c.yaw); out.Write(c.roll);
}
static void ReadControls(DataStreamIn& in, CarControls& c) {
	in.Read(c.throttle); in.Read(c.steer); in.Read(c.pitch); in.Read(c.yaw); in.Read(c.roll);
}

static void WriteCar(Arena* arena, DataStreamOut& out, Car* car) {
	CarState s = car->GetState();
	const CarControls& c = car->controls;
	out.Write(car->id);
	WriteBody(out, car->_rigidBody, car->_netRotation);

	bool bits[] = {
		s.isOnGround, s.wheelsWithContact[0], s.wheelsWithContact[1], s.wheelsWithContact[2], s.wheelsWithContact[3],
		s.hasJumped, s.hasDoubleJumped, s.hasFlipped, s.isFlipping, s.isJumping, s.isBoosting, s.isSupersonic,
		s.isAutoFlipping, s.worldContact.hasContact, s.isDemoed, s.ballHitInfo.isValid,
		c.jump, c.boost, c.handbrake, c.airPitchSafety,
		s.lastControls.jump, s.lastControls.boost, s.lastControls.handbrake, s.lastControls.airPitchSafety,
	};
	uint32_t flags = 0;
	for (int i = 0; i < (int)(sizeof(bits) / sizeof(bits[0])); i++)
		flags |= (uint32_t)bits[i] << i;
	out.Write(flags);

	WriteVec(out, s.flipRelTorque);
	for (float f : { s.jumpTime, s.flipTime, s.airTime, s.airTimeSinceJump, s.boost, s.timeSinceBoosted, s.boostingTime,
		s.supersonicTime, s.handbrakeVal, s.autoFlipTimer, s.autoFlipTorqueScale, s.carContact.cooldownTimer, s.demoRespawnTimer })
		out.Write(f);
	WriteVec(out, s.worldContact.contactNormal);
	out.Write(s.carContact.otherCarID);
	WriteControls(out, c);
	WriteControls(out, s.lastControls);
	for (const CarState::WheelCarry& w : s.wheelCarry.wheels)
		for (float f : { w.steerAngle, w.engineForce, w.brake, w.latFriction, w.longFriction, w.extraPushback })
			out.Write(f);
	if (s.ballHitInfo.isValid) {
		WriteVec(out, s.ballHitInfo.relativePosOnBall);
		WriteVec(out, s.ballHitInfo.ballPos);
		WriteVec(out, s.ballHitInfo.extraHitVel);
		out.Write(Age(arena, s.ballHitInfo.tickCountWhenHit));
		out.Write(Age(arena, s.ballHitInfo.tickCountWhenExtraImpulseApplied));
	}
}

static void ReadCar(Arena* arena, DataStreamIn& in, CarData& d) {
	in.Read(d.id);
	ReadBody(in, d.body);
	CarState& s = d.state;
	CarControls& c = d.controls;
	uint32_t flags = in.Read<uint32_t>();
	bool* bits[] = {
		&s.isOnGround, &s.wheelsWithContact[0], &s.wheelsWithContact[1], &s.wheelsWithContact[2], &s.wheelsWithContact[3],
		&s.hasJumped, &s.hasDoubleJumped, &s.hasFlipped, &s.isFlipping, &s.isJumping, &s.isBoosting, &s.isSupersonic,
		&s.isAutoFlipping, &s.worldContact.hasContact, &s.isDemoed, &s.ballHitInfo.isValid,
		&c.jump, &c.boost, &c.handbrake, &c.airPitchSafety,
		&s.lastControls.jump, &s.lastControls.boost, &s.lastControls.handbrake, &s.lastControls.airPitchSafety,
	};
	for (int i = 0; i < (int)(sizeof(bits) / sizeof(bits[0])); i++)
		*bits[i] = (flags >> i) & 1;

	ReadVec(in, s.flipRelTorque);
	for (float* f : { &s.jumpTime, &s.flipTime, &s.airTime, &s.airTimeSinceJump, &s.boost, &s.timeSinceBoosted, &s.boostingTime,
		&s.supersonicTime, &s.handbrakeVal, &s.autoFlipTimer, &s.autoFlipTorqueScale, &s.carContact.cooldownTimer, &s.demoRespawnTimer })
		in.Read(*f);
	ReadVec(in, s.worldContact.contactNormal);
	in.Read(s.carContact.otherCarID);
	ReadControls(in, c);
	ReadControls(in, s.lastControls);
	for (CarState::WheelCarry& w : s.wheelCarry.wheels)
		for (float* f : { &w.steerAngle, &w.engineForce, &w.brake, &w.latFriction, &w.longFriction, &w.extraPushback })
			in.Read(*f);
	if (s.ballHitInfo.isValid) {
		ReadVec(in, s.ballHitInfo.relativePosOnBall);
		ReadVec(in, s.ballHitInfo.ballPos);
		ReadVec(in, s.ballHitInfo.extraHitVel);
		s.ballHitInfo.tickCountWhenHit = FromAge(arena, in.Read<int64_t>());
		s.ballHitInfo.tickCountWhenExtraImpulseApplied = FromAge(arena, in.Read<int64_t>());
	}
}

static void ApplyCar(const CarData& d, Car* car) {
	CarState s = d.state;
	ApplyBody(d.body, car->_rigidBody, car->_netRotation);
	const btTransform& t = car->_rigidBody.getWorldTransform();
	s.pos = t.getOrigin() * BT_TO_UU;
	s.rotMat = t.getBasis();
	s.vel = car->_rigidBody.getLinearVelocity() * BT_TO_UU;
	s.angVel = car->_rigidBody.getAngularVelocity();
	s.tickCountSinceUpdate = car->_internalState.tickCountSinceUpdate;
	for (int i = 0; i < car->_bulletVehicle.m_wheelInfo.size() && i < 4; i++) {
		btWheelInfoRL& wheel = car->_bulletVehicle.m_wheelInfo[i];
		const CarState::WheelCarry& w = s.wheelCarry.wheels[i];
		wheel.m_steerAngle = w.steerAngle;
		wheel.m_engineForce = w.engineForce;
		wheel.m_brake = w.brake;
		wheel.m_latFriction = w.latFriction;
		wheel.m_longFriction = w.longFriction;
		wheel.m_extraPushback = w.extraPushback;
	}
	car->_internalState = s;
	car->_velocityImpulseCache = { 0, 0, 0 };
	car->controls = d.controls;
}

// --- the update ----------------------------------------------------------------------------------------------

enum : uint8_t { HAS_BALL = 1, HAS_PADS = 2 };

void Write(Arena* arena, DataStreamOut& out, const WriteOptions& options) {
	out.Write(VERSION);
	out.Write<uint8_t>((options.ball ? HAS_BALL : 0) | (options.boostPads ? HAS_PADS : 0));
	out.Write<uint16_t>((uint16_t)RS_MIN(arena->kickoffCountdownTicks, 65535u));

	if (options.ball) {
		Ball* ball = arena->ball;
		WriteBody(out, ball->_rigidBody, ball->_netRotation);
		const BallState& s = ball->_internalState;
		for (float f : { s.hsInfo.yTargetDir, s.hsInfo.curTargetSpeed, s.hsInfo.timeSinceHit, s.dsInfo.accumulatedHitForce, s.dsInfo.yTargetDir })
			out.Write(f);
		out.Write<int32_t>(s.dsInfo.chargeLevel);
		out.Write<uint8_t>(s.dsInfo.hasDamaged);
		out.Write(Age(arena, s.dsInfo.lastDamageTick));
	}

	out.Write<uint8_t>((uint8_t)options.carIds.size());
	for (uint32_t id : options.carIds)
		WriteCar(arena, out, arena->GetCar(id));

	if (options.boostPads) {
		const auto& pads = arena->GetBoostPads();
		out.Write<uint8_t>((uint8_t)pads.size());
		for (BoostPad* pad : pads) {
			BoostPadState s = pad->GetState();
			out.Write<uint8_t>(s.isActive);
			if (!s.isActive)
				out.Write(s.cooldown);
			out.Write(s.prevLockedCarID);
		}
	}
}

bool Read(Arena* arena, DataStreamIn& in) {
	if (in.Read<uint8_t>() != VERSION)
		return false;
	uint8_t has = in.Read<uint8_t>();
	uint16_t countdown = in.Read<uint16_t>();

	Body ballBody{};
	BallState ballState = arena->ball->_internalState;
	if (has & HAS_BALL) {
		ReadBody(in, ballBody);
		for (float* f : { &ballState.hsInfo.yTargetDir, &ballState.hsInfo.curTargetSpeed, &ballState.hsInfo.timeSinceHit,
			&ballState.dsInfo.accumulatedHitForce, &ballState.dsInfo.yTargetDir })
			in.Read(*f);
		ballState.dsInfo.chargeLevel = in.Read<int32_t>();
		ballState.dsInfo.hasDamaged = in.Read<uint8_t>() != 0;
		ballState.dsInfo.lastDamageTick = FromAge(arena, in.Read<int64_t>());
	}

	std::vector<CarData> cars(in.Read<uint8_t>());
	for (CarData& d : cars) {
		ReadCar(arena, in, d);
		if (in.IsOverflown() || !arena->GetCar(d.id))
			return false;
	}

	struct Pad { bool active; float cooldown; uint32_t prevLockedCarID; };
	std::vector<Pad> pads;
	if (has & HAS_PADS) {
		pads.resize(in.Read<uint8_t>());
		if (pads.size() != arena->GetBoostPads().size())
			return false;
		for (Pad& p : pads) {
			p.active = in.Read<uint8_t>() != 0;
			p.cooldown = p.active ? 0.f : in.Read<float>();
			in.Read(p.prevLockedCarID);
		}
	}
	if (in.IsOverflown())
		return false;

	// Everything parsed: apply
	arena->kickoffCountdownTicks = countdown;
	if (has & HAS_BALL) {
		Ball* ball = arena->ball;
		ApplyBody(ballBody, ball->_rigidBody, ball->_netRotation);
		ballState.pos = ball->_rigidBody.getWorldTransform().getOrigin() * BT_TO_UU;
		ballState.rotMat = ball->_rigidBody.getWorldTransform().getBasis();
		ballState.vel = ball->_rigidBody.getLinearVelocity() * BT_TO_UU;
		ballState.angVel = ball->_rigidBody.getAngularVelocity();
		ball->_internalState = ballState;
		ball->_velocityImpulseCache = { 0, 0, 0 };
	}
	for (const CarData& d : cars)
		ApplyCar(d, arena->GetCar(d.id));
	for (size_t i = 0; i < pads.size(); i++) {
		BoostPadState s = arena->GetBoostPads()[i]->GetState();
		s.isActive = pads[i].active;
		s.cooldown = pads[i].cooldown;
		s.prevLockedCarID = pads[i].prevLockedCarID;
		s.curLockedCar = nullptr;
		arena->GetBoostPads()[i]->SetState(s);
	}
	return true;
}

} // namespace NetState
