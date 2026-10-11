#pragma once
// Match stats as the game's server computes them (notes/match-stats.md): the ball's touch history (Ball_TA Touches,
// RecordCarHit), StatFactory_TA's detection (touches, shots and saves, clears and centres, goals, demolitions, fives,
// post and crossbar hits) and PRI_TA's counters. Server only; driven by the arena's tick and bump callbacks.
#include "RocketSim.h"

#include <cstdint>
#include <map>
#include <vector>

namespace RLStats {

using RocketSim::Arena;
using RocketSim::Car;
using RocketSim::PhysState;
using RocketSim::Vec;

// StatEvent_TA objects (Soccar's StatEventCollection); the ids are the protocol's (protocol/README.md)
enum StatEvent : uint8_t {
	GOAL, AERIAL_GOAL, BACKWARDS_GOAL, BICYCLE_GOAL, TURTLE_GOAL, LONG_GOAL, OVERTIME_GOAL, HAT_TRICK,
	ASSIST, PLAYMAKER, POOL_SHOT, SHOT, SAVE, EPIC_SAVE, SAVIOR, CLEAR, CENTER, FIRST_TOUCH, BALL_HIT,
	CROSSBAR_HITS, AERIAL_HIT, BICYCLE_HIT, JUGGLE_HIT, DEMOLISH, DEMOLISHED, EXTERMINATION, LOW_FIVE, HIGH_FIVE,
	OWN_GOAL, MVP, WIN, LOSS, DEMOLITION_RESPAWN,
	STAT_EVENT_COUNT
};

struct StatEventInfo {
	int points;
	bool addToScore; // (else MatchBonusXP: all 0 in Soccar)
};
extern const StatEventInfo STAT_EVENTS[STAT_EVENT_COUNT];

// PRI_TA's match counters (replicated ones and the server's own), in the protocol's order
enum Counter : uint8_t {
	MATCH_SCORE, MATCH_GOALS, MATCH_ASSISTS, MATCH_SAVES, MATCH_SHOTS, MATCH_DEMOLISHES, MATCH_EPIC_SAVES,
	MATCH_CENTERS, MATCH_CLEARS, MATCH_AERIAL_HITS, MATCH_BICYCLE_HITS, MATCH_JUGGLE_HITS, MATCH_FIRST_TOUCHES,
	MATCH_POOL_SHOTS, MATCH_LOW_FIVES, MATCH_HIGH_FIVES, MATCH_TIMES_DEMOLISHED, MATCH_CROSSBAR_HITS, MATCH_OWN_GOALS,
	BALL_TOUCHES,
	COUNTER_COUNT
};

struct PlayerStats {
	int32_t counters[COUNTER_COUNT] = {};
	int32_t eventCounts[STAT_EVENT_COUNT] = {}; // (MatchStats: each event's count, for the podium titles)
};

// One award (GiveScore): the event to `car`, with the demolition's victim (0: none)
struct Award {
	StatEvent event;
	uint32_t car, victim;
	int32_t count;
};

// BallHitInfo (Ball_TA.Touches): one touch, its states before and after
struct Touch {
	uint32_t car = 0, attacker = 0; // (attacker: AttackerPRI, the car that bumped this one in the last 0.6 s)
	uint8_t team = 0;
	PhysState preHitCar; // the car's OldRBState
	Vec preHitBallPos, preHitBallVel; // the ball's OldRBState
	Vec postHitBallVel; // its state after the tick
	float distance = 0; // the ball's XY path since this touch (native: while it's the newest)
	float time = 0;
	Vec hitLocation, hitNormal; // (normal: out of the ball, towards the car)
	bool dodging = false, wheelsTouching = false, worldTouching = false;
	int hitId = 0;
};

enum class FactoryState : uint8_t { INACTIVE, ACTIVE, POST_GOAL };

// The goals' frames (Goal_TA.Init: Stadium_P)
struct GoalFrame {
	uint8_t team;
	Vec location; // (0, ±5120, 312)
	Vec saveDir; // out of the goal: (0, ±1, 0)
};

class StatFactory {
public:
	static constexpr size_t MAX_TOUCHES = 50;

	explicit StatFactory(Arena* arena) : _arena(arena) {}

	// The game's state: the factory counts while the round is active (Active), demolitions and fives after a goal
	// (PostGoalScored), nothing otherwise
	void SetState(FactoryState state);
	FactoryState GetState() const { return _state; }
	void SetOvertime(bool overtime) { _overtime = overtime; }
	// A new match: every player's counters back to 0
	void ResetMatch();
	void RemoveCar(uint32_t carId);

	// The arena's callbacks: a bump or demolition during the step, then the end of each tick (a goal: the ball exploding
	// while the round is active)
	void OnBump(Car* bumper, Car* victim, bool isDemo);
	void OnTickEnd();
	// A goal on `goalTeam`'s goal told from outside (a replay's), while the round is active
	void ScoreGoal(uint8_t goalTeam);

	// Awards since the last call, in order
	std::vector<Award> TakeAwards();
	const PlayerStats* GetStats(uint32_t carId) const;
	const std::vector<Touch>& GetTouches() const { return _touches; }
	int GetShotGoal() const { return _cache.shotGoal; } // (the goal the ball is a shot on: -1 none)

	// (exposed for tests)
	void RecordCarHit(Car* car, Vec hitLocation, Vec hitNormal);
	bool IsAerialHit(const Touch& hit) const;
	bool IsBicycleHit(const Touch& hit) const;
	static bool IsJuggleHit(const Touch& hit);
	bool IsTurtleHit(const Touch& hit) const;
	static bool IsBackwardsHit(const Touch& hit);
	bool IsLocationFarOffGround(Vec location) const;
	float Now() const;

private:
	struct BallCache {
		float ballHitTime = 0, specialHitTime = 0, juggleTime = 0, groundHitTime = 0, shotTime = 0, saveTime = 0;
		int shotGoal = -1, redZoneGoal = -1;
		uint32_t redZoneCar = 0;
		int redZoneHitId = 0;
	};
	struct CarTrack {
		uint64_t lastBallContactTick = ~0ULL; // (LastBallTouchFrame)
		float lastWheelTouchTime = -1e9f;
		bool wheelOnBall[4] = {};
		uint32_t attacker = 0;
		float attackerTime = -1e9f;
		bool demoed = false;
		std::map<StatEvent, float> cooldowns; // (StatCooldowns: UnlockWorldTime)
	};
	struct PendingBump { uint32_t bumper, victim; bool isDemo; };

	Arena* _arena;
	FactoryState _state = FactoryState::INACTIVE;
	bool _overtime = false;
	bool _gaveFirstTouch = false;
	bool _ballExploded = false;
	BallCache _cache;
	std::vector<Touch> _touches; // newest first
	Vec _ballOldLocation;
	bool _haveOldLocation = false;
	float _lastCrossbarTime = -1e9f;
	uint32_t _scoringCar = 0;
	std::vector<uint32_t> _carsIssuedFive;
	std::vector<uint32_t> _pendingRespawns;
	std::vector<PendingBump> _bumps;
	std::map<uint32_t, CarTrack> _tracks;
	std::map<uint32_t, PlayerStats> _stats;
	std::vector<Award> _awards;

	Car* _Car(uint32_t id) const;
	void _GiveScore(uint32_t car, StatEvent event, uint32_t victim = 0, int count = 1);
	void _Count(uint32_t car, Counter counter, int by = 1);
	int _Get(uint32_t car, Counter counter) const;
	bool _TryAwardTimeRestrictedStat(uint32_t car, StatEvent event);
	void _RegisterCar(uint32_t car);
	void _BeginActive();

	void _RecordTouches(uint64_t tick);
	void _OnCarTouch();
	void _OnBallHitWorld(Vec location, Vec normal);
	void _OnGoalScored(uint8_t goalTeam);
	void _OnCarDemolished(uint32_t attacker, uint32_t victim);
	void _OnBumpAfterGoal(uint32_t bumper, uint32_t victim);
	void _UpdateShotGoal();
	void _UpdateRedZone();
	int _FindShotGoal() const;
	bool _IsEpicSave(const Touch& hit, const GoalFrame& goal) const;
	bool _IsBallBehindGoal(const GoalFrame& goal) const;
	bool _OnMyHalf(Vec location, uint8_t team) const;
};

} // namespace RLStats
