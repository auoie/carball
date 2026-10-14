#include "Arena.h"
#include "../GameRotator/GameRotator.h"
#include "SweepGjkEpa282.h"

#include <algorithm>
#include "../../RocketSim.h"

#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btAxisSweep3.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btDbvtBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btSimpleBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btRSBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btOverlappingPairCache.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btPersistentManifold.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btDefaultCollisionConfiguration.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btInternalEdgeUtility.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btBoxShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btSphereShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btContinuousConvexCollision.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btGjkEpaPenetrationDepthSolver.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btVoronoiSimplexSolver.h"
#include "../../../libsrc/bullet3-3.24/LinearMath/btTransformUtil.h"
#include "../../../libsrc/bullet3-3.24/BulletDynamics/ConstraintSolver/btGeneric6DofConstraint.h" // RL PATCH: the XY lock
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
	// RL PATCH: a deterministic spot (RocketSim: Respawn with a clock-seeded random spot)
	Car::RespawnSpot spot = _ChooseSpawn(car, {}, false);
	car->_RespawnAt(spot.pos, spot.yaw, _mutatorConfig.carSpawnBoostAmount);

	return car;
}

// RL PATCH: respawning as the game (its scripts, 2026-10-06; static analysis GA-18, DS-1 to DS-7). A demolished
// player can pick a spot for the first 2.5 s of the 3 s: a press left or right picks that side's next spot (the inner
// one first; "left" is the player's own: x * y <= 0), and 0.5 s before the respawn the spot locks in: the picked one,
// or the team's respawn spots tried from a random one, the first no car or ball is within 48 uu of, else the first
// free spot 192 uu away in one of 8 directions (GetSpawnOrientation). At the respawn the locked spot is checked again
// (its offsets, else a fresh choice). RocketSim picked a random spot from a clock-seeded generator that isn't in
// snapshots (server, clients and rollbacks each chose their own) and didn't look for cars; the random start here comes
// from the tick count and the car's ID. Not modelled: the offsets' line-of-sight check (open floor at every spot)
std::vector<Car::RespawnSpot> Arena::_RespawnSpots(Team team, int side) {
	using namespace RLConst;
	const CarSpawnPos* spots;
	switch (gameMode) {
	case GameMode::HOOPS:
		spots = CAR_RESPAWN_LOCATIONS_HOOPS;
		break;
	case GameMode::DROPSHOT:
		spots = CAR_RESPAWN_LOCATIONS_DROPSHOT;
		break;
	default:
		spots = CAR_RESPAWN_LOCATIONS_SOCCAR;
	}
	bool blue = team == Team::BLUE;
	std::vector<Car::RespawnSpot> out;
	for (int i = 0; i < CAR_RESPAWN_LOCATION_AMOUNT; i++) {
		Car::RespawnSpot s;
		s.pos = Vec(spots[i].x, spots[i].y * (blue ? 1 : -1), CAR_RESPAWN_Z);
		s.yaw = spots[i].yawAng + (blue ? 0 : M_PI);
		s.valid = true;
		bool left = s.pos.x * s.pos.y <= 0;
		if (side == 0 || (side == 1) == left)
			out.push_back(s);
	}
	if (side != 0) // inner first (SortSecondary)
		std::stable_sort(out.begin(), out.end(), [](const Car::RespawnSpot& a, const Car::RespawnSpot& b) {
			return abs(a.pos.x) < abs(b.pos.x);
		});
	return out;
}

bool Arena::_SpawnTaken(Vec pos, Car* car, const std::vector<Car::RespawnSpot>& claimed) {
	using namespace RLConst;
	auto nearHitbox = [&](Vec carPos, const RotMat& rot, const CarConfig& config) {
		Vec centre = carPos + rot.forward * config.hitboxPosOffset.x + rot.right * config.hitboxPosOffset.y +
			rot.up * config.hitboxPosOffset.z;
		Vec d = pos - centre, h = config.hitboxSize / 2;
		Vec local = Vec(d.Dot(rot.forward), d.Dot(rot.right), d.Dot(rot.up));
		Vec outside = local - Vec(RS_CLAMP(local.x, -h.x, h.x), RS_CLAMP(local.y, -h.y, h.y), RS_CLAMP(local.z, -h.z, h.z));
		return outside.LengthSq() < DEMO_SPAWN_ENCROACH_RADIUS * DEMO_SPAWN_ENCROACH_RADIUS;
	};
	for (Car* other : _cars) {
		if (other == car || other->_internalState.isDemoed)
			continue;
		const btTransform& t = other->_rigidBody.getWorldTransform();
		if (nearHitbox(t.m_origin * BT_TO_UU, t.m_basis, other->config))
			return true;
	}
	for (const Car::RespawnSpot& s : claimed)
		if (nearHitbox(s.pos, Angle(s.yaw, 0, 0).ToRotMat(), car->config))
			return true;
	if (ball) {
		float r = DEMO_SPAWN_ENCROACH_RADIUS + ball->GetRadius();
		if ((ball->_rigidBody.getWorldTransform().m_origin * BT_TO_UU - (btVector3)pos).length2() < r * r)
			return true;
	}
	return false;
}

bool Arena::_SpawnOffset(Car* car, const Car::RespawnSpot& spot, const std::vector<Car::RespawnSpot>& claimed,
	Car::RespawnSpot& out) {
	// FindValidCarSpawnOffset: the spot's yaw + i x 45 degrees, 4 x 48 uu away
	for (int i = 0; i < 8; i++) {
		float yaw = spot.yaw + i * (float)(M_PI / 4);
		Car::RespawnSpot s = spot;
		s.pos += Vec(det_cosf(yaw), det_sinf(yaw), 0) * RLConst::DEMO_SPAWN_OFFSET;
		if (!_SpawnTaken(s.pos, car, claimed)) {
			out = s;
			return true;
		}
	}
	return false;
}

bool Arena::_SpawnFromSpots(Car* car, const std::vector<Car::RespawnSpot>& spots, int start,
	const std::vector<Car::RespawnSpot>& claimed, Car::RespawnSpot& out) {
	// GetSpawnOrientationFromLocations: a spot no one is on, else one with a free offset, both from `start` round
	int n = (int)spots.size();
	for (int k = 0; k < n; k++)
		if (!_SpawnTaken(spots[(start + k) % n].pos, car, claimed)) {
			out = spots[(start + k) % n];
			return true;
		}
	for (int k = 0; k < n; k++)
		if (_SpawnOffset(car, spots[(start + k) % n], claimed, out))
			return true;
	return false;
}

Car::RespawnSpot Arena::_ChooseSpawn(Car* car, const std::vector<Car::RespawnSpot>& claimed, bool usePreference) {
	// GetSpawnOrientation: the picked spot if any, else the team's from a random one; then the picked side, then all
	std::vector<Car::RespawnSpot> all = _RespawnSpots(car->team), spots = all;
	const CarState& st = car->_internalState;
	bool picked = false;
	if (usePreference && st.demoSpawnPreference) {
		std::vector<Car::RespawnSpot> side = _RespawnSpots(car->team, st.demoSpawnPreference);
		if (st.demoSpawnIndex < side.size()) {
			spots = { side[st.demoSpawnIndex] };
			picked = true;
		}
	}
	int start = Math::RandInt(0, (int)spots.size(), (int)((tickCount * 31 + car->id) & 0x7fffffff));
	Car::RespawnSpot out;
	if (_SpawnFromSpots(car, spots, start, claimed, out))
		return out;
	if (picked && _SpawnFromSpots(car, _RespawnSpots(car->team, st.demoSpawnPreference), 0, claimed, out))
		return out;
	if (_SpawnFromSpots(car, all, 0, claimed, out))
		return out;
	return all[start % all.size()];
}

void Arena::_UpdateDemolished(Car* car, std::vector<Car::RespawnSpot>& claimed) {
	using namespace RLConst;
	CarState& st = car->_internalState;
	bool prespawn = _mutatorConfig.respawnDelay >= DEMO_PRESPAWN_MIN_DELAY;

	// Selection, until the lock: the steer input (the game binds aDemoSpawnSelect to the same A / D and left stick X),
	// a push past 0.3 to a side
	float steer = car->controls.steer;
	int8_t select = steer < -DEMO_SPAWN_SELECT_THRESHOLD ? -1 : (steer > DEMO_SPAWN_SELECT_THRESHOLD ? 1 : 0);
	int8_t lastSelect = st.demoSpawnSelectLast;
	st.demoSpawnSelectLast = select;
	if (prespawn && !st.prespawnSet && select != 0 && lastSelect == 0) {
		uint8_t side = select < 0 ? 1 : 2;
		size_t sideSize = _RespawnSpots(car->team, side).size();
		st.demoSpawnIndex = (st.demoSpawnPreference != side || st.demoSpawnIndex + 1u >= sideSize) ? 0 : st.demoSpawnIndex + 1;
		st.demoSpawnPreference = side;
	}

	// The lock (EventPrespawn), on the tick the timer reaches DEMO_PRESPAWN_STATE_LENGTH (half a tick of slack for the
	// float timer)
	float timerAfter = RS_MAX(st.demoRespawnTimer - tickTime, 0);
	if (prespawn && !st.prespawnSet && timerAfter <= DEMO_PRESPAWN_STATE_LENGTH + tickTime / 2) {
		Car::RespawnSpot s = _ChooseSpawn(car, claimed, true);
		st.prespawnSet = true;
		st.prespawnPos = s.pos;
		st.prespawnYaw = s.yaw;
	}

	// The respawn this tick (Car::_PreTickUpdate): the locked spot if still free, else its offsets, else a fresh choice
	if (timerAfter == 0 && !respawnsHeld) {
		Car::RespawnSpot s;
		s.pos = st.prespawnPos;
		s.yaw = st.prespawnYaw;
		s.valid = true;
		if (!st.prespawnSet || (_SpawnTaken(s.pos, car, claimed) && !_SpawnOffset(car, s, claimed, s)))
			s = _ChooseSpawn(car, claimed, false);
		car->_respawnSpot = s;
		claimed.push_back(s);
	}
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
		_RemoveXYLock(car); // RL PATCH
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

void Arena::SetTickEndCallback(TickEndEventFn callbackFunc, void* userInfo) {
	_tickEndCallback.func = callbackFunc;
	_tickEndCallback.userInfo = userInfo;
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

	std::array<uint8_t, 5> orders[2];
	for (int i = 0; i < CAR_SPAWN_LOCATION_AMOUNT; i++)
		orders[0][i] = orders[1][i] = (uint8_t)kickoffOrder[i];
	_ResetToKickoff(orders, 0, randEngine);

	if (seed != -1) {
		// Custom random engine was created for this seed, so we need to free it
		delete randEngine;
	}
}

// RL PATCH: a car on a kickoff spot (blue's, or its mirror), as a new body
static void PlaceAtKickoffSpot(Car* car, const RLConst::CarSpawnPos& spawnPos, bool mirrored, float boost) {
	using namespace RLConst;
	CarState spawnState;
	spawnState.boost = boost;
	spawnState.pos = { spawnPos.x, spawnPos.y, CAR_SPAWN_REST_Z };
	Angle angle = Angle(spawnPos.yawAng, 0, 0);
	spawnState.isOnGround = true;
	if (mirrored) {
		spawnState.pos *= { -1, -1, 1 };
		angle.yaw += M_PI;
	}
	spawnState.rotMat = angle.ToRotMat();
	spawnState.pos += spawnState.rotMat.forward * car->config.spawnForwardOffset; // (CarConfig)
	spawnState.spawnCount = car->_internalState.spawnCount + 1;
	// (a new body, so its inertia tensor from the spawn: the game's ResetPlayers destroys the cars and spawns new
	// ones: InitBody -> setMassProps computes it; static analysis RS-12)
	spawnState.refreshInertia = true;
	car->SetState(spawnState);
}

// RL PATCH: freeplay's new round (Arena.h)
void Arena::ResetToFreeplayKickoff(int seed, int spawnIndex) {
	using namespace RLConst;
	std::minstd_rand0 randEngine(seed);
	std::array<uint8_t, 5> order = { 0, 1, 2, 3, 4 };
	for (int i = CAR_SPAWN_LOCATION_AMOUNT - 1; i > 0; i--) // (as StartKickoffSequence)
		std::swap(order[i], order[randEngine() % (i + 1)]);
	int i = 0;
	for (Car* car : _cars) {
		int k = (spawnIndex + i++) % (2 * CAR_SPAWN_LOCATION_AMOUNT);
		if (k < 0)
			k += 2 * CAR_SPAWN_LOCATION_AMOUNT;
		PlaceAtKickoffSpot(car, CAR_SPAWN_LOCATIONS_SOCCAR[order[k / 2]], k % 2 == 1, _mutatorConfig.carSpawnBoostAmount);
	}
	BallState ballState = BallState();
	ballState.spawnCount = ball->_internalState.spawnCount + 1;
	ballState.pos.z = BALL_SPAWN_Z;
	ball->SetState(ballState);
	ResetBoostPads();
	goalExplosion = GoalExplosion();
}

// RL PATCH: ResetPickups
void Arena::ResetBoostPads() {
	for (BoostPad* boostPad : _boostPads)
		boostPad->SetState(BoostPadState());
}

// RL PATCH: a match's kickoff order (InitField: RandomizeSpawnPoints)
void Arena::StartKickoffSequence(int seed, int teamSize) {
	using namespace RLConst;
	std::minstd_rand0 randEngine(seed);
	std::array<uint8_t, 5> order = { 0, 1, 2, 3, 4 };
	for (int i = CAR_SPAWN_LOCATION_AMOUNT - 1; i > 0; i--)
		std::swap(order[i], order[randEngine() % (i + 1)]);
	kickoffSequence = KickoffSequence();
	kickoffSequence.order[0] = kickoffSequence.order[1] = order;
	kickoffSequence.teamSize = (uint8_t)RS_CLAMP(teamSize, 0, CAR_SPAWN_LOCATION_AMOUNT);
}

// RL PATCH: the game's kickoff assignment (static analysis MR-4, MR-5)
void Arena::ResetToNextKickoff() {
	using namespace RLConst;
	constexpr int SPOTS = CAR_SPAWN_LOCATION_AMOUNT;
	KickoffSequence& seq = kickoffSequence;
	int first = seq.next % SPOTS;
	int members[2] = {};
	for (Car* car : _cars)
		members[car->team == Team::BLUE ? 0 : 1]++;
	// (MaxTeamSize: the match's team size, grown to the larger team: CanIncreaseMaxTeamSize)
	int maxTeamSize = RS_MIN(RS_MAX(RS_MAX(members[0], members[1]), (int)seq.teamSize), SPOTS);

	// Uneven teams (bUseDisadvantageSpawnAdjustment, in the Countdown state: every kickoff but the match's first): of
	// the window of MaxTeamSize spots from the index, the most central one (SortPreferableSpawn: smallest distance
	// from the centre, a tie to x*y < 0, the player's own left) goes to the short team's last car, unless one of its
	// cars already has it. For this kickoff only: the next one starts from the match's order again (live, a 1v2
	// exhibition: the lone car took the window's most central spot at every kickoff; validation finding 48)
	std::array<uint8_t, 5> orders[2] = { seq.order[0], seq.order[1] };
	if (seq.kickoffs > 0 && gameMode == GameMode::SOCCAR) {
		auto better = [](const CarSpawnPos& a, const CarSpawnPos& b) {
			float da = a.x * a.x + a.y * a.y, db = b.x * b.x + b.y * b.y;
			if (da != db)
				return da < db;
			return (a.x * a.y < 0) && !(b.x * b.y < 0);
		};
		for (int team = 0; team < 2; team++) {
			int own = RS_MIN(members[team], SPOTS);
			if (own == 0 || members[1 - team] <= members[team])
				continue;
			std::array<uint8_t, 5>& order = orders[team];
			int best = first;
			for (int k = 1; k < maxTeamSize; k++) {
				int slot = (first + k) % SPOTS;
				if (better(CAR_SPAWN_LOCATIONS_SOCCAR[order[slot]], CAR_SPAWN_LOCATIONS_SOCCAR[order[best]]))
					best = slot;
			}
			int bestOffset = (best - first + SPOTS) % SPOTS;
			if (bestOffset >= own) // (not among the spots its cars take already)
				std::swap(order[best], order[(first + own - 1) % SPOTS]);
		}
	}

	std::minstd_rand0 randEngine((unsigned)tickCount + 1); // (the other game modes' ball direction)
	_ResetToKickoff(orders, first, &randEngine);
	seq.next = (uint8_t)((first + 1) % SPOTS);
	seq.kickoffs++;
}

void Arena::_UpdateGoalExplosion() {
	using namespace RLConst;
	GoalExplosion& ex = goalExplosion;
	if (!ex.active)
		return;
	// (ExplosionComponent_X tick: the front from the life time before this tick; StartRadius 0, Speed 10000,
	// EndRadius 3000, Falloff 0.1, RBVelocityChange 5000, MomentumOffset (-500, 0, -500) in the goal's frame, whose X
	// points out of the goal)
	// RL PATCH (KNB-5..7, 9; match-rules audit): it runs between ticks (here at the end of one), so the next tick's
	// start-of-step cap (_LimitVelocities, the game's applyDamping) clamps a pushed car before it moves (it moved one
	// tick uncapped: replays, position 2.8 -> 0.17 uu); each car's HitLocation is its actor Location, one tick behind
	// its body (where it was at this tick's start: _oldState), and AddImpulse applies the push there, so the lever
	// spins it (angular velocity 4.85 -> 0.83 rad/s), the direction from there too; the front reaches a car when it
	// reaches that Location's collision cylinder's box, Location +- (48, 48, 32) (the octree's point-to-box test), not
	// the hitbox
	constexpr float SPEED = 10000, END_RADIUS = 3000, FALLOFF = 0.1f, VEL_CHANGE = 5000;
	constexpr float BOX_XY = 48, BOX_Z = 32;
	float radius = ex.lifeTime * SPEED;
	ex.lifeTime += tickTime;
	if (radius > END_RADIUS) {
		ex.active = false;
		return;
	}
	float scale = det_powf(1 - radius / END_RADIUS, FALLOFF); // (deterministic: server and clients agree to the bit)
	Vec momentumOrigin = ex.origin + Vec(0, 500 * ex.goalDir, -500);
	for (Car* car : _cars) {
		if (car->_internalState.isDemoed || std::find(ex.hitCars.begin(), ex.hitCars.end(), car->id) != ex.hitCars.end())
			continue;
		const Vec at = car->_oldState.pos; // (the actor Location: one tick behind the body)
		Vec gap(
			RS_MAX(abs(ex.origin.x - at.x) - BOX_XY, 0.f),
			RS_MAX(abs(ex.origin.y - at.y) - BOX_XY, 0.f),
			RS_MAX(abs(ex.origin.z - at.z) - BOX_Z, 0.f));
		if (gap.LengthSq() > radius * radius)
			continue;
		ex.hitCars.push_back(car->id);
		Vec dir = (at - momentumOrigin).Normalized();
		// (VelChange: the change in velocity, so an impulse of it times the mass, at the Location)
		btVector3 impulse = (btVector3)(dir * (VEL_CHANGE * scale)) * (UU_TO_BT / car->_rigidBody.getInvMass());
		car->_rigidBody.applyImpulse(impulse, (btVector3)(at * UU_TO_BT) - car->_rigidBody.getCenterOfMassPosition());
		car->_rigidBody.activate(true);
		// (the next physics frame reads the body back, capped and quantised, as its OldRBState and its state, and writes
		// that into the body before the step: the push is never seen uncapped, by the bump and demolition tests, the ball
		// hit or the network state; RV-231)
		Quantize::QuantizeVelocities(car->_rigidBody, CAR_MAX_SPEED, CAR_MAX_ANG_SPEED);
	}
}

void Arena::RedoKickoff() {
	KickoffSequence& seq = kickoffSequence;
	if (seq.kickoffs > 0) {
		seq.next = (uint8_t)((seq.next + RLConst::CAR_SPAWN_LOCATION_AMOUNT - 1) % RLConst::CAR_SPAWN_LOCATION_AMOUNT);
		seq.kickoffs--;
	}
	ResetToNextKickoff();
}

void Arena::_ResetToKickoff(const std::array<uint8_t, 5> orders[2], int first, std::minstd_rand0* randEngine) {
	using namespace RLConst;
	int locationAmount = (gameMode == GameMode::HEATSEEKER) ? CAR_SPAWN_LOCATION_AMOUNT_HEATSEEKER : CAR_SPAWN_LOCATION_AMOUNT;

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
			spawnPos = {}; // (per team below: RL PATCH, each team's own order)
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
				if (i < locationAmount) // RL PATCH
					spawnPos = CAR_SPAWN_LOCATIONS[RS_MIN((int)orders[teamIndex][(first + i) % locationAmount], locationAmount - 1)];
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
				spawnState.pos += spawnState.rotMat.forward * teamCars[i]->config.spawnForwardOffset; // RL PATCH (CarConfig)
				spawnState.spawnCount = teamCars[i]->_internalState.spawnCount + 1; // RL PATCH
				// RL PATCH: a new body, so its inertia tensor from the spawn (the game's ResetPlayers destroys the cars and
				// spawns new ones: InitBody -> setMassProps computes it; static analysis RS-12)
				spawnState.refreshInertia = true;

				teamCars[i]->SetState(spawnState);
			}
		}
	}

	BallState ballState = BallState();
	ballState.spawnCount = ball->_internalState.spawnCount + 1; // RL PATCH
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

	goalExplosion = GoalExplosion(); // RL PATCH
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
		{ // RL PATCH: for the match stats
			btVector3 at = (contactPoint.getPositionWorldOnA() + contactPoint.getPositionWorldOnB()) * 0.5f;
			btVector3 normal = arenaInst->ball->_rigidBody.getWorldTransform().getOrigin() - at;
			arenaInst->ballWorldContacts.push_back({ at * BT_TO_UU, normal.length2() > 0 ? normal.normalized() : btVector3(0, 0, 1) });
		}
		
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
	// RL PATCH: where they touch, on the ball (the match stats' HitLocation)
	car->_ballContactPoint = (ballIsBodyA ? manifoldPoint.getPositionWorldOnA() : manifoldPoint.getPositionWorldOnB()) * BT_TO_UU;
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

// RL PATCH: both cars at their time of impact, for the demo cone (Car_TA.ShouldDemolish -> GetTimeOfImpact
// FUN_140f01930). Each car's start-of-tick state (its location and velocity x 0.02, its quaternion: the integrator
// 0x140ea04f0) is integrated one tick back and one tick forward, Bullet's continuous convex cast runs between the hitboxes
// over that span (allowed penetration 0.04; the game's 2.82 penetration solver: RV-233), and at the fraction the
// locations are lerped as the game's (to x 50 - from x 50) x f + from x 50 and the rotations slerped as UE3's SlerpQuat,
// normalised, through the matrix QuatToRotator makes (RV-232). A missed sweep keeps the start-of-tick states
// (InitTimeOfImpactFromOldRBState)
float Arena::SweepToImpact(Car* car1, Car* car2, float tickTime, PhysState& impact1, PhysState& impact2) {
	impact1 = car1->_oldState;
	impact2 = car2->_oldState;

	btTransform from[2], to[2];
	Car* cars[2] = { car1, car2 };
	for (int i = 0; i < 2; i++) {
		const PhysState& s = cars[i]->_oldState;
		btTransform t(cars[i]->_oldQuat, s.pos * UU_TO_BT);
		btVector3 vel = s.vel * UU_TO_BT;
		btTransformUtil::integrateTransform(t, -vel, -s.angVel, tickTime, from[i]);
		btTransformUtil::integrateTransform(t, vel, s.angVel, tickTime, to[i]);
	}

	btVoronoiSimplexSolver simplexSolver;
	SweepPenetrationSolver282 penetrationSolver;
	btContinuousConvexCollision cast(&car1->_childHitboxShape, &car2->_childHitboxShape, &simplexSolver, &penetrationSolver);
	btConvexCast::CastResult result;
	result.m_fraction = 1;
	result.m_allowedPenetration = 0.04f;
	btTransform child[2];
	for (int i = 0; i < 2; i++)
		child[i] = cars[i]->_compoundShape.getChildTransform(0);
	if (!cast.calcTimeOfImpact(from[0] * child[0], to[0] * child[0], from[1] * child[1], to[1] * child[1], result) ||
		result.m_fraction >= 1)
		return 1;

	float f = result.m_fraction;
	PhysState* impacts[2] = { &impact1, &impact2 };
	for (int i = 0; i < 2; i++) {
		const btVector3 &a = from[i].getOrigin(), &b = to[i].getOrigin();
		float ax = a.x() * BT_TO_UU, ay = a.y() * BT_TO_UU, az = a.z() * BT_TO_UU;
		impacts[i]->pos = Vec((b.x() * BT_TO_UU - ax) * f + ax, (b.y() * BT_TO_UU - ay) * f + ay, (b.z() * BT_TO_UU - az) * f + az);
		btQuaternion qa = from[i].getRotation(), qb = to[i].getRotation();
		UEQuat q = UENormalized(UESlerpQuat({ qa.x(), qa.y(), qa.z(), qa.w() }, { qb.x(), qb.y(), qb.z(), qb.w() }, f));
		impacts[i]->rotMat = UEQuatRotMat(q);
	}
	return f;
}

bool Arena::DemoConeAtImpact(Car* car1, Car* car2, float tickTime, bool reverse) {
	using namespace RLConst;
	PhysState impact, otherImpact;
	SweepToImpact(car1, car2, tickTime, impact, otherImpact);
	// (each car's hitbox centre from its rotator's matrix, the attacker's cone axes from the same: FUN_140f11c30)
	RotMat basis = GameRotatorBasis(impact.rotMat);
	Vec impactDir = GameConeCentre(otherImpact.pos, GameRotatorBasis(otherImpact.rotMat), car2->config.hitboxPosOffset) -
		GameConeCentre(impact.pos, basis, car1->config.hitboxPosOffset);
	return IsWithinForwardCone(basis, impactDir, DEMO_CONE_YAW_DEG, DEMO_CONE_PITCH_DEG, reverse);
}

// RL PATCH: car-car impacts follow Car_TA.ApplyCarImpactForces / ShouldDemolish / GetBumpImpulse,
// using both cars' start-of-tick states (the game's OldRBState)
void Arena::_BtCallback_OnCarCarCollision(Car* car1, Car* car2, btManifoldPoint& manifoldPoint) {
	using namespace RLConst;

	// Manually override manifold friction/restitution
	manifoldPoint.m_combinedFriction = RLConst::CARCAR_COLLISION_FRICTION;
	manifoldPoint.m_combinedRestitution = RLConst::CARCAR_COLLISION_RESTITUTION;

	if (car1->_internalState.isDemoed || car2->_internalState.isDemoed)
		return;

	// RL PATCH: demolitions apply after both directions (the game's Demolish only queues the demolition, finished in
	// EventPostPhysicsStep, so the victim's own impact handling still runs that tick: a mutual supersonic head-on
	// demolishes both cars, and a victim driving at its attacker still bumps it; static analysis GA-15). RocketSim
	// stopped at the first demolition, so the result depended on the pair's order
	Car* demolished[2] = {};

	// Test collision both ways
	for (int i = 0; i < 2; i++) {

		bool isSwapped = (i == 1);
		if (isSwapped)
			std::swap(car1, car2);

		bool canDemoTeam = _mutatorConfig.enableTeamDemos || (car1->team != car2->team);

		if (_mutatorConfig.demoMode == DemoMode::ON_CONTACT) {
			if (canDemoTeam) {
				demolished[i] = car2;
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
		// RL PATCH: as the game's cone (FUN_140f11c30, from Impact.Rotation = QuatToRotator(...)): each car's axes from its
		// rotator through the sine table, and its hitbox centre the location plus the offset times the transpose of that
		// rotation (the native multiplies the offset by the matrix's rows); the attacker's cone axes from the same rotator
		auto hitboxCenter = [](const PhysState& s, const Vec& offset) {
			return GameConeCentre(s.pos, GameRotatorBasis(s.rotMat), offset);
		};
		Vec hitboxDir =
			hitboxCenter(otherState, car2->config.hitboxPosOffset) - hitboxCenter(state, car1->config.hitboxPosOffset);

		bool isDemo = false;
		if (_mutatorConfig.demoMode == DemoMode::NORMAL && car1->_internalState.isSupersonic && canDemoTeam) {
			// Backwards demolitions are allowed (PhysicsConfig_TA.bAllowBackwardsDemolitions)
			// RL PATCH: CarForward = Vector(QuatToRotator(OldRBState.Quaternion)) (ShouldDemolish)
			float forwardSpeed = state.vel.Dot(GameRotatorBasis(state.rotMat).forward);
			if (abs(forwardSpeed) >= DEMO_MIN_FORWARD_SPEED) {
				// The cone at the time of impact (the bump cone below uses the start-of-tick states)
				isDemo = DemoConeAtImpact(car1, car2, tickTime, forwardSpeed < 0);
			}
		}

		if (isDemo) {
			demolished[i] = car2;
			if (_carBumpCallback.func)
				_carBumpCallback.func(this, car1, car2, true, _carBumpCallback.userInfo);
			continue;
		}

		// RL PATCH: in cooldown until strictly more than BumpInterval has passed (the game: PhysicsTime > LastHitTime +
		// 0.25, so a hit exactly 30 ticks later is still in cooldown, the next comes at 31; static analysis GA-16). The
		// timer runs on below 0 by up to a tick (Car::_PostTickUpdate), so "exactly over" (~0) still blocks
		if ((car1->_internalState.carContact.otherCarID == car2->id) &&
		    (car1->_internalState.carContact.cooldownTimer > -BUMP_COOLDOWN_EPSILON))
			continue; // In cooldown (BumpInterval)

		// Only bumper hits push (PushFactor is 0 otherwise), but every bump starts the cooldown
		Vec bumpImpulse = { 0, 0, 0 };
		if (IsWithinForwardCone(GameRotatorBasis(state.rotMat), hitboxDir, BUMP_CONE_YAW_DEG, BUMP_CONE_PITCH_DEG, false)) {
			if (car2->_internalState.isOnGround) {
				// RL PATCH: UpDir = GetRotatorAxis(QuatToRotator(OtherCar.OldRBState.Quaternion), 2) (GetBumpImpulse): the
				// rotator's whole units and the sine table. Live (`car_car` tick 110, a side bump at 1400): 0.09 -> 0.01 uu/s
				bumpImpulse =
					velDir * BUMP_VEL_AMOUNT_GROUND_CURVE.GetOutput(speed) +
					GameRotatorBasis(otherState.rotMat).up * BUMP_UPWARD_VEL_AMOUNT_CURVE.GetOutput(speed);
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

	for (Car* victim : demolished)
		if (victim)
			victim->Demolish(_mutatorConfig.respawnDelay);
}

void Arena::_BtCallback_OnCarWorldCollision(Car* car, btCollisionObject* world, btManifoldPoint& manifoldPoint) {
	// (the car's world contact is rebuilt after the step: _UpdateWorldContacts)

	// Manually override manifold friction/restitution
	manifoldPoint.m_combinedFriction = _mutatorConfig.carWorldFriction;
	manifoldPoint.m_combinedRestitution = _mutatorConfig.carWorldRestitution;
}

// RL PATCH: each car's world contact as the game rebuilds it after the step (FUN_140f55040, FUN_140f13c80; all world
// geometry is one RBCollision record): in contact if any of its manifolds with static geometry has points (persisted
// ones too), the normal the normalised sum of all those points' normals, towards the car. RocketSim took the normal of
// the last point added during the step, and missed contacts that only persisted. Read by auto-roll and auto-flip at
// the next tick (static analysis RS-7). The manifolds are added up in the order of the world objects they touch, not
// the dispatcher's (which differs in a restored or cloned arena, and float addition doesn't commute in its last bits)
void Arena::_UpdateWorldContacts() {
	btCollisionDispatcher* dispatcher = _bulletWorld.getDispatcher();
	std::vector<std::pair<int, btPersistentManifold*>> touching;
	for (Car* car : _cars) {
		touching.clear();
		for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
			btPersistentManifold* manifold = dispatcher->getManifoldByIndexInternal(i);
			if (manifold->getNumContacts() == 0)
				continue;
			bool first = manifold->getBody0() == &car->_rigidBody, second = manifold->getBody1() == &car->_rigidBody;
			if (!first && !second)
				continue;
			const btCollisionObject* other = first ? manifold->getBody1() : manifold->getBody0();
			if (other->isStaticObject())
				touching.emplace_back(other->getWorldArrayIndex(), manifold);
		}
		std::sort(touching.begin(), touching.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
		btVector3 sum(0, 0, 0);
		int count = 0;
		for (const auto& [index, manifold] : touching) {
			bool first = manifold->getBody0() == &car->_rigidBody;
			for (int j = 0; j < manifold->getNumContacts(); j++) {
				// (the normal on B points towards A: towards the car when it is A)
				const btVector3& normal = manifold->getContactPoint(j).m_normalWorldOnB;
				sum += first ? normal : -normal;
				count++;
			}
		}
		car->_internalState.worldContact.hasContact = count > 0;
		if (count > 0) {
			float length = sum.length();
			if (length > 1e-6f)
				car->_internalState.worldContact.contactNormal = sum / length;
		}
	}
}

// RL PATCH (IT-2, RV-166): the contacts' normal from their sum, as the game's SafeNormal: a sum near zero (contacts from
// opposite sides) has none, so no speed and no event
bool Arena::_ImpactNormal(const btVector3& sum, btVector3& out) {
	float length = sum.length();
	if (length <= 1e-4f)
		return false;
	out = sum / length;
	return true;
}

// RL PATCH (impact triggers, notes/impact-triggers.md IT-1..3): the game's manifold scan after each physics step
// (FUN_140eddaa0), its accumulation per partner actor (ARBActor_TA::OnRigidBodyCollision) and HandleCollision's speed:
// skipped are manifolds with no point, with a no-contact-response body or a sleeping or disabled one
void Arena::_UpdateImpacts() {
	if (!collectImpacts)
		return;
	if (impacts.size() > IMPACT_LIMIT)
		impacts.erase(impacts.begin(), impacts.begin() + (impacts.size() - IMPACT_LIMIT / 2));
	struct Entry {
		const btCollisionObject* other;
		int points = 0;
		btVector3 pos = btVector3(0, 0, 0), normal = btVector3(0, 0, 0), vSelf = btVector3(0, 0, 0), vOther = btVector3(0, 0, 0);
	};
	btCollisionDispatcher* dispatcher = _bulletWorld.getDispatcher();
	std::vector<Entry> entries;
	// (one body's contacts, partner by partner: a car's with anything; the ball's with the world only, as its own
	// ImpactEffectsComponent's (its hits with a car are the car's events: RV-172))
	auto scan = [&](const btRigidBody* self, uint32_t selfId, bool worldOnly) {
		entries.clear();
		for (int i = 0; i < dispatcher->getNumManifolds(); i++) {
			btPersistentManifold* manifold = dispatcher->getManifoldByIndexInternal(i);
			if (manifold->getNumContacts() == 0)
				continue;
			const btCollisionObject *body0 = manifold->getBody0(), *body1 = manifold->getBody1();
			bool first = body0 == self;
			if (!first && body1 != self)
				continue;
			if (!body0->hasContactResponse() || !body1->hasContactResponse())
				continue;
			// (a sleeping or disabled dynamic body: Bullet keeps the static ones "sleeping" from the start)
			auto asleep = [](const btCollisionObject* o) {
				int state = o->getActivationState();
				return !o->isStaticObject() && (state == ISLAND_SLEEPING || state == DISABLE_SIMULATION);
			};
			if (asleep(body0) || asleep(body1))
				continue;
			const btCollisionObject* other = first ? body1 : body0;
			if (worldOnly && (other->getUserIndex() == BT_USERINFO_TYPE_BALL || other->getUserIndex() == BT_USERINFO_TYPE_CAR))
				continue;
			Entry* entry = nullptr;
			for (Entry& e : entries)
				if (e.other == other)
					entry = &e;
			if (!entry) {
				entries.push_back(Entry{ other });
				entry = &entries.back();
			}
			for (int j = 0; j < manifold->getNumContacts(); j++) {
				const btManifoldPoint& point = manifold->getContactPoint(j);
				// (the position on body 0's side for both, the normal from body 1 toward body 0: swapped for body 1)
				entry->pos += point.m_positionWorldOnA;
				entry->normal += first ? point.m_normalWorldOnB : -point.m_normalWorldOnB;
				entry->vSelf += first ? point.m_rlVel1 : point.m_rlVel2;
				entry->vOther += first ? point.m_rlVel2 : point.m_rlVel1;
				entry->points++;
			}
		}
		for (const Entry& e : entries) {
			float k = 1.f / (float)e.points;
			btVector3 pos = e.pos * k, dv = (e.vSelf - e.vOther) * k * BT_TO_UU;
			if (abs(dv.x()) < 1e-4f && abs(dv.y()) < 1e-4f && abs(dv.z()) < 1e-4f)
				continue;
			btVector3 n;
			if (!_ImpactNormal(e.normal, n))
				continue;
			// RL PATCH (RV-215, IT-2): the line check only against the static world (SingleLineCheck from 10 uu on the
			// body's side through the point to 10 uu into the partner; a hit's normal and point replace the contact's). A
			// car's collision component is its skeletal mesh, which HandleCollision checks none of: the averaged normal
			// stays (a ray hit the other car's box face at its edges: the bump speed, the sound, the sparks wrong); a ball's
			// check runs from the point toward its centre over its mesh: the radial normal there
			const int otherKind = e.other->getUserIndex();
			if (otherKind == BT_USERINFO_TYPE_BALL) {
				btVector3 radial = pos - e.other->getWorldTransform().getOrigin();
				if (radial.length2() > 1e-12f)
					n = radial.normalized();
			} else if (otherKind != BT_USERINFO_TYPE_CAR) {
				btVector3 from = pos + n * (10 * UU_TO_BT), to = pos - n * (10 * UU_TO_BT);
				// (the body itself left out: the game's source)
				btCollisionWorld::ClosestRayResultCallback ray(from, to, self);
				ray.m_collisionFilterGroup = -1;
				ray.m_collisionFilterMask = -1;
				_bulletWorld.rayTest(from, to, ray);
				if (ray.hasHit()) {
					n = ray.m_hitNormalWorld.normalized();
					pos = ray.m_hitPointWorld;
				}
			}
			// (kept with 50 uu/s or more along the normal or across it: the impacts' effects, or the slides', RV-164)
			float speed = abs(dv.dot(n)), slide = dv.length() - speed;
			if (speed < 50 && slide < 50)
				continue;
			int kind = 0;
			uint32_t partnerId = 0;
			if (e.other->getUserIndex() == BT_USERINFO_TYPE_BALL) {
				kind = 1;
			} else if (e.other->getUserIndex() == BT_USERINFO_TYPE_CAR) {
				kind = 2;
				partnerId = ((Car*)e.other->getUserPointer())->id;
			}
			impacts.push_back(ImpactEvent{ tickCount, selfId, kind, partnerId, speed, slide, Vec(pos) * BT_TO_UU, Vec(n) });
		}
	};
	for (Car* car : _cars)
		if (!car->_internalState.isDemoed)
			scan(&car->_rigidBody, car->id, false);
	if (ball)
		scan(&ball->_rigidBody, IMPACT_BALL, true);
}

Arena::Arena(GameMode gameMode, const ArenaConfig& config, float tickRate) : _mutatorConfig(gameMode), _config(config) {

	// Tickrate must be from 15 to 120tps
	assert(tickRate >= 15 && tickRate <= 120);

	RocketSim::AssertInitialized("Cannot create Arena, ");

	this->gameMode = gameMode;
	this->tickTime = 1 / tickRate;

	// RL PATCH: the XY locks' fixed body (RV-298), as Bullet's getFixedBody() makes its own
	_xyAnchor = new btRigidBody(btScalar(0), NULL, NULL);
	_xyAnchor->setMassProps(btScalar(0), btVector3(0, 0, 0));

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

		// RL PATCH: restitution at every contact speed, as Bullet 2.82's restitutionCurve (rest = e x -v); 3.24 drops it below
		// this threshold (default 0.2 BU/s = 10 uu/s). Live: a ball settling on a parked car's roof was 4.9 uu/s off
		solverInfo.m_restitutionVelocityThreshold = 0;

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

// RL PATCH: the match's kickoff order in snapshots
static void _WriteKickoffSequence(DataStreamOut& out, const Arena::KickoffSequence& s) {
	for (const auto& order : s.order)
		for (uint8_t spot : order)
			out.Write(spot);
	out.Write(s.next);
	out.Write(s.kickoffs);
	out.Write(s.teamSize);
}

static void _ReadKickoffSequence(DataStreamIn& in, Arena::KickoffSequence& s) {
	for (auto& order : s.order)
		for (uint8_t& spot : order)
			spot = in.Read<uint8_t>() % RLConst::CAR_SPAWN_LOCATION_AMOUNT;
	s.next = in.Read<uint8_t>();
	s.kickoffs = in.Read<uint16_t>();
	s.teamSize = in.Read<uint8_t>();
}

// RL PATCH: the goal explosion's wave in snapshots (and the network state: NetState.cpp)
void _WriteGoalExplosion(DataStreamOut& out, const Arena::GoalExplosion& ex) {
	out.Write<uint8_t>(ex.active);
	if (!ex.active)
		return;
	out.WriteMultiple(ex.origin.x, ex.origin.y, ex.origin.z);
	out.Write(ex.goalDir);
	out.Write(ex.lifeTime);
	out.Write<uint8_t>((uint8_t)ex.hitCars.size());
	for (uint32_t id : ex.hitCars)
		out.Write(id);
}

void _ReadGoalExplosion(DataStreamIn& in, Arena::GoalExplosion& ex) {
	ex = Arena::GoalExplosion();
	ex.active = in.Read<uint8_t>() != 0;
	if (!ex.active)
		return;
	in.ReadMultiple(ex.origin.x, ex.origin.y, ex.origin.z);
	in.Read(ex.goalDir);
	in.Read(ex.lifeTime);
	ex.hitCars.resize(in.Read<uint8_t>());
	for (uint32_t& id : ex.hitCars)
		in.Read(id);
}

// RL PATCH: the cars' XY locks in a snapshot: each held one's car and pin, so a restored world takes them back where
// they were (Arena::_UpdateXYLocks)
static void _WriteXYLocks(DataStreamOut& out, const Arena::CarSet& cars) {
	uint32_t held = 0;
	// (a pending one too: a snapshot taken just after a load, before the tick takes it back: RV-297)
	for (const Car* car : cars)
		held += car->_xyLock != NULL || car->_xyLockPending;
	out.Write(held);
	for (const Car* car : cars) {
		if (!car->_xyLock && !car->_xyLockPending)
			continue;
		const btVector3 pin = car->_xyLock ? car->_xyLock->getFrameOffsetA().getOrigin() : car->_xyLockPin;
		out.Write(car->id);
		out.WriteMultiple(pin.x(), pin.y(), pin.z());
	}
}

static void _ReadXYLocks(DataStreamIn& in, Arena* arena) {
	for (Car* car : arena->GetCars()) {
		arena->_RemoveXYLock(car);
		car->_xyLockPending = false;
	}
	uint32_t held = in.Read<uint32_t>();
	for (uint32_t i = 0; i < held; i++) {
		uint32_t id = in.Read<uint32_t>();
		float x, y, z;
		in.ReadMultiple(x, y, z);
		Car* car = arena->GetCar(id);
		if (car) {
			car->_xyLockPending = true;
			car->_xyLockPin = btVector3(x, y, z);
		}
	}
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
	_WriteKickoffSequence(out, kickoffSequence); // RL PATCH
	out.Write<uint8_t>(respawnsHeld); // RL PATCH
	_WriteGoalExplosion(out, goalExplosion); // RL PATCH
	_WriteXYLocks(out, _cars); // RL PATCH
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
	// any game effects, then replace the contact points with the saved ones. Sleeping and disabled bodies are woken
	// for that pass: Bullet doesn't process them against a static one, so their manifold (which the original kept from
	// before the body fell asleep, or was disabled: the exploded ball in the goal, a demolished car; RV-223) would
	// otherwise not exist here
	struct Sleeper { btCollisionObject* obj; int state; btScalar deactivationTime; };
	std::vector<Sleeper> sleepers;
	btCollisionObjectArray& objects = _bulletWorld.getCollisionObjectArray();
	for (int i = 0; i < objects.size(); i++) {
		btCollisionObject* obj = objects[i];
		int state = obj->getActivationState();
		if (!obj->isStaticObject() && (state == ISLAND_SLEEPING || state == DISABLE_SIMULATION)) {
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
	_ReadKickoffSequence(in, newArena->kickoffSequence); // RL PATCH
	newArena->respawnsHeld = in.Read<uint8_t>() != 0; // RL PATCH
	_ReadGoalExplosion(in, newArena->goalExplosion); // RL PATCH
	_ReadXYLocks(in, newArena); // RL PATCH

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
	_ReadKickoffSequence(in, kickoffSequence); // RL PATCH
	respawnsHeld = in.Read<uint8_t>() != 0; // RL PATCH
	_ReadGoalExplosion(in, goalExplosion); // RL PATCH
	_ReadXYLocks(in, this); // RL PATCH
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
		// RL PATCH: its XY lock taken back where it is
		newCar->_xyLockPending = car->_xyLock != NULL || car->_xyLockPending;
		newCar->_xyLockPin = car->_xyLock ? car->_xyLock->getFrameOffsetA().getOrigin() : car->_xyLockPin;
	}

	assert(this->_boostPads.size() == newArena->_boostPads.size());
	for (int i = 0; i < this->_boostPads.size(); i++)
		newArena->_boostPads[i]->SetState(this->_boostPads[i]->GetState());

	newArena->tickCount = this->tickCount;
	newArena->_lastCarID = this->_lastCarID;
	newArena->kickoffCountdownTicks = this->kickoffCountdownTicks; // RL PATCH
	newArena->kickoffSequence = this->kickoffSequence; // RL PATCH
	newArena->respawnsHeld = this->respawnsHeld; // RL PATCH
	newArena->goalExplosion = this->goalExplosion; // RL PATCH

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

// RL PATCH: Car_TA.SetConstrained2D (FUN_140f21a90 every physics tick: SetConstrained2D(!bDriving || bPodiumMode);
// static session PD1): Bullet 2.82's btGeneric6DofConstraint against the fixed body, frame A the identity basis at the
// body's world origin as it takes hold, frame B the identity, its linear limits lower (0, 0, 1) upper (0, 0, 0) (X and
// Y held, Z free: lower over upper), every angular one (1, 0) (free), the world's ERP and CFM. Not driving is the
// kickoff countdown here (SetAllDriving(false)); the end's frozen world doesn't step
void Arena::_UpdateXYLocks(bool countdown) {
	for (Car* car : _cars) {
		const bool want = (countdown || podiumMode) && !car->_internalState.isDemoed;
		// (placed while held: taken again where it is now, unless a snapshot's pin is waiting: RV-295)
		if (want && car->_xyLock && car->_xyLockMoved && !car->_xyLockPending)
			_RemoveXYLock(car);
		car->_xyLockMoved = false;
		if (want && !car->_xyLock) {
			btTransform frameA;
			frameA.setIdentity();
			// (where a snapshot's lock was, else where the car is)
			frameA.setOrigin(car->_xyLockPending ? car->_xyLockPin : car->_rigidBody.getCenterOfMassPosition());
			car->_xyLockPending = false;
			btTransform frameB;
			frameB.setIdentity();
			// (its angular limits all free, so 2.82's calculateAngleInfo runs without the exe's gimbal guard (B18,
			// 0x1402b0ec0) and is inert here: RV-300)
			btGeneric6DofConstraint* lock = new btGeneric6DofConstraint(*_xyAnchor, car->_rigidBody, frameA, frameB, true);
			lock->setLinearLowerLimit(btVector3(0, 0, 1));
			lock->setLinearUpperLimit(btVector3(0, 0, 0));
			for (int axis = 3; axis < 6; axis++)
				lock->setLimit(axis, 1, 0);
			_bulletWorld.addConstraint(lock, true);
			car->_xyLock = lock;
		} else if (!want) {
			_RemoveXYLock(car);
			car->_xyLockPending = false;
		}
	}
}

void Arena::_RemoveXYLock(Car* car) {
	if (!car->_xyLock)
		return;
	_bulletWorld.removeConstraint(car->_xyLock);
	delete car->_xyLock;
	car->_xyLock = NULL;
}

void Arena::Step(int ticksToSimulate) {
	for (int i = 0; i < ticksToSimulate; i++) {
		if (frozen) { // RL PATCH: the bodies hold where they are
			tickCount++;
			continue;
		}

		_bulletWorld.setWorldUserInfo(this);

		// RL PATCH: the ball sleeps through Bullet's own deactivation, as in the game (stock updateActivationState,
		// FUN_1402c14a0): below 0.8 BU/s (40 uu/s) and 1 rad/s for gDeactivationTime (2 s), it falls asleep and its
		// velocities are zeroed. RocketSim woke the ball here every tick unless its velocity was exactly zero, so a slow
		// ball rolled on forever. Replays: a ball at rest falls asleep 2.0 s after being placed (782 of 795 kickoffs)

		bool ballOnly = _cars.empty();

		bool hasArenaStuff = (gameMode != GameMode::THE_VOID);
		
		// RL PATCH: the ball's start-of-tick velocity (OldRBState) for the car hit impulse (cars keep theirs in _oldState),
		// as the read-back makes it: in uu, capped and quantised, not the body's x50 of its x0.02 (RV-244)
		{
			btVector3 vel = ball->_rigidBody.m_linearVelocity * BT_TO_UU, angVel = ball->_rigidBody.m_angularVelocity;
			Quantize::ReadBackVelocities(vel, angVel, _mutatorConfig.ballMaxSpeed, RLConst::BALL_MAX_ANG_SPEED);
			ball->_startOfTickVel = vel;
			ball->_startOfTickPos = ball->_rigidBody.getWorldTransform().getOrigin() * BT_TO_UU;
		}
		ballWorldContacts.clear(); // RL PATCH
		boostPickups.clear(); // RL PATCH

		// RL PATCH: kickoff countdown, no input. The jump's edge still follows the real input (Car_TA.SetVehicleInput
		// calls OnJumpPressed only when Input.bJump changes, and OnJumpPressed returns while !bDriving: a press during the
		// countdown is swallowed, and one held through it doesn't jump at the release; static analysis RV-55)
		// The real input is put back after the tick, so a Step of several ticks keeps it for the next (RV-93)
		const bool countdown = kickoffCountdownTicks > 0;
		std::vector<CarControls> countdownControls;
		if (countdown) {
			for (Car* car : _cars) {
				countdownControls.push_back(car->controls);
				car->controls = CarControls();
			}
		}

		{ // RL PATCH: demolished cars' respawn spot selection, lock and respawn spot (in ID order, each respawning car
		  // avoiding the ones before; _UpdateDemolished)
			std::vector<Car::RespawnSpot> claimed;
			for (Car* car : _cars)
				if (car->_internalState.isDemoed)
					_UpdateDemolished(car, claimed);
		}

		for (Car* car : _cars) {
			car->_podiumMode = podiumMode; // RL PATCH
			car->_PreTickUpdate(gameMode, tickTime, _mutatorConfig, respawnsHeld);
		}

		if (hasArenaStuff && !ballOnly) {
			for (BoostPad* pad : _boostPads)
				pad->_PreTickUpdate(tickTime);
		}

		// Update ball
		ball->_PreTickUpdate(gameMode, tickTime);

		// RL PATCH: the ball's speed caps at the start of the step too (the cars': Car::_LimitVelocities)
		ball->_LimitVelocities(_mutatorConfig);

		// RL PATCH (KNB-7): the ball's location as the step starts: the explosion's (Ball_TA.Explode's ExplodeLocation
		// is its actor Location, one tick behind the body that crossed the line)
		const Vec ballAtStart = ball->_rigidBody.getWorldTransform().m_origin * BT_TO_UU;

		// RL PATCH: the XY locks (Car_TA's pre-step SetConstrained2D, every tick)
		_UpdateXYLocks(countdown);

		// Update world
		_bulletWorld.stepSimulation(tickTime, 0, tickTime);

		_UpdateWorldContacts(); // RL PATCH
		_UpdateImpacts(); // RL PATCH

		size_t carIndex = 0;
		for (Car* car : _cars) {
			car->_PostTickUpdate(gameMode, tickTime, _mutatorConfig);
			// RL PATCH (RV-55): through the countdown the last input's jump is the real one held, so its press at the
			// release doesn't count
			if (countdown && carIndex < countdownControls.size())
				car->_internalState.lastControls.jump = countdownControls[carIndex].jump;
			carIndex++;
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

		if (countdown) { // (RV-93)
			size_t i = 0;
			for (Car* car : _cars)
				if (i < countdownControls.size()) car->controls = countdownControls[i++];
		}

		if (hasArenaStuff && !ballOnly)
			for (BoostPad* pad : _boostPads) {
				// RL PATCH: a pickup is an active pad with a car on it (the car not full: BoostPadGrid)
				Car* taker = pad->_internalState.isActive ? pad->_internalState.curLockedCar : NULL;
				pad->_PostTickUpdate(tickTime, _mutatorConfig);
				if (taker)
					boostPickups.push_back({ taker->id, pad->config.isBig });
			}

		ball->_FinishPhysicsTick(_mutatorConfig);

		// Sync tiles state after the tick ends.
		// We don't want to sync the state on tile damage, 
		//	because that would cause the ball to immediately fall through the newly-broken tile.
		if (gameMode == GameMode::DROPSHOT)
			if (ball->_internalState.dsInfo.lastDamageTick && ball->_internalState.dsInfo.lastDamageTick == tickCount)
				SetDropshotTilesState(_dropshotTilesState);

		// RL PATCH: a goal explodes the ball (the game's Active.HandleHitGoal -> Ball.Explode: physics none, no
		// collision) until the kickoff reset, so it can't come back out and score again (match-rules audit MR-2).
		// RocketSim's ball played on
		if (gameMode != GameMode::THE_VOID && !ball->_internalState.isExploded && IsBallScored()) {
			goalBallSpeed = ball->_rigidBody.getLinearVelocity().length() * BT_TO_UU;
			ball->_internalState.isExploded = true;
			ball->_ApplyExploded();
			// The explosion goes off where the ball was as this step began (KNB-7: one tick short of the line), its
			// front from now on (between ticks)
			goalExplosion = GoalExplosion();
			goalExplosion.active = true;
			goalExplosion.origin = ballAtStart;
			goalExplosion.goalDir = goalExplosion.origin.y > 0 ? 1.f : -1.f;
		}

		_UpdateGoalExplosion(); // RL PATCH (KNB-5: between ticks, before the next one's cap)

		if (_goalScoreCallback.func != NULL) { // Potentially fire goal score callback
			if (IsBallScored()) {
				_goalScoreCallback.func(this, RS_TEAM_FROM_Y(-ball->_rigidBody.getWorldTransform().m_origin.y()), _goalScoreCallback.userInfo);
			}
		}

		if (_tickEndCallback.func != NULL) // RL PATCH
			_tickEndCallback.func(this, _tickEndCallback.userInfo);

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

	// RL PATCH: the cars' XY locks out and freed, then their fixed body
	for (Car* car : _cars)
		_RemoveXYLock(car);
	delete _xyAnchor;
	_xyAnchor = NULL;

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
	auto collisionOffsets = RocketSim::GetArenaCollisionOffsets(gameMode);

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
		_AddStaticCollisionShape(mesh, i < collisionOffsets.size() ? collisionOffsets[i] : btVector3(0, 0, 0), mask, mask);

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