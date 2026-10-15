//! Authoritative game server: the patched engine (C++, `engine/capi`) behind WebTransport.
//! Protocol: `protocol/README.md`. Netcode: `notes/netcode.md`.

pub mod engine;
pub mod game;
pub mod game_loop;
pub mod input_buffer;
pub mod match_host;
pub mod net;
#[cfg(test)]
mod netsim;
pub mod replication;
#[cfg(test)]
mod net_tests;
pub mod protocol;
pub mod queue;
