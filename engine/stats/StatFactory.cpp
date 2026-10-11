#include "StatFactory.h"

#include "Sim/GameRotator/GameRotator.h"

#include <algorithm>
#include <cmath>

namespace RLStats {

using namespace RocketSim;

// Points and bAddToScore (notes/match-stats.md §2)
const StatEventInfo STAT_EVENTS[STAT_EVENT_COUNT] = {
	{ 100, true }, // GOAL
	{ 20, true }, // AERIAL_GOAL
	{ 20, true }, // BACKWARDS_GOAL
	{ 20, true }, // BICYCLE_GOAL
	{ 20, true }, // TURTLE_GOAL
	{ 20, true }, // LONG_GOAL
	{ 25, true }, // OVERTIME_GOAL
	{ 25, true }, // HAT_TRICK
	{ 50, true }, // ASSIST
	{ 25, true }, // PLAYMAKER
	{ 20, true }, // POOL_SHOT
	{ 10, true }, // SHOT
	{ 50, true }, // SAVE
	{ 75, true }, // EPIC_SAVE
	{ 25, true }, // SAVIOR
	{ 20, true }, // CLEAR
	{ 10, true }, // CENTER
	{ 0, true }, // FIRST_TOUCH
	{ 2, true }, // BALL_HIT
	{ 2, true }, // CROSSBAR_HITS
	{ 0, true }, // AERIAL_HIT
	{ 0, true }, // BICYCLE_HIT
	{ 0, true }, // JUGGLE_HIT
	{ 0, true }, // DEMOLISH
	{ 0, false }, // DEMOLISHED
	{ 20, true }, // EXTERMINATION
	{ 5, true }, // LOW_FIVE
	{ 20, true }, // HIGH_FIVE
	{ 0, true }, // OWN_GOAL
	{ 0, false }, // MVP
	{ 0, false }, // WIN
	{ 0, false }, // LOSS
	{ 0, false }, // DEMOLITION_RESPAWN
	{ 0, false }, // MOST_BOOST_PICKUPS
	{ 0, false }, // FEWEST_BOOST_PICKUPS
	{ 0, false }, // MOST_BALL_TOUCHES
	{ 0, false }, // FEWEST_BALL_TOUCHES
	{ 0, false }, // MOST_CAR_TOUCHES
	{ 0, false }, // FURTHEST_GOAL
	{ 0, false }, // FASTEST_GOAL
	{ 0, false }, // SLOWEST_GOAL
};

namespace {
// StatFactory archetype, GameEvent_Soccar, Goal_TA defaults (§1.1)
constexpr float SHOT_ARRIVE_TIME = 1.5f, SHOT_MAX_DISTANCE = 2300, GOAL_SIZE_FUDGE = 100;
constexpr float RED_ZONE_DISTANCE = 2300;
constexpr float JUGGLE_MIN_SPEED = 500, BULLET_HIT_SPEED = 3200;
constexpr float AERIAL_HIT_HEIGHT = 500, AERIAL_HIT_MIN_REL_SPEED = 100, BICYCLE_SPIN_SPEED = 250;
constexpr float LONG_GOAL_DISTANCE = 7000, ASSIST_MAX_TIME = 5;
constexpr int HAT_TRICK_THRESHOLD = 3, PLAYMAKER_THRESHOLD = 3, SAVIOR_THRESHOLD = 3, DEMOLITION_THRESHOLD = 7;
constexpr float STAT_COOLDOWN_SECONDS = 5; // (Save and Shot: CooldownSeconds)
constexpr float CROSSBAR_HITS_COOLDOWN = 0.1f;
constexpr float EPIC_SAVE_MIN_SPEED = 500, EPIC_SAVE_ARRIVE_TIME = 0.25f;
constexpr float BALL_HIT_INTERVAL = 1, SPECIAL_HIT_INTERVAL = 0.5f, WHEEL_TOUCH_INTERVAL = 0.15f;
constexpr float ATTACKER_SECONDS = 0.6f; // (Car_TA.BumpCar's AttackerPRI, cleared after 0.6 s)
constexpr float BALL_RADIUS = 95.49f; // (Ball_TA.UpdateRadius: notes/match-rules-audit.md)
constexpr float GOAL_HALF_WIDTH = 960, GOAL_HALF_HEIGHT = 376; // (LocalExtent Y, Z)

// Soccar's goals in the game's order (Goal_TA.Init in Stadium_P); WorldFrontCenter = Location
const GoalFrame GOALS[2] = {
	{ 0, Vec(0, -5120, 312), Vec(0, 1, 0) },
	{ 1, Vec(0, 5120, 312), Vec(0, -1, 0) },
};

// GoalCrossbarVolume_TA x6 (Stadium_P): centre, half-extent
struct Box { Vec centre, half; };
const Box CROSSBAR_VOLUMES[6] = {
	{ Vec(3.2f, -5120, 626.8f), Vec(967.7f, 65.6f, 65.6f) },
	{ Vec(3.2f, 5120, 626.8f), Vec(967.7f, 65.6f, 65.6f) },
	{ Vec(-892.8f, -5120, 322.8f), Vec(68.8f, 68.8f, 366) },
	{ Vec(899.2f, -5120, 322.8f), Vec(68.8f, 68.8f, 366) },
	{ Vec(-892.8f, 5120, 322.8f), Vec(68.8f, 68.8f, 366) },
	{ Vec(899.2f, 5120, 322.8f), Vec(68.8f, 68.8f, 366) },
};

bool Inside(const Box& b, Vec p) {
	return fabsf(p.x - b.centre.x) <= b.half.x && fabsf(p.y - b.centre.y) <= b.half.y && fabsf(p.z - b.centre.z) <= b.half.z;
}

// The goal's local Y axis (its Rotation's: yaw ±16384)
Vec GoalRight(const GoalFrame& g) { return Vec(-g.saveDir.y, g.saveDir.x, 0); }

} // namespace

float StatFactory::Now() const {
	// (WorldInfo.TimeSeconds once this tick has run: the callback comes before the arena counts it)
	return (float)((double)(_arena->tickCount + 1) * _arena->tickTime);
}

Car* StatFactory::_Car(uint32_t id) const {
	for (Car* car : _arena->GetCars())
		if (car->id == id)
			return car;
	return nullptr;
}

void StatFactory::SetState(FactoryState state) {
	if (state == _state)
		return;
	_state = state;
	if (state == FactoryState::ACTIVE)
		_BeginActive();
}

// Active.BeginState: the ball's cache rebuilt (Ball_TA.Reset clears its touches at the kickoff), the first touch
// open again, every car registered (cooldowns reset), no respawns pending
void StatFactory::_BeginActive() {
	_cache = BallCache();
	_touches.clear();
	_gaveFirstTouch = false;
	_pendingRespawns.clear();
	for (Car* car : _arena->GetCars())
		_RegisterCar(car->id);
}

void StatFactory::_RegisterCar(uint32_t car) { _tracks[car].cooldowns.clear(); }

void StatFactory::ResetMatch() {
	_stats.clear();
	_goalRecords = {};
	for (auto& [id, track] : _tracks)
		track.cooldowns.clear();
}

void StatFactory::RemoveCar(uint32_t carId) {
	_tracks.erase(carId);
	_stats.erase(carId);
}

void StatFactory::OnBump(Car* bumper, Car* victim, bool isDemo) { _bumps.push_back({ bumper->id, victim->id, isDemo }); }

std::vector<Award> StatFactory::TakeAwards() {
	std::vector<Award> out;
	out.swap(_awards);
	return out;
}

const PlayerStats* StatFactory::GetStats(uint32_t carId) const {
	auto it = _stats.find(carId);
	return it == _stats.end() ? nullptr : &it->second;
}

// StatFactory.GiveScore -> PRI.GiveScore -> OnGainedStat: MatchScore, MatchStats; a player gone (no team) gets nothing
void StatFactory::_GiveScore(uint32_t car, StatEvent event, uint32_t victim, int count) {
	if (!_Car(car))
		return;
	PlayerStats& s = _stats[car];
	if (STAT_EVENTS[event].addToScore)
		s.counters[MATCH_SCORE] += STAT_EVENTS[event].points;
	s.eventCounts[event] += count;
	s.eventPresent[event] = true;
	_awards.push_back({ event, car, victim, count });
}

// GiveScore then SetStatCount, for the match end's events: MatchStats only (no points, nothing sent)
void StatFactory::_SetMatchStat(uint32_t car, StatEvent event, int count) {
	if (!_Car(car))
		return;
	PlayerStats& s = _stats[car];
	s.eventCounts[event] = count;
	s.eventPresent[event] = true;
}

void StatFactory::_Count(uint32_t car, Counter counter, int by) {
	if (_Car(car))
		_stats[car].counters[counter] += by;
}

int StatFactory::_Get(uint32_t car, Counter counter) const {
	auto it = _stats.find(car);
	return it == _stats.end() ? 0 : it->second.counters[counter];
}

// PRI_TA.TryAwardTimeRestrictedStat
bool StatFactory::_TryAwardTimeRestrictedStat(uint32_t car, StatEvent event) {
	float now = Now();
	auto& cooldowns = _tracks[car].cooldowns;
	auto it = cooldowns.find(event);
	if (it == cooldowns.end()) {
		cooldowns[event] = now + STAT_COOLDOWN_SECONDS;
		return true;
	}
	if (it->second <= now) {
		it->second = now + STAT_COOLDOWN_SECONDS;
		return true;
	}
	return false;
}

// FastTrace(Loc - (0, 0, 500), Loc): world geometry only, each of the arena's static bodies tested directly (the
// broadphase is built for short rays)
bool StatFactory::IsLocationFarOffGround(Vec location) const {
	btVector3 from = location * UU_TO_BT, to = (location - Vec(0, 0, AERIAL_HIT_HEIGHT)) * UU_TO_BT;
	btTransform fromT(btMatrix3x3::getIdentity(), from), toT(btMatrix3x3::getIdentity(), to);
	btCollisionWorld::ClosestRayResultCallback callback(from, to, nullptr);
	for (btRigidBody* body : _arena->_worldCollisionRBs)
		btCollisionWorld::rayTestSingle(fromT, toT, body, body->getCollisionShape(), body->getWorldTransform(), callback);
	return !callback.hasHit();
}

bool StatFactory::IsAerialHit(const Touch& hit) const {
	if (hit.wheelsTouching || hit.worldTouching || hit.preHitCar.pos.z < AERIAL_HIT_HEIGHT)
		return false;
	if ((hit.preHitCar.vel - hit.preHitBallVel).Length() < AERIAL_HIT_MIN_REL_SPEED)
		return false;
	return IsLocationFarOffGround(hit.preHitCar.pos);
}

bool StatFactory::IsBicycleHit(const Touch& hit) const {
	if (hit.wheelsTouching || !hit.dodging)
		return false;
	RotMat axes = GameRotatorBasis(hit.preHitCar.rotMat);
	if (-hit.preHitCar.angVel.Dot(axes.right) * 57.2958f < BICYCLE_SPIN_SPEED)
		return false;
	Vec offset = hit.hitLocation - hit.preHitCar.pos;
	return axes.forward.Dot(offset) >= 0 && axes.up.Dot(offset) >= 0;
}

bool StatFactory::IsJuggleHit(const Touch& hit) {
	return hit.preHitCar.pos.z < hit.preHitBallPos.z && hit.postHitBallVel.z >= JUGGLE_MIN_SPEED;
}

bool StatFactory::IsTurtleHit(const Touch& hit) const {
	Car* car = _Car(hit.car); // (the car's contact now, not the touch's)
	if (!car || !car->_internalState.worldContact.hasContact || car->_internalState.worldContact.contactNormal.z <= 0.707f)
		return false;
	return abs(UERotatorFromMatrix(hit.preHitCar.rotMat).roll) > 16384;
}

bool StatFactory::IsBackwardsHit(const Touch& hit) {
	if (hit.dodging || hit.car == 0)
		return false;
	Vec rear = GameRotatorBasis(hit.preHitCar.rotMat).forward * -1;
	Vec rearPoint = hit.preHitCar.pos + rear * 40;
	return (hit.hitLocation - rearPoint).Dot(rear) > 0 && rear.Dot(hit.hitNormal) < 0;
}

// Ball_TA.RecordCarHit / SetBallHitData: a new touch at the front (the same car's touch in the same frame replaced),
// then EventCarTouch (StatFactory.OnCarTouch while the round is active)
void StatFactory::RecordCarHit(Car* car, Vec hitLocation, Vec hitNormal) {
	float now = Now();
	const CarTrack& track = _tracks[car->id];
	Touch t;
	t.car = car->id;
	t.team = (uint8_t)car->team;
	t.attacker = (track.attacker && now - track.attackerTime < ATTACKER_SECONDS) ? track.attacker : 0;
	t.preHitCar = car->_oldState;
	t.preHitBallPos = _arena->ball->_startOfTickPos;
	t.preHitBallVel = _arena->ball->_startOfTickVel;
	t.postHitBallVel = _arena->ball->GetState().vel;
	t.time = now;
	t.hitLocation = hitLocation;
	t.hitNormal = hitNormal;
	t.dodging = car->_internalState.isFlipping;
	for (int i = 0; i < 4; i++) {
		const auto& wheel = car->_bulletVehicle.m_wheelInfo[i];
		t.wheelsTouching |= wheel.m_raycastInfo.m_isInContact && wheel.m_isInContactWithWorld;
	}
	t.worldTouching = car->_internalState.worldContact.hasContact;
	t.hitId = _touches.empty() ? 1 : _touches[0].hitId + 1;
	if (!_touches.empty() && _touches[0].time == t.time && _touches[0].car == t.car) {
		_touches[0] = t;
	} else {
		_touches.insert(_touches.begin(), t);
		if (_touches.size() > MAX_TOUCHES)
			_touches.pop_back();
	}
	if (_state == FactoryState::ACTIVE)
		_OnCarTouch();
}

// StatFactory_TA.OnCarTouch
void StatFactory::_OnCarTouch() {
	if (_ballExploded) // (bCanBeScored)
		return;
	const Touch& hit = _touches[0];
	_cache.redZoneHitId = 0; // (the script's BallIdx is still 0 here: with one ball, this ball's)
	if (!_gaveFirstTouch) {
		_gaveFirstTouch = true;
		_GiveScore(hit.car, FIRST_TOUCH);
		_Count(hit.car, MATCH_FIRST_TOUCHES);
		return;
	}
	if (hit.time - _cache.ballHitTime > BALL_HIT_INTERVAL) {
		_GiveScore(hit.car, BALL_HIT);
		_cache.ballHitTime = hit.time;
	}
	if (hit.time - _cache.specialHitTime > SPECIAL_HIT_INTERVAL) {
		if ((hit.preHitBallVel - hit.postHitBallVel).Length() >= BULLET_HIT_SPEED)
			_cache.specialHitTime = hit.time; // (BulletHit is None in Soccar: no award, but the window restarts)
		if (IsBicycleHit(hit)) {
			_GiveScore(hit.car, BICYCLE_HIT);
			_Count(hit.car, MATCH_BICYCLE_HITS);
			_cache.specialHitTime = hit.time;
		}
		if (IsAerialHit(hit)) {
			_GiveScore(hit.car, AERIAL_HIT);
			_Count(hit.car, MATCH_AERIAL_HITS);
			_cache.specialHitTime = hit.time;
		}
		if (IsJuggleHit(hit)) {
			int n = 1;
			float minTime = std::max(_cache.juggleTime, _cache.groundHitTime);
			for (size_t i = 1; i < _touches.size() && n < 3; i++) {
				const Touch& earlier = _touches[i];
				if (earlier.car != hit.car || earlier.time <= minTime || !IsJuggleHit(earlier))
					break;
				n++;
			}
			if (n >= 3) {
				_GiveScore(hit.car, JUGGLE_HIT);
				_cache.juggleTime = Now();
				_cache.specialHitTime = hit.time;
				_Count(hit.car, MATCH_JUGGLE_HITS);
			}
		}
	}
}

// Car_TA.OnHitBall (a touch when the car's previous contact frame is 2 or more physics frames back) and
// HandleWheelContactChanged (a wheel newly on the ball, at most every 0.15 s)
void StatFactory::_RecordTouches(uint64_t tick) {
	float now = Now();
	for (Car* car : _arena->GetCars()) {
		CarTrack& track = _tracks[car->id];
		if (car->_internalState.isDemoed)
			continue;
		const BallHitInfo& info = car->_internalState.ballHitInfo;
		if (info.isValid && info.tickCountWhenHit == tick) {
			if (track.lastBallContactTick == ~0ULL || tick - track.lastBallContactTick >= 2) {
				Vec point = car->_ballContactPoint;
				RecordCarHit(car, point, (point - info.ballPos).Normalized());
				_Count(car->id, BALL_TOUCHES);
			}
			track.lastBallContactTick = tick;
		}
		bool newlyOnBall = false;
		Vec location, normal;
		for (int i = 0; i < 4; i++) {
			const auto& ray = car->_bulletVehicle.m_wheelInfo[i].m_raycastInfo;
			bool onBall = ray.m_isInContact && ray.m_groundObject == &_arena->ball->_rigidBody;
			if (onBall && !track.wheelOnBall[i]) {
				newlyOnBall = true;
				location = ray.m_contactPointWS * BT_TO_UU;
				normal = ray.m_contactNormalWS;
			}
			track.wheelOnBall[i] = onBall;
		}
		if (newlyOnBall && now - track.lastWheelTouchTime >= WHEEL_TOUCH_INTERVAL) {
			track.lastWheelTouchTime = now;
			RecordCarHit(car, location, normal);
		}
	}
}

// StatFactory.OnBallHitWorld (the ground for juggles) and GoalCrossbarVolumeManager_TA.TriggerHit -> OnBallHitCrossbar
void StatFactory::_OnBallHitWorld(Vec location, Vec normal) {
	if (_state != FactoryState::ACTIVE)
		return;
	float now = Now();
	if (normal.z > 0.1f)
		_cache.groundHitTime = now;
	bool crossbar = false;
	for (const Box& box : CROSSBAR_VOLUMES)
		crossbar |= Inside(box, location);
	if (crossbar && !_touches.empty() && now - _lastCrossbarTime >= CROSSBAR_HITS_COOLDOWN) {
		_lastCrossbarTime = now;
		_GiveScore(_touches[0].car, CROSSBAR_HITS);
		_Count(_touches[0].car, MATCH_CROSSBAR_HITS);
	}
}

bool StatFactory::_IsBallBehindGoal(const GoalFrame& goal) const {
	Vec ball = _arena->ball->GetState().pos;
	return (goal.location - (ball + goal.saveDir * BALL_RADIUS)).Dot(goal.saveDir) > 0;
}

// GameEvent_Soccar_TA.OnMyHalf: the nearest goal (the other teams' 100 farther, squared) is the team's
bool StatFactory::_OnMyHalf(Vec location, uint8_t team) const {
	int best = -1;
	float bestDistance = 0;
	for (int i = 0; i < 2; i++) {
		float d = (location - GOALS[i].location).LengthSq() + (GOALS[i].team != team ? 100.f : 0.f);
		if (best == -1 || d < bestDistance) {
			best = i;
			bestDistance = d;
		}
	}
	return GOALS[best].team == team;
}

// StatFactory_TA.FindShotGoal: the goal the ball would reach within 1.5 s, from its half, within 2300 of its centre
int StatFactory::_FindShotGoal() const {
	BallState ball = _arena->ball->GetState();
	float gravity = _arena->GetMutatorConfig().gravity.z;
	for (int i = 0; i < 2; i++) {
		const GoalFrame& goal = GOALS[i];
		float speed = ball.vel.Dot(goal.saveDir * -1);
		if (speed > 0 && _OnMyHalf(ball.pos, goal.team) && !_IsBallBehindGoal(goal)) {
			float distance = (ball.pos - goal.location).Dot(goal.saveDir);
			float t = std::max(distance, 0.f) / speed;
			if (t < SHOT_ARRIVE_TIME && (ball.pos - goal.location).Length() < SHOT_MAX_DISTANCE) {
				Vec at = ball.pos + ball.vel * t + Vec(0, 0, 0.5f * gravity * t * t);
				Vec local = at - goal.location;
				float y = local.Dot(GoalRight(goal)), z = local.z;
				if (-(GOAL_HALF_WIDTH + GOAL_SIZE_FUDGE) < y && y < GOAL_HALF_WIDTH + GOAL_SIZE_FUDGE && z < GOAL_HALF_HEIGHT + GOAL_SIZE_FUDGE)
					return i;
			}
		}
	}
	return -1;
}

// StatFactory_TA.IsEpicSave: the ball already at the goal line's plane, or (the car airborne or fast) arriving within
// 0.25 s
bool StatFactory::_IsEpicSave(const Touch& hit, const GoalFrame& goal) const {
	float d = (hit.preHitBallPos - goal.location).Dot(goal.saveDir) - BALL_RADIUS;
	if (d <= 0)
		return true;
	if (!hit.wheelsTouching || hit.preHitCar.vel.Length() > EPIC_SAVE_MIN_SPEED) {
		float speed = hit.preHitBallVel.Dot(goal.saveDir * -1);
		if (speed > 0)
			return d / speed <= EPIC_SAVE_ARRIVE_TIME;
	}
	return false;
}

// StatFactory_TA.UpdateShotGoal: a tracked shot stopping without going in is a save by the last toucher if they defend;
// a new shot counts once per touch for an attacker
void StatFactory::_UpdateShotGoal() {
	int shot = _FindShotGoal();
	if (shot == _cache.shotGoal)
		return;
	const Touch t0 = _touches[0];
	if (_cache.shotGoal != -1) {
		const GoalFrame& goal = GOALS[_cache.shotGoal];
		if (!_IsBallBehindGoal(goal) && t0.team == goal.team && _TryAwardTimeRestrictedStat(t0.car, SAVE)) {
			if (_IsEpicSave(t0, goal)) {
				_GiveScore(t0.car, EPIC_SAVE);
				_Count(t0.car, MATCH_EPIC_SAVES);
			} else {
				_GiveScore(t0.car, SAVE);
			}
			_cache.saveTime = t0.time;
			_Count(t0.car, MATCH_SAVES);
			if (_Get(t0.car, MATCH_SAVES) % SAVIOR_THRESHOLD == 0)
				_GiveScore(t0.car, SAVIOR);
		}
	}
	if (shot != -1) {
		if (t0.team != GOALS[shot].team) {
			_cache.shotGoal = shot;
			if (_cache.shotTime != t0.time) {
				_cache.shotTime = t0.time;
				if (_TryAwardTimeRestrictedStat(t0.car, SHOT)) {
					_Count(t0.car, MATCH_SHOTS);
					_GiveScore(t0.car, SHOT);
				}
			}
		}
	} else {
		_cache.shotGoal = -1;
	}
}

// StatFactory_TA.UpdateRedZone: leaving a goal's 2300 sphere off a defender is a clear, entering it off an attacker
// (not a shot) a centre
void StatFactory::_UpdateRedZone() {
	Vec ball = _arena->ball->GetState().pos;
	int zone = -1;
	float best = 0;
	for (int i = 0; i < 2; i++) {
		float d = (ball - GOALS[i].location).Length();
		if (d <= RED_ZONE_DISTANCE && !_IsBallBehindGoal(GOALS[i]) && (zone == -1 || d < best)) {
			zone = i;
			best = d;
		}
	}
	if (zone == _cache.redZoneGoal)
		return;
	const Touch& t0 = _touches[0];
	if (_cache.redZoneGoal != -1 && t0.team == GOALS[_cache.redZoneGoal].team && t0.car != _cache.redZoneCar && t0.time > _cache.saveTime) {
		_GiveScore(t0.car, CLEAR);
		_Count(t0.car, MATCH_CLEARS);
	}
	if (zone != -1 && _cache.shotGoal == -1 && t0.team != GOALS[zone].team && t0.hitId != _cache.redZoneHitId) {
		_GiveScore(t0.car, CENTER);
		_Count(t0.car, MATCH_CENTERS);
	}
	_cache.redZoneGoal = zone;
	_cache.redZoneCar = zone != -1 ? t0.car : 0;
	_cache.redZoneHitId = t0.hitId;
}

// GameEvent_Soccar_TA.HandleHitGoal's touch indices, then StatFactory_TA.OnGoalScored
void StatFactory::_OnGoalScored(uint8_t goalTeam) {
	_scoringCar = 0;
	_carsIssuedFive.clear();
	if (_touches.empty())
		return;
	// DetermineScoreTouchIndex: the newest attacking touch, else the newest
	size_t scoreIdx = 0;
	for (size_t i = 0; i < _touches.size(); i++) {
		if (_touches[i].team != goalTeam) {
			scoreIdx = i;
			break;
		}
	}
	const Touch scorerHit = _touches[scoreIdx];
	// DetermineAssistTouchIndex: the newest earlier touch by a teammate (opponents' skipped) within 5 s
	int assistIdx = -1;
	for (size_t i = scoreIdx + 1; i < _touches.size(); i++) {
		const Touch& t = _touches[i];
		if (t.car == scorerHit.car || t.team != scorerHit.team)
			continue;
		if (t.time < scorerHit.time - ASSIST_MAX_TIME)
			break;
		assistIdx = (int)i;
		break;
	}
	const Touch t0 = _touches[0];
	uint32_t assister = 0;
	Car* attacker = t0.attacker ? _Car(t0.attacker) : nullptr;
	if (attacker && (uint8_t)attacker->team != goalTeam && (uint8_t)attacker->team != t0.team) {
		_GiveScore(t0.attacker, POOL_SHOT);
		_Count(t0.attacker, MATCH_POOL_SHOTS);
		if (t0.attacker != scorerHit.car)
			assister = t0.attacker;
	}
	if (t0.team == goalTeam && _cache.shotGoal == -1) {
		_Count(t0.car, MATCH_OWN_GOALS);
		_GiveScore(t0.car, OWN_GOAL);
	}
	if (scorerHit.team == goalTeam)
		return; // (only defenders touched it: no goal, no assist)
	_scoringCar = scorerHit.car;
	// The goal records (HandleHitGoal; own goals never get here): strict, so the first goal keeps a tie
	float speed = _arena->goalBallSpeed;
	if (speed > _goalRecords.fastest) {
		_goalRecords.fastest = speed;
		_goalRecords.fastestCar = scorerHit.car;
	}
	if (_goalRecords.slowest < 0 || speed < _goalRecords.slowest) {
		_goalRecords.slowest = speed;
		_goalRecords.slowestCar = scorerHit.car;
	}
	if (scorerHit.distance > _goalRecords.furthest) {
		_goalRecords.furthest = scorerHit.distance;
		_goalRecords.furthestCar = scorerHit.car;
	}
	// GetStatEventsForGoalHit, in its order (BulletGoal None; the equaliser events, 0 points and hidden, left out)
	_GiveScore(scorerHit.car, GOAL);
	if (IsBackwardsHit(scorerHit))
		_GiveScore(scorerHit.car, BACKWARDS_GOAL);
	if (IsBicycleHit(scorerHit))
		_GiveScore(scorerHit.car, BICYCLE_GOAL);
	if (IsAerialHit(scorerHit))
		_GiveScore(scorerHit.car, AERIAL_GOAL);
	if (IsTurtleHit(scorerHit))
		_GiveScore(scorerHit.car, TURTLE_GOAL);
	if (scorerHit.distance > LONG_GOAL_DISTANCE)
		_GiveScore(scorerHit.car, LONG_GOAL);
	if (_overtime)
		_GiveScore(scorerHit.car, OVERTIME_GOAL);
	_Count(scorerHit.car, MATCH_GOALS);
	if (_Get(scorerHit.car, MATCH_GOALS) % HAT_TRICK_THRESHOLD == 0)
		_GiveScore(scorerHit.car, HAT_TRICK);
	if (!assister && assistIdx != -1)
		assister = _touches[assistIdx].car;
	if (assister) {
		_Count(assister, MATCH_ASSISTS);
		_GiveScore(assister, ASSIST);
		if (_Get(assister, MATCH_ASSISTS) % PLAYMAKER_THRESHOLD == 0)
			_GiveScore(assister, PLAYMAKER);
	}
}

void StatFactory::ScoreGoal(uint8_t goalTeam) {
	if (_state != FactoryState::ACTIVE)
		return;
	_OnGoalScored(goalTeam);
	_state = FactoryState::POST_GOAL;
}

// StatFactory_TA.OnCarDemolished (Active and PostGoalScored)
void StatFactory::_OnCarDemolished(uint32_t attacker, uint32_t victim) {
	if (!attacker || attacker == victim)
		return;
	_Count(attacker, MATCH_DEMOLISHES);
	_GiveScore(attacker, DEMOLISH, victim);
	_GiveScore(victim, DEMOLISHED);
	if (std::find(_pendingRespawns.begin(), _pendingRespawns.end(), victim) == _pendingRespawns.end())
		_pendingRespawns.push_back(victim);
	_Count(victim, MATCH_TIMES_DEMOLISHED);
	if (_Get(attacker, MATCH_DEMOLISHES) % DEMOLITION_THRESHOLD == 0)
		_GiveScore(attacker, EXTERMINATION);
}

// PostGoalScored.HandleBumpedCar / InitiatorFiveHitType: a teammate bumping the scorer, once per car per goal; high when
// both are airborne and the bumper is 500 up with nothing below
void StatFactory::_OnBumpAfterGoal(uint32_t bumper, uint32_t victim) {
	if (!_scoringCar || victim != _scoringCar)
		return;
	Car* initiator = _Car(bumper);
	Car* receiver = _Car(victim);
	if (!initiator || !receiver || initiator->team != receiver->team)
		return;
	if (std::find(_carsIssuedFive.begin(), _carsIssuedFive.end(), bumper) != _carsIssuedFive.end())
		return;
	_carsIssuedFive.push_back(bumper);
	Vec at = initiator->GetState().pos;
	bool high = at.z >= AERIAL_HIT_HEIGHT && !initiator->_internalState.worldContact.hasContact &&
		!initiator->_internalState.isOnGround && !receiver->_internalState.worldContact.hasContact &&
		!receiver->_internalState.isOnGround && IsLocationFarOffGround(at);
	_GiveScore(bumper, high ? HIGH_FIVE : LOW_FIVE);
	_Count(bumper, high ? MATCH_HIGH_FIVES : MATCH_LOW_FIVES);
}

// The end of each physics tick, in the game's frame order (§4): bumps, touches, the ball's world hits, the touch's
// distance, the goal, then the factory's own tick (shots and saves, clears and centres); respawns
void StatFactory::OnTickEnd() {
	uint64_t tick = _arena->tickCount;
	float now = Now();
	for (const PendingBump& bump : _bumps) {
		CarTrack& track = _tracks[bump.victim];
		track.attacker = bump.bumper;
		track.attackerTime = now;
		if (!bump.isDemo) { // (Car_TA.BumpCar: both cars, in any state; a demolition is no touch)
			_Count(bump.bumper, CAR_TOUCHES);
			_Count(bump.victim, CAR_TOUCHES);
		}
		if (_state == FactoryState::INACTIVE)
			continue;
		if (bump.isDemo)
			_OnCarDemolished(bump.bumper, bump.victim);
		else if (_state == FactoryState::POST_GOAL)
			_OnBumpAfterGoal(bump.bumper, bump.victim);
	}
	_bumps.clear();
	for (const auto& pickup : _arena->boostPickups) // (small and big alike)
		_Count(pickup.first, BOOST_PICKUPS);

	_RecordTouches(tick);
	for (const auto& contact : _arena->ballWorldContacts)
		_OnBallHitWorld(contact.first, contact.second);

	Vec ball = _arena->ball->GetState().pos;
	if (!_touches.empty() && _haveOldLocation) {
		float dx = ball.x - _ballOldLocation.x, dy = ball.y - _ballOldLocation.y;
		_touches[0].distance += sqrtf(dx * dx + dy * dy);
	}
	_ballOldLocation = ball;
	_haveOldLocation = true;

	bool exploded = _arena->ball->_internalState.isExploded;
	if (exploded && !_ballExploded)
		ScoreGoal(ball.y < 0 ? 0 : 1);
	_ballExploded = exploded;

	if (_state == FactoryState::ACTIVE && !_touches.empty() && !_ballExploded) {
		_UpdateShotGoal();
		_UpdateRedZone();
	}

	for (Car* car : _arena->GetCars()) {
		CarTrack& track = _tracks[car->id];
		bool demoed = car->_internalState.isDemoed;
		if (track.demoed && !demoed && _state == FactoryState::ACTIVE) { // (Active.HandlePlayerRestarted)
			_RegisterCar(car->id);
			auto pending = std::find(_pendingRespawns.begin(), _pendingRespawns.end(), car->id);
			if (pending != _pendingRespawns.end()) {
				_pendingRespawns.erase(pending);
				_GiveScore(car->id, DEMOLITION_RESPAWN);
			}
		}
		track.demoed = demoed;
	}
}

void StatFactory::OnMatchEnded(bool haveWinner) {
	std::vector<uint32_t> cars; // (SoccarEvent.PRIs: the players here; leavers' counters take no part)
	for (Car* car : _arena->GetCars())
		cars.push_back(car->id);
	if (haveWinner) {
		// DeterminePickupCounts: the fewest is the smallest positive count; the two only together, when the most is over
		// 10 times the fewest; every player tied gets the event
		int most = 0, fewest = -1;
		for (uint32_t car : cars) {
			int n = _Get(car, BOOST_PICKUPS);
			most = std::max(most, n);
			if (n > 0 && (fewest == -1 || n < fewest))
				fewest = n;
		}
		for (uint32_t car : cars) {
			int n = _Get(car, BOOST_PICKUPS);
			if (n == most && most > fewest * 10)
				_SetMatchStat(car, MOST_BOOST_PICKUPS, most);
			if (n == fewest && fewest * 10 < most)
				_SetMatchStat(car, FEWEST_BOOST_PICKUPS, fewest);
		}
		// DetermineTouchCounts: no such rule
		int mostCar = 0, mostBall = 0, leastBall = -1;
		for (uint32_t car : cars) {
			mostCar = std::max(mostCar, _Get(car, CAR_TOUCHES));
			int n = _Get(car, BALL_TOUCHES);
			mostBall = std::max(mostBall, n);
			if (n > 0 && (leastBall == -1 || n < leastBall))
				leastBall = n;
		}
		for (uint32_t car : cars) {
			if (_Get(car, CAR_TOUCHES) == mostCar)
				_SetMatchStat(car, MOST_CAR_TOUCHES, mostCar);
			int n = _Get(car, BALL_TOUCHES);
			if (n == mostBall)
				_SetMatchStat(car, MOST_BALL_TOUCHES, mostBall);
			if (n == leastBall)
				_SetMatchStat(car, FEWEST_BALL_TOUCHES, leastBall);
		}
	}
	// The goal records to their scorers still here: whole metres and m/s (float32, truncated), the slowest at least 1
	if (_goalRecords.furthestCar)
		_SetMatchStat(_goalRecords.furthestCar, FURTHEST_GOAL, (int)(_goalRecords.furthest / 100.f));
	if (_goalRecords.fastestCar)
		_SetMatchStat(_goalRecords.fastestCar, FASTEST_GOAL, (int)(_goalRecords.fastest / 100.f));
	if (_goalRecords.slowestCar)
		_SetMatchStat(_goalRecords.slowestCar, SLOWEST_GOAL, std::max(1, (int)(_goalRecords.slowest / 100.f)));
}

} // namespace RLStats
