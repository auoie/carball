#include "btVehicleRL.h"
#include "../../RLConst.h"
#define ROLLING_INFLUENCE_FIX

#include "../../../libsrc/bullet3-3.24/BulletDynamics/Dynamics/btDynamicsWorld.h"
#include "../../../libsrc/bullet3-3.24/BulletDynamics/ConstraintSolver/btContactConstraint.h"

RS_NS_START

// RL PATCH (31): the vehicle as the game's Bullet vehicle does it (update FUN_1402c5340: ray FUN_1402c3b50, contact
// pass FUN_1402c3360, VehicleSim hook, suspension FUN_1402c2a40, friction FUN_1402c49d0; wheels set up in
// FUN_140f044e0). Replays confirm it (notes/validation.md).

// Closest hit per collision object (the game tests each candidate object on its own, FUN_1402c3b50)
struct PerObjectRayCallback : public btCollisionWorld::RayResultCallback {
	struct Hit {
		const btCollisionObject* obj;
		btScalar fraction;
		btVector3 normal;
	};
	Hit hits[16];
	int count = 0;

	btScalar addSingleResult(btCollisionWorld::LocalRayResult& r, bool normalInWorldSpace) override {
		int i = 0;
		while (i < count && hits[i].obj != r.m_collisionObject) i++;
		if (i == count) {
			if (count == 16) return 1;
			hits[count++] = { r.m_collisionObject, 2, btVector3(0, 0, 0) };
		}
		if (r.m_hitFraction < hits[i].fraction) {
			hits[i].fraction = r.m_hitFraction;
			hits[i].normal = normalInWorldSpace ? r.m_hitNormalLocal : r.m_collisionObject->getWorldTransform().getBasis() * r.m_hitNormalLocal;
		}
		m_collisionObject = r.m_collisionObject;
		return 1; // keep receiving every hit
	}
};

btVehicleRL::btVehicleRL(
	const btVehicleTuning& tuning, 
	btRigidBody* chassis, btVehicleRaycaster* raycaster, btDynamicsWorld* world, 
	int addedRayCollisionMask
) : m_vehicleRaycaster(raycaster), m_pitchControl(0),  m_dynamicsWorld(world) {
	m_chassisBody = chassis;
	m_indexRightAxis = 0;
	m_indexUpAxis = 2;
	m_indexForwardAxis = 1;
	m_vehicleRaycaster->addedFilterMask = addedRayCollisionMask;
	defaultInit(tuning);
}

void btVehicleRL::defaultInit(const btVehicleTuning& tuning) {
	(void)tuning;
	m_steeringValue = 0;
}

btVehicleRL::~btVehicleRL() {
}

//
// basically most of the code is general for 2 or 4 wheel vehicles, but some of it needs to be reviewed
//
btWheelInfoRL& btVehicleRL::addWheel(const btVector3& connectionPointCS, const btVector3& wheelDirectionCS0, const btVector3& wheelAxleCS, float suspensionRestLength, float wheelRadius, const btVehicleTuning& tuning, bool isFrontWheel) {
	btWheelInfoConstructionInfo ci;

	ci.m_chassisConnectionCS = connectionPointCS;
	ci.m_wheelDirectionCS = wheelDirectionCS0;
	ci.m_wheelAxleCS = wheelAxleCS;
	ci.m_suspensionRestLength = suspensionRestLength;
	ci.m_wheelRadius = wheelRadius;
	ci.m_suspensionStiffness = tuning.m_suspensionStiffness;
	ci.m_wheelsDampingCompression = tuning.m_suspensionCompression;
	ci.m_wheelsDampingRelaxation = tuning.m_suspensionDamping;
	ci.m_frictionSlip = tuning.m_frictionSlip;
	ci.m_bIsFrontWheel = isFrontWheel;
	ci.m_maxSuspensionTravelCm = tuning.m_maxSuspensionTravelCm;
	ci.m_maxSuspensionForce = tuning.m_maxSuspensionForce;

	m_wheelInfo.push_back(btWheelInfoRL(ci));

	btWheelInfoRL& wheel = m_wheelInfo[getNumWheels() - 1];

	updateWheelTransformsWS(wheel);
	updateWheelTransform(getNumWheels() - 1);
	return wheel;
}

const btTransform& btVehicleRL::getWheelTransformWS(int wheelIndex) const {
	btAssert(wheelIndex < getNumWheels());
	const btWheelInfoRL& wheel = m_wheelInfo[wheelIndex];
	return wheel.m_worldTransform;
}

// See: I20 or I21
void btVehicleRL::updateWheelTransform(int wheelIndex) {
	btWheelInfoRL& wheel = m_wheelInfo[wheelIndex];
	updateWheelTransformsWS(wheel);
	btVector3 up = -wheel.m_raycastInfo.m_wheelDirectionWS;
	const btVector3& right = wheel.m_raycastInfo.m_wheelAxleWS;
	btVector3 fwd = up.cross(right);
	fwd = fwd.normalize();
	//	up = right.cross(fwd);
	//	up.normalize();

	btQuaternion steeringOrn(up, wheel.m_steerAngle);
	btMatrix3x3 steeringMat(steeringOrn);

	btMatrix3x3 basis2;
	basis2[0][m_indexRightAxis] = -right[0];
	basis2[1][m_indexRightAxis] = -right[1];
	basis2[2][m_indexRightAxis] = -right[2];

	basis2[0][m_indexUpAxis] = up[0];
	basis2[1][m_indexUpAxis] = up[1];
	basis2[2][m_indexUpAxis] = up[2];

	basis2[0][m_indexForwardAxis] = fwd[0];
	basis2[1][m_indexForwardAxis] = fwd[1];
	basis2[2][m_indexForwardAxis] = fwd[2];
	wheel.m_worldTransform.setBasis(steeringMat * basis2);
	wheel.m_worldTransform.setOrigin(
		wheel.m_raycastInfo.m_hardPointWS + wheel.m_raycastInfo.m_wheelDirectionWS * wheel.m_raycastInfo.m_suspensionLength);
}

void btVehicleRL::resetSuspension() {
	int i;
	for (i = 0; i < m_wheelInfo.size(); i++) {
		btWheelInfoRL& wheel = m_wheelInfo[i];
		wheel.m_raycastInfo.m_suspensionLength = wheel.getSuspensionRestLength();
		wheel.m_suspensionRelativeVelocity = 0;

		wheel.m_raycastInfo.m_contactNormalWS = -wheel.m_raycastInfo.m_wheelDirectionWS;
		wheel.m_clippedInvContactDotSuspension = 1;
		wheel.m_extraPushback = 0;
	}
}

// See: I20 or I21
void btVehicleRL::updateWheelTransformsWS(btWheelInfoRL& wheel) {
	wheel.m_raycastInfo.m_isInContact = false;
	wheel.m_isInContactWithWorld = false;

	btTransform chassisTrans = getChassisWorldTransform();
	wheel.m_raycastInfo.m_hardPointWS = chassisTrans(wheel.m_chassisConnectionPointCS);
	wheel.m_raycastInfo.m_wheelDirectionWS = chassisTrans.getBasis() * wheel.m_wheelDirectionCS;
	wheel.m_raycastInfo.m_wheelAxleWS = chassisTrans.getBasis() * wheel.m_wheelAxleCS;
}

float btVehicleRL::rayCast(btWheelInfoRL& wheel) {
	updateWheelTransformsWS(wheel);

	float depth = -1;
	wheel.m_extraPushback = 0; // RL PATCH: recomputed every tick (RocketSim kept it until the ray missed)

	float suspensionTravel = wheel.m_maxSuspensionTravelCm / 100;
	// RL PATCH: radius + rest + travel (RocketSim subtracted the 2.5 uu max raise here too)
	float realRayLength = wheel.getSuspensionRestLength() + suspensionTravel + wheel.m_wheelsRadius;

	// See: I21
	btVector3 source = wheel.m_raycastInfo.m_hardPointWS;
	btVector3 target = source + (wheel.m_raycastInfo.m_wheelDirectionWS * realRayLength);
	wheel.m_raycastInfo.m_contactPointWS = target;
	wheel.m_raycastInfo.m_groundObject = NULL;

	// See: I22
	btVehicleRaycaster::btVehicleRaycasterResult rayResults;
	
	btAssert(m_vehicleRaycaster);
	// RL PATCH: each object's closest hit, ignored when it is within the car's box (closer than m_minHitDistSq)
	btCollisionObject* object;
	{
		PerObjectRayCallback cb;
		cb.m_ignoreObj = m_chassisBody;
		cb.m_collisionFilterGroup |= m_vehicleRaycaster->addedFilterMask;
		m_dynamicsWorld->rayTest(source, target, cb);
		object = nullptr;
		float best = 2;
		for (int i = 0; i < cb.count; i++) {
			const btRigidBody* body = btRigidBody::upcast(cb.hits[i].obj);
			if (!body || !body->hasContactResponse()) continue;
			btVector3 hit = source.lerp(target, cb.hits[i].fraction);
			if ((hit - source).length2() < m_minHitDistSq) continue;
			if (cb.hits[i].fraction < best) {
				best = cb.hits[i].fraction;
				object = (btCollisionObject*)cb.hits[i].obj;
				rayResults.m_hitPointInWorld = hit;
				rayResults.m_hitNormalInWorld = cb.hits[i].normal.normalized();
				rayResults.m_distFraction = best;
			}
		}
	}

	// See: I23
	if (object) {
		wheel.m_raycastInfo.m_contactPointWS = rayResults.m_hitPointInWorld;
		float fraction = rayResults.m_distFraction;
		depth = realRayLength * rayResults.m_distFraction;
		wheel.m_raycastInfo.m_contactNormalWS = rayResults.m_hitNormalInWorld;
		wheel.m_raycastInfo.m_isInContact = true;
		wheel.m_isInContactWithWorld = object->isStaticObject();

		wheel.m_raycastInfo.m_groundObject = object;

		float wheelTraceLenSq = (wheel.m_raycastInfo.m_hardPointWS - wheel.m_raycastInfo.m_contactPointWS).dot(getUpVector());
		wheel.m_raycastInfo.m_suspensionLength = wheelTraceLenSq - wheel.m_wheelsRadius;

		//clamp on max suspension travel
		// RL PATCH: not clamped to the travel (the ray's length and minimum hit distance bound it)

		float denominator = wheel.m_raycastInfo.m_contactNormalWS.dot(getUpVector());

		btVector3 relpos = wheel.m_raycastInfo.m_contactPointWS - m_chassisBody->getWorldTransform().m_origin;
		wheel.m_velAtContactPoint = m_chassisBody->getVelocityInLocalPoint(relpos);

		float projVel = wheel.m_raycastInfo.m_contactNormalWS.dot(wheel.m_velAtContactPoint);

		if (denominator > 0.1) {
			float inv = 1 / denominator;
			wheel.m_suspensionRelativeVelocity = projVel * inv;
			wheel.m_clippedInvContactDotSuspension = inv;
		} else {
			// Denominator is too tiny to be meaningful
			wheel.m_suspensionRelativeVelocity = 0;
			wheel.m_clippedInvContactDotSuspension = 10;
		}

		if (object->isStaticObject()) { // Compute m_extraPushback when colliding with static object
			float rayPushbackThresh = (wheel.m_suspensionRestLength1 + wheel.m_wheelsRadius) - RLConst::BTVehicle::SUSPENSION_SUBTRACTION;
			if (wheelTraceLenSq < rayPushbackThresh) {

				float wheelTraceDistDelta = wheelTraceLenSq - rayPushbackThresh;
				// RL PATCH: the game passes a default solver info (static, so 1/60 s and erp 0.2), not the world's (1/120 s,
				// which doubled the pushback's penetration term)
				static const btContactSolverInfo gameSolverInfo;
				float collisionResult = resolveSingleCollision(
					m_chassisBody,
					object,
					rayResults.m_hitPointInWorld,
					rayResults.m_hitNormalInWorld,
					gameSolverInfo,
					wheelTraceDistDelta,
					false
				);

				wheel.m_extraPushback = collisionResult / getNumWheels();
			}
		}

	} else {
		wheel.m_raycastInfo.m_suspensionLength = wheel.getSuspensionRestLength() + suspensionTravel;
		wheel.m_suspensionRelativeVelocity = 0;
		wheel.m_raycastInfo.m_contactNormalWS = -wheel.m_raycastInfo.m_wheelDirectionWS;
		wheel.m_clippedInvContactDotSuspension = 1;
		wheel.m_extraPushback = 0;
	}

	return depth;
}

const btTransform& btVehicleRL::getChassisWorldTransform() const {
	return getRigidBody()->getCenterOfMassTransform();
}

void btVehicleRL::updateVehicleFirst(float step) {

	for (int i = 0; i < getNumWheels(); i++)
		updateWheelTransform(i);

	//
	// simulate suspension
	//

	for (int i = 0; i < m_wheelInfo.size(); i++)
		rayCast(m_wheelInfo[i]);
}

void btVehicleRL::updateWheelBases() {
	for (int i = 0; i < getNumWheels(); i++) {
		btWheelInfoRL& wheel = m_wheelInfo[i];
		bool contact = wheel.m_raycastInfo.m_isInContact, world = wheel.m_isInContactWithWorld;
		updateWheelTransform(i); // (also resets the contact flags: keep them)
		wheel.m_raycastInfo.m_isInContact = contact;
		wheel.m_isInContactWithWorld = world;
	}
}

void btVehicleRL::updateVehicleSecond(float step) {
	// RL PATCH: the wheels' friction uses this tick's VehicleSim values (steering, engine, brake, friction) and the
	// velocities after the suspension impulse. RocketSim computed it before both, from the previous tick's values.
	updateWheelBases(); // this tick's steering
	updateSuspension(step);
	calcFrictionImpulses(step);
	applyFrictionImpulses(step);
}

void btVehicleRL::setSteeringValue(float steering, int wheel) {
	btAssert(wheel >= 0 && wheel < getNumWheels());

	btWheelInfoRL& wheelInfo = getWheelInfo(wheel);
	wheelInfo.m_steering = steering;
}

float btVehicleRL::getSteeringValue(int wheel) const {
	return getWheelInfo(wheel).m_steering;
}

void btVehicleRL::applyEngineForce(float force, int wheel) {
	btAssert(wheel >= 0 && wheel < getNumWheels());
	btWheelInfoRL& wheelInfo = getWheelInfo(wheel);
	wheelInfo.m_engineForce = force;
}

const btWheelInfoRL& btVehicleRL::getWheelInfo(int index) const {
	btAssert((index >= 0) && (index < getNumWheels()));

	return m_wheelInfo[index];
}

btWheelInfoRL& btVehicleRL::getWheelInfo(int index) {
	btAssert((index >= 0) && (index < getNumWheels()));

	return m_wheelInfo[index];
}

void btVehicleRL::setBrake(float brake, int wheelIndex) {
	btAssert((wheelIndex >= 0) && (wheelIndex < getNumWheels()));
	getWheelInfo(wheelIndex).m_brake = brake;
}

// See: I24
void btVehicleRL::updateSuspension(float deltaTime) {
	
	for (int i = 0; i < getNumWheels(); i++) {
		btWheelInfoRL& wheel_info = m_wheelInfo[i];

		if (wheel_info.m_raycastInfo.m_isInContact) {
			float force =
				(wheel_info.getSuspensionRestLength() - wheel_info.m_raycastInfo.m_suspensionLength)
				* wheel_info.m_suspensionStiffness * wheel_info.m_clippedInvContactDotSuspension;
			
			float dampingVelScale = (wheel_info.m_suspensionRelativeVelocity < 0) ? wheel_info.m_wheelsDampingCompression : wheel_info.m_wheelsDampingRelaxation;

			wheel_info.m_wheelsSuspensionForce = force - (dampingVelScale * wheel_info.m_suspensionRelativeVelocity);
			wheel_info.m_wheelsSuspensionForce *= wheel_info.m_suspensionForceScale;

			// RL never uses downwards suspension forces
			if (wheel_info.m_wheelsSuspensionForce < 0)
				wheel_info.m_wheelsSuspensionForce = 0;

		} else {
			wheel_info.m_wheelsSuspensionForce = 0;
		}
	}

	for (int i = 0; i < getNumWheels(); i++) {
		btWheelInfoRL& wheel = m_wheelInfo[i];
		if (wheel.m_wheelsSuspensionForce != 0) {
			btVector3 contactPointOffset = wheel.m_raycastInfo.m_contactPointWS - getRigidBody()->getCenterOfMassPosition();
			float baseForceScale = (wheel.m_wheelsSuspensionForce * deltaTime) + wheel.m_extraPushback;
			btVector3 force = wheel.m_raycastInfo.m_contactNormalWS * baseForceScale;
			m_chassisBody->applyImpulse(force, contactPointOffset);
		}
	}

	// RL PATCH: each wheel touching a dynamic body pushes it into its surface at the contact point, and wakes it (the
	// game's vehicle update, FUN_1402c3360 / FUN_1402c2a40 family; RocketSim's vehicle never touched the ground body)
	for (int i = 0; i < getNumWheels(); i++) {
		btWheelInfoRL& wheel = m_wheelInfo[i];
		if (!wheel.m_raycastInfo.m_isInContact || !wheel.m_raycastInfo.m_groundObject) continue;
		btRigidBody* ground = btRigidBody::upcast((btCollisionObject*)wheel.m_raycastInfo.m_groundObject);
		if (!ground || ground->isStaticOrKinematicObject()) continue;
		ground->applyImpulse(-wheel.m_raycastInfo.m_contactNormalWS * RLConst::BTVehicle::WHEEL_PUSH_IMPULSE,
		                     wheel.m_raycastInfo.m_contactPointWS - ground->getCenterOfMassPosition());
		ground->activate();
	}
}

// See: I25
void btVehicleRL::calcFrictionImpulses(float timeStep) {

	float frictionScale = m_chassisBody->getMass() / 3;

	// Determine impulses
	for (int i = 0; i < m_wheelInfo.size(); i++) {
		btWheelInfoRL& wheel = m_wheelInfo[i];

		btRigidBody* groundObject = (btRigidBody*)wheel.m_raycastInfo.m_groundObject;
		if (groundObject) {
			// Axle direction (includes steering turn)
			btVector3 axleDir = wheel.m_worldTransform.getBasis().getColumn(m_indexRightAxis);

			// RL PATCH: lateral friction along the wheel's own axle (RocketSim projected it onto the contact plane)
			btVector3 surfNormalWS = wheel.m_raycastInfo.m_contactNormalWS;

			// Wheel forwards direction
			btVector3 forwardDir = surfNormalWS.cross(axleDir).safeNormalized();

			float sideImpulse;

			// Get sideways friction force
			// RL PATCH: against Bullet's fixed body: the game treats every ground as static and motionless (FUN_1402c49d0
			// passes FUN_1402c31f0, the fixed body), so a ball or car under the wheel neither moves the contact nor shares
			// the impulse. Live: a car resting on a ball slid off 8 uu/s per tick too fast
			resolveSingleBilateral(
				*m_chassisBody, wheel.m_raycastInfo.m_contactPointWS,
				btTypedConstraint::getFixedBody(), wheel.m_raycastInfo.m_contactPointWS,
				0,
				axleDir,
				sideImpulse,
				timeStep
			);

			float rollingFriction;
			if (wheel.m_engineForce == 0) {
				if (wheel.m_brake) {
					// Simplified variation of calcRollingFriction()
					// RL PATCH: the chassis's velocity at the contact as measured in the ray pass, before the suspension
					// impulse; the ground's velocity ignored, as for the side friction
					float relVel = wheel.m_velAtContactPoint.dot(forwardDir);

					// This will round off small rolling friction amounts when at sub-80 TPS to prevent stuttering (to an extent)
					// TODO: Improve and clarify
					if (timeStep > (1 / 80.f)) {
						float threshold = -(1 / (timeStep * 150.f)) + 0.8f;
						if (abs(relVel) < threshold)
							relVel = 0;
					}

					// TODO: No idea where this number comes from or how it was calculated lol
					constexpr float ROLLING_FRICTION_SCALE_MAGIC = 113.73963f;

					rollingFriction = RS_CLAMP(-relVel * ROLLING_FRICTION_SCALE_MAGIC, -wheel.m_brake, wheel.m_brake);
				} else {
					// Don't apply friction when driving with no brake
					rollingFriction = 0;
				}
			} else {
				// Engine force already accounts for our mass, so we will cancel out the friction scale multiplication at the end
				rollingFriction = -wheel.m_engineForce / frictionScale;
			}

			btVector3 totalFrictionForce = (forwardDir * rollingFriction * wheel.m_longFriction) + (axleDir * sideImpulse * wheel.m_latFriction);
			wheel.m_impulse = totalFrictionForce * frictionScale;
		} else {
			wheel.m_impulse = { 0,0,0 };
		}
	}
}

// See: I25
void btVehicleRL::applyFrictionImpulses(float timeStep) {
	// Apply impulses
	btVector3 upDir = m_chassisBody->getWorldTransform().getBasis().getColumn(m_indexUpAxis);
	for (int i = 0; i < m_wheelInfo.size(); i++) {
		btWheelInfoRL& wheel = m_wheelInfo[i];
		if (!wheel.m_impulse.isZero()) {
			btVector3 wheelContactOffset = wheel.m_raycastInfo.m_contactPointWS - m_chassisBody->getWorldTransform().getOrigin();
			float contactUpDot = upDir.dot(wheelContactOffset);
			btVector3 wheelRelPos = wheelContactOffset - upDir * contactUpDot;
			m_chassisBody->applyImpulse(wheel.m_impulse * timeStep, wheelRelPos);
		}
	}
}

btVector3 btVehicleRL::getUpwardsDirFromWheelContacts() {
	// RL PATCH: the wheels on world geometry only (the game's FUN_140eed3e0, for the sticky force and auto-roll); a wheel
	// on the ball or a car doesn't count
	btVector3 sumContactDir = btVector3(0, 0, 0);
	for (int i = 0; i < m_wheelInfo.size(); i++)
		if (m_wheelInfo[i].m_raycastInfo.m_isInContact && m_wheelInfo[i].m_isInContactWithWorld)
			sumContactDir += m_wheelInfo[i].m_raycastInfo.m_contactNormalWS;

	if (sumContactDir == btVector3(0, 0, 0)) {
		// No wheels had world contact, just return basic upward direction
		return this->getUpVector();
	} else {
		// Average normal of contact
		return sumContactDir.safeNormalized();
	}
}

float btVehicleRL::getForwardSpeed() {
	return m_chassisBody->getLinearVelocity().dot(getForwardVector());
}

RS_NS_END