//! The queue: who plays together. A search names a playlist; each playlist's searchers wait in arrival order, and as soon
//! as a full match's worth are waiting (two teams of its size: full start, no backfill or bots) the queue asks the host
//! for a match (`MatchHosting::create_match`) and hands each searcher their slot's token (`MatchFound`); their search
//! sessions end there. Nothing else about matches is the queue's (notes/matchmaking.md, v1 queue checklist; no ranks,
//! parties or regions in v1). A match cancelled before its start (`Cancelled`: someone didn't claim their slot, or left
//! before the start) puts the players who claimed back at the front, in their first search's order, and whoever stalled
//! it can't search for `NO_SHOW_COOLDOWN`, by their browser's key and by address (RV-367, the user's decision: one
//! person can't keep stalling matches; leaving a started match isn't penalized).

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::net::IpAddr;

use tokio::sync::mpsc::Sender;

use crate::game::{Outgoing, PlayerId};
use crate::match_host::{Cancelled, MatchHosting, Playlist, RESERVATION_SECONDS};
use crate::protocol::Control;

/// How long a browser or address that stalled a match can't search (s)
pub const NO_SHOW_COOLDOWN: f64 = 120.0;
/// How long a cancelled match's claimed token puts its player back at the front (s: the client searches again at once)
const RETURN_SECONDS: f64 = 60.0;

/// Who a search is from: its address (`net::address_key`), its browser's key (0: none), and the token of the slot it
/// claimed in a match cancelled for someone else (0: none)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchFrom {
    pub address: IpAddr,
    pub key: u64,
    pub token: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Searched {
    Queued,
    /// No playlist has the team size
    NoPlaylist,
    /// Its browser or address stalled a match: it may search again in this many seconds
    Cooldown { seconds: u16 },
}

struct Searcher {
    id: PlayerId,
    out: Sender<Outgoing>,
    from: SearchFrom,
    /// When it first searched (s): a returning player keeps their first search's
    since: f64,
    /// Back from a match cancelled for someone else: ahead of every new searcher
    returning: bool,
}

/// A found match's slot: who searched for it, until its match starts or is cancelled
struct Handed {
    team_size: u8,
    from: SearchFrom,
    since: f64,
    until: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Who {
    Address(IpAddr),
    Key(u64),
}

pub struct Matchmaker {
    playlists: BTreeMap<u8, Playlist>,
    /// Each playlist's searchers (by team size): the returning ones first, each part oldest first
    waiting: BTreeMap<u8, VecDeque<Searcher>>,
    /// The playlist each searcher is in
    searching: HashMap<PlayerId, u8>,
    /// The found matches' slots, by token
    handed: HashMap<u64, Handed>,
    /// A cancelled match's claimed tokens: their playlist, first search's time, and until when they're good
    returning: HashMap<u64, (u8, f64, f64)>,
    /// Who stalled a match: until when they can't search
    cooldowns: HashMap<Who, f64>,
    /// When the expired entries were last let go (s)
    tidied: f64,
}

impl Matchmaker {
    /// The playlists searches may name (one per team size)
    pub fn new(playlists: &[Playlist]) -> Self {
        Self {
            playlists: playlists.iter().map(|p| (p.team_size, *p)).collect(),
            waiting: playlists.iter().map(|p| (p.team_size, VecDeque::new())).collect(),
            searching: HashMap::new(),
            handed: HashMap::new(),
            returning: HashMap::new(),
            cooldowns: HashMap::new(),
            tidied: 0.0,
        }
    }

    /// Until when the search's browser or address can't search, if either can't now
    fn cooling(&self, from: &SearchFrom, now: f64) -> Option<f64> {
        let key = (from.key != 0).then_some(Who::Key(from.key));
        [Some(Who::Address(from.address)), key].into_iter().flatten().filter_map(|w| self.cooldowns.get(&w).copied()).filter(|&until| until > now).reduce(f64::max)
    }

    /// A search of the playlist with this team size at `now` (s). A session searches once: a second search from it is
    /// ignored. A cancelled match's claimed token (`from.token`) puts it back at the front, in its first search's order
    pub fn search(&mut self, id: PlayerId, team_size: u8, out: Sender<Outgoing>, from: SearchFrom, now: f64) -> Searched {
        if !self.waiting.contains_key(&team_size) {
            return Searched::NoPlaylist;
        }
        if let Some(until) = self.cooling(&from, now) {
            return Searched::Cooldown { seconds: (until - now).ceil().clamp(1.0, f64::from(u16::MAX)) as u16 };
        }
        if self.searching.contains_key(&id) {
            return Searched::Queued;
        }
        let back = (from.token != 0)
            .then(|| self.returning.remove(&from.token))
            .flatten()
            .filter(|&(size, _, until)| size == team_size && until > now)
            .map(|(_, since, _)| since);
        let queue = self.waiting.get_mut(&team_size).expect("checked above");
        self.searching.insert(id, team_size);
        match back {
            Some(since) => {
                let at = queue.iter().position(|s| !s.returning || s.since > since).unwrap_or(queue.len());
                queue.insert(at, Searcher { id, out, from, since, returning: true });
            }
            None => queue.push_back(Searcher { id, out, from, since: now, returning: false }),
        }
        Searched::Queued
    }

    /// A match was cancelled before its start: who claimed goes back to the front when they search again, who stalled it
    /// can't search for a while (`NO_SHOW_COOLDOWN`)
    pub fn cancelled(&mut self, cancelled: &Cancelled, now: f64) {
        for token in &cancelled.stalled {
            if let Some(h) = self.handed.remove(token) {
                eprintln!("a match stalled by a no-show: their browser and address can't search for {NO_SHOW_COOLDOWN} s");
                let until = now + NO_SHOW_COOLDOWN;
                self.cooldowns.insert(Who::Address(h.from.address), until);
                if h.from.key != 0 {
                    self.cooldowns.insert(Who::Key(h.from.key), until);
                }
            }
        }
        for token in &cancelled.stayed {
            if let Some(h) = self.handed.remove(token) {
                self.returning.insert(*token, (h.team_size, h.since, now + RETURN_SECONDS));
            }
        }
    }

    /// Lets go of what has expired, once a second at most (the loop runs every millisecond)
    fn tidy(&mut self, now: f64) {
        if now - self.tidied < 1.0 {
            return;
        }
        self.tidied = now;
        self.handed.retain(|_, h| h.until > now);
        self.returning.retain(|_, r| r.2 > now);
        self.cooldowns.retain(|_, until| *until > now);
    }

    /// The searcher's session ended (cancelled, or the connection lost)
    pub fn cancel(&mut self, id: PlayerId) {
        if let Some(team_size) = self.searching.remove(&id)
            && let Some(queue) = self.waiting.get_mut(&team_size)
        {
            queue.retain(|s| s.id != id);
        }
    }

    pub fn searching(&self, team_size: u8) -> usize {
        self.waiting.get(&team_size).map_or(0, VecDeque::len)
    }

    /// Every match the waiting searchers fill, oldest searchers first: each one's token sent, their sessions let go.
    /// (A searcher whose session already ended, its cancel not yet here, doesn't count)
    pub fn form(&mut self, host: &mut impl MatchHosting, now: f64) {
        self.tidy(now);
        for (&team_size, queue) in &mut self.waiting {
            // (only a playlist with a match's worth waiting is looked at: the loop runs every millisecond, RV-357)
            let players = 2 * usize::from(team_size);
            if queue.len() < players {
                continue;
            }
            queue.retain(|s| !s.out.is_closed());
            while queue.len() >= players {
                let found: Vec<Searcher> = queue.drain(..players).collect();
                let tokens = host.create_match(self.playlists[&team_size], players, now);
                for (searcher, token) in found.into_iter().zip(tokens) {
                    self.searching.remove(&searcher.id);
                    // (kept past the reservation's end: a cancel's report comes with the tick after it)
                    self.handed.insert(token, Handed { team_size, from: searcher.from, since: searcher.since, until: now + RESERVATION_SECONDS + 30.0 });
                    let _ = searcher.out.try_send(Outgoing::Control(Control::MatchFound { token }.encode()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{MatchType, OUT_QUEUE};
    use tokio::sync::mpsc::{Receiver, channel};

    /// A host that records what it was asked and gives numbered tokens
    #[derive(Default)]
    struct Recorder {
        asked: Vec<(u8, usize)>,
        next: u64,
    }

    impl MatchHosting for Recorder {
        fn create_match(&mut self, playlist: Playlist, players: usize, _now: f64) -> Vec<u64> {
            self.asked.push((playlist.team_size, players));
            (0..players)
                .map(|_| {
                    self.next += 1;
                    self.next
                })
                .collect()
        }
    }

    fn playlists() -> Vec<Playlist> {
        [1, 2, 3].map(|team_size| Playlist { team_size, match_type: MatchType::Casual, forfeit_vote_wait: None }).to_vec()
    }

    /// A searcher's address and browser key (by id), no returning token
    fn from(id: PlayerId) -> SearchFrom {
        SearchFrom { address: [10, 0, 0, id as u8].into(), key: 1000 + id, token: 0 }
    }

    fn queued(queue: &mut Matchmaker, id: PlayerId, team_size: u8, out: Sender<Outgoing>) -> bool {
        queue.search(id, team_size, out, from(id), 0.0) == Searched::Queued
    }

    fn found(rx: &mut Receiver<Outgoing>) -> Option<u64> {
        while let Ok(Outgoing::Control(bytes)) = rx.try_recv() {
            if let Ok(Control::MatchFound { token }) = Control::decode(&bytes[2..]) {
                return Some(token);
            }
        }
        None
    }

    #[test]
    fn a_match_forms_only_when_a_playlist_has_two_full_teams() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let mut rxs = Vec::new();
        for id in 1..=3 {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(queued(&mut queue, id, 2, tx));
            rxs.push(rx);
        }
        let (tx, mut solo) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 9, 1, tx));
        queue.form(&mut host, 0.0);
        assert!(host.asked.is_empty(), "three of four for 2v2, one of two for 1v1");
        let (tx, rx) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 4, 2, tx));
        rxs.push(rx);
        queue.form(&mut host, 0.0);
        assert_eq!(host.asked, vec![(2, 4)]);
        let tokens: Vec<u64> = rxs.iter_mut().map(|rx| found(rx).unwrap()).collect();
        assert_eq!(tokens, vec![1, 2, 3, 4], "oldest first, a token each");
        assert!(rxs.iter().all(Receiver::is_closed), "their search sessions let go");
        assert_eq!((queue.searching(2), queue.searching(1)), (0, 1));
        assert!(found(&mut solo).is_none());
    }

    #[test]
    fn a_cancelled_or_ended_search_leaves_the_queue_and_duplicates_and_unknown_playlists_dont_count() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let (tx1, mut rx1) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 1, 1, tx1.clone()));
        assert!(queued(&mut queue, 1, 1, tx1), "a second search from the session: ignored");
        assert_eq!(queue.searching(1), 1);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert_eq!(queue.search(5, 4, tx, from(5), 0.0), Searched::NoPlaylist, "no 4v4 playlist");
        let (tx2, rx2) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 2, 1, tx2));
        queue.cancel(2);
        drop(rx2);
        let (tx3, rx3) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 3, 1, tx3));
        drop(rx3); // (its session ended, the cancel not yet here)
        queue.form(&mut host, 0.0);
        assert!(host.asked.is_empty());
        assert_eq!(queue.searching(1), 1);
        let (tx4, mut rx4) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 4, 1, tx4));
        queue.form(&mut host, 0.0);
        assert_eq!(host.asked, vec![(1, 2)]);
        assert_eq!((found(&mut rx1), found(&mut rx4)), (Some(1), Some(2)));
    }

    #[test]
    fn who_claimed_goes_back_to_the_front_in_their_first_searchs_order_once() {
        // (RV-367: a match cancelled for someone else costs its players their place no more)
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let search = |queue: &mut Matchmaker, id: PlayerId, token: u64, now: f64| {
            let (tx, rx) = channel(OUT_QUEUE);
            assert_eq!(queue.search(id, 1, tx, SearchFrom { token, ..from(id) }, now), Searched::Queued);
            rx
        };
        let (mut a, mut b) = (search(&mut queue, 1, 0, 0.0), search(&mut queue, 2, 0, 1.0));
        queue.form(&mut host, 1.0);
        let (ta, tb) = (found(&mut a).unwrap(), found(&mut b).unwrap());
        let mut c = search(&mut queue, 3, 0, 5.0);
        let mut d = search(&mut queue, 4, 0, 6.0);
        // b claimed, a didn't: b back at the front with their token, ahead of c and d
        queue.cancelled(&Cancelled { stayed: vec![tb], stalled: vec![ta] }, 13.0);
        let mut b = search(&mut queue, 2, tb, 14.0);
        queue.form(&mut host, 14.0);
        assert!(found(&mut b).is_some() && found(&mut c).is_some(), "b first, then the oldest new searcher");
        assert!(found(&mut d).is_none());
        // The token puts no one at the front again, nor in another playlist
        let (tx, _rx) = channel(OUT_QUEUE);
        assert_eq!(queue.search(5, 1, tx, SearchFrom { token: tb, ..from(5) }, 15.0), Searched::Queued);
        assert_eq!(queue.waiting[&1].back().map(|s| (s.id, s.returning)), Some((5, false)));
        let mut e = search(&mut queue, 6, 0, 16.0);
        queue.form(&mut host, 16.0);
        assert!(found(&mut d).is_some() && found(&mut e).is_none(), "d (the oldest) with 5");
    }

    #[test]
    fn returning_players_keep_their_first_searchs_order_among_themselves() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let mut rxs: Vec<_> = (1..=4)
            .map(|id| {
                let (tx, rx) = channel(OUT_QUEUE);
                assert_eq!(queue.search(id, 2, tx, from(id), id as f64), Searched::Queued);
                rx
            })
            .collect();
        queue.form(&mut host, 4.0);
        let tokens: Vec<u64> = rxs.iter_mut().map(|rx| found(rx).unwrap()).collect();
        let (tx, _new) = channel(OUT_QUEUE);
        assert_eq!(queue.search(9, 2, tx, from(9), 5.0), Searched::Queued);
        queue.cancelled(&Cancelled { stayed: tokens[..3].to_vec(), stalled: vec![tokens[3]] }, 16.0);
        // They search again in another order: the queue has them in their first searches' (1, 2, 3), then 9
        let mut again = Vec::new();
        for id in [3, 1, 2] {
            let (tx, rx) = channel(OUT_QUEUE);
            assert_eq!(queue.search(id, 2, tx, SearchFrom { token: tokens[id as usize - 1], ..from(id) }, 17.0), Searched::Queued);
            again.push(rx);
        }
        let order: Vec<(PlayerId, f64)> = queue.waiting[&2].iter().map(|s| (s.id, s.since)).collect();
        assert_eq!(order, vec![(1, 1.0), (2, 2.0), (3, 3.0), (9, 5.0)]);
    }

    #[test]
    fn whoever_stalled_a_match_cant_search_for_two_minutes_by_browser_key_or_address() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let (tx, mut a) = channel(OUT_QUEUE);
        assert_eq!(queue.search(1, 1, tx, from(1), 0.0), Searched::Queued);
        let (tx, mut b) = channel(OUT_QUEUE);
        assert_eq!(queue.search(2, 1, tx, from(2), 0.0), Searched::Queued);
        queue.form(&mut host, 0.0);
        let (ta, tb) = (found(&mut a).unwrap(), found(&mut b).unwrap());
        queue.cancelled(&Cancelled { stayed: vec![tb], stalled: vec![ta] }, 12.0);
        let try_search = |queue: &mut Matchmaker, id: PlayerId, from: SearchFrom, now: f64| {
            let (tx, _rx) = channel(OUT_QUEUE);
            let searched = queue.search(id, 1, tx, from, now);
            queue.cancel(id);
            searched
        };
        assert_eq!(try_search(&mut queue, 10, from(1), 20.0), Searched::Cooldown { seconds: 112 });
        assert_eq!(try_search(&mut queue, 11, SearchFrom { key: 777, ..from(1) }, 20.0), Searched::Cooldown { seconds: 112 }, "a new key, the same address");
        assert_eq!(try_search(&mut queue, 12, SearchFrom { address: [192, 168, 0, 9].into(), ..from(1) }, 20.0), Searched::Cooldown { seconds: 112 }, "the same key elsewhere");
        assert_eq!(try_search(&mut queue, 13, from(3), 20.0), Searched::Queued, "someone else");
        assert_eq!(try_search(&mut queue, 14, from(2), 20.0), Searched::Queued, "who claimed");
        assert_eq!(try_search(&mut queue, 15, from(1), 131.9), Searched::Cooldown { seconds: 1 });
        assert_eq!(try_search(&mut queue, 16, from(1), 132.1), Searched::Queued, "two minutes on");
    }
}
