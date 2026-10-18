//! The game server's calls to the accounts service (notes/accounts.md §3; LV1): each match's result, each armed leave and
//! each refill (`match_host::Report`), sent to `API_URL` with the tunnel's Access service token (`CF-Access-Client-Id`,
//! `CF-Access-Client-Secret`) and the game server's own bearer token. A call that fails for a reason that may pass (no
//! answer, a 5xx, 429) is tried again with a growing wait, in order, for up to the acceptance window (24 h); each is kept
//! on disk meanwhile (`OUTBOX_DIR`, a small volume), so a restart sends it later. A call the service refuses (another 4xx)
//! is logged and dropped. Without `API_URL` (a development server, the tests) the calls are only logged.

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
        Report::Quitter { match_id, ticket } => Call {
            method: "POST".into(),
            path: "/api/quitters".into(),
            body: Some(json!({ "match": match_id, "ticket": ticket })),
            created,
        },
        Report::Refilled { match_id, account } => Call {
            method: "DELETE".into(),
            path: format!("/api/quitters/{match_id}/{}", account_text(account)),
            body: None,
            created,
        },
    }
}

/// An account's id as the service writes it (a UUID's text)
pub fn account_text(a: &[u8; 16]) -> String {
    let h: String = a.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

/// What became of a call
#[derive(Debug, PartialEq, Eq)]
pub enum Sent {
    /// Taken (2xx)
    Done,
    /// Refused for good (a 4xx but 429): dropped
    Refused(u16),
    /// Not now (no answer, 5xx, 429): tried again later
    Later,
}

/// The calls in order, each with its file (if kept on disk)
struct Queue {
    calls: VecDeque<(Call, Option<PathBuf>)>,
    dir: Option<PathBuf>,
    next: u64,
}

impl Queue {
    /// The calls kept in `dir` (by name: their order), or none
    fn load(dir: Option<PathBuf>) -> Self {
        let mut queue = Self { calls: VecDeque::new(), dir, next: 0 };
        let Some(dir) = queue.dir.clone() else { return queue };
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("outbox: {}: {e}; calls kept in memory only", dir.display());
            queue.dir = None;
            return queue;
        }
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|d| {
                d.filter_map(|e| e.ok().map(|e| e.path()))
                    .filter(|p| p.extension().is_some_and(|x| x == "json"))
                    .collect()
            })
            .unwrap_or_default();
        files.sort();
        for path in files {
            match std::fs::read_to_string(&path).ok().and_then(|text| parse(&text)) {
                Some(call) => queue.calls.push_back((call, Some(path))),
                None => eprintln!("outbox: {} unreadable, left as it is", path.display()),
            }
        }
        if !queue.calls.is_empty() {
            eprintln!("outbox: {} calls kept from before", queue.calls.len());
        }
        queue
    }

    /// A call at the back, written first (to a temporary name, then renamed: a crash leaves no half call)
    fn push(&mut self, call: Call) {
        let file = self.dir.as_ref().and_then(|dir| {
            self.next += 1;
            let name = format!("{:012}-{:06}.json", call.created, self.next);
            let path = dir.join(&name);
            let tmp = dir.join(format!("{name}.tmp"));
            let text = serialize(&call);
            match std::fs::write(&tmp, text).and_then(|()| std::fs::rename(&tmp, &path)) {
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
            let status = response.status();
            if status.is_success() {
                Sent::Done
            } else if status.as_u16() == 429 || status.is_server_error() {
                eprintln!("outbox: {} {}: {status}, later", call.method, call.path);
                Sent::Later
            } else {
                Sent::Refused(status.as_u16())
            }
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
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(10)).build() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("outbox: no HTTP client ({e}): calls logged only");
            reqwest::Client::new()
        }
    };
    let mut queue = Queue::load(config.dir.clone());
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
                retry_at = Some(tokio::time::Instant::now() + wait);
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
        let quit = call_of(&Report::Quitter { match_id: "abc".into(), ticket: "t0".into() }, "g", 0);
        assert_eq!(
            (quit.path.as_str(), quit.body.unwrap()),
            ("/api/quitters", json!({"match": "abc", "ticket": "t0"}))
        );
        let account = [0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x49, 0x08, 0x87, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01, 0x00];
        let refill = call_of(&Report::Refilled { match_id: "abc".into(), account }, "g", 0);
        assert_eq!(
            (refill.method.as_str(), refill.path.as_str(), refill.body),
            ("DELETE", "/api/quitters/abc/0f0e0d0c-0b0a-4908-8706-050403020100", None)
        );
    }

    /// A stand-in accounts service: answers each request with the next status (the last again after), recording each
    /// request's first line and headers
    async fn service(statuses: Vec<u16>) -> (String, Arc<Mutex<Vec<String>>>) {
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
                let reply = format!("HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
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
        tx.send(Report::Refilled { match_id: "m1".into(), account: [7; 16] }).unwrap();
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
                "DELETE /api/quitters/m1/07070707-0707-0707-0707-070707070707 HTTP/1.1",
                "POST /api/quitters HTTP/1.1"
            ]
        );
        let first = seen[0].to_ascii_lowercase();
        assert!(first.contains("authorization: bearer secret-token"), "{first}");
        assert!(
            first.contains("cf-access-client-id: access-id")
                && first.contains("cf-access-client-secret: access-secret")
        );
        assert!(seen[4].contains(r#"{"match":"m2","ticket":"t2"}"#), "{}", seen[4]);
        drop(tx);
        task.await.unwrap();
        let _ = std::fs::remove_dir(&dir);
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
