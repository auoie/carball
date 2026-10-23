#!/usr/bin/env bash
# The image build's WebAssembly cache (scripts/build_images.sh, RV-794..797): its own functions, taken from the script,
# run on a temporary directory with a fake build. The key follows the build's commands, the compilers' environment and
# the sources (not a comment); a hit builds nothing and prints the hashes; a corrupted entry is caught, put aside and
# built again; two builds at once build once.
#   scripts/build_images_cache_test.sh      (needs what the image build does: Emscripten, cmake, rustc, node)
set -euo pipefail
SCRIPT="$(cd "$(dirname "$0")" && pwd)/build_images.sh"
H=$(mktemp -d "${TMPDIR:-/tmp}/build-cache-test.XXXXXX")
echo "(in $H)"
eval "$(awk '/^(build_env|cargo_config|toolchain|inputs_key|cached)\(\) \{/,/^}/' "$SCRIPT")"
EM=${EMSCRIPTEN_ROOT:-/usr/lib/emscripten}
run=$(date +%s%N)
SRC="$H/src-$run"; CACHE="$H/cache-$run"; OUT="$H/out-$run"
mkdir -p "$SRC/engine" "$CACHE" "$OUT"
echo "int x;" > "$SRC/engine/a.cpp"
builds="$H/builds-$run"; : > "$builds"
fake() { echo built >> "$builds"; sleep 1; mkdir -p "$OUT"; echo "wasm $(cat "$SRC/engine/a.cpp")" > "$OUT/x.wasm"; }
pass=0 fail=0
check() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "PASS $3"; else fail=$((fail+1)); echo "FAIL $3 (got $1, want $2)"; fi; }
k1=$(inputs_key fake engine)
cached e "$k1" "$OUT" x.wasm -- fake > /dev/null
check "$(wc -l < "$builds")" 1 "a cold cache builds"
check "$(cat "$CACHE/e-$k1/SHA256SUMS" | cut -d' ' -f3)" "x.wasm" "the entry keeps its files' hashes"
o=$(cached e "$k1" "$OUT" x.wasm -- fake); [[ $o == *"(cached"* ]] && check yes yes "the same key: a hit" || check no yes "the same key: a hit"
check "$(wc -l < "$builds")" 1 "a hit builds nothing"
o=$(cached e "$k1" "$OUT" x.wasm -- fake); [[ $o == *"  x.wasm"* ]] && check yes yes "a hit prints the hashes" || check no yes "a hit prints the hashes"
# (the key: the build function's text, the environment, the sources; not a comment)
fake() { echo built >> "$builds"; sleep 1; mkdir -p "$OUT"; echo "wasm -O3 $(cat "$SRC/engine/a.cpp")" > "$OUT/x.wasm"; }
check "$([ "$(inputs_key fake engine)" != "$k1" ] && echo changed)" changed "a changed build command: a new key"
fake() { echo built >> "$builds"; sleep 1; mkdir -p "$OUT"; echo "wasm $(cat "$SRC/engine/a.cpp")" > "$OUT/x.wasm"; } # (a comment)
check "$(inputs_key fake engine)" "$k1" "the same build with a comment: the same key"
for v in EMCC_CFLAGS=-O2 CFLAGS=-g CXXFLAGS=-g LDFLAGS=-s RUSTFLAGS=-Copt-level=1 CARGO_PROFILE_RELEASE_LTO=true EM_CACHE=/x CARGO_ENCODED_RUSTFLAGS=x; do
	check "$([ "$(env "$v" bash -c "$(declare -f build_env cargo_config toolchain inputs_key fake); SRC='$SRC' EM='$EM' inputs_key fake engine")" != "$k1" ] && echo changed)" changed "$v: a new key"
done
check "$([ "$(env HOME_UNRELATED=1 bash -c "$(declare -f build_env cargo_config toolchain inputs_key fake); SRC='$SRC' EM='$EM' inputs_key fake engine")" = "$k1" ] && echo same)" same "an unrelated variable: the same key"
# (cargo's config: CARGO_INCREMENTAL, a .cargo/config.toml where the build runs or above it, CARGO_HOME's: RV-815)
check "$([ "$(env CARGO_INCREMENTAL=1 bash -c "$(declare -f build_env cargo_config toolchain inputs_key fake); SRC='$SRC' EM='$EM' inputs_key fake engine")" != "$k1" ] && echo changed)" changed "CARGO_INCREMENTAL=1: a new key"
mkdir -p "$H/cwd-$run/below/.cargo" "$H/cwd-$run/above/.cargo" "$H/home-$run"
printf '[profile.release]\nopt-level = 1\n' > "$H/cwd-$run/below/.cargo/config.toml"
check "$([ "$(cd "$H/cwd-$run/below" && inputs_key fake engine)" != "$k1" ] && echo changed)" changed "a .cargo/config.toml where the build runs: a new key"
mkdir -p "$H/cwd-$run/above/deep"
printf '[profile.release]\nopt-level = 1\n' > "$H/cwd-$run/above/.cargo/config"
check "$([ "$(cd "$H/cwd-$run/above/deep" && inputs_key fake engine)" != "$k1" ] && echo changed)" changed "a .cargo/config above where it runs: a new key"
home_key() { env CARGO_HOME="$H/home-$run" bash -c "$(declare -f build_env cargo_config toolchain inputs_key fake); SRC='$SRC' EM='$EM' inputs_key fake engine"; }
before=$(home_key)
printf '[build]\nincremental = true\n' > "$H/home-$run/config.toml"
# (a directory reached through a symlink: the config above the physical one counts, as cargo reads it, RV-824)
ln -s "$H/cwd-$run/above/deep" "$H/link-$run"
check "$([ "$(cd "$H/link-$run" && inputs_key fake engine)" != "$k1" ] && echo changed)" changed "a config above a symlinked directory's physical one: a new key"
check "$([ "$(home_key)" != "$before" ] && echo changed)" changed "a config in CARGO_HOME: a new key"
echo "int y;" > "$SRC/engine/a.cpp"
check "$([ "$(inputs_key fake engine)" != "$k1" ] && echo changed)" changed "a changed source: a new key"
echo "int x;" > "$SRC/engine/a.cpp"
# (a corrupted entry: caught, put aside (kept), built again, the new entry right)
printf 'X' | dd of="$CACHE/e-$k1/x.wasm" bs=1 seek=0 conv=notrunc status=none
o=$(cached e "$k1" "$OUT" x.wasm -- fake 2>&1); [[ $o == *"don't match"* ]] && check yes yes "a corrupted entry caught" || check no yes "a corrupted entry caught"
check "$(wc -l < "$builds")" 2 "a corrupted entry built again"
check "$(ls -d "$CACHE"/e-"$k1".mismatch-* | wc -l)" 1 "the corrupted entry put aside, not deleted"
check "$(cat "$CACHE/e-$k1/x.wasm")" "wasm int x;" "the rebuilt entry's file right"
(cd "$CACHE/e-$k1" && sha256sum --quiet --strict -c SHA256SUMS) && check ok ok "the rebuilt entry matches its hashes" || check bad ok "the rebuilt entry matches its hashes"
# (two builds at once of a new key: one builds, the other waits and takes its entry; no nested partial)
echo "int z;" > "$SRC/engine/a.cpp"
k2=$(inputs_key fake engine)
cached e "$k2" "$OUT" x.wasm -- fake > "$H/race1-$run" & p1=$!
cached e "$k2" "$OUT" x.wasm -- fake > "$H/race2-$run" & p2=$!
wait $p1; wait $p2
check "$(wc -l < "$builds")" 3 "two builds at once: built once"
check "$(cat "$H/race1-$run" "$H/race2-$run" | grep -c '(cached')" 1 "two builds at once: the other a hit"
check "$(find "$CACHE" -name '*.partial' | wc -l)" 0 "no partial entry left, none nested"
# (the script's keys taken before either build: a build writes inside the paths a later key reads)
keys=$(grep -n '^HOST_KEY=$(inputs_key' "$SCRIPT" | cut -d: -f1)
first=$(grep -n '^cached engine' "$SCRIPT" | cut -d: -f1)
check "$([ -n "$keys" ] && [ -n "$first" ] && [ "$keys" -lt "$first" ] && echo before)" before "the keys taken before the first build"
echo "passed $pass, failed $fail"
[ $fail = 0 ]
