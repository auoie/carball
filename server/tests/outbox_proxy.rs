//! The outbox never sends through a proxy the environment names (its credentials go to `API_URL` alone, AP3): a test
//! binary of its own, so the process's proxy variables are set before anything else runs (RX31)

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use carball_server::match_host::Report;
use carball_server::outbox::{OutboxConfig, run};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// A stand-in answering every connection with `reply`, counting them
fn answer(listener: tokio::net::TcpListener, reply: &'static [u8]) -> Arc<AtomicUsize> {
    let count = Arc::new(AtomicUsize::new(0));
    let counted = count.clone();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = vec![0u8; 8192];
            let _ = stream.read(&mut buf).await;
            counted.fetch_add(1, Ordering::SeqCst);
            let _ = stream.write_all(reply).await;
        }
    });
    count
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
        proxy.set_nonblocking(true).unwrap();
        let proxied = answer(
            tokio::net::TcpListener::from_std(proxy).unwrap(),
            b"HTTP/1.1 502 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let service = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", service.local_addr().unwrap());
        let served = answer(service, b"HTTP/1.1 204 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
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
        while served.load(Ordering::SeqCst) == 0 && proxied.load(Ordering::SeqCst) == 0 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            (served.load(Ordering::SeqCst), proxied.load(Ordering::SeqCst)),
            (1, 0),
            "sent to the service itself, never to the proxy"
        );
        drop(tx);
        task.await.unwrap();
    });
}
