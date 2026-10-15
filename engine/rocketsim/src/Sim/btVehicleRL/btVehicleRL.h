#pragma once
#include "../../BaseInc.h"

#include "../../../libsrc/bullet3-3.24/BulletDynamics/Vehicle/btDefaultVehicleRaycaster.h"

RS_NS_START

// This is a modified version of btWheelInfo to more accurately follow Rocket League
struct btWheelInfoCarball : public btWheelInfo {
	bool m_isInContactWithWorld = false;
	float m_steerAngle = 0;

	btVector3 m_velAtContactPoint;

	// lat = sideways, long = forward
	float m_latFriction = 0, m_longFriction = 0;
	btVector3 m_impulse;

	float m_suspensionForceScale;

	// Extra force applied when compressed significantly
	float m_extraPushback = 0;

	btWheelInfoCarball() {}

	btWheelInfoCarball(btWheelInfoConstructionInfo& constructionInfo) : btWheelInfo(constructionInfo) {}
};

// This is a modified version of btRaycastVehicle to more accurately follow Rocket League
class btVehicleCarball : public btActionInterface {
public:
	// RL PATCH: the game's wheel order. Its vehicle holds the wheels front left, front right, back left, back right
	// (UWheel_TA::Init 0x140f097c0 adds them in Vehicle.Wheels' order); RocketSim right before left. The game's i-th
	// wheel is our wheel GameWheel(i). Every per-wheel pass that applies impulses runs in the game's order: the contact
	// pass (FUN_1402c3e60), whose impulses on a dynamic ground each change what the next wheel's pushback sees, and the
	// suspension and friction passes (FUN_1402c3540, FUN_1402c54d0: the chassis' velocity summed in that order)
	int GameWheel(int i) const { return m_wheelInfo.size() == 4 ? (i ^ 1) : i; }
	btAlignedObjectArray<btVector3> m_forwardWS;
	btAlignedObjectArray<btVector3> m_axle;
	btAlignedObjectArray<float> m_forwardImpulse;
	btAlignedObjectArray<float> m_sideImpulse;

	btDynamicsWorld* m_dynamicsWorld;

	///backwards compatibility
	int m_userConstraintType;
	int m_userConstraintId;


	class btVehicleTuning
	{
	public:
		btVehicleTuning()
			: m_suspensionStiffness(float(5.88)),
			m_suspensionCompression(float(0.83)),
			m_suspensionDamping(float(0.88)),
			m_maxSuspensionTravelCm(float(500.)),
			m_frictionSlip(float(10.5)),
			m_maxSuspensionForce(float(6000.)) {
		}
		float m_suspensionStiffness;
		float m_suspensionCompression;
		float m_suspensionDamping;
		float m_maxSuspensionTravelCm;
		float m_frictionSlip;
		float m_maxSuspensionForce;
	};

	btVehicleRaycaster* m_vehicleRaycaster;
	float m_pitchControl;
	float m_steeringValue;

	btRigidBody* m_chassisBody;

	int m_indexRightAxis;
	int m_indexUpAxis;
	int m_indexForwardAxis;

	void defaultInit(const btVehicleTuning& tuning);

	btVehicleCarball() {}

	btVehicleCarball(const btVehicleTuning& tuning,
		btRigidBody* chassis, btVehicleRaycaster* raycaster, btDynamicsWorld* world,
		int addedRayCollisionMask);

	virtual ~btVehicleCarball();

	///btActionInterface interface
	void updateAction(btCollisionWorld* collisionWorld, float step) {
		assert(false); // This should never be hit in RocketSim!
	}

	const btTransform& getChassisWorldTransform() const;

	float rayCast(btWheelInfoCarball& wheel);

	// RL PATCH (FP2): the bodies the wheel rays test this tick, as the game picks them (findRayCandidates): at most
	// 32, in the broadphase's proxy order
	static constexpr int MAX_RAY_CANDIDATES = 32;
	const btCollisionObject* m_rayCandidates[MAX_RAY_CANDIDATES] = {};
	int m_numRayCandidates = 0;
	void findRayCandidates();
	// A wheel's ray from its hard point: radius + rest length + travel
	float rayLength(const btWheelInfoCarball& wheel) const;

	void updateVehicleFirst(float step);
	void updateVehicleSecond(float step);

	// RL PATCH: the wheels' world transforms with their current steer angle, keeping the ray pass's contact flags
	void updateWheelBases();

	void resetSuspension();

	float getSteeringValue(int wheel) const;

	void setSteeringValue(float steering, int wheel);

	void applyEngineForce(float force, int wheel);

	const btTransform& getWheelTransformWS(int wheelIndex) const;

	void updateWheelTransform(int wheelIndex);

	//	void	setRaycastWheelInfo( int wheelIndex , bool isInContact, const btVector3& hitPoint, const btVector3& hitNormal,float depth);

	btWheelInfoCarball& addWheel(const btVector3& connectionPointCS0, const btVector3& wheelDirectionCS0, const btVector3& wheelAxleCS, float suspensionRestLength, float wheelRadius, const btVehicleTuning& tuning, bool isFrontWheel);

	inline int getNumWheels() const {
		return int(m_wheelInfo.size());
	}

	btAlignedObjectArray<btWheelInfoCarball> m_wheelInfo;

	const btWheelInfoCarball& getWheelInfo(int index) const;

	btWheelInfoCarball& getWheelInfo(int index);

	void updateWheelTransformsWS(btWheelInfoCarball& wheel);

	void setBrake(float brake, int wheelIndex);

	void setPitchControl(float pitch) {
		m_pitchControl = pitch;
	}

	void updateSuspension(float deltaTime);

	virtual void calcFrictionImpulses(float timeStep);
	// RL PATCH: ray hits closer than this (squared, BU) to the wheel's hard point are ignored: inside the car's box
	float m_minHitDistSq = 0;
	void applyFrictionImpulses(float timeStep);

	inline btRigidBody* getRigidBody() {
		return m_chassisBody;
	}

	const btRigidBody* getRigidBody() const {
		return m_chassisBody;
	}

	inline int getRightAxis() const {
		return m_indexRightAxis;
	}
	inline int getUpAxis() const {
		return m_indexUpAxis;
	}

	inline int getForwardAxis() const {
		return m_indexForwardAxis;
	}

	btVector3 getForwardVector() const {
		const btTransform& chassisTrans = getChassisWorldTransform();

		btVector3 forwardW(
			chassisTrans.getBasis()[0][m_indexForwardAxis],
			chassisTrans.getBasis()[1][m_indexForwardAxis],
			chassisTrans.getBasis()[2][m_indexForwardAxis]);

		return forwardW;
	}

	btVector3 getUpVector() const {
		const btTransform& chassisTrans = getChassisWorldTransform();

		btVector3 forwardW(
			chassisTrans.getBasis()[0][m_indexUpAxis],
			chassisTrans.getBasis()[1][m_indexUpAxis],
			chassisTrans.getBasis()[2][m_indexUpAxis]);

		return forwardW;
	}

	btVector3 getRightVector() const {
		const btTransform& chassisTrans = getChassisWorldTransform();

		btVector3 forwardW(
			chassisTrans.getBasis()[0][m_indexRightAxis],
			chassisTrans.getBasis()[1][m_indexRightAxis],
			chassisTrans.getBasis()[2][m_indexRightAxis]);

		return forwardW;
	}

	virtual void setCoordinateSystem(int rightIndex, int upIndex, int forwardIndex) {
		m_indexRightAxis = rightIndex;
		m_indexUpAxis = upIndex;
		m_indexForwardAxis = forwardIndex;
	}

	///backwards compatibility
	int getUserConstraintType() const {
		return m_userConstraintType;
	}

	void setUserConstraintType(int userConstraintType) {
		m_userConstraintType = userConstraintType;
	};

	void setUserConstraintId(int uid) {
		m_userConstraintId = uid;
	}

	int getUserConstraintId() const {
		return m_userConstraintId;
	}

    // Extra utility funcs
	btVector3 getUpwardsDirFromWheelContacts();
	float getForwardSpeed();
};

RS_NS_END