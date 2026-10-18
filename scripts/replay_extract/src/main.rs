//! Dump ball and car rigid-body states (plus car inputs) from Rocket League replays to CSV.
//!
//! One row per replicated RigidBody update:
//! replay,frame,time,kind,actor,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,sleeping,throttle,steer,handbrake,boosting,
//! jump,double_jump,dodge,boost_amount,body,steer_sensitivity,team,handbrake_ramp,
//! dodge_torque_x,dodge_torque_y,dodge_torque_z,jump_since,double_jump_since,dodge_since
//!
//! Units as replicated: positions uu, velocities uu/s, angular velocities rad/s × 100 (boxcars divides every vector by
//! 100; the game sends angular velocity × 100). throttle/steer: the game's bytes (128 = 0; see `Vehicle_TA` input
//! quantization in notes/physics-values.md). jump/double_jump/dodge/boosting: the car component is active.
//! boost_amount 0–255 (255 = 100 boost). body: the loadout's body product id (23 Octane, 4284 Fennec, ...).
//! handbrake_ramp: the car's handbrake value (rises 5/s while held, falls 2/s), integrated frame by frame from the
//! replicated handbrake flag, each change taken halfway between the frame it arrived in and the one before.
//! dodge_torque: the dodge component's replicated DodgeTorque (as decoded: /100). *_since: seconds since that
//! component became active (same halfway estimate), empty when it is not active.
//!
//! Usage: replay_extract [--demos DEMOS.csv] [--pickups PICKUPS.csv] [--goals GOALS.csv] OUT.csv REPLAY [REPLAY...]
//!
//! --demos: one row per replicated demolition (Car_TA ReplicatedDemolish, _CustomFX / GoalExplosion, Extended):
//! replay,frame,time,attacker,victim,avx,avy,avz,vvx,vvy,vvz (the actors and their velocities as replicated).
//! --pickups: one row per replicated boost pad pickup state (VehiclePickup_TA (New)ReplicatedPickupData):
//! replay,frame,time,pad,instigator,picked_up (pad actor; instigator car actor or -1; the replicated value).
//! --goals: one row per goal (the header's Goals): replay,frame,time,scorer,team,goal_explosion (the scorer's loadout
//! goal explosion product id for their team: a cosmetic that can carry its own explosion physics).

use boxcars::{Attribute, HeaderProp, ParserBuilder};
use std::collections::HashMap;
use std::fs;
use std::io::{BufWriter, Write};

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Ball,
    Car,
    Boost,
    Jump,
    DoubleJump,
    Dodge,
    Other,
}

#[derive(Clone, Copy)]
struct CarInputs {
    throttle: u8,
    steer: u8,
    handbrake: bool,
    boosting: bool,
    jump: bool,
    double_jump: bool,
    dodge: bool,
    boost_amount: u8,
    team: u8,
    handbrake_ramp: f32,
    dodge_torque: [f32; 3],
    jump_start: f32,
    double_jump_start: f32,
    dodge_start: f32,
}

impl Default for CarInputs {
    fn default() -> Self {
        Self {
            throttle: 128,
            steer: 128,
            handbrake: false,
            boosting: false,
            jump: false,
            double_jump: false,
            dodge: false,
            boost_amount: 0,
            team: 255,
            handbrake_ramp: 0.0,
            dodge_torque: [0.0; 3],
            jump_start: 0.0,
            double_jump_start: 0.0,
            dodge_start: 0.0,
        }
    }
}

#[derive(Default, Clone, Copy)]
struct Player {
    bodies: Option<(u32, u32)>, // blue, orange loadout bodies
    steer_sensitivity: Option<f32>,
    goal_explosions: Option<(Option<u32>, Option<u32>)>, // blue, orange loadout goal explosions (product ids)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args: Vec<String> = std::env::args().collect();
    let mut demos = None;
    let mut pickups = None;
    let mut goals = None;
    let mut pri = None;
    loop {
        if args.len() > 2 && args[1] == "--pri" {
            // The players' match counters as they change (MatchScore, Goals, Assists, Saves, Shots, CarDemolitions,
            // SelfDemolitions), each car's PRI, the game's state names and overtime, and the header's goals
            let mut p = BufWriter::new(fs::File::create(&args[2])?);
            writeln!(p, "replay,frame,time,kind,a,b,value")?;
            pri = Some(p);
            args.drain(1..3);
            continue;
        }
        if args.len() > 2 && args[1] == "--demos" {
            let mut d = BufWriter::new(fs::File::create(&args[2])?);
            writeln!(d, "replay,frame,time,attacker,victim,avx,avy,avz,vvx,vvy,vvz")?;
            demos = Some(d);
            args.drain(1..3);
        } else if args.len() > 2 && args[1] == "--goals" {
            // One row per goal: the scorer (the header's Goals) and their loadout's goal explosion (a cosmetic that
            // carries its own explosion physics: notes/validation.md finding 46)
            let mut g = BufWriter::new(fs::File::create(&args[2])?);
            writeln!(g, "replay,frame,time,scorer,team,goal_explosion")?;
            goals = Some(g);
            args.drain(1..3);
        } else if args.len() > 2 && args[1] == "--pickups" {
            let mut p = BufWriter::new(fs::File::create(&args[2])?);
            writeln!(p, "replay,frame,time,pad,instigator,picked_up")?;
            pickups = Some(p);
            args.drain(1..3);
        } else {
            break;
        }
    }
    let mut out = BufWriter::new(fs::File::create(&args[1])?);
    writeln!(
        out,
        "replay,frame,time,kind,actor,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,sleeping,throttle,steer,handbrake,boosting,\
         jump,double_jump,dodge,boost_amount,body,steer_sensitivity,team,handbrake_ramp,\
         dodge_torque_x,dodge_torque_y,dodge_torque_z,jump_since,double_jump_since,dodge_since"
    )?;

    for path in &args[2..] {
        let data = fs::read(path)?;
        let replay = match ParserBuilder::new(&data).must_parse_network_data().parse() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("{path}: {e}");
                continue;
            }
        };
        let name = std::path::Path::new(path).file_stem().unwrap().to_string_lossy().to_string();
        let objects = &replay.objects;
        let frames = match &replay.network_frames {
            Some(n) => &n.frames,
            None => continue,
        };

        let mut kinds: HashMap<i32, Kind> = HashMap::new();
        let mut inputs: HashMap<i32, CarInputs> = HashMap::new(); // car actor -> inputs
        let mut owner: HashMap<i32, i32> = HashMap::new(); // car component -> car actor
        let mut car_pri: HashMap<i32, i32> = HashMap::new(); // car actor -> PRI actor
        let mut players: HashMap<i32, Player> = HashMap::new(); // PRI actor -> loadout and preferences
        let mut names: HashMap<i32, String> = HashMap::new(); // PRI actor -> player name
        let mut counters: HashMap<(i32, u8), i32> = HashMap::new(); // (PRI, counter) -> last value
        let mut last_state = String::new();
        let mut last_overtime = false;

        let mut prev_time = frames.first().map(|f| f.time).unwrap_or(0.0);
        for (fi, frame) in frames.iter().enumerate() {
            // Handbrake ramps up to the middle of this frame interval with the state they had
            let mid = (prev_time + frame.time) / 2.0;
            for i in inputs.values_mut() {
                let rate = if i.handbrake { 5.0 } else { -2.0 };
                i.handbrake_ramp = (i.handbrake_ramp + rate * (mid - prev_time)).clamp(0.0, 1.0);
            }
            for a in &frame.deleted_actors {
                kinds.remove(&a.0);
                inputs.remove(&a.0);
                owner.remove(&a.0);
            }
            for na in &frame.new_actors {
                let obj = objects[na.object_id.0 as usize].as_str();
                let kind = if obj.starts_with("Archetypes.Ball.") {
                    Kind::Ball
                } else if obj.starts_with("Archetypes.Car.") {
                    Kind::Car
                } else {
                    match obj {
                        "Archetypes.CarComponents.CarComponent_Boost" => Kind::Boost,
                        "Archetypes.CarComponents.CarComponent_Jump" => Kind::Jump,
                        "Archetypes.CarComponents.CarComponent_DoubleJump" => Kind::DoubleJump,
                        "Archetypes.CarComponents.CarComponent_Dodge" => Kind::Dodge,
                        _ => Kind::Other,
                    }
                };
                kinds.insert(na.actor_id.0, kind);
            }
            let mut bodies = Vec::new(); // rigid body updates, written once this frame's inputs are in
            for ua in &frame.updated_actors {
                let actor = ua.actor_id.0;
                let kind = *kinds.get(&actor).unwrap_or(&Kind::Other);
                let prop = objects[ua.object_id.0 as usize].as_str();
                let component_car = owner.get(&actor).copied();
                match (&ua.attribute, prop) {
                    (Attribute::Byte(b), "TAGame.Vehicle_TA:ReplicatedThrottle") => {
                        inputs.entry(actor).or_default().throttle = *b
                    }
                    (Attribute::Byte(b), "TAGame.Vehicle_TA:ReplicatedSteer") => {
                        inputs.entry(actor).or_default().steer = *b
                    }
                    (Attribute::Boolean(b), "TAGame.Vehicle_TA:bReplicatedHandbrake") => {
                        inputs.entry(actor).or_default().handbrake = *b
                    }
                    (Attribute::TeamPaint(p), "TAGame.Car_TA:TeamPaint") => {
                        inputs.entry(actor).or_default().team = p.team
                    }
                    (Attribute::ActiveActor(aa), "Engine.Pawn:PlayerReplicationInfo") => {
                        car_pri.insert(actor, aa.actor.0);
                        if let Some(p) = pri.as_mut() {
                            writeln!(p, "{name},{fi},{},carpri,{actor},{},", frame.time, aa.actor.0)?;
                        }
                    }
                    (Attribute::Int(v), counter) if pri.is_some() && counter.starts_with("TAGame.PRI_TA:") => {
                        let id = match counter {
                            "TAGame.PRI_TA:MatchScore" => Some(0u8),
                            "TAGame.PRI_TA:MatchGoals" => Some(1),
                            "TAGame.PRI_TA:MatchAssists" => Some(2),
                            "TAGame.PRI_TA:MatchSaves" => Some(3),
                            "TAGame.PRI_TA:MatchShots" => Some(4),
                            "TAGame.PRI_TA:CarDemolitions" => Some(5),
                            "TAGame.PRI_TA:SelfDemolitions" => Some(6),
                            _ => None,
                        };
                        if let Some(id) = id {
                            if counters.insert((actor, id), *v) != Some(*v) {
                                writeln!(pri.as_mut().unwrap(), "{name},{fi},{},stat,{actor},{id},{v}", frame.time)?;
                            }
                        }
                    }
                    (Attribute::Int(v), "TAGame.GameEvent_TA:ReplicatedStateName") if pri.is_some() => {
                        let state = replay.names.get(*v as usize).cloned().unwrap_or_default();
                        if state != last_state {
                            writeln!(pri.as_mut().unwrap(), "{name},{fi},{},state,,,{state}", frame.time)?;
                            last_state = state;
                        }
                    }
                    (Attribute::Boolean(b), "TAGame.GameEvent_Soccar_TA:bOverTime") if pri.is_some() => {
                        if *b != last_overtime {
                            writeln!(pri.as_mut().unwrap(), "{name},{fi},{},overtime,,,{}", frame.time, *b as u8)?;
                            last_overtime = *b;
                        }
                    }
                    (Attribute::TeamLoadout(l), "TAGame.PRI_TA:ClientLoadouts") => {
                        let p = players.entry(actor).or_default();
                        p.bodies = Some((l.blue.body, l.orange.body));
                        p.goal_explosions = Some((l.blue.goal_explosion, l.orange.goal_explosion));
                    }
                    (Attribute::String(s), "Engine.PlayerReplicationInfo:PlayerName") => {
                        names.insert(actor, s.clone());
                    }
                    (Attribute::Float(s), "TAGame.PRI_TA:SteeringSensitivity") => {
                        players.entry(actor).or_default().steer_sensitivity = Some(*s)
                    }
                    (Attribute::ActiveActor(aa), "TAGame.CarComponent_TA:Vehicle") => {
                        owner.insert(actor, aa.actor.0);
                    }
                    (Attribute::Byte(b), "TAGame.CarComponent_TA:ReplicatedActive") => {
                        if let Some(car) = component_car {
                            let active = b % 2 == 1;
                            let i = inputs.entry(car).or_default();
                            match kind {
                                Kind::Boost => i.boosting = active,
                                Kind::Jump => {
                                    if active && !i.jump {
                                        i.jump_start = mid;
                                    }
                                    i.jump = active
                                }
                                Kind::DoubleJump => {
                                    if active && !i.double_jump {
                                        i.double_jump_start = mid;
                                    }
                                    i.double_jump = active
                                }
                                Kind::Dodge => {
                                    if active && !i.dodge {
                                        i.dodge_start = mid;
                                    }
                                    i.dodge = active
                                }
                                _ => {}
                            }
                        }
                    }
                    (Attribute::Location(v), "TAGame.CarComponent_Dodge_TA:DodgeTorque") => {
                        if let Some(car) = component_car {
                            inputs.entry(car).or_default().dodge_torque = [v.x, v.y, v.z];
                        }
                    }
                    (Attribute::ReplicatedBoost(rb), "TAGame.CarComponent_Boost_TA:ReplicatedBoost") => {
                        if let Some(car) = component_car {
                            inputs.entry(car).or_default().boost_amount = rb.boost_amount;
                        }
                    }
                    (Attribute::Byte(b), "TAGame.CarComponent_Boost_TA:ReplicatedBoostAmount") => {
                        if let Some(car) = component_car {
                            inputs.entry(car).or_default().boost_amount = *b;
                        }
                    }
                    (Attribute::Demolish(_), _)
                    | (Attribute::DemolishFx(_), _)
                    | (Attribute::DemolishExtended(_), _)
                        if demos.is_some() =>
                    {
                        let (attacker, victim, av, vv) = match &ua.attribute {
                            Attribute::Demolish(d) => (d.attacker.0, d.victim.0, d.attack_velocity, d.victim_velocity),
                            Attribute::DemolishFx(d) => {
                                (d.attacker.0, d.victim.0, d.attack_velocity, d.victim_velocity)
                            }
                            Attribute::DemolishExtended(d) => {
                                (d.attacker.actor.0, d.victim.actor.0, d.attacker_velocity, d.victim_velocity)
                            }
                            _ => unreachable!(),
                        };
                        writeln!(
                            demos.as_mut().unwrap(),
                            "{name},{fi},{},{attacker},{victim},{},{},{},{},{},{}",
                            frame.time,
                            av.x,
                            av.y,
                            av.z,
                            vv.x,
                            vv.y,
                            vv.z
                        )?;
                    }
                    (Attribute::Pickup(_), _) | (Attribute::PickupNew(_), _) if pickups.is_some() => {
                        let (instigator, picked) = match &ua.attribute {
                            Attribute::Pickup(p) => (p.instigator, p.picked_up as u8),
                            Attribute::PickupNew(p) => (p.instigator, p.picked_up),
                            _ => unreachable!(),
                        };
                        writeln!(
                            pickups.as_mut().unwrap(),
                            "{name},{fi},{},{actor},{},{picked}",
                            frame.time,
                            instigator.map(|a| a.0).unwrap_or(-1)
                        )?;
                    }
                    (Attribute::RigidBody(rb), _) if kind == Kind::Ball || kind == Kind::Car => {
                        bodies.push((actor, kind, *rb));
                    }
                    _ => {}
                }
            }
            // ... and from the middle of the interval to this frame with the new state
            for i in inputs.values_mut() {
                let rate = if i.handbrake { 5.0 } else { -2.0 };
                i.handbrake_ramp = (i.handbrake_ramp + rate * (frame.time - mid)).clamp(0.0, 1.0);
            }
            prev_time = frame.time;
            let since =
                |active: bool, start: f32| if active { format!("{:.4}", frame.time - start) } else { String::new() };
            for (actor, kind, rb) in &bodies {
                let (actor, kind) = (*actor, *kind);
                {
                    let lv = rb.linear_velocity.unwrap_or(boxcars::Vector3f { x: 0.0, y: 0.0, z: 0.0 });
                    let av = rb.angular_velocity.unwrap_or(boxcars::Vector3f { x: 0.0, y: 0.0, z: 0.0 });
                    let inp = inputs.get(&actor).copied().unwrap_or_default();
                    let player = car_pri.get(&actor).and_then(|p| players.get(p)).copied().unwrap_or_default();
                    let body = match (player.bodies, inp.team) {
                        (Some((blue, _)), 0) => blue.to_string(),
                        (Some((_, orange)), 1) => orange.to_string(),
                        _ => String::new(),
                    };
                    let sens = player.steer_sensitivity.map(|s| s.to_string()).unwrap_or_default();
                    writeln!(
                        out,
                        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{:.4},{},{},{},{},{},{}",
                        name,
                        fi,
                        frame.time,
                        if kind == Kind::Ball { "ball" } else { "car" },
                        actor,
                        rb.location.x,
                        rb.location.y,
                        rb.location.z,
                        rb.rotation.x,
                        rb.rotation.y,
                        rb.rotation.z,
                        rb.rotation.w,
                        lv.x,
                        lv.y,
                        lv.z,
                        av.x,
                        av.y,
                        av.z,
                        rb.sleeping as u8,
                        inp.throttle,
                        inp.steer,
                        inp.handbrake as u8,
                        inp.boosting as u8,
                        inp.jump as u8,
                        inp.double_jump as u8,
                        inp.dodge as u8,
                        inp.boost_amount,
                        body,
                        sens,
                        inp.team,
                        inp.handbrake_ramp,
                        inp.dodge_torque[0],
                        inp.dodge_torque[1],
                        inp.dodge_torque[2],
                        since(inp.jump, inp.jump_start),
                        since(inp.double_jump, inp.double_jump_start),
                        since(inp.dodge, inp.dodge_start)
                    )?;
                }
            }
        }

        if let Some(p) = pri.as_mut() {
            for (key, prop) in &replay.properties {
                let HeaderProp::Array(list) = prop else { continue };
                if key != "Goals" {
                    continue;
                }
                for goal in list {
                    let field = |n: &str| goal.iter().find(|(k, _)| k == n).map(|(_, v)| v);
                    if let (Some(HeaderProp::Int(frame)), Some(HeaderProp::Int(team))) =
                        (field("frame"), field("PlayerTeam"))
                    {
                        let time = frames.get(*frame as usize).map_or(0.0, |f| f.time);
                        writeln!(p, "{name},{frame},{time},goal,{team},,")?;
                    }
                }
            }
        }
        if let Some(g) = goals.as_mut() {
            for (key, prop) in &replay.properties {
                let HeaderProp::Array(list) = prop else { continue };
                if key != "Goals" {
                    continue;
                }
                for goal in list {
                    let field = |n: &str| goal.iter().find(|(k, _)| k == n).map(|(_, v)| v);
                    let frame = match field("frame") {
                        Some(HeaderProp::Int(f)) => *f,
                        _ => continue,
                    };
                    let scorer = match field("PlayerName") {
                        Some(HeaderProp::Str(s)) => s.clone(),
                        _ => String::new(),
                    };
                    let team = match field("PlayerTeam") {
                        Some(HeaderProp::Int(t)) => *t,
                        _ => -1,
                    };
                    let explosion = names
                        .iter()
                        .find(|(_, n)| **n == scorer)
                        .and_then(|(pri, _)| players.get(pri)?.goal_explosions)
                        .and_then(|(blue, orange)| if team == 1 { orange } else { blue })
                        .map(|id| id.to_string())
                        .unwrap_or_default();
                    let time = frames.get(frame as usize).map_or(0.0, |f| f.time);
                    writeln!(g, "{name},{frame},{time},{},{team},{explosion}", scorer.replace(',', " "))?;
                }
            }
        }
    }
    Ok(())
}
