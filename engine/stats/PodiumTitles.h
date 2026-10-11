#pragma once
// The podium titles (notes/match-stats.md §5.4a): the title archetypes (GameInfo_Soccar_SF StatTitles), their points
// (StatTitle_TA.GetNumPoints) and PrePodiumSpotlight.UpdateSpotlight's assignment: every member's qualifying titles
// sorted by points with the game's qsort (MSVC's: ties in its unstable order), then two greedy passes, each title once
#include "StatFactory.h"

#include <cstdint>
#include <map>
#include <utility>
#include <vector>

namespace RLStats {

enum class StatUnit : uint8_t { COUNT, SPEED, DISTANCE };

// StatCategory_TA (GameEvent_Soccar.StatCategories order): SingleInstance ×4, Compound ×3, Standard ×2, Tracking ×0.01
enum class TitleCategory : uint8_t { SINGLE_INSTANCE, COMPOUND, STANDARD, TRACKING };

struct StatTitle {
	const char* archetype;
	TitleCategory category;
	StatEvent stat;
	int points, minValue, maxValue; // (maxValue 0: no maximum)
	bool perStat, inverse, clampToOne;
	StatUnit unit;
};

// Every title, in the categories' order then each category's Titles order: the protocol's title ids
constexpr size_t TITLE_COUNT = 30;
extern const StatTitle STAT_TITLES[TITLE_COUNT];
constexpr uint8_t NO_TITLE = 0xFF;

// MemberTitleStat: a title for a member, its points and the stat count it shows
struct TitleStat {
	uint8_t title = NO_TITLE;
	int points = 0, count = 0;
	uint32_t car = 0;
};

// GetNumPoints: whether the title applies to the member's MatchStats (the stat's entry there, in range), and if so its
// points (truncated: tracking's ×0.01 in float32 is ⌊base/100⌋) and count
bool GetNumPoints(const StatTitle& title, const PlayerStats& stats, int& points, int& count);

// UpdateSpotlight for the teams' current members in order (blue's in join order, then orange's; null stats: none yet):
// each member's primary and secondary (title NO_TITLE: none)
std::map<uint32_t, std::pair<TitleStat, TitleStat>> AssignTitles(const std::vector<std::pair<uint32_t, const PlayerStats*>>& members);

// The CRT's qsort (UCRT: median-of-three quicksort, sub-arrays of 8 or fewer finished by a selection sort moving the
// first maximum to the end). `comp(x, y)` > 0: x after y
template <typename T, typename Comp>
void MsvcQsort(std::vector<T>& a, Comp comp) {
	if (a.size() < 2)
		return;
	auto swap = [&](size_t i, size_t j) {
		if (i != j)
			std::swap(a[i], a[j]);
	};
	auto shortsort = [&](size_t lo, size_t hi) {
		while (hi > lo) {
			size_t max = lo;
			for (size_t p = lo + 1; p <= hi; p++)
				if (comp(a[p], a[max]) > 0)
					max = p;
			swap(max, hi);
			hi--;
		}
	};
	std::vector<std::pair<ptrdiff_t, ptrdiff_t>> stack;
	ptrdiff_t lo = 0, hi = (ptrdiff_t)a.size() - 1;
	for (;;) {
		ptrdiff_t size = hi - lo + 1;
		if (size <= 8) {
			shortsort((size_t)lo, (size_t)hi);
		} else {
			ptrdiff_t mid = lo + size / 2;
			if (comp(a[lo], a[mid]) > 0)
				swap(lo, mid);
			if (comp(a[lo], a[hi]) > 0)
				swap(lo, hi);
			if (comp(a[mid], a[hi]) > 0)
				swap(mid, hi);
			ptrdiff_t loguy = lo, higuy = hi;
			for (;;) {
				if (mid > loguy) {
					do
						loguy++;
					while (loguy < mid && comp(a[loguy], a[mid]) <= 0);
				}
				if (mid <= loguy) {
					do
						loguy++;
					while (loguy <= hi && comp(a[loguy], a[mid]) <= 0);
				}
				do
					higuy--;
				while (higuy > mid && comp(a[higuy], a[mid]) > 0);
				if (higuy < loguy)
					break;
				swap(loguy, higuy);
				if (mid == higuy)
					mid = loguy;
			}
			higuy++;
			if (mid < higuy) {
				do
					higuy--;
				while (higuy > mid && comp(a[higuy], a[mid]) == 0);
			}
			if (mid >= higuy) {
				do
					higuy--;
				while (higuy > lo && comp(a[higuy], a[mid]) == 0);
			}
			if (higuy - lo >= hi - loguy) {
				if (lo < higuy)
					stack.push_back({ lo, higuy });
				if (loguy < hi) {
					lo = loguy;
					continue;
				}
			} else {
				if (loguy < hi)
					stack.push_back({ loguy, hi });
				if (lo < higuy) {
					hi = higuy;
					continue;
				}
			}
		}
		if (stack.empty())
			return;
		lo = stack.back().first;
		hi = stack.back().second;
		stack.pop_back();
	}
}

} // namespace RLStats
