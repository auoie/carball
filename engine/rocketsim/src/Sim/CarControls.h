#pragma once
#include "../BaseInc.h"

RS_NS_START

// Stores all control inputs to a car
struct CarControls {
	// Driving control
	float throttle, steer;

	// Air orientation control
	float pitch, yaw, roll;

	// Boolean action inputs
	bool jump, boost, handbrake;

	// RL PATCH: keyboard "air pitch safety" (PlayerController_TA.ApplyAirPitchSafety) is holding back
	// nose-down pitch: air control ignores pitch, while dodges still use it (the game keeps
	// VehicleInput.DodgeForward from before the safety zeroes VehicleInput.Pitch).
	bool airPitchSafety;

	// RL PATCH: the dodge's forward input, when the caller has it (VehicleInput.DodgeForward: -Pitch from before the air
	// pitch safety, made a byte on its own, so q(-p) where the engine would have -q(p): the byte scales by 127 up and by
	// 128 down; static analysis C-2). Read by the dodge deadzone, the dodge's direction and the flip cancel. Without it,
	// -pitch
	float dodgeForward;
	bool hasDodgeForward;

	// Maybe someday...
	// bool useItem;

	CarControls() {
		// Initialize everything as zero
		memset(this, 0, sizeof(CarControls));
	}

	// Makes all values range-valid (clamps from -1 to 1)
	void ClampFix() {
		throttle	= RS_CLAMP(throttle,	-1, 1);
		steer		= RS_CLAMP(steer,		-1, 1);
		pitch		= RS_CLAMP(pitch,		-1, 1);
		yaw			= RS_CLAMP(yaw,		-1, 1);
		roll		= RS_CLAMP(roll,		-1, 1);
	}
};

#define CAR_CONTROLS_SERIALIZATION_FIELDS(name) \
name.throttle, name.steer, \
name.pitch, name.yaw, name.roll, \
name.boost, name.jump, name.handbrake, name.airPitchSafety, name.dodgeForward, name.hasDodgeForward

RS_NS_END