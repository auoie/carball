#pragma once
#include "../../BaseInc.h"
#include <set>
#include "../Car/Car.h"
#include "../Ball/Ball.h"
#include "../BoostPad/BoostPad.h"
#include "../CollisionMasks.h"

#include "../../CollisionMeshFile/CollisionMeshFile.h"
#include "../BoostPad/BoostPadGrid/BoostPadGrid.h"
#include "../MutatorConfig/MutatorConfig.h"
#include "ArenaConfig/ArenaConfig.h"
#include "DropshotTiles/DropshotTiles.h"

#include "../../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btDbvtBroadphase.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btStaticPlaneShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btBvhTriangleMeshShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btCollisionDispatcher.h"
#include "../../../libsrc/bullet3-3.24/BulletDynamics/ConstraintSolver/btSequentialImpulseConstraintSolver.h"
#include "../../../libsrc/bullet3-3.24/BulletDynamics/Dynamics/btDiscreteDynamicsWorld.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btDefaultCollisionConfiguration.h"

RS_NS_START

typedef std::function<void(class Arena* arena, Team scoringTeam, void* userInfo)> GoalScoreEventFn;
typedef std::function<void(class Arena* arena, Car* bumper, Car* victim, bool isDemo, void* userInfo)> CarBumpEventFn;

// The container for all game simulation
// Stores cars, the ball, all arena collisions, and manages the overall game state
class Arena {
public:

	GameMode gameMode;

	uint32_t _lastCarID = 0;
	// RL PATCH: cars ordered by ID. An unordered_set of pointers iterates in memory-address order,
	// so update order (e.g. who gets a contested boost pad) differed between runs, platforms and
	// restored snapshots.
	struct CarIDCompare {
		bool operator()(const Car* a, const Car* b) const { return a->id < b->id; }
	};
	typedef std::set<Car*, CarIDCompare> CarSet;
	CarSet _cars;
	bool ownsCars = true; // If true, deleting this arena instance deletes all cars

	std::unordered_map<uint32_t, Car*> _carIDMap;
	
	Ball* ball;
	bool ownsBall = true; // If true, deleting this arena instance deletes the ball
	
	std::vector<BoostPad*> _boostPads;
	bool ownsBoostPads = true; // If true, deleing this arena instance deletes all boost pads
	
	BoostPadGrid _boostPadGrid;

	MutatorConfig _mutatorConfig;

	DropshotTilesState _dropshotTilesState;

	const MutatorConfig& GetMutatorConfig() { return _mutatorConfig; }
	void SetMutatorConfig(const MutatorConfig& mutatorConfig);

	// Time in seconds each tick (1/tickrate)
	float tickTime; 

	// Returns (1 / tickTime)
	float GetTickRate() const {
		return 1 / tickTime;
	}

	// Total ticks this arena instance has been simulated for, never resets
	uint64_t tickCount = 0;

	// RL PATCH: kickoff countdown: while non-zero, every car's controls are zeroed for the tick, then it counts down.
	// The game freezes the cars for 4.0 s after a kickoff reset (replays: the first car moves 3.99-4.05 s after the
	// reset; the "3-2-1" countdown, WarmupTime 3, plus a second). ResetToRandomKickoff leaves it alone (freeplay
	// has no countdown); a match server sets it. Saved in snapshots and the network state.
	uint32_t kickoffCountdownTicks = 0;

	const CarSet& GetCars() { return _cars; }
	const std::vector<BoostPad*>& GetBoostPads() { return _boostPads; }

	// Returns true if added, false if car was already added
	bool _AddCarFromPtr(Car* car);
	Car* AddCar(Team team, const CarConfig& config = CAR_CONFIG_OCTANE);

	// Returns false if the car ID was not found in the cars list
	bool RemoveCar(uint32_t id);

	// Returns false if the car was not found in the cars list
	// NOTE: If the car was removed, the car will be freed and the pointer will be made invalid
	bool RemoveCar(Car* car) {
		return RemoveCar(car->id);
	}

	Car* GetCar(uint32_t id);

	btDiscreteDynamicsWorld _bulletWorld;
	struct {
		btDefaultCollisionConfiguration collisionConfig;
		btCollisionDispatcher collisionDispatcher;
		btOverlappingPairCache* overlappingPairCache;
		btBroadphaseInterface* broadphase;
		btSequentialImpulseConstraintSolver constraintSolver;
	} _bulletWorldParams;

	std::vector<btRigidBody*> _worldCollisionRBs = {};
	std::vector<btBvhTriangleMeshShape*> _worldCollisionBvhShapes = {};
	std::vector<btStaticPlaneShape*> _worldCollisionPlaneShapes = {};
	std::vector<btRigidBody*> _worldDropshotTileRBs = {};

	struct {
		GoalScoreEventFn func = NULL;
		void* userInfo = NULL;
	} _goalScoreCallback;
	void SetGoalScoreCallback(GoalScoreEventFn callbackFn, void* userInfo = NULL);

	struct {
		CarBumpEventFn func = NULL;
		void* userInfo = NULL;
	} _carBumpCallback;
	void SetCarBumpCallback(CarBumpEventFn callbackFn, void* userInfo = NULL);

	// NOTE: Arena should be destroyed after use
	static Arena* Create(GameMode gameMode, const ArenaConfig& arenaConfig = {}, float tickRate = 120);
	
	// Serialize entire arena state including cars, ball, and boostpads
	void Serialize(DataStreamOut& out) const;

	// Load new arena from serialized data
	static Arena* DeserializeNew(DataStreamIn& in);

	// RL PATCH: loads a snapshot into this arena, keeping its physics world: far faster than DeserializeNew(),
	// which builds a whole arena (for rollback). The snapshot must have the same game mode, tick rate, arena
	// config and cars (IDs, teams, car bodies). Returns false and changes nothing when it doesn't.
	bool DeserializeInPlace(DataStreamIn& in);

	Arena(const Arena& other) = delete; // No copy constructor, use Arena::Clone() instead
	Arena& operator =(const Arena& other) = delete; // No copy operator, use Arena::Clone() instead

	Arena(Arena&& other) = delete; // No move constructor
	Arena& operator =(Arena&& other) = delete; // No move operator

	// Get a deep copy of the arena
	Arena* Clone(bool copyCallbacks);

	// NOTE: Car ID will not be restored
	Car* DeserializeNewCar(DataStreamIn& in, Team team);

	// Simulate everything in the arena for a given number of ticks
	void Step(int ticksToSimulate = 1);

	void ResetToRandomKickoff(int seed = -1);

	// Returns true if the ball is probably going in, does not account for wall or ceiling bounces
	// NOTE: Purposefully overestimates, just like the real RL's shot prediction
	// To check which goal it will score in, use the ball's velocity
	// Margin can be manually adjusted with extraMargin (negative to prevent overestimating)
	bool IsBallProbablyGoingIn(float maxTime = 2.f, float extraMargin = 0, Team* goalTeamOut = NULL) const;

	// Returns true if the ball is in the net
	// Works for all gamemodes (and does nothing in THE_VOID)
	bool IsBallScored() const;

	// Free all associated memory
	~Arena();

	// NOTE: Passed shape pointer will be freed when arena is deconstructed
	// NOTE: Shape will be automatically added to _worldCollisionRBs but no other list 
	btRigidBody* _AddStaticCollisionShape(
		btCollisionShape* shape,
		btVector3 posBT = btVector3(0, 0, 0),
		int group = 0, int mask = 0);

	void _SetupArenaCollisionShapes();

	// RL PATCH: respawning (see Arena.cpp): the team's respawn spots (side 0 all, 1 left, 2 right: inner first), whether
	// a spot is taken (`claimed`: spots of cars respawning this tick), the game's spot choice, and a demolished car's
	// selection, prespawn lock and respawn spot
	std::vector<Car::RespawnSpot> _RespawnSpots(Team team, int side = 0);
	bool _SpawnTaken(Vec pos, Car* car, const std::vector<Car::RespawnSpot>& claimed);
	bool _SpawnFromSpots(Car* car, const std::vector<Car::RespawnSpot>& spots, int start,
		const std::vector<Car::RespawnSpot>& claimed, Car::RespawnSpot& out);
	bool _SpawnOffset(Car* car, const Car::RespawnSpot& spot, const std::vector<Car::RespawnSpot>& claimed, Car::RespawnSpot& out);
	Car::RespawnSpot _ChooseSpawn(Car* car, const std::vector<Car::RespawnSpot>& claimed, bool usePreference);
	void _UpdateDemolished(Car* car, std::vector<Car::RespawnSpot>& claimed);

	// Static function called by Bullet internally when adding a collision point
	static bool _BulletContactAddedCallback(
		btManifoldPoint& cp,
		const btCollisionObjectWrapper* colObjA, int partID_A, int indexA,
		const btCollisionObjectWrapper* colObjB, int partID_B, int indexB
	);

	void _BtCallback_OnCarBallCollision(Car* car, Ball* ball, btManifoldPoint& manifoldPoint, bool ballIsBodyA);
	void _BtCallback_OnCarCarCollision(Car* car1, Car* car2, btManifoldPoint& manifoldPoint);
	void _BtCallback_OnCarWorldCollision(Car* car, btCollisionObject* worldObject, btManifoldPoint& manifoldPoint);

	const ArenaConfig& GetArenaConfig() const {
		return _config;
	}

	// Backwards compatability
	ArenaMemWeightMode GetMemWeightMode() {
		return _config.memWeightMode;
	}

	DropshotTilesState GetDropshotTilesState() const { return _dropshotTilesState; };

	// RL PATCH: Bullet's persistent contact points, part of snapshots (see Arena.cpp)
	void _SerializeContacts(DataStreamOut& out);
	void _DeserializeContacts(DataStreamIn& in);
	void SetDropshotTilesState(const DropshotTilesState& tilesState);

private:
	
	// Constructor for use by Arena::Create()
	Arena(GameMode gameMode, const ArenaConfig& config, float tickRate = 120);

	// Making this private because horrible memory overflows can happen if you changed it
	ArenaConfig _config;
};

RS_NS_END