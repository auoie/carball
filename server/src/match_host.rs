//! The match host: runs the matches on the game thread. The queue (`src/queue.rs`) only decides who plays together and
//! asks for a match (`MatchHosting::create_match`); the host reserves a slot per player, each with a one-time random token
//! that the player's client claims with a new session (`claim`). A match starts when every slot is claimed (full start:
//! `Game::hold_for`), and is cancelled if one isn't within `RESERVATION_SECONDS` or a player leaves before it starts: the
//! claimed players are told (`KICK_NOT_ALL_JOINED`) and search again, the queue told who stalled it (`take_cancelled`:
//! RV-367) (notes/matchmaking.md, v1 queue checklist). A match
//! over (its end screen's time up) or left by everyone is let go. Development servers host one open match that anyone
//! joins (`join_open`), which rematches and never ends.

use std::collections::{BTreeMap, HashMap};

use tokio::sync::mpsc::Sender;

use crate::game::{Game, JoinRequest, MatchType, Outgoing, PlayerId, TICK_RATE, random_u64};
use crate::protocol::{self, Control};

/// A playlist: its team size, match type and forfeit vote wait (s; None: the match type's)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Playlist {
    pub team_size: u8,
    pub match_type: MatchType,
    pub forfeit_vote_wait: Option<f32>,
}

/// How long a match waits for its reserved players, from its `MatchFound`: the 3 s "Joining in" countdown and the match
/// page's load and connection (RV-367, the user's decision: well under the game's 30 s, MM-18, which let one no-show
/// hold the others that long)
pub const RESERVATION_SECONDS: f64 = 12.0;

/// At most this many ticks of a match to catch up after a stall; beyond that, its time is dropped
const MAX_CATCH_UP_TICKS: u32 = 5;

pub type MatchId = u32;

/// What the queue asks of a host: a match for this many players in this playlist; one token per player, to hand them
pub trait MatchHosting {
    fn create_match(&mut self, playlist: Playlist, players: usize, now: f64) -> Vec<u64>;
}

/// A reserved slot: its token, its team, who claimed it, and whether they left before the start
struct Reservation {
    token: u64,
    team: u8,
    claimed: Option<PlayerId>,
    left: bool,
}

/// A match cancelled before its start, for the queue (RV-367): the tokens of the slots that stalled it (cancelled by time:
/// those not claimed; by a leave before the start: the leaver's, the others' still in their time), and of the rest (back
/// to the front when they search again: a claimed player told so, one still loading refused their claim)
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Cancelled {
    pub stayed: Vec<u64>,
    pub stalled: Vec<u64>,
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
}

pub struct MatchHost {
    matches: BTreeMap<MatchId, Hosted>,
    /// The match each player is in
    players: HashMap<PlayerId, MatchId>,
    /// The unclaimed tokens' matches
    tokens: HashMap<u64, MatchId>,
    next_id: MatchId,
    /// Each match its own kickoff orders (the game's are random)
    seed: i32,
    /// Browser tests: each round, the ball is knocked into a goal this long after "go" (ticks)
    test_goal_after: Option<u64>,
    /// The last tick's time (s): a match built later starts its clock there
    now: f64,
    /// The matches cancelled since the queue last asked (`take_cancelled`)
    cancelled: Vec<Cancelled>,
}

impl Hosted {
    /// The match's game, built at its first player
    fn game(&mut self, test_goal_after: Option<u64>) -> &mut Game {
        let (seed, playlist, open, hold_for) = (self.seed, self.playlist, self.open, self.reservations.len());
        self.game.get_or_insert_with(|| {
            let mut game = Game::with_options(seed, playlist.team_size);
            game.match_type = playlist.match_type;
            game.forfeit_vote_wait = playlist.forfeit_vote_wait.map(|s| (s * TICK_RATE as f32) as u32);
            game.test_goal_after = test_goal_after;
            game.rematch = open;
            game.idle_kick = !open;
            game.hold_for = hold_for;
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
        Self { matches: BTreeMap::new(), players: HashMap::new(), tokens: HashMap::new(), next_id: 1, seed, test_goal_after, now: 0.0, cancelled: Vec::new() }
    }

    fn add(&mut self, playlist: Playlist, reservations: Vec<Reservation>, open: bool, now: f64) -> MatchId {
        self.seed = self.seed.wrapping_add(7919);
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        for r in &reservations {
            self.tokens.insert(r.token, id);
        }
        let mut hosted = Hosted { game: None, seed: self.seed, playlist, reservations, created: now, next_tick: now, open };
        if open {
            hosted.game(self.test_goal_after); // (anyone may join it: built at once)
        }
        self.matches.insert(id, hosted);
        id
    }

    /// Development servers: the open match anyone joins (`join_open`)
    pub fn open_match(&mut self, playlist: Playlist, now: f64) -> MatchId {
        self.add(playlist, Vec::new(), true, now)
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

    /// A player claims their reserved slot with its token: they join its match on its team; false if no reservation
    /// has the token (never given, claimed already, or its match gone)
    pub fn claim(&mut self, token: u64, id: PlayerId, request: JoinRequest, out: Sender<Outgoing>) -> bool {
        let Some(match_id) = self.tokens.remove(&token) else { return false };
        let Some(hosted) = self.matches.get_mut(&match_id) else { return false };
        let Some(slot) = hosted.reservations.iter_mut().find(|r| r.token == token && r.claimed.is_none()) else { return false };
        slot.claimed = Some(id);
        let team = slot.team;
        if hosted.game.is_none() {
            hosted.next_tick = self.now; // (its clock from now: built at its first claim)
        }
        hosted.game(self.test_goal_after).join(id, JoinRequest { team, ..request }, out);
        self.players.insert(id, match_id);
        true
    }

    /// A player's session ended. Before their match started it's cancelled (its slot can't be filled: full start)
    pub fn leave(&mut self, id: PlayerId, lost: bool) {
        let Some(match_id) = self.players.remove(&id) else { return };
        let Some(hosted) = self.matches.get_mut(&match_id) else { return };
        if let Some(game) = hosted.game.as_mut() {
            if lost {
                game.connection_lost(id);
            } else {
                game.leave(id);
            }
        }
        if hosted.holding() {
            eprintln!("match {match_id}: player {id} left before the start, cancelled");
            if let Some(slot) = hosted.reservations.iter_mut().find(|r| r.claimed == Some(id)) {
                slot.left = true;
            }
            self.cancel(match_id);
        } else if hosted.player_count() == 0 && !hosted.open {
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
            }));
            if ran.is_err() {
                eprintln!("match {match_id}: its tick panicked, let go");
                done.push((match_id, false));
                if m.open {
                    restart.push(m.playlist);
                }
                continue;
            }
            if m.open {
                continue;
            }
            if m.holding() && now - m.created > RESERVATION_SECONDS {
                eprintln!("match {match_id}: not every reserved player joined in {RESERVATION_SECONDS} s, cancelled");
                done.push((match_id, true));
            } else if m.game.as_ref().is_some_and(Game::is_over) || (!m.holding() && m.player_count() == 0) {
                done.push((match_id, false));
            }
        }
        for (match_id, cancelled) in done {
            if cancelled {
                self.cancel(match_id);
            } else {
                self.drop_match(match_id);
            }
        }
        for playlist in restart {
            self.open_match(playlist, now);
        }
    }

    /// The match is cancelled before it started: its players are told, then their sessions end; the queue is told who
    /// stayed and who stalled it
    fn cancel(&mut self, match_id: MatchId) {
        if let Some(hosted) = self.matches.get(&match_id) {
            if let Some(game) = hosted.game.as_ref() {
                game.broadcast(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED });
            }
            let by_leave = hosted.reservations.iter().any(|r| r.left);
            let (stalled, stayed): (Vec<&Reservation>, Vec<&Reservation>) =
                hosted.reservations.iter().partition(|r| if by_leave { r.left } else { r.claimed.is_none() });
            self.cancelled.push(Cancelled { stayed: stayed.iter().map(|r| r.token).collect(), stalled: stalled.iter().map(|r| r.token).collect() });
        }
        self.drop_match(match_id);
    }

    /// The matches cancelled before their start since the last call (the queue's: RV-367)
    pub fn take_cancelled(&mut self) -> Vec<Cancelled> {
        std::mem::take(&mut self.cancelled)
    }

    /// Lets the match go: its players' sessions end (their queues closed once what was sent goes out), its tokens die
    fn drop_match(&mut self, match_id: MatchId) {
        if let Some(hosted) = self.matches.remove(&match_id) {
            for r in &hosted.reservations {
                self.tokens.remove(&r.token);
            }
            self.players.retain(|_, m| *m != match_id);
            eprintln!("match {match_id} let go");
        }
    }
}

impl MatchHosting for MatchHost {
    /// The players' slots, teams alternating (blue, orange, ...), each with a token none other has
    fn create_match(&mut self, playlist: Playlist, players: usize, now: f64) -> Vec<u64> {
        let mut reservations = Vec::with_capacity(players);
        for i in 0..players {
            let token = loop {
                let t = random_u64();
                if t != 0 && !self.tokens.contains_key(&t) && reservations.iter().all(|r: &Reservation| r.token != t) {
                    break t;
                }
            };
            reservations.push(Reservation { token, team: (i % 2) as u8, claimed: None, left: false });
        }
        let tokens = reservations.iter().map(|r| r.token).collect();
        let match_id = self.add(playlist, reservations, false, now);
        eprintln!("match {match_id}: {players} players reserved ({} v {})", playlist.team_size, playlist.team_size);
        tokens
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::OUT_QUEUE;
    use crate::protocol::Phase;
    use tokio::sync::mpsc::{Receiver, channel};

    fn init_engine() {
        crate::engine::init(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    }

    const ONES: Playlist = Playlist { team_size: 1, match_type: MatchType::Casual, forfeit_vote_wait: None };
    const TWOS: Playlist = Playlist { team_size: 2, match_type: MatchType::Casual, forfeit_vote_wait: None };

    fn request() -> JoinRequest {
        JoinRequest {
            team: 255,
            body: 0,
            dodge_deadzone: 0.5,
            steering_sensitivity: 1.0,
            air_control_sensitivity: 1.0,
            auto_skip_replay: false,
            key: 0,
            name: String::new(),
            quick_chat: 0,
            block_non_tactical: false,
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
        let tokens = host.create_match(TWOS, 4, 0.0);
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
    fn the_window_is_the_users_12_s() {
        // (RV-367's decision, pinned: RX14's N18)
        assert_eq!(RESERVATION_SECONDS, 12.0);
    }

    #[test]
    fn a_token_claims_once_and_only_its_own_slot() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, 2, 0.0);
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
        let tokens = host.create_match(ONES, 2, 0.0);
        let (tx, mut rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx));
        run(&mut host, 0.0, RESERVATION_SECONDS - 0.5);
        assert_eq!(host.match_count(), 1);
        run(&mut host, RESERVATION_SECONDS - 0.5, 1.0);
        assert_eq!(host.match_count(), 0);
        assert!(host.game_of(1).is_none());
        assert!(controls(&mut rx).contains(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED }));
        assert!(rx.try_recv().is_err() && rx.is_closed(), "the session's queue closed: it ends");
        // (before any late claim, which would take its token out itself: RX13's S22)
        assert!(host.tokens.is_empty() && host.players.is_empty(), "a let-go match keeps no tokens or players (RV-360)");
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(!host.claim(tokens[1], 2, request(), tx), "the late token is dead");
        assert_eq!(host.take_cancelled(), vec![Cancelled { stayed: vec![tokens[0]], stalled: vec![tokens[1]] }], "by time: the unclaimed slot stalled it");
        assert!(host.take_cancelled().is_empty());
    }

    #[test]
    fn a_no_show_or_a_leaver_before_the_start_waits_and_the_others_go_back_to_the_front() {
        // RV-367 with the real queue and host: a searcher that never claims (or claims and leaves) costs the others
        // their place no more, and can't do it again for two minutes
        use crate::queue::{Matchmaker, NO_SHOW_COOLDOWN, SearchFrom, Searched};
        init_engine();
        let mut queue = Matchmaker::new(&[ONES]);
        let mut host = MatchHost::new(1, None);
        let from = |id: PlayerId| SearchFrom { address: [10, 0, 0, id as u8].into(), key: 500 + id, token: 0 };
        let search = |queue: &mut Matchmaker, id: PlayerId, who: PlayerId, token: u64, now: f64| {
            let (tx, rx) = channel(OUT_QUEUE);
            assert_eq!(queue.search(id, 1, tx, SearchFrom { token, ..from(who) }, now), Searched::Queued);
            rx
        };
        let token_of = |rx: &mut Receiver<Outgoing>| controls(rx).into_iter().find_map(|m| if let Control::MatchFound { token } = m { Some(token) } else { None });
        let step = |host: &mut MatchHost, queue: &mut Matchmaker, t: f64| {
            queue.form(host, t);
            host.tick(t);
            for c in host.take_cancelled() {
                queue.cancelled(&c, t);
            }
        };
        // The no-show (1) and a player (2) are matched; 3 searches meanwhile
        let mut s1 = search(&mut queue, 1, 1, 0, 0.0);
        let mut s2 = search(&mut queue, 2, 2, 0, 1.0);
        step(&mut host, &mut queue, 1.0);
        let (_t1, t2) = (token_of(&mut s1).unwrap(), token_of(&mut s2).unwrap());
        let mut s3 = search(&mut queue, 3, 3, 0, 2.0);
        let (tx, mut m2) = channel(OUT_QUEUE);
        assert!(host.claim(t2, 20, request(), tx));
        let mut t = 1.0;
        while host.match_count() > 0 {
            t += 1.0 / 120.0;
            step(&mut host, &mut queue, t);
        }
        assert!(t < 1.0 + RESERVATION_SECONDS + 0.1, "cancelled at {t}");
        assert!(controls(&mut m2).contains(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED }));
        let (tx, _r) = channel(OUT_QUEUE);
        assert!(matches!(queue.search(30, 1, tx, from(1), t), Searched::Cooldown { seconds, network: false } if f64::from(seconds) > NO_SHOW_COOLDOWN - 1.0));
        // 2 searches again with its token: matched with 3 ahead of 4, who searched before 2's return
        let mut s4 = search(&mut queue, 4, 4, 0, t);
        let mut s2 = search(&mut queue, 21, 2, t2, t);
        step(&mut host, &mut queue, t);
        let (t2, t3) = (token_of(&mut s2).unwrap(), token_of(&mut s3).unwrap());
        assert!(token_of(&mut s4).is_none(), "4 waits");
        // This time 3 claims and leaves before 2 has claimed: 3 waits, and 2's claim (still in its time) is refused but
        // its token puts it back at the front
        let (tx, _m3) = channel(OUT_QUEUE);
        assert!(host.claim(t3, 23, request(), tx));
        host.leave(23, false);
        step(&mut host, &mut queue, t + 2.0);
        let (tx, _m2) = channel(OUT_QUEUE);
        assert!(!host.claim(t2, 22, request(), tx));
        let (tx, _r) = channel(OUT_QUEUE);
        assert!(matches!(queue.search(31, 1, tx, from(3), t + 3.0), Searched::Cooldown { .. }), "the leaver");
        let mut s2 = search(&mut queue, 24, 2, t2, t + 3.0);
        step(&mut host, &mut queue, t + 3.0);
        assert!(token_of(&mut s2).is_some() && token_of(&mut s4).is_some(), "2 (back at the front) with 4");
    }

    #[test]
    fn a_leave_before_the_start_cancels_and_after_it_leaves_the_slot_empty() {
        init_engine();
        let mut host = MatchHost::new(1, None);
        let tokens = host.create_match(ONES, 2, 0.0);
        let (tx1, _rx1) = channel(OUT_QUEUE);
        let (tx2, _rx2) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx1));
        host.leave(1, false);
        assert_eq!(host.match_count(), 0, "cancelled: player 1 alone, then gone");
        assert!(!host.claim(tokens[1], 2, request(), tx2));
        // (in a 2v2 with two claimed, one leaving before the start: the other is told, and their session ends: RV-360)
        let tokens = host.create_match(TWOS, 4, 0.0);
        let (tx5, mut rx5) = channel(OUT_QUEUE);
        let (tx6, _rx6) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 5, request(), tx5) && host.claim(tokens[1], 6, request(), tx6));
        host.leave(6, false);
        assert_eq!(host.match_count(), 0);
        assert!(controls(&mut rx5).contains(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED }));
        assert!(rx5.is_closed());

        let tokens = host.create_match(TWOS, 4, 0.0);
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
        let a = host.create_match(ONES, 2, 0.0);
        let mut rxs = Vec::new();
        for (i, &token) in a.iter().enumerate() {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(host.claim(token, 1 + i as PlayerId, request(), tx));
            rxs.push(rx);
        }
        let t = run(&mut host, 0.0, 2.0);
        let b = host.create_match(ONES, 2, t);
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
            let tokens = host.create_match(ONES, 2, 0.0);
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
        let tokens = host.create_match(ONES, 2, 0.0);
        run(&mut host, 0.0, 1.0);
        assert!(host.matches.values().all(|m| m.game.is_none()), "not built before a claim");
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(host.claim(tokens[0], 1, request(), tx));
        host.tick(1.0);
        let before = host.game_of(1).unwrap().tick_count();
        host.tick(11.0); // (a 10 s stall)
        assert_eq!(host.game_of(1).unwrap().tick_count() - before, 5, "five ticks to catch up, the rest dropped");
        host.tick(11.0 + 1.0 / 120.0);
        assert!(host.game_of(1).unwrap().tick_count() - before <= 7, "then on time: the dropped time doesn't come back");
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
}
