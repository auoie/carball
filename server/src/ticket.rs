//! The tickets (notes/accounts.md §3, AC-6): who a claim or a rejoin is from, signed by the accounts service
//! (`api/internal/ticket`, the format's other half) with Ed25519 and checked here offline, by the key's id
//! (`TICKET_PUBLIC_KEYS`: keys rotate). A ticket is good for its life (±30 s of the two boxes' clocks), once: its
//! one-time id is kept until it expires. A ticket is a JWT (compact JWS, alg EdDSA alone, its key's id the `kid`), its
//! claims:
//!
//! iss "carball" | sub the account id (32 hex digits) | iat, exp (Unix s) | jti its one-time id (16 bytes, base64url) |
//! name | ratings: 1v1, 2v2, 3v3, [rating, deviation] each, rounded | purpose "rejoin" or "seat" | match (16 hex digits) |
//! a seat's: aud its server (host:port), playlist (the team size), seat, roster (its seats)
//!
//! A match ticket (a seat; notes/matchmaking.md, the central matchmaker) is the accounts service's matchmaker's for one
//! seat of one match at one game server, 30 s long, taken once (RV-850); its server (`aud`) is compared with this
//! server's name by the claim (`net.rs`), not here.
//!
//! The ratings are the account's when the ticket was issued (the matchmaker pairs by them: notes/matchmaking.md).
//! A rejoin's ticket is for its match alone (the network server takes it for that rejoin, nothing else): the accounts
//! service issues one to a leaver its queue ban holds, so they can come back and refill the lobby (LV1, AP3).
//! protocol/ticket_vector.json holds tickets the API's code makes, checked by both sides' tests.

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use jsonwebtoken::errors::ErrorKind;
use jsonwebtoken::{Algorithm, DecodingKey, Validation};
use std::collections::HashMap;
use std::sync::{Mutex, RwLock};

/// Every ticket's issuer (`iss`: the API's `ticket.Issuer`)
const ISSUER: &str = "carball";
/// A ticket's longest encoded length (the API's `ticket.MaxBytes`; the Hello's ticket capped at it)
pub const MAX_BYTES: usize = 1024;
/// A match ticket's server address's longest (bytes; the API's `ticket.MaxServer`)
const MAX_SERVER: usize = 64;
/// The two boxes' clocks apart at most (s)
const SKEW: i64 = 30;
/// A rejoin ticket's life (s; the API's `ticket.Lifetime`); a match ticket's (`ticket.SeatLifetime`)
const LIFETIME: i64 = 120;
const SEAT_LIFETIME: i64 = 30;

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

/// The old development key's public key (its seed the SHA-256 of "carball development ticket key", published in the
/// repository's history until design 4 removed it, 2026-10-24): never a ticket key, under whatever id it's listed, since
/// anyone can sign with it (RV-1059)
const PUBLISHED_DEV_KEY: [u8; 32] = [
    212, 241, 128, 92, 150, 47, 245, 131, 87, 14, 146, 109, 163, 238, 152, 26, 182, 181, 172, 33, 140, 159, 225, 18,
    133, 242, 207, 142, 146, 34, 22, 5,
];

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
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Purpose {
    /// A rejoin of this match (its id: Welcome's `match_id`)
    Rejoin(u64),
    /// A seat of a match the matchmaker made
    Seat(Seat),
}

/// A match ticket's seat: its match (the matchmaker's id), the server it's for (its address), the playlist (team size),
/// the seat (even blue, odd orange) and the roster's size
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seat {
    pub match_id: u64,
    pub server: String,
    pub playlist: u8,
    pub seat: u8,
    pub roster: u8,
}

/// What a good ticket says
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ticket {
    pub account: [u8; 16],
    pub name: String,
    /// When it was issued and when it expires (Unix s)
    pub issued: i64,
    pub expires: i64,
    /// Its one-time id
    pub nonce: [u8; 16],
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
    /// A good ticket for something else (a rejoin's for a claim or another match, a seat's for a rejoin or another
    /// server)
    NotForThis,
}

/// A ticket's claims as the API writes them (a seat's `aud`, playlist, seat and roster: none in a rejoin's); none else,
/// and none null (RV-954)
#[derive(Debug, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Claims {
    iss: String,
    sub: String,
    #[serde(default, deserialize_with = "present")]
    aud: Option<String>,
    iat: i64,
    exp: i64,
    jti: String,
    name: String,
    ratings: [[u16; 2]; 3],
    purpose: String,
    #[serde(rename = "match")]
    match_id: String,
    #[serde(default, deserialize_with = "present")]
    playlist: Option<u8>,
    #[serde(default, deserialize_with = "present")]
    seat: Option<u8>,
    #[serde(default, deserialize_with = "present")]
    roster: Option<u8>,
}

/// A claim given has a value: null refused (absent: none, the field's default)
fn present<'de, D: serde::Deserializer<'de>, T: serde::Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

/// A ticket's header as the API writes it, and nothing else: alg, kid and typ, each once (RV-947: jsonwebtoken's own
/// takes others, crit among them, and ignores them)
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StrictHeader {
    alg: String,
    kid: String,
    typ: String,
}

/// A ticket's key id, its header checked: three parts, the header exactly alg "EdDSA", kid (1-32 bytes) and typ "JWT"
fn strict_header(encoded: &str) -> Option<String> {
    let mut parts = encoded.split('.');
    let head = parts.next()?;
    if parts.count() != 2 {
        return None;
    }
    let header: StrictHeader = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(head).ok()?).ok()?;
    (header.alg == "EdDSA" && header.typ == "JWT" && !header.kid.is_empty() && header.kid.len() <= 32)
        .then_some(header.kid)
}

/// The keys tickets are checked with (reloadable: a rotation without a restart, AP2-4), the one-time ids taken (until
/// their tickets expire), and when this process started (a ticket issued before it may have been used with the one
/// before: refused, with no clock skew allowed, deliberately: a skew would let a ticket spent on the last process through
/// again; a game box clock ahead of the service's only costs a fresh ticket for the first seconds after a restart, RX31
/// F7)
pub struct Tickets {
    keys: RwLock<HashMap<String, Vec<u8>>>,
    nonces: Mutex<HashMap<[u8; 16], i64>>,
    /// The one-time ids whose use is being decided now (a rejoin's question to the API): one at a time (RV-1020)
    deciding: Mutex<std::collections::HashSet<[u8; 16]>>,
    started: i64,
}

/// A ticket's use being decided (`Tickets::decide`): its one-time id free again when it's dropped
pub struct Deciding<'a> {
    tickets: &'a Tickets,
    nonce: [u8; 16],
}

impl Drop for Deciding<'_> {
    fn drop(&mut self) {
        self.tickets.deciding.lock().unwrap_or_else(std::sync::PoisonError::into_inner).remove(&self.nonce);
    }
}

impl std::fmt::Debug for Tickets {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // (the keys' ids alone)
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
            deciding: Mutex::new(std::collections::HashSet::new()),
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

    /// The listed keys replaced by a new list (a rotation: `TICKET_PUBLIC_KEYS_FILE` read again on SIGHUP); a bad list
    /// changes nothing
    pub fn reload(&self, list: &str) -> anyhow::Result<()> {
        let keys = parse_keys(list)?;
        anyhow::ensure!(!keys.is_empty(), "TICKET_PUBLIC_KEYS: no key");
        *self.keys.write().unwrap_or_else(std::sync::PoisonError::into_inner) = keys;
        Ok(())
    }

    /// A ticket checked at `now` (Unix s): `verify`, then `spend`
    pub fn check(&self, encoded: &str, now: i64) -> Result<Ticket, Refusal> {
        let ticket = self.verify(encoded, now)?;
        self.spend(&ticket, now)?;
        Ok(ticket)
    }

    /// A ticket verified at `now` (Unix s): its signature by a key of ours (EdDSA alone), its claims, its time, its
    /// one-time id not seen before; not taken (`spend`, once its use is decided: a ticket shown for something else, or a
    /// rejoin the matchmaker refuses, stays good, RV-973; a used one refused before anyone's asked, RV-1008)
    pub fn verify(&self, encoded: &str, now: i64) -> Result<Ticket, Refusal> {
        if encoded.len() > MAX_BYTES {
            return Err(Refusal::Malformed);
        }
        let kid = strict_header(encoded).ok_or(Refusal::Malformed)?;
        let claims = {
            let keys = self.keys.read().unwrap_or_else(std::sync::PoisonError::into_inner);
            let key = keys.get(&kid).ok_or(Refusal::UnknownKey)?;
            jsonwebtoken::decode::<Claims>(encoded, &DecodingKey::from_ed_der(key), &validation())
                .map_err(|e| match e.kind() {
                    ErrorKind::InvalidSignature => Refusal::BadSignature,
                    _ => Refusal::Malformed,
                })?
                .claims
        };
        let ticket = read(claims).ok_or(Refusal::Malformed)?;
        let (nonce, issued) = (ticket.nonce, ticket.issued);
        // (its life within its purpose's (one clock's difference: no skew in it, RV-950), and begun before it ends: AP2-3;
        // issued since this process started, no skew allowed: its one-time id may have been used with the process before,
        // whose ids are gone, AP2-4, AP3)
        let life = if matches!(ticket.purpose, Purpose::Seat(_)) { SEAT_LIFETIME } else { LIFETIME };
        if ticket.expires < issued || ticket.expires.saturating_sub(issued) > life {
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
        Ok(ticket)
    }

    /// A verified ticket's use being decided, one at a time (a rejoin's question to the API, RV-1020): another use of it
    /// meanwhile is refused (Reused), so a replayed ticket asks once, not as often as it's sent; free again once dropped
    pub fn decide(&self, ticket: &Ticket) -> Result<Deciding<'_>, Refusal> {
        if self.deciding.lock().unwrap_or_else(std::sync::PoisonError::into_inner).insert(ticket.nonce) {
            Ok(Deciding { tickets: self, nonce: ticket.nonce })
        } else {
            Err(Refusal::Reused)
        }
    }

    /// Takes a verified ticket's one-time id at `now` (kept until it expires): Reused if it was taken since its `verify`
    pub fn spend(&self, ticket: &Ticket, now: i64) -> Result<(), Refusal> {
        let mut nonces = self.nonces.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        nonces.retain(|_, &mut until| until.saturating_add(SKEW) > now);
        if nonces.contains_key(&ticket.nonce) {
            return Err(Refusal::Reused);
        }
        nonces.insert(ticket.nonce, ticket.expires);
        Ok(())
    }
}

/// What a ticket's signature and claims are checked for: EdDSA alone, issued by the accounts service, an account and an
/// expiry; its time this module's own rules (the skew, this process's start), a seat's server compared with this
/// server's name by its claim (`net.rs`)
fn validation() -> Validation {
    let mut validation = Validation::new(Algorithm::EdDSA);
    validation.set_issuer(&[ISSUER]);
    validation.set_required_spec_claims(&["exp", "iss", "sub"]);
    validation.validate_exp = false;
    validation.validate_aud = false;
    validation
}

/// `TICKET_PUBLIC_KEYS`'s keys: "KID BASE64" each, separated by commas or new lines; a malformed line, a key not 32
/// bytes, a key of small order, a key id twice or the old published development key refused (AP2-5, RV-1059)
fn parse_keys(list: &str) -> anyhow::Result<HashMap<String, Vec<u8>>> {
    let mut keys = HashMap::new();
    // (an error names the entry by its number, never its text: a seed pasted in the wrong file stays out of the log,
    // RV-953)
    for (n, entry) in
        list.split([',', '\n']).map(str::trim).filter(|e| !e.is_empty()).enumerate().map(|(i, e)| (i + 1, e))
    {
        let (kid, b64) = entry
            .split_once(char::is_whitespace)
            .ok_or_else(|| anyhow::anyhow!("TICKET_PUBLIC_KEYS: key entry {n} isn't \"KID BASE64\""))?;
        let key = STANDARD
            .decode(b64.trim())
            .map_err(|_| anyhow::anyhow!("TICKET_PUBLIC_KEYS: key entry {n} isn't base64"))?;
        anyhow::ensure!(key.len() == 32, "TICKET_PUBLIC_KEYS: key entry {n}'s key isn't 32 bytes");
        anyhow::ensure!(!kid.is_empty() && kid.len() <= 32, "TICKET_PUBLIC_KEYS: key entry {n}'s id isn't 1-32 bytes");
        anyhow::ensure!(!small_order(&key), "TICKET_PUBLIC_KEYS: key entry {n} is of small order (no signer's)");
        anyhow::ensure!(
            key != PUBLISHED_DEV_KEY,
            "TICKET_PUBLIC_KEYS: key entry {n} is the old development key, published (anyone can sign with it)"
        );
        anyhow::ensure!(keys.insert(kid.to_string(), key).is_none(), "TICKET_PUBLIC_KEYS: key entry {n} repeats an id");
    }
    Ok(keys)
}

/// A verified ticket's claims, each in its form; None for a malformed one (a rejoin's has its match and no seat; a seat's
/// its match and a seat in its playlist's roster at a named server; anything else refused)
fn read(claims: Claims) -> Option<Ticket> {
    let account = hex_bytes::<16>(&claims.sub)?;
    let nonce: [u8; 16] = URL_SAFE_NO_PAD.decode(&claims.jti).ok()?.try_into().ok()?;
    let match_id = u64::from_be_bytes(hex_bytes::<8>(&claims.match_id)?);
    if claims.iss != ISSUER || claims.name.is_empty() || claims.name.len() > 32 || match_id == 0 {
        return None;
    }
    let purpose = match (claims.purpose.as_str(), claims.aud, claims.playlist, claims.seat, claims.roster) {
        ("rejoin", None, None, None, None) => Purpose::Rejoin(match_id),
        ("seat", Some(server), Some(playlist), Some(seat), Some(roster))
            if !server.is_empty()
                && server.len() <= MAX_SERVER
                && (1..=3).contains(&playlist)
                && roster == 2 * playlist
                && seat < roster =>
        {
            Purpose::Seat(Seat { match_id, server, playlist, seat, roster })
        }
        _ => return None,
    };
    let ratings = claims.ratings.map(|[rating, deviation]| Shown { rating, deviation });
    Some(Ticket { account, name: claims.name, issued: claims.iat, expires: claims.exp, nonce, ratings, purpose })
}

/// `N` bytes from `2N` hex digits (either case, as the API reads them); None for anything else (a sign too)
fn hex_bytes<const N: usize>(text: &str) -> Option<[u8; N]> {
    if text.len() != 2 * N || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; N];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
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
    use jsonwebtoken::{EncodingKey, Header};
    use ring::signature::{Ed25519KeyPair, KeyPair};

    const NOW: i64 = 1_792_300_000;
    /// An Ed25519 seed's PKCS#8 v1 (RFC 8410) before the seed: the signing key's form jsonwebtoken takes
    const PKCS8_PREFIX: [u8; 16] =
        [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];

    /// A key of the seed `[seed; 32]`: its signing key and the tickets that check with it (key id "test", started at
    /// NOW)
    fn key(seed: u8) -> (EncodingKey, Tickets) {
        let public = Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap().public_key().as_ref().to_vec();
        let tickets = Tickets::from_list(&format!("test {}", STANDARD.encode(public))).unwrap().started_at(NOW);
        (EncodingKey::from_ed_der(&[PKCS8_PREFIX.as_slice(), &[seed; 32]].concat()), tickets)
    }

    /// A rejoin ticket's claims as the API writes them (its match 0xa1), issued and expiring as given, its one-time id
    /// `nonce` 16 times
    fn rejoin_claims(issued: i64, expires: i64, nonce: u8) -> serde_json::Value {
        serde_json::json!({
            "iss": "carball", "sub": "ab".repeat(16), "iat": issued, "exp": expires,
            "jti": URL_SAFE_NO_PAD.encode([nonce; 16]), "name": "Name",
            "ratings": [[1500, 500], [1723, 64], [1312, 110]], "purpose": "rejoin", "match": "00000000000000a1",
        })
    }

    /// Claims signed by hand with `key` (EdDSA, key id "test"), whatever they say
    fn signed(key: &EncodingKey, claims: &serde_json::Value) -> String {
        let mut header = Header::new(Algorithm::EdDSA);
        header.kid = Some("test".into());
        jsonwebtoken::encode(&header, claims, key).unwrap()
    }

    /// A ticket as the API issues one, signed with `key`: `account` named `name` with a new account's ratings, for
    /// `purpose`, issued at `issued` for its purpose's life, a fresh one-time id
    fn issued(key: &EncodingKey, account: [u8; 16], name: &str, purpose: &Purpose, issued: i64) -> String {
        let mut nonce = [0u8; 16];
        getrandom::fill(&mut nonce).unwrap();
        let (rating, deviation) = (DEFAULT_RATING.rating, DEFAULT_RATING.deviation);
        let mut claims = serde_json::json!({
            "iss": "carball", "sub": account.iter().map(|b| format!("{b:02x}")).collect::<String>(), "iat": issued,
            "exp": issued + LIFETIME, "jti": URL_SAFE_NO_PAD.encode(nonce), "name": name,
            "ratings": [[rating, deviation], [rating, deviation], [rating, deviation]], "purpose": "rejoin",
        });
        match purpose {
            Purpose::Rejoin(m) => claims["match"] = format!("{m:016x}").into(),
            Purpose::Seat(seat) => {
                claims["match"] = format!("{:016x}", seat.match_id).into();
                (claims["purpose"], claims["exp"], claims["aud"]) =
                    ("seat".into(), (issued + SEAT_LIFETIME).into(), seat.server.clone().into());
                (claims["playlist"], claims["seat"], claims["roster"]) =
                    (seat.playlist.into(), seat.seat.into(), seat.roster.into());
            }
        }
        signed(key, &claims)
    }

    /// The tickets the API's code made (protocol/ticket_vector.json, api/internal/ticket's vector test: a rejoin's and a
    /// seat's): read as they say
    /// RV-1020: a ticket's use decided one at a time: a second decision while the first is held is refused (Reused); once
    /// it's dropped, free again
    #[test]
    fn a_tickets_use_is_decided_one_at_a_time() {
        let (k, tickets) = key(9);
        let encoded = issued(&k, [7; 16], "Eve", &Purpose::Rejoin(0xd4), NOW);
        let ticket = tickets.verify(&encoded, NOW).unwrap();
        let first = tickets.decide(&ticket).unwrap();
        assert!(matches!(tickets.decide(&ticket), Err(Refusal::Reused)), "a second while the first is decided");
        drop(first);
        assert!(tickets.decide(&ticket).is_ok(), "free again");
    }

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
            assert_eq!((ticket.issued, ticket.expires), (n("issued"), n("expires")));
            assert_eq!(hex(&ticket.nonce), s("nonce"), "its one-time id (RV-959)");
            let ratings: Vec<(u16, u16)> = ticket.ratings.iter().map(|r| (r.rating, r.deviation)).collect();
            let want: Vec<(u16, u16)> = v["ratings"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| (r[0].as_u64().unwrap() as u16, r[1].as_u64().unwrap() as u16))
                .collect();
            assert_eq!(ratings, want);
            let purpose = match (n("purpose"), s("match").parse::<u64>().unwrap()) {
                (1, m) => Purpose::Rejoin(m),
                (2, m) => Purpose::Seat(Seat {
                    match_id: m,
                    server: s("server"),
                    playlist: n("playlist") as u8,
                    seat: n("seat") as u8,
                    roster: n("roster") as u8,
                }),
                other => panic!("{other:?}"),
            };
            assert_eq!(ticket.purpose, purpose);
            assert_eq!(tickets.check(&s("encoded"), n("issued") + 11), Err(Refusal::Reused));
        }
    }

    /// A ticket's claims: a rejoin's with its match and no seat, read back; a search's, a rejoin's of no match or with a
    /// seat, a seat's without one or outside its roster, another issuer, an account, one-time id or match not in their
    /// form, a name empty or too long: refused
    #[test]
    fn a_tickets_claims_are_a_rejoins_or_a_seats() {
        let (k, tickets) = key(6);
        let rejoin = tickets.check(&signed(&k, &rejoin_claims(NOW, NOW + 120, 1)), NOW).unwrap();
        assert_eq!((rejoin.purpose, rejoin.account), (Purpose::Rejoin(0xa1), [0xab; 16]));
        let seat = |c: &mut serde_json::Value, playlist: u8, seat: u8, roster: u8| {
            c["purpose"] = "seat".into();
            c["aud"] = "game.example:4433".into();
            (c["playlist"], c["seat"], c["roster"]) = (playlist.into(), seat.into(), roster.into());
        };
        type Change = fn(&mut serde_json::Value);
        let changes: [(&str, Change); 14] = [
            ("a search's", |c| c["purpose"] = "search".into()),
            ("a rejoin of no match", |c| c["match"] = "0000000000000000".into()),
            ("a rejoin with a seat", |c| c["seat"] = 1.into()),
            ("a rejoin with a server", |c| c["aud"] = "game.example:4433".into()),
            ("a seat without its seat", |c| {
                c["purpose"] = "seat".into();
                c["aud"] = "game.example:4433".into();
                (c["playlist"], c["roster"]) = (1.into(), 2.into());
            }),
            ("a seat outside its roster", |c| c["seat"] = 2.into()),
            ("a seat of two servers", |c| c["aud"] = serde_json::json!(["a.example:1", "b.example:1"])),
            ("another issuer", |c| c["iss"] = "someone".into()),
            ("a short account", |c| c["sub"] = "ab".into()),
            ("a one-time id not 16 bytes", |c| c["jti"] = "AAAA".into()),
            ("a signed match", |c| c["match"] = "+00000000000000a".into()),
            ("no name", |c| c["name"] = "".into()),
            ("a name past 32 bytes", |c| c["name"] = "x".repeat(33).into()),
            ("no expiry", |c| {
                c.as_object_mut().unwrap().remove("exp");
            }),
        ];
        for (i, (what, change)) in changes.into_iter().enumerate() {
            let mut claims = rejoin_claims(NOW, NOW + 120, 10 + i as u8);
            if what.starts_with("a seat outside") || what.starts_with("a seat of two") {
                seat(&mut claims, 1, 0, 2);
            }
            change(&mut claims);
            assert_eq!(tickets.check(&signed(&k, &claims), NOW), Err(Refusal::Malformed), "{what}");
        }
        let mut good_seat = rejoin_claims(NOW, NOW + 30, 40);
        seat(&mut good_seat, 3, 5, 6);
        assert!(tickets.check(&signed(&k, &good_seat), NOW).is_ok(), "a seat that fits");
    }

    #[test]
    fn a_ticket_checks_once_within_its_time() {
        let (k, tickets) = key(10);
        let account = [7u8; 16];
        let fresh = || issued(&k, account, "Made Up", &Purpose::Rejoin(0xa1), NOW);
        let encoded = fresh();
        assert!(encoded.len() <= MAX_BYTES);
        let ticket = tickets.check(&encoded, NOW + 10).unwrap();
        assert_eq!(
            ticket,
            Ticket {
                account,
                name: "Made Up".into(),
                issued: NOW,
                expires: NOW + LIFETIME,
                nonce: ticket.nonce,
                ratings: [DEFAULT_RATING; 3],
                purpose: Purpose::Rejoin(0xa1)
            }
        );
        assert_eq!(tickets.check(&encoded, NOW + 11), Err(Refusal::Reused), "used once");
        assert_eq!(
            tickets.check(&fresh(), NOW + LIFETIME + SKEW),
            Err(Refusal::OutOfTime),
            "past its time and the skew"
        );
        assert_eq!(tickets.check(&fresh(), NOW - SKEW - 1), Err(Refusal::OutOfTime), "before it was issued");
        assert!(tickets.check(&fresh(), NOW + LIFETIME + SKEW - 1).is_ok(), "within the skew");
        // (the skew pinned, and a one-time id kept to the end of its ticket's time and the skew: a replay a second before
        // refused as used, at that end as out of its time (RV-952's R5, R7))
        assert_eq!(SKEW, 30);
        let replayed = fresh();
        assert!(tickets.check(&replayed, NOW).is_ok());
        assert_eq!(
            tickets.check(&replayed, NOW + LIFETIME + SKEW - 1),
            Err(Refusal::Reused),
            "a second before the end"
        );
        assert_eq!(tickets.check(&replayed, NOW + LIFETIME + SKEW), Err(Refusal::OutOfTime), "at the end");
    }

    /// A header with anything but alg EdDSA, kid and typ JWT (crit, b64, x5c, jku; no typ; a member twice), a claim
    /// jsonwebtoken would have taken (an unknown one, one twice, a null aud, a float time): refused (RV-947, RV-954); an
    /// unknown key id with a key listed: refused as unknown (RV-952's R8); a validly signed ticket past MAX_BYTES:
    /// refused for its length (RV-952's R1)
    #[test]
    fn a_ticket_says_what_the_apis_say_and_no_more() {
        let (k, tickets) = key(6);
        let raw = |header: &str, payload: &str| {
            let message = format!("{}.{}", URL_SAFE_NO_PAD.encode(header), URL_SAFE_NO_PAD.encode(payload));
            let signature = jsonwebtoken::crypto::sign(message.as_bytes(), &k, Algorithm::EdDSA).unwrap();
            format!("{message}.{signature}")
        };
        let head = r#"{"alg":"EdDSA","kid":"test","typ":"JWT"}"#;
        let body = serde_json::to_string(&rejoin_claims(NOW, NOW + 120, 1)).unwrap();
        assert!(tickets.check(&raw(head, &body), NOW).is_ok(), "the hand-made ticket itself");
        let swap = |from: &str, to: &str| body.replacen(from, to, 1);
        for (what, header, payload) in [
            ("crit", r#"{"alg":"EdDSA","kid":"test","typ":"JWT","crit":["exp"]}"#, body.clone()),
            ("b64", r#"{"alg":"EdDSA","kid":"test","typ":"JWT","b64":false}"#, body.clone()),
            ("x5c", r#"{"alg":"EdDSA","kid":"test","typ":"JWT","x5c":["AAAA"]}"#, body.clone()),
            ("jku", r#"{"alg":"EdDSA","kid":"test","typ":"JWT","jku":"https://x.example"}"#, body.clone()),
            ("no typ", r#"{"alg":"EdDSA","kid":"test"}"#, body.clone()),
            // (its value read too, not its presence alone: RV-1006's RN6)
            ("typ JOSE", r#"{"alg":"EdDSA","kid":"test","typ":"JOSE"}"#, body.clone()),
            ("typ jwt", r#"{"alg":"EdDSA","kid":"test","typ":"jwt"}"#, body.clone()),
            ("kid twice", r#"{"alg":"EdDSA","kid":"test","kid":"test","typ":"JWT"}"#, body.clone()),
            ("an unknown claim", head, swap(r#""iss""#, r#""admin":true,"iss""#)),
            ("a claim twice", head, swap(r#""iss":"carball""#, r#""iss":"carball","iss":"carball""#)),
            ("a null aud", head, swap(r#""iss""#, r#""aud":null,"iss""#)),
            ("a float time", head, swap(&format!(r#""iat":{NOW}"#), &format!(r#""iat":{NOW}.5"#))),
        ] {
            assert_eq!(tickets.check(&raw(header, &payload), NOW), Err(Refusal::Malformed), "{what}");
        }
        let listed = Tickets::from_list(&format!("other {}", STANDARD.encode([9u8; 32]))).unwrap().started_at(NOW);
        assert_eq!(listed.check(&raw(head, &body), NOW), Err(Refusal::UnknownKey), "a key listed, not its id");
        // (the longest a key id, a server and a name can make it: each character one JSON writes as 6 bytes)
        let escaped = |n: usize| r"\u003c".repeat(n);
        let long_kid = "<".repeat(32);
        let (long_key, _) = key(7);
        let long_list = format!(
            "{long_kid} {}",
            STANDARD.encode(Ed25519KeyPair::from_seed_unchecked(&[7; 32]).unwrap().public_key().as_ref())
        );
        let long_tickets = Tickets::from_list(&long_list).unwrap().started_at(NOW);
        let long_head = format!(r#"{{"alg":"EdDSA","kid":"{}","typ":"JWT"}}"#, escaped(32));
        let long_body = format!(
            r#"{{"iss":"carball","sub":"{}","aud":"{}:4433","iat":{NOW},"exp":{},"jti":"{}","name":"{}","ratings":[[1,1],[1,1],[1,1]],"purpose":"seat","match":"00000000000000a1","playlist":3,"seat":5,"roster":6}}"#,
            "ab".repeat(16),
            escaped(58),
            NOW + 30,
            URL_SAFE_NO_PAD.encode([1u8; 16]),
            escaped(32)
        );
        let message = format!("{}.{}", URL_SAFE_NO_PAD.encode(&long_head), URL_SAFE_NO_PAD.encode(&long_body));
        let long = format!(
            "{message}.{}",
            jsonwebtoken::crypto::sign(message.as_bytes(), &long_key, Algorithm::EdDSA).unwrap()
        );
        assert!(long.len() > MAX_BYTES, "{}", long.len());
        assert_eq!(long_tickets.check(&long, NOW), Err(Refusal::Malformed), "past MAX_BYTES");
    }

    /// A match ticket: its seat read back, at its server, its life a seat's
    #[test]
    fn a_match_tickets_seat_reads_back() {
        let (k, tickets) = key(11);
        let seat = Seat { match_id: 0xfeed, server: "game-eu.example:4433".into(), playlist: 3, seat: 5, roster: 6 };
        let ticket =
            tickets.check(&issued(&k, [7; 16], "Made Up", &Purpose::Seat(seat.clone()), NOW), NOW + 1).unwrap();
        assert_eq!((ticket.purpose, ticket.expires), (Purpose::Seat(seat), NOW + SEAT_LIFETIME));
    }

    /// Another key's signature, a changed payload, alg none, an HMAC keyed with the public key, not a JWT, too long, an
    /// unknown key id: refused
    #[test]
    fn a_ticket_of_another_key_or_changed_is_refused() {
        let (signer, ours) = key(2);
        // (the same key id, another key: a key "test" listed, a ticket signed by another)
        let ((_, tests), (other, _)) = (key(3), key(4));
        let foreign = signed(&other, &rejoin_claims(NOW, NOW + 120, 1));
        assert_eq!(tests.check(&foreign, NOW), Err(Refusal::BadSignature), "the same key id, another key");
        let encoded = issued(&signer, [1; 16], "Name", &Purpose::Rejoin(0xa1), NOW);
        let parts: Vec<&str> = encoded.split('.').collect();
        let payload = String::from_utf8(URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        let changed = URL_SAFE_NO_PAD.encode(payload.replace("\"name\":\"Name\"", "\"name\":\"Mame\""));
        assert_ne!(changed, parts[1]);
        let tampered = format!("{}.{changed}.{}", parts[0], parts[2]);
        assert_eq!(ours.check(&tampered, NOW), Err(Refusal::BadSignature), "its payload changed");
        let none = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","kid":"test","typ":"JWT"}"#);
        assert_eq!(ours.check(&format!("{none}.{}.", parts[1]), NOW), Err(Refusal::Malformed), "alg none");
        let public = ours.keys.read().unwrap()["test"].clone();
        let mut hs = Header::new(Algorithm::HS256);
        hs.kid = Some("test".into());
        let claims: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let confused = jsonwebtoken::encode(&hs, &claims, &EncodingKey::from_secret(&public)).unwrap();
        assert_eq!(ours.check(&confused, NOW), Err(Refusal::Malformed), "HS256 keyed with the public key");
        assert_eq!(ours.check("!!", NOW), Err(Refusal::Malformed));
        assert_eq!(ours.check(&"A".repeat(MAX_BYTES + 1), NOW), Err(Refusal::Malformed));
        let nobody = Tickets::from_list("").unwrap();
        assert_eq!(nobody.check(&encoded, NOW), Err(Refusal::UnknownKey), "no key of that id");
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
        // (an error names the entry, never its text: RV-953)
        let secret = "c2VlZC1vZi1hLWtleS1uZXZlci10by1iZS1sb2dnZWQhIQ==";
        for list in [secret.to_string(), format!("k1 {secret}"), format!("k1 {b64}, k1 {secret}")] {
            let err = Tickets::from_list(&list).unwrap_err().to_string();
            assert!(!err.contains(secret) && err.contains("entry"), "{err}");
        }
        assert!(Tickets::from_list("").unwrap().is_empty());
        assert_eq!(account_key(&[0; 16]), 1, "never 0");
        assert_eq!(account_key(&[0, 0, 0, 0, 0, 0, 0, 2, 9, 9, 9, 9, 9, 9, 9, 9]), 2);
    }

    /// AP2-3, AP2-4: a ticket ending at the end of time, one ending before it began, or one longer than the API's: refused,
    /// and the checks after still sound; one issued before this process started (its one-time id maybe used before):
    /// refused
    #[test]
    fn a_tickets_life_is_the_apis_and_from_this_process_on() {
        let (k, tickets) = key(5);
        let at = |issued: i64, expires: i64, nonce: u8| signed(&k, &rejoin_claims(issued, expires, nonce));
        assert_eq!(tickets.check(&at(NOW, i64::MAX, 1), NOW), Err(Refusal::Malformed), "a lifetime to the end");
        assert_eq!(tickets.check(&at(NOW, NOW - 1, 2), NOW), Err(Refusal::Malformed), "ends before it begins");
        assert_eq!(
            tickets.check(&at(NOW, NOW + LIFETIME + 1, 3), NOW),
            Err(Refusal::Malformed),
            "past a rejoin's life"
        );
        // (a seat's life its own: 30 s, RV-950)
        let mut seat = rejoin_claims(NOW, NOW + SEAT_LIFETIME + 1, 8);
        seat["purpose"] = "seat".into();
        seat["aud"] = "game.example:4433".into();
        (seat["playlist"], seat["seat"], seat["roster"]) = (1.into(), 0.into(), 2.into());
        assert_eq!(tickets.check(&signed(&k, &seat), NOW), Err(Refusal::Malformed), "past a seat's life");
        seat["exp"] = (NOW + SEAT_LIFETIME).into();
        seat["jti"] = URL_SAFE_NO_PAD.encode([9u8; 16]).into();
        assert!(tickets.check(&signed(&k, &seat), NOW).is_ok(), "a seat's 30 s");
        assert!(tickets.check(&at(NOW, NOW + LIFETIME, 4), NOW + 1).is_ok(), "the checks after: sound");
        assert_eq!(
            tickets.check(&at(NOW - SKEW - 1, NOW + 60, 5), NOW + 10),
            Err(Refusal::OutOfTime),
            "before the start"
        );
        assert_eq!(
            tickets.check(&at(NOW - 1, NOW + 60, 6), NOW + 10),
            Err(Refusal::OutOfTime),
            "a second before the start, within the skew: its one-time id maybe used before (AP3)"
        );
        assert!(tickets.check(&at(NOW, NOW + 60, 7), NOW + 10).is_ok(), "issued as it started");
    }

    /// AP2-5: a key of small order, a key id twice: refused; a reload replaces the listed keys, and a bad list changes
    /// nothing
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
        // (the old development key, its seed published: refused under any id, RV-1059)
        let seed = ring::digest::digest(&ring::digest::SHA256, b"carball development ticket key");
        let dev = Ed25519KeyPair::from_seed_unchecked(seed.as_ref()).unwrap();
        assert_eq!(dev.public_key().as_ref(), PUBLISHED_DEV_KEY);
        let e = Tickets::from_list(&format!("prod {}", STANDARD.encode(PUBLISHED_DEV_KEY))).unwrap_err().to_string();
        assert!(e.contains("old development key"), "{e}");
        let tickets = Tickets::from_list(&format!("k1 {}", b64(1))).unwrap();
        tickets.reload(&format!("k2 {}", b64(2))).unwrap();
        assert_eq!(tickets.key_ids(), ["k2"]);
        assert!(tickets.reload(" , ").is_err(), "no key");
        assert!(tickets.reload(&format!("k3 {}", STANDARD.encode(SMALL_ORDER[1]))).is_err());
        assert_eq!(tickets.key_ids(), ["k2"], "unchanged");
    }
}
