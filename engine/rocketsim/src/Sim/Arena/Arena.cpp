#include "Arena.h"
#include "../../RocketSim.h"

#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btAxisSweep3.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btDbvtBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btSimpleBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btRSBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btOverlappingPairCache.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btDefaultCollisionConfiguration.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btInternalEdgeUtility.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btBoxShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btSphereShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btContinuousConvexCollision.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btGjkEpaPenetrationDepthSolver.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btVoronoiSimplexSolver.h"
#include "../../../libsrc/bullet3-3.24/LinearMath/btTransformUtil.h"
#include "DropshotTiles/DropshotTiles.h"

RS_NS_START

void Arena::SetMutatorConfig(const MutatorConfig& mutatorConfig) {

	bool
		ballChanged = mutatorConfig.ballRadius != this->_mutatorConfig.ballRadius || mutatorConfig.ballMass != this->_mutatorConfig.ballMass,
		carMassChanged = mutatorConfig.carMass != this->_mutatorConfig.carMass,
		gravityChanged = mutatorConfig.gravity != this->_mutatorConfig.gravity;

	this->_mutatorConfig = mutatorConfig;

	_bulletWorld.setGravity(mutatorConfig.gravity * UU_TO_BT);
	
	if (ballChanged) {
		// We'll need to remake the ball
		_bulletWorld.removeCollisionObject(&ball->_rigidBody);
		delete ball->_collisionShape;
		ball->_BulletSetup(gameMode, &_bulletWorld, mutatorConfig, _config.noBallRot);
	}

	if (carMassChanged) {
		for (Car* car : _cars) {
			btVector3 newCarInertia;
			car->_childHitboxShape.calculateLocalInertia(mutatorConfig.carMass, newCarInertia);
			car->_rigidBody.setMassProps(mutatorConfig.carMass, newCarInertia); // RL PATCH: was ballMass
		}
	}

	// Update ball rigidbody physics values for world contact
	// NOTE: Cars don't use their rigidbody physics values for world contact
	ball->_rigidBody.setFriction(mutatorConfig.ballWorldFriction);
	ball->_rigidBody.setRestitution(mutatorConfig.ballWorldRestitution);
	ball->_rigidBody.setDamping(mutatorConfig.ballDrag, 0);
}

Car* Arena::AddCar(Team team, const CarConfig& config) {
	Car* car = Car::_AllocateCar();
	
	car->config = config;
	car->team = team;
	
	_AddCarFromPtr(car);

	car->_BulletSetup(gameMode, &_bulletWorld, _mutatorConfig);
	car->Respawn(gameMode, -1, _mutatorConfig.carSpawnBoostAmount);

	return car;
}

bool Arena::_AddCarFromPtr(Car* car) {

	car->id = ++_lastCarID;

	if (_carIDMap.find(car->id) == _carIDMap.end()) {
		assert(!_cars.count(car));
		
		_carIDMap[car->id] = car;
		_cars.insert(car);
		return true;

	} else {
		return false;
	}
}

bool Arena::RemoveCar(uint32_t id) {
	auto itr = _carIDMap.find(id);

	if (itr != _carIDMap.end()) {
		Car* car = itr->second;
		_carIDMap.erase(itr);
		_cars.erase(car);
		_bulletWorld.removeCollisionObject(&car->_rigidBody);
		if (ownsCars)
			delete car;
		return true;
	} else {
		return false;
	}
}

Car* Arena::GetCar(uint32_t id) {
	return _carIDMap[id];
}

void Arena::SetGoalScoreCallback(GoalScoreEventFn callbackFunc, void* userInfo) {
	if (gameMode == GameMode::THE_VOID)
		RS_ERR_CLOSE("Cannot set a goal score callback when on THE_VOID gamemode");

	_goalScoreCallback.func = callbackFunc;
	_goalScoreCallback.userInfo = userInfo;
}

void Arena::SetCarBumpCallback(CarBumpEventFn callbackFunc, void* userInfo) {
	_carBumpCallback.func = callbackFunc;
	_carBumpCallback.userInfo = userInfo;
}

void Arena::ResetToRandomKickoff(int seed) {
	using namespace RLConst;
	// TODO: Make shuffling of kickoff setup more efficient (?)

	static thread_local std::array<int, CAR_SPAWN_LOCATION_AMOUNT> KICKOFF_ORDER_TEMPLATE = { -1 };
	if (KICKOFF_ORDER_TEMPLATE[0] == -1) {
		// Initialize
		for (int i = 0; i < CAR_SPAWN_LOCATION_AMOUNT; i++)
			KICKOFF_ORDER_TEMPLATE[i] = i;
	}

	auto kickoffOrder = KICKOFF_ORDER_TEMPLATE;

	// RL PATCH: fixed engine type and our own shuffle, so every platform picks the same kickoff
	std::minstd_rand0* randEngine;
	if (seed == -1) {
		randEngine = &Math::GetRandEngine();
	} else {
		randEngine = new std::minstd_rand0(seed);
	}

	int locationAmount = (gameMode == GameMode::HEATSEEKER) ? CAR_SPAWN_LOCATION_AMOUNT_HEATSEEKER : CAR_SPAWN_LOCATION_AMOUNT;

	for (int i = locationAmount - 1; i > 0; i--) // Fisher-Yates (std::shuffle differs between standard libraries)
		std::swap(kickoffOrder[i], kickoffOrder[(*randEngine)() % (i + 1)]);

	const CarSpawnPos* CAR_SPAWN_LOCATIONS = CAR_SPAWN_LOCATIONS_SOCCAR;
	const CarSpawnPos* CAR_RESPAWN_LOCATIONS = CAR_RESPAWN_LOCATIONS_SOCCAR;
	if (gameMode == GameMode::HOOPS) {
		CAR_SPAWN_LOCATIONS = CAR_SPAWN_LOCATIONS_HOOPS;
		CAR_RESPAWN_LOCATIONS = CAR_RESPAWN_LOCATIONS_HOOPS;
	} else if (gameMode == GameMode::HEATSEEKER) {
		CAR_SPAWN_LOCATIONS = CAR_SPAWN_LOCATIONS_HEATSEEKER;
		CAR_RESPAWN_LOCATIONS = CAR_RESPAWN_LOCATIONS_SOCCAR;
	} else if (gameMode == GameMode::DROPSHOT) {
		CAR_SPAWN_LOCATIONS = CAR_SPAWN_LOCATIONS_DROPSHOT;
		CAR_RESPAWN_LOCATIONS = CAR_RESPAWN_LOCATIONS_DROPSHOT;
	}

	std::vector<Car*> blueCars, orangeCars;
	for (Car* car : _cars)
		((car->team == Team::BLUE) ? blueCars : orangeCars).push_back(car);

	int numCarsAtRespawnPos[CAR_RESPAWN_LOCATION_AMOUNT] = {};

	int kickoffPositionAmount = RS_MAX(blueCars.size(), orangeCars.size());
	for (int i = 0; i < kickoffPositionAmount; i++) {

		CarSpawnPos spawnPos;
	
		if (i < locationAmount) {
			spawnPos = CAR_SPAWN_LOCATIONS[RS_MIN(kickoffOrder[i], locationAmount - 1)];
		} else {
			int respawnPosIdx = (i - (locationAmount)) % locationAmount;
			spawnPos = CAR_RESPAWN_LOCATIONS[respawnPosIdx];

			// Extra offset to add to multiple cars spawning at the same respawn point,
			//	helps prevent insane numbers of cars from spawning in eachother.
			// Eventually, they will spawn so far away that they clip out of the arena,
			//	but that's not my problem.
			constexpr float CAR_SPAWN_EXTRA_OFFSET_Y = 250;
			spawnPos.y += CAR_SPAWN_EXTRA_OFFSET_Y * numCarsAtRespawnPos[respawnPosIdx];
			numCarsAtRespawnPos[respawnPosIdx]++;
		}

		for (int teamIndex = 0; teamIndex < 2; teamIndex++) {
			bool isBlue = (teamIndex == 0);
			std::vector<Car*> teamCars = isBlue ? blueCars : orangeCars;

			if (i < teamCars.size()) {
				CarState spawnState;
				spawnState.boost = _mutatorConfig.carSpawnBoostAmount;
				spawnState.pos = { spawnPos.x, spawnPos.y, CAR_SPAWN_REST_Z };
				Angle angle = Angle(spawnPos.yawAng, 0, 0);
				spawnState.isOnGround = true;

				if (!isBlue) {
					spawnState.pos *= { -1, -1, 1 };
					angle.yaw += M_PI;
				}

				spawnState.rotMat = angle.ToRotMat();

				teamCars[i]->SetState(spawnState);
			}
		}
	}

	BallState ballState = BallState();
	if (gameMode == GameMode::SOCCAR)
		ballState.pos.z = BALL_KICKOFF_Z;
	if (gameMode == GameMode::HEATSEEKER) {
		int nextRand = (*randEngine)();
		Vec scale = Vec(1, (nextRand % 2) ? 1 : -1, 1);
		ballState.pos = Heatseeker::BALL_START_POS * scale;
		ballState.vel = Heatseeker::BALL_START_VEL * scale;
	} else if (gameMode == GameMode::SNOWDAY) {
		// Don't freeze
		ballState.vel.z = FLT_EPSILON;
	}
	ball->SetState(ballState);

	// Reset boost pads
	for (BoostPad* boostPad : _boostPads)
		boostPad->SetState(BoostPadState());

	// Reset tile states
	if (gameMode == GameMode::DROPSHOT)
		SetDropshotTilesState({});

	if (seed != -1) {
		// Custom random engine was created for this seed, so we need to free it
		delete randEngine;
	}
}

void Arena::SetDropshotTilesState(const DropshotTilesState& state) {
	for (int teamIdx = 0; teamIdx <= 1; teamIdx++) {
		for (int tileIdx = 0; tileIdx < RLConst::Dropshot::NUM_TILES_PER_TEAM; tileIdx++) {
			auto& newState = state.states[teamIdx][tileIdx];

			int rbIndex = tileIdx + (RLConst::Dropshot::NUM_TILES_PER_TEAM * teamIdx);
			assert(rbIndex < _worldDropshotTileRBs.size());
			auto dropshotTileRB = _worldDropshotTileRBs[rbIndex];
			if (newState.damageState == DropshotTileState::STATE_BROKEN) {
				dropshotTileRB->m_collisionFlags |= btCollisionObject::CF_NO_CONTACT_RESPONSE;
			} else {
				dropshotTileRB->m_collisionFlags &= ~btCollisionObject::CF_NO_CONTACT_RESPONSE;
			}
		}
	}

	_dropshotTilesState = state;
}

// RL PATCH: set while a restored arena rebuilds Bullet's contact bookkeeping (no game effects then)
static thread_local bool g_restoringContacts = false;

bool Arena::_BulletContactAddedCallback(
	btManifoldPoint& contactPoint,
	const btCollisionObjectWrapper* objA, int partID_A, int indexA,
	const btCollisionObjectWrapper* objB, int partID_B, int indexB) {

	if (g_restoringContacts)
		return true;

	auto
		bodyA = objA->m_collisionObject,
		bodyB = objB->m_collisionObject;

	if (!objA->m_collisionObject->hasContactResponse() || !objB->m_collisionObject->hasContactResponse())
		return true;

	bool shouldSwap = false;
	if ((bodyA->getUserIndex() != -1) && (bodyB->getUserIndex() != -1)) {
		// If both bodies have a user index, the lower user index should be A
		shouldSwap = bodyA->getUserIndex() > bodyB->getUserIndex();
	} else {
		// If only one body has a user index, make sure that body is A
		shouldSwap = (bodyB->getUserIndex() != -1);
	}

	if (shouldSwap)
		std::swap(bodyA, bodyB);

	int
		userIndexA = bodyA->getUserIndex(),
		userIndexB = bodyB->getUserIndex();

	bool carInvolved = (userIndexA == BT_USERINFO_TYPE_CAR);
	if (carInvolved) {

		Car* car = (Car*)bodyA->getUserPointer();
		Arena* arenaInst = (Arena*)car->_bulletVehicle.m_dynamicsWorld->getWorldUserInfo();

		if (userIndexB == BT_USERINFO_TYPE_BALL) {
			// Car + Ball
			arenaInst->
				_BtCallback_OnCarBallCollision(car, (Ball*)bodyB->getUserPointer(), contactPoint, shouldSwap);
		} else if (userIndexB == BT_USERINFO_TYPE_CAR) {
			// Car + Car
			arenaInst->
				_BtCallback_OnCarCarCollision(car, (Car*)bodyB->getUserPointer(), contactPoint);
		} else {
			// Car + World
			arenaInst->
				_BtCallback_OnCarWorldCollision(car, (btCollisionObject*)bodyB->getUserPointer(), contactPoint);
		}
	} else if (userIndexA == BT_USERINFO_TYPE_BALL && userIndexB == BT_USERINFO_TYPE_DROPSHOT_TILE) {

		Arena* arenaInst = (Arena*)bodyB->getUserPointer();
		arenaInst->ball->_OnDropshotTileCollision(
			arenaInst->_dropshotTilesState, bodyB->getUserIndex2(), bodyB, arenaInst->tickCount, arenaInst->tickTime
		);

	} else if (userIndexA == BT_USERINFO_TYPE_BALL && userIndexB == -1) {
		// Ball + World
		Arena* arenaInst = (Arena*)bodyB->getUserPointer();
		arenaInst->ball->_OnWorldCollision(arenaInst->gameMode, contactPoint.m_normalWorldOnB, arenaInst->tickTime);
		
		// Set as special (unless in snowday)
		if (arenaInst->gameMode != GameMode::SNOWDAY)
			contactPoint.m_isSpecial = true;
	}
	
	btAdjustInternalEdgeContacts(
		contactPoint, 
		(shouldSwap ? objA : objB), (shouldSwap ? objB : objA),
		(shouldSwap ? partID_A : partID_B), (shouldSwap ? indexA : indexB)
	);
	return true;
}

void Arena::_BtCallback_OnCarBallCollision(Car* car, Ball* ball, btManifoldPoint& manifoldPoint, bool ballIsBodyA) {
	using namespace RLConst;

	Vec relBallPos = (ballIsBodyA ? manifoldPoint.m_localPointA : manifoldPoint.m_localPointB) * BT_TO_UU;
	ball->_OnHit(car, relBallPos, manifoldPoint.m_combinedFriction, manifoldPoint.m_combinedRestitution, gameMode, _mutatorConfig, tickCount);
}

// RL PATCH: is `dir` inside the car's forward "elliptical cone" (native FUN_140f0d620)?
// Pitch angle: angle between forward and dir with its right-axis component removed;
// yaw angle: the same with the up-axis component removed. The game removes the component
// divided by 1.01 (or times 1.01 when negative), so a tiny part of it remains.
static bool IsWithinForwardCone(const RotMat& rot, Vec dir, float yawDeg, float pitchDeg, bool reverse) {
	Vec forward = reverse ? -rot.forward : rot.forward;

	auto angleWithoutAxis = [&](Vec axis) {
		float c = dir.Dot(axis);
		c = (c >= 0) ? (c / 1.01f) : (c * 1.01f);
		Vec d = dir - axis * c;
		float lengthSq = d.LengthSq();
		if (lengthSq != 1)
			d = (lengthSq >= 1e-8f) ? d * (1 / sqrtf(lengthSq)) : Vec(0, 0, 0);
		return det_acosf(RS_CLAMP(forward.Dot(d), -1, 1)) * 57.29578f;
	};

	if (angleWithoutAxis(rot.right) > pitchDeg)
		return false;
	return angleWithoutAxis(rot.up) <= yawDeg;
}

// RL PATCH: both cars at their time of impact, for the demo cone (Car_TA.ShouldDemolish -> GetTimeOfImpact, native
// FUN_140efc840). Each car's start-of-tick state is integrated one tick back and one tick forward (FUN_140e9c2e0),
// Bullet's continuous convex cast runs between the hitboxes over that span (allowed penetration 0.04), and the
// positions are lerped and the rotations slerped at the fraction. A missed sweep keeps the start-of-tick states
// (InitTimeOfImpactFromOldRBState).
static void SweepToImpact(Car* car1, Car* car2, float tickTime, PhysState& impact1, PhysState& impact2) {
	impact1 = car1->_oldState;
	impact2 = car2->_oldState;

	btTransform from[2], to[2];
	Car* cars[2] = { car1, car2 };
	for (int i = 0; i < 2; i++) {
		const PhysState& s = cars[i]->_oldState;
		btTransform t(s.rotMat, s.pos * UU_TO_BT);
		btTransformUtil::integrateTransform(t, -(s.vel * UU_TO_BT), -s.angVel, tickTime, from[i]);
		btTransformUtil::integrateTransform(t, s.vel * UU_TO_BT, s.angVel, tickTime, to[i]);
	}

	btVoronoiSimplexSolver simplexSolver;
	btGjkEpaPenetrationDepthSolver penetrationSolver;
	btContinuousConvexCollision cast(&car1->_childHitboxShape, &car2->_childHitboxShape, &simplexSolver, &penetrationSolver);
	btConvexCast::CastResult result;
	result.m_fraction = 1;
	result.m_allowedPenetration = 0.04f;
	btTransform child[2];
	for (int i = 0; i < 2; i++)
		child[i] = cars[i]->_compoundShape.getChildTransform(0);
	if (!cast.calcTimeOfImpact(from[0] * child[0], to[0] * child[0], from[1] * child[1], to[1] * child[1], result) ||
		result.m_fraction >= 1)
		return;

	float f = result.m_fraction;
	PhysState* impacts[2] = { &impact1, &impact2 };
	for (int i = 0; i < 2; i++) {
		impacts[i]->pos = (from[i].getOrigin() + (to[i].getOrigin() - from[i].getOrigin()) * f) * BT_TO_UU;
		btQuaternion q = from[i].getRotation().slerp(to[i].getRotation(), f);
		if (q.length2() > 1e-8f)
			impacts[i]->rotMat = btMatrix3x3(q.normalized());
	}
}

// RL PATCH: car-car impacts follow Car_TA.ApplyCarImpactForces / ShouldDemolish / GetBumpImpulse,
// using both cars' start-of-tick states (the game's OldRBState)
void Arena::_BtCallback_OnCarCarCollision(Car* car1, Car* car2, btManifoldPoint& manifoldPoint) {
	using namespace RLConst;

	// Manually override manifold friction/restitution
	manifoldPoint.m_combinedFriction = RLConst::CARCAR_COLLISION_FRICTION;
	manifoldPoint.m_combinedRestitution = RLConst::CARCAR_COLLISION_RESTITUTION;

	// Test collision both ways
	for (int i = 0; i < 2; i++) {

		bool isSwapped = (i == 1);
		if (isSwapped)
			std::swap(car1, car2);

		if (car1->_internalState.isDemoed || car2->_internalState.isDemoed)
			return;

		bool canDemoTeam = _mutatorConfig.enableTeamDemos || (car1->team != car2->team);

		if (_mutatorConfig.demoMode == DemoMode::ON_CONTACT) {
			if (canDemoTeam) {
				car2->Demolish(_mutatorConfig.respawnDelay);
				if (_carBumpCallback.func)
					_carBumpCallback.func(this, car1, car2, true, _carBumpCallback.userInfo);
			}
			continue;
		}

		const PhysState& state = car1->_oldState;
		const PhysState& otherState = car2->_oldState;

		float speed = state.vel.Length();
		if (speed <= 0)
			continue;

		Vec hitDir = (otherState.pos - state.pos).Normalized();
		float speedTowardsOtherCar = hitDir.Dot(state.vel);
		if (speedTowardsOtherCar <= 0)
			continue;

		Vec velDir = state.vel / speed;
		float otherCarAwaySpeed = otherState.vel.Dot(velDir);
		if (otherCarAwaySpeed >= speedTowardsOtherCar)
			continue;

		// Direction between the hitbox centres
		auto hitboxCenter = [](const PhysState& s, const Vec& offset) {
			return s.pos + s.rotMat.forward * offset.x + s.rotMat.right * offset.y + s.rotMat.up * offset.z;
		};
		Vec hitboxDir =
			hitboxCenter(otherState, car2->config.hitboxPosOffset) - hitboxCenter(state, car1->config.hitboxPosOffset);

		bool isDemo = false;
		if (_mutatorConfig.demoMode == DemoMode::NORMAL && car1->_internalState.isSupersonic && canDemoTeam) {
			// Backwards demolitions are allowed (PhysicsConfig_TA.bAllowBackwardsDemolitions)
			float forwardSpeed = state.vel.Dot(state.rotMat.forward);
			if (abs(forwardSpeed) >= DEMO_MIN_FORWARD_SPEED) {
				// The cone at the time of impact (the bump cone below uses the start-of-tick states)
				PhysState impact, otherImpact;
				SweepToImpact(car1, car2, tickTime, impact, otherImpact);
				Vec impactDir =
					hitboxCenter(otherImpact, car2->config.hitboxPosOffset) - hitboxCenter(impact, car1->config.hitboxPosOffset);
				isDemo = IsWithinForwardCone(impact.rotMat, impactDir, DEMO_CONE_YAW_DEG, DEMO_CONE_PITCH_DEG, forwardSpeed < 0);
			}
		}

		if (isDemo) {
			car2->Demolish(_mutatorConfig.respawnDelay);
			if (_carBumpCallback.func)
				_carBumpCallback.func(this, car1, car2, true, _carBumpCallback.userInfo);
			continue;
		}

		if ((car1->_internalState.carContact.otherCarID == car2->id) && (car1->_internalState.carContact.cooldownTimer > 0))
			continue; // In cooldown (BumpInterval)

		// Only bumper hits push (PushFactor is 0 otherwise), but every bump starts the cooldown
		Vec bumpImpulse = { 0, 0, 0 };
		if (IsWithinForwardCone(state.rotMat, hitboxDir, BUMP_CONE_YAW_DEG, BUMP_CONE_PITCH_DEG, false)) {
			if (car2->_internalState.isOnGround) {
				bumpImpulse =
					velDir * BUMP_VEL_AMOUNT_GROUND_CURVE.GetOutput(speed) +
					otherState.rotMat.up * BUMP_UPWARD_VEL_AMOUNT_CURVE.GetOutput(speed);
			} else {
				bumpImpulse = velDir * BUMP_VEL_AMOUNT_AIR_CURVE.GetOutput(speed);
			}
		}

		car2->_velocityImpulseCache += bumpImpulse * _mutatorConfig.bumpForceScale * UU_TO_BT;

		car1->_internalState.carContact.otherCarID = car2->id;
		car1->_internalState.carContact.cooldownTimer = _mutatorConfig.bumpCooldownTime;

		if (_carBumpCallback.func)
			_carBumpCallback.func(this, car1, car2, false, _carBumpCallback.userInfo);
	}
}

void Arena::_BtCallback_OnCarWorldCollision(Car* car, btCollisionObject* world, btManifoldPoint& manifoldPoint) {
	car->_internalState.worldContact.hasContact = true;
	car->_internalState.worldContact.contactNormal = manifoldPoint.m_normalWorldOnB;

	// Manually override manifold friction/restitution
	manifoldPoint.m_combinedFriction = _mutatorConfig.carWorldFriction;
	manifoldPoint.m_combinedRestitution = _mutatorConfig.carWorldRestitution;
}

Arena::Arena(GameMode gameMode, const ArenaConfig& config, float tickRate) : _mutatorConfig(gameMode), _config(config) {

	// Tickrate must be from 15 to 120tps
	assert(tickRate >= 15 && tickRate <= 120);

	RocketSim::AssertInitialized("Cannot create Arena, ");

	this->gameMode = gameMode;
	this->tickTime = 1 / tickRate;

	{ // Initialize world

		btDefaultCollisionConstructionInfo collisionConfigConstructionInfo = {};

		// These take up a ton of memory normally
		if (_config.memWeightMode == ArenaMemWeightMode::LIGHT) {
			collisionConfigConstructionInfo.m_defaultMaxPersistentManifoldPoolSize /= 32;
			collisionConfigConstructionInfo.m_defaultMaxCollisionAlgorithmPoolSize /= 64;
		} else {
			collisionConfigConstructionInfo.m_defaultMaxPersistentManifoldPoolSize /= 16;
			collisionConfigConstructionInfo.m_defaultMaxCollisionAlgorithmPoolSize /= 32;
		}

		_bulletWorldParams.collisionConfig.setup(collisionConfigConstructionInfo);

		_bulletWorldParams.collisionDispatcher.setup(&_bulletWorldParams.collisionConfig);
		_bulletWorldParams.constraintSolver = btSequentialImpulseConstraintSolver();

		_bulletWorldParams.overlappingPairCache = new btHashedOverlappingPairCache();
		
		if (_config.useCustomBroadphase) {
			float cellSizeMultiplier = 1;
			if (_config.memWeightMode == ArenaMemWeightMode::LIGHT) {
				// Increase cell size
				cellSizeMultiplier = 2.0f;
			}

			_bulletWorldParams.broadphase = new btRSBroadphase(
				_config.minPos * UU_TO_BT,
				_config.maxPos * UU_TO_BT,
				_config.maxAABBLen * UU_TO_BT * cellSizeMultiplier,
				_bulletWorldParams.overlappingPairCache,
				_config.maxObjects);
		} else {
			_bulletWorldParams.broadphase = new btDbvtBroadphase(_bulletWorldParams.overlappingPairCache);
		}

		_bulletWorld.setup(
			&_bulletWorldParams.collisionDispatcher,
			_bulletWorldParams.broadphase,
			&_bulletWorldParams.constraintSolver,
			&_bulletWorldParams.collisionConfig
		);

		_bulletWorld.setGravity(_mutatorConfig.gravity * UU_TO_BT);

		// Adjust solver configuration to be closer to older Bullet (Rocket League's Bullet is from somewhere between 2013 and 2015)
		auto& solverInfo = _bulletWorld.getSolverInfo();
		solverInfo.m_splitImpulsePenetrationThreshold = 1.0e30f;
		solverInfo.m_erp2 = 0.8f;

		// RL PATCH: the game sets solverMode = 0 (no warm starting, no SIMD path) (FUN_140403cc0)
		solverInfo.m_solverMode = 0;

		// RL PATCH: Bullet sets m_timeStep only inside stepSimulation, but the wheel pushback
		// (btVehicleRL::rayCast -> resolveSingleCollision) reads it before that. Without this, a new or
		// restored arena used Bullet's default 1/60 s for its first tick.
		solverInfo.m_timeStep = tickTime;

		// RL PATCH: process contact pairs and solve contacts in a fixed order (by the objects' sort keys,
		// BulletLink.h) instead of one that depends on the world's history (see Arena::_SerializeContacts)
		_bulletWorld.getDispatchInfo().m_deterministicOverlappingPairs = true;
	}

	bool loadArenaStuff = gameMode != GameMode::THE_VOID;

	if (loadArenaStuff) {
		_SetupArenaCollisionShapes();

		// Give arena collision shapes the proper restitution/friction values
		for (auto* rb : _worldCollisionRBs) {
			rb->setRestitution(RLConst::ARENA_COLLISION_BASE_RESTITUTION);
			rb->setFriction(RLConst::ARENA_COLLISION_BASE_FRICTION);
			rb->setRollingFriction(0.f);
		}
	}

	{ // Initialize ball
		ball = Ball::_AllocBall();

		ball->_BulletSetup(gameMode, &_bulletWorld, _mutatorConfig, _config.noBallRot);
		ball->SetState(BallState());
	}

	if (loadArenaStuff && gameMode != GameMode::DROPSHOT) { // Initialize boost pads
		using namespace RLConst::BoostPads;

		if (_config.useCustomBoostPads) {
			for (auto& padConfig : _config.customBoostPads) {
				BoostPad* pad = BoostPad::_AllocBoostPad();
				pad->_Setup(padConfig);

				_boostPads.push_back(pad);
			}
		} else {
			bool isHoops = gameMode == GameMode::HOOPS;

			int amountSmall = isHoops ? LOCS_AMOUNT_SMALL_HOOPS : LOCS_AMOUNT_SMALL_SOCCAR;
			_boostPads.reserve(LOCS_AMOUNT_BIG + amountSmall);

			for (int i = 0; i < (LOCS_AMOUNT_BIG + amountSmall); i++) {

				BoostPadConfig padConfig;

				padConfig.isBig = i < LOCS_AMOUNT_BIG;

				btVector3 pos;
				if (isHoops) {
					padConfig.pos = padConfig.isBig ? LOCS_BIG_HOOPS[i] : LOCS_SMALL_HOOPS[i - LOCS_AMOUNT_BIG];
				} else {
					padConfig.pos = padConfig.isBig ? LOCS_BIG_SOCCAR[i] : LOCS_SMALL_SOCCAR[i - LOCS_AMOUNT_BIG];
				}

				BoostPad* pad = BoostPad::_AllocBoostPad();
				pad->_Setup(padConfig);

				_boostPads.push_back(pad);
				_boostPadGrid.Add(pad);
			}
		}
	}

	// Set internal tick callback
	_bulletWorld.setWorldUserInfo(this);

	gContactAddedCallback = &Arena::_BulletContactAddedCallback;
}

Arena* Arena::Create(GameMode gameMode, const ArenaConfig& arenaConfig, float tickRate) {
	return new Arena(gameMode, arenaConfig, tickRate);
}

void Arena::Serialize(DataStreamOut& out) const {
	out.WriteMultiple(gameMode, tickTime, tickCount, _lastCarID);

	_config.Serialize(out);

	{ // Serialize cars
		out.Write<uint32_t>(_cars.size());
		for (auto car : _cars) {
			out.Write(car->team);
			out.Write(car->id);
			car->Serialize(out);
		}
	}

	if (_boostPads.size() > 0) { // Serialize boost pads
		out.Write<uint32_t>(_boostPads.size());
		for (auto pad : _boostPads)
			pad->GetState().Serialize(out);
	}

	{ // Serialize ball
		ball->GetState().Serialize(out);
		RawBodyState::From(ball->_rigidBody, ball->_netRotation).Serialize(out); // RL PATCH: exact physics state
	}

	{ // Serialize mutators
		_mutatorConfig.Serialize(out);
	}

	// RL PATCH: persistent contact points
	const_cast<Arena*>(this)->_SerializeContacts(out);
	out.Write(kickoffCountdownTicks); // RL PATCH
}

// RL PATCH: Bullet keeps contact points from tick to tick (persistent manifolds), and some contacts, such as a
// car resting on another car, depend on the previous tick's points. Snapshots save them, so a restored arena
// continues bit for bit like the original.

// Identifies a collision object in any arena of the same game mode: its sort key (see BulletLink.h)
static int32_t ContactBodyKey(const btCollisionObject* o) {
	return o->getUserIndex3();
}

static void WriteVec(DataStreamOut& out, const btVector3& v) { out.Write(v.x()); out.Write(v.y()); out.Write(v.z()); }
static btVector3 ReadVec(DataStreamIn& in) {
	float x = in.Read<float>(), y = in.Read<float>(), z = in.Read<float>();
	return btVector3(x, y, z);
}

static void WriteContactPoint(DataStreamOut& out, const btManifoldPoint& p) {
	WriteVec(out, p.m_localPointA); WriteVec(out, p.m_localPointB);
	WriteVec(out, p.m_positionWorldOnB); WriteVec(out, p.m_positionWorldOnA); WriteVec(out, p.m_normalWorldOnB);
	out.WriteMultiple(p.m_distance1, p.m_combinedFriction, p.m_combinedRollingFriction, p.m_combinedSpinningFriction,
		p.m_combinedRestitution, p.m_partId0, p.m_partId1, p.m_index0, p.m_index1, p.m_contactPointFlags,
		p.m_appliedImpulse, p.m_prevRHS, p.m_appliedImpulseLateral1, p.m_appliedImpulseLateral2,
		p.m_contactMotion1, p.m_contactMotion2, p.m_contactCFM, p.m_contactERP, p.m_frictionCFM, p.m_lifeTime,
		p.m_isSpecial);
	WriteVec(out, p.m_lateralFrictionDir1); WriteVec(out, p.m_lateralFrictionDir2);
}

static btManifoldPoint ReadContactPoint(DataStreamIn& in) {
	btManifoldPoint p;
	p.m_localPointA = ReadVec(in); p.m_localPointB = ReadVec(in);
	p.m_positionWorldOnB = ReadVec(in); p.m_positionWorldOnA = ReadVec(in); p.m_normalWorldOnB = ReadVec(in);
	in.ReadMultiple(p.m_distance1, p.m_combinedFriction, p.m_combinedRollingFriction, p.m_combinedSpinningFriction,
		p.m_combinedRestitution, p.m_partId0, p.m_partId1, p.m_index0, p.m_index1, p.m_contactPointFlags,
		p.m_appliedImpulse, p.m_prevRHS, p.m_appliedImpulseLateral1, p.m_appliedImpulseLateral2,
		p.m_contactMotion1, p.m_contactMotion2, p.m_contactCFM, p.m_contactERP, p.m_frictionCFM, p.m_lifeTime,
		p.m_isSpecial);
	p.m_lateralFrictionDir1 = ReadVec(in); p.m_lateralFrictionDir2 = ReadVec(in);
	return p;
}

void Arena::_SerializeContacts(DataStreamOut& out) {
	// The manifolds with contacts, by the bodies' sort keys: the dispatcher's own order depends on when each manifold
	// was created, which a restored arena doesn't share now that manifolds persist between ticks
	auto* dispatcher = _bulletWorld.getDispatcher();
	std::vector<btPersistentManifold*> manifolds;
	for (int i = 0; i < dispatcher->getNumManifolds(); i++)
		if (dispatcher->getManifoldByIndexInternal(i)->getNumContacts() > 0)
			manifolds.push_back(dispatcher->getManifoldByIndexInternal(i));
	std::sort(manifolds.begin(), manifolds.end(), [](const btPersistentManifold* a, const btPersistentManifold* b) {
		int a0 = ContactBodyKey(a->getBody0()), a1 = ContactBodyKey(a->getBody1());
		int b0 = ContactBodyKey(b->getBody0()), b1 = ContactBodyKey(b->getBody1());
		return a0 != b0 ? a0 < b0 : a1 < b1;
	});
	out.Write((uint32_t)manifolds.size());
	for (btPersistentManifold* m : manifolds) {
		out.Write(ContactBodyKey(m->getBody0()));
		out.Write(ContactBodyKey(m->getBody1()));
		out.Write<int32_t>(m->getNumContacts());
		for (int j = 0; j < m->getNumContacts(); j++)
			WriteContactPoint(out, m->getContactPoint(j));
	}

}

void Arena::_DeserializeContacts(DataStreamIn& in) {
	struct Saved {
		int32_t key0, key1;
		std::vector<btManifoldPoint> points;
	};
	std::vector<Saved> saved(in.Read<uint32_t>());
	for (Saved& s : saved) {
		in.Read(s.key0);
		in.Read(s.key1);
		s.points.resize(in.Read<int32_t>());
		for (btManifoldPoint& p : s.points)
			p = ReadContactPoint(in);
	}

	// Let Bullet create its pairs, collision algorithms and manifolds for the current positions, without
	// any game effects, then replace the contact points with the saved ones. Sleeping bodies are woken for that
	// pass: Bullet doesn't process a sleeping body against a static one, so their manifold (which the original kept
	// from before the body fell asleep, with its points) would otherwise not exist here
	struct Sleeper { btCollisionObject* obj; int state; btScalar deactivationTime; };
	std::vector<Sleeper> sleepers;
	btCollisionObjectArray& objects = _bulletWorld.getCollisionObjectArray();
	for (int i = 0; i < objects.size(); i++) {
		btCollisionObject* obj = objects[i];
		if (!obj->isStaticObject() && obj->getActivationState() == ISLAND_SLEEPING) {
			sleepers.push_back({ obj, obj->getActivationState(), obj->getDeactivationTime() });
			obj->forceActivationState(ACTIVE_TAG);
		}
	}
	g_restoringContacts = true;
	_bulletWorld.performDiscreteCollisionDetection();
	g_restoringContacts = false;
	for (const Sleeper& sl : sleepers) {
		sl.obj->forceActivationState(sl.state);
		sl.obj->setDeactivationTime(sl.deactivationTime);
	}

	auto* dispatcher = _bulletWorld.getDispatcher();
	for (int i = 0; i < dispatcher->getNumManifolds(); i++)
		dispatcher->getManifoldByIndexInternal(i)->clearManifold();

	for (const Saved& s : saved) {
		for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
			btPersistentManifold* m = dispatcher->getManifoldByIndexInternal(i);
			if (ContactBodyKey(m->getBody0()) != s.key0 || ContactBodyKey(m->getBody1()) != s.key1)
				continue;
			m->setNumContacts((int)s.points.size());
			for (int j = 0; j < (int)s.points.size(); j++)
				m->getContactPoint(j) = s.points[j];
			break;
		}
	}
}

Arena* Arena::DeserializeNew(DataStreamIn& in) {
	constexpr char ERROR_PREFIX[] = "Arena::Deserialize(): ";

	GameMode gameMode;
	float tickTime;
	uint64_t tickCount;
	uint32_t lastCarID;

	in.ReadMultiple(gameMode, tickTime, tickCount, lastCarID);

	ArenaConfig newConfig = {};
	newConfig.Deserialize(in);

	Arena* newArena = new Arena(gameMode, newConfig, 1.f / tickTime);
	newArena->tickCount = tickCount;
	
	{ // Deserialize cars
		uint32_t carAmount = in.Read<uint32_t>();
		for (uint32_t i = 0; i < carAmount; i++) {
			Team team;
			uint32_t id;
			in.Read(team);
			in.Read(id);

#ifndef RS_MAX_SPEED
			if (newArena->_carIDMap.count(id))
				RS_ERR_CLOSE(ERROR_PREFIX << "Failed to load, got repeated car ID of " << id);
#endif

			// RL PATCH: give the car its saved ID directly. The old code re-numbered cars and then forced the
			// ID, which lost a car whenever the saved order was not ascending.
			newArena->_lastCarID = id - 1;
			Car* newCar = newArena->DeserializeNewCar(in, team);
			assert(newCar->id == id);
		}

		newArena->_lastCarID = lastCarID;
	}

	// Deserialize boost pads
	if (newArena->_boostPads.size() > 0) {
		uint32_t boostPadAmount = in.Read<uint32_t>();

#ifndef RS_MAX_SPEED
		if (boostPadAmount != newArena->_boostPads.size())
			RS_ERR_CLOSE(ERROR_PREFIX << "Failed to load, " <<
				"different boost pad amount written in file (" << boostPadAmount << "/" << newArena->_boostPads.size() << ")");
#endif

		for (auto pad : newArena->_boostPads) {
			BoostPadState padState = BoostPadState();
			padState.Deserialize(in);
			pad->SetState(padState);
		}
	}

	BallState ballState = BallState();
	ballState.Deserialize(in);
	RawBodyState ballBody;
	ballBody.Deserialize(in);

	{ // RL PATCH: apply the mutators before the ball state. Deserializing straight into _mutatorConfig made
	  // SetMutatorConfig() see no change, so a different ball size or car mass was never applied.
		MutatorConfig mutators = MutatorConfig(gameMode);
		mutators.Deserialize(in);
		newArena->SetMutatorConfig(mutators);
	}

	newArena->ball->SetState(ballState);
	ballBody.ApplyTo(newArena->ball->_rigidBody, newArena->ball->_netRotation);
	for (Car* car : newArena->_cars)
		car->_loadedBody.ApplyTo(car->_rigidBody, car->_netRotation);

	newArena->_DeserializeContacts(in); // RL PATCH: persistent contact points
	newArena->kickoffCountdownTicks = in.Read<uint32_t>(); // RL PATCH

	return newArena;
}

// Whether two car configs give the same physics body (preferences such as the dodge deadzone may differ)
static bool SameCarBody(const CarConfig& a, const CarConfig& b) {
	auto same = [](const Vec& x, const Vec& y) { return x.x == y.x && x.y == y.y && x.z == y.z; };
	auto sameWheels = [&](const WheelPairConfig& x, const WheelPairConfig& y) {
		return x.wheelRadius == y.wheelRadius && x.suspensionRestLength == y.suspensionRestLength &&
			same(x.connectionPointOffset, y.connectionPointOffset);
	};
	return same(a.hitboxSize, b.hitboxSize) && same(a.hitboxPosOffset, b.hitboxPosOffset) &&
		sameWheels(a.frontWheels, b.frontWheels) && sameWheels(a.backWheels, b.backWheels) && a.threeWheels == b.threeWheels;
}

bool Arena::DeserializeInPlace(DataStreamIn& in) {
	size_t start = in.pos;
	auto reject = [&]() { in.pos = start; return false; };

	GameMode loadedMode;
	float loadedTickTime;
	uint64_t loadedTickCount;
	uint32_t loadedLastCarID;
	in.ReadMultiple(loadedMode, loadedTickTime, loadedTickCount, loadedLastCarID);
	ArenaConfig loadedConfig = {};
	loadedConfig.Deserialize(in);
	{
		DataStreamOut ours, theirs;
		_config.Serialize(ours);
		loadedConfig.Serialize(theirs);
		if (loadedMode != gameMode || loadedTickTime != tickTime || ours.data != theirs.data)
			return reject();
	}

	struct LoadedCar {
		uint32_t id;
		CarControls controls;
		CarConfig config;
		CarState state;
		RawBodyState body;
	};
	std::vector<LoadedCar> cars(in.Read<uint32_t>());
	if (cars.size() != _cars.size())
		return reject();
	for (LoadedCar& c : cars) {
		Team team;
		in.Read(team);
		in.Read(c.id);
		Car::_ReadSerialized(in, c.controls, c.config, c.state, c.body);
		Car* existing = GetCar(c.id);
		if (!existing || existing->team != team || !SameCarBody(existing->config, c.config))
			return reject();
	}

	std::vector<BoostPadState> pads;
	if (_boostPads.size() > 0) {
		pads.resize(in.Read<uint32_t>());
		if (pads.size() != _boostPads.size())
			return reject();
		for (BoostPadState& pad : pads)
			pad.Deserialize(in);
	}

	BallState ballState = BallState();
	ballState.Deserialize(in);
	RawBodyState ballBody;
	ballBody.Deserialize(in);
	MutatorConfig mutators = MutatorConfig(gameMode);
	mutators.Deserialize(in);

	// Everything matches: apply
	tickCount = loadedTickCount;
	_lastCarID = loadedLastCarID;
	SetMutatorConfig(mutators);
	for (LoadedCar& c : cars) {
		Car* car = GetCar(c.id);
		car->controls = c.controls;
		car->config = c.config;
		car->SetState(c.state);
		c.body.ApplyTo(car->_rigidBody, car->_netRotation);
	}
	for (size_t i = 0; i < pads.size(); i++)
		_boostPads[i]->SetState(pads[i]);
	ball->SetState(ballState);
	ballBody.ApplyTo(ball->_rigidBody, ball->_netRotation);
	ball->_velocityImpulseCache = { 0, 0, 0 };
	_DeserializeContacts(in);
	kickoffCountdownTicks = in.Read<uint32_t>(); // RL PATCH
	return true;
}

Arena* Arena::Clone(bool copyCallbacks) {
	Arena* newArena = new Arena(this->gameMode, this->_config, this->GetTickRate());
	
	if (copyCallbacks) {
		newArena->_goalScoreCallback = this->_goalScoreCallback;
		newArena->_carBumpCallback = this->_carBumpCallback;
	}

	newArena->SetMutatorConfig(this->_mutatorConfig); // RL PATCH: the clone kept default mutators
	newArena->ball->SetState(this->ball->GetState());
	RawBodyState::From(this->ball->_rigidBody, this->ball->_netRotation).ApplyTo(newArena->ball->_rigidBody, newArena->ball->_netRotation); // RL PATCH: exact state
	newArena->ball->_velocityImpulseCache = this->ball->_velocityImpulseCache;

	for (Car* car : this->_cars) {
		// RL PATCH: keep the same ID (setting it after AddCar left the ID map pointing at the wrong IDs)
		newArena->_lastCarID = car->id - 1;
		Car* newCar = newArena->AddCar(car->team, car->config);
		assert(newCar->id == car->id);

		newCar->SetState(car->GetState());
		RawBodyState::From(car->_rigidBody, car->_netRotation).ApplyTo(newCar->_rigidBody, newCar->_netRotation); // RL PATCH: exact state
		newCar->controls = car->controls;
		newCar->_velocityImpulseCache = car->_velocityImpulseCache;
	}

	assert(this->_boostPads.size() == newArena->_boostPads.size());
	for (int i = 0; i < this->_boostPads.size(); i++)
		newArena->_boostPads[i]->SetState(this->_boostPads[i]->GetState());

	newArena->tickCount = this->tickCount;
	newArena->_lastCarID = this->_lastCarID;
	newArena->kickoffCountdownTicks = this->kickoffCountdownTicks; // RL PATCH

	{ // RL PATCH: persistent contact points
		DataStreamOut contactsOut;
		this->_SerializeContacts(contactsOut);
		DataStreamIn contactsIn;
		contactsIn.data = contactsOut.data;
		newArena->_DeserializeContacts(contactsIn);
	}

	return newArena;
}

Car* Arena::DeserializeNewCar(DataStreamIn& in, Team team) {
	Car* car = Car::_AllocateCar();
	car->_Deserialize(in);
	car->team = team;

	// RL PATCH: _BulletSetup() resets the boost to the spawn amount, so keep the loaded state
	CarState loadedState = car->_internalState;

	_AddCarFromPtr(car);

	car->_BulletSetup(gameMode, &_bulletWorld, _mutatorConfig);
	car->SetState(loadedState);

	return car;
}

void Arena::Step(int ticksToSimulate) {
	for (int i = 0; i < ticksToSimulate; i++) {

		_bulletWorld.setWorldUserInfo(this);

		// RL PATCH: the ball sleeps through Bullet's own deactivation, as in the game (stock updateActivationState,
		// FUN_1402c14a0): below 0.8 BU/s (40 uu/s) and 1 rad/s for gDeactivationTime (2 s), it falls asleep and its
		// velocities are zeroed. RocketSim woke the ball here every tick unless its velocity was exactly zero, so a slow
		// ball rolled on forever. Replays: a ball at rest falls asleep 2.0 s after being placed (782 of 795 kickoffs)

		bool ballOnly = _cars.empty();

		bool hasArenaStuff = (gameMode != GameMode::THE_VOID);
		
		// RL PATCH: the ball's start-of-tick velocity (OldRBState) for the car hit impulse (cars keep theirs in _oldState)
		ball->_startOfTickVel = ball->_rigidBody.m_linearVelocity * BT_TO_UU;

		if (kickoffCountdownTicks > 0) // RL PATCH: kickoff countdown, no input
			for (Car* car : _cars)
				car->controls = CarControls();

		for (Car* car : _cars)
			car->_PreTickUpdate(gameMode, tickTime, _mutatorConfig);

		if (hasArenaStuff && !ballOnly) {
			for (BoostPad* pad : _boostPads)
				pad->_PreTickUpdate(tickTime);
		}

		// Update ball
		ball->_PreTickUpdate(gameMode, tickTime);

		// Update world
		_bulletWorld.stepSimulation(tickTime, 0, tickTime);

		for (Car* car : _cars) {
			car->_PostTickUpdate(gameMode, tickTime, _mutatorConfig);
			car->_FinishPhysicsTick(_mutatorConfig);
			if (hasArenaStuff) {
				if (_config.useCustomBoostPads) {
					// TODO: This is quite slow, we should use a sorting method of some sort
					for (auto& boostPad : _boostPads) {
						boostPad->_CheckCollide(car);
					}
				} else {
					_boostPadGrid.CheckCollision(car);
				}
			}
		}

		if (hasArenaStuff && !ballOnly)
			for (BoostPad* pad : _boostPads)
				pad->_PostTickUpdate(tickTime, _mutatorConfig);

		ball->_FinishPhysicsTick(_mutatorConfig);

		// Sync tiles state after the tick ends.
		// We don't want to sync the state on tile damage, 
		//	because that would cause the ball to immediately fall through the newly-broken tile.
		if (gameMode == GameMode::DROPSHOT)
			if (ball->_internalState.dsInfo.lastDamageTick && ball->_internalState.dsInfo.lastDamageTick == tickCount)
				SetDropshotTilesState(_dropshotTilesState);

		if (_goalScoreCallback.func != NULL) { // Potentially fire goal score callback
			if (IsBallScored()) {
				_goalScoreCallback.func(this, RS_TEAM_FROM_Y(-ball->_rigidBody.getWorldTransform().m_origin.y()), _goalScoreCallback.userInfo);
			}
		}

		tickCount++;
		if (kickoffCountdownTicks > 0)
			kickoffCountdownTicks--;
	}
}

// Returns negative: within
// Note that the returned margin is squared
float BallWithinHoopsGoalXYMarginSq(float x, float y) {
	constexpr float
		SCALE_Y = 0.9f,
		OFFSET_Y = 2770.f,
		RADIUS_SQ = 716 * 716;

	float dy = abs(y) * SCALE_Y - OFFSET_Y;
	float distSq = x * x + dy * dy;
	return distSq - RADIUS_SQ;
}

bool Arena::IsBallProbablyGoingIn(float maxTime, float extraMargin, Team* goalTeamOut) const {
	Vec ballPos = ball->_rigidBody.getWorldTransform().m_origin * BT_TO_UU;
	Vec ballVel = ball->_rigidBody.m_linearVelocity * BT_TO_UU;

	if (gameMode == GameMode::SOCCAR || gameMode == GameMode::SNOWDAY) {
		if (abs(ballVel.y) < FLT_EPSILON)
			return false;

		float scoreDirSgn = RS_SGN(ballVel.y);
		float goalY = _mutatorConfig.goalBaseThresholdY * scoreDirSgn;
		float distToGoal = abs(ballPos.y - goalY);

		float timeToGoal = distToGoal / abs(ballVel.y);
		
		if (timeToGoal > maxTime)
			return false;

		Vec extrapPosWhenScore = ballPos + (ballVel * timeToGoal) + (_mutatorConfig.gravity * timeToGoal * timeToGoal) / 2;

		// From: https://github.com/RLBot/RLBot/wiki/Useful-Game-Values
		constexpr float
			APPROX_GOAL_HALF_WIDTH = 892.755f,
			APPROX_GOAL_HEIGHT = 642.775;

		float scoreMargin = _mutatorConfig.ballRadius * 0.1f + extraMargin;

		if (extrapPosWhenScore.z > APPROX_GOAL_HEIGHT + scoreMargin)
			return false; // Too high

		if (abs(extrapPosWhenScore.x) > APPROX_GOAL_HALF_WIDTH + scoreMargin)
			return false; // Too far to the side

		if (goalTeamOut)
			*goalTeamOut = RS_TEAM_FROM_Y(scoreDirSgn);

		// Ok it's probably gonna score, or at least be very close
		return true;
	} else if (gameMode == GameMode::HOOPS) {

		constexpr float
			APPROX_RIM_HEIGHT = 365;
		
		float minHeight = APPROX_RIM_HEIGHT + _mutatorConfig.ballRadius * 1.2f;

		if (ballVel.z < -FLT_EPSILON && ballPos.z < minHeight) {
			if (BallWithinHoopsGoalXYMarginSq(ballPos.x, ballPos.y) < 0) {
				if (goalTeamOut)
					*goalTeamOut = RS_TEAM_FROM_Y(ballPos.y);
				return true; // Already in the net
			}
		}

		float margin = _mutatorConfig.ballRadius * 1.0f;
		float marginSq = margin * margin;

		float upQuadIntercept;
		float downQuadIntercept;

		// Calculate time to score using quadratic intercept
		{
			float g = _mutatorConfig.gravity.z;
			if (g > -FLT_EPSILON)
				return false; 

			float v = ballVel.z;
			float h = ballPos.z - minHeight;

			float sqrtInput = v * v - 2 * g * h;
			if (sqrtInput > 0) {
				float sqrtOutput = sqrtf(sqrtInput);
				upQuadIntercept = (-v + sqrtOutput) / g;
				downQuadIntercept = (-v - sqrtOutput) / g;
			} else {
				// Never reaches the rim height
				if (BallWithinHoopsGoalXYMarginSq(ballPos.x, ballPos.y) < -marginSq) {
					// If started within the hoop, it will stay within the hoop and is therefore scoring
					return true;
				} else {
					// Otherwise, it can never get into the hoop and is therefore never scoring
					return false;
				}
			}
		}
		
		if (upQuadIntercept >= 0) {
			// Ball has to go up before it can fall into the hoop
			// Make sure it cant hit the rim on the way up

			Vec extrapPosUp = ballPos + (ballVel * upQuadIntercept);
			float upMarginSq = BallWithinHoopsGoalXYMarginSq(extrapPosUp.x, extrapPosUp.y);

			float minClearanceMargin = 60 + _mutatorConfig.ballRadius;

			if (upMarginSq > -marginSq && upMarginSq < (minClearanceMargin * minClearanceMargin))
				return false; // Will probably hit rim
		}

		Vec extrapPosDown = ballPos + (ballVel * downQuadIntercept);
		extrapPosDown.y = abs(extrapPosDown.y);

		{ // Very approximate prediction of backboard bounce
			float wallBounceY = RLConst::ARENA_EXTENT_Y_HOOPS - _mutatorConfig.ballRadius;
			if (extrapPosDown.y > wallBounceY) {
				float margin = extrapPosDown.y - wallBounceY;
				extrapPosDown.y -= margin * (1 + _mutatorConfig.ballWorldRestitution);
			}
		}
		
		if (BallWithinHoopsGoalXYMarginSq(extrapPosDown.x, extrapPosDown.y) < -marginSq) {
			if (goalTeamOut)
				*goalTeamOut = RS_TEAM_FROM_Y(extrapPosDown.y);
			return true;
		} else {
			return false;
		}

	} else {
		RS_ERR_CLOSE("Arena::IsBallProbablyGoingIn() is not supported for gamemode " << GAMEMODE_STRS[(int)gameMode]);
		return false;
	}
}

bool Arena::IsBallScored() const {
	switch (gameMode) {
	case GameMode::SOCCAR:
	case GameMode::HEATSEEKER:
	case GameMode::SNOWDAY:
	{
		float ballPosY = ball->_rigidBody.getWorldTransform().m_origin.y() * BT_TO_UU;
		return abs(ballPosY) > (_mutatorConfig.goalBaseThresholdY + _mutatorConfig.ballRadius);
	}
	case GameMode::HOOPS:
	{
		if (ball->_rigidBody.getWorldTransform().m_origin.z() < RLConst::HOOPS_GOAL_SCORE_THRESHOLD_Z * UU_TO_BT) {
			constexpr float
				SCALE_Y = 0.9f,
				OFFSET_Y = 2770.f,
				RADIUS_SQ = 716 * 716;

			Vec ballPos = ball->_rigidBody.getWorldTransform().m_origin * BT_TO_UU;
			return BallWithinHoopsGoalXYMarginSq(ballPos.x, ballPos.y) < 0;
		} else {
			return false;
		}
	}
	case GameMode::DROPSHOT:
	{
		if ((ball->_rigidBody.getWorldTransform().m_origin.z() * BT_TO_UU) < -(_mutatorConfig.ballRadius * 1.75f)) {
			return true;
		} else {
			return false;
		}
	}
	default:
		return false;
	}
}

Arena::~Arena() {

	// Remove all from bullet world constraints
	while (_bulletWorld.getNumConstraints() > 0)
		_bulletWorld.removeConstraint(0);

	// Manually remove all collision objects
	// Otherwise we run into issues regarding deconstruction order
	while (_bulletWorld.getNumCollisionObjects() > 0)
		_bulletWorld.removeCollisionObject(_bulletWorld.getCollisionObjectArray()[0]);

	// Remove all cars
	if (ownsCars) {
		for (Car* car : _cars)
			delete car;
	}

	// Remove the ball
	if (ownsBall) {
		Ball::_DestroyBall(ball);
	}

	if (_boostPads.size() > 0) {
		if (ownsBoostPads) {
			// Remove all boost pads
			for (BoostPad* boostPad : _boostPads)
				delete boostPad;
		}
	}

	// Remove all rigidbodies and collision shapes that we own
	for (auto rb : _worldCollisionRBs) {
		auto shape = rb->getCollisionShape();
		
		bool isBvh = dynamic_cast<btBvhTriangleMeshShape*>(shape);
		if (isBvh) {
			// Don't free BVH shapes because we don't own them
		} else {
			delete shape;
		}

		delete rb;
	}

	delete _bulletWorldParams.overlappingPairCache;
	delete _bulletWorldParams.broadphase;
}

btRigidBody* Arena::_AddStaticCollisionShape(btCollisionShape* shape, btVector3 posBT, int group, int mask) {
	btRigidBody* shapeRB = new btRigidBody(0, NULL, shape);
	shapeRB->setWorldTransform(btTransform(btMatrix3x3::getIdentity(), posBT));
	shapeRB->setUserPointer(this);
	if (group || mask) {
		_bulletWorld.addRigidBody(shapeRB, group, mask);
	} else {
		_bulletWorld.addRigidBody(shapeRB);
	}
	shapeRB->setUserIndex3(BT_SORT_KEY_STATIC + (int)_worldCollisionRBs.size()); // RL PATCH: sort key
	_worldCollisionRBs.push_back(shapeRB);
	return shapeRB;
}

void Arena::_SetupArenaCollisionShapes() {
	assert(gameMode != GameMode::THE_VOID);
	bool isHoops = gameMode == GameMode::HOOPS;
	bool isDropShot = gameMode == GameMode::DROPSHOT;

	auto collisionMeshes = RocketSim::GetArenaCollisionShapes(gameMode);

	if (collisionMeshes.empty()) {
		RS_ERR_CLOSE(
			"No arena meshes found for gamemode " << GAMEMODE_STRS[(int)gameMode] << ", " <<
			"the mesh files should be in " << RocketSim::_collisionMeshesFolder
		)
	}

	for (size_t i = 0; i < collisionMeshes.size(); i++) {
		auto mesh = collisionMeshes[i];

		bool isHoopsNet = false;

		if (isHoops) { // Detect net mesh and disable car collision
			const unsigned char* vertexBase;
			int numVerts, stride;
			const unsigned char* indexBase;
			int indexStride, numFaces;
			mesh->getMeshInterface()->getLockedReadOnlyVertexIndexBase(&vertexBase, numVerts, stride, &indexBase, indexStride, numFaces);
			
			constexpr int HOOPS_NET_NUM_VERTS = 505;
			if (numVerts == HOOPS_NET_NUM_VERTS) {
				isHoopsNet = true;
			}
		}

		int mask = isHoopsNet ? CollisionMasks::HOOPS_NET : 0;
		_worldCollisionBvhShapes.push_back(mesh);
		_AddStaticCollisionShape(mesh, btVector3(0, 0, 0), mask, mask);

		// Don't free the BVH when we deconstruct this arena
		mesh->m_ownsBvh = false;
	}

	{ // Add arena collision planes (floor/walls/ceiling)
		using namespace RLConst;

		float 
			extentX = isHoops ? ARENA_EXTENT_X_HOOPS : ARENA_EXTENT_X,
			extentY = isHoops ? ARENA_EXTENT_Y_HOOPS : ARENA_EXTENT_Y,
			height  = isDropShot ? ARENA_HEIGHT_DROPSHOT : (isHoops ? ARENA_HEIGHT_HOOPS : ARENA_HEIGHT);

		auto fnAddPlane = [&](Vec posUU, Vec normal, int mask = 0) {
			assert(normal.Length() == 1);
			auto planeShape = new btStaticPlaneShape(normal, 0);

			_worldCollisionPlaneShapes.push_back(planeShape);
			_AddStaticCollisionShape(
				planeShape,
				posUU * UU_TO_BT,
				mask, mask
			);
		};

		// Floor
		fnAddPlane(Vec(0, 0, isDropShot ? RLConst::FLOOR_HEIGHT_DROPSHOT : 0), Vec(0, 0, 1), isDropShot ? CollisionMasks::DROPSHOT_FLOOR : 0);

		// Ceiling
		fnAddPlane(Vec(0, 0, height), Vec(0, 0, -1), 0);

		if (!isDropShot) {
			// Side walls
			fnAddPlane(Vec(-extentX, 0, height / 2), btVector3( 1, 0, 0));
			fnAddPlane(Vec(extentX, 0, height / 2),  btVector3(-1, 0, 0));
		}
		

		if (isHoops) {
			// Y walls
			fnAddPlane(Vec(0, -extentY, height / 2), btVector3(0,  1, 0));
			fnAddPlane(Vec(0, extentY, height / 2),  btVector3(0, -1, 0));
		}
	}

	if (isDropShot) {
		// Add tiles
		auto tileShapes = DropshotTiles::MakeTileShapes();
		for (int i = 0; i < tileShapes.size(); i++) {
			int teamIdx = i / RLConst::Dropshot::NUM_TILES_PER_TEAM;
			int tileIdx = i % RLConst::Dropshot::NUM_TILES_PER_TEAM;

			// Shift down so the collision doesn't peek through the floor
			Vec pos = Vec(0, 0, -tileShapes[i]->getMargin());

			auto tileRB = _AddStaticCollisionShape(tileShapes[i], pos, DROPSHOT_TILE, DROPSHOT_TILE);
			tileRB->setUserIndex(BT_USERINFO_TYPE_DROPSHOT_TILE);
			tileRB->setUserIndex2(i);
			_worldDropshotTileRBs.push_back(tileRB);
		}
	}
}

RS_NS_END