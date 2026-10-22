//! The game protocol (version 1): see `protocol/README.md`. Byte-exact samples in `protocol/vectors.json`.

use crate::engine::Controls;

// 2: kickoff countdown in the state; 3: the wheels' previous contacts; 4: the jump's release; 5: respawn spot selection
// and flip resets in the state; 9: the goal replay (its phase, plan and skip votes; Hello's auto-skip); 10: forfeit votes,
// the match type, a leaver's car, no contest; 11: quick chat, players' names (the roster), a leave's reason; 12: whether a
// leaver's car explodes; 13: match stats, mute, Hello's chat filters; 14: the match's intro and end (its phases, the end
// screen's countdown, ready checks, podium titles), Refused's version reason; 17: the queue (Hello's intent, playlist and
// token, 64-bit keys, MatchFound, IdleWarning, Kicked); 18: the moving bodies' broadphase boxes in the engine snapshot
// (physics FP2); 19: a search's browser key and returning token, SearchCooldown (RV-367: no-shows); 20: SearchCooldown
// says whether the browser or the network is why (RV-385); 21: the match's map (MatchFound, Welcome); 22: the garage's
// car (Hello's model, the roster's); 23: Kicked's KICK_REPLACED (RV-460); 24: the stat graphs' network rows (HUD-21: the
// input datagrams' sequence, each update's input-buffer window and the inputs lost); 25: one map, Night (map 0, its
// arena the glasshouse: an older client would draw another); 26: Hello's search ticket, Refused's REFUSED_TICKET; 27:
// rejoining a ranked match (Hello's INTENT_REJOIN, Welcome's match id, Refused's REFUSED_IN_MATCH and REFUSED_CONCLUDED)
pub const VERSION: u16 = 27;
/// The maps a match can be on (the client's THEMES: protocol/README.md): one, Night (the user's decision of 2026-10-17); a
/// map on the wire is its index
pub const MAP_COUNT: u8 = 1;
/// Night, every match's map
pub const NIGHT_MAP: u8 = 0;
const _: () = assert!(NIGHT_MAP < MAP_COUNT);
/// The quick-chat presets (`Group1-6MessageN`: notes/quick-chat.md CHAT-1); a preset on the wire is its index
pub const QUICK_CHAT_PRESETS: u8 = 76;
/// A player's quick-chat filter (`EChatFilter` as the clone uses it: CHAT-18)
pub const CHAT_EVERYONE: u8 = 0;
pub const CHAT_TEAM: u8 = 1;
pub const CHAT_FRIENDS: u8 = 2;
pub const CHAT_OFF: u8 = 3;
/// A name's bytes at most (UTF-8)
pub const MAX_NAME_BYTES: usize = 32;
/// A Hello's search ticket's bytes at most (notes/accounts.md §3: the accounts service's encoded ticket)
pub const MAX_TICKET_BYTES: usize = 320;
/// Why a join was refused
pub const REFUSED_FULL: u8 = 0;
/// `Refused`'s reason: the client speaks another protocol version (RV-262; a client of version 12 on can read it)
pub const REFUSED_VERSION: u8 = 1;
/// `Refused`'s reason: no reservation has the token (never given, already claimed, or expired)
pub const REFUSED_TOKEN: u8 = 2;
/// `Refused`'s reason: this server doesn't serve the hello's intent (a direct join on a queue server, a search on a direct one)
pub const REFUSED_MODE: u8 = 3;
/// `Refused`'s reason: a search's or a claim's ticket missing, not ours, out of its time, used before, or not the
/// account that searched (notes/accounts.md §3: sign in again)
pub const REFUSED_TICKET: u8 = 4;
/// `Refused`'s reason: a search from an account that holds a seat already, in a match found or running (one search or
/// match per account: notes/accounts.md §3, AP2-1; a ranked 2v2 or 3v3 left by accident is rejoined instead)
pub const REFUSED_IN_MATCH: u8 = 5;
/// `Refused`'s reason: a rejoin whose match is over, or has no seat of the account's to take back (LV1: "Match has
/// concluded")
pub const REFUSED_CONCLUDED: u8 = 6;
/// A search from an account the server reported as a quitter in the last few minutes (its queue ban, AP3)
pub const REFUSED_QUEUE_BANNED: u8 = 7;
/// Hello's intent: join this server's match (development servers), search a playlist's queue, claim a reserved slot
pub const INTENT_JOIN: u8 = 0;
pub const INTENT_SEARCH: u8 = 1;
pub const INTENT_CLAIM: u8 = 2;
/// Hello's intent: rejoin the ranked match its token names (Welcome's match id: LV1, 2v2 and 3v3 only)
pub const INTENT_REJOIN: u8 = 3;
/// `Kicked`'s reason: idle too long (MM-37)
pub const KICK_IDLE: u8 = 0;
/// `Kicked`'s reason: the match was cancelled before it started, not every reserved player joined (MM-18)
pub const KICK_NOT_ALL_JOINED: u8 = 1;
/// `Kicked`'s reason: a newer search from the same browser (another of its tabs) took this search's place (RV-460)
pub const KICK_REPLACED: u8 = 2;

/// A hello's version, read before the rest (another version's fields don't decode: RV-243); None: not a hello
pub fn hello_version(body: &[u8]) -> Option<u16> {
    if let [0x01, lo, hi, ..] = *body { Some(u16::from_le_bytes([lo, hi])) } else { None }
}

/// Stat events (`StatEvent_TA`, `engine/stats/StatFactory.h` `StatEvent`): the ids `StatEvent` and `Ticker` carry
pub mod stat {
    pub const GOAL: u8 = 0;
    pub const AERIAL_GOAL: u8 = 1;
    pub const BACKWARDS_GOAL: u8 = 2;
    pub const BICYCLE_GOAL: u8 = 3;
    pub const TURTLE_GOAL: u8 = 4;
    pub const LONG_GOAL: u8 = 5;
    pub const OVERTIME_GOAL: u8 = 6;
    pub const HAT_TRICK: u8 = 7;
    pub const ASSIST: u8 = 8;
    pub const PLAYMAKER: u8 = 9;
    pub const POOL_SHOT: u8 = 10;
    pub const SHOT: u8 = 11;
    pub const SAVE: u8 = 12;
    pub const EPIC_SAVE: u8 = 13;
    pub const SAVIOR: u8 = 14;
    pub const CLEAR: u8 = 15;
    pub const CENTER: u8 = 16;
    pub const FIRST_TOUCH: u8 = 17;
    pub const BALL_HIT: u8 = 18;
    pub const CROSSBAR_HITS: u8 = 19;
    pub const AERIAL_HIT: u8 = 20;
    pub const BICYCLE_HIT: u8 = 21;
    pub const JUGGLE_HIT: u8 = 22;
    pub const DEMOLISH: u8 = 23;
    pub const DEMOLISHED: u8 = 24;
    pub const EXTERMINATION: u8 = 25;
    pub const LOW_FIVE: u8 = 26;
    pub const HIGH_FIVE: u8 = 27;
    pub const OWN_GOAL: u8 = 28;
    pub const MVP: u8 = 29;
    pub const WIN: u8 = 30;
    pub const LOSS: u8 = 31;
    pub const DEMOLITION_RESPAWN: u8 = 32;

    /// Sent to the receiver (`ClientNotifyGainedStat`) unless `bSkipReplication` (BallHit, CrossbarHits)
    pub fn notifies_receiver(event: u8) -> bool {
        !matches!(event, BALL_HIT | CROSSBAR_HITS)
    }

    /// Goes to every player's ticker (`bNotifyTicker`, match-stats.md §2)
    pub fn notifies_ticker(event: u8) -> bool {
        matches!(
            event,
            GOAL | AERIAL_GOAL
                | BACKWARDS_GOAL
                | BICYCLE_GOAL
                | TURTLE_GOAL
                | LONG_GOAL
                | OVERTIME_GOAL
                | HAT_TRICK
                | ASSIST
                | PLAYMAKER
                | POOL_SHOT
                | SHOT
                | SAVE
                | EPIC_SAVE
                | SAVIOR
                | BICYCLE_HIT
                | DEMOLISH
                | EXTERMINATION
                | LOW_FIVE
                | HIGH_FIVE
                | MVP
                | WIN
        )
    }
}
pub const MAX_INPUT_FRAMES: usize = 10;

/// Control stream (reliable) messages
#[derive(Clone, Debug, PartialEq)]
pub enum Control {
    Hello {
        version: u16,
        team: u8,
        /// The garage's car (`MODEL_PRESETS`: the server takes an unknown one as the first)
        model: u8,
        dodge_deadzone: f32,
        steering_sensitivity: f32,
        air_control_sensitivity: f32,
        /// The player skips goal replays (`bAutoSkipGoalReplay`): auto-ready in every one
        auto_skip_replay: bool,
        /// The key the server gave this client before (its `Welcome`'s), kept across its reconnects (who started a forfeit
        /// vote: `ForfeitInitiatorIDs`); 0 for none (64 random bits: SEC-9). A search's: the browser's own key (random,
        /// kept: a no-show's cooldown counts it, RV-367)
        key: u64,
        /// The player's name (UTF-8, `MAX_NAME_BYTES` at most; the server tidies it)
        name: String,
        /// Their chat filters from the start (as `ChatFilter`: RV-259)
        quick_chat: u8,
        block_non_tactical: bool,
        /// `INTENT_*`: what the session is for
        intent: u8,
        /// A search's playlist: its team size (1, 2 or 3); 0 otherwise
        playlist: u8,
        /// A claim's token (from `MatchFound`). A search's: the token of the slot it claimed in a match cancelled for
        /// someone else (`KICK_NOT_ALL_JOINED`): it searches again at the front of the queue (RV-367). 0 otherwise
        token: u64,
        /// A search's and a claim's signed ticket (notes/accounts.md §3: the accounts service's, or a development
        /// server's own): who the player is, their name; empty for a join (development) and the local host
        ticket: String,
    },
    /// Mute or unmute a player's chat for this player (`ClientMutePlayer`: the server stops relaying their lines to them)
    Mute {
        car: u32,
        on: bool,
    },
    /// A quick-chat preset (`ServerSay_TA` with bPreset): to the player's team or to all
    QuickChat {
        preset: u8,
        team: bool,
    },
    /// The player's chat filters (`ServerSetQuickChatFilter`, `ServerSetTacticalChatFilter`): `CHAT_*`, and whether
    /// other players' non-tactical presets are blocked during the match
    ChatFilter {
        quick_chat: u8,
        block_non_tactical: bool,
    },
    /// Skip the goal replay (`ReadyUp`: Space / pad A); counts only during one
    ReadyUp,
    /// The auto-skip setting changed (`ServerSetAutoSkipGoalReplay`: turned on during a replay, it readies the player)
    AutoSkipReplay {
        on: bool,
    },
    /// The client had a hitch (over 0.1 s between its ticks) 2 s ago: the server resets its jitter buffer
    /// (`NetworkInputBuffer_TA.ClientTick` → `ServerResetInputBuffer`)
    ResetInputBuffer,
    /// Vote to forfeit (`PRI.ServerVoteToForfeit`): starts the team's vote, or joins it as a yes
    VoteForfeit,
    /// `match_type`: 0 casual, 1 ranked, 2 private (who may vote to forfeit, after how long, its label); `team_size`: the
    /// playlist's; `map`: the match's (`MAP_COUNT`), the arena every player sees; `key`: the player's (Hello's again, if
    /// it was this server's and no one here has it; else a new one); `match_id`: a queue match's, for a rejoin (0: none)
    Welcome {
        version: u16,
        car_id: u32,
        tick_rate: u8,
        frame: u32,
        match_type: u8,
        team_size: u8,
        map: u8,
        key: u64,
        match_id: u64,
        snapshot: Vec<u8>,
    },
    World {
        frame: u32,
        snapshot: Vec<u8>,
    },
    Event {
        server_tick: u32,
        event: GameEvent,
    },
    /// The match's state: sent when it changes and each second while the clock runs
    Match(MatchState),
    /// The goal replay starts (`StartReplay` → `ReplayPlayback`): what the clients play from their own recording
    Replay(ReplayPlan),
    /// How many players are ready to skip the goal replay, of how many (sent when it changes during one)
    ReplayReady {
        ready: u8,
        total: u8,
    },
    /// The player's team's forfeit vote, sent to each of its players when it changes (`Team_TA.ForfeitVote`)
    ForfeitVote(ForfeitVoteState),
    /// The players: each one's car, team and name, sent to everyone when it changes
    Roster(Vec<RosterEntry>),
    /// A quick-chat line (`ChatMessage_TA`): the sender's car, the preset, to the team or all, and the clock's shown
    /// seconds as the server relayed it (`SecondsRemaining`)
    Chat {
        car: u32,
        preset: u8,
        team: bool,
        seconds: u16,
    },
    /// The sender's chat is blocked by the spam filter for this long (`ClientNotifyChatDisabled`)
    ChatBlocked {
        seconds: f32,
    },
    /// The join was refused (`REFUSED_FULL`: the match has its most players), instead of a `Welcome`; the session ends
    Refused {
        reason: u8,
    },
    /// Every player's scoreboard line (`PRI_TA`'s replicated match counters, ping, MVP), sent when it changes and every
    /// two seconds for the pings
    Scoreboard(Vec<ScoreboardEntry>),
    /// A stat this player gained (`ClientNotifyGainedStat`: their popup), with its points
    StatEvent {
        event: u8,
        points: u16,
    },
    /// A stat someone gained, for every player's feed (`ClientNotifyStatTickerMessage`): the receiver's car and a
    /// demolition's victim (0: none)
    Ticker {
        event: u8,
        receiver: u32,
        victim: u32,
    },
    /// A search found a match: the slot's one-time token, to claim with a new session's hello, and the match's map (its
    /// arena loads during the join's countdown); the search session ends
    MatchFound {
        token: u64,
        map: u8,
    },
    /// The idle warning shows (`IdleWarning_TA`: idle over 25 s of play) or hides (the player acted)
    IdleWarning {
        on: bool,
    },
    /// The server ends this player's session (`KICK_*`), closing it a second later (`CloseConnectionWithReason`)
    Kicked {
        reason: u8,
    },
    /// A search refused: its browser (`network` false) or its address (true: a network shared with someone who did)
    /// stalled a match (didn't claim its slot, or left before the start) and may search again in this many seconds
    /// (RV-367, RV-385); the session ends
    SearchCooldown {
        seconds: u16,
        network: bool,
    },
}

/// One player's scoreboard line
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScoreboardEntry {
    pub car: u32,
    /// Round-trip time in ms (999 at most)
    pub ping: u16,
    /// The match's MVP (`bMatchMVP`)
    pub mvp: bool,
    /// Ready for the next match (the end screen's ready check)
    pub ready: bool,
    /// The match counters (`engine::STAT_COUNTERS`, in its order; 65535 at most)
    pub counters: Vec<u16>,
    /// The podium titles: primary, secondary (from the match's end; notes/match-stats.md §5.4a)
    pub titles: [Option<PodiumTitle>; 2],
}

/// A podium title (`MemberTitleStat`): its id (`engine/stats/PodiumTitles.cpp` STAT_TITLES) and the stat count it shows
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PodiumTitle {
    pub title: u8,
    pub count: u16,
}

/// No title (the wire's title byte)
pub const NO_TITLE: u8 = 255;

/// The garage's cars (the client's `CARS`, src/game/cars.ts; only ever appended to): a model on the wire is its index,
/// each with the engine's hitbox preset it plays with; one this server doesn't know plays as the first
pub const MODEL_PRESETS: [u8; 4] = [0, 0, 1, 5];

/// The garage's retired cars (their ids never reused): 1, the Standard (the user's, 2026-10-17), now Sport (0) as the
/// client takes it
pub const RETIRED_MODELS: [u8; 1] = [1];

/// A hello's model as the server takes it: one it knows, else 0 (a retired one too); and its hitbox preset
pub fn model_preset(model: u8) -> (u8, u8) {
    match MODEL_PRESETS.get(usize::from(model)) {
        Some(&preset) if !RETIRED_MODELS.contains(&model) => (model, preset),
        _ => (0, MODEL_PRESETS[0]),
    }
}

/// A player as the others know them: their car (the engine's id), team, name and the garage's car they drive
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RosterEntry {
    pub car: u32,
    pub team: u8,
    pub model: u8,
    pub name: String,
}

pub const VOTE_RUNNING: u8 = 0;
pub const VOTE_PASSED: u8 = 1;
pub const VOTE_FAILED: u8 = 2;
pub const VOTE_NONE: u8 = 3;

/// A team's forfeit vote as one of its players sees it
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ForfeitVoteState {
    /// `VOTE_RUNNING`, `VOTE_PASSED` or `VOTE_FAILED` (a finished vote stays 5 s), `VOTE_NONE`
    pub state: u8,
    pub yes: u8,
    /// the votes it needs: the team's players (unanimous)
    pub required: u8,
    /// game seconds left of its 20 (`TimeRemaining`, counted down each game second)
    pub seconds_left: u8,
    /// this player has voted
    pub voted: bool,
    /// this player may start a vote (the lockout: one start each until the team is re-enabled)
    pub can_start: bool,
}

/// A goal replay (server ticks; `ReplayDirector_TA`): `notes/camera-respawn-goal.md` GS-7..9
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReplayPlan {
    /// The first tick shown (`GetReplayStartTime`)
    pub start_tick: u32,
    pub goal_tick: u32,
    /// The recording's end: the goal + PostGoalTime
    pub end_tick: u32,
    pub scoring_team: u8,
    /// Stretches played at 0.25 speed (from, to: exclusive), in order
    pub slomo: Vec<(u32, u32)>,
    /// Whom the camera follows with the ball, until when (car id, tick): each run of touches by one car up to the
    /// scoring touch, in order
    pub focus: Vec<(u32, u32)>,
}

/// Where a match is (the game's GameEvent_Soccar_TA states)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// The kickoff countdown: cars frozen, the clock stopped
    Countdown = 0,
    /// Playing (the clock runs once the ball has been hit, or 5 s after "go")
    Active = 1,
    /// After a goal, until the next kickoff (the clock stopped)
    PostGoal = 2,
    /// Time is up: the round ends when the ball touches the ground (goals still count)
    TimeUp = 3,
    /// The match is over (`winner`): the world frozen, the winner shown (`PrePodiumSpotlight`, 3 s)
    PrePodium = 4,
    /// The goal replay (`ReplayPlayback`): the cars gone, until it ends or every player skips it
    Replay = 5,
    /// Before the match's first countdown (`WaitingForPlayers`, its 3 s warm-up): cars held, no messages
    Waiting = 6,
    /// The podium (`PodiumSpotlight`, 5.3 s): the winners' cars at their spots, drivable with unlimited boost; the
    /// others' cars gone
    Podium = 7,
    /// The end screen (`Finished`, up to 60 s): the world frozen; the next match when every player is ready
    Finished = 8,
}

impl Phase {
    /// The match is over: the podium phases and the end screen
    pub fn match_over(self) -> bool {
        matches!(self, Phase::PrePodium | Phase::Podium | Phase::Finished)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchState {
    pub server_tick: u32,
    pub phase: Phase,
    /// Sudden death: `clock_ticks` counts up from the start of overtime
    pub overtime: bool,
    pub clock_running: bool,
    /// Regulation: ticks left (120 per second); overtime: ticks played
    pub clock_ticks: u32,
    pub score: [u8; 2],
    pub winner: Option<u8>,
    /// The match ended by a forfeit: a team voted to, or left (none of its players remained)
    pub forfeit: bool,
    /// Forfeit votes are allowed now (`bCanVoteToForfeit`: no winner yet, and 60 s (casual) or 90 s of the clock gone,
    /// or overtime)
    pub can_vote_forfeit: bool,
    /// The match ended with no contest: every team left (`ForceNoContest`)
    pub no_contest: bool,
    /// The end screen's countdown to the next match, whole seconds (0 in the other phases)
    pub seconds_left: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameEvent {
    /// `team` scored; `scorer` and `assister`: the cars credited with the goal and the assist (0: none; no scorer when
    /// only the defending team touched the ball)
    Goal {
        team: u8,
        scorer: u32,
        assister: u32,
    },
    Demo {
        attacker: u32,
        victim: u32,
    },
    /// A player left; `lost`: their connection timed out (the chat log's "lost connection"); `explode`: their car explodes
    /// where it is (`Car.Demolish(None)`: no demolition counted), not when already demolished or in the goal replay
    Left {
        car: u32,
        lost: bool,
        explode: bool,
    },
}

/// Datagram (unreliable) messages
#[derive(Clone, Debug, PartialEq)]
pub enum Datagram {
    /// `sequence`: the client's count of its input datagrams (wrapping: the server counts the gaps, Out Loss)
    Inputs {
        timestamp: u32,
        sequence: u16,
        first_frame: u32,
        frames: Vec<InputFrame>,
    },
    Update(Update),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Update {
    pub server_tick: u32,
    pub ack_frame: u32,
    pub received_frame: u32,
    pub echo_timestamp: u32,
    pub echo_delay: u16,
    pub buffer_target: u8,
    pub buffer_size: u8,
    /// Since the last update (the stat graphs' IBuf rows, HUD-21): the input buffer's fewest and most frames, its frames
    /// skipped (over) and ticks without one (under), the client's input datagrams lost
    pub buffer_low: u8,
    pub buffer_high: u8,
    pub buffer_over: u8,
    pub buffer_under: u8,
    pub input_loss: u8,
    pub part: u8,
    pub parts: u8,
    pub state: Vec<u8>,
}

/// One frame of a player's inputs, quantized as sent (axes in 1/127 steps).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct InputFrame {
    pub throttle: i8,
    pub steer: i8,
    pub pitch: i8,
    pub yaw: i8,
    pub roll: i8,
    /// The dodge's forward input: -pitch made a byte on its own (q(-p), not -q(p): `VehicleInput.DodgeForward`)
    pub dodge_forward: i8,
    pub bits: u8,
}

pub const BIT_JUMP: u8 = 1;
pub const BIT_BOOST: u8 = 2;
pub const BIT_HANDBRAKE: u8 = 4;
pub const BIT_AIR_PITCH_SAFETY: u8 = 8;

/// round(v × 127), halves away from zero, clamped
/// An input axis as the game's input byte (`Vehicle_TA.SetVehicleInput`): q = round(v × 127) for v ≥ 0 and
/// round(v × 128) below, halves up (the engine applies the same, so decoded values pass through unchanged)
pub fn quantize_axis(v: f32) -> i8 {
    let v = v.clamp(-1.0, 1.0);
    let f = if v < 0.0 { (v * 128.0).max(-128.0) } else { (v * 127.0).min(127.0) };
    let y = f + 128.0;
    ((((y + y) + 0.5).round_ties_even() as i32 >> 1) - 128) as i8
}

pub fn dequantize_axis(q: i8) -> f32 {
    let v = f32::from(q);
    if q < 0 { v * 0.0078125 } else { v / 127.0 }
}

impl InputFrame {
    pub fn controls(&self) -> Controls {
        Controls {
            throttle: dequantize_axis(self.throttle),
            steer: dequantize_axis(self.steer),
            pitch: dequantize_axis(self.pitch),
            yaw: dequantize_axis(self.yaw),
            roll: dequantize_axis(self.roll),
            jump: u8::from(self.bits & BIT_JUMP != 0),
            boost: u8::from(self.bits & BIT_BOOST != 0),
            handbrake: u8::from(self.bits & BIT_HANDBRAKE != 0),
            air_pitch_safety: u8::from(self.bits & BIT_AIR_PITCH_SAFETY != 0),
            dodge_forward: dequantize_axis(self.dodge_forward),
            has_dodge_forward: 1,
        }
    }
}

// --- encoding -------------------------------------------------------------------------------------------------

#[derive(Default)]
struct Writer(Vec<u8>);

impl Writer {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn i8(&mut self, v: i8) {
        self.0.push(v as u8);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn bytes_with_len(&mut self, b: &[u8]) {
        self.u32(b.len() as u32);
        self.0.extend_from_slice(b);
    }
    /// A ticket: a u16 byte count, then its bytes (ASCII: base64url; `MAX_TICKET_BYTES` at most, a longer one sent empty)
    fn ticket(&mut self, s: &str) {
        let b = if s.len() <= MAX_TICKET_BYTES { s.as_bytes() } else { &[] };
        self.u16(b.len() as u16);
        self.0.extend_from_slice(b);
    }
    /// A short UTF-8 string: a byte count, then its bytes (`MAX_NAME_BYTES` at most, cut at a character boundary)
    fn name(&mut self, s: &str) {
        let mut end = s.len().min(MAX_NAME_BYTES);
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        self.u8(end as u8);
        self.0.extend_from_slice(&s.as_bytes()[..end]);
    }
}

#[derive(Debug)]
pub enum DecodeError {
    Truncated,
    UnknownType(u8),
    TooLarge,
    /// Bytes after the message's end (a hello's: AP2-12)
    Trailing,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Truncated => write!(f, "message truncated"),
            Self::UnknownType(t) => write!(f, "unknown message type 0x{t:02x}"),
            Self::TooLarge => write!(f, "message too large"),
            Self::Trailing => write!(f, "bytes after the message"),
        }
    }
}

impl std::error::Error for DecodeError {}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], DecodeError> {
        if self.0.len() < n {
            return Err(DecodeError::Truncated);
        }
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Ok(head)
    }
    fn u8(&mut self) -> Result<u8, DecodeError> {
        Ok(self.take(1)?[0])
    }
    fn i8(&mut self) -> Result<i8, DecodeError> {
        Ok(self.take(1)?[0] as i8)
    }
    fn u16(&mut self) -> Result<u16, DecodeError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32, DecodeError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, DecodeError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn f32(&mut self) -> Result<f32, DecodeError> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn bytes_with_len(&mut self) -> Result<Vec<u8>, DecodeError> {
        let n = self.u32()? as usize;
        Ok(self.take(n)?.to_vec())
    }
    /// A ticket (u16 count, `MAX_TICKET_BYTES` at most: a longer one is malformed)
    fn ticket(&mut self) -> Result<String, DecodeError> {
        let n = usize::from(self.u16()?);
        if n > MAX_TICKET_BYTES {
            return Err(DecodeError::Truncated);
        }
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn name(&mut self) -> Result<String, DecodeError> {
        let n = usize::from(self.u8()?);
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn rest(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0).to_vec()
    }
}

impl Control {
    /// The message with its u16 length prefix, ready for the control stream.
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        match self {
            Self::Hello {
                version,
                team,
                model,
                dodge_deadzone,
                steering_sensitivity,
                air_control_sensitivity,
                auto_skip_replay,
                key,
                name,
                quick_chat,
                block_non_tactical,
                intent,
                playlist,
                token,
                ticket,
            } => {
                w.u8(0x01);
                w.u16(*version);
                w.u8(*team);
                w.u8(*model);
                w.f32(*dodge_deadzone);
                w.f32(*steering_sensitivity);
                w.f32(*air_control_sensitivity);
                w.u8(u8::from(*auto_skip_replay));
                w.u64(*key);
                w.name(name);
                w.u8(*quick_chat);
                w.u8(u8::from(*block_non_tactical));
                w.u8(*intent);
                w.u8(*playlist);
                w.u64(*token);
                w.ticket(ticket);
            }
            Self::MatchFound { token, map } => {
                w.u8(0x8F);
                w.u64(*token);
                w.u8(*map);
            }
            Self::IdleWarning { on } => {
                w.u8(0x90);
                w.u8(u8::from(*on));
            }
            Self::Kicked { reason } => {
                w.u8(0x91);
                w.u8(*reason);
            }
            Self::SearchCooldown { seconds, network } => {
                w.u8(0x92);
                w.u16(*seconds);
                w.u8(u8::from(*network));
            }
            Self::Mute { car, on } => {
                w.u8(0x08);
                w.u32(*car);
                w.u8(u8::from(*on));
            }
            Self::QuickChat { preset, team } => {
                w.u8(0x06);
                w.u8(*preset);
                w.u8(u8::from(*team));
            }
            Self::ChatFilter { quick_chat, block_non_tactical } => {
                w.u8(0x07);
                w.u8(*quick_chat);
                w.u8(u8::from(*block_non_tactical));
            }
            Self::Roster(players) => {
                w.u8(0x88);
                w.u8(players.len().min(255) as u8);
                for p in players.iter().take(255) {
                    w.u32(p.car);
                    w.u8(p.team);
                    w.u8(p.model);
                    w.name(&p.name);
                }
            }
            Self::Chat { car, preset, team, seconds } => {
                w.u8(0x89);
                w.u32(*car);
                w.u8(*preset);
                w.u8(u8::from(*team));
                w.u16(*seconds);
            }
            Self::ChatBlocked { seconds } => {
                w.u8(0x8A);
                w.f32(*seconds);
            }
            Self::Refused { reason } => {
                w.u8(0x8B);
                w.u8(*reason);
            }
            Self::Scoreboard(entries) => {
                w.u8(0x8C);
                w.u8(entries.len().min(255) as u8);
                for e in entries.iter().take(255) {
                    w.u32(e.car);
                    w.u16(e.ping);
                    w.u8(u8::from(e.mvp) | (u8::from(e.ready) << 1));
                    w.u8(e.counters.len().min(255) as u8);
                    for &c in e.counters.iter().take(255) {
                        w.u16(c);
                    }
                    for t in &e.titles {
                        w.u8(t.map_or(NO_TITLE, |t| t.title));
                        w.u16(t.map_or(0, |t| t.count));
                    }
                }
            }
            Self::StatEvent { event, points } => {
                w.u8(0x8D);
                w.u8(*event);
                w.u16(*points);
            }
            Self::Ticker { event, receiver, victim } => {
                w.u8(0x8E);
                w.u8(*event);
                w.u32(*receiver);
                w.u32(*victim);
            }
            Self::ResetInputBuffer => w.u8(0x02),
            Self::VoteForfeit => w.u8(0x05),
            Self::ForfeitVote(v) => {
                w.u8(0x87);
                w.u8(v.state);
                w.u8(v.yes);
                w.u8(v.required);
                w.u8(v.seconds_left);
                w.u8(u8::from(v.voted) | (u8::from(v.can_start) << 1));
            }
            Self::ReadyUp => w.u8(0x03),
            Self::AutoSkipReplay { on } => {
                w.u8(0x04);
                w.u8(u8::from(*on));
            }
            Self::Replay(plan) => {
                w.u8(0x85);
                w.u32(plan.start_tick);
                w.u32(plan.goal_tick);
                w.u32(plan.end_tick);
                w.u8(plan.scoring_team);
                w.u8(plan.slomo.len().min(255) as u8);
                for (from, to) in plan.slomo.iter().take(255) {
                    w.u32(*from);
                    w.u32(*to);
                }
                w.u8(plan.focus.len().min(255) as u8);
                for (car, tick) in plan.focus.iter().take(255) {
                    w.u32(*car);
                    w.u32(*tick);
                }
            }
            Self::ReplayReady { ready, total } => {
                w.u8(0x86);
                w.u8(*ready);
                w.u8(*total);
            }
            Self::Welcome {
                version,
                car_id,
                tick_rate,
                frame,
                match_type,
                team_size,
                map,
                key,
                match_id,
                snapshot,
            } => {
                w.u8(0x81);
                w.u16(*version);
                w.u32(*car_id);
                w.u8(*tick_rate);
                w.u32(*frame);
                w.u8(*match_type);
                w.u8(*team_size);
                w.u8(*map);
                w.u64(*key);
                w.u64(*match_id);
                w.bytes_with_len(snapshot);
            }
            Self::World { frame, snapshot } => {
                w.u8(0x82);
                w.u32(*frame);
                w.bytes_with_len(snapshot);
            }
            Self::Match(m) => {
                w.u8(0x84);
                w.u32(m.server_tick);
                w.u8(m.phase as u8);
                w.u8(u8::from(m.overtime)
                    | (u8::from(m.clock_running) << 1)
                    | (u8::from(m.forfeit) << 2)
                    | (u8::from(m.can_vote_forfeit) << 3)
                    | (u8::from(m.no_contest) << 4));
                w.u32(m.clock_ticks);
                w.u8(m.score[0]);
                w.u8(m.score[1]);
                w.u8(m.winner.unwrap_or(255));
                w.u8(m.seconds_left);
            }
            Self::Event { server_tick, event } => {
                w.u8(0x83);
                w.u32(*server_tick);
                match event {
                    GameEvent::Goal { team, scorer, assister } => {
                        w.u8(0);
                        w.u8(*team);
                        w.u32(*scorer);
                        w.u32(*assister);
                    }
                    GameEvent::Demo { attacker, victim } => {
                        w.u8(1);
                        w.u32(*attacker);
                        w.u32(*victim);
                    }
                    GameEvent::Left { car, lost, explode } => {
                        w.u8(2);
                        w.u32(*car);
                        w.u8(u8::from(*lost) | (u8::from(*explode) << 1));
                    }
                }
            }
        }
        let body = w.0;
        assert!(body.len() <= usize::from(u16::MAX), "control message too large");
        let mut framed = Vec::with_capacity(body.len() + 2);
        framed.extend_from_slice(&(body.len() as u16).to_le_bytes());
        framed.extend_from_slice(&body);
        framed
    }

    /// Decodes one message (without its length prefix).
    pub fn decode(body: &[u8]) -> Result<Self, DecodeError> {
        let mut r = Reader(body);
        Ok(match r.u8()? {
            0x01 => Self::Hello {
                version: r.u16()?,
                team: r.u8()?,
                model: r.u8()?,
                dodge_deadzone: r.f32()?,
                steering_sensitivity: r.f32()?,
                air_control_sensitivity: r.f32()?,
                auto_skip_replay: r.u8()? != 0,
                key: r.u64()?,
                name: r.name()?,
                quick_chat: r.u8()?,
                block_non_tactical: r.u8()? != 0,
                intent: r.u8()?,
                playlist: r.u8()?,
                token: r.u64()?,
                ticket: {
                    let ticket = r.ticket()?;
                    if !r.0.is_empty() {
                        return Err(DecodeError::Trailing);
                    }
                    ticket
                },
            },
            0x8F => Self::MatchFound { token: r.u64()?, map: r.u8()? },
            0x90 => Self::IdleWarning { on: r.u8()? != 0 },
            0x91 => Self::Kicked { reason: r.u8()? },
            0x92 => Self::SearchCooldown { seconds: r.u16()?, network: r.u8()? != 0 },
            0x08 => Self::Mute { car: r.u32()?, on: r.u8()? != 0 },
            0x06 => Self::QuickChat { preset: r.u8()?, team: r.u8()? != 0 },
            0x07 => Self::ChatFilter { quick_chat: r.u8()?, block_non_tactical: r.u8()? != 0 },
            0x88 => {
                let players = (0..r.u8()?)
                    .map(|_| Ok(RosterEntry { car: r.u32()?, team: r.u8()?, model: r.u8()?, name: r.name()? }))
                    .collect::<Result<_, DecodeError>>()?;
                Self::Roster(players)
            }
            0x89 => Self::Chat { car: r.u32()?, preset: r.u8()?, team: r.u8()? != 0, seconds: r.u16()? },
            0x8A => Self::ChatBlocked { seconds: r.f32()? },
            0x8B => Self::Refused { reason: r.u8()? },
            0x8C => {
                let n = r.u8()?;
                let mut entries = Vec::with_capacity(usize::from(n));
                for _ in 0..n {
                    let (car, ping, flags) = (r.u32()?, r.u16()?, r.u8()?);
                    let k = r.u8()?;
                    let counters = (0..k).map(|_| r.u16()).collect::<Result<Vec<_>, _>>()?;
                    let mut title = || -> Result<Option<PodiumTitle>, DecodeError> {
                        let (title, count) = (r.u8()?, r.u16()?);
                        Ok((title != NO_TITLE).then_some(PodiumTitle { title, count }))
                    };
                    let titles = [title()?, title()?];
                    entries.push(ScoreboardEntry {
                        car,
                        ping,
                        mvp: flags & 1 != 0,
                        ready: flags & 2 != 0,
                        counters,
                        titles,
                    });
                }
                Self::Scoreboard(entries)
            }
            0x8D => Self::StatEvent { event: r.u8()?, points: r.u16()? },
            0x8E => Self::Ticker { event: r.u8()?, receiver: r.u32()?, victim: r.u32()? },
            0x02 => Self::ResetInputBuffer,
            0x05 => Self::VoteForfeit,
            0x87 => {
                let (state, yes, required, seconds_left, flags) = (r.u8()?, r.u8()?, r.u8()?, r.u8()?, r.u8()?);
                Self::ForfeitVote(ForfeitVoteState {
                    state,
                    yes,
                    required,
                    seconds_left,
                    voted: flags & 1 != 0,
                    can_start: flags & 2 != 0,
                })
            }
            0x03 => Self::ReadyUp,
            0x04 => Self::AutoSkipReplay { on: r.u8()? != 0 },
            0x85 => {
                let (start_tick, goal_tick, end_tick, scoring_team) = (r.u32()?, r.u32()?, r.u32()?, r.u8()?);
                let slomo = (0..r.u8()?).map(|_| Ok((r.u32()?, r.u32()?))).collect::<Result<_, DecodeError>>()?;
                let focus = (0..r.u8()?).map(|_| Ok((r.u32()?, r.u32()?))).collect::<Result<_, DecodeError>>()?;
                Self::Replay(ReplayPlan { start_tick, goal_tick, end_tick, scoring_team, slomo, focus })
            }
            0x86 => Self::ReplayReady { ready: r.u8()?, total: r.u8()? },
            0x81 => Self::Welcome {
                version: r.u16()?,
                car_id: r.u32()?,
                tick_rate: r.u8()?,
                frame: r.u32()?,
                match_type: r.u8()?,
                team_size: r.u8()?,
                map: r.u8()?,
                key: r.u64()?,
                match_id: r.u64()?,
                snapshot: r.bytes_with_len()?,
            },
            0x82 => Self::World { frame: r.u32()?, snapshot: r.bytes_with_len()? },
            0x83 => {
                let server_tick = r.u32()?;
                let event = match r.u8()? {
                    0 => GameEvent::Goal { team: r.u8()?, scorer: r.u32()?, assister: r.u32()? },
                    1 => GameEvent::Demo { attacker: r.u32()?, victim: r.u32()? },
                    2 => {
                        let (car, flags) = (r.u32()?, r.u8()?);
                        GameEvent::Left { car, lost: flags & 1 != 0, explode: flags & 2 != 0 }
                    }
                    t => return Err(DecodeError::UnknownType(t)),
                };
                Self::Event { server_tick, event }
            }
            0x84 => {
                let server_tick = r.u32()?;
                let phase = match r.u8()? {
                    0 => Phase::Countdown,
                    1 => Phase::Active,
                    2 => Phase::PostGoal,
                    3 => Phase::TimeUp,
                    4 => Phase::PrePodium,
                    5 => Phase::Replay,
                    6 => Phase::Waiting,
                    7 => Phase::Podium,
                    8 => Phase::Finished,
                    t => return Err(DecodeError::UnknownType(t)),
                };
                let flags = r.u8()?;
                let clock_ticks = r.u32()?;
                let score = [r.u8()?, r.u8()?];
                let winner = Some(r.u8()?).filter(|&w| w != 255);
                let seconds_left = r.u8()?;
                Self::Match(MatchState {
                    server_tick,
                    phase,
                    overtime: flags & 1 != 0,
                    clock_running: flags & 2 != 0,
                    clock_ticks,
                    score,
                    winner,
                    forfeit: flags & 4 != 0,
                    can_vote_forfeit: flags & 8 != 0,
                    no_contest: flags & 16 != 0,
                    seconds_left,
                })
            }
            t => return Err(DecodeError::UnknownType(t)),
        })
    }
}

impl Datagram {
    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        match self {
            Self::Inputs { timestamp, sequence, first_frame, frames } => {
                w.u8(0x01);
                w.u32(*timestamp);
                w.u16(*sequence);
                w.u32(*first_frame);
                w.u8(frames.len() as u8);
                for f in frames {
                    for axis in [f.throttle, f.steer, f.pitch, f.yaw, f.roll, f.dodge_forward] {
                        w.i8(axis);
                    }
                    w.u8(f.bits);
                }
            }
            Self::Update(u) => {
                w.u8(0x81);
                w.u32(u.server_tick);
                w.u32(u.ack_frame);
                w.u32(u.received_frame);
                w.u32(u.echo_timestamp);
                w.u16(u.echo_delay);
                w.u8(u.buffer_target);
                w.u8(u.buffer_size);
                for v in [u.buffer_low, u.buffer_high, u.buffer_over, u.buffer_under, u.input_loss] {
                    w.u8(v);
                }
                w.u8(u.part);
                w.u8(u.parts);
                w.0.extend_from_slice(&u.state);
            }
        }
        w.0
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut r = Reader(bytes);
        Ok(match r.u8()? {
            0x01 => {
                let timestamp = r.u32()?;
                let sequence = r.u16()?;
                let first_frame = r.u32()?;
                let count = usize::from(r.u8()?);
                if count > MAX_INPUT_FRAMES {
                    return Err(DecodeError::TooLarge);
                }
                let mut frames = Vec::with_capacity(count);
                for _ in 0..count {
                    frames.push(InputFrame {
                        throttle: r.i8()?,
                        steer: r.i8()?,
                        pitch: r.i8()?,
                        yaw: r.i8()?,
                        roll: r.i8()?,
                        dodge_forward: r.i8()?,
                        bits: r.u8()?,
                    });
                }
                Self::Inputs { timestamp, sequence, first_frame, frames }
            }
            0x81 => Self::Update(Update {
                server_tick: r.u32()?,
                ack_frame: r.u32()?,
                received_frame: r.u32()?,
                echo_timestamp: r.u32()?,
                echo_delay: r.u16()?,
                buffer_target: r.u8()?,
                buffer_size: r.u8()?,
                buffer_low: r.u8()?,
                buffer_high: r.u8()?,
                buffer_over: r.u8()?,
                buffer_under: r.u8()?,
                input_loss: r.u8()?,
                part: r.u8()?,
                parts: r.u8()?,
                state: r.rest(),
            }),
            t => return Err(DecodeError::UnknownType(t)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vectors() -> Value {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../protocol/vectors.json")).unwrap();
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn a_hello_with_bytes_after_its_ticket_is_refused() {
        let hello = Control::Hello {
            version: VERSION,
            team: 255,
            model: 0,
            dodge_deadzone: 0.5,
            steering_sensitivity: 1.0,
            air_control_sensitivity: 1.0,
            auto_skip_replay: false,
            key: 0,
            name: String::new(),
            quick_chat: CHAT_EVERYONE,
            block_non_tactical: false,
            intent: INTENT_SEARCH,
            playlist: 1,
            token: 0,
            ticket: "abc".into(),
        };
        let bytes = hello.encode();
        assert!(matches!(Control::decode(&bytes[2..]), Ok(Control::Hello { ticket, .. }) if ticket == "abc"));
        let mut longer = bytes[2..].to_vec();
        longer.push(0);
        assert!(matches!(Control::decode(&longer), Err(DecodeError::Trailing)), "AP2-12");
        drop(hello);
    }

    #[test]
    fn the_vectors_are_this_versions() {
        assert_eq!(vectors()["protocolVersion"].as_u64(), Some(u64::from(VERSION)));
        let hello =
            vectors()["vectors"].as_array().unwrap().iter().find(|v| v["message"]["type"] == "hello").cloned().unwrap();
        assert_eq!(
            hello["message"]["version"].as_u64(),
            Some(u64::from(VERSION)),
            "the Hello vector carries this version (RV-257)"
        );
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    fn f(v: &Value) -> f32 {
        v.as_f64().unwrap() as f32
    }
    fn u(v: &Value) -> u32 {
        v.as_u64().unwrap() as u32
    }
    /// A 64-bit value (a decimal string in the JSON: a JS number can't hold it)
    fn big(v: &Value) -> u64 {
        v.as_str().unwrap().parse().unwrap()
    }
    fn bytes(v: &Value) -> Vec<u8> {
        v.as_array().unwrap().iter().map(|b| b.as_u64().unwrap() as u8).collect()
    }

    fn control_from_json(m: &Value) -> Control {
        match m["type"].as_str().unwrap() {
            "hello" => Control::Hello {
                version: u(&m["version"]) as u16,
                team: u(&m["team"]) as u8,
                model: u(&m["model"]) as u8,
                dodge_deadzone: f(&m["dodgeDeadzone"]),
                steering_sensitivity: f(&m["steeringSensitivity"]),
                air_control_sensitivity: f(&m["airControlSensitivity"]),
                auto_skip_replay: m["autoSkipReplay"].as_bool().unwrap(),
                key: big(&m["key"]),
                name: m["name"].as_str().unwrap().to_string(),
                quick_chat: ["everyone", "team", "friends", "off"].iter().position(|&f| f == m["quickChat"]).unwrap()
                    as u8,
                block_non_tactical: m["blockNonTactical"].as_bool().unwrap(),
                intent: ["join", "search", "claim", "rejoin"].iter().position(|&i| i == m["intent"]).unwrap() as u8,
                playlist: u(&m["playlist"]) as u8,
                token: big(&m["token"]),
                ticket: m["ticket"].as_str().unwrap().to_string(),
            },
            "matchFound" => Control::MatchFound { token: big(&m["token"]), map: u(&m["map"]) as u8 },
            "idleWarning" => Control::IdleWarning { on: m["on"].as_bool().unwrap() },
            "kicked" => Control::Kicked { reason: u(&m["reason"]) as u8 },
            "searchCooldown" => {
                Control::SearchCooldown { seconds: u(&m["seconds"]) as u16, network: m["network"].as_bool().unwrap() }
            }
            "mute" => Control::Mute { car: u(&m["car"]), on: m["on"].as_bool().unwrap() },
            "scoreboard" => Control::Scoreboard(
                m["players"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| ScoreboardEntry {
                        car: u(&p["car"]),
                        ping: u(&p["ping"]) as u16,
                        mvp: p["mvp"].as_bool().unwrap(),
                        ready: p["ready"].as_bool().unwrap(),
                        counters: p["counters"].as_array().unwrap().iter().map(|c| u(c) as u16).collect(),
                        titles: [0, 1].map(|i| {
                            let t = &p["titles"][i];
                            (!t.is_null())
                                .then(|| PodiumTitle { title: u(&t["title"]) as u8, count: u(&t["count"]) as u16 })
                        }),
                    })
                    .collect(),
            ),
            "statEvent" => Control::StatEvent { event: u(&m["event"]) as u8, points: u(&m["points"]) as u16 },
            "ticker" => {
                Control::Ticker { event: u(&m["event"]) as u8, receiver: u(&m["receiver"]), victim: u(&m["victim"]) }
            }
            "quickChat" => Control::QuickChat { preset: u(&m["preset"]) as u8, team: m["team"].as_bool().unwrap() },
            "chatFilter" => Control::ChatFilter {
                quick_chat: ["everyone", "team", "friends", "off"].iter().position(|&f| f == m["quickChat"]).unwrap()
                    as u8,
                block_non_tactical: m["blockNonTactical"].as_bool().unwrap(),
            },
            "roster" => Control::Roster(
                m["players"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| RosterEntry {
                        car: u(&p["car"]),
                        team: u(&p["team"]) as u8,
                        model: u(&p["model"]) as u8,
                        name: p["name"].as_str().unwrap().to_string(),
                    })
                    .collect(),
            ),
            "chat" => Control::Chat {
                car: u(&m["car"]),
                preset: u(&m["preset"]) as u8,
                team: m["team"].as_bool().unwrap(),
                seconds: u(&m["seconds"]) as u16,
            },
            "chatBlocked" => Control::ChatBlocked { seconds: f(&m["seconds"]) },
            "refused" => Control::Refused { reason: u(&m["reason"]) as u8 },
            "readyUp" => Control::ReadyUp,
            "autoSkipReplay" => Control::AutoSkipReplay { on: m["on"].as_bool().unwrap() },
            "replay" => {
                let pairs = |v: &Value| v.as_array().unwrap().iter().map(|p| (u(&p[0]), u(&p[1]))).collect();
                Control::Replay(ReplayPlan {
                    start_tick: u(&m["startTick"]),
                    goal_tick: u(&m["goalTick"]),
                    end_tick: u(&m["endTick"]),
                    scoring_team: u(&m["scoringTeam"]) as u8,
                    slomo: pairs(&m["slomo"]),
                    focus: m["focus"].as_array().unwrap().iter().map(|p| (u(&p["car"]), u(&p["tick"]))).collect(),
                })
            }
            "replayReady" => Control::ReplayReady { ready: u(&m["ready"]) as u8, total: u(&m["total"]) as u8 },
            "welcome" => Control::Welcome {
                version: u(&m["version"]) as u16,
                car_id: u(&m["carId"]),
                tick_rate: u(&m["tickRate"]) as u8,
                frame: u(&m["frame"]),
                match_type: ["casual", "ranked", "private"].iter().position(|&t| t == m["matchType"]).unwrap() as u8,
                team_size: u(&m["teamSize"]) as u8,
                map: u(&m["map"]) as u8,
                key: big(&m["key"]),
                match_id: big(&m["matchId"]),
                snapshot: bytes(&m["snapshot"]),
            },
            "voteForfeit" => Control::VoteForfeit,
            "forfeitVote" => Control::ForfeitVote(ForfeitVoteState {
                state: ["running", "passed", "failed", "none"].iter().position(|&s| s == m["state"]).unwrap() as u8,
                yes: u(&m["yes"]) as u8,
                required: u(&m["required"]) as u8,
                seconds_left: u(&m["secondsLeft"]) as u8,
                voted: m["voted"].as_bool().unwrap(),
                can_start: m["canStart"].as_bool().unwrap(),
            }),
            "resetInputBuffer" => Control::ResetInputBuffer,
            "world" => Control::World { frame: u(&m["frame"]), snapshot: bytes(&m["snapshot"]) },
            "event" => Control::Event {
                server_tick: u(&m["serverTick"]),
                event: match m["event"]["kind"].as_str().unwrap() {
                    "goal" => GameEvent::Goal {
                        team: u(&m["event"]["team"]) as u8,
                        scorer: u(&m["event"]["scorer"]),
                        assister: u(&m["event"]["assister"]),
                    },
                    "left" => GameEvent::Left {
                        car: u(&m["event"]["car"]),
                        lost: m["event"]["lost"].as_bool().unwrap(),
                        explode: m["event"]["explode"].as_bool().unwrap(),
                    },
                    _ => GameEvent::Demo { attacker: u(&m["event"]["attacker"]), victim: u(&m["event"]["victim"]) },
                },
            },
            "match" => Control::Match(MatchState {
                server_tick: u(&m["serverTick"]),
                phase: match m["phase"].as_str().unwrap() {
                    "countdown" => Phase::Countdown,
                    "active" => Phase::Active,
                    "postGoal" => Phase::PostGoal,
                    "timeUp" => Phase::TimeUp,
                    "replay" => Phase::Replay,
                    "waiting" => Phase::Waiting,
                    "podium" => Phase::Podium,
                    "finished" => Phase::Finished,
                    _ => Phase::PrePodium,
                },
                overtime: m["overtime"].as_bool().unwrap(),
                clock_running: m["clockRunning"].as_bool().unwrap(),
                clock_ticks: u(&m["clockTicks"]),
                score: [u(&m["score"][0]) as u8, u(&m["score"][1]) as u8],
                winner: m["winner"].as_u64().map(|w| w as u8),
                forfeit: m["forfeit"].as_bool().unwrap(),
                can_vote_forfeit: m["canVoteForfeit"].as_bool().unwrap(),
                no_contest: m["noContest"].as_bool().unwrap(),
                seconds_left: u(&m["secondsLeft"]) as u8,
            }),
            t => panic!("unknown {t}"),
        }
    }

    fn datagram_from_json(m: &Value) -> Datagram {
        match m["type"].as_str().unwrap() {
            "inputs" => Datagram::Inputs {
                timestamp: u(&m["timestamp"]),
                sequence: u(&m["sequence"]) as u16,
                first_frame: u(&m["firstFrame"]),
                frames: m["frames"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|fr| {
                        let bit = |name: &str, b: u8| if fr[name].as_bool().unwrap() { b } else { 0 };
                        InputFrame {
                            throttle: quantize_axis(f(&fr["throttle"])),
                            steer: quantize_axis(f(&fr["steer"])),
                            pitch: quantize_axis(f(&fr["pitch"])),
                            yaw: quantize_axis(f(&fr["yaw"])),
                            roll: quantize_axis(f(&fr["roll"])),
                            dodge_forward: quantize_axis(f(&fr["dodgeForward"])),
                            bits: bit("jump", BIT_JUMP)
                                | bit("boost", BIT_BOOST)
                                | bit("handbrake", BIT_HANDBRAKE)
                                | bit("airPitchSafety", BIT_AIR_PITCH_SAFETY),
                        }
                    })
                    .collect(),
            },
            _ => Datagram::Update(Update {
                server_tick: u(&m["serverTick"]),
                ack_frame: u(&m["ackFrame"]),
                received_frame: u(&m["receivedFrame"]),
                echo_timestamp: u(&m["echoTimestamp"]),
                echo_delay: u(&m["echoDelay"]) as u16,
                buffer_target: u(&m["bufferTarget"]) as u8,
                buffer_size: u(&m["bufferSize"]) as u8,
                buffer_low: u(&m["bufferLow"]) as u8,
                buffer_high: u(&m["bufferHigh"]) as u8,
                buffer_over: u(&m["bufferOver"]) as u8,
                buffer_under: u(&m["bufferUnder"]) as u8,
                input_loss: u(&m["inputLoss"]) as u8,
                part: u(&m["part"]) as u8,
                parts: u(&m["parts"]) as u8,
                state: bytes(&m["state"]),
            }),
        }
    }

    #[test]
    fn reset_input_buffer_round_trips() {
        let bytes = Control::ResetInputBuffer.encode();
        assert_eq!(bytes, vec![1, 0, 0x02]);
        assert_eq!(Control::decode(&bytes[2..]).unwrap(), Control::ResetInputBuffer);
    }

    #[test]
    fn a_hellos_version_is_read_before_its_fields_whatever_the_version() {
        // (version 11's hello, its version set: two bytes short of ours, so it doesn't decode as ours: RV-243, RV-262)
        let v11 = hex("2200010b000000cdcc4c3f0000803f0000a03f01efbeadde0b4d65726375727920e29aa1");
        assert_eq!(hello_version(&v11[2..]), Some(11));
        assert!(Control::decode(&v11[2..]).is_err());
        let ours = Control::Hello {
            version: VERSION,
            team: 0,
            model: 0,
            dodge_deadzone: 0.5,
            steering_sensitivity: 1.0,
            air_control_sensitivity: 1.0,
            auto_skip_replay: false,
            key: 0,
            name: String::new(),
            quick_chat: CHAT_EVERYONE,
            block_non_tactical: false,
            intent: INTENT_JOIN,
            playlist: 0,
            token: 0,
            ticket: String::new(),
        }
        .encode();
        assert_eq!(hello_version(&ours[2..]), Some(VERSION));
        assert_eq!(hello_version(&[0x81, 11, 0]), None, "a welcome");
        assert_eq!(hello_version(&[0x01, 11]), None, "too short");
    }

    #[test]
    fn the_kick_reasons_are_the_shared_vectors() {
        // (KICK_* as the client's net/protocol.ts reads them, each the shared vector's: idle, not all joined, replaced;
        // RV-503's SM2: the constants themselves pinned, not only the JSON's numbers)
        let v = vectors();
        let kicked: Vec<(u8, Vec<u8>)> = v["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|vector| vector["message"]["type"] == "kicked")
            .map(|vector| (u(&vector["message"]["reason"]) as u8, hex(vector["hex"].as_str().unwrap())))
            .collect();
        for reason in [KICK_IDLE, KICK_NOT_ALL_JOINED, KICK_REPLACED] {
            let expected = kicked.iter().find(|(r, _)| *r == reason).map(|(_, bytes)| bytes.clone());
            assert_eq!(Some(Control::Kicked { reason }.encode()), expected, "reason {reason}");
        }
        assert_eq!((KICK_IDLE, KICK_NOT_ALL_JOINED, KICK_REPLACED), (0, 1, 2));
    }

    #[test]
    fn matches_the_shared_vectors() {
        let v = vectors();
        for vector in v["vectors"].as_array().unwrap() {
            let expected = hex(vector["hex"].as_str().unwrap());
            let message = &vector["message"];
            if vector["channel"] == "control" {
                let m = control_from_json(message);
                assert_eq!(m.encode(), expected, "{message}");
                assert_eq!(Control::decode(&expected[2..]).unwrap(), m);
            } else {
                let m = datagram_from_json(message);
                assert_eq!(m.encode(), expected, "{message}");
                assert_eq!(Datagram::decode(&expected).unwrap(), m);
            }
        }
    }

    #[test]
    fn dequantized_axes_are_the_same_floats_everywhere() {
        let v = vectors();
        let bits = v["dequantizedAxes"]["bits"].as_array().unwrap();
        assert_eq!(bits.len(), 256);
        for (i, b) in bits.iter().enumerate() {
            let q = i as i32 - 128;
            let expected = u32::from_str_radix(b.as_str().unwrap(), 16).unwrap();
            assert_eq!(dequantize_axis(q as i8).to_bits(), expected, "q = {q}");
            assert_eq!(quantize_axis(dequantize_axis(q as i8)), q as i8);
        }
    }

    #[test]
    fn quantizes_like_the_game() {
        assert_eq!(quantize_axis(-1.0), -128);
        assert_eq!(quantize_axis(1.0), 127);
        assert_eq!(quantize_axis(-0.7), -90);
        assert_eq!(quantize_axis(0.7), 89);
        assert_eq!(quantize_axis(-63.5 / 128.0), -63); // halves up
        assert_eq!(quantize_axis(63.5 / 127.0), 64);
    }

    #[test]
    fn rejects_garbage() {
        assert!(Datagram::decode(&[]).is_err());
        assert!(Datagram::decode(&[0x01, 1, 2]).is_err());
        assert!(Datagram::decode(&[0x7f]).is_err());
        // (timestamp, sequence, first frame, then a count over the most)
        let mut too_many = vec![0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11];
        too_many.extend(std::iter::repeat_n(0, 66));
        assert!(Datagram::decode(&too_many).is_err());
    }
}
