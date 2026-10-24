#!/usr/bin/env bash
# The engine's Rust bindings (server/src/engine_ffi.rs) made again from its C interface (engine/capi/rlengine.h) with
# bindgen, after a change to the header: server/tests/engine_bindings.rs's options (bindgen's version pinned in
# server/Cargo.toml), the file written instead of checked. Needs libclang and rustfmt. Offline (cargo --offline), unless
# CARGO_OFFLINE=0.
#   scripts/gen_bindings.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OFFLINE=$([ "${CARGO_OFFLINE:-1}" = 0 ] && echo --locked || echo --offline)
CARBALL_WRITE_BINDINGS=1 cargo test "$OFFLINE" --manifest-path "$ROOT/server/Cargo.toml" --test engine_bindings
git -C "$ROOT" diff --stat -- server/src/engine_ffi.rs
