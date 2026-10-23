//! The queue: who plays together. A search names a playlist; each playlist's searchers wait in arrival order, and as soon
//! as a full match's worth are waiting (two teams of its size: full start, no backfill or bots) the queue asks the host
//! for a match (`MatchHosting::create_match`) and hands each searcher their slot's token (`MatchFound`); their search
//! sessions end there. Nothing else about matches is the queue's (notes/matchmaking.md, v1 queue checklist; no ranks,
//! parties or regions in v1). A match cancelled before its start (`Cancelled`: someone didn't claim their slot, or left
//! before the start) puts the players who claimed back at the front, in their first search's order, and whoever stalled
//! it can't search for `NO_SHOW_COOLDOWN`, by their browser's key (RV-367, the user's decision: one person can't keep
//! stalling matches; leaving a started match isn't penalized). Their address (an IPv4 address, an IPv6 /64) is blocked
//! too only after `ADDRESS_STALLS` different browser keys stalled from it within `STALL_WINDOW`, or at once for a search
//! that sent no key (RV-385, RV-407: either is often shared, by a carrier's NAT, a dorm, a household, public Wi-Fi), so a
//! new key doesn't dodge it and one staller doesn't block their neighbours.
//!
//! Ranked pairing (ours: the game's matchmaker is PsyNet's, unknowable; notes/matchmaking.md): each search carries its
//! account's rating in the playlist (its ticket's). The oldest searcher anchors a match of searchers whose ratings are
//! within a window of theirs (`rating_window`: ±100, wider by 50 every 10 s either has waited, ±600 at most, then anyone),
//! the rest in their order; the teams split by a snake draft on rating, for even averages.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::net::IpAddr;

use tokio::sync::mpsc::Sender;

use crate::game::{Outgoing, PlayerId};
use crate::match_host::{Cancelled, MatchHosting, Playlist, RESERVATION_SECONDS};
use crate::protocol::{self, Control};

/// How long a browser or address that stalled a match can't search (s)
pub const NO_SHOW_COOLDOWN: f64 = 120.0;
/// How long a cancelled match's claimed token puts its player back at the front (s: the client searches again at once)
const RETURN_SECONDS: f64 = 60.0;
/// An IPv4 address is blocked after this many different browser keys stalled from it within `STALL_WINDOW` (s)
const ADDRESS_STALLS: usize = 2;
const STALL_WINDOW: f64 = 600.0;
/// A slot given up for a match found in another region (`Cancelled::declined`) isn't a no-show once per this many
/// seconds per account (an address without one); a second within it is (notes/matchmaking.md, Regions: the race of two
/// regions matching at once is rare, and a decline comes before anything about its match is known)
pub const DECLINE_WINDOW: f64 = 600.0;
/// The addresses whose recent stalls are kept, at most (the one whose last stall is oldest let go first: memory stays
/// bounded, RV-407. Filling it to let a staller's record go takes ~100k addresses stalling within the window, RV-428)
const MAX_STALL_ADDRESSES: usize = 100_000;

/// Who a search is from: its address (`net::address_key`), its key (an account's; 0: none), the token of the slot it
/// claimed in a match cancelled for someone else (0: none), and its rating in the playlist (`DEFAULT_RATING` unknown)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchFrom {
    pub address: IpAddr,
    pub key: u64,
    pub token: u64,
    pub rating: u16,
}

/// A rating unknown (a search without a ticket: a development server's): a new account's
pub const DEFAULT_RATING: u16 = 1500;

/// A search's rating in its playlist: its ticket's for that team size (1v1, 2v2, 3v3), else a new account's
pub fn search_rating(ratings: Option<&[u16; 3]>, team_size: u8) -> u16 {
    ratings.and_then(|r| r.get(usize::from(team_size.max(1)) - 1).copied()).unwrap_or(DEFAULT_RATING)
}

/// The ratings a searcher who has waited `waited` seconds is matched within (±): 100, wider by 50 every 10 s, 600 at most;
/// past that (100 s), anyone
pub fn rating_window(waited: f64) -> f64 {
    let steps = (waited.max(0.0) / 10.0).floor();
    if steps >= 10.0 { f64::INFINITY } else { (100.0 + 50.0 * steps).min(600.0) }
}

/// A match's seats in the host's order (teams alternating: blue, orange, ...) for these searchers, by a snake draft on
/// their ratings (the best to blue, the next two to orange, the next two to blue, ...): their indices
pub fn snake_seats(ratings: &[u16]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..ratings.len()).collect();
    order.sort_by(|&a, &b| ratings[b].cmp(&ratings[a]).then(a.cmp(&b)));
    let (mut blue, mut orange) = (Vec::new(), Vec::new());
    for (pick, &i) in order.iter().enumerate() {
        // (picks 0, 3, 4, 7, 8, ... blue; 1, 2, 5, 6, ... orange)
        if (pick + 1) % 4 < 2 { blue.push(i) } else { orange.push(i) }
    }
    blue.iter().zip(&orange).flat_map(|(&b, &o)| [b, o]).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Searched {
    Queued,
    /// No playlist has the team size
    NoPlaylist,
    /// Its browser (`network` false) or its address (true: maybe a neighbour's doing) stalled a match: it may search again
    /// in this many seconds
    Cooldown {
        seconds: u16,
        network: bool,
    },
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
    /// A cancelled match's claimed tokens: their playlist, first search's time, until when they're good, and the key that
    /// searched (another key's search can't use it: AP2-2)
    returning: HashMap<u64, (u8, f64, f64, u64)>,
    /// Who stalled a match: until when they can't search
    cooldowns: HashMap<Who, f64>,
    /// Who gave up a slot for another region's match without a no-show, and when (once per `DECLINE_WINDOW`)
    declines: HashMap<Who, f64>,
    /// Each address's recent stalls (an IPv6 one by its /64): the browser keys and when
    stalls: HashMap<IpAddr, Vec<(u64, f64)>>,
    /// Every stall within the window in the order they came (times never go back), so the oldest address is found
    /// without a scan when the records are full (RV-428: a scan of 100k took milliseconds on the game thread). An entry
    /// whose address stalled again since, or was let go, is passed over
    stall_order: VecDeque<(IpAddr, f64)>,
    /// The most addresses whose stalls are kept (`MAX_STALL_ADDRESSES`)
    stall_cap: usize,
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
            declines: HashMap::new(),
            stalls: HashMap::new(),
            stall_order: VecDeque::new(),
            stall_cap: MAX_STALL_ADDRESSES,
            tidied: 0.0,
        }
    }

    /// Until when the search can't search, if it can't now, and whether only its address is why (not its browser)
    fn cooling(&self, from: &SearchFrom, now: f64) -> Option<(f64, bool)> {
        let until = |who: Who| self.cooldowns.get(&who).copied().filter(|&until| until > now);
        let key = if from.key != 0 { until(Who::Key(from.key)) } else { None };
        match (key, until(Who::Address(from.address))) {
            (Some(k), a) => Some((a.map_or(k, |a| a.max(k)), false)),
            (None, Some(a)) => Some((a, true)),
            (None, None) => None,
        }
    }

    fn refusal(until: f64, network: bool, now: f64) -> Searched {
        Searched::Cooldown { seconds: (until - now).ceil().clamp(1.0, f64::from(u16::MAX)) as u16, network }
    }

    /// A search of the playlist with this team size at `now` (s). A session searches once: a second search from it is
    /// ignored. A new search from a browser key already waiting replaces that key's waiting search (its session let go).
    /// A cancelled match's claimed token (`from.token`) puts it back at the front, in its first search's order
    pub fn search(
        &mut self,
        id: PlayerId,
        team_size: u8,
        out: Sender<Outgoing>,
        from: SearchFrom,
        now: f64,
    ) -> Searched {
        if !self.waiting.contains_key(&team_size) {
            return Searched::NoPlaylist;
        }
        if let Some((until, network)) = self.cooling(&from, now) {
            return Self::refusal(until, network, now);
        }
        if self.searching.contains_key(&id) {
            return Searched::Queued;
        }
        // (a page that went (another map, a reload) and searches again from its new page: its old search, if the old
        // session's close isn't here yet, can't be matched to the new one or leave a ghost for others to match, RV-443)
        if from.key != 0 {
            let old: Vec<PlayerId> =
                self.waiting.values().flatten().filter(|s| s.from.key == from.key).map(|s| s.id).collect();
            for old in old {
                // (its tab told why before its session's let go: the queue's drop flushes what it sent, RV-460)
                if let Some(searcher) = self.waiting.values().flatten().find(|s| s.id == old) {
                    let _ = searcher
                        .out
                        .try_send(Outgoing::Control(Control::Kicked { reason: protocol::KICK_REPLACED }.encode()));
                }
                self.cancel(old);
            }
        }
        let back = (from.token != 0)
            .then(|| self.returning.get(&from.token).copied())
            .flatten()
            .filter(|&(size, _, until, key)| size == team_size && until > now && key == from.key)
            .map(|(_, since, _, _)| since);
        if back.is_some() {
            self.returning.remove(&from.token);
        }
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
    /// can't search for a while (`NO_SHOW_COOLDOWN`: their browser key; their address as the module says), and their other
    /// searches waiting now are let go with the refusal (RV-386: a staller's other sessions can't stall more matches). A
    /// slot declined for another region's match is no stall once per `DECLINE_WINDOW`, then one
    pub fn cancelled(&mut self, cancelled: &Cancelled, now: f64) {
        let mut stalled = cancelled.stalled.clone();
        for token in &cancelled.declined {
            let Some(h) = self.handed.get(token) else { continue };
            let who = if h.from.key != 0 { Who::Key(h.from.key) } else { Who::Address(h.from.address) };
            if self.declines.get(&who).is_some_and(|&at| now - at < DECLINE_WINDOW) {
                stalled.push(*token); // (a second within the window: a stall, as any)
            } else {
                self.declines.insert(who, now);
                self.handed.remove(token);
                eprintln!("a match's slot given up for another region's match: no no-show counted");
            }
        }
        for token in &stalled {
            if let Some(h) = self.handed.remove(token) {
                let until = now + NO_SHOW_COOLDOWN;
                if h.from.key != 0 {
                    self.cooldowns.insert(Who::Key(h.from.key), until);
                }
                let address = h.from.key == 0 || self.address_stalled(h.from.address, h.from.key, now);
                if address {
                    self.cooldowns.insert(Who::Address(h.from.address), until);
                }
                eprintln!(
                    "a match stalled by a no-show: their browser{} can't search for {NO_SHOW_COOLDOWN} s",
                    if address { " and address" } else { "" }
                );
            }
        }
        // (the searches waiting now that the new cooldowns cover: let go, told why)
        let mut refused = Vec::new();
        for queue in self.waiting.values_mut() {
            let mut i = 0;
            while i < queue.len() {
                let from = queue[i].from;
                let key = if from.key != 0 {
                    self.cooldowns.get(&Who::Key(from.key)).copied().filter(|&u| u > now)
                } else {
                    None
                };
                let address = self.cooldowns.get(&Who::Address(from.address)).copied().filter(|&u| u > now);
                match (key, address) {
                    (None, None) => i += 1,
                    (k, a) => {
                        let until = k.into_iter().chain(a).fold(now, f64::max);
                        let searcher = queue.remove(i).expect("in range");
                        refused.push((searcher, until, k.is_none()));
                    }
                }
            }
        }
        for (searcher, until, network) in refused {
            self.searching.remove(&searcher.id);
            if let Searched::Cooldown { seconds, network } = Self::refusal(until, network, now) {
                let _ = searcher.out.try_send(Outgoing::Control(Control::SearchCooldown { seconds, network }.encode()));
            }
        }
        for token in &cancelled.stayed {
            if let Some(h) = self.handed.remove(token) {
                self.returning.insert(*token, (h.team_size, h.since, now + RETURN_SECONDS, h.from.key));
            }
        }
    }

    /// Notes a stall from the address by the browser key at `now`; whether the address is now blocked too (`ADDRESS_STALLS`
    /// different keys within `STALL_WINDOW`). The records full, the address whose last stall is oldest is let go first
    fn address_stalled(&mut self, address: IpAddr, key: u64, now: f64) -> bool {
        if !self.stalls.contains_key(&address) {
            while self.stalls.len() >= self.stall_cap
                && let Some((oldest, at)) = self.stall_order.pop_front()
            {
                // (an address's latest stall alone stands for it)
                if self.stalls.get(&oldest).and_then(|s| s.last()).is_some_and(|&(_, last)| last == at) {
                    self.stalls.remove(&oldest);
                }
            }
        }
        let stalls = self.stalls.entry(address).or_default();
        stalls.retain(|&(_, at)| now - at < STALL_WINDOW);
        stalls.push((key, now));
        self.stall_order.push_back((address, now));
        let mut keys: Vec<u64> = stalls.iter().map(|&(k, _)| k).collect();
        keys.sort_unstable();
        keys.dedup();
        keys.len() >= ADDRESS_STALLS
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
        self.declines.retain(|_, at| now - *at < DECLINE_WINDOW);
        self.stalls.retain(|_, stalls| {
            stalls.retain(|&(_, at)| now - at < STALL_WINDOW);
            !stalls.is_empty()
        });
        while self.stall_order.front().is_some_and(|&(_, at)| now - at >= STALL_WINDOW) {
            self.stall_order.pop_front();
        }
    }

    /// The searcher's session ended (cancelled, or the connection lost)
    /// An account reported as a quitter: its searches waiting let go, their sessions handed back to be refused, each
    /// with when it began (the seats it gave up given back: RX31, RX33)
    pub fn drop_account(&mut self, key: u64) -> Vec<(Sender<Outgoing>, f64)> {
        let mut dropped = Vec::new();
        if key == 0 {
            return dropped;
        }
        for queue in self.waiting.values_mut() {
            queue.retain(|s| {
                let keep = s.from.key != key;
                if !keep {
                    self.searching.remove(&s.id);
                    dropped.push((s.out.clone(), s.since));
                }
                keep
            });
        }
        dropped
    }

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

    /// Every match the waiting searchers fill: each oldest searcher in turn with those within the rating window (theirs
    /// or the other's, whoever has waited longer), in queue order; the teams by a snake draft; each one's token sent,
    /// their sessions let go. (A searcher whose session already ended, its cancel not yet here, doesn't count)
    pub fn form(&mut self, host: &mut impl MatchHosting, now: f64) {
        self.tidy(now);
        for (&team_size, queue) in &mut self.waiting {
            // (only a playlist with a match's worth waiting is looked at: the loop runs every millisecond, RV-357)
            let players = 2 * usize::from(team_size);
            if queue.len() < players {
                continue;
            }
            queue.retain(|s| !s.out.is_closed());
            let mut anchor = 0;
            while queue.len() >= players && anchor + players <= queue.len() {
                let a = &queue[anchor];
                let within = |s: &Searcher| {
                    let window = rating_window(now - a.since).max(rating_window(now - s.since));
                    (f64::from(s.from.rating) - f64::from(a.from.rating)).abs() <= window
                };
                let picked: Vec<usize> = std::iter::once(anchor)
                    .chain((anchor + 1..queue.len()).filter(|&i| within(&queue[i])))
                    .take(players)
                    .collect();
                if picked.len() < players {
                    anchor += 1; // (not enough near this one yet: the next oldest may make a match)
                    continue;
                }
                let mut found: Vec<Searcher> = Vec::with_capacity(players);
                for &i in picked.iter().rev() {
                    found.push(queue.remove(i).expect("in range"));
                }
                found.reverse();
                let seats = snake_seats(&found.iter().map(|s| s.from.rating).collect::<Vec<_>>());
                let mut found: Vec<Option<Searcher>> = found.into_iter().map(Some).collect();
                let found: Vec<Searcher> = seats.iter().filter_map(|&i| found[i].take()).collect();
                let keys: Vec<u64> = found.iter().map(|s| s.from.key).collect();
                let created = host.create_match(self.playlists[&team_size], &keys, now);
                for (searcher, token) in found.into_iter().zip(created.tokens) {
                    self.searching.remove(&searcher.id);
                    // (kept past the reservation's end: a cancel's report comes with the tick after it)
                    self.handed.insert(
                        token,
                        Handed {
                            team_size,
                            from: searcher.from,
                            since: searcher.since,
                            until: now + RESERVATION_SECONDS + 30.0,
                        },
                    );
                    let _ = searcher
                        .out
                        .try_send(Outgoing::Control(Control::MatchFound { token, map: created.map }.encode()));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{MatchType, OUT_QUEUE};
    use crate::match_host::Created;
    use tokio::sync::mpsc::{Receiver, channel};

    /// A host that records what it was asked and gives numbered tokens
    #[derive(Default)]
    struct Recorder {
        asked: Vec<(u8, usize)>,
        next: u64,
    }

    impl MatchHosting for Recorder {
        fn create_match(&mut self, playlist: Playlist, keys: &[u64], _now: f64) -> Created {
            let players = keys.len();
            self.asked.push((playlist.team_size, players));
            let tokens = (0..players)
                .map(|_| {
                    self.next += 1;
                    self.next
                })
                .collect();
            // (every match on Night, the one map)
            Created { tokens, map: crate::protocol::NIGHT_MAP }
        }
    }

    fn playlists() -> Vec<Playlist> {
        [1, 2, 3]
            .map(|team_size| Playlist { team_size, match_type: MatchType::Casual, forfeit_vote_wait: None })
            .to_vec()
    }

    /// A searcher's address and browser key (by id), no returning token
    fn from(id: PlayerId) -> SearchFrom {
        SearchFrom { address: [10, 0, 0, id as u8].into(), key: 1000 + id, token: 0, rating: DEFAULT_RATING }
    }

    fn queued(queue: &mut Matchmaker, id: PlayerId, team_size: u8, out: Sender<Outgoing>) -> bool {
        queue.search(id, team_size, out, from(id), 0.0) == Searched::Queued
    }

    fn found(rx: &mut Receiver<Outgoing>) -> Option<u64> {
        while let Ok(Outgoing::Control(bytes)) = rx.try_recv() {
            if let Ok(Control::MatchFound { token, .. }) = Control::decode(&bytes[2..]) {
                return Some(token);
            }
        }
        None
    }

    /// AP3, RX31: a returning searcher at the front keeps its own first search's time; paired with an older searcher behind
    /// it, the wider window of the two counts (the older one's), not the front one's alone
    #[test]
    fn the_wider_window_of_the_two_counts_when_a_returning_searcher_is_in_front() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let (tx, mut far) = channel(OUT_QUEUE);
        assert_eq!(queue.search(3, 1, tx, SearchFrom { rating: 1500, ..from(3) }, 0.0), Searched::Queued);
        let mut rxs = Vec::new();
        for id in 1..=2 {
            let (tx, rx) = channel(OUT_QUEUE);
            assert_eq!(queue.search(id, 1, tx, SearchFrom { rating: 1000, ..from(id) }, 50.0), Searched::Queued);
            rxs.push(rx);
        }
        queue.form(&mut host, 50.0);
        let tokens: Vec<u64> = rxs.iter_mut().map(|rx| found(rx).unwrap()).collect();
        assert!(found(&mut far).is_none(), "500 apart, its window 350: not yet");
        // (player 1 back at the front, its first search's time kept: 50 s)
        queue.cancelled(&Cancelled { stayed: vec![tokens[0]], stalled: vec![tokens[1]], ..Default::default() }, 55.0);
        let (tx, mut back) = channel(OUT_QUEUE);
        let returning = SearchFrom { token: tokens[0], rating: 1000, ..from(1) };
        assert_eq!(queue.search(1, 1, tx, returning, 56.0), Searched::Queued);
        assert_eq!(queue.waiting[&1].front().map(|s| s.id), Some(1));
        // (at 80 s: the front one's window 250, the older one's 500; 500 apart, so the older one's makes the match)
        queue.form(&mut host, 80.0);
        assert!(found(&mut back).is_some() && found(&mut far).is_some());
    }

    /// RX31: an account reported as a quitter has its waiting searches let go (refused by the caller), the others kept
    #[test]
    fn a_reported_quitters_waiting_search_is_let_go() {
        let mut queue = Matchmaker::new(&playlists());
        let (tx, _rx) = channel(8);
        assert!(queued(&mut queue, 1, 2, tx.clone()));
        assert!(queued(&mut queue, 2, 2, tx.clone()));
        assert_eq!(queue.drop_account(1000 + 1).len(), 1);
        assert_eq!(queue.searching(2), 1, "the other search kept");
        assert!(!queue.searching.contains_key(&1) && queue.searching.contains_key(&2), "its index gone too (RX32)");
        assert!(queue.drop_account(0).is_empty(), "no account: nothing");
        assert!(queue.drop_account(1000 + 1).is_empty(), "let go already");
        assert!(queued(&mut queue, 1, 2, tx), "searching again is the gate's to refuse, not the queue's");
    }

    #[test]
    fn a_search_is_paired_by_its_playlists_rating() {
        let ratings = [1100, 1200, 1300];
        assert_eq!([1, 2, 3].map(|size| search_rating(Some(&ratings), size)), [1100, 1200, 1300]);
        assert_eq!(search_rating(None, 2), DEFAULT_RATING, "no ticket: a new account's");
    }

    #[test]
    fn the_rating_window_widens_with_the_wait_then_takes_anyone() {
        assert_eq!(rating_window(0.0), 100.0);
        assert_eq!(rating_window(9.9), 100.0);
        assert_eq!(rating_window(10.0), 150.0);
        assert_eq!(rating_window(95.0), 550.0);
        assert_eq!(rating_window(100.0), f64::INFINITY);
        // (the snake draft: by rating, the best and the 4th and 5th blue, the 2nd, 3rd and 6th orange; seats alternate)
        assert_eq!(snake_seats(&[1500, 1800, 1600, 1700]), vec![1, 3, 0, 2]);
        assert_eq!(snake_seats(&[1000, 1100, 1200, 1300, 1400, 1500]), vec![5, 4, 2, 3, 1, 0]);
        // (each team's mean as close as the draft gets: 1800+1500 and 1700+1600)
        let r = [1500u16, 1800, 1600, 1700];
        let seats = snake_seats(&r);
        let blue: u32 = seats.iter().step_by(2).map(|&i| u32::from(r[i])).sum();
        let orange: u32 = seats.iter().skip(1).step_by(2).map(|&i| u32::from(r[i])).sum();
        assert_eq!((blue, orange), (3300, 3300));
    }

    #[test]
    fn searchers_far_apart_wait_until_their_windows_meet_others_near_pair_at_once() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let search = |queue: &mut Matchmaker, id: PlayerId, rating: u16, at: f64| {
            let (tx, rx) = channel(OUT_QUEUE);
            assert_eq!(queue.search(id, 1, tx, SearchFrom { rating, ..from(id) }, at), Searched::Queued);
            rx
        };
        let mut low = search(&mut queue, 1, 1000, 0.0);
        let mut high = search(&mut queue, 2, 1700, 0.0);
        queue.form(&mut host, 0.0);
        assert!(host.asked.is_empty(), "700 apart: no match yet");
        // (a searcher near the high one: paired at once, the low one still waiting, its place kept)
        let mut near = search(&mut queue, 3, 1650, 1.0);
        queue.form(&mut host, 1.0);
        assert_eq!(host.asked, vec![(1, 2)]);
        assert!(found(&mut high).is_some() && found(&mut near).is_some() && found(&mut low).is_none());
        // (another far one: 600 apart pairs once either has waited 100 s, anyone after)
        let mut far = search(&mut queue, 4, 1600, 2.0);
        queue.form(&mut host, 50.0);
        assert_eq!(host.asked.len(), 1, "600 apart at 50 s: not yet");
        queue.form(&mut host, 100.0);
        assert_eq!(host.asked.len(), 2);
        assert!(found(&mut low).is_some() && found(&mut far).is_some());
    }

    #[test]
    fn a_returning_token_is_its_own_accounts_alone() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let mut rxs = Vec::new();
        for id in 1..=2 {
            let (tx, rx) = channel(OUT_QUEUE);
            assert!(queued(&mut queue, id, 1, tx));
            rxs.push(rx);
        }
        queue.form(&mut host, 0.0);
        let tokens: Vec<u64> = rxs.iter_mut().map(|rx| found(rx).unwrap()).collect();
        // (the match cancelled for player 2's stall: player 1's token returns them to the front)
        queue.cancelled(&Cancelled { stayed: vec![tokens[0]], stalled: vec![tokens[1]], ..Default::default() }, 13.0);
        // (another account's search with it: an ordinary search, at the back; the token still the owner's)
        let (tx, _rx) = channel(OUT_QUEUE);
        assert_eq!(queue.search(7, 1, tx, SearchFrom { token: tokens[0], ..from(7) }, 14.0), Searched::Queued);
        assert!(queue.returning.contains_key(&tokens[0]), "not spent by another account");
        let (tx, _rx) = channel(OUT_QUEUE);
        assert_eq!(queue.search(1, 1, tx, SearchFrom { token: tokens[0], ..from(1) }, 15.0), Searched::Queued);
        assert!(!queue.returning.contains_key(&tokens[0]), "its owner's: back at the front");
        assert_eq!(queue.waiting[&1].front().map(|s| s.id), Some(1));
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
        // (a token each, seated by the snake draft: equal ratings in search order, the 1st and 4th blue, the 2nd and 3rd
        // orange; the host's seats alternate blue, orange)
        assert_eq!(tokens, vec![1, 2, 4, 3], "a token each, seated by the draft");
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
    fn a_new_search_from_a_waiting_browser_key_replaces_its_old_one() {
        // (RV-443: a page that went searches again from its new page before its old session's close is here)
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let (old_tx, mut old_rx) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 1, 1, old_tx));
        let (new_tx, mut new_rx) = channel(OUT_QUEUE);
        assert_eq!(
            queue.search(2, 1, new_tx, SearchFrom { address: [10, 0, 0, 2].into(), ..from(1) }, 1.0),
            Searched::Queued
        );
        assert_eq!(queue.searching(1), 1, "one search for the browser");
        // (its tab told why first: another tab searching, RV-460)
        let mut told = Vec::new();
        while let Ok(Outgoing::Control(bytes)) = old_rx.try_recv() {
            if let Ok(c) = Control::decode(&bytes[2..]) {
                told.push(c);
            }
        }
        assert_eq!(told, [Control::Kicked { reason: protocol::KICK_REPLACED }]);
        assert!(old_rx.is_closed(), "the old session let go");
        queue.form(&mut host, 1.0);
        assert!(host.asked.is_empty(), "not matched with itself");
        // (another browser: the 1v1 is the new search's and the other's; the old session's end changes nothing)
        let (tx, mut rx) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 3, 1, tx));
        queue.cancel(1);
        queue.form(&mut host, 1.0);
        assert_eq!(host.asked, vec![(1, 2)]);
        assert_eq!((found(&mut new_rx), found(&mut rx)), (Some(1), Some(2)));
        // (and a search without a key replaces nothing)
        let (tx_a, _rx_a) = channel(OUT_QUEUE);
        let (tx_b, _rx_b) = channel(OUT_QUEUE);
        assert_eq!(queue.search(4, 2, tx_a, SearchFrom { key: 0, ..from(4) }, 1.0), Searched::Queued);
        assert_eq!(queue.search(5, 2, tx_b, SearchFrom { key: 0, ..from(5) }, 1.0), Searched::Queued);
        assert_eq!(queue.searching(2), 2);
    }

    #[test]
    fn a_browser_keys_new_search_replaces_its_waiting_one_in_another_playlist_too() {
        // (RV-461: one search a key, whatever its playlist: the 1v1's let go for the 2v2's)
        let mut queue = Matchmaker::new(&playlists());
        let (tx1, mut rx1) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 1, 1, tx1));
        let (tx2, _rx2) = channel(OUT_QUEUE);
        assert_eq!(queue.search(2, 2, tx2, from(1), 1.0), Searched::Queued);
        assert_eq!((queue.searching(1), queue.searching(2)), (0, 1));
        assert!(
            matches!(rx1.try_recv(), Ok(Outgoing::Control(bytes)) if matches!(Control::decode(&bytes[2..]), Ok(Control::Kicked { reason: protocol::KICK_REPLACED })))
        );
        assert!(rx1.is_closed());
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
        queue.cancelled(&Cancelled { stayed: vec![tb], stalled: vec![ta], ..Default::default() }, 13.0);
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
        queue.cancelled(
            &Cancelled { stayed: tokens[..3].to_vec(), stalled: vec![tokens[3]], ..Default::default() },
            16.0,
        );
        // They search again in another order: the queue has them in their first searches' (1, 2, 3), then 9
        let mut again = Vec::new();
        for id in [3, 1, 2] {
            let (tx, rx) = channel(OUT_QUEUE);
            assert_eq!(
                queue.search(id, 2, tx, SearchFrom { token: tokens[id as usize - 1], ..from(id) }, 17.0),
                Searched::Queued
            );
            again.push(rx);
        }
        let order: Vec<(PlayerId, f64)> = queue.waiting[&2].iter().map(|s| (s.id, s.since)).collect();
        assert_eq!(order, vec![(1, 1.0), (2, 2.0), (3, 3.0), (9, 5.0)]);
    }

    /// A 1v1 formed of `a` and `b` (searching now), cancelled with `stalled` not having claimed; the searchers' channels kept
    fn stall(
        queue: &mut Matchmaker,
        a: SearchFrom,
        b: SearchFrom,
        now: f64,
        a_stalls: bool,
    ) -> Vec<Receiver<Outgoing>> {
        let mut host = Recorder::default();
        let (ta, mut ra) = channel(OUT_QUEUE);
        assert_eq!(queue.search(901, 1, ta, a, now), Searched::Queued);
        let (tb, mut rb) = channel(OUT_QUEUE);
        assert_eq!(queue.search(902, 1, tb, b, now), Searched::Queued);
        queue.form(&mut host, now);
        let (ka, kb) = (found(&mut ra).unwrap(), found(&mut rb).unwrap());
        let (stayed, stalled) = if a_stalls { (kb, ka) } else { (ka, kb) };
        queue.cancelled(&Cancelled { stayed: vec![stayed], stalled: vec![stalled], ..Default::default() }, now + 12.0);
        vec![ra, rb]
    }

    fn try_search(queue: &mut Matchmaker, id: PlayerId, from: SearchFrom, now: f64) -> Searched {
        let (tx, _rx) = channel(OUT_QUEUE);
        let searched = queue.search(id, 1, tx, from, now);
        queue.cancel(id);
        searched
    }

    /// A match found for `a` and `b` at `now`, then cancelled for `a`'s decline (another region's match found at the same
    /// moment): `b`'s token (back to the front)
    fn declined(queue: &mut Matchmaker, a: SearchFrom, b: SearchFrom, now: f64) -> u64 {
        let mut host = Recorder::default();
        let (ta, mut ra) = channel(OUT_QUEUE);
        assert_eq!(queue.search(901, 1, ta, a, now), Searched::Queued);
        let (tb, mut rb) = channel(OUT_QUEUE);
        assert_eq!(queue.search(902, 1, tb, b, now), Searched::Queued);
        queue.form(&mut host, now);
        let (ka, kb) = (found(&mut ra).unwrap(), found(&mut rb).unwrap());
        queue.cancelled(&Cancelled { stayed: vec![kb], declined: vec![ka], ..Default::default() }, now + 1.0);
        kb
    }

    #[test]
    fn a_slot_declined_for_another_regions_match_is_no_stall_once_per_ten_minutes() {
        // (notes/matchmaking.md, Regions: two regions matched one searcher at the same moment; the second given up)
        let mut queue = Matchmaker::new(&playlists());
        let kept = declined(&mut queue, from(1), from(2), 0.0);
        assert_eq!(try_search(&mut queue, 10, from(1), 2.0), Searched::Queued, "the decliner searches at once");
        assert!(queue.returning.contains_key(&kept), "the other back to the front");
        assert!(queue.handed.is_empty());
        // (a second within ten minutes: a stall, its cooldown; its address not blocked for one key's stall)
        declined(&mut queue, from(1), from(3), 300.0);
        assert_eq!(try_search(&mut queue, 11, from(1), 302.0), Searched::Cooldown { seconds: 119, network: false });
        assert_eq!(try_search(&mut queue, 12, from(4), 302.0), Searched::Queued, "someone else");
        // (ten minutes after the free one: free again)
        declined(&mut queue, from(1), from(5), 601.0);
        assert_eq!(try_search(&mut queue, 13, from(1), 603.0), Searched::Queued, "a new window");
        // (without a key, by its address)
        let keyless = SearchFrom { key: 0, ..from(6) };
        declined(&mut queue, keyless, from(7), 700.0);
        assert_eq!(try_search(&mut queue, 14, keyless, 702.0), Searched::Queued);
        declined(&mut queue, keyless, from(8), 710.0);
        assert_eq!(try_search(&mut queue, 15, keyless, 712.0), Searched::Cooldown { seconds: 119, network: true });
        // (expired, they're let go)
        let mut host = Recorder::default();
        queue.form(&mut host, 2000.0);
        assert!(queue.declines.is_empty());
    }

    #[test]
    fn a_found_match_tells_each_of_its_players_its_map() {
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let (tx1, mut rx1) = channel(OUT_QUEUE);
        let (tx2, mut rx2) = channel(OUT_QUEUE);
        assert!(queued(&mut queue, 1, 1, tx1) && queued(&mut queue, 2, 1, tx2));
        queue.form(&mut host, 0.0);
        let map_of = |rx: &mut Receiver<Outgoing>| match rx.try_recv() {
            Ok(Outgoing::Control(bytes)) => match Control::decode(&bytes[2..]) {
                Ok(Control::MatchFound { map, .. }) => Some(map),
                _ => None,
            },
            _ => None,
        };
        // (Night, the one map)
        let night = Some(crate::protocol::NIGHT_MAP);
        assert_eq!((map_of(&mut rx1), map_of(&mut rx2)), (night, night));
    }

    #[test]
    fn a_staller_cant_search_for_two_minutes_by_their_browser_key_not_their_neighbours() {
        // (RV-367, RV-385: one staller behind a shared IPv4 address blocks their key alone)
        let mut queue = Matchmaker::new(&playlists());
        let _kept = stall(&mut queue, from(1), from(2), 0.0, true);
        assert_eq!(try_search(&mut queue, 10, from(1), 20.0), Searched::Cooldown { seconds: 112, network: false });
        assert_eq!(
            try_search(&mut queue, 11, SearchFrom { address: [192, 168, 0, 9].into(), ..from(1) }, 20.0),
            Searched::Cooldown { seconds: 112, network: false },
            "the same key elsewhere"
        );
        assert_eq!(
            try_search(&mut queue, 12, SearchFrom { key: 777, ..from(1) }, 20.0),
            Searched::Queued,
            "a neighbour (another key, the address)"
        );
        assert_eq!(try_search(&mut queue, 13, from(2), 20.0), Searched::Queued, "who claimed");
        assert_eq!(try_search(&mut queue, 15, from(1), 131.9), Searched::Cooldown { seconds: 1, network: false });
        assert_eq!(try_search(&mut queue, 16, from(1), 132.1), Searched::Queued, "two minutes on");
        // Expired, they're let go (RX14's N19)
        let mut host = Recorder::default();
        queue.form(&mut host, 200.0);
        assert!(queue.cooldowns.is_empty() && queue.handed.is_empty() && queue.returning.is_empty());
    }

    #[test]
    fn an_address_is_blocked_after_two_browser_keys_stall_from_it_or_a_keyless_one_or_its_ipv6_64() {
        // (RV-385: a new key doesn't dodge it: the second stall from the address blocks it, for everyone there, told it's
        // the network's)
        let mut queue = Matchmaker::new(&playlists());
        let _a = stall(&mut queue, from(1), from(2), 0.0, true);
        let _b = stall(&mut queue, SearchFrom { key: 555, ..from(1) }, from(3), 100.0, true);
        assert_eq!(
            try_search(&mut queue, 20, SearchFrom { key: 556, ..from(1) }, 120.0),
            Searched::Cooldown { seconds: 112, network: true }
        );
        assert_eq!(
            try_search(&mut queue, 21, SearchFrom { key: 555, ..from(1) }, 120.0),
            Searched::Cooldown { seconds: 112, network: false },
            "the staller: their key's"
        );
        // Ten minutes apart, two keys don't add up
        let mut queue = Matchmaker::new(&playlists());
        let _a = stall(&mut queue, from(1), from(2), 0.0, true);
        let _b = stall(&mut queue, SearchFrom { key: 555, ..from(1) }, from(3), 700.0, true);
        assert_eq!(try_search(&mut queue, 22, SearchFrom { key: 556, ..from(1) }, 720.0), Searched::Queued);
        // No key: the address at once
        let mut queue = Matchmaker::new(&playlists());
        let _c = stall(&mut queue, SearchFrom { key: 0, ..from(1) }, from(2), 0.0, true);
        assert_eq!(
            try_search(&mut queue, 23, SearchFrom { key: 556, ..from(1) }, 20.0),
            Searched::Cooldown { seconds: 112, network: true }
        );
        // An IPv6 /64 the same: one staller doesn't block their neighbours, a second key does (RV-407)
        let mut queue = Matchmaker::new(&playlists());
        let six = SearchFrom { address: "2001:db8:1:2::".parse().unwrap(), ..from(1) };
        let _d = stall(&mut queue, six, from(2), 0.0, true);
        assert_eq!(try_search(&mut queue, 24, SearchFrom { key: 556, ..six }, 20.0), Searched::Queued);
        let _e = stall(&mut queue, SearchFrom { key: 557, ..six }, from(3), 30.0, true);
        assert_eq!(
            try_search(&mut queue, 25, SearchFrom { key: 556, ..six }, 50.0),
            Searched::Cooldown { seconds: 112, network: true }
        );
        // One key stalling twice is still one key (RX15's C4)
        let mut queue = Matchmaker::new(&playlists());
        let _f = stall(&mut queue, from(1), from(2), 0.0, true);
        let _g = stall(&mut queue, from(1), from(3), 140.0, true);
        assert_eq!(try_search(&mut queue, 26, SearchFrom { key: 556, ..from(1) }, 160.0), Searched::Queued);
        // Their records let go after the window (RX15's C11)
        let mut host = Recorder::default();
        queue.form(&mut host, 900.0);
        assert!(queue.stalls.is_empty());
        assert!(queue.stall_order.is_empty());
    }

    #[test]
    fn the_stall_records_full_let_the_address_whose_last_stall_is_oldest_go() {
        // (RV-428, RX16's C20/C21: the cap kept, by the oldest address alone, found without a scan)
        let mut queue = Matchmaker::new(&playlists());
        queue.stall_cap = 3;
        let at = |i: u8| IpAddr::from([10, 0, 0, i]);
        for i in 1..=3 {
            assert!(!queue.address_stalled(at(i), u64::from(i), f64::from(i)));
        }
        // (the records full, 1, the oldest, stalls again under another key: its record kept, not let go to make room, so
        // it's blocked; RX17's C27. 2's last stall is the oldest now)
        assert!(queue.address_stalled(at(1), 7, 4.0));
        assert!(!queue.address_stalled(at(4), 4, 5.0));
        assert_eq!(queue.stalls.len(), 3);
        assert!(!queue.stalls.contains_key(&at(2)) && queue.stalls.contains_key(&at(1)));
        // 1's record stands: another key from it still blocks it
        assert!(queue.address_stalled(at(1), 9, 6.0));
        // 2 again, the records full: 3 goes (1's earlier entries are passed over), and 2 starts over with one key
        assert!(!queue.address_stalled(at(2), 8, 7.0));
        assert_eq!(queue.stalls.len(), 3);
        assert!(!queue.stalls.contains_key(&at(3)));
        assert!(!queue.address_stalled(at(5), 5, 8.0));
        assert!(!queue.stalls.contains_key(&at(4)), "4 next");
        // (the full records stay cheap: 100 new addresses into a 100k-address table, where a scan each took ~2.6 ms in a
        // release build, far more in this one)
        // (RX17's C21: the cap is 100k addresses, and the 100,001st lets exactly the first go)
        let mut queue = Matchmaker::new(&playlists());
        let address = |i: u32| IpAddr::from((0x0a00_0000 + i).to_be_bytes());
        for i in 0..100_000 {
            queue.address_stalled(address(i), 1, f64::from(i) * 0.001);
        }
        assert_eq!(queue.stalls.len(), 100_000);
        queue.address_stalled(address(100_000), 1, 150.0);
        assert_eq!(queue.stalls.len(), 100_000);
        assert!(
            !queue.stalls.contains_key(&address(0))
                && queue.stalls.contains_key(&address(1))
                && queue.stalls.contains_key(&address(100_000))
        );
        let t0 = std::time::Instant::now();
        for i in 0..100u32 {
            queue.address_stalled(IpAddr::from((0x0b00_0000 + i).to_be_bytes()), 1, 200.0);
        }
        assert_eq!(queue.stalls.len(), MAX_STALL_ADDRESSES);
        assert!(t0.elapsed() < std::time::Duration::from_millis(250), "{:?}", t0.elapsed());
    }

    #[test]
    fn a_refusal_shows_the_longer_wait_and_a_newly_blocked_addresss_waiting_searches_are_let_go() {
        // (RX15's C12: the browser's 2 minutes nearly over, the address's longer: the address's wait, still the browser's
        // words; C18: a third browser waiting at the address when the second stall blocks it is let go, told it's the
        // network's)
        let mut queue = Matchmaker::new(&playlists());
        let _a = stall(&mut queue, from(1), from(2), 0.0, true);
        let (tx, mut waiting) = channel(OUT_QUEUE);
        assert_eq!(queue.search(40, 2, tx, SearchFrom { key: 558, ..from(1) }, 50.0), Searched::Queued);
        let _b = stall(&mut queue, SearchFrom { key: 555, ..from(1) }, from(3), 88.0, true);
        let mut told = None;
        while let Ok(Outgoing::Control(bytes)) = waiting.try_recv() {
            if let Ok(Control::SearchCooldown { seconds, network }) = Control::decode(&bytes[2..]) {
                told = Some((seconds, network));
            }
        }
        assert_eq!(told, Some((120, true)));
        assert_eq!(try_search(&mut queue, 41, from(1), 110.0), Searched::Cooldown { seconds: 110, network: false });
    }

    #[test]
    fn a_stallers_other_waiting_searches_are_let_go_with_the_refusal() {
        // (RV-386: a browser whose 1v1 is forming searches the 2v2 from another tab (its waiting search, one a key: a
        // new one replaces it, RV-443); it stalls the 1v1: that search is never matched)
        let mut queue = Matchmaker::new(&playlists());
        let mut host = Recorder::default();
        let (ta, mut ra) = channel(OUT_QUEUE);
        let (tb, mut rb) = channel(OUT_QUEUE);
        assert_eq!(queue.search(901, 1, ta, from(1), 0.0), Searched::Queued);
        assert_eq!(queue.search(902, 1, tb, from(2), 0.0), Searched::Queued);
        queue.form(&mut host, 0.0);
        let (ka, kb) = (found(&mut ra).unwrap(), found(&mut rb).unwrap());
        let (tx, mut other) = channel(OUT_QUEUE);
        assert_eq!(queue.search(30, 2, tx, from(1), 1.0), Searched::Queued);
        assert_eq!(queue.searching(2), 1);
        queue.cancelled(&Cancelled { stayed: vec![kb], stalled: vec![ka], ..Default::default() }, 13.0);
        assert_eq!(queue.searching(2), 0);
        let mut refused = None;
        while let Ok(Outgoing::Control(bytes)) = other.try_recv() {
            if let Ok(Control::SearchCooldown { seconds, network }) = Control::decode(&bytes[2..]) {
                refused = Some((seconds, network));
            }
        }
        assert_eq!(refused, Some((120, false)));
        assert!(other.is_closed(), "its session let go");
    }
}
