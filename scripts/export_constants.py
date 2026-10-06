"""Export Rocket League physics constants from decrypted packages to JSON.

Re-run after a game patch: decrypt the packages listed in PKGS with decrypt_upk.py, then
  python3 export_constants.py ../out/decrypted ../out/rl_physics_constants.json
Values are raw (uu, uu*mass for forces/impulses, degrees for steer curves) plus a few derived
per-mass numbers. See notes/physics-values.md for meaning and caveats.
"""
import json
import os
import sys

from package import Package
from props import PropReader

PKGS = {
    "TAGame": "TAGame.upk",
    "Soccar": "GameInfo_Soccar_SF.upk",
    "Engine": "Engine.upk",
    "Startup": "Startup.upk",
    "Stadium": "Stadium_P.upk",
    "Octane": "Body_Octane_SF.upk",
}


def load(dirpath):
    out = {}
    for key, fname in PKGS.items():
        pkg = Package(os.path.join(dirpath, fname))
        out[key] = (pkg, PropReader(pkg))
    return out


def obj(pk, path):
    pkg, pr = pk
    hits = [e for e in pkg.exports if pkg.path(e["index"]) == path]
    if not hits:
        raise KeyError(path)
    o, _, _ = pr.read_object(hits[0])
    return o


def curve(v):
    return [[p["InVal"], p["OutVal"]] for p in v.get("Points", [])]


def main():
    src, dst = sys.argv[1], sys.argv[2]
    P = load(src)
    car = obj(P["Soccar"], "Archetypes.Car.Car_Default")
    sim = obj(P["Soccar"], "Archetypes.Car.Car_Default.DefaultVehicleSim")
    sim_default = obj(P["TAGame"], "Default__VehicleSim_TA")
    wf = obj(P["Soccar"], "Archetypes.Car.Car_Default.DefaultVehicleSim.FrontLeft")
    wb = obj(P["Soccar"], "Archetypes.Car.Car_Default.DefaultVehicleSim.BackLeft")
    ball = obj(P["Soccar"], "Archetypes.Ball.Ball_Default")
    ball_body = obj(P["Soccar"], "Ball_Default.Meshes.Ball_DefaultBall00.RB_BodySetup_0")
    comp = {n: obj(P["TAGame"], f"Archetypes.CarComponents.CarComponent_{n}")
            for n in ("Boost", "Jump", "DoubleJump", "Dodge", "AirControl", "FlipCar")}
    comp_def = {n: obj(P["TAGame"], f"Default__CarComponent_{n}_TA")
                for n in ("Boost", "DoubleJump", "Dodge", "AirControl")}
    physcfg = obj(P["TAGame"], "Default__PhysicsConfig_TA")
    engshare = obj(P["TAGame"], "Default__EngineShare_TA")
    world = obj(P["Engine"], "Default__WorldInfo")
    pm_ball = obj(P["TAGame"], "PhysicalMaterials.Game.Physmat_Ball")
    pm_car = obj(P["TAGame"], "PhysicalMaterials.Game.Physmat_Car")
    pm_sticky = obj(P["Startup"], "PhysicalMaterials.Collision_Sticky")
    pm_engine = obj(P["Engine"], "Default__PhysicalMaterial")
    pad_s = obj(P["Stadium"], "Archetypes.VehiclePickup.VehiclePickup_BoostPad")
    pad_b = obj(P["Stadium"], "Archetypes.VehiclePickup.VehiclePickup_BoostPill")
    pad_s_cyl = obj(P["Stadium"], "Archetypes.VehiclePickup.VehiclePickup_BoostPad.DefaultCollisionCylinder")
    pad_b_cyl = obj(P["Stadium"], "Archetypes.VehiclePickup.VehiclePickup_BoostPill.DefaultCollisionCylinder")
    octane = obj(P["Octane"], "Body_Octane.Body_Octane")
    net_jitter = obj(P["TAGame"], "Default__NetworkJitterSettings_TA")
    net_input = obj(P["TAGame"], "Default__NetworkInputBuffer_TA")
    rb_default = obj(P["TAGame"], "Default__RBActor_TA")

    m = car["Mass"]
    ci = physcfg["CarInteractionSettings"]
    c = {
        "_meta": {
            "units": "uu (1 uu = 1 cm); forces/impulses are uu*mass; steer curves in degrees (inner wheel)",
            "bullet_scale": 0.02,
            "source": "decrypted Rocket League packages; see notes/physics-values.md",
        },
        "simulation": {
            "tick_rate_hz": engshare["PhysicsFramerate"],
            "max_substeps": engshare["MaxPhysicsSubsteps"],
            "gravity_z": world["DefaultGravityZ"],
            "quantize_physics": physcfg["bQuantizePhysics"],
        },
        "car": {
            "mass": m,
            "max_linear_speed": car["MaxLinearSpeed"],
            "max_angular_speed": car["MaxAngularSpeed"],
            "sticky_force": {"ground": car["StickyForce"]["Ground"], "wall": car["StickyForce"]["Wall"]},
            "auto_roll": {"torque": car["AutoFlip"]["Torque"], "force": car["AutoFlip"]["Force"]},
            "max_time_for_dodge": car["MaxTimeForDodge"],
            "jump_leave_ground_time": physcfg["JumpLeaveGroundTime"],
            "supersonic": {k: physcfg["SuperSonicSettings"][k] for k in ("Speed", "TurnoffSpeedBuffer", "TurnoffTime")},
            "material": {"friction": pm_car["Friction"], "restitution": pm_car["Restitution"]},
            "octane_front_wheel_radius": octane["FrontAxle"]["WheelRadius"],
        },
        "vehicle_sim": {
            "drive_torque": sim["DriveTorque"],
            "drive_torque_per_wheel_scale": 0.25,
            "drive_torque_scale_if_fewer_than_3_wheels": 0.25,
            "drive_torque_curve_signed_speed": curve(sim["DriveTorqueCurve"]),
            "brake_torque": sim["BrakeTorque"],
            "steer_angle_curve_deg_inner_wheel": curve(sim["SteerAngleCurve"]),
            "handbrake_steer_angle_curve_deg_inner_wheel": curve(sim["HandbrakeSteerAngleCurve"]),
            "ackermann_steering": sim["bUseAckermannSteering"],
            "handbrake_rate": {"rise": sim_default["HandbrakeRate"]["RiseRate"],
                               "fall": sim["HandbrakeRate"]["FallRate"]},
            "stop_threshold": sim_default["StopThreshold"],
            "idle_brake_factor": sim["IdleBrakeFactor"],
            "opposite_brake_factor": sim_default["OppositeBrakeFactor"],
        },
        "wheels": {
            k: {
                "suspension_stiffness": w["SuspensionStiffness"],
                "suspension_damping_compression": w["SuspensionDampingCompression"],
                "suspension_damping_relaxation": w["SuspensionDampingRelaxation"],
                "suspension_travel": w["SuspensionTravel"],
                "suspension_max_raise": w["SuspensionMaxRaise"],
                "lat_friction_curve": curve(w["LatFrictionCurve"]),
                "handbrake_lat_friction_curve": curve(w["HandbrakeLatFrictionCurve"]),
                "handbrake_long_friction_curve": curve(w["HandbrakeLongFrictionCurve"]),
                "wall_friction_curve": curve(w["WallFrictionCurve"]),
                "aerial_throttle_to_velocity_factor": w["AerialThrottleToVelocityFactor"],
                "aerial_acceleration_factor": w["AerialAccelerationFactor"],
            } for k, w in (("front", wf), ("back", wb))
        },
        "boost": {
            "force": comp["Boost"]["BoostForce"],
            "accel_uu_s2": comp["Boost"]["BoostForce"] / m,
            "modifier": comp_def["Boost"]["BoostModifier"],
            "consumption_rate_per_s": comp["Boost"]["BoostConsumptionRate"],
            "max_amount": comp["Boost"]["MaxBoostAmount"],
            "start_amount": comp["Boost"]["StartBoostAmount"],
            "min_boost_time": comp["Boost"]["MinBoostTime"],
        },
        "jump": {
            "impulse": comp["Jump"]["JumpImpulse"], "impulse_uu_s": comp["Jump"]["JumpImpulse"] / m,
            "force": comp["Jump"]["JumpForce"], "accel_uu_s2": comp["Jump"]["JumpForce"] / m,
            "force_time": comp["Jump"]["JumpForceTime"], "min_jump_time": comp["Jump"]["MinJumpTime"],
            "double_jump_impulse": comp["DoubleJump"]["JumpImpulse"],
        },
        "dodge": {k: comp["Dodge"][k] for k in (
            "DodgeInputThreshold", "SideDodgeImpulse", "SideDodgeImpulseMaxSpeedScale", "ForwardDodgeImpulse",
            "ForwardDodgeImpulseMaxSpeedScale", "BackwardDodgeImpulse", "BackwardDodgeImpulseMaxSpeedScale",
            "SideDodgeTorque", "ForwardDodgeTorque", "DodgeTorqueTime", "MinDodgeTorqueTime", "DodgeZDamping",
            "DodgeZDampingDelay", "DodgeZDampingUpTime")},
        "air_control": {
            "torque_pyr": [comp["AirControl"]["AirTorque"][k] for k in ("Pitch", "Yaw", "Roll")],
            "damping_pyr": [comp["AirControl"]["AirDamping"][k] for k in ("Pitch", "Yaw", "Roll")],
            "torque_scalar": comp_def["AirControl"]["AirTorqueScalar"],
            "damping_scalar": comp_def["AirControl"]["AirDampingScalar"],
            "throttle_force": comp["AirControl"]["ThrottleForce"],
            "throttle_accel_uu_s2": comp["AirControl"]["ThrottleForce"] / m,
        },
        "flip_car": {
            "impulse_velocity_change": comp["FlipCar"]["FlipCarImpulse"],
            "torque_angular_velocity_change_per_tick": comp["FlipCar"]["FlipCarTorque"],
            "time": comp["FlipCar"]["FlipCarTime"],
        },
        "ball": {
            "mass": ball["Mass"],
            "radius": ball_body["AggGeom"]["SphereElems"][0]["Radius"],
            "visual_radius": ball["VisualRadius"],
            "max_linear_speed": ball["MaxLinearSpeed"],
            "max_angular_speed": ball["MaxAngularSpeed"],
            "friction": pm_ball["Friction"], "restitution": pm_ball["Restitution"],
            "linear_damping": pm_ball["LinearDamping"],
            "car_interaction": {
                "push_factor_curve": curve(ball["CarInteraction"]["PushFactorCurve"]),
                "push_z_scale": ball["CarInteraction"]["PushZScale"],
                "push_forward_scale": ball["CarInteraction"]["PushForwardScale"],
                "max_relative_speed": ball["CarInteraction"]["MaxRelativeSpeed"],
                "friction": ball["CarInteraction"]["Friction"],
            },
        },
        "arena": {
            "friction": pm_sticky["Friction"],
            "restitution": pm_engine["Restitution"],
            "combine_rule_inferred": "friction=multiply, restitution=max",
        },
        "car_car": {
            "bumper_push_curve_ground": curve(ci["BumperPushFactorCurveGround"]),
            "bumper_push_curve_air": curve(ci["BumperPushFactorCurveAir"]),
            "z_push_curve": curve(ci["ZPushFactorCurve"]),
            "bump_interval": ci["BumpInterval"],
            "com_angle_check": {k: v for k, v in ci["COMAngleCheck"].items() if k != "_struct"},
            "friction": pm_car["Friction"] ** 2,
        },
        "boost_pads": {
            "small": {"amount": pad_s["BoostAmount"], "respawn": pad_s["RespawnDelay"],
                      "radius": pad_s_cyl["CollisionRadius"], "height": pad_s_cyl["CollisionHeight"]},
            "big": {"amount": pad_b["BoostAmount"], "respawn": pad_b["RespawnDelay"],
                    "radius": pad_b_cyl["CollisionRadius"], "height": pad_b_cyl["CollisionHeight"]},
        },
        "netcode": {
            "client_prediction": engshare["bEnableClientPrediction"],
            "max_uploaded_client_frames": engshare["MaxUploadedClientFrames"],
            "max_input_frames_per_packet": net_input["MaxInputFramesPerPacket"],
            "input_send_rate_hz": net_input["NetUpdateFrequency"],
            "jitter": {k: v for k, v in net_jitter.items() if not k.startswith("_")},
            "sim_time_scale": {k: v for k, v in physcfg["CSTS"].items() if k != "_struct"},
            "fixed_adjust_sim_time_rate": physcfg["STS"]["FixedAdjustSimTimeRate"],
            "rb_sync": {k: v for k, v in rb_default["NetworkSyncSettings"].items() if k != "_struct"},
        },
    }
    with open(dst, "w") as f:
        json.dump(c, f, indent=2)
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
