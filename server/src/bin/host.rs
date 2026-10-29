//! The browser's local host: an offline match against bots. The server's own match (`MatchHost`'s open match: the same
//! rules, flow and messages as online), built for wasm32-unknown-emscripten (scripts/build_host.sh) and run in a worker
//! (client/src/local/hostWorker.ts). Its players, the page's client and the bots, come and go through these calls instead
//! of WebTransport: a client's control stream bytes and datagrams in; every player's queue out (`host_drain`); a bot's
//! controls straight to its car (`host_bot`), its view of the match the whole match's snapshot (`host_state`). Players are
//! u32s here (numbers in JavaScript), the game's ids widened.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ffi::{CStr, c_char};
use std::path::Path;

use carball_server::chan::{Receiver, channel};
use carball_server::engine::{self, Controls};
use carball_server::game::{JoinRequest, MatchType, OUT_QUEUE, Outgoing, PlayerId};
use carball_server::match_host::{MatchHost, Playlist};
use carball_server::protocol::{self, Control, Datagram};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// A drained message's kind: a control message (framed, as the stream carries it), a datagram, the stream's end
const KIND_CONTROL: u8 = 0;
const KIND_DATAGRAM: u8 = 1;
const KIND_END: u8 = 2;

struct Session {
    /// Its control stream's bytes not read yet (a message: its length, a little-endian u16, then its body)
    unread: Vec<u8>,
    /// The game's queue to it, from its hello on
    out: Option<Receiver<Outgoing>>,
    /// Its stream's end handed out (the game let go of it)
    ended: bool,
}

struct Host {
    matches: MatchHost,
    sessions: BTreeMap<PlayerId, Session>,
    /// `host_drain`'s messages: per message its player (u32), kind (u8), length (u32), bytes; little-endian
    drained: Vec<u8>,
    /// `host_state`'s last
    state: Vec<u8>,
}

thread_local! {
    static HOST: RefCell<Option<Host>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut Host) -> R) -> Option<R> {
    HOST.with_borrow_mut(|host| host.as_mut().map(f))
}

/// # Safety
/// `bytes` points at `len` readable bytes (or `len` is 0)
unsafe fn slice<'a>(bytes: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || bytes.is_null() { &[] } else { unsafe { std::slice::from_raw_parts(bytes, len) } }
}

/// The engine set up with the arena's collision meshes from this directory (the worker writes them into the module's
/// file system first); 1 on success
///
/// # Safety
/// `dir` is a NUL-terminated string
#[unsafe(no_mangle)]
pub unsafe extern "C" fn host_init(dir: *const c_char) -> i32 {
    // (the match's log to the worker's console: one line per event, no time, the browser keeps its own; ours info and up,
    // the other crates' errors alone)
    let _ = tracing_subscriber::fmt()
        .with_target(false)
        .without_time()
        .with_writer(std::io::stderr)
        .finish()
        .with(carball_server::log_filter(tracing::Level::INFO))
        .try_init();
    let Ok(dir) = unsafe { CStr::from_ptr(dir) }.to_str() else {
        return 0;
    };
    match engine::init(Path::new(dir)) {
        Ok(()) => 1,
        Err(e) => {
            tracing::error!("local host: {e}");
            0
        }
    }
}

/// A new open match of `team_size` a side (on Night, the one map), the kickoff orders from `seed`; a casual match's rules
/// (forfeit votes after 60 s); its clock starting at 0 s
#[unsafe(no_mangle)]
pub extern "C" fn host_open(team_size: u8, seed: i32) {
    let mut matches = MatchHost::new(seed, None);
    matches.open_match(Playlist { team_size, match_type: MatchType::Casual, forfeit_vote_wait: None }, 0.0);
    HOST.with_borrow_mut(|host| {
        *host = Some(Host { matches, sessions: BTreeMap::new(), drained: Vec::new(), state: Vec::new() })
    });
}

/// A player's session opened: its hello comes on its control stream (`host_control`)
#[unsafe(no_mangle)]
pub extern "C" fn host_connect(id: u32) {
    let id = PlayerId::from(id);
    with(|h| h.sessions.insert(id, Session { unread: Vec::new(), out: None, ended: false }));
}

/// Bytes on a player's control stream (its first message the hello, which joins the open match), at `now` s
///
/// # Safety
/// `bytes` points at `len` readable bytes
#[unsafe(no_mangle)]
pub unsafe extern "C" fn host_control(id: u32, bytes: *const u8, len: usize, now: f64) {
    let id = PlayerId::from(id);
    let bytes = unsafe { slice(bytes, len) };
    with(|h| {
        let Some(session) = h.sessions.get_mut(&id) else {
            return;
        };
        session.unread.extend_from_slice(bytes);
        while session.unread.len() >= 2 {
            let length = usize::from(u16::from_le_bytes([session.unread[0], session.unread[1]]));
            if session.unread.len() < 2 + length {
                break;
            }
            let body: Vec<u8> = session.unread.drain(..2 + length).skip(2).collect();
            if session.out.is_none() {
                session.out = Some(hello(&mut h.matches, id, &body));
                continue;
            }
            let Some(game) = h.matches.game_of(id) else {
                continue;
            };
            // (as the network server's: game_loop.rs, net.rs; nothing else is expected from a client)
            match Control::decode(&body) {
                Ok(Control::ResetInputBuffer) => game.reset_input_buffer(id, now),
                Ok(Control::ReadyUp) => game.ready_up(id),
                Ok(Control::AutoSkipReplay { on }) => game.set_auto_skip_replay(id, on),
                Ok(Control::VoteForfeit) => game.vote_forfeit(id),
                Ok(Control::QuickChat { preset, team }) => game.quick_chat(id, preset, team, now),
                Ok(Control::ChatFilter { quick_chat, block_non_tactical }) => {
                    game.set_chat_filter(id, quick_chat, block_non_tactical)
                }
                Ok(Control::Mute { car, on }) => game.set_mute(id, car, on),
                Ok(_) | Err(_) => {}
            }
        }
    });
}

/// A hello: its version checked, then a join of the open match (refused: the reason, then the stream's end)
fn hello(matches: &mut MatchHost, id: PlayerId, body: &[u8]) -> Receiver<Outgoing> {
    let (out, receiver) = channel(OUT_QUEUE);
    let refuse = |reason: u8| {
        let _ = out.try_send(Outgoing::Control(Control::Refused { reason }.encode()));
    };
    if protocol::hello_version(body).is_some_and(|v| v != protocol::VERSION) {
        refuse(protocol::REFUSED_VERSION);
        return receiver;
    }
    match Control::decode(body).ok().and_then(JoinRequest::from_hello) {
        Some((request, _, _, _)) => {
            if !matches.join_open(id, request, out.clone()) {
                refuse(protocol::REFUSED_MODE);
            }
        }
        None => refuse(protocol::REFUSED_MODE),
    }
    receiver
}

/// A datagram from a player (its inputs), at `now` s
///
/// # Safety
/// `bytes` points at `len` readable bytes
#[unsafe(no_mangle)]
pub unsafe extern "C" fn host_datagram(id: u32, bytes: *const u8, len: usize, now: f64) {
    let id = PlayerId::from(id);
    let bytes = unsafe { slice(bytes, len) };
    with(|h| {
        if let (Ok(Datagram::Inputs { timestamp, sequence, first_frame, frames }), Some(game)) =
            (Datagram::decode(bytes), h.matches.game_of(id))
        {
            game.note_input_sequence(id, sequence);
            game.receive_inputs(id, timestamp, first_frame, &frames, now);
        }
    });
}

/// A player's session closed
#[unsafe(no_mangle)]
pub extern "C" fn host_leave(id: u32) {
    let id = PlayerId::from(id);
    with(|h| {
        h.matches.leave(id, false);
        h.sessions.remove(&id);
    });
}

/// The match's ticks due by `now` s
#[unsafe(no_mangle)]
pub extern "C" fn host_tick(now: f64) {
    with(|h| h.matches.tick(now));
}

/// When the next tick is due (s), or -1 with no match running
#[unsafe(no_mangle)]
pub extern "C" fn host_next_tick() -> f64 {
    with(|h| h.matches.next_tick()).flatten().unwrap_or(-1.0)
}

/// Every player's messages since the last drain into one buffer (`host_drained`): its length
#[unsafe(no_mangle)]
pub extern "C" fn host_drain() -> usize {
    with(|h| {
        h.drained.clear();
        for (&id, session) in &mut h.sessions {
            let Some(out) = session.out.as_mut() else {
                continue;
            };
            while let Some(message) = out.try_recv() {
                let (kind, bytes) = match message {
                    Outgoing::Control(bytes) => (KIND_CONTROL, bytes),
                    Outgoing::Datagram(bytes) => (KIND_DATAGRAM, bytes),
                };
                push(&mut h.drained, id, kind, &bytes);
            }
            if out.finished() && !session.ended {
                session.ended = true;
                push(&mut h.drained, id, KIND_END, &[]);
            }
        }
        h.drained.len()
    })
    .unwrap_or(0)
}

fn push(buffer: &mut Vec<u8>, id: PlayerId, kind: u8, bytes: &[u8]) {
    buffer.extend_from_slice(&(id as u32).to_le_bytes());
    buffer.push(kind);
    buffer.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buffer.extend_from_slice(bytes);
}

/// `host_drain`'s buffer (valid until the next call into the host)
#[unsafe(no_mangle)]
pub extern "C" fn host_drained() -> *const u8 {
    with(|h| h.drained.as_ptr()).unwrap_or(std::ptr::null())
}

/// A bot's controls from the next tick on (its first call makes the player a bot: no input buffer, never idle)
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn host_bot(
    id: u32,
    throttle: f32,
    steer: f32,
    pitch: f32,
    yaw: f32,
    roll: f32,
    jump: u8,
    boost: u8,
    handbrake: u8,
) {
    let id = PlayerId::from(id);
    with(|h| {
        if let Some(game) = h.matches.game_of(id) {
            game.set_bot_controls(
                id,
                Controls { throttle, steer, pitch, yaw, roll, jump, boost, handbrake, ..Controls::default() },
            );
        }
    });
}

/// The car a player drives, or -1
#[unsafe(no_mangle)]
pub extern "C" fn host_car(id: u32) -> i32 {
    let id = PlayerId::from(id);
    with(|h| h.matches.game_of(id).and_then(|g| g.car_id(id))).flatten().map_or(-1, |car| car as i32)
}

/// The phase of a player's match (`protocol::Phase` as its number: 0 the countdown, 1 play, ... 8 finished), or -1 (the
/// bots' pick overrides: a kickoff's pause, the match's end)
#[unsafe(no_mangle)]
pub extern "C" fn host_phase(id: u32) -> i32 {
    let id = PlayerId::from(id);
    with(|h| h.matches.game_of(id).map(|g| g.phase() as i32)).flatten().unwrap_or(-1)
}

/// A team's goals in a player's match (0 blue, 1 orange), or -1 (no such player or team: the bots' score difference)
#[unsafe(no_mangle)]
pub extern "C" fn host_score(id: u32, team: u32) -> i32 {
    let id = PlayerId::from(id);
    let team = usize::try_from(team).ok();
    with(|h| {
        h.matches
            .game_of(id)
            .and_then(|g| team.and_then(|t| g.score.get(t)).map(|&s| i32::try_from(s).unwrap_or(i32::MAX)))
    })
    .flatten()
    .unwrap_or(-1)
}

/// One of a player's input buffer counters (0 consumed, 1 never consumed, 2 over, 3 under, 4 refill skips, 5 duplicates,
/// 6 late, 7 trimmed: the client's network tests read them, RV-1034; i32::MAX at most), or -1 (no such player or counter)
#[unsafe(no_mangle)]
pub extern "C" fn host_input_stat(id: u32, which: u32) -> i32 {
    let id = PlayerId::from(id);
    let stats = with(|h| h.matches.game_of(id).and_then(|g| g.input_stats(id))).flatten();
    let Some(s) = stats else { return -1 };
    let counters = [
        s.consumed,
        s.never_consumed,
        s.over_buffer_frames,
        s.under_buffer_frames,
        s.fill_skips,
        s.duplicates,
        s.late_dropped,
        s.trimmed,
    ];
    counters.get(which as usize).map_or(-1, |&n| i32::try_from(n).unwrap_or(i32::MAX))
}

/// The whole match's state, as a welcome's snapshot, of a player's match into `host_state_bytes`: its length (0: no such
/// player)
#[unsafe(no_mangle)]
pub extern "C" fn host_state(id: u32) -> usize {
    let id = PlayerId::from(id);
    with(|h| {
        h.state = h.matches.game_of(id).map(|g| g.snapshot()).unwrap_or_default();
        h.state.len()
    })
    .unwrap_or(0)
}

/// `host_state`'s bytes (valid until the next call into the host)
#[unsafe(no_mangle)]
pub extern "C" fn host_state_bytes() -> *const u8 {
    with(|h| h.state.as_ptr()).unwrap_or(std::ptr::null())
}

/// (the module's calls are the exports above; nothing runs at start)
fn main() {}
