//! The game loop thread: drains network messages, opens the matchmaker's matches at their first claim, and runs every
//! match at 120 ticks per game second: 120 Hz, but for the slow motion after a goal (`Game::next_tick_seconds`), each
//! match on its own clock.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tokio::sync::mpsc::{Receiver, Sender, UnboundedSender};

use crate::game::Outgoing;
use crate::match_host::{MatchHost, Playlist, Report};
use crate::net::{Intent, ToGame};
use crate::protocol::{self, Control};

/// What the server hosts: one open match anyone joins (development servers and the browser tests), or the matchmaker's
/// matches in these playlists (`--mode queue`: claims and rejoins only)
pub enum Mode {
    Direct(Playlist),
    Queue(Vec<Playlist>),
}

/// The game's queue of messages from the sessions (bounded: RV-248)
pub const TO_GAME_QUEUE: usize = 65_536;
/// At most this many messages read between ticks: a flood waits in the queue instead of starving the matches (SEC-3)
const MESSAGES_PER_LOOP: usize = 2048;

/// When the loop next wakes (s from its start): the next match's tick (`MatchHost::next_tick`), else, with no match, a
/// tick's length from `now` (the matchmaker's claims waiting no longer than a match's messages)
pub fn wake_at(next_tick: Option<f64>, now: f64) -> f64 {
    next_tick.unwrap_or(now + 1.0 / f64::from(crate::game::TICK_RATE))
}

/// Sleeps until `deadline`, in one sleep: on Linux to the absolute time (clock_nanosleep TIMER_ABSTIME on
/// CLOCK_MONOTONIC, the clock `Instant` reads), so nothing drifts between reckoning the wait and sleeping; returns at once
/// for a deadline passed
pub fn sleep_until(deadline: Instant) {
    let now = Instant::now();
    let Some(wait) = deadline.checked_duration_since(now) else { return };
    #[cfg(target_os = "linux")]
    {
        let mut at = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        // SAFETY: clock_gettime and clock_nanosleep read and write only the timespec given, a local
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut at) };
        at.tv_sec += wait.as_secs() as libc::time_t;
        at.tv_nsec += wait.subsec_nanos() as libc::c_long;
        if at.tv_nsec >= 1_000_000_000 {
            at.tv_sec += 1;
            at.tv_nsec -= 1_000_000_000;
        }
        // (an interrupting signal: woken early, the loop reckons again and sleeps the rest)
        unsafe { libc::clock_nanosleep(libc::CLOCK_MONOTONIC, libc::TIMER_ABSTIME, &at, std::ptr::null_mut()) };
    }
    #[cfg(not(target_os = "linux"))]
    std::thread::sleep(wait);
}

/// The session's hello is refused: the reason sent, then its queue let go (the session ends)
fn refuse(out: Sender<Outgoing>, reason: u8) {
    let _ = out.try_send(Outgoing::Control(Control::Refused { reason }.encode()));
}

/// The same, logged with who asked and for what (the user's decision of 2026-10-23: every refusal says who and where)
fn refuse_logged(out: Sender<Outgoing>, reason: u8, id: crate::game::PlayerId, who: &str, asked: &str) {
    tracing::warn!("player {id} ({who}): {asked} refused: {}", protocol::refused_text(reason));
    refuse(out, reason);
}

/// `test_goal_after`: browser tests only (`Game::test_goal_after`, s). `heartbeat`: the loop's last pass, in ms from
/// `start` (the health check's)
pub fn run(
    messages: Receiver<ToGame>,
    mode: Mode,
    test_goal_after: Option<f32>,
    heartbeat: Arc<AtomicU64>,
    start: Instant,
) {
    run_with_reports(messages, mode, test_goal_after, heartbeat, start, None);
}

/// The same, the ranked reports (results, quitters, refills: `match_host::Report`) handed to `reports` (the outbox's)
pub fn run_with_reports(
    mut messages: Receiver<ToGame>,
    mode: Mode,
    test_goal_after: Option<f32>,
    heartbeat: Arc<AtomicU64>,
    start: Instant,
    reports: Option<UnboundedSender<Report>>,
) {
    let seconds = |at: Instant| at.saturating_duration_since(start).as_secs_f64();
    // (each server run its own kickoff orders, as the game's are random)
    let seed =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.subsec_nanos() as i32);
    let mut host = MatchHost::new(seed, test_goal_after.map(|s| (s * crate::game::TICK_RATE as f32) as u64));
    let playlists = match &mode {
        Mode::Direct(_) => Vec::new(),
        Mode::Queue(playlists) => playlists.clone(),
    };
    let queue_mode = matches!(mode, Mode::Queue(_));
    if let Mode::Direct(playlist) = mode {
        host.open_match(playlist, 0.0);
    }
    // (the benchmark's counters, when they're on: each pass's busy time and ticks, notes/benchmarks.md)
    let metrics = crate::metrics::get();
    // (the sleeps to the ticks as precise as the clock: this thread's timer slack 1 ns, not the kernel's 50 us default)
    #[cfg(target_os = "linux")]
    // SAFETY: PR_SET_TIMERSLACK sets this thread's slack alone, from an integer
    unsafe {
        libc::prctl(libc::PR_SET_TIMERSLACK, 1 as libc::c_ulong, 0, 0, 0);
    }
    loop {
        let pass = Instant::now();
        heartbeat.store(start.elapsed().as_millis() as u64, Ordering::Relaxed);
        host.observe(seconds(Instant::now()));
        for _ in 0..MESSAGES_PER_LOOP {
            match messages.try_recv() {
                Ok(ToGame::Join { id, intent, request, out }) => {
                    let who = request.who();
                    match intent {
                        Intent::Join => {
                            if !host.join_open(id, request, out.clone()) {
                                refuse_logged(out, protocol::REFUSED_MODE, id, &who, "a join");
                            }
                        }
                        // (a development server has no matchmaker's matches: a claim isn't its, RV-363)
                        Intent::Claim { seat } if !queue_mode => {
                            let asked = format!("a claim of match {:016x}", seat.match_id);
                            refuse_logged(out, protocol::REFUSED_MODE, id, &who, &asked);
                        }
                        Intent::Claim { seat } => {
                            let asked = format!("a claim of match {:016x} seat {}", seat.match_id, seat.seat);
                            match playlists.iter().find(|p| p.team_size == seat.playlist) {
                                Some(&playlist) => {
                                    if let Err(reason) = host.claim_seat(&seat, playlist, id, request, out.clone()) {
                                        refuse_logged(out, reason, id, &who, &asked);
                                    }
                                }
                                None => refuse_logged(out, protocol::REFUSED_MODE, id, &who, &asked),
                            }
                        }
                        Intent::Rejoin { match_id } => {
                            let asked = format!("a rejoin of match {match_id:016x}");
                            let ticket = request.ticket.as_ref().map(|t| t.encoded.clone());
                            if !queue_mode {
                                refuse_logged(out, protocol::REFUSED_MODE, id, &who, &asked);
                            } else if let Err(reason) = host.rejoin(match_id, id, request, out.clone()) {
                                refuse_logged(out, reason, id, &who, &asked);
                                // (the matchmaker let it through and holds the account's searches for its Back: told
                                // it won't come, RV-1076)
                                if let Some(ticket) = ticket {
                                    host.rejoin_refused(match_id, ticket);
                                }
                            }
                        }
                    }
                }
                Ok(ToGame::Leave { id, lost }) => host.leave(id, lost),
                Ok(ToGame::Inputs { id, slot }) => {
                    if let (Some(inputs), Some(game)) = (slot.take(), host.game_of(id)) {
                        game.note_input_sequence(id, inputs.sequence);
                        game.receive_inputs(
                            id,
                            inputs.timestamp,
                            inputs.first_frame,
                            &inputs.frames,
                            seconds(inputs.at),
                        );
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
        let ticked = host.tick(seconds(Instant::now()));
        // (the accounts service's: results, quitters, refills and the matchmaker's events, sent by the outbox)
        for report in host.take_reports() {
            match &reports {
                Some(tx) => {
                    let _ = tx.send(report);
                }
                None => tracing::info!("ranked report (no outbox): {}", report.summary()),
            }
        }
        if let Some(m) = metrics {
            let (matches, players) = host.counts();
            m.pass(pass.elapsed(), ticked.ticks, ticked.slipped, matches, players);
        }
        // (asleep until the next tick is due, in one sleep, not one a millisecond (PERF1: ~940 wakeups a second idle): the
        // messages that came meanwhile read on waking, before that tick, as they always were before the tick that uses
        // them: the inputs with the time they arrived (`inputs.at`, the network's), the others (a join, a claim, a reset of
        // the input buffer) taken at the tick, as the game takes its RPCs before its world's tick)
        sleep_until(start + Duration::from_secs_f64(wake_at(host.next_tick(), seconds(Instant::now())).max(0.0)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loop_wakes_at_the_next_tick_else_a_ticks_length_on() {
        assert_eq!(wake_at(Some(12.5), 10.0), 12.5);
        let idle = wake_at(None, 10.0);
        assert!((idle - (10.0 + 1.0 / 120.0)).abs() < 1e-12, "{idle}");
    }

    #[test]
    fn the_sleep_to_a_tick_never_wakes_before_it_and_a_passed_one_not_at_all() {
        for millis in [1u64, 4, 9] {
            let deadline = Instant::now() + Duration::from_millis(millis);
            sleep_until(deadline);
            let woke = Instant::now();
            assert!(woke >= deadline, "woke {:?} early", deadline - woke);
            // (late by the clock's wakeup alone: generous, a loaded test machine)
            assert!(woke - deadline < Duration::from_millis(200), "{:?} late", woke - deadline);
        }
        let passed = Instant::now();
        std::thread::sleep(Duration::from_millis(2));
        let before = Instant::now();
        sleep_until(passed);
        assert!(before.elapsed() < Duration::from_millis(50), "a passed deadline: no sleep");
    }
}
