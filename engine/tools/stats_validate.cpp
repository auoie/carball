// Match stats (engine/stats) against Rocket League replays: the replay's physics re-run frame by frame (each body set to
// its replay state when the replay updates it, the ticks between frames simulated with the replicated inputs), the stat
// factory fed by the engine's contacts, the round state and the goals taken from the replay. Its awards are compared
// with the players' counters as the replay records them (MatchScore, Goals, Assists, Saves, Shots: the PRI's replicated
// values, at the frames they change).
//
// Usage: stats_validate STATES.csv PRI.csv [--meshes DIR] [--events OUT.csv]
//   STATES.csv and PRI.csv from scripts/replay_extract --pri PRI.csv STATES.csv REPLAYS...
//
// Caveats: the replays are an older build than the live one (Sept 2025); the cars' pitch, yaw and roll inputs aren't
// replicated (air control is missing between frames); every car uses the Octane hitbox (most do).
#include "RocketSim.h"
#include "Sim/Quantize/Quantize.h"
#include "StatFactory.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <map>
#include <set>
#include <string>
#include <vector>

using namespace RocketSim;
using namespace RLStats;

struct Body {
	Vec pos, vel, angVel;
	RotMat rot;
	btQuaternion q;
};

struct CarRow {
	int actor = 0, team = 0, throttle = 128, steer = 128;
	Body b;
	bool handbrake = false, boosting = false, jump = false, doubleJump = false, dodge = false;
	float dodgeSince = -1, jumpSince = -1;
	Vec dodgeTorque;
};

struct Frame {
	int index = 0;
	double time = 0;
	bool hasBall = false;
	Body ball;
	std::vector<CarRow> cars;
};

struct PriRow {
	int frame;
	double time;
	std::string kind;
	int a = 0, b = 0;
	std::string value;
};

struct Replay {
	std::string name;
	std::vector<Frame> frames;
	std::vector<PriRow> pri;
};

static std::vector<std::string> Split(const std::string& line) {
	std::vector<std::string> f;
	size_t start = 0;
	for (;;) {
		size_t comma = line.find(',', start);
		f.push_back(line.substr(start, comma - start));
		if (comma == std::string::npos)
			break;
		start = comma + 1;
	}
	return f;
}

static RotMat FromQuat(float x, float y, float z, float w) {
	return RotMat(
		Vec(1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)),
		Vec(2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)),
		Vec(2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)));
}

static float DecodeAxis(int b) { return Quantize::InputAxisValue((int8_t)(b - 128)); }

static std::map<std::string, Replay> Load(const char* statesPath, const char* priPath) {
	std::map<std::string, Replay> replays;
	std::ifstream in(statesPath);
	std::string line;
	std::getline(in, line);
	while (std::getline(in, line)) {
		auto f = Split(line);
		if (f.size() < 37)
			continue;
		Replay& r = replays[f[0]];
		r.name = f[0];
		int index = std::stoi(f[1]);
		if (r.frames.empty() || r.frames.back().index != index) {
			r.frames.push_back({});
			r.frames.back().index = index;
			r.frames.back().time = std::stod(f[2]);
		}
		Frame& fr = r.frames.back();
		auto num = [&](int i) { return std::stof(f[i]); };
		Body b;
		b.pos = Vec(num(5), num(6), num(7));
		b.rot = FromQuat(num(8), num(9), num(10), num(11));
		b.q = btQuaternion(num(8), num(9), num(10), num(11));
		b.vel = Vec(num(12), num(13), num(14));
		b.angVel = Vec(num(15), num(16), num(17)) / 100;
		if (f[3] == "ball") {
			fr.hasBall = true;
			fr.ball = b;
		} else {
			CarRow c;
			c.actor = std::stoi(f[4]);
			c.b = b;
			c.throttle = std::stoi(f[19]);
			c.steer = std::stoi(f[20]);
			c.handbrake = f[21] == "1";
			c.boosting = f[22] == "1";
			c.jump = f[23] == "1";
			c.doubleJump = f[24] == "1";
			c.dodge = f[25] == "1";
			c.team = std::stoi(f[29]);
			c.dodgeTorque = Vec(num(31), num(32), num(33));
			c.jumpSince = f[34].empty() ? -1 : num(34);
			c.dodgeSince = f[36].empty() ? -1 : num(36);
			fr.cars.push_back(c);
		}
	}
	std::ifstream pin(priPath);
	std::getline(pin, line);
	while (std::getline(pin, line)) {
		auto f = Split(line);
		if (f.size() < 7)
			continue;
		PriRow row;
		row.frame = std::stoi(f[1]);
		row.time = std::stod(f[2]);
		row.kind = f[3];
		row.a = f[4].empty() ? 0 : std::stoi(f[4]);
		row.b = f[5].empty() ? 0 : std::stoi(f[5]);
		row.value = f[6];
		replays[f[0]].pri.push_back(row);
	}
	return replays;
}

// The replay's counters: 0 MatchScore, 1 Goals, 2 Assists, 3 Saves, 4 Shots
static const char* COUNTER_NAMES[5] = { "score", "goals", "assists", "saves", "shots" };

struct Totals {
	int replay[5] = {}, ours[5] = {};
};

struct Matching {
	int replayEvents = 0, ourEvents = 0, matched = 0; // (per counter: increments close in time, same player)
};

static int g_frames = 0, g_replays = 0;
static std::map<std::string, Matching> g_matching;
static Totals g_totals;
static int g_scoreExact = 0, g_scorePlayers = 0;
static std::FILE* g_events = nullptr;
static std::string g_traceReplay;
static bool g_inferTouches = true;
static int g_inferred = 0, g_simTouches = 0;
static double g_traceFrom = 0, g_traceTo = 0;

// Each car's state at every frame: its own rows, and between two rows at most 0.25 s apart, interpolated (the replay
// updates a car every 2-3 frames; a stale car misses touches the ball's next state already shows)
static void Interpolate(Replay& r) {
	std::map<int, std::vector<std::pair<size_t, const CarRow*>>> rows; // actor -> (frame index, row)
	for (size_t i = 0; i < r.frames.size(); i++)
		for (const CarRow& c : r.frames[i].cars)
			rows[c.actor].push_back({ i, &c });
	std::vector<std::pair<size_t, CarRow>> added;
	for (auto& [actor, list] : rows) {
		for (size_t k = 0; k + 1 < list.size(); k++) {
			size_t a = list[k].first, b = list[k + 1].first;
			double ta = r.frames[a].time, tb = r.frames[b].time;
			if (tb - ta > 0.25)
				continue;
			const CarRow &ra = *list[k].second, &rb = *list[k + 1].second;
			for (size_t i = a + 1; i < b; i++) {
				float t = (float)((r.frames[i].time - ta) / (tb - ta));
				CarRow c = ra;
				c.b.pos = ra.b.pos + (rb.b.pos - ra.b.pos) * t;
				c.b.vel = ra.b.vel + (rb.b.vel - ra.b.vel) * t;
				c.b.angVel = ra.b.angVel + (rb.b.angVel - ra.b.angVel) * t;
				c.b.q = ra.b.q.slerp(rb.b.q, t);
				c.b.rot = FromQuat(c.b.q.x(), c.b.q.y(), c.b.q.z(), c.b.q.w());
				if (c.dodgeSince >= 0)
					c.dodgeSince += (float)(r.frames[i].time - ta);
				added.push_back({ i, c });
			}
		}
	}
	for (auto& [i, c] : added)
		r.frames[i].cars.push_back(c);
}

static void RunReplay(Replay& r) {
	if (r.frames.size() < 100)
		return;
	Interpolate(r);
	g_replays++;
	Arena* arena = Arena::Create(GameMode::SOCCAR);
	MutatorConfig mutators = arena->GetMutatorConfig();
	mutators.demoMode = DemoMode::DISABLED; // (the replay's own cars come and go)
	arena->SetMutatorConfig(mutators);
	StatFactory stats(arena);
	arena->SetTickEndCallback([](Arena*, void* info) { ((StatFactory*)info)->OnTickEnd(); }, &stats);
	arena->SetCarBumpCallback([](Arena*, Car* bumper, Car* victim, bool isDemo, void* info) {
		((StatFactory*)info)->OnBump(bumper, victim, isDemo);
	}, &stats);
	arena->Step(240);

	// The PRI rows by frame
	std::map<int, std::vector<const PriRow*>> priAt;
	for (const PriRow& row : r.pri)
		priAt[row.frame].push_back(&row);
	std::map<int, int> carPri; // car actor -> PRI
	std::map<int, Car*> priCar; // PRI -> its arena car (one per player, across respawns)
	std::map<uint32_t, int> carToPri; // arena car id -> PRI
	std::map<int, double> priSeen; // PRI -> the last time its car had a row
	std::map<int, int> priTeam;
	std::map<int, std::array<int, 5>> replayCounters, ourCounters;
	struct Event { double time; int pri; int counter; };
	std::vector<Event> replayEvents, ourEvents;
	std::string state;
	double engineGoalAt = -1; // (a goal the re-run scored while the replay played on: since when, RV-278)

	auto award = [&](const Award& a, double time) {
		auto it = carToPri.find(a.car);
		if (it == carToPri.end())
			return;
		int pri = it->second;
		auto& c = ourCounters[pri];
		if (STAT_EVENTS[a.event].addToScore)
			c[0] += STAT_EVENTS[a.event].points;
		int counter = a.event == GOAL ? 1 : a.event == ASSIST ? 2 : (a.event == SAVE || a.event == EPIC_SAVE) ? 3 : a.event == SHOT ? 4 : -1;
		if (counter > 0) {
			c[counter]++;
			ourEvents.push_back({ time, pri, counter });
		}
		if (STAT_EVENTS[a.event].points > 0)
			ourEvents.push_back({ time, pri, 0 });
		if (g_events)
			fprintf(g_events, "%s,%.3f,ours,%d,%d,%d\n", r.name.c_str(), time, pri, (int)a.event, STAT_EVENTS[a.event].points);
	};

	for (size_t i = 0; i < r.frames.size(); i++) {
		const Frame& fr = r.frames[i];
		g_frames++;
		for (const PriRow* row : priAt[fr.index]) {
			if (row->kind == "carpri") {
				carPri[row->a] = row->b;
			} else if (row->kind == "stat" && row->b < 5) {
				int value = std::stoi(row->value);
				auto& c = replayCounters[row->a];
				int before = c[row->b];
				c[row->b] = value;
				if (value > before) {
					replayEvents.push_back({ fr.time, row->a, row->b });
					if (g_events)
						fprintf(g_events, "%s,%.3f,replay,%d,%s,%d\n", r.name.c_str(), fr.time, row->a, COUNTER_NAMES[row->b], value - before);
				}
			} else if (row->kind == "state") {
				state = row->value;
				if (state == "Active") {
					stats.SetState(FactoryState::ACTIVE);
				} else if (state == "PostGoalScored") {
					// (the goal, if the re-run ball didn't cross the line first: on the goal its centre is in)
					stats.ScoreGoal(arena->ball->GetState().pos.y < 0 ? 0 : 1);
					stats.SetState(FactoryState::POST_GOAL);
				} else {
					stats.SetState(FactoryState::INACTIVE);
				}
			} else if (row->kind == "overtime") {
				stats.SetOvertime(row->value == "1");
			} else if (row->kind == "goal") {
				// (the header's goal frame: if the re-run ball didn't cross the line, the goal is scored here)
				if (stats.GetState() == FactoryState::ACTIVE)
					stats.ScoreGoal(row->a == 0 ? 1 : 0);
			}
		}

		// A touch the re-run missed: the replay's ball changed course beyond the re-run's (more than 300 uu/s apart) with
		// no touch in the interval and a car within reach (the replay doesn't say who: the nearest)
		bool inferTouch = false;
		Car* toucher = nullptr;
		if (fr.hasBall && g_inferTouches && i > 0) {
			Vec simVel = arena->ball->GetState().vel;
			bool touched = !stats.GetTouches().empty() && stats.GetTouches()[0].time >= (float)(arena->tickCount * arena->tickTime) - 0.05f;
			if ((simVel - fr.ball.vel).Length() > 300 && !touched) {
				float best = 260;
				for (auto& [pri, car] : priCar) {
					if (!car || car->_internalState.isDemoed)
						continue;
					float d = (car->GetState().pos - fr.ball.pos).Length();
					if (d < best) {
						best = d;
						toucher = car;
					}
				}
				inferTouch = toucher != nullptr;
			}
		}

		// The bodies the replay updates this frame
		if (fr.hasBall) {
			BallState s = arena->ball->GetState();
			s.pos = fr.ball.pos;
			s.rotMat = fr.ball.rot;
			s.vel = fr.ball.vel;
			s.angVel = fr.ball.angVel;
			s.isExploded = false; // (the replay's ball is in play again at the kickoff; a goal explodes it in the re-run)
			arena->ball->SetState(s);
			// (the re-run scored where the replay played on, a goal-line save: the round goes on once the replay is still
			// in play a second later; a real goal's state row follows its crossing within ~0.1 s, so it isn't counted
			// twice: RV-278)
			if (state == "Active" && stats.GetState() == FactoryState::POST_GOAL) {
				if (engineGoalAt < 0)
					engineGoalAt = fr.time;
				else if (fr.time - engineGoalAt > 1.0) {
					stats.ResumeRound();
					engineGoalAt = -1;
				}
			} else {
				engineGoalAt = -1;
			}
		}
		for (const CarRow& row : fr.cars) {
			auto pit = carPri.find(row.actor);
			if (pit == carPri.end())
				continue;
			int pri = pit->second;
			Car*& car = priCar[pri];
			if (!car) {
				car = arena->AddCar(row.team == 1 ? Team::ORANGE : Team::BLUE, CAR_CONFIG_OCTANE);
				carToPri[car->id] = pri;
				priTeam[pri] = row.team;
			}
			priSeen[pri] = fr.time;
			CarState s = car->GetState();
			s.pos = row.b.pos;
			s.rotMat = row.b.rot;
			s.vel = row.b.vel;
			s.angVel = row.b.angVel;
			s.isDemoed = false;
			s.isFlipping = row.dodge && row.dodgeSince >= 0 && row.dodgeSince < RLConst::FLIP_TORQUE_TIME;
			if (s.isFlipping) {
				s.hasFlipped = true;
				s.flipTime = row.dodgeSince;
				s.flipRelTorque = Vec(row.dodgeTorque.x * 100 / RLConst::FLIP_TORQUE_X, row.dodgeTorque.y * 100 / RLConst::FLIP_TORQUE_Y, 0);
			}
			car->SetState(s);
			car->controls.throttle = DecodeAxis(row.throttle);
			car->controls.steer = DecodeAxis(row.steer);
			car->controls.handbrake = row.handbrake;
			car->controls.boost = row.boosting;
			car->controls.jump = row.jump;
		}
		if (inferTouch) {
			g_inferred++;
			Vec ball = arena->ball->GetState().pos;
			Vec toCar = (toucher->GetState().pos - ball).Normalized();
			stats.RecordCarHit(toucher, ball + toCar * 91.25f, toCar);
			for (const Award& a : stats.TakeAwards())
				award(a, fr.time);
		}
		// A player's car gone a while (demolished, or between rounds): out of play until it's back
		for (auto& [pri, car] : priCar)
			if (car && !car->_internalState.isDemoed && fr.time - priSeen[pri] > 0.25)
				car->Demolish(1e9f);

		if (i + 1 < r.frames.size()) {
			int k = std::clamp((int)std::lround((r.frames[i + 1].time - fr.time) * 120), 1, 8);
			for (int t = 0; t < k; t++) {
				arena->Step(1);
				double now = fr.time + (t + 1) / 120.0;
				if (r.name.rfind(g_traceReplay, 0) == 0 && !g_traceReplay.empty() && now >= g_traceFrom && now <= g_traceTo) {
					BallState b = arena->ball->GetState();
					printf("    %.3f ball (%.0f %.0f %.0f) v (%.0f %.0f %.0f) shot %d touches %zu", now, b.pos.x, b.pos.y, b.pos.z,
						b.vel.x, b.vel.y, b.vel.z, stats.GetShotGoal(), stats.GetTouches().size());
					if (!stats.GetTouches().empty()) {
						const Touch& t0 = stats.GetTouches()[0];
						printf(" | t0 pri %d team %d at %.3f", carToPri[t0.car], t0.team, t0.time);
					}
					for (auto& [pri, car] : priCar) {
						CarState c = car->GetState();
						printf(" | pri %d (%.0f %.0f %.0f)%s%s", pri, c.pos.x, c.pos.y, c.pos.z, c.isDemoed ? " demoed" : "",
							c.ballHitInfo.isValid && c.ballHitInfo.tickCountWhenHit + 1 == arena->tickCount ? " HIT" : "");
					}
					printf("\n");
				}
				for (const Award& a : stats.TakeAwards()) {
					award(a, now);
					if (r.name.rfind(g_traceReplay, 0) == 0 && !g_traceReplay.empty() && now >= g_traceFrom && now <= g_traceTo)
						printf("    award %d to pri %d\n", (int)a.event, carToPri[a.car]);
				}
			}
		}
	}

	// Totals and matching per counter
	std::set<int> pris;
	for (auto& [pri, c] : replayCounters)
		pris.insert(pri);
	for (int pri : pris) {
		auto& rc = replayCounters[pri];
		auto& oc = ourCounters[pri];
		for (int c = 0; c < 5; c++) {
			g_totals.replay[c] += rc[c];
			g_totals.ours[c] += oc[c];
		}
		g_scorePlayers++;
		g_scoreExact += rc[0] == oc[0];
		printf("  %s pri %d: replay score %d g %d a %d sv %d sh %d | ours %d g %d a %d sv %d sh %d\n", r.name.c_str(), pri,
			rc[0], rc[1], rc[2], rc[3], rc[4], oc[0], oc[1], oc[2], oc[3], oc[4]);
	}
	for (int c = 1; c < 5; c++) {
		Matching& m = g_matching[COUNTER_NAMES[c]];
		std::vector<bool> used(ourEvents.size());
		for (const Event& e : replayEvents) {
			if (e.counter != c)
				continue;
			m.replayEvents++;
			for (size_t j = 0; j < ourEvents.size(); j++) {
				const Event& o = ourEvents[j];
				// (the replay's counters lag: a PRI replicates about once a second, a goal at once)
				double lag = e.time - o.time;
				if (!used[j] && o.counter == c && o.pri == e.pri && lag >= -0.1 && lag <= 1.2) {
					used[j] = true;
					m.matched++;
					break;
				}
			}
		}
		for (const Event& o : ourEvents)
			m.ourEvents += o.counter == c;
	}
	delete arena;
}

int main(int argc, char** argv) {
	if (argc < 3) {
		fprintf(stderr, "usage: stats_validate STATES.csv PRI.csv [--meshes DIR] [--events OUT.csv]\n");
		return 1;
	}
	std::string meshes = ARENA_MESH_DIR;
	for (int i = 3; i + 1 < argc; i += 2) {
		std::string opt = argv[i];
		if (opt == "--meshes")
			meshes = argv[i + 1];
		else if (opt == "--infer-touches")
			g_inferTouches = std::string(argv[i + 1]) != "0";
		else if (opt == "--trace" && i + 3 < argc) {
			g_traceReplay = argv[i + 1];
			g_traceFrom = atof(argv[i + 2]);
			g_traceTo = atof(argv[i + 3]);
			i += 2;
		} else if (opt == "--events") {
			g_events = std::fopen(argv[i + 1], "w");
			fprintf(g_events, "replay,time,source,pri,what,amount\n");
		}
	}
	RocketSim::Init(meshes, true);
	auto replays = Load(argv[1], argv[2]);
	for (auto& [name, r] : replays)
		RunReplay(r);
	if (g_events)
		std::fclose(g_events);

	printf("%d replays, %d frames, %d touches inferred from the replay's ball\n", g_replays, g_frames, g_inferred);
	printf("totals (replay / ours):");
	for (int c = 0; c < 5; c++)
		printf(" %s %d / %d;", COUNTER_NAMES[c], g_totals.replay[c], g_totals.ours[c]);
	printf("\nfinal score exact for %d of %d players\n", g_scoreExact, g_scorePlayers);
	for (auto& [name, m] : g_matching)
		printf("%s: replay %d, ours %d, matched (ours 0.1 s after to 1.2 s before) %d (recall %.1f%%, precision %.1f%%)\n", name.c_str(),
			m.replayEvents, m.ourEvents, m.matched, m.replayEvents ? 100.0 * m.matched / m.replayEvents : 0,
			m.ourEvents ? 100.0 * m.matched / m.ourEvents : 0);
	return 0;
}
