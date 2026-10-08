//! The game protocol (version 1): see `protocol/README.md`. Byte-exact samples in `protocol/vectors.json`.

use crate::engine::Controls;

pub const VERSION: u16 = 3; // 2: kickoff countdown in the state; 3: the wheels' previous contacts
pub const MAX_INPUT_FRAMES: usize = 10;

/// Control stream (reliable) messages
#[derive(Clone, Debug, PartialEq)]
pub enum Control {
    Hello { version: u16, team: u8, body: u8, dodge_deadzone: f32, steering_sensitivity: f32, air_control_sensitivity: f32 },
    Welcome { version: u16, car_id: u32, tick_rate: u8, frame: u32, snapshot: Vec<u8> },
    World { frame: u32, snapshot: Vec<u8> },
    Event { server_tick: u32, event: GameEvent },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameEvent {
    Goal { team: u8 },
    Demo { attacker: u32, victim: u32 },
}

/// Datagram (unreliable) messages
#[derive(Clone, Debug, PartialEq)]
pub enum Datagram {
    Inputs { timestamp: u32, first_frame: u32, frames: Vec<InputFrame> },
    Update(Update),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    pub server_tick: u32,
    pub ack_frame: u32,
    pub received_frame: u32,
    pub echo_timestamp: u32,
    pub echo_delay: u16,
    pub buffer_target: u8,
    pub buffer_size: u8,
    pub part: u8,
    pub parts: u8,
    pub state: Vec<u8>,
}

/// One frame of a player's inputs, quantized as sent (axes in 1/127 steps).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InputFrame {
    pub throttle: i8,
    pub steer: i8,
    pub pitch: i8,
    pub yaw: i8,
    pub roll: i8,
    pub bits: u8,
}

pub const BIT_JUMP: u8 = 1;
pub const BIT_BOOST: u8 = 2;
pub const BIT_HANDBRAKE: u8 = 4;
pub const BIT_AIR_PITCH_SAFETY: u8 = 8;

/// round(v × 127), halves away from zero, clamped
/// An input axis as the game's input byte (`Vehicle_TA.SetVehicleInput`): q = round(v × 127) for v ≥ 0 and
/// round(v × 128) below, halves up (the engine applies the same, so decoded values pass through unchanged)
pub fn quantize_axis(v: f32) -> i8 {
    let v = v.clamp(-1.0, 1.0);
    let f = if v < 0.0 { (v * 128.0).max(-128.0) } else { (v * 127.0).min(127.0) };
    let y = f + 128.0;
    ((((y + y) + 0.5).round_ties_even() as i32 >> 1) - 128) as i8
}

pub fn dequantize_axis(q: i8) -> f32 {
    let v = f32::from(q);
    if q < 0 { v * 0.0078125 } else { v / 127.0 }
}

impl InputFrame {
    pub fn controls(&self) -> Controls {
        Controls {
            throttle: dequantize_axis(self.throttle),
            steer: dequantize_axis(self.steer),
            pitch: dequantize_axis(self.pitch),
            yaw: dequantize_axis(self.yaw),
            roll: dequantize_axis(self.roll),
            jump: u8::from(self.bits & BIT_JUMP != 0),
            boost: u8::from(self.bits & BIT_BOOST != 0),
            handbrake: u8::from(self.bits & BIT_HANDBRAKE != 0),
            air_pitch_safety: u8::from(self.bits & BIT_AIR_PITCH_SAFETY != 0),
        }
    }
}

// --- encoding -------------------------------------------------------------------------------------------------

#[derive(Default)]
struct Writer(Vec<u8>);

impl Writer {
    fn u8(&mut self, v: u8) { self.0.push(v); }
    fn i8(&mut self, v: i8) { self.0.push(v as u8); }
    fn u16(&mut self, v: u16) { self.0.extend_from_slice(&v.to_le_bytes()); }
    fn u32(&mut self, v: u32) { self.0.extend_from_slice(&v.to_le_bytes()); }
    fn f32(&mut self, v: f32) { self.0.extend_from_slice(&v.to_le_bytes()); }
    fn bytes_with_len(&mut self, b: &[u8]) {
        self.u32(b.len() as u32);
        self.0.extend_from_slice(b);
    }
}

#[derive(Debug)]
pub enum DecodeError {
    Truncated,
    UnknownType(u8),
    TooLarge,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Truncated => write!(f, "message truncated"),
            Self::UnknownType(t) => write!(f, "unknown message type 0x{t:02x}"),
            Self::TooLarge => write!(f, "message too large"),
        }
    }
}

impl std::error::Error for DecodeError {}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], DecodeError> {
        if self.0.len() < n {
            return Err(DecodeError::Truncated);
        }
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Ok(head)
    }
    fn u8(&mut self) -> Result<u8, DecodeError> { Ok(self.take(1)?[0]) }
    fn i8(&mut self) -> Result<i8, DecodeError> { Ok(self.take(1)?[0] as i8) }
    fn u16(&mut self) -> Result<u16, DecodeError> { Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap())) }
    fn u32(&mut self) -> Result<u32, DecodeError> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn f32(&mut self) -> Result<f32, DecodeError> { Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    fn bytes_with_len(&mut self) -> Result<Vec<u8>, DecodeError> {
        let n = self.u32()? as usize;
        Ok(self.take(n)?.to_vec())
    }
    fn rest(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0).to_vec()
    }
}

impl Control {
    /// The message with its u16 length prefix, ready for the control stream.
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        match self {
            Self::Hello { version, team, body, dodge_deadzone, steering_sensitivity, air_control_sensitivity } => {
                w.u8(0x01);
                w.u16(*version);
                w.u8(*team);
                w.u8(*body);
                w.f32(*dodge_deadzone);
                w.f32(*steering_sensitivity);
                w.f32(*air_control_sensitivity);
            }
            Self::Welcome { version, car_id, tick_rate, frame, snapshot } => {
                w.u8(0x81);
                w.u16(*version);
                w.u32(*car_id);
                w.u8(*tick_rate);
                w.u32(*frame);
                w.bytes_with_len(snapshot);
            }
            Self::World { frame, snapshot } => {
                w.u8(0x82);
                w.u32(*frame);
                w.bytes_with_len(snapshot);
            }
            Self::Event { server_tick, event } => {
                w.u8(0x83);
                w.u32(*server_tick);
                match event {
                    GameEvent::Goal { team } => {
                        w.u8(0);
                        w.u8(*team);
                    }
                    GameEvent::Demo { attacker, victim } => {
                        w.u8(1);
                        w.u32(*attacker);
                        w.u32(*victim);
                    }
                }
            }
        }
        let body = w.0;
        assert!(body.len() <= usize::from(u16::MAX), "control message too large");
        let mut framed = Vec::with_capacity(body.len() + 2);
        framed.extend_from_slice(&(body.len() as u16).to_le_bytes());
        framed.extend_from_slice(&body);
        framed
    }

    /// Decodes one message (without its length prefix).
    pub fn decode(body: &[u8]) -> Result<Self, DecodeError> {
        let mut r = Reader(body);
        Ok(match r.u8()? {
            0x01 => Self::Hello {
                version: r.u16()?,
                team: r.u8()?,
                body: r.u8()?,
                dodge_deadzone: r.f32()?,
                steering_sensitivity: r.f32()?,
                air_control_sensitivity: r.f32()?,
            },
            0x81 => Self::Welcome { version: r.u16()?, car_id: r.u32()?, tick_rate: r.u8()?, frame: r.u32()?, snapshot: r.bytes_with_len()? },
            0x82 => Self::World { frame: r.u32()?, snapshot: r.bytes_with_len()? },
            0x83 => {
                let server_tick = r.u32()?;
                let event = match r.u8()? {
                    0 => GameEvent::Goal { team: r.u8()? },
                    1 => GameEvent::Demo { attacker: r.u32()?, victim: r.u32()? },
                    t => return Err(DecodeError::UnknownType(t)),
                };
                Self::Event { server_tick, event }
            }
            t => return Err(DecodeError::UnknownType(t)),
        })
    }
}

impl Datagram {
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        match self {
            Self::Inputs { timestamp, first_frame, frames } => {
                w.u8(0x01);
                w.u32(*timestamp);
                w.u32(*first_frame);
                w.u8(frames.len() as u8);
                for f in frames {
                    for axis in [f.throttle, f.steer, f.pitch, f.yaw, f.roll] {
                        w.i8(axis);
                    }
                    w.u8(f.bits);
                }
            }
            Self::Update(u) => {
                w.u8(0x81);
                w.u32(u.server_tick);
                w.u32(u.ack_frame);
                w.u32(u.received_frame);
                w.u32(u.echo_timestamp);
                w.u16(u.echo_delay);
                w.u8(u.buffer_target);
                w.u8(u.buffer_size);
                w.u8(u.part);
                w.u8(u.parts);
                w.0.extend_from_slice(&u.state);
            }
        }
        w.0
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut r = Reader(bytes);
        Ok(match r.u8()? {
            0x01 => {
                let timestamp = r.u32()?;
                let first_frame = r.u32()?;
                let count = usize::from(r.u8()?);
                if count > MAX_INPUT_FRAMES {
                    return Err(DecodeError::TooLarge);
                }
                let mut frames = Vec::with_capacity(count);
                for _ in 0..count {
                    frames.push(InputFrame { throttle: r.i8()?, steer: r.i8()?, pitch: r.i8()?, yaw: r.i8()?, roll: r.i8()?, bits: r.u8()? });
                }
                Self::Inputs { timestamp, first_frame, frames }
            }
            0x81 => Self::Update(Update {
                server_tick: r.u32()?,
                ack_frame: r.u32()?,
                received_frame: r.u32()?,
                echo_timestamp: r.u32()?,
                echo_delay: r.u16()?,
                buffer_target: r.u8()?,
                buffer_size: r.u8()?,
                part: r.u8()?,
                parts: r.u8()?,
                state: r.rest(),
            }),
            t => return Err(DecodeError::UnknownType(t)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../protocol/vectors.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    fn f(v: &Value) -> f32 { v.as_f64().unwrap() as f32 }
    fn u(v: &Value) -> u32 { v.as_u64().unwrap() as u32 }
    fn bytes(v: &Value) -> Vec<u8> { v.as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect() }

    fn control_from_json(m: &Value) -> Control {
        match m["type"].as_str().unwrap() {
            "hello" => Control::Hello {
                version: u(&m["version"]) as u16,
                team: u(&m["team"]) as u8,
                body: u(&m["body"]) as u8,
                dodge_deadzone: f(&m["dodgeDeadzone"]),
                steering_sensitivity: f(&m["steeringSensitivity"]),
                air_control_sensitivity: f(&m["airControlSensitivity"]),
            },
            "welcome" => Control::Welcome {
                version: u(&m["version"]) as u16,
                car_id: u(&m["carId"]),
                tick_rate: u(&m["tickRate"]) as u8,
                frame: u(&m["frame"]),
                snapshot: bytes(&m["snapshot"]),
            },
            "world" => Control::World { frame: u(&m["frame"]), snapshot: bytes(&m["snapshot"]) },
            "event" => Control::Event {
                server_tick: u(&m["serverTick"]),
                event: match m["event"]["kind"].as_str().unwrap() {
                    "goal" => GameEvent::Goal { team: u(&m["event"]["team"]) as u8 },
                    _ => GameEvent::Demo { attacker: u(&m["event"]["attacker"]), victim: u(&m["event"]["victim"]) },
                },
            },
            t => panic!("unknown {t}"),
        }
    }

    fn datagram_from_json(m: &Value) -> Datagram {
        match m["type"].as_str().unwrap() {
            "inputs" => Datagram::Inputs {
                timestamp: u(&m["timestamp"]),
                first_frame: u(&m["firstFrame"]),
                frames: m["frames"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|fr| {
                        let bit = |name: &str, b: u8| if fr[name].as_bool().unwrap() { b } else { 0 };
                        InputFrame {
                            throttle: quantize_axis(f(&fr["throttle"])),
                            steer: quantize_axis(f(&fr["steer"])),
                            pitch: quantize_axis(f(&fr["pitch"])),
                            yaw: quantize_axis(f(&fr["yaw"])),
                            roll: quantize_axis(f(&fr["roll"])),
                            bits: bit("jump", BIT_JUMP) | bit("boost", BIT_BOOST) | bit("handbrake", BIT_HANDBRAKE) | bit("airPitchSafety", BIT_AIR_PITCH_SAFETY),
                        }
                    })
                    .collect(),
            },
            _ => Datagram::Update(Update {
                server_tick: u(&m["serverTick"]),
                ack_frame: u(&m["ackFrame"]),
                received_frame: u(&m["receivedFrame"]),
                echo_timestamp: u(&m["echoTimestamp"]),
                echo_delay: u(&m["echoDelay"]) as u16,
                buffer_target: u(&m["bufferTarget"]) as u8,
                buffer_size: u(&m["bufferSize"]) as u8,
                part: u(&m["part"]) as u8,
                parts: u(&m["parts"]) as u8,
                state: bytes(&m["state"]),
            }),
        }
    }

    #[test]
    fn matches_the_shared_vectors() {
        let v = vectors();
        for vector in v["vectors"].as_array().unwrap() {
            let expected = hex(vector["hex"].as_str().unwrap());
            let message = &vector["message"];
            if vector["channel"] == "control" {
                let m = control_from_json(message);
                assert_eq!(m.encode(), expected, "{message}");
                assert_eq!(Control::decode(&expected[2..]).unwrap(), m);
            } else {
                let m = datagram_from_json(message);
                assert_eq!(m.encode(), expected, "{message}");
                assert_eq!(Datagram::decode(&expected).unwrap(), m);
            }
        }
    }

    #[test]
    fn dequantized_axes_are_the_same_floats_everywhere() {
        let v = vectors();
        let bits = v["dequantizedAxes"]["bits"].as_array().unwrap();
        assert_eq!(bits.len(), 256);
        for (i, b) in bits.iter().enumerate() {
            let q = i as i32 - 128;
            let expected = u32::from_str_radix(b.as_str().unwrap(), 16).unwrap();
            assert_eq!(dequantize_axis(q as i8).to_bits(), expected, "q = {q}");
            assert_eq!(quantize_axis(dequantize_axis(q as i8)), q as i8);
        }
    }

    #[test]
    fn quantizes_like_the_game() {
        assert_eq!(quantize_axis(-1.0), -128);
        assert_eq!(quantize_axis(1.0), 127);
        assert_eq!(quantize_axis(-0.7), -90);
        assert_eq!(quantize_axis(0.7), 89);
        assert_eq!(quantize_axis(-63.5 / 128.0), -63); // halves up
        assert_eq!(quantize_axis(63.5 / 127.0), 64);
    }

    #[test]
    fn rejects_garbage() {
        assert!(Datagram::decode(&[]).is_err());
        assert!(Datagram::decode(&[0x01, 1, 2]).is_err());
        assert!(Datagram::decode(&[0x7f]).is_err());
        let mut too_many = vec![0x01, 0, 0, 0, 0, 0, 0, 0, 0, 11];
        too_many.extend(std::iter::repeat_n(0, 66));
        assert!(Datagram::decode(&too_many).is_err());
    }
}
