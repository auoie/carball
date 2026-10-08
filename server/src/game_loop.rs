//! The game loop thread: drains network messages and runs the match at a fixed 120 Hz.

use std::time::{Duration, Instant};

use tokio::sync::mpsc::UnboundedReceiver;

use crate::game::{Game, TICK_RATE};
use crate::net::ToGame;

/// At most this many ticks to catch up after a stall; beyond that, time is dropped
const MAX_CATCH_UP_TICKS: u32 = 5;

pub fn run(mut messages: UnboundedReceiver<ToGame>, team_size: u8) {
    let tick_length = Duration::from_secs(1) / TICK_RATE;
    let start = Instant::now();
    let seconds = |at: Instant| at.saturating_duration_since(start).as_secs_f64();
    // (each server run its own kickoff orders, as the game's are random)
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.subsec_nanos() as i32);
    let mut game = Game::with_options(seed, team_size);
    let mut next_tick = start;
    loop {
        loop {
            match messages.try_recv() {
                Ok(ToGame::Join { id, request, out }) => game.join(id, request, out),
                Ok(ToGame::Leave { id }) => game.leave(id),
                Ok(ToGame::Inputs { id, timestamp, first_frame, frames, at }) => {
                    game.receive_inputs(id, timestamp, first_frame, &frames, seconds(at));
                }
                Ok(ToGame::ResetInputBuffer { id }) => game.reset_input_buffer(id, seconds(Instant::now())),
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => return,
            }
        }
        let now = Instant::now();
        if now < next_tick {
            std::thread::sleep((next_tick - now).min(Duration::from_millis(1)));
            continue;
        }
        let mut ticks = 0;
        while next_tick <= Instant::now() && ticks < MAX_CATCH_UP_TICKS {
            game.tick(seconds(next_tick));
            next_tick += tick_length;
            ticks += 1;
        }
        if ticks == MAX_CATCH_UP_TICKS && next_tick < Instant::now() {
            next_tick = Instant::now();
        }
    }
}
