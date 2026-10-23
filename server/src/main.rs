use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

use carball_server::game::MatchType;
use carball_server::match_host::Playlist;
use carball_server::net::NetLimits;
use carball_server::{engine, game_loop, net};

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
    /// A development server (`--dev`): a self-signed certificate whatever CERT_PATH and KEY_PATH say. A queue server
    /// without a certificate must be asked for it (RV-381: an empty variable in a deployment is no silent outage)
    dev: bool,
    /// The host name the server is reached at (logged: its certificate must be for it), and the port when it's published
    /// as another than `--port` (`PUBLIC_PORT`): together this server's name, as its match tickets name it
    public_host: Option<String>,
    public_port: Option<u16>,
    health_port: u16,
    limits: NetLimits,
    /// The search tickets' public keys (`TICKET_PUBLIC_KEYS`: "KID BASE64", comma- or line-separated; notes/accounts.md
    /// §3): a queue server's, required unless --dev (which makes a key of its own as well)
    ticket_keys: Option<String>,
    /// Or their file (`TICKET_PUBLIC_KEYS_FILE`): read at the start and again on SIGHUP (a rotation without a restart,
    /// AP2-4)
    ticket_keys_file: Option<PathBuf>,
    /// The accounts service for the ranked calls (results, quitters: notes/accounts.md §3): its origin (`API_URL`), the
    /// game server's token file, the tunnel's Access service token (its id, its secret's file), and where the calls wait
    /// (`OUTBOX_DIR`). A queue server's, required unless --dev (which logs the calls only)
    api: Option<ApiArgs>,
    outbox_dir: Option<PathBuf>,
    /// A development server's matchmaker (`--api-url http://127.0.0.1:PORT`: `carball-api matchmaker --dev`), its calls
    /// sent there, no token
    dev_api: Option<String>,
}

impl Args {
    /// This server's name as the matchmaker and its match tickets name it: its address, `PUBLIC_HOST` (127.0.0.1 for a
    /// development server without one) and its port (`PUBLIC_PORT`, else `--port`)
    fn server_name(&self) -> String {
        format!("{}:{}", self.public_host.as_deref().unwrap_or("127.0.0.1"), self.public_port.unwrap_or(self.port))
    }
}

/// `API_URL` and its credentials' files
#[derive(Clone, Debug, PartialEq)]
struct ApiArgs {
    url: String,
    token_file: PathBuf,
    access: Option<(String, PathBuf)>,
}

const USAGE: &str = "usage: carball-server [--mode direct|queue] [--dev] [--port 4433] [--info-port 4434] [--dev-info on|off] [--info-bind 127.0.0.1] \
[--meshes DIR] [--team-size 3] [--match-type casual|ranked|private (the open match's; a queue's are ranked)] [--forfeit-vote-wait SECONDS] [--test-goal-after SECONDS] \
[--cert FULLCHAIN.pem --key KEY.pem] [--allowed-origin ORIGIN[,ORIGIN...]] [--public-host HOST] [--health-port 8081] \
[--max-sessions N] [--max-per-address N] [--max-per-address-per-minute N] | --healthcheck
environment (each the flag's default): SERVER_MODE, GAME_PORT, MESHES_DIR, CERT_PATH, KEY_PATH, ALLOWED_ORIGIN, PUBLIC_HOST, HEALTH_PORT;
TICKET_PUBLIC_KEYS (a queue server's: the search tickets' public keys, \"KID BASE64\" each); API_URL, GAME_SERVER_TOKEN_FILE,
CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET_FILE, OUTBOX_DIR (a queue server's ranked calls to the accounts service)";

/// A variable's or flag's number, the error naming it (RV-399: an empty GAME_PORT said only "cannot parse integer")
fn number<T: std::str::FromStr>(name: &str, value: &str) -> anyhow::Result<T>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    value.trim().parse().map_err(|e| anyhow::anyhow!("{name} {value:?}: {e}"))
}

/// `--healthcheck`'s port alone (--health-port, else HEALTH_PORT, else 8081): the check reads nothing else, so a
/// setting the server would refuse doesn't make a running server unhealthy (RV-399)
fn health_port(args: &[String], env: impl Fn(&str) -> Option<String>) -> anyhow::Result<u16> {
    if let Some(at) = args.iter().position(|a| a == "--health-port") {
        let value = args.get(at + 1).ok_or_else(|| anyhow::anyhow!("--health-port needs a value"))?;
        return number("--health-port", value);
    }
    env("HEALTH_PORT").map_or(Ok(8081), |p| number("HEALTH_PORT", &p))
}

fn parse_mode(value: &str) -> anyhow::Result<bool> {
    match value {
        "direct" => Ok(false),
        "queue" => Ok(true),
        other => anyhow::bail!("mode {other}: direct or queue"),
    }
}

/// The page origins allowed, as browsers send them (lowercase, no trailing slash); none named is an error, not "any"
/// (RV-372: a blank ALLOWED_ORIGIN mustn't open the server to every page)
fn origins(value: &str) -> anyhow::Result<Vec<String>> {
    let list: Vec<String> = value
        .split(',')
        .map(|o| o.trim().trim_end_matches('/').to_ascii_lowercase())
        .filter(|o| !o.is_empty())
        .collect();
    anyhow::ensure!(!list.is_empty(), "ALLOWED_ORIGIN (--allowed-origin) names no origin: {value:?}");
    Ok(list)
}

/// The arena's collision meshes when neither --meshes nor MESHES_DIR names them: the repository's
/// (`out/arena/collision_meshes`) in a directory above the binary, a development build's (no build machine's path
/// compiled in: RV-380)
fn default_meshes() -> PathBuf {
    let found = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.ancestors().map(|d| d.join("out/arena/collision_meshes")).find(|d| d.is_dir()));
    found.unwrap_or_else(|| PathBuf::from("collision_meshes"))
}

/// The development info server: on without a certificate unless turned off, off with one unless asked (SEC-6)
fn dev_info_on(args: &Args) -> bool {
    args.dev_info.unwrap_or(args.cert.is_none())
}

/// The arguments, each flag's default from the environment (`env`: the image's interface, APP-CONTRACT.md). A public
/// server (a certificate) needs its page origins; a queue server needs a certificate, or `--dev`
fn parse_args(mut it: impl Iterator<Item = String>, env: impl Fn(&str) -> Option<String>) -> anyhow::Result<Args> {
    let mut match_type = None;
    let mut args = Args {
        port: 4433,
        info_port: 4434,
        dev_info: None,
        info_bind: [127, 0, 0, 1].into(),
        meshes: PathBuf::new(),
        team_size: carball_server::game::TEAM_SIZE,
        match_type: MatchType::Casual,
        forfeit_vote_wait: None,
        test_goal_after: None,
        queue: false,
        cert: None,
        dev: false,
        public_host: None,
        public_port: None,
        health_port: 8081,
        limits: NetLimits::default(),
        ticket_keys: None,
        ticket_keys_file: None,
        api: None,
        outbox_dir: None,
        dev_api: None,
    };
    if let Some(mode) = env("SERVER_MODE") {
        args.queue = parse_mode(&mode)?;
    }
    if let Some(port) = env("GAME_PORT") {
        args.port = number("GAME_PORT", &port)?;
    }
    if let Some(dir) = env("MESHES_DIR").filter(|d| !d.is_empty()) {
        args.meshes = dir.into();
    }
    let mut cert = env("CERT_PATH").map(PathBuf::from);
    let mut key = env("KEY_PATH").map(PathBuf::from);
    if let Some(list) = env("ALLOWED_ORIGIN") {
        args.limits.allowed_origins = Some(origins(&list)?);
    }
    args.public_host = env("PUBLIC_HOST").filter(|h| !h.is_empty());
    if let Some(port) = env("PUBLIC_PORT").filter(|p| !p.is_empty()) {
        args.public_port = Some(number("PUBLIC_PORT", &port)?);
    }
    if let Some(port) = env("HEALTH_PORT") {
        args.health_port = number("HEALTH_PORT", &port)?;
    }
    while let Some(arg) = it.next() {
        let mut value = || it.next().ok_or_else(|| anyhow::anyhow!("{arg} needs a value"));
        match arg.as_str() {
            "--port" => args.port = number("--port", &value()?)?,
            "--info-port" => args.info_port = number("--info-port", &value()?)?,
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
                anyhow::ensure!(
                    (1..=(carball_server::game::MAX_PLAYERS / 2) as u8).contains(&args.team_size),
                    "--team-size: 1 to {}",
                    carball_server::game::MAX_PLAYERS / 2
                );
            }
            "--match-type" => {
                match_type = Some(match value()?.as_str() {
                    "casual" => MatchType::Casual,
                    "ranked" => MatchType::Ranked,
                    "private" => MatchType::Private,
                    other => anyhow::bail!("--match-type {other}: casual, ranked or private"),
                });
            }
            "--forfeit-vote-wait" => args.forfeit_vote_wait = Some(value()?.parse()?),
            "--test-goal-after" => args.test_goal_after = Some(value()?.parse()?),
            "--mode" => args.queue = parse_mode(&value()?)?,
            "--dev" => args.dev = true,
            "--cert" => cert = Some(value()?.into()),
            "--key" => key = Some(value()?.into()),
            "--allowed-origin" => args.limits.allowed_origins = Some(origins(&value()?)?),
            "--public-host" => args.public_host = Some(value()?),
            "--public-port" => args.public_port = Some(number("--public-port", &value()?)?),
            "--api-url" => args.dev_api = Some(value()?.trim_end_matches('/').to_string()),
            "--health-port" => args.health_port = number("--health-port", &value()?)?,
            "--max-sessions" => args.limits.max_sessions = number("--max-sessions", &value()?)?,
            "--max-per-address" => args.limits.per_address = number("--max-per-address", &value()?)?,
            "--max-per-address-per-minute" => {
                args.limits.per_address_per_minute = number("--max-per-address-per-minute", &value()?)?
            }
            "--healthcheck" => {} // (main's, before the rest is read: health_port)
            _ => anyhow::bail!("{USAGE}"),
        }
    }
    if args.meshes.as_os_str().is_empty() {
        args.meshes = default_meshes();
    }
    // (a development matchmaker's: plain http on this machine, a development server's alone)
    if let Some(url) = &args.dev_api {
        let host = url.strip_prefix("http://").and_then(|h| h.rsplit_once(':')).map(|(h, _)| h);
        anyhow::ensure!(
            args.dev && matches!(host, Some("127.0.0.1" | "localhost" | "[::1]")),
            "--api-url is a development matchmaker's (http://127.0.0.1:PORT), with --dev alone"
        );
    }
    // (the queue's matches are ranked: online play is ranked only, the user's decision; --match-type the open match's,
    // casual by default, RX32)
    args.match_type = match (args.queue, match_type) {
        (true, None | Some(MatchType::Ranked)) => MatchType::Ranked,
        (true, Some(other)) => anyhow::bail!("--match-type {other:?}: the queue's matches are ranked"),
        (false, chosen) => chosen.unwrap_or(MatchType::Casual),
    };
    args.ticket_keys = env("TICKET_PUBLIC_KEYS").filter(|k| !k.trim().is_empty());
    args.ticket_keys_file = env("TICKET_PUBLIC_KEYS_FILE").filter(|k| !k.trim().is_empty()).map(PathBuf::from);
    anyhow::ensure!(
        args.ticket_keys.is_none() || args.ticket_keys_file.is_none(),
        "TICKET_PUBLIC_KEYS or TICKET_PUBLIC_KEYS_FILE, not both"
    );
    anyhow::ensure!(
        !args.queue || args.dev || args.ticket_keys.is_some() || args.ticket_keys_file.is_some(),
        "the queue's searches are accounts': it needs TICKET_PUBLIC_KEYS or TICKET_PUBLIC_KEYS_FILE (the accounts service's ticket keys), or --dev for a development server"
    );
    // (--dev signs its own tickets: never beside production keys, AP2-7)
    anyhow::ensure!(
        !args.dev || (args.ticket_keys.is_none() && args.ticket_keys_file.is_none()),
        "--dev signs tickets of its own: it refuses production keys (TICKET_PUBLIC_KEYS, TICKET_PUBLIC_KEYS_FILE)"
    );
    args.api = api_args(&env)?;
    args.outbox_dir = env("OUTBOX_DIR").filter(|d| !d.trim().is_empty()).map(PathBuf::from);
    anyhow::ensure!(
        !args.queue || args.dev || args.api.is_some(),
        "the queue's matches are rated: it needs API_URL and GAME_SERVER_TOKEN_FILE (the accounts service and the game server's token), or --dev for a development server"
    );
    // (a blank one too: its calls kept in memory alone would go with a restart, RX31)
    anyhow::ensure!(
        !args.queue || args.dev || args.outbox_dir.is_some(),
        "the queue's ranked calls are kept on disk until sent: it needs OUTBOX_DIR (a small volume), or --dev for a development server"
    );
    if args.dev {
        // (a certificate there is a public server's: --dev on it would hand out its own tickets to the internet, AP2-7)
        let mounted = |p: &Option<PathBuf>| p.as_ref().is_some_and(|p| !p.as_os_str().is_empty() && p.is_file());
        anyhow::ensure!(
            !mounted(&cert) && !mounted(&key),
            "--dev with a certificate at CERT_PATH or KEY_PATH: that's a public server's (no --dev there)"
        );
        return Ok(args); // (self-signed, whatever the certificate's variables say)
    }
    args.cert = match (cert, key) {
        (Some(c), Some(k)) => {
            anyhow::ensure!(
                !c.as_os_str().is_empty() && !k.as_os_str().is_empty(),
                "CERT_PATH and KEY_PATH are empty (a development server: --dev)"
            );
            Some((c, k))
        }
        (None, None) => None,
        _ => anyhow::bail!("a certificate needs both CERT_PATH and KEY_PATH (--cert and --key)"),
    };
    anyhow::ensure!(
        !args.queue || args.cert.is_some(),
        "the queue serves the public: it needs a certificate (CERT_PATH and KEY_PATH, or --cert and --key), or --dev for a development server"
    );
    // (a certificate is a public server's, and online play needs a ticket: no open match without one, AP2-9)
    anyhow::ensure!(
        args.queue || args.cert.is_none(),
        "the open match (--mode direct) takes anyone without a ticket: a development server's, not a public one (no certificate; --dev)"
    );
    anyhow::ensure!(
        args.cert.is_none() || args.limits.allowed_origins.is_some(),
        "a server with a certificate needs ALLOWED_ORIGIN (--allowed-origin): the pages it serves"
    );
    Ok(args)
}

/// The accounts service's settings: none without `API_URL`; with it, `https://HOST[:PORT]` (no path), the token's file,
/// and the Access service token's id and secret file together or neither
fn api_args(env: &impl Fn(&str) -> Option<String>) -> anyhow::Result<Option<ApiArgs>> {
    let set = |name: &str| env(name).filter(|v| !v.trim().is_empty()).map(|v| v.trim().to_string());
    let Some(url) = set("API_URL") else { return Ok(None) };
    let url = url.trim_end_matches('/').to_string();
    let host = url.strip_prefix("https://").unwrap_or("");
    anyhow::ensure!(
        !host.is_empty() && !host.contains('/') && !host.contains(char::is_whitespace),
        "API_URL must be https://HOST[:PORT] (the accounts service's origin), got {url:?}"
    );
    let token_file = set("GAME_SERVER_TOKEN_FILE").map(PathBuf::from);
    let token_file = token_file.ok_or_else(|| anyhow::anyhow!("API_URL needs GAME_SERVER_TOKEN_FILE"))?;
    let access = match (set("CF_ACCESS_CLIENT_ID"), set("CF_ACCESS_CLIENT_SECRET_FILE")) {
        (Some(id), Some(secret)) => Some((id, PathBuf::from(secret))),
        (None, None) => None,
        _ => anyhow::bail!("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET_FILE go together"),
    };
    Ok(Some(ApiArgs { url, token_file, access }))
}

/// A secret's file: its text, trimmed; refused when empty
fn read_secret(name: &str, path: &Path) -> anyhow::Result<String> {
    let text = std::fs::read_to_string(path).map_err(|e| anyhow::anyhow!("{name} {}: {e}", path.display()))?;
    // (its trailing line ends dropped, nothing else: the accounts service reads the same file the same way, AP3)
    let text = text.trim_end_matches(['\r', '\n']).to_string();
    anyhow::ensure!(!text.is_empty(), "{name} {}: empty", path.display());
    Ok(text)
}

/// The outbox's settings, its secrets read now (a missing or empty file stops the start, and so does an `OUTBOX_DIR` it
/// can't write when its calls go to the accounts service)
fn outbox_config(args: &Args) -> anyhow::Result<carball_server::outbox::OutboxConfig> {
    if let (Some(_), Some(dir)) = (&args.api, &args.outbox_dir) {
        carball_server::outbox::check_dir(dir)?;
    }
    let (api_url, token, access) = match &args.api {
        Some(api) => {
            let token = read_secret("GAME_SERVER_TOKEN_FILE", &api.token_file)?;
            let access = match &api.access {
                Some((id, file)) => Some((id.clone(), read_secret("CF_ACCESS_CLIENT_SECRET_FILE", file)?)),
                None => {
                    eprintln!("no CF_ACCESS_CLIENT_ID: the ranked calls go without the tunnel's Access service token");
                    None
                }
            };
            (Some(api.url.clone()), token, access)
        }
        None => (args.dev_api.clone(), String::new(), None),
    };
    Ok(carball_server::outbox::OutboxConfig {
        api_url,
        token,
        access,
        dir: args.outbox_dir.clone(),
        server: args.server_name(),
        first_wait: Duration::from_secs(5),
        max_wait: Duration::from_secs(300),
        https_only: args.dev_api.is_none(),
    })
}

/// SIGHUP asks for the certificate to be read again, and the ticket keys' file
static RELOAD: AtomicBool = AtomicBool::new(false);
static RELOAD_KEYS: AtomicBool = AtomicBool::new(false);

extern "C" fn on_sighup(_: libc::c_int) {
    RELOAD.store(true, Ordering::SeqCst);
    RELOAD_KEYS.store(true, Ordering::SeqCst);
}

/// The ticket keys' file read again on SIGHUP (a rotation: its new key added beside the old, the old dropped later), its
/// keys logged by id; a bad file keeps the keys there were
async fn reload_ticket_keys(tickets: Arc<carball_server::ticket::Tickets>, file: PathBuf) {
    // SAFETY: the handler only stores to atomics
    unsafe {
        libc::signal(libc::SIGHUP, on_sighup as *const () as libc::sighandler_t);
    }
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        if !RELOAD_KEYS.swap(false, Ordering::SeqCst) {
            continue;
        }
        match std::fs::read_to_string(&file).map_err(anyhow::Error::from).and_then(|list| tickets.reload(&list)) {
            Ok(()) => println!("ticket keys reloaded (SIGHUP): {}", tickets.key_ids().join(", ")),
            Err(e) => eprintln!("ticket keys not reloaded ({}): {e}; the ones there were kept", file.display()),
        }
    }
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
        match net::load_identity(&cert, &key).await {
            Ok(identity) => {
                match net::server_config(identity, port).and_then(|config| Ok(server.reload_config(config, false)?)) {
                    Ok(()) => {
                        seen = now;
                        eprintln!("certificate reloaded ({})", if asked { "SIGHUP" } else { "its files changed" });
                    }
                    Err(e) => eprintln!("certificate reload failed, the old one stays: {e:#}"),
                }
            }
            // (a renewal written in two steps can be read between them, a key that isn't the certificate's yet: tried
            // again at the next check, RV-368)
            Err(e) => eprintln!("certificate not read, the old one stays: {e:#}"),
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    if argv.iter().any(|a| a == "--healthcheck") {
        let port = health_port(&argv, |name| std::env::var(name).ok())?;
        std::process::exit(if net::health_check(port) { 0 } else { 1 });
    }
    let args = parse_args(argv.into_iter(), |name| std::env::var(name).ok())?;
    // SAFETY: the handler only calls _exit
    unsafe {
        libc::signal(libc::SIGTERM, on_stop as *const () as libc::sighandler_t);
        libc::signal(libc::SIGINT, on_stop as *const () as libc::sighandler_t);
    }
    engine::init(&args.meshes)?;
    let (identity, dev_hash) = match &args.cert {
        Some((cert, key)) => (net::load_identity(cert, key).await?, None),
        None => {
            let (identity, hash) = net::dev_identity()?;
            (identity, Some(hash))
        }
    };
    let server = Arc::new(net::endpoint(identity, args.port)?);
    // (a queue server's searches and claims are accounts': their tickets checked with these keys; a development server's
    // own key too, its info server signing tickets for the pages that ask)
    let key_list = match &args.ticket_keys_file {
        Some(file) => std::fs::read_to_string(file)
            .map_err(|e| anyhow::anyhow!("TICKET_PUBLIC_KEYS_FILE {}: {e}", file.display()))?,
        None => args.ticket_keys.clone().unwrap_or_default(),
    };
    let mut tickets = carball_server::ticket::Tickets::from_list(&key_list)?;
    // (a list that names no key, ", " say: a queue server refusing everyone, AP2-5)
    anyhow::ensure!(!args.queue || args.dev || !tickets.is_empty(), "TICKET_PUBLIC_KEYS names no key");
    if args.dev && args.queue {
        // (development only: anyone may get a ticket from its info server, any account, any name)
        eprintln!("--dev: this server signs tickets of its own for anyone who asks: never a public server");
        tickets = tickets.with_dev_key()?;
    }
    if args.queue {
        println!("ticket keys: {}", tickets.key_ids().join(", "));
    }
    let tickets = args.queue.then(|| Arc::new(tickets));
    if let (Some(tickets), Some(file)) = (&tickets, &args.ticket_keys_file) {
        tokio::spawn(reload_ticket_keys(tickets.clone(), file.clone()));
    }
    let mut args = args;
    args.limits.tickets = tickets.clone();
    // (a match ticket is for one server: this one's name, its address, RV-850)
    args.limits.server_name = args.queue.then(|| args.server_name());

    // (bounded: a flood of messages waits in its session instead of growing the game's queue, RV-248)
    let (to_game, messages) = tokio::sync::mpsc::channel(game_loop::TO_GAME_QUEUE);
    let playlist =
        |team_size| Playlist { team_size, match_type: args.match_type, forfeit_vote_wait: args.forfeit_vote_wait };
    // (direct: one open match of --team-size; queue: the 1v1, 2v2 and 3v3 playlists)
    let mode = if args.queue {
        game_loop::Mode::Queue([1, 2, 3].map(playlist).to_vec())
    } else {
        game_loop::Mode::Direct(playlist(args.team_size))
    };
    let test_goal_after = args.test_goal_after;
    let start = Instant::now();
    let heartbeat = Arc::new(AtomicU64::new(0));
    let game_heartbeat = heartbeat.clone();
    // (a queue server's ranked calls: the outbox, sending to the accounts service; without API_URL, --dev, logged only)
    let reports = if args.queue {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let config = outbox_config(&args)?;
        match &config.api_url {
            Some(url) => println!(
                "ranked calls to {url} (waiting in {})",
                config.dir.as_ref().map_or("memory".into(), |d| d.display().to_string())
            ),
            None => println!("ranked calls logged only (no API_URL: development)"),
        }
        tokio::spawn(carball_server::outbox::run(config, rx));
        // (the matches this server had before its start are gone: the matchmaker frees their players)
        let _ = tx.send(carball_server::match_host::Report::Restarted { at: carball_server::ticket::unix_now() });
        println!("this server's name for the matchmaker: {}", args.server_name());
        Some(tx)
    } else {
        None
    };
    let game = std::thread::Builder::new()
        .name("game".into())
        .spawn(move || game_loop::run_with_reports(messages, mode, test_goal_after, game_heartbeat, start, reports))?;
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
    let dev_info = dev_info_on(&args);
    let mode = if args.queue { "the queue's matches" } else { "one open match" };
    let origins = args.limits.allowed_origins.as_ref().map_or("any origin (development)".to_string(), |o| o.join(", "));
    let host = args.public_host.as_deref().unwrap_or("this machine");
    println!(
        "carball-server: {mode}, WebTransport on UDP port {} at {host}, pages from {origins}, health on 127.0.0.1:{}",
        args.port, args.health_port
    );
    match (dev_info, dev_hash) {
        (true, Some(hash)) => {
            tokio::spawn(net::serve_info(
                args.info_bind,
                args.info_port,
                args.port,
                hash,
                tickets.filter(|_| args.dev),
            ));
            println!("dev info on http://{}:{}/info (self-signed certificate)", args.info_bind, args.info_port);
            let query = if args.info_port == 4434 {
                "server".to_string()
            } else {
                format!("server=localhost:{}", args.info_port)
            };
            println!("To play: run the web client (cd client && npm run dev) and open http://localhost:5173/?{query}");
        }
        (true, None) => {
            eprintln!("--dev-info: no development info with a real certificate (the client connects by name)")
        }
        _ => {}
    }
    net::accept_loop(server, to_game, args.limits).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A secret's file read as the accounts service reads it: its trailing line ends dropped, nothing else (AP3)
    #[test]
    fn a_secret_loses_its_line_ends_only() {
        let path = std::env::temp_dir().join(format!("carball-secret-{:016x}", carball_server::game::random_u64()));
        std::fs::write(&path, " tok en \r\n").unwrap();
        assert_eq!(read_secret("T", &path).unwrap(), " tok en ");
        std::fs::write(&path, "\n").unwrap();
        assert!(read_secret("T", &path).is_err(), "empty");
        let _ = std::fs::remove_file(&path);
    }

    fn parse(args: &[&str]) -> anyhow::Result<Args> {
        parse_args(args.iter().map(|a| (*a).to_string()), |_| None)
    }

    /// This server's name for the matchmaker: PUBLIC_HOST and its port (PUBLIC_PORT, else --port; 127.0.0.1 for a
    /// development server); a development matchmaker's URL (--api-url) loopback http, with --dev alone
    #[test]
    fn the_servers_name_and_a_development_matchmakers_url() {
        let env = |name: &str| match name {
            "PUBLIC_HOST" => Some("game-eu.example".to_string()),
            "PUBLIC_PORT" => Some("443".to_string()),
            _ => None,
        };
        let named = parse_args(["--port", "4433"].iter().map(|a| (*a).to_string()), env).unwrap();
        assert_eq!(named.server_name(), "game-eu.example:443");
        assert_eq!(parse(&["--port", "5000"]).unwrap().server_name(), "127.0.0.1:5000");
        let dev = parse(&["--mode", "queue", "--dev", "--api-url", "http://127.0.0.1:8090/"]).unwrap();
        assert_eq!(dev.dev_api.as_deref(), Some("http://127.0.0.1:8090"));
        assert!(parse(&["--mode", "queue", "--api-url", "http://127.0.0.1:8090"]).is_err(), "without --dev");
        assert!(parse(&["--mode", "queue", "--dev", "--api-url", "http://example.com:8090"]).is_err(), "not loopback");
        assert!(parse(&["--mode", "queue", "--dev", "--api-url", "https://127.0.0.1:8090"]).is_err(), "not plain http");
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
        assert!(parse(&["--mode", "queue", "--dev"]).unwrap().queue);
        // (the queue's matches ranked, whatever else asked; the open match casual unless --match-type says, RX32)
        assert_eq!(parse(&["--mode", "queue", "--dev"]).unwrap().match_type, MatchType::Ranked);
        assert_eq!(
            parse(&["--mode", "queue", "--dev", "--match-type", "ranked"]).unwrap().match_type,
            MatchType::Ranked
        );
        assert!(parse(&["--mode", "queue", "--dev", "--match-type", "casual"]).is_err());
        assert_eq!(parse(&[]).unwrap().match_type, MatchType::Casual);
        assert_eq!(parse(&["--match-type", "private"]).unwrap().match_type, MatchType::Private);
        assert!(!parse(&["--mode", "direct"]).unwrap().queue);
        assert!(!parse(&[]).unwrap().queue, "direct by default");
        assert!(parse(&["--mode", "ranked"]).is_err());
        assert!(parse(&["--team-size"]).is_err(), "a value needed");
    }

    #[test]
    fn the_environment_gives_the_defaults_and_flags_override_it() {
        let env = |name: &str| {
            match name {
                "SERVER_MODE" => Some("queue"),
                "GAME_PORT" => Some("5000"),
                "CERT_PATH" => Some("/certs/fullchain.pem"),
                "KEY_PATH" => Some("/certs/privkey.pem"),
                "ALLOWED_ORIGIN" => Some("https://carball.zolt.top/, https://other.example"),
                "PUBLIC_HOST" => Some("game.carball.zolt.top"),
                "HEALTH_PORT" => Some("9000"),
                "TICKET_PUBLIC_KEYS" => Some("k1 AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="),
                "API_URL" => Some("https://carball.zolt.top/"),
                "GAME_SERVER_TOKEN_FILE" => Some("/run/secrets/game_token"),
                "CF_ACCESS_CLIENT_ID" => Some("access-id.access"),
                "CF_ACCESS_CLIENT_SECRET_FILE" => Some("/run/secrets/access_secret"),
                "OUTBOX_DIR" => Some("/var/lib/carball-game/outbox"),
                _ => None,
            }
            .map(str::to_string)
        };
        let args = parse_args(std::iter::empty(), env).unwrap();
        assert!(args.queue);
        assert_eq!((args.port, args.health_port), (5000, 9000));
        assert_eq!(
            args.api,
            Some(ApiArgs {
                url: "https://carball.zolt.top".into(),
                token_file: "/run/secrets/game_token".into(),
                access: Some(("access-id.access".into(), "/run/secrets/access_secret".into())),
            })
        );
        assert_eq!(args.outbox_dir.as_deref(), Some(Path::new("/var/lib/carball-game/outbox")));
        assert_eq!(args.cert, Some(("/certs/fullchain.pem".into(), "/certs/privkey.pem".into())));
        assert_eq!(
            args.limits.allowed_origins,
            Some(vec!["https://carball.zolt.top".to_string(), "https://other.example".to_string()])
        );
        assert_eq!(args.public_host.as_deref(), Some("game.carball.zolt.top"));
        assert!(args.ticket_keys.is_some());
        // (the open match with a certificate: a public server without tickets, refused: AP2-9)
        let e = parse_args(["--port", "6000", "--mode", "direct"].map(String::from).into_iter(), env).err().unwrap();
        assert!(e.to_string().contains("--mode direct"), "{e}");
        let args = parse(&["--port", "6000", "--mode", "direct"]).unwrap();
        assert_eq!((args.port, args.queue), (6000, false));
        assert!(parse(&["--cert", "/a.pem"]).is_err(), "a certificate needs its key");
        let dev = parse(&[]).unwrap();
        assert!(dev.cert.is_none() && dev.limits.allowed_origins.is_none());
        assert!(dev.meshes.ends_with("collision_meshes"), "no build machine's path: found at run time");
    }

    #[test]
    fn a_public_server_needs_its_origins_and_a_queue_server_a_certificate_or_dev() {
        // (RV-372, RV-381: a blank or missing setting fails closed, not open)
        let with = |vars: &'static [(&'static str, &'static str)], flags: &[&str]| {
            parse_args(flags.iter().map(|f| (*f).to_string()), move |name: &str| {
                vars.iter().find(|(n, _)| *n == name).map(|(_, v)| (*v).to_string())
            })
        };
        const CERT: [(&str, &str); 2] = [("CERT_PATH", "/certs/fullchain.pem"), ("KEY_PATH", "/certs/privkey.pem")];
        assert!(with(&CERT, &[]).is_err(), "a certificate without ALLOWED_ORIGIN");
        assert!(with(&[CERT[0], CERT[1], ("ALLOWED_ORIGIN", "")], &[]).is_err(), "a blank ALLOWED_ORIGIN");
        assert!(with(&[CERT[0], CERT[1], ("ALLOWED_ORIGIN", " , ")], &[]).is_err(), "no origin named");
        let args = with(
            &[
                ("SERVER_MODE", "queue"),
                CERT[0],
                CERT[1],
                ("ALLOWED_ORIGIN", "HTTPS://Carball.Zolt.Top/"),
                ("TICKET_PUBLIC_KEYS", "k1 AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="),
                ("API_URL", "https://carball.zolt.top"),
                ("GAME_SERVER_TOKEN_FILE", "/run/t"),
                ("OUTBOX_DIR", "/o"),
            ],
            &[],
        )
        .unwrap();
        assert_eq!(
            args.limits.allowed_origins,
            Some(vec!["https://carball.zolt.top".to_string()]),
            "as browsers send it"
        );
        // A queue server: a certificate, or --dev
        assert!(with(&[("SERVER_MODE", "queue")], &[]).is_err());
        assert!(
            with(
                &[
                    ("SERVER_MODE", "queue"),
                    ("CERT_PATH", ""),
                    ("KEY_PATH", ""),
                    ("ALLOWED_ORIGIN", "https://a.example")
                ],
                &[]
            )
            .is_err(),
            "empty paths"
        );
        let dev =
            with(&[("SERVER_MODE", "queue"), CERT[0], CERT[1], ("ALLOWED_ORIGIN", "https://a.example")], &["--dev"])
                .unwrap();
        assert!(dev.queue && dev.cert.is_none(), "--dev: self-signed whatever the variables say");
        const KEYS: (&str, &str) = ("TICKET_PUBLIC_KEYS", "k1 AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
        const API: [(&str, &str); 3] =
            [("API_URL", "https://carball.zolt.top"), ("GAME_SERVER_TOKEN_FILE", "/run/t"), ("OUTBOX_DIR", "/o")];
        assert!(
            with(
                &[
                    ("SERVER_MODE", "queue"),
                    CERT[0],
                    CERT[1],
                    ("ALLOWED_ORIGIN", "https://a.example"),
                    KEYS,
                    API[0],
                    API[1],
                    API[2]
                ],
                &[]
            )
            .unwrap()
            .cert
            .is_some()
        );
        // (a public queue server's matches are rated: without the accounts service it won't start; --dev logs the calls)
        let public = [
            ("SERVER_MODE", "queue"),
            CERT[0],
            CERT[1],
            ("ALLOWED_ORIGIN", "https://a.example"),
            KEYS,
            ("OUTBOX_DIR", "/o"),
        ];
        let refused = |extra: &'static [(&'static str, &'static str)], why: &str| {
            let vars: Vec<(&'static str, &'static str)> = public.iter().chain(extra).copied().collect();
            let vars: &'static [(&'static str, &'static str)] = Box::leak(vars.into_boxed_slice());
            assert!(with(vars, &[]).is_err(), "{why}");
        };
        refused(&[], "no API_URL");
        refused(&[("API_URL", "https://carball.zolt.top")], "no GAME_SERVER_TOKEN_FILE");
        refused(&[("API_URL", "http://carball.zolt.top"), ("GAME_SERVER_TOKEN_FILE", "/t")], "http");
        refused(&[("API_URL", "https://carball.zolt.top/api"), ("GAME_SERVER_TOKEN_FILE", "/t")], "a path");
        refused(
            &[("API_URL", "https://carball.zolt.top"), ("GAME_SERVER_TOKEN_FILE", "/t"), ("CF_ACCESS_CLIENT_ID", "id")],
            "the Access id without its secret",
        );
        assert!(dev.api.is_none(), "--dev without API_URL: calls logged only");
        // (its calls kept on disk until sent: without OUTBOX_DIR, or a blank one, it won't start; --dev keeps none, RX31)
        let without = |outbox: Option<&'static str>| {
            let mut vars =
                vec![("SERVER_MODE", "queue"), CERT[0], CERT[1], ("ALLOWED_ORIGIN", "https://a.example"), KEYS];
            vars.extend([API[0], API[1]]);
            vars.extend(outbox.map(|o| ("OUTBOX_DIR", o)));
            let vars: &'static [(&'static str, &'static str)] = Box::leak(vars.into_boxed_slice());
            with(vars, &[])
        };
        let e = without(None).err().expect("no OUTBOX_DIR");
        assert!(e.to_string().contains("OUTBOX_DIR"), "{e}");
        assert!(without(Some(" ")).is_err(), "a blank OUTBOX_DIR");
        assert!(without(Some("/o")).is_ok());
        // (one it can't write: the start refused, before any secret is read)
        let unwritable = without(Some("/proc/carball-outbox-test")).unwrap();
        let e = outbox_config(&unwritable).expect_err("an unwritable OUTBOX_DIR");
        assert!(e.to_string().contains("OUTBOX_DIR /proc/carball-outbox-test"), "{e}");
        // (a public queue server's searches are accounts': without the tickets' keys it won't start; --dev makes its own)
        assert!(
            with(&[("SERVER_MODE", "queue"), CERT[0], CERT[1], ("ALLOWED_ORIGIN", "https://a.example")], &[]).is_err(),
            "no TICKET_PUBLIC_KEYS"
        );
        assert!(
            with(
                &[
                    ("SERVER_MODE", "queue"),
                    CERT[0],
                    CERT[1],
                    ("ALLOWED_ORIGIN", "https://a.example"),
                    ("TICKET_PUBLIC_KEYS", " ")
                ],
                &[]
            )
            .is_err(),
            "a blank TICKET_PUBLIC_KEYS"
        );
    }

    #[test]
    fn a_bad_number_names_its_setting_and_the_health_check_reads_only_its_port() {
        // (RV-399)
        let env = |vars: &'static [(&'static str, &'static str)]| {
            move |name: &str| vars.iter().find(|(n, _)| *n == name).map(|(_, v)| (*v).to_string())
        };
        let e = parse_args(std::iter::empty(), env(&[("GAME_PORT", "")])).err().expect("an empty GAME_PORT");
        assert!(e.to_string().contains("GAME_PORT"), "{e}");
        let e = parse(&["--port", "x"]).err().expect("--port x");
        assert!(e.to_string().contains("--port"), "{e}");
        // (a --dev run's empty certificate variables, an origin left blank: none of the health check's business)
        let messy = env(&[("CERT_PATH", ""), ("KEY_PATH", ""), ("ALLOWED_ORIGIN", ""), ("HEALTH_PORT", "9000")]);
        assert_eq!(health_port(&["--healthcheck".to_string()], messy).unwrap(), 9000);
        assert_eq!(
            health_port(&["--healthcheck".to_string(), "--health-port".to_string(), "9100".to_string()], messy)
                .unwrap(),
            9100
        );
        assert_eq!(health_port(&[], env(&[])).unwrap(), 8081);
        assert!(health_port(&[], env(&[("HEALTH_PORT", "")])).is_err());
    }

    #[test]
    fn dev_refuses_production_keys_and_a_mounted_certificate() {
        // (AP2-7: --dev's own tickets never beside production keys or a public server's certificate)
        let with = |vars: &'static [(&'static str, &'static str)]| {
            parse_args(["--mode", "queue", "--dev"].map(String::from).into_iter(), move |name: &str| {
                vars.iter().find(|(n, _)| *n == name).map(|(_, v)| (*v).to_string())
            })
        };
        assert!(with(&[]).is_ok());
        assert!(with(&[("TICKET_PUBLIC_KEYS", "k1 AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=")]).is_err());
        assert!(with(&[("TICKET_PUBLIC_KEYS_FILE", "/run/keys")]).is_err());
        let mounted: &'static str = Box::leak(std::env::current_exe().unwrap().display().to_string().into_boxed_str());
        let vars: &'static [(&'static str, &'static str)] =
            Box::leak(Box::new([("CERT_PATH", mounted), ("KEY_PATH", "/k.pem")]));
        assert!(with(vars).is_err(), "a file at CERT_PATH");
        assert!(
            with(&[("CERT_PATH", "/no/such/file.pem"), ("KEY_PATH", "/k.pem")]).is_ok(),
            "the image's defaults, nothing there"
        );
        assert!(
            parse_args(std::iter::empty(), |n: &str| match n {
                "TICKET_PUBLIC_KEYS" => Some("k".into()),
                "TICKET_PUBLIC_KEYS_FILE" => Some("/f".into()),
                _ => None,
            })
            .is_err(),
            "both"
        );
    }

    #[test]
    fn the_development_info_server_is_on_without_a_certificate_only_unless_asked() {
        let env = |name: &str| match name {
            "SERVER_MODE" => Some("queue".to_string()),
            "CERT_PATH" => Some("/c.pem".to_string()),
            "KEY_PATH" => Some("/k.pem".to_string()),
            "ALLOWED_ORIGIN" => Some("https://a.example".to_string()),
            "TICKET_PUBLIC_KEYS" => Some("k1 AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=".to_string()),
            "API_URL" => Some("https://a.example".to_string()),
            "GAME_SERVER_TOKEN_FILE" => Some("/run/t".to_string()),
            "OUTBOX_DIR" => Some("/o".to_string()),
            _ => None,
        };
        assert!(!dev_info_on(&parse_args(std::iter::empty(), env).unwrap()), "SEC-6: off with a certificate");
        assert!(dev_info_on(&parse(&[]).unwrap()));
        assert!(!dev_info_on(&parse(&["--dev-info", "off"]).unwrap()));
        assert!(dev_info_on(&parse(&["--mode", "queue", "--dev"]).unwrap()));
    }
}
