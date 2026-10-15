//! The match host: runs the matches on the game thread. The queue (`src/queue.rs`) only decides who plays together and
//! asks for a match (`MatchHosting::create_match`); the host reserves a slot per player, each with a one-time random token
//! that the player's client claims with a new session (`claim`). A match starts when every slot is claimed (full start:
//! `Game::hold_for`), and is cancelled if one isn't within `RESERVATION_SECONDS` or a player leaves before it starts: the
//! claimed players are told (`KICK_NOT_ALL_JOINED`) and search again (notes/matchmaking.md, v1 queue checklist). A match
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

/// How long a match waits for its reserved players (the game's initial reservation timeout: MM-18)
pub const RESERVATION_SECONDS: f64 = 30.0;

/// At most this many ticks of a match to catch up after a stall; beyond that, its time is dropped
const MAX_CATCH_UP_TICKS: u32 = 5;

pub type MatchId = u32;

/// What the queue asks of a host: a match for this many players in this playlist; one token per player, to hand them
pub trait MatchHosting {
    fn create_match(&mut self, playlist: Playlist, players: usize, now: f64) -> Vec<u64>;
}

/// A reserved slot: its token, its team, and who claimed it
struct Reservation {
    token: u64,
    team: u8,
    claimed: Option<PlayerId>,
}

struct Hosted {
    game: Game,
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
}

impl MatchHost {
    pub fn new(seed: i32, test_goal_after: Option<u64>) -> Self {
        Self { matches: BTreeMap::new(), players: HashMap::new(), tokens: HashMap::new(), next_id: 1, seed, test_goal_after }
    }

    fn add(&mut self, playlist: Playlist, reservations: Vec<Reservation>, open: bool, now: f64) -> MatchId {
        self.seed = self.seed.wrapping_add(7919);
        let mut game = Game::with_options(self.seed, playlist.team_size);
        game.match_type = playlist.match_type;
        game.forfeit_vote_wait = playlist.forfeit_vote_wait.map(|s| (s * TICK_RATE as f32) as u32);
        game.test_goal_after = self.test_goal_after;
        game.rematch = open;
        game.idle_kick = !open;
        game.hold_for = reservations.len();
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        for r in &reservations {
            self.tokens.insert(r.token, id);
        }
        self.matches.insert(id, Hosted { game, reservations, created: now, next_tick: now, open });
        id
    }

    /// Development servers: the open match anyone joins (`join_open`)
    pub fn open_match(&mut self, playlist: Playlist, now: f64) -> MatchId {
        self.add(playlist, Vec::new(), true, now)
    }

    /// A player joins the open match; false if there's none (a queue server)
    pub fn join_open(&mut self, id: PlayerId, request: JoinRequest, out: Sender<Outgoing>) -> bool {
        let Some((&match_id, hosted)) = self.matches.iter_mut().find(|(_, m)| m.open) else { return false };
        hosted.game.join(id, request, out);
        if hosted.game.car_id(id).is_some() {
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
        hosted.game.join(id, JoinRequest { team, ..request }, out);
        self.players.insert(id, match_id);
        true
    }

    /// A player's session ended. Before their match started it's cancelled (its slot can't be filled: full start)
    pub fn leave(&mut self, id: PlayerId, lost: bool) {
        let Some(match_id) = self.players.remove(&id) else { return };
        let Some(hosted) = self.matches.get_mut(&match_id) else { return };
        if lost {
            hosted.game.connection_lost(id);
        } else {
            hosted.game.leave(id);
        }
        if hosted.game.holding() {
            eprintln!("match {match_id}: player {id} left before the start, cancelled");
            self.cancel(match_id);
        } else if hosted.game.player_count() == 0 && !hosted.open {
            self.drop_match(match_id);
        }
    }

    /// The game a player is in
    pub fn game_of(&mut self, id: PlayerId) -> Option<&mut Game> {
        let match_id = self.players.get(&id)?;
        self.matches.get_mut(match_id).map(|m| &mut m.game)
    }

    pub fn match_count(&self) -> usize {
        self.matches.len()
    }

    /// When the next match tick is due (s); None without matches
    pub fn next_tick(&self) -> Option<f64> {
        self.matches.values().map(|m| m.next_tick).min_by(f64::total_cmp)
    }

    /// Each match's ticks due by `now` (s), at most a few to catch up; then the matches cancelled (reservations
    /// expired), over or empty let go
    pub fn tick(&mut self, now: f64) {
        let mut done = Vec::new();
        for (&match_id, m) in &mut self.matches {
            let mut ticks = 0;
            while m.next_tick <= now && ticks < MAX_CATCH_UP_TICKS {
                m.game.tick(m.next_tick);
                m.next_tick += m.game.next_tick_seconds();
                ticks += 1;
            }
            if ticks == MAX_CATCH_UP_TICKS && m.next_tick < now {
                m.next_tick = now;
            }
            if m.open {
                continue;
            }
            if m.game.holding() && now - m.created > RESERVATION_SECONDS {
                eprintln!("match {match_id}: not every reserved player joined in {RESERVATION_SECONDS} s, cancelled");
                done.push((match_id, true));
            } else if m.game.is_over() || (!m.game.holding() && m.game.player_count() == 0) {
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
    }

    /// The match is cancelled before it started: its players are told, then their sessions end
    fn cancel(&mut self, match_id: MatchId) {
        if let Some(hosted) = self.matches.get(&match_id) {
            hosted.game.broadcast(&Control::Kicked { reason: protocol::KICK_NOT_ALL_JOINED });
        }
        self.drop_match(match_id);
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
            reservations.push(Reservation { token, team: (i % 2) as u8, claimed: None });
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
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(!host.claim(tokens[1], 2, request(), tx), "the late token is dead");
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
        assert!(ta >= 3 * 120 - 2 && (119..=121).contains(&tb), "each its own clock: {ta}, {tb}");
        // A team forfeits: the match ends, its end screen runs out, and it's let go (b's idle players not kicked meanwhile)
        host.matches.values_mut().for_each(|m| m.game.idle_kick = false);
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
