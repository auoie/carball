#pragma once
// RL PATCH (RV-233): the demolition sweep's penetration solver as the game's Bullet 2.82 has it: one unnormalised guess
// (transformB - transformA) and no retries in calcPenDepth (3.24 safe-normalises it, tries up to 9 guesses and zeroes
// the witnesses on failure), and EPA_MAX_VERTICES 64 (faces 128; 3.24: 128, 256). For the sweep only (Arena.cpp
// SweepToImpact): contact generation keeps 3.24's. With both, the sweep matches 2.82 on the static session's 200k cases
// (DSW1); 3.24's flipped one hit in 100k and moved EPA normals by up to 0.034 degrees, only at overlapping starts
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btGjkEpa2.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/NarrowPhaseCollision/btConvexPenetrationDepthSolver.h"

// btGjkEpaSolver2's Distance and Penetration with the 2.82 EPA size (SweepGjkEpa282.cpp: a copy of 3.24's btGjkEpa2.cpp
// in its own namespace)
struct SweepGjkEpa282 {
	typedef btGjkEpaSolver2::sResults sResults;
	static bool Distance(const btConvexShape* shape0, const btTransform& wtrs0, const btConvexShape* shape1, const btTransform& wtrs1,
		const btVector3& guess, sResults& results);
	static bool Penetration(const btConvexShape* shape0, const btTransform& wtrs0, const btConvexShape* shape1, const btTransform& wtrs1,
		const btVector3& guess, sResults& results, bool usemargins = true);
};

// btGjkEpaPenetrationDepthSolver with 2.82's calcPenDepth
class SweepPenetrationSolver282 : public btConvexPenetrationDepthSolver {
public:
	bool calcPenDepth(btSimplexSolverInterface& simplexSolver, const btConvexShape* convexA, const btConvexShape* convexB,
		const btTransform& transA, const btTransform& transB, btVector3& v, btVector3& pa, btVector3& pb) override;
};
