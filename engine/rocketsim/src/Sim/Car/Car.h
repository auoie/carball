#pragma once
#include "../PhysState/RawBodyState.h"
#include "../PhysState/PhysState.h"
#include "CarConfig/CarConfig.h"
#include "../btVehicleRL/btVehicleRL.h"
#include "../CarControls.h"
#include "../BallHitInfo/BallHitInfo.h"
#include "../../Math/Math.h"
#include "../MutatorConfig/MutatorConfig.h"

#include "../../../libsrc/bullet3-3.24/BulletDynamics/Dynamics/btRigidBody.h"
#include "../../../libsrc/bullet3-3.24/BulletDynamics/Vehicle/btDefaultVehicleRaycaster.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btBoxShape.h"
#include "../../../libsrc/bullet3-3.24/BulletCollision/CollisionShapes/btCompoundShape.h"
#include "../../../src/Sim/btVehicleRL/btVehicleRL.h"

class btGeneric6DofConstraint;

RS_NS_START

struct CarState : public PhysState {

	// Incremented every update, reset when SetState() is called
	// Used for telling if a stateset occured
	// Not serialized
	uint64_t tickCountSinceUpdate = 0;

	// RL PATCH: SetState() recomputes the body's world inverse inertia tensor from this rotation (else it keeps it, as
	// the game's placements do: see Car::SetState). A request, not part of the state: not serialized, reset on setting
	bool refreshInertia = false;

	// True if 3 or more wheels have contact
	bool isOnGround = true;

	// Whether each of the 4 wheels have contact
	// First two are front
	// If your car has 3 wheels, the 4th bool will always be false
	bool wheelsWithContact[4] = {};

	// RL PATCH: wheel values that carry over into the next tick. The vehicle's raycast/friction pass at
	// the start of a tick uses the steering angle, drive/brake forces and friction set during the
	// previous tick, so they are part of the state (a restored car then continues exactly).
	struct WheelCarry {
		float steerAngle = 0, engineForce = 0, brake = 0, latFriction = 0, longFriction = 0;
		float extraPushback = 0; // only reset when the wheel ray misses or the suspension bottoms out
		// The previous tick's ray result, which the car's pre-physics step (sticky force) uses; whether the wheel
		// touched any object is wheelsWithContact
		bool worldContact = false;
		Vec contactNormal = Vec(0, 0, 1);
	};
	struct {
		WheelCarry wheels[4] = {};
	} wheelCarry; 

	// Whether we jumped to get into the air
	// Can be false while airborne, if we left the ground with a flip reset
	bool hasJumped = false;

	// True if we have double jumped and are still in the air
	// NOTE: Flips DO NOT COUNT as double jumps! This is not RLBot.
	bool hasDoubleJumped = false;

	// True if we are in the air, and (have flipped or are currently flipping)
	bool hasFlipped = false;

	// Relative torque direction of the flip
	// Forward flip will have positive Y
	Vec flipRelTorque = { 0, 0, 0 };

	// RL PATCH: while jumping, the time since we started jumping; after a jump (hasJumped), the time since it ended
	float jumpTime = 0;
	float flipTime = 0; // When currently flipping, the time since we started flipping, else 0

	// True during a flip (not an auto-flip, and not after a flip)
	bool isFlipping = false;

	// True during a jump
	bool isJumping = false;

	// RL PATCH: the jump button was released during the current jump (the game's bDeactivate): the jump then ends once
	// past its minimum time, even if pressed again
	bool jumpReleased = false;

	// Total time spent in the air
	float airTime = 0;

	// Time spent in the air once !isJumping
	// If we never jumped, it is 0
	float airTimeSinceJump = 0;

	// Goes from 0 to 100
	float boost = RLConst::BOOST_SPAWN_AMOUNT;

	// Used for recharge boost, counts up from 0 on spawn (in seconds)
	float timeSinceBoosted = 0.f;

	// True if we boosted that tick
	// There exists a minimum boosting time, thus why we must track boosting time
	bool isBoosting = false;
	float boostingTime = 0;

	bool isSupersonic = false;

	// RL PATCH: time spent below the supersonic start speed while supersonic, for checking with the supersonic maintain
	// time (see RLConst.h; the game's TimeBelowSupersonicSpeed). RocketSim: time spent supersonic
	float supersonicTime = 0;

	// This is a state variable due to the rise/fall rate of handbrake inputs (see RLConst.h)
	float handbrakeVal = 0;

	bool isAutoFlipping = false;
	float autoFlipTimer = 0; // Counts down when auto-flipping
	float autoFlipTorqueScale = 0;

	struct {
		bool hasContact = false;
		Vec contactNormal;
	} worldContact;

	struct {
		uint32_t otherCarID = 0;
		float cooldownTimer = 0;
	} carContact;

	bool isDemoed = false;
	float demoRespawnTimer = 0;

	// RL PATCH: respawn spot selection while demolished (the game's PRI_TA.DemoSelectionData and
	// PlayerController_TA.Prespawn; Arena::_UpdateDemolished): the steer input's side last tick (-1, 0, 1: a push past
	// 0.3 picks), the side picked (0 none, 1 left, 2 right) and the spot on it (0 the inner one); then,
	// DEMO_PRESPAWN_STATE_LENGTH before the respawn, the spot locked in
	int8_t demoSpawnSelectLast = 0;
	uint8_t demoSpawnPreference = 0;
	uint8_t demoSpawnIndex = 0;
	bool prespawnSet = false;
	Vec prespawnPos = { 0, 0, 0 };
	float prespawnYaw = 0;

	// RL PATCH: how many times landing on the ball or another car gave the car its jump and dodge back (the game's
	// DodgesRefreshedCounter, for the flip reset indicator: Car::_PreTickUpdate). Wraps
	uint16_t flipResets = 0;

	// RL PATCH: counts the car's placements by a kickoff reset or a respawn (in the game each is a new actor or a
	// teleport, never smoothed): a client draws a correction that changes it at once and smooths every other. Wraps
	uint16_t spawnCount = 0;

	// RL PATCH: seconds left of air control's pitch lock after a dodge that ended by landing (the game locks pitch
	// for 0.3 s after the dodge deactivates, also when landing deactivates it: a wavedash, then a jump; GA-5)
	float dodgePitchLockTime = 0;

	BallHitInfo ballHitInfo = BallHitInfo();

	// Controls from last tick, set to this->controls after simulation
	CarControls lastControls = CarControls();

	CarState() : PhysState() {
		pos.z = RLConst::CAR_SPAWN_REST_Z;
	}

	// Returns true if the car is currently able to jump, double-jump, or flip
	bool HasFlipOrJump() const;

	// Returns true if we currently have a flip, and got it from a flip reset (instead of a jump)
	bool HasFlipReset() const;

	// Returns true if we are in the air, and became airborne from a flip reset
	// This returns true regardless of whether or not we still have the flip
	bool GotFlipReset() const;

	void Serialize(DataStreamOut& out) const;
	void Deserialize(DataStreamIn& in);
};

#define CARSTATE_SERIALIZATION_FIELDS \
pos, rotMat, vel, angVel, isOnGround, hasJumped, hasDoubleJumped, hasFlipped, \
flipRelTorque, jumpTime, isFlipping, flipTime, isJumping, jumpReleased /* RL PATCH */, airTimeSinceJump, \
boost, isBoosting, boostingTime, timeSinceBoosted, supersonicTime, handbrakeVal, isAutoFlipping, \
autoFlipTimer, autoFlipTorqueScale, isDemoed, demoRespawnTimer, lastControls, \
demoSpawnSelectLast, demoSpawnPreference, demoSpawnIndex, prespawnSet, prespawnPos, prespawnYaw, flipResets, spawnCount, dodgePitchLockTime, /* RL PATCH */ \
worldContact.hasContact, worldContact.contactNormal, \
carContact.otherCarID, carContact.cooldownTimer, \
isSupersonic /* RL PATCH: affects the next tick (supersonic is kept down to 2100 uu/s) */

enum class Team : byte {
	BLUE = 0,
	ORANGE = 1
};

#define RS_OPPOSITE_TEAM(team) ((team) == Team::BLUE ? Team::ORANGE : Team::BLUE)
#define RS_TEAM_FROM_Y(y) ((y) < 0 ? Team::BLUE : Team::ORANGE)

class Car {
public:
	// Configuration for this car
	CarConfig config;
	Team team;

	// Each car is given a unique ID when created by the arena
	// Will always be >0 (unless you somehow reach integer overflow)
	uint32_t id;

	// The controls to simulate the car with
	CarControls controls;

	CarState GetState();
	void SetState(const CarState& state);

	void Demolish(float respawnDelay = RLConst::DEMO_RESPAWN_TIME);

	// Respawn the car, called after we have been demolished and waited for the respawn timer
	void Respawn(GameMode gameMode, int seed = -1, float boostAmount = RLConst::BOOST_SPAWN_AMOUNT);

	// RL PATCH: a fresh car at this spot (the respawn's new state)
	void _RespawnAt(Vec pos, float yaw, float boostAmount);

	// RL PATCH: where the car respawns when its demolition timer runs out this tick (chosen by the arena before the
	// cars' pre-physics step: Arena::_FindRespawnSpot)
	struct RespawnSpot {
		Vec pos;
		float yaw = 0;
		bool valid = false;
	} _respawnSpot;

	btVehicleRL _bulletVehicle;
	btDefaultVehicleRaycaster _bulletVehicleRaycaster;
	btRigidBody _rigidBody;
	// RL PATCH: the XY lock while the car isn't driving (the kickoff countdown) or is on the podium (Car_TA's per-tick
	// SetConstrained2D(!bDriving || bPodiumMode): a btGeneric6DofConstraint pinning the body's world X/Y where it took
	// hold, Z and every rotation free; Arena::_UpdateXYLocks keeps it, static session PD1). Not state: taken again
	// where the car is when it's wanted and missing (a clone, a load)
	btGeneric6DofConstraint* _xyLock = NULL;
	// RL PATCH: a lock a snapshot held, its pin (frame A's origin, BT units): taken there as the lock comes back
	bool _xyLockPending = false;
	btVector3 _xyLockPin = btVector3(0, 0, 0);
	// RL PATCH: placed since the last tick (SetState: a spawn, a kickoff, a respawn, a load): a held lock is taken again
	// where the car is now (the game's every placement is a new body, a new lock: RV-295)
	bool _xyLockMoved = false;
	// RL PATCH: whether the car is held (a lock, or a snapshot's pin waiting), and its pin as the next tick takes it: a
	// placement since the last tick takes it again where it is now (RV-295), so a snapshot, a clone and the network
	// state carry that, not the old pin (RV-303)
	bool _XYLockHeld(btVector3* pin) const;
	// RL PATCH: podium mode (EnablePodiumMode): the jump's force lasts PodiumJumpForceTime (the arena sets it per tick)
	bool _podiumMode = false;
	// RL PATCH: another player's car on a client (the game's SimulatedProxy): its components (Jump, DoubleJump, Dodge,
	// AirControl, FlipCar, Boost) don't run, not even in a resim (the component loop needs the vehicle's Role > 1;
	// notes/netcode-live.md §9): the car drives (the vehicle: throttle, steer, handbrake), its jumps, dodges, boost and
	// air control show only in the server's states. A mode, not state (the client sets it for every car but its own)
	bool _componentsOff = false;
	btCompoundShape _compoundShape;
	btBoxShape _childHitboxShape;

	// NOTE: Not all values are updated because they are unneeded for internal simulation
	// Those values are only updated when GetState() is called
	CarState _internalState;

	// RL PATCH: state at the start of the current tick (the game's OldRBState): its location and velocities as the
	// read-back rounds them, in uu; its rotation the matrix QuatToRotator makes of its quaternion, `_oldQuat`
	PhysState _oldState;
	btQuaternion _oldQuat;
	void _CaptureOldState();

	// RL PATCH: this tick's throttle as the game's Vehicle.Input.Throttle (controls.throttle, or 1 while boosting on the
	// ground: _PreTickUpdate)
	float _inputThrottle = 0;

	// Get the forward direction as a unit vector
	Vec GetForwardDir() const {
		return _internalState.rotMat.forward;
	}

	// Get the rightward direction as a unit vector
	Vec GetRightDir() const {
		return _internalState.rotMat.right;
	}

	// Get the upward direction as a unit vector
	Vec GetUpDir() const {
		return _internalState.rotMat.up;
	}

	// RL PATCH: the dodge's forward input (CarControls::dodgeForward, else -pitch)
	float _DodgeForward() const { return controls.hasDodgeForward ? controls.dodgeForward : -controls.pitch; }
	// RL PATCH: the axes the jump press of this tick came with, when not the controls' (the server's double consume: the
	// first frame's press, the second frame's controls; the game's dodge takes the press's DodgeForward and DodgeRight,
	// G10); a dodge starting this tick reads them, the tick clears them
	struct PressAxes {
		bool valid = false;
		float dodgeForward = 0, yaw = 0, roll = 0;
	} _pressAxes;
	float _PressForward() const { return _pressAxes.valid ? _pressAxes.dodgeForward : _DodgeForward(); }
	float _PressYaw() const { return _pressAxes.valid ? _pressAxes.yaw : controls.yaw; }
	float _PressRoll() const { return _pressAxes.valid ? _pressAxes.roll : controls.roll; }

	// RL PATCH: respawnHeld: a demolished car stays demolished (after a goal, until the kickoff)
	bool _PreTickRespawn(GameMode gameMode, float tickTime, const MutatorConfig& mutatorConfig, bool respawnHeld); // RL PATCH
	void _PreTickUpdate(GameMode gameMode, float tickTime, const MutatorConfig& mutatorConfig, bool respawnHeld = false);
	void _PostTickUpdate(GameMode gameMode, float tickTime, const MutatorConfig& mutatorConfig);
	void _LimitVelocities();

	Vec _velocityImpulseCache = { 0,0,0 };

	// RL PATCH: the steering curves for this car (inner-wheel curves converted to the inner/outer average)
	LinearPieceCurve _steerAngleCurve, _powerslideSteerAngleCurve;

	// RL PATCH: exact rigid body state read by _Deserialize(), applied once the car is in the world
	RawBodyState _loadedBody;

	// RL PATCH: the rotation as last quantized, as the network sends it (see Quantize::PackedRotation)
	Quantize::PackedRotation _netRotation;

	// RL PATCH: where it last touched the ball, on the ball (uu; valid on the tick of ballHitInfo.tickCountWhenHit)
	Vec _ballContactPoint = { 0,0,0 };
	// RL PATCH: whether SetState() has placed the body (its first placement computes the inertia tensor: Car::SetState)
	bool _bodyPlaced = false;
	void _FinishPhysicsTick(const MutatorConfig& mutatorConfig);

	void _BulletSetup(GameMode gameMode, class btDynamicsWorld* bulletWorld, const MutatorConfig& mutatorConfig);
	
	// For construction by Arena
	static Car* _AllocateCar() { return new Car(); }

	void Serialize(DataStreamOut& out);
	void _Deserialize(DataStreamIn& in);

	// RL PATCH: reads what Serialize() wrote, without a car (used by Arena::DeserializeInPlace)
	static void _ReadSerialized(DataStreamIn& in, CarControls& controls, CarConfig& config, CarState& state, RawBodyState& body);

	Car(const Car& other) = delete;
	Car& operator=(const Car& other) = delete;

	~Car() {}

private:
	void _UpdateWheels(float tickTime, const MutatorConfig& mutatorConfig, int numWheelsInContact, float forwardSpeed_UU);
	void _UpdateBoost(float tickTime, const MutatorConfig& mutatorConfig, float forwardSpeed_UU);
	void _UpdateJump(float tickTime, const MutatorConfig& mutatorConfig, bool jumpPressed);
	void _UpdateAirTorque(float tickTime, const MutatorConfig& mutatorConfig, bool doAirControl);
	void _UpdateDoubleJumpOrFlip(float tickTime, const MutatorConfig& mutatorConfig, bool jumpPressed, float forwardSpeed_UU);
	void _UpdateFlipTime(float tickTime);
	void _UpdateStickyForce(float forwardSpeed_UU);
	void _UpdateAutoFlip(float tickTime, const MutatorConfig& mutatorConfig, bool jumpPressed);
	void _UpdateAutoFlipTorque(float tickTime);
	void _UpdateAutoRoll(float tickTime, const MutatorConfig& mutatorConfig, int numWheelsInContact);

	Car() {}
};

RS_NS_END