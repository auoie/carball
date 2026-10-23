//! The match host: runs the matches on the game thread. The accounts service's matchmaker decides who plays together,
//! where, and in which seat (notes/matchmaking.md, the central matchmaker): each player claims their seat with its match
//! ticket (`claim_seat`), and the first claim of a match opens it here. A match starts when every seat is claimed (full
//! start: `Game::hold_for`), and is cancelled if one isn't within `RESERVATION_SECONDS` of the first claim or a player
//! leaves before it starts: the claimed players are told (`KICK_NOT_ALL_JOINED`) and search again, the matchmaker told
//! which seats stalled it (`Report::Cancelled`: RV-367). Its start and an end with no result are told too, so the
//! matchmaker frees its accounts (`Report::Started`, `Report::Over`). A match
//! over (its end screen's time up) or left by everyone is let go. Development servers host one open match that anyone
//! joins (`join_open`), which rematches and never ends. Each match is on Night, the one map (the user's decision of
//! 2026-10-17), sent as map 0 in its `MatchFound` and every player's welcome.

use std::collections::{BTreeMap, HashMap};

use crate::chan::Sender;

use crate::game::{Game, JoinRequest, MatchType, Outgoing, PlayerId, SeatTicket, TICK_RATE, random_u64};

use crate::protocol::{self, Control};

/// A playlist: its team size, match type and forfeit vote wait (s; None: the match type's)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Playlist {
    pub team_size: u8,
    pub match_type: MatchType,
    pub forfeit_vote_wait: Option<f32>,
}

/// How long a match waits for its players from its first claim: about the user's 12 s from the match found (RV-367: well
/// under the game's 30 s, MM-18, which let one no-show hold the others that long), less the 3 s "Joining in" countdown
/// before any claim
pub const RESERVATION_SECONDS: f64 = 10.0;

/// How long a cancelled or finished match's id is remembered (s): its match tickets' life and the clocks' skew, so a late
/// claim can't open it again
const CLOSED_MEMORY: f64 = 60.0;

/// At most this many ticks of a match to catch up after a stall; beyond that, its time is dropped
const MAX_CATCH_UP_TICKS: u32 = 5;

/// A leave after the match hasn't ticked this long (s) is the server's outage, not the player's: no ban (LV1's leniency:
/// every connected player received nothing for 20 s)
const OUTAGE_SECONDS: f64 = 20.0;

/// A seat's session heard from within this long (s) is live: a rejoin never takes it over (another tab of the account,
/// RX30C); one silent longer (its page gone, not yet timed out at 10 s) is taken over
const TAKEOVER_SILENCE: f64 = 3.0;

/// An armed leave by a lost connection waits this long (s) before it's reported: if most of the match's seats lose
/// theirs within it either side, it's the server's network outage (each session timing out together), not the
/// player's: no ban (LV1's leniency, AP3). A leave the player chose is reported at once
const OUTAGE_WINDOW: f64 = 5.0;

/// What the ranked rules tell the accounts service, as it happens (notes/accounts.md §3; LV1): taken by the network
/// server (`take_reports`), sent by its outbox. Only for seats with tickets (the queue's: never the local host's)
#[derive(Clone, Debug, PartialEq)]
pub enum Report {
    /// An armed leave (the lobby full of humans, no winner yet, the first leaver): the leaver's first ticket, its account
    /// checked again by the service
    Quitter { match_id: String, ticket: String },
    /// A rejoin filled the lobby again: that match's ban on the account undone, shown by the rejoin's own ticket (for
    /// that match: the service lifts no ban on the game server's word alone, AP3)
    Refilled { match_id: String, ticket: String },
    /// A match ended with a winner (a no contest has no result)
    Result(MatchResult),
    /// A match started (every seat claimed): the matchmaker holds its players in it
    Started { match_id: String },
    /// A seat's player left the started match: they may search (the game's rule), giving up their rejoin
    Left { match_id: String, seat: u8 },
    /// A seat's player rejoined: in the match again
    Back { match_id: String, seat: u8 },
    /// A match cancelled before its start: the seats that stalled it (not claimed in time, or left before the start)
    Cancelled { match_id: String, no_shows: Vec<u8> },
    /// A started match let go with no result (a no contest; seats without tickets): its accounts free
    Over { match_id: String },
    /// This server started (Unix s): the matches it had before are gone
    Restarted { at: i64 },
}

/// A match's result for the accounts service
#[derive(Clone, Debug, PartialEq)]
pub struct MatchResult {
    pub match_id: String,
    /// Its team size (the playlist)
    pub playlist: u8,
    pub winning_team: u8,
    pub players: Vec<ResultPlayer>,
}

/// One seat's part of a result: its first ticket, its team, whether its player left and didn't come back, their time in
/// the match (s)
#[derive(Clone, Debug, PartialEq)]
pub struct ResultPlayer {
    pub ticket: String,
    pub team: u8,
    pub quitter: bool,
    pub seconds: u32,
}

pub type MatchId = u32;

/// A seat claimed with a match ticket (the network server checked the ticket: the matchmaker's, for this server): its
/// match (the matchmaker's id), playlist (team size), seat (even blue, odd orange) and the roster's size
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeatClaim {
    pub match_id: u64,
    pub playlist: u8,
    pub seat: u8,
    pub roster: u8,
}

/// A seat (its index in the match's reservations, the match ticket's): its team, its account's key (once claimed), who
/// claimed it, and whether they left before the start; its ranked state: its first ticket, since when its player is here
/// (none: not here) and their time before, whether they left the started match (a quitter unless back) and whether that
/// leave was reported; when its player's connection was last lost (an outage's count), and the last rejoin's ticket (a
/// refill's)
struct Reservation {
    team: u8,
    key: u64,
    claimed: Option<PlayerId>,
    left: bool,
    ticket: Option<SeatTicket>,
    here_since: Option<f64>,
    played: f64,
    quit: bool,
    reported: bool,
    lost_at: Option<f64>,
    rejoin_ticket: Option<String>,
    /// When its session (the claim's or the last rejoin's) joined: one that young is live though not heard from yet,
    /// no rejoin takes it over (RX31)
    session_since: f64,
}

impl Reservation {
    fn new(team: u8, key: u64) -> Self {
        Self {
            team,
            key,
            claimed: None,
            left: false,
            ticket: None,
            here_since: None,
            played: 0.0,
            quit: false,
            reported: false,
            lost_at: None,
            rejoin_ticket: None,
            session_since: 0.0,
        }
    }

    /// Their time in the match by now (s)
    fn seconds(&self, now: f64) -> f64 {
        self.played + self.here_since.map_or(0.0, |since| (now - since).max(0.0))
    }
}

struct Hosted {
    /// Built when the first player arrives: a formed match no one claims costs no arena and no ticks (RV-357)
    game: Option<Game>,
    seed: i32,
    playlist: Playlist,
    reservations: Vec<Reservation>,
    created: f64,
    /// When its next tick is due (s)
    next_tick: f64,
    /// The development server's match: anyone joins, it rematches, it's never let go
    open: bool,
    /// Its map (`protocol::MAP_COUNT`)
    map: u8,
    /// Its id for the accounts service and a rejoin (random, never 0: Welcome's `match_id`; the service's as 16 hex digits)
    ranked: u64,
    /// The leave penalty armed (LV1): the lobby full of humans and no winner yet; the first leaver drops it lobby-wide,
    /// the lobby full again re-arms it
    armed: bool,
    /// When it last ticked (s): a leave after a long silence is the server's outage
    ticked_at: f64,
    /// An armed leave by a lost connection waiting out `OUTAGE_WINDOW`: its seat and when
    pending_quit: Option<(usize, f64)>,
    /// Its start told (`Report::Started`)
    started_told: bool,
}

impl Hosted {
    /// Every seat's player here
    fn lobby_full(&self) -> bool {
        !self.reservations.is_empty() && self.reservations.iter().all(|r| r.here_since.is_some())
    }

    /// A team has won, or the match is over
    fn decided(&self) -> bool {
        self.game.as_ref().is_some_and(|g| g.has_winner() || g.is_over())
    }

    /// Its id as the accounts service has it
    fn ranked_text(&self) -> String {
        format!("{:016x}", self.ranked)
    }
}

pub struct MatchHost {
    matches: BTreeMap<MatchId, Hosted>,
    /// The match each player is in
    players: HashMap<PlayerId, MatchId>,
    /// The matchmaker's matches cancelled or finished lately (their ids), until when a claim of one is refused
    closed: HashMap<u64, f64>,
    next_id: MatchId,
    /// Each match its own kickoff orders (the game's are random)
    seed: i32,
    /// Browser tests: each round, the ball is knocked into a goal this long after "go" (ticks)
    test_goal_after: Option<u64>,
    /// The last tick's time (s): a match built later starts its clock there
    now: f64,
    /// For the accounts service, since the network server last asked (`take_reports`)
    reports: Vec<Report>,
}

impl Hosted {
    /// The match's game, built at its first player
    fn game(&mut self, test_goal_after: Option<u64>) -> &mut Game {
        let (seed, playlist, open, hold_for, map, ranked) =
            (self.seed, self.playlist, self.open, self.reservations.len(), self.map, self.ranked);
        self.game.get_or_insert_with(|| {
            let mut game = Game::with_options(seed, playlist.team_size);
            game.match_type = playlist.match_type;
            game.forfeit_vote_wait = playlist.forfeit_vote_wait.map(|s| (s * TICK_RATE as f32) as u32);
            game.test_goal_after = test_goal_after;
            game.rematch = open;
            game.idle_kick = !open;
            game.hold_for = hold_for;
            game.map = map;
            game.match_id = if open { 0 } else { ranked };
            game
        })
    }

    /// Waiting for its reserved players (unclaimed, or claimed and held)
    fn holding(&self) -> bool {
        self.game.as_ref().is_none_or(Game::holding)
    }

    fn player_count(&self) -> usize {
        self.game.as_ref().map_or(0, Game::player_count)
    }
}

impl MatchHost {
    pub fn new(seed: i32, test_goal_after: Option<u64>) -> Self {
        Self {
            matches: BTreeMap::new(),
            players: HashMap::new(),
            closed: HashMap::new(),
            next_id: 1,
            seed,
            test_goal_after,
            now: 0.0,
            reports: Vec::new(),
        }
    }

    /// A match: its seats, whether it's the open one, its id for the accounts service (the matchmaker's; none: a random
    /// one, the open match's)
    fn add(
        &mut self,
        playlist: Playlist,
        reservations: Vec<Reservation>,
        open: bool,
        ranked: Option<u64>,
        now: f64,
    ) -> MatchId {
        self.seed = self.seed.wrapping_add(7919);
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        // (Night, the one map: the user's decision of 2026-10-17)
        let map = protocol::NIGHT_MAP;
        let ranked = ranked.unwrap_or_else(|| {
            loop {
                let id = random_u64();
                if id != 0 && !self.matches.values().any(|m| m.ranked == id) {
                    break id;
                }
            }
        });
        let mut hosted = Hosted {
            game: None,
            seed: self.seed,
            playlist,
            reservations,
            created: now,
            next_tick: now,
            open,
            map,
            ranked,
            armed: false,
            ticked_at: now,
            pending_quit: None,
            started_told: false,
        };
        if open {
            hosted.game(self.test_goal_after); // (anyone may join it: built at once)
        }
        self.matches.insert(id, hosted);
        id
    }

    /// Development servers: the open match anyone joins (`join_open`)
    pub fn open_match(&mut self, playlist: Playlist, now: f64) -> MatchId {
        self.add(playlist, Vec::new(), true, None, now)
    }

    /// A player joins the open match; false if there's none (a queue server)
    pub fn join_open(&mut self, id: PlayerId, request: JoinRequest, out: Sender<Outgoing>) -> bool {
        let Some((&match_id, hosted)) = self.matches.iter_mut().find(|(_, m)| m.open) else { return false };
        let game = hosted.game(self.test_goal_after);
        game.join(id, request, out);
        if game.car_id(id).is_some() {
            self.players.insert(id, match_id);
        }
        true
    }

    /// A player claims their seat with its match ticket's (`seat`, checked by the network server: the matchmaker's, for
    /// this server): they join its match on its team, the match opened here at its first claim in `playlist`; else
    /// refused with why: `REFUSED_TOKEN` for a match cancelled or over (or no longer waiting for its players), a seat
    /// taken, or a ticket that doesn't fit the match; `REFUSED_IN_MATCH` for an account whose player is in another match
    /// here
    pub fn claim_seat(
        &mut self,
        seat: &SeatClaim,
        playlist: Playlist,
        id: PlayerId,
        request: JoinRequest,
        out: Sender<Outgoing>,
    ) -> Result<(), u8> {
        let gone = Err(protocol::REFUSED_TOKEN);
        if request.verified && self.account_busy(request.key) {
            tracing::warn!("player {id}: a claim of an account in another match here, refused");
            return Err(protocol::REFUSED_IN_MATCH);
        }
        let found = self.matches.iter().find(|(_, m)| m.ranked == seat.match_id && !m.open).map(|(&k, _)| k);
        let match_id = match found {
            Some(match_id) => match_id,
            None if self.closed.contains_key(&seat.match_id) || playlist.team_size != seat.playlist => return gone,
            None => {
                let seats = (0..seat.roster).map(|i| Reservation::new(i % 2, 0)).collect();
                let match_id = self.add(playlist, seats, false, Some(seat.match_id), self.now);
                tracing::info!(
                    "match {match_id}: opened at its first claim ({} v {}, matchmaker's {:016x})",
                    seat.playlist,
                    seat.playlist,
                    seat.match_id
                );
                match_id
            }
        };
        let Some(hosted) = self.matches.get_mut(&match_id) else { return gone };
        if hosted.playlist.team_size != seat.playlist
            || hosted.reservations.len() != usize::from(seat.roster)
            || !hosted.holding()
        {
            return gone;
        }
        let Some(slot) = hosted.reservations.get_mut(usize::from(seat.seat)).filter(|r| r.claimed.is_none() && !r.left)
        else {
            tracing::warn!("player {id}: a claim of a seat taken, refused");
            return gone;
        };
        slot.key = request.key;
        slot.claimed = Some(id);
        slot.here_since = Some(self.now);
        slot.session_since = self.now;
        slot.ticket = request.ticket.clone(); // (the seat's first: its result's and its quitter's)
        let team = slot.team;
        if hosted.game.is_none() {
            hosted.next_tick = self.now; // (its clock from now: built at its first claim)
        }
        hosted.game(self.test_goal_after).join(id, JoinRequest { team, ..request }, out);
        self.players.insert(id, match_id);
        self.lobby_filled(match_id);
        Ok(())
    }

    /// Every seat's player here: the leave penalty armed (no winner yet), and the leavers back since their reported leave
    /// cleared (the game's RPC_RemoveQuitter: the ban undone), no longer quitters
    fn lobby_filled(&mut self, match_id: MatchId) {
        let Some(hosted) = self.matches.get_mut(&match_id) else { return };
        if !hosted.lobby_full() || hosted.armed || hosted.decided() {
            return;
        }
        hosted.armed = true;
        let ranked = hosted.ranked_text();
        for r in &mut hosted.reservations {
            r.quit = false;
            if std::mem::take(&mut r.reported)
                && let Some(ticket) = r.rejoin_ticket.clone()
            {
                self.reports.push(Report::Refilled { match_id: ranked.clone(), ticket });
            }
        }
    }

    /// A seat's player left the started match: a quitter (unless back by its end); the first while the penalty is armed
    /// reported, and the penalty dropped lobby-wide (LV1), unless it's the server's outage: its silence, or (for a lost
    /// connection, waiting out `OUTAGE_WINDOW`) most seats lost at once
    fn seat_left(&mut self, match_id: MatchId, id: PlayerId, started: bool, lost: bool) {
        self.seat_left_decided(match_id, id, started, lost, None);
    }

    /// The same, `decided` whether a team had won before the leave when the game knew first (an idle kick: the game's
    /// own forfeit after it mustn't excuse it)
    fn seat_left_decided(&mut self, match_id: MatchId, id: PlayerId, started: bool, lost: bool, decided: Option<bool>) {
        let now = self.now;
        let Some(hosted) = self.matches.get_mut(&match_id) else { return };
        let decided = decided.unwrap_or_else(|| hosted.decided());
        let outage = now - hosted.ticked_at > OUTAGE_SECONDS;
        let armed = std::mem::take(&mut hosted.armed);
        let ranked_id = hosted.ranked_text();
        let Some(seat) = hosted.reservations.iter().position(|r| r.claimed == Some(id)) else { return };
        let slot = &mut hosted.reservations[seat];
        slot.played = slot.seconds(now);
        slot.here_since = None;
        if lost {
            slot.lost_at = Some(now);
        }
        if started {
            self.reports.push(Report::Left { match_id: ranked_id.clone(), seat: seat as u8 });
        }
        if !started || decided {
            return;
        }
        slot.quit = true;
        if !armed {
            return;
        }
        if outage {
            tracing::info!("match {match_id}: player {id} left during the server's silence: no ban");
        } else if slot.ticket.is_some() && !slot.reported {
            if lost {
                hosted.pending_quit = Some((seat, now)); // (reported after the window, unless an outage)
            } else {
                slot.reported = true;
                let ticket = slot.ticket.as_ref().map(|t| t.encoded.clone()).unwrap_or_default();
                self.reports.push(Report::Quitter { match_id: ranked_id, ticket });
            }
        }
    }

    /// A match's armed leave by a lost connection decided once its window is over (or at once, `now_or_never`: the
    /// match let go): an outage if more than half its seats lost their connection within `OUTAGE_WINDOW` of it (no
    /// ban); else reported, unless its player is back
    fn decide_pending_quit(&mut self, match_id: MatchId, now_or_never: bool) {
        let now = self.now;
        let Some(hosted) = self.matches.get_mut(&match_id) else { return };
        let Some((seat, since)) = hosted.pending_quit else { return };
        if !now_or_never && now - since < OUTAGE_WINDOW {
            return;
        }
        hosted.pending_quit = None;
        let lost_together = hosted
            .reservations
            .iter()
            .filter(|r| r.lost_at.is_some_and(|at| (at - since).abs() <= OUTAGE_WINDOW))
            .count();
        let ranked_id = hosted.ranked_text();
        if 2 * lost_together > hosted.reservations.len() {
            tracing::info!(
                "match {match_id}: {lost_together} of {} connections lost at once: an outage, no ban",
                hosted.reservations.len()
            );
            return;
        }
        let slot = &mut hosted.reservations[seat];
        if slot.here_since.is_none()
            && !slot.reported
            && let Some(t) = &slot.ticket
        {
            slot.reported = true;
            self.reports.push(Report::Quitter { match_id: ranked_id, ticket: t.encoded.clone() });
        }
    }

    /// Whether an account (its key) has a player in a match here (claimed, its session here): one match at a time (the
    /// matchmaker's rule, held here too for a claim; a seat it left, held empty for a rejoin, doesn't count)
    pub fn account_busy(&self, key: u64) -> bool {
        key != 0
            && self.matches.values().any(|m| {
                !m.open
                    && !m.game.as_ref().is_some_and(Game::is_over)
                    && m.reservations.iter().any(|r| r.key == key && r.claimed.is_some() && r.here_since.is_some())
            })
    }

    /// A rejoin (LV1): the ranked 2v2 or 3v3 match `match_id` takes the account back into its seat, its team, while it
    /// runs (no winner yet); else refused with why: `REFUSED_CONCLUDED` ("Match has concluded"), or `REFUSED_IN_MATCH`
    /// while the seat's session is live (another tab of the account: the seat left as it is, RX30C). A seat whose old
    /// session the server still holds but hasn't heard from in `TAKEOVER_SILENCE` (gone, not yet timed out) is taken
    /// over: that session told it was replaced and let go (AP3). The seat's first ticket stays its result's; the rejoin's
    /// own is kept for a refill (notes/accounts.md §3)
    pub fn rejoin(
        &mut self,
        match_id: u64,
        id: PlayerId,
        request: JoinRequest,
        out: Sender<Outgoing>,
    ) -> Result<(), u8> {
        let now = self.now;
        let concluded = Err(protocol::REFUSED_CONCLUDED);
        let Some((&mid, hosted)) = self.matches.iter_mut().find(|(_, m)| m.ranked == match_id && !m.open) else {
            return concluded;
        };
        let running = hosted.game.as_ref().is_some_and(|g| !g.is_over() && !g.has_winner() && !g.holding());
        if !request.verified || hosted.playlist.team_size < 2 || !running {
            return concluded;
        }
        let Some(seat) = hosted.reservations.iter().position(|r| r.key == request.key && r.claimed.is_some()) else {
            return concluded;
        };
        let back = Report::Back { match_id: hosted.ranked_text(), seat: seat as u8 };
        let slot = &mut hosted.reservations[seat];
        let stale = slot.here_since.is_some().then_some(slot.claimed).flatten();
        // (live: heard within TAKEOVER_SILENCE, or joined within it and not heard from yet, RX31)
        if let Some(old) = stale
            && (now - slot.session_since < TAKEOVER_SILENCE
                || hosted.game.as_ref().is_some_and(|g| g.heard_within(old, now, TAKEOVER_SILENCE)))
        {
            tracing::warn!("match {mid}: player {id}'s rejoin refused: the seat's session (player {old}) is live");
            return Err(protocol::REFUSED_IN_MATCH);
        }
        slot.claimed = Some(id);
        slot.here_since = slot.here_since.or(Some(now));
        slot.session_since = now;
        slot.lost_at = None;
        slot.rejoin_ticket = request.ticket.as_ref().map(|t| t.encoded.clone());
        let team = slot.team;
        let game = hosted.game(self.test_goal_after);
        if let Some(old) = stale {
            tracing::info!("match {mid}: player {id} took over player {old}'s seat (its session not yet timed out)");
            game.replaced(old);
            self.players.remove(&old);
        } else {
            tracing::info!("match {mid}: player {id} rejoined team {team}");
        }
        game.join(id, JoinRequest { team, ..request }, out);
        self.players.insert(id, mid);
        self.reports.push(back);
        self.lobby_filled(mid);
        Ok(())
    }

    /// The time now (s), before the messages that came since the last tick are handled: a leave after a stall of the
    /// whole server is seen as one (the penalty's leniency)
    pub fn observe(&mut self, now: f64) {
        self.now = self.now.max(now);
    }

    /// What the accounts service is to be told since the last call (the network server's outbox sends it)
    pub fn take_reports(&mut self) -> Vec<Report> {
        std::mem::take(&mut self.reports)
    }

    /// A match over: its result, if it has a winner and every seat a ticket (a no contest, the local host's or an
    /// unverified match has none: then, for a matchmaker's match that started, its end with no result)
    fn report_result(&mut self, match_id: MatchId) {
        if !self.result(match_id)
            && let Some(hosted) = self.matches.get(&match_id)
            && hosted.started_told
        {
            self.reports.push(Report::Over { match_id: hosted.ranked_text() });
        }
    }

    /// The match's result reported, if it has one
    fn result(&mut self, match_id: MatchId) -> bool {
        let now = self.now;
        let Some(hosted) = self.matches.get(&match_id) else { return false };
        let Some(game) = hosted.game.as_ref() else { return false };
        if hosted.reservations.is_empty() {
            return false; // (an open match)
        }
        let state = game.match_state();
        let Some(winning_team) = state.winner.filter(|_| !state.no_contest) else {
            tracing::info!("match {match_id}: no winner, no result (a no contest)");
            return false;
        };
        let players: Option<Vec<ResultPlayer>> = hosted
            .reservations
            .iter()
            .map(|r| {
                r.ticket.as_ref().map(|t| ResultPlayer {
                    ticket: t.encoded.clone(),
                    team: r.team,
                    quitter: r.quit && r.here_since.is_none(),
                    seconds: r.seconds(now).round() as u32,
                })
            })
            .collect();
        match players {
            Some(players) => {
                self.reports.push(Report::Result(MatchResult {
                    match_id: hosted.ranked_text(),
                    playlist: hosted.playlist.team_size,
                    winning_team,
                    players,
                }));
                true
            }
            None => {
                tracing::info!("match {match_id}: seats without tickets, no result");
                false
            }
        }
    }

    /// A player's session ended. Before their match started it's cancelled (its slot can't be filled: full start)
    pub fn leave(&mut self, id: PlayerId, lost: bool) {
        let Some(match_id) = self.players.remove(&id) else { return };
        let Some(started) = self.matches.get(&match_id).map(|m| !m.holding()) else { return };
        self.seat_left(match_id, id, started, lost);
        let Some(hosted) = self.matches.get_mut(&match_id) else { return };
        if let Some(game) = hosted.game.as_mut() {
            if lost {
                game.connection_lost(id);
            } else {
                game.leave(id);
            }
        }
        if hosted.holding() {
            tracing::info!("match {match_id}: player {id} left before the start, cancelled");
            if let Some(slot) = hosted.reservations.iter_mut().find(|r| r.claimed == Some(id)) {
                slot.left = true;
            }
            self.cancel(match_id);
        } else if hosted.player_count() == 0 && !hosted.open {
            self.report_result(match_id);
            self.drop_match(match_id);
        }
    }

    /// The game a player is in
    pub fn game_of(&mut self, id: PlayerId) -> Option<&mut Game> {
        let match_id = self.players.get(&id)?;
        self.matches.get_mut(match_id).and_then(|m| m.game.as_mut())
    }

    pub fn match_count(&self) -> usize {
        self.matches.len()
    }

    /// When the next match tick is due (s); None without matches
    pub fn next_tick(&self) -> Option<f64> {
        self.matches.values().map(|m| m.next_tick).min_by(f64::total_cmp)
    }

    /// Each match's ticks due by `now` (s), at most a few to catch up; then the matches cancelled (reservations
    /// expired), over or empty let go. A match whose tick panics is let go alone, its players' sessions ended; the
    /// others play on (SEC-7: they share the game thread); an open match starts afresh
    pub fn tick(&mut self, now: f64) {
        self.now = now;
        let mut done = Vec::new();
        let mut restart = Vec::new();
        let mut started = Vec::new();
        for (&match_id, m) in &mut self.matches {
            let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let Some(game) = m.game.as_mut() else {
                    m.next_tick = now; // (not built yet: no clock)
                    return;
                };
                let mut ticks = 0;
                while m.next_tick <= now && ticks < MAX_CATCH_UP_TICKS {
                    game.tick(m.next_tick);
                    m.next_tick += game.next_tick_seconds();
                    ticks += 1;
                }
                if ticks == MAX_CATCH_UP_TICKS && m.next_tick < now {
                    m.next_tick = now;
                }
                if ticks > 0 {
                    m.ticked_at = now;
                }
            }));
            if ran.is_err() {
                tracing::error!("match {match_id}: its tick panicked, let go");
                done.push((match_id, false));
                if m.open {
                    restart.push(m.playlist);
                }
                continue;
            }
            if m.open {
                continue;
            }
            // (its start told once: every seat claimed and the game under way)
            if !m.started_told && !m.holding() {
                m.started_told = true;
                started.push(Report::Started { match_id: m.ranked_text() });
            }
            if m.holding() && now - m.created > RESERVATION_SECONDS {
                tracing::info!(
                    "match {match_id}: not every player claimed their seat in {RESERVATION_SECONDS} s, cancelled"
                );
                done.push((match_id, true));
            } else if m.game.as_ref().is_some_and(Game::is_over) || (!m.holding() && m.player_count() == 0) {
                done.push((match_id, false));
            }
        }
        // (the players the games let go of themselves, kicked for idling or not reading: leaves, counted as they happen
        // (LV1), the game's own forfeit after them no excuse; their sessions' closes later find no seat)
        let dropped: Vec<(MatchId, crate::game::Dropped)> = self
            .matches
            .iter_mut()
            .flat_map(|(&match_id, m)| {
                m.game.as_mut().map(Game::take_dropped).unwrap_or_default().into_iter().map(move |d| (match_id, d))
            })
            .collect();
        for (match_id, d) in dropped {
            if self.players.remove(&d.id).is_some() {
                self.seat_left_decided(match_id, d.id, true, d.lost, Some(d.decided));
            }
        }
        // (the armed leaves by a lost connection whose window is over: an outage, or reported)
        let waiting: Vec<MatchId> =
            self.matches.iter().filter(|(_, m)| m.pending_quit.is_some()).map(|(&id, _)| id).collect();
        for match_id in waiting {
            self.decide_pending_quit(match_id, false);
        }
        for (match_id, cancelled) in done {
            if cancelled {
                self.cancel(match_id);
            } else {
                self.report_result(match_id);
                self.drop_match(match_id);
            }
        }
        for playlist in restart {
            self.open_match(playlist, now);
        }
        self.reports.extend(started);
        self.closed.retain(|_, until| *until > now);
    }

    /// The match is cancelled before it started: its players are told, then their sessions end; the matchmaker is told
    /// which seats stalled it (cancelled by time: those not claimed; by a leave before the start: the leaver's)
    fn cancel(&mut self, match_id: MatchId) {
        if let Some(hosted) = self.matches.get(&match_id) {
            if let Some(game) = hosted.game.as_ref() {
                game.broadcast(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED });
            }
            let by_leave = hosted.reservations.iter().any(|r| r.left);
            let no_shows = (0u8..)
                .zip(&hosted.reservations)
                .filter(|(_, r)| if by_leave { r.left } else { r.claimed.is_none() })
                .map(|(seat, _)| seat)
                .collect();
            self.reports.push(Report::Cancelled { match_id: hosted.ranked_text(), no_shows });
        }
        self.drop_match(match_id);
    }

    /// Lets the match go: its players' sessions end (their queues closed once what was sent goes out), its id remembered
    fn drop_match(&mut self, match_id: MatchId) {
        self.decide_pending_quit(match_id, true); // (a leave waiting out its window: decided with what's known)
        if let Some(hosted) = self.matches.remove(&match_id) {
            if !hosted.open {
                self.closed.insert(hosted.ranked, self.now + CLOSED_MEMORY);
            }
            self.players.retain(|_, m| *m != match_id);
            tracing::info!("match {match_id} let go");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::OUT_QUEUE;
    use crate::protocol::Phase;
    use tokio::sync::mpsc::{Receiver, channel};

    fn init_engine() {
        crate::engine::init(std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../out/arena/collision_meshes"
        )))
        .unwrap();
    }

    const ONES: Playlist = Playlist { team_size: 1, match_type: MatchType::Casual, forfeit_vote_wait: None };
    const TWOS: Playlist = Playlist { team_size: 2, match_type: MatchType::Casual, forfeit_vote_wait: None };

    fn request() -> JoinRequest {
        JoinRequest {
            team: 255,
            model: 0,
            dodge_deadzone: 0.5,
            steering_sensitivity: 1.0,
            air_control_sensitivity: 1.0,
            auto_skip_replay: false,
            key: 0,
            name: String::new(),
            quick_chat: 0,
            block_non_tactical: false,
            verified: false,
            ticket: None,
        }
    }

    fn controls(rx: &mut Receiver<Outgoing>) -> Vec<Control> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            if let Outgoing::Control(bytes) = m {
                out.push(Control::decode(&bytes[2..]).unwrap());
            }
        }
        out
    }

    /// The tests' matchmaker: a match's seats handed out as tokens, each a seat's claim as its match ticket would carry
    /// it (`claim_seat`), and its map
    struct Made {
        tokens: Vec<u64>,
        map: u8,
    }

    thread_local! {
        static SEATS: std::cell::RefCell<HashMap<u64, (SeatClaim, Playlist)>> = Default::default();
    }

    trait Matchmaker {
        /// A match for this many players (their accounts' keys: their claims' own), its id the matchmaker's
        fn create_match(&mut self, playlist: Playlist, players: &[u64], now: f64) -> Made;
        /// A seat claimed with its token's seat; false if refused
        fn claim(&mut self, token: u64, id: PlayerId, request: JoinRequest, out: Sender<Outgoing>) -> bool;
    }

    impl Matchmaker for MatchHost {
        fn create_match(&mut self, playlist: Playlist, players: &[u64], _now: f64) -> Made {
            let match_id = random_u64() | 1;
            let roster = players.len() as u8;
            let tokens = (0..roster)
                .map(|seat| {
                    let token = random_u64() | 1;
                    let claim = SeatClaim { match_id, playlist: playlist.team_size, seat, roster };
                    SEATS.with(|s| s.borrow_mut().insert(token, (claim, playlist)));
                    token
                })
                .collect();
            Made { tokens, map: protocol::NIGHT_MAP }
        }

        fn claim(&mut self, token: u64, id: PlayerId, request: JoinRequest, out: Sender<Outgoing>) -> bool {
            let Some((seat, playlist)) = SEATS.with(|s| s.borrow().get(&token).copied()) else { return false };
            self.claim_seat(&seat, playlist, id, request, out).is_ok()
        }
    }

    /// The ranked rules' reports (quitters, refills, results), the matchmaker's events apart
    fn ranked(reports: Vec<Report>) -> Vec<Report> {
        reports
            .into_iter()
            .filter(|r| matches!(r, Report::Quitter { .. } | Report::Refilled { .. } | Report::Result(_)))
            .collect()
    }

    /// The host's matches run for `seconds` from `from`, 120 ticks a second
    fn run(host: &mut MatchHost, from: f64, seconds: f64) -> f64 {
        let mut t = from;
        while t < from + seconds {
            host.tick(t);
            t += 1.0 / 120.0;
        }
        t
    }

    #[test]
    fn a_match_starts_only_when_every_reserved_player_has_claimed() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[0; 4], 0.0).tokens;
        assert_eq!(tokens.len(), 4);
        assert!(tokens.iter().all(|&t| t != 0) && tokens.iter().collect::<std::collections::BTreeSet<_>>().len() == 4);
        let mut rxs = Vec::new();
        for (i, &token) in tokens.iter().take(3).enumerate() {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(host.claim(token, i as PlayerId + 1, request(), tx));
            rxs.push(rx);
        }
        let t = run(&mut host, 0.0, 10.0);
        let game = host.game_of(1).unwrap();
        assert_eq!((game.phase(), game.holding()), (Phase::Waiting, true), "held for the fourth");
        let (tx, rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[3], 4, request(), tx));
        rxs.push(rx);
        let t = run(&mut host, t, 3.5);
        let game = host.game_of(4).unwrap();
        assert_eq!((game.phase(), game.holding()), (Phase::Countdown, false), "the warm-up's 3 s, then the countdown");
        run(&mut host, t, 4.5);
        assert_eq!(host.game_of(4).unwrap().phase(), Phase::Active);
        // Teams alternate by slot: two a side
        let teams: Vec<u8> = rxs
            .iter_mut()
            .flat_map(controls)
            .filter_map(|m| if let Control::Roster(r) = m { Some(r) } else { None })
            .last()
            .unwrap()
            .iter()
            .map(|p| p.team)
            .collect();
        assert_eq!((teams.iter().filter(|&&t| t == 0).count(), teams.len()), (2, 4));
    }

    #[test]
    fn the_window_is_about_the_users_12_s() {
        // (RV-367's decision, pinned: RX14's N18; from the first claim now, after the 3 s countdown)
        assert_eq!(RESERVATION_SECONDS, 10.0);
    }

    /// A seat's ticket (made up)
    fn seat(n: u8) -> JoinRequest {
        JoinRequest {
            key: u64::from(n),
            verified: true,
            ticket: Some(SeatTicket { encoded: format!("t{n}"), account: [n; 16], ratings: [1500; 3] }),
            ..request()
        }
    }

    /// A rejoin's request (its own ticket, made up)
    fn rejoining(n: u8) -> JoinRequest {
        JoinRequest {
            ticket: Some(SeatTicket { encoded: format!("r{n}"), account: [n; 16], ratings: [1500; 3] }),
            ..seat(n)
        }
    }

    /// The host run on to `until` (s), ticking each 1/120 s
    fn run_to(host: &mut MatchHost, from: f64, until: f64) {
        let mut t = from;
        while t < until {
            t += 1.0 / 120.0;
            host.tick(t);
        }
    }

    #[test]
    fn the_first_armed_leave_is_reported_and_the_result_has_the_winner_the_quitter_and_the_time_played() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[1, 2], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, seat(1), tx.clone()));
        assert!(host.claim(tokens[1], 2, seat(2), tx));
        run_to(&mut host, 0.0, 5.0);
        assert!(ranked(host.take_reports()).is_empty(), "nothing yet");
        // (player 1 leaves: reported at once, the lobby's penalty dropped; their team empty, it forfeits)
        host.observe(5.0);
        host.leave(1, false);
        let reports = ranked(host.take_reports());
        let Some(Report::Quitter { match_id, ticket }) = reports.first() else { panic!("{reports:?}") };
        assert_eq!((reports.len(), ticket.as_str()), (1, "t1"));
        let match_id = match_id.clone();
        run_to(&mut host, 5.0, 6.0);
        // (the winner leaves after the forfeit: no ban, the result sent as the match goes)
        host.leave(2, false);
        let reports = ranked(host.take_reports());
        let [Report::Result(result)] = reports.as_slice() else { panic!("{reports:?}") };
        assert_eq!((result.match_id.as_str(), result.playlist, result.winning_team), (match_id.as_str(), 1, 1));
        let by_ticket = |t: &str| result.players.iter().find(|p| p.ticket == t).unwrap().clone();
        assert_eq!((by_ticket("t1").team, by_ticket("t1").quitter, by_ticket("t1").seconds), (0, true, 5));
        assert_eq!((by_ticket("t2").team, by_ticket("t2").quitter, by_ticket("t2").seconds), (1, false, 6));
        assert_eq!(host.match_count(), 0);
    }

    #[test]
    fn only_the_first_leaver_is_banned_and_everyone_gone_is_a_no_contest_with_no_result() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        run_to(&mut host, 0.0, 3.0);
        for id in [1, 2, 3, 4] {
            host.leave(id, id == 2); // (a lost connection counts too)
        }
        let reports = ranked(host.take_reports());
        assert_eq!(reports.len(), 1, "the first leaver alone, then no result (a no contest): {reports:?}");
        assert!(matches!(&reports[0], Report::Quitter { ticket, .. } if ticket == "t1"));
    }

    #[test]
    fn a_leave_after_the_servers_silence_or_from_an_unverified_seat_isnt_reported() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[1, 2], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        host.claim(tokens[0], 1, seat(1), tx.clone());
        host.claim(tokens[1], 2, seat(2), tx.clone());
        run_to(&mut host, 0.0, 2.0);
        host.observe(2.0 + OUTAGE_SECONDS + 1.0); // (the whole server stalled)
        host.leave(1, true);
        assert!(
            !ranked(host.take_reports()).iter().any(|r| matches!(r, Report::Quitter { .. })),
            "the server's outage: no ban"
        );
        // (seats without tickets: no quitter, no result)
        let tokens = host.create_match(ONES, &[0, 0], 30.0).tokens;
        host.claim(tokens[0], 3, request(), tx.clone());
        host.claim(tokens[1], 4, request(), tx);
        run_to(&mut host, 30.0, 32.0);
        host.leave(3, false);
        run_to(&mut host, 32.0, 33.0);
        host.leave(4, false);
        assert!(ranked(host.take_reports()).is_empty());
    }

    #[test]
    fn a_ranked_2v2_seat_left_by_accident_is_rejoined_the_ban_undone_and_one_match_per_account() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        assert!(host.account_busy(1) && !host.account_busy(9), "a player in a match here, one not");
        let match_id = host.matches.values().next().unwrap().ranked;
        run_to(&mut host, 0.0, 3.0);
        host.observe(3.0);
        host.leave(1, true);
        // (a lost connection: reported once its outage window is over, one seat of four)
        assert!(ranked(host.take_reports()).is_empty(), "waiting out the outage window");
        run_to(&mut host, 3.0, 3.0 + OUTAGE_WINDOW + 0.1);
        assert!(matches!(ranked(host.take_reports()).as_slice(), [Report::Quitter { ticket, .. }] if ticket == "t1"));
        assert!(!host.account_busy(1), "its seat held empty: no bar to a claim elsewhere (RX30C)");
        // (another account can't take it; the match's own player back on their team, the refill shown by its ticket)
        assert!(host.rejoin(match_id, 10, rejoining(9), tx.clone()).is_err(), "not the seat's account");
        assert!(host.rejoin(match_id + 1, 10, rejoining(1), tx.clone()).is_err(), "no such match");
        assert!(host.rejoin(match_id, 10, rejoining(1), tx.clone()).is_ok());
        let reports = ranked(host.take_reports());
        assert!(matches!(reports.as_slice(), [Report::Refilled { ticket, .. }] if ticket == "r1"), "{reports:?}");
        let hosted = host.matches.values().next().unwrap();
        let slot = hosted.reservations.iter().find(|r| r.key == 1).unwrap();
        assert!(
            !slot.quit && slot.claimed == Some(10) && hosted.armed,
            "back, no longer a quitter, the penalty re-armed"
        );
        // (the result keeps each seat's first ticket, not the rejoin's)
        assert_eq!(slot.ticket.as_ref().map(|t| t.encoded.as_str()), Some("t1"));
        assert_eq!(host.game_of(10).map(|g| g.player_count()), Some(4));
    }

    /// The refill only once every seat is back, and no rejoin once a team has won (a search giving a left seat up is the
    /// matchmaker's now: it gives no rejoin ticket after)
    #[test]
    fn a_refill_waits_for_the_whole_lobby() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        let match_id = host.matches.values().next().unwrap().ranked;
        run_to(&mut host, 0.0, 3.0);
        host.observe(3.0);
        host.leave(1, false); // (the first: reported at once)
        host.leave(2, false); // (a later leaver: no ban)
        assert!(matches!(ranked(host.take_reports()).as_slice(), [Report::Quitter { ticket, .. }] if ticket == "t1"));
        // (player 1 back, player 2 still away: the lobby not full, no refill yet)
        assert!(host.rejoin(match_id, 10, rejoining(1), tx.clone()).is_ok());
        assert!(ranked(host.take_reports()).is_empty(), "a seat still empty: no refill");
        // (player 2 back too: the lobby full, player 1's ban undone)
        assert!(host.rejoin(match_id, 11, rejoining(2), tx.clone()).is_ok());
        assert!(matches!(ranked(host.take_reports()).as_slice(), [Report::Refilled { ticket, .. }] if ticket == "r1"));
        // (a 2v2 whose team 0 both left: team 1 wins by forfeit; no rejoin once there's a winner)
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        let match_id = host.matches.values().next().unwrap().ranked;
        run_to(&mut host, 0.0, 3.0);
        host.leave(1, false);
        host.leave(3, false);
        run_to(&mut host, 3.0, 3.5);
        assert!(host.matches.values().next().is_some_and(Hosted::decided), "team 1 won by forfeit");
        assert!(host.rejoin(match_id, 12, rejoining(1), tx).is_err(), "a winner: concluded");
    }

    /// RX30C (LV1): an idle kick is a leave: the first while the penalty's armed reported as it happens, the game's own
    /// forfeit after the kicks no excuse; the kicked sessions' closes later find no seat
    #[test]
    fn an_idle_kick_is_a_leave() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, mut rx) = channel(OUT_QUEUE);
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        // (nobody sends an input: every player idles out and is kicked; their messages read, so none is dropped for a
        // full queue)
        for second in 0..50 {
            run_to(&mut host, f64::from(second), f64::from(second + 1));
            while rx.try_recv().is_ok() {}
        }
        let reports = ranked(host.take_reports());
        let quitters: Vec<&Report> = reports.iter().filter(|r| matches!(r, Report::Quitter { .. })).collect();
        assert_eq!(quitters.len(), 1, "the first kicked, armed: {reports:?}");
        for id in 1..=4 {
            host.leave(id, false); // (the sessions' closes: nothing more)
        }
        assert!(!ranked(host.take_reports()).iter().any(|r| matches!(r, Report::Quitter { .. })));
    }

    /// RX31 (AP4): a 1v1's idle kick is the kicked player's leave though the forfeit it causes lands in the same host step
    /// (the game's "decided" from before the kick counts, not the host's after it), whichever tick of a step it falls on
    #[test]
    fn an_idle_kick_whose_forfeit_lands_in_the_same_step_is_still_a_leave() {
        init_engine();
        for offset in 0..5 {
            let mut host = MatchHost::new(1, None);
            let tokens = host.create_match(ONES, &[1, 2], 0.0).tokens;
            let (tx, mut rx) = channel(OUT_QUEUE);
            for (i, &token) in tokens.iter().enumerate() {
                let n = i as u8 + 1;
                assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
            }
            // (player 2 chats every 5 s, player 1 never acts; the host steps 5 ticks at a time, as when it catches up)
            let mut t = f64::from(offset) / 120.0;
            host.tick(t);
            let mut next_chat = 0.0;
            let mut reports = Vec::new();
            while t < 60.0 && !reports.iter().any(|r| matches!(r, Report::Quitter { .. })) {
                t += 5.0 / 120.0;
                host.tick(t);
                if t >= next_chat {
                    if let Some(game) = host.game_of(2) {
                        game.quick_chat(2, 0, false, t);
                    }
                    next_chat = t + 5.0;
                }
                while rx.try_recv().is_ok() {}
                reports.extend(ranked(host.take_reports()));
            }
            assert!(
                matches!(reports.as_slice(), [Report::Quitter { ticket, .. }] if ticket == "t1"),
                "offset {offset}: {reports:?}"
            );
        }
    }

    /// RX31 (AP4): a player let go for not reading its messages (its queue full) is a lost connection: the 5 s window
    /// waited out before the report, as for a timeout
    #[test]
    fn a_full_queue_drop_is_a_lost_connection_reported_after_the_window() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (stuck, _never_read) = channel(64);
        let (tx, mut rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, seat(1), stuck));
        for (i, &token) in tokens.iter().enumerate().skip(1) {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        let mut t = 0.0;
        while host.players.contains_key(&1) {
            assert!(t < 20.0, "never let go");
            run_to(&mut host, t, t + 0.1);
            t += 0.1;
            while rx.try_recv().is_ok() {}
        }
        assert!(
            !ranked(host.take_reports()).iter().any(|r| matches!(r, Report::Quitter { .. })),
            "lost: not reported at once"
        );
        run_to(&mut host, t, t + OUTAGE_WINDOW + 0.2);
        let reports = ranked(host.take_reports());
        assert!(matches!(reports.as_slice(), [Report::Quitter { ticket, .. }] if ticket == "t1"), "{reports:?}");
    }

    /// AP3, RX31: an unverified session never rejoins (a seat is an account's); a seat reported once isn't reported again
    /// when an earlier lost connection's window ends after its later leave
    #[test]
    fn an_unverified_rejoin_is_refused_and_a_seat_is_reported_once() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        let match_id = host.matches.values().next().unwrap().ranked;
        run_to(&mut host, 0.0, 3.0);
        host.leave(1, true); // (a lost connection: its report waits out the window)
        let unverified = JoinRequest { verified: false, ..rejoining(1) };
        assert_eq!(host.rejoin(match_id, 9, unverified, tx.clone()), Err(protocol::REFUSED_CONCLUDED));
        run_to(&mut host, 3.0, 4.0);
        // (back within the window: the lobby full, the penalty armed again; then left again, reported at once)
        assert!(host.rejoin(match_id, 10, rejoining(1), tx.clone()).is_ok());
        run_to(&mut host, 4.0, 5.0);
        host.leave(10, false);
        let reports = ranked(host.take_reports());
        assert!(matches!(reports.as_slice(), [Report::Quitter { ticket, .. }] if ticket == "t1"), "{reports:?}");
        // (the first leave's window ends after it: that seat reported already, nothing more)
        run_to(&mut host, 5.0, 3.0 + OUTAGE_WINDOW + 1.0);
        assert!(!ranked(host.take_reports()).iter().any(|r| matches!(r, Report::Quitter { .. })));
    }

    /// AP3: a rejoin while the server still holds the seat's old session (gone, not yet timed out) takes the seat over:
    /// the old session told it was replaced and let go, no leave counted, the time played kept
    #[test]
    fn a_rejoin_takes_over_a_seat_whose_old_session_lingers() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, mut rx) = channel(OUT_QUEUE);
        let (old_tx, mut old_rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, seat(1), old_tx));
        for (i, &token) in tokens.iter().enumerate().skip(1) {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        let match_id = host.matches.values().next().unwrap().ranked;
        run_to(&mut host, 0.0, 3.0);
        // (its session live, heard just now: another tab's rejoin refused, the seat and its session left as they are,
        // RX30C)
        host.game_of(1).unwrap().receive_inputs(1, 0, 0, &[], 3.0);
        assert_eq!(host.rejoin(match_id, 9, rejoining(1), tx.clone()), Err(protocol::REFUSED_IN_MATCH));
        assert!(!controls(&mut old_rx).contains(&Control::Kicked { reason: protocol::KICK_REPLACED }));
        assert_eq!(host.matches.values().next().unwrap().reservations[0].claimed, Some(1));
        // (silent past TAKEOVER_SILENCE, gone but not yet timed out: taken over)
        run_to(&mut host, 3.0, 3.0 + TAKEOVER_SILENCE + 0.1);
        while old_rx.try_recv().is_ok() || rx.try_recv().is_ok() {}
        assert!(host.rejoin(match_id, 10, rejoining(1), tx.clone()).is_ok());
        assert!(controls(&mut old_rx).contains(&Control::Kicked { reason: protocol::KICK_REPLACED }));
        assert!(old_rx.try_recv().is_err() && old_rx.is_closed(), "the old session's queue closed: it ends");
        // (the rejoined session just joined, not heard from yet: a second rejoin doesn't take it over, RX31)
        assert_eq!(host.rejoin(match_id, 11, rejoining(1), tx.clone()), Err(protocol::REFUSED_IN_MATCH));
        host.leave(1, true); // (its session closing later: not this seat's any more)
        run_to(&mut host, 3.0 + TAKEOVER_SILENCE + 0.1, 3.0 + TAKEOVER_SILENCE + OUTAGE_WINDOW + 0.2);
        assert!(ranked(host.take_reports()).is_empty(), "no leave, no refill: {:?}", ranked(host.take_reports()));
        let hosted = host.matches.values().next().unwrap();
        let slot = hosted.reservations.iter().find(|r| r.key == 1).unwrap();
        assert!(
            slot.claimed == Some(10) && !slot.quit && slot.seconds(3.0 + OUTAGE_WINDOW) > 7.9,
            "the seat's, its time kept"
        );
        assert_eq!(host.game_of(10).map(|g| g.player_count()), Some(4));
    }

    /// AP3: most of a match's connections lost together (each session timing out at once: the server's network) is an
    /// outage, no ban; one lost alone is the player's, reported after the window; a player back within it isn't
    #[test]
    fn an_outage_of_most_connections_bans_no_one() {
        init_engine();
        let start = |host: &mut MatchHost, at: f64| {
            let tokens = host.create_match(TWOS, &[1, 2, 3, 4], at).tokens; // (the seats' keys)
            let (tx, _rx) = channel(OUT_QUEUE);
            for (i, &token) in tokens.iter().enumerate() {
                let n = i as u8 + 1;
                assert!(host.claim(token, 100 * u64::from(n), seat(n), tx.clone())); // (players 100-400: seats 1-4)
            }
            run_to(host, at, at + 3.0);
            host.matches.values().last().unwrap().ranked
        };
        // (three of four within the window: an outage)
        let mut host = MatchHost::new(1, None);
        start(&mut host, 0.0);
        host.observe(3.0);
        host.leave(100, true);
        run_to(&mut host, 3.0, 4.0);
        host.leave(200, true);
        host.leave(300, true);
        run_to(&mut host, 4.0, 3.0 + OUTAGE_WINDOW + 1.0);
        assert!(!ranked(host.take_reports()).iter().any(|r| matches!(r, Report::Quitter { .. })), "an outage: no ban");
        // (two of four: a household's network, not the server's; the first reported after the window, not before)
        let mut host = MatchHost::new(1, None);
        start(&mut host, 0.0);
        host.observe(3.0);
        host.leave(100, true);
        host.leave(200, true);
        run_to(&mut host, 3.0, 3.0 + OUTAGE_WINDOW - 0.5);
        assert!(ranked(host.take_reports()).is_empty(), "within the window");
        run_to(&mut host, 3.0 + OUTAGE_WINDOW - 0.5, 3.0 + OUTAGE_WINDOW + 0.5);
        assert!(matches!(ranked(host.take_reports()).as_slice(), [Report::Quitter { ticket, .. }] if ticket == "t1"));
        // (back within the window: nothing reported, nothing to undo)
        let mut host = MatchHost::new(1, None);
        let match_id = start(&mut host, 0.0);
        host.observe(3.0);
        host.leave(100, true);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.rejoin(match_id, 10, rejoining(1), tx).is_ok());
        run_to(&mut host, 3.0, 3.0 + OUTAGE_WINDOW + 1.0);
        assert!(ranked(host.take_reports()).is_empty(), "back in time");
    }

    /// AP3: a leave waiting out its window when the match is let go is decided then, with what's known
    #[test]
    fn a_leave_waiting_out_its_window_is_decided_when_the_match_goes() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[1, 2], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, seat(1), tx.clone()));
        assert!(host.claim(tokens[1], 2, seat(2), tx));
        run_to(&mut host, 0.0, 3.0);
        host.observe(3.0);
        host.leave(1, true);
        run_to(&mut host, 3.0, 4.0);
        host.leave(2, false); // (the forfeit's winner goes: the match let go within the window)
        let reports = ranked(host.take_reports());
        assert!(reports.iter().any(|r| matches!(r, Report::Quitter { ticket, .. } if ticket == "t1")), "{reports:?}");
        assert!(reports.iter().any(|r| matches!(r, Report::Result(_))), "{reports:?}");
        assert_eq!(host.match_count(), 0);
    }

    #[test]
    fn no_rejoin_in_1v1_or_once_there_is_a_winner() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[1, 2], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        host.claim(tokens[0], 1, seat(1), tx.clone());
        host.claim(tokens[1], 2, seat(2), tx.clone());
        let match_id = host.matches.values().next().unwrap().ranked;
        run_to(&mut host, 0.0, 3.0);
        host.leave(1, true);
        assert!(host.rejoin(match_id, 10, seat(1), tx.clone()).is_err(), "1v1: no rejoin");
        run_to(&mut host, 3.0, 4.0);
        assert!(!host.account_busy(1), "the forfeit's winner decided: the seat no longer held");
    }

    #[test]
    fn a_token_claims_once_and_only_its_own_slot() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[0; 2], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx.clone()));
        assert!(!host.claim(tokens[0], 2, request(), tx.clone()), "used");
        assert!(!host.claim(12345, 3, request(), tx.clone()), "never given");
        assert!(!host.claim(0, 4, request(), tx), "none");
        assert_eq!(host.game_of(1).unwrap().player_count(), 1);
        assert!(host.game_of(2).is_none());
    }

    #[test]
    fn a_match_whose_players_dont_all_claim_in_time_is_cancelled_and_its_players_told() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[0; 2], 0.0).tokens;
        let (tx, mut rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx));
        run(&mut host, 0.0, RESERVATION_SECONDS - 0.5);
        assert_eq!(host.match_count(), 1);
        run(&mut host, RESERVATION_SECONDS - 0.5, 1.0);
        assert_eq!(host.match_count(), 0);
        assert!(host.game_of(1).is_none());
        assert!(controls(&mut rx).contains(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED }));
        assert!(rx.try_recv().is_err() && rx.is_closed(), "the session's queue closed: it ends");
        assert!(host.players.is_empty(), "a let-go match keeps no players (RV-360)");
        let reports = host.take_reports();
        assert!(
            matches!(reports.as_slice(), [Report::Cancelled { no_shows, .. }] if no_shows == &[1]),
            "by time: the unclaimed seat stalled it: {reports:?}"
        );
        // (a late claim can't open it again: its id remembered while its tickets live)
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(!host.claim(tokens[1], 2, request(), tx), "the late claim refused");
        assert_eq!(host.match_count(), 0);
    }

    #[test]
    fn each_match_is_on_night_the_one_map_every_player_welcomed_with_it() {
        init_engine();
        let welcomed = |rx: &mut Receiver<Outgoing>| {
            controls(rx).into_iter().find_map(|c| if let Control::Welcome { map, .. } = c { Some(map) } else { None })
        };
        // (Night, every match's: the user's decision of 2026-10-17)
        let mut host = MatchHost::new(1, None);
        assert!((0..20).all(|_| host.create_match(ONES, &[0; 2], 0.0).map == protocol::NIGHT_MAP));
        // (a queue match's players, each welcomed with its map)
        let mut host = MatchHost::new(1, None);
        let created = host.create_match(TWOS, &[0; 4], 0.0);
        for (i, &token) in created.tokens.iter().enumerate() {
            let (tx, mut rx) = channel(OUT_QUEUE);
            assert!(host.claim(token, 10 + i as PlayerId, request(), tx));
            assert_eq!(welcomed(&mut rx), Some(created.map), "player {i}");
        }
        // (a development server's open match: its own map, the same for everyone who joins)
        let mut host = MatchHost::new(1, None);
        host.open_match(ONES, 0.0);
        let (tx1, mut rx1) = channel(OUT_QUEUE);
        let (tx2, mut rx2) = channel(OUT_QUEUE);
        assert!(host.join_open(1, request(), tx1) && host.join_open(2, request(), tx2));
        let (m1, m2) = (welcomed(&mut rx1), welcomed(&mut rx2));
        assert!(m1 == m2 && m1 == Some(protocol::NIGHT_MAP), "{m1:?} {m2:?}");
    }

    #[test]
    fn a_leave_before_the_start_cancels_and_after_it_leaves_the_slot_empty() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[0; 2], 0.0).tokens;
        let (tx1, _rx1) = channel(OUT_QUEUE);
        let (tx2, _rx2) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx1));
        host.leave(1, false);
        assert_eq!(host.match_count(), 0, "cancelled: player 1 alone, then gone");
        assert!(!host.claim(tokens[1], 2, request(), tx2));
        // (in a 2v2 with two claimed, one leaving before the start: the other is told, and their session ends: RV-360)
        let tokens = host.create_match(TWOS, &[0; 4], 0.0).tokens;
        let (tx5, mut rx5) = channel(OUT_QUEUE);
        let (tx6, _rx6) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 5, request(), tx5) && host.claim(tokens[1], 6, request(), tx6));
        host.leave(6, false);
        assert_eq!(host.match_count(), 0);
        assert!(controls(&mut rx5).contains(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED }));
        assert!(rx5.is_closed());

        let tokens = host.create_match(TWOS, &[0; 4], 0.0).tokens;
        let mut rxs = Vec::new();
        for (i, &token) in tokens.iter().enumerate() {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(host.claim(token, 10 + i as PlayerId, request(), tx));
            rxs.push(rx);
        }
        let t = run(&mut host, 0.0, 1.0);
        host.leave(11, true);
        assert_eq!(host.match_count(), 1, "started: the match plays on without them (no backfill)");
        assert_eq!(host.game_of(10).unwrap().player_count(), 3);
        for id in [10, 12, 13] {
            host.leave(id, false);
        }
        run(&mut host, t, 0.1);
        assert_eq!(host.match_count(), 0, "everyone gone: let go");
    }

    #[test]
    fn matches_tick_on_their_own_and_a_finished_one_is_let_go() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let a = host.create_match(ONES, &[0; 2], 0.0).tokens;
        let mut rxs = Vec::new();
        for (i, &token) in a.iter().enumerate() {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(host.claim(token, 1 + i as PlayerId, request(), tx));
            rxs.push(rx);
        }
        let t = run(&mut host, 0.0, 2.0);
        let b = host.create_match(ONES, &[0; 2], t).tokens;
        for (i, &token) in b.iter().enumerate() {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(host.claim(token, 3 + i as PlayerId, request(), tx));
            rxs.push(rx);
        }
        run(&mut host, t, 1.0);
        let (ta, tb) = (host.game_of(1).unwrap().tick_count(), host.game_of(3).unwrap().tick_count());
        assert!(ta >= 3 * 120 - 2 && (119..=122).contains(&tb), "each its own clock: {ta}, {tb}");
        // A team forfeits: the match ends, its end screen runs out, and it's let go (b's idle players not kicked meanwhile)
        host.matches.values_mut().filter_map(|m| m.game.as_mut()).for_each(|g| g.idle_kick = false);
        host.leave(2, false);
        let mut t = t + 1.0;
        for _ in 0..80 {
            t = run(&mut host, t, 1.0);
            rxs.iter_mut().for_each(|rx| while rx.try_recv().is_ok() {}); // (the clients read)
        }
        assert!(host.game_of(1).is_none(), "match a let go after its end screen");
        assert!(host.game_of(3).is_some(), "match b plays on");
    }

    #[test]
    fn a_match_whose_tick_panics_is_let_go_and_the_others_play_on() {
        // (SEC-7)
        init_engine();
        let mut host = MatchHost::new(1, None);
        let mut rxs = Vec::new();
        for first in [1, 3] {
            let tokens = host.create_match(ONES, &[0; 2], 0.0).tokens;
            for (i, &token) in tokens.iter().enumerate() {
                let (tx, rx) = channel(OUT_QUEUE);
                assert!(host.claim(token, first + i as PlayerId, request(), tx));
                rxs.push(rx);
            }
        }
        let t = run(&mut host, 0.0, 1.0);
        host.game_of(1).unwrap().panic_next_tick = true;
        let before = host.game_of(3).unwrap().tick_count();
        let t = run(&mut host, t, 0.5);
        assert!(host.game_of(1).is_none() && host.game_of(2).is_none(), "the panicking match let go");
        assert!(rxs[0].is_closed() && rxs[1].is_closed(), "its sessions end");
        assert!(host.game_of(3).unwrap().tick_count() > before + 50, "the other plays on");
        // An open match starts afresh
        let mut open = MatchHost::new(1, None);
        open.open_match(ONES, 0.0);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(open.join_open(9, request(), tx));
        open.game_of(9).unwrap().panic_next_tick = true;
        run(&mut open, t, 0.1);
        assert_eq!(open.match_count(), 1);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(open.join_open(10, request(), tx), "a new open match takes players");
    }

    #[test]
    fn a_formed_match_costs_nothing_until_claimed_and_a_stall_catches_up_five_ticks_at_most() {
        // (RV-357: no arena and no ticks for a match no one claimed; RV-360: the catch-up bound)
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, &[0; 2], 0.0).tokens;
        run(&mut host, 0.0, 1.0);
        assert!(host.matches.values().all(|m| m.game.is_none()), "not built before a claim");
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx));
        host.tick(1.0);
        let before = host.game_of(1).unwrap().tick_count();
        host.tick(9.5); // (an 8.5 s stall, inside the wait for the other player)
        assert_eq!(host.game_of(1).unwrap().tick_count() - before, 5, "five ticks to catch up, the rest dropped");
        host.tick(9.5 + 1.0 / 120.0);
        assert!(
            host.game_of(1).unwrap().tick_count() - before <= 7,
            "then on time: the dropped time doesn't come back"
        );
    }

    #[test]
    fn the_open_match_takes_anyone_and_stays() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        host.open_match(ONES, 0.0);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.join_open(1, request(), tx));
        host.leave(1, false);
        run(&mut host, 0.0, 1.0);
        assert_eq!(host.match_count(), 1);
        let mut queue_host = MatchHost::new(1, None);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(!queue_host.join_open(1, request(), tx), "a queue server has no open match");
    }

    /// The matchmaker's events (notes/matchmaking.md, the central matchmaker): its start once, each leave and rejoin of
    /// the started match by seat, a cancel's no-shows (a leaver's before the start), its end with no result
    #[test]
    fn the_matchmaker_is_told_the_start_the_leaves_and_rejoins_a_cancel_and_an_end_with_no_result() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(TWOS, &[1, 2, 3, 4], 0.0).tokens;
        let (tx, _rx) = channel(OUT_QUEUE);
        for (i, &token) in tokens.iter().enumerate() {
            let n = i as u8 + 1;
            assert!(host.claim(token, u64::from(n), seat(n), tx.clone()));
        }
        let hosted = host.matches.values().next().unwrap();
        let (match_id, ranked_id) = (hosted.ranked, hosted.ranked_text());
        run_to(&mut host, 0.0, 3.0);
        let events = |host: &mut MatchHost| -> Vec<Report> {
            host.take_reports()
                .into_iter()
                .filter(|r| !matches!(r, Report::Quitter { .. } | Report::Refilled { .. } | Report::Result(_)))
                .collect()
        };
        assert_eq!(events(&mut host), vec![Report::Started { match_id: ranked_id.clone() }], "its start, once");
        run_to(&mut host, 3.0, 4.0);
        assert!(events(&mut host).is_empty());
        host.observe(4.0);
        host.leave(2, false);
        assert_eq!(events(&mut host), vec![Report::Left { match_id: ranked_id.clone(), seat: 1 }]);
        assert!(host.rejoin(match_id, 20, rejoining(2), tx.clone()).is_ok());
        assert_eq!(events(&mut host), vec![Report::Back { match_id: ranked_id.clone(), seat: 1 }]);
        // (everyone gone, no winner: a no contest, its end told with no result)
        for id in [1, 20, 3, 4] {
            host.leave(id, false);
        }
        let all = events(&mut host);
        assert_eq!(all.last(), Some(&Report::Over { match_id: ranked_id.clone() }), "{all:?}");
        assert_eq!(all.iter().filter(|r| matches!(r, Report::Left { .. })).count(), 4);

        // (a leave before the start: a cancel naming the leaver's seat alone)
        let tokens = host.create_match(ONES, &[5, 6], 10.0).tokens;
        host.observe(10.0);
        assert!(host.claim(tokens[0], 5, seat(5), tx.clone()) && host.claim(tokens[1], 6, seat(6), tx.clone()));
        host.leave(6, false);
        let all = events(&mut host);
        assert!(matches!(all.as_slice(), [Report::Cancelled { no_shows, .. }] if no_shows == &[1]), "{all:?}");
        // (a match that never started, its last player gone: cancelled, never "over": RV-876's R11)
        let tokens = host.create_match(ONES, &[7, 8], 20.0).tokens;
        host.observe(20.0);
        assert!(host.claim(tokens[0], 7, seat(7), tx.clone()));
        host.leave(7, false);
        let all = events(&mut host);
        assert!(matches!(all.as_slice(), [Report::Cancelled { no_shows, .. }] if no_shows == &[0]), "{all:?}");
    }

    /// A claim opens its match at the first, in the ticket's playlist; a claim that doesn't fit the match (another
    /// playlist or roster, a seat taken) or of an account in another match here is refused
    #[test]
    fn a_seat_claim_opens_its_match_and_one_that_doesnt_fit_is_refused() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let (tx, _rx) = channel(OUT_QUEUE);
        let claim = SeatClaim { match_id: 0xabc, playlist: 2, seat: 0, roster: 4 };
        assert_eq!(host.claim_seat(&claim, TWOS, 1, seat(1), tx.clone()), Ok(()));
        assert_eq!(host.match_count(), 1);
        assert_eq!(host.matches.values().next().unwrap().ranked, 0xabc, "the matchmaker's id");
        let refused = |host: &mut MatchHost, c: SeatClaim, id: PlayerId, n: u8| {
            host.claim_seat(&c, TWOS, id, seat(n), tx.clone())
        };
        assert_eq!(refused(&mut host, claim, 2, 2), Err(protocol::REFUSED_TOKEN), "a seat taken");
        assert_eq!(
            refused(&mut host, SeatClaim { roster: 6, seat: 1, ..claim }, 2, 2),
            Err(protocol::REFUSED_TOKEN),
            "another roster"
        );
        assert_eq!(
            refused(&mut host, SeatClaim { seat: 4, ..claim }, 2, 2),
            Err(protocol::REFUSED_TOKEN),
            "no such seat"
        );
        assert_eq!(
            host.claim_seat(&SeatClaim { playlist: 1, roster: 2, ..claim }, ONES, 2, seat(2), tx.clone()),
            Err(protocol::REFUSED_TOKEN),
            "another playlist"
        );
        // (account 1 is in match 0xabc: its claim of a seat in another match here refused)
        let other = SeatClaim { match_id: 0xdef, playlist: 1, seat: 0, roster: 2 };
        assert_eq!(host.claim_seat(&other, ONES, 3, seat(1), tx.clone()), Err(protocol::REFUSED_IN_MATCH));
        assert_eq!(refused(&mut host, SeatClaim { seat: 1, ..claim }, 2, 2), Ok(()));
    }
}
