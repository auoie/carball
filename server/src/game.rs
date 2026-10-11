//! The match: one arena, its players, the 120 Hz tick, and what each player is sent (`protocol/README.md`,
//! `notes/netcode.md`). No networking here: messages go out through each player's channel, so this is testable.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use tokio::sync::mpsc::Sender;

use crate::engine::{Arena, Award, Controls, Event, STAT_COUNTERS, StatCounters, StatsState, stat_event_points};
use crate::input_buffer::InputBuffer;
use crate::protocol::{self, Control, Datagram, ForfeitVoteState, GameEvent, InputFrame, MatchState, Phase, PodiumTitle, ReplayPlan, ScoreboardEntry, Update, stat};

pub const TICK_RATE: u32 = 120;
/// Updates go out every other tick (60 Hz)
const UPDATE_EVERY_TICKS: u64 = 2;
/// Cars away from the ball and the boost pads: every 8 ticks (15 Hz, `Car_TA.NetUpdateFrequency`)
const SLOW_UPDATE_EVERY_TICKS: u64 = 8;
/// Cars this close to the ball go in every update (`NetworkConfig_TA.ForcePacketSignificantDistance`)
const NEAR_BALL_DISTANCE: f32 = 1000.0;
/// Datagram budget for an update (QUIC datagrams are limited by the path MTU, ~1200 bytes)
pub const MAX_DATAGRAM: usize = 1100;
const UPDATE_HEADER: usize = 25;
/// After a goal, the goal replay or the next kickoff (`GameEvent_Soccar_TA.PostGoalTime` 3.0 game s; ticks, which keep
/// their 120 per game second through the slow motion)
const POST_GOAL_TICKS: u64 = 3 * TICK_RATE as u64;
/// The slow motion after a goal (`ScoreSlomoCurve`: game seconds since the goal, time dilation; linear, clamped):
/// `notes/camera-respawn-goal.md` GS-2, the same as the client's `src/game/goalSequence.ts`
const SCORE_SLOMO_CURVE: [(f64, f64); 3] = [(0.125, 1.0), (0.225, 0.1875), (0.625, 1.0)];
/// The goal replay (`ReplayDirector` archetype; ticks): shown from the scoring touch less `REPLAY_PADDING`, at most
/// `MAX_REPLAY` before the goal, at least `MIN_REPLAY` + the padding
const MIN_REPLAY_TICKS: i64 = 4 * TICK_RATE as i64;
const MAX_REPLAY_TICKS: i64 = 10 * TICK_RATE as i64;
const REPLAY_PADDING_TICKS: i64 = 2 * TICK_RATE as i64;
/// Slowed round the scoring touch (`SlomoPreScoreTime` 0.25 s, `SlomoPostScoreTime` 0.1 s) and before the goal when a
/// defender was close (`SlomoDefendTime` 0.25 s), to `SlomoTimeDilation`
const SLOMO_PRE_SCORE_TICKS: i64 = 30;
const SLOMO_POST_SCORE_TICKS: i64 = 12;
const SLOMO_DEFEND_TICKS: i64 = 30;
const SLOMO_TIME_DILATION: f64 = 0.25;
/// A defender this close to the ball at the goal (`SlomoDefendDistance` 200 + the car's cylinder radius 48 + the
/// ball's radius 95.49: `SetSlomoForDefender`)
const SLOMO_DEFEND_DISTANCE: f32 = 200.0 + 48.0 + 95.49;
/// Ball touches kept (`Ball_TA` keeps 50)
const MAX_TOUCHES: usize = 50;
/// After a kickoff reset, the cars get no input for this long (replays: the first car moves 3.99-4.05 s after the
/// reset; the "3-2-1" countdown plus a second)
const KICKOFF_COUNTDOWN_SECONDS: f32 = 4.0;
/// A client's jitter buffer resets at most this often (s)
const MIN_RESET_INTERVAL: f64 = 1.0;
/// Before a match's first kickoff countdown, the cars wait frozen at their spots (`WarmupTime` 3 s)
const WARMUP_SECONDS: f32 = 3.0;
/// A team's size (`GameEvent_Team_TA.MaxTeamSize`: the soccar archetype's 3; it grows when a team has more players)
pub const TEAM_SIZE: u8 = 3;
/// The match clock (`GameEvent_Soccar_TA.GameTime` 300 s)
pub const MATCH_TICKS: u32 = 300 * TICK_RATE;
/// The clock starts at the first touch, or this long after "go" (`BallHasBeenHitStartDelay` 5.0 s)
const CLOCK_START_DELAY_TICKS: u64 = 5 * TICK_RATE as u64;
/// After the match (notes/match-intro-outro.md MIO-10): the winner shown, the world frozen (`PrePodiumSpotlight`:
/// PodiumDelay 3.0 s); the podium (`PodiumSpotlight`: PodiumTime 5.3 s); the end screen (`Finished`: FinishTime 60 s,
/// ready-up allowed after 1 s, every player ready starts the next match)
const PRE_PODIUM_SECONDS: f32 = 3.0;
const PODIUM_SECONDS: f32 = 5.3;
const FINISH_SECONDS: u32 = 60;
const READY_UP_DELAY_SECONDS: f32 = 1.0;
/// The podium's spots for blue winners (MIO-11, the winners-explosion variant: 3000 uu in front of their own goal), the
/// MVP's first: x, y, yaw (rotator units). Orange's are point-mirrored
const PODIUM_SPOTS: [(f32, f32, i32); 4] =
    [(-40.0, -1670.0, 16384 + 6248), (-200.0, -1795.0, 16384 + 57784), (150.0, -1820.0, 16384 + 10548), (-115.0, -2020.0, 16384 + 13848)];
/// A player's outgoing queue (control messages and datagrams for their session): a client that stops reading its control
/// stream fills it, and is dropped (RV-248)
pub const OUT_QUEUE: usize = 2048;

/// A match's players at most (a 4v4 private match's, twice over: each car adds about 0.7 KB to the world snapshot a join
/// sends, a u16-framed control message, which 90 cars would overflow: RV-242)
pub const MAX_PLAYERS: usize = 16;
/// A forfeit vote runs 20 game s (`ForfeitVoteArchetype.TimeRemaining`, less 1 each game second); a finished one stays
/// 5 s more (destroyed 5 s after `FinishVote`)
const FORFEIT_VOTE_SECONDS: u64 = 20;
const FORFEIT_VOTE_LINGER_TICKS: u64 = 5 * TICK_RATE as u64;
/// A leave's forfeit check runs 0.01 game s later (`CheckAllTeamsForfeitState`'s timer): the second tick after it
const FORFEIT_CHECK_TICKS: u64 = 2;

pub type PlayerId = u64;

/// The match type (`MatchType_TA`; a server option): when forfeit votes are allowed and their label, and whether a team
/// left without players forfeits (notes/match-rules-audit.md MR-7)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchType {
    Casual = 0,
    Ranked = 1,
    Private = 2,
}

impl MatchType {
    /// The clock time before forfeit votes (`ForfeitVoteWaitGameTime`: casual 60 s; ranked, and the base, 90 s)
    fn forfeit_wait_ticks(self) -> u32 {
        if self == Self::Casual { 60 * TICK_RATE } else { 90 * TICK_RATE }
    }

    /// A team left without players forfeits (`CanCheckForForfeit`: public match types, once their 30 s wait for players
    /// is over, which our matches don't have; private matches never)
    fn auto_forfeit(self) -> bool {
        self != Self::Private
    }

    /// The playlist allows forfeit votes (`bAllowForfeit || bApplyQuitPenalty || PlayerCount == 2`: casual and ranked
    /// have the quit penalty; a private match's flags aren't known, MR §9.3, so its 1v1s only)
    fn allows_forfeit(self, team_size: u8) -> bool {
        self != Self::Private || team_size == 1
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Outgoing {
    Control(Vec<u8>),
    Datagram(Vec<u8>),
}

/// What a joining player asked for (their `Hello`)
#[derive(Clone, Debug)]
pub struct JoinRequest {
    pub team: u8,
    pub body: u8,
    pub dodge_deadzone: f32,
    pub steering_sensitivity: f32,
    pub air_control_sensitivity: f32,
    pub auto_skip_replay: bool,
    /// The client's key, the same when it reconnects
    pub key: u32,
    /// The name it asked for (tidied: `player_name`)
    pub name: String,
    /// Its chat filters from the start (`protocol::CHAT_*`; RV-259)
    pub quick_chat: u8,
    pub block_non_tactical: bool,
}

/// The chat spam filter (`ApplyChatSpamFilter`, `ChatSpam`: notes/quick-chat.md CHAT-10..12): a per-player leaky bucket on
/// real time, shared by every channel
const CHAT_RISE: f64 = 1.2;
const CHAT_RISE_MULTIPLIER: f64 = 0.75;
const CHAT_DECAY: f64 = 1.0;
const CHAT_MAX: f64 = 4.0;

#[derive(Clone, Copy, Debug, Default)]
struct ChatBucket {
    value: f64,
    last: f64,
}

impl ChatBucket {
    /// A message at `now` (real s): None when it passes, else the seconds until chat is allowed again (a blocked
    /// attempt decays the bucket and adds nothing)
    fn apply(&mut self, now: f64) -> Option<f64> {
        self.value = (self.value - CHAT_DECAY * (now - self.last)).max(0.0);
        self.last = now;
        if self.value > CHAT_MAX {
            return Some((self.value - CHAT_MAX) / CHAT_DECAY);
        }
        self.value += CHAT_RISE + self.value * CHAT_RISE_MULTIPLIER;
        None
    }
}

/// A preset is tactical (the Block Non-Tactical filter's rule: Group1, Group5 and Group6, by the preset's group)
fn tactical(preset: u8) -> bool {
    !(22..59).contains(&preset) // (Group1: 0-21; Group5, Group6: 59-75)
}

/// Characters a name may not have (RV-249): format characters (Cf: the bidi controls that would turn a chat line round,
/// zero-width ones, the BOM), the line and paragraph separators (Zl, Zp), the invisible fillers a name could be made of
/// alone, and the replacement character an invalid UTF-8 name decodes to
fn hidden_char(c: char) -> bool {
    c.is_control()
        || matches!(c as u32,
            0x00AD | 0x034F | 0x061C | 0x115F | 0x1160 | 0x17B4 | 0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F | 0x2028..=0x202E
            | 0x2060..=0x206F | 0x2800 | 0x3164 | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF9..=0xFFFD | 0x1D173..=0x1D17A
            | 0xE0000..=0xE0FFF)
}

/// The name a player asked for, tidied: hidden characters dropped, trimmed, `MAX_NAME_BYTES` at most; none left, or another
/// player's automatic name ("Player 7"): "Player N"
fn player_name(asked: &str, id: PlayerId) -> String {
    let clean: String = asked.chars().filter(|&c| !hidden_char(c)).collect();
    let mut name = clean.trim().to_string();
    let mut end = name.len().min(protocol::MAX_NAME_BYTES);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    name.truncate(end);
    let name = name.trim_end().to_string();
    let reserved = name.strip_prefix("Player ").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
    if name.is_empty() || reserved { format!("Player {id}") } else { name }
}

/// A run of one car's touches on the ball (`Ball_TA` touches, consecutive ones by a car merged): its last tick
#[derive(Clone, Copy, Debug)]
struct Touch {
    car: u32,
    team: u8,
    tick: u64,
}

/// A team's forfeit vote (`ForfeitVote_TA`, MR-7.1-7.4)
struct ForfeitVote {
    /// Its voters (the team's players; a joiner added, a leaver removed while it runs) and each one's yes
    voters: BTreeMap<PlayerId, bool>,
    started: u64,
    /// Whether it passed, and when it finished (`FinishVote`)
    finished: Option<(bool, u64)>,
}

impl ForfeitVote {
    fn yes(&self) -> usize {
        self.voters.values().filter(|&&yes| yes).count()
    }

    /// Unanimous (`bUnanimousVote`: every voter's yes; the game excuses idle-banned voters, which we don't have)
    fn passed(&self) -> bool {
        !self.voters.is_empty() && self.yes() >= self.voters.len()
    }

    /// `TimeRemaining`: 20 less each whole game second it ran
    fn seconds_left(&self, tick: u64) -> u64 {
        let at = self.finished.map_or(tick, |(_, at)| at);
        FORFEIT_VOTE_SECONDS.saturating_sub((at - self.started) / u64::from(TICK_RATE))
    }
}

/// The time dilation `game_seconds` after a goal (`ScoreSlomoCurve`)
fn score_slomo(game_seconds: f64) -> f64 {
    let [(x0, y0), (x1, y1), (x2, y2)] = SCORE_SLOMO_CURVE;
    if game_seconds <= x0 {
        y0
    } else if game_seconds <= x1 {
        y0 + (y1 - y0) * (game_seconds - x0) / (x1 - x0)
    } else if game_seconds <= x2 {
        y1 + (y2 - y1) * (game_seconds - x1) / (x2 - x1)
    } else {
        y2
    }
}

/// The seconds the clock shows (`Active.UpdateGameTime`: int(t) + 1, 0 at t ≤ 0; regulation 300 before it first runs:
/// notes/visual-timing.md VT-23): an update goes out when it changes, so clients show it on time
fn shown_seconds(s: &MatchState) -> u32 {
    if !s.overtime && s.clock_ticks >= MATCH_TICKS {
        return MATCH_TICKS / TICK_RATE;
    }
    if s.clock_ticks == 0 { 0 } else { s.clock_ticks / TICK_RATE + 1 }
}

/// Real seconds the replay lasts: its length, each slowed stretch 1 / 0.25 times over
fn replay_seconds(plan: &ReplayPlan) -> f64 {
    let length = f64::from(plan.end_tick - plan.start_tick);
    let slowed: f64 = plan.slomo.iter().map(|&(from, to)| f64::from(to - from)).sum();
    (length + slowed * (1.0 / SLOMO_TIME_DILATION - 1.0)) / f64::from(TICK_RATE)
}

struct Player {
    car_id: u32,
    team: u8,
    input: InputBuffer,
    out: Sender<Outgoing>,
    /// Newest input packet timestamp and when it arrived (for the ping echo)
    echo: Option<(u32, f64)>,
    /// When its jitter buffer was last reset (s)
    last_reset: Option<f64>,
    /// Skips every goal replay (auto-ready)
    auto_skip_replay: bool,
    /// Ready to skip this goal replay
    ready: bool,
    key: u32,
    /// They may not start a forfeit vote (`SetStartVoteToForfeitDisabled`: they started one, until their team is
    /// re-enabled; at a join, if their key started one this match)
    vote_start_disabled: bool,
    /// Their team's forfeit vote as last sent to them
    vote_sent: Option<ForfeitVoteState>,
    name: String,
    chat: ChatBucket,
    /// Their quick-chat filter (`protocol::CHAT_*`) and whether they block others' non-tactical presets
    chat_filter: u8,
    block_non_tactical: bool,
    /// The cars whose chat they muted (`VoiceMuteList`: the server doesn't relay those lines to them)
    muted: BTreeSet<u32>,
    /// The last spam notice: when (real s) and its whole seconds (RV-248: one per second at most, or when it changes)
    blocked_notice: Option<(f64, u32)>,
    /// Their match counters as the engine last gave them (`PRI_TA` Match*)
    stats: StatCounters,
    /// Their podium titles (`PRI_TA.PrimaryTitle`/`SecondaryTitle`: the match's end, none before)
    titles: [Option<PodiumTitle>; 2],
    /// Round-trip time (ms), as the connection measures it
    ping: u16,
}

pub struct Game {
    arena: Arena,
    players: BTreeMap<PlayerId, Player>,
    /// Seeds each match's kickoff spot order (the game's is random: `RandomizeSpawnPoints`)
    match_seed: i32,
    /// The playlist's team size
    team_size: u8,
    phase: Phase,
    /// PostGoal: the replay's (or the next round's) tick; Replay: its end; Ended: the next match's
    phase_until: u64,
    /// The last goal's tick (the slow motion after it)
    goal_tick: u64,
    /// The ball's touches this round, oldest first
    touches: VecDeque<Touch>,
    /// Each car's latest touch seen (the engine's)
    last_touch: BTreeMap<u32, u64>,
    /// When the ball was last placed (the kickoff reset: the replay starts no earlier)
    ball_spawn_tick: u64,
    /// A defender was close to the ball at a goal: replays slow down before the goal (`bSlomoForDefender`, which
    /// nothing in the game's script clears: for the rest of the match)
    slomo_for_defender: bool,
    /// The last goal's replay, until it plays
    replay: Option<ReplayPlan>,
    /// The ready count last sent in a replay (ready, total)
    ready_sent: Option<(u8, u8)>,
    /// When the countdown ended ("go")
    go_tick: u64,
    /// Regulation: ticks left; overtime: ticks played
    clock_ticks: u32,
    overtime: bool,
    clock_running: bool,
    winner: Option<u8>,
    forfeit: bool,
    /// Every team left (`bNoContest`)
    no_contest: bool,
    /// The match type (casual unless set before players join)
    pub match_type: MatchType,
    /// The playlist's clock time before forfeit votes, in ticks, when not the match type's (`ForfeitVoteWaitGameTime`)
    pub forfeit_vote_wait: Option<u32>,
    /// Each team's forfeit vote, while it runs and for 5 s after
    votes: [Option<ForfeitVote>; 2],
    /// The keys that started a forfeit vote this match: only grows (`ForfeitInitiatorIDs`: a starter who rejoins can't
    /// start another, `CheckInitiatedForfeit`)
    initiators: BTreeSet<u32>,
    /// The keys this server gave out, and the next one's seed (RV-239: the server's, so two tabs can't share one); a
    /// new match keeps only those of the players here (RV-270)
    issued_keys: BTreeSet<u32>,
    key_seed: u32,
    /// A team forfeited after a goal: the match ends at the next round (`bForfeit`, MRL-13)
    forfeiting: Option<u8>,
    /// The teams players left since the last forfeit check, and the check's tick (`PlayersRemovedThisFrame`)
    left_teams: Vec<u8>,
    forfeit_check_at: Option<u64>,
    pub score: [u32; 2],
    /// The match state last sent
    sent: Option<MatchState>,
    /// Browser tests: each round, the ball is knocked into orange's goal this many ticks after "go"
    pub test_goal_after: Option<u64>,
    /// The players who left this match: their team and counters (`FormerMembers`: the MVP counts them)
    former: Vec<(u8, StatCounters)>,
    /// The match's MVP (`bMatchMVP`), if still here
    mvp: Option<u32>,
    /// The scoreboard changed since it was last sent; when it was (the pings: every 2 s)
    scoreboard_dirty: bool,
    scoreboard_sent: u64,
    /// When the end screen began (ready-up allowed 1 s later)
    finished_at: u64,
}

impl Default for Game {
    fn default() -> Self {
        Self::new()
    }
}

impl Game {
    pub fn new() -> Self {
        Self::with_seed(1)
    }

    /// `seed`: the first match's kickoff order (then one more per match)
    pub fn with_seed(seed: i32) -> Self {
        Self::with_options(seed, TEAM_SIZE)
    }

    /// `team_size`: the playlist's (1 for 1v1, 2 for 2v2, ...)
    pub fn with_options(seed: i32, team_size: u8) -> Self {
        Self {
            arena: Arena::new(),
            players: BTreeMap::new(),
            match_seed: seed,
            team_size,
            phase: Phase::Countdown,
            phase_until: 0,
            goal_tick: 0,
            touches: VecDeque::new(),
            last_touch: BTreeMap::new(),
            ball_spawn_tick: 0,
            slomo_for_defender: false,
            replay: None,
            ready_sent: None,
            test_goal_after: None,
            former: Vec::new(),
            mvp: None,
            scoreboard_dirty: true,
            scoreboard_sent: 0,
            finished_at: 0,
            go_tick: 0,
            clock_ticks: MATCH_TICKS,
            overtime: false,
            clock_running: false,
            winner: None,
            forfeit: false,
            no_contest: false,
            match_type: MatchType::Casual,
            forfeit_vote_wait: None,
            votes: [None, None],
            initiators: BTreeSet::new(),
            issued_keys: BTreeSet::new(),
            key_seed: (seed as u32) ^ 0x9e37_79b9,
            forfeiting: None,
            left_teams: Vec::new(),
            forfeit_check_at: None,
            score: [0, 0],
            sent: None,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// The match state clients are sent
    pub fn match_state(&self) -> MatchState {
        MatchState {
            server_tick: self.arena.tick_count() as u32,
            phase: self.phase,
            overtime: self.overtime,
            clock_running: self.clock_running,
            clock_ticks: self.clock_ticks,
            score: self.score.map(|s| s.min(255) as u8),
            winner: self.winner,
            forfeit: self.forfeit,
            can_vote_forfeit: self.can_vote_forfeit(),
            no_contest: self.no_contest,
            seconds_left: if self.phase == Phase::Finished {
                self.phase_until.saturating_sub(self.arena.tick_count()).div_ceil(u64::from(TICK_RATE)).min(255) as u8
            } else {
                0
            },
        }
    }

    /// A team has won (`HasWinner`: the match ended, a team forfeited, or the clock ran out with the scores apart)
    fn has_winner(&self) -> bool {
        self.winner.is_some() || self.forfeiting.is_some() || ((self.overtime || self.clock_ticks == 0) && self.score[0] != self.score[1])
    }

    /// Forfeit votes are allowed (`bCanVoteToForfeit`, MR-7.6): the playlist allows them, no winner yet, and the clock
    /// has run the match type's wait, or counts up (overtime). (The game re-evaluates it as the clock's shown second
    /// changes, so from 4:00 shown in casual and 3:30 in ranked: the first tick past the wait)
    fn can_vote_forfeit(&self) -> bool {
        let elapsed = MATCH_TICKS - self.clock_ticks.min(MATCH_TICKS);
        let waited = self.overtime || elapsed > self.forfeit_vote_wait.unwrap_or_else(|| self.match_type.forfeit_wait_ticks());
        self.match_type.allows_forfeit(self.team_size) && !self.phase.match_over() && !self.has_winner() && waited
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn tick_count(&self) -> u64 {
        self.arena.tick_count()
    }

    pub fn car_id(&self, player: PlayerId) -> Option<u32> {
        self.players.get(&player).map(|p| p.car_id)
    }

    pub fn car_position(&mut self, player: PlayerId) -> Option<[f32; 3]> {
        let car = self.car_id(player)?;
        self.arena.car_position(car)
    }

    pub fn join(&mut self, id: PlayerId, request: JoinRequest, out: Sender<Outgoing>) {
        if self.players.len() >= MAX_PLAYERS {
            // (refused: the session ends once it's sent)
            eprintln!("player {id} refused: full ({MAX_PLAYERS} players)");
            let _ = out.try_send(Outgoing::Control(Control::Refused { reason: protocol::REFUSED_FULL }.encode()));
            return;
        }
        let team = match request.team {
            0 | 1 => request.team,
            _ => {
                let blue = self.players.values().filter(|p| p.team == 0).count();
                u8::from(blue > self.players.len() - blue)
            }
        };
        let car_id = self.arena.add_car(team, request.body);
        eprintln!("player {id} joined team {team} (car {car_id})");
        // (a running vote takes the joiner as a voter: `AddToTeam`)
        if let Some(vote) = self.votes[usize::from(team)].as_mut()
            && vote.finished.is_none()
        {
            vote.voters.insert(id, false);
        }
        self.arena.set_car_preferences(car_id, request.dodge_deadzone, request.steering_sensitivity, request.air_control_sensitivity);
        if self.players.is_empty() {
            self.new_match();
        } else if matches!(self.phase, Phase::Waiting | Phase::Countdown) {
            self.arena.redo_kickoff(); // (joining in a kickoff countdown: a kickoff spot, the others where they were)
        } else if self.phase == Phase::Podium {
            self.arena.demolish_car(car_id); // (only the winners have cars on the podium)
        }
        // (the key the client brought, if this server gave it and no one here has it: a reconnect; else a new one. Its old
        // session still here, not yet timed out: a new key, the vote lockout carried over to it, RV-265)
        let brought = request.key != 0 && self.issued_keys.contains(&request.key);
        let key = if brought && !self.players.values().any(|p| p.key == request.key) {
            request.key
        } else {
            let key = self.new_key();
            if brought && self.initiators.contains(&request.key) {
                self.initiators.insert(key);
            }
            key
        };
        let player = Player {
            car_id,
            team,
            input: InputBuffer::default(),
            out,
            echo: None,
            last_reset: None,
            auto_skip_replay: request.auto_skip_replay,
            ready: false,
            key,
            vote_start_disabled: self.initiators.contains(&key),
            vote_sent: None,
            name: player_name(&request.name, id),
            chat: ChatBucket::default(),
            chat_filter: request.quick_chat.min(protocol::CHAT_OFF),
            block_non_tactical: request.block_non_tactical,
            muted: BTreeSet::new(),
            blocked_notice: None,
            stats: [0; STAT_COUNTERS],
            titles: [None, None],
            ping: 0,
        };
        let snapshot = self.arena.save_state();
        let welcome = Control::Welcome {
            version: protocol::VERSION,
            car_id,
            tick_rate: TICK_RATE as u8,
            frame: 0,
            match_type: self.match_type as u8,
            team_size: self.team_size,
            key,
            snapshot: snapshot.clone(),
        };
        let welcome = welcome.encode();
        // (a frame's length is a u16: 16 cars' world is ~12.4 KB, a fifth of it, RV-242/272)
        debug_assert!(welcome.len() - 2 <= usize::from(u16::MAX), "a welcome of {} bytes", welcome.len());
        let _ = player.out.try_send(Outgoing::Control(welcome));
        let _ = player.out.try_send(Outgoing::Control(Control::Match(self.match_state()).encode()));
        self.players.insert(id, player);
        self.send_world_to_others(id, &snapshot);
        self.send_votes();
        self.send_roster();
        self.scoreboard_dirty = true;
    }

    /// A key not given out before, never 0
    fn new_key(&mut self) -> u32 {
        loop {
            self.key_seed = self.key_seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let key = self.key_seed ^ (self.key_seed >> 15);
            if key != 0 && self.issued_keys.insert(key) {
                return key;
            }
        }
    }

    /// The players to everyone (their cars, teams and names)
    fn send_roster(&self) {
        let roster = self.players.values().map(|p| protocol::RosterEntry { car: p.car_id, team: p.team, name: p.name.clone() }).collect();
        self.broadcast(&Control::Roster(roster));
    }

    /// Mute or unmute another player's chat for this player (`ClientMutePlayer` → `VoiceMuteList`, CHAT-19)
    pub fn set_mute(&mut self, id: PlayerId, car: u32, on: bool) {
        if let Some(p) = self.players.get_mut(&id) {
            if on {
                p.muted.insert(car);
            } else {
                p.muted.remove(&car);
            }
        }
    }

    /// The connection's round-trip time (ms) for the scoreboard (`PRI.Ping`, capped at 999 as the game shows it)
    pub fn set_ping(&mut self, id: PlayerId, ms: u32) {
        if let Some(p) = self.players.get_mut(&id) {
            p.ping = ms.min(999) as u16;
        }
    }

    /// The player's chat filters (`ServerSetQuickChatFilter`, `ServerSetTacticalChatFilter`)
    pub fn set_chat_filter(&mut self, id: PlayerId, quick_chat: u8, block_non_tactical: bool) {
        if let Some(p) = self.players.get_mut(&id) {
            p.chat_filter = quick_chat.min(protocol::CHAT_OFF);
            p.block_non_tactical = block_non_tactical;
        }
    }

    /// A quick-chat preset (`ServerSay_TA` → `ServerSayInternal_TA` → `GetMessageRecipients`, CHAT-10, 18, 20): through
    /// the sender's spam filter (blocked: the notice to them), then to the sender and to each player the channel reaches
    /// whom neither side's filter keeps it from (a team-only sender's goes to the team; a friends-only one's to nobody
    /// else, the clone having no friends; a recipient's Off or team-only filter, or their non-tactical block), stamped
    /// with the clock's shown seconds. `now`: real time (s)
    pub fn quick_chat(&mut self, id: PlayerId, preset: u8, team: bool, now: f64) {
        if preset >= protocol::QUICK_CHAT_PRESETS {
            return;
        }
        let Some(sender) = self.players.get_mut(&id) else { return };
        if sender.chat_filter == protocol::CHAT_OFF {
            return;
        }
        if let Some(seconds) = sender.chat.apply(now) {
            // (the notice when its whole seconds change, or once a second: a flood queues no more than that, RV-248)
            let whole = seconds.ceil() as u32;
            if sender.blocked_notice.is_none_or(|(at, shown)| shown != whole || now - at >= 1.0) {
                sender.blocked_notice = Some((now, whole));
                let _ = sender.out.try_send(Outgoing::Control(Control::ChatBlocked { seconds: seconds as f32 }.encode()));
            }
            return;
        }
        let (car, from_team, from_filter) = (sender.car_id, sender.team, sender.chat_filter);
        let team = team || from_filter == protocol::CHAT_TEAM;
        let message = Control::Chat { car, preset, team, seconds: shown_seconds(&self.match_state()).min(u32::from(u16::MAX)) as u16 }.encode();
        for (&to, p) in &self.players {
            let reaches = to == id
                || (!(team && p.team != from_team)
                    && from_filter != protocol::CHAT_FRIENDS
                    && !(from_filter == protocol::CHAT_TEAM && p.team != from_team)
                    && match p.chat_filter {
                        protocol::CHAT_EVERYONE => true,
                        protocol::CHAT_TEAM => p.team == from_team,
                        _ => false, // (friends only: the clone has no friends; off)
                    }
                    && !(p.block_non_tactical && !tactical(preset))
                    && !p.muted.contains(&car));
            if reaches {
                let _ = p.out.try_send(Outgoing::Control(message.clone()));
            }
        }
    }

    /// A player left the match (their connection closed)
    pub fn leave(&mut self, id: PlayerId) {
        self.remove_player(id, false);
    }

    /// A player's connection timed out (the chat log's "lost connection")
    pub fn connection_lost(&mut self, id: PlayerId) {
        self.remove_player(id, true);
    }

    fn remove_player(&mut self, id: PlayerId, lost: bool) {
        if let Some(player) = self.players.remove(&id) {
            let stats = player.input.stats;
            eprintln!(
                "player {id} left: {} input frames repeated (buffer empty), {} skipped to catch up",
                stats.under_buffer_frames, stats.over_buffer_frames
            );
            let team = player.team;
            // (a full public lobby loses its leave penalty: every team's vote ends, `OnPenaltyChanged`, MR-7.15)
            let full = self.players.len() + 1 >= 2 * usize::from(self.team_size);
            if self.match_type.auto_forfeit() && full && !self.has_winner() {
                self.votes = [None, None];
                self.reenable_vote_starters(1 - team);
            }
            // (the leaver leaves their team's vote, which may pass without them: `RemoveFromTeam`)
            if let Some(vote) = self.votes[usize::from(team)].as_mut()
                && vote.finished.is_none()
            {
                vote.voters.remove(&id);
            }
            self.check_vote(team);
            self.reenable_vote_starters(team);
            // Their car explodes where it is (`RemovePlayerFromTeam` -> `Car.Demolish(None)`: no demolition counted, no
            // phase test), then goes: only a live car, not one already demolished (a podium's loser has none), and none in
            // the goal replay (`StartReplay` destroys the cars; ours stay in the arena: RV-235, RV-264)
            let tick = self.arena.tick_count();
            let explode = self.phase != Phase::Replay && !self.arena.car_demoed(player.car_id);
            self.broadcast(&Control::Event { server_tick: tick as u32, event: GameEvent::Left { car: player.car_id, lost, explode } });
            self.arena.remove_car(player.car_id);
            // (their counters stay with the match: the MVP counts the team's former members)
            if !self.phase.match_over() {
                self.former.push((team, player.stats));
            }
            if self.mvp == Some(player.car_id) {
                self.mvp = None;
            }
            self.scoreboard_dirty = true;
            if self.players.is_empty() {
                // Everyone gone: no contest (`ForceNoContest`: straight to the end screen, no podium; the arena stops until
                // the next player starts a match)
                if !self.phase.match_over() {
                    self.no_contest = true;
                    self.finish(tick);
                }
            } else {
                // A team left without players may forfeit, 0.01 game s later (MR-7.9-7.11)
                self.left_teams.push(team);
                self.forfeit_check_at = Some(tick + FORFEIT_CHECK_TICKS);
            }
            let snapshot = self.arena.save_state();
            self.send_world_to_others(id, &snapshot);
            self.send_match_state();
            self.send_votes();
            self.send_roster();
        }
    }

    /// The forfeit check after leaves (`CheckAllTeamsForfeitState`): in public match types, a team a player left that has
    /// no players now forfeits, unless a team has won. (Every team empty is the no contest at the leave. The game also
    /// checks every team at each countdown's end; our matches start without its 30 s wait for players, so a team empty
    /// from the start, solo play, isn't a forfeit)
    fn check_forfeits(&mut self) {
        self.forfeit_check_at = None;
        let left = std::mem::take(&mut self.left_teams);
        if !self.match_type.auto_forfeit() || self.has_winner() {
            return;
        }
        match left.iter().find(|&&team| !self.players.values().any(|p| p.team == team)) {
            Some(&team) => self.team_forfeits(team),
            None => eprintln!("forfeit check: teams {left:?} still have players"),
        }
    }

    /// A team forfeits (`Team.Forfeit` → `HandleTeamForfeit`, MR-7.7): the other team wins whatever the score, at once,
    /// or after a goal at the next round (`StartNewRound`: the replay plays on)
    fn team_forfeits(&mut self, team: u8) {
        eprintln!("team {team} forfeits ({:?})", self.phase);
        match self.phase {
            Phase::PrePodium | Phase::Podium | Phase::Finished => {}
            Phase::PostGoal | Phase::Replay => self.forfeiting = Some(team),
            Phase::Waiting | Phase::Countdown | Phase::Active | Phase::TimeUp => self.end_match(1 - team.min(1), true),
        }
    }

    /// Vote to forfeit (`PRI.ServerVoteToForfeit` → `Team.VoteToForfeit`, MR-7.4/7.5): while votes are allowed, starts
    /// the player's team's vote if none runs (not if they started one before: the lockout, which the game leaves to its
    /// menu, is enforced here), and counts their yes
    pub fn vote_forfeit(&mut self, id: PlayerId) {
        let Some((team, key, disabled)) = self.players.get(&id).map(|p| (p.team, p.key, p.vote_start_disabled)) else { return };
        if !self.can_vote_forfeit() {
            return;
        }
        let slot = usize::from(team.min(1));
        if self.votes[slot].as_ref().is_none_or(|vote| vote.finished.is_some()) {
            if disabled {
                return; // (they started one before: the lockout, enforced here)
            }
            self.initiators.insert(key);
            if let Some(p) = self.players.get_mut(&id) {
                p.vote_start_disabled = true;
            }
            let voters = self.players.iter().filter(|(_, p)| p.team == team).map(|(&id, _)| (id, false)).collect();
            self.votes[slot] = Some(ForfeitVote { voters, started: self.arena.tick_count(), finished: None });
        }
        if let Some(vote) = self.votes[slot].as_mut()
            && let Some(yes) = vote.voters.get_mut(&id)
            && !*yes
        {
            *yes = true; // (logged when it changes: a held or repeated press isn't a line each, RV-267)
            eprintln!("player {id} votes to forfeit: team {team} {}/{}", vote.yes(), vote.voters.len());
        }
        self.check_vote(team);
        self.send_votes();
        self.send_match_state();
    }

    /// A team's running vote that every voter now backs passes: the team forfeits
    fn check_vote(&mut self, team: u8) {
        let tick = self.arena.tick_count();
        if let Some(vote) = self.votes[usize::from(team.min(1))].as_mut()
            && vote.finished.is_none()
            && vote.passed()
        {
            vote.finished = Some((true, tick));
            self.team_forfeits(team);
        }
    }

    /// The votes' clocks: a vote finishes at its 20 s (failed: nobody votes no), then goes 5 s later; a failed or gone
    /// vote re-enables its team's starters when none of them may start one
    fn update_votes(&mut self, tick: u64) {
        for team in 0..2u8 {
            let slot = usize::from(team);
            let Some(vote) = self.votes[slot].as_mut() else { continue };
            match vote.finished {
                None if tick - vote.started >= FORFEIT_VOTE_SECONDS * u64::from(TICK_RATE) => {
                    let passed = vote.passed();
                    vote.finished = Some((passed, tick));
                    if passed {
                        self.team_forfeits(team);
                    } else {
                        self.reenable_vote_starters(team);
                    }
                }
                Some((_, at)) if tick - at >= FORFEIT_VOTE_LINGER_TICKS => {
                    self.votes[slot] = None;
                    self.reenable_vote_starters(team);
                }
                _ => {}
            }
        }
    }

    /// Every player of the team may not start a vote: all of them may again (MR-7.5; the initiators stay recorded, so
    /// one who leaves and rejoins can't)
    fn reenable_vote_starters(&mut self, team: u8) {
        let mut members = self.players.values_mut().filter(|p| p.team == team).peekable();
        if members.peek().is_none() {
            return;
        }
        let members: Vec<&mut Player> = members.collect();
        if members.iter().all(|p| p.vote_start_disabled) {
            for p in members {
                p.vote_start_disabled = false;
            }
        }
    }

    /// Each player's view of their team's vote, to them when it changed
    fn send_votes(&mut self) {
        let tick = self.arena.tick_count();
        let states: Vec<(PlayerId, ForfeitVoteState)> = self
            .players
            .iter()
            .map(|(&id, p)| {
                let can_start = !p.vote_start_disabled;
                let state = match &self.votes[usize::from(p.team.min(1))] {
                    None => ForfeitVoteState { state: protocol::VOTE_NONE, yes: 0, required: 0, seconds_left: 0, voted: false, can_start },
                    Some(vote) => ForfeitVoteState {
                        state: match vote.finished {
                            None => protocol::VOTE_RUNNING,
                            Some((true, _)) => protocol::VOTE_PASSED,
                            Some((false, _)) => protocol::VOTE_FAILED,
                        },
                        yes: vote.yes().min(255) as u8,
                        required: vote.voters.len().min(255) as u8,
                        seconds_left: vote.seconds_left(tick) as u8,
                        voted: vote.voters.get(&id) == Some(&true),
                        can_start,
                    },
                };
                (id, state)
            })
            .collect();
        for (id, state) in states {
            if let Some(p) = self.players.get_mut(&id)
                && p.vote_sent != Some(state)
            {
                let _ = p.out.try_send(Outgoing::Control(Control::ForfeitVote(state).encode()));
                p.vote_sent = Some(state);
            }
        }
    }

    /// The set of cars changed: everyone else reloads the world
    fn send_world_to_others(&self, except: PlayerId, snapshot: &[u8]) {
        for (&id, p) in &self.players {
            if id != except {
                let world = Control::World { frame: p.input.ack_frame(), snapshot: snapshot.to_vec() };
                let _ = p.out.try_send(Outgoing::Control(world.encode()));
            }
        }
    }

    pub fn receive_inputs(&mut self, id: PlayerId, timestamp: u32, first_frame: u32, frames: &[InputFrame], now: f64) {
        if let Some(p) = self.players.get_mut(&id)
            && p.input.receive(timestamp, first_frame, frames, now)
        {
            p.echo = Some((timestamp, now));
        }
    }

    /// The client had a hitch: its jitter buffer starts over (`ServerResetInputBuffer`). At most once per
    /// `MIN_RESET_INTERVAL` (a client asks 2 s after its last hitch; more often is a broken or hostile client)
    pub fn reset_input_buffer(&mut self, id: PlayerId, now: f64) {
        if let Some(p) = self.players.get_mut(&id)
            && p.last_reset.is_none_or(|last| now - last >= MIN_RESET_INTERVAL)
        {
            p.input.jitter.reset();
            p.last_reset = Some(now);
        }
    }

    /// Skip the goal replay (`ServerReadyUp`: only while one plays)
    /// `ReadyUp`: skips the goal replay, or on the end screen (from 1 s in) readies the player for the next match
    /// (`SetReadyToPlay` → `ServerReadyUp`, MIO-31)
    pub fn ready_up(&mut self, id: PlayerId) {
        let tick = self.arena.tick_count();
        let end_screen = self.phase == Phase::Finished && tick >= self.finished_at + (READY_UP_DELAY_SECONDS * TICK_RATE as f32) as u64;
        if (self.phase == Phase::Replay || end_screen)
            && let Some(p) = self.players.get_mut(&id)
        {
            self.scoreboard_dirty |= end_screen && !p.ready;
            p.ready = true;
        }
    }

    /// The player's auto-skip setting (`ServerSetAutoSkipGoalReplay`: turned on during a replay, it readies them)
    pub fn set_auto_skip_replay(&mut self, id: PlayerId, on: bool) {
        if let Some(p) = self.players.get_mut(&id) {
            p.auto_skip_replay = on;
            if on && self.phase == Phase::Replay {
                p.ready = true;
            }
        }
    }

    /// Real seconds until the next tick: 1/120, but for the 360 ticks after a goal, the n-th of which lasts
    /// (1/120) / D((n - 1) / 120) with D the slow-motion curve (the game's dilated frame time steps its physics, so its
    /// ticks slow down with the world: notes/camera-respawn-goal.md GS-2/3, notes/client-loop-timing.md LT-3)
    pub fn next_tick_seconds(&self) -> f64 {
        let base = 1.0 / f64::from(TICK_RATE);
        if self.phase != Phase::PostGoal {
            return base;
        }
        let n = self.arena.tick_count() + 1 - self.goal_tick;
        if n > POST_GOAL_TICKS {
            return base;
        }
        base / score_slomo((n - 1) as f64 / f64::from(TICK_RATE))
    }

    /// A new match: scores 0, the clock full, a new kickoff order, the first kickoff
    fn new_match(&mut self) {
        self.slomo_for_defender = false;
        self.score = [0, 0];
        self.clock_ticks = MATCH_TICKS;
        self.overtime = false;
        self.winner = None;
        self.forfeit = false;
        self.no_contest = false;
        self.votes = [None, None];
        self.initiators.clear();
        // (a leaver's key only mattered for their vote lockout, which ends with the match: RV-270)
        let here: BTreeSet<u32> = self.players.values().map(|p| p.key).collect();
        self.issued_keys.retain(|k| here.contains(k));
        for p in self.players.values_mut() {
            p.vote_start_disabled = false;
        }
        self.forfeiting = None;
        self.left_teams.clear();
        self.forfeit_check_at = None;
        // (the world runs again: the podium's boost and hidden losers end with the kickoff's placement)
        self.arena.set_frozen(false);
        self.arena.set_unlimited_boost(false);
        for p in self.players.values_mut() {
            p.ready = false;
        }
        // (the match stats start over: `PRI.ResetMatchStats`)
        self.arena.reset_stats();
        for p in self.players.values_mut() {
            p.stats = [0; STAT_COUNTERS];
            p.titles = [None, None];
        }
        self.former.clear();
        self.mvp = None;
        self.scoreboard_dirty = true;
        self.arena.start_match(self.match_seed, self.team_size);
        self.match_seed = self.match_seed.wrapping_add(1);
        self.kickoff();
        let warmup = (WARMUP_SECONDS * TICK_RATE as f32) as u32;
        self.arena.set_kickoff_countdown(self.arena.kickoff_countdown() + warmup);
        // (the warm-up is `WaitingForPlayers`' last 3 s: no messages; then the countdown's 3, 2, 1, GO)
        self.phase = Phase::Waiting;
        self.phase_until = self.arena.tick_count() + u64::from(warmup);
    }

    fn kickoff(&mut self) {
        self.arena.set_respawns_held(false);
        self.arena.next_kickoff();
        // (a new ball: its touches start over, as the engine's cars' do)
        self.ball_spawn_tick = self.arena.tick_count();
        self.touches.clear();
        self.last_touch.clear();
        self.replay = None;
        self.arena.set_kickoff_countdown((KICKOFF_COUNTDOWN_SECONDS * TICK_RATE as f32) as u32);
        self.phase = Phase::Countdown;
    }

    /// The match is over: the winner shown, the cars frozen for the podium, then a new match (`EndGame`)
    fn end_match(&mut self, winner: u8, forfeit: bool) {
        self.winner = Some(winner);
        self.forfeit = forfeit;
        self.forfeiting = None;
        self.votes = [None, None]; // (the votes end with the match)
        self.phase = Phase::PrePodium;
        self.phase_until = self.arena.tick_count() + (PRE_PODIUM_SECONDS * TICK_RATE as f32) as u64;
        // (`EndGame` → `FreezePawns`: the ball and every car hold where they are)
        self.arena.set_frozen(true);
        self.award_match_end(winner);
        // (`OnMatchEnded`'s tracking events, then `PrePodiumSpotlight.UpdateSpotlight`: titles for both teams' current
        // members, blue's first, each team in join order)
        let members: Vec<u32> = [0, 1].iter().flat_map(|&team| self.players.values().filter(move |p| p.team == team).map(|p| p.car_id)).collect();
        let titles = self.arena.match_ended(true, &members);
        for (car, titles) in members.into_iter().zip(titles) {
            if let Some(p) = self.players.values_mut().find(|p| p.car_id == car) {
                p.titles = titles;
            }
        }
    }

    /// `PodiumSpotlight` (`InitPodiumCars`, MIO-11/13): the ball hidden; the winning team's players by MVPSort at the
    /// podium's spots, the MVP's first, drivable with unlimited boost; every other car gone
    fn start_podium(&mut self, tick: u64) {
        let winner = self.winner.unwrap_or(0);
        self.arena.set_frozen(false);
        self.arena.set_respawns_held(true);
        self.arena.set_unlimited_boost(true);
        self.arena.hide_ball();
        let mut winners: Vec<(StatCounters, u32)> = self.players.values().filter(|p| p.team == winner).map(|p| (p.stats, p.car_id)).collect();
        winners.sort_by(|a, b| (b.0[0], b.0[1], b.0[2], b.0[3]).cmp(&(a.0[0], a.0[1], a.0[2], a.0[3])));
        let on_podium: Vec<u32> = winners.iter().take(PODIUM_SPOTS.len()).map(|&(_, car)| car).collect();
        // (`ClearPodiumTitle` from 4th place on: those titles are gone, not handed on)
        for &(_, car) in winners.iter().skip(3) {
            if let Some(p) = self.players.values_mut().find(|p| p.car_id == car) {
                p.titles = [None, None];
            }
        }
        self.scoreboard_dirty = true;
        for (i, &car) in on_podium.iter().enumerate() {
            let (x, y, yaw) = PODIUM_SPOTS[i];
            let (x, y, yaw) = if winner == 1 { (-x, -y, yaw + 32768) } else { (x, y, yaw) };
            self.arena.place_car(car, x, y, yaw as f32 * (std::f32::consts::TAU / 65536.0), 100.0);
        }
        let others: Vec<u32> = self.players.values().map(|p| p.car_id).filter(|car| !on_podium.contains(car)).collect();
        for car in others {
            self.arena.demolish_car(car);
        }
        self.phase = Phase::Podium;
        self.phase_until = tick + (PODIUM_SECONDS * TICK_RATE as f32) as u64;
    }

    /// `Finished` (MIO-14, MIO-31): the world frozen again; the end screen's 60 s, ready-up from 1 s in
    fn finish(&mut self, tick: u64) {
        self.arena.set_frozen(true);
        self.arena.set_unlimited_boost(false);
        for p in self.players.values_mut() {
            p.ready = false;
        }
        self.phase = Phase::Finished;
        self.finished_at = tick;
        self.phase_until = tick + u64::from(FINISH_SECONDS * TICK_RATE);
        self.scoreboard_dirty = true;
    }

    /// `EndGame` → `GetMVP` / `NotifyWonMVP`, then `StatFactory.OnMatchEnded`: Win to the winning team's players and Loss
    /// to the others, then the MVP: the best of the winning team, former members included, by score, goals, assists and
    /// saves (`MVPSort`); none in 1v1 playlists (match-stats.md §5.3, STAT-18)
    fn award_match_end(&mut self, winner: u8) {
        let sort_key = |s: &StatCounters| (s[0], s[1], s[2], s[3]);
        let best_here = self.players.values().filter(|p| p.team == winner).map(|p| (sort_key(&p.stats), Some(p.car_id))).max_by_key(|&(k, _)| k);
        let best_former = self.former.iter().filter(|(team, _)| *team == winner).map(|(_, s)| (sort_key(s), None)).max_by_key(|&(k, _)| k);
        // (a tie between someone here and a former member goes to the one here: the sort's order is open, STAT §11.2)
        let best = match (best_here, best_former) {
            (Some(here), Some(former)) => Some(if former.0 > here.0 { former } else { here }),
            (here, former) => here.or(former),
        };
        self.mvp = if self.team_size > 1 { best.and_then(|(_, car)| car) } else { None };
        let players: Vec<(u32, u8)> = self.players.values().map(|p| (p.car_id, p.team)).collect();
        for &(car, team) in &players {
            self.send_stat(car, if team == winner { stat::WIN } else { stat::LOSS }, 0);
        }
        if let Some(car) = self.mvp {
            self.send_stat(car, stat::MVP, 0);
        }
        self.scoreboard_dirty = true;
    }

    /// A stat gained by a car's player: their popup (unless the event isn't replicated) and every player's feed (if it
    /// goes there)
    fn send_stat(&self, car: u32, event: u8, victim: u32) {
        if stat::notifies_receiver(event)
            && let Some(p) = self.players.values().find(|p| p.car_id == car)
        {
            let points = stat_event_points(event).clamp(0, i32::from(u16::MAX)) as u16;
            let _ = p.out.try_send(Outgoing::Control(Control::StatEvent { event, points }.encode()));
        }
        if stat::notifies_ticker(event) {
            self.broadcast(&Control::Ticker { event, receiver: car, victim });
        }
    }

    /// This tick's stat awards (the engine's StatFactory): each player's counters taken again, the popups and feed
    /// sent; the goal's scorer and assister (for the goal event)
    fn handle_awards(&mut self, awards: &[Award]) -> (u32, u32) {
        let (mut scorer, mut assister) = (0, 0);
        for a in awards {
            match a.event {
                stat::GOAL => scorer = a.car,
                stat::ASSIST => assister = a.car,
                _ => {}
            }
            self.send_stat(a.car, a.event, a.victim);
        }
        if !awards.is_empty() {
            let cars: Vec<u32> = self.players.values().map(|p| p.car_id).collect();
            for car in cars {
                let stats = self.arena.car_stats(car);
                if let Some(p) = self.players.values_mut().find(|p| p.car_id == car) {
                    self.scoreboard_dirty |= p.stats != stats;
                    p.stats = stats;
                }
            }
        }
        (scorer, assister)
    }

    /// Everyone's scoreboard lines when they changed, and every 2 s for the pings
    fn send_scoreboard(&mut self, tick: u64) {
        if !self.scoreboard_dirty && tick < self.scoreboard_sent + 2 * u64::from(TICK_RATE) {
            return;
        }
        let entries = self
            .players
            .values()
            .map(|p| ScoreboardEntry {
                car: p.car_id,
                ping: p.ping,
                mvp: self.mvp == Some(p.car_id),
                ready: self.phase == Phase::Finished && p.ready,
                counters: p.stats.iter().map(|&c| c.clamp(0, i32::from(u16::MAX)) as u16).collect(),
                titles: p.titles,
            })
            .collect();
        self.broadcast(&Control::Scoreboard(entries));
        self.scoreboard_dirty = false;
        self.scoreboard_sent = tick;
    }

    /// A round ended (after a goal, or the ball down at 0:00): the match ends with a winner, goes to overtime when
    /// tied at 0:00, or has another kickoff (`GameEvent_Soccar_TA.StartNewRound`)
    fn new_round(&mut self) {
        if let Some(team) = self.forfeiting {
            self.end_match(1 - team.min(1), true);
            return;
        }
        let time_up = self.overtime || self.clock_ticks == 0;
        if time_up && self.score[0] != self.score[1] {
            self.end_match(u8::from(self.score[1] > self.score[0]), false);
        } else {
            if time_up && !self.overtime {
                self.overtime = true; // (sudden death, the clock counting up from 0)
                self.clock_ticks = 0;
            }
            self.kickoff();
        }
    }

    /// Each car's new touches on the ball this tick, as runs per car (the game's touches, consecutive ones merged)
    fn track_touches(&mut self) {
        for p in self.players.values() {
            let Some(tick) = self.arena.car_last_ball_touch_tick(p.car_id) else { continue };
            if self.last_touch.insert(p.car_id, tick) == Some(tick) {
                continue;
            }
            match self.touches.back_mut() {
                Some(last) if last.car == p.car_id => last.tick = tick,
                _ => self.touches.push_back(Touch { car: p.car_id, team: p.team, tick }),
            }
            if self.touches.len() > MAX_TOUCHES {
                self.touches.pop_front();
            }
        }
    }

    /// The goal's replay (`ReplayDirector_TA`: `GoalScored`, `GetReplayStartTime`, `ShouldSlomo`, `BuildFocusCars`;
    /// notes/camera-respawn-goal.md GS-7..9)
    fn plan_replay(&mut self, goal: u64, team: u8) -> ReplayPlan {
        // The scoring touch: the newest by the scoring team, else the newest (`DetermineScoreTouchIndex`)
        let score_hit = self.touches.iter().rposition(|t| t.team == team).or_else(|| self.touches.len().checked_sub(1));
        let hit = score_hit.and_then(|i| self.touches.get(i)).map(|t| t.tick as i64);
        let goal_tick = goal as i64;
        let start = (hit.unwrap_or(0).min(goal_tick - MIN_REPLAY_TICKS) - REPLAY_PADDING_TICKS)
            .max(0)
            .max(goal_tick - MAX_REPLAY_TICKS)
            .max(self.ball_spawn_tick as i64);
        let end = goal_tick + POST_GOAL_TICKS as i64;
        // A defender close to the ball (`SetSlomoForDefender`: at the goal's frame)
        let ball = self.arena.ball_position();
        let defenders: Vec<u32> = self.players.values().filter(|p| p.team != team).map(|p| p.car_id).collect();
        for car in defenders {
            if let Some(p) = self.arena.car_position(car) {
                let d = [p[0] - ball[0], p[1] - ball[1], p[2] - ball[2]];
                if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() < SLOMO_DEFEND_DISTANCE {
                    self.slomo_for_defender = true;
                }
            }
        }
        let mut windows: Vec<(i64, i64)> = Vec::new();
        if let Some(h) = hit {
            windows.push((h - SLOMO_PRE_SCORE_TICKS, h + SLOMO_POST_SCORE_TICKS));
        }
        if self.slomo_for_defender {
            windows.push((goal_tick - SLOMO_DEFEND_TICKS, goal_tick));
        }
        windows.sort_unstable();
        let mut slomo: Vec<(u32, u32)> = Vec::new();
        for (from, to) in windows {
            let (from, to) = (from.max(start) as u32, to.min(end) as u32);
            if to <= from {
                continue;
            }
            match slomo.last_mut() {
                Some(last) if from <= last.1 => last.1 = last.1.max(to),
                _ => slomo.push((from, to)),
            }
        }
        // The camera follows each car that touched the ball in the replay, in turn, up to the scoring touch
        let focus = score_hit
            .map(|last| {
                let mut runs: Vec<(u32, u32)> = Vec::new();
                for t in self.touches.iter().take(last + 1).filter(|t| t.tick as i64 >= start) {
                    match runs.last_mut() {
                        Some(run) if run.0 == t.car => run.1 = t.tick as u32,
                        _ => runs.push((t.car, t.tick as u32)),
                    }
                }
                runs
            })
            .unwrap_or_default();
        ReplayPlan { start_tick: start as u32, goal_tick: goal as u32, end_tick: end as u32, scoring_team: team, slomo, focus }
    }

    /// 360 ticks after the goal (`StartReplay`): the goal replay if any player wants it (`ShouldPlayReplayPlayback`),
    /// the ready votes cleared (`SetAllowReadyUp`), else the next round at once
    fn start_replay(&mut self, tick: u64) {
        let wanted = self.players.values().any(|p| !p.auto_skip_replay);
        match self.replay.take() {
            Some(plan) if wanted => {
                self.phase = Phase::Replay;
                self.phase_until = tick + (replay_seconds(&plan) * f64::from(TICK_RATE)).round() as u64;
                // (`SetAllowReadyUp`: everyone unready, then `AutoReadyPlayers`)
                for p in self.players.values_mut() {
                    p.ready = p.auto_skip_replay;
                }
                self.broadcast(&Control::Replay(plan));
                self.ready_sent = None;
                self.send_ready();
            }
            _ => self.new_round(),
        }
    }

    /// The replay's ready count to everyone when it changed
    fn send_ready(&mut self) {
        let ready = self.players.values().filter(|p| p.ready).count().min(255) as u8;
        let state = (ready, self.players.len().min(255) as u8);
        if self.ready_sent != Some(state) {
            self.broadcast(&Control::ReplayReady { ready: state.0, total: state.1 });
            self.ready_sent = Some(state);
        }
    }

    fn broadcast(&self, message: &Control) {
        let bytes = message.encode();
        for p in self.players.values() {
            let _ = p.out.try_send(Outgoing::Control(bytes.clone()));
        }
    }

    /// One physics tick. `now`: server time in seconds.
    pub fn tick(&mut self, now: f64) {
        // (a player whose queue is full isn't reading: their session goes, as a lost connection)
        let stuck: Vec<PlayerId> = self.players.iter().filter(|(_, p)| p.out.capacity() == 0).map(|(&id, _)| id).collect();
        for id in stuck {
            eprintln!("player {id}: outgoing queue full ({OUT_QUEUE}), dropped");
            self.remove_player(id, true);
        }
        if self.players.is_empty() {
            return;
        }
        let odd_tick = self.arena.tick_count() % 2 == 1;
        // (after the match the cars are frozen: `EndGame` → `SetAllDriving(false)`; in the goal replay they're gone:
        // `StartReplay` → `DestroyCars`, here frozen out of sight until the kickoff places them)
        let frozen = matches!(self.phase, Phase::PrePodium | Phase::Finished | Phase::Replay);
        for p in self.players.values_mut() {
            let controls = p.input.tick(now, odd_tick);
            let controls = if frozen { Controls::default() } else { controls };
            self.arena.set_controls(p.car_id, &controls);
            // (a release and a press inside this tick's frames: a fresh press, NET-2)
            if p.input.repress_jump && !frozen {
                self.arena.repress_jump(p.car_id);
            }
        }
        // (the stats count while the round is on: Active, and at 0:00 until the ball lands; after a goal the engine moves
        // them on itself, then only demolitions and fives count)
        self.arena.set_stats_state(match self.phase {
            Phase::Active | Phase::TimeUp => StatsState::Round,
            Phase::PostGoal => StatsState::AfterGoal,
            _ => StatsState::Inactive,
        });
        self.arena.set_stats_overtime(self.overtime);
        self.arena.step(1);
        let tick = self.arena.tick_count();
        self.track_touches();
        let awards = self.arena.take_stat_awards();
        let (scorer, assister) = self.handle_awards(&awards);

        for event in self.arena.take_events() {
            match event {
                // (one goal per round: the engine explodes the ball on a goal; goals count while playing and at 0:00)
                Event::Goal { team } if matches!(self.phase, Phase::Active | Phase::TimeUp) => {
                    self.score[usize::from(team.min(1))] += 1;
                    self.broadcast(&Control::Event { server_tick: tick as u32, event: GameEvent::Goal { team, scorer, assister } });
                    self.phase = Phase::PostGoal;
                    self.goal_tick = tick;
                    self.phase_until = tick + POST_GOAL_TICKS;
                    self.arena.set_respawns_held(true); // (the demolished wait for the kickoff)
                    self.replay = Some(self.plan_replay(tick, team));
                }
                Event::Goal { .. } => {}
                Event::Demo { .. } if self.phase == Phase::Replay => {} // (the cars are gone)
                Event::Demo { attacker, victim } => {
                    self.broadcast(&Control::Event { server_tick: tick as u32, event: GameEvent::Demo { attacker, victim } });
                }
                Event::Bump { .. } => {}
            }
        }
        if self.forfeit_check_at.is_some_and(|at| tick >= at) {
            self.check_forfeits();
        }
        self.update_votes(tick);
        self.update_match(tick);
        self.send_match_state();
        self.send_votes();
        self.send_scoreboard(tick);

        if tick.is_multiple_of(UPDATE_EVERY_TICKS) {
            self.send_updates(now);
        }
    }

    /// The match's clock and phases after a tick (`GameEvent_Soccar_TA`: Countdown, Active, PostGoalScored, the 0:00
    /// `EndRoundComponent`, overtime, `EndGame`)
    fn update_match(&mut self, tick: u64) {
        self.clock_running = false;
        match self.phase {
            Phase::Countdown => {
                if self.arena.kickoff_countdown() == 0 {
                    self.phase = Phase::Active;
                    self.go_tick = tick;
                }
            }
            Phase::Active => {
                if self.test_goal_after.is_some_and(|after| tick == self.go_tick + after) {
                    self.arena.set_ball([0.0, 4900.0, 300.0], [0.0, 2000.0, 0.0]);
                }
                // The clock runs once the ball has been hit (`bBallHasBeenHit`: a touch, or 5 s after "go")
                let hit = self.arena.last_ball_touch_tick().is_some() || tick >= self.go_tick + CLOCK_START_DELAY_TICKS;
                if hit && self.overtime {
                    self.clock_ticks = self.clock_ticks.saturating_add(1);
                    self.clock_running = true;
                } else if hit && self.clock_ticks > 0 {
                    self.clock_ticks -= 1;
                    self.clock_running = true;
                    if self.clock_ticks == 0 {
                        self.phase = Phase::TimeUp;
                    }
                }
            }
            // At 0:00 the round ends when the ball touches the ground (or sleeps)
            Phase::TimeUp => {
                if self.arena.ball_on_ground() {
                    self.new_round();
                }
            }
            Phase::PostGoal => {
                if tick >= self.phase_until {
                    self.start_replay(tick);
                }
            }
            // `CheckPlayersReady` (every 0.01 s; here every tick): `AutoReadyPlayers` readies the auto-skippers (a ready
            // player stays ready: turning auto-skip off doesn't undo it, RV-12); all ready, or the replay's end
            Phase::Replay => {
                for p in self.players.values_mut() {
                    p.ready |= p.auto_skip_replay;
                }
                if tick >= self.phase_until || self.players.values().all(|p| p.ready) {
                    self.new_round();
                } else {
                    self.send_ready();
                }
            }
            Phase::Waiting => {
                if tick >= self.phase_until {
                    self.phase = Phase::Countdown;
                }
            }
            Phase::PrePodium => {
                if tick >= self.phase_until {
                    self.start_podium(tick);
                }
            }
            Phase::Podium => {
                if tick >= self.phase_until {
                    self.finish(tick);
                }
            }
            // The next match when the 60 s are up, or every player is ready (`CheckPlayersReady`, from 1 s in)
            Phase::Finished => {
                let all_ready = !self.players.is_empty() && self.players.values().all(|p| p.ready);
                if tick >= self.phase_until || all_ready {
                    self.new_match();
                }
            }
        }
    }

    /// The match state to everyone when it changed (the clock: when its shown second changes)
    fn send_match_state(&mut self) {
        let state = self.match_state();
        let shown = shown_seconds;
        let changed = self.sent.is_none_or(|sent| MatchState { server_tick: 0, clock_ticks: shown(&sent), ..sent } != MatchState { server_tick: 0, clock_ticks: shown(&state), ..state });
        if changed {
            self.broadcast(&Control::Match(state));
            self.sent = Some(state);
        }
    }

    /// The network-state parts of this update, each within the datagram budget
    fn update_parts(&mut self) -> Vec<Vec<u8>> {
        let tick = self.arena.tick_count();
        let slow = tick.is_multiple_of(SLOW_UPDATE_EVERY_TICKS);
        let ball = self.arena.ball_position();
        let mut cars = Vec::new();
        for car in self.arena.car_ids() {
            let near = self.arena.car_position(car).is_some_and(|p| {
                let d = [p[0] - ball[0], p[1] - ball[1], p[2] - ball[2]];
                d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= NEAR_BALL_DISTANCE * NEAR_BALL_DISTANCE
            });
            if near || slow {
                cars.push(car);
            }
        }

        // Greedy split: the ball and pads go in the first part
        let budget = MAX_DATAGRAM - UPDATE_HEADER;
        let mut parts = Vec::new();
        let (mut with_ball, mut with_pads) = (true, slow);
        let mut current: Vec<u32> = Vec::new();
        for car in cars {
            current.push(car);
            if self.arena.write_net_state(with_ball, &current, with_pads).len() > budget && current.len() > 1 {
                current.pop();
                parts.push(self.arena.write_net_state(with_ball, &current, with_pads));
                (with_ball, with_pads) = (false, false);
                current = vec![car];
            }
        }
        parts.push(self.arena.write_net_state(with_ball, &current, with_pads));
        parts
    }

    fn send_updates(&mut self, now: f64) {
        let parts = self.update_parts();
        let server_tick = self.arena.tick_count() as u32;
        for p in self.players.values() {
            let (echo_timestamp, echo_delay) = match p.echo {
                Some((timestamp, at)) => (timestamp, ((now - at) * 1000.0).clamp(0.0, f64::from(u16::MAX)) as u16),
                None => (0, 0),
            };
            for (i, state) in parts.iter().enumerate() {
                let update = Update {
                    server_tick,
                    ack_frame: p.input.ack_frame(),
                    received_frame: p.input.last_received_frame,
                    echo_timestamp,
                    echo_delay,
                    buffer_target: p.input.jitter.buffer_size.min(255) as u8,
                    buffer_size: p.input.len().min(255) as u8,
                    part: i as u8,
                    parts: parts.len() as u8,
                    state: state.clone(),
                };
                let _ = p.out.try_send(Outgoing::Datagram(Datagram::Update(update).encode()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::tests::init_engine;
    use tokio::sync::mpsc::{Receiver, channel};

    /// (the tests read their queues only now and then: room for whole matches)
    const TEST_QUEUE: usize = 1 << 20;

    /// (skipping goal replays: a goal goes straight to the next kickoff; the replay's tests ask for them)
    const REQUEST: JoinRequest = JoinRequest {
        team: 255,
        body: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: true,
        key: 0,
        name: String::new(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
    };
    const WANTS_REPLAYS: JoinRequest = JoinRequest {
        team: 255,
        body: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: false,
        key: 0,
        name: String::new(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
    };

    fn drain(rx: &mut Receiver<Outgoing>) -> Vec<Outgoing> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            out.push(m);
        }
        out
    }

    fn throttle_frames(n: usize) -> Vec<InputFrame> {
        vec![InputFrame { throttle: 127, ..InputFrame::default() }; n]
    }

    #[test]
    fn players_join_drive_and_receive_updates() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = channel(TEST_QUEUE);
        let (tx2, mut rx2) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx1);
        game.join(2, REQUEST, tx2);

        // Player 1: Welcome then World (player 2 joined); player 2: Welcome
        let first = drain(&mut rx1);
        let Outgoing::Control(bytes) = &first[0] else { panic!() };
        let Control::Welcome { car_id, snapshot, .. } = Control::decode(&bytes[2..]).unwrap() else { panic!() };
        assert!(matches!(drain(&mut rx2)[0], Outgoing::Control(_)));

        // A client-side arena: the welcome snapshot, then the world snapshot sent when player 2 joined
        let mut client = Arena::new();
        assert!(client.load_state(&snapshot));
        let world = first
            .iter()
            .find_map(|m| match m {
                Outgoing::Control(b) => match Control::decode(&b[2..]) {
                    Ok(Control::World { snapshot, .. }) => Some(snapshot),
                    _ => None,
                },
                Outgoing::Datagram(_) => None,
            })
            .unwrap();
        assert!(client.load_state(&world));

        // Player 1 sends 2 frames per 60 Hz packet (throttle 1), player 2 nothing; the match's first kickoff (3 s
        // warm-up and the 4 s countdown), then 2 seconds of driving
        let start = game.car_position(1).unwrap();
        let mut frame = 1u32;
        let mut last_update = None;
        let mut max_size = 0;
        let countdown = game.arena.kickoff_countdown();
        assert_eq!(countdown, 840);
        for tick in 0..countdown + 240 {
            if tick == countdown {
                let p = game.car_position(1).unwrap();
                assert!((p[0] - start[0]).hypot(p[1] - start[1]) < 1.0, "the car moved during the countdown");
                assert_eq!(client.kickoff_countdown(), 0, "the countdown reached the client through the updates");
            }
            let now = f64::from(tick) / 120.0;
            if tick % 2 == 0 {
                game.receive_inputs(1, tick, frame, &throttle_frames(2), now);
                frame += 2;
            }
            game.tick(now);
            for m in drain(&mut rx1) {
                if let Outgoing::Datagram(d) = m {
                    max_size = max_size.max(d.len());
                    if let Datagram::Update(u) = Datagram::decode(&d).unwrap() {
                        assert!(client.apply_net_state(&u.state), "update did not apply");
                        last_update = Some(u);
                    }
                }
            }
            drain(&mut rx2);
        }
        let end = game.car_position(1).unwrap();
        assert!((end[0] - start[0]).hypot(end[1] - start[1]) > 1000.0, "the car drove");
        assert!(max_size <= MAX_DATAGRAM, "datagram of {max_size} bytes");
        let u = last_update.unwrap();
        assert!(u.ack_frame > frame - 40 && u.ack_frame < frame, "ack {}", u.ack_frame); // 1 frame per tick sent, ~all consumed
        assert_eq!(u.received_frame, frame - 1);
        // The client's view of the server's car (updated at least every 8 ticks) is within a few ticks of driving
        let server_pos = game.arena.car_position(car_id).unwrap();
        let client_pos = client.car_position(car_id).unwrap();
        assert!((server_pos[0] - client_pos[0]).hypot(server_pos[1] - client_pos[1]) < 200.0);
    }

    #[test]
    fn input_buffer_resets_are_rate_limited() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        let inflate = |game: &mut Game| {
            let p = game.players.get_mut(&1).unwrap();
            p.input.jitter.buffer_size = 18; // (as after a long gap)
        };
        let size = |game: &Game| game.players[&1].input.jitter.buffer_size;
        inflate(&mut game);
        game.reset_input_buffer(1, 10.0);
        assert_eq!(size(&game), 7);
        inflate(&mut game);
        game.reset_input_buffer(1, 10.5); // too soon: ignored
        assert_eq!(size(&game), 18);
        game.reset_input_buffer(1, 11.0);
        assert_eq!(size(&game), 7);
    }

    /// One player, ticked until `until` says so (or `max` ticks); the tick count when it did
    fn run_until(game: &mut Game, max: u32, mut until: impl FnMut(&mut Game) -> bool) -> u64 {
        for _ in 0..max {
            game.tick(game.tick_count() as f64 / 120.0);
            if until(game) {
                return game.tick_count();
            }
        }
        panic!("not reached in {max} ticks (phase {:?}, clock {})", game.phase, game.clock_ticks);
    }

    fn ticks(game: &mut Game, n: u64) {
        for _ in 0..n {
            game.tick(game.tick_count() as f64 / 120.0);
        }
    }

    fn controls(rx: &mut Receiver<Outgoing>) -> Vec<Control> {
        drain(rx)
            .iter()
            .filter_map(|m| match m {
                Outgoing::Control(b) => Control::decode(&b[2..]).ok(),
                Outgoing::Datagram(_) => None,
            })
            .collect()
    }

    fn events(rx: &mut Receiver<Outgoing>) -> Vec<GameEvent> {
        controls(rx).into_iter().filter_map(|c| if let Control::Event { event, .. } = c { Some(event) } else { None }).collect()
    }

    /// The last forfeit vote state sent
    fn last_vote(rx: &mut Receiver<Outgoing>) -> Option<ForfeitVoteState> {
        controls(rx).into_iter().filter_map(|c| if let Control::ForfeitVote(v) = c { Some(v) } else { None }).next_back()
    }

    fn match_states(rx: &mut Receiver<Outgoing>) -> Vec<MatchState> {
        drain(rx)
            .iter()
            .filter_map(|m| match m {
                Outgoing::Control(b) => match Control::decode(&b[2..]) {
                    Ok(Control::Match(state)) => Some(state),
                    _ => None,
                },
                Outgoing::Datagram(_) => None,
            })
            .collect()
    }

    #[test]
    fn the_clock_waits_for_go_and_the_ball_being_hit() {
        init_engine();
        let mut game = Game::new();
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        assert_eq!(match_states(&mut rx).last().map(|m| (m.phase, m.clock_ticks)), Some((Phase::Waiting, MATCH_TICKS)));
        // The match's first kickoff: the 3 s warm-up (`WaitingForPlayers`) and the 4 s countdown, the clock stopped
        let countdown = run_until(&mut game, 1000, |g| g.phase == Phase::Countdown);
        assert_eq!(countdown, 360);
        let go = run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        assert_eq!(go, 840);
        // Nobody touches the ball: the clock starts 5 s after go (BallHasBeenHitStartDelay)
        let started = run_until(&mut game, 1000, |g| g.clock_ticks < MATCH_TICKS);
        assert_eq!(started, go + CLOCK_START_DELAY_TICKS);
        let states = match_states(&mut rx);
        assert!(states.iter().any(|m| m.phase == Phase::Active && !m.clock_running));
        assert!(states.last().is_some_and(|m| m.clock_running && m.clock_ticks == MATCH_TICKS - 1));
        // Then a message each shown second
        run_until(&mut game, 400, |g| g.clock_ticks == MATCH_TICKS - 3 * TICK_RATE - 1);
        let shown: Vec<u32> = match_states(&mut rx).iter().map(shown_seconds).collect();
        assert_eq!(shown, vec![299, 298, 297]);
    }

    #[test]
    fn a_touch_starts_the_clock() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        // A ball rolling into the parked car
        let car = game.car_position(1).unwrap();
        game.arena.set_ball([car[0], car[1] + 400.0, 93.0], [0.0, -1500.0, 0.0]);
        let started = run_until(&mut game, 300, |g| g.clock_ticks < MATCH_TICKS);
        assert_eq!(game.arena.last_ball_touch_tick(), Some(started));
    }

    #[test]
    fn at_zero_the_round_ends_when_the_ball_lands_then_a_tie_goes_to_overtime() {
        init_engine();
        let mut game = Game::new();
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        run_until(&mut game, 1000, |g| g.clock_running);
        game.clock_ticks = 2;
        game.arena.set_ball([0.0, 0.0, 800.0], [0.0, 0.0, 0.0]);
        let tick = game.tick_count();
        run_until(&mut game, 10, |g| g.phase == Phase::TimeUp);
        assert_eq!(game.clock_ticks, 0);
        let z = game.arena.ball_position()[2];
        assert!(z > 400.0, "time up with the ball high (z {z})");
        // The round ends when the ball reaches the floor, not before; 0-0: overtime, a kickoff
        let landed = run_until(&mut game, 400, |g| g.phase != Phase::TimeUp);
        let z = game.arena.ball_position()[2];
        assert!(z < 100.0, "the round ended with the ball at z {z}");
        assert!(landed > tick + 120);
        assert_eq!((game.phase, game.overtime, game.clock_ticks), (Phase::Countdown, true, 0));
        assert!(match_states(&mut rx).last().is_some_and(|m| m.overtime && m.phase == Phase::Countdown));
        // Overtime counts up from go (here at once: the clock starts at the delay or a touch, as in regulation)
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        run_until(&mut game, 1000, |g| g.clock_ticks > 0);
        run_until(&mut game, 200, |g| g.clock_ticks == 120);
    }

    #[test]
    fn the_first_goal_in_overtime_wins_then_a_new_match_starts() {
        init_engine();
        let mut game = Game::new();
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.overtime = true;
        game.clock_ticks = 0;
        game.arena.set_ball([0.0, 5000.0, 300.0], [0.0, 2000.0, 0.0]); // into orange's goal: blue scores
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        assert_eq!(game.score, [1, 0]);
        let ended = run_until(&mut game, 400, |g| g.phase == Phase::PrePodium);
        assert_eq!(game.winner, Some(0));
        assert!(match_states(&mut rx).last().is_some_and(|m| m.phase == Phase::PrePodium && m.winner == Some(0) && m.score == [1, 0]));
        // The world frozen for the 3 s before the podium
        let car = game.car_id(1).unwrap();
        let frozen_at = game.car_position(1).unwrap();
        ticks(&mut game, 100);
        assert_eq!(game.car_position(1), Some(frozen_at));
        // The podium: the winner's car at the first spot, drivable, the ball gone
        let podium = run_until(&mut game, 1000, |g| g.phase == Phase::Podium);
        assert_eq!(podium - ended, (PRE_PODIUM_SECONDS * TICK_RATE as f32) as u64);
        ticks(&mut game, 1);
        let at = game.car_position(1).unwrap();
        assert!((at[0] - PODIUM_SPOTS[0].0).abs() < 40.0 && (at[1] - PODIUM_SPOTS[0].1).abs() < 40.0, "spot {at:?}");
        assert!(!game.arena.car_demoed(car));
        // The end screen after 5.3 s: frozen, its 60 s counting down; ready-up only from 1 s in
        let finished = run_until(&mut game, 1000, |g| g.phase == Phase::Finished);
        assert_eq!(finished - podium, (PODIUM_SECONDS * TICK_RATE as f32) as u64);
        assert_eq!(game.match_state().seconds_left, 60);
        game.ready_up(1);
        ticks(&mut game, 2);
        assert_eq!(game.phase, Phase::Finished, "ready before the 1 s doesn't count");
        ticks(&mut game, 120);
        game.ready_up(1);
        ticks(&mut game, 1);
        // Every player ready: a new match, 0-0, the full clock, its warm-up, then the kickoff's countdown
        assert_eq!((game.phase, game.score, game.clock_ticks, game.overtime, game.winner), (Phase::Waiting, [0, 0], MATCH_TICKS, false, None));
        run_until(&mut game, 400, |g| g.phase == Phase::Countdown);
    }

    #[test]
    fn the_end_screen_starts_the_next_match_after_60_s_and_the_podium_has_the_winners_only_mvp_first() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.end_match(0, false);
        run_until(&mut game, 1200, |g| g.phase == Phase::Finished);
        let waited = run_until(&mut game, 8000, |g| g.phase != Phase::Finished);
        assert_eq!(waited, game.finished_at + u64::from(FINISH_SECONDS * TICK_RATE));
        // A losing player has no car on the podium; the winners' second at spot 2
        let (mut game, _rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 0, 2), (3, 1, 3)]);
        roll_into(&mut game, 1); // (the first touch: 0 points)
        ticks(&mut game, 130);
        roll_into(&mut game, 2); // (a ball hit, +2: 2 has the higher score, the MVP, spot 1)
        game.end_match(0, false);
        run_until(&mut game, 1000, |g| g.phase == Phase::Podium);
        ticks(&mut game, 1);
        assert!(game.arena.car_demoed(game.car_id(3).unwrap()));
        let first = game.car_position(2).unwrap();
        let second = game.car_position(1).unwrap();
        assert!((first[1] - PODIUM_SPOTS[0].1).abs() < 40.0 && (second[1] - PODIUM_SPOTS[1].1).abs() < 40.0, "{first:?} {second:?}");
    }

    #[test]
    fn a_team_left_without_players_forfeits() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = channel(TEST_QUEUE);
        let (tx2, _rx2) = channel(TEST_QUEUE);
        let (tx3, _rx3) = channel(TEST_QUEUE);
        game.join(1, JoinRequest { team: 0, ..REQUEST }, tx1);
        game.join(2, JoinRequest { team: 1, ..REQUEST }, tx2);
        game.join(3, JoinRequest { team: 1, ..REQUEST }, tx3);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.leave(2); // (orange still has a player)
        ticks(&mut game, 10);
        assert_eq!(game.phase, Phase::Active);
        drain(&mut rx1);
        // The leaver's car explodes for the others; their team forfeits 0.01 game s later (the second tick)
        let car = game.car_id(3).unwrap();
        game.leave(3);
        assert!(events(&mut rx1).contains(&GameEvent::Left { car, lost: false, explode: true }));
        game.tick(0.0);
        assert_eq!(game.phase, Phase::Active);
        game.tick(0.0);
        assert_eq!((game.phase, game.winner, game.forfeit), (Phase::PrePodium, Some(0), true));
        assert!(match_states(&mut rx1).last().is_some_and(|m| m.phase == Phase::PrePodium && m.forfeit && m.winner == Some(0)));
        // A new match after the podium and the end screen, not a forfeit
        run_until(&mut game, 10_000, |g| g.phase == Phase::Countdown);
        assert!(!game.forfeit && game.winner.is_none());
    }

    #[test]
    fn a_goal_at_zero_counts_and_a_goal_with_time_left_is_a_kickoff() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        // With time left: a goal, then the next kickoff with the clock where it stopped
        game.clock_ticks = 5000;
        game.arena.set_ball([0.0, -5000.0, 300.0], [0.0, -2000.0, 0.0]); // orange scores
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        let clock = game.clock_ticks;
        run_until(&mut game, 400, |g| g.phase == Phase::Countdown);
        assert_eq!((game.score, game.clock_ticks, game.overtime), ([0, 1], clock, false));
        // At 0:00 with the ball in the air: a goal still counts, and wins
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        run_until(&mut game, 1000, |g| g.clock_running);
        game.clock_ticks = 1;
        game.arena.set_ball([0.0, 4500.0, 600.0], [0.0, 1500.0, 0.0]);
        run_until(&mut game, 10, |g| g.phase == Phase::TimeUp);
        run_until(&mut game, 200, |g| g.phase == Phase::PostGoal);
        assert_eq!(game.score, [1, 1]);
        // 1-1 at 0:00: overtime
        run_until(&mut game, 400, |g| g.phase == Phase::Countdown);
        assert!(game.overtime);
    }

    #[test]
    fn a_kickoff_starts_the_countdown_and_a_joiner_in_it_gets_a_kickoff_spot() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        assert_eq!(game.arena.kickoff_countdown(), 840); // (the match's first: with the warm-up)
        let first = game.car_position(1).unwrap();
        for _ in 0..100 {
            game.tick(0.0);
        }
        let (tx2, _rx2) = channel(TEST_QUEUE);
        game.join(2, JoinRequest { team: 0, ..REQUEST }, tx2);
        // Both on kickoff spots (z 17, a spot's x and y), the first car where it was; the countdown goes on
        let kickoff_spots = [(-2048.0, -2560.0), (2048.0, -2560.0), (-256.0, -3840.0), (256.0, -3840.0), (0.0, -4608.0)];
        let on_spot = |p: [f32; 3]| kickoff_spots.iter().any(|&(x, y): &(f32, f32)| (p[0].abs() - x.abs()).abs() < 0.1 && (p[1].abs() - y.abs()).abs() < 0.1);
        let second = game.car_position(2).unwrap();
        assert!(on_spot(first) && on_spot(second), "{first:?} {second:?}");
        assert_eq!(game.car_position(1).unwrap(), first);
        assert_eq!(game.arena.kickoff_countdown(), 740);
        // A goal's kickoff: the countdown alone
        game.phase = Phase::PostGoal;
        game.phase_until = game.tick_count() + 1;
        game.tick(0.0);
        assert_eq!(game.arena.kickoff_countdown(), 480);
    }

    #[test]
    fn goals_reset_to_a_kickoff_and_leaving_updates_the_others() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = channel(TEST_QUEUE);
        let (tx2, rx2) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx1);
        game.join(2, REQUEST, tx2);
        drain(&mut rx1);
        game.leave(2);
        let world = drain(&mut rx1);
        assert!(world.iter().any(|m| matches!(m, Outgoing::Control(b) if b[2] == 0x82)));
        assert_eq!(game.player_count(), 1);
        drop(rx2);
    }

    fn replay_plans(rx: &mut Receiver<Outgoing>) -> Vec<ReplayPlan> {
        drain(rx)
            .into_iter()
            .filter_map(|m| match m {
                Outgoing::Control(b) => match Control::decode(&b[2..]) {
                    Ok(Control::Replay(plan)) => Some(plan),
                    _ => None,
                },
                Outgoing::Datagram(_) => None,
            })
            .collect()
    }

    #[test]
    fn the_slow_motion_after_a_goal_makes_its_360_ticks_last_3_53_s() {
        init_engine();
        let mut game = Game::new();
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        assert_eq!(game.next_tick_seconds(), 1.0 / 120.0);
        game.arena.set_ball([0.0, 5000.0, 300.0], [0.0, 2000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        let mut real = 0.0;
        let mut slowest: f64 = 0.0;
        for _ in 0..POST_GOAL_TICKS {
            let seconds = game.next_tick_seconds();
            real += seconds;
            slowest = slowest.max(seconds);
            game.tick(0.0);
        }
        // (notes/camera-respawn-goal.md: per tick 3.5317 s; the slowest at dilation 0.1875)
        assert!((real - 3.5317).abs() < 1e-4, "{real}");
        assert!((slowest - 1.0 / 120.0 / 0.1875).abs() < 1e-12);
        assert_eq!(game.phase, Phase::Countdown);
        assert_eq!(game.next_tick_seconds(), 1.0 / 120.0);
    }

    #[test]
    fn a_goal_replay_plays_with_the_cars_frozen_until_every_player_skips_it() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = channel(TEST_QUEUE);
        let (tx2, _rx2) = channel(TEST_QUEUE);
        game.join(1, WANTS_REPLAYS, tx1);
        game.join(2, WANTS_REPLAYS, tx2);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.arena.set_ball([0.0, 5000.0, 300.0], [0.0, 2000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        let goal = game.goal_tick;
        game.ready_up(1); // (too early: only during the replay)
        drain(&mut rx1);
        let started = run_until(&mut game, 400, |g| g.phase == Phase::Replay);
        assert_eq!(started, goal + POST_GOAL_TICKS);
        let plans = replay_plans(&mut rx1);
        assert_eq!(plans.len(), 1);
        let plan = &plans[0];
        // No touch: from 10 s before the goal, but not before the ball's kickoff placement; to 3 s after it
        assert_eq!((plan.goal_tick, plan.end_tick, plan.scoring_team), (goal as u32, (goal + POST_GOAL_TICKS) as u32, 0));
        assert_eq!(plan.start_tick, game.ball_spawn_tick.max(goal.saturating_sub(1200)) as u32);
        assert!(plan.slomo.is_empty() && plan.focus.is_empty());
        // The cars get no input
        game.receive_inputs(1, 1, 1, &throttle_frames(10), 0.0);
        let before = game.car_position(1).unwrap();
        for _ in 0..10 {
            game.tick(0.0);
        }
        let after = game.car_position(1).unwrap();
        assert!((after[0] - before[0]).abs() + (after[1] - before[1]).abs() < 1.0, "{before:?} {after:?}");
        // One player ready: the replay goes on; both: the kickoff
        game.ready_up(1);
        game.tick(0.0);
        assert_eq!(game.phase, Phase::Replay);
        assert!(drain(&mut rx1).iter().any(|m| matches!(m, Outgoing::Control(b) if matches!(Control::decode(&b[2..]), Ok(Control::ReplayReady { ready: 1, total: 2 })))));
        game.ready_up(2);
        game.tick(0.0);
        assert_eq!(game.phase, Phase::Countdown);
        assert_eq!(game.arena.kickoff_countdown(), 480);
    }

    #[test]
    fn a_goal_replay_ends_after_its_real_length_and_auto_skippers_are_ready() {
        init_engine();
        let mut game = Game::new();
        let (tx1, _rx1) = channel(TEST_QUEUE);
        let (tx2, _rx2) = channel(TEST_QUEUE);
        game.join(1, WANTS_REPLAYS, tx1);
        game.join(2, REQUEST, tx2); // (skips replays: one is still played for player 1)
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.arena.set_ball([0.0, -5000.0, 300.0], [0.0, -2000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        let started = run_until(&mut game, 400, |g| g.phase == Phase::Replay);
        // (no touch, no slow motion: from the ball's spawn or 10 s before the goal, to 3 s after it, in real time)
        let ticks = game.goal_tick + POST_GOAL_TICKS - game.ball_spawn_tick.max(game.goal_tick.saturating_sub(1200));
        let ended = run_until(&mut game, 3000, |g| g.phase != Phase::Replay);
        assert_eq!(ended - started, ticks);
        assert_eq!(game.phase, Phase::Countdown);
        // Turning auto-skip on in a replay readies the player
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.arena.set_ball([0.0, -5000.0, 300.0], [0.0, -2000.0, 0.0]);
        run_until(&mut game, 1000, |g| g.phase == Phase::PostGoal);
        run_until(&mut game, 400, |g| g.phase == Phase::Replay);
        game.set_auto_skip_replay(1, true);
        game.tick(0.0);
        assert_eq!(game.phase, Phase::Countdown);
    }

    #[test]
    fn the_replay_starts_two_seconds_before_the_scoring_touch_and_slows_round_it() {
        init_engine();
        let mut game = Game::new();
        let (tx1, _rx1) = channel(TEST_QUEUE);
        let (tx2, _rx2) = channel(TEST_QUEUE);
        game.join(1, JoinRequest { team: 0, ..WANTS_REPLAYS }, tx1);
        game.join(2, JoinRequest { team: 1, ..WANTS_REPLAYS }, tx2);
        let [blue, orange] = [game.car_id(1).unwrap(), game.car_id(2).unwrap()];
        game.ball_spawn_tick = 1000;
        let goal = 5000;
        let touch = |car, team, tick| Touch { car, team, tick };
        // Blue, orange, blue twice (one run), orange (after the scoring touch): blue scores
        game.touches = [touch(blue, 0, 3000), touch(orange, 1, 4000), touch(blue, 0, 4700), touch(orange, 1, 4900)].into();
        game.slomo_for_defender = false;
        game.arena.set_ball([0.0, 0.0, 1500.0], [0.0, 0.0, 0.0]); // (no defender near)
        let plan = game.plan_replay(goal, 0);
        // The scoring touch at 4700: min(4700, goal - 4 s = 4520) - 2 s = 4280 (not before goal - 10 s, the ball's spawn)
        assert_eq!(plan.start_tick, 4280);
        assert_eq!(plan.end_tick, 5360);
        assert_eq!(plan.slomo, vec![(4700 - 30, 4700 + 12)]);
        assert_eq!(plan.focus, vec![(blue, 4700)]); // (orange's touch at 4000 is before the start)
        // A touch long before: the replay is capped at 10 s; the defender's stretch before the goal joins in
        game.touches = [touch(blue, 0, 2000)].into();
        game.slomo_for_defender = true;
        let plan = game.plan_replay(goal, 0);
        assert_eq!(plan.start_tick, 3800);
        assert_eq!(plan.slomo, vec![(4970, 5000)]); // (the hit's stretch is before the start)
        assert!(plan.focus.is_empty());
        // Its real length: a hit 1 s before the goal, 9 s shown with 0.35 s of it slowed: 10.05 s (gs_slomo.py)
        let seconds = replay_seconds(&ReplayPlan { start_tick: 0, goal_tick: 0, end_tick: 1080, scoring_team: 0, slomo: vec![(100, 142)], focus: vec![] });
        assert!((seconds - 10.05).abs() < 1e-9);
    }

    #[test]
    fn a_player_ready_by_auto_skip_stays_ready_when_turning_it_off() {
        init_engine();
        let mut game = Game::new();
        let (tx1, _rx1) = channel(TEST_QUEUE);
        let (tx2, _rx2) = channel(TEST_QUEUE);
        game.join(1, WANTS_REPLAYS, tx1);
        game.join(2, REQUEST, tx2); // (auto-skips)
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.arena.set_ball([0.0, 5000.0, 300.0], [0.0, 2000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        run_until(&mut game, 400, |g| g.phase == Phase::Replay);
        game.set_auto_skip_replay(2, false);
        game.tick(0.0);
        assert_eq!(game.phase, Phase::Replay);
        game.ready_up(1);
        game.tick(0.0);
        assert_eq!(game.phase, Phase::Countdown);
    }

    #[test]
    fn the_slow_motion_after_a_goal_leaves_the_jitter_buffer_as_it_was() {
        // The client sends its input packets at 60 Hz of real time, each with its newest frames (fewer of them through
        // the post-goal slow motion, its clock slowed with the world: online.ts), and the jitter buffer measures their
        // gaps in real time as the game's (RealTimeSeconds, MR-6.6): the slow motion leaves it as it was (MRL-16, RV-238)
        init_engine();
        let mut game = Game::new();
        game.test_goal_after = Some(60);
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        let (mut now, mut next_send, mut before, mut after, mut most) = (0.0, 0.0, None, None, 0);
        for tick in 0..2400u32 {
            while now >= next_send {
                // (the client a couple of frames ahead of the server's tick; its unacknowledged frames, the newest 10)
                let newest = tick + 2;
                let first = newest.saturating_sub(9).max(1);
                game.receive_inputs(1, (next_send * 1000.0) as u32, first, &throttle_frames((newest - first + 1) as usize), now);
                next_send += 1.0 / 60.0;
            }
            game.tick(now);
            now += game.next_tick_seconds();
            drain(&mut rx);
            let size = game.players[&1].input.jitter.buffer_size;
            if before.is_some() {
                most = most.max(size);
            }
            if game.phase == Phase::PostGoal && before.is_none() {
                before = Some(size);
            }
            if before.is_some() && game.phase == Phase::Active {
                after = Some(size);
            }
        }
        let (before, after) = (before.unwrap(), after.unwrap());
        eprintln!("jitter buffer: before the goal {before}, at most {most} after it, after the kickoff {after}");
        assert_eq!((most, after), (before, before), "the slow motion grew the jitter buffer");
    }


    #[test]
    fn the_jitter_buffer_sizes_by_real_time_gaps_through_the_slow_motion() {
        // Packets arriving 16 and 40 ms apart in real time through the goal's slow motion (gaps under 16 ms count as 16,
        // and the buffer's 50 ms floor hides a spread smaller than this): the player's jitter buffer is a real-time one's
        // fed the same arrivals, packet for packet (a game clock's gaps, slowed, would leave it at its floor: RV-263)
        init_engine();
        let mut game = Game::new();
        game.test_goal_after = Some(60);
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx);
        let mut reference = crate::input_buffer::JitterBuffer::default();
        let (mut now, mut next_send, mut short, mut slowed) = (0.0, 0.0, true, 0);
        for tick in 0..2400u32 {
            while now >= next_send {
                let newest = tick + 2;
                let first = newest.saturating_sub(9).max(1);
                game.receive_inputs(1, (next_send * 1000.0) as u32, first, &throttle_frames((newest - first + 1) as usize), next_send);
                reference.received_packet(next_send);
                let jitter = &game.players[&1].input.jitter;
                assert_eq!((jitter.buffer_size, jitter.buffer_time), (reference.buffer_size, reference.buffer_time), "at {next_send}");
                if game.phase == Phase::PostGoal {
                    slowed += 1;
                }
                next_send += if short { 0.016 } else { 0.040 };
                short = !short;
            }
            game.tick(now);
            now += game.next_tick_seconds();
            drain(&mut rx);
        }
        assert!(slowed > 100, "packets through the slow motion: {slowed}");
        assert!(reference.buffer_size > 7, "the irregular gaps grew it: {}", reference.buffer_size);
    }

    /// A match with these players (id, team, key) at "go", and their channels
    fn match_with(match_type: MatchType, team_size: u8, players: &[(PlayerId, u8, u32)]) -> (Game, Vec<Receiver<Outgoing>>) {
        init_engine();
        let mut game = Game::with_options(1, team_size);
        game.match_type = match_type;
        let mut rxs = Vec::new();
        for &(id, team, key) in players {
            let (tx, rx) = channel(TEST_QUEUE);
            game.join(id, JoinRequest { team, key, ..REQUEST }, tx);
            rxs.push(rx);
        }
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        (game, rxs)
    }

    #[test]
    fn a_forfeit_after_a_goal_ends_the_match_at_the_next_round() {
        init_engine();
        let mut game = Game::new();
        let (tx1, mut rx1) = channel(TEST_QUEUE);
        let (tx2, _rx2) = channel(TEST_QUEUE);
        game.join(1, JoinRequest { team: 0, ..WANTS_REPLAYS }, tx1);
        game.join(2, JoinRequest { team: 1, ..WANTS_REPLAYS }, tx2);
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.arena.set_ball([0.0, 5000.0, 300.0], [0.0, 2000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        // Orange leaves after blue's goal: the forfeit waits, and the replay plays (MRL-13); no votes meanwhile (a team
        // forfeiting has a winner: with the clock's wait long over, only that keeps them off)
        game.leave(2);
        ticks(&mut game, 5);
        assert_eq!((game.phase, game.forfeiting, game.winner), (Phase::PostGoal, Some(1), None));
        game.clock_ticks = 200 * TICK_RATE;
        assert!(!game.match_state().can_vote_forfeit);
        run_until(&mut game, 400, |g| g.phase == Phase::Replay);
        drain(&mut rx1);
        game.ready_up(1);
        game.tick(0.0);
        assert_eq!((game.phase, game.winner, game.forfeit), (Phase::PrePodium, Some(0), true));
    }

    #[test]
    fn everyone_leaving_is_a_no_contest_and_the_next_player_starts_a_match() {
        let (mut game, _rxs) = match_with(MatchType::Casual, 3, &[(1, 0, 1)]);
        game.leave(1);
        let state = game.match_state();
        assert_eq!((state.phase, state.winner, state.forfeit, state.no_contest), (Phase::Finished, None, false, true));
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(2, REQUEST, tx);
        let state = game.match_state();
        assert_eq!((state.phase, state.no_contest), (Phase::Waiting, false));
    }

    #[test]
    fn forfeit_votes_wait_for_the_clock_and_need_every_teammate() {
        // Blue leads 3-0 and still forfeits
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 11), (2, 0, 12), (3, 1, 13), (4, 1, 14)]);
        game.score = [3, 0];
        // Casual: not before 60 s of the clock (4:00 shown)
        game.clock_ticks = MATCH_TICKS - 60 * TICK_RATE;
        game.vote_forfeit(1);
        assert!(game.votes[0].is_none() && !game.match_state().can_vote_forfeit);
        game.clock_ticks -= 1;
        assert!(game.match_state().can_vote_forfeit);
        game.vote_forfeit(1);
        let starter = last_vote(&mut rxs[0]).unwrap();
        let mate = last_vote(&mut rxs[1]).unwrap();
        assert_eq!(starter, ForfeitVoteState { state: protocol::VOTE_RUNNING, yes: 1, required: 2, seconds_left: 20, voted: true, can_start: false });
        assert_eq!(mate, ForfeitVoteState { voted: false, can_start: true, ..starter });
        assert_eq!(last_vote(&mut rxs[2]).map(|v| v.state), Some(protocol::VOTE_NONE), "orange's vote");
        // A joiner on blue votes too; the time counts down in game seconds
        let (tx5, mut rx5) = channel(TEST_QUEUE);
        game.join(5, JoinRequest { team: 0, key: 15, ..REQUEST }, tx5);
        ticks(&mut game, 120);
        assert_eq!(last_vote(&mut rx5).map(|v| (v.yes, v.required, v.seconds_left)), Some((1, 3, 19)));
        game.vote_forfeit(1); // (again: no change)
        game.vote_forfeit(2);
        assert_eq!(game.phase, Phase::Active);
        game.vote_forfeit(5);
        assert_eq!((game.phase, game.winner, game.forfeit), (Phase::PrePodium, Some(1), true));
    }

    #[test]
    fn a_reconnect_while_the_old_session_is_still_here_keeps_the_lockout_under_a_new_key() {
        // (RV-265: the old session not yet timed out holds the key; the new one gets another, still locked out)
        let (mut game, mut rxs) = match_with(MatchType::Casual, 3, &[(1, 0, 11), (2, 0, 12), (3, 1, 13)]);
        game.clock_ticks = 200 * TICK_RATE;
        game.vote_forfeit(1);
        ticks(&mut game, 20 * 120);
        drain(&mut rxs[0]);
        let starter = game.players[&1].key;
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(4, JoinRequest { team: 0, key: starter, ..REQUEST }, tx);
        assert_ne!(game.players[&4].key, starter, "the key is still the old session's");
        assert_eq!(last_vote(&mut rx).map(|v| v.can_start), Some(false));
        game.vote_forfeit(4);
        assert!(game.votes[0].as_ref().is_some_and(|v| v.finished.is_some()), "no new vote");
        // (a key that started nothing carries nothing)
        let mate = game.players[&2].key;
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(5, JoinRequest { team: 0, key: mate, ..REQUEST }, tx);
        assert_eq!(last_vote(&mut rx).map(|v| v.can_start), Some(true));
    }

    #[test]
    fn a_new_match_lets_last_matchs_vote_starters_start_one_and_forgets_leavers_keys() {
        // (RV-269, RV-270: the initiators and the per-player lockouts start over; only the keys of the players here stay)
        let (mut game, mut rxs) = match_with(MatchType::Casual, 3, &[(1, 0, 11), (2, 0, 12), (3, 1, 13), (4, 1, 14)]);
        game.clock_ticks = 200 * TICK_RATE;
        game.vote_forfeit(1);
        ticks(&mut game, 20 * 120);
        assert!(game.players[&1].vote_start_disabled);
        let leaver = game.players[&4].key;
        game.leave(4);
        assert!(game.issued_keys.contains(&leaver), "kept through the match (a reconnect brings it back)");
        game.end_match(1, false);
        game.new_match();
        run_until(&mut game, 1000, |g| g.phase == Phase::Active);
        game.clock_ticks = 200 * TICK_RATE;
        assert!(!game.players[&1].vote_start_disabled);
        // (rejoining with their key, kept as they're here: no longer an initiator either)
        let starter = game.players[&1].key;
        game.leave(1);
        let (tx, _rx) = channel(TEST_QUEUE);
        game.join(6, JoinRequest { team: 0, key: starter, ..REQUEST }, tx);
        assert_eq!(game.players[&6].key, starter);
        drain(&mut rxs[1]);
        game.vote_forfeit(6);
        assert!(game.votes[0].as_ref().is_some_and(|v| v.finished.is_none()), "the former starter starts one");
        assert!(!game.issued_keys.contains(&leaver));
        assert_eq!(game.issued_keys.len(), 3);
    }

    #[test]
    fn a_failed_vote_locks_out_its_starter_until_every_teammate_has_started_one() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 3, &[(1, 0, 11), (2, 0, 12), (3, 1, 13)]);
        game.clock_ticks = 200 * TICK_RATE;
        game.vote_forfeit(1);
        ticks(&mut game, 20 * 120 - 1);
        assert_eq!(game.votes[0].as_ref().map(|v| v.finished), Some(None));
        game.tick(0.0);
        assert_eq!(last_vote(&mut rxs[0]).map(|v| (v.state, v.can_start)), Some((protocol::VOTE_FAILED, false)));
        // The starter can't start another (the game's menu hides it; the server refuses it), even after reconnecting
        game.vote_forfeit(1);
        assert_eq!(game.votes[0].as_ref().map(|v| v.finished.is_some()), Some(true));
        let starter = game.players[&1].key; // (the server's key for them, which their client brings back)
        game.leave(1);
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(4, JoinRequest { team: 0, key: starter, ..REQUEST }, tx);
        assert_eq!(game.players[&4].key, starter, "a reconnect keeps its key");
        assert_eq!(last_vote(&mut rx).map(|v| v.can_start), Some(false));
        game.vote_forfeit(4);
        assert_eq!(game.votes[0].as_ref().map(|v| v.finished.is_some()), Some(true));
        // A teammate can, at once (replacing the failed one, shown up to 5 s)
        game.vote_forfeit(2);
        assert_eq!(game.votes[0].as_ref().map(|v| (v.finished, v.yes())), Some((None, 1)));
        // When that fails too, nobody on the team may start one: all may again
        ticks(&mut game, 20 * 120);
        assert_eq!(last_vote(&mut rx).map(|v| (v.state, v.can_start)), Some((protocol::VOTE_FAILED, true)));
        assert_eq!(last_vote(&mut rxs[1]).map(|v| v.can_start), Some(true));
        // ... and 5 s later it's gone
        ticks(&mut game, 5 * 120);
        assert_eq!(last_vote(&mut rx).map(|v| v.state), Some(protocol::VOTE_NONE));
        // The match remembers who started one: the starter, re-enabled, then leaving and coming back, can't again
        // (`ForfeitInitiatorIDs` only grows: RV-239)
        game.leave(4);
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(5, JoinRequest { team: 0, key: starter, ..REQUEST }, tx);
        assert_eq!(last_vote(&mut rx).map(|v| v.can_start), Some(false));
    }

    #[test]
    fn keys_are_the_servers_and_two_tabs_cant_share_one() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 3, &[(1, 0, 0), (2, 1, 77)]);
        let welcome_key = |rx: &mut Receiver<Outgoing>| -> Option<u32> {
            controls(rx).into_iter().find_map(|c| if let Control::Welcome { key, .. } = c { Some(key) } else { None })
        };
        drain(&mut rxs[1]);
        let one = game.players[&1].key;
        assert!(one != 0 && game.players[&2].key != 77, "a key this server didn't give is replaced");
        // A copy of a connected player's key (a duplicated tab) gets a new one; a gone player's key comes back to them
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(3, JoinRequest { key: one, ..REQUEST }, tx);
        let three = welcome_key(&mut rx).unwrap();
        assert!(three != one && three != 0);
        game.leave(1);
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(4, JoinRequest { key: one, ..REQUEST }, tx);
        assert_eq!(welcome_key(&mut rx), Some(one));
    }

    #[test]
    fn a_vote_passes_on_a_lone_players_press_and_private_matches_vote_in_1v1s_only() {
        // Ranked: from 90 s of the clock; a team of one forfeits on the press
        let (mut game, _rxs) = match_with(MatchType::Ranked, 3, &[(1, 0, 11), (2, 1, 12)]);
        game.clock_ticks = MATCH_TICKS - 61 * TICK_RATE;
        assert!(!game.match_state().can_vote_forfeit);
        game.clock_ticks = MATCH_TICKS - 91 * TICK_RATE;
        game.vote_forfeit(2);
        assert_eq!((game.phase, game.winner, game.forfeit), (Phase::PrePodium, Some(0), true));
        // Overtime: always
        let (mut game, _rxs) = match_with(MatchType::Ranked, 3, &[(1, 0, 11), (2, 1, 12)]);
        (game.overtime, game.clock_ticks) = (true, 0);
        assert!(game.match_state().can_vote_forfeit);
        // Private: votes in 1v1s only, and no forfeit when a team leaves
        let (mut game, _rxs) = match_with(MatchType::Private, 2, &[(1, 0, 11), (2, 1, 12)]);
        game.clock_ticks = 100 * TICK_RATE;
        assert!(!game.match_state().can_vote_forfeit);
        game.leave(2);
        ticks(&mut game, 5);
        assert_eq!((game.phase, game.winner), (Phase::Active, None));
        let (mut game, _rxs) = match_with(MatchType::Private, 1, &[(1, 0, 11), (2, 1, 12)]);
        game.clock_ticks = 100 * TICK_RATE;
        assert!(game.match_state().can_vote_forfeit);
    }

    #[test]
    fn a_leave_from_a_full_public_lobby_ends_the_votes() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 11), (2, 0, 12), (3, 1, 13), (4, 1, 14)]);
        game.clock_ticks = 200 * TICK_RATE;
        game.vote_forfeit(1);
        assert_eq!(last_vote(&mut rxs[1]).map(|v| v.state), Some(protocol::VOTE_RUNNING));
        // (the leave penalty lifts: `OnPenaltyChanged`)
        game.leave(4);
        assert_eq!(last_vote(&mut rxs[1]).map(|v| v.state), Some(protocol::VOTE_NONE));
        // Without a full lobby, a leave from the voting team takes the leaver's vote out: the rest still need to vote
        game.vote_forfeit(2);
        game.leave(2);
        let vote = last_vote(&mut rxs[0]).unwrap();
        assert_eq!((vote.state, vote.yes, vote.required), (protocol::VOTE_RUNNING, 0, 1));
    }


    #[test]
    fn the_playlist_can_set_the_wait_before_votes() {
        let (mut game, _rxs) = match_with(MatchType::Ranked, 3, &[(1, 0, 11), (2, 1, 12)]);
        game.forfeit_vote_wait = Some(0);
        assert!(!game.match_state().can_vote_forfeit, "the clock hasn't run");
        game.clock_ticks -= 1;
        assert!(game.match_state().can_vote_forfeit);
    }

    #[test]
    fn a_release_and_a_press_consumed_together_reach_the_car() {
        // Frames in a burst are consumed one or two a tick; a pair with a release and a press is a fresh press: in the
        // air, the double jump, which jump held throughout doesn't give (NET-2 through the game: RV-219)
        init_engine();
        // (the apex, and each tick's last frame consumed and repress)
        let run = |release: Option<usize>| -> (f32, Vec<(u32, bool)>) {
            let mut game = Game::new();
            let (tx, _rx) = channel(TEST_QUEUE);
            game.join(1, REQUEST, tx);
            run_until(&mut game, 1000, |g| g.phase == Phase::Active);
            let now = game.tick_count() as f64 / 120.0;
            let held = InputFrame { bits: protocol::BIT_JUMP, ..InputFrame::default() };
            let mut frames = vec![held; 60];
            if let Some(at) = release {
                frames[at] = InputFrame::default();
            }
            game.receive_inputs(1, 1, 1, &frames, now);
            let (mut top, mut trace): (f32, _) = (0.0, Vec::new());
            for _ in 0..90 {
                game.tick(now);
                let input = &game.players[&1].input;
                trace.push((input.ack_frame(), input.repress_jump));
                top = top.max(game.car_position(1).unwrap()[2]);
            }
            (top, trace)
        };
        let (held, trace) = run(None);
        // A tick after the jump's 24 consuming two frames (which ticks do doesn't depend on the frames): the release in
        // the first of them (frame n is frames[n - 1])
        let k = (26..trace.len()).find(|&k| trace[k].0 == trace[k - 1].0 + 2).unwrap();
        let (repressed, with) = run(Some(trace[k - 1].0 as usize));
        assert!(with[k].1, "the pair with the release and the press");
        assert!(repressed > held + 50.0, "held {held}, with the release {repressed}");
    }


    /// The quick-chat lines sent: (sender's car, preset, team, seconds)
    fn chats(rx: &mut Receiver<Outgoing>) -> Vec<(u32, u8, bool, u16)> {
        controls(rx)
            .into_iter()
            .filter_map(|c| if let Control::Chat { car, preset, team, seconds } = c { Some((car, preset, team, seconds)) } else { None })
            .collect()
    }

    #[test]
    fn players_have_names_and_everyone_gets_the_roster() {
        init_engine();
        let mut game = Game::new();
        let mut rxs = Vec::new();
        for (id, name) in [(1, "  Merc\u{7}ury  "), (2, ""), (3, "a name far longer than thirty-two bytes, cut")] {
            let (tx, rx) = channel(TEST_QUEUE);
            game.join(id, JoinRequest { name: name.to_string(), ..REQUEST }, tx);
            rxs.push(rx);
        }
        let roster = controls(&mut rxs[0]).into_iter().filter_map(|c| if let Control::Roster(r) = c { Some(r) } else { None }).next_back().unwrap();
        let names: Vec<&str> = roster.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Mercury", "Player 2", "a name far longer than thirty-tw"]);
        assert_eq!(roster.iter().map(|p| (p.car, p.team)).collect::<Vec<_>>(), [(1, 0), (2, 1), (3, 0)]);
        // A leave: the roster without them, and why they went
        game.connection_lost(2);
        let left = controls(&mut rxs[0]);
        assert!(left.iter().any(|c| matches!(c, Control::Event { event: GameEvent::Left { car: 2, lost: true, .. }, .. })));
        assert!(left.iter().any(|c| matches!(c, Control::Roster(r) if r.len() == 2)));
    }

    #[test]
    fn quick_chat_reaches_the_channel_stamped_with_the_clock() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 0, 2), (3, 1, 3)]);
        game.clock_ticks = 250 * TICK_RATE + 30; // (4:11 shown)
        for rx in &mut rxs {
            drain(rx);
        }
        // "I got it!" to the team: the sender and the teammate, not orange
        game.quick_chat(1, 0, true, 0.0);
        assert_eq!(chats(&mut rxs[0]), [(1, 0, true, 251)]);
        assert_eq!(chats(&mut rxs[1]), [(1, 0, true, 251)]);
        assert!(chats(&mut rxs[2]).is_empty());
        // "Nice shot!" to all
        game.quick_chat(3, 22, false, 0.0);
        for rx in &mut rxs {
            assert_eq!(chats(rx), [(3, 22, false, 251)]);
        }
        // (no such preset: nothing)
        game.quick_chat(1, protocol::QUICK_CHAT_PRESETS, false, 0.0);
        assert!(chats(&mut rxs[0]).is_empty());
    }

    #[test]
    fn the_spam_filter_lets_three_through_then_blocks_with_a_notice() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 1, 2)]);
        drain(&mut rxs[1]);
        for _ in 0..3 {
            game.quick_chat(1, 22, false, 10.0);
        }
        assert_eq!(chats(&mut rxs[1]).len(), 3);
        game.quick_chat(1, 22, false, 10.0);
        let notice = controls(&mut rxs[0]).into_iter().find_map(|c| if let Control::ChatBlocked { seconds } = c { Some(seconds) } else { None });
        assert!(notice.is_some_and(|s| (s - 2.975).abs() < 1e-4), "{notice:?}");
        assert!(chats(&mut rxs[1]).is_empty());
        // (a blocked attempt adds nothing: allowed again 2.975 s after the first block)
        game.quick_chat(1, 22, false, 12.0);
        assert!(chats(&mut rxs[1]).is_empty());
        game.quick_chat(1, 22, false, 13.0);
        assert_eq!(chats(&mut rxs[1]).len(), 1);
    }

    #[test]
    fn chat_filters_on_both_sides() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 0, 2), (3, 1, 3), (4, 1, 4)]);
        for rx in &mut rxs {
            drain(rx);
        }
        // Recipients: off gets nothing, team-only gets its team's, a non-tactical block keeps out "Nice shot!" during the
        // match but not "I got it!"
        game.set_chat_filter(2, protocol::CHAT_OFF, false);
        game.set_chat_filter(3, protocol::CHAT_TEAM, false);
        game.set_chat_filter(4, protocol::CHAT_EVERYONE, true);
        game.quick_chat(1, 22, false, 0.0);
        game.quick_chat(1, 0, false, 10.0);
        let got: Vec<Vec<u8>> = rxs.iter_mut().map(|rx| chats(rx).iter().map(|c| c.1).collect()).collect();
        assert_eq!(got, [vec![22, 0], vec![], vec![], vec![0]]);
        // After the match, post-game chat isn't non-tactical: "gg" (59) reaches the blocker
        game.end_match(0, false);
        game.quick_chat(1, 59, false, 20.0);
        assert_eq!(chats(&mut rxs[3]).iter().map(|c| c.1).collect::<Vec<_>>(), [59]);
        // Senders: team-only goes to the team; friends-only to nobody else (no friends); off sends nothing
        for rx in &mut rxs {
            drain(rx);
        }
        game.set_chat_filter(2, protocol::CHAT_EVERYONE, false);
        game.set_chat_filter(1, protocol::CHAT_TEAM, false);
        game.quick_chat(1, 22, false, 30.0);
        assert_eq!(chats(&mut rxs[1]), [(1, 22, true, shown_seconds(&game.match_state()) as u16)]);
        assert!(chats(&mut rxs[3]).is_empty());
        drain(&mut rxs[0]);
        game.set_chat_filter(1, protocol::CHAT_FRIENDS, false);
        game.quick_chat(1, 22, false, 40.0);
        assert_eq!(chats(&mut rxs[0]).len(), 1, "the sender sees their own");
        assert!(chats(&mut rxs[1]).is_empty());
        game.set_chat_filter(1, protocol::CHAT_OFF, false);
        game.quick_chat(1, 22, false, 50.0);
        assert!(chats(&mut rxs[0]).is_empty());
    }


    #[test]
    fn a_leavers_car_explodes_only_when_its_there() {
        // (RV-235, RV-264: a live car in the game's sense; not one already demolished, none in the goal replay)
        let (mut game, mut rxs) = match_with(MatchType::Private, 3, &[(1, 0, 1), (2, 1, 2), (3, 0, 3), (4, 1, 4)]);
        let explode = |rx: &mut Receiver<Outgoing>| -> Option<bool> {
            events(rx).into_iter().find_map(|e| if let GameEvent::Left { explode, .. } = e { Some(explode) } else { None })
        };
        drain(&mut rxs[0]);
        game.leave(2);
        assert_eq!(explode(&mut rxs[0]), Some(true));
        let car = game.car_id(3).unwrap();
        game.arena.demolish_car(car);
        game.leave(3);
        assert_eq!(explode(&mut rxs[0]), Some(false), "a demolished car");
        game.phase = Phase::Replay;
        game.leave(4);
        assert_eq!(explode(&mut rxs[0]), Some(false), "in the goal replay (the game destroys the cars for it)");
    }


    #[test]
    fn votes_wait_for_no_winner_overtime_allows_them_and_a_finished_one_stays_5_s() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 3, &[(1, 0, 0), (2, 0, 0), (3, 1, 0)]);
        // At 0:00 with the scores apart a team has won: no votes; tied, they are
        (game.clock_ticks, game.score) = (0, [1, 0]);
        assert!(!game.match_state().can_vote_forfeit);
        game.score = [1, 1];
        assert!(game.match_state().can_vote_forfeit);
        // Overtime: always, its clock counting up past the regulation wait's equivalent too
        (game.overtime, game.clock_ticks, game.score) = (true, 30_000, [0, 0]);
        assert!(game.match_state().can_vote_forfeit);
        (game.overtime, game.clock_ticks) = (false, 200 * TICK_RATE);
        // A failed vote stays its 5 s, then goes
        game.vote_forfeit(1);
        ticks(&mut game, 20 * 120);
        assert!(game.votes[0].as_ref().is_some_and(|v| v.finished == Some((false, game.tick_count()))));
        ticks(&mut game, 5 * 120 - 1);
        assert!(game.votes[0].is_some(), "gone before its 5 s");
        ticks(&mut game, 1);
        assert!(game.votes[0].is_none());
        // The match's end ends a running vote
        game.vote_forfeit(2);
        drain(&mut rxs[0]);
        game.end_match(1, false);
        game.send_votes();
        assert!(game.votes.iter().all(Option::is_none));
        assert_eq!(last_vote(&mut rxs[0]).map(|v| v.state), Some(protocol::VOTE_NONE));
    }


    #[test]
    fn a_full_match_refuses_a_join() {
        init_engine();
        let mut game = Game::new();
        let mut rxs = Vec::new();
        for id in 0..MAX_PLAYERS as PlayerId {
            let (tx, rx) = channel(TEST_QUEUE);
            game.join(id, REQUEST, tx);
            rxs.push(rx);
        }
        let (tx, mut rx) = channel(TEST_QUEUE);
        game.join(99, REQUEST, tx);
        assert_eq!(controls(&mut rx), [Control::Refused { reason: protocol::REFUSED_FULL }]);
        assert_eq!(game.player_count(), MAX_PLAYERS);
        assert!(rx.try_recv().is_err(), "nothing more: the game let go of it");
    }


    fn stat_events(rx: &mut Receiver<Outgoing>) -> Vec<(u8, u16)> {
        controls(rx).into_iter().filter_map(|c| if let Control::StatEvent { event, points } = c { Some((event, points)) } else { None }).collect()
    }

    fn last_scoreboard(rx: &mut Receiver<Outgoing>) -> Option<Vec<ScoreboardEntry>> {
        controls(rx).into_iter().filter_map(|c| if let Control::Scoreboard(e) = c { Some(e) } else { None }).next_back()
    }

    /// The ball rolled into a car until it touches it
    fn roll_into(game: &mut Game, player: PlayerId) {
        let car = game.car_position(player).unwrap();
        game.arena.set_ball([car[0], car[1] + 400.0, 93.0], [0.0, -1500.0, 0.0]);
        let car_id = game.car_id(player).unwrap();
        let before = game.arena.car_last_ball_touch_tick(car_id);
        run_until(game, 300, |g| g.arena.car_last_ball_touch_tick(car_id) != before);
        ticks(game, 3);
    }

    #[test]
    fn the_match_end_gives_both_teams_podium_titles_on_the_scoreboard_until_the_next_match() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 1, &[(1, 0, 1), (2, 1, 2)]);
        roll_into(&mut game, 1); // (the first touch, the only ball touch)
        game.end_match(1, false); // (orange wins: titles go to the losers too)
        ticks(&mut game, 1);
        let car = game.car_id(1).unwrap();
        let board = last_scoreboard(&mut rxs[1]).unwrap();
        // Aggressor (FirstTouches, 2 points), then Benchwarmer (the fewest ball touches, 0 points); orange: nothing qualifies
        let line = board.iter().find(|e| e.car == car).unwrap();
        assert_eq!(line.titles, [Some(PodiumTitle { title: 20, count: 1 }), Some(PodiumTitle { title: 25, count: 1 })]);
        assert!(board.iter().filter(|e| e.car != car).all(|e| e.titles == [None, None]));
        game.new_match();
        ticks(&mut game, 1);
        assert!(last_scoreboard(&mut rxs[0]).unwrap().iter().all(|e| e.titles == [None, None]));
    }

    #[test]
    fn a_goal_credits_its_scorer_and_the_assist_with_popups_feed_and_scoreboard() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 0, 2), (3, 1, 3)]);
        roll_into(&mut game, 1); // (the round's first touch)
        roll_into(&mut game, 2);
        for rx in &mut rxs {
            drain(rx);
        }
        game.arena.set_ball([0.0, 4900.0, 300.0], [0.0, 3000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        let orange = controls(&mut rxs[2]);
        let goal = orange.iter().find_map(|c| if let Control::Event { event: e @ GameEvent::Goal { .. }, .. } = c { Some(*e) } else { None });
        assert_eq!(goal, Some(GameEvent::Goal { team: 0, scorer: 2, assister: 1 }));
        let scorer = stat_events(&mut rxs[1]);
        assert!(scorer.contains(&(stat::GOAL, 100)), "{scorer:?}");
        let blue = controls(&mut rxs[0]);
        assert!(blue.contains(&Control::StatEvent { event: stat::ASSIST, points: 50 }));
        // Everyone's feed has the goal and the assist; the scoreboard the counters
        let feed: Vec<(u8, u32)> =
            orange.into_iter().filter_map(|c| if let Control::Ticker { event, receiver, .. } = c { Some((event, receiver)) } else { None }).collect();
        assert!(feed.contains(&(stat::GOAL, 2)) && feed.contains(&(stat::ASSIST, 1)), "{feed:?}");
        let board = blue.into_iter().filter_map(|c| if let Control::Scoreboard(e) = c { Some(e) } else { None }).next_back().unwrap();
        let line = |car: u32| board.iter().find(|e| e.car == car).unwrap().counters.clone();
        assert_eq!((line(2)[1], line(1)[2]), (1, 1), "goals, assists");
        assert!(line(2)[0] >= 100 && line(1)[0] >= 50, "scores {} {}", line(2)[0], line(1)[0]);
    }

    #[test]
    fn the_match_end_gives_wins_losses_and_the_winning_teams_best_the_mvp() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 0, 2), (3, 1, 3)]);
        roll_into(&mut game, 1);
        roll_into(&mut game, 2);
        game.arena.set_ball([0.0, 4900.0, 300.0], [0.0, 3000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        for rx in &mut rxs {
            drain(rx);
        }
        game.end_match(0, false);
        ticks(&mut game, 1);
        assert_eq!(stat_events(&mut rxs[1]), [(stat::WIN, 0), (stat::MVP, 0)]);
        assert_eq!(stat_events(&mut rxs[0]), [(stat::WIN, 0)]);
        let orange = controls(&mut rxs[2]);
        let lost: Vec<u8> = orange.iter().filter_map(|c| if let Control::StatEvent { event, .. } = c { Some(*event) } else { None }).collect();
        assert_eq!(lost, [stat::LOSS]);
        let board = orange.into_iter().filter_map(|c| if let Control::Scoreboard(e) = c { Some(e) } else { None }).next_back().unwrap();
        assert_eq!(board.iter().filter(|e| e.mvp).map(|e| e.car).collect::<Vec<_>>(), [2]);

        // A former member who'd have been the MVP takes it with them: nobody here is
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 0, 2), (3, 1, 3)]);
        roll_into(&mut game, 1);
        roll_into(&mut game, 2);
        game.arena.set_ball([0.0, 4900.0, 300.0], [0.0, 3000.0, 0.0]);
        run_until(&mut game, 120, |g| g.phase == Phase::PostGoal);
        game.leave(2);
        drain(&mut rxs[0]);
        game.end_match(0, false);
        assert_eq!(stat_events(&mut rxs[0]), [(stat::WIN, 0)]);

        // No MVP in a 1v1 playlist
        let (mut game, mut rxs) = match_with(MatchType::Casual, 1, &[(1, 0, 1), (2, 1, 2)]);
        drain(&mut rxs[0]);
        game.end_match(0, false);
        assert_eq!(stat_events(&mut rxs[0]), [(stat::WIN, 0)]);
    }

    #[test]
    fn a_new_match_starts_the_counters_over() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 1, &[(1, 0, 1), (2, 1, 2)]);
        roll_into(&mut game, 1);
        roll_into(&mut game, 1);
        ticks(&mut game, 130);
        roll_into(&mut game, 1); // (a ball hit: +2)
        assert!(game.players[&1].stats[0] > 0);
        game.new_match();
        ticks(&mut game, 1);
        assert_eq!(game.players[&1].stats, [0; STAT_COUNTERS]);
        assert!(last_scoreboard(&mut rxs[1]).unwrap().iter().all(|e| e.counters.iter().all(|&c| c == 0)));
    }

    #[test]
    fn a_muted_players_chat_isnt_relayed_to_who_muted_them() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 1, 2)]);
        drain(&mut rxs[1]);
        game.set_mute(2, 1, true);
        game.quick_chat(1, 22, false, 0.0);
        assert!(chats(&mut rxs[1]).is_empty());
        assert_eq!(chats(&mut rxs[0]).len(), 1, "the sender still sees their own");
        game.set_mute(2, 1, false);
        game.quick_chat(1, 23, false, 10.0);
        assert_eq!(chats(&mut rxs[1]).len(), 1);
    }

    #[test]
    fn the_non_tactical_block_has_no_phase_and_a_flood_queues_few_notices() {
        // RV-247: blocked after the match too (the game's filter is by preset only)
        let (mut game, mut rxs) = match_with(MatchType::Casual, 2, &[(1, 0, 1), (2, 1, 2)]);
        game.set_chat_filter(2, protocol::CHAT_EVERYONE, true);
        game.end_match(0, false);
        drain(&mut rxs[1]);
        game.quick_chat(1, 51, false, 0.0);
        assert!(chats(&mut rxs[1]).is_empty());
        game.quick_chat(1, 0, false, 5.0); // (a tactical one still reaches them)
        assert_eq!(chats(&mut rxs[1]).len(), 1);
        // RV-248: 100k blocked attempts within a second queue a notice or two
        drain(&mut rxs[0]);
        for i in 0..100_000 {
            game.quick_chat(1, 22, false, 20.0 + f64::from(i) * 1e-5);
        }
        let notices = controls(&mut rxs[0]).into_iter().filter(|c| matches!(c, Control::ChatBlocked { .. })).count();
        assert!((1..=3).contains(&notices), "{notices} notices");
    }

    #[test]
    fn pings_reach_the_scoreboard_every_two_seconds() {
        let (mut game, mut rxs) = match_with(MatchType::Casual, 1, &[(1, 0, 1), (2, 1, 2)]);
        ticks(&mut game, 1);
        drain(&mut rxs[1]);
        game.set_ping(1, 1234);
        ticks(&mut game, 2 * 120);
        let board = last_scoreboard(&mut rxs[1]).unwrap();
        assert_eq!(board.iter().find(|e| e.car == 1).map(|e| e.ping), Some(999));
    }


    #[test]
    fn names_lose_hidden_characters_and_cant_take_another_players_automatic_name() {
        assert_eq!(player_name("\u{202E}ziggy", 3), "ziggy");
        assert_eq!(player_name("\u{2066}Bo\u{2069}", 3), "Bo");
        assert_eq!(player_name("\u{200B}", 3), "Player 3");
        assert_eq!(player_name("\u{FEFF}", 3), "Player 3");
        assert_eq!(player_name("\u{3164}", 3), "Player 3");
        assert_eq!(player_name("a\u{2028}b", 3), "ab");
        assert_eq!(player_name("Player 2", 3), "Player 3");
        assert_eq!(player_name("Player 2x", 3), "Player 2x");
        assert_eq!(player_name("\u{FFFD}", 3), "Player 3"); // (an invalid UTF-8 name)
    }

    #[test]
    fn the_tactical_range_ends_at_58_and_the_bucket_blocks_only_over_4() {
        assert!(!tactical(58) && tactical(59) && tactical(21) && !tactical(22));
        // (exactly 4 isn't over: the fourth line passes at 4.0, the next is blocked)
        let mut bucket = ChatBucket { value: 4.0, last: 0.0 };
        assert_eq!(bucket.apply(0.0), None);
        assert!(bucket.apply(0.0).is_some());
    }


    #[test]
    fn a_player_who_stops_reading_is_dropped_when_their_queue_fills() {
        init_engine();
        let mut game = Game::new();
        let (tx1, _rx1) = channel(64); // (never read)
        let (tx2, mut rx2) = channel(TEST_QUEUE);
        game.join(1, REQUEST, tx1);
        game.join(2, REQUEST, tx2);
        run_until(&mut game, 1000, |g| g.player_count() == 1);
        assert!(game.players.contains_key(&2));
        let left = events(&mut rx2).into_iter().find_map(|e| if let GameEvent::Left { car, lost, .. } = e { Some((car, lost)) } else { None });
        assert_eq!(left, Some((1, true)));
    }

}
