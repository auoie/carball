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
mod netsim;
pub mod replication;
#[cfg(all(test, feature = "net"))]
mod net_tests;
pub mod protocol;
#[cfg(feature = "net")]
pub mod queue;
