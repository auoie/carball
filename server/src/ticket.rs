//! The search tickets (notes/accounts.md §3, AC-6): who a search or a claim is from, signed by the accounts service
//! (`api/internal/ticket`, the format's other half) with Ed25519 and checked here offline, by the key's id
//! (`TICKET_PUBLIC_KEYS`: keys rotate). A ticket is good for its two minutes (±30 s of the two boxes' clocks), once: its
//! nonce is kept until it expires. The bytes, unpadded base64url:
//!
//! version (1) | kid length (1) | kid | account id (16) | issued (8, Unix s, big-endian) | expires (8) | nonce (16) |
//! name length (1) | name | signature (64) over "carball-search\0" and the bytes before it
//!
//! A development server (`--dev`) also takes tickets of a key it makes at its start (id "dev"), which its info server
//! hands to the pages that ask (`dev_ticket`): the browser tests and a development page sign in without the service.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ring::signature::{ED25519, Ed25519KeyPair, KeyPair, UnparsedPublicKey};
use std::collections::HashMap;
use std::sync::Mutex;

/// The format's version
const VERSION: u8 = 1;
/// What a signature covers before the ticket's bytes (the audience)
const CONTEXT: &[u8] = b"carball-search\0";
/// A ticket's longest encoded length (the API's `ticket.MaxBytes`; the Hello's ticket capped at it)
pub const MAX_BYTES: usize = 256;
/// The two boxes' clocks apart at most (s)
const SKEW: i64 = 30;
/// A development ticket's life (s; the API's `ticket.Lifetime`)
const LIFETIME: i64 = 120;
/// The development key's id
pub const DEV_KEY_ID: &str = "dev";

/// What a good ticket says
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ticket {
    pub account: [u8; 16],
    pub name: String,
    pub expires: i64,
}

/// Why a ticket was refused
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Malformed,
    UnknownKey,
    BadSignature,
    OutOfTime,
    Reused,
}

/// The keys tickets are checked with, and the nonces taken (until their tickets expire)
pub struct Tickets {
    keys: HashMap<String, Vec<u8>>,
    nonces: Mutex<HashMap<[u8; 16], i64>>,
    dev: Option<Ed25519KeyPair>,
}

impl std::fmt::Debug for Tickets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // (the keys' ids alone: never a development key's secret)
        f.debug_struct("Tickets").field("keys", &self.keys.keys().collect::<Vec<_>>()).finish_non_exhaustive()
    }
}

impl Tickets {
    /// The keys of `TICKET_PUBLIC_KEYS`: "KID BASE64" each, separated by commas or new lines (the API's `ticket-key`
    /// prints one)
    pub fn from_list(list: &str) -> anyhow::Result<Self> {
        let mut keys = HashMap::new();
        for entry in list.split([',', '\n']).map(str::trim).filter(|e| !e.is_empty()) {
            let (kid, b64) = entry
                .split_once(char::is_whitespace)
                .ok_or_else(|| anyhow::anyhow!("TICKET_PUBLIC_KEYS: {entry:?} isn't \"KID BASE64\""))?;
            let key = STANDARD.decode(b64.trim())?;
            anyhow::ensure!(key.len() == 32, "TICKET_PUBLIC_KEYS: {kid}'s key isn't 32 bytes");
            anyhow::ensure!(!kid.is_empty() && kid.len() <= 32, "TICKET_PUBLIC_KEYS: {kid:?} isn't a key id");
            keys.insert(kid.to_string(), key);
        }
        Ok(Self { keys, nonces: Mutex::new(HashMap::new()), dev: None })
    }

    /// Whether it has a key to check with
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// A development server's: its own key besides (made now, gone with the process), whose tickets `dev_ticket` signs
    pub fn with_dev_key(mut self) -> anyhow::Result<Self> {
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed).map_err(|e| anyhow::anyhow!("the system's random source: {e}"))?;
        let pair = Ed25519KeyPair::from_seed_unchecked(&seed).map_err(|_| anyhow::anyhow!("a development key"))?;
        self.keys.insert(DEV_KEY_ID.to_string(), pair.public_key().as_ref().to_vec());
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
        let key = self.keys.get(&kid).ok_or(Refusal::UnknownKey)?;
        let signed = [CONTEXT, body].concat();
        UnparsedPublicKey::new(&ED25519, key).verify(&signed, signature).map_err(|_| Refusal::BadSignature)?;
        if now + SKEW < issued || now - SKEW >= ticket.expires {
            return Err(Refusal::OutOfTime);
        }
        let mut nonces = self.nonces.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        nonces.retain(|_, &mut until| until + SKEW > now);
        if nonces.contains_key(&nonce) {
            return Err(Refusal::Reused);
        }
        nonces.insert(nonce, ticket.expires);
        Ok(ticket)
    }

    /// A development ticket for `account` named `name` at `now`, signed with the development key; None without one (a
    /// server not `--dev`) or for a name that won't fit
    pub fn dev_ticket(&self, account: [u8; 16], name: &str, now: i64) -> Option<String> {
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
        let signature = pair.sign(&[CONTEXT, &body].concat());
        body.extend_from_slice(signature.as_ref());
        Some(URL_SAFE_NO_PAD.encode(body))
    }
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
    let (&m, name) = b[48..].split_first()?;
    if m == 0 || m > 32 || name.len() != m as usize {
        return None;
    }
    let name = std::str::from_utf8(name).ok()?.to_string();
    Some((kid, Ticket { account, name, expires }, nonce, issued))
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

    #[test]
    fn a_development_ticket_checks_once_within_its_time() {
        let tickets = Tickets::from_list("").unwrap().with_dev_key().unwrap();
        let account = [7u8; 16];
        let encoded = tickets.dev_ticket(account, "Made Up", NOW).unwrap();
        assert!(encoded.len() <= MAX_BYTES);
        let ticket = tickets.check(&encoded, NOW + 10).unwrap();
        assert_eq!(ticket, Ticket { account, name: "Made Up".into(), expires: NOW + LIFETIME });
        assert_eq!(tickets.check(&encoded, NOW + 11), Err(Refusal::Reused), "used once");
        let late = tickets.dev_ticket(account, "Made Up", NOW).unwrap();
        assert_eq!(tickets.check(&late, NOW + LIFETIME + SKEW), Err(Refusal::OutOfTime), "past its time and the skew");
        let early = tickets.dev_ticket(account, "Made Up", NOW).unwrap();
        assert_eq!(tickets.check(&early, NOW - SKEW - 1), Err(Refusal::OutOfTime), "before it was issued");
        let within = tickets.dev_ticket(account, "Made Up", NOW).unwrap();
        assert!(tickets.check(&within, NOW + LIFETIME + SKEW - 1).is_ok(), "within the skew");
    }

    #[test]
    fn a_ticket_of_another_key_or_changed_is_refused() {
        let ours = Tickets::from_list("").unwrap().with_dev_key().unwrap();
        let theirs = Tickets::from_list("").unwrap().with_dev_key().unwrap();
        let foreign = theirs.dev_ticket([1; 16], "Name", NOW).unwrap();
        assert_eq!(ours.check(&foreign, NOW), Err(Refusal::BadSignature), "the same key id, another key");
        let encoded = ours.dev_ticket([1; 16], "Name", NOW).unwrap();
        let mut raw = URL_SAFE_NO_PAD.decode(&encoded).unwrap();
        raw[10] ^= 1; // (the account's bytes)
        assert_eq!(ours.check(&URL_SAFE_NO_PAD.encode(&raw), NOW), Err(Refusal::BadSignature));
        assert_eq!(ours.check("!!", NOW), Err(Refusal::Malformed));
        assert_eq!(ours.check(&"A".repeat(MAX_BYTES + 1), NOW), Err(Refusal::Malformed));
        let none = Tickets::from_list("").unwrap();
        assert_eq!(none.check(&encoded, NOW), Err(Refusal::UnknownKey), "no key of that id");
        assert!(none.dev_ticket([1; 16], "Name", NOW).is_none(), "a server not --dev signs none");
    }

    #[test]
    fn the_keys_list_and_the_account_key() {
        let pair = Ed25519KeyPair::from_seed_unchecked(&[3; 32]).unwrap();
        let b64 = STANDARD.encode(pair.public_key().as_ref());
        let tickets = Tickets::from_list(&format!("k1 {b64},\nk2 {b64}\n")).unwrap();
        assert_eq!(tickets.keys.len(), 2);
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
        let sig = pair.sign(&[CONTEXT, &body].concat());
        body.extend_from_slice(sig.as_ref());
        let tickets = Tickets::from_list(&format!("test {}", STANDARD.encode(pair.public_key().as_ref()))).unwrap();
        let ticket = tickets.check(&URL_SAFE_NO_PAD.encode(&body), NOW).unwrap();
        assert_eq!((ticket.account, ticket.name.as_str()), ([0xab; 16], "Name"));
    }
}
