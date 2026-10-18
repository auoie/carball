//! A simulated network path for the network tests (notes/netcode-live.md §13.0): each packet sent is delivered after a
//! delay (a base, jitter: normal or AR(1), path stalls that hold back what is sent during them), lost (i.i.d. or
//! Gilbert–Elliott), or delivered twice; reordering comes from the delays. Seeded and deterministic, in virtual time.
//! Its TypeScript twin, `client/src/testing/netsim.ts`, gives the same deliveries for the same seed and profile (checked
//! by vectors this module's tests write).

/// PCG32 (O'Neill's XSH RR, 64-bit state): the same sequence in Rust and TypeScript
#[derive(Clone, Debug)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    pub fn new(seed: u64, stream: u64) -> Self {
        let mut rng = Self { state: 0, inc: (stream << 1) | 1 };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(self.inc);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform in [0, 1)
    pub fn uniform(&mut self) -> f64 {
        f64::from(self.next_u32()) / 4_294_967_296.0
    }

    /// Standard normal (Box–Muller, one of the pair)
    pub fn normal(&mut self) -> f64 {
        let u1 = 1.0 - self.uniform();
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Jitter {
    None,
    /// Independent normal delays around the base, `sigma` ms
    Normal {
        sigma_ms: f64,
    },
    /// AR(1): each packet's jitter `rho` of the last's plus fresh noise, `sigma` ms overall
    Ar1 {
        sigma_ms: f64,
        rho: f64,
    },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Loss {
    None,
    Iid {
        p: f64,
    },
    /// Two states: good to bad with `p_gb` a packet, back with `p_bg`; each its own loss rate
    GilbertElliott {
        p_gb: f64,
        p_bg: f64,
        loss_good: f64,
        loss_bad: f64,
    },
}

/// The path stalls from `at_s` for `ms`, then every `every_s` (0: once): what is sent then arrives when it ends
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stall {
    pub at_s: f64,
    pub ms: f64,
    pub every_s: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub base_ms: f64,
    pub jitter: Jitter,
    pub loss: Loss,
    pub duplicate: f64,
    pub stalls: Vec<Stall>,
}

impl Profile {
    /// A constant delay
    pub fn constant(base_ms: f64) -> Self {
        Self { base_ms, jitter: Jitter::None, loss: Loss::None, duplicate: 0.0, stalls: Vec::new() }
    }
}

#[derive(Clone, Debug)]
pub struct NetSim {
    pub profile: Profile,
    rng: Pcg32,
    ar: f64,
    bad: bool,
}

impl NetSim {
    pub fn new(profile: Profile, seed: u64) -> Self {
        Self { profile, rng: Pcg32::new(seed, 54), ar: 0.0, bad: false }
    }

    /// The end of the stall `t` (s) falls in, if any
    fn stalled_until(&self, t: f64) -> Option<f64> {
        for s in &self.profile.stalls {
            let mut start = s.at_s;
            loop {
                let end = start + s.ms / 1000.0;
                if t >= start && t < end {
                    return Some(end);
                }
                if s.every_s <= 0.0 || start > t {
                    break;
                }
                start += s.every_s;
            }
        }
        None
    }

    /// A packet sent at `t` (s): when its copies arrive (none: lost; two: duplicated). The draws are taken in a fixed
    /// order whatever the profile (loss, jitter, duplicate, the duplicate's jitter), so its twin can follow
    pub fn send(&mut self, t: f64) -> Vec<f64> {
        let loss_draw = self.rng.uniform();
        let jitter_draw = self.rng.normal();
        let dup_draw = self.rng.uniform();
        let dup_jitter = self.rng.normal();
        let lost = match self.profile.loss {
            Loss::None => false,
            Loss::Iid { p } => loss_draw < p,
            Loss::GilbertElliott { p_gb, p_bg, loss_good, loss_bad } => {
                // (the state moves first, on the same draw's high part: a second draw would change the sequence)
                let move_draw = (loss_draw * 1024.0).fract();
                if self.bad {
                    if move_draw < p_bg {
                        self.bad = false;
                    }
                } else if move_draw < p_gb {
                    self.bad = true;
                }
                loss_draw < if self.bad { loss_bad } else { loss_good }
            }
        };
        let jitter_ms = match self.profile.jitter {
            Jitter::None => 0.0,
            Jitter::Normal { sigma_ms } => sigma_ms * jitter_draw,
            Jitter::Ar1 { sigma_ms, rho } => {
                self.ar = rho * self.ar + (1.0 - rho * rho).sqrt() * sigma_ms * jitter_draw;
                self.ar
            }
        };
        if lost {
            return Vec::new();
        }
        let depart = self.stalled_until(t).unwrap_or(t);
        let arrive = |j: f64| depart + (self.profile.base_ms + j).max(0.0) / 1000.0;
        let mut out = vec![arrive(jitter_ms)];
        if dup_draw < self.profile.duplicate {
            let extra = match self.profile.jitter {
                Jitter::None => 0.0,
                Jitter::Normal { sigma_ms } | Jitter::Ar1 { sigma_ms, .. } => sigma_ms * dup_jitter,
            };
            out.push(arrive(jitter_ms + extra.abs()));
        }
        out
    }
}

/// A TypeScript twin's vectors (client/src/testing/): this text must be the file's. With `REGENERATE_VECTORS=1` it's
/// written instead; without the client's tree (a server-only checkout) the check is skipped (RV-317)
#[cfg(test)]
pub(crate) fn check_vectors(path: &str, text: &str) {
    let dir = std::path::Path::new(path).parent().expect("a file in a directory");
    if !dir.is_dir() {
        return;
    }
    if std::env::var_os("REGENERATE_VECTORS").is_some_and(|v| v == "1") {
        std::fs::write(path, text).expect("writes the vectors");
        return;
    }
    let old = std::fs::read_to_string(path).unwrap_or_default();
    assert!(old == text, "{path} is out of date: regenerate it with REGENERATE_VECTORS=1 cargo test");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcg32_is_the_reference_sequence() {
        // (O'Neill's pcg32 demo, seed 42, stream 54: its first outputs)
        let mut rng = Pcg32::new(42, 54);
        let first: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(first, [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]);
    }

    #[test]
    fn delivers_with_the_profile_s_loss_delay_and_duplicates() {
        let profile = Profile {
            base_ms: 50.0,
            jitter: Jitter::Normal { sigma_ms: 10.0 },
            loss: Loss::Iid { p: 0.05 },
            duplicate: 0.05,
            stalls: Vec::new(),
        };
        let mut sim = NetSim::new(profile, 7);
        let (mut lost, mut dup, mut delay) = (0, 0, Vec::new());
        for i in 0..100_000 {
            let t = f64::from(i) / 60.0;
            let got = sim.send(t);
            if got.is_empty() {
                lost += 1;
            }
            if got.len() == 2 {
                dup += 1;
            }
            if let Some(a) = got.first() {
                delay.push((a - t) * 1000.0);
            }
        }
        assert!((4500..5500).contains(&lost), "lost {lost}");
        assert!((4000..5500).contains(&dup), "duplicated {dup}");
        let mean = delay.iter().sum::<f64>() / delay.len() as f64;
        let sd = (delay.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / delay.len() as f64).sqrt();
        assert!((mean - 50.0).abs() < 0.3 && (sd - 10.0).abs() < 0.3, "delay {mean} ± {sd} ms");
    }

    #[test]
    fn a_stall_holds_back_what_is_sent_during_it() {
        let profile = Profile { stalls: vec![Stall { at_s: 1.0, ms: 150.0, every_s: 0.0 }], ..Profile::constant(30.0) };
        let mut sim = NetSim::new(profile, 1);
        assert!((sim.send(0.9)[0] - 0.93).abs() < 1e-9);
        assert!((sim.send(1.05)[0] - 1.18).abs() < 1e-9, "held to the stall's end");
        assert!((sim.send(1.2)[0] - 1.23).abs() < 1e-9);
    }

    #[test]
    fn gilbert_elliott_loses_in_bursts() {
        let profile = Profile {
            loss: Loss::GilbertElliott { p_gb: 0.01, p_bg: 0.2, loss_good: 0.0, loss_bad: 0.5 },
            ..Profile::constant(20.0)
        };
        let mut sim = NetSim::new(profile, 3);
        let mut runs = Vec::new();
        let mut run = 0;
        for i in 0..200_000 {
            if sim.send(f64::from(i) / 60.0).is_empty() {
                run += 1;
            } else if run > 0 {
                runs.push(run);
                run = 0;
            }
        }
        let lost: usize = runs.iter().sum();
        // (in the bad state 1/(1 + 20) of the time, half lost: about 2.4 %)
        assert!((3000..7000).contains(&lost), "lost {lost}");
        assert!(runs.iter().any(|&r| r >= 3), "no bursts");
    }

    /// Vectors for the TypeScript twin (client/src/testing/netsim.test.ts): the same seed and profiles, the same
    /// deliveries (written to client/src/testing/netsim.vectors.json)
    #[test]
    fn writes_the_twin_s_vectors() {
        let profiles = [
            (
                "jitter",
                Profile {
                    base_ms: 50.0,
                    jitter: Jitter::Normal { sigma_ms: 10.0 },
                    loss: Loss::Iid { p: 0.05 },
                    duplicate: 0.05,
                    stalls: Vec::new(),
                },
            ),
            (
                "ar1",
                Profile {
                    base_ms: 100.0,
                    jitter: Jitter::Ar1 { sigma_ms: 8.0, rho: 0.9 },
                    loss: Loss::None,
                    duplicate: 0.0,
                    stalls: vec![Stall { at_s: 0.5, ms: 150.0, every_s: 2.0 }],
                },
            ),
            (
                "burst",
                Profile {
                    loss: Loss::GilbertElliott { p_gb: 0.05, p_bg: 0.3, loss_good: 0.01, loss_bad: 0.6 },
                    ..Profile::constant(30.0)
                },
            ),
        ];
        let mut out = String::from("{\n");
        for (k, (name, profile)) in profiles.iter().enumerate() {
            let mut sim = NetSim::new(profile.clone(), 11);
            let deliveries: Vec<String> = (0..300)
                .map(|i| {
                    let got = sim.send(f64::from(i) / 60.0);
                    format!("[{}]", got.iter().map(|a| format!("{a:.9}")).collect::<Vec<_>>().join(","))
                })
                .collect();
            out +=
                &format!("  \"{name}\": [{}]{}\n", deliveries.join(","), if k + 1 < profiles.len() { "," } else { "" });
        }
        out += "}\n";
        check_vectors(concat!(env!("CARGO_MANIFEST_DIR"), "/../client/src/testing/netsim.vectors.json"), &out);
    }
}
