//! Dump ball and car rigid-body states (plus car inputs) from Rocket League replays to CSV.
//!
//! One row per replicated RigidBody update:
//! replay,frame,time,kind,actor,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,sleeping,throttle,steer,handbrake,boosting
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
    Other,
}

#[derive(Default, Clone, Copy)]
struct CarInputs {
    throttle: u8,
    steer: u8,
    handbrake: bool,
    boosting: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let mut out = BufWriter::new(fs::File::create(&args[1])?);
    writeln!(
        out,
        "replay,frame,time,kind,actor,x,y,z,qx,qy,qz,qw,vx,vy,vz,wx,wy,wz,sleeping,throttle,steer,handbrake,boosting"
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
        let mut boost_owner: HashMap<i32, i32> = HashMap::new(); // boost component -> car actor

        for (fi, frame) in frames.iter().enumerate() {
            for a in &frame.deleted_actors {
                kinds.remove(&a.0);
            }
            for na in &frame.new_actors {
                let obj = &objects[na.object_id.0 as usize];
                let kind = if obj.starts_with("Archetypes.Ball.") {
                    Kind::Ball
                } else if obj.starts_with("Archetypes.Car.") {
                    Kind::Car
                } else if obj == "Archetypes.CarComponents.CarComponent_Boost" {
                    Kind::Boost
                } else {
                    Kind::Other
                };
                kinds.insert(na.actor_id.0, kind);
            }
            for ua in &frame.updated_actors {
                let actor = ua.actor_id.0;
                let kind = *kinds.get(&actor).unwrap_or(&Kind::Other);
                let prop = objects[ua.object_id.0 as usize].as_str();
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
                    (Attribute::ActiveActor(aa), "TAGame.CarComponent_TA:Vehicle") if kind == Kind::Boost => {
                        boost_owner.insert(actor, aa.actor.0);
                    }
                    (Attribute::Byte(b), "TAGame.CarComponent_TA:ReplicatedActive") if kind == Kind::Boost => {
                        if let Some(car) = boost_owner.get(&actor) {
                            inputs.entry(*car).or_default().boosting = b % 2 == 1;
                        }
                    }
                    (Attribute::RigidBody(rb), _) if kind == Kind::Ball || kind == Kind::Car => {
                        let lv = rb.linear_velocity.unwrap_or(boxcars::Vector3f { x: 0.0, y: 0.0, z: 0.0 });
                        let av = rb.angular_velocity.unwrap_or(boxcars::Vector3f { x: 0.0, y: 0.0, z: 0.0 });
                        let inp = inputs.get(&actor).copied().unwrap_or_default();
                        writeln!(
                            out,
                            "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
                            name,
                            fi,
                            frame.time,
                            if kind == Kind::Ball { "ball" } else { "car" },
                            actor,
                            rb.location.x, rb.location.y, rb.location.z,
                            rb.rotation.x, rb.rotation.y, rb.rotation.z, rb.rotation.w,
                            lv.x, lv.y, lv.z, av.x, av.y, av.z,
                            rb.sleeping as u8,
                            inp.throttle, inp.steer, inp.handbrake as u8, inp.boosting as u8
                        )?;
                    }
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
