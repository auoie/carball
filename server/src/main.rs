use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

use rl_server::game::MatchType;
use rl_server::match_host::Playlist;
use rl_server::net::NetLimits;
use rl_server::{engine, game_loop, net};
use wtransport::Identity;

struct Args {
    port: u16,
    info_port: u16,
    /// The development info server (`/info`: the port and the self-signed certificate's hash): on without a certificate,
    /// or when asked
    dev_info: Option<bool>,
    info_bind: IpAddr,
    meshes: PathBuf,
    team_size: u8,
    /// Who may vote to forfeit and when, and whether a team left without players forfeits
    match_type: MatchType,
    /// The clock time before forfeit votes (s; default: the match type's, 60 casual, 90 ranked and private)
    forfeit_vote_wait: Option<f32>,
    /// Browser tests: each round, the ball is knocked into a goal this long after "go"
    test_goal_after: Option<f32>,
    /// The queue's matches (1v1, 2v2, 3v3: searches and claims only), not one open match
    queue: bool,
    /// The certificate chain and its key (PEM): a public server's (APP-CONTRACT.md), reloaded when they change or on SIGHUP
    cert: Option<(PathBuf, PathBuf)>,
    /// The host name the server is reached at (logged: its certificate must be for it)
    public_host: Option<String>,
    health_port: u16,
    limits: NetLimits,
    health_check: bool,
}

const USAGE: &str = "usage: rl-server [--mode direct|queue] [--port 4433] [--info-port 4434] [--dev-info on|off] [--info-bind 127.0.0.1] \
[--meshes DIR] [--team-size 3] [--match-type casual|ranked|private] [--forfeit-vote-wait SECONDS] [--test-goal-after SECONDS] \
[--cert FULLCHAIN.pem --key KEY.pem] [--allowed-origin ORIGIN[,ORIGIN...]] [--public-host HOST] [--health-port 8081] \
[--max-sessions N] [--max-per-address N] [--max-per-address-per-minute N] | --healthcheck
environment (each the flag's default): RL_MODE, GAME_PORT, MESHES_DIR, CERT_PATH, KEY_PATH, ALLOWED_ORIGIN, PUBLIC_HOST, HEALTH_PORT";

fn parse_mode(value: &str) -> anyhow::Result<bool> {
    match value {
        "direct" => Ok(false),
        "queue" => Ok(true),
        other => anyhow::bail!("mode {other}: direct or queue"),
    }
}

fn origins(value: &str) -> Option<Vec<String>> {
    let list: Vec<String> = value.split(',').map(|o| o.trim().trim_end_matches('/').to_string()).filter(|o| !o.is_empty()).collect();
    (!list.is_empty()).then_some(list)
}

/// The arguments, each flag's default from the environment (`env`: the image's interface, APP-CONTRACT.md)
fn parse_args(mut it: impl Iterator<Item = String>, env: impl Fn(&str) -> Option<String>) -> anyhow::Result<Args> {
    let mut args = Args {
        port: 4433,
        info_port: 4434,
        dev_info: None,
        info_bind: [127, 0, 0, 1].into(),
        meshes: PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../out/arena/collision_meshes")),
        team_size: rl_server::game::TEAM_SIZE,
        match_type: MatchType::Casual,
        forfeit_vote_wait: None,
        test_goal_after: None,
        queue: false,
        cert: None,
        public_host: None,
        health_port: 8081,
        limits: NetLimits::default(),
        health_check: false,
    };
    if let Some(mode) = env("RL_MODE") {
        args.queue = parse_mode(&mode)?;
    }
    if let Some(port) = env("GAME_PORT") {
        args.port = port.parse()?;
    }
    if let Some(dir) = env("MESHES_DIR") {
        args.meshes = dir.into();
    }
    let mut cert = env("CERT_PATH").map(PathBuf::from);
    let mut key = env("KEY_PATH").map(PathBuf::from);
    if let Some(list) = env("ALLOWED_ORIGIN") {
        args.limits.allowed_origins = origins(&list);
    }
    args.public_host = env("PUBLIC_HOST").filter(|h| !h.is_empty());
    if let Some(port) = env("HEALTH_PORT") {
        args.health_port = port.parse()?;
    }
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| anyhow::anyhow!("{arg} needs a value"));
        match arg.as_str() {
            "--port" => args.port = value()?.parse()?,
            "--info-port" => args.info_port = value()?.parse()?,
            "--dev-info" => {
                args.dev_info = Some(match value()?.as_str() {
                    "on" => true,
                    "off" => false,
                    other => anyhow::bail!("--dev-info {other}: on or off"),
                })
            }
            "--info-bind" => args.info_bind = value()?.parse()?,
            "--meshes" => args.meshes = value()?.into(),
            "--team-size" => {
                // (two teams of it within the match's most players: RV-329)
                args.team_size = value()?.parse()?;
                anyhow::ensure!((1..=(rl_server::game::MAX_PLAYERS / 2) as u8).contains(&args.team_size), "--team-size: 1 to {}", rl_server::game::MAX_PLAYERS / 2);
            }
            "--match-type" => {
                args.match_type = match value()?.as_str() {
                    "casual" => MatchType::Casual,
                    "ranked" => MatchType::Ranked,
                    "private" => MatchType::Private,
                    other => anyhow::bail!("--match-type {other}: casual, ranked or private"),
                }
            }
            "--forfeit-vote-wait" => args.forfeit_vote_wait = Some(value()?.parse()?),
            "--test-goal-after" => args.test_goal_after = Some(value()?.parse()?),
            "--mode" => args.queue = parse_mode(&value()?)?,
            "--cert" => cert = Some(value()?.into()),
            "--key" => key = Some(value()?.into()),
            "--allowed-origin" => args.limits.allowed_origins = origins(&value()?),
            "--public-host" => args.public_host = Some(value()?),
            "--health-port" => args.health_port = value()?.parse()?,
            "--max-sessions" => args.limits.max_sessions = value()?.parse()?,
            "--max-per-address" => args.limits.per_address = value()?.parse()?,
            "--max-per-address-per-minute" => args.limits.per_address_per_minute = value()?.parse()?,
            "--healthcheck" => args.health_check = true,
            _ => anyhow::bail!("{USAGE}"),
        }
    }
    args.cert = match (cert, key) {
        (Some(c), Some(k)) => Some((c, k)),
        (None, None) => None,
        _ => anyhow::bail!("a certificate needs both CERT_PATH and KEY_PATH (--cert and --key)"),
    };
    Ok(args)
}

/// SIGHUP asks for the certificate to be read again
static RELOAD: AtomicBool = AtomicBool::new(false);

extern "C" fn on_sighup(_: libc::c_int) {
    RELOAD.store(true, Ordering::SeqCst);
}

/// SIGTERM or SIGINT: the process ends at once (as a container's PID 1, an unhandled SIGTERM is ignored: `docker stop`
/// would wait out its grace period); its matches end with it
extern "C" fn on_stop(_: libc::c_int) {
    // SAFETY: _exit is async-signal-safe
    unsafe { libc::_exit(0) }
}

fn modified(path: &PathBuf) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// The certificate read again when its files change (checked every 5 s) or on SIGHUP: new sessions get it, sessions open
/// now keep theirs (no match dropped: `Endpoint::reload_config` without a rebind)
async fn reload_certificates(server: Arc<net::ServerEndpoint>, cert: PathBuf, key: PathBuf, port: u16) {
    // SAFETY: the handler only stores to an atomic
    unsafe {
        libc::signal(libc::SIGHUP, on_sighup as *const () as libc::sighandler_t);
    }
    let mut seen = (modified(&cert), modified(&key));
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let mut checks = 0u32;
    loop {
        tick.tick().await;
        checks += 1;
        let asked = RELOAD.swap(false, Ordering::SeqCst);
        let now = if asked || checks.is_multiple_of(5) { (modified(&cert), modified(&key)) } else { seen };
        if !asked && now == seen {
            continue;
        }
        match Identity::load_pemfiles(&cert, &key).await {
            Ok(identity) => match net::server_config(identity, port).and_then(|config| Ok(server.reload_config(config, false)?)) {
                Ok(()) => {
                    seen = now;
                    eprintln!("certificate reloaded ({})", if asked { "SIGHUP" } else { "its files changed" });
                }
                Err(e) => eprintln!("certificate reload failed, the old one stays: {e:#}"),
            },
            // (a renewal written in two steps can be read between them: tried again at the next check)
            Err(e) => eprintln!("certificate not read, the old one stays: {e:#}"),
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // (an empty variable is an unset one: `-e CERT_PATH=` runs a development server from the image)
    let args = parse_args(std::env::args().skip(1), |name| std::env::var(name).ok().filter(|v| !v.is_empty()))?;
    if args.health_check {
        std::process::exit(if net::health_check(args.health_port) { 0 } else { 1 });
    }
    // SAFETY: the handler only calls _exit
    unsafe {
        libc::signal(libc::SIGTERM, on_stop as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_stop as *const () as libc::sighandler_t);
    }
    engine::init(&args.meshes)?;
    let (identity, dev_hash) = match &args.cert {
        Some((cert, key)) => (Identity::load_pemfiles(cert, key).await?, None),
        None => {
            let (identity, hash) = net::dev_identity()?;
            (identity, Some(hash))
        }
    };
    let server = Arc::new(net::endpoint(identity, args.port)?);

    // (bounded: a flood of messages waits in its session instead of growing the game's queue, RV-248)
    let (to_game, messages) = tokio::sync::mpsc::channel(game_loop::TO_GAME_QUEUE);
    let playlist = |team_size| Playlist { team_size, match_type: args.match_type, forfeit_vote_wait: args.forfeit_vote_wait };
    // (direct: one open match of --team-size; queue: the 1v1, 2v2 and 3v3 playlists)
    let mode = if args.queue { game_loop::Mode::Queue([1, 2, 3].map(playlist).to_vec()) } else { game_loop::Mode::Direct(playlist(args.team_size)) };
    let test_goal_after = args.test_goal_after;
    let start = Instant::now();
    let heartbeat = Arc::new(AtomicU64::new(0));
    let game_heartbeat = heartbeat.clone();
    let game = std::thread::Builder::new().name("game".into()).spawn(move || game_loop::run(messages, mode, test_goal_after, game_heartbeat, start))?;
    // (the game thread gone, by a panic outside a match's tick: the process ends, for its supervisor to restart it, SEC-7)
    tokio::spawn(async move {
        let mut every = tokio::time::interval(Duration::from_secs(1));
        loop {
            every.tick().await;
            if game.is_finished() {
                eprintln!("the game thread ended: exiting");
                std::process::exit(1);
            }
        }
    });
    tokio::spawn(net::serve_health(args.health_port, heartbeat, start));
    if let Some((cert, key)) = args.cert.clone() {
        tokio::spawn(reload_certificates(server.clone(), cert, key, args.port));
    }
    let dev_info = args.dev_info.unwrap_or(args.cert.is_none());
    let mode = if args.queue { "the queue's matches" } else { "one open match" };
    let origins = args.limits.allowed_origins.as_ref().map_or("any origin (development)".to_string(), |o| o.join(", "));
    let host = args.public_host.as_deref().unwrap_or("this machine");
    println!("rl-server: {mode}, WebTransport on UDP port {} at {host}, pages from {origins}, health on 127.0.0.1:{}", args.port, args.health_port);
    match (dev_info, dev_hash) {
        (true, Some(hash)) => {
            tokio::spawn(net::serve_info(args.info_bind, args.info_port, args.port, hash));
            println!("dev info on http://{}:{}/info (self-signed certificate)", args.info_bind, args.info_port);
            let query = if args.info_port == 4434 { "server".to_string() } else { format!("server=localhost:{}", args.info_port) };
            println!("To play: run the web client (cd client && npm run dev) and open http://localhost:5173/?{query}");
        }
        (true, None) => eprintln!("--dev-info: no development info with a real certificate (the client connects by name)"),
        _ => {}
    }
    net::accept_loop(server, to_game, args.limits).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> anyhow::Result<Args> {
        parse_args(args.iter().map(|a| (*a).to_string()), |_| None)
    }

    #[test]
    fn a_team_size_outside_the_match_is_refused_and_the_mode_named() {
        // (two teams within the match's most players: RV-329, RV-344)
        for bad in ["0", "9", "255", "-1", "x"] {
            assert!(parse(&["--team-size", bad]).is_err(), "--team-size {bad}");
        }
        for good in 1..=8 {
            assert_eq!(parse(&["--team-size", &good.to_string()]).unwrap().team_size, good);
        }
        assert!(parse(&["--mode", "queue"]).unwrap().queue);
        assert!(!parse(&["--mode", "direct"]).unwrap().queue);
        assert!(!parse(&[]).unwrap().queue, "direct by default");
        assert!(parse(&["--mode", "ranked"]).is_err());
        assert!(parse(&["--team-size"]).is_err(), "a value needed");
    }

    #[test]
    fn the_environment_gives_the_defaults_and_flags_override_it() {
        let env = |name: &str| {
            match name {
                "RL_MODE" => Some("queue"),
                "GAME_PORT" => Some("5000"),
                "CERT_PATH" => Some("/certs/fullchain.pem"),
                "KEY_PATH" => Some("/certs/privkey.pem"),
                "ALLOWED_ORIGIN" => Some("https://carball.zolt.top/, https://other.example"),
                "PUBLIC_HOST" => Some("game.carball.zolt.top"),
                "HEALTH_PORT" => Some("9000"),
                _ => None,
            }
            .map(str::to_string)
        };
        let args = parse_args(std::iter::empty(), env).unwrap();
        assert!(args.queue);
        assert_eq!((args.port, args.health_port), (5000, 9000));
        assert_eq!(args.cert, Some(("/certs/fullchain.pem".into(), "/certs/privkey.pem".into())));
        assert_eq!(args.limits.allowed_origins, Some(vec!["https://carball.zolt.top".to_string(), "https://other.example".to_string()]));
        assert_eq!(args.public_host.as_deref(), Some("game.carball.zolt.top"));
        let args = parse_args(["--port", "6000", "--mode", "direct"].map(String::from).into_iter(), env).unwrap();
        assert_eq!((args.port, args.queue), (6000, false));
        assert!(parse(&["--cert", "/a.pem"]).is_err(), "a certificate needs its key");
        let dev = parse(&[]).unwrap();
        assert!(dev.cert.is_none() && dev.limits.allowed_origins.is_none());
    }
}
