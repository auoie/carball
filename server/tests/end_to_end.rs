//! A client connects over real WebTransport (localhost, the dev certificate by hash), drives, and follows the
//! server's world through updates.

use std::path::Path;
use std::time::{Duration, Instant};

use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use carball_server::engine::{self, Arena};
use carball_server::net::NetLimits;
use carball_server::protocol::{self, Control, Datagram, InputFrame};
use carball_server::ticket::{DEFAULT_RATING, Purpose, Seat, Tickets, unix_now};
use carball_server::{game_loop, net};
use wtransport::{ClientConfig, Endpoint};

/// The tests' clients all come from one address: no per-address limits
fn open_limits() -> NetLimits {
    let plenty = net::Rate { burst: 100_000, per_minute: 100_000 };
    NetLimits { per_address: 1000, claims: plenty, pings: plenty, ..NetLimits::default() }
}

/// `open_limits` with the accounts service at `url` asked before a rejoin (RV-1008)
fn asking(url: String) -> NetLimits {
    let config = carball_server::outbox::OutboxConfig {
        api_url: Some(url),
        token: "game-token".into(),
        access: None,
        dir: None,
        server: String::new(),
        first_wait: Duration::from_secs(1),
        max_wait: Duration::from_secs(1),
        https_only: false,
    };
    NetLimits { api: carball_server::outbox::Api::new(&config).unwrap().map(Arc::new), ..open_limits() }
}

/// A stand-in accounts service answering every rejoin's question with `rejoin`
async fn rejoin_service(rejoin: bool) -> wiremock::MockServer {
    let service = wiremock::MockServer::start().await;
    answer_rejoins(&service, rejoin).await;
    service
}

async fn answer_rejoins(service: &wiremock::MockServer, rejoin: bool) {
    wiremock::Mock::given(wiremock::matchers::path("/api/fleet/rejoin"))
        .respond_with(wiremock::ResponseTemplate::new(200).set_body_json(serde_json::json!({ "rejoin": rejoin })))
        .mount(service)
        .await;
}

fn heartbeat() -> Arc<AtomicU64> {
    Arc::new(AtomicU64::new(0))
}

async fn read_control(recv: &mut wtransport::RecvStream) -> Control {
    let mut len = [0u8; 2];
    recv.read_exact(&mut len).await.unwrap();
    let mut body = vec![0u8; usize::from(u16::from_le_bytes(len))];
    recv.read_exact(&mut body).await.unwrap();
    Control::decode(&body).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_client_connects_drives_and_follows_the_world() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    std::thread::spawn(move || {
        game_loop::run(
            messages,
            game_loop::Mode::Direct(carball_server::match_host::Playlist {
                team_size: carball_server::game::TEAM_SIZE,
                match_type: carball_server::game::MatchType::Casual,
                forfeit_vote_wait: None,
            }),
            None,
            heartbeat(),
            Instant::now(),
        )
    });
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));

    let config = ClientConfig::builder()
        .with_bind_default()
        .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
        .build();
    let connection = Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let (mut send, mut recv) = connection.open_bi().await.unwrap().await.unwrap();
    let hello = Control::Hello {
        version: protocol::VERSION,
        team: 255,
        model: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: false,
        key: 7,
        name: "tester".to_string(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
        intent: protocol::INTENT_JOIN,
        playlist: 0,
        token: 0,
        ticket: String::new(),
    };
    send.write_all(&hello.encode()).await.unwrap();
    let Control::Welcome { car_id, snapshot, tick_rate, .. } = read_control(&mut recv).await else {
        panic!("expected welcome")
    };
    assert_eq!(tick_rate, 120);

    let mut world = Arena::new();
    assert!(world.load_state(&snapshot));
    let start = world.car_position(car_id).unwrap();

    // The kickoff countdown (cars get no input), then 1.5 s: inputs at 60 Hz (2 new frames each, resending the
    // last 10), apply every update
    let countdown = Duration::from_secs_f64(f64::from(world.kickoff_countdown()) / 120.0);
    assert!(countdown >= Duration::from_secs(3), "kickoff countdown {countdown:?}");
    let begin = Instant::now();
    let mut frame = 0u32;
    let mut sent: Vec<InputFrame> = Vec::new();
    let mut updates = 0;
    let mut last_ack = 0;
    let mut pings = Vec::new();
    // (the datagrams' own count, protocol 24: the server counts its gaps as inputs lost, none here on localhost)
    let mut datagrams = 0u16;
    let mut lost = 0u32;
    let mut next_send = Instant::now();
    while begin.elapsed() < countdown + Duration::from_millis(1500) {
        if Instant::now() >= next_send {
            next_send += Duration::from_micros(16_667);
            for _ in 0..2 {
                frame += 1;
                sent.push(InputFrame { throttle: 127, ..InputFrame::default() });
            }
            let keep = sent.len().min(protocol::MAX_INPUT_FRAMES);
            let frames = sent[sent.len() - keep..].to_vec();
            let packet = Datagram::Inputs {
                timestamp: begin.elapsed().as_millis() as u32,
                sequence: datagrams,
                first_frame: frame + 1 - keep as u32,
                frames,
            };
            datagrams = datagrams.wrapping_add(1);
            connection.send_datagram(packet.encode()).unwrap();
        }
        if let Ok(Ok(d)) = tokio::time::timeout(Duration::from_millis(2), connection.receive_datagram()).await
            && let Ok(Datagram::Update(u)) = Datagram::decode(&d)
        {
            assert!(world.apply_net_state(&u.state));
            updates += 1;
            if u.part == 0 {
                lost += u32::from(u.input_loss);
            }
            last_ack = last_ack.max(u.ack_frame);
            if u.echo_timestamp > 0 {
                let now = begin.elapsed().as_millis() as i64;
                pings.push(now - i64::from(u.echo_timestamp) - i64::from(u.echo_delay));
            }
        }
    }
    let end = world.car_position(car_id).unwrap();
    let driven = (end[0] - start[0]).hypot(end[1] - start[1]);
    println!(
        "updates {updates}, last ack {last_ack} of {frame} frames sent, driven {driven:.0} uu, pings {:?}",
        &pings[pings.len().saturating_sub(5)..]
    );
    assert!(updates > 300, "{updates} updates in {:?} (60 Hz expected)", countdown + Duration::from_millis(1500));
    assert!(driven > 500.0, "client view of the car drove {driven} uu");
    assert!(last_ack + 30 > frame, "the server consumed our inputs (ack {last_ack}, sent {frame})");
    assert!(pings.iter().all(|&p| (0..100).contains(&p)), "ping on localhost {pings:?}");
    assert_eq!(lost, 0, "inputs lost on localhost");
    // Three datagrams skipped on purpose: the server counts them (the session, the game loop and the update's window)
    datagrams = datagrams.wrapping_add(3);
    let skipped_at = Instant::now();
    let mut reported = 0u32;
    while skipped_at.elapsed() < Duration::from_millis(400) {
        if Instant::now() >= next_send {
            next_send += Duration::from_micros(16_667);
            frame += 1;
            sent.push(InputFrame { throttle: 127, ..InputFrame::default() });
            let keep = sent.len().min(protocol::MAX_INPUT_FRAMES);
            let packet = Datagram::Inputs {
                timestamp: begin.elapsed().as_millis() as u32,
                sequence: datagrams,
                first_frame: frame + 1 - keep as u32,
                frames: sent[sent.len() - keep..].to_vec(),
            };
            datagrams = datagrams.wrapping_add(1);
            connection.send_datagram(packet.encode()).unwrap();
        }
        if let Ok(Ok(d)) = tokio::time::timeout(Duration::from_millis(2), connection.receive_datagram()).await
            && let Ok(Datagram::Update(u)) = Datagram::decode(&d)
            && u.part == 0
        {
            reported += u32::from(u.input_loss);
        }
    }
    assert_eq!(reported, 3, "the skipped datagrams reported lost");
}

/// A client that vanishes without closing (its runtime stops) is a lost connection once the server's idle timeout ends
/// it; one that closes its session left (RV-250: the reason comes from the connection's close, whichever task noticed)
#[tokio::test(flavor = "multi_thread")]
async fn a_vanished_client_is_a_lost_connection_and_a_closed_one_left() {
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let config = wtransport::ServerConfig::builder()
        .with_bind_default(0)
        .with_identity(identity)
        .keep_alive_interval(Some(Duration::from_millis(300)))
        .max_idle_timeout(Some(Duration::from_millis(1500)))
        .unwrap()
        .build();
    let server = Endpoint::server(config).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, mut messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));
    let hello = Control::Hello {
        version: protocol::VERSION,
        team: 255,
        model: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: false,
        key: 0,
        name: String::new(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
        intent: protocol::INTENT_JOIN,
        playlist: 0,
        token: 0,
        ticket: String::new(),
    }
    .encode();
    let mut keep = Vec::new(); // (the game's ends of the sessions' queues)
    for vanish in [true, true, true, false] {
        let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
        let bytes = hello.clone();
        let client = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
            rt.block_on(async {
                let config = ClientConfig::builder()
                    .with_bind_default()
                    .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                    .build();
                let connection =
                    Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
                let (mut send, recv) = connection.open_bi().await.unwrap().await.unwrap();
                send.write_all(&bytes).await.unwrap();
                ready_tx.send(()).unwrap();
                let _ = go_rx.recv();
                if vanish {
                    std::mem::forget((connection, send, recv));
                } else {
                    connection.close(0u32.into(), b"bye");
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            });
            rt.shutdown_background();
        });
        ready_rx.recv().unwrap();
        let joined = loop {
            match tokio::time::timeout(Duration::from_secs(5), messages.recv()).await {
                Ok(Some(net::ToGame::Join { id, out, .. })) => {
                    keep.push(out);
                    break id;
                }
                Ok(Some(_)) => continue,
                other => panic!("no join: {other:?}"),
            }
        };
        go_tx.send(()).unwrap();
        client.join().unwrap();
        let lost = loop {
            match tokio::time::timeout(Duration::from_secs(10), messages.recv()).await {
                Ok(Some(net::ToGame::Leave { id, lost })) if id == joined => break lost,
                Ok(Some(_)) => continue,
                other => panic!("no leave: {other:?}"),
            }
        };
        assert_eq!(lost, vanish, "vanished {vanish}");
    }
}

/// A hello: its intent (a direct join, a ping, a refused search), playlist and token
fn queue_hello(intent: u8, playlist: u8, token: u64) -> Vec<u8> {
    keyed_hello(intent, playlist, token, 0)
}

/// The same with a key (a search's: the browser's)
fn keyed_hello(intent: u8, playlist: u8, token: u64, key: u64) -> Vec<u8> {
    versioned_hello(protocol::VERSION, intent, playlist, token, key)
}

/// The same as a client of `version` speaks it
fn versioned_hello(version: u16, intent: u8, playlist: u8, token: u64, key: u64) -> Vec<u8> {
    Control::Hello {
        version,
        team: 255,
        model: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: false,
        key,
        name: String::new(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
        intent,
        playlist,
        token,
        ticket: String::new(),
    }
    .encode()
}

/// A session's first control message after its hello
async fn first_reply(
    port: u16,
    cert_hash: [u8; 32],
    hello: Vec<u8>,
) -> (Control, wtransport::Connection, wtransport::RecvStream) {
    first_reply_at("localhost", port, cert_hash, hello).await
}

/// The same to a host by name or address (127.0.0.1: an IPv4 client; localhost can be ::1)
async fn first_reply_at(
    host: &str,
    port: u16,
    cert_hash: [u8; 32],
    hello: Vec<u8>,
) -> (Control, wtransport::Connection, wtransport::RecvStream) {
    let config = ClientConfig::builder()
        .with_bind_default()
        .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
        .build();
    let connection = Endpoint::client(config).unwrap().connect(format!("https://{host}:{port}/play")).await.unwrap();
    let (mut send, mut recv) = connection.open_bi().await.unwrap().await.unwrap();
    send.write_all(&hello).await.unwrap();
    std::mem::forget(send); // (the control stream stays open: the session lasts)
    let reply = tokio::time::timeout(Duration::from_secs(10), read_control(&mut recv)).await.expect("a reply");
    (reply, connection, recv)
}

/// A client of another protocol version (an older page, a newer one) is refused with the version reason, its hello's
/// other fields never read: an older one's body that wouldn't decode as this version's (RV-243, RV-538 SM3); this
/// version's hello is let in
#[tokio::test(flavor = "multi_thread")]
async fn another_versions_hello_is_refused_with_the_version_reason_this_ones_let_in() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist {
        team_size: 1,
        match_type: carball_server::game::MatchType::Casual,
        forfeit_vote_wait: None,
    };
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now())
    });
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));

    let refused = Control::Refused { reason: protocol::REFUSED_VERSION };
    // (an older page's hello: its tag and version, then fields this version can't read)
    let [lo, hi] = (protocol::VERSION - 1).to_le_bytes();
    let (older, ..) = first_reply(port, cert_hash, vec![3, 0, 0x01, lo, hi]).await;
    assert_eq!(older, refused, "an older version's hello");
    let (newer, ..) =
        first_reply(port, cert_hash, versioned_hello(protocol::VERSION + 1, protocol::INTENT_JOIN, 0, 0, 0)).await;
    assert_eq!(newer, refused, "a newer version's hello");
    let (current, ..) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_JOIN, 0, 0)).await;
    assert!(!matches!(current, Control::Refused { .. }), "this version's hello let in: {current:?}");
}

/// A hello with a ticket (a claim's match ticket or a rejoin's: who the player is, notes/accounts.md §3)
fn ticketed_hello(intent: u8, playlist: u8, token: u64, ticket: String) -> Vec<u8> {
    Control::Hello {
        version: protocol::VERSION,
        team: 255,
        model: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: false,
        key: 0,
        name: "Hello's own".into(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
        intent,
        playlist,
        token,
        ticket,
    }
    .encode()
}

/// A queue server (the matchmaker's matches) with the development key's tickets, its name `localhost:PORT`; its port
/// and certificate hash, its tickets (for the tests' match tickets), and the short idle timeout's server when `quick`
async fn ticketed_server(quick: bool) -> (u16, [u8; 32], Arc<Tickets>) {
    ticketed_server_limited(quick, open_limits()).await
}

/// `ticketed_server` with these limits (its tickets and name added)
async fn ticketed_server_limited(quick: bool, limits: NetLimits) -> (u16, [u8; 32], Arc<Tickets>) {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = if quick {
        // (a short idle timeout: a vanished client is lost in 1.5 s)
        let config = wtransport::ServerConfig::builder()
            .with_bind_default(0)
            .with_identity(identity)
            .keep_alive_interval(Some(Duration::from_millis(300)))
            .max_idle_timeout(Some(Duration::from_millis(1500)))
            .unwrap()
            .build();
        Endpoint::server(config).unwrap()
    } else {
        net::endpoint(identity, 0).unwrap()
    };
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlists = [1, 2, 3]
        .map(|team_size| carball_server::match_host::Playlist {
            team_size,
            match_type: carball_server::game::MatchType::Ranked,
            forfeit_vote_wait: None,
        })
        .to_vec();
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Queue(playlists), None, heartbeat(), Instant::now())
    });
    let tickets = Arc::new(Tickets::from_list("").unwrap().with_dev_key().unwrap());
    let limits = NetLimits { tickets: Some(tickets.clone()), server_name: Some(format!("localhost:{port}")), ..limits };
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    (port, cert_hash, tickets)
}

/// A match ticket for `account`'s seat of match `match_id` (`roster` seats, a 1v1's 2) at `server`
fn seat_ticket(
    tickets: &Tickets,
    account: u8,
    name: &str,
    match_id: u64,
    seat: u8,
    roster: u8,
    server: &str,
) -> String {
    let seat = Seat { match_id, server: server.into(), playlist: roster / 2, seat, roster };
    tickets.dev_ticket([account; 16], name, [DEFAULT_RATING; 3], Purpose::Seat(seat), unix_now()).unwrap()
}

/// A region's ping is answered at once, its session closed right after (its slot free, not held for the page's close:
/// RV-856); a search or a decline isn't served here (the accounts service's matchmaker has the one queue)
#[tokio::test(flavor = "multi_thread")]
async fn a_ping_is_answered_and_closed_at_once_and_a_search_or_a_decline_is_refused() {
    let (port, cert_hash, _tickets) = ticketed_server(false).await;
    let (pong, connection, _recv) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_PING, 0, 0)).await;
    assert_eq!(
        pong,
        Control::Pong { server: format!("localhost:{port}") },
        "its own name, as its match tickets name it"
    );
    let start = Instant::now();
    let closed = tokio::time::timeout(Duration::from_secs(2), connection.closed()).await;
    assert!(closed.is_ok() && start.elapsed() < Duration::from_millis(600), "closed after {:?}", start.elapsed());
    for intent in [protocol::INTENT_SEARCH, protocol::INTENT_DECLINE] {
        let (reply, ..) = first_reply(port, cert_hash, queue_hello(intent, 1, 0)).await;
        assert_eq!(reply, Control::Refused { reason: protocol::REFUSED_MODE }, "intent {intent}");
    }
}

/// The user's decision of 2026-10-23 (LAN parties): an address's region pings past their allowance go unanswered (the
/// page's dash), its claims' own allowance untouched: a claim after them still heard (refused for its ticket). Every
/// session spends a start as it's admitted (both kinds' allowances together: 5 here), so past those the next is refused
/// before its hello
#[tokio::test(flavor = "multi_thread")]
async fn an_addresss_pings_and_claims_each_have_their_own_allowance() {
    let limits = NetLimits {
        claims: net::Rate { burst: 2, per_minute: 1 },
        pings: net::Rate { burst: 3, per_minute: 1 },
        ..open_limits()
    };
    let (port, cert_hash, _tickets) = ticketed_server_limited(false, limits).await;
    let mut pongs = Vec::new();
    for _ in 0..4 {
        let reply = any_reply(port, cert_hash, queue_hello(protocol::INTENT_PING, 0, 0)).await;
        pongs.push(matches!(reply, Some(Control::Pong { .. })));
    }
    assert_eq!(pongs, [true, true, true, false], "the pings' burst answered, the next not");
    let claim = any_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, 0)).await;
    assert_eq!(claim, Some(Control::Refused { reason: protocol::REFUSED_TICKET }), "a claim after them, heard");
    let past = any_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, 0)).await;
    assert_eq!(past, None, "the starts spent: refused before its hello");
}

/// A session's first control message; none if it's refused, or ends without one (an unanswered ping)
async fn any_reply(port: u16, cert_hash: [u8; 32], hello: Vec<u8>) -> Option<Control> {
    let config = ClientConfig::builder()
        .with_bind_default()
        .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
        .build();
    let connection = Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.ok()?;
    let (mut send, mut recv) = connection.open_bi().await.ok()?.await.ok()?;
    send.write_all(&hello).await.ok()?;
    let mut len = [0u8; 2];
    tokio::time::timeout(Duration::from_secs(5), recv.read_exact(&mut len)).await.ok()?.ok()?;
    let mut body = vec![0u8; usize::from(u16::from_le_bytes(len))];
    recv.read_exact(&mut body).await.ok()?;
    let reply = Control::decode(&body).ok();
    let _ = tokio::time::timeout(Duration::from_secs(2), connection.closed()).await;
    reply
}

/// Match tickets (notes/matchmaking.md, the central matchmaker; RV-850): a claim needs one, for this server, used once;
/// the first claim opens the match (its id the matchmaker's), each seat taken once, the roster named as the tickets
/// name the players; an account in a match here can't claim another; each ticket for its own (a match ticket isn't a
/// rejoin's, a rejoin's not another match's); a 1v1 has no rejoin
#[tokio::test(flavor = "multi_thread")]
async fn match_tickets_open_their_match_here_once_each_seat_its_own() {
    let (port, cert_hash, tickets) = ticketed_server(false).await;
    let here = format!("localhost:{port}");
    let ticket = |account: u8, name: &str, match_id: u64, seat: u8| {
        seat_ticket(&tickets, account, name, match_id, seat, 2, &here)
    };
    let refused = Control::Refused { reason: protocol::REFUSED_TICKET };
    let (none, ..) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, 0)).await;
    assert_eq!(none, refused, "a claim without a ticket");
    let (junk, ..) = first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, "AAAA".into())).await;
    assert_eq!(junk, refused, "a malformed ticket");
    let elsewhere = seat_ticket(&tickets, 1, "Ada", 0xa1, 0, 2, "game-eu.example:4433");
    let (other_server, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, elsewhere)).await;
    assert_eq!(other_server, refused, "another server's match ticket");

    let first = ticket(1, "Ada", 0xa1, 0);
    let (claim, _conn_a, mut recv_a) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, first.clone())).await;
    let Control::Welcome { match_id, team_size, .. } = claim else { panic!("{claim:?}") };
    assert_eq!((match_id, team_size), (0xa1, 1), "opened at its first claim, the matchmaker's id");
    let (reused, ..) = first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, first)).await;
    assert_eq!(reused, refused, "a ticket used once");
    let (taken, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, ticket(2, "Bea", 0xa1, 0))).await;
    assert_eq!(taken, Control::Refused { reason: protocol::REFUSED_TOKEN }, "a seat taken");
    let (cb, _conn_b, _recv_b) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, ticket(2, "Bea", 0xa1, 1))).await;
    assert!(matches!(cb, Control::Welcome { match_id: 0xa1, .. }), "{cb:?}");
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut names = Vec::new();
    while names.len() < 2 && Instant::now() < deadline {
        if let Ok(Control::Roster(r)) = tokio::time::timeout(Duration::from_secs(1), read_control(&mut recv_a)).await {
            names = r.iter().map(|p| p.name.clone()).collect();
        }
    }
    names.sort_unstable();
    assert_eq!(names, vec!["Ada".to_string(), "Bea".to_string()], "the tickets' names");
    let (busy, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, ticket(1, "Ada", 0xb2, 0))).await;
    assert_eq!(busy, Control::Refused { reason: protocol::REFUSED_IN_MATCH }, "a second match for Ada here");
    // (each ticket for its own, AP3)
    let rejoin_ticket =
        |m: u64| tickets.dev_ticket([1; 16], "Ada", [DEFAULT_RATING; 3], Purpose::Rejoin(m), unix_now()).unwrap();
    let (seat_for_rejoin, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_REJOIN, 0, 0xa1, ticket(1, "Ada", 0xa1, 0))).await;
    assert_eq!(seat_for_rejoin, refused, "a match ticket for a rejoin");
    let (rejoin_for_claim, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, rejoin_ticket(0xa1))).await;
    assert_eq!(rejoin_for_claim, refused, "a rejoin's ticket for a claim");
    let (other_match, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_REJOIN, 0, 0xa1, rejoin_ticket(2))).await;
    assert_eq!(other_match, refused, "another match's rejoin ticket");
    let (rejoin, ..) =
        first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_REJOIN, 0, 0xa1, rejoin_ticket(0xa1))).await;
    assert_eq!(rejoin, Control::Refused { reason: protocol::REFUSED_CONCLUDED }, "a 1v1 has no rejoin");
}

/// A ranked 2v2 whose Ada loses her connection (no close: lost at the 1.5 s timeout, reported after its window), then
/// her rejoin of the match with a rejoin ticket for it (what a saved record's RECONNECT asks), the matchmaker confirming
/// it: back in her seat
#[tokio::test(flavor = "multi_thread")]
async fn a_lost_leaver_reported_can_rejoin() {
    let service = rejoin_service(true).await;
    let (port, cert_hash, tickets) = ticketed_server_limited(true, asking(service.uri())).await;
    let here = format!("localhost:{port}");
    let ticket = |account: u8, name: &str, seat: u8| seat_ticket(&tickets, account, name, 0xc3, seat, 4, &here);
    // (Ada's claim on a runtime of its own, so that its connection can vanish)
    let claim = ticketed_hello(protocol::INTENT_CLAIM, 0, 0, ticket(1, "Ada", 0));
    let (welcomed_tx, welcomed_rx) = std::sync::mpsc::channel::<Option<u64>>();
    let (go_tx, go_rx) = std::sync::mpsc::channel::<()>();
    let client = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(1).enable_all().build().unwrap();
        rt.block_on(async {
            let config = ClientConfig::builder()
                .with_bind_default()
                .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
                .build();
            let connection =
                Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
            let (mut send, mut recv) = connection.open_bi().await.unwrap().await.unwrap();
            send.write_all(&claim).await.unwrap();
            let reply = tokio::time::timeout(Duration::from_secs(10), read_control(&mut recv)).await;
            welcomed_tx
                .send(match reply {
                    Ok(Control::Welcome { match_id, .. }) => Some(match_id),
                    _ => None,
                })
                .unwrap();
            let _ = go_rx.recv();
            std::mem::forget((connection, send, recv));
        });
        rt.shutdown_background();
    });
    let match_id = welcomed_rx.recv().unwrap().expect("Ada in the match");
    let mut kept = Vec::new();
    for (account, name, seat) in [(2u8, "Bea", 1u8), (3, "Cy", 2), (4, "Di", 3)] {
        let (reply, conn, recv) =
            first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_CLAIM, 0, 0, ticket(account, name, seat)))
                .await;
        assert!(matches!(reply, Control::Welcome { .. }), "{reply:?}");
        kept.push((conn, recv));
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    go_tx.send(()).unwrap();
    client.join().unwrap();
    tokio::time::sleep(Duration::from_millis(8500)).await;
    let rejoin =
        tickets.dev_ticket([1; 16], "Ada", [DEFAULT_RATING; 3], Purpose::Rejoin(match_id), unix_now()).unwrap();
    let (reply, ..) = first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_REJOIN, 0, match_id, rejoin)).await;
    drop(kept);
    assert!(matches!(reply, Control::Welcome { .. }), "the seat to rejoin: {reply:?}");
}

/// RV-992: on a queue server, a hello with intent 0 (a development server's join) or one unknown (9) is refused
/// REFUSED_MODE by its session: nothing reaches the game thread (no join, no line with the hello's own name)
#[tokio::test(flavor = "multi_thread")]
async fn a_queue_servers_unserved_intents_never_reach_the_game() {
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, mut messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let tickets = Arc::new(Tickets::from_list("").unwrap().with_dev_key().unwrap());
    let limits = NetLimits { tickets: Some(tickets), server_name: Some(format!("localhost:{port}")), ..open_limits() };
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    for intent in [protocol::INTENT_JOIN, 9] {
        let (reply, ..) = first_reply(port, cert_hash, ticketed_hello(intent, 0, 0, String::new())).await;
        assert_eq!(reply, Control::Refused { reason: protocol::REFUSED_MODE }, "intent {intent}");
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    while let Ok(message) = messages.try_recv() {
        assert!(!matches!(message, net::ToGame::Join { .. }), "a join reached the game: {message:?}");
    }
}

/// RV-1008, RV-1020: a rejoin the matchmaker refuses (its account searched or was matched since, maybe at another server)
/// is refused REFUSED_REJOIN_GONE and its ticket spent, that being final: a replay refused as used, the matchmaker never
/// asked again. With the matchmaker failing or down, REFUSED_UNCONFIRMED, never let in, the ticket left good: once it's
/// back, the same ticket gets to the game (a match it doesn't have: concluded)
#[tokio::test(flavor = "multi_thread")]
async fn a_rejoin_the_matchmaker_refuses_or_cant_confirm_is_refused() {
    let service = rejoin_service(false).await;
    let (port, cert_hash, tickets) = ticketed_server_limited(false, asking(service.uri())).await;
    let rejoin = tickets.dev_ticket([5; 16], "Eve", [DEFAULT_RATING; 3], Purpose::Rejoin(0xd4), unix_now()).unwrap();
    let hello = || ticketed_hello(protocol::INTENT_REJOIN, 0, 0xd4, rejoin.clone());
    let (reply, ..) = first_reply(port, cert_hash, hello()).await;
    assert_eq!(reply, Control::Refused { reason: protocol::REFUSED_REJOIN_GONE }, "the matchmaker's no");
    let (replayed, ..) = first_reply(port, cert_hash, hello()).await;
    assert_eq!(replayed, Control::Refused { reason: protocol::REFUSED_TICKET }, "spent: a replay refused as used");
    assert_eq!(service.received_requests().await.unwrap().len(), 1, "the matchmaker asked once");
    let other = tickets.dev_ticket([5; 16], "Eve", [DEFAULT_RATING; 3], Purpose::Rejoin(0xd5), unix_now()).unwrap();
    let hello = || ticketed_hello(protocol::INTENT_REJOIN, 0, 0xd5, other.clone());
    service.reset().await;
    wiremock::Mock::given(wiremock::matchers::path("/api/fleet/rejoin"))
        .respond_with(wiremock::ResponseTemplate::new(503))
        .mount(&service)
        .await;
    let (reply, ..) = first_reply(port, cert_hash, hello()).await;
    assert_eq!(reply, Control::Refused { reason: protocol::REFUSED_UNCONFIRMED }, "the matchmaker failing");
    service.reset().await;
    answer_rejoins(&service, true).await;
    let (reply, ..) = first_reply(port, cert_hash, hello()).await;
    assert_eq!(
        reply,
        Control::Refused { reason: protocol::REFUSED_CONCLUDED },
        "left good, then confirmed: to the game"
    );
    // (the matchmaker down: a server asking at a port nothing listens on)
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let (port, cert_hash, tickets) = ticketed_server_limited(false, asking(format!("http://127.0.0.1:{closed}"))).await;
    let third = tickets.dev_ticket([5; 16], "Eve", [DEFAULT_RATING; 3], Purpose::Rejoin(0xd6), unix_now()).unwrap();
    let (reply, ..) = first_reply(port, cert_hash, ticketed_hello(protocol::INTENT_REJOIN, 0, 0xd6, third)).await;
    assert_eq!(reply, Control::Refused { reason: protocol::REFUSED_UNCONFIRMED }, "the matchmaker down");
}

/// A server that takes pages from one origin only, and few sessions from an address: another origin, or none, is
/// forbidden (the origin's case as browsers send it); the third session at once from the address is refused, and past
/// the server's most sessions any (SEC-5, SEC-2)
#[tokio::test(flavor = "multi_thread")]
async fn other_origins_and_an_addresss_extra_sessions_are_refused() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist {
        team_size: 2,
        match_type: carball_server::game::MatchType::Casual,
        forfeit_vote_wait: None,
    };
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now())
    });
    let limits = NetLimits {
        per_address: 2,
        allowed_origins: Some(vec!["https://carball.zolt.top".into()]),
        ..NetLimits::default()
    };
    let to_game_capped = to_game.clone();
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    let connect = |origin: Option<&'static str>| async move {
        let config = ClientConfig::builder()
            .with_bind_default()
            .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
            .build();
        let mut options = wtransport::endpoint::ConnectOptions::builder(format!("https://localhost:{port}/play"));
        if let Some(origin) = origin {
            options = options.add_header("origin", origin);
        }
        Endpoint::client(config).unwrap().connect(options.build()).await
    };
    assert!(connect(None).await.is_err(), "no origin: forbidden");
    assert!(connect(Some("https://evil.example")).await.is_err(), "another origin: forbidden");
    let first = connect(Some("https://carball.zolt.top")).await.expect("the page's origin");
    let second = connect(Some("https://Carball.Zolt.Top")).await.expect("a second session from the address");
    assert!(connect(Some("https://carball.zolt.top")).await.is_err(), "a third at once: refused");
    drop((first, second));

    // A server of one session at most: the second is refused, whatever its address may have
    let (identity, capped_hash) = net::dev_identity().unwrap();
    let capped = net::endpoint(identity, 0).unwrap();
    let capped_port = capped.local_addr().unwrap().port();
    tokio::spawn(net::accept_loop(Arc::new(capped), to_game_capped, NetLimits { max_sessions: 1, ..open_limits() }));
    let config = || {
        ClientConfig::builder()
            .with_bind_default()
            .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(capped_hash)])
            .build()
    };
    let only = Endpoint::client(config())
        .unwrap()
        .connect(format!("https://localhost:{capped_port}/play"))
        .await
        .expect("the one session");
    assert!(
        Endpoint::client(config()).unwrap().connect(format!("https://localhost:{capped_port}/play")).await.is_err(),
        "past the most sessions"
    );
    drop(only);
}

/// A session that never opens its control stream is closed at the handshake's deadline (SEC-2); one that floods control
/// messages or input datagrams is closed (SEC-3, RV-373); a development server refuses a search or a claim (RV-363)
#[tokio::test(flavor = "multi_thread")]
async fn a_silent_session_times_out_and_a_flooding_one_is_closed() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist {
        team_size: 2,
        match_type: carball_server::game::MatchType::Casual,
        forfeit_vote_wait: None,
    };
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now())
    });
    let limits = NetLimits { handshake: Duration::from_secs(1), ..open_limits() };
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    let config = || {
        ClientConfig::builder()
            .with_bind_default()
            .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)])
            .build()
    };

    let silent = Endpoint::client(config()).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let start = Instant::now();
    let closed = tokio::time::timeout(Duration::from_secs(5), silent.closed()).await;
    assert!(closed.is_ok(), "the silent session is still open after 5 s");
    assert!(start.elapsed() < Duration::from_secs(3), "closed after {:?}", start.elapsed());

    let flooder = Endpoint::client(config()).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let (mut send, mut recv) = flooder.open_bi().await.unwrap().await.unwrap();
    send.write_all(&queue_hello(protocol::INTENT_JOIN, 0, 0)).await.unwrap();
    assert!(matches!(read_control(&mut recv).await, Control::Welcome { .. }));
    let mute = Control::Mute { car: 1, on: true }.encode();
    for _ in 0..400 {
        if send.write_all(&mute).await.is_err() {
            break;
        }
    }
    let closed = tokio::time::timeout(Duration::from_secs(5), flooder.closed()).await;
    assert!(closed.is_ok(), "the flooding session is still open");

    // Input datagrams far over the rate: dropped, then the session closed
    let flooder = Endpoint::client(config()).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let (mut send, mut recv) = flooder.open_bi().await.unwrap().await.unwrap();
    send.write_all(&queue_hello(protocol::INTENT_JOIN, 0, 0)).await.unwrap();
    assert!(matches!(read_control(&mut recv).await, Control::Welcome { .. }));
    let inputs =
        Datagram::Inputs { timestamp: 0, sequence: 0, first_frame: 0, frames: vec![InputFrame::default()] }.encode();
    let flooding = async {
        loop {
            for _ in 0..200 {
                let _ = flooder.send_datagram(inputs.clone());
            }
            tokio::task::yield_now().await;
        }
    };
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::select! {
            _ = flooding => {}
            _ = flooder.closed() => {}
        }
    })
    .await;
    assert!(closed.is_ok(), "the input flood's session is still open");
    drop(send);

    // A development server has no queue: a search and a claim are refused (3, not a token's 2: RX13's S13)
    for hello in [queue_hello(protocol::INTENT_SEARCH, 1, 0), queue_hello(protocol::INTENT_CLAIM, 0, 42)] {
        let (reply, ..) = first_reply(port, cert_hash, hello).await;
        assert_eq!(reply, Control::Refused { reason: protocol::REFUSED_MODE });
    }
}

/// A certificate reload keeps the sessions open now (their matches go on: updates keep coming) and gives new sessions
/// the new certificate (APP-CONTRACT.md: reload on a file change or SIGHUP)
#[tokio::test(flavor = "multi_thread")]
async fn a_certificate_reload_keeps_open_sessions_and_serves_the_new_one() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, old_hash) = net::dev_identity().unwrap();
    let server = Arc::new(net::endpoint(identity, 0).unwrap());
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist {
        team_size: 2,
        match_type: carball_server::game::MatchType::Casual,
        forfeit_vote_wait: None,
    };
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now())
    });
    tokio::spawn(net::accept_loop(server.clone(), to_game, open_limits()));
    let client = |hash: [u8; 32]| {
        ClientConfig::builder()
            .with_bind_default()
            .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(hash)])
            .build()
    };

    let connection =
        Endpoint::client(client(old_hash)).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let (mut send, mut recv) = connection.open_bi().await.unwrap().await.unwrap();
    send.write_all(&queue_hello(protocol::INTENT_JOIN, 0, 0)).await.unwrap();
    assert!(matches!(read_control(&mut recv).await, Control::Welcome { .. }));

    let (identity, new_hash) = net::dev_identity().unwrap();
    server.reload_config(net::server_config(identity, port).unwrap(), false).unwrap();

    // The open session: updates keep coming for a second after the reload
    let until = Instant::now() + Duration::from_secs(1);
    let mut updates = 0;
    while Instant::now() < until {
        if let Ok(Ok(d)) = tokio::time::timeout(Duration::from_millis(50), connection.receive_datagram()).await
            && matches!(Datagram::decode(&d), Ok(Datagram::Update(_)))
        {
            updates += 1;
        }
    }
    assert!(updates > 30, "{updates} updates after the reload");
    // New sessions: the new certificate, not the old one
    assert!(
        Endpoint::client(client(new_hash)).unwrap().connect(format!("https://localhost:{port}/play")).await.is_ok()
    );
    assert!(
        Endpoint::client(client(old_hash)).unwrap().connect(format!("https://localhost:{port}/play")).await.is_err()
    );
    drop(send);
}

/// A key that isn't its certificate's (a renewal read between its two writes) is an error, not wtransport's panic, so the
/// reloads go on; the pair once both are written loads and serves (RV-368)
#[tokio::test(flavor = "multi_thread")]
async fn a_certificate_and_a_key_that_dont_match_are_refused_and_the_pair_then_served() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join("rv368");
    std::fs::create_dir_all(&dir).unwrap();
    let (cert, key) = (dir.join("fullchain.pem"), dir.join("privkey.pem"));
    let (old, _) = net::dev_identity().unwrap();
    let (new, new_hash) = net::dev_identity().unwrap();
    // The renewal half written: the new certificate, the old key
    std::fs::write(&cert, new.certificate_chain().as_slice()[0].to_pem()).unwrap();
    std::fs::write(&key, old.private_key().to_secret_pem()).unwrap();
    let e = net::load_identity(&cert, &key).await.expect_err("a key that isn't the certificate's");
    assert!(format!("{e:#}").contains("not the certificate's"), "{e:#}");
    // Then the new key: loaded, and a server reloaded with it serves the new certificate
    std::fs::write(&key, new.private_key().to_secret_pem()).unwrap();
    let identity = net::load_identity(&cert, &key).await.expect("the pair");
    let (start, _) = net::dev_identity().unwrap();
    let server = Arc::new(net::endpoint(start, 0).unwrap());
    let port = server.local_addr().unwrap().port();
    server.reload_config(net::server_config(identity, port).unwrap(), false).unwrap();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist {
        team_size: 1,
        match_type: carball_server::game::MatchType::Casual,
        forfeit_vote_wait: None,
    };
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now())
    });
    tokio::spawn(net::accept_loop(server, to_game, open_limits()));
    let config = ClientConfig::builder()
        .with_bind_default()
        .with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(new_hash)])
        .build();
    assert!(Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.is_ok());
}

/// A QUIC connection that never asks for a WebTransport session is closed at the QUIC deadline, not the hello's
/// (RV-366, RX14's N5)
#[tokio::test(flavor = "multi_thread")]
async fn a_quic_connection_that_never_asks_for_a_session_is_closed_at_the_quic_deadline() {
    use wtransport::quinn;
    use wtransport::tls::rustls;
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, _) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist {
        team_size: 1,
        match_type: carball_server::game::MatchType::Casual,
        forfeit_vote_wait: None,
    };
    std::thread::spawn(move || {
        game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now())
    });
    let limits =
        NetLimits { quic_handshake: Duration::from_secs(1), handshake: Duration::from_secs(10), ..open_limits() };
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    // (QUIC with WebTransport's ALPN, and nothing after: no HTTP/3 settings, no session request)
    let tls = wtransport::tls::client::build_default_tls_config(
        Arc::new(rustls::RootCertStore::empty()),
        Some(Arc::new(wtransport::tls::client::NoServerVerification::new())),
    );
    let config = quinn::ClientConfig::new(Arc::new(quinn::crypto::rustls::QuicClientConfig::try_from(tls).unwrap()));
    let mut endpoint = quinn::Endpoint::client("0.0.0.0:0".parse().unwrap()).unwrap();
    endpoint.set_default_client_config(config);
    let connection =
        endpoint.connect(([127, 0, 0, 1], port).into(), "localhost").unwrap().await.expect("the QUIC handshake");
    let start = Instant::now();
    let closed = tokio::time::timeout(Duration::from_secs(5), connection.closed()).await;
    assert!(closed.is_ok(), "still open after 5 s");
    assert!(start.elapsed() < Duration::from_secs(3), "closed after {:?}", start.elapsed());
}

/// The binary's `--healthcheck` (the image's HEALTHCHECK): 0 against a live health endpoint, 1 against none, quickly
/// (RX15's C16: its wiring in main)
#[tokio::test(flavor = "multi_thread")]
async fn the_binarys_healthcheck_answers_by_the_health_endpoint() {
    let free_port = || std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let (live, dead) = (free_port(), free_port());
    let start = Instant::now();
    let beat = Arc::new(AtomicU64::new(0));
    tokio::spawn(net::serve_health(net::bind_health(live).await.unwrap(), beat.clone(), start));
    tokio::time::sleep(Duration::from_millis(200)).await;
    beat.store(start.elapsed().as_millis() as u64, std::sync::atomic::Ordering::Relaxed);
    // (beside settings the server itself would refuse, a queue without a certificate or origins: the check reads only
    // the health port, RV-399, RV-429)
    let check = |port: u16| {
        std::process::Command::new(env!("CARGO_BIN_EXE_carball-server"))
            .args(["--healthcheck", "--health-port", &port.to_string()])
            .env_remove("HEALTH_PORT")
            .envs([("SERVER_MODE", "queue"), ("CERT_PATH", ""), ("KEY_PATH", ""), ("ALLOWED_ORIGIN", "")])
            .status()
            .unwrap()
            .code()
    };
    let at = Instant::now();
    assert_eq!(tokio::task::spawn_blocking(move || check(live)).await.unwrap(), Some(0));
    assert_eq!(tokio::task::spawn_blocking(move || check(dead)).await.unwrap(), Some(1));
    assert!(at.elapsed() < Duration::from_secs(5), "{:?}", at.elapsed());
}

/// A meshes folder that isn't the arena's is refused at startup, what's wrong named, never taken for a healthy server whose
/// first match aborts the process or whose goals sit unplaced at the field's centre (RV-421, RV-434): empty, the layout
/// before the rename (soccar/), a partial copy, the goal halves' older trailer (RLOF: the engine's refusal, caught), unplaced
/// goals, a truncated file, a bad triangle index (the engine's)
#[test]
fn the_binary_refuses_a_meshes_folder_that_isnt_the_arenas() {
    let meshes = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes/arena"));
    let mut files: Vec<_> = std::fs::read_dir(meshes)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "cmf"))
        .collect();
    files.sort();
    assert_eq!(files.len(), 16);
    let root = Path::new(env!("CARGO_TARGET_TMPDIR")).join("meshes_layouts");
    // (a copy of the arena's meshes under `name/folder`, each file's bytes edited, or left out)
    let copy = |name: &str, folder: &str, edit: &dyn Fn(usize, Vec<u8>) -> Option<Vec<u8>>| {
        let dir = root.join(name);
        std::fs::create_dir_all(dir.join(folder)).unwrap();
        for (i, file) in files.iter().enumerate() {
            if let Some(bytes) = edit(i, std::fs::read(file).unwrap()) {
                std::fs::write(dir.join(folder).join(file.file_name().unwrap()), bytes).unwrap();
            }
        }
        dir
    };
    let goal = |bytes: &[u8]| bytes.len() >= 16 && &bytes[bytes.len() - 16..bytes.len() - 12] == b"CBOF";
    let empty = root.join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let cases = [
        (empty.clone(), "no arena collision meshes (arena/*.cmf) in"),
        (copy("old", "soccar", &|_, b| Some(b)), "no arena collision meshes (arena/*.cmf) in"),
        (copy("partial", "arena", &|i, b| (i == 0).then_some(b)), "holds 1 mesh, not the arena's 16"),
        (
            copy("rlof", "arena", &|_, mut b| {
                if goal(&b) {
                    let at = b.len() - 16;
                    b[at..at + 4].copy_from_slice(b"RLOF");
                }
                Some(b)
            }),
            "16 bytes after the vertices that aren't a body offset",
        ),
        (
            copy("unplaced", "arena", &|_, b| Some(if goal(&b) { b[..b.len() - 16].to_vec() } else { b })),
            "0 meshes placed by a body offset",
        ),
        (
            copy("truncated", "arena", &|i, b| Some(if i == 3 { b[..b.len() - 5].to_vec() } else { b })),
            "not a whole mesh (truncated",
        ),
        (
            copy("bad_index", "arena", &|i, mut b| {
                if i == 5 {
                    b[8..12].copy_from_slice(&i32::MAX.to_le_bytes());
                }
                Some(b)
            }),
            "bad triangle vertex index",
        ),
    ];
    for (dir, expected) in &cases {
        let mut server = std::process::Command::new(env!("CARGO_BIN_EXE_carball-server"))
            .args(["--dev", "--mode", "direct", "--port", "0", "--dev-info", "off", "--health-port", "0", "--meshes"])
            .arg(dir)
            .env_remove("MESHES_DIR")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        // (a server that started anyway is stopped, the test failed, not left running)
        let at = Instant::now();
        while server.try_wait().unwrap().is_none() && at.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(50));
        }
        if server.try_wait().unwrap().is_none() {
            server.kill().unwrap();
        }
        let out = server.wait_with_output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        // (exit 1 with the reason: not 134, an engine exception aborting the process)
        assert_eq!(out.status.code(), Some(1), "{}: {stderr}", dir.display());
        assert!(stderr.contains(expected) && stderr.contains(&*dir.to_string_lossy()), "{}: {stderr}", dir.display());
    }
}
