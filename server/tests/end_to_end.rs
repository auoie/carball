//! A client connects over real WebTransport (localhost, the dev certificate by hash), drives, and follows the
//! server's world through updates.

use std::path::Path;
use std::time::{Duration, Instant};

use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use rl_server::engine::{self, Arena};
use rl_server::net::NetLimits;
use rl_server::protocol::{self, Control, Datagram, InputFrame};
use rl_server::{game_loop, net};
use wtransport::{ClientConfig, Endpoint};

/// The tests' clients all come from one address: no per-address limits
fn open_limits() -> NetLimits {
    NetLimits { per_address: 1000, per_address_per_minute: 100_000, ..NetLimits::default() }
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
    let (to_game, messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    std::thread::spawn(move || game_loop::run(
        messages,
        game_loop::Mode::Direct(rl_server::match_host::Playlist {
            team_size: rl_server::game::TEAM_SIZE,
            match_type: rl_server::game::MatchType::Casual,
            forfeit_vote_wait: None,
        }),
        None,
        heartbeat(),
        Instant::now(),
    ));
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
        body: 0,
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
    };
    send.write_all(&hello.encode()).await.unwrap();
    let Control::Welcome { car_id, snapshot, tick_rate, .. } = read_control(&mut recv).await else { panic!("expected welcome") };
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
                first_frame: frame + 1 - keep as u32,
                frames,
            };
            connection.send_datagram(packet.encode()).unwrap();
        }
        if let Ok(Ok(d)) = tokio::time::timeout(Duration::from_millis(2), connection.receive_datagram()).await
            && let Ok(Datagram::Update(u)) = Datagram::decode(&d)
        {
            assert!(world.apply_net_state(&u.state));
            updates += 1;
            last_ack = last_ack.max(u.ack_frame);
            if u.echo_timestamp > 0 {
                let now = begin.elapsed().as_millis() as i64;
                pings.push(now - i64::from(u.echo_timestamp) - i64::from(u.echo_delay));
            }
        }
    }
    let end = world.car_position(car_id).unwrap();
    let driven = (end[0] - start[0]).hypot(end[1] - start[1]);
    println!("updates {updates}, last ack {last_ack} of {frame} frames sent, driven {driven:.0} uu, pings {:?}", &pings[pings.len().saturating_sub(5)..]);
    assert!(updates > 300, "{updates} updates in {:?} (60 Hz expected)", countdown + Duration::from_millis(1500));
    assert!(driven > 500.0, "client view of the car drove {driven} uu");
    assert!(last_ack + 30 > frame, "the server consumed our inputs (ack {last_ack}, sent {frame})");
    assert!(pings.iter().all(|&p| (0..100).contains(&p)), "ping on localhost {pings:?}");
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
    let (to_game, mut messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));
    let hello = Control::Hello {
        version: protocol::VERSION,
        team: 255,
        body: 0,
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
                let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();
                let connection = Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
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

/// A hello for the queue: a search of a playlist, a claim of a token, or a direct join
fn queue_hello(intent: u8, playlist: u8, token: u64) -> Vec<u8> {
    Control::Hello {
        version: protocol::VERSION,
        team: 255,
        body: 0,
        dodge_deadzone: 0.5,
        steering_sensitivity: 1.0,
        air_control_sensitivity: 1.0,
        auto_skip_replay: false,
        key: 0,
        name: String::new(),
        quick_chat: protocol::CHAT_EVERYONE,
        block_non_tactical: false,
        intent,
        playlist,
        token,
    }
    .encode()
}

/// A session's first control message after its hello
async fn first_reply(port: u16, cert_hash: [u8; 32], hello: Vec<u8>) -> (Control, wtransport::Connection, wtransport::RecvStream) {
    let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();
    let connection = Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let (mut send, mut recv) = connection.open_bi().await.unwrap().await.unwrap();
    send.write_all(&hello).await.unwrap();
    std::mem::forget(send); // (the control stream stays open: the session lasts)
    let reply = tokio::time::timeout(Duration::from_secs(10), read_control(&mut recv)).await.expect("a reply");
    (reply, connection, recv)
}

/// Two players search 1v1 on a queue server: each gets a token, claims it with a new session and joins the match on
/// opposite teams; a token claims once; a direct join and an unknown playlist are refused
#[tokio::test(flavor = "multi_thread")]
async fn two_searches_make_a_match_their_tokens_claim() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    let playlists = [1, 2, 3]
        .map(|team_size| rl_server::match_host::Playlist { team_size, match_type: rl_server::game::MatchType::Casual, forfeit_vote_wait: None })
        .to_vec();
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Queue(playlists), None, heartbeat(), Instant::now()));
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));

    let (direct, ..) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_JOIN, 0, 0)).await;
    assert_eq!(direct, Control::Refused { reason: protocol::REFUSED_MODE });
    let (unknown, ..) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_SEARCH, 4, 0)).await;
    assert_eq!(unknown, Control::Refused { reason: protocol::REFUSED_MODE });

    let (a, b) = tokio::join!(
        first_reply(port, cert_hash, queue_hello(protocol::INTENT_SEARCH, 1, 0)),
        first_reply(port, cert_hash, queue_hello(protocol::INTENT_SEARCH, 1, 0)),
    );
    let (Control::MatchFound { token: ta }, ..) = a else { panic!("{:?}", a.0) };
    let (Control::MatchFound { token: tb }, ..) = b else { panic!("{:?}", b.0) };
    assert!(ta != tb && ta != 0 && tb != 0);

    let (ca, _conn_a, mut recv_a) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, ta)).await;
    let Control::Welcome { team_size, key, .. } = ca else { panic!("{ca:?}") };
    assert_eq!(team_size, 1);
    assert_ne!(key, 0);
    let (again, ..) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, ta)).await;
    assert_eq!(again, Control::Refused { reason: protocol::REFUSED_TOKEN }, "claimed once");
    let (cb, _conn_b, _recv_b) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, tb)).await;
    assert!(matches!(cb, Control::Welcome { .. }), "{cb:?}");
    // Both here: a roster of two, one a side, and the warm-up running (no longer held)
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut teams = Vec::new();
    while teams.len() < 2 && Instant::now() < deadline {
        if let Ok(Control::Roster(r)) = tokio::time::timeout(Duration::from_secs(1), read_control(&mut recv_a)).await {
            teams = r.iter().map(|p| p.team).collect();
        }
    }
    teams.sort_unstable();
    assert_eq!(teams, vec![0, 1]);
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
    let (to_game, messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    let playlist = rl_server::match_host::Playlist { team_size: 2, match_type: rl_server::game::MatchType::Casual, forfeit_vote_wait: None };
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now()));
    let limits = NetLimits { per_address: 2, allowed_origins: Some(vec!["https://carball.zolt.top".into()]), ..NetLimits::default() };
    let to_game_capped = to_game.clone();
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    let connect = |origin: Option<&'static str>| async move {
        let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();
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
    let config = || ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(capped_hash)]).build();
    let only = Endpoint::client(config()).unwrap().connect(format!("https://localhost:{capped_port}/play")).await.expect("the one session");
    assert!(Endpoint::client(config()).unwrap().connect(format!("https://localhost:{capped_port}/play")).await.is_err(), "past the most sessions");
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
    let (to_game, messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    let playlist = rl_server::match_host::Playlist { team_size: 2, match_type: rl_server::game::MatchType::Casual, forfeit_vote_wait: None };
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now()));
    let limits = NetLimits { handshake: Duration::from_secs(1), ..open_limits() };
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    let config = || ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();

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
    let inputs = Datagram::Inputs { timestamp: 0, first_frame: 0, frames: vec![InputFrame::default()] }.encode();
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
    let (to_game, messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    let playlist = rl_server::match_host::Playlist { team_size: 2, match_type: rl_server::game::MatchType::Casual, forfeit_vote_wait: None };
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now()));
    tokio::spawn(net::accept_loop(server.clone(), to_game, open_limits()));
    let client = |hash: [u8; 32]| ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(hash)]).build();

    let connection = Endpoint::client(client(old_hash)).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
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
    assert!(Endpoint::client(client(new_hash)).unwrap().connect(format!("https://localhost:{port}/play")).await.is_ok());
    assert!(Endpoint::client(client(old_hash)).unwrap().connect(format!("https://localhost:{port}/play")).await.is_err());
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
    let (to_game, messages) = tokio::sync::mpsc::channel(rl_server::game_loop::TO_GAME_QUEUE);
    let playlist = rl_server::match_host::Playlist { team_size: 1, match_type: rl_server::game::MatchType::Casual, forfeit_vote_wait: None };
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now()));
    tokio::spawn(net::accept_loop(server, to_game, open_limits()));
    let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(new_hash)]).build();
    assert!(Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.is_ok());
}
