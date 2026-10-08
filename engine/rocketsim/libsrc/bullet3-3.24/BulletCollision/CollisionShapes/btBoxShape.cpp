/*
Bullet Continuous Collision Detection and Physics Library
Copyright (c) 2003-2009 Erwin Coumans  http://bulletphysics.org

This software is provided 'as-is', without any express or implied warranty.
In no event will the authors be held liable for any damages arising from the use of this software.
Permission is granted to anyone to use this software for any purpose, 
including commercial applications, and to alter it and redistribute it freely, 
subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
*/
#include "btBoxShape.h"

btBoxShape::btBoxShape(const btVector3& boxHalfExtents)
	: btPolyhedralConvexShape()
{
	m_shapeType = BOX_SHAPE_PROXYTYPE;

	// RL PATCH: the safe margin first, as Bullet 2.82 (the game's): the inner dimensions then subtract the margin the box
	// keeps. RocketSim's setMargin isn't virtual, so the later setSafeMargin didn't correct them: every car's box was
	// 0.04 BU - 0.1 x its smallest half extent too small (Octane 0.0677 uu per half extent). Read live from the game:
	// inner 58.3207 / 41.4167 / 17.3966 uu + margin 1.9330 = the hitbox's half extents
	setSafeMargin(boxHalfExtents);

	btVector3 margin(getMargin(), getMargin(), getMargin());
	m_implicitShapeDimensions = boxHalfExtents - margin;

	setSafeMargin(boxHalfExtents);
};

void btBoxShape::getAabb(const btTransform& t, btVector3& aabbMin, btVector3& aabbMax) const
{
	btTransformAabb(getHalfExtentsWithoutMargin(), getMargin(), t, aabbMin, aabbMax);
}

void btBoxShape::calculateLocalInertia(btScalar mass, btVector3& inertia) const
{
	//btScalar margin = btScalar(0.);
	btVector3 halfExtents = getHalfExtentsWithMargin();

	btScalar lx = btScalar(2.) * (halfExtents.x());
	btScalar ly = btScalar(2.) * (halfExtents.y());
	btScalar lz = btScalar(2.) * (halfExtents.z());

	inertia.setValue(mass / (btScalar(12.0)) * (ly * ly + lz * lz),
					 mass / (btScalar(12.0)) * (lx * lx + lz * lz),
					 mass / (btScalar(12.0)) * (lx * lx + ly * ly));
}
