#pragma once
// RL PATCH (FP2): a body the game creates (a kickoff's spawn, a respawn, the ball at a kickoff) gets its broadphase box
// at once: addCollisionObject 0x140270f30 → createProxy 0x140272c30 → setAabb, the shape's tight box at the spawn pose (no
// contact threshold, no predicted pose: notes/bullet-diff.md "Broadphase boxes at placement", AB1). Moving a body
// (SetState without a new spawn, a rollback restore) leaves its stored box as it was; boxes otherwise change only in the
// step's updateAabbs, after the vehicles, so the wheel rays' candidate query (btVehicleCarball) sees a just-moved body only
// if its old box overlaps. RV-375: its entry in the broadphase's max-edge order is made anew too (after its equals), as
// the game's destroy and create make it.
#include "../../libsrc/bullet3-3.24/BulletCollision/CollisionDispatch/btCollisionWorld.h"
#include "../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btBroadphaseInterface.h"
#include "../../libsrc/bullet3-3.24/BulletCollision/BroadphaseCollision/btRSBroadphase.h"

inline void SetCreatedBox(btCollisionWorld* world, btCollisionObject* obj) {
	btBroadphaseProxy* proxy = obj->getBroadphaseHandle();
	if (!world || !proxy)
		return;
	btVector3 boxMin, boxMax;
	obj->getCollisionShape()->getAabb(obj->getWorldTransform(), boxMin, boxMax);
	if (auto* rs = dynamic_cast<btRSBroadphase*>(world->getBroadphase()))
		rs->respawnProxy(proxy, boxMin, boxMax, world->getDispatcher());
	else
		world->getBroadphase()->setAabb(proxy, boxMin, boxMax, world->getDispatcher());
}
