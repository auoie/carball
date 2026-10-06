#!/bin/sh
# Native and WebAssembly builds must simulate bit-identically (the native game server and the
# browser clients run the same physics). Run after building engine/build and engine/build-wasm.
#   engine/tests/check_native_wasm.sh [seconds]
set -e
cd "$(dirname "$0")/.."
SECONDS_TO_RUN=${1:-300}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
build/determinism ../out/arena/collision_meshes "$SECONDS_TO_RUN" > "$TMP/native_det.txt"
node build-wasm/determinism.js /collision_meshes "$SECONDS_TO_RUN" > "$TMP/wasm_det.txt"
if cmp -s "$TMP/native_det.txt" "$TMP/wasm_det.txt"; then
	echo "determinism: identical ($SECONDS_TO_RUN s scripted 2v2, $(tail -1 "$TMP/native_det.txt"))"
else
	echo "determinism: DIFFERENT"; diff "$TMP/native_det.txt" "$TMP/wasm_det.txt" | head -5; fail=1
fi
build/arena_smoketest ../out/arena/collision_meshes > "$TMP/native_smoke.txt"
node build-wasm/arena_smoketest.js /collision_meshes > "$TMP/wasm_smoke.txt"
if cmp -s "$TMP/native_smoke.txt" "$TMP/wasm_smoke.txt"; then
	echo "arena smoke test: identical"
else
	echo "arena smoke test: DIFFERENT"; diff "$TMP/native_smoke.txt" "$TMP/wasm_smoke.txt" | head -5; fail=1
fi
exit $fail
