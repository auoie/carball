//! WebTransport front end: accepts sessions on `/play`, reads the player's `Hello` from the control stream, then
//! forwards input datagrams to the game and the game's messages to the client (`protocol/README.md`). What it lets in
//! (the security review's SEC-2, SEC-3, SEC-5: `NetLimits`): QUIC's stream and buffer limits, an address proven before
//! anything is spent on it (RV-366), sessions at once and per address, the handshakes' deadlines, the page's origin, each
//! session's message rates.

use std::collections::{HashMap, VecDeque};
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
    Inputs {
        id: PlayerId,
        timestamp: u32,
        sequence: u16,
        first_frame: u32,
        frames: Vec<InputFrame>,
        at: std::time::Instant,
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

/// What the front end lets in: sessions at once, per address at once and new a minute (SEC-2; an address as
/// `address_key` counts it), the page origins allowed (SEC-5; None: any, a development server). The defaults are a
/// public server's; the browser tests' servers, every page on one address, raise the per-address limits
#[derive(Clone, Debug)]
pub struct NetLimits {
    pub max_sessions: usize,
    pub per_address: usize,
    pub per_address_per_minute: usize,
    /// The starts a minute an address's region pings may give back (RV-870); past them a ping counts as any start, so
    /// one address can't open handshakes without end (RV-900)
    pub pings_per_address_per_minute: usize,
    pub allowed_origins: Option<Vec<String>>,
    /// The handshake, from the first packet through the hello, must be done this soon
    pub handshake: Duration,
    /// Its QUIC part, through the session's request (a browser sends it at once), this soon (RV-366)
    pub quic_handshake: Duration,
    /// The match and rejoin tickets checked (notes/accounts.md §3): a queue server's always (`main` requires its keys, or
    /// --dev's); None, no claim or rejoin taken (a direct development server, the tests')
    pub tickets: Option<Arc<crate::ticket::Tickets>>,
    /// This server's name as a match ticket names it (its address, host:port: `PUBLIC_HOST` and its port); None, any (the
    /// tests')
    pub server_name: Option<String>,
}

impl Default for NetLimits {
    fn default() -> Self {
        Self {
            max_sessions: 512,
            per_address: 8,
            per_address_per_minute: 30,
            pings_per_address_per_minute: 120,
            allowed_origins: None,
            handshake: Duration::from_secs(10),
            quic_handshake: Duration::from_secs(4),
            tickets: None,
            server_name: None,
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

pub fn admit(
    validated: bool,
    address: IpAddr,
    sessions: &Arc<tokio::sync::Semaphore>,
    admission: &Mutex<Admission>,
    limits: &NetLimits,
    now: Instant,
) -> Admit {
    if !validated {
        return Admit::Retry;
    }
    let Ok(permit) = sessions.clone().try_acquire_owned() else { return Admit::Refuse("the server's most sessions") };
    if !admission.lock().unwrap().admit(address, now, limits) {
        return Admit::Refuse("its address's sessions at once or this minute");
    }
    Admit::Admit(permit)
}

/// The sessions of each address (`address_key`): at once, and the starts of the last minute (SEC-2)
#[derive(Debug, Default)]
pub struct Admission {
    active: HashMap<IpAddr, usize>,
    starts: HashMap<IpAddr, VecDeque<Instant>>,
    /// The starts given back for pings, the last minute's
    pings: HashMap<IpAddr, VecDeque<Instant>>,
    /// When the addresses last ended were let go: once a minute at most (RV-909)
    swept: Option<Instant>,
    /// When each address's refusal was last logged: a line a minute at most (a flood's refusals don't fill the log)
    refusals_logged: HashMap<IpAddr, Instant>,
}

/// Drops the times a minute or more before `now`
fn last_minute(times: &mut VecDeque<Instant>, now: Instant) {
    while times.front().is_some_and(|&t| now.saturating_duration_since(t) >= Duration::from_secs(60)) {
        times.pop_front();
    }
}

impl Admission {
    /// A new session from `address`, if its limits allow it (counted then: `release` when it ends)
    pub fn admit(&mut self, address: IpAddr, now: Instant, limits: &NetLimits) -> bool {
        if self.swept.is_none_or(|t| now.saturating_duration_since(t) >= Duration::from_secs(60)) {
            self.sweep(now);
        }
        let starts = self.starts.entry(address).or_default();
        last_minute(starts, now);
        let active = self.active.get(&address).copied().unwrap_or(0);
        if active >= limits.per_address || starts.len() >= limits.per_address_per_minute {
            return false;
        }
        starts.push_back(now);
        *self.active.entry(address).or_default() += 1;
        true
    }

    /// Lets go of the addresses with no start or ping in the last minute: they'd otherwise stay, one for every address ever
    /// seen (RV-909; an address's next start makes its entry again)
    fn sweep(&mut self, now: Instant) {
        self.swept = Some(now);
        for times in [&mut self.starts, &mut self.pings] {
            times.retain(|_, t| {
                last_minute(t, now);
                !t.is_empty()
            });
        }
        self.refusals_logged.retain(|_, &mut at| now.saturating_duration_since(at) < Duration::from_secs(60));
    }

    /// Whether a refusal of `address` is logged: its first in a minute (a flood of refusals writes a line a minute, not
    /// one each)
    pub fn log_refusal(&mut self, address: IpAddr, now: Instant) -> bool {
        match self.refusals_logged.get(&address) {
            Some(&at) if now.saturating_duration_since(at) < Duration::from_secs(60) => false,
            _ => {
                self.refusals_logged.insert(address, now);
                true
            }
        }
    }

    /// A session from `address` that turned out a region's ping: its start not counted (each search pings every region,
    /// so players behind one NAT would otherwise run its starts out and a claim be refused, a no-show: RV-870), up to
    /// the pings' own budget a minute (RV-900: past it, counted as any start)
    pub fn refund(&mut self, address: IpAddr, now: Instant, limits: &NetLimits) {
        let pings = self.pings.entry(address).or_default();
        last_minute(pings, now);
        if pings.len() >= limits.pings_per_address_per_minute {
            return;
        }
        pings.push_back(now);
        if let Some(starts) = self.starts.get_mut(&address) {
            starts.pop_back();
        }
    }

    pub fn release(&mut self, address: IpAddr) {
        if let Some(n) = self.active.get_mut(&address) {
            *n -= 1;
            if *n == 0 {
                self.active.remove(&address);
                if self.starts.get(&address).is_some_and(VecDeque::is_empty) {
                    self.starts.remove(&address);
                }
                if self.pings.get(&address).is_some_and(VecDeque::is_empty) {
                    self.pings.remove(&address);
                }
            }
        }
    }
}

pub async fn accept_loop(server: Arc<ServerEndpoint>, to_game: Sender<ToGame>, limits: NetLimits) {
    let mut next_id: PlayerId = 1;
    let sessions = Arc::new(tokio::sync::Semaphore::new(limits.max_sessions));
    let admission = Arc::new(Mutex::new(Admission::default()));
    let limits = Arc::new(limits);
    loop {
        let incoming = server.accept().await;
        let peer = incoming.remote_address();
        let address = address_key(peer.ip());
        let permit =
            match admit(incoming.remote_address_validated(), address, &sessions, &admission, &limits, Instant::now()) {
                Admit::Retry => {
                    incoming.retry();
                    continue;
                }
                Admit::Refuse(why) => {
                    if admission.lock().unwrap().log_refusal(address, Instant::now()) {
                        tracing::warn!("session from {peer} refused: {why} (its address's next this minute unlogged)");
                    }
                    incoming.refuse();
                    continue;
                }
                Admit::Admit(permit) => permit,
            };
        let id = next_id;
        next_id += 1;
        let to_game = to_game.clone();
        let admission = admission.clone();
        let limits = limits.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let refund = || admission.lock().unwrap().refund(address, Instant::now(), &limits);
            let lost = match session(incoming, peer, id, &to_game, &limits, &refund).await {
                Ok(lost) => lost,
                Err(e) => {
                    tracing::info!("player {id} ({peer}): {e:#}");
                    matches!(
                        e.downcast_ref::<wtransport::error::ConnectionError>(),
                        Some(wtransport::error::ConnectionError::TimedOut)
                    )
                }
            };
            let _ = to_game.send(ToGame::Leave { id, lost }).await;
            admission.lock().unwrap().release(address);
        });
    }
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
        tracing::warn!("session from {} refused: its page's origin {:?}", request.remote_address(), request.origin());
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
    ping: &(dyn Fn() + Sync),
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
            // (refused with its reason, then the client closes; a client from before version 12 just sees the close)
            let _ = send.write_all(&Control::Refused { reason: protocol::REFUSED_VERSION }.encode()).await;
            let _ = send.finish().await;
            let _ = tokio::time::timeout(Duration::from_secs(2), connection.closed()).await;
            bail!("protocol version {version}, server speaks {}", protocol::VERSION);
        }
    };
    // (a region's ping: answered at once, no ticket, nothing for the game thread; the page times the round trip; its
    // session closed after a moment's flush, its slot free at once, not after the page's close: RV-856)
    if matches!(&hello, Control::Hello { intent, .. } if *intent == protocol::INTENT_PING) {
        ping(); // (its start given back: RV-870)
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
    // (no search or decline here: the accounts service's matchmaker has the one queue; a claim or a rejoin needs its
    // ticket, so a server without tickets takes neither)
    let ticketed = matches!(intent, protocol::INTENT_CLAIM | protocol::INTENT_REJOIN);
    if matches!(intent, protocol::INTENT_SEARCH | protocol::INTENT_DECLINE) || (ticketed && limits.tickets.is_none()) {
        let _ = send.write_all(&Control::Refused { reason: protocol::REFUSED_MODE }.encode()).await;
        let _ = send.finish().await;
        let _ = tokio::time::timeout(Duration::from_secs(2), connection.closed()).await;
        bail!("a hello named {:?} with intent {intent}: not served here", request.name);
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
                intent == protocol::INTENT_CLAIM && limits.server_name.as_ref().is_none_or(|own| *own == s.server)
            }
            crate::ticket::Purpose::Rejoin(m) => intent == protocol::INTENT_REJOIN && *m == token,
        };
        match tickets.check(&ticket, crate::ticket::unix_now()).and_then(|checked| {
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
            Ok(checked) => {
                if let crate::ticket::Purpose::Seat(s) = &checked.purpose {
                    seat = Some(crate::match_host::SeatClaim {
                        match_id: s.match_id,
                        playlist: s.playlist,
                        seat: s.seat,
                        roster: s.roster,
                    });
                }
                request.key = crate::ticket::account_key(&checked.account);
                request.name = checked.name;
                request.verified = true;
                request.ticket = Some(crate::game::SeatTicket {
                    encoded: ticket,
                    account: checked.account,
                    ratings: checked.ratings.map(|r| r.rating),
                });
            }
            Err(why) => {
                let _ = send.write_all(&Control::Refused { reason: protocol::REFUSED_TICKET }.encode()).await;
                let _ = send.finish().await;
                let _ = tokio::time::timeout(Duration::from_secs(2), connection.closed()).await;
                let rejoin = if intent == protocol::INTENT_REJOIN {
                    format!(", a rejoin of match {token:016x}")
                } else {
                    String::new()
                };
                bail!("ticket refused: {why:?} (a hello named {:?}{rejoin})", request.name);
            }
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
                        // (a game too far behind drops input packets, as lost ones: the queue stays bounded, RV-248)
                        if let Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) =
                            to_game.try_send(ToGame::Inputs { id, timestamp, sequence, first_frame, frames, at: std::time::Instant::now() })
                        {
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
                .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
                .await;
        });
    }
}

/// A development endpoint's answer: its JSON (any page may read it, never cached), or a 400 for a request it can't serve
fn dev_answer(body: Option<String>) -> axum::response::Response {
    use axum::http::{StatusCode, header};
    use axum::response::IntoResponse;
    let open = [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*"), (header::CACHE_CONTROL, "no-store")];
    match body {
        Some(body) => (open, [(header::CONTENT_TYPE, "application/json")], body).into_response(),
        None => (StatusCode::BAD_REQUEST, open).into_response(),
    }
}

/// Development helper: `GET /info` on plain HTTP returns the WebTransport port and the certificate hash, so a browser
/// on this machine can connect to the self-signed server; a development queue server's `GET /dev-ticket` its tickets
/// (`dev_ticket`). A development server's only (SEC-6): on `bind` (127.0.0.1 unless asked), 64 connections at once, 2 s
/// for a request's headers
pub async fn serve_info(
    bind: IpAddr,
    port: u16,
    webtransport_port: u16,
    cert_hash: [u8; 32],
    dev_tickets: Option<Arc<crate::ticket::Tickets>>,
) -> anyhow::Result<()> {
    use axum::routing::get;
    let hex: String = cert_hash.iter().map(|b| format!("{b:02x}")).collect();
    let info = serde_json::json!({ "port": webtransport_port, "certHash": hex }).to_string();
    let mut app = axum::Router::new().route("/info", get(move || std::future::ready(dev_answer(Some(info.clone())))));
    if let Some(tickets) = dev_tickets {
        app = app.route(
            "/dev-ticket",
            get(move |axum::extract::Query(query): axum::extract::Query<DevTicketQuery>| {
                std::future::ready(dev_answer(dev_ticket(&tickets, &query)))
            }),
        );
    }
    serve_http(tokio::net::TcpListener::bind((bind, port)).await?, app, 64, Duration::from_secs(2)).await
}

/// A development ticket's query (`/dev-ticket?…`, form-decoded): `name` ("Dev " and the account's first 4 hex digits
/// when none, so two nameless players aren't one name), `id` (the account's 16 bytes as 32 hex digits, kept by the page
/// so its searches are one account's; random when none), `r1`, `r2`, `r3` (the playlists' ratings, the tests' pairing: a
/// new account's when none) and `rejoin` (the match the rejoin's ticket is for: 16 hex digits, as the API's; required)
#[derive(Debug, Default, serde::Deserialize)]
struct DevTicketQuery {
    name: Option<String>,
    id: Option<String>,
    r1: Option<String>,
    r2: Option<String>,
    r3: Option<String>,
    rejoin: Option<String>,
}

/// A development ticket's JSON for its query; None for a malformed one
fn dev_ticket(tickets: &crate::ticket::Tickets, query: &DevTicketQuery) -> Option<String> {
    let mut ratings = [crate::ticket::DEFAULT_RATING; 3];
    let rejoin = query.rejoin.as_deref()?;
    let match_id = u64::from_str_radix(rejoin, 16).ok().filter(|&m| m != 0 && rejoin.len() == 16)?;
    let mut account = [0u8; 16];
    getrandom::fill(&mut account).ok()?;
    let name =
        query.name.as_deref().map(str::trim).filter(|n| !n.is_empty() && n.len() <= crate::protocol::MAX_NAME_BYTES);
    if let Some(id) = query.id.as_deref().filter(|id| id.len() == 32) {
        for (i, byte) in account.iter_mut().enumerate() {
            *byte = u8::from_str_radix(id.get(2 * i..2 * i + 2)?, 16).ok()?;
        }
    }
    for (rating, value) in ratings.iter_mut().zip([&query.r1, &query.r2, &query.r3]) {
        if let Some(value) = value {
            rating.rating = value.parse().ok()?;
        }
    }
    let name = name.map_or_else(|| format!("Dev {:02x}{:02x}", account[0], account[1]), str::to_string);
    let purpose = crate::ticket::Purpose::Rejoin(match_id);
    let ticket = tickets.dev_ticket(account, &name, ratings, purpose, crate::ticket::unix_now())?;
    Some(serde_json::json!({ "ticket": ticket }).to_string())
}

/// The container's health check (APP-CONTRACT.md): `GET /healthz` on `127.0.0.1:port` answers 200 while the game thread
/// runs (its heartbeat, each loop, within 2 s), else 503
pub async fn serve_health(
    port: u16,
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
    serve_http(tokio::net::TcpListener::bind(("127.0.0.1", port)).await?, app, 16, Duration::from_secs(2)).await
}

/// `carball-server --healthcheck`: asks the health endpoint (2 s at most, never through a proxy the environment names);
/// true if it answered 200
pub async fn health_check(port: u16) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(2)).no_proxy().build() else {
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

    #[test]
    fn a_development_ticket_is_for_the_asked_account_and_name() {
        let tickets = crate::ticket::Tickets::from_list("").unwrap().with_dev_key().unwrap();
        let ticket_of = |query: &str| {
            let uri: axum::http::Uri = format!("http://localhost/dev-ticket?{query}").parse().ok()?;
            let axum::extract::Query(query) = axum::extract::Query::<DevTicketQuery>::try_from_uri(&uri).ok()?;
            let body = dev_ticket(&tickets, &query)?;
            let ticket = body.strip_prefix("{\"ticket\":\"")?.strip_suffix("\"}")?;
            tickets.check(ticket, crate::ticket::unix_now()).ok()
        };
        let id = "0123456789abcdef".repeat(2);
        let t = ticket_of(&format!("name=Caf%C3%A9+Ada&id={id}&rejoin=00000000000000a1")).unwrap();
        assert_eq!((t.name.as_str(), t.account[0], t.account[15]), ("Café Ada", 0x01, 0xef));
        assert_eq!(t.purpose, crate::ticket::Purpose::Rejoin(0xa1), "a rejoin's, for its match");
        assert!(ticket_of("rejoin=00000000000000a1").unwrap().name.starts_with("Dev "), "no name: Dev and the digits");
        assert_eq!(ticket_of(&format!("name=%20%20&id={id}&rejoin=00000000000000a1")).unwrap().name, "Dev 0123");
        // (form decoding's, as a browser's: a malformed escape kept as it is)
        assert_eq!(ticket_of(&format!("name=%zz&id={id}&rejoin=00000000000000a1")).unwrap().name, "%zz");
        assert!(ticket_of(&format!("id={}&rejoin=00000000000000a1", "zz".repeat(16))).is_none(), "a malformed id");
        let long = ticket_of(&format!("name={}&id={id}&rejoin=00000000000000a1", "x".repeat(40)));
        assert_eq!(long.unwrap().name, "Dev 0123", "too long");
        assert!(
            ticket_of(&format!("name=Ada&id={id}")).is_none(),
            "no match: no ticket (a search's are the matchmaker's)"
        );
        for bad in ["a1", "0000000000000000", "zz000000000000a1"] {
            assert!(ticket_of(&format!("id={id}&rejoin={bad}")).is_none(), "a malformed match {bad}");
        }
    }

    /// The development info server as HTTP: its routes and methods (anything else a 404 or 405), the CORS and no-store
    /// headers, a request split across reads read whole, a connection that sends nothing let go after 2 s
    #[tokio::test]
    async fn the_info_server_answers_its_routes_as_http() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let tickets = Arc::new(crate::ticket::Tickets::from_list("").unwrap().with_dev_key().unwrap());
        tokio::spawn(serve_info([127, 0, 0, 1].into(), port, 4433, [0xab; 32], Some(tickets)));
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
        let ticket = get("/dev-ticket?name=Ada&rejoin=00000000000000a1").await.unwrap();
        assert_eq!(ticket.status(), 200);
        assert_eq!(get("/dev-ticket?name=Ada").await.unwrap().status(), 400, "no match");
        assert_eq!(get("/dev-ticket?rejoin=zz").await.unwrap().status(), 400);
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

    #[test]
    fn an_address_gets_its_sessions_at_once_and_a_minutes_starts_only() {
        let limits = NetLimits { per_address: 2, per_address_per_minute: 3, ..NetLimits::default() };
        let (a, b): (IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into());
        let t0 = Instant::now();
        let mut admission = Admission::default();
        assert!(admission.admit(a, t0, &limits) && admission.admit(a, t0, &limits));
        assert!(!admission.admit(a, t0, &limits), "two at once");
        assert!(admission.admit(b, t0, &limits), "another address");
        admission.release(a);
        assert!(admission.admit(a, t0, &limits), "a released one makes room");
        admission.release(a);
        assert!(!admission.admit(a, t0, &limits), "but three starts a minute");
        assert!(admission.admit(a, t0 + Duration::from_secs(61), &limits), "a minute on");
        admission.release(a);
        admission.release(a);
        admission.release(b);
        assert!(admission.active.is_empty());
    }

    /// RV-870: a ping's start given back: an address's pings never run out its starts, a claim after 30 still admitted;
    /// RV-900: up to the pings' budget a minute, then counted as any start (refused once those run out), a minute on
    /// given back again
    #[test]
    fn a_pings_start_is_given_back_within_its_budget() {
        let limits = NetLimits { per_address_per_minute: 3, pings_per_address_per_minute: 5, ..NetLimits::default() };
        let a: IpAddr = [10, 0, 0, 1].into();
        let t0 = Instant::now();
        let mut admission = Admission::default();
        let ping = |admission: &mut Admission, at: Instant| -> bool {
            let admitted = admission.admit(a, at, &limits);
            if admitted {
                admission.refund(a, at, &limits);
                admission.release(a);
            }
            admitted
        };
        assert_eq!((0..5).filter(|_| ping(&mut admission, t0)).count(), 5, "the budget's pings, given back");
        assert!(admission.admit(a, t0, &limits), "a claim after them");
        admission.release(a);
        assert_eq!((0..10).filter(|_| ping(&mut admission, t0)).count(), 2, "past the budget: as any start");
        let t1 = t0 + Duration::from_secs(61);
        assert_eq!((0..5).filter(|_| ping(&mut admission, t1)).count(), 5, "a minute on");
        assert!(admission.admit(a, t1, &limits), "and a claim");
    }

    /// RV-909: an address gone for a minute is let go, its starts and pings with it; one with a session open is kept
    #[test]
    fn addresses_gone_a_minute_are_let_go() {
        let limits = NetLimits::default();
        let (a, b): (IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into());
        let t0 = Instant::now();
        let mut admission = Admission::default();
        assert!(admission.admit(a, t0, &limits));
        admission.refund(a, t0, &limits);
        admission.release(a);
        assert!(admission.admit(a, t0, &limits));
        admission.release(a);
        assert!(admission.admit(b, t0, &limits)); // (b's session stays open)
        assert_eq!((admission.starts.len(), admission.pings.len()), (2, 1));
        let later = t0 + Duration::from_secs(61);
        assert!(admission.admit(b, later, &limits));
        assert!(!admission.starts.contains_key(&a) && !admission.pings.contains_key(&a), "a gone a minute let go");
        assert!(admission.starts.contains_key(&b), "b kept: a start in its minute");
    }

    /// RV-919's P1: the sweep keeps an address whose minute is still open: two starts at 50 s and 55 s, a sweep at 61 s,
    /// then a third within their minute refused (a limit of 2)
    #[test]
    fn the_sweep_keeps_an_open_minute() {
        let limits = NetLimits { per_address_per_minute: 2, ..NetLimits::default() };
        let (a, b): (IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into());
        let t0 = Instant::now();
        let mut admission = Admission::default();
        assert!(admission.admit(b, t0, &limits)); // (the first sweep, at 0 s)
        for at in [50, 55] {
            assert!(admission.admit(a, t0 + Duration::from_secs(at), &limits));
            admission.release(a);
        }
        assert!(
            !admission.admit(a, t0 + Duration::from_secs(61), &limits),
            "a third start in the minute, after a sweep"
        );
    }

    /// RV-919's R22: a ping's refund prunes its own minute: the pings' budget used at 30 s, a sweep at 61 s (which keeps
    /// them: 31 s old), a ping at 95 s refunded all the same
    #[test]
    fn a_refund_prunes_its_own_minute() {
        let limits = NetLimits { per_address_per_minute: 3, pings_per_address_per_minute: 2, ..NetLimits::default() };
        let (a, b): (IpAddr, IpAddr) = ([10, 0, 0, 1].into(), [10, 0, 0, 2].into());
        let t0 = Instant::now();
        let mut admission = Admission::default();
        let ping = |admission: &mut Admission, at: u64| {
            let at = t0 + Duration::from_secs(at);
            assert!(admission.admit(a, at, &limits));
            admission.refund(a, at, &limits);
            admission.release(a);
        };
        assert!(admission.admit(b, t0, &limits)); // (the first sweep, at 0 s)
        ping(&mut admission, 30);
        ping(&mut admission, 30);
        assert!(admission.admit(b, t0 + Duration::from_secs(61), &limits)); // (a sweep)
        ping(&mut admission, 95);
        // (refunded: the address's three starts all still free in 95 s's minute)
        let at = t0 + Duration::from_secs(95);
        assert!((0..3).all(|_| {
            let ok = admission.admit(a, at, &limits);
            admission.release(a);
            ok
        }));
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
        let mut admission = Admission::default();
        let t0 = Instant::now();
        assert!(admission.admit(key("2001:db8::1"), t0, &limits) && admission.admit(key("2001:db8::2"), t0, &limits));
        assert!(!admission.admit(key("2001:db8::3"), t0, &limits));
        assert!(admission.admit(key("2001:db8:0:1::1"), t0, &limits));
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
        let admission = Mutex::new(Admission::default());
        let a: IpAddr = [10, 0, 0, 1].into();
        let t0 = Instant::now();
        for _ in 0..10 {
            assert!(matches!(admit(false, a, &sessions, &admission, &limits, t0), Admit::Retry));
        }
        assert_eq!(sessions.available_permits(), 1);
        assert!(admission.lock().unwrap().active.is_empty());
        let Admit::Admit(permit) = admit(true, a, &sessions, &admission, &limits, t0) else {
            panic!("a proven address admitted")
        };
        assert!(
            matches!(admit(true, [10, 0, 0, 2].into(), &sessions, &admission, &limits, t0), Admit::Refuse(_)),
            "the global cap"
        );
        drop(permit);
        // (a refusal logged once a minute an address: a flood of them a line a minute)
        let mut admission = admission.lock().unwrap();
        assert!(admission.log_refusal(a, t0));
        assert!(!admission.log_refusal(a, t0 + Duration::from_secs(30)), "again within the minute");
        assert!(admission.log_refusal([10, 0, 0, 2].into(), t0), "another address's");
        assert!(admission.log_refusal(a, t0 + Duration::from_secs(61)), "a minute on");
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
