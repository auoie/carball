//! The search tickets (notes/accounts.md §3, AC-6): who a search or a claim is from, signed by the accounts service
//! (`api/internal/ticket`, the format's other half) with Ed25519 and checked here offline, by the key's id
//! (`TICKET_PUBLIC_KEYS`: keys rotate). A ticket is good for its two minutes (±30 s of the two boxes' clocks), once: its
//! nonce is kept until it expires. The bytes, unpadded base64url:
//!
//! version (1) = 3 | kid length (1) | kid | account id (16) | issued (8, Unix s, big-endian) | expires (8) | nonce (16) |
//! name length (1) | name | the ratings, 1v1, 2v2, 3v3: rating (2) and deviation (2) each, rounded | purpose (1): 0 a
//! search (and its claim), 1 a rejoin | match (8): a rejoin's match id, 0 for a search | signature (64) over
//! "carball-search\0" and the bytes before it
//!
//! The ratings are the account's when the ticket was issued: the queue pairs searchers by them (notes/matchmaking.md).
//! A rejoin's ticket is for its match alone (the network server takes it for that rejoin, nothing else): the accounts
//! service issues one to a leaver its queue ban holds, so they can come back and refill the lobby (LV1, AP3).
//! protocol/ticket_vector.json holds tickets the API's code makes, checked by both sides' tests.
//!
//! A development server (`--dev`) also takes tickets of a key it makes at its start (id "dev"), which its info server
//! hands to the pages that ask (`dev_ticket`): the browser tests and a development page sign in without the service.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ring::signature::{ED25519, Ed25519KeyPair, KeyPair, UnparsedPublicKey};
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};

/// The format's version (2: the ratings; 3: the purpose and match)
const VERSION: u8 = 3;
/// What a signature covers before the ticket's bytes (the audience)
const CONTEXT: &[u8] = b"carball-search\0";
/// A ticket's longest encoded length (the API's `ticket.MaxBytes`; the Hello's ticket capped at it)
pub const MAX_BYTES: usize = 320;
/// The two boxes' clocks apart at most (s)
const SKEW: i64 = 30;
/// A development ticket's life (s; the API's `ticket.Lifetime`)
const LIFETIME: i64 = 120;
/// The development key's id (reserved: a listed key can't take it)
pub const DEV_KEY_ID: &str = "dev";
/// A ticket's longest life (s): the API's two minutes and the skew; a ticket longer, or ending before it began, refused
/// (AP2-3)
const MAX_LIFETIME: i64 = LIFETIME + SKEW;

/// The Ed25519 public keys of small order (libsodium's list, sign bit aside: each checked to decode to a point P with
/// [8]P the identity): a signature "checks" under one for many messages, so none is taken (AP2-5)
const SMALL_ORDER: [[u8; 32]; 7] = {
    let mut ones = [0xffu8; 32];
    ones[31] = 0x7f;
    let (mut a, mut b, mut c) = (ones, ones, ones);
    a[0] = 0xec;
    b[0] = 0xed;
    c[0] = 0xee;
    let mut one = [0u8; 32];
    one[0] = 1;
    [
        [0; 32],
        one,
        [
            0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0, 0xd5, 0xdf,
            0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05,
        ],
        [
            0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f, 0x2a, 0x20,
            0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a,
        ],
        a,
        b,
        c,
    ]
};

/// A public key of small order (its sign bit aside)
fn small_order(key: &[u8]) -> bool {
    key.len() == 32 && SMALL_ORDER.iter().any(|bad| key[..31] == bad[..31] && key[31] & 0x7f == bad[31])
}

/// A rating as a ticket carries it, rounded
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shown {
    pub rating: u16,
    pub deviation: u16,
}

/// A new account's rating (the API's: lichess's 1500, deviation 500)
pub const DEFAULT_RATING: Shown = Shown { rating: 1500, deviation: 500 };

/// What a ticket is for
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    /// A search, and its claim
    Search,
    /// A rejoin of this match (its id: Welcome's `match_id`)
    Rejoin(u64),
}

/// What a good ticket says
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ticket {
    pub account: [u8; 16],
    pub name: String,
    pub expires: i64,
    /// In the playlists 1v1, 2v2, 3v3 (index 0, 1, 2)
    pub ratings: [Shown; 3],
    pub purpose: Purpose,
}

/// Why a ticket was refused
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Malformed,
    UnknownKey,
    BadSignature,
    OutOfTime,
    Reused,
    /// A good ticket for something else (a search's for a rejoin, a rejoin's for another match or a search)
    NotForThis,
}

/// The keys tickets are checked with (reloadable: a rotation without a restart, AP2-4), the nonces taken (until their
/// tickets expire), and when this process started (a ticket issued before it may have been used with the one before:
/// refused, with no clock skew allowed, deliberately: a skew would let a ticket spent on the last process through again;
/// a game box clock ahead of the service's only costs a fresh ticket for the first seconds after a restart, RX31 F7)
pub struct Tickets {
    keys: RwLock<HashMap<String, Vec<u8>>>,
    nonces: Mutex<HashMap<[u8; 16], i64>>,
    dev: Option<Ed25519KeyPair>,
    started: i64,
}

impl std::fmt::Debug for Tickets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // (the keys' ids alone: never a development key's secret)
        f.debug_struct("Tickets").field("keys", &self.key_ids()).finish_non_exhaustive()
    }
}

impl Tickets {
    /// The keys of `TICKET_PUBLIC_KEYS`: "KID BASE64" each, separated by commas or new lines (the API's `ticket-key`
    /// prints one)
    pub fn from_list(list: &str) -> anyhow::Result<Self> {
        Ok(Self {
            keys: RwLock::new(parse_keys(list)?),
            nonces: Mutex::new(HashMap::new()),
            dev: None,
            started: unix_now(),
        })
    }

    /// The same, started at `started` (Unix s: the tests')
    pub fn started_at(mut self, started: i64) -> Self {
        self.started = started;
        self
    }

    /// Whether it has a key to check with
    pub fn is_empty(&self) -> bool {
        self.keys.read().unwrap_or_else(std::sync::PoisonError::into_inner).is_empty()
    }

    /// The keys' ids (logged at the start and at a reload)
    pub fn key_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> =
            self.keys.read().unwrap_or_else(std::sync::PoisonError::into_inner).keys().cloned().collect();
        ids.sort();
        ids
    }

    /// The listed keys replaced by a new list (a rotation: `TICKET_PUBLIC_KEYS_FILE` read again on SIGHUP), the
    /// development key kept; a bad list changes nothing
    pub fn reload(&self, list: &str) -> anyhow::Result<()> {
        let mut keys = parse_keys(list)?;
        anyhow::ensure!(!keys.is_empty(), "TICKET_PUBLIC_KEYS: no key");
        if let Some(pair) = &self.dev {
            keys.insert(DEV_KEY_ID.to_string(), pair.public_key().as_ref().to_vec());
        }
        *self.keys.write().unwrap_or_else(std::sync::PoisonError::into_inner) = keys;
        Ok(())
    }

    /// A development server's: its own key besides (made now, gone with the process), whose tickets `dev_ticket` signs
    pub fn with_dev_key(mut self) -> anyhow::Result<Self> {
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed).map_err(|e| anyhow::anyhow!("the system's random source: {e}"))?;
        let pair = Ed25519KeyPair::from_seed_unchecked(&seed).map_err(|_| anyhow::anyhow!("a development key"))?;
        self.keys
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(DEV_KEY_ID.to_string(), pair.public_key().as_ref().to_vec());
        self.dev = Some(pair);
        Ok(self)
    }

    /// A ticket checked at `now` (Unix s): its signature by a key of ours, its time, its nonce not seen before (taken
    /// now, kept until it expires)
    pub fn check(&self, encoded: &str, now: i64) -> Result<Ticket, Refusal> {
        if encoded.len() > MAX_BYTES {
            return Err(Refusal::Malformed);
        }
        let raw = URL_SAFE_NO_PAD.decode(encoded).map_err(|_| Refusal::Malformed)?;
        if raw.len() < 64 + 2 {
            return Err(Refusal::Malformed);
        }
        let (body, signature) = raw.split_at(raw.len() - 64);
        let (kid, ticket, nonce, issued) = decode(body).ok_or(Refusal::Malformed)?;
        {
            let keys = self.keys.read().unwrap_or_else(std::sync::PoisonError::into_inner);
            let key = keys.get(&kid).ok_or(Refusal::UnknownKey)?;
            let signed = [CONTEXT, body].concat();
            UnparsedPublicKey::new(&ED25519, key).verify(&signed, signature).map_err(|_| Refusal::BadSignature)?;
        }
        // (its life within the API's, and begun before it ends: AP2-3; issued since this process started, no skew allowed:
        // its nonce may have been used with the process before, whose nonces are gone, AP2-4, AP3)
        if ticket.expires < issued || ticket.expires.saturating_sub(issued) > MAX_LIFETIME {
            return Err(Refusal::Malformed);
        }
        if now.saturating_add(SKEW) < issued || now.saturating_sub(SKEW) >= ticket.expires || issued < self.started {
            return Err(Refusal::OutOfTime);
        }
        let mut nonces = self.nonces.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        nonces.retain(|_, &mut until| until.saturating_add(SKEW) > now);
        if nonces.contains_key(&nonce) {
            return Err(Refusal::Reused);
        }
        nonces.insert(nonce, ticket.expires);
        Ok(ticket)
    }

    /// A development ticket for `account` named `name` with `ratings`, for `purpose`, at `now`, signed with the
    /// development key; None without one (a server not `--dev`) or for a name that won't fit
    pub fn dev_ticket(
        &self,
        account: [u8; 16],
        name: &str,
        ratings: [Shown; 3],
        purpose: Purpose,
        now: i64,
    ) -> Option<String> {
        let pair = self.dev.as_ref()?;
        if name.is_empty() || name.len() > 32 {
            return None;
        }
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).ok()?;
        let mut body = vec![VERSION, DEV_KEY_ID.len() as u8];
        body.extend_from_slice(DEV_KEY_ID.as_bytes());
        body.extend_from_slice(&account);
        body.extend_from_slice(&now.to_be_bytes());
        body.extend_from_slice(&(now + LIFETIME).to_be_bytes());
        body.extend_from_slice(&nonce);
        body.push(name.len() as u8);
        body.extend_from_slice(name.as_bytes());
        for r in ratings {
            body.extend_from_slice(&r.rating.to_be_bytes());
            body.extend_from_slice(&r.deviation.to_be_bytes());
        }
        body.extend_from_slice(&purpose_bytes(purpose));
        let signature = pair.sign(&[CONTEXT, &body].concat());
        body.extend_from_slice(signature.as_ref());
        Some(URL_SAFE_NO_PAD.encode(body))
    }
}

/// `TICKET_PUBLIC_KEYS`'s keys: "KID BASE64" each, separated by commas or new lines; a malformed line, a key not 32
/// bytes, a key of small order, a key id twice or the development key's id refused (AP2-5)
fn parse_keys(list: &str) -> anyhow::Result<HashMap<String, Vec<u8>>> {
    let mut keys = HashMap::new();
    for entry in list.split([',', '\n']).map(str::trim).filter(|e| !e.is_empty()) {
        let (kid, b64) = entry
            .split_once(char::is_whitespace)
            .ok_or_else(|| anyhow::anyhow!("TICKET_PUBLIC_KEYS: {entry:?} isn't \"KID BASE64\""))?;
        let key = STANDARD.decode(b64.trim())?;
        anyhow::ensure!(key.len() == 32, "TICKET_PUBLIC_KEYS: {kid}'s key isn't 32 bytes");
        anyhow::ensure!(!kid.is_empty() && kid.len() <= 32, "TICKET_PUBLIC_KEYS: {kid:?} isn't a key id");
        anyhow::ensure!(kid != DEV_KEY_ID, "TICKET_PUBLIC_KEYS: the key id {DEV_KEY_ID:?} is --dev's own");
        anyhow::ensure!(!small_order(&key), "TICKET_PUBLIC_KEYS: {kid}'s key is of small order (no signer's)");
        anyhow::ensure!(keys.insert(kid.to_string(), key).is_none(), "TICKET_PUBLIC_KEYS: the key id {kid:?} twice");
    }
    Ok(keys)
}

/// A purpose's bytes: its byte and the match (0 for a search)
fn purpose_bytes(purpose: Purpose) -> [u8; 9] {
    let (kind, match_id) = match purpose {
        Purpose::Search => (0u8, 0u64),
        Purpose::Rejoin(m) => (1, m),
    };
    let mut b = [kind; 9];
    b[1..].copy_from_slice(&match_id.to_be_bytes());
    b
}

/// A ticket's bytes (unsigned part): its key's id, what it says, its nonce and when it was issued
fn decode(b: &[u8]) -> Option<(String, Ticket, [u8; 16], i64)> {
    let (&version, b) = b.split_first()?;
    let (&n, b) = b.split_first()?;
    let n = n as usize;
    if version != VERSION || n == 0 || n > 32 || b.len() < n + 16 + 8 + 8 + 16 + 1 {
        return None;
    }
    let kid = std::str::from_utf8(&b[..n]).ok()?.to_string();
    let b = &b[n..];
    let account: [u8; 16] = b[..16].try_into().ok()?;
    let issued = i64::from_be_bytes(b[16..24].try_into().ok()?);
    let expires = i64::from_be_bytes(b[24..32].try_into().ok()?);
    let nonce: [u8; 16] = b[32..48].try_into().ok()?;
    let (&m, rest) = b[48..].split_first()?;
    let m = m as usize;
    if m == 0 || m > 32 || rest.len() != m + 3 * 4 + 9 {
        return None;
    }
    let name = std::str::from_utf8(&rest[..m]).ok()?.to_string();
    let r = &rest[m..];
    let at = |i: usize| u16::from_be_bytes([r[i], r[i + 1]]);
    let ratings = [0, 1, 2].map(|p| Shown { rating: at(4 * p), deviation: at(4 * p + 2) });
    let match_id = u64::from_be_bytes(r[13..21].try_into().ok()?);
    // (a search's has no match, a rejoin's has one: anything else refused)
    let purpose = match (r[12], match_id) {
        (0, 0) => Purpose::Search,
        (1, m) if m != 0 => Purpose::Rejoin(m),
        _ => return None,
    };
    Some((kid, Ticket { account, name, expires, ratings, purpose }, nonce, issued))
}

/// An account as the queue's and the match's player key (`JoinRequest::key`): its id's first 8 bytes, never 0 (0 is
/// "no key")
pub fn account_key(account: &[u8; 16]) -> u64 {
    let key = u64::from_be_bytes(account[..8].try_into().unwrap_or([0; 8]));
    if key == 0 { 1 } else { key }
}

/// Now, Unix seconds
pub fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_792_300_000;

    /// The tickets the API's code made (protocol/ticket_vector.json, api/internal/ticket's vector test: a search's and a
    /// rejoin's): read as they say
    #[test]
    fn the_apis_tickets_read_as_they_were_made() {
        let text =
            std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../protocol/ticket_vector.json")).unwrap();
        let all: serde_json::Value = serde_json::from_str(&text).unwrap();
        let vectors = all["vectors"].as_array().unwrap();
        assert_eq!(vectors.len(), 2);
        for v in vectors {
            let s = |k: &str| v[k].as_str().unwrap().to_string();
            let n = |k: &str| v[k].as_i64().unwrap();
            let tickets =
                Tickets::from_list(&format!("{} {}", s("keyId"), s("publicKey"))).unwrap().started_at(n("issued"));
            let ticket = tickets.check(&s("encoded"), n("issued") + 10).unwrap();
            let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
            assert_eq!(hex(&ticket.account), s("account"));
            assert_eq!(ticket.name, s("name"));
            assert_eq!(ticket.expires, n("expires"));
            let ratings: Vec<(u16, u16)> = ticket.ratings.iter().map(|r| (r.rating, r.deviation)).collect();
            let want: Vec<(u16, u16)> = v["ratings"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| (r[0].as_u64().unwrap() as u16, r[1].as_u64().unwrap() as u16))
                .collect();
            assert_eq!(ratings, want);
            let purpose = match (n("purpose"), s("match").parse::<u64>().unwrap()) {
                (0, 0) => Purpose::Search,
                (1, m) => Purpose::Rejoin(m),
                other => panic!("{other:?}"),
            };
            assert_eq!(ticket.purpose, purpose);
            assert_eq!(tickets.check(&s("encoded"), n("issued") + 11), Err(Refusal::Reused));
        }
    }

    /// A ticket's purpose: a search's without a match, a rejoin's with its match, read back; any other pair refused
    #[test]
    fn a_tickets_purpose_is_a_search_or_a_rejoin_of_one_match() {
        let tickets = Tickets::from_list("").unwrap().with_dev_key().unwrap().started_at(NOW);
        let rejoin =
            tickets.dev_ticket([7; 16], "Made Up", [DEFAULT_RATING; 3], Purpose::Rejoin(0x0123_4567_89ab_cdef), NOW);
        assert_eq!(tickets.check(&rejoin.unwrap(), NOW).unwrap().purpose, Purpose::Rejoin(0x0123_4567_89ab_cdef));
        let pair = Ed25519KeyPair::from_seed_unchecked(&[6; 32]).unwrap();
        let ours = Tickets::from_list(&format!("test {}", STANDARD.encode(pair.public_key().as_ref())))
            .unwrap()
            .started_at(NOW);
        for (i, (kind, match_id)) in [(0u8, 9u64), (1, 0), (2, 0), (2, 9)].into_iter().enumerate() {
            let mut purpose = [kind; 9];
            purpose[1..].copy_from_slice(&match_id.to_be_bytes());
            let ticket = signed_with(&pair, NOW, NOW + 120, i as u8 + 20, &purpose);
            assert_eq!(ours.check(&ticket, NOW), Err(Refusal::Malformed), "purpose {kind}, match {match_id}");
        }
    }

    #[test]
    fn a_development_ticket_checks_once_within_its_time() {
        let tickets = Tickets::from_list("").unwrap().with_dev_key().unwrap().started_at(NOW);
        let account = [7u8; 16];
        let encoded = tickets.dev_ticket(account, "Made Up", [DEFAULT_RATING; 3], Purpose::Search, NOW).unwrap();
        assert!(encoded.len() <= MAX_BYTES);
        let ticket = tickets.check(&encoded, NOW + 10).unwrap();
        assert_eq!(
            ticket,
            Ticket {
                account,
                name: "Made Up".into(),
                expires: NOW + LIFETIME,
                ratings: [DEFAULT_RATING; 3],
                purpose: Purpose::Search
            }
        );
        assert_eq!(tickets.check(&encoded, NOW + 11), Err(Refusal::Reused), "used once");
        let late = tickets.dev_ticket(account, "Made Up", [DEFAULT_RATING; 3], Purpose::Search, NOW).unwrap();
        assert_eq!(tickets.check(&late, NOW + LIFETIME + SKEW), Err(Refusal::OutOfTime), "past its time and the skew");
        let early = tickets.dev_ticket(account, "Made Up", [DEFAULT_RATING; 3], Purpose::Search, NOW).unwrap();
        assert_eq!(tickets.check(&early, NOW - SKEW - 1), Err(Refusal::OutOfTime), "before it was issued");
        let within = tickets.dev_ticket(account, "Made Up", [DEFAULT_RATING; 3], Purpose::Search, NOW).unwrap();
        assert!(tickets.check(&within, NOW + LIFETIME + SKEW - 1).is_ok(), "within the skew");
    }

    #[test]
    fn a_ticket_of_another_key_or_changed_is_refused() {
        let ours = Tickets::from_list("").unwrap().with_dev_key().unwrap().started_at(NOW);
        let theirs = Tickets::from_list("").unwrap().with_dev_key().unwrap().started_at(NOW);
        let foreign = theirs.dev_ticket([1; 16], "Name", [DEFAULT_RATING; 3], Purpose::Search, NOW).unwrap();
        assert_eq!(ours.check(&foreign, NOW), Err(Refusal::BadSignature), "the same key id, another key");
        let encoded = ours.dev_ticket([1; 16], "Name", [DEFAULT_RATING; 3], Purpose::Search, NOW).unwrap();
        let mut raw = URL_SAFE_NO_PAD.decode(&encoded).unwrap();
        raw[10] ^= 1; // (the account's bytes)
        assert_eq!(ours.check(&URL_SAFE_NO_PAD.encode(&raw), NOW), Err(Refusal::BadSignature));
        assert_eq!(ours.check("!!", NOW), Err(Refusal::Malformed));
        assert_eq!(ours.check(&"A".repeat(MAX_BYTES + 1), NOW), Err(Refusal::Malformed));
        let none = Tickets::from_list("").unwrap();
        assert_eq!(none.check(&encoded, NOW), Err(Refusal::UnknownKey), "no key of that id");
        assert!(
            none.dev_ticket([1; 16], "Name", [DEFAULT_RATING; 3], Purpose::Search, NOW).is_none(),
            "a server not --dev signs none"
        );
    }

    #[test]
    fn the_keys_list_and_the_account_key() {
        let pair = Ed25519KeyPair::from_seed_unchecked(&[3; 32]).unwrap();
        let b64 = STANDARD.encode(pair.public_key().as_ref());
        let other = STANDARD.encode(Ed25519KeyPair::from_seed_unchecked(&[4; 32]).unwrap().public_key().as_ref());
        let tickets = Tickets::from_list(&format!("k1 {b64},\nk2 {other}\n")).unwrap();
        assert_eq!(tickets.key_ids(), ["k1", "k2"]);
        assert!(Tickets::from_list("k1").is_err(), "no key");
        assert!(Tickets::from_list("k1 c2hvcnQ=").is_err(), "not 32 bytes");
        assert!(Tickets::from_list("").unwrap().is_empty());
        assert_eq!(account_key(&[0; 16]), 1, "never 0");
        assert_eq!(account_key(&[0, 0, 0, 0, 0, 0, 0, 2, 9, 9, 9, 9, 9, 9, 9, 9]), 2);
    }

    /// The API's tickets (api/internal/ticket): one it issued checks here, its fixed seed's key (the Go test's)
    #[test]
    fn a_ticket_the_api_signs_checks_here() {
        // (the API's format by hand, with the Go tests' seed: 0..31)
        let seed: Vec<u8> = (0u8..32).collect();
        let pair = Ed25519KeyPair::from_seed_unchecked(&seed).unwrap();
        let mut body = vec![VERSION, 4];
        body.extend_from_slice(b"test");
        body.extend_from_slice(&[0xab; 16]);
        body.extend_from_slice(&NOW.to_be_bytes());
        body.extend_from_slice(&(NOW + 120).to_be_bytes());
        body.extend_from_slice(&[5; 16]);
        body.push(4);
        body.extend_from_slice(b"Name");
        body.extend_from_slice(&[0x05, 0xdc, 0x01, 0xf4, 0x06, 0xbb, 0x00, 0x40, 0x05, 0x20, 0x00, 0x6e]);
        body.extend_from_slice(&[0; 9]); // (a search's: no match)
        let sig = pair.sign(&[CONTEXT, &body].concat());
        body.extend_from_slice(sig.as_ref());
        let tickets = Tickets::from_list(&format!("test {}", STANDARD.encode(pair.public_key().as_ref())))
            .unwrap()
            .started_at(NOW);
        let ticket = tickets.check(&URL_SAFE_NO_PAD.encode(&body), NOW).unwrap();
        assert_eq!((ticket.account, ticket.name.as_str()), ([0xab; 16], "Name"));
        let shown = |rating, deviation| Shown { rating, deviation };
        assert_eq!(ticket.ratings, [shown(1500, 500), shown(1723, 64), shown(1312, 110)]);
    }

    /// A ticket signed by hand: `issued`, `expires` as given (the API's format, a key of ours), a search's
    fn signed(pair: &Ed25519KeyPair, issued: i64, expires: i64, nonce: u8) -> String {
        signed_with(pair, issued, expires, nonce, &[0; 9])
    }

    /// The same with its purpose and match bytes as given
    fn signed_with(pair: &Ed25519KeyPair, issued: i64, expires: i64, nonce: u8, purpose: &[u8; 9]) -> String {
        let mut body = vec![VERSION, 4];
        body.extend_from_slice(b"test");
        body.extend_from_slice(&[0xab; 16]);
        body.extend_from_slice(&issued.to_be_bytes());
        body.extend_from_slice(&expires.to_be_bytes());
        body.extend_from_slice(&[nonce; 16]);
        body.push(4);
        body.extend_from_slice(b"Name");
        body.extend_from_slice(&[0; 12]);
        body.extend_from_slice(purpose);
        let sig = pair.sign(&[CONTEXT, &body].concat());
        body.extend_from_slice(sig.as_ref());
        URL_SAFE_NO_PAD.encode(&body)
    }

    /// AP2-3, AP2-4: a ticket ending at the end of time, one ending before it began, or one longer than the API's: refused,
    /// and the checks after still sound; one issued before this process started (its nonce maybe used before): refused
    #[test]
    fn a_tickets_life_is_the_apis_and_from_this_process_on() {
        let pair = Ed25519KeyPair::from_seed_unchecked(&[5; 32]).unwrap();
        let tickets = Tickets::from_list(&format!("test {}", STANDARD.encode(pair.public_key().as_ref())))
            .unwrap()
            .started_at(NOW);
        assert_eq!(
            tickets.check(&signed(&pair, NOW, i64::MAX, 1), NOW),
            Err(Refusal::Malformed),
            "a lifetime to the end"
        );
        assert_eq!(
            tickets.check(&signed(&pair, NOW, NOW - 1, 2), NOW),
            Err(Refusal::Malformed),
            "ends before it begins"
        );
        assert_eq!(tickets.check(&signed(&pair, NOW, NOW + MAX_LIFETIME + 1, 3), NOW), Err(Refusal::Malformed));
        assert!(tickets.check(&signed(&pair, NOW, NOW + LIFETIME, 4), NOW + 1).is_ok(), "the checks after: sound");
        assert_eq!(
            tickets.check(&signed(&pair, NOW - SKEW - 1, NOW + 60, 5), NOW + 10),
            Err(Refusal::OutOfTime),
            "before the start"
        );
        assert_eq!(
            tickets.check(&signed(&pair, NOW - 1, NOW + 60, 6), NOW + 10),
            Err(Refusal::OutOfTime),
            "a second before the start, within the skew: its nonce maybe used before (AP3)"
        );
        assert!(tickets.check(&signed(&pair, NOW, NOW + 60, 7), NOW + 10).is_ok(), "issued as it started");
    }

    /// AP2-5: a key of small order, a key id twice, the development key's id: refused; a reload replaces the listed keys,
    /// keeps the development key, and a bad list changes nothing
    #[test]
    fn the_keys_list_refuses_bad_keys_and_reloads() {
        let b64 =
            |seed: u8| STANDARD.encode(Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap().public_key().as_ref());
        for bad in SMALL_ORDER {
            assert!(Tickets::from_list(&format!("so {}", STANDARD.encode(bad))).is_err(), "small order {bad:02x?}");
            let mut signed_bit = bad;
            signed_bit[31] |= 0x80;
            assert!(Tickets::from_list(&format!("so {}", STANDARD.encode(signed_bit))).is_err(), "its sign bit set");
        }
        assert!(Tickets::from_list(&format!("k1 {}, k1 {}", b64(1), b64(2))).is_err(), "a key id twice");
        assert!(Tickets::from_list(&format!("dev {}", b64(1))).is_err(), "--dev's own id");
        let tickets = Tickets::from_list(&format!("k1 {}", b64(1))).unwrap().with_dev_key().unwrap();
        tickets.reload(&format!("k2 {}", b64(2))).unwrap();
        assert_eq!(tickets.key_ids(), ["dev", "k2"]);
        assert!(tickets.reload(" , ").is_err(), "no key");
        assert!(tickets.reload(&format!("k3 {}", STANDARD.encode(SMALL_ORDER[1]))).is_err());
        assert_eq!(tickets.key_ids(), ["dev", "k2"], "unchanged");
    }
}
