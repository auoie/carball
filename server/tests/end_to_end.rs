//! A client connects over real WebTransport (localhost, the dev certificate by hash), drives, and follows the
//! server's world through updates.

use std::path::Path;
use std::time::{Duration, Instant};

use rl_server::engine::{self, Arena};
use rl_server::protocol::{self, Control, Datagram, InputFrame};
use rl_server::{game_loop, net};
use wtransport::{ClientConfig, Endpoint};

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
    let (to_game, messages) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || game_loop::run(messages));
    tokio::spawn(net::accept_loop(server, to_game));

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
    };
    send.write_all(&hello.encode()).await.unwrap();
    let Control::Welcome { car_id, snapshot, tick_rate, .. } = read_control(&mut recv).await else { panic!("expected welcome") };
    assert_eq!(tick_rate, 120);

    let mut world = Arena::new();
    assert!(world.load_state(&snapshot));
    let start = world.car_position(car_id).unwrap();

    // 1.5 s: inputs at 60 Hz (2 new frames each, resending the last 10), apply every update
    let begin = Instant::now();
    let mut frame = 0u32;
    let mut sent: Vec<InputFrame> = Vec::new();
    let mut updates = 0;
    let mut last_ack = 0;
    let mut pings = Vec::new();
    let mut next_send = Instant::now();
    while begin.elapsed() < Duration::from_millis(1500) {
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
    assert!(updates > 60, "{updates} updates in 1.5 s (60 Hz expected)");
    assert!(driven > 500.0, "client view of the car drove {driven} uu");
    assert!(last_ack + 30 > frame, "the server consumed our inputs (ack {last_ack}, sent {frame})");
    assert!(pings.iter().all(|&p| (0..100).contains(&p)), "ping on localhost {pings:?}");
}
