#include "PodiumTitles.h"

#include <algorithm>

namespace RLStats {

using C = TitleCategory;
using U = StatUnit;

// (archetype, category, stat, P, Min, Max, per stat, inverse, clamp to one, unit): §5.4a A.1
const StatTitle STAT_TITLES[TITLE_COUNT] = {
	{ "OvertimeGoal", C::SINGLE_INSTANCE, OVERTIME_GOAL, 10, 0, 0, false, false, true, U::COUNT },
	{ "Goals_10", C::COMPOUND, GOAL, 1, 10, 0, true, false, false, U::COUNT },
	{ "Goals_6_9", C::COMPOUND, GOAL, 1, 6, 9, true, false, false, U::COUNT },
	{ "Goals_3_5", C::COMPOUND, GOAL, 1, 3, 5, true, false, false, U::COUNT },
	{ "Saves_10", C::COMPOUND, SAVE, 1, 10, 0, true, false, false, U::COUNT },
	{ "Saves_6_9", C::COMPOUND, SAVE, 1, 6, 9, true, false, false, U::COUNT },
	{ "Saves_3_5", C::COMPOUND, SAVE, 1, 3, 5, true, false, false, U::COUNT },
	{ "EpicSaves", C::COMPOUND, EPIC_SAVE, 2, 1, 0, true, false, false, U::COUNT },
	{ "PoolShots", C::COMPOUND, POOL_SHOT, 5, 1, 0, true, false, false, U::COUNT },
	{ "BackwardsGoal", C::COMPOUND, BACKWARDS_GOAL, 3, 1, 0, true, false, false, U::COUNT },
	{ "BicycleGoal", C::COMPOUND, BICYCLE_GOAL, 3, 1, 0, true, false, false, U::COUNT },
	{ "AerialGoal", C::COMPOUND, AERIAL_GOAL, 3, 1, 0, true, false, false, U::COUNT },
	{ "TurtleGoal", C::COMPOUND, TURTLE_GOAL, 3, 1, 0, true, false, false, U::COUNT },
	{ "OwnGoal", C::COMPOUND, OWN_GOAL, 4, 0, 0, true, false, false, U::COUNT },
	{ "Juggles", C::COMPOUND, JUGGLE_HIT, 2, 1, 0, true, false, false, U::COUNT },
	{ "Goals", C::STANDARD, GOAL, 1, 1, 0, true, false, false, U::COUNT },
	{ "Saves", C::STANDARD, SAVE, 1, 1, 0, true, false, false, U::COUNT },
	{ "Assists", C::STANDARD, ASSIST, 1, 1, 0, true, false, false, U::COUNT },
	{ "Centers", C::STANDARD, CENTER, 1, 1, 0, true, false, false, U::COUNT },
	{ "Shots", C::STANDARD, SHOT, 1, 1, 0, true, false, false, U::COUNT },
	{ "FirstTouches", C::STANDARD, FIRST_TOUCH, 1, 1, 0, true, false, false, U::COUNT },
	{ "Demolitions", C::STANDARD, DEMOLISH, 1, 1, 0, true, false, false, U::COUNT },
	{ "MostBoostPickups", C::TRACKING, MOST_BOOST_PICKUPS, 20, 10, 0, true, false, false, U::COUNT },
	{ "FewestBoostPickups", C::TRACKING, FEWEST_BOOST_PICKUPS, 20, 0, 0, true, false, false, U::COUNT },
	{ "MostBallTouches", C::TRACKING, MOST_BALL_TOUCHES, 5, 20, 0, true, false, false, U::COUNT },
	{ "FewestBallTouches", C::TRACKING, FEWEST_BALL_TOUCHES, 10, 0, 0, true, false, false, U::COUNT },
	{ "CarTouches", C::TRACKING, MOST_CAR_TOUCHES, 20, 20, 0, true, false, false, U::COUNT },
	{ "FurthestGoal", C::TRACKING, FURTHEST_GOAL, 6, 50, 0, true, false, false, U::DISTANCE },
	{ "FastestGoal", C::TRACKING, FASTEST_GOAL, 15, 20, 0, true, false, false, U::SPEED },
	{ "SlowestGoal", C::TRACKING, SLOWEST_GOAL, 75, 0, 20, true, true, false, U::SPEED },
};

bool GetNumPoints(const StatTitle& title, const PlayerStats& stats, int& points, int& count) {
	points = count = 0;
	if (!stats.eventPresent[title.stat])
		return false;
	int n = stats.eventCounts[title.stat];
	if (!(n >= title.minValue) || !(title.maxValue == 0 || n <= title.maxValue))
		return false;
	int base = !title.perStat ? title.points
	           : (title.inverse && n <= title.maxValue) ? title.points * (title.maxValue - n)
	                                                     : title.points * n;
	switch (title.category) {
		case C::SINGLE_INSTANCE: points = base * 4; break;
		case C::COMPOUND: points = base * 3; break;
		case C::STANDARD: points = base * 2; break;
		case C::TRACKING: points = base / 100; break; // (float32 base × 0.0099999998, truncated: §5.4a A.2)
	}
	count = title.clampToOne ? 1 : n;
	return true;
}

std::map<uint32_t, std::pair<TitleStat, TitleStat>> AssignTitles(const std::vector<std::pair<uint32_t, const PlayerStats*>>& members) {
	std::vector<TitleStat> titleStats;
	std::vector<uint32_t> noTitles;
	for (const auto& [car, stats] : members) {
		noTitles.push_back(car);
		if (!stats)
			continue;
		for (size_t t = 0; t < TITLE_COUNT; t++) {
			int points, count;
			if (GetNumPoints(STAT_TITLES[t], *stats, points, count))
				titleStats.push_back({ (uint8_t)t, points, count, car });
		}
	}
	// MemberTitleSort: points only, descending (the array Sort's comparator is the delegate negated)
	MsvcQsort(titleStats, [](const TitleStat& a, const TitleStat& b) { return a.points > b.points ? -1 : a.points < b.points ? 1 : 0; });
	std::map<uint32_t, std::pair<TitleStat, TitleStat>> out;
	for (uint32_t car : noTitles)
		out[car] = {};
	for (int pass = 0; pass < 2; pass++) {
		std::vector<TitleStat> copy = titleStats;
		std::vector<uint32_t> free = noTitles;
		while (!copy.empty() && !free.empty()) {
			const TitleStat top = copy[0];
			auto member = std::find(free.begin(), free.end(), top.car);
			if (member != free.end()) {
				(pass == 0 ? out[top.car].first : out[top.car].second) = top;
				free.erase(member);
				for (size_t k = copy.size() - 1; k >= 1; k--)
					if (copy[k].title == top.title || copy[k].car == top.car)
						copy.erase(copy.begin() + (ptrdiff_t)k);
				for (size_t k = titleStats.size(); k-- > 0;)
					if (titleStats[k].title == top.title)
						titleStats.erase(titleStats.begin() + (ptrdiff_t)k);
			}
			copy.erase(copy.begin());
		}
	}
	return out;
}

} // namespace RLStats
