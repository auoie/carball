//! Authoritative game server: the patched engine (C++, `engine/capi`) behind WebTransport.
//! Protocol: `protocol/README.md`. Netcode: `notes/netcode.md`. Without the `net` feature: the match alone (the browser's
//! local host, `src/bin/host.rs`).

pub mod chan;
pub mod engine;
pub mod game;
#[cfg(feature = "net")]
pub mod game_loop;
pub mod input_buffer;
pub mod match_host;
#[cfg(feature = "net")]
pub mod net;
#[cfg(all(test, feature = "net"))]
mod net_tests;
#[cfg(all(test, feature = "net"))]
mod netsim;
#[cfg(feature = "net")]
pub mod outbox;
pub mod protocol;
pub mod replication;
#[cfg(feature = "net")]
pub mod ticket;

/// The log's filter, the network server's and the local host's (RV-937): this crate's own events at `level`, any other
/// crate's errors alone (the dependencies' warnings are noise, never said in our words: quinn-udp's failed send, RX48)
#[cfg(any(feature = "net", feature = "host"))]
pub fn log_filter(level: tracing::Level) -> tracing_subscriber::filter::Targets {
    tracing_subscriber::filter::Targets::new()
        .with_target("carball_server", level)
        .with_target("carball_host", level)
        .with_default(tracing::Level::ERROR)
}

#[cfg(all(test, feature = "net"))]
mod tests {
    use tracing::Level;

    /// This crate's info and up (the library's modules, both binaries'); another crate's warnings not, its errors yes
    #[test]
    fn the_log_takes_our_events_and_only_the_others_errors() {
        let filter = super::log_filter(Level::INFO);
        assert!(filter.would_enable("carball_server::net", &Level::INFO));
        assert!(filter.would_enable("carball_server", &Level::WARN));
        assert!(filter.would_enable("carball_host", &Level::INFO));
        assert!(!filter.would_enable("carball_server::outbox", &Level::DEBUG));
        assert!(!filter.would_enable("quinn_udp", &Level::WARN), "a failed send's warning: noise");
        assert!(!filter.would_enable("quinn_proto::connection", &Level::WARN));
        assert!(filter.would_enable("quinn", &Level::ERROR));
    }
}
