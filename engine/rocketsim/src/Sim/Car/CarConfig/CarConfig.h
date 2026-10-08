#pragma once
#include "../../../BaseInc.h"

RS_NS_START

struct WheelPairConfig {
	// Radius of both wheels
	float wheelRadius;

	// How far out the suspension rests
	float suspensionRestLength;

	// Where the wheel actually connects (suspension start position)
	// NOTE: Y should ALWAYS be positive. It will be automatically negated when creating the second wheel. 
	Vec connectionPointOffset;
};

#define WHEEL_PAIR_CONFIG_SERIALIZATION_FIELDS(name) \
name.connectionPointOffset, name.suspensionRestLength, name.wheelRadius

struct CarConfig {
	// Full size of hitbox (NOT the half-size/extent)
	Vec hitboxSize;

	// Offset of the hitbox (from it's origin)
	// NOTE: Does not effect car's center of mass, that's always at local (0,0,0)
	Vec hitboxPosOffset;

	WheelPairConfig frontWheels, backWheels;

	// Car has three-wheel behavior (psyclops)
	// NOTE: The psyclops actually has 4 wheels, the front two are combined
	// No car actually has only 3 simulated wheels
	bool threeWheels = false;

	// (|yaw| + |pitch| + |roll|) will need to be >= this in order to flip
	float dodgeDeadzone = 0.5f;

	// RL PATCH: the player's input sensitivities, which the game applies in the car's physics
	// (PRI_TA.SetUserCarPreferences -> VehicleSim.SteeringSensitivity, AirControl AirControlSensitivity).
	// The input is scaled, then clamped to [-1, 1]; at 10 (the maximum) any input is full input.
	float steeringSensitivity = 1.f;
	float airControlSensitivity = 1.f;

	// RL PATCH: where the game creates this body at a (re)spawn: the height (36.00, MoveToGround's, plus the body
	// mesh's Tz) and an offset along the car's forward axis (the body's HandlingPresetXOffset plus its mesh's Origin.X:
	// the Venom's mesh origin is (5, 0, 0)), from the preset's reference body; per body, not per preset (the Takumi and
	// the Scarab, Octane-preset bodies, have +5 and +7). Live, each body respawned twice (validation finding 48)
	float spawnZ = 36.f;
	float spawnForwardOffset = 0;
};

#define CAR_CONFIG_SERIALIZATION_FIELDS(name) \
name.dodgeDeadzone, name.steeringSensitivity, name.airControlSensitivity, name.hitboxPosOffset, name.hitboxSize, \
name.threeWheels /* RL PATCH: was missing, so a restored Psyclops got four wheels */, \
WHEEL_PAIR_CONFIG_SERIALIZATION_FIELDS(name.frontWheels), \
WHEEL_PAIR_CONFIG_SERIALIZATION_FIELDS(name.backWheels), \
name.spawnZ, name.spawnForwardOffset /* RL PATCH */ \

// Global car configurations for all car type presets
// NOTE: CAR_CONFIG_PLANK is the batmobile preset
const extern CarConfig
	CAR_CONFIG_OCTANE, CAR_CONFIG_DOMINUS, CAR_CONFIG_PLANK, CAR_CONFIG_BREAKOUT, CAR_CONFIG_HYBRID, CAR_CONFIG_MERC, CAR_CONFIG_PSYCLOPS;

RS_NS_END