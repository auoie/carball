//! A client connects over real WebTransport (localhost, the dev certificate by hash), drives, and follows the
//! server's world through updates.

use std::path::Path;
use std::time::{Duration, Instant};

use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use carball_server::engine::{self, Arena};
use carball_server::net::NetLimits;
use carball_server::protocol::{self, Control, Datagram, InputFrame};
use carball_server::game::Outgoing;
use carball_server::{game_loop, net};
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
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    std::thread::spawn(move || game_loop::run(
        messages,
        game_loop::Mode::Direct(carball_server::match_host::Playlist {
            team_size: carball_server::game::TEAM_SIZE,
            match_type: carball_server::game::MatchType::Casual,
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
    println!("updates {updates}, last ack {last_ack} of {frame} frames sent, driven {driven:.0} uu, pings {:?}", &pings[pings.len().saturating_sub(5)..]);
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
            let packet = Datagram::Inputs { timestamp: begin.elapsed().as_millis() as u32, sequence: datagrams, first_frame: frame + 1 - keep as u32, frames: sent[sent.len() - keep..].to_vec() };
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
    keyed_hello(intent, playlist, token, 0)
}

/// The same with a key (a search's: the browser's)
fn keyed_hello(intent: u8, playlist: u8, token: u64, key: u64) -> Vec<u8> {
    Control::Hello {
        version: protocol::VERSION,
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
    }
    .encode()
}

/// A session's first control message after its hello
async fn first_reply(port: u16, cert_hash: [u8; 32], hello: Vec<u8>) -> (Control, wtransport::Connection, wtransport::RecvStream) {
    first_reply_at("localhost", port, cert_hash, hello).await
}

/// The same to a host by name or address (127.0.0.1: an IPv4 client; localhost can be ::1)
async fn first_reply_at(host: &str, port: u16, cert_hash: [u8; 32], hello: Vec<u8>) -> (Control, wtransport::Connection, wtransport::RecvStream) {
    let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();
    let connection = Endpoint::client(config).unwrap().connect(format!("https://{host}:{port}/play")).await.unwrap();
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
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlists = [1, 2, 3]
        .map(|team_size| carball_server::match_host::Playlist { team_size, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None })
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
    let (Control::MatchFound { token: ta, map: ma }, ..) = a else { panic!("{:?}", a.0) };
    let (Control::MatchFound { token: tb, map: mb }, ..) = b else { panic!("{:?}", b.0) };
    assert!(ta != tb && ta != 0 && tb != 0);
    // (the match's map, Night, the same for both: in their MatchFound and their welcomes)
    assert!(ma == mb && ma == protocol::NIGHT_MAP, "{ma} {mb}");

    let (ca, _conn_a, mut recv_a) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, ta)).await;
    let Control::Welcome { team_size, key, map, .. } = ca else { panic!("{ca:?}") };
    assert_eq!((team_size, map), (1, ma));
    assert_ne!(key, 0);
    let (again, ..) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, ta)).await;
    assert_eq!(again, Control::Refused { reason: protocol::REFUSED_TOKEN }, "claimed once");
    let (cb, _conn_b, _recv_b) = first_reply(port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, tb)).await;
    assert!(matches!(cb, Control::Welcome { map, .. } if map == ma), "{cb:?}");
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

/// A search's session, its control stream kept for the test to close (as the page's `finish`)
async fn search_session(port: u16, cert_hash: [u8; 32], playlist: u8, key: u64) -> (wtransport::Connection, wtransport::SendStream, wtransport::RecvStream) {
    let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();
    let connection = Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
    let (mut send, recv) = connection.open_bi().await.unwrap().await.unwrap();
    send.write_all(&keyed_hello(protocol::INTENT_SEARCH, playlist, 0, key)).await.unwrap();
    (connection, send, recv)
}

/// The session's next control message within `wait`; None if its stream ended first (or nothing came)
async fn next_control(recv: &mut wtransport::RecvStream, wait: Duration) -> Option<Control> {
    tokio::time::timeout(wait, async {
        let mut len = [0u8; 2];
        recv.read_exact(&mut len).await.ok()?;
        let mut body = vec![0u8; usize::from(u16::from_le_bytes(len))];
        recv.read_exact(&mut body).await.ok()?;
        Control::decode(&body).ok()
    })
    .await
    .ok()
    .flatten()
}

/// A search's page closing its stream takes it out of the queue at once (CancelSearch, SM5: a search after that isn't
/// matched with it); a match formed as it closed still reaches it (the flush on close, SM6: its MatchFound if and only if
/// its rival's); a newer search from its browser key tells it why (KICK_REPLACED, RV-460). RV-461
#[tokio::test(flavor = "multi_thread")]
async fn a_closed_search_leaves_the_queue_a_match_formed_as_it_closed_reaches_it_and_a_replaced_one_is_told() {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlists = [1, 2, 3]
        .map(|team_size| carball_server::match_host::Playlist { team_size, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None })
        .to_vec();
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Queue(playlists), None, heartbeat(), Instant::now()));
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));
    let found = |c: &Option<Control>| matches!(c, Some(Control::MatchFound { .. }));

    // CancelSearch: closed, its session ends with no answer; the next searcher waits, matched with the one after
    let (_a, mut a_send, mut a_recv) = search_session(port, cert_hash, 1, 101).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    a_send.finish().await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let (_b, _b_send, mut b_recv) = search_session(port, cert_hash, 1, 102).await;
    assert_eq!(next_control(&mut a_recv, Duration::from_secs(3)).await, None, "the closed search isn't matched");
    assert_eq!(next_control(&mut b_recv, Duration::from_millis(500)).await, None, "nobody to play yet");
    let (_c, _c_send, mut c_recv) = search_session(port, cert_hash, 1, 103).await;
    assert!(found(&next_control(&mut b_recv, Duration::from_secs(5)).await));
    assert!(found(&next_control(&mut c_recv, Duration::from_secs(5)).await));

    // The flush: a page closing as its rival's search lands, whichever comes first, both or neither get the match (the
    // rival's hello `offset` ms after the close, before it if negative: around the game loop's 8 ms tick, so some rounds
    // form the match just before the close is seen)
    let mut rounds_found = 0;
    for (round, offset) in [-10i64, -8, -6, -5, -4, -3, -2, -1, 0, 2].into_iter().enumerate() {
        let key = 200 + 10 * round as u64;
        let (_d, mut d_send, mut d_recv) = search_session(port, cert_hash, 1, key).await;
        let (_e, mut e_send, mut e_recv) = {
            let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(cert_hash)]).build();
            let connection = Endpoint::client(config).unwrap().connect(format!("https://localhost:{port}/play")).await.unwrap();
            let (send, recv) = connection.open_bi().await.unwrap().await.unwrap();
            (connection, send, recv)
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        let rival = async {
            tokio::time::sleep(Duration::from_millis(offset.max(0).unsigned_abs())).await;
            e_send.write_all(&keyed_hello(protocol::INTENT_SEARCH, 1, 0, key + 1)).await.unwrap();
        };
        let close = async {
            tokio::time::sleep(Duration::from_millis(offset.min(0).unsigned_abs())).await;
            d_send.finish().await.unwrap();
        };
        tokio::join!(close, rival);
        let d = next_control(&mut d_recv, Duration::from_secs(3)).await;
        let e = next_control(&mut e_recv, Duration::from_secs(1)).await;
        assert_eq!(found(&d), found(&e), "round {round}: the closed page's answer {d:?}, its rival's {e:?}");
        if !found(&d) {
            // (the rival still waits: another searcher makes its match, the queue left clean for the next round)
            let (_f, _f_send, mut f_recv) = search_session(port, cert_hash, 1, key + 2).await;
            assert!(found(&next_control(&mut e_recv, Duration::from_secs(5)).await), "round {round}");
            assert!(found(&next_control(&mut f_recv, Duration::from_secs(5)).await), "round {round}");
        }
        rounds_found += usize::from(found(&d));
    }
    println!("the flush: {rounds_found} of 10 rounds matched the closing page");

    // RV-460: a second tab of the browser searching: the first told why, its session ended; the second waits
    let (_old, _old_send, mut old_recv) = search_session(port, cert_hash, 3, 300).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let (_new, _new_send, mut new_recv) = search_session(port, cert_hash, 3, 300).await;
    assert_eq!(next_control(&mut old_recv, Duration::from_secs(5)).await, Some(Control::Kicked { reason: protocol::KICK_REPLACED }));
    assert_eq!(next_control(&mut old_recv, Duration::from_secs(5)).await, None, "then its session ends");
    assert_eq!(next_control(&mut new_recv, Duration::from_millis(500)).await, None, "the new search waits");
}

/// The flush on close made certain (SM9, RV-486): a stand-in game answers the closing search's CancelSearch with a
/// match found (one formed just before the cancel was seen, the race above's rare case): the page still reads it, so the
/// search is out of the queue before the session ends and what the game sent before that goes out
#[tokio::test(flavor = "multi_thread")]
async fn a_closing_search_writes_out_what_the_game_sent_before_its_cancel() {
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, mut messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));
    // (the game: the search's Join kept; its CancelSearch answered with a match, then let go; true if the cancel came
    // before the session's Leave)
    let game = tokio::spawn(async move {
        let mut searcher = None;
        while let Some(message) = messages.recv().await {
            match message {
                net::ToGame::Join { out, .. } => searcher = Some(out),
                net::ToGame::CancelSearch { .. } => {
                    if let Some(out) = searcher.take() {
                        let _ = out.send(Outgoing::Control(Control::MatchFound { token: 7, map: 3 }.encode())).await;
                    }
                    return true;
                }
                net::ToGame::Leave { .. } => return false,
                _ => {}
            }
        }
        false
    });
    let (_d, mut d_send, mut d_recv) = search_session(port, cert_hash, 1, 900).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    d_send.finish().await.unwrap();
    assert_eq!(next_control(&mut d_recv, Duration::from_secs(3)).await, Some(Control::MatchFound { token: 7, map: 3 }));
    assert_eq!(next_control(&mut d_recv, Duration::from_secs(3)).await, None, "then its stream ends");
    assert!(game.await.unwrap(), "the search cancelled before its session ended");
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
    let playlist = carball_server::match_host::Playlist { team_size: 2, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None };
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
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist { team_size: 2, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None };
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
    let inputs = Datagram::Inputs { timestamp: 0, sequence: 0, first_frame: 0, frames: vec![InputFrame::default()] }.encode();
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
    let playlist = carball_server::match_host::Playlist { team_size: 2, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None };
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
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlist = carball_server::match_host::Playlist { team_size: 1, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None };
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now()));
    tokio::spawn(net::accept_loop(server, to_game, open_limits()));
    let config = ClientConfig::builder().with_bind_default().with_server_certificate_hashes([wtransport::tls::Sha256Digest::new(new_hash)]).build();
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
    let playlist = carball_server::match_host::Playlist { team_size: 1, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None };
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Direct(playlist), None, heartbeat(), Instant::now()));
    let limits = NetLimits { quic_handshake: Duration::from_secs(1), handshake: Duration::from_secs(10), ..open_limits() };
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, limits));
    // (QUIC with WebTransport's ALPN, and nothing after: no HTTP/3 settings, no session request)
    let tls = wtransport::tls::client::build_default_tls_config(
        Arc::new(rustls::RootCertStore::empty()),
        Some(Arc::new(wtransport::tls::client::NoServerVerification::new())),
    );
    let config = quinn::ClientConfig::new(Arc::new(quinn::crypto::rustls::QuicClientConfig::try_from(tls).unwrap()));
    let mut endpoint = quinn::Endpoint::client("0.0.0.0:0".parse().unwrap()).unwrap();
    endpoint.set_default_client_config(config);
    let connection = endpoint.connect(([127, 0, 0, 1], port).into(), "localhost").unwrap().await.expect("the QUIC handshake");
    let start = Instant::now();
    let closed = tokio::time::timeout(Duration::from_secs(5), connection.closed()).await;
    assert!(closed.is_ok(), "still open after 5 s");
    assert!(start.elapsed() < Duration::from_secs(3), "closed after {:?}", start.elapsed());
}

/// A 1v1 found for the keys `a` and `b` from `host`; `a` claims, `b` never does: `a`'s session told at the window's end
async fn stalled_match(host: &str, port: u16, cert_hash: [u8; 32], a: u64, b: u64) {
    let (ra, rb) = tokio::join!(
        first_reply_at(host, port, cert_hash, keyed_hello(protocol::INTENT_SEARCH, 1, 0, a)),
        first_reply_at(host, port, cert_hash, keyed_hello(protocol::INTENT_SEARCH, 1, 0, b)),
    );
    let (Control::MatchFound { token: ta, .. }, ..) = ra else { panic!("{:?}", ra.0) };
    let (Control::MatchFound { .. }, ..) = rb else { panic!("{:?}", rb.0) };
    let (welcome, _conn, mut recv) = first_reply_at(host, port, cert_hash, queue_hello(protocol::INTENT_CLAIM, 0, ta)).await;
    assert!(matches!(welcome, Control::Welcome { .. }), "{welcome:?}");
    let start = Instant::now();
    let kicked = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if let Control::Kicked { reason } = read_control(&mut recv).await {
                return reason;
            }
        }
    })
    .await
    .expect("told the match was cancelled");
    assert_eq!(kicked, protocol::KICK_NOT_ALL_JOINED);
    assert!(start.elapsed() < Duration::from_secs(14), "cancelled after {:?}", start.elapsed());
    tokio::time::sleep(Duration::from_millis(100)).await;
}

/// No-shows over the wire from one address (RV-367, RV-385, RV-407; RX14's N21, N22, RX15's C13): a no-show's browser
/// can't search (its own refusal) while other browsers there still find matches; a second browser's no-show there blocks
/// the address, told as the network's
async fn no_shows_from(host: &'static str) {
    engine::init(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes"))).unwrap();
    let (identity, cert_hash) = net::dev_identity().unwrap();
    let server = net::endpoint(identity, 0).unwrap();
    let port = server.local_addr().unwrap().port();
    let (to_game, messages) = tokio::sync::mpsc::channel(carball_server::game_loop::TO_GAME_QUEUE);
    let playlists = [1, 2, 3]
        .map(|team_size| carball_server::match_host::Playlist { team_size, match_type: carball_server::game::MatchType::Casual, forfeit_vote_wait: None })
        .to_vec();
    std::thread::spawn(move || game_loop::run(messages, game_loop::Mode::Queue(playlists), None, heartbeat(), Instant::now()));
    tokio::spawn(net::accept_loop(Arc::new(server), to_game, open_limits()));

    stalled_match(host, port, cert_hash, 11, 22).await;
    let (refused, ..) = first_reply_at(host, port, cert_hash, keyed_hello(protocol::INTENT_SEARCH, 1, 0, 22)).await;
    assert!(matches!(refused, Control::SearchCooldown { seconds, network: false } if (100..=120).contains(&seconds)), "{host}: {refused:?}");
    // Two other browsers there: matched, and one of them doesn't claim either: the address is blocked
    stalled_match(host, port, cert_hash, 33, 44).await;
    let (blocked, ..) = first_reply_at(host, port, cert_hash, keyed_hello(protocol::INTENT_SEARCH, 1, 0, 55)).await;
    assert!(matches!(blocked, Control::SearchCooldown { seconds, network: true } if (100..=120).contains(&seconds)), "{host}: {blocked:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn no_shows_over_ipv4_block_their_browser_then_after_two_their_address() {
    no_shows_from("127.0.0.1").await;
}

/// The same over IPv6: its /64 is blocked only after two browsers' no-shows too (RX15's RV-407)
#[tokio::test(flavor = "multi_thread")]
async fn no_shows_over_ipv6_block_their_browser_then_after_two_their_64() {
    no_shows_from("[::1]").await;
}


/// The binary's `--healthcheck` (the image's HEALTHCHECK): 0 against a live health endpoint, 1 against none, quickly
/// (RX15's C16: its wiring in main)
#[tokio::test(flavor = "multi_thread")]
async fn the_binarys_healthcheck_answers_by_the_health_endpoint() {
    let free_port = || std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let (live, dead) = (free_port(), free_port());
    let start = Instant::now();
    let beat = Arc::new(AtomicU64::new(0));
    tokio::spawn(net::serve_health(live, beat.clone(), start));
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
    let mut files: Vec<_> = std::fs::read_dir(meshes).unwrap().map(|e| e.unwrap().path()).filter(|p| p.extension().is_some_and(|x| x == "cmf")).collect();
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
        (copy("unplaced", "arena", &|_, b| Some(if goal(&b) { b[..b.len() - 16].to_vec() } else { b })), "0 meshes placed by a body offset"),
        (copy("truncated", "arena", &|i, b| Some(if i == 3 { b[..b.len() - 5].to_vec() } else { b })), "not a whole mesh (truncated"),
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
