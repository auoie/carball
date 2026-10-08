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

	// RL PATCH: a match's kickoff spots (the game's PrimaryStarts and NextSpawnIndex, static analysis MR-4): one random
	// order of the 5 kickoff spots per match (InitField's RandomizeSpawnPoints), a copy per team (orange's mirrored;
	// the uneven-teams adjustment changes the short team's copy), stepped by one each kickoff. Saved in snapshots.
	struct KickoffSequence {
		std::array<uint8_t, 5> order[2] = { { 0, 1, 2, 3, 4 }, { 0, 1, 2, 3, 4 } }; // CAR_SPAWN_LOCATIONS indices, per team
		uint8_t next = 0;      // the next kickoff's index into the order (NextSpawnIndex)
		uint16_t kickoffs = 0; // kickoffs since the match started (the uneven-teams adjustment skips the first)
		uint8_t teamSize = 0;  // the match's team size (the playlist's MaxTeamSize; it grows to the larger team)
	};
	KickoffSequence kickoffSequence;

	// RL PATCH: demolished cars aren't respawned while set (the game after a goal: PostGoalScored, until the kickoff
	// resets every car; static analysis MR-6). A match server sets it. Saved in snapshots and the network state
	bool respawnsHeld = false;

	// RL PATCH: the goal explosion's knockback (the ball's ExplosionComponent_X, static analysis MR-6): a wave from where
	// the ball scored, its front at 10000 uu/s up to 3000 uu; each car its front reaches (not demolished) gets one
	// velocity change of 5000 x (1 - front/3000)^0.1 away from a point 500 uu behind the ball (into the goal) and 500 uu
	// below it, no spin. Saved in snapshots and the network state
	struct GoalExplosion {
		bool active = false;
		Vec origin;            // the ball's location at the goal
		float goalDir = 0;     // the goal's side: +1 at +y, -1 at -y
		float lifeTime = 0;    // game time since it went off (s)
		std::vector<uint32_t> hitCars; // the cars it has pushed (DamagedActors: once each)
	};
	GoalExplosion goalExplosion;

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

	// RL PATCH: a new match's kickoff order, shuffled from `seed` (every platform the same); teamSize: the match's
	// team size (the playlist's MaxTeamSize, 0: the larger team's)
	void StartKickoffSequence(int seed, int teamSize = 0);
	// RL PATCH: the match's next kickoff (as the game's): car k of each team (in ID order) at order[(next + k) % 5];
	// from the second kickoff on, a team with fewer cars gets the most central spot of the other team's spots for its
	// last car (bUseDisadvantageSpawnAdjustment); then the index steps
	void ResetToNextKickoff();
	// RL PATCH: the current kickoff again (a player joined during its countdown: the others keep their spots, the new
	// car takes the next free one)
	void RedoKickoff();

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
	// RL PATCH: cars at the kickoff spots: car k of team t at orders[t][(first + k) % spots] (beyond the spots, the
	// respawn spots), the ball at the centre, pads reset
	void _ResetToKickoff(const std::array<uint8_t, 5> orders[2], int first, std::minstd_rand0* randEngine);
	// RL PATCH: one tick of the goal explosion's wave (before the physics step)
	void _UpdateGoalExplosion();
	void _SerializeContacts(DataStreamOut& out);
	void _DeserializeContacts(DataStreamIn& in);
	void SetDropshotTilesState(const DropshotTilesState& tilesState);

private:
	
	// Constructor for use by Arena::Create()
	Arena(GameMode gameMode, const ArenaConfig& config, float tickRate = 120);

	// Making this private because horrible memory overflows can happen if you changed it
	ArenaConfig _config;
};

// RL PATCH: the goal explosion's wave as bytes (snapshots, the network state)
void _WriteGoalExplosion(DataStreamOut& out, const Arena::GoalExplosion& ex);
void _ReadGoalExplosion(DataStreamIn& in, Arena::GoalExplosion& ex);

RS_NS_END