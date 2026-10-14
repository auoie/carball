//! What each update carries, at the game's rates (notes/netcode-live.md §11, notes/netcode-audit.md "Wire size of the
//! car state"): an actor is considered at its `NetUpdateFrequency` with the net tick's jitter (now + 1/NUF + U(0, 1/57):
//! the ball's 100 ≈ 35 a second, a car's 15 ≈ 12 a second; every gameplay actor always relevant) and forced into the
//! next update by the events the game forces: the ball after a car hits it (`ForceNetUpdatePacket`), a car on a
//! placement (a teleport, a respawn, a kickoff), a flip reset, a demolition, the countdown's end (`SetAllDriving`) and
//! its jump, double jump or dodge within 1000 uu of the ball (`ForceNetPacketIfNearBall`). The pads go when one is
//! picked up or comes back (`NewReplicatedPickupData`), and once a second besides (a datagram can be lost).

use std::collections::{BTreeMap, BTreeSet};

use crate::engine::{Arena, CarNetInfo};

/// `NetUpdateFrequency`: the ball's, a car's (`Ball_TA`, `Car_TA`)
const BALL_RATE: f64 = 100.0;
const CAR_RATE: f64 = 15.0;
/// The net tick's jitter on each consideration: U(0, 1/`NetServerMaxTickRate`)
const NET_TICK_RATE: f64 = 57.0;
/// A car's jump, double jump or dodge this close to the ball forces it (`ForcePacketSignificantDistance`)
const FORCE_DISTANCE: f32 = 1000.0;
/// The pads again after this long without a change (s)
const PADS_REFRESH: f64 = 1.0;

/// The actors one update carries
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Chosen {
    pub ball: bool,
    pub cars: Vec<u32>,
    pub pads: bool,
}

pub struct Replication {
    rng: u64,
    ball_next: f64,
    car_next: BTreeMap<u32, f64>,
    force_ball: bool,
    force_cars: BTreeSet<u32>,
    /// Each car's watched state after the last tick
    watched: BTreeMap<u32, CarNetInfo>,
    last_touch: Option<u64>,
    countdown: u32,
    pads_sent: Option<u64>,
    pads_next: f64,
}

impl Replication {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1,
            ball_next: 0.0,
            car_next: BTreeMap::new(),
            force_ball: true,
            force_cars: BTreeSet::new(),
            watched: BTreeMap::new(),
            last_touch: None,
            countdown: 0,
            pads_sent: None,
            pads_next: 0.0,
        }
    }

    /// Uniform in [0, 1) (xorshift64*)
    fn uniform(&mut self) -> f64 {
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        (self.rng.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 11) as f64 / (1u64 << 53) as f64
    }

    /// After each tick (and the match's placements in it): the events that force actors into the next update
    pub fn watch(&mut self, arena: &mut Arena) {
        let touch = arena.last_ball_touch_tick();
        if touch.is_some() && touch != self.last_touch {
            self.force_ball = true;
        }
        self.last_touch = touch;
        let countdown = arena.kickoff_countdown();
        let go = self.countdown > 0 && countdown == 0;
        self.countdown = countdown;
        let ball = arena.ball_position();
        let cars = arena.car_ids();
        self.watched.retain(|id, _| cars.contains(id));
        self.car_next.retain(|id, _| cars.contains(id));
        for car in cars {
            let Some(now) = arena.car_net_info(car) else { continue };
            let near = arena.car_position(car).is_some_and(|p| {
                let d = [p[0] - ball[0], p[1] - ball[1], p[2] - ball[2]];
                d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= FORCE_DISTANCE * FORCE_DISTANCE
            });
            let forced = match self.watched.get(&car) {
                None => true,
                Some(was) => {
                    let impulse = (now.jumped > was.jumped) || (now.double_jumped > was.double_jumped) || (now.flipped > was.flipped);
                    go || now.spawn_count != was.spawn_count || now.flip_resets != was.flip_resets || now.demoed != was.demoed || (impulse && near)
                }
            };
            if forced {
                self.force_cars.insert(car);
            }
            self.watched.insert(car, now);
        }
    }

    /// At an update: the actors due (considered and their time come) or forced since the last update
    pub fn choose(&mut self, arena: &mut Arena) -> Chosen {
        let t = arena.tick_count() as f64 / 120.0;
        let mut chosen = Chosen::default();
        if self.force_ball || t >= self.ball_next {
            chosen.ball = true;
            self.ball_next = t + 1.0 / BALL_RATE + self.uniform() / NET_TICK_RATE;
        }
        for car in arena.car_ids() {
            let due = self.car_next.get(&car).is_none_or(|&next| t >= next);
            if due || self.force_cars.contains(&car) {
                chosen.cars.push(car);
                let next = t + 1.0 / CAR_RATE + self.uniform() / NET_TICK_RATE;
                self.car_next.insert(car, next);
            }
        }
        let pads = arena.pads_active();
        if self.pads_sent != Some(pads) || t >= self.pads_next {
            chosen.pads = true;
            self.pads_sent = Some(pads);
            self.pads_next = t + PADS_REFRESH;
        }
        self.force_ball = false;
        self.force_cars.clear();
        chosen
    }
}
