//! The queue: who plays together. A search names a playlist; each playlist's searchers wait in arrival order, and as soon
//! as a full match's worth are waiting (two teams of its size: full start, no backfill or bots) the queue asks the host
//! for a match (`MatchHosting::create_match`) and hands each searcher their slot's token (`MatchFound`); their search
//! sessions end there. Nothing else about matches is the queue's (notes/matchmaking.md, v1 queue checklist; no ranks,
//! parties or regions in v1).

use std::collections::{BTreeMap, HashMap, VecDeque};

use tokio::sync::mpsc::Sender;

use crate::game::{Outgoing, PlayerId};
use crate::match_host::{MatchHosting, Playlist};
use crate::protocol::Control;

struct Searcher {
    id: PlayerId,
    out: Sender<Outgoing>,
}

pub struct Matchmaker {
    playlists: BTreeMap<u8, Playlist>,
    /// Each playlist's searchers (by team size), oldest first
    waiting: BTreeMap<u8, VecDeque<Searcher>>,
    /// The playlist each searcher is in
    searching: HashMap<PlayerId, u8>,
}

impl Matchmaker {
    /// The playlists searches may name (one per team size)
    pub fn new(playlists: &[Playlist]) -> Self {
        Self {
            playlists: playlists.iter().map(|p| (p.team_size, *p)).collect(),
            waiting: playlists.iter().map(|p| (p.team_size, VecDeque::new())).collect(),
            searching: HashMap::new(),
        }
    }

    /// A search of the playlist with this team size; false if there's no such playlist. A session searches once: a second
    /// search from it is ignored
    pub fn search(&mut self, id: PlayerId, team_size: u8, out: Sender<Outgoing>) -> bool {
        let Some(queue) = self.waiting.get_mut(&team_size) else { return false };
        if let std::collections::hash_map::Entry::Vacant(entry) = self.searching.entry(id) {
            entry.insert(team_size);
            queue.push_back(Searcher { id, out });
        }
        true
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
            assert!(queue.search(id, 2, tx));
            rxs.push(rx);
        }
        let (tx, mut solo) = channel(OUT_QUEUE);
        assert!(queue.search(9, 1, tx));
        queue.form(&mut host, 0.0);
        assert!(host.asked.is_empty(), "three of four for 2v2, one of two for 1v1");
        let (tx, rx) = channel(OUT_QUEUE);
        assert!(queue.search(4, 2, tx));
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
        assert!(queue.search(1, 1, tx1.clone()));
        assert!(queue.search(1, 1, tx1), "a second search from the session: ignored");
        assert_eq!(queue.searching(1), 1);
        let (tx, _rx) = channel(OUT_QUEUE);
        assert!(!queue.search(5, 4, tx), "no 4v4 playlist");
        let (tx2, rx2) = channel(OUT_QUEUE);
        assert!(queue.search(2, 1, tx2));
        queue.cancel(2);
        drop(rx2);
        let (tx3, rx3) = channel(OUT_QUEUE);
        assert!(queue.search(3, 1, tx3));
        drop(rx3); // (its session ended, the cancel not yet here)
        queue.form(&mut host, 0.0);
        assert!(host.asked.is_empty());
        assert_eq!(queue.searching(1), 1);
        let (tx4, mut rx4) = channel(OUT_QUEUE);
        assert!(queue.search(4, 1, tx4));
        queue.form(&mut host, 0.0);
        assert_eq!(host.asked, vec![(1, 2)]);
        assert_eq!((found(&mut rx1), found(&mut rx4)), (Some(1), Some(2)));
    }
}
