//! The game server's calls to the accounts service (notes/accounts.md §3; LV1): each match's result, each armed leave and
//! each refill (`match_host::Report`), sent to `API_URL` with the tunnel's Access service token (`CF-Access-Client-Id`,
//! `CF-Access-Client-Secret`) and the game server's own bearer token: over https alone, to that origin alone (no redirect
//! followed, no proxy: the credentials go nowhere else, AP3). A call that fails for a reason that may pass is tried again
//! with a growing wait, in order, for up to the acceptance window (24 h): no answer, a 5xx, 429, and the answers that
//! aren't the service's own (a redirect, 401 or 403 from Access, a challenge or a wrong token, 404 or 405 from a wrong
//! route), those logged loudly; each is kept on disk meanwhile (`OUTBOX_DIR`, a small volume), so a restart sends it
//! later. A call the service refuses (another 4xx) is logged and dropped. Without `API_URL` (a development server, the
//! tests) the calls are only logged.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::mpsc::UnboundedReceiver;

use crate::match_host::Report;

/// How long a call is tried (s): the accounts service's acceptance window (`server.AcceptWindow`)
const GIVE_UP_SECONDS: i64 = 24 * 60 * 60;

/// Where the calls go and with what
#[derive(Clone, Debug)]
pub struct OutboxConfig {
    /// The service's origin (`https://carball.zolt.top`); none: calls logged only
    pub api_url: Option<String>,
    /// The game server's bearer token (`GAME_SERVER_TOKEN_FILE`)
    pub token: String,
    /// The tunnel's Access service token: its client id and secret
    pub access: Option<(String, String)>,
    /// Where the calls wait (`OUTBOX_DIR`); none: in memory only
    pub dir: Option<PathBuf>,
    /// This server's name in the results (`PUBLIC_HOST`)
    pub server: String,
    /// The first retry's wait; it doubles up to `max_wait`
    pub first_wait: Duration,
    pub max_wait: Duration,
    /// https alone (the service's; false: the tests' stand-in over plain http)
    pub https_only: bool,
}

/// A call: its method, path, body (JSON) and when it was made (Unix s)
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub method: String,
    pub path: String,
    pub body: Option<Value>,
    pub created: i64,
}

/// A report's call
pub fn call_of(report: &Report, server: &str, created: i64) -> Call {
    match report {
        Report::Result(r) => Call {
            method: "POST".into(),
            path: "/api/results".into(),
            body: Some(json!({
                "match": r.match_id,
                "server": server,
                "playlist": r.playlist,
                "winningTeam": r.winning_team,
                "players": r.players.iter().map(|p| json!({
                    "ticket": p.ticket, "team": p.team, "quitter": p.quitter, "seconds": p.seconds,
                })).collect::<Vec<_>>(),
            })),
            created,
        },
        // (the leave's time, the report's: the ban runs from it, not from when the call gets through, AP3)
        Report::Quitter { match_id, ticket } => Call {
            method: "POST".into(),
            path: "/api/quitters".into(),
            body: Some(json!({ "match": match_id, "ticket": ticket, "at": created })),
            created,
        },
        Report::Refilled { match_id, ticket } => Call {
            method: "POST".into(),
            path: "/api/refills".into(),
            body: Some(json!({ "match": match_id, "ticket": ticket })),
            created,
        },
    }
}

/// What became of a call
#[derive(Debug, PartialEq, Eq)]
pub enum Sent {
    /// Taken (2xx)
    Done,
    /// Refused for good (a 4xx but 429): dropped
    Refused(u16),
    /// Not now (no answer, 5xx, 429; a redirect, 401, 403, 404, 405: not the service's own answer): tried again later
    Later,
}

/// What an answer's status makes of a call
fn sent(status: u16) -> Sent {
    match status {
        200..=299 => Sent::Done,
        300..=399 | 401 | 403 | 404 | 405 | 429 | 500..=599 => Sent::Later,
        _ => Sent::Refused(status),
    }
}

/// The calls in order, each with its file (if kept on disk)
struct Queue {
    calls: VecDeque<(Call, Option<PathBuf>)>,
    dir: Option<PathBuf>,
    next: u64,
}

impl Queue {
    /// The calls kept in `dir` (by name: their order), or none; a crash's half-written `.tmp` files cleared, an
    /// unreadable call moved aside to `bad/` (said, not tried for ever), the names' counter on from the last kept (no new
    /// call overwrites one)
    fn load(dir: Option<PathBuf>) -> Self {
        let mut queue = Self { calls: VecDeque::new(), dir, next: 0 };
        let Some(dir) = queue.dir.clone() else { return queue };
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("outbox: {}: {e}; calls kept in memory only", dir.display());
            queue.dir = None;
            return queue;
        }
        let entries: Vec<PathBuf> =
            std::fs::read_dir(&dir).map(|d| d.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default();
        for tmp in entries.iter().filter(|p| p.extension().is_some_and(|x| x == "tmp")) {
            remove(tmp);
        }
        let mut files: Vec<&PathBuf> = entries.iter().filter(|p| p.extension().is_some_and(|x| x == "json")).collect();
        files.sort();
        for path in files {
            let counter = path.file_stem().and_then(|s| s.to_str()?.rsplit('-').next()?.parse::<u64>().ok());
            queue.next = queue.next.max(counter.unwrap_or(0));
            match std::fs::read_to_string(path).ok().and_then(|text| parse(&text)) {
                Some(call) => queue.calls.push_back((call, Some(path.clone()))),
                None => {
                    let bad = dir.join("bad");
                    let moved = std::fs::create_dir_all(&bad)
                        .and_then(|()| std::fs::rename(path, bad.join(path.file_name().unwrap_or_default())));
                    eprintln!("outbox: {} unreadable, moved to {} ({moved:?})", path.display(), bad.display());
                }
            }
        }
        if !queue.calls.is_empty() {
            eprintln!("outbox: {} calls kept from before", queue.calls.len());
        }
        queue
    }

    /// A call at the back, written first (to a temporary name, synced, then renamed and the directory synced: a crash or
    /// a power cut leaves the whole call or none)
    fn push(&mut self, call: Call) {
        let file = self.dir.as_ref().and_then(|dir| {
            self.next += 1;
            let name = format!("{:012}-{:06}.json", call.created, self.next);
            let path = dir.join(&name);
            let tmp = dir.join(format!("{name}.tmp"));
            let text = serialize(&call);
            match write_synced(&tmp, text.as_bytes())
                .and_then(|()| std::fs::rename(&tmp, &path))
                .and_then(|()| sync_dir(dir))
            {
                Ok(()) => Some(path),
                Err(e) => {
                    eprintln!("outbox: writing {}: {e}; kept in memory", path.display());
                    None
                }
            }
        });
        self.calls.push_back((call, file));
    }

    /// The front call gone (sent or dropped): its file too
    fn pop(&mut self) {
        if let Some((_, Some(path))) = self.calls.pop_front() {
            remove(&path);
        }
    }
}

fn write_synced(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = std::fs::File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn sync_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::File::open(dir)?.sync_all()
}

/// The outbox's directory made and written to now (a call written and removed): one it can't write stops the start,
/// rather than the server keeping its calls in memory and losing them at the next restart (AP3)
pub fn check_dir(dir: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir).map_err(|e| anyhow::anyhow!("OUTBOX_DIR {}: {e}", dir.display()))?;
    let probe = dir.join(".probe.tmp");
    write_synced(&probe, b"{}").map_err(|e| anyhow::anyhow!("OUTBOX_DIR {} isn't writable: {e}", dir.display()))?;
    std::fs::remove_file(&probe).map_err(|e| anyhow::anyhow!("OUTBOX_DIR {}: {e}", dir.display()))
}

fn remove(path: &Path) {
    if let Err(e) = std::fs::remove_file(path) {
        eprintln!("outbox: removing {}: {e}", path.display());
    }
}

fn serialize(call: &Call) -> String {
    json!({ "method": call.method, "path": call.path, "body": call.body, "created": call.created }).to_string()
}

fn parse(text: &str) -> Option<Call> {
    let v: Value = serde_json::from_str(text).ok()?;
    Some(Call {
        method: v["method"].as_str()?.to_string(),
        path: v["path"].as_str()?.to_string(),
        body: Some(v["body"].clone()).filter(|b| !b.is_null()),
        created: v["created"].as_i64()?,
    })
}

/// One call sent
async fn send(client: &reqwest::Client, config: &OutboxConfig, api: &str, call: &Call) -> Sent {
    let method = if call.method == "DELETE" { reqwest::Method::DELETE } else { reqwest::Method::POST };
    let mut request = client
        .request(method, format!("{api}{}", call.path))
        .header("Authorization", format!("Bearer {}", config.token));
    if let Some((id, secret)) = &config.access {
        request = request.header("CF-Access-Client-Id", id).header("CF-Access-Client-Secret", secret);
    }
    if let Some(body) = &call.body {
        request = request.header("Content-Type", "application/json").body(body.to_string());
    }
    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let result = sent(status);
            match status {
                429 | 500..=599 => eprintln!("outbox: {} {}: {status}, later", call.method, call.path),
                300..=399 | 401 | 403 | 404 | 405 => eprintln!(
                    "outbox: {} {}: {status}, not the accounts service's answer (a redirect, Access or a challenge, a wrong \
                     route or token): kept and tried again; check API_URL, GAME_SERVER_TOKEN_FILE and the Access token",
                    call.method, call.path
                ),
                _ => {}
            }
            result
        }
        Err(e) => {
            eprintln!("outbox: {} {}: {e}, later", call.method, call.path);
            Sent::Later
        }
    }
}

/// The outbox: the reports from the game thread, each made a call and kept, sent in order (retried as said above) until
/// the channel closes
pub async fn run(config: OutboxConfig, mut reports: UnboundedReceiver<Report>) {
    // (to API_URL alone: no redirect followed, no proxy, https alone; named, not a bare client: AP3)
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .https_only(config.https_only)
        .user_agent(concat!("carball-server/", env!("CARGO_PKG_VERSION")))
        .build();
    let mut queue = Queue::load(config.dir.clone());
    let client = match client {
        Ok(c) => c,
        Err(e) => {
            // (never sent by this run: kept, for the next)
            eprintln!("outbox: no HTTP client ({e}): the calls kept for a restart");
            while let Some(r) = reports.recv().await {
                queue.push(call_of(&r, &config.server, crate::ticket::unix_now()));
            }
            return;
        }
    };
    let mut wait = config.first_wait;
    let mut retry_at: Option<tokio::time::Instant> = None;
    loop {
        // (new reports first; the front call sent when it's due)
        let due = retry_at.is_none_or(|at| tokio::time::Instant::now() >= at);
        if queue.calls.is_empty() || !due {
            let sleep = retry_at.map(tokio::time::sleep_until);
            tokio::select! {
                report = reports.recv() => match report {
                    Some(r) => queue.push(call_of(&r, &config.server, crate::ticket::unix_now())),
                    None => return,
                },
                () = async { if let Some(s) = sleep { s.await } else { std::future::pending().await } } => {}
            }
            continue;
        }
        while let Ok(r) = reports.try_recv() {
            queue.push(call_of(&r, &config.server, crate::ticket::unix_now()));
        }
        let Some((call, _)) = queue.calls.front().cloned() else { continue };
        let Some(api) = config.api_url.as_deref() else {
            eprintln!(
                "outbox (no API_URL): {} {} {}",
                call.method,
                call.path,
                call.body.as_ref().map_or(String::new(), Value::to_string)
            );
            queue.pop();
            continue;
        };
        if crate::ticket::unix_now() - call.created > GIVE_UP_SECONDS {
            eprintln!("outbox: {} {} past the acceptance window: dropped", call.method, call.path);
            queue.pop();
            continue;
        }
        match send(&client, &config, api, &call).await {
            Sent::Done => {
                queue.pop();
                wait = config.first_wait;
                retry_at = None;
            }
            Sent::Refused(status) => {
                eprintln!("outbox: {} {} refused ({status}): dropped", call.method, call.path);
                queue.pop();
                retry_at = None;
            }
            Sent::Later => {
                // (±20%: game servers after the same outage don't all come back at once)
                let jitter = 0.8 + 0.4 * (crate::game::random_u64() % 1000) as f64 / 1000.0;
                retry_at = Some(tokio::time::Instant::now() + wait.mul_f64(jitter));
                wait = (wait * 2).min(config.max_wait);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::match_host::{MatchResult, ResultPlayer};
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn each_reports_call() {
        let result = Report::Result(MatchResult {
            match_id: "abc".into(),
            playlist: 1,
            winning_team: 1,
            players: vec![
                ResultPlayer { ticket: "t0".into(), team: 0, quitter: true, seconds: 120 },
                ResultPlayer { ticket: "t1".into(), team: 1, quitter: false, seconds: 300 },
            ],
        });
        let call = call_of(&result, "game.example", 5);
        assert_eq!((call.method.as_str(), call.path.as_str(), call.created), ("POST", "/api/results", 5));
        assert_eq!(
            call.body.unwrap(),
            json!({"match": "abc", "server": "game.example", "playlist": 1, "winningTeam": 1, "players": [
                {"ticket": "t0", "team": 0, "quitter": true, "seconds": 120},
                {"ticket": "t1", "team": 1, "quitter": false, "seconds": 300},
            ]})
        );
        let quit = call_of(&Report::Quitter { match_id: "abc".into(), ticket: "t0".into() }, "g", 7);
        assert_eq!(
            (quit.path.as_str(), quit.body.unwrap()),
            ("/api/quitters", json!({"match": "abc", "ticket": "t0", "at": 7}))
        );
        let refill = call_of(&Report::Refilled { match_id: "abc".into(), ticket: "r0".into() }, "g", 0);
        assert_eq!(
            (refill.method.as_str(), refill.path.as_str(), refill.body.unwrap()),
            ("POST", "/api/refills", json!({"match": "abc", "ticket": "r0"}))
        );
    }

    /// An answer's status: taken, tried again (the service's "not now", and the answers that aren't the service's), or
    /// refused for good (dropped)
    #[test]
    fn each_status_is_taken_retried_or_dropped() {
        for status in [200, 201, 204] {
            assert_eq!(sent(status), Sent::Done, "{status}");
        }
        for status in [301, 302, 303, 307, 308, 401, 403, 404, 405, 429, 500, 502, 503, 504] {
            assert_eq!(sent(status), Sent::Later, "{status}");
        }
        for status in [400, 409, 410, 413, 422] {
            assert_eq!(sent(status), Sent::Refused(status), "{status}");
        }
    }

    /// A stand-in accounts service: answers each request with the next status (the last again after), recording each
    /// request's first line and headers
    async fn service(statuses: Vec<u16>) -> (String, Arc<Mutex<Vec<String>>>) {
        service_to(statuses, None).await
    }

    /// The same, each answer with a `Location` (a redirect's)
    async fn service_to(statuses: Vec<u16>, location: Option<String>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            let mut i = 0;
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut buf = vec![0u8; 8192];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                log.lock().unwrap().push(String::from_utf8_lossy(&buf[..n]).to_string());
                let status = statuses[i.min(statuses.len() - 1)];
                i += 1;
                let to = location.as_ref().map_or(String::new(), |l| format!("Location: {l}\r\n"));
                let reply = format!("HTTP/1.1 {status} X\r\n{to}Content-Length: 0\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(reply.as_bytes()).await;
            }
        });
        (url, seen)
    }

    fn config(api_url: Option<String>, dir: Option<PathBuf>) -> OutboxConfig {
        OutboxConfig {
            api_url,
            token: "secret-token".into(),
            access: Some(("access-id".into(), "access-secret".into())),
            dir,
            server: "game.example".into(),
            first_wait: Duration::from_millis(20),
            max_wait: Duration::from_millis(80),
            https_only: false,
        }
    }

    fn scratch_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("carball-outbox-{:016x}", crate::game::random_u64()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn until(what: impl Fn() -> bool) {
        for _ in 0..200 {
            if what() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("not in time");
    }

    #[tokio::test]
    async fn calls_go_out_in_order_with_the_credentials_retried_through_failures() {
        let (url, seen) = service(vec![503, 503, 204, 409, 204]).await;
        let dir = scratch_dir();
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(config(Some(url), Some(dir.clone())), rx));
        tx.send(Report::Quitter { match_id: "m1".into(), ticket: "t1".into() }).unwrap();
        tx.send(Report::Refilled { match_id: "m1".into(), ticket: "r1".into() }).unwrap();
        tx.send(Report::Quitter { match_id: "m2".into(), ticket: "t2".into() }).unwrap();
        // (503, 503, then taken; the refill refused for good (409): dropped; the last taken)
        until(|| seen.lock().unwrap().len() == 5).await;
        until(|| std::fs::read_dir(&dir).map_or(0, |d| d.count()) == 0).await;
        let seen = seen.lock().unwrap().clone();
        let lines: Vec<&str> = seen.iter().map(|r| r.lines().next().unwrap_or("")).collect();
        assert_eq!(
            lines,
            [
                "POST /api/quitters HTTP/1.1",
                "POST /api/quitters HTTP/1.1",
                "POST /api/quitters HTTP/1.1",
                "POST /api/refills HTTP/1.1",
                "POST /api/quitters HTTP/1.1"
            ]
        );
        let first = seen[0].to_ascii_lowercase();
        assert!(first.contains("authorization: bearer secret-token"), "{first}");
        assert!(first.contains("user-agent: carball-server/"), "named: {first}");
        assert!(seen[3].contains(r#"{"match":"m1","ticket":"r1"}"#), "{}", seen[3]);
        assert!(
            first.contains("cf-access-client-id: access-id")
                && first.contains("cf-access-client-secret: access-secret")
        );
        assert!(seen[4].contains(r#""match":"m2","ticket":"t2""#), "{}", seen[4]);
        drop(tx);
        task.await.unwrap();
        let _ = std::fs::remove_dir(&dir);
    }

    /// A redirect (Access's login, another host) isn't followed: the credentials go nowhere else, and the call is tried
    /// again, as after 401 and 403 (Access, a challenge, a token not set yet), until the service takes it (AP3)
    #[tokio::test]
    async fn a_redirect_is_not_followed_and_an_answer_not_the_services_is_retried() {
        let (elsewhere, elsewhere_seen) = service(vec![200]).await;
        let (url, seen) = service_to(vec![302, 307, 401, 403, 204], Some(format!("{elsewhere}/login"))).await;
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(config(Some(url), None), rx));
        tx.send(Report::Quitter { match_id: "m1".into(), ticket: "t1".into() }).unwrap();
        until(|| seen.lock().unwrap().len() == 5).await;
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(seen.lock().unwrap().len(), 5, "taken at the fifth: not sent again");
        assert!(elsewhere_seen.lock().unwrap().is_empty(), "the redirect's host got nothing");
        drop(tx);
        task.await.unwrap();
    }

    /// https alone (the service's): a plain http origin is never sent to, its call kept for later
    #[tokio::test]
    async fn plain_http_is_never_sent_to() {
        let (url, seen) = service(vec![204]).await;
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(OutboxConfig { https_only: true, ..config(Some(url), None) }, rx));
        tx.send(Report::Quitter { match_id: "m1".into(), ticket: "t1".into() }).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(seen.lock().unwrap().is_empty(), "sent over plain http");
        drop(tx);
        task.abort();
    }

    /// The calls kept on disk loaded in their order (by name); a crash's `.tmp` cleared; an unreadable call moved to
    /// `bad/`, not tried for ever; a new call named after the last kept, never over it (AP3)
    #[test]
    fn the_kept_calls_load_in_order_and_a_bad_one_is_moved_aside() {
        let dir = scratch_dir();
        let call =
            |m: &str, created| call_of(&Report::Quitter { match_id: m.into(), ticket: "t".into() }, "g", created);
        std::fs::write(dir.join("000000000005-000002.json"), serialize(&call("second", 5))).unwrap();
        std::fs::write(dir.join("000000000005-000001.json"), serialize(&call("first", 5))).unwrap();
        std::fs::write(dir.join("000000000004-000009.json"), "not a call").unwrap();
        std::fs::write(dir.join("000000000006-000003.json.tmp"), "half").unwrap();
        let mut queue = Queue::load(Some(dir.clone()));
        let order: Vec<String> =
            queue.calls.iter().map(|(c, _)| c.body.as_ref().unwrap()["match"].as_str().unwrap().to_string()).collect();
        assert_eq!(order, ["first", "second"]);
        assert!(dir.join("bad/000000000004-000009.json").is_file(), "the unreadable one moved aside");
        assert!(!dir.join("000000000006-000003.json.tmp").exists(), "the half-written one cleared");
        queue.push(call("third", 5));
        assert!(dir.join("000000000005-000010.json").is_file(), "named on from the last kept (9)");
        assert_eq!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter(|e| e.as_ref().unwrap().path().extension().is_some_and(|x| x == "json"))
                .count(),
            3
        );
        let _ = std::fs::remove_dir_all(&dir);
        // (a directory it can't write: the start refused)
        let file = std::env::temp_dir().join(format!("carball-outbox-file-{:016x}", crate::game::random_u64()));
        std::fs::write(&file, "").unwrap();
        assert!(check_dir(&file.join("outbox")).is_err(), "under a file");
        let _ = std::fs::remove_file(&file);
        let fine = scratch_dir();
        assert!(check_dir(&fine).is_ok());
        assert_eq!(std::fs::read_dir(&fine).unwrap().count(), 0, "its probe gone");
        let _ = std::fs::remove_dir(&fine);
    }

    #[tokio::test]
    async fn a_call_kept_on_disk_goes_out_after_a_restart() {
        let dir = scratch_dir();
        // (the service away: the call waits on disk)
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(config(Some("http://127.0.0.1:9".into()), Some(dir.clone())), rx));
        tx.send(Report::Quitter { match_id: "m9".into(), ticket: "t9".into() }).unwrap();
        until(|| std::fs::read_dir(&dir).map_or(0, |d| d.count()) == 1).await;
        drop(tx);
        task.abort();
        // (a new run with the service back: sent from the file, the file gone)
        let (url, seen) = service(vec![204]).await;
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(config(Some(url), Some(dir.clone())), rx));
        until(|| seen.lock().unwrap().len() == 1).await;
        until(|| std::fs::read_dir(&dir).map_or(0, |d| d.count()) == 0).await;
        assert!(seen.lock().unwrap()[0].contains(r#""match":"m9""#));
        drop(tx);
        task.await.unwrap();
        let _ = std::fs::remove_dir(&dir);
    }
}
