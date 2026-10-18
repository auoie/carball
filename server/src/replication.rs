//! What each update carries, at the game's rates (notes/netcode-live.md §11, notes/netcode-audit.md "Wire size of the
//! car state"): the ball considered at its `NetUpdateFrequency` with the net tick's jitter (now + 1/100 + U(0, 1/57):
//! ≈ 35 a second), each car at the cadence the replays received (13.4 a second: 4 or 5 updates apart; the
//! NetUpdateFrequency 15 model gave ≈ 12: RV-315), every gameplay actor always relevant; and forced into the next update
//! by the events the game forces: the ball after a car hits it (`ForceNetUpdatePacket`), a car on a placement (a
//! teleport, a respawn, a kickoff), a flip reset, a demolition, the countdown's end (`SetAllDriving`) and its jump,
//! double jump or dodge within 1000 uu of the ball (`ForceNetPacketIfNearBall`). The pads go when one is picked up or
//! comes back (`NewReplicatedPickupData`), and once a second besides (a datagram can be lost).

use std::collections::{BTreeMap, BTreeSet};

use crate::engine::{Arena, CarNetInfo};

/// The ball's `NetUpdateFrequency` (`Ball_TA`)
const BALL_RATE: f64 = 100.0;
/// The net tick's jitter on the ball's consideration: U(0, 1/`NetServerMaxTickRate`)
const NET_TICK_RATE: f64 = 57.0;
/// A car's gap between updates in ticks: 4 updates (8 ticks, 66.7 ms) this share of the time, else 5 (83.3 ms): a mean of
/// 74.6 ms, the replays' 13.4 a second per car (§11.2: their gaps of 1, 2, 3 recorded frames 14, 53, 32 %)
const CAR_SHORT_GAP: u64 = 8;
const CAR_LONG_GAP: u64 = 10;
const CAR_SHORT_SHARE: f64 = 0.52;
/// A car's jump, double jump or dodge this close to the ball forces it (`ForcePacketSignificantDistance`)
const FORCE_DISTANCE: f32 = 1000.0;
/// The pads again after this long without a change (ticks: 1 s)
const PADS_REFRESH: u64 = 120;

/// The actors one update carries
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Chosen {
    pub ball: bool,
    pub cars: Vec<u32>,
    pub pads: bool,
}

/// A car as one tick left it: what forces it, and whether it's near the ball
#[derive(Clone, Copy, Debug)]
pub struct Watched {
    pub id: u32,
    pub info: CarNetInfo,
    pub near_ball: bool,
}

pub struct Replication {
    rng: u64,
    ball_next: f64,
    car_next: BTreeMap<u32, u64>,
    force_ball: bool,
    force_cars: BTreeSet<u32>,
    /// Each car's watched state after the last tick
    watched: BTreeMap<u32, CarNetInfo>,
    last_touch: Option<u64>,
    countdown: u32,
    pads_sent: Option<u64>,
    pads_next: u64,
}

/// Whether a car's change over a tick forces it into the next update (`go`: the countdown ended)
fn forces(was: &CarNetInfo, now: &CarNetInfo, near_ball: bool, go: bool) -> bool {
    let impulse = now.jumped > was.jumped || now.double_jumped > was.double_jumped || now.flipped > was.flipped;
    go || now.spawn_count != was.spawn_count
        || now.flip_resets != was.flip_resets
        || now.demoed != was.demoed
        || (impulse && near_ball)
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
            pads_next: 0,
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
        let ball = arena.ball_position();
        let cars: Vec<Watched> = arena
            .car_ids()
            .into_iter()
            .filter_map(|id| {
                let info = arena.car_net_info(id)?;
                let near_ball = arena.car_position(id).is_some_and(|p| {
                    let d = [p[0] - ball[0], p[1] - ball[1], p[2] - ball[2]];
                    d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= FORCE_DISTANCE * FORCE_DISTANCE
                });
                Some(Watched { id, info, near_ball })
            })
            .collect();
        self.observe(arena.last_ball_touch_tick(), arena.kickoff_countdown(), &cars);
    }

    /// `watch`'s rule: the ball's latest touch, the kickoff countdown and the cars after a tick
    pub fn observe(&mut self, touch: Option<u64>, countdown: u32, cars: &[Watched]) {
        if touch.is_some() && touch != self.last_touch {
            self.force_ball = true;
        }
        self.last_touch = touch;
        let go = self.countdown > 0 && countdown == 0;
        self.countdown = countdown;
        self.watched.retain(|id, _| cars.iter().any(|c| c.id == *id));
        self.car_next.retain(|id, _| cars.iter().any(|c| c.id == *id));
        for car in cars {
            let forced = self.watched.get(&car.id).is_none_or(|was| forces(was, &car.info, car.near_ball, go));
            if forced {
                self.force_cars.insert(car.id);
            }
            self.watched.insert(car.id, car.info);
        }
    }

    /// At an update: the actors due (considered and their time come) or forced since the last update
    pub fn choose(&mut self, arena: &mut Arena) -> Chosen {
        let tick = arena.tick_count();
        let cars = arena.car_ids();
        let pads = arena.pads_active();
        self.choose_at(tick, &cars, pads)
    }

    /// `choose`'s rule at a tick, for these cars and the pads' active flags
    pub fn choose_at(&mut self, tick: u64, cars: &[u32], pads: u64) -> Chosen {
        let t = tick as f64 / 120.0;
        let mut chosen = Chosen::default();
        if self.force_ball || t >= self.ball_next {
            chosen.ball = true;
            self.ball_next = t + 1.0 / BALL_RATE + self.uniform() / NET_TICK_RATE;
        }
        for &car in cars {
            let due = self.car_next.get(&car).is_none_or(|&next| tick >= next);
            if due || self.force_cars.contains(&car) {
                chosen.cars.push(car);
                let gap = if self.uniform() < CAR_SHORT_SHARE { CAR_SHORT_GAP } else { CAR_LONG_GAP };
                self.car_next.insert(car, tick + gap);
            }
        }
        if self.pads_sent != Some(pads) || tick >= self.pads_next {
            chosen.pads = true;
            self.pads_sent = Some(pads);
            self.pads_next = tick + PADS_REFRESH;
        }
        self.force_ball = false;
        self.force_cars.clear();
        chosen
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STILL: CarNetInfo =
        CarNetInfo { spawn_count: 1, flip_resets: 0, jumped: 0, double_jumped: 0, flipped: 0, demoed: 0 };

    #[test]
    fn what_forces_a_car() {
        // (RV-313: each of the game's forcing events, and none without one)
        assert!(!forces(&STILL, &STILL, true, false), "nothing changed");
        assert!(forces(&STILL, &STILL, false, true), "the countdown's end: every car");
        assert!(forces(&STILL, &CarNetInfo { spawn_count: 2, ..STILL }, false, false), "a placement");
        assert!(forces(&STILL, &CarNetInfo { flip_resets: 1, ..STILL }, false, false), "a flip reset");
        assert!(forces(&STILL, &CarNetInfo { demoed: 1, ..STILL }, false, false), "a demolition");
        assert!(forces(&CarNetInfo { demoed: 1, ..STILL }, &STILL, false, false), "the respawn's end of it");
        for (what, now) in [
            ("a jump", CarNetInfo { jumped: 1, ..STILL }),
            ("a double jump", CarNetInfo { double_jumped: 1, ..STILL }),
            ("a dodge", CarNetInfo { flipped: 1, ..STILL }),
        ] {
            assert!(forces(&STILL, &now, true, false), "{what} near the ball");
            assert!(!forces(&STILL, &now, false, false), "{what} away from the ball");
        }
        assert!(
            !forces(&CarNetInfo { jumped: 1, ..STILL }, &STILL, true, false),
            "a landing (the jump flag going down)"
        );
    }

    #[test]
    fn forced_actors_go_in_the_next_update_and_due_ones_at_the_game_s_rates() {
        let mut r = Replication::new(7);
        let cars = [1, 2];
        let watched = |near: bool, info: CarNetInfo| {
            [Watched { id: 1, info, near_ball: near }, Watched { id: 2, info: STILL, near_ball: false }]
        };
        r.observe(None, 0, &watched(false, STILL));
        let first = r.choose_at(2, &cars, 0b11);
        assert_eq!(first, Chosen { ball: true, cars: vec![1, 2], pads: true }, "everything at first");
        // At the same tick again: nothing due, nothing forced
        assert_eq!(r.choose_at(2, &cars, 0b11), Chosen::default());
        // A touch: the ball; a pad taken: the pads; a jump by the ball: that car alone
        r.observe(Some(2), 0, &watched(true, CarNetInfo { jumped: 1, ..STILL }));
        assert_eq!(r.choose_at(2, &cars, 0b01), Chosen { ball: true, cars: vec![1], pads: true });
        // The same touch again forces nothing
        r.observe(Some(2), 0, &watched(true, CarNetInfo { jumped: 1, ..STILL }));
        assert_eq!(r.choose_at(2, &cars, 0b01), Chosen::default());
        // The countdown's end: every car
        r.observe(Some(2), 1, &watched(true, CarNetInfo { jumped: 1, ..STILL }));
        r.observe(Some(2), 0, &watched(true, CarNetInfo { jumped: 1, ..STILL }));
        assert_eq!(r.choose_at(2, &cars, 0b01).cars, vec![1, 2]);
        // Due ones over 10 s of updates every other tick: the ball ≈ 35-40, a car ≈ 13.4 a second, the pads once a second
        let mut r = Replication::new(3);
        let (mut ball, mut car, mut pads) = (0, 0, 0);
        for tick in (2..=1202).step_by(2) {
            let c = r.choose_at(tick, &[1], 0);
            ball += usize::from(c.ball);
            car += usize::from(c.cars.contains(&1));
            pads += usize::from(c.pads);
        }
        assert!((350..=420).contains(&ball), "ball {ball} in 10 s");
        assert!((128..=140).contains(&car), "car {car} in 10 s");
        assert!((10..=12).contains(&pads), "pads {pads} in 10 s");
    }
}
