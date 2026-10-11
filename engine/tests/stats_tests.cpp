// Match stats (engine/stats/StatFactory): the game's detection rules (notes/match-stats.md) on a real arena, the touches
// placed by hand where a rule is about the touch's record, the ball's flight simulated
#include "RocketSim.h"
#include "Sim/GameRotator/GameRotator.h"
#include "PodiumTitles.h"
#include "StatFactory.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace RocketSim;
using namespace RLStats;

static int failures = 0, checks = 0;

#define CHECK(cond, ...) do { \
	checks++; \
	if (!(cond)) { failures++; printf("    FAIL %s:%d: %s -- ", __FILE__, __LINE__, #cond); printf(__VA_ARGS__); printf("\n"); } \
} while (0)

// An arena whose tick and bump callbacks feed a stat factory, as the C API wires them
struct Harness {
	Arena* arena;
	StatFactory stats;
	std::vector<Award> awards; // (everything taken so far)

	Harness() : arena(Arena::Create(GameMode::SOCCAR)), stats(arena) {
		arena->SetTickEndCallback([](Arena*, void* info) { ((StatFactory*)info)->OnTickEnd(); }, &stats);
		arena->SetCarBumpCallback([](Arena*, Car* bumper, Car* victim, bool isDemo, void* info) {
			((StatFactory*)info)->OnBump(bumper, victim, isDemo);
		}, &stats);
		arena->Step(240); // (the game's clock is well past its first seconds by any kickoff: the caches' times start at 0)
	}
	~Harness() { delete arena; }

	// A car parked on the floor facing `forward` (one tick run, so its start-of-tick state is this)
	Car* Park(Team team, Vec pos, Vec forward = Vec(1, 0, 0)) {
		Car* car = arena->AddCar(team, CAR_CONFIG_OCTANE);
		CarState s;
		s.pos = pos;
		s.rotMat = RotMat(forward, Vec(0, 0, 1).Cross(forward), Vec(0, 0, 1));
		car->SetState(s);
		return car;
	}

	void Ball(Vec pos, Vec vel = Vec()) {
		BallState s;
		s.pos = pos;
		s.vel = vel;
		arena->ball->SetState(s);
	}

	// A touch by `car` on the ball where it is, in front of the car
	void Touch(Car* car) {
		Vec ball = arena->ball->GetState().pos;
		Vec toCar = (car->GetState().pos - ball).Normalized();
		stats.RecordCarHit(car, ball + toCar * 91.25f, toCar);
	}

	void Step(int ticks = 1) {
		arena->Step(ticks);
		for (const Award& a : stats.TakeAwards())
			awards.push_back(a);
	}

	int Count(StatEvent event, uint32_t car) const {
		return (int)std::count_if(awards.begin(), awards.end(), [&](const Award& a) { return a.event == event && a.car == car; });
	}

	int Counter(uint32_t car, RLStats::Counter counter) const {
		const PlayerStats* s = stats.GetStats(car);
		return s ? s->counters[counter] : 0;
	}

	std::string List() const {
		std::string out;
		for (const Award& a : awards)
			out += std::to_string(a.event) + "@" + std::to_string(a.car) + " ";
		return out;
	}
};

static void TestFirstTouchAndBallHits() {
	puts("the first touch after the kickoff gives only FirstTouch; then BallHit +2 at most once a second");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, 0, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(0, 0, 300));
	h.Touch(blue);
	h.Step();
	CHECK(h.Count(FIRST_TOUCH, blue->id) == 1 && h.Count(BALL_HIT, blue->id) == 0, "%s", h.List().c_str());
	h.Step(60);
	h.Touch(blue); // (0.5 s later: a second second hasn't passed since the last BallHit, but none was given yet)
	h.Step();
	CHECK(h.Count(BALL_HIT, blue->id) == 1, "%s", h.List().c_str());
	h.Step(60);
	h.Touch(blue);
	h.Step();
	CHECK(h.Count(BALL_HIT, blue->id) == 1, "within the second: %s", h.List().c_str());
	h.Step(60);
	h.Touch(blue);
	h.Step();
	CHECK(h.Count(BALL_HIT, blue->id) == 2, "%s", h.List().c_str());
	CHECK(h.Counter(blue->id, MATCH_SCORE) == 4 && h.Counter(blue->id, MATCH_FIRST_TOUCHES) == 1, "score %d",
		h.Counter(blue->id, MATCH_SCORE));
	// Not while the round isn't active
	h.stats.SetState(FactoryState::INACTIVE);
	h.Step(150);
	h.Touch(blue);
	h.Step();
	CHECK(h.Count(BALL_HIT, blue->id) == 2, "inactive: %s", h.List().c_str());
}

static void TestContactFrames() {
	puts("one continuous contact is one touch; a contact two frames after the last is a new one (Car_TA.OnHitBall)");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, 0, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	auto contact = [&]() { // (as the car-ball callback stamps it during the coming tick)
		BallHitInfo& info = blue->_internalState.ballHitInfo;
		info.isValid = true;
		info.tickCountWhenHit = h.arena->tickCount;
		info.ballPos = h.arena->ball->GetState().pos;
		blue->_ballContactPoint = info.ballPos + Vec(-91.25f, 0, 0);
	};
	for (int i = 0; i < 5; i++) {
		contact();
		h.Step();
	}
	CHECK(h.stats.GetTouches().size() == 1 && h.Counter(blue->id, BALL_TOUCHES) == 1, "%zu touches",
		h.stats.GetTouches().size());
	h.Step(); // (one frame without contact: still the same touch)
	contact();
	h.Step();
	CHECK(h.stats.GetTouches().size() == 2, "after a gap of one frame: %zu touches", h.stats.GetTouches().size());
	const Touch& t = h.stats.GetTouches()[0];
	CHECK(t.car == blue->id && fabsf(t.hitNormal.x + 1) < 1e-4f, "normal (%f, %f, %f)", t.hitNormal.x, t.hitNormal.y, t.hitNormal.z);
}

static void TestRealContact() {
	puts("a car driving into the ball records the touch where they met, its normal out of the ball towards the car");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(0, -400, 17), Vec(0, 1, 0));
	h.Ball(Vec(0, 0, 93.15f));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	blue->controls.throttle = 1;
	blue->controls.boost = true;
	for (int i = 0; i < 120 && h.stats.GetTouches().empty(); i++)
		h.Step();
	CHECK(h.stats.GetTouches().size() == 1, "%zu touches", h.stats.GetTouches().size());
	if (!h.stats.GetTouches().empty()) {
		const Touch& t = h.stats.GetTouches()[0];
		CHECK(t.car == blue->id && t.team == 0 && t.hitNormal.y < -0.9f && t.hitLocation.y < 0 && t.hitLocation.y > -100,
			"at (%f, %f, %f), normal (%f, %f, %f)", t.hitLocation.x, t.hitLocation.y, t.hitLocation.z, t.hitNormal.x,
			t.hitNormal.y, t.hitNormal.z);
		CHECK(t.preHitBallVel.Length() < 1 && t.postHitBallVel.y > 500, "ball before %f, after %f", t.preHitBallVel.Length(),
			t.postHitBallVel.y);
		CHECK(h.Count(FIRST_TOUCH, blue->id) == 1, "%s", h.List().c_str());
	}
}

static void TestShotAndSaves() {
	puts("a shot: heading into the goal within 1.5 s off an attacker; a save: the shot stopped by a defender; epic at the line");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, 3000, 17));
	Car* orange = h.Park(Team::ORANGE, Vec(2000, 3000, 17));
	Car* keeper = h.Park(Team::ORANGE, Vec(2500, 3000, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(0, 3000, 300));
	h.Touch(blue); // (the first touch)
	h.Step();
	h.Ball(Vec(0, 3800, 300), Vec(0, 2200, 0));
	h.Step();
	h.Touch(blue);
	h.Step();
	CHECK(h.Count(SHOT, blue->id) == 1 && h.Counter(blue->id, MATCH_SHOTS) == 1, "%s", h.List().c_str());
	h.Step(5);
	CHECK(h.Count(SHOT, blue->id) == 1, "one shot per touch: %s", h.List().c_str());
	// Turned back 400 short of the line: a save
	h.Ball(Vec(0, 4700, 300), Vec(0, 2200, 0));
	h.Step();
	h.Ball(h.arena->ball->GetState().pos, Vec(0, -1500, 400));
	h.Touch(orange);
	h.Step();
	CHECK(h.Count(SAVE, orange->id) == 1 && h.Count(EPIC_SAVE, orange->id) == 0 && h.Counter(orange->id, MATCH_SAVES) == 1,
		"%s", h.List().c_str());
	// Another shot, and the keeper turns it back with the ball already at the line: epic (counted as a save too)
	h.Ball(Vec(0, 3800, 300), Vec(0, 2200, 0));
	h.Step();
	h.Touch(blue);
	h.Step(2);
	CHECK(h.Count(SHOT, blue->id) == 1, "the 5 s cooldown: %s", h.List().c_str());
	h.Ball(Vec(0, 5050, 300), Vec(0, 2200, 0));
	h.Step();
	h.Ball(h.arena->ball->GetState().pos, Vec(0, -1500, 400));
	h.Touch(keeper);
	h.Step();
	CHECK(h.Count(EPIC_SAVE, keeper->id) == 1 && h.Count(SAVE, keeper->id) == 0, "%s", h.List().c_str());
	CHECK(h.Counter(keeper->id, MATCH_SAVES) == 1 && h.Counter(keeper->id, MATCH_EPIC_SAVES) == 1 &&
		h.Counter(keeper->id, MATCH_SCORE) == 75, "score %d", h.Counter(keeper->id, MATCH_SCORE));
}

static void TestGoalAssistOwnGoal() {
	puts("a goal: the newest attacking touch scores; the assist is a teammate's earlier touch within 5 s, opponents skipped");
	Harness h;
	Car* a = h.Park(Team::BLUE, Vec(-2000, 3000, 17));
	Car* b = h.Park(Team::BLUE, Vec(-2500, 3000, 17));
	Car* o = h.Park(Team::ORANGE, Vec(2000, 3000, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(0, 4600, 300));
	h.Touch(a);
	h.Step(10);
	h.Ball(Vec(0, 4600, 300));
	h.Touch(o); // (an opponent's touch between doesn't cancel it)
	h.Step(10);
	h.Ball(Vec(0, 4600, 300), Vec(0, 3000, 0));
	h.Touch(b);
	for (int i = 0; i < 60 && h.stats.GetState() == FactoryState::ACTIVE; i++)
		h.Step();
	CHECK(h.stats.GetState() == FactoryState::POST_GOAL, "no goal");
	CHECK(h.Count(GOAL, b->id) == 1 && h.Count(ASSIST, a->id) == 1 && h.Count(SHOT, b->id) == 1, "%s", h.List().c_str());
	CHECK(h.Counter(b->id, MATCH_GOALS) == 1 && h.Counter(a->id, MATCH_ASSISTS) == 1 && h.Count(OWN_GOAL, o->id) == 0,
		"%s", h.List().c_str());
	// (a's touch was the last when the ball first counted as in orange's zone: a centre, +10)
	CHECK(h.Count(CENTER, a->id) == 1 && h.Counter(b->id, MATCH_SCORE) == 110 && h.Counter(a->id, MATCH_SCORE) == 60,
		"scores %d %d: %s", h.Counter(b->id, MATCH_SCORE), h.Counter(a->id, MATCH_SCORE), h.List().c_str());

	puts("an own goal: a defender's last touch while it wasn't a shot; the attacker before it still scores");
	Harness g;
	Car* attacker = g.Park(Team::BLUE, Vec(-2000, 3000, 17));
	Car* defender = g.Park(Team::ORANGE, Vec(2000, 3000, 17));
	g.Step();
	g.stats.SetState(FactoryState::ACTIVE);
	g.Ball(Vec(0, 4600, 300), Vec(0, -300, 0));
	g.Touch(attacker);
	g.Step(10);
	g.Ball(g.arena->ball->GetState().pos, Vec(0, 3000, 0));
	g.Touch(defender);
	for (int i = 0; i < 60 && g.stats.GetState() == FactoryState::ACTIVE; i++)
		g.Step();
	CHECK(g.Count(OWN_GOAL, defender->id) == 1 && g.Count(GOAL, attacker->id) == 1 && g.Count(SHOT, attacker->id) == 0,
		"%s", g.List().c_str());
	CHECK(g.Counter(defender->id, MATCH_OWN_GOALS) == 1, "own goals %d", g.Counter(defender->id, MATCH_OWN_GOALS));

	puts("a deflected shot: the defender's touch on a tracked shot isn't an own goal");
	Harness f;
	Car* shooter = f.Park(Team::BLUE, Vec(-2000, 3000, 17));
	Car* deflector = f.Park(Team::ORANGE, Vec(2000, 3000, 17));
	f.Step();
	f.stats.SetState(FactoryState::ACTIVE);
	f.Ball(Vec(0, 1000, 300));
	f.Touch(shooter);
	f.Step();
	f.Ball(Vec(0, 4000, 300), Vec(0, 2500, 0));
	f.Touch(shooter);
	f.Step(10);
	f.Ball(f.arena->ball->GetState().pos, Vec(100, 2600, 0));
	f.Touch(deflector);
	for (int i = 0; i < 60 && f.stats.GetState() == FactoryState::ACTIVE; i++)
		f.Step();
	CHECK(f.Count(SHOT, shooter->id) == 1 && f.Count(GOAL, shooter->id) == 1 && f.Count(OWN_GOAL, deflector->id) == 0,
		"%s", f.List().c_str());

	puts("only defenders touched it: no goal, no assist");
	Harness d;
	Car* d1 = d.Park(Team::ORANGE, Vec(2000, 3000, 17));
	d.Park(Team::BLUE, Vec(-2000, 3000, 17));
	d.Step();
	d.stats.SetState(FactoryState::ACTIVE);
	d.Ball(Vec(0, 4600, 300), Vec(0, 3000, 0));
	d.Touch(d1);
	for (int i = 0; i < 60 && d.stats.GetState() == FactoryState::ACTIVE; i++)
		d.Step();
	CHECK(d.Count(OWN_GOAL, d1->id) == 1 && d.Count(GOAL, d1->id) == 0, "%s", d.List().c_str());
}

static void TestGoalModifiers() {
	puts("goal modifiers: a long goal (over 7000 of the ball's XY path since the scoring touch), overtime, a hat trick at the third");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, -3000, 17), Vec(-1, 0, 0));
	h.Step();
	for (int goal = 1; goal <= 3; goal++) {
		h.stats.SetOvertime(goal == 3);
		h.stats.SetState(FactoryState::INACTIVE);
		h.arena->ResetToNextKickoff();
		CarState s = blue->GetState(); // (back where it was, facing the ball)
		s.pos = Vec(-2000, -3000, 17);
		s.rotMat = RotMat(Vec(-1, 0, 0), Vec(0, -1, 0), Vec(0, 0, 1));
		blue->SetState(s);
		h.Step();
		h.stats.SetState(FactoryState::ACTIVE);
		Vec start = goal == 1 ? Vec(-3000, -3000, 300) : Vec(0, 4600, 300);
		h.Ball(start);
		h.Touch(blue); // (first touch: then the scoring touch)
		h.Step();
		h.Ball(start);
		h.Touch(blue);
		if (goal == 1) { // (the ball carried along: its path, not where it started)
			for (int i = 0; i < 9; i++) {
				h.Step();
				h.Ball(Vec(-3000 + 333.3f * (i + 1), -3000 + 888.8f * (i + 1), 300));
			}
		}
		h.Ball(h.arena->ball->GetState().pos, Vec(0, 3000, 0));
		for (int i = 0; i < 60 && h.stats.GetState() == FactoryState::ACTIVE; i++)
			h.Step();
	}
	CHECK(h.Count(GOAL, blue->id) == 3 && h.Count(LONG_GOAL, blue->id) == 1 && h.Count(OVERTIME_GOAL, blue->id) == 1 &&
		h.Count(HAT_TRICK, blue->id) == 1, "%s", h.List().c_str());
}

static void TestClearAndCenter() {
	puts("a centre: into the opponents' 2300 zone off an attacker (not a shot); a clear: out of your own off another defender");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, -3000, 17));
	Car* orange = h.Park(Team::ORANGE, Vec(2000, -3000, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(1500, 0, 300)); // (outside both zones: a zone change off a touch rules that touch out of a centre)
	h.Touch(blue); // (first touch)
	h.Step();
	h.Ball(Vec(1500, -3300, 100), Vec(0, -400, 0)); // (outside blue's zone, drifting in, too slow for a shot)
	h.Touch(orange);
	h.Step(60);
	CHECK(h.Count(CENTER, orange->id) == 1 && h.Count(SHOT, orange->id) == 0, "%s", h.List().c_str());
	h.Ball(h.arena->ball->GetState().pos, Vec(0, 3000, 0));
	h.Touch(blue);
	h.Step(60);
	CHECK(h.Count(CLEAR, blue->id) == 1 && h.Counter(blue->id, MATCH_CLEARS) == 1, "%s", h.List().c_str());

	puts("no clear by the defender who was last to touch it when it came in");
	h.Ball(Vec(1500, -3300, 100), Vec(0, -400, 0));
	h.Touch(blue);
	h.Step(60);
	h.Ball(h.arena->ball->GetState().pos, Vec(0, 3000, 0));
	h.Touch(blue);
	h.Step(60);
	CHECK(h.Count(CLEAR, blue->id) == 1, "%s", h.List().c_str());
}

static void TestDemolitions() {
	puts("demolitions: Demolish to the attacker with its victim, Demolished to the victim, an extermination at every 7th");
	Harness h;
	Car* a = h.Park(Team::BLUE, Vec(-2000, 0, 17));
	Car* v = h.Park(Team::ORANGE, Vec(2000, 0, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	for (int i = 0; i < 7; i++) {
		if (i == 6)
			CHECK(h.Count(EXTERMINATION, a->id) == 0, "before the 7th: %s", h.List().c_str());
		h.stats.OnBump(a, v, true);
		h.Step();
	}
	CHECK(h.Count(DEMOLISH, a->id) == 7 && h.Count(DEMOLISHED, v->id) == 7 && h.Count(EXTERMINATION, a->id) == 1, "%s",
		h.List().c_str());
	CHECK(h.Counter(a->id, MATCH_DEMOLISHES) == 7 && h.Counter(v->id, MATCH_TIMES_DEMOLISHED) == 7 &&
		h.Counter(a->id, MATCH_SCORE) == 20, "score %d", h.Counter(a->id, MATCH_SCORE));
	bool victim = std::any_of(h.awards.begin(), h.awards.end(), [&](const Award& w) { return w.event == DEMOLISH && w.victim == v->id; });
	CHECK(victim, "the victim rides along");
	h.stats.SetState(FactoryState::INACTIVE);
	h.stats.OnBump(a, v, true);
	h.Step();
	CHECK(h.Count(DEMOLISH, a->id) == 7, "not counted outside the round");
}

static void TestFives() {
	puts("after a goal a teammate's bump on the scorer is a low five, once per car; high with both airborne, 500 up");
	Harness h;
	Car* scorer = h.Park(Team::BLUE, Vec(-2000, 3000, 17));
	Car* mate = h.Park(Team::BLUE, Vec(-2500, 3000, 17));
	Car* flyer = h.Park(Team::BLUE, Vec(-3000, 3000, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(0, 4600, 300), Vec(0, 3000, 0));
	h.Touch(scorer);
	h.Step();
	h.Touch(scorer);
	for (int i = 0; i < 60 && h.stats.GetState() == FactoryState::ACTIVE; i++)
		h.Step();
	h.stats.OnBump(mate, scorer, false);
	h.stats.OnBump(mate, scorer, false);
	h.Step();
	CHECK(h.Count(LOW_FIVE, mate->id) == 1 && h.Counter(mate->id, MATCH_LOW_FIVES) == 1, "%s", h.List().c_str());
	CarState up = flyer->GetState();
	up.pos = Vec(-1000, 0, 900);
	flyer->SetState(up);
	CarState s = scorer->GetState();
	s.pos = Vec(-1000, 300, 900);
	scorer->SetState(s);
	h.Step();
	h.stats.OnBump(flyer, scorer, false);
	h.Step();
	CHECK(h.Count(HIGH_FIVE, flyer->id) == 1, "%s", h.List().c_str());
}

static void TestHitPredicates() {
	puts("the hit tests: aerial (500 up, nothing below, 100 uu/s apart), juggle, backwards, bicycle");
	Harness h;
	Touch t;
	t.car = 1;
	t.preHitCar.rotMat = RotMat(Vec(1, 0, 0), Vec(0, 1, 0), Vec(0, 0, 1));
	t.preHitCar.pos = Vec(0, 0, 700);
	t.preHitCar.vel = Vec(0, 0, 300);
	CHECK(h.stats.IsAerialHit(t), "over the field centre");
	t.preHitCar.pos.z = 450;
	CHECK(!h.stats.IsAerialHit(t), "below 500");
	t.preHitCar.pos = Vec(0, 0, 700);
	t.wheelsTouching = true;
	CHECK(!h.stats.IsAerialHit(t), "wheels on a surface");
	t.wheelsTouching = false;
	t.preHitBallVel = Vec(0, 0, 250);
	CHECK(!h.stats.IsAerialHit(t), "moving with the ball");
	CHECK(!h.stats.IsLocationFarOffGround(Vec(0, 0, 400)), "the floor within 500");
	CHECK(h.stats.IsLocationFarOffGround(Vec(0, 0, 600)), "the floor beyond 500");
	CHECK(!h.stats.IsLocationFarOffGround(Vec(0, 5500, 900)), "the goal's roof under it");

	t.preHitBallPos = Vec(0, 0, 800);
	t.postHitBallVel = Vec(0, 0, 500);
	CHECK(StatFactory::IsJuggleHit(t), "from below, the ball up at 500");
	t.postHitBallVel.z = 499;
	CHECK(!StatFactory::IsJuggleHit(t), "slower");

	t.preHitCar.pos = Vec(0, 0, 17);
	t.hitLocation = Vec(-100, 0, 40); // (behind the car)
	t.hitNormal = Vec(1, 0, 0); // (out of the ball, towards the car)
	CHECK(StatFactory::IsBackwardsHit(t), "behind");
	t.hitLocation = Vec(-30, 0, 40);
	CHECK(!StatFactory::IsBackwardsHit(t), "within 40 of the centre");
	t.hitLocation = Vec(-100, 0, 40);
	t.dodging = true;
	CHECK(!StatFactory::IsBackwardsHit(t), "dodging");

	t.preHitCar.angVel = Vec(0, -5, 0); // (nose up: about the right axis, negative)
	t.hitLocation = Vec(60, 0, 50);
	CHECK(h.stats.IsBicycleHit(t), "pitching back at 286 deg/s, hit in front and above");
	t.preHitCar.angVel = Vec(0, -4, 0);
	CHECK(!h.stats.IsBicycleHit(t), "229 deg/s");
	t.preHitCar.angVel = Vec(0, -5, 0);
	t.hitLocation = Vec(60, 0, 10);
	CHECK(!h.stats.IsBicycleHit(t), "below the centre");
}

static void TestJuggle() {
	puts("a juggle: three touches from below by one player sending the ball up at 500+, none before the ball's last ground hit");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, 0, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(0, 0, 1000));
	h.Touch(blue); // (first touch)
	h.Step(80);
	auto juggle = [&]() { // (from below: the car's at 17; up at 600 after the hit)
		h.Ball(Vec(0, 0, 1000));
		h.Step();
		h.Ball(Vec(0, 0, 1000), Vec(0, 0, 600));
		h.Touch(blue);
		h.Step(80);
	};
	juggle();
	juggle();
	CHECK(h.Count(JUGGLE_HIT, blue->id) == 0, "two: %s", h.List().c_str());
	juggle();
	CHECK(h.Count(JUGGLE_HIT, blue->id) == 1 && h.Counter(blue->id, MATCH_JUGGLE_HITS) == 1, "three: %s", h.List().c_str());

	puts("the ball on the ground between them restarts the count");
	Harness g;
	Car* car = g.Park(Team::BLUE, Vec(-2000, 0, 17));
	g.Step();
	g.stats.SetState(FactoryState::ACTIVE);
	g.Ball(Vec(0, 0, 1000));
	g.Touch(car);
	g.Step(80);
	auto up = [&]() {
		g.Ball(Vec(0, 0, 1000));
		g.Step();
		g.Ball(Vec(0, 0, 1000), Vec(0, 0, 600));
		g.Touch(car);
		g.Step(80);
	};
	up();
	up();
	g.Ball(Vec(0, 0, 100), Vec(0, 0, -500)); // (a bounce off the floor)
	g.Step(20);
	up();
	CHECK(g.Count(JUGGLE_HIT, car->id) == 0, "%s", g.List().c_str());
}

static void TestCrossbar() {
	puts("the ball hitting the crossbar: +2 to the last toucher, once per 0.1 s");
	Harness h;
	Car* blue = h.Park(Team::BLUE, Vec(-2000, 3000, 17));
	h.Step();
	h.stats.SetState(FactoryState::ACTIVE);
	h.Ball(Vec(0, 4700, 680), Vec(0, 2000, 0));
	h.Touch(blue);
	h.Step(40);
	CHECK(h.Count(CROSSBAR_HITS, blue->id) == 1 && h.Counter(blue->id, MATCH_CROSSBAR_HITS) == 1, "%s", h.List().c_str());
}

static void TestActivityCounters() {
	puts("car touches: both cars per bump, a demolition none; pad pickups: small and big alike, never at full boost");
	Harness h;
	Car* a = h.Park(Team::BLUE, Vec(3584, 0, 17)); // (on the big pad)
	Car* b = h.Park(Team::ORANGE, Vec(-3584, 0, 17)); // (the other one, full)
	CarState full = b->GetState();
	full.boost = 100;
	b->SetState(full);
	Car* c = h.Park(Team::ORANGE, Vec(0, -4240, 17)); // (a small pad)
	h.Step();
	CHECK(h.Counter(a->id, BOOST_PICKUPS) == 1 && h.Counter(c->id, BOOST_PICKUPS) == 1 && h.Counter(b->id, BOOST_PICKUPS) == 0,
		"a %d c %d b %d", h.Counter(a->id, BOOST_PICKUPS), h.Counter(c->id, BOOST_PICKUPS), h.Counter(b->id, BOOST_PICKUPS));
	h.Step(10);
	CHECK(h.Counter(a->id, BOOST_PICKUPS) == 1, "once per pickup: %d", h.Counter(a->id, BOOST_PICKUPS));
	h.stats.OnBump(a, b, false);
	h.Step();
	h.stats.OnBump(a, b, true);
	h.Step();
	CHECK(h.Counter(a->id, CAR_TOUCHES) == 1 && h.Counter(b->id, CAR_TOUCHES) == 1 && h.Counter(c->id, CAR_TOUCHES) == 0,
		"a %d b %d", h.Counter(a->id, CAR_TOUCHES), h.Counter(b->id, CAR_TOUCHES));
}

static bool HasEvent(const StatFactory& stats, uint32_t car, StatEvent event, int count) {
	const PlayerStats* s = stats.GetStats(car);
	return s && s->eventPresent[event] && s->eventCounts[event] == count;
}

static bool NoEvent(const StatFactory& stats, uint32_t car, StatEvent event) {
	const PlayerStats* s = stats.GetStats(car);
	return !s || !s->eventPresent[event];
}

static void TestMatchEndEvents() {
	puts("match end: most and fewest pickups only past 10 times, touches always, ties all; goal records strict, own goals out");
	{
		Harness h;
		Car* a = h.Park(Team::BLUE, Vec(-2000, 0, 17));
		Car* b = h.Park(Team::BLUE, Vec(-1000, 0, 17));
		Car* c = h.Park(Team::ORANGE, Vec(1000, 0, 17));
		Car* d = h.Park(Team::ORANGE, Vec(2000, 0, 17));
		h.Step();
		h.stats.SetCounter(a->id, BOOST_PICKUPS, 31);
		h.stats.SetCounter(b->id, BOOST_PICKUPS, 3);
		h.stats.SetCounter(c->id, BOOST_PICKUPS, 0); // (no pickups: not the fewest)
		h.stats.SetCounter(d->id, BOOST_PICKUPS, 31);
		h.stats.SetCounter(a->id, BALL_TOUCHES, 9);
		h.stats.SetCounter(b->id, BALL_TOUCHES, 9);
		h.stats.SetCounter(c->id, BALL_TOUCHES, 0);
		h.stats.SetCounter(d->id, BALL_TOUCHES, 40);
		h.stats.SetCounter(c->id, CAR_TOUCHES, 21);
		h.stats.OnMatchEnded(true);
		CHECK(HasEvent(h.stats, a->id, MOST_BOOST_PICKUPS, 31) && HasEvent(h.stats, d->id, MOST_BOOST_PICKUPS, 31), "31 > 30: the most, both tied");
		CHECK(HasEvent(h.stats, b->id, FEWEST_BOOST_PICKUPS, 3) && NoEvent(h.stats, c->id, FEWEST_BOOST_PICKUPS), "the fewest positive");
		CHECK(HasEvent(h.stats, d->id, MOST_BALL_TOUCHES, 40) && HasEvent(h.stats, a->id, FEWEST_BALL_TOUCHES, 9) &&
			HasEvent(h.stats, b->id, FEWEST_BALL_TOUCHES, 9) && NoEvent(h.stats, c->id, FEWEST_BALL_TOUCHES), "touches");
		CHECK(HasEvent(h.stats, c->id, MOST_CAR_TOUCHES, 21) && NoEvent(h.stats, a->id, MOST_CAR_TOUCHES), "car touches");
	}
	{
		Harness h;
		Car* a = h.Park(Team::BLUE, Vec(-2000, 0, 17));
		Car* b = h.Park(Team::ORANGE, Vec(2000, 0, 17));
		h.Step();
		h.stats.SetCounter(a->id, BOOST_PICKUPS, 30);
		h.stats.SetCounter(b->id, BOOST_PICKUPS, 3);
		h.stats.OnMatchEnded(true);
		CHECK(NoEvent(h.stats, a->id, MOST_BOOST_PICKUPS) && NoEvent(h.stats, b->id, FEWEST_BOOST_PICKUPS), "30 vs 3: neither");
	}
	{
		Harness h;
		Car* a = h.Park(Team::BLUE, Vec(-2000, 3000, 17));
		Car* b = h.Park(Team::ORANGE, Vec(2000, -3000, 17));
		h.Step();
		h.stats.SetState(FactoryState::ACTIVE);
		auto goal = [&](Car* by, uint8_t goalTeam, float speed) {
			h.Ball(Vec(0, goalTeam == 1 ? 3000 : -3000, 93));
			h.Touch(by);
			h.arena->goalBallSpeed = speed;
			h.stats.ScoreGoal(goalTeam);
			h.stats.SetState(FactoryState::ACTIVE);
		};
		goal(a, 1, 2850); // a's: 28 m/s
		goal(b, 0, 650); // b's: the slowest, 6 m/s
		goal(a, 1, 650); // (tied: the first keeps it)
		goal(b, 1, 99999); // (b's own goal: not a record)
		goal(a, 1, 50); // (0.5 m/s: at least 1)
		h.stats.SetCounter(a->id, BALL_TOUCHES, 5);
		h.stats.OnMatchEnded(false);
		CHECK(HasEvent(h.stats, a->id, FASTEST_GOAL, 28) && HasEvent(h.stats, a->id, SLOWEST_GOAL, 1) && NoEvent(h.stats, b->id, FASTEST_GOAL),
			"records");
		CHECK(NoEvent(h.stats, a->id, MOST_BALL_TOUCHES), "no winner: no touch events");
	}
}

static StatEvent EventOf(const char* name) {
	static const std::pair<const char*, StatEvent> names[] = {
		{ "Goal", GOAL }, { "Shot", SHOT }, { "Assist", ASSIST }, { "Save", SAVE }, { "EpicSave", EPIC_SAVE },
		{ "Demolish", DEMOLISH }, { "OvertimeGoal", OVERTIME_GOAL }, { "MostBallTouches", MOST_BALL_TOUCHES },
		{ "FewestBallTouches", FEWEST_BALL_TOUCHES }, { "MostBoostPickups", MOST_BOOST_PICKUPS },
		{ "FewestBoostPickups", FEWEST_BOOST_PICKUPS }, { "CarTouches", MOST_CAR_TOUCHES }, { "FastestGoal", FASTEST_GOAL },
		{ "SlowestGoal", SLOWEST_GOAL }, { "FurthestGoal", FURTHEST_GOAL },
	};
	for (const auto& [n, e] : names)
		if (std::string(n) == name)
			return e;
	printf("unknown event %s\n", name);
	return STAT_EVENT_COUNT;
}

static PlayerStats Stats(std::initializer_list<std::pair<const char*, int>> entries) {
	PlayerStats s;
	for (const auto& [name, count] : entries) {
		s.eventCounts[EventOf(name)] = count;
		s.eventPresent[EventOf(name)] = true;
	}
	return s;
}

// "archetype points count" for a title (empty: none)
static std::string Title(const TitleStat& t) {
	if (t.title == NO_TITLE)
		return "-";
	return std::string(STAT_TITLES[t.title].archetype) + " " + std::to_string(t.points) + " " + std::to_string(t.count);
}

static void TestPodiumTitles() {
	puts("podium titles: MSVC qsort's tie order, PT1's examples (notes/match-stats.md §5.4a A.7)");
	auto order = [](std::vector<int> keys) {
		std::vector<std::pair<int, int>> a;
		for (size_t i = 0; i < keys.size(); i++)
			a.push_back({ keys[i], (int)i });
		MsvcQsort(a, [](const std::pair<int, int>& x, const std::pair<int, int>& y) { return x.first > y.first ? -1 : x.first < y.first ? 1 : 0; });
		std::vector<int> out;
		for (const auto& p : a)
			out.push_back(p.second);
		return out;
	};
	CHECK(order({ 2, 2 }) == std::vector<int>({ 1, 0 }), "2");
	CHECK(order({ 2, 2, 2 }) == std::vector<int>({ 1, 2, 0 }), "3");
	CHECK(order({ 2, 2, 2, 2, 2 }) == std::vector<int>({ 1, 2, 3, 4, 0 }), "5");
	CHECK(order(std::vector<int>(9, 2)) == std::vector<int>({ 0, 1, 2, 3, 4, 5, 6, 7, 8 }), "9");
	CHECK(order(std::vector<int>(10, 2)) == std::vector<int>({ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 }), "10");
	CHECK(order({ 2, 4, 2, 2, 4, 2, 2, 4, 2, 2, 2, 4 }) == std::vector<int>({ 1, 7, 4, 11, 5, 6, 3, 2, 8, 9, 10, 0 }), "12");
	CHECK(order({ 4, 2, 6, 0, 0, 9, 0, 4, 9, 0, 9, 2, 0, 0, 6, 6, 0, 2, 0, 9, 6, 0, 9, 0, 2 }) ==
		std::vector<int>({ 5, 8, 19, 22, 10, 2, 14, 15, 20, 7, 0, 24, 1, 11, 17, 13, 16, 9, 18, 6, 4, 21, 3, 23, 12 }), "25 (podium_ref.py)");

	auto assign = [](std::vector<PlayerStats>& members) {
		std::vector<std::pair<uint32_t, const PlayerStats*>> list;
		for (size_t i = 0; i < members.size(); i++)
			list.push_back({ (uint32_t)i + 1, &members[i] });
		return AssignTitles(list);
	};
	{
		std::vector<PlayerStats> m = {
			Stats({ { "Goal", 3 }, { "Shot", 4 }, { "Assist", 1 }, { "MostBallTouches", 42 }, { "CarTouches", 21 } }),
			Stats({ { "Goal", 1 }, { "Save", 2 }, { "Shot", 1 }, { "FewestBoostPickups", 2 } }),
			Stats({ { "Save", 6 }, { "EpicSave", 1 }, { "MostBoostPickups", 35 } }),
			Stats({ { "Goal", 1 }, { "Shot", 2 }, { "Demolish", 2 }, { "FastestGoal", 28 }, { "FewestBallTouches", 9 } }),
		};
		auto t = assign(m);
		CHECK(Title(t[1].first) == "Goals_3_5 9 3" && Title(t[1].second) == "Shots 8 4", "A %s / %s", Title(t[1].first).c_str(), Title(t[1].second).c_str());
		CHECK(Title(t[2].first) == "Saves 4 2" && Title(t[2].second) == "Goals 2 1", "B %s / %s", Title(t[2].first).c_str(), Title(t[2].second).c_str());
		CHECK(Title(t[3].first) == "Saves_6_9 18 6" && Title(t[3].second) == "MostBoostPickups 7 35", "C %s / %s", Title(t[3].first).c_str(), Title(t[3].second).c_str());
		CHECK(Title(t[4].first) == "Demolitions 4 2" && Title(t[4].second) == "FastestGoal 4 28", "D %s / %s", Title(t[4].first).c_str(), Title(t[4].second).c_str());
	}
	{
		std::vector<PlayerStats> m = {
			Stats({ { "Goal", 2 }, { "OvertimeGoal", 1 }, { "Shot", 3 }, { "SlowestGoal", 6 }, { "FurthestGoal", 61 } }),
			Stats({ { "Goal", 1 }, { "Save", 3 }, { "Shot", 2 }, { "FastestGoal", 31 } }),
		};
		auto t = assign(m);
		CHECK(Title(t[1].first) == "OvertimeGoal 40 1" && Title(t[1].second) == "SlowestGoal 10 6", "A %s / %s", Title(t[1].first).c_str(), Title(t[1].second).c_str());
		CHECK(Title(t[2].first) == "Saves_3_5 9 3" && Title(t[2].second) == "Saves 6 3", "B %s / %s", Title(t[2].first).c_str(), Title(t[2].second).c_str());
	}
	{
		std::vector<PlayerStats> m(3, Stats({ { "Goal", 1 }, { "Shot", 1 } }));
		auto t = assign(m);
		CHECK(Title(t[1].first) == "Shots 2 1" && Title(t[2].first) == "Goals 2 1" && Title(t[3].first) == "-", "%s %s %s",
			Title(t[1].first).c_str(), Title(t[2].first).c_str(), Title(t[3].first).c_str());
		CHECK(Title(t[1].second) == "-" && Title(t[2].second) == "-" && Title(t[3].second) == "-", "no secondaries");
	}
	{
		int points, count;
		PlayerStats slow = Stats({ { "SlowestGoal", 20 } });
		CHECK(GetNumPoints(STAT_TITLES[29], slow, points, count) && points == 0 && count == 20, "Slowpoke at 20: 0 points");
		PlayerStats slower = Stats({ { "SlowestGoal", 21 } });
		CHECK(!GetNumPoints(STAT_TITLES[29], slower, points, count), "21: over its maximum");
		PlayerStats pickups = Stats({ { "MostBoostPickups", 25 } });
		CHECK(GetNumPoints(STAT_TITLES[22], pickups, points, count) && points == 5, "500 x 0.01 is 5, not 4: %d", points);
		PlayerStats none = Stats({ { "MostBoostPickups", 0 } });
		CHECK(!GetNumPoints(STAT_TITLES[22], none, points, count), "nobody picked up: no Speed Demon");
	}
}

int main(int argc, char** argv) {
	std::string meshes = argc > 1 ? argv[1] : ARENA_MESH_DIR;
	RocketSim::Init(meshes, true);

	TestFirstTouchAndBallHits();
	TestContactFrames();
	TestRealContact();
	TestShotAndSaves();
	TestGoalAssistOwnGoal();
	TestGoalModifiers();
	TestClearAndCenter();
	TestDemolitions();
	TestFives();
	TestHitPredicates();
	TestJuggle();
	TestCrossbar();
	TestActivityCounters();
	TestMatchEndEvents();
	TestPodiumTitles();

	printf("%d checks, %d failed\n", checks, failures);
	return failures ? 1 : 0;
}
