//! The game loop thread: drains network messages and runs the match at 120 ticks per game second: 120 Hz, but for the
//! slow motion after a goal (`Game::next_tick_seconds`).

use std::time::{Duration, Instant};

use tokio::sync::mpsc::UnboundedReceiver;

use crate::game::{Game, MatchType};
use crate::net::ToGame;

/// At most this many ticks to catch up after a stall; beyond that, time is dropped
const MAX_CATCH_UP_TICKS: u32 = 5;

/// `test_goal_after`: browser tests only (`Game::test_goal_after`)
/// The playlist: its team size, match type and forfeit vote wait (s; None: the match type's)
pub struct Playlist {
    pub team_size: u8,
    pub match_type: MatchType,
    pub forfeit_vote_wait: Option<f32>,
}

pub fn run(mut messages: UnboundedReceiver<ToGame>, playlist: Playlist, test_goal_after: Option<f32>) {
    let start = Instant::now();
    let seconds = |at: Instant| at.saturating_duration_since(start).as_secs_f64();
    // (each server run its own kickoff orders, as the game's are random)
    let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.subsec_nanos() as i32);
    let mut game = Game::with_options(seed, playlist.team_size);
    game.match_type = playlist.match_type;
    game.forfeit_vote_wait = playlist.forfeit_vote_wait.map(|s| (s * crate::game::TICK_RATE as f32) as u32);
    game.test_goal_after = test_goal_after.map(|s| (s * crate::game::TICK_RATE as f32) as u64);
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
                Ok(ToGame::ReadyUp { id }) => game.ready_up(id),
                Ok(ToGame::AutoSkipReplay { id, on }) => game.set_auto_skip_replay(id, on),
                Ok(ToGame::VoteForfeit { id }) => game.vote_forfeit(id),
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
            next_tick += Duration::from_secs_f64(game.next_tick_seconds());
            ticks += 1;
        }
        if ticks == MAX_CATCH_UP_TICKS && next_tick < Instant::now() {
            next_tick = Instant::now();
        }
    }
}
