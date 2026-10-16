//! A player's input buffer on the server, as the game does it by default (`NetworkInputBuffer_ServerConsume_TA`)
//! with its jitter buffer (`ClientJitterBuffer_TA`). See `notes/netcode.md`.
//!
//! One deliberate difference: the game counts `LastProcessedFrame` up from 0 from the moment the player joins, even
//! before any input arrives; we start counting at the first input frame, so early acknowledgements are meaningful.

use std::collections::VecDeque;

use crate::engine::Controls;
use crate::protocol::InputFrame;

/// Physics ticks per second (`EngineShare_TA.PhysicsFramerate`)
pub const TICK_RATE: f32 = 120.0;

/// `NetworkJitterSettings_TA`
const MIN_TIME_BETWEEN_PACKETS: f32 = 0.016;
const MAX_TIME_BETWEEN_PACKETS: f32 = 0.25;
const BUFFER_STD_DEVIATIONS: f32 = 4.0;
const MIN_BUFFER_TIME: f32 = 0.05;
const ROLLING_AVERAGE_TIME: f32 = 15.0;

/// At most half a second of inputs is kept (`TrimInputFrames`)
const MAX_BUFFERED_FRAMES: usize = (TICK_RATE * 0.5) as usize;
/// No packet for this long: the car gets zero input (`FUN_140eb31f0`)
const INPUT_TIMEOUT: f64 = 1.0;

/// How many frames of inputs to hold back, from how regularly packets arrive (`ClientJitterBuffer_TA`).
#[derive(Clone, Debug)]
pub struct JitterBuffer {
    last_packet_time: Option<f64>,
    mean: f32,
    variance: f32,
    pub buffer_time: f32,
    pub buffer_size: u32,
}

impl Default for JitterBuffer {
    fn default() -> Self {
        Self { last_packet_time: None, mean: 0.016, variance: 0.0, buffer_time: 0.0, buffer_size: 7 }
    }
}

impl JitterBuffer {
    /// Back to the initial estimate (`JitterBuffer.Reset`: mean 0.016 s, variance 0, size 7), keeping the time of the
    /// last packet. After a client hitch (`ServerResetInputBuffer`): one long gap would otherwise keep the buffer large
    /// for tens of seconds (a 300 ms gap: size 18, still 9 after 30 s)
    pub fn reset(&mut self) {
        *self = Self { last_packet_time: self.last_packet_time, ..Self::default() };
    }

    pub fn received_packet(&mut self, now: f64) {
        if let Some(last) = self.last_packet_time {
            let gap = ((now - last) as f32).clamp(MIN_TIME_BETWEEN_PACKETS, MAX_TIME_BETWEEN_PACKETS);
            let rate = (gap / ROLLING_AVERAGE_TIME).min(1.0);
            self.mean += (gap - self.mean) * rate;
            let jitter = gap - self.mean;
            self.variance += (jitter * jitter - self.variance) * rate;
            self.buffer_time = (self.mean + self.variance.sqrt() * BUFFER_STD_DEVIATIONS).max(MIN_BUFFER_TIME);
            self.buffer_size = (self.buffer_time / (1.0 / TICK_RATE)).ceil() as u32 + 1;
        }
        self.last_packet_time = Some(now);
    }
}

/// What the buffer did, counted (the network tests' measures: notes/netcode-live.md §13)
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    /// Ticks that consumed two frames (over the jitter target)
    pub over_buffer_frames: u32,
    /// Ticks with no frame to consume
    pub under_buffer_frames: u32,
    /// ... of those, the last input repeated / zeroed (no packet for a second)
    pub repeated: u32,
    pub zeroed: u32,
    /// Ticks the refill skipped (odd ticks while filling)
    pub fill_skips: u32,
    /// Frames dropped: over the half second kept, at or before the last consumed, already buffered
    pub trimmed: u32,
    pub late_dropped: u32,
    pub duplicates: u32,
    /// Frames consumed, and frames passed over for good (a gap between two consumed: never received in time)
    pub consumed: u32,
    pub never_consumed: u32,
}

/// Since the last update sent (the stat graphs' IBuf rows and Out Loss, HUD-21: the game's InputBufferStats in each
/// ClientAckFrame): the queue's fewest and most frames after a tick, the ticks it skipped a frame (over) and had none
/// (under), the client's datagrams lost on the way (its sequence's gaps: protocol 24)
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BufferWindow {
    pub low: u8,
    pub high: u8,
    pub over: u8,
    pub under: u8,
    pub lost: u8,
    /// A tick sampled the queue in it
    seen: bool,
}

#[derive(Clone, Debug, Default)]
pub struct InputBuffer {
    /// Received, not yet consumed; sorted by frame, no duplicates
    frames: VecDeque<(u32, InputFrame)>,
    /// The frame the server's state corresponds to for this player (`LastProcessedFrame`); acknowledged in updates
    last_processed_frame: Option<u32>,
    /// The last frame actually consumed (`LastProcessedReceivedFrame`): older frames are dropped
    last_consumed_frame: u32,
    /// Highest frame received so far
    pub last_received_frame: u32,
    last_packet_time: f64,
    newest_timestamp: Option<u32>,
    filling: bool,
    pub jitter: JitterBuffer,
    /// The controls the car currently drives with (repeated when no frame is available)
    pub controls: Controls,
    /// The car had jump held and this tick released it and pressed it again (in two frames consumed together, or a
    /// tap's release left over from the last tick): the car must see a fresh press though jump reads held
    /// (`Arena::repress_jump`: NET-2)
    pub repress_jump: bool,
    /// The jump the car was given last tick (a tap's press though its frame released it: RV-216)
    given_jump: bool,
    /// This tick's jump press came in the first of two frames consumed together: its axes (the dodge's forward input,
    /// yaw, roll), the dodge's direction in the game, where the car drives with the second's (G10)
    pub press_axes: Option<(f32, f32, f32)>,
    /// A frame consumed this tick changed the inputs as the idle kick counts it (MM-35a), against `kick_inputs`
    pub acted: bool,
    /// The inputs the idle kick last counted (`PC.LastInputs`: zeroed at first, replaced only when a frame counts)
    kick_inputs: Controls,
    pub stats: Stats,
    /// The newest datagram sequence seen (protocol 24)
    last_sequence: Option<u16>,
    window: BufferWindow,
}

/// The idle kick's activity test (`VehicleInputHasChangedForKick`, 0x140f66fc0: notes/matchmaking.md MM-35a): a press or
/// release of jump, boost or handbrake; a throttle or pitch-stick change of 0.01 or more; steer or the yaw stick, only
/// while throttling (a byte step, about 0.008, never counts alone)
pub fn changed_for_kick(new: &Controls, old: &Controls) -> bool {
    const EPS: f32 = 0.01;
    let moved = |a: f32, b: f32| (a - b).abs() >= EPS;
    if (new.jump, new.boost, new.handbrake) != (old.jump, old.boost, old.handbrake) {
        return true;
    }
    if moved(new.throttle, old.throttle) || moved(new.dodge_forward, old.dodge_forward) {
        return true;
    }
    if new.throttle.abs() < EPS {
        return false;
    }
    moved(new.steer, old.steer) || moved(new.yaw, old.yaw)
}

impl InputBuffer {
    /// A datagram's sequence (protocol 24): a gap past the newest counts that many lost; a late or repeated one isn't
    /// counted, nor a jump of 1000 or more (a client starting its count again)
    pub fn note_sequence(&mut self, sequence: u16) {
        if let Some(last) = self.last_sequence {
            let gap = sequence.wrapping_sub(last) as i16;
            if gap <= 0 {
                return;
            }
            if (2..1000).contains(&gap) {
                self.window.lost = self.window.lost.saturating_add((gap - 1).min(255) as u8);
            }
        }
        self.last_sequence = Some(sequence);
    }

    /// The window since the last update (its queue now, if no tick sampled it), started again
    pub fn take_window(&mut self) -> BufferWindow {
        let queued = self.frames.len().min(255) as u8;
        let w = if self.window.seen { self.window } else { BufferWindow { low: queued, high: queued, ..self.window } };
        self.window = BufferWindow::default();
        w
    }

    pub fn ack_frame(&self) -> u32 {
        self.last_processed_frame.unwrap_or(0)
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// The last frame consumed (0: none yet)
    pub fn last_consumed(&self) -> u32 {
        self.last_consumed_frame
    }

    /// Refilling after running dry (frames consumed only on even ticks until the buffer reaches its target)
    pub fn filling(&self) -> bool {
        self.filling
    }

    /// A packet of consecutive frames starting at `first_frame` (`ReceiveClientPacket`).
    /// Returns whether it was the newest packet so far (its timestamp is then the one to echo).
    pub fn receive(&mut self, timestamp: u32, first_frame: u32, frames: &[InputFrame], now: f64) -> bool {
        let newest = self.newest_timestamp.is_none_or(|t| timestamp.wrapping_sub(t) as i32 > 0);
        if newest {
            // ReceiveNewClientPacket (ServerConsume): before the packet's frames are merged
            self.newest_timestamp = Some(timestamp);
            self.last_packet_time = now;
            self.jitter.received_packet(now);
            if self.filling && self.frames.len() >= self.jitter.buffer_size as usize {
                self.filling = false;
            }
        }
        // ReceiveClientFrames: merge in frame order, then trim
        for (i, frame) in frames.iter().enumerate() {
            let number = first_frame.wrapping_add(i as u32);
            self.last_received_frame = self.last_received_frame.max(number);
            if self.last_processed_frame.is_some() && number <= self.last_consumed_frame {
                self.stats.late_dropped = self.stats.late_dropped.saturating_add(1);
                continue;
            }
            match self.frames.binary_search_by_key(&number, |(n, _)| *n) {
                Ok(_) => self.stats.duplicates = self.stats.duplicates.saturating_add(1),
                Err(at) => self.frames.insert(at, (number, *frame)),
            }
        }
        while self.frames.len() > MAX_BUFFERED_FRAMES {
            self.frames.pop_front();
            self.stats.trimmed = self.stats.trimmed.saturating_add(1);
        }
        newest
    }

    fn consume_one(&mut self) {
        if let Some((number, frame)) = self.frames.pop_front() {
            if self.stats.consumed > 0 && number > self.last_consumed_frame.wrapping_add(1) {
                self.stats.never_consumed = self.stats.never_consumed.saturating_add(number - self.last_consumed_frame - 1);
            }
            self.stats.consumed = self.stats.consumed.saturating_add(1);
            self.controls = frame.controls();
            if changed_for_kick(&self.controls, &self.kick_inputs) {
                self.kick_inputs = self.controls;
                self.acted = true;
            }
            self.last_processed_frame = Some(number);
            self.last_consumed_frame = number;
        }
    }

    fn skip_one(&mut self) {
        if let Some(n) = self.last_processed_frame.as_mut() {
            *n = n.wrapping_add(1);
        }
    }

    /// One server physics tick (`NetworkInputBuffer_ServerConsume_TA`, `FUN_140f1e780`). `odd_tick`: the server's
    /// physics frame number is odd (while refilling, frames are consumed only on even ticks).
    ///
    /// Two frames consumed in one tick (over the jitter target): the game fires SetVehicleInput for each, so the first
    /// one's jump edges still count though its axes, boost and handbrake give way to the second's (NET-2): a press in the
    /// first released in the second still jumps this tick (released the next), and a release in the first pressed again
    /// in the second is a fresh press (`repress_jump`). The edges are the car's: after a tap's jump, its release comes
    /// first the next tick, so a press then is fresh too, a held press as well as another tap (RV-216). A press in the
    /// first frame dodges by its axes (`press_axes`: the game's SetVehicleInput of the first frame starts the dodge, G10).
    pub fn tick(&mut self, now: f64, odd_tick: bool) -> Controls {
        self.repress_jump = false;
        self.press_axes = None;
        self.acted = false;
        let previous = self.controls.jump != 0; // (the last frame consumed)
        let mut first = None;
        let mut first_controls = self.controls;
        let mut second = false;
        if self.frames.is_empty() {
            if now - self.last_packet_time > INPUT_TIMEOUT {
                self.controls = Controls::default();
                self.stats.zeroed = self.stats.zeroed.saturating_add(1);
            } else {
                self.stats.repeated = self.stats.repeated.saturating_add(1);
            }
            self.filling = true;
            self.skip_one();
            self.stats.under_buffer_frames = self.stats.under_buffer_frames.saturating_add(1);
            self.window.under = self.window.under.saturating_add(1);
        } else {
            if !self.filling || !odd_tick {
                self.consume_one();
                first = Some(self.controls.jump != 0);
                first_controls = self.controls;
            } else {
                self.skip_one();
                self.stats.fill_skips = self.stats.fill_skips.saturating_add(1);
            }
            if (self.jitter.buffer_size as usize) < self.frames.len() {
                self.consume_one();
                self.stats.over_buffer_frames = self.stats.over_buffer_frames.saturating_add(1);
                self.window.over = self.window.over.saturating_add(1);
                second = true;
            }
        }
        let queued = self.frames.len().min(255) as u8;
        let w = &mut self.window;
        (w.low, w.high) = if w.seen { (w.low.min(queued), w.high.max(queued)) } else { (queued, queued) };
        w.seen = true;
        let last = self.controls.jump != 0;
        // The jump the car gets, and whether a release came before its press this tick
        let (jump, released) = match first {
            None if !second => (last, false), // (no frame: as it was, or a tap's release now)
            Some(a) if second && !previous && a && !last => (true, true), // (a tap: it still jumps)
            Some(a) if second => (last, !previous || !a),
            _ => (last, !previous),
        };
        self.repress_jump = jump && released && self.given_jump;
        self.given_jump = jump;
        if second && first == Some(true) && !previous {
            self.press_axes = Some((first_controls.dodge_forward, first_controls.yaw, first_controls.roll));
        }
        Controls { jump: u8::from(jump), ..self.controls }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(throttle: i8) -> InputFrame {
        InputFrame { throttle, ..InputFrame::default() }
    }

    #[test]
    fn the_datagrams_lost_from_their_sequence_and_the_window_since_the_last_update() {
        // (protocol 24, the stat graphs' Out Loss and IBuf rows: HUD-21)
        let mut b = InputBuffer::default();
        b.note_sequence(10);
        b.note_sequence(11);
        b.note_sequence(14); // (12 and 13 lost)
        b.note_sequence(13); // (late: not counted again)
        b.note_sequence(5000); // (a jump of 1000 or more: a count started again, not loss)
        assert_eq!(b.take_window().lost, 2);
        b.note_sequence(5001);
        assert_eq!(b.take_window().lost, 0);
        // (across the wrap: 65534, then 1, 65535 and 0 lost)
        let mut b = InputBuffer::default();
        b.note_sequence(65534);
        b.note_sequence(1);
        assert_eq!(b.take_window().lost, 2);
        // The queue's fewest and most frames after each tick, the ticks over and under
        let mut b = InputBuffer::default();
        b.receive(1, 1, &[frame(1); 3], 0.0);
        let mut t = 0.0;
        for _ in 0..3 {
            t += 1.0 / 120.0;
            b.tick(t, false);
        }
        t += 1.0 / 120.0;
        b.tick(t, false); // (none left: under)
        let w = b.take_window();
        assert_eq!((w.low, w.under), (0, 1));
        assert!(w.high >= 1, "{w:?}");
        b.receive(2, 4, &[frame(1); 20], t);
        t += 1.0 / 120.0;
        b.tick(t, false); // (over the target: two consumed, one over)
        let w = b.take_window();
        assert_eq!(w.over, 1);
        assert!(w.low >= 10 && w.high == w.low, "{w:?}");
        // (no tick since: the queue as it is)
        let w = b.take_window();
        assert_eq!((w.low, w.high, w.over, w.under, w.lost), (b.len() as u8, b.len() as u8, 0, 0, 0));
    }

    #[test]
    fn its_counters_stay_at_their_top_under_a_flood() {
        // (SEC-7: a client's packets drive them; a debug build panics on an overflow, so they saturate; RV-324. The same
        // packets from zero drive every counter, RV-344)
        let flood = |b: &mut InputBuffer| {
            b.receive(1, 1, &[frame(1); 70], 0.0); // (over the 60 kept: trimmed)
            b.receive(2, 70, &[frame(1)], 0.0); // (a duplicate: frame 70 still buffered)
            for t in 0..200 {
                b.tick(f64::from(t) / 120.0, t % 2 == 1);
            }
            b.receive(3, 1, &[frame(1)], 1.7); // (late)
            b.receive(4, 100, &[frame(1); 4], 1.7); // (after running dry: refilling, odd ticks skip)
            b.tick(1.71, true);
            b.receive(5, 120, &[frame(1)], 1.72); // (a gap: frames 104..119 never come)
            for t in 0..10 {
                b.tick(1.72 + f64::from(t) / 120.0, false);
            }
            b.receive(6, 200, &[frame(1); 20], 1.9); // (more than the target: two a tick)
            b.tick(1.91, false);
            b.tick(3.5, false); // (no packet for over a second: zeroed)
            b.tick(3.6, false);
        };
        let mut fresh = InputBuffer::default();
        flood(&mut fresh);
        let s = fresh.stats;
        for (name, count) in [
            ("over_buffer_frames", s.over_buffer_frames),
            ("under_buffer_frames", s.under_buffer_frames),
            ("repeated", s.repeated),
            ("zeroed", s.zeroed),
            ("fill_skips", s.fill_skips),
            ("trimmed", s.trimmed),
            ("late_dropped", s.late_dropped),
            ("duplicates", s.duplicates),
            ("consumed", s.consumed),
            ("never_consumed", s.never_consumed),
        ] {
            assert!(count > 0, "{name} not driven: {s:?}");
        }
        let top = Stats {
            over_buffer_frames: u32::MAX,
            under_buffer_frames: u32::MAX,
            repeated: u32::MAX,
            zeroed: u32::MAX,
            fill_skips: u32::MAX,
            trimmed: u32::MAX,
            late_dropped: u32::MAX,
            duplicates: u32::MAX,
            consumed: u32::MAX,
            never_consumed: u32::MAX,
        };
        let mut b = InputBuffer { stats: top, ..InputBuffer::default() };
        flood(&mut b);
        assert_eq!(b.stats, top);
    }

    #[test]
    fn a_press_in_the_first_of_two_frames_dodges_by_its_axes() {
        // (G10: the first frame pressed jump with a forward dodge, the second holds it pushing sideways; the car drives
        // with the second, its dodge goes forward)
        let mut b = InputBuffer::default();
        let a = InputFrame { dodge_forward: 127, pitch: -127, bits: crate::protocol::BIT_JUMP, ..InputFrame::default() };
        let held = InputFrame { yaw: 127, bits: crate::protocol::BIT_JUMP, ..InputFrame::default() };
        let mut frames = vec![a, held];
        frames.extend(vec![InputFrame::default(); 7]);
        b.receive(1, 1, &frames, 0.0);
        let controls = b.tick(0.0, false);
        assert_eq!(b.stats.over_buffer_frames, 1, "two frames consumed");
        assert_eq!(controls.yaw, 1.0, "the second's axes drive");
        assert_eq!(b.press_axes, Some((1.0, 0.0, 0.0)), "the first's dodge");
        // Not without a press in the first frame
        b.tick(0.0, false);
        assert_eq!(b.press_axes, None);
    }

    #[test]
    fn a_hitch_reset_brings_the_buffer_back_at_once() {
        let mut j = JitterBuffer::default();
        for i in 0..=600 {
            j.received_packet(f64::from(i) / 60.0);
        }
        // One 300 ms gap: the buffer grows, and stays large for tens of seconds of regular packets
        let mut t = 10.0 + 0.3;
        j.received_packet(t);
        assert!(j.buffer_size >= 15, "size after the gap {}", j.buffer_size);
        for _ in 0..(30 * 60) {
            t += 1.0 / 60.0;
            j.received_packet(t);
        }
        assert!(j.buffer_size > 7, "size 30 s later {}", j.buffer_size);
        // The reset: the initial estimate, and the next packet's gap measured from the last one (not from 0)
        j.reset();
        assert_eq!(j.buffer_size, 7);
        j.received_packet(t + 1.0 / 60.0);
        assert_eq!(j.buffer_size, 7);
    }

    #[test]
    fn jitter_buffer_follows_the_game_formula() {
        let mut j = JitterBuffer::default();
        j.received_packet(0.0);
        assert_eq!(j.buffer_size, 7); // the default until a second packet
        // Perfectly regular 60 Hz packets: the buffer shrinks to the 0.05 s minimum = ceil(6) + 1 = 7 frames
        for i in 1..=2000 {
            j.received_packet(f64::from(i) / 60.0);
        }
        assert!((j.mean - 1.0 / 60.0).abs() < 1e-4, "mean {}", j.mean);
        assert_eq!(j.buffer_time, MIN_BUFFER_TIME);
        assert_eq!(j.buffer_size, 7);
        // Irregular packets (alternating 16 ms / 60 ms gaps): mean 38 ms, std 22 ms -> 0.126 s -> ceil(15.1) + 1 = 17
        // (gaps under 16 ms count as 16 ms, so faster bursts add no jitter)
        let mut t = 2000.0 / 60.0;
        for i in 0..4000 {
            t += if i % 2 == 0 { 0.016 } else { 0.060 };
            j.received_packet(t);
        }
        assert!((16..=18).contains(&j.buffer_size), "buffer {} frames ({} s)", j.buffer_size, j.buffer_time);
    }

    #[test]
    fn consumes_one_frame_per_tick_in_order() {
        let mut b = InputBuffer::default();
        b.receive(1, 10, &[frame(1), frame(2), frame(3)], 0.0);
        b.receive(2, 12, &[frame(3), frame(4)], 0.01); // overlap with the previous packet
        assert_eq!(b.len(), 4);
        let throttles: Vec<f32> = (0..4).map(|i| b.tick(0.02, i % 2 == 1).throttle).collect();
        assert_eq!(throttles, [1.0 / 127.0, 2.0 / 127.0, 3.0 / 127.0, 4.0 / 127.0]);
        assert_eq!(b.ack_frame(), 13);
    }

    #[test]
    fn repeats_the_last_input_when_empty_and_refills_at_half_rate() {
        let mut b = InputBuffer::default();
        b.receive(1, 1, &[frame(5)], 0.0);
        b.tick(0.0, false);
        assert_eq!(b.ack_frame(), 1);
        // Nothing buffered: same input, the acknowledged frame moves on
        assert_eq!(b.tick(0.01, true).throttle, 5.0 / 127.0);
        assert_eq!(b.ack_frame(), 2);
        assert_eq!(b.stats.under_buffer_frames, 1);
        // Frames arrive while refilling: consumed only on even ticks until the buffer reaches the target
        b.receive(2, 2, &[frame(6), frame(7), frame(8)], 0.02);
        b.tick(0.03, true);
        assert_eq!(b.len(), 3, "odd tick while refilling: nothing consumed");
        b.tick(0.04, false);
        assert_eq!(b.len(), 2, "even tick: one consumed");
    }

    #[test]
    fn catches_up_when_over_the_jitter_target() {
        let mut b = InputBuffer::default();
        let frames: Vec<InputFrame> = (0..10).map(frame).collect();
        b.receive(1, 1, &frames, 0.0);
        b.tick(0.0, false); // 10 buffered > 7: two consumed
        assert_eq!(b.len(), 8);
        assert_eq!(b.stats.over_buffer_frames, 1);
    }

    fn jump(on: bool) -> InputFrame {
        InputFrame { bits: if on { crate::protocol::BIT_JUMP } else { 0 }, ..InputFrame::default() }
    }

    #[test]
    fn a_jump_tap_survives_a_double_consume() {
        // A one-frame tap in the first of two frames consumed together: the tick still jumps, the next releases (NET-2)
        let mut b = InputBuffer::default();
        b.receive(1, 1, &[jump(false)], 0.0);
        b.tick(0.0, false);
        // (9 at once, over the target of 7: the tap's frame and the release's consumed together)
        let mut frames = vec![jump(true), jump(false)];
        frames.extend(vec![jump(false); 7]);
        b.receive(2, 2, &frames, 0.01);
        assert_eq!(b.tick(0.02, false).jump, 1, "the tap was lost");
        assert_eq!(b.stats.over_buffer_frames, 1);
        assert_eq!(b.tick(0.03, false).jump, 0, "released after the tap");
    }

    #[test]
    fn a_release_and_a_press_in_one_tick_are_a_fresh_press() {
        let mut b = InputBuffer::default();
        b.receive(1, 1, &[jump(true)], 0.0);
        b.tick(0.0, false);
        assert_eq!(b.controls.jump, 1);
        // (then 9 frames at once: the first two consumed together, a release then a press)
        let mut frames = vec![jump(false), jump(true)];
        frames.extend(vec![jump(true); 7]);
        b.receive(2, 2, &frames, 0.01);
        let out = b.tick(0.02, false);
        assert_eq!(out.jump, 1);
        assert!(b.repress_jump, "the release between the two frames was lost");
        b.tick(0.03, false);
        assert!(!b.repress_jump, "only for that tick");
    }

    #[test]
    fn a_press_the_tick_after_a_tap_is_a_fresh_press() {
        // J, 0 consumed together, then J held: the tap's release comes first the next tick, so its press is fresh (the
        // car otherwise holds one long jump where the game hops and presses again: RV-216)
        let mut b = InputBuffer::default();
        b.receive(1, 1, &[jump(false)], 0.0);
        b.tick(0.0, false);
        let mut frames = vec![jump(true), jump(false)];
        frames.extend(vec![jump(true); 7]);
        b.receive(2, 2, &frames, 0.01);
        assert_eq!(b.tick(0.02, false).jump, 1, "the tap");
        assert!(!b.repress_jump, "a press from released");
        assert_eq!(b.tick(0.03, false).jump, 1);
        assert!(b.repress_jump, "the release after the tap and this press");
        assert_eq!(b.tick(0.04, false).jump, 1);
        assert!(!b.repress_jump, "held");
    }

    #[test]
    fn two_taps_in_consecutive_double_consumes_are_two_presses() {
        let mut b = InputBuffer::default();
        b.receive(1, 1, &[jump(false)], 0.0);
        b.tick(0.0, false);
        let mut frames = vec![jump(true), jump(false), jump(true), jump(false)];
        frames.extend(vec![jump(false); 7]);
        b.receive(2, 2, &frames, 0.01);
        assert_eq!(b.tick(0.02, false).jump, 1);
        assert_eq!(b.tick(0.03, false).jump, 1);
        assert_eq!(b.stats.over_buffer_frames, 2, "two double consumes");
        assert!(b.repress_jump, "the second tap was lost");
        assert_eq!(b.tick(0.04, false).jump, 0, "released after it");
    }

    #[test]
    fn drops_old_frames_and_times_out() {
        let mut b = InputBuffer::default();
        b.receive(1, 5, &[frame(9)], 0.0);
        b.tick(0.0, false);
        b.receive(2, 3, &[frame(1), frame(2), frame(3)], 0.01); // all at or before frame 5: dropped
        assert_eq!(b.len(), 0);
        assert_eq!(b.tick(0.5, false).throttle, 9.0 / 127.0); // still repeating
        assert_eq!(b.tick(1.5, false).throttle, 0.0); // no packet for over a second: zero input
    }
}
