//! WebTransport front end: accepts sessions on `/play`, reads the player's `Hello` from the control stream, then
//! forwards input datagrams to the game and the game's messages to the client (`protocol/README.md`).

use std::time::Duration;

use anyhow::{Context, bail};
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
use wtransport::endpoint::IncomingSession;
use wtransport::{Endpoint, Identity, ServerConfig};

use crate::game::{JoinRequest, Outgoing, PlayerId};
use crate::protocol::{self, Control, Datagram, InputFrame};

/// Messages from the network tasks to the game loop
#[derive(Debug)]
pub enum ToGame {
    Join { id: PlayerId, request: JoinRequest, out: UnboundedSender<Outgoing> },
    Leave { id: PlayerId },
    Inputs { id: PlayerId, timestamp: u32, first_frame: u32, frames: Vec<InputFrame>, at: std::time::Instant },
    ResetInputBuffer { id: PlayerId },
}

/// Development identity: self-signed for localhost, valid 14 days (the browser limit for certificate hashes)
pub fn dev_identity() -> anyhow::Result<(Identity, [u8; 32])> {
    let identity = Identity::self_signed(["localhost", "127.0.0.1", "::1"])?;
    let hash = *identity.certificate_chain().as_slice()[0].hash().as_ref();
    Ok((identity, hash))
}

pub fn endpoint(identity: Identity, port: u16) -> anyhow::Result<Endpoint<wtransport::endpoint::endpoint_side::Server>> {
    let config = ServerConfig::builder()
        .with_bind_default(port)
        .with_identity(identity)
        .keep_alive_interval(Some(Duration::from_secs(2)))
        .max_idle_timeout(Some(Duration::from_secs(10)))?
        .build();
    Ok(Endpoint::server(config)?)
}

pub async fn accept_loop(server: Endpoint<wtransport::endpoint::endpoint_side::Server>, to_game: UnboundedSender<ToGame>) {
    let mut next_id: PlayerId = 1;
    loop {
        let incoming = server.accept().await;
        let id = next_id;
        next_id += 1;
        let to_game = to_game.clone();
        tokio::spawn(async move {
            if let Err(e) = session(incoming, id, &to_game).await {
                eprintln!("player {id}: {e:#}");
            }
            let _ = to_game.send(ToGame::Leave { id });
        });
    }
}

async fn read_control(recv: &mut wtransport::RecvStream) -> anyhow::Result<Control> {
    let mut len = [0u8; 2];
    recv.read_exact(&mut len).await?;
    let mut body = vec![0u8; usize::from(u16::from_le_bytes(len))];
    recv.read_exact(&mut body).await?;
    Ok(Control::decode(&body)?)
}

async fn session(incoming: IncomingSession, id: PlayerId, to_game: &UnboundedSender<ToGame>) -> anyhow::Result<()> {
    let request = incoming.await?;
    if request.path() != "/play" {
        request.not_found().await;
        return Ok(());
    }
    let connection = request.accept().await?;
    let (mut send, mut recv) = connection.accept_bi().await.context("no control stream")?;
    let Control::Hello { version, team, body, dodge_deadzone, steering_sensitivity, air_control_sensitivity } =
        tokio::time::timeout(Duration::from_secs(5), read_control(&mut recv)).await.context("no hello")??
    else {
        bail!("expected hello");
    };
    if version != protocol::VERSION {
        bail!("protocol version {version}, server speaks {}", protocol::VERSION);
    }

    let (out_tx, mut out_rx) = unbounded_channel();
    let request = JoinRequest { team, body, dodge_deadzone, steering_sensitivity, air_control_sensitivity };
    to_game.send(ToGame::Join { id, request, out: out_tx })?;

    // Game -> client
    let writer_connection = connection.clone();
    let writer = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            match message {
                Outgoing::Control(bytes) => {
                    if send.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                // Unreliable: a datagram that doesn't fit or can't be queued is simply lost, like a lost packet
                Outgoing::Datagram(bytes) => {
                    let _ = writer_connection.send_datagram(bytes);
                }
            }
        }
    });

    // Client -> game: control messages (in their own task: a framed read mustn't be cancelled halfway); the control
    // stream closing ends the session
    let control_to_game = to_game.clone();
    let mut control_reader = tokio::spawn(async move {
        loop {
            match read_control(&mut recv).await {
                Ok(Control::ResetInputBuffer) => {
                    if control_to_game.send(ToGame::ResetInputBuffer { id }).is_err() {
                        break;
                    }
                }
                Ok(_) => {} // (nothing else is expected from a client)
                Err(_) => break,
            }
        }
    });

    // Client -> game: input datagrams
    let result = loop {
        tokio::select! {
            datagram = connection.receive_datagram() => match datagram {
                Ok(d) => {
                    if let Ok(Datagram::Inputs { timestamp, first_frame, frames }) = Datagram::decode(&d) {
                        to_game.send(ToGame::Inputs { id, timestamp, first_frame, frames, at: std::time::Instant::now() })?;
                    }
                }
                Err(e) => break Err(e.into()),
            },
            _ = &mut control_reader => break Ok(()),
        }
    };
    control_reader.abort();
    writer.abort();
    result
}

/// Development helper: `GET /info` on plain HTTP returns the WebTransport port and the certificate hash, so a browser
/// on this machine can connect to the self-signed server.
pub async fn serve_info(port: u16, webtransport_port: u16, cert_hash: [u8; 32]) -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let hex: String = cert_hash.iter().map(|b| format!("{b:02x}")).collect();
    let body = format!("{{\"port\":{webtransport_port},\"certHash\":\"{hex}\"}}");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    loop {
        let (mut stream, _) = listener.accept().await?;
        let response = response.clone();
        tokio::spawn(async move {
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).await;
            let _ = stream.write_all(response.as_bytes()).await;
        });
    }
}
