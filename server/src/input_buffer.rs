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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub over_buffer_frames: u32,
    pub under_buffer_frames: u32,
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
    pub stats: Stats,
}

impl InputBuffer {
    pub fn ack_frame(&self) -> u32 {
        self.last_processed_frame.unwrap_or(0)
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
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
                continue;
            }
            match self.frames.binary_search_by_key(&number, |(n, _)| *n) {
                Ok(_) => {}
                Err(at) => self.frames.insert(at, (number, *frame)),
            }
        }
        while self.frames.len() > MAX_BUFFERED_FRAMES {
            self.frames.pop_front();
        }
        newest
    }

    fn consume_one(&mut self) {
        if let Some((number, frame)) = self.frames.pop_front() {
            self.controls = frame.controls();
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
    pub fn tick(&mut self, now: f64, odd_tick: bool) -> Controls {
        if self.frames.is_empty() {
            if now - self.last_packet_time > INPUT_TIMEOUT {
                self.controls = Controls::default();
            }
            self.filling = true;
            self.skip_one();
            self.stats.under_buffer_frames += 1;
        } else {
            if !self.filling || !odd_tick {
                self.consume_one();
            } else {
                self.skip_one();
            }
            if (self.jitter.buffer_size as usize) < self.frames.len() {
                self.consume_one();
                self.stats.over_buffer_frames += 1;
            }
        }
        self.controls
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(throttle: i8) -> InputFrame {
        InputFrame { throttle, ..InputFrame::default() }
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
