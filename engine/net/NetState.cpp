#include "NetState.h"

#include "Sim/PhysState/RawBodyState.h"

#include <algorithm>
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
	float invInertia[9]; // the world inverse inertia tensor as it is (not recomputed from the rotation: see Quantize)
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
	for (int r = 0; r < 3; r++)
		for (int c = 0; c < 3; c++) out.Write((float)rb.m_invInertiaTensorWorld[r][c]);
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
	for (float& f : b.invInertia) in.Read(f);
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
	const float* m = b.invInertia;
	rb.m_invInertiaTensorWorld = btMatrix3x3(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
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
	out.Write<uint8_t>(c.hasDodgeForward);
	if (c.hasDodgeForward)
		out.Write(c.dodgeForward);
}
static void ReadControls(DataStreamIn& in, CarControls& c) {
	in.Read(c.throttle); in.Read(c.steer); in.Read(c.pitch); in.Read(c.yaw); in.Read(c.roll);
	c.hasDodgeForward = in.Read<uint8_t>() != 0;
	c.dodgeForward = 0;
	if (c.hasDodgeForward)
		in.Read(c.dodgeForward);
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
		s.wheelCarry.wheels[0].worldContact, s.wheelCarry.wheels[1].worldContact, s.wheelCarry.wheels[2].worldContact,
		s.wheelCarry.wheels[3].worldContact, s.jumpReleased, s.prespawnSet,
	};
	uint32_t flags = 0;
	for (int i = 0; i < (int)(sizeof(bits) / sizeof(bits[0])); i++)
		flags |= (uint32_t)bits[i] << i;
	out.Write(flags);

	WriteVec(out, s.flipRelTorque);
	for (float f : { s.jumpTime, s.flipTime, s.airTime, s.airTimeSinceJump, s.boost, s.timeSinceBoosted, s.boostingTime,
		s.supersonicTime, s.handbrakeVal, s.autoFlipTimer, s.autoFlipTorqueScale, s.carContact.cooldownTimer, s.demoRespawnTimer,
		s.dodgePitchLockTime })
		out.Write(f);
	WriteVec(out, s.worldContact.contactNormal);
	out.Write(s.carContact.otherCarID);
	WriteControls(out, c);
	WriteControls(out, s.lastControls);
	for (const CarState::WheelCarry& w : s.wheelCarry.wheels)
		for (float f : { w.steerAngle, w.engineForce, w.brake, w.latFriction, w.longFriction, w.extraPushback })
			out.Write(f);
	for (int i = 0; i < 4; i++) // (only touching wheels' normals are used)
		if (s.wheelsWithContact[i])
			WriteVec(out, s.wheelCarry.wheels[i].contactNormal);
	if (s.ballHitInfo.isValid) {
		WriteVec(out, s.ballHitInfo.relativePosOnBall);
		WriteVec(out, s.ballHitInfo.ballPos);
		WriteVec(out, s.ballHitInfo.extraHitVel);
		out.Write(Age(arena, s.ballHitInfo.tickCountWhenHit));
		out.Write(Age(arena, s.ballHitInfo.tickCountWhenExtraImpulseApplied));
	}
	out.Write(s.demoSpawnSelectLast);
	out.Write(s.demoSpawnPreference);
	out.Write(s.demoSpawnIndex);
	out.Write(s.flipResets);
	out.Write(s.spawnCount);
	if (s.prespawnSet) {
		WriteVec(out, s.prespawnPos);
		out.Write(s.prespawnYaw);
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
		&s.wheelCarry.wheels[0].worldContact, &s.wheelCarry.wheels[1].worldContact, &s.wheelCarry.wheels[2].worldContact,
		&s.wheelCarry.wheels[3].worldContact, &s.jumpReleased, &s.prespawnSet,
	};
	for (int i = 0; i < (int)(sizeof(bits) / sizeof(bits[0])); i++)
		*bits[i] = (flags >> i) & 1;

	ReadVec(in, s.flipRelTorque);
	for (float* f : { &s.jumpTime, &s.flipTime, &s.airTime, &s.airTimeSinceJump, &s.boost, &s.timeSinceBoosted, &s.boostingTime,
		&s.supersonicTime, &s.handbrakeVal, &s.autoFlipTimer, &s.autoFlipTorqueScale, &s.carContact.cooldownTimer, &s.demoRespawnTimer,
		&s.dodgePitchLockTime })
		in.Read(*f);
	ReadVec(in, s.worldContact.contactNormal);
	in.Read(s.carContact.otherCarID);
	ReadControls(in, c);
	ReadControls(in, s.lastControls);
	for (CarState::WheelCarry& w : s.wheelCarry.wheels)
		for (float* f : { &w.steerAngle, &w.engineForce, &w.brake, &w.latFriction, &w.longFriction, &w.extraPushback })
			in.Read(*f);
	for (int i = 0; i < 4; i++)
		if (s.wheelsWithContact[i])
			ReadVec(in, s.wheelCarry.wheels[i].contactNormal);
	if (s.ballHitInfo.isValid) {
		ReadVec(in, s.ballHitInfo.relativePosOnBall);
		ReadVec(in, s.ballHitInfo.ballPos);
		ReadVec(in, s.ballHitInfo.extraHitVel);
		s.ballHitInfo.tickCountWhenHit = FromAge(arena, in.Read<int64_t>());
		s.ballHitInfo.tickCountWhenExtraImpulseApplied = FromAge(arena, in.Read<int64_t>());
	}
	in.Read(s.demoSpawnSelectLast);
	in.Read(s.demoSpawnPreference);
	in.Read(s.demoSpawnIndex);
	in.Read(s.flipResets);
	in.Read(s.spawnCount);
	if (s.prespawnSet) {
		ReadVec(in, s.prespawnPos);
		in.Read(s.prespawnYaw);
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
		wheel.m_raycastInfo.m_isInContact = s.wheelsWithContact[i];
		wheel.m_isInContactWithWorld = w.worldContact;
		wheel.m_raycastInfo.m_contactNormalWS = w.contactNormal;
	}
	car->_internalState = s;
	car->_velocityImpulseCache = { 0, 0, 0 };
	car->controls = d.controls;
}

// --- the update ----------------------------------------------------------------------------------------------

enum : uint8_t { HAS_BALL = 1, HAS_PADS = 2 };

static void WriteExact(Arena* arena, DataStreamOut& out, const WriteOptions& options) {
	out.Write(VERSION);
	out.Write<uint8_t>((options.ball ? HAS_BALL : 0) | (options.boostPads ? HAS_PADS : 0));
	out.Write<uint16_t>((uint16_t)RS_MIN(arena->kickoffCountdownTicks, 65535u));
	out.Write<uint8_t>(arena->respawnsHeld);

	if (options.ball) {
		Ball* ball = arena->ball;
		WriteBody(out, ball->_rigidBody, ball->_netRotation);
		const BallState& s = ball->_internalState;
		for (float f : { s.hsInfo.yTargetDir, s.hsInfo.curTargetSpeed, s.hsInfo.timeSinceHit, s.dsInfo.accumulatedHitForce, s.dsInfo.yTargetDir })
			out.Write(f);
		out.Write<int32_t>(s.dsInfo.chargeLevel);
		out.Write<uint8_t>(s.dsInfo.hasDamaged);
		out.Write(Age(arena, s.dsInfo.lastDamageTick));
		out.Write<uint8_t>(s.isExploded);
		out.Write(s.spawnCount);
		_WriteGoalExplosion(out, arena->goalExplosion);
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

static bool ReadExact(Arena* arena, DataStreamIn& in, std::vector<uint32_t>* carIds) {
	if (in.Read<uint8_t>() != VERSION)
		return false;
	uint8_t has = in.Read<uint8_t>();
	uint16_t countdown = in.Read<uint16_t>();
	bool respawnsHeld = in.Read<uint8_t>() != 0;

	Body ballBody{};
	BallState ballState = arena->ball->_internalState;
	Arena::GoalExplosion goalExplosion = arena->goalExplosion;
	if (has & HAS_BALL) {
		ReadBody(in, ballBody);
		for (float* f : { &ballState.hsInfo.yTargetDir, &ballState.hsInfo.curTargetSpeed, &ballState.hsInfo.timeSinceHit,
			&ballState.dsInfo.accumulatedHitForce, &ballState.dsInfo.yTargetDir })
			in.Read(*f);
		ballState.dsInfo.chargeLevel = in.Read<int32_t>();
		ballState.dsInfo.hasDamaged = in.Read<uint8_t>() != 0;
		ballState.dsInfo.lastDamageTick = FromAge(arena, in.Read<int64_t>());
		ballState.isExploded = in.Read<uint8_t>() != 0;
		in.Read(ballState.spawnCount);
		_ReadGoalExplosion(in, goalExplosion);
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
	arena->respawnsHeld = respawnsHeld;
	arena->goalExplosion = goalExplosion;
	if (has & HAS_BALL) {
		Ball* ball = arena->ball;
		ApplyBody(ballBody, ball->_rigidBody, ball->_netRotation);
		ballState.pos = ball->_rigidBody.getWorldTransform().getOrigin() * BT_TO_UU;
		ballState.rotMat = ball->_rigidBody.getWorldTransform().getBasis();
		ballState.vel = ball->_rigidBody.getLinearVelocity() * BT_TO_UU;
		ballState.angVel = ball->_rigidBody.getAngularVelocity();
		ball->_internalState = ballState;
		ball->_velocityImpulseCache = { 0, 0, 0 };
		ball->_ApplyExploded();
	}
	for (const CarData& d : cars)
		ApplyCar(d, arena->GetCar(d.id));
	if (carIds) {
		carIds->clear();
		for (const CarData& d : cars)
			carIds->push_back(d.id);
	}
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

// --- the compact form (COMPACT_VERSION) ---------------------------------------------------------------------------
// A bitstream, low bit first. A body as the game's ReplicatedRBState (notes/netcode-audit.md "Wire size of the car
// state"): the location x100 and the velocities x100 / x10000 as packed int vectors, the rotation's 2 + 3 x 18 bits.
// The bodies were rounded to exactly that at their last tick (Quantize), so these restore them bit for bit; a body
// whose floats don't come back exactly (placed since its last tick) goes raw. Each car adds the gameplay state a
// client can't see in its body (the game's components and replicated properties: flags, boost, the controls, the
// dodge's torque, counters, its XY lock); the rest (timers, the wheels' carried values, contacts) stays the client's.

namespace {

struct BitWriter {
	std::vector<uint8_t>& out;
	uint64_t bit = 0;
	void Put(uint32_t v, int n) {
		for (int i = 0; i < n; i++, bit++) {
			if ((bit & 7) == 0)
				out.push_back(0);
			if ((v >> i) & 1)
				out.back() |= (uint8_t)(1u << (bit & 7));
		}
	}
	void Bool(bool b) { Put(b ? 1 : 0, 1); }
	void F32(float f) { uint32_t u; memcpy(&u, &f, 4); Put(u, 32); }
	void Id(uint32_t id) {
		Put(RS_MIN(id, 255u), 8);
		if (id >= 255)
			Put(id, 32);
	}
};

struct BitReader {
	const std::vector<uint8_t>& data;
	uint64_t bit;
	bool overflow = false;
	uint32_t Get(int n) {
		uint32_t v = 0;
		for (int i = 0; i < n; i++, bit++) {
			uint64_t byte = bit >> 3;
			if (byte >= data.size()) {
				overflow = true;
				return 0;
			}
			v |= (uint32_t)((data[byte] >> (bit & 7)) & 1) << i;
		}
		return v;
	}
	bool Bool() { return Get(1) != 0; }
	float F32() { uint32_t u = Get(32); float f; memcpy(&f, &u, 4); return f; }
	uint32_t Id() {
		uint32_t id = Get(8);
		return id == 255 ? Get(32) : id;
	}
};

bool SameBits(float a, float b) { return memcmp(&a, &b, sizeof(float)) == 0; }
bool SameBits(const btVector3& a, const btVector3& b) { return SameBits(a.x(), b.x()) && SameBits(a.y(), b.y()) && SameBits(a.z(), b.z()); }

// The packed int vector (FUN_140386e40): B = clamp(ceil_log2(1 + max|c|), 1, 22) - 1, then 3 x (B + 2) bits of c + 2^(B+1)
constexpr int MAX_VECTOR_BITS = 22;
constexpr int32_t MAX_VECTOR_VALUE = (1 << MAX_VECTOR_BITS) - 1;

void PutVector(BitWriter& w, const int32_t c[3]) {
	uint32_t m = 0;
	for (int i = 0; i < 3; i++)
		m = RS_MAX(m, (uint32_t)std::abs(c[i]));
	int log2 = 0;
	while ((1ull << log2) < 1ull + m)
		log2++;
	int b = std::clamp(log2, 1, MAX_VECTOR_BITS) - 1;
	w.Put((uint32_t)b, 5);
	for (int i = 0; i < 3; i++)
		w.Put((uint32_t)(c[i] + (1 << (b + 1))), b + 2);
}

void GetVector(BitReader& r, int32_t c[3]) {
	int b = (int)r.Get(5);
	if (b >= MAX_VECTOR_BITS) {
		r.overflow = true;
		b = 0;
	}
	for (int i = 0; i < 3; i++)
		c[i] = (int32_t)r.Get(b + 2) - (1 << (b + 1));
}

bool Fits(const int32_t c[3]) {
	for (int i = 0; i < 3; i++)
		if (c[i] < -MAX_VECTOR_VALUE || c[i] > MAX_VECTOR_VALUE)
			return false;
	return true;
}

// The read-back of a quantized body's values (Quantize::Location, Quantize::Velocity: the same arithmetic)
btVector3 LocationFromInts(const int32_t n[3]) {
	btVector3 pos;
	for (int i = 0; i < 3; i++)
		pos[i] = (1.f / 100.f) * (float)n[i];
	return pos * UU_TO_BT;
}
float VelocityFromInt(int32_t k, float scale) {
	float invScale = 1.f / scale;
	float result = invScale * (float)k;
	float sign = (result > 0) ? 1.f : ((result < 0) ? -1.f : 0.f);
	return sign * (invScale * 0.1f) + result;
}
btVector3 LinVelFromInts(const int32_t k[3]) {
	return btVector3(VelocityFromInt(k[0], 100.f), VelocityFromInt(k[1], 100.f), VelocityFromInt(k[2], 100.f)) * UU_TO_BT;
}
btVector3 AngVelFromInts(const int32_t k[3]) {
	return btVector3(VelocityFromInt(k[0], 10000.f), VelocityFromInt(k[1], 10000.f), VelocityFromInt(k[2], 10000.f));
}

bool Sleeping(int activationState) { return activationState == ISLAND_SLEEPING || activationState == DISABLE_SIMULATION; }

struct CompactBody {
	btVector3 origin, linVel, angVel;
	Quantize::PackedRotation rotation; // when valid; otherwise the raw basis
	btMatrix3x3 basis;
	uint8_t activationState = ACTIVE_TAG;
	float deactivationTime = 0;
};

void PutRotation(BitWriter& w, const Quantize::PackedRotation& r) {
	w.Put(r.largest, 2);
	for (uint32_t c : r.c)
		w.Put(c, 18);
}

void WriteCompactBody(BitWriter& w, const btRigidBody& rb, const Quantize::PackedRotation& rotation) {
	const btVector3& origin = rb.getWorldTransform().getOrigin();
	int activation = rb.getActivationState();
	int32_t loc[3], vel[3], ang[3];
	btVector3 uu = origin * BT_TO_UU, velUU = rb.getLinearVelocity() * BT_TO_UU;
	for (int i = 0; i < 3; i++) {
		loc[i] = Quantize::RoundUE(100.f * uu[i]);
		vel[i] = (int32_t)(100.f * velUU[i]);
		ang[i] = (int32_t)(10000.f * rb.getAngularVelocity()[i]);
	}
	bool sleeping = Sleeping(activation);
	bool exact = rotation.valid && Fits(loc) && Fits(vel) && Fits(ang) && SameBits(LocationFromInts(loc), origin) &&
		(sleeping ? SameBits(rb.getLinearVelocity(), btVector3(0, 0, 0)) && SameBits(rb.getAngularVelocity(), btVector3(0, 0, 0))
			: SameBits(LinVelFromInts(vel), rb.getLinearVelocity()) && SameBits(AngVelFromInts(ang), rb.getAngularVelocity()));
	w.Bool(!exact);
	w.Put((uint32_t)activation, 3);
	w.Bool(rb.getDeactivationTime() != 0);
	if (rb.getDeactivationTime() != 0)
		w.F32(rb.getDeactivationTime());
	if (exact) {
		PutVector(w, loc);
		PutRotation(w, rotation);
		if (!sleeping) {
			PutVector(w, vel);
			PutVector(w, ang);
		}
		return;
	}
	for (int i = 0; i < 3; i++)
		w.F32(origin[i]);
	w.Bool(rotation.valid);
	if (rotation.valid) {
		PutRotation(w, rotation);
	} else {
		for (int r = 0; r < 3; r++)
			for (int c = 0; c < 3; c++)
				w.F32(rb.getWorldTransform().getBasis()[r][c]);
	}
	for (int i = 0; i < 3; i++)
		w.F32(rb.getLinearVelocity()[i]);
	for (int i = 0; i < 3; i++)
		w.F32(rb.getAngularVelocity()[i]);
}

Quantize::PackedRotation GetRotation(BitReader& r) {
	Quantize::PackedRotation p;
	p.largest = (uint8_t)r.Get(2);
	for (uint32_t& c : p.c)
		c = r.Get(18);
	p.valid = true;
	return p;
}

void ReadCompactBody(BitReader& r, CompactBody& b) {
	bool raw = r.Bool();
	b.activationState = (uint8_t)r.Get(3);
	b.deactivationTime = r.Bool() ? r.F32() : 0.f;
	if (!raw) {
		int32_t loc[3], vel[3] = {}, ang[3] = {};
		GetVector(r, loc);
		b.rotation = GetRotation(r);
		if (!Sleeping(b.activationState)) {
			GetVector(r, vel);
			GetVector(r, ang);
		}
		b.origin = LocationFromInts(loc);
		b.linVel = Sleeping(b.activationState) ? btVector3(0, 0, 0) : LinVelFromInts(vel);
		b.angVel = Sleeping(b.activationState) ? btVector3(0, 0, 0) : AngVelFromInts(ang);
		return;
	}
	for (int i = 0; i < 3; i++)
		b.origin[i] = r.F32();
	b.rotation = {};
	if (r.Bool()) {
		b.rotation = GetRotation(r);
	} else {
		for (int i = 0; i < 3; i++)
			for (int c = 0; c < 3; c++)
				b.basis[i][c] = r.F32();
	}
	for (int i = 0; i < 3; i++)
		b.linVel[i] = r.F32();
	for (int i = 0; i < 3; i++)
		b.angVel[i] = r.F32();
}

bool SameRotation(const Quantize::PackedRotation& a, const Quantize::PackedRotation& b) {
	return a.valid && b.valid && a.largest == b.largest && a.c[0] == b.c[0] && a.c[1] == b.c[1] && a.c[2] == b.c[2];
}

// The body onto the client's own: its world inverse inertia stays the client's unless the rotation changed (the game
// doesn't recompute it after the tick's rounding: the client's own, from its own step, is the best guess)
void OverlayBody(const CompactBody& b, btRigidBody& rb, Quantize::PackedRotation& netRotation) {
	btTransform t = rb.getWorldTransform();
	btMatrix3x3 basis = b.rotation.valid ? btMatrix3x3(Quantize::Unpack(b.rotation)) : b.basis;
	bool rotated = b.rotation.valid ? !SameRotation(b.rotation, netRotation) : (netRotation.valid || !(basis == t.getBasis()));
	t.setOrigin(b.origin);
	t.setBasis(basis);
	rb.setWorldTransform(t);
	rb.setInterpolationWorldTransform(t);
	rb.setLinearVelocity(b.linVel);
	rb.setAngularVelocity(b.angVel);
	rb.setInterpolationLinearVelocity(b.linVel);
	rb.setInterpolationAngularVelocity(b.angVel);
	rb.forceActivationState(b.activationState);
	rb.setDeactivationTime(b.deactivationTime);
	if (rotated)
		rb.updateInertiaTensor();
	netRotation = b.rotation;
}

// Lossy values, compared in their sent form: a client value that sends the same is kept (its prediction was right)
uint8_t BoostByte(float boost) { return (uint8_t)std::clamp(Quantize::RoundUE(boost * (255.f / 100.f)), 0, 255); }
float BoostFromByte(uint8_t q) { return (float)q * (100.f / 255.f); }
int8_t TorqueByte(float v) { return (int8_t)std::clamp(Quantize::RoundUE(v * 127.f), -127, 127); }
// A 16-bit counter from its low byte, the nearest to the client's
uint16_t CounterNear(uint16_t client, uint8_t low) { return (uint16_t)(client + (int8_t)(uint8_t)(low - (uint8_t)client)); }

enum : uint32_t { C_HAS_BALL = 1, C_HAS_PADS = 2, C_RESPAWNS_HELD = 4, C_EXPLOSION = 8 };

// The car's timers the physics reads (not airTime, a stat, nor timeSinceBoosted, the recharge mutator's), each sent
// while it isn't at rest (a few at a time: a jump, a dodge, a powerslide, a bump), exactly
constexpr int TIMERS = 10;
float* Timers(CarState& s, float* out[TIMERS]) {
	float* list[TIMERS] = { &s.jumpTime, &s.flipTime, &s.airTimeSinceJump, &s.boostingTime, &s.supersonicTime, &s.handbrakeVal,
		&s.autoFlipTimer, &s.autoFlipTorqueScale, &s.dodgePitchLockTime, &s.carContact.cooldownTimer };
	for (int i = 0; i < TIMERS; i++)
		out[i] = list[i];
	return out[0];
}
// At rest: 0, the bump cooldown a tick below it (Car::_PostTickUpdate)
float TimerRest(int i, float tickTime) { return i == TIMERS - 1 ? -tickTime : 0.f; }

struct CompactCar {
	uint32_t id;
	CompactBody body;
	bool hasJumped, hasDoubleJumped, hasFlipped, isFlipping, isJumping, isBoosting, isSupersonic, isAutoFlipping, isDemoed, jumpReleased;
	bool jump, boost, handbrake, airPitchSafety, hasDodgeForward;
	int8_t axes[6]; // throttle, steer, pitch, yaw, roll, dodge forward
	uint8_t boostAmount, spawnCount, flipResets;
	int8_t torque[3];
	float demoRespawnTimer;
	float timers[TIMERS];
	uint32_t contactCar;
	bool held;
	btVector3 pin;
};

void WriteCompactCar(BitWriter& w, Car* car, float tickTime) {
	CarState s = car->_internalState;
	const CarControls& c = car->controls;
	w.Id(car->id);
	WriteCompactBody(w, car->_rigidBody, car->_netRotation);
	for (bool b : { s.hasJumped, s.hasDoubleJumped, s.hasFlipped, s.isFlipping, s.isJumping, s.isBoosting, s.isSupersonic,
		s.isAutoFlipping, s.isDemoed, s.jumpReleased, c.jump, c.boost, c.handbrake, c.airPitchSafety, c.hasDodgeForward })
		w.Bool(b);
	w.Put((uint8_t)Quantize::InputAxisByte(c.throttle), 8);
	w.Put((uint8_t)Quantize::InputAxisByte(c.steer), 8);
	bool air = c.pitch != 0 || c.yaw != 0 || c.roll != 0 || (c.hasDodgeForward && c.dodgeForward != 0);
	w.Bool(air);
	if (air)
		for (float v : { c.pitch, c.yaw, c.roll, c.hasDodgeForward ? c.dodgeForward : 0.f })
			w.Put((uint8_t)Quantize::InputAxisByte(v), 8);
	w.Put(BoostByte(s.boost), 8);
	w.Put((uint8_t)s.spawnCount, 8);
	w.Put((uint8_t)s.flipResets, 8);
	if (s.isFlipping)
		for (int i = 0; i < 3; i++)
			w.Put((uint8_t)TorqueByte(s.flipRelTorque[i]), 8);
	if (s.isDemoed)
		w.F32(s.demoRespawnTimer);
	float* timers[TIMERS];
	Timers(s, timers);
	for (int i = 0; i < TIMERS; i++) {
		bool active = !SameBits(*timers[i], TimerRest(i, tickTime));
		w.Bool(active);
		if (active)
			w.F32(*timers[i]);
	}
	bool bumped = !SameBits(s.carContact.cooldownTimer, TimerRest(TIMERS - 1, tickTime));
	if (bumped)
		w.Id(s.carContact.otherCarID);
	btVector3 pin;
	bool held = car->_XYLockHeld(&pin);
	w.Bool(held);
	if (held)
		for (int i = 0; i < 3; i++)
			w.F32(pin[i]);
}

void ReadCompactCar(BitReader& r, CompactCar& d, float tickTime) {
	d.id = r.Id();
	ReadCompactBody(r, d.body);
	for (bool* b : { &d.hasJumped, &d.hasDoubleJumped, &d.hasFlipped, &d.isFlipping, &d.isJumping, &d.isBoosting, &d.isSupersonic,
		&d.isAutoFlipping, &d.isDemoed, &d.jumpReleased, &d.jump, &d.boost, &d.handbrake, &d.airPitchSafety, &d.hasDodgeForward })
		*b = r.Bool();
	d.axes[0] = (int8_t)r.Get(8);
	d.axes[1] = (int8_t)r.Get(8);
	bool air = r.Bool();
	for (int i = 2; i < 6; i++)
		d.axes[i] = air ? (int8_t)r.Get(8) : 0;
	d.boostAmount = (uint8_t)r.Get(8);
	d.spawnCount = (uint8_t)r.Get(8);
	d.flipResets = (uint8_t)r.Get(8);
	for (int i = 0; i < 3; i++)
		d.torque[i] = d.isFlipping ? (int8_t)r.Get(8) : 0;
	d.demoRespawnTimer = d.isDemoed ? r.F32() : 0.f;
	for (int i = 0; i < TIMERS; i++)
		d.timers[i] = r.Bool() ? r.F32() : TimerRest(i, tickTime);
	d.contactCar = SameBits(d.timers[TIMERS - 1], TimerRest(TIMERS - 1, tickTime)) ? 0 : r.Id();
	d.held = r.Bool();
	d.pin = btVector3(0, 0, 0);
	if (d.held)
		for (int i = 0; i < 3; i++)
			d.pin[i] = r.F32();
}

// An axis the client holds: kept if it sends the same byte (a remote car's faded value, the local car's own)
void OverlayAxis(float& v, int8_t q) {
	if (Quantize::InputAxisByte(v) != q)
		v = Quantize::InputAxisValue(q);
}

void OverlayCar(Arena* arena, const CompactCar& d, Car* car) {
	OverlayBody(d.body, car->_rigidBody, car->_netRotation);
	CarState s = car->_internalState;
	const btTransform& t = car->_rigidBody.getWorldTransform();
	s.pos = t.getOrigin() * BT_TO_UU;
	s.rotMat = t.getBasis();
	s.vel = car->_rigidBody.getLinearVelocity() * BT_TO_UU;
	s.angVel = car->_rigidBody.getAngularVelocity();
	s.hasJumped = d.hasJumped;
	s.hasDoubleJumped = d.hasDoubleJumped;
	s.hasFlipped = d.hasFlipped;
	s.isFlipping = d.isFlipping;
	s.isJumping = d.isJumping;
	s.isBoosting = d.isBoosting;
	s.isSupersonic = d.isSupersonic;
	s.isAutoFlipping = d.isAutoFlipping;
	s.isDemoed = d.isDemoed;
	s.jumpReleased = d.jumpReleased;
	float* timers[TIMERS];
	Timers(s, timers);
	for (int i = 0; i < TIMERS; i++)
		*timers[i] = d.timers[i];
	if (d.contactCar)
		s.carContact.otherCarID = d.contactCar;
	if (d.isDemoed)
		s.demoRespawnTimer = d.demoRespawnTimer;
	if (BoostByte(s.boost) != d.boostAmount)
		s.boost = BoostFromByte(d.boostAmount);
	if (d.isFlipping)
		for (int i = 0; i < 3; i++)
			if (TorqueByte(s.flipRelTorque[i]) != d.torque[i])
				s.flipRelTorque[i] = (float)d.torque[i] / 127.f;
	s.spawnCount = CounterNear(s.spawnCount, d.spawnCount);
	s.flipResets = CounterNear(s.flipResets, d.flipResets);

	// The controls of the tick (the game replicates a car's inputs to the others): its last controls too, as after a tick
	CarControls c = car->controls;
	c.jump = d.jump;
	c.boost = d.boost;
	c.handbrake = d.handbrake;
	c.airPitchSafety = d.airPitchSafety;
	OverlayAxis(c.throttle, d.axes[0]);
	OverlayAxis(c.steer, d.axes[1]);
	OverlayAxis(c.pitch, d.axes[2]);
	OverlayAxis(c.yaw, d.axes[3]);
	OverlayAxis(c.roll, d.axes[4]);
	c.hasDodgeForward = d.hasDodgeForward;
	if (d.hasDodgeForward)
		OverlayAxis(c.dodgeForward, d.axes[5]);
	else
		c.dodgeForward = 0;
	car->controls = c;
	s.lastControls = c;
	s.tickCountSinceUpdate = car->_internalState.tickCountSinceUpdate;
	car->_internalState = s;
	car->_velocityImpulseCache = { 0, 0, 0 };

	// Its XY lock: the server's pin (RV-304), taken there at the next tick unless the client already holds it there
	btVector3 pin;
	bool held = car->_XYLockHeld(&pin);
	if (d.held && !(held && SameBits(pin, d.pin))) {
		arena->_RemoveXYLock(car);
		car->_xyLockPending = true;
		car->_xyLockPin = d.pin;
		car->_xyLockMoved = false;
	} else if (!d.held && held) {
		arena->_RemoveXYLock(car);
		car->_xyLockPending = false;
		car->_xyLockMoved = false;
	}
}

void WriteCompact(Arena* arena, DataStreamOut& out, const WriteOptions& options) {
	out.Write(COMPACT_VERSION);
	BitWriter w{ out.data, (uint64_t)out.data.size() * 8 };
	const Arena::GoalExplosion& ex = arena->goalExplosion;
	w.Put((options.ball ? C_HAS_BALL : 0) | (options.boostPads ? C_HAS_PADS : 0) | (arena->respawnsHeld ? C_RESPAWNS_HELD : 0) |
		(ex.active ? C_EXPLOSION : 0), 4);
	uint32_t countdown = RS_MIN(arena->kickoffCountdownTicks, 65535u);
	w.Bool(countdown != 0);
	if (countdown)
		w.Put(countdown, 16);
	if (ex.active) {
		for (int i = 0; i < 3; i++)
			w.F32(ex.origin[i]);
		w.F32(ex.goalDir);
		w.F32(ex.lifeTime);
		w.Put((uint32_t)RS_MIN(ex.hitCars.size(), (size_t)255), 8);
		for (size_t i = 0; i < RS_MIN(ex.hitCars.size(), (size_t)255); i++)
			w.Id(ex.hitCars[i]);
	}
	if (options.ball) {
		Ball* ball = arena->ball;
		WriteCompactBody(w, ball->_rigidBody, ball->_netRotation);
		w.Put((uint8_t)ball->_internalState.spawnCount, 8);
		w.Bool(ball->_internalState.isExploded);
	}
	w.Put((uint32_t)options.carIds.size(), 8);
	for (uint32_t id : options.carIds)
		WriteCompactCar(w, arena->GetCar(id), arena->tickTime);
	if (options.boostPads) {
		const auto& pads = arena->GetBoostPads();
		w.Put((uint32_t)pads.size(), 8);
		for (BoostPad* pad : pads) {
			BoostPadState s = pad->GetState();
			w.Bool(s.isActive);
			if (!s.isActive)
				w.F32(s.cooldown);
			w.Bool(s.prevLockedCarID != 0);
			if (s.prevLockedCarID != 0)
				w.Id(s.prevLockedCarID);
		}
	}
}

bool ApplyCompact(Arena* arena, DataStreamIn& in, std::vector<uint32_t>* carIds) {
	if (in.data.empty() || in.data[0] != COMPACT_VERSION)
		return false;
	BitReader r{ in.data, 8 };
	uint32_t has = r.Get(4);
	uint32_t countdown = r.Bool() ? r.Get(16) : 0;
	Arena::GoalExplosion ex;
	if (has & C_EXPLOSION) {
		ex.active = true;
		for (int i = 0; i < 3; i++)
			ex.origin[i] = r.F32();
		ex.goalDir = r.F32();
		ex.lifeTime = r.F32();
		ex.hitCars.resize(r.Get(8));
		for (uint32_t& id : ex.hitCars)
			id = r.Id();
	}
	CompactBody ballBody;
	uint8_t ballSpawns = 0;
	bool ballExploded = false;
	if (has & C_HAS_BALL) {
		ReadCompactBody(r, ballBody);
		ballSpawns = (uint8_t)r.Get(8);
		ballExploded = r.Bool();
	}
	std::vector<CompactCar> cars(r.Get(8));
	for (CompactCar& d : cars) {
		ReadCompactCar(r, d, arena->tickTime);
		if (r.overflow || !arena->GetCar(d.id))
			return false;
	}
	struct Pad { bool active; float cooldown; uint32_t prevLockedCarID; };
	std::vector<Pad> pads;
	if (has & C_HAS_PADS) {
		pads.resize(r.Get(8));
		if (pads.size() != arena->GetBoostPads().size())
			return false;
		for (Pad& p : pads) {
			p.active = r.Bool();
			p.cooldown = p.active ? 0.f : r.F32();
			p.prevLockedCarID = r.Bool() ? r.Id() : 0;
		}
	}
	if (r.overflow)
		return false;

	// Everything parsed: apply
	arena->kickoffCountdownTicks = countdown;
	arena->respawnsHeld = (has & C_RESPAWNS_HELD) != 0;
	arena->goalExplosion = ex;
	if (has & C_HAS_BALL) {
		Ball* ball = arena->ball;
		OverlayBody(ballBody, ball->_rigidBody, ball->_netRotation);
		BallState s = ball->_internalState;
		s.pos = ball->_rigidBody.getWorldTransform().getOrigin() * BT_TO_UU;
		s.rotMat = ball->_rigidBody.getWorldTransform().getBasis();
		s.vel = ball->_rigidBody.getLinearVelocity() * BT_TO_UU;
		s.angVel = ball->_rigidBody.getAngularVelocity();
		s.spawnCount = CounterNear(s.spawnCount, ballSpawns);
		s.isExploded = ballExploded;
		ball->_internalState = s;
		ball->_velocityImpulseCache = { 0, 0, 0 };
		ball->_ApplyExploded();
	}
	for (const CompactCar& d : cars)
		OverlayCar(arena, d, arena->GetCar(d.id));
	if (carIds) {
		carIds->clear();
		for (const CompactCar& d : cars)
			carIds->push_back(d.id);
	}
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

} // namespace

void Write(Arena* arena, DataStreamOut& out, const WriteOptions& options) {
	if (options.exact)
		WriteExact(arena, out, options);
	else
		WriteCompact(arena, out, options);
}

bool Read(Arena* arena, DataStreamIn& in, std::vector<uint32_t>* carIds) {
	if (!in.data.empty() && in.data[in.pos] == COMPACT_VERSION)
		return ApplyCompact(arena, in, carIds);
	return ReadExact(arena, in, carIds);
}

} // namespace NetState
