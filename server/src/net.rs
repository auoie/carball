//! WebTransport front end: accepts sessions on `/play`, reads the player's `Hello` from the control stream, then
//! forwards input datagrams to the game and the game's messages to the client (`protocol/README.md`). What it lets in
//! (the security review's SEC-2, SEC-3, SEC-5: `NetLimits`): QUIC's stream and buffer limits, an address proven before
//! anything is spent on it (RV-366), sessions at once and per address, the handshakes' deadlines, the page's origin, each
//! session's message rates.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv6Addr};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use tokio::sync::mpsc::{Sender, channel};
use wtransport::endpoint::IncomingSession;
use wtransport::{Endpoint, Identity, ServerConfig};

use crate::game::{JoinRequest, OUT_QUEUE, Outgoing, PlayerId};
use crate::protocol::{self, Control, Datagram, InputFrame};

/// What a session is for (its hello's intent)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Intent {
    /// Join the server's open match (development servers)
    Join,
    /// Claim a seat with its match ticket (the matchmaker's, for this server: notes/matchmaking.md, the central
    /// matchmaker)
    Claim { seat: crate::match_host::SeatClaim },
    /// Rejoin the ranked match left by accident (its id: Welcome's `match_id`; LV1)
    Rejoin { match_id: u64 },
}

/// An input datagram as the game thread takes it
#[derive(Debug, PartialEq)]
pub struct Inputs {
    pub timestamp: u32,
    pub sequence: u16,
    pub first_frame: u32,
    pub frames: Vec<InputFrame>,
    /// When it arrived
    pub at: std::time::Instant,
}

/// A session's newest input datagram, waiting for the game thread: one at a time, a newer one taking its place (each
/// carries the newest frames, an older one's among them: the rest as if lost). The game's queue holds one note of it
/// at most for each session, so neither a session's flood nor a stalled game thread drops another's inputs (RV-991)
#[derive(Debug, Default)]
pub struct InputSlot(Mutex<Option<Inputs>>);

impl InputSlot {
    /// Puts `inputs` in, in place of any there: whether the slot was empty (a note of it then due)
    fn put(&self, inputs: Inputs) -> bool {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).replace(inputs).is_none()
    }

    /// The datagram waiting, taken out
    pub fn take(&self) -> Option<Inputs> {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()
    }
}

/// A session's input datagram to the game: into its slot, noted in the game's queue if the slot was empty; the queue full
/// (a stalled game thread), the slot emptied, its datagram as lost, so that the next one is noted; Err once the game's
/// gone
fn deliver_inputs(to_game: &Sender<ToGame>, id: PlayerId, slot: &Arc<InputSlot>, inputs: Inputs) -> Result<(), ()> {
    if !slot.put(inputs) {
        return Ok(());
    }
    match to_game.try_send(ToGame::Inputs { id, slot: slot.clone() }) {
        Ok(()) => Ok(()),
        Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
            slot.take();
            Ok(())
        }
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => Err(()),
    }
}

/// Messages from the network tasks to the game loop
#[derive(Debug)]
pub enum ToGame {
    Join {
        id: PlayerId,
        intent: Intent,
        request: JoinRequest,
        out: Sender<Outgoing>,
    },
    /// The session ended; `lost`: its connection timed out
    Leave {
        id: PlayerId,
        lost: bool,
    },
    /// The session's newest input datagram is waiting in its slot (`InputSlot`)
    Inputs {
        id: PlayerId,
        slot: Arc<InputSlot>,
    },
    ResetInputBuffer {
        id: PlayerId,
    },
    /// Skip the goal replay
    ReadyUp {
        id: PlayerId,
    },
    AutoSkipReplay {
        id: PlayerId,
        on: bool,
    },
    /// Vote to forfeit (starts or joins the team's vote)
    VoteForfeit {
        id: PlayerId,
    },
    /// A quick-chat preset
    QuickChat {
        id: PlayerId,
        preset: u8,
        team: bool,
    },
    /// The player's chat filters
    ChatFilter {
        id: PlayerId,
        quick_chat: u8,
        block_non_tactical: bool,
    },
    /// The player muted or unmuted another player's chat
    Mute {
        id: PlayerId,
        car: u32,
        on: bool,
    },
    /// The connection's round-trip time (ms)
    Ping {
        id: PlayerId,
        ms: u32,
    },
}

/// Development identity: self-signed for localhost, valid 14 days (the browser limit for certificate hashes)
pub fn dev_identity() -> anyhow::Result<(Identity, [u8; 32])> {
    let identity = Identity::self_signed(["localhost", "127.0.0.1", "::1"])?;
    let hash = *identity.certificate_chain().as_slice()[0].hash().as_ref();
    Ok((identity, hash))
}

pub type ServerEndpoint = Endpoint<wtransport::endpoint::endpoint_side::Server>;

/// The server's configuration with its identity: QUIC's limits for a game session (SEC-2: a session opens two
/// bidirectional streams, HTTP/3's three unidirectional ones; small receive windows, so a session can't make the server
/// buffer much), a keep-alive every 2 s and a 10 s idle timeout
pub fn server_config(identity: Identity, port: u16) -> anyhow::Result<ServerConfig> {
    let mut transport = wtransport::config::QuicTransportConfig::default();
    transport
        .max_concurrent_bidi_streams(4u32.into())
        .max_concurrent_uni_streams(4u32.into())
        .stream_receive_window(256_000u32.into())
        .receive_window(1_000_000u32.into())
        .datagram_receive_buffer_size(Some(64 * 1024))
        .send_window(1_000_000);
    // (dual-stack, [::]: IPv6 clients served too, the hosts on host networking, RV-406 lifted 2026-10-23)
    Ok(ServerConfig::builder()
        .with_bind_default(port)
        .with_custom_transport(identity, transport)
        .keep_alive_interval(Some(Duration::from_secs(2)))
        .max_idle_timeout(Some(Duration::from_secs(10)))?
        .build())
}

pub fn endpoint(identity: Identity, port: u16) -> anyhow::Result<ServerEndpoint> {
    Ok(Endpoint::server(server_config(identity, port)?)?)
}

/// A public server's certificate chain and key, from their PEM files, checked to be a pair: wtransport's configuration
/// panics on a key that isn't the certificate's (RV-368: a renewal read between its two writes would end the reloads)
pub async fn load_identity(cert: &Path, key: &Path) -> anyhow::Result<Identity> {
    let identity = Identity::load_pemfiles(cert, key).await?;
    check_pair(&identity)?;
    Ok(identity)
}

/// The identity as wtransport's server configuration takes it (the same calls), an error where they'd panic
fn check_pair(identity: &Identity) -> anyhow::Result<()> {
    use rustls::pki_types::pem::PemObject;
    use rustls::pki_types::{CertificateDer, PrivateKeyDer};
    use wtransport::tls::rustls;
    let chain =
        identity.certificate_chain().as_slice().iter().map(|c| CertificateDer::from(c.der().to_vec())).collect();
    let key =
        PrivateKeyDer::from_pem_slice(identity.private_key().to_secret_pem().as_bytes()).context("the private key")?;
    rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .context("the key is not the certificate's")?;
    Ok(())
}

/// What the front end lets in: sessions at once, per address at once and as they start (SEC-2; an address as
/// `address_key` counts it: a LAN party's players behind one IPv4 address, or one IPv6 /64, all of them: the user's
/// decision of 2026-10-23), the page origins allowed (SEC-5; None: any, a development server). The defaults are a public
/// server's, to tune from the benchmark's hostile mode; the browser tests' servers, every page on one address, raise the
/// per-address limits
#[derive(Clone, Debug)]
pub struct NetLimits {
    pub max_sessions: usize,
    pub per_address: usize,
    /// An address's claims and rejoins (any hello but a ping) as they come: a whole LAN party's at once, then steady
    pub claims: Rate,
    /// Its region pings (each search pings every region, the Play page twice: RV-870), apart from the claims, so that
    /// pings can't use up the claims' (no player's claim a no-show for the pings of others behind its address)
    pub pings: Rate,
    pub allowed_origins: Option<Vec<String>>,
    /// The handshake, from the first packet through the hello, must be done this soon
    pub handshake: Duration,
    /// Its QUIC part, through the session's request (a browser sends it at once), this soon (RV-366)
    pub quic_handshake: Duration,
    /// The match and rejoin tickets checked (notes/accounts.md §3): a queue server's always (`main` requires its keys, or
    /// --dev's); None, no claim or rejoin taken (a direct development server, the tests')
    pub tickets: Option<Arc<crate::ticket::Tickets>>,
    /// This server's name as a match ticket names it (its address, host:port: `PUBLIC_HOST` and its port); None, no match
    /// ticket taken (RV-956: the tests' servers that take none)
    pub server_name: Option<String>,
    /// The accounts service, asked before a rejoin is let in (RV-1008); None, no one to ask (a development server without
    /// one: its rejoins unconfirmed)
    pub api: Option<Arc<crate::outbox::Api>>,
}

impl Default for NetLimits {
    fn default() -> Self {
        Self {
            max_sessions: 512,
            per_address: 64,
            claims: Rate { burst: 64, per_minute: 60 },
            pings: Rate { burst: 192, per_minute: 240 },
            allowed_origins: None,
            handshake: Duration::from_secs(10),
            quic_handshake: Duration::from_secs(4),
            tickets: None,
            server_name: None,
            api: None,
        }
    }
}
/// How long a ping's session waits for its Pong to go out before it closes (RV-856: its slot free at once)
const PING_FLUSH: Duration = Duration::from_millis(100);

/// Each session's rates (SEC-3), a second and a burst: input datagrams (a client sends one a frame; more are dropped, as
/// lost packets) and control messages (more are dropped)
const INPUT_RATE: (f64, f64) = (240.0, 120.0);
const CONTROL_RATE: (f64, f64) = (20.0, 40.0);
/// The messages dropped over those rates a session may run up, a second and at most: past that it's closed. They drain,
/// so a client now and then over its rate (a 360 Hz display's frames: 120 inputs a second dropped) never is; a flood of
/// either kind is (RV-373)
const INPUT_OVERRUN: (f64, f64) = (500.0, 5000.0);
const CONTROL_OVERRUN: (f64, f64) = (2.0, 200.0);

/// A token bucket: `rate` a second, `burst` at most
#[derive(Clone, Debug)]
pub struct TokenBucket {
    rate: f64,
    burst: f64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new((rate, burst): (f64, f64), now: Instant) -> Self {
        Self { rate, burst, tokens: burst, last: now }
    }

    /// One token, if there's one
    pub fn take(&mut self, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.rate).min(self.burst);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// The address a session's limits count against: an IPv4 address (an IPv4-mapped IPv6 one as its IPv4: the server's
/// socket is dual-stack), an IPv6 address's /64, one host's usual share (RV-366)
pub fn address_key(ip: IpAddr) -> IpAddr {
    match ip.to_canonical() {
        IpAddr::V6(v6) => {
            let s = v6.segments();
            IpAddr::V6(Ipv6Addr::new(s[0], s[1], s[2], s[3], 0, 0, 0, 0))
        }
        v4 => v4,
    }
}

/// A rate per client address: `burst` at once, then `per_minute` (governor's GCRA: the allowance refills steadily, one
/// every minute / `per_minute`)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rate {
    pub burst: u32,
    pub per_minute: u32,
}

impl Rate {
    fn quota(self) -> governor::Quota {
        let at_least_one = |n: u32| std::num::NonZeroU32::new(n.max(1)).unwrap_or(std::num::NonZeroU32::MIN);
        governor::Quota::per_minute(at_least_one(self.per_minute)).allow_burst(at_least_one(self.burst))
    }

    /// Two rates' sum (the starts', both kinds')
    fn and(self, other: Self) -> Self {
        Self {
            burst: self.burst.saturating_add(other.burst),
            per_minute: self.per_minute.saturating_add(other.per_minute),
        }
    }
}

impl std::str::FromStr for Rate {
    type Err = String;

    /// "BURST/PER_MINUTE", e.g. "64/60"
    fn from_str(text: &str) -> Result<Self, String> {
        let (burst, per_minute) = text.split_once('/').ok_or("BURST/PER_MINUTE, e.g. 64/60")?;
        let number = |n: &str| n.trim().parse::<u32>().ok().filter(|&n| n > 0).ok_or("whole numbers above 0");
        Ok(Self { burst: number(burst)?, per_minute: number(per_minute)? })
    }
}

/// What becomes of a connection attempt: an address not yet proven is sent a Retry before anything is spent on it (a
/// spoofed Initial holds no slot, RV-366); a proven one is refused past the limits, else admitted (its permit kept for
/// the session)
#[derive(Debug)]
pub enum Admit {
    Retry,
    /// Past a limit: which (the log's)
    Refuse(&'static str),
    Admit(tokio::sync::OwnedSemaphorePermit),
}

pub fn admit<C: governor::clock::Clock + Clone>(
    validated: bool,
    address: IpAddr,
    sessions: &Arc<tokio::sync::Semaphore>,
    admission: &Mutex<Admission<C>>,
    limits: &NetLimits,
) -> Admit {
    if !validated {
        return Admit::Retry;
    }
    let Ok(permit) = sessions.clone().try_acquire_owned() else { return Admit::Refuse("the server's most sessions") };
    if let Err(why) = admission.lock().unwrap().admit(address, limits) {
        return Admit::Refuse(why);
    }
    Admit::Admit(permit)
}

/// What a session's hello asks for, as an address's allowances count it
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A region's ping
    Ping,
    /// A claim, a rejoin, or any other hello (refused later or not)
    Claim,
}

type Bucket<C> = governor::RateLimiter<
    IpAddr,
    governor::state::keyed::HashMapStateStore<IpAddr>,
    C,
    governor::middleware::NoOpMiddleware<<C as governor::clock::Clock>::Instant>,
>;

/// The sessions of each address (`address_key`): at once, and as they start (SEC-2; governor's keyed buckets, the 60 s
/// windows and the pings' refund before them, RV-870/900/909/919). A session is charged as it's admitted, its hello's
/// kind not yet known (both kinds' rates together: a connect-and-close loop bounded too), then its hello's kind's own
#[derive(Debug)]
pub struct Admission<C: governor::clock::Clock + Clone = governor::clock::DefaultClock> {
    clock: C,
    active: HashMap<IpAddr, usize>,
    starts: Bucket<C>,
    claims: Bucket<C>,
    pings: Bucket<C>,
    /// When the buckets' idle addresses and the refusals' lines were last let go: once a minute at most (RV-909)
    swept: Option<C::Instant>,
    /// Each address's refusals, by why: when the last was logged, and how many since unlogged (a flood's refusals write
    /// a line a minute, counted: RV-970)
    refusals: HashMap<(IpAddr, &'static str), (C::Instant, u64)>,
}

const MINUTE: Duration = Duration::from_secs(60);

impl Admission {
    pub fn new(limits: &NetLimits) -> Self {
        Self::with_clock(limits, governor::clock::DefaultClock::default())
    }
}

impl<C: governor::clock::Clock + Clone> Admission<C> {
    pub fn with_clock(limits: &NetLimits, clock: C) -> Self {
        let bucket = |rate: Rate| Bucket::hashmap_with_clock(rate.quota(), clock.clone());
        Self {
            starts: bucket(limits.claims.and(limits.pings)),
            claims: bucket(limits.claims),
            pings: bucket(limits.pings),
            clock,
            active: HashMap::new(),
            swept: None,
            refusals: HashMap::new(),
        }
    }

    fn since(&self, then: C::Instant) -> Duration {
        Duration::from(governor::clock::Reference::duration_since(&self.clock.now(), then))
    }

    /// A new session from `address`, if its limits allow it (counted then: `release` when it ends); else why not
    pub fn admit(&mut self, address: IpAddr, limits: &NetLimits) -> Result<(), &'static str> {
        self.sweep_due();
        if self.active.get(&address).copied().unwrap_or(0) >= limits.per_address {
            return Err("its address's sessions at once");
        }
        if self.starts.check_key(&address).is_err() {
            return Err("its address's new sessions");
        }
        *self.active.entry(address).or_default() += 1;
        Ok(())
    }

    /// A session's hello of `kind` from `address`, if that kind's allowance has room
    pub fn charge(&self, address: IpAddr, kind: Kind) -> bool {
        match kind {
            Kind::Ping => self.pings.check_key(&address).is_ok(),
            Kind::Claim => self.claims.check_key(&address).is_ok(),
        }
    }

    /// Whether a refusal of `address` for `why` is logged: its first in a minute, with how many went unlogged since the
    /// last line (a flood of refusals writes a line a minute, not one each)
    pub fn log_refusal(&mut self, address: IpAddr, why: &'static str) -> Option<u64> {
        let now = self.clock.now();
        let logged = match self.refusals.get(&(address, why)).copied() {
            Some((logged, unlogged)) if self.since(logged) < MINUTE => {
                self.refusals.insert((address, why), (logged, unlogged + 1));
                None
            }
            Some((_, unlogged)) => {
                self.refusals.insert((address, why), (now, 0));
                Some(unlogged)
            }
            None => {
                self.refusals.insert((address, why), (now, 0));
                Some(0)
            }
        };
        // (its own first: the sweep then says the others' counts; refusals at the global cap, which never reach `admit`,
        // sweep too, RV-970)
        self.sweep_due();
        logged
    }

    /// Once a minute: the buckets' addresses whose allowance is whole again let go (they'd otherwise stay, one for every
    /// address ever seen, RV-909; their next session makes theirs anew), and the refusals' lines over a minute old,
    /// those it held unlogged said then
    fn sweep_due(&mut self) {
        if self.swept.is_some_and(|t| self.since(t) < MINUTE) {
            return;
        }
        self.swept = Some(self.clock.now());
        for bucket in [&self.starts, &self.claims, &self.pings] {
            bucket.retain_recent();
            bucket.shrink_to_fit();
        }
        let old: Vec<_> =
            self.refusals.iter().filter(|(_, (at, _))| self.since(*at) >= MINUTE).map(|(k, v)| (*k, *v)).collect();
        for ((address, why), (_, unlogged)) in old {
            self.refusals.remove(&(address, why));
            if unlogged > 0 {
                tracing::warn!(
                    "sessions from {address}: {unlogged} more refused ({why}) in the minute after its last line"
                );
            }
        }
    }

    pub fn release(&mut self, address: IpAddr) {
        if let Some(n) = self.active.get_mut(&address) {
            *n -= 1;
            if *n == 0 {
                self.active.remove(&address);
            }
        }
    }
}

/// A session's address and its admission: its hello's kind charged, its refusals logged a line a minute
pub struct Admitted {
    admission: Arc<Mutex<Admission>>,
    address: IpAddr,
}

impl Admitted {
    fn charge(&self, kind: Kind) -> bool {
        self.admission.lock().unwrap().charge(self.address, kind)
    }

    /// A refusal of this session's for `why`, its line if it's the address's first in a minute
    fn refused(&self, peer: std::net::SocketAddr, why: &'static str) {
        if let Some(unlogged) = self.admission.lock().unwrap().log_refusal(self.address, why) {
            let since = if unlogged > 0 { format!(", {unlogged} more since the last line") } else { String::new() };
            tracing::warn!("session from {peer} refused: {why} (its address's next this minute unlogged{since})");
        }
    }
}

pub async fn accept_loop(server: Arc<ServerEndpoint>, to_game: Sender<ToGame>, limits: NetLimits) {
    let mut next_id: PlayerId = 1;
    let sessions = Arc::new(tokio::sync::Semaphore::new(limits.max_sessions));
    let admission = Arc::new(Mutex::new(Admission::new(&limits)));
    let limits = Arc::new(limits);
    loop {
        let incoming = server.accept().await;
        // (an IPv4 client as a.b.c.d, as the accounts service's lines name it, not [::ffff:a.b.c.d]: RV-967)
        let peer = incoming.remote_address();
        let peer = std::net::SocketAddr::new(peer.ip().to_canonical(), peer.port());
        let address = address_key(peer.ip());
        let admitted = Admitted { admission: admission.clone(), address };
        let permit = match admit(incoming.remote_address_validated(), address, &sessions, &admission, &limits) {
            Admit::Retry => {
                incoming.retry();
                continue;
            }
            Admit::Refuse(why) => {
                admitted.refused(peer, why);
                incoming.refuse();
                continue;
            }
            Admit::Admit(permit) => permit,
        };
        let id = next_id;
        next_id += 1;
        let to_game = to_game.clone();
        let limits = limits.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let lost = match session(incoming, peer, id, &to_game, &limits, &admitted).await {
                Ok(lost) => lost,
                Err(e) => {
                    tracing::info!("{}", session_end_line(id, peer, &e));
                    matches!(
                        e.downcast_ref::<wtransport::error::ConnectionError>(),
                        Some(wtransport::error::ConnectionError::TimedOut)
                    )
                }
            };
            let _ = to_game.send(ToGame::Leave { id, lost }).await;
            admitted.admission.lock().unwrap().release(address);
        });
    }
}

/// Text a client may have written (a QUIC close's reason, in a session's error), made one line for the log: control
/// characters (CR, LF and the rest, Unicode's line and paragraph separators too) escaped, so it can't make a line of its
/// own that reads as the server's (RV-1009; names are logged quoted, `{name:?}`, escaped the same)
pub fn one_line(text: &str) -> std::borrow::Cow<'_, str> {
    let escaped = |c: char| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}');
    if !text.contains(escaped) {
        return std::borrow::Cow::Borrowed(text);
    }
    text.chars().map(|c| if escaped(c) { c.escape_default().to_string() } else { c.to_string() }).collect()
}

/// The line a session's error ends it with: its player and address, then the error, one line
fn session_end_line(id: PlayerId, peer: std::net::SocketAddr, e: &anyhow::Error) -> String {
    format!("player {id} ({peer}): {}", one_line(&format!("{e:#}")))
}

/// Refuses a session's hello with `reason`, then gives the client a moment to close
async fn refuse(send: &mut wtransport::SendStream, connection: &wtransport::Connection, reason: u8) {
    let _ = send.write_all(&Control::Refused { reason }.encode()).await;
    let _ = send.finish().await;
    let _ = tokio::time::timeout(Duration::from_secs(2), connection.closed()).await;
}

async fn read_control(recv: &mut wtransport::RecvStream) -> anyhow::Result<Control> {
    Ok(Control::decode(&read_body(recv).await?)?)
}

async fn read_body(recv: &mut wtransport::RecvStream) -> anyhow::Result<Vec<u8>> {
    let mut len = [0u8; 2];
    recv.read_exact(&mut len).await?;
    let mut body = vec![0u8; usize::from(u16::from_le_bytes(len))];
    recv.read_exact(&mut body).await?;
    Ok(body)
}

/// The client's hello, its version checked before the rest is read (another version's fields don't decode: RV-243);
/// `Err(version)`: another version's
async fn read_hello(recv: &mut wtransport::RecvStream) -> anyhow::Result<Result<Control, u16>> {
    let body = read_body(recv).await?;
    match protocol::hello_version(&body) {
        Some(version) if version != protocol::VERSION => Ok(Err(version)),
        _ => Ok(Ok(Control::decode(&body)?)),
    }
}

/// The session up to its hello: the request (its path and its page's origin checked: SEC-5), the connection, the control
/// stream, the hello
async fn handshake(
    incoming: IncomingSession,
    limits: &NetLimits,
) -> anyhow::Result<
    Option<(wtransport::Connection, wtransport::SendStream, wtransport::RecvStream, Result<Control, u16>)>,
> {
    let request =
        tokio::time::timeout(limits.quic_handshake, incoming).await.context("no QUIC handshake in time")??;
    if request.path() != "/play" {
        request.not_found().await;
        return Ok(None);
    }
    if let Some(allowed) = &limits.allowed_origins
        && !request.origin().is_some_and(|origin| allowed.iter().any(|a| a.eq_ignore_ascii_case(origin)))
    {
        // (an IPv4 client as a.b.c.d, RV-967, RV-1010)
        let from = request.remote_address();
        let from = std::net::SocketAddr::new(from.ip().to_canonical(), from.port());
        tracing::warn!("session from {from} refused: its page's origin {:?}", request.origin());
        request.forbidden().await;
        return Ok(None);
    }
    let connection = request.accept().await?;
    let (send, mut recv) = connection.accept_bi().await.context("no control stream")?;
    let hello = read_hello(&mut recv).await?;
    Ok(Some((connection, send, recv, hello)))
}

/// One player's session; `Ok(lost)`: whether it ended by its connection timing out (the chat log's "lost connection")
async fn session(
    incoming: IncomingSession,
    peer: std::net::SocketAddr,
    id: PlayerId,
    to_game: &Sender<ToGame>,
    limits: &NetLimits,
    admitted: &Admitted,
) -> anyhow::Result<bool> {
    // (the whole handshake within its deadline: a session that never opens its control stream is gone, SEC-2)
    let Some((connection, mut send, mut recv, hello)) =
        tokio::time::timeout(limits.handshake, handshake(incoming, limits)).await.context("no hello in time")??
    else {
        return Ok(false);
    };
    let hello = match hello {
        Ok(hello) => hello,
        Err(version) => {
            // (a client from before version 12 just sees the close)
            refuse(&mut send, &connection, protocol::REFUSED_VERSION).await;
            bail!("protocol version {version}, server speaks {}", protocol::VERSION);
        }
    };
    // (its kind charged to its address, before anything's spent on it: a ping past the pings' allowance unanswered (the
    // page's dash), a claim past the claims' refused)
    let ping = matches!(&hello, Control::Hello { intent, .. } if *intent == protocol::INTENT_PING);
    if !admitted.charge(if ping { Kind::Ping } else { Kind::Claim }) {
        if !ping {
            refuse(&mut send, &connection, protocol::REFUSED_FULL).await;
        }
        admitted.refused(peer, if ping { "its address's pings" } else { "its address's claims and rejoins" });
        return Ok(false);
    }
    // (a region's ping: answered at once, no ticket, nothing for the game thread; the page times the round trip; its
    // session closed after a moment's flush, its slot free at once, not after the page's close: RV-856)
    if ping {
        let server = limits.server_name.clone().unwrap_or_default();
        let _ = send.write_all(&Control::Pong { server }.encode()).await;
        let _ = send.finish().await;
        let _ = tokio::time::timeout(PING_FLUSH, connection.closed()).await;
        return Ok(false);
    }
    let ticket = if let Control::Hello { ticket, .. } = &hello { ticket.clone() } else { String::new() };
    let Some((mut request, intent, _playlist, token)) = JoinRequest::from_hello(hello) else {
        bail!("expected hello");
    };
    request.peer = Some(peer);
    // (a queue server, with tickets, serves a claim or a rejoin alone; a development server without, a join of its open
    // match alone: no search or decline anywhere (the accounts service's matchmaker has the one queue), and no other
    // intent, 0's or one unknown, taken to the game thread: refused here, RV-992)
    let ticketed = matches!(intent, protocol::INTENT_CLAIM | protocol::INTENT_REJOIN);
    let served = if limits.tickets.is_some() { ticketed } else { intent == protocol::INTENT_JOIN };
    if !served {
        refuse(&mut send, &connection, protocol::REFUSED_MODE).await;
        bail!("a hello with intent {intent}: not served here");
    }
    // (a claim and a rejoin are an account's: its ticket checked here alone, never in the match code the browser's local
    // host shares; the account's key and name in place of the hello's)
    let mut seat = None;
    if let Some(tickets) = &limits.tickets
        && ticketed
    {
        // (each ticket for its own: a match ticket for a claim of its seat at this server, a rejoin's for that match's
        // rejoin alone, AP3, RV-850)
        let purpose_fits = |purpose: &crate::ticket::Purpose| match purpose {
            crate::ticket::Purpose::Seat(s) => {
                // (a server with no name takes no match ticket: failing closed, RV-956)
                intent == protocol::INTENT_CLAIM && limits.server_name.as_ref().is_some_and(|own| *own == s.server)
            }
            crate::ticket::Purpose::Rejoin(m) => intent == protocol::INTENT_REJOIN && *m == token,
        };
        // (verified, then its use decided, then spent: a ticket shown for something else, or a rejoin the matchmaker
        // refuses, stays good, RV-973)
        let refused = |why: crate::ticket::Refusal| {
            // (no name: the hello's is the page's own setting, not a checked account's, RV-968)
            let rejoin = if intent == protocol::INTENT_REJOIN {
                format!(" (a rejoin of match {token:016x})")
            } else {
                String::new()
            };
            anyhow::anyhow!("ticket refused: {why:?}{rejoin}")
        };
        let checked = match tickets.verify(&ticket, crate::ticket::unix_now()).and_then(|checked| {
            if let crate::ticket::Purpose::Seat(s) = &checked.purpose
                && let Some(own) = limits.server_name.as_ref().filter(|own| **own != s.server)
            {
                // (said plainly: a server whose name isn't the one its page's ping told the matchmaker, RV-863)
                tracing::warn!(
                    "session from {peer}: a match ticket for server {:?}, this server is {own:?}: refused",
                    s.server
                );
            }
            if purpose_fits(&checked.purpose) { Ok(checked) } else { Err(crate::ticket::Refusal::NotForThis) }
        }) {
            Ok(checked) => checked,
            Err(why) => {
                refuse(&mut send, &connection, protocol::REFUSED_TICKET).await;
                return Err(refused(why));
            }
        };
        if let crate::ticket::Purpose::Seat(s) = &checked.purpose {
            seat = Some(crate::match_host::SeatClaim {
                match_id: s.match_id,
                playlist: s.playlist,
                seat: s.seat,
                roster: s.roster,
            });
        }
        request.key = crate::ticket::account_key(&checked.account);
        request.name = checked.name.clone();
        request.verified = true;
        request.ticket = Some(crate::game::SeatTicket {
            encoded: ticket.clone(),
            account: checked.account,
            ratings: checked.ratings.map(|r| r.rating),
        });
        // (a rejoin the matchmaker confirms first: the account's latest match still this one, at this server; else it
        // searched or was matched since, maybe at another server, and its ticket would put it in two matches. Not asked:
        // refused, never let in unconfirmed, RV-1008. One question at a time for a ticket, held until it's spent: a replay
        // meanwhile refused as used, so a ticket asks once, not as often as it's sent, RV-1020)
        let mut _deciding = None;
        if let (crate::ticket::Purpose::Rejoin(m), Some(api)) = (&checked.purpose, &limits.api) {
            match tickets.decide(&checked) {
                Ok(deciding) => _deciding = Some(deciding),
                Err(why) => {
                    refuse(&mut send, &connection, protocol::REFUSED_TICKET).await;
                    return Err(refused(why));
                }
            }
            let server = limits.server_name.as_deref().unwrap_or_default();
            match api.rejoin(server, *m, &ticket).await {
                crate::outbox::RejoinAnswer::Allowed => {}
                crate::outbox::RejoinAnswer::Gone => {
                    // (final: the account's latest match only ever moves on, so the ticket is spent: a replay refused here
                    // as used, the API never asked again, RV-1020; its question's slot let go before the refusal's close
                    // wait, RV-1028)
                    let _ = tickets.spend(&checked, crate::ticket::unix_now());
                    drop(_deciding.take());
                    refuse(&mut send, &connection, protocol::REFUSED_REJOIN_GONE).await;
                    bail!(
                        "{}: the rejoin of match {m:016x} refused: the matchmaker says the account searched or was matched \
                         since, or the match is another server's",
                        request.who()
                    );
                }
                // (the API down or slow, which passes: the ticket left good for a retry once it's back, RV-1020)
                crate::outbox::RejoinAnswer::Unconfirmed(why) => {
                    drop(_deciding.take());
                    refuse(&mut send, &connection, protocol::REFUSED_UNCONFIRMED).await;
                    bail!("{}: the rejoin of match {m:016x} refused unconfirmed: the matchmaker: {why}", request.who());
                }
            }
        }
        if let Err(why) = tickets.spend(&checked, crate::ticket::unix_now()) {
            refuse(&mut send, &connection, protocol::REFUSED_TICKET).await;
            return Err(refused(why));
        }
    }
    let intent = match (intent, seat) {
        (protocol::INTENT_CLAIM, Some(seat)) => Intent::Claim { seat },
        (protocol::INTENT_REJOIN, _) => Intent::Rejoin { match_id: token },
        _ => Intent::Join,
    };
    // (the session as its lines name it: who (its address, account and name) and its match)
    let label = match &intent {
        Intent::Claim { seat } => format!("player {id} ({}) in match {:016x}", request.who(), seat.match_id),
        Intent::Rejoin { match_id } => format!("player {id} ({}) in match {match_id:016x}", request.who()),
        Intent::Join => format!("player {id} ({})", request.who()),
    };

    let (out_tx, mut out_rx) = channel(OUT_QUEUE);
    to_game.send(ToGame::Join { id, intent, request, out: out_tx }).await?;

    // Game -> client
    let writer_connection = connection.clone();
    // (datagrams the connection refused: too large for the path now, or for a peer without datagrams; counted on every
    // way the session ends, RV-334; none counted once it's closed)
    let unsent = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let writer_unsent = unsent.clone();
    let mut writer = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            match message {
                Outgoing::Control(bytes) => {
                    if send.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                // Unreliable: a datagram that doesn't fit or can't be queued is simply lost, like a lost packet (counted)
                Outgoing::Datagram(bytes) => match writer_connection.send_datagram(bytes) {
                    Ok(()) | Err(wtransport::error::SendDatagramError::NotConnected) => {}
                    Err(_) => {
                        writer_unsent.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                },
            }
        }
        // (the game let go of this player: a refused join, a found match, a kick, a match let go; what it sent goes out
        // before the stream ends)
        let _ = send.finish().await;
    });

    // Client -> game: control messages (in their own task: a framed read mustn't be cancelled halfway); the control
    // stream closing ends the session
    let control_to_game = to_game.clone();
    let reader_label = label.clone();
    let mut control_reader = tokio::spawn(async move {
        // (at most CONTROL_RATE: more are dropped, and a session that keeps on is closed, SEC-3)
        let mut bucket = TokenBucket::new(CONTROL_RATE, Instant::now());
        let mut overruns = TokenBucket::new(CONTROL_OVERRUN, Instant::now());
        loop {
            let read = read_control(&mut recv).await;
            if read.is_ok() && !bucket.take(Instant::now()) {
                if !overruns.take(Instant::now()) {
                    tracing::warn!("{reader_label}: control messages over the rate, session ends");
                    break;
                }
                continue;
            }
            let message = match read {
                Ok(Control::ResetInputBuffer) => ToGame::ResetInputBuffer { id },
                Ok(Control::ReadyUp) => ToGame::ReadyUp { id },
                Ok(Control::AutoSkipReplay { on }) => ToGame::AutoSkipReplay { id, on },
                Ok(Control::VoteForfeit) => ToGame::VoteForfeit { id },
                Ok(Control::QuickChat { preset, team }) => ToGame::QuickChat { id, preset, team },
                Ok(Control::ChatFilter { quick_chat, block_non_tactical }) => {
                    ToGame::ChatFilter { id, quick_chat, block_non_tactical }
                }
                Ok(Control::Mute { car, on }) => ToGame::Mute { id, car, on },
                Ok(_) => continue, // (nothing else is expected from a client)
                Err(e) => {
                    // (a malformed message ends the session: say why; a closed stream is the usual end)
                    if e.downcast_ref::<protocol::DecodeError>().is_some() {
                        tracing::warn!("{reader_label}: malformed control message ({e}), session ends");
                    }
                    break;
                }
            };
            if control_to_game.send(message).await.is_err() {
                break;
            }
        }
    });

    // Client -> game: input datagrams (at most INPUT_RATE: more are dropped as lost, SEC-3; a flood ends the session,
    // RV-373); the round-trip time each second (the scoreboard's ping)
    let mut ping_every = tokio::time::interval(Duration::from_secs(1));
    let mut inputs = TokenBucket::new(INPUT_RATE, Instant::now());
    let mut input_overruns = TokenBucket::new(INPUT_OVERRUN, Instant::now());
    let slot = Arc::new(InputSlot::default());
    let result: anyhow::Result<()> = loop {
        tokio::select! {
            _ = ping_every.tick() => {
                let _ = to_game.try_send(ToGame::Ping { id, ms: connection.rtt().as_millis().min(u128::from(u32::MAX)) as u32 });
            }
            datagram = connection.receive_datagram() => match datagram {
                Ok(d) => {
                    if !inputs.take(Instant::now()) {
                        if !input_overruns.take(Instant::now()) {
                            tracing::warn!("{label}: input datagrams over the rate, session ends");
                            break Ok(());
                        }
                        continue;
                    }
                    if let Ok(Datagram::Inputs { timestamp, sequence, first_frame, frames }) = Datagram::decode(&d) {
                        // (one waiting at a time, the newest: the queue stays bounded whatever the game's pace, RV-248,
                        // RV-991)
                        let at = std::time::Instant::now();
                        if deliver_inputs(to_game, id, &slot, Inputs { timestamp, sequence, first_frame, frames, at }).is_err() {
                            bail!("the game has stopped");
                        }
                    }
                }
                Err(e) => break Err(e.into()),
            },
            _ = &mut control_reader => break Ok(()),
            // (the game let go of this player: give the client a moment to read why and close)
            _ = &mut writer => {
                let _ = tokio::time::timeout(Duration::from_secs(2), &mut control_reader).await;
                break Ok(());
            }
        }
    };
    control_reader.abort();
    writer.abort();
    let refused = unsent.load(std::sync::atomic::Ordering::Relaxed);
    if refused > 0 {
        tracing::warn!("{label}: {refused} datagrams refused by the connection (too large or unsupported)");
    }
    result?;
    // (whichever branch noticed first, the connection's own close says why: an idle timeout is a lost connection, RV-250)
    let reason = tokio::time::timeout(Duration::from_millis(100), connection.closed()).await;
    Ok(matches!(reason, Ok(wtransport::error::ConnectionError::TimedOut)))
}

/// Serves `app` over plain HTTP/1 on `listener` (a development or health endpoint's: SEC-6): `open` connections at once
/// (one more closed at once), each given `read` for its request's headers, one request each
async fn serve_http(
    listener: tokio::net::TcpListener,
    app: axum::Router,
    open: usize,
    read: Duration,
) -> anyhow::Result<()> {
    let open = Arc::new(tokio::sync::Semaphore::new(open));
    loop {
        // (an accept error, a connection reset early, isn't the server's end)
        let Ok((stream, _)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        let Ok(permit) = open.clone().try_acquire_owned() else { continue };
        let service = hyper_util::service::TowerToHyperService::new(app.clone());
        tokio::spawn(async move {
            let _permit = permit;
            let _ = hyper::server::conn::http1::Builder::new()
                .timer(hyper_util::rt::TokioTimer::new())
                .header_read_timeout(read)
                .keep_alive(false)
                // (a request's headers 16 KiB at most, not hyper's 400 KiB: these endpoints take no more, RV-940)
                .max_buf_size(MAX_REQUEST_BUFFER)
                .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
                .await;
        });
    }
}

/// A development or health endpoint's request buffer at most (bytes; hyper's least is 8 KiB)
const MAX_REQUEST_BUFFER: usize = 16 * 1024;

/// The development info's answer: its JSON (any page may read it, never cached)
fn dev_answer(body: String) -> axum::response::Response {
    use axum::http::header;
    use axum::response::IntoResponse;
    let open = [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"), (header::CACHE_CONTROL, "no-store")];
    (open, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

/// Development helper: `GET /info` on plain HTTP returns the WebTransport port and the certificate hash, so a browser
/// on this machine can connect to the self-signed server (the direct `--dev` server's alone, SEC-6): on `bind`
/// (127.0.0.1 unless asked), 64 connections at once, 2 s for a request's headers
pub async fn serve_info(bind: IpAddr, port: u16, webtransport_port: u16, cert_hash: [u8; 32]) -> anyhow::Result<()> {
    use axum::routing::get;
    let hex: String = cert_hash.iter().map(|b| format!("{b:02x}")).collect();
    let info = serde_json::json!({ "port": webtransport_port, "certHash": hex }).to_string();
    let app = axum::Router::new().route("/info", get(move || std::future::ready(dev_answer(info.clone()))));
    serve_http(tokio::net::TcpListener::bind((bind, port)).await?, app, 64, Duration::from_secs(2)).await
}

/// The health endpoint's port bound, on 127.0.0.1 (the start fails if it's taken: another process's /healthz would
/// answer the check, RV-986)
pub async fn bind_health(port: u16) -> anyhow::Result<tokio::net::TcpListener> {
    tokio::net::TcpListener::bind(("127.0.0.1", port)).await.with_context(|| format!("HEALTH_PORT 127.0.0.1:{port}"))
}

/// The container's health check (APP-CONTRACT.md): `GET /healthz` on its listener (`bind_health`) answers 200 while the
/// game thread runs (its heartbeat, each loop, within 2 s), else 503
pub async fn serve_health(
    listener: tokio::net::TcpListener,
    heartbeat: Arc<std::sync::atomic::AtomicU64>,
    start: Instant,
) -> anyhow::Result<()> {
    use axum::http::StatusCode;
    let app = axum::Router::new().route(
        "/healthz",
        axum::routing::get(move || {
            let beat = heartbeat.load(std::sync::atomic::Ordering::Relaxed);
            let now = start.elapsed().as_millis() as u64;
            std::future::ready(if now.saturating_sub(beat) < 2000 {
                (StatusCode::OK, "ok")
            } else {
                (StatusCode::SERVICE_UNAVAILABLE, "the game thread is stuck")
            })
        }),
    );
    serve_http(listener, app, 16, Duration::from_secs(2)).await
}

/// `carball-server --healthcheck`: asks the health endpoint (2 s at most, never through a proxy the environment names);
/// true if it answered 200
pub async fn health_check(port: u16) -> bool {
    // (no redirect followed: only the endpoint's own 200 is healthy, RV-940)
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return false;
    };
    client
        .get(format!("http://127.0.0.1:{port}/healthz"))
        .send()
        .await
        .is_ok_and(|r| r.status() == reqwest::StatusCode::OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RV-1009: a client's text (a QUIC close's reason, with CR, LF or a line separator) stays on its session's line: it
    /// can't forge a line of its own (a "left: reported as a quitter" of another account)
    /// RV-991: a session's inputs hold one place in the game's queue at most (its newest waiting): with the game thread
    /// stalled and one session flooding, another's newest still arrive; the queue full, a datagram is lost, not stuck
    /// (the next one noted); the game gone, said
    #[test]
    fn a_floods_inputs_hold_one_place_and_another_sessions_newest_arrive() {
        let datagram =
            |sequence: u16| Inputs { timestamp: 0, sequence, first_frame: 0, frames: vec![], at: Instant::now() };
        let (to_game, mut game) = channel(4);
        let (flood, honest) = (Arc::new(InputSlot::default()), Arc::new(InputSlot::default()));
        for sequence in 0..10_000 {
            deliver_inputs(&to_game, 1, &flood, datagram(sequence)).unwrap();
        }
        deliver_inputs(&to_game, 2, &honest, datagram(7)).unwrap();
        deliver_inputs(&to_game, 2, &honest, datagram(8)).unwrap();
        let mut got = Vec::new();
        while let Ok(ToGame::Inputs { id, slot }) = game.try_recv() {
            got.push((id, slot.take().map(|i| i.sequence)));
        }
        assert_eq!(got, [(1, Some(9999)), (2, Some(8))], "one note each, the newest of each");
        let (to_game, mut game) = channel(1);
        to_game.try_send(ToGame::Ping { id: 3, ms: 0 }).unwrap();
        deliver_inputs(&to_game, 2, &honest, datagram(9)).unwrap();
        assert!(honest.take().is_none(), "the queue full: lost, the slot left empty");
        game.try_recv().unwrap();
        deliver_inputs(&to_game, 2, &honest, datagram(10)).unwrap();
        assert!(matches!(game.try_recv(), Ok(ToGame::Inputs { id: 2, .. })), "the next one noted");
        honest.take();
        drop(game);
        assert!(deliver_inputs(&to_game, 2, &honest, datagram(11)).is_err(), "the game gone");
    }

    #[test]
    fn a_clients_text_stays_on_its_line() {
        let reason =
            "bye\r\n2026-10-24T00:00:00Z  INFO match 1: player 9 (\"Forged\") left: reported as a quitter\u{2028}x";
        let e = anyhow::anyhow!("closed by the peer: {reason}");
        let line = session_end_line(7, "192.0.2.1:5000".parse().unwrap(), &e);
        assert!(!line.contains(['\r', '\n', '\u{2028}']), "{line}");
        assert!(line.starts_with("player 7 (192.0.2.1:5000): closed by the peer: bye\\r\\n2026"), "{line}");
        assert_eq!(one_line("a plain \"name\" stays as it is"), "a plain \"name\" stays as it is");
    }

    /// The development info server as HTTP: its routes and methods (anything else a 404 or 405), the CORS and no-store
    /// headers, a request split across reads read whole, a connection that sends nothing let go after 2 s
    #[tokio::test]
    async fn the_info_server_answers_its_routes_as_http() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        tokio::spawn(serve_info([127, 0, 0, 1].into(), port, 4433, [0xab; 32]));
        tokio::time::sleep(Duration::from_millis(100)).await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let get = |path: &str| client.get(format!("http://127.0.0.1:{port}{path}")).send();
        let info = get("/info").await.unwrap();
        assert_eq!(info.status(), 200);
        assert_eq!(info.headers()["access-control-allow-origin"], "*");
        assert_eq!(info.headers()["cache-control"], "no-store");
        let body: serde_json::Value = serde_json::from_str(&info.text().await.unwrap()).unwrap();
        assert_eq!((body["port"].as_u64(), body["certHash"].as_str().map(str::len)), (Some(4433), Some(64)));
        assert_eq!(get("/").await.unwrap().status(), 404, "not the info for any path");
        let posted = client.post(format!("http://127.0.0.1:{port}/info")).send().await.unwrap();
        assert_eq!(posted.status(), 405, "nor for any method");
        assert_eq!(
            get("/dev-ticket?rejoin=00000000000000a1").await.unwrap().status(),
            404,
            "no tickets here: the accounts service issues them"
        );
        // (a request in two writes, apart: read whole, answered)
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(b"GET /info HTTP/1.1\r\nHo").await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        stream.write_all(b"st: localhost\r\n\r\n").await.unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.unwrap();
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        // (nothing sent: the connection closed within its 2 s and a little)
        let mut idle = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let started = Instant::now();
        let mut rest = Vec::new();
        let read = tokio::time::timeout(Duration::from_secs(5), idle.read_to_end(&mut rest)).await;
        assert!(
            read.is_ok() && started.elapsed() < Duration::from_secs(4),
            "an idle connection held {:?}",
            started.elapsed()
        );
    }

    /// The plain HTTP endpoints' limits applied, not configured only (RV-939's H1, H3; RV-940): one request a connection
    /// (a second sent with it unanswered), the connections at once capped (one more closed at once), a request's headers
    /// past 16 KiB refused
    #[tokio::test]
    async fn the_http_endpoints_limits_hold() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = axum::Router::new().route("/", axum::routing::get(|| async { "ok" }));
        tokio::spawn(serve_http(listener, app, 2, Duration::from_secs(2)));
        let connect = || tokio::net::TcpStream::connect(("127.0.0.1", port));
        let reply = |mut s: tokio::net::TcpStream| async move {
            let mut text = Vec::new();
            let _ = tokio::time::timeout(Duration::from_secs(5), s.read_to_end(&mut text)).await;
            String::from_utf8_lossy(&text).into_owned()
        };
        let mut two = connect().await.unwrap();
        two.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n").await.unwrap();
        let text = reply(two).await;
        assert_eq!(text.matches("HTTP/1.1 200").count(), 1, "{text}");
        let held = [connect().await.unwrap(), connect().await.unwrap()];
        tokio::time::sleep(Duration::from_millis(100)).await;
        let started = Instant::now();
        let text = reply(connect().await.unwrap()).await;
        assert!(
            text.is_empty() && started.elapsed() < Duration::from_secs(1),
            "one past the cap: {text:?}, {:?}",
            started.elapsed()
        );
        drop(held);
        tokio::time::sleep(Duration::from_millis(200)).await;
        let mut big = connect().await.unwrap();
        big.write_all(format!("GET / HTTP/1.1\r\nHost: x\r\nX-Big: {}\r\n\r\n", "a".repeat(20_000)).as_bytes())
            .await
            .unwrap();
        let text = reply(big).await;
        assert!(text.starts_with("HTTP/1.1 431"), "headers past 16 KiB: {text:?}");
    }

    /// The health endpoint: 200 while the game thread's heartbeat is within 2 s, else 503; `--healthcheck` true for that
    /// 200 alone: a 503, a redirect (even to a 200) and a listener that never answers (given up in its 2 s) false
    /// (RV-939's H5, H7, H9; RV-940)
    #[tokio::test]
    async fn the_health_endpoint_and_its_check() {
        let free = || std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let (port, moved, silent) = (free(), free(), free());
        let start = Instant::now().checked_sub(Duration::from_secs(10)).unwrap();
        let heartbeat = Arc::new(std::sync::atomic::AtomicU64::new(10_000));
        tokio::spawn(serve_health(bind_health(port).await.unwrap(), heartbeat.clone(), start));
        assert!(bind_health(port).await.is_err(), "a port taken: an error, the start fails");
        let to = format!("http://127.0.0.1:{port}/healthz");
        let redirect = axum::Router::new().route(
            "/healthz",
            axum::routing::get(move || {
                std::future::ready((
                    axum::http::StatusCode::MOVED_PERMANENTLY,
                    [(axum::http::header::LOCATION, to.clone())],
                ))
            }),
        );
        tokio::spawn(serve_http(
            tokio::net::TcpListener::bind(("127.0.0.1", moved)).await.unwrap(),
            redirect,
            4,
            Duration::from_secs(2),
        ));
        let never = tokio::net::TcpListener::bind(("127.0.0.1", silent)).await.unwrap();
        tokio::spawn(async move {
            let mut kept = Vec::new();
            while let Ok((stream, _)) = never.accept().await {
                kept.push(stream);
            }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(health_check(port).await, "a heartbeat within 2 s");
        assert!(!health_check(moved).await, "a redirect to a 200");
        let started = Instant::now();
        assert!(!health_check(silent).await, "a listener that never answers");
        assert!(started.elapsed() < Duration::from_secs(3), "given up in {:?}", started.elapsed());
        heartbeat.store(0, std::sync::atomic::Ordering::Relaxed);
        assert!(!health_check(port).await, "a heartbeat 10 s old: 503");
    }

    #[test]
    fn a_bucket_lets_its_burst_through_then_its_rate() {
        let t0 = Instant::now();
        let mut b = TokenBucket::new((20.0, 40.0), t0);
        assert_eq!((0..100).filter(|_| b.take(t0)).count(), 40, "the burst");
        let t1 = t0 + Duration::from_millis(500);
        assert_eq!((0..100).filter(|_| b.take(t1)).count(), 10, "half a second's rate");
        let t2 = t1 + Duration::from_secs(60);
        assert_eq!((0..100).filter(|_| b.take(t2)).count(), 40, "never more than the burst");
    }

    /// A test's admission on a clock it moves
    fn admission_at(
        limits: &NetLimits,
    ) -> (Admission<governor::clock::FakeRelativeClock>, governor::clock::FakeRelativeClock) {
        let clock = governor::clock::FakeRelativeClock::default();
        (Admission::with_clock(limits, clock.clone()), clock)
    }

    /// An address's sessions at once, and its starts (both kinds' allowances together: a burst, then their rates); another
    /// address apart. The defaults: a LAN party's 64 at once (the user's decision of 2026-10-23)
    #[test]
    fn an_address_gets_its_sessions_at_once_and_its_starts_as_they_refill() {
        let limits = NetLimits {
            per_address: 2,
            claims: Rate { burst: 2, per_minute: 60 },
            pings: Rate { burst: 1, per_minute: 60 },
            ..NetLimits::default()
        };
        let (a, b): (IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into());
        let (mut admission, clock) = admission_at(&limits);
        assert!(admission.admit(a, &limits).is_ok() && admission.admit(a, &limits).is_ok());
        assert_eq!(admission.admit(a, &limits), Err("its address's sessions at once"));
        assert!(admission.admit(b, &limits).is_ok(), "another address");
        admission.release(a);
        assert!(admission.admit(a, &limits).is_ok(), "a released one makes room: the third start of a burst of 3");
        admission.release(a);
        assert_eq!(admission.admit(a, &limits), Err("its address's new sessions"), "the burst's starts used");
        clock.advance(Duration::from_millis(500));
        assert!(admission.admit(a, &limits).is_ok(), "the rates' two a second: one again half a second on");
        admission.release(a);
        admission.release(a);
        admission.release(b);
        assert!(admission.active.is_empty());
        assert_eq!(NetLimits::default().per_address, 64);
    }

    /// The user's decision of 2026-10-23 (LAN parties): claims and rejoins, and region pings, each their own allowance, a
    /// burst then steady; pings past theirs leave the claims' whole (no claim a no-show for the pings of others behind its
    /// address)
    #[test]
    fn claims_and_pings_each_have_their_own_allowance() {
        let limits = NetLimits {
            claims: Rate { burst: 3, per_minute: 60 },
            pings: Rate { burst: 5, per_minute: 120 },
            ..NetLimits::default()
        };
        let a: IpAddr = [10, 0, 0, 1].into();
        let (admission, clock) = admission_at(&limits);
        let take = |kind: Kind| (0..20).filter(|_| admission.charge(a, kind)).count();
        assert_eq!(take(Kind::Ping), 5, "the pings' burst");
        assert_eq!(take(Kind::Claim), 3, "the claims' own, whole");
        clock.advance(Duration::from_secs(1));
        assert_eq!((take(Kind::Ping), take(Kind::Claim)), (2, 1), "a second's of each");
        clock.advance(Duration::from_secs(600));
        assert_eq!(take(Kind::Claim), 3, "never more than the burst");
        assert_eq!(NetLimits::default().claims, Rate { burst: 64, per_minute: 60 }, "1 a second");
        assert_eq!(NetLimits::default().pings, Rate { burst: 192, per_minute: 240 }, "4 a second");
        assert_eq!("64/60".parse::<Rate>(), Ok(Rate { burst: 64, per_minute: 60 }));
        for bad in ["64", "0/1", "64/0", "a/1", "64/1/2"] {
            assert!(bad.parse::<Rate>().is_err(), "{bad}");
        }
    }

    /// RV-909: the buckets let go of an address once its allowance is whole again (swept a minute at most apart); one
    /// still refilling is kept, its use remembered
    #[test]
    fn addresses_whose_allowance_is_whole_are_let_go() {
        let limits = NetLimits {
            claims: Rate { burst: 2, per_minute: 60 },
            pings: Rate { burst: 2, per_minute: 60 },
            ..NetLimits::default()
        };
        let (a, b, c): (IpAddr, IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into(), [10, 0, 0, 3].into());
        let (mut admission, clock) = admission_at(&limits);
        let start = |admission: &mut Admission<_>, at: IpAddr| {
            let ok = admission.admit(at, &limits).is_ok();
            admission.release(at);
            ok
        };
        assert!(start(&mut admission, a)); // (the first sweep, at 0 s)
        clock.advance(Duration::from_secs(59));
        assert_eq!((0..9).filter(|_| start(&mut admission, b)).count(), 4, "b's burst at 59 s");
        clock.advance(Duration::from_secs(1));
        assert!(start(&mut admission, c)); // (a sweep, at 60 s)
        assert_eq!(admission.starts.len(), 2, "a's whole again, let go; b's refilling kept, c's new");
        assert_eq!(
            (0..9).filter(|_| start(&mut admission, b)).count(),
            2,
            "b's use remembered: a second's refill alone"
        );
    }

    /// RV-970: a refusal's line once a minute for each address and reason, the ones between counted (said with the next
    /// line, or by the sweep after its minute)
    #[test]
    fn refusals_are_logged_a_line_a_minute_counted() {
        let limits = NetLimits::default();
        let (a, b): (IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into());
        let (mut admission, clock) = admission_at(&limits);
        assert_eq!(admission.log_refusal(a, "x"), Some(0));
        assert_eq!((admission.log_refusal(a, "x"), admission.log_refusal(a, "x")), (None, None));
        assert_eq!(admission.log_refusal(a, "y"), Some(0), "another reason's");
        assert_eq!(admission.log_refusal(b, "x"), Some(0), "another address's");
        clock.advance(Duration::from_secs(30));
        assert_eq!(admission.log_refusal(a, "x"), None);
        clock.advance(Duration::from_secs(31));
        assert_eq!(admission.log_refusal(a, "x"), Some(3), "a minute on: the three between counted");
        clock.advance(Duration::from_secs(61));
        assert_eq!(admission.log_refusal(b, "z"), Some(0));
        assert_eq!(admission.refusals.len(), 1, "the lines over a minute old let go");
    }

    #[test]
    fn an_ipv6_address_counts_by_its_64_and_a_mapped_ipv4_one_as_itself() {
        let key = |s: &str| address_key(s.parse().unwrap());
        assert_eq!(key("2001:db8:1:2:aaaa::1"), key("2001:db8:1:2:ffff:1:2:3"), "one /64");
        assert_ne!(key("2001:db8:1:2::1"), key("2001:db8:1:3::1"), "the next /64");
        assert_eq!(key("::ffff:10.0.0.1"), key("10.0.0.1"), "a dual-stack socket's IPv4 client");
        assert_ne!(key("::ffff:10.0.0.1"), key("::ffff:10.0.0.2"), "IPv4 clients aren't one /64");
        // Two hosts of one /64 share its limits
        let limits = NetLimits { per_address: 2, ..NetLimits::default() };
        let (mut admission, _clock) = admission_at(&limits);
        assert!(
            admission.admit(key("2001:db8::1"), &limits).is_ok()
                && admission.admit(key("2001:db8::2"), &limits).is_ok()
        );
        assert!(admission.admit(key("2001:db8::3"), &limits).is_err());
        assert!(admission.admit(key("2001:db8:0:1::1"), &limits).is_ok());
    }

    #[test]
    fn the_handshakes_deadlines_are_4_s_for_quic_and_10_s_through_the_hello() {
        let limits = NetLimits::default();
        assert_eq!((limits.quic_handshake, limits.handshake), (Duration::from_secs(4), Duration::from_secs(10)));
    }

    #[test]
    fn an_unproven_address_is_sent_a_retry_and_takes_no_slot() {
        let limits = NetLimits { max_sessions: 1, per_address: 1, ..NetLimits::default() };
        let sessions = Arc::new(tokio::sync::Semaphore::new(1));
        let admission = Mutex::new(Admission::new(&limits));
        let a: IpAddr = [10, 0, 0, 1].into();
        for _ in 0..10 {
            assert!(matches!(admit(false, a, &sessions, &admission, &limits), Admit::Retry));
        }
        assert_eq!(sessions.available_permits(), 1);
        assert!(admission.lock().unwrap().active.is_empty());
        assert_eq!(admission.lock().unwrap().starts.len(), 0, "a Retry charged nothing");
        let Admit::Admit(permit) = admit(true, a, &sessions, &admission, &limits) else {
            panic!("a proven address admitted")
        };
        assert!(
            matches!(admit(true, [10, 0, 0, 2].into(), &sessions, &admission, &limits), Admit::Refuse(_)),
            "the global cap"
        );
        drop(permit);
    }

    #[test]
    fn overruns_drain_a_client_now_and_then_over_its_rate_stays_a_flood_doesnt() {
        // A 360 Hz client: 360 inputs a second, 120 over the rate, for ten minutes
        let t0 = Instant::now();
        let (mut inputs, mut overruns) = (TokenBucket::new(INPUT_RATE, t0), TokenBucket::new(INPUT_OVERRUN, t0));
        let mut closed = false;
        for frame in 0..360 * 600 {
            let t = t0 + Duration::from_secs_f64(f64::from(frame) / 360.0);
            if !inputs.take(t) && !overruns.take(t) {
                closed = true;
            }
        }
        assert!(!closed);
        // A flood: 20 000 a second, closed within half a second
        let t1 = t0 + Duration::from_secs(700);
        let (mut inputs, mut overruns) = (TokenBucket::new(INPUT_RATE, t1), TokenBucket::new(INPUT_OVERRUN, t1));
        let at = (0..20_000).position(|i| {
            let t = t1 + Duration::from_secs_f64(f64::from(i) / 20_000.0);
            !inputs.take(t) && !overruns.take(t)
        });
        assert!(at.is_some_and(|i| i < 10_000), "{at:?}");
    }
}
