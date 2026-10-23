#!/usr/bin/env bash
# The browser's local host (an offline match against bots, client/src/local/): the engine's libraries built with
# Emscripten (engine/build-wasm-host), then the server's match (server/src/bin/host.rs) for wasm32-unknown-emscripten
# linked with them; the module copied beside them as carball_host.mjs + carball_host.wasm (the client's @host).
# Needs: emcmake (Emscripten), rustup's wasm32-unknown-emscripten target. Offline (cargo --offline), unless CARGO_OFFLINE=0
# (the image build's: its registry a cache, Dockerfile).
#   scripts/build_host.sh [engine|host]     (one step alone: the engine's libraries, or the host linked with them; both
#                                            by default. The image build runs them in two stages, the libraries' cached
#                                            while the engine is unchanged)
set -euo pipefail
STEP=${1:-all}
case $STEP in all | engine | host) ;; *) echo "usage: scripts/build_host.sh [engine|host]"; exit 1 ;; esac
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${CARBALL_ENGINE_WASM:-$ROOT/engine/build-wasm-host}
TARGET_DIR=${CARGO_TARGET_DIR:-$ROOT/server/target}
# (no build machine's paths in the module, which ships: the sources', the registry's and the home directory's remapped,
# Rust's (its panic messages name source files) and the engine's C++ alike)
CARGO_HOME_DIR=${CARGO_HOME:-$HOME/.cargo}
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$ROOT=/src --remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$HOME=/home"
PREFIX_MAP="-ffile-prefix-map=$ROOT=/src -ffile-prefix-map=$HOME=/home"
mkdir -p "$OUT"
if [ "$STEP" != host ]; then
	emcmake cmake -S "$ROOT/engine" -B "$OUT" -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="$PREFIX_MAP" -DCMAKE_CXX_FLAGS="$PREFIX_MAP" > "$OUT/configure.log"
	cmake --build "$OUT" --target rlengine_capi -j "${JOBS:-8}"
fi
[ "$STEP" != engine ] || exit 0
# (em++, not emcc: linking as C++ brings the engine's C++ library and Emscripten's exception support, which Rust's
# unwinding on this target needs)
# (no debug info: the module ships without its functions' names)
OFFLINE=$([ "${CARGO_OFFLINE:-1}" = 0 ] && echo --locked || echo --offline)
CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER=em++ CARBALL_ENGINE_WASM=$OUT cargo build "$OFFLINE" --release --manifest-path "$ROOT/server/Cargo.toml" --target-dir "$TARGET_DIR" \
	--target wasm32-unknown-emscripten --no-default-features --features host --bin carball-host
BUILT=$TARGET_DIR/wasm32-unknown-emscripten/release
cp "$BUILT/carball-host.js" "$OUT/carball_host.mjs"
cp "$BUILT/carball_host.wasm" "$OUT/carball_host.wasm"
echo "local host: $OUT/carball_host.mjs"
