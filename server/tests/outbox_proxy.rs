//! The outbox never sends through a proxy the environment names (its credentials go to `API_URL` alone, AP3): a test
//! binary of its own, so the process's proxy variables are set before anything else runs (RX31)

use std::time::{Duration, Instant};

use carball_server::match_host::Report;
use carball_server::outbox::{OutboxConfig, run};

/// A stand-in (wiremock) answering every request with `status`
async fn answer(listener: std::net::TcpListener, status: u16) -> wiremock::MockServer {
    let server = wiremock::MockServer::builder().listener(listener).start().await;
    wiremock::Mock::given(wiremock::matchers::any())
        .respond_with(wiremock::ResponseTemplate::new(status))
        .mount(&server)
        .await;
    server
}

/// How many requests a stand-in got
async fn count(server: &wiremock::MockServer) -> usize {
    server.received_requests().await.map_or(0, |r| r.len())
}

#[test]
fn a_proxy_named_in_the_environment_is_never_used() {
    let proxy = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy_url = format!("http://{}", proxy.local_addr().unwrap());
    // SAFETY: this binary's one test, before it starts a thread of its own or anything reads the environment
    unsafe {
        for name in ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
            std::env::set_var(name, &proxy_url);
        }
        for name in ["NO_PROXY", "no_proxy"] {
            std::env::remove_var(name);
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    runtime.block_on(async move {
        let proxied = answer(proxy, 502).await;
        let served = answer(std::net::TcpListener::bind("127.0.0.1:0").unwrap(), 204).await;
        let url = served.uri();
        let config = OutboxConfig {
            api_url: Some(url),
            token: "secret-token".into(),
            access: None,
            dir: None,
            server: "game.example".into(),
            first_wait: Duration::from_millis(20),
            max_wait: Duration::from_millis(80),
            https_only: false,
        };
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(run(config, rx));
        tx.send(Report::Quitter { match_id: "m1".into(), ticket: "t1".into() }).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while count(&served).await == 0 && count(&proxied).await == 0 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            (count(&served).await, count(&proxied).await),
            (1, 0),
            "sent to the service itself, never to the proxy"
        );
        drop(tx);
        task.await.unwrap();
    });
}
