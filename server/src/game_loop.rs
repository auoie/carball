//! The game loop thread: drains network messages, forms matches from the queue, and runs every match at 120 ticks per game
//! second: 120 Hz, but for the slow motion after a goal (`Game::next_tick_seconds`), each match on its own clock.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::mpsc::{Receiver, Sender};

use crate::game::Outgoing;
use crate::match_host::{MatchHost, Playlist};
use crate::net::{Intent, ToGame};
use crate::protocol::{self, Control};
use crate::queue::{Matchmaker, SearchFrom, Searched};

/// What the server hosts: one open match anyone joins (development servers and the browser tests), or the queue's
/// matches (`--mode queue`: searches and claims only)
pub enum Mode {
    Direct(Playlist),
    Queue(Vec<Playlist>),
}

/// The game's queue of messages from the sessions (bounded: RV-248)
pub const TO_GAME_QUEUE: usize = 65_536;
/// At most this many messages read between ticks: a flood waits in the queue instead of starving the matches (SEC-3)
const MESSAGES_PER_LOOP: usize = 2048;

/// The session's hello is refused: the reason sent, then its queue let go (the session ends)
fn refuse(out: Sender<Outgoing>, reason: u8) {
    let _ = out.try_send(Outgoing::Control(Control::Refused { reason }.encode()));
}

/// `test_goal_after`: browser tests only (`Game::test_goal_after`, s). `heartbeat`: the loop's last pass, in ms from
/// `start` (the health check's)
pub fn run(
    mut messages: Receiver<ToGame>,
    mode: Mode,
    test_goal_after: Option<f32>,
    heartbeat: Arc<AtomicU64>,
    start: Instant,
) {
    let seconds = |at: Instant| at.saturating_duration_since(start).as_secs_f64();
    // (each server run its own kickoff orders, as the game's are random)
    let seed =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.subsec_nanos() as i32);
    let mut host = MatchHost::new(seed, test_goal_after.map(|s| (s * crate::game::TICK_RATE as f32) as u64));
    let mut queue = Matchmaker::new(match &mode {
        Mode::Direct(_) => &[],
        Mode::Queue(playlists) => playlists,
    });
    let queue_mode = matches!(mode, Mode::Queue(_));
    if let Mode::Direct(playlist) = mode {
        host.open_match(playlist, 0.0);
    }
    loop {
        heartbeat.store(start.elapsed().as_millis() as u64, Ordering::Relaxed);
        for _ in 0..MESSAGES_PER_LOOP {
            match messages.try_recv() {
                Ok(ToGame::Join { id, intent, request, address, out }) => match intent {
                    Intent::Join => {
                        if !host.join_open(id, request, out.clone()) {
                            refuse(out, protocol::REFUSED_MODE);
                        }
                    }
                    Intent::Search { team_size, token } => {
                        let from = SearchFrom { address, key: request.key, token };
                        match queue.search(id, team_size, out.clone(), from, seconds(Instant::now())) {
                            Searched::Queued => {}
                            Searched::NoPlaylist => refuse(out, protocol::REFUSED_MODE),
                            // (its browser or address stalled a match: refused with the time left, RV-367)
                            Searched::Cooldown { seconds, network } => {
                                let _ = out
                                    .try_send(Outgoing::Control(Control::SearchCooldown { seconds, network }.encode()));
                            }
                        }
                    }
                    // (a development server has no reservations: a claim isn't its, RV-363)
                    Intent::Claim { .. } if !queue_mode => refuse(out, protocol::REFUSED_MODE),
                    Intent::Claim { token } => {
                        if !host.claim(token, id, request, out.clone()) {
                            eprintln!("player {id}: no reservation for their token");
                            refuse(out, protocol::REFUSED_TOKEN);
                        }
                    }
                },
                Ok(ToGame::Leave { id, lost }) => {
                    queue.cancel(id);
                    host.leave(id, lost);
                }
                Ok(ToGame::CancelSearch { id }) => queue.cancel(id),
                Ok(ToGame::Inputs { id, timestamp, sequence, first_frame, frames, at }) => {
                    if let Some(game) = host.game_of(id) {
                        game.note_input_sequence(id, sequence);
                        game.receive_inputs(id, timestamp, first_frame, &frames, seconds(at));
                    }
                }
                Ok(ToGame::ResetInputBuffer { id }) => {
                    if let Some(game) = host.game_of(id) {
                        game.reset_input_buffer(id, seconds(Instant::now()));
                    }
                }
                Ok(ToGame::ReadyUp { id }) => host.game_of(id).into_iter().for_each(|g| g.ready_up(id)),
                Ok(ToGame::AutoSkipReplay { id, on }) => {
                    host.game_of(id).into_iter().for_each(|g| g.set_auto_skip_replay(id, on))
                }
                Ok(ToGame::VoteForfeit { id }) => host.game_of(id).into_iter().for_each(|g| g.vote_forfeit(id)),
                Ok(ToGame::QuickChat { id, preset, team }) => {
                    let now = seconds(Instant::now());
                    host.game_of(id).into_iter().for_each(|g| g.quick_chat(id, preset, team, now));
                }
                Ok(ToGame::ChatFilter { id, quick_chat, block_non_tactical }) => {
                    host.game_of(id).into_iter().for_each(|g| g.set_chat_filter(id, quick_chat, block_non_tactical));
                }
                Ok(ToGame::Mute { id, car, on }) => host.game_of(id).into_iter().for_each(|g| g.set_mute(id, car, on)),
                Ok(ToGame::Ping { id, ms }) => host.game_of(id).into_iter().for_each(|g| g.set_ping(id, ms)),
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => break,
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => return,
            }
        }
        let now = seconds(Instant::now());
        queue.form(&mut host, now);
        host.tick(now);
        // (the matches cancelled before their start, by a leave or by time: who stayed goes back to the front, who stalled
        // them waits, RV-367)
        for cancelled in host.take_cancelled() {
            queue.cancelled(&cancelled, now);
        }
        // (until the next tick is due, a millisecond at most: the messages are read meanwhile)
        let wait = host.next_tick().map_or(0.001, |next| (next - seconds(Instant::now())).clamp(0.0, 0.001));
        if wait > 0.0 {
            std::thread::sleep(Duration::from_secs_f64(wait));
        }
    }
}
