#include "Car.h"
#include "../../RLConst.h"

#include "../../../libsrc/bullet3-3.24/BulletDynamics/Dynamics/btDynamicsWorld.h"
#include "../CollisionMasks.h"
#include "../Quantize/Quantize.h"

RS_NS_START

// RL PATCH: the game's input shaping (FUN_140396ca0) for steering and air control: scale by the
// sensitivity, then clamp; at the maximum sensitivity (10) any input is full input.
static float ShapeInput(float input, float sensitivity) {
	if (sensitivity > 10 || abs(sensitivity - 10) < 0.001f)
		input = (input > 0) ? 1.f : ((input < 0) ? -1.f : 0.f);
	return RS_CLAMP(input * sensitivity, -1, 1);
}

// RL PATCH: VehicleSim's steering curves give the inner front wheel's angle. PhysicsConfig_TA.bUseAckermannSteering
// is false, so at setup the game turns off the car's Ackermann steering and converts every curve point to the average
// of the inner and the outer wheel's angle, outer = atan(L / (W + L / tan(inner))) with the car's wheelbase L and front
// track W (FUN_140f17d30 -> FUN_140ec7c00); both front wheels then steer by it. Replays confirm the average over
// per-wheel angles (notes/validation.md). For the Octane this gives stock RocketSim's curve.
static LinearPieceCurve AverageSteerCurve(const LinearPieceCurve& inner, float wheelbase, float track) {
	LinearPieceCurve out;
	for (auto& [speed, angle] : inner.valueMappings) {
		float x = abs(angle);
		float outer = det_atanf(wheelbase / (track + wheelbase / det_tanf(x)));
		float avg = (outer - x) * 0.5f + x;
		out.valueMappings[speed] = angle < 0 ? -avg : avg;
	}
	return out;
}

// Update our internal state from bullet and return it
CarState Car::GetState() {
	_internalState.pos = _rigidBody.getWorldTransform().m_origin * BT_TO_UU;

	// NOTE: rotMat already updated at the start of Car::_PostTickUpdate()

	_internalState.vel = _rigidBody.m_linearVelocity * BT_TO_UU;

	_internalState.angVel = _rigidBody.m_angularVelocity;

	// RL PATCH: wheel values carried into the next tick
	for (int i = 0; i < _bulletVehicle.m_wheelInfo.size() && i < 4; i++) {
		const btWheelInfoRL& wheel = _bulletVehicle.m_wheelInfo[i];
		// (a wheel's normal only matters while it touches something: otherwise a fixed one, so equal states compare equal)
		bool contact = wheel.m_raycastInfo.m_isInContact;
		_internalState.wheelCarry.wheels[i] = {
			wheel.m_steerAngle, wheel.m_engineForce, wheel.m_brake, wheel.m_latFriction, wheel.m_longFriction,
			wheel.m_extraPushback, contact && wheel.m_isInContactWithWorld,
			contact ? Vec(wheel.m_raycastInfo.m_contactNormalWS) : Vec(0, 0, 1)
		};
	}

	return _internalState;
}

// The speed caps (CAR_MAX_SPEED, CAR_MAX_ANG_SPEED). RL PATCH: also before the vehicle update (_PreTickUpdate), as the
// game's Bullet caps at the start of each substep in applyDamping (FUN_1402c23a0, MaxLinearSpeed / MaxAngularSpeed on
// the body), after the car's own impulses and before the vehicle's: a dodge or jump impulse that takes the car over the
// cap moves it from the cap. The end-of-tick cap is the game's RB-state read-back (FUN_140eed9e0). Live: a forward dodge
// at 2300 uu/s moved the car 4.16 uu too far on its press tick
void Car::_LimitVelocities() {
	using namespace RLConst;
	btVector3
		vel = _rigidBody.m_linearVelocity,
		angVel = _rigidBody.m_angularVelocity;

	if (vel.length2() > (CAR_MAX_SPEED * UU_TO_BT) * (CAR_MAX_SPEED * UU_TO_BT))
		vel = vel.normalized() * (CAR_MAX_SPEED * UU_TO_BT);

	if (angVel.length2() > (CAR_MAX_ANG_SPEED * CAR_MAX_ANG_SPEED))
		angVel = angVel.normalized() * CAR_MAX_ANG_SPEED;

	_rigidBody.m_linearVelocity = vel;
	_rigidBody.m_angularVelocity = angVel;
}

// Update our bullet stuff to this new state, replace our internal state with it
void Car::SetState(const CarState& state) {
	btTransform rbTransform;
	rbTransform.setOrigin(state.pos * UU_TO_BT);
	rbTransform.setBasis(state.rotMat);
	_rigidBody.getWorldTransform() = rbTransform;
	_rigidBody.m_linearVelocity = state.vel * UU_TO_BT;
	_rigidBody.m_angularVelocity = state.angVel;
	_rigidBody.updateInertiaTensor();

	_velocityImpulseCache = { 0, 0, 0 };

	// RL PATCH: wheel values carried into the next tick
	for (int i = 0; i < _bulletVehicle.m_wheelInfo.size() && i < 4; i++) {
		btWheelInfoRL& wheel = _bulletVehicle.m_wheelInfo[i];
		const CarState::WheelCarry& carry = state.wheelCarry.wheels[i];
		wheel.m_steerAngle = carry.steerAngle;
		wheel.m_engineForce = carry.engineForce;
		wheel.m_brake = carry.brake;
		wheel.m_latFriction = carry.latFriction;
		wheel.m_longFriction = carry.longFriction;
		wheel.m_extraPushback = carry.extraPushback;
		wheel.m_raycastInfo.m_isInContact = state.wheelsWithContact[i];
		wheel.m_isInContactWithWorld = carry.worldContact;
		wheel.m_raycastInfo.m_contactNormalWS = carry.contactNormal;
	}

	_internalState = state;
	_internalState.tickCountSinceUpdate = 0;
	_netRotation.valid = false; // RL PATCH: not a quantized state
}

void Car::Demolish(float respawnDelay) {
	_internalState.isDemoed = true;
	_internalState.demoRespawnTimer = respawnDelay;
}

void Car::Respawn(GameMode gameMode, int seed, float boostAmount) {
	using namespace RLConst;

	int spawnPosIndex = Math::RandInt(0, CAR_RESPAWN_LOCATION_AMOUNT, seed);

	const CarSpawnPos* spawnPosArray;
	switch (gameMode) {
	case GameMode::HOOPS:
		spawnPosArray = CAR_RESPAWN_LOCATIONS_HOOPS;
		break;
	case GameMode::DROPSHOT:
		spawnPosArray = CAR_RESPAWN_LOCATIONS_DROPSHOT;
		break;
	default:
		spawnPosArray = CAR_RESPAWN_LOCATIONS_SOCCAR;
	}

	CarSpawnPos spawnPos = spawnPosArray[spawnPosIndex];

	_RespawnAt(Vec(spawnPos.x, spawnPos.y * (team == Team::BLUE ? 1 : -1), CAR_RESPAWN_Z),
		spawnPos.yawAng + (team == Team::BLUE ? 0 : M_PI), boostAmount);
}

void Car::_RespawnAt(Vec pos, float yaw, float boostAmount) {
	CarState newState = CarState();
	// RL PATCH: the body is created at its own height above the spot, and its forward offset ahead (CarConfig)
	newState.pos = Vec(pos.x + cosf(yaw) * config.spawnForwardOffset, pos.y + sinf(yaw) * config.spawnForwardOffset, config.spawnZ);
	newState.rotMat = Angle(yaw, 0.f, 0.f).ToRotMat();
	newState.boost = boostAmount;
	newState.spawnCount = _internalState.spawnCount + 1;
	this->SetState(newState);
}

void Car::_PreTickUpdate(GameMode gameMode, float tickTime, const MutatorConfig& mutatorConfig, bool respawnHeld) {
	using namespace RLConst;

#ifndef RS_MAX_SPEED
	// Fix inputs
	controls.ClampFix();
#endif

	// RL PATCH: the game keeps every input axis as a byte (Vehicle_TA.SetVehicleInput)
	controls.throttle = Quantize::InputAxis(controls.throttle);
	controls.steer = Quantize::InputAxis(controls.steer);
	controls.pitch = Quantize::InputAxis(controls.pitch);
	controls.yaw = Quantize::InputAxis(controls.yaw);
	controls.roll = Quantize::InputAxis(controls.roll);
	if (controls.hasDodgeForward)
		controls.dodgeForward = Quantize::InputAxis(RS_CLAMP(controls.dodgeForward, -1, 1));

	assert(_bulletVehicle.getNumWheels() == 4 || _bulletVehicle.getNumWheels() == 3);

	// RL PATCH: keep the start-of-tick state, like the game's OldRBState (used by car-car impacts)
	_oldState.pos = _rigidBody.getWorldTransform().m_origin * BT_TO_UU;
	_oldState.rotMat = _rigidBody.getWorldTransform().m_basis;
	_oldState.vel = _rigidBody.m_linearVelocity * BT_TO_UU;
	_oldState.angVel = _rigidBody.m_angularVelocity;

	{ // Update simulation state
		if (_internalState.isDemoed) {
			_internalState.demoRespawnTimer = RS_MAX(_internalState.demoRespawnTimer - tickTime, 0);
			if (_internalState.demoRespawnTimer == 0 && !respawnHeld) {
				// RL PATCH: at the spot the arena chose (Arena::_UpdateDemolished: deterministic, not on another car)
				if (_respawnSpot.valid)
					_RespawnAt(_respawnSpot.pos, _respawnSpot.yaw, mutatorConfig.carSpawnBoostAmount);
				else
					Respawn(gameMode, -1, mutatorConfig.carSpawnBoostAmount);
				_respawnSpot.valid = false;
			}
		}

		// RL PATCH: a car respawned this tick is simulated from this tick on (the game sets it on the ground at once;
		// the frames before its body exists are its asset loading, a machine-dependent latency; static analysis).
		// RocketSim kept it frozen for the respawn tick
		if (_internalState.isDemoed) {
			// Disable rigidbody simulation
			_rigidBody.m_activationState1 = DISABLE_SIMULATION;
			_rigidBody.m_collisionFlags |= btCollisionObject::CF_NO_CONTACT_RESPONSE;

			// Don't bother updating anything
		} else {
			// Prevent the car's RB from becoming inactive
			_rigidBody.m_activationState1 = ACTIVE_TAG;
			_rigidBody.m_collisionFlags &= ~btCollisionObject::CF_NO_CONTACT_RESPONSE;
		}
	}

	if (_internalState.isDemoed)
		return; // No other updates need to occur

	bool jumpPressed = controls.jump && !_internalState.lastControls.jump;

	// RL PATCH: the game's Car_TA.SetVehicleInput sets the input throttle to 1 while the car is on the ground (3+ wheels
	// after the previous tick), boost is held and there is boost left (before this tick's use), so everything reading
	// the throttle sees 1: VehicleSim's drive, the wheels' wall grip, the sticky force's wall share, auto-roll (static
	// analysis GA-1). RocketSim made boost a full throttle in VehicleSim only, also in the air. Live (`ga_boost`):
	// boosting on a wall with throttle 0, 7.5 uu/s per tick off
	_inputThrottle = (_internalState.isOnGround && controls.boost && _internalState.boost > 0) ? 1 : controls.throttle;

	// RL PATCH: the car's own pre-physics step (Car_TA FUN_140f1c600 and its components: jump, dodge, air control,
	// auto-roll, sticky force, boost) runs before the vehicle casts this tick's wheel rays, so it works on the contacts
	// the previous tick's rays found, and the vehicle's suspension and friction then see its impulses. RocketSim cast
	// the rays first: a jump's first tick kept the suspension's support, and the sticky force, air control and boost
	// switched between ground and air a tick early. Live recordings: exact on every tick of jumps, landings and flips.
	int numWheelsInContact = 0; // (the previous tick's rays)
	for (int i = 0; i < _bulletVehicle.m_wheelInfo.size() && i < 4; i++)
		numWheelsInContact += _internalState.wheelsWithContact[i];
	float forwardSpeed_UU = _bulletVehicle.getForwardSpeed() * BT_TO_UU;

	_UpdateJump(tickTime, mutatorConfig, jumpPressed);
	_UpdateAutoFlip(tickTime, mutatorConfig, jumpPressed);

	_UpdateDoubleJumpOrFlip(tickTime, mutatorConfig, jumpPressed, forwardSpeed_UU);

	// RL PATCH: air control and the dodge torque come after this tick's jump, flip and auto-flip starts (the game
	// activates those from the input before any component applies its forces), so a dodge already turns the car on
	// its press tick; RocketSim ran air control first and started the dodge torque a tick late
	if (numWheelsInContact < 3) {
		_UpdateAirTorque(tickTime, mutatorConfig, numWheelsInContact == 0);
	} else {
		_internalState.isFlipping = false;
	}
	_UpdateFlipTime(tickTime);
	_UpdateAutoFlipTorque(tickTime);

	// RL PATCH: auto-roll as the game gates it (Car_TA pre-physics FUN_140f1c600): throttle held, no dodge active, fewer
	// than all wheels on world geometry (wheels on the ball or a car don't count), and at least one, or else the body
	// touching the world. RocketSim counted any wheel contact, rolled during dodges, and rolled with all four wheels
	// down whenever the body touched the world. Live: climbing a goal's side wall 0.8 uu/s per tick off; a forward
	// dodge at speed with the front wheels touching, 0.83
	int numWheelsOnWorld = 0;
	for (int i = 0; i < _bulletVehicle.m_wheelInfo.size(); i++)
		numWheelsOnWorld += _bulletVehicle.m_wheelInfo[i].m_raycastInfo.m_isInContact && _bulletVehicle.m_wheelInfo[i].m_isInContactWithWorld;
	if (_inputThrottle && !_internalState.isFlipping && numWheelsOnWorld < _bulletVehicle.m_wheelInfo.size() &&
	    (numWheelsOnWorld > 0 || _internalState.worldContact.hasContact))
		_UpdateAutoRoll(tickTime, mutatorConfig, numWheelsOnWorld);

	_internalState.worldContact.hasContact = false;

	_UpdateStickyForce(forwardSpeed_UU);

	bool wasBoosting = _internalState.isBoosting; // (what the AirControl component sees: it runs before Boost)
	_UpdateBoost(tickTime, mutatorConfig, forwardSpeed_UU);

	// RL PATCH: the game's air throttle (AirControl ApplyForces FUN_140eb3400) is ThrottleForce x (boost active ? 1 :
	// throttle), with the Boost component's state from before this tick's update (the components run AirControl first:
	// static analysis GA-8), so a boost press adds only the boost's own 991.67 on its first tick and the release leaves
	// the throttle's 66.67 for one more (live `ga_boost`: 0.55 uu/s on those ticks). BOOST_ACCEL_AIR includes the full
	// air throttle (991.67 + 66.67), so _UpdateBoost applies the rest; stock RocketSim added throttle x 66.67 on top
	// (boost + throttle in the air was 6% too strong).
	// RL PATCH: the AirControl component is only active with no wheel touching anything (as RocketSim's own air
	// control torque); RocketSim applied the air throttle with up to 2 wheels down. Live: 2 wheels on a wall, 0.56 uu/s
	// per tick too fast
	float airThrottle = wasBoosting ? 1 : _inputThrottle;
	if (numWheelsInContact == 0 && airThrottle != 0)
		_rigidBody.applyCentralForce(GetForwardDir() * airThrottle * RLConst::THROTTLE_AIR_ACCEL * UU_TO_BT * RLConst::CAR_MASS_BT);

	// RL PATCH: the speed caps between the car's own impulses (jump, dodge, auto-flip) and the vehicle's (the game's
	// Bullet caps at the start of its substep, before the vehicle update: _LimitVelocities)
	_LimitVelocities();

	// The vehicle: this tick's wheel rays and contacts, then VehicleSim, the suspension and the wheels' friction
	_bulletVehicle.updateVehicleFirst(tickTime);

	numWheelsInContact = 0;
	for (int i = 0; i < _bulletVehicle.m_wheelInfo.size(); i++) {
		bool inContact = _bulletVehicle.m_wheelInfo[i].m_raycastInfo.m_isInContact;
		_internalState.wheelsWithContact[i] = inContact;
		numWheelsInContact += inContact;
	}
	// RL PATCH: a landing (the game's OnGroundChanged) clears hasJumped (bJumped): see _UpdateJump. If the jump or
	// dodge had been used and at most one wheel is on world geometry (the rest on the ball or a car: IsOnRBActor), it
	// counts as a flip reset (UpdateDodgeAvailable: DodgesRefreshedCounter, which drives the game's indicator)
	if (numWheelsInContact >= 3 && !_internalState.isOnGround) {
		if (_internalState.hasJumped || _internalState.hasDoubleJumped || _internalState.hasFlipped) {
			int wheelsOnWorld = 0;
			for (int i = 0; i < _bulletVehicle.m_wheelInfo.size(); i++)
				wheelsOnWorld += _bulletVehicle.m_wheelInfo[i].m_raycastInfo.m_isInContact && _bulletVehicle.m_wheelInfo[i].m_isInContactWithWorld;
			if (wheelsOnWorld <= 1)
				_internalState.flipResets++;
		}
		_internalState.hasJumped = false;
	}
	_internalState.isOnGround = numWheelsInContact >= 3;

	forwardSpeed_UU = _bulletVehicle.getForwardSpeed() * BT_TO_UU;
	_UpdateWheels(tickTime, mutatorConfig, numWheelsInContact, forwardSpeed_UU);

	_bulletVehicle.updateVehicleSecond(tickTime);
}

void Car::_PostTickUpdate(GameMode gameMode, float tickTime, const MutatorConfig& mutatorConfig) {

	if (_internalState.isDemoed)
		return;

	_internalState.rotMat = _rigidBody.getWorldTransform().m_basis;

	{ // RL PATCH: update supersonic like the game (Car_TA FUN_140f1c600): on from 2200; below that it stays on until
	  // 1 s has been spent below 2200 (TimeBelowSupersonicSpeed, here supersonicTime) or the speed drops under 2100.
	  // RocketSim timed from becoming supersonic, so a car supersonic for over 1 s lost it right below 2200.
		float speedSquared = (_rigidBody.m_linearVelocity * BT_TO_UU).length2();

		if (speedSquared >= RLConst::SUPERSONIC_START_SPEED * RLConst::SUPERSONIC_START_SPEED) {
			_internalState.isSupersonic = true;
			_internalState.supersonicTime = 0;
		} else if (_internalState.isSupersonic) {
			_internalState.supersonicTime += tickTime;
			if (_internalState.supersonicTime >= RLConst::SUPERSONIC_MAINTAIN_MAX_TIME ||
				speedSquared < RLConst::SUPERSONIC_MAINTAIN_MIN_SPEED * RLConst::SUPERSONIC_MAINTAIN_MIN_SPEED)
				_internalState.isSupersonic = false;
		}
	}

	// Update car contact cooldown timer
	// RL PATCH: it runs on to a tick below 0, so the arena can tell a cooldown exactly over (still blocking: the game's
	// test is strict) from one over by a tick (Arena::_BtCallback_OnCarCarCollision)
	if (_internalState.carContact.cooldownTimer > -tickTime)
		_internalState.carContact.cooldownTimer = RS_MAX(_internalState.carContact.cooldownTimer - tickTime, -tickTime);

	_internalState.lastControls = controls;
}

void Car::_FinishPhysicsTick(const MutatorConfig& mutatorConfig) {
	using namespace RLConst;

	if (_internalState.isDemoed)
		return;

	// Add velocity cache
	if (!_velocityImpulseCache.IsZero()) {
		_rigidBody.m_linearVelocity += _velocityImpulseCache;
		_velocityImpulseCache = { 0,0,0 };
	}

	_LimitVelocities();

	// RL PATCH: round the state through the network serializer every tick (bQuantizePhysics)
	Quantize::QuantizeRigidBody(_rigidBody, &_netRotation);
	_internalState.rotMat = _rigidBody.getWorldTransform().m_basis;

	_internalState.tickCountSinceUpdate++;
}

void Car::_BulletSetup(GameMode gameMode, btDynamicsWorld* bulletWorld, const MutatorConfig& mutatorConfig) {
	{ // RL PATCH: this car's steering curves (inner-wheel curves -> inner/outer average for its geometry)
		float wheelbase = config.frontWheels.connectionPointOffset.x - config.backWheels.connectionPointOffset.x;
		float track = config.frontWheels.connectionPointOffset.y * 2;
		_steerAngleCurve = AverageSteerCurve(RLConst::STEER_ANGLE_INNER_FROM_SPEED_CURVE, wheelbase, track);
		_powerslideSteerAngleCurve = AverageSteerCurve(RLConst::POWERSLIDE_STEER_ANGLE_INNER_FROM_SPEED_CURVE, wheelbase, track);
	}

	// Set up rigidbody and collision shapes
	_childHitboxShape = btBoxShape((config.hitboxSize * UU_TO_BT) / 2);
	_compoundShape = btCompoundShape(false, 1);

	btTransform hitboxOffsetTransform = btTransform();
	hitboxOffsetTransform.setIdentity();
	hitboxOffsetTransform.setOrigin(config.hitboxPosOffset * UU_TO_BT);
	_compoundShape.addChildShape(hitboxOffsetTransform, &_childHitboxShape);

	btVector3 localInertia(0, 0, 0);
	_childHitboxShape.calculateLocalInertia(RLConst::CAR_MASS_BT, localInertia);

	btRigidBody::btRigidBodyConstructionInfo rbInfo
		= btRigidBody::btRigidBodyConstructionInfo(RLConst::CAR_MASS_BT, NULL, &_compoundShape, localInertia);

	btTransform carTransform = btTransform();
	carTransform.setIdentity();
	rbInfo.m_startWorldTransform = carTransform;

	_rigidBody = btRigidBody(rbInfo);
	_rigidBody.setUserIndex(BT_USERINFO_TYPE_CAR);
	_rigidBody.setUserPointer(this);
	_rigidBody.setUserIndex3(BT_SORT_KEY_CAR + (int)id); // RL PATCH: sort key

	_rigidBody.m_collisionFlags |= btCollisionObject::CF_CUSTOM_MATERIAL_CALLBACK;

	_rigidBody.m_friction = RLConst::CAR_COLLISION_FRICTION;
	_rigidBody.m_restitution = RLConst::CAR_COLLISION_RESTITUTION;

	// Disable gyroscopic force
	_rigidBody.m_rigidbodyFlags = 0;
	
	// We want our car and our suspension rays to collide with the dropshot floor
	int extraCollisionMask = CollisionMasks::DROPSHOT_FLOOR;

	// Add rigidbody to world
	bulletWorld->addRigidBody(
		&_rigidBody, btBroadphaseProxy::DefaultFilter | extraCollisionMask, btBroadphaseProxy::AllFilter
	);

	{ // Set up actual vehicle stuff
		_bulletVehicleRaycaster = btDefaultVehicleRaycaster(bulletWorld);

		btVehicleRL::btVehicleTuning tuning = btVehicleRL::btVehicleTuning();

		_bulletVehicle = btVehicleRL(tuning, &_rigidBody, &_bulletVehicleRaycaster, bulletWorld, extraCollisionMask);

		// Match RL with X forward, Y right, Z up
		_bulletVehicle.setCoordinateSystem(1, 2, 0);

		// Set up wheel directions with RL coordinate system
		btVector3 wheelDirectionCS(0, 0, -1), wheelAxleCS(0, -1, 0);

		{ // Set up wheels
			int numWheels = 4;//config.threeWheels ? 3 : 4;
			for (int i = 0; i < numWheels; i++) {
				bool front = i < 2;
				if (numWheels == 3)
					front = i == 0;

				bool left = i % 2;

				float radius = front ? config.frontWheels.wheelRadius : config.backWheels.wheelRadius;
				btVector3 wheelRayStartOffset =
					front ? config.frontWheels.connectionPointOffset : config.backWheels.connectionPointOffset;

				if (left)
					wheelRayStartOffset.y() *= -1;

				float suspensionRestLength =
					front ? config.frontWheels.suspensionRestLength : config.backWheels.suspensionRestLength;

				suspensionRestLength -= RLConst::BTVehicle::MAX_SUSPENSION_TRAVEL;

				{ // RL PATCH: the game ignores ray hits within the car's box: half its height (pre-skin) - 1 uu
					float minDist = ((config.hitboxSize.z - 2.5f) / 2 - 1) * UU_TO_BT;
					_bulletVehicle.m_minHitDistSq = minDist * minDist;
				}
				_bulletVehicle.addWheel(
					wheelRayStartOffset * UU_TO_BT,
					wheelDirectionCS, wheelAxleCS,
					suspensionRestLength * UU_TO_BT,
					radius * UU_TO_BT, tuning, true);

				{ // Fix wheel info data
					using namespace RLConst::BTVehicle;

					btWheelInfoRL& wheelInfo = _bulletVehicle.m_wheelInfo[i];
					wheelInfo.m_suspensionStiffness = SUSPENSION_STIFFNESS;
					wheelInfo.m_wheelsDampingCompression = WHEELS_DAMPING_COMPRESSION;
					wheelInfo.m_wheelsDampingRelaxation = WHEELS_DAMPING_RELAXATION;
					wheelInfo.m_maxSuspensionTravelCm = (MAX_SUSPENSION_TRAVEL * UU_TO_BT) * 100; // Same for all cars (hopefully)
					wheelInfo.m_maxSuspensionForce = FLT_MAX; // Don't think there's a limit
					wheelInfo.m_bIsFrontWheel = front;
					// RL PATCH: each wheel carries its share of the car's weight (Bullet vehicle FUN_1402c52a0):
					// mass * |other axle x| / wheelbase / 2 (Octane: 35.735 front, 54.265 back)
					float frontX = config.frontWheels.connectionPointOffset.x, backX = config.backWheels.connectionPointOffset.x;
					wheelInfo.m_suspensionForceScale = RLConst::CAR_MASS_BT * abs(front ? backX : frontX) / (frontX - backX) / 2;
				}
			}
		}
	}

	_internalState.boost = mutatorConfig.carSpawnBoostAmount;
}

bool CarState::HasFlipOrJump() const {
	return 
		isOnGround || 
		(!hasFlipped && !hasDoubleJumped && airTimeSinceJump < RLConst::DOUBLEJUMP_MAX_DELAY);
}

bool CarState::HasFlipReset() const {
	return !isOnGround && HasFlipOrJump() && !hasJumped;
}

bool CarState::GotFlipReset() const {
	return !isOnGround && !hasJumped;
}

void CarState::Serialize(DataStreamOut& out) const {
	ballHitInfo.Serialize(out);

	out.WriteMultiple(
		CARSTATE_SERIALIZATION_FIELDS
	);
	// RL PATCH: the wheel values the next tick uses (written field by field: WriteMultiple passes its arguments by value,
	// so it can't take the contact array, and the carry struct has padding that a raw copy would write)
	for (bool contact : wheelsWithContact)
		out.Write(contact);
	for (const WheelCarry& w : wheelCarry.wheels)
		out.WriteMultiple(w.steerAngle, w.engineForce, w.brake, w.latFriction, w.longFriction, w.extraPushback,
			w.worldContact, w.contactNormal);
}

void CarState::Deserialize(DataStreamIn& in) {

	ballHitInfo.Deserialize(in);

	in.ReadMultiple(
		CARSTATE_SERIALIZATION_FIELDS
	);
	for (bool& contact : wheelsWithContact) // RL PATCH
		in.Read(contact);
	for (WheelCarry& w : wheelCarry.wheels)
		in.ReadMultiple(w.steerAngle, w.engineForce, w.brake, w.latFriction, w.longFriction, w.extraPushback,
			w.worldContact, w.contactNormal);
}

void Car::Serialize(DataStreamOut& out) {
	out.WriteMultiple(CAR_CONTROLS_SERIALIZATION_FIELDS(controls));
	out.WriteMultiple(CAR_CONFIG_SERIALIZATION_FIELDS(config));
	GetState().Serialize(out);
	RawBodyState::From(_rigidBody, _netRotation).Serialize(out); // RL PATCH: exact physics state
}

void Car::_ReadSerialized(DataStreamIn& in, CarControls& controls, CarConfig& config, CarState& state, RawBodyState& body) {
	in.ReadMultiple(CAR_CONTROLS_SERIALIZATION_FIELDS(controls));
	in.ReadMultiple(CAR_CONFIG_SERIALIZATION_FIELDS(config));
	state = CarState();
	state.Deserialize(in);
	body.Deserialize(in); // RL PATCH: exact physics state
}

void Car::_Deserialize(DataStreamIn& in) {
	_ReadSerialized(in, controls, config, _internalState, _loadedBody);
}

void Car::_UpdateWheels(float tickTime, const MutatorConfig& mutatorConfig, int numWheelsInContact, float forwardSpeed_UU) {
	using namespace RLConst;

	float absForwardSpeed_UU = abs(forwardSpeed_UU);

	{ // Increase/decrease handbrake value from input
		if (controls.handbrake) {
			_internalState.handbrakeVal += POWERSLIDE_RISE_RATE * tickTime;
		} else {
			_internalState.handbrakeVal -= POWERSLIDE_FALL_RATE * tickTime;
		}
		_internalState.handbrakeVal = RS_CLAMP(_internalState.handbrakeVal, 0, 1);
	}

	float realThrottle = _inputThrottle; // RL PATCH: with boost only on the ground (see _PreTickUpdate)
	float realBrake = 0;

	{ // Update throttle/brake forces
		float driveSpeedScale = DRIVE_SPEED_TORQUE_FACTOR_CURVE.GetOutput(absForwardSpeed_UU);

		float engineThrottle = realThrottle;

		if (controls.handbrake) {
			// Real throttle is unchanged from the input throttle when powersliding
		} else {
			float absThrottle = abs(realThrottle);

			if (absThrottle > THROTTLE_DEADZONE) {
				if (absForwardSpeed_UU > STOPPING_FORWARD_VEL && RS_SGN(realThrottle) != RS_SGN(forwardSpeed_UU)) {
					// Full brake is applied if we are trying to drive in the opposite direction
					realBrake = 1;

					if (absForwardSpeed_UU > BRAKING_NO_THROTTLE_SPEED_THRESH) {
						// Kill actual throttle (we can't throttle and brake at the same time, even backwards)
						engineThrottle = 0;
					}
				}
			} else {
				// No throttle, we are coasting
				engineThrottle = 0;

				// Apply coasting brake, we full-break when coasting very slowly
				bool shouldFullStop = (absForwardSpeed_UU < STOPPING_FORWARD_VEL);
				realBrake = shouldFullStop ? 1 : COASTING_BRAKE_FACTOR;
			}
		}

		if (numWheelsInContact < 3)
			driveSpeedScale /= 4;

		float driveEngineForce = engineThrottle * (THROTTLE_TORQUE_AMOUNT * UU_TO_BT) * driveSpeedScale;
		float driveBrakeForce = realBrake * (BRAKE_TORQUE_AMOUNT * UU_TO_BT);
		for (int i = 0; i < _bulletVehicle.m_wheelInfo.size(); i++) {
			_bulletVehicle.m_wheelInfo[i].m_engineForce = driveEngineForce;
			_bulletVehicle.m_wheelInfo[i].m_brake = driveBrakeForce;
		}
	}

	if (config.threeWheels) { // Update steering
		float steerAngle = STEER_ANGLE_FROM_SPEED_CURVE_THREEWHEEL.GetOutput(absForwardSpeed_UU);

		if (_internalState.handbrakeVal) {
			steerAngle +=
				(POWERSLIDE_STEER_ANGLE_FROM_SPEED_CURVE.GetOutput(absForwardSpeed_UU) - steerAngle)
				* _internalState.handbrakeVal;
		}

		steerAngle *= ShapeInput(controls.steer, config.steeringSensitivity); // RL PATCH: SteeringSensitivity
		_bulletVehicle.m_wheelInfo[0].m_steerAngle = steerAngle;
		_bulletVehicle.m_wheelInfo[1].m_steerAngle = steerAngle;
	} else {
		// RL PATCH: both front wheels steer by the car's average-angle curve (see AverageSteerCurve)
		float steerAngle = _steerAngleCurve.GetOutput(absForwardSpeed_UU);

		if (_internalState.handbrakeVal) {
			steerAngle +=
				(_powerslideSteerAngleCurve.GetOutput(absForwardSpeed_UU) - steerAngle)
				* _internalState.handbrakeVal;
		}

		steerAngle *= ShapeInput(controls.steer, config.steeringSensitivity); // RL PATCH: SteeringSensitivity
		_bulletVehicle.m_wheelInfo[0].m_steerAngle = steerAngle;
		_bulletVehicle.m_wheelInfo[1].m_steerAngle = steerAngle;
	}

	// RL PATCH: the wheels are turned to this tick's steer angle before their slip is measured (VehicleSim FUN_140f5ff00
	// calls FUN_1402c58b0 between writing the angle and the friction pass); RocketSim measured it along the ray pass's
	// axles, which still had the previous tick's angle
	_bulletVehicle.updateWheelBases();

	{ // Update friction
		for (int i = 0; i < _bulletVehicle.m_wheelInfo.size(); i++) {
			auto& wheel = _bulletVehicle.m_wheelInfo[i];
			if (wheel.m_raycastInfo.m_groundObject) {

				btVector3
					vel = _rigidBody.m_linearVelocity,
					angularVel = _rigidBody.m_angularVelocity;

				btVector3
					latDir = wheel.m_worldTransform.getBasis().getColumn(1),
					longDir = latDir.cross(wheel.m_raycastInfo.m_contactNormalWS);

				float frictionCurveInput = 0;

				btVector3 wheelDelta = wheel.m_raycastInfo.m_hardPointWS - _rigidBody.getWorldTransform().m_origin;

				auto crossVec = (angularVel.cross(wheelDelta) + vel) * BT_TO_UU;

				float baseFriction = abs(crossVec.dot(latDir));

				// Significant friction results in lateral slip
				if (baseFriction > 5)
					frictionCurveInput = baseFriction / (abs(crossVec.dot(longDir)) + baseFriction);

				float latFriction = (config.threeWheels ? LAT_FRICTION_CURVE_THREEWHEEL : LAT_FRICTION_CURVE).GetOutput(frictionCurveInput);
				float longFriction = LONG_FRICTION_CURVE.GetOutput(frictionCurveInput);

				if (_internalState.handbrakeVal) {
					float handbrakeAmount = _internalState.handbrakeVal;

					latFriction *= (HANDBRAKE_LAT_FRICTION_FACTOR_CURVE.GetOutput(frictionCurveInput) - 1) * handbrakeAmount + 1;
					longFriction *= (HANDBRAKE_LONG_FRICTION_FACTOR_CURVE.GetOutput(frictionCurveInput) - 1) * handbrakeAmount + 1;
				} else {
					longFriction = 1; // If we aren't powersliding, it's not scaled down
				}

				// RL PATCH: the wall-grip curve is skipped only on a sticky surface (the arena's materials) with the input
				// throttle non-zero (Wheel_TA FUN_140f588f0: bStickyWheels && Vehicle.Input.Throttle != 0; boosting on the
				// ground counts, see _PreTickUpdate); RocketSim used throttle-or-boost on any surface
				bool isContactSticky = _inputThrottle != 0 && wheel.m_isInContactWithWorld;

				if (isContactSticky) {
					// Keep current friction values
				} else {
					// Scale friction down with non-sticky friction curve
					float nonStickyScale = NON_STICKY_FRICTION_FACTOR_CURVE.GetOutput(wheel.m_raycastInfo.m_contactNormalWS.z());
					latFriction *= nonStickyScale;
					longFriction *= nonStickyScale;
				}

				wheel.m_latFriction = latFriction;
				wheel.m_longFriction = longFriction;
			}
		}
	}
}

// RL PATCH: part of the car's pre-physics step (Vehicle FUN_140eb70a0), so on the wheel contacts the previous tick's
// rays found (still in the wheels: _PreTickUpdate casts this tick's rays after it)
void Car::_UpdateStickyForce(float forwardSpeed_UU) {
	using namespace RLConst;

	bool wheelsHaveWorldContact = false;
	for (int i = 0; i < _bulletVehicle.m_wheelInfo.size(); i++)
		wheelsHaveWorldContact |= _bulletVehicle.m_wheelInfo[i].m_isInContactWithWorld;

	// Update sticky forces if at least 1 wheel has world contact
	if (wheelsHaveWorldContact) {
		btVector3 upwardsDir = _bulletVehicle.getUpwardsDirFromWheelContacts();

		// RL PATCH: the wall share needs the input throttle (Vehicle FUN_140eb70a0: Input.Throttle != 0 or |forward
		// speed| > 25; boosting on the ground counts, see _PreTickUpdate); RocketSim used the throttle including boost
		bool fullStick = (_inputThrottle != 0) || (abs(forwardSpeed_UU) > STOPPING_FORWARD_VEL);

		float stickyForceScale = config.threeWheels ? 0 : 0.5f;
		if (fullStick)
			stickyForceScale += 1 - abs(upwardsDir.z());

		_rigidBody.applyCentralForce(upwardsDir * stickyForceScale * (GRAVITY_Z * UU_TO_BT) * CAR_MASS_BT);
	}
}

void Car::_UpdateBoost(float tickTime, const MutatorConfig& mutatorConfig, float forwardSpeed_UU) {
	using namespace RLConst;

	bool hasBoost = _internalState.boost > 0;

	if (hasBoost) { // Update boosting timer
		if (_internalState.isBoosting) {
			if (controls.boost || _internalState.boostingTime < BOOST_MIN_TIME) {
				// Keep boosting
				_internalState.isBoosting = true;
			} else {
				_internalState.isBoosting = false;
			}
		} else {
			if (controls.boost) {
				// Start boosting
				_internalState.isBoosting = controls.boost;
			}
		}
	} else {
		_internalState.isBoosting = false;
	}

	if (_internalState.isBoosting) {
		_internalState.boostingTime += tickTime;
	} else {
		_internalState.boostingTime = 0;
	}

	// Apply boosting force and consume boost
	if (_internalState.isBoosting) {
		_internalState.boost = RS_MAX(_internalState.boost - mutatorConfig.boostUsedPerSecond * tickTime, 0);
		// RL PATCH: in the air (no wheel touching anything, the AirControl component's activation; RocketSim: below 3
		// wheels) the boost's own force is boostAccelAir less the AirControl component's full throttle, which
		// _PreTickUpdate applies (one tick behind the boost state, as the game)
		bool anyWheelContact = false;
		for (bool contact : _internalState.wheelsWithContact)
			anyWheelContact |= contact;
		_rigidBody.applyCentralForce(
			(anyWheelContact ? mutatorConfig.boostAccelGround : mutatorConfig.boostAccelAir - THROTTLE_AIR_ACCEL) * UU_TO_BT
			* GetForwardDir() * CAR_MASS_BT
		);
		_internalState.timeSinceBoosted = 0;
	} else {
		_internalState.timeSinceBoosted += tickTime;

		// Recharge boost
		if (mutatorConfig.rechargeBoostEnabled)
			if (_internalState.timeSinceBoosted >= mutatorConfig.rechargeBoostDelay)
				_internalState.boost += mutatorConfig.rechargeBoostPerSecond * tickTime;
	}

	_internalState.boost = RS_MIN(_internalState.boost, RLConst::BOOST_MAX);
}

void Car::_UpdateJump(float tickTime, const MutatorConfig& mutatorConfig, bool jumpPressed) {
	using namespace RLConst;

	// RL PATCH: the game's jump rules (CarComponent_Jump_TA, static analysis GA-2): a ground jump needs !bJumped
	// (hasJumped), which clears on a real landing (OnGroundChanged: _PreTickUpdate) or once the jump has been over for
	// JumpLeaveGroundTime with the car still on the ground; releasing the button (bDeactivate) ends the jump once past
	// its minimum time even if it is pressed again. RocketSim started a new ground jump on any press with the wheels
	// down (they touch for up to 6 ticks after a short jump: a second jump) and followed the current button. Live
	// (`ga_jump`): jump 3 ticks, release 1, press again: 304 uu/s off, then 12 per tick
	if (_internalState.isOnGround && !_internalState.isJumping && _internalState.hasJumped &&
	    _internalState.jumpTime >= JUMP_LEAVE_GROUND_TIME)
		_internalState.hasJumped = false;

	if (_internalState.isJumping) {
		_internalState.jumpReleased |= !controls.jump;
		if (_internalState.jumpTime < JUMP_MIN_TIME || (!_internalState.jumpReleased && _internalState.jumpTime < JUMP_MAX_TIME)) {
			// Continue jump
			_internalState.isJumping = true;
		} else {
			// We can't keep jumping any longer
			_internalState.isJumping = false;
			_internalState.jumpTime = 0; // (from now on the time since the jump ended)
		}
	} else if (_internalState.isOnGround && jumpPressed && !_internalState.hasJumped) {
		// Start jumping
		_internalState.isJumping = true;
		_internalState.jumpReleased = false;
		_internalState.jumpTime = 0;
		btVector3 jumpStartForce = GetUpDir() * mutatorConfig.jumpImmediateForce * UU_TO_BT * CAR_MASS_BT;
		_rigidBody.applyCentralImpulse(jumpStartForce);
	}

	if (_internalState.isJumping) {
		_internalState.hasJumped = true;

		// Apply extra long-jump force
		// RL PATCH: the full JumpForce from the press tick on (CarComponent_Jump_TA); RocketSim scaled it by 0.62 for the
		// first 0.025 s. Live recordings: the car gains 4.02 uu/s per tick on the floor from the first tick
		// (1458.33 - gravity - sticky force)
		btVector3 totalJumpForce = GetUpDir() * mutatorConfig.jumpAccel;
		_rigidBody.applyCentralForce(totalJumpForce * UU_TO_BT * CAR_MASS_BT);
	}

	if (_internalState.isJumping || _internalState.hasJumped) {
		_internalState.jumpTime += tickTime;
	}
}

void Car::_UpdateAirTorque(float tickTime, const MutatorConfig& mutatorConfig, bool updateAirControl) {
	using namespace RLConst;

	btVector3
		dirPitch_right = -GetRightDir(),
		dirYaw_up = GetUpDir(),
		dirRoll_forward = -GetForwardDir();

	// RL PATCH: air control also runs during a dodge, with the pitch input taken as 0 (AirControl ApplyForces
	// FUN_140eb3400; pitchTorqueScale below): yaw and roll steer, and all three axes are damped. RocketSim switched
	// it off for the dodge unless it was cancelled. Live recordings: the yaw torque on a side flip's press tick and the
	// pitch damping on the next ticks (1.867 rad/s x 30 x CAR_TORQUE_SCALE = 0.045 rad/s per tick)
	bool doAirControl = true;
	if (_internalState.isFlipping)
		_internalState.isFlipping = _internalState.hasFlipped && _internalState.flipTime < FLIP_TORQUE_TIME;

	if (_internalState.isFlipping) {

		btVector3 relDodgeTorque = _internalState.flipRelTorque;

		if (!_internalState.flipRelTorque.IsZero()) {
			// Flip cancel check
			float pitchScale = 1;

			// RL PATCH: the pitch part can only be cancelled once the dodge has been active for
			// MinDodgeTorqueTime (0.041 s), checked with the same active time as the Z damping (the time
			// before this tick, see _UpdateFlipTime)
			// (the dodge's forward input, C-2: a cancel pulls against it)
			float dodgeForward = _DodgeForward();
			if (relDodgeTorque.y() != 0 && dodgeForward != 0 && _internalState.flipTime >= FLIP_TORQUE_MIN_TIME) {
				if (RS_SGN(relDodgeTorque.y()) == RS_SGN(-dodgeForward)) {

#ifndef RS_MAX_SPEED
					pitchScale = 1 - RS_MIN(abs(dodgeForward), 1); // Sanity clamp
#else
					pitchScale = 1 - abs(dodgeForward); // No sanity check
#endif
				}
			}

			relDodgeTorque.y() *= pitchScale;

			btVector3 dodgeTorque = relDodgeTorque * btVector3(FLIP_TORQUE_X, FLIP_TORQUE_Y, 0);
			_rigidBody.applyTorque(_rigidBody.m_invInertiaTensorWorld.inverse() * _rigidBody.getWorldTransform().m_basis * dodgeTorque);
		}
	}

	// RL PATCH: air control stays on during an auto-flip (the AirControl component is active with no wheel touching;
	// static analysis GA-3): its damping holds the flip at 5.29 rad/s, not 5.5, and the player's input acts. Live
	// (`ga_autoflip`): 0.21 rad/s per tick off
	doAirControl &= updateAirControl;
	if (doAirControl) {

		float pitchTorqueScale = 1;

		// RL PATCH: air control uses shaped inputs (AirControlSensitivity); the air pitch safety zeroes pitch here only
		float
			airPitch = controls.airPitchSafety ? 0 : ShapeInput(controls.pitch, config.airControlSensitivity),
			airYaw = ShapeInput(controls.yaw, config.airControlSensitivity),
			airRoll = ShapeInput(controls.roll, config.airControlSensitivity);

		btVector3 torque;
		if (airPitch || airYaw || airRoll) {

			if (_internalState.isFlipping) {
				pitchTorqueScale = 0;
			} else if (_internalState.hasFlipped) {
				// Extra pitch lock after flip has finished
				if (_internalState.flipTime < FLIP_TORQUE_TIME + FLIP_PITCHLOCK_EXTRA_TIME)
					pitchTorqueScale = 0;
			}
			if (_internalState.dodgePitchLockTime > tickTime / 2) // RL PATCH: after a dodge ended by landing (GA-5)
				pitchTorqueScale = 0;

			// TODO: Use actual dot product operator functions (?)
			torque = (airPitch * dirPitch_right * pitchTorqueScale * CAR_AIR_CONTROL_TORQUE.x) +
				(airYaw * dirYaw_up * CAR_AIR_CONTROL_TORQUE.y) +
				(airRoll * dirRoll_forward * CAR_AIR_CONTROL_TORQUE.z);
		} else {
			torque = { 0, 0, 0 };
		}

		auto angVel = _rigidBody.m_angularVelocity;

		// TODO: Use actual dot product operator functions (?)
		float
			dampPitch = dirPitch_right.dot(angVel) * CAR_AIR_CONTROL_DAMPING.x * (1 - abs(doAirControl ? (airPitch * pitchTorqueScale) : 0)),
			dampYaw = dirYaw_up.dot(angVel) * CAR_AIR_CONTROL_DAMPING.y * (1 - abs(doAirControl ? airYaw : 0)),
			dampRoll = dirRoll_forward.dot(angVel) * CAR_AIR_CONTROL_DAMPING.z;

		btVector3 damping =
			(dirYaw_up * dampYaw) +
			(dirPitch_right * dampPitch) +
			(dirRoll_forward * dampRoll);
		_rigidBody.applyTorque(_rigidBody.m_invInertiaTensorWorld.inverse() * (torque - damping) * CAR_TORQUE_SCALE);
	}

	// (air throttle: applied after the boost update, see _PreTickUpdate)
}

void Car::_UpdateDoubleJumpOrFlip(float tickTime, const MutatorConfig& mutatorConfig, bool jumpPressed, float forwardSpeed_UU) {
	using namespace RLConst;

	float tickTimeScale = tickTime / (1 / 120.f);

	if (_internalState.isOnGround) {
		// RL PATCH: landing ends a dodge still active: its pitch lock goes on for 0.3 s (GA-5)
		if (_internalState.isFlipping)
			_internalState.dodgePitchLockTime = FLIP_PITCHLOCK_EXTRA_TIME;
		_internalState.hasDoubleJumped = false;
		_internalState.hasFlipped = false;
		_internalState.airTime = 0;
		_internalState.airTimeSinceJump = 0;
		_internalState.flipTime = 0;
	} else {
		_internalState.airTime += tickTime;

		if (_internalState.hasJumped && !_internalState.isJumping) {
			_internalState.airTimeSinceJump += tickTime;
		} else {
			_internalState.airTimeSinceJump = 0;
		}

		if (jumpPressed && _internalState.airTimeSinceJump < DOUBLEJUMP_MAX_DELAY) {
			float inputMagnitude = abs(controls.yaw) + abs(_DodgeForward()) + abs(controls.roll); // (RL PATCH C-2)
			bool isFlipInput = inputMagnitude >= config.dodgeDeadzone;

			bool canUse;

			if (isFlipInput) {
				canUse = (!_internalState.hasDoubleJumped && !_internalState.hasFlipped) || mutatorConfig.unlimitedFlips;
			} else {
				canUse = (!_internalState.hasDoubleJumped && !_internalState.hasFlipped) || mutatorConfig.unlimitedDoubleJumps;
			}

			if (_internalState.isAutoFlipping)
				canUse = false;

			if (canUse) {
				if (isFlipInput) {
					// Begin flipping
					_internalState.flipTime = 0;
					_internalState.hasFlipped = true;
					_internalState.isFlipping = true;

					// Apply initial dodge vel and set later dodge vel
					// Replicated based on https://github.com/samuelpmish/RLUtilities/blob/develop/src/simulation/car.cc
					{
						float forwardSpeedRatio = abs(forwardSpeed_UU) / CAR_MAX_SPEED;

						// RL PATCH: as the game's GetDodgeImpulse (FUN_140eef310, static analysis GA-7): the direction
						// normalised, then each component of 0.1 or less zeroed. RocketSim zeroed the direction when both
						// inputs were under 0.1 before normalising, so yaw 0.95 + roll -1 (side -0.05) had no impulse; the
						// game's is a full side dodge. Live (`ga_jump`): 500 uu/s off
						btVector3 dodgeDir = btVector3(_DodgeForward(), controls.yaw + controls.roll, 0);
						float dodgeLengthSq = dodgeDir.length2();
						dodgeDir = (dodgeLengthSq >= 1e-8f) ? dodgeDir / sqrtf(dodgeLengthSq) : btVector3(0, 0, 0);
						for (int k = 0; k < 2; k++)
							if (abs(dodgeDir[k]) <= 0.1f)
								dodgeDir[k] = 0;

						{
							// RL PATCH: CarComponent_Dodge_TA.SetDodgeSettings:
							// DodgeDirection = Normal(-pitch, yaw + roll) (no deadzone),
							// DodgeTorque = Round(224 * dir.X) pitch, Round(260 * -dir.Y) roll
							Vec torqueDir = Vec(_DodgeForward(), controls.yaw + controls.roll, 0);
							float lengthSq = torqueDir.LengthSq();
							torqueDir = (lengthSq >= 1e-8f) ? torqueDir / sqrtf(lengthSq) : Vec(0, 0, 0);

							auto roundUE = [](float val) { return floorf(val + 0.5f); };
							float torqueRoll = roundUE(FLIP_TORQUE_X * -torqueDir.y);
							float torquePitch = roundUE(FLIP_TORQUE_Y * torqueDir.x);

							_internalState.flipRelTorque =
								btVector3(torqueRoll / FLIP_TORQUE_X / tickTimeScale, torquePitch / FLIP_TORQUE_Y / tickTimeScale, 0);
						}

						if (abs(dodgeDir.x()) < 0.1f) dodgeDir.x() = 0;
						if (abs(dodgeDir.y()) < 0.1f) dodgeDir.y() = 0;

						if (!dodgeDir.fuzzyZero()) {
							bool shouldDodgeBackwards;

							if (abs(forwardSpeed_UU) < 100.0f) {
								shouldDodgeBackwards = dodgeDir.x() < 0.0f;
							} else {
								shouldDodgeBackwards = (dodgeDir.x() >= 0.0f) != (forwardSpeed_UU >= 0.0f);
							}

							Vec initalDodgeVel = dodgeDir * FLIP_INITIAL_VEL_SCALE;

							float maxSpeedScaleX =
								shouldDodgeBackwards ? FLIP_BACKWARD_IMPULSE_MAX_SPEED_SCALE : FLIP_FORWARD_IMPULSE_MAX_SPEED_SCALE;

							initalDodgeVel.x *= ((maxSpeedScaleX - 1) * forwardSpeedRatio) + 1.f;
							initalDodgeVel.y *= ((FLIP_SIDE_IMPULSE_MAX_SPEED_SCALE - 1) * forwardSpeedRatio) + 1.f;

							if (shouldDodgeBackwards)
								initalDodgeVel.x *= FLIP_BACKWARD_IMPULSE_SCALE_X;

							Vec forwardDir2D = GetForwardDir().To2D().Normalized();
							Vec rightDir2D = Vec(-forwardDir2D.y, forwardDir2D.x, 0.f);

							Vec finalDeltaVel = initalDodgeVel.x * forwardDir2D + initalDodgeVel.y * rightDir2D;

							_rigidBody.applyCentralImpulse(finalDeltaVel * UU_TO_BT * CAR_MASS_BT);
						}
					}

				} else {
					// Double jump, add upwards velocity
					btVector3 jumpStartForce = GetUpDir() * JUMP_IMMEDIATE_FORCE * UU_TO_BT * CAR_MASS_BT;
					_rigidBody.applyCentralImpulse(jumpStartForce);

					_internalState.hasDoubleJumped = true;
				}
			}
		}
	}

}

// RL PATCH: the dodge component's forces get the time it has been active before this tick (0 on its press tick,
// CarComponent_Dodge_TA FUN_140eb72b0): its torque and Z damping run while that is under 0.65 s, the damping from
// 0.15 s (while rising only until 0.21 s), and the clock advances after. RocketSim advanced it first, so the damping
// started and ended a tick early. Live recordings: damping from the 18th tick after the press to the 78th.
void Car::_UpdateFlipTime(float tickTime) {
	using namespace RLConst;

	float tickTimeScale = tickTime / (1 / 120.f);

	if (_internalState.isFlipping) {
		if (_internalState.flipTime <= FLIP_TORQUE_TIME) {
			if (_internalState.flipTime >= FLIP_Z_DAMP_START && (_rigidBody.m_linearVelocity.z() < 0 || _internalState.flipTime < FLIP_Z_DAMP_END)) {
				_rigidBody.m_linearVelocity.z() *= det_powf(1 - FLIP_Z_DAMP_120, tickTimeScale);
			}
		}
		_internalState.flipTime += tickTime;
	} else if (_internalState.hasFlipped) {
		// Increment flip time even after we are done flipping
		// We need to count the time after for FLIP_PITCHLOCK_EXTRA_TIME to work
		_internalState.flipTime += tickTime;
	}
	_internalState.dodgePitchLockTime = RS_MAX(_internalState.dodgePitchLockTime - tickTime, 0); // RL PATCH (GA-5)
}

void Car::_UpdateAutoFlip(float tickTime, const MutatorConfig& mutatorConfig, bool jumpPressed) {
	using namespace RLConst;

	// RL PATCH: the game's FlipCar component (static analysis GA-3): it activates on a jump press with the dodge
	// inactive and no auto-flip running, when the body touches the world with a contact normal of z > 0.707 and the
	// car's up within 15 degrees of the normal's opposite (CanActivate); it ends when the car is on the ground (3+
	// wheels) or by its timer, CAR_AUTOFLIP_TIME x |world roll| / pi (live: 48 ticks on a flat roof, 40 roof down on
	// the side curve at world roll 150). RocketSim activated on |world roll| > 2.8 rad (no flip roof down on a curve,
	// a flip at 160-165 degrees on flat ground, where the game double jumps), could restart mid-flip and ran the timer
	// only. Live (`ga_autoflip`, roof down on the 30-degree side curve): 110 uu/s off
	if (
		jumpPressed &&
		!_internalState.isAutoFlipping && !_internalState.isFlipping &&
		_internalState.worldContact.hasContact &&
		_internalState.worldContact.contactNormal.z > CAR_AUTOFLIP_NORMZ_THRESH &&
		_internalState.worldContact.contactNormal.Dot(GetUpDir()) < CAR_AUTOFLIP_UP_DOT_THRESH
		) {

		// TODO: Slow :(
		Angle angles = Angle::FromRotMat(_internalState.rotMat);

		float absRoll = abs(angles.roll);
		_internalState.autoFlipTimer = CAR_AUTOFLIP_TIME * (absRoll / M_PI);
		_internalState.autoFlipTorqueScale = (angles.roll > 0) ? 1 : -1;
		_internalState.isAutoFlipping = true;

		_rigidBody.applyCentralImpulse(-GetUpDir() * CAR_AUTOFLIP_IMPULSE * UU_TO_BT * CAR_MASS_BT);
	}
}

// RL PATCH: the FlipCar component's force (an angular-velocity change), applied after the other components' (its
// ApplyForces runs last: AirControl first, so air control's damping works on the angular velocity from before it)
void Car::_UpdateAutoFlipTorque(float tickTime) {
	using namespace RLConst;

	if (_internalState.isAutoFlipping) {
		if (_internalState.autoFlipTimer <= 0 || _internalState.isOnGround) {
			_internalState.isAutoFlipping = false;
			_internalState.autoFlipTimer = 0;
		} else {
			// RL PATCH: FlipCarTorque is applied as an angular-velocity change of 1000 every tick,
			// which the car's max angular speed (5.5 rad/s) caps at once
			btVector3 angVel = _rigidBody.m_angularVelocity +
				GetForwardDir() * CAR_AUTOFLIP_ANGVEL_CHANGE * _internalState.autoFlipTorqueScale;
			if (angVel.length2() > CAR_MAX_ANG_SPEED * CAR_MAX_ANG_SPEED)
				angVel = angVel.normalized() * CAR_MAX_ANG_SPEED;
			_rigidBody.m_angularVelocity = angVel;

			_internalState.autoFlipTimer -= tickTime;
		}
	}
}

void Car::_UpdateAutoRoll(float tickTime, const MutatorConfig& mutatorConfig, int numWheelsInContact) {
	using namespace RLConst;

	btVector3 groundUpDir;
	if (numWheelsInContact > 0) {
		groundUpDir = _bulletVehicle.getUpwardsDirFromWheelContacts();
	} else {
		groundUpDir = _internalState.worldContact.contactNormal;
	}

	btVector3 groundDownDir = -groundUpDir;

	btVector3
		forwardDir = GetForwardDir(),
		rightDir = GetRightDir(),
		upDir = GetUpDir();
	
	btVector3
		crossRightDir = groundUpDir.cross(forwardDir),
		crossForwardDir = groundDownDir.cross(crossRightDir);

	float
		rightTorqueFactor = 1 - RS_CLAMP(rightDir.dot(crossRightDir), 0, 1),
		forwardTorqueFactor = 1 - RS_CLAMP(forwardDir.dot(crossForwardDir), 0, 1);

	Vec
		torqueDirRight = forwardDir * (rightDir.dot(groundUpDir) >= 0 ? -1 : 1),
		torqueDirForward = rightDir * (forwardDir.dot(groundUpDir) >= 0 ? 1 : -1);

	Vec torqueRight = torqueDirRight * rightTorqueFactor;
	Vec torqueForward = torqueDirForward * forwardTorqueFactor;

	_rigidBody.applyCentralForce(groundDownDir * RLConst::CAR_AUTOROLL_FORCE * UU_TO_BT * CAR_MASS_BT);
	_rigidBody.applyTorque(_rigidBody.m_invInertiaTensorWorld.inverse() * (torqueForward + torqueRight) * RLConst::CAR_AUTOROLL_TORQUE);
}

RS_NS_END
