//! WebTransport front end: accepts sessions on `/play`, reads the player's `Hello` from the control stream, then
//! forwards input datagrams to the game and the game's messages to the client (`protocol/README.md`). What it lets in
//! (the security review's SEC-2, SEC-3, SEC-5: `NetLimits`): QUIC's stream and buffer limits, sessions at once and per
//! address, the handshake's deadline, the page's origin, each session's message rates.

use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
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
    /// Search the queue of the playlist with this team size
    Search { team_size: u8 },
    /// Claim a reserved slot (the token a search's `MatchFound` gave)
    Claim { token: u64 },
}

/// Messages from the network tasks to the game loop
#[derive(Debug)]
pub enum ToGame {
    Join { id: PlayerId, intent: Intent, request: JoinRequest, out: Sender<Outgoing> },
    /// The session ended; `lost`: its connection timed out
    Leave { id: PlayerId, lost: bool },
    Inputs { id: PlayerId, timestamp: u32, first_frame: u32, frames: Vec<InputFrame>, at: std::time::Instant },
    ResetInputBuffer { id: PlayerId },
    /// Skip the goal replay
    ReadyUp { id: PlayerId },
    AutoSkipReplay { id: PlayerId, on: bool },
    /// Vote to forfeit (starts or joins the team's vote)
    VoteForfeit { id: PlayerId },
    /// A quick-chat preset
    QuickChat { id: PlayerId, preset: u8, team: bool },
    /// The player's chat filters
    ChatFilter { id: PlayerId, quick_chat: u8, block_non_tactical: bool },
    /// The player muted or unmuted another player's chat
    Mute { id: PlayerId, car: u32, on: bool },
    /// The connection's round-trip time (ms)
    Ping { id: PlayerId, ms: u32 },
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

/// What the front end lets in: sessions at once, per address at once and new a minute (SEC-2), the page origins
/// allowed (SEC-5; None: any, a development server). The defaults are a public server's; the browser tests' servers,
/// every page on one address, raise the per-address limits
#[derive(Clone, Debug)]
pub struct NetLimits {
    pub max_sessions: usize,
    pub per_address: usize,
    pub per_address_per_minute: usize,
    pub allowed_origins: Option<Vec<String>>,
    /// The handshake, from the first packet through the hello, must be done this soon
    pub handshake: Duration,
}

impl Default for NetLimits {
    fn default() -> Self {
        Self { max_sessions: 512, per_address: 8, per_address_per_minute: 30, allowed_origins: None, handshake: Duration::from_secs(10) }
    }
}
/// Each session's rates (SEC-3), a second and a burst: input datagrams (a client sends one a frame; more are dropped, as
/// lost packets) and control messages (more are dropped; a session that keeps on is closed)
const INPUT_RATE: (f64, f64) = (240.0, 120.0);
const CONTROL_RATE: (f64, f64) = (20.0, 40.0);
/// Control messages dropped over the rate before the session is closed
const CONTROL_OVERRUN_LIMIT: u32 = 200;

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

/// The sessions of each address: at once, and the starts of the last minute (SEC-2)
#[derive(Debug, Default)]
pub struct Admission {
    active: HashMap<IpAddr, usize>,
    starts: HashMap<IpAddr, VecDeque<Instant>>,
}

impl Admission {
    /// A new session from `address`, if its limits allow it (counted then: `release` when it ends)
    pub fn admit(&mut self, address: IpAddr, now: Instant, limits: &NetLimits) -> bool {
        let starts = self.starts.entry(address).or_default();
        while starts.front().is_some_and(|&t| now.saturating_duration_since(t) >= Duration::from_secs(60)) {
            starts.pop_front();
        }
        let active = self.active.get(&address).copied().unwrap_or(0);
        if active >= limits.per_address || starts.len() >= limits.per_address_per_minute {
            return false;
        }
        starts.push_back(now);
        *self.active.entry(address).or_default() += 1;
        true
    }

    pub fn release(&mut self, address: IpAddr) {
        if let Some(n) = self.active.get_mut(&address) {
            *n -= 1;
            if *n == 0 {
                self.active.remove(&address);
                if self.starts.get(&address).is_some_and(VecDeque::is_empty) {
                    self.starts.remove(&address);
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
        // (refused before anything is spent on it: too many sessions, or too many from its address)
        let address = incoming.remote_address().ip();
        let Ok(permit) = sessions.clone().try_acquire_owned() else {
            incoming.refuse();
            continue;
        };
        if !admission.lock().unwrap().admit(address, Instant::now(), &limits) {
            incoming.refuse();
            continue;
        }
        let id = next_id;
        next_id += 1;
        let to_game = to_game.clone();
        let admission = admission.clone();
        let limits = limits.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let lost = match session(incoming, id, &to_game, &limits).await {
                Ok(lost) => lost,
                Err(e) => {
                    eprintln!("player {id}: {e:#}");
                    matches!(e.downcast_ref::<wtransport::error::ConnectionError>(), Some(wtransport::error::ConnectionError::TimedOut))
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
) -> anyhow::Result<Option<(wtransport::Connection, wtransport::SendStream, wtransport::RecvStream, Result<Control, u16>)>> {
    let request = incoming.await?;
    if request.path() != "/play" {
        request.not_found().await;
        return Ok(None);
    }
    if let Some(allowed) = &limits.allowed_origins
        && !request.origin().is_some_and(|origin| allowed.iter().any(|a| a == origin))
    {
        eprintln!("session from origin {:?} refused", request.origin());
        request.forbidden().await;
        return Ok(None);
    }
    let connection = request.accept().await?;
    let (send, mut recv) = connection.accept_bi().await.context("no control stream")?;
    let hello = read_hello(&mut recv).await?;
    Ok(Some((connection, send, recv, hello)))
}

/// One player's session; `Ok(lost)`: whether it ended by its connection timing out (the chat log's "lost connection")
async fn session(incoming: IncomingSession, id: PlayerId, to_game: &Sender<ToGame>, limits: &NetLimits) -> anyhow::Result<bool> {
    // (the whole handshake within its deadline: a session that never opens its control stream is gone, SEC-2)
    let Some((connection, mut send, mut recv, hello)) = tokio::time::timeout(limits.handshake, handshake(incoming, limits)).await.context("no hello in time")??
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
    let Control::Hello {
        team,
        body,
        dodge_deadzone,
        steering_sensitivity,
        air_control_sensitivity,
        auto_skip_replay,
        key,
        name,
        quick_chat,
        block_non_tactical,
        intent,
        playlist,
        token,
        ..
    } = hello
    else {
        bail!("expected hello");
    };
    let intent = match intent {
        protocol::INTENT_SEARCH => Intent::Search { team_size: playlist },
        protocol::INTENT_CLAIM => Intent::Claim { token },
        _ => Intent::Join,
    };

    let (out_tx, mut out_rx) = channel(OUT_QUEUE);
    let request = JoinRequest { team, body, dodge_deadzone, steering_sensitivity, air_control_sensitivity, auto_skip_replay, key, name, quick_chat, block_non_tactical };
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
    let mut control_reader = tokio::spawn(async move {
        // (at most CONTROL_RATE: more are dropped, and a session that keeps on is closed, SEC-3)
        let mut bucket = TokenBucket::new(CONTROL_RATE, Instant::now());
        let mut overrun = 0;
        loop {
            let read = read_control(&mut recv).await;
            if read.is_ok() && !bucket.take(Instant::now()) {
                overrun += 1;
                if overrun > CONTROL_OVERRUN_LIMIT {
                    eprintln!("player {id}: control messages over the rate, session ends");
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
                Ok(Control::ChatFilter { quick_chat, block_non_tactical }) => ToGame::ChatFilter { id, quick_chat, block_non_tactical },
                Ok(Control::Mute { car, on }) => ToGame::Mute { id, car, on },
                Ok(_) => continue, // (nothing else is expected from a client)
                Err(e) => {
                    // (a malformed message ends the session: say why; a closed stream is the usual end)
                    if e.downcast_ref::<protocol::DecodeError>().is_some() {
                        eprintln!("player {id}: malformed control message ({e}), session ends");
                    }
                    break;
                }
            };
            if control_to_game.send(message).await.is_err() {
                break;
            }
        }
    });

    // Client -> game: input datagrams (at most INPUT_RATE: more are dropped as lost, SEC-3); the round-trip time each
    // second (the scoreboard's ping)
    let mut ping_every = tokio::time::interval(Duration::from_secs(1));
    let mut inputs = TokenBucket::new(INPUT_RATE, Instant::now());
    let result: anyhow::Result<()> = loop {
        tokio::select! {
            _ = ping_every.tick() => {
                let _ = to_game.try_send(ToGame::Ping { id, ms: connection.rtt().as_millis().min(u128::from(u32::MAX)) as u32 });
            }
            datagram = connection.receive_datagram() => match datagram {
                Ok(d) => {
                    if !inputs.take(Instant::now()) {
                        continue;
                    }
                    if let Ok(Datagram::Inputs { timestamp, first_frame, frames }) = Datagram::decode(&d) {
                        // (a game too far behind drops input packets, as lost ones: the queue stays bounded, RV-248)
                        if let Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) =
                            to_game.try_send(ToGame::Inputs { id, timestamp, first_frame, frames, at: std::time::Instant::now() })
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
        eprintln!("player {id}: {refused} datagrams refused by the connection (too large or unsupported)");
    }
    result?;
    // (whichever branch noticed first, the connection's own close says why: an idle timeout is a lost connection, RV-250)
    let reason = tokio::time::timeout(Duration::from_millis(100), connection.closed()).await;
    Ok(matches!(reason, Ok(wtransport::error::ConnectionError::TimedOut)))
}

/// Development helper: `GET /info` on plain HTTP returns the WebTransport port and the certificate hash, so a browser
/// on this machine can connect to the self-signed server. A development server's only (SEC-6): on `bind` (127.0.0.1
/// unless asked), 64 connections at once, a 2 s read
pub async fn serve_info(bind: IpAddr, port: u16, webtransport_port: u16, cert_hash: [u8; 32]) -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let hex: String = cert_hash.iter().map(|b| format!("{b:02x}")).collect();
    let body = format!("{{\"port\":{webtransport_port},\"certHash\":\"{hex}\"}}");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let listener = tokio::net::TcpListener::bind((bind, port)).await?;
    let open = Arc::new(tokio::sync::Semaphore::new(64));
    loop {
        // (an accept error, a connection reset early, isn't the server's end)
        let Ok((mut stream, _)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        let Ok(permit) = open.clone().try_acquire_owned() else { continue };
        let response = response.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let mut request = [0u8; 1024];
            if tokio::time::timeout(Duration::from_secs(2), stream.read(&mut request)).await.is_ok() {
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });
    }
}

/// The container's health check (APP-CONTRACT.md): `GET /healthz` on `127.0.0.1:port` answers 200 while the game thread
/// runs (its heartbeat, each loop, within 2 s), else 503
pub async fn serve_health(port: u16, heartbeat: Arc<std::sync::atomic::AtomicU64>, start: Instant) -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    loop {
        let Ok((mut stream, _)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        let heartbeat = heartbeat.clone();
        tokio::spawn(async move {
            let mut request = [0u8; 256];
            let _ = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut request)).await;
            let beat = heartbeat.load(std::sync::atomic::Ordering::Relaxed);
            let now = start.elapsed().as_millis() as u64;
            let ok = now.saturating_sub(beat) < 2000;
            let (status, body) = if ok { ("200 OK", "ok") } else { ("503 Service Unavailable", "the game thread is stuck") };
            let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}

/// `rl-server --healthcheck`: asks the health endpoint; true if it answered 200
pub fn health_check(port: u16) -> bool {
    use std::io::{Read, Write};
    let Ok(mut stream) = std::net::TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(2)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    if stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\n\r\n").is_err() {
        return false;
    }
    let mut response = [0u8; 64];
    let n = stream.read(&mut response).unwrap_or(0);
    response[..n].starts_with(b"HTTP/1.1 200")
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
