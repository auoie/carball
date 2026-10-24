//! The network tests' T2 (notes/netcode-live.md §13.1): the server's input buffer (ServerConsume and its jitter buffer)
//! fed by a model client through a simulated path, in virtual time, deterministic. The client: one input frame per new
//! physics tick (120 Hz of its own time), at 60/144/30 fps; a packet when the 60 Hz send clock is due (one per frame at
//! most) with the frames the server hasn't acknowledged, newest 10 at most (online.ts `#sendInputs`); 2 s after a frame
//! over 0.1 s, a reset request (`#watchHitches`). The server: a tick every 1/120 s consuming the buffer, an update with
//! the acknowledged frame every other tick. Measured: under, over, repeated, zeroed, the buffer's target and queue,
//! the ack lag, frames never consumed, jumps given; against §13's expected values.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::input_buffer::{InputBuffer, Stats};
use crate::netsim::{Jitter, Loss, NetSim, Profile, Stall};
use crate::protocol::{BIT_JUMP, InputFrame};

const TICK: f64 = 1.0 / 120.0;
const MAX_INPUT_FRAMES: u32 = 10;
const HITCH_SECONDS: f64 = 0.1;
const HITCH_RESET_DELAY: f64 = 2.0;

#[derive(Clone, Debug)]
pub struct Run {
    pub fps: f64,
    pub seconds: f64,
    pub up: Profile,
    pub down: Profile,
    /// Client frames this long at these times (a hitch)
    pub hitches: Vec<(f64, f64)>,
    /// Upstream packets sent in this window lost (an outage)
    pub outage: Option<(f64, f64)>,
    /// A one-tick jump tap this often (s)
    pub taps_every: Option<f64>,
    /// Ask for the server's reset after a hitch (the client does)
    pub hitch_reset: bool,
    pub seed: u64,
}

impl Run {
    pub fn new(fps: f64, seconds: f64, up: Profile) -> Self {
        Self {
            fps,
            seconds,
            up,
            down: Profile::constant(50.0),
            hitches: Vec::new(),
            outage: None,
            taps_every: None,
            hitch_reset: true,
            seed: 1,
        }
    }
}

/// One server tick's view
#[derive(Clone, Copy, Debug)]
pub struct TickSample {
    pub t: f64,
    pub target: u32,
    pub queue: usize,
    pub ack_lag: u32,
    pub stats: Stats,
    pub filling: bool,
    pub jump: bool,
    pub repress: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Outcome {
    pub ticks: Vec<TickSample>,
    /// When the client's jump taps were
    pub taps: Vec<f64>,
    pub resets: Vec<f64>,
    /// The frames consumed, in order
    pub consumed: Vec<u32>,
}

impl Outcome {
    /// The stats' growth between two times
    pub fn delta(&self, from: f64, to: f64) -> Stats {
        let at = |t: f64| self.ticks.iter().rev().find(|s| s.t <= t).map(|s| s.stats).unwrap_or_default();
        let (a, b) = (at(from), at(to));
        Stats {
            over_buffer_frames: b.over_buffer_frames - a.over_buffer_frames,
            under_buffer_frames: b.under_buffer_frames - a.under_buffer_frames,
            repeated: b.repeated - a.repeated,
            zeroed: b.zeroed - a.zeroed,
            fill_skips: b.fill_skips - a.fill_skips,
            trimmed: b.trimmed - a.trimmed,
            late_dropped: b.late_dropped - a.late_dropped,
            duplicates: b.duplicates - a.duplicates,
            consumed: b.consumed - a.consumed,
            never_consumed: b.never_consumed - a.never_consumed,
        }
    }

    pub fn samples(&self, from: f64, to: f64) -> impl Iterator<Item = &TickSample> {
        self.ticks.iter().filter(move |s| s.t >= from && s.t < to)
    }

    pub fn target_at(&self, t: f64) -> u32 {
        self.ticks.iter().rev().find(|s| s.t <= t).map_or(7, |s| s.target)
    }
}

#[derive(Debug)]
enum Kind {
    ClientFrame,
    Packet { timestamp: u32, first: u32, frames: Vec<InputFrame> },
    Ack(u32),
    Reset,
    ServerTick(u64),
}

#[derive(Debug)]
struct Event {
    t: f64,
    order: u64,
    kind: Kind,
}

impl PartialEq for Event {
    fn eq(&self, other: &Self) -> bool {
        self.t == other.t && self.order == other.order
    }
}
impl Eq for Event {}
impl PartialOrd for Event {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Event {
    // (a min-heap on time, then on the order pushed)
    fn cmp(&self, other: &Self) -> Ordering {
        other.t.total_cmp(&self.t).then(other.order.cmp(&self.order))
    }
}

pub fn simulate(run: &Run) -> Outcome {
    let mut up = NetSim::new(run.up.clone(), run.seed);
    let mut down = NetSim::new(run.down.clone(), run.seed + 1000);
    let mut events = BinaryHeap::new();
    let mut order = 0u64;
    let mut push = |events: &mut BinaryHeap<Event>, t: f64, kind: Kind| {
        order += 1;
        events.push(Event { t, order, kind });
    };
    push(&mut events, 0.0, Kind::ClientFrame);
    push(&mut events, TICK * 0.5, Kind::ServerTick(0));

    // The client
    let mut frame_time = 0.0f64;
    let mut tick_clock = 0.0f64;
    let mut newest_frame = 0u32; // (frames numbered from 1)
    let mut inputs: Vec<InputFrame> = vec![InputFrame::default()];
    let mut send_since = 0.0f64;
    let mut ack = 0u32;
    let mut hitch_reset: Option<f64> = None;
    let mut next_tap = run.taps_every;
    let mut taps = Vec::new();
    // The server
    let mut buffer = InputBuffer::default();
    let mut out = Outcome::default();
    let mut consumed_count = 0u32;

    while let Some(event) = events.pop() {
        if event.t > run.seconds {
            break;
        }
        let t = event.t;
        match event.kind {
            Kind::ClientFrame => {
                let dt = run
                    .hitches
                    .iter()
                    .find(|(at, _)| (*at - t).abs() < 0.5 / run.fps)
                    .map_or(1.0 / run.fps, |&(_, len)| len);
                let since = t - frame_time;
                frame_time = t;
                // (the hitch watch, as the client's)
                if since > HITCH_SECONDS {
                    hitch_reset = Some(HITCH_RESET_DELAY);
                } else if let Some(left) = hitch_reset.as_mut() {
                    *left -= since;
                    if *left <= 0.0 {
                        hitch_reset = None;
                        if run.hitch_reset {
                            let at = down.send(t).first().copied().unwrap_or(t + 0.05); // (on the reliable stream: always arrives)
                            push(&mut events, at, Kind::Reset);
                        }
                    }
                }
                // New ticks: one input frame each
                tick_clock += since;
                while tick_clock >= TICK {
                    tick_clock -= TICK;
                    newest_frame += 1;
                    // (a throttle that varies, for the traces' checks)
                    let mut frame =
                        InputFrame { throttle: ((newest_frame % 200) as i32 - 100) as i8, ..InputFrame::default() };
                    if let Some(at) = next_tap
                        && t >= at
                    {
                        frame.bits = BIT_JUMP;
                        taps.push(t);
                        next_tap = Some(at + run.taps_every.unwrap_or(1.0));
                    }
                    inputs.push(frame);
                }
                // The send clock (60 Hz, one packet a frame at most)
                send_since += since;
                if send_since >= 1.0 / 60.0 {
                    send_since = (send_since - 1.0 / 60.0).clamp(0.0, 1.0 / 60.0);
                    let first = (ack + 1).max(newest_frame.saturating_sub(MAX_INPUT_FRAMES - 1)).max(1);
                    if first <= newest_frame {
                        let frames = inputs[first as usize..=newest_frame as usize].to_vec();
                        let lost = run.outage.is_some_and(|(at, len)| t >= at && t < at + len);
                        for arrive in if lost { Vec::new() } else { up.send(t) } {
                            push(
                                &mut events,
                                arrive,
                                Kind::Packet { timestamp: (t * 1000.0).round() as u32, first, frames: frames.clone() },
                            );
                        }
                    }
                }
                push(&mut events, t + dt, Kind::ClientFrame);
            }
            Kind::Packet { timestamp, first, frames } => {
                buffer.receive(timestamp, first, &frames, t);
            }
            // (the highest seen, as the client keeps it: online.ts `#applyUpdate`)
            Kind::Ack(frame) => ack = ack.max(frame),
            Kind::Reset => {
                buffer.jitter.reset();
                out.resets.push(t);
            }
            Kind::ServerTick(n) => {
                // (tick n runs frame n + 1: the parity the game's consumes see, counted before them, RV-1032)
                let controls = buffer.tick(t, (n + 1) % 2 == 1);
                if buffer.stats.consumed > consumed_count {
                    consumed_count = buffer.stats.consumed;
                    out.consumed.push(buffer.last_consumed());
                }
                out.ticks.push(TickSample {
                    t,
                    target: buffer.jitter.buffer_size,
                    queue: buffer.len(),
                    ack_lag: buffer.last_received_frame.saturating_sub(buffer.ack_frame()),
                    stats: buffer.stats,
                    filling: buffer.filling(),
                    jump: controls.jump != 0,
                    repress: buffer.repress_jump,
                });
                if n % 2 == 0 {
                    let ack_frame = buffer.ack_frame();
                    for arrive in down.send(t) {
                        push(&mut events, arrive, Kind::Ack(ack_frame));
                    }
                }
                push(&mut events, t + TICK, Kind::ServerTick(n + 1));
            }
        }
    }
    out.taps = taps;
    out
}

fn per_minute(count: u32, seconds: f64) -> f64 {
    f64::from(count) * 60.0 / seconds
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normal(sigma_ms: f64) -> Profile {
        Profile { jitter: Jitter::Normal { sigma_ms }, ..Profile::constant(50.0) }
    }

    #[test]
    fn t2a_a_steady_path_keeps_the_buffer_at_its_floor() {
        // (a) 50 ms constant, no loss, 60 fps: after 2 s, under = over = 0 for 60 s, target 7, queue 5–9, ack lag 7 ± 2
        let out = simulate(&Run::new(60.0, 62.0, Profile::constant(50.0)));
        let d = out.delta(2.0, 62.0);
        assert_eq!((d.under_buffer_frames, d.over_buffer_frames), (0, 0), "{d:?}");
        assert!(out.samples(2.0, 62.0).all(|s| s.target == 7));
        let (qmin, qmax) = out.samples(2.0, 62.0).fold((usize::MAX, 0), |(a, b), s| (a.min(s.queue), b.max(s.queue)));
        assert!(qmin >= 5 && qmax <= 9, "queue {qmin}..{qmax}");
        let lag: Vec<u32> = out.samples(2.0, 62.0).map(|s| s.ack_lag).collect();
        let mean = f64::from(lag.iter().sum::<u32>()) / lag.len() as f64;
        assert!((mean - 7.0).abs() <= 2.0, "ack lag {mean}");
    }

    #[test]
    fn t2b_fast_and_slow_clients_keep_it_there_too() {
        // (b) 144 and 30 fps clients: target 7, under = over = 0. At 30 fps only once the jitter estimate has taken the
        // 33 ms gaps in: it starts at 16 ms and averages over 15 s, so for the first ~20 s the target sits at 9-12 and the
        // buffer swings between the refill's skips and double consumes (about 40 a second each); from ~30 s, 7 and quiet.
        // The game's own (NL1: the same jitter update, fill exit before the merge, over-consume every tick)
        let fast = simulate(&Run::new(144.0, 62.0, Profile::constant(50.0)));
        let d = fast.delta(2.0, 62.0);
        assert_eq!((d.under_buffer_frames, d.over_buffer_frames), (0, 0), "144 fps: {d:?}");
        assert!(fast.samples(2.0, 62.0).all(|s| s.target == 7), "144 fps");
        let slow = simulate(&Run::new(30.0, 105.0, Profile::constant(50.0)));
        let warm = slow.delta(0.0, 20.0);
        assert!(warm.over_buffer_frames > 500 && warm.fill_skips > 500, "30 fps warm-up: {warm:?}");
        let d = slow.delta(45.0, 105.0);
        assert_eq!((d.under_buffer_frames, d.over_buffer_frames, d.fill_skips), (0, 0, 0), "30 fps: {d:?}");
        assert!(slow.samples(45.0, 105.0).all(|s| s.target == 7), "30 fps");
    }

    #[test]
    fn t2c_jitter_grows_the_buffer_by_the_game_s_formula() {
        // (c) i.i.d. jitter: the target these seeded paths give, exactly (RV-1031: not a reference buffer fed the same
        // arrivals, which shares its code); ≈ 7 / 8 / 13 ± 2 by the game's formula; under ≤ 1 a minute after a 30 s
        // warm-up for σ ≤ 10 ms
        for (sigma, exact, expected) in [(5.0, 7u32, 7u32), (10.0, 9, 8), (20.0, 14, 13)] {
            let out = simulate(&Run::new(60.0, 120.0, normal(sigma)));
            let target = out.target_at(119.9);
            assert_eq!(target, exact, "σ {sigma}");
            assert!(target.abs_diff(expected) <= 2, "σ {sigma}: target {target}, expected ≈ {expected}");
            if sigma <= 10.0 {
                let under = out.delta(30.0, 120.0).under_buffer_frames;
                assert!(per_minute(under, 90.0) <= 1.0, "σ {sigma}: under {under} in 90 s");
            }
        }
    }

    #[test]
    fn t2d_a_stall_grows_it_at_once_and_it_comes_back() {
        // (d) a 150 ms stall: 7 → 11 at once, ≈ 13 repeated ticks, then over ≈ 10–14, back to 7 in ≈ 25–30 s, no reset
        let mut run = Run::new(60.0, 60.0, Profile::constant(50.0));
        run.up.stalls = vec![Stall { at_s: 10.0, ms: 150.0, every_s: 0.0 }];
        let out = simulate(&run);
        let before = out.target_at(10.0);
        let after = out.samples(10.0, 11.0).map(|s| s.target).max().unwrap_or(0);
        assert_eq!(before, 7);
        assert!((10..=12).contains(&after), "after the stall {after}");
        let d = out.delta(10.0, 11.0);
        assert!((10..=16).contains(&d.repeated), "repeated {}", d.repeated);
        // (10: every frame held back by the stall arrives at once and is still newer than the last consumed (skips move
        // LastProcessedFrame, not LastProcessedReceivedFrame), the queue then ~25 over a target of 11: the game's too, NL1)
        let over = out.delta(10.0, 20.0).over_buffer_frames;
        assert!((10..=14).contains(&over), "over {over}");
        let back = out.samples(10.5, 60.0).find(|s| s.target == 7).map(|s| s.t - 10.0);
        assert!(back.is_some_and(|b| (15.0..=40.0).contains(&b)), "back to 7 after {back:?} s");
        assert!(out.resets.is_empty());
    }

    #[test]
    fn t2e_loss_costs_no_frame_at_60_fps() {
        // (e) i.i.d. loss 1 / 5 %: never consumed 0 at 60 fps (each frame rides in ≥ 2 packets); at 30 fps ≈ 0.36 / 9.5 a
        // minute; target 7; under ≈ 0 / ≤ 1 a minute
        for p in [0.01, 0.05] {
            let mut run = Run::new(60.0, 122.0, Profile { loss: Loss::Iid { p }, ..Profile::constant(50.0) });
            run.seed = 5;
            let out = simulate(&run);
            let d = out.delta(2.0, 122.0);
            assert_eq!(d.never_consumed, 0, "60 fps, {p}");
            assert!(out.samples(2.0, 122.0).all(|s| s.target == 7), "60 fps, {p}");
            assert!(per_minute(d.under_buffer_frames, 120.0) <= 1.0, "60 fps, {p}: under {}", d.under_buffer_frames);
        }
        for (p, expected) in [(0.01, 0.36), (0.05, 9.5)] {
            let mut run = Run::new(30.0, 602.0, Profile { loss: Loss::Iid { p }, ..Profile::constant(50.0) });
            run.seed = 9;
            let out = simulate(&run);
            let lost = per_minute(out.delta(2.0, 602.0).never_consumed, 600.0);
            assert!(
                (lost - expected).abs() <= expected.max(0.5) * 0.6,
                "30 fps, {p}: {lost} a minute, expected ≈ {expected}"
            );
        }
    }

    #[test]
    fn t2f_reordering_and_duplicates_change_nothing_consumed() {
        // (f) reordering (from jitter) and 5 % duplicates: frames consumed in order, none twice or passed over; the jitter
        // buffer sampled on newer timestamps only
        let mut run = Run::new(
            60.0,
            62.0,
            Profile { jitter: Jitter::Normal { sigma_ms: 12.0 }, duplicate: 0.05, ..Profile::constant(50.0) },
        );
        run.seed = 3;
        let out = simulate(&run);
        assert!(out.consumed.windows(2).all(|w| w[1] > w[0]), "consumed out of order");
        let d = out.delta(0.0, 62.0);
        assert_eq!(d.never_consumed, 0);
        assert!(d.duplicates > 0);
        assert_eq!(out.target_at(61.9), 10, "the seeded path's target (RV-1031)");
    }

    #[test]
    fn t2g_a_client_hitch_is_reset_two_seconds_later() {
        // (g) a 300 ms client hitch: target 18; the reset 2 s later brings it to 7 at the next packet; without it, still
        // over 7 30 s later
        let mut run = Run::new(60.0, 45.0, Profile::constant(50.0));
        run.hitches = vec![(10.0, 0.3)];
        let out = simulate(&run);
        let peak = out.samples(10.0, 11.0).map(|s| s.target).max().unwrap_or(0);
        assert!((16..=19).contains(&peak), "after the hitch {peak}");
        assert_eq!(out.resets.len(), 1);
        let reset = out.resets[0];
        assert!((reset - 12.3).abs() < 0.2, "reset at {reset}");
        assert_eq!(out.target_at(reset + 0.05), 7);
        run.hitch_reset = false;
        let without = simulate(&run);
        assert!(without.target_at(42.0) > 7, "without the reset {}", without.target_at(42.0));
    }

    #[test]
    fn t2h_an_outage_repeats_a_second_then_zeroes_then_refills() {
        // (h) a 1.2 s upstream outage: the timeout counts from the last packet's arrival, repeats start when the queue's
        // ~7 frames run out: 112 ± 3 repeated ticks (the game's, NL1), the rest zeroed; then the refill
        let mut run = Run::new(60.0, 20.0, Profile::constant(50.0));
        run.outage = Some((10.0, 1.2));
        let out = simulate(&run);
        let d = out.delta(10.0, 11.4);
        assert!(d.repeated.abs_diff(112) <= 3, "repeated {}", d.repeated);
        assert!((15..=40).contains(&d.zeroed), "zeroed {}", d.zeroed);
        assert!(out.samples(11.2, 11.5).any(|s| s.filling), "no refill");
    }

    #[test]
    fn t2i_one_tick_jump_taps_all_jump() {
        // (i) one-tick jump taps under σ = 20 ms: the server jumps once a tap (NET-2: a tap in a double consume still
        // jumps)
        let mut run = Run::new(60.0, 62.0, normal(20.0));
        run.taps_every = Some(0.37);
        run.seed = 4;
        let out = simulate(&run);
        // (counted to a cut between two taps: after the last counted tap's jump, before the next one's can come)
        let last = out.taps.iter().copied().filter(|&t| t < 61.0).fold(0.0, f64::max);
        let cut = last + 0.28;
        let taps = out.taps.iter().filter(|&&t| t <= last).count() as u32;
        let mut jumps = 0u32;
        let mut was = false;
        for s in out.samples(0.0, cut) {
            if (s.jump && !was) || s.repress {
                jumps += 1;
            }
            was = s.jump;
        }
        assert_eq!(jumps, taps, "{jumps} jumps for {taps} taps");
    }
}
