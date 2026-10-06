//! Dump ball and car rigid-body states (plus car inputs) from Rocket League replays to CSV.
//!
//! One row per replicated RigidBody update:
//! replay,frame,time,kind,actor,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,sleeping,throttle,steer,handbrake,boosting,
//! jump,double_jump,dodge,boost_amount,body,steer_sensitivity,team
//!
//! Units as replicated: positions uu, velocities uu/s, angular velocities rad/s × 100 (boxcars divides every vector by
//! 100; the game sends angular velocity × 100). throttle/steer: the game's bytes (128 = 0; see `Vehicle_TA` input
//! quantization in notes/physics-values.md). jump/double_jump/dodge/boosting: the car component is active.
//! boost_amount 0–255 (255 = 100 boost). body: the loadout's body product id (23 Octane, 4284 Fennec, ...).
//!
//! Usage: replay_extract OUT.csv REPLAY [REPLAY...]

use boxcars::{Attribute, ParserBuilder};
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
        }
    }
}

#[derive(Default, Clone, Copy)]
struct Player {
    bodies: Option<(u32, u32)>, // blue, orange loadout bodies
    steer_sensitivity: Option<f32>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let mut out = BufWriter::new(fs::File::create(&args[1])?);
    writeln!(
        out,
        "replay,frame,time,kind,actor,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,sleeping,throttle,steer,handbrake,boosting,\
         jump,double_jump,dodge,boost_amount,body,steer_sensitivity,team"
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

        for (fi, frame) in frames.iter().enumerate() {
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
                    (Attribute::TeamPaint(p), "TAGame.Car_TA:TeamPaint") => inputs.entry(actor).or_default().team = p.team,
                    (Attribute::ActiveActor(aa), "Engine.Pawn:PlayerReplicationInfo") => {
                        car_pri.insert(actor, aa.actor.0);
                    }
                    (Attribute::TeamLoadout(l), "TAGame.PRI_TA:ClientLoadouts") => {
                        players.entry(actor).or_default().bodies = Some((l.blue.body, l.orange.body))
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
                                Kind::Jump => i.jump = active,
                                Kind::DoubleJump => i.double_jump = active,
                                Kind::Dodge => i.dodge = active,
                                _ => {}
                            }
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
                    (Attribute::RigidBody(rb), _) if kind == Kind::Ball || kind == Kind::Car => {
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
                            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                            name,
                            fi,
                            frame.time,
                            if kind == Kind::Ball { "ball" } else { "car" },
                            actor,
                            rb.location.x, rb.location.y, rb.location.z,
                            rb.rotation.x, rb.rotation.y, rb.rotation.z, rb.rotation.w,
                            lv.x, lv.y, lv.z, av.x, av.y, av.z,
                            rb.sleeping as u8,
                            inp.throttle, inp.steer, inp.handbrake as u8, inp.boosting as u8,
                            inp.jump as u8, inp.double_jump as u8, inp.dodge as u8, inp.boost_amount,
                            body, sens, inp.team
                        )?;
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
