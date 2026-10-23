#!/usr/bin/env bash
# Builds the three images of APP-CONTRACT.md from the commit (HEAD), never the working tree (RV-370): `git archive`
# stages the sources under out/images/<TAG>-<time>/src, so nothing uncommitted or git-ignored (local-only data, a stray
# file next to the meshes) gets in. There the engine's WebAssembly is built, then the client's production build and its
# shipped-data check on what it built, then the server's release binary (no debug info, no build machine's paths:
# RV-380, no game's names: RV-423), then the accounts service's (the same checks); each image is built from a staging
# directory holding only what it ships. Needs docker (or podman as `docker`), Emscripten (/usr/lib/emscripten, or
# EMSCRIPTEN_ROOT), cargo (offline: its registry cached), Go (offline: the modules go.sum pins in its module cache) and
# the client's installed packages (client/node_modules).
#   scripts/build_images.sh [TAG]              (default: the commit's short hash)
#   scripts/build_images.sh --worktree TAG     (testing a change before its commit: the working tree's files that are
#                                               committed or would be, never git-ignored ones)
# Then export or push, e.g.:
#   docker save carball-web:TAG | gzip > carball-web-TAG.tar.gz      (docker load < carball-web-TAG.tar.gz on the host)
#   docker tag carball-web:TAG REGISTRY/carball-web:TAG && docker push REGISTRY/carball-web:TAG    (the same for carball-game
#                                                                                                    and carball-api)
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd -P)
COMMIT=$(git -C "$R" rev-parse --short HEAD)
WORKTREE=0
if [ "${1:-}" = "--worktree" ]; then
	WORKTREE=1
	shift
	[ -n "${1:-}" ] || { echo "--worktree needs a TAG (not the commit's: it isn't what's built)"; exit 1; }
	if [[ "$1" =~ ^[0-9a-f]{7,40}$ ]]; then echo "--worktree: $1 looks like a commit's hash, which this build isn't: another TAG"; exit 1; fi
fi
TAG=${1:-$COMMIT}
PATHS=(client engine server protocol scripts api out/arena/collision_meshes) # (scripts: build_host.sh, the local host's build)
STAGE="$R/out/images/$TAG-$(date +%Y%m%d%H%M%S)"
SRC="$STAGE/src"
mkdir -p "$SRC" "$STAGE/web" "$STAGE/game" "$STAGE/api"

if [ $WORKTREE = 1 ]; then
	echo "note: built from the working tree (on $COMMIT), not a commit"
	(cd "$R" && git ls-files -z --cached --others --exclude-standard --deduplicate -- "${PATHS[@]}" | tar --null --ignore-failed-read -T - -cf -) | tar -x -C "$SRC"
	SOURCE="the working tree on $COMMIT"
else
	# (what isn't committed isn't built: said, so the tag isn't taken for it)
	if [ -n "$(git -C "$R" status --porcelain -- "${PATHS[@]}")" ]; then
		echo "note: uncommitted changes under ${PATHS[*]} are not in these images (built from $COMMIT)"
	fi
	git -C "$R" archive --format=tar HEAD "${PATHS[@]}" | tar -x -C "$SRC"
	SOURCE=$COMMIT
fi

EM=${EMSCRIPTEN_ROOT:-/usr/lib/emscripten}
# The two WebAssembly builds kept by everything that makes them (out/images/cache/<commit|worktree>/<name>-<key>): the
# staged sources' files, the build's own commands (its function's text), the environment the compilers read and the
# tools' versions, hashed; so an image built with the engine unchanged (an API-only update) reuses the last outputs
# instead of starting from scratch, the sources still staged clean. A commit's build never takes a working tree's entry;
# an entry's files are checked against the hashes kept with them before they're used (a mismatch: put aside, built
# again), and their hashes are printed, so an image's WebAssembly can be matched; one build at a time takes or fills the
# cache (RV-794..797)
CACHE="$R/out/images/cache/$([ $WORKTREE = 1 ] && echo worktree || echo commit)"
mkdir -p "$CACHE"

build_engine() {
	PATH="$EM:$PATH" emcmake cmake -S "$SRC/engine" -B "$SRC/engine/build-wasm" -DCMAKE_BUILD_TYPE=Release > /dev/null
	PATH="$EM:$PATH" emmake make -C "$SRC/engine/build-wasm" -j8 rlengine rlengine_web
}
# (its own target directory; the build machine's paths remapped by the script itself: the module ships)
build_local_host() {
	PATH="$EM:$PATH" CARGO_TARGET_DIR="$R/out/images/target-host" CARBALL_ENGINE_WASM="$SRC/engine/build-wasm-host" bash "$SRC/scripts/build_host.sh"
}
# The environment the compilers and cargo read (every CARGO_ variable: CARGO_INCREMENTAL, CARGO_HOME, a profile's)
build_env() {
	env | grep -E '^(EMCC_|EM_|CFLAGS=|CXXFLAGS=|CPPFLAGS=|LDFLAGS=|RUSTFLAGS=|RUSTDOCFLAGS=|CARGO_|RUSTC|RUSTUP_TOOLCHAIN=|CC=|CXX=|AR=)' | LC_ALL=C sort || true
}
# cargo's config files it would read, named and in full: in the directory the build runs in and each one above it, and
# in CARGO_HOME (a profile there changes the host's build: RV-815)
cargo_config() {
	local d f
	d=$(pwd -P) # (the physical directory, as cargo reads it: a symlinked one's config above isn't missed, RV-824)
	while :; do
		for f in "$d/.cargo/config" "$d/.cargo/config.toml"; do
			if [ -f "$f" ]; then echo "$f"; cat "$f"; fi
		done
		[ "$d" = / ] && break
		d=$(dirname "$d")
	done
	for f in "${CARGO_HOME:-$HOME/.cargo}/config" "${CARGO_HOME:-$HOME/.cargo}/config.toml"; do
		if [ -f "$f" ]; then echo "$f"; cat "$f"; fi
	done
}
# The tools: Emscripten's and its clang's versions, Binaryen's, CMake's, Rust's and Node's
toolchain() {
	PATH="$EM:$PATH" emcc -v 2>&1 | head -2
	PATH="$EM:$PATH" wasm-opt --version 2>&1 || true
	cmake --version | head -1
	rustc -vV
	node --version
}
# inputs_key FUNCTION PATH...: the staged files under each path, the build function's text, the environment, cargo's
# config, the tools
inputs_key() {
	local build=$1
	shift
	{
		for path in "$@"; do (cd "$SRC" && find "$path" -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum); done
		declare -f "$build"
		build_env
		cargo_config
		toolchain
	} | sha256sum | cut -c1-24
}
# cached NAME KEY DIR FILE... -- COMMAND...: DIR's FILEs from the cache when it holds KEY's and they match their hashes,
# else the command run and its FILEs kept with their hashes (put in place whole, so a stopped build leaves no half
# entry); the files' hashes printed either way
cached() {
	local name=$1 key=$2 dir=$3
	shift 3
	local files=()
	while [ "$1" != "--" ]; do files+=("$1"); shift; done
	shift
	local entry="$CACHE/$name-$key"
	(
		flock 9
		if [ -d "$entry" ]; then
			if (cd "$entry" && sha256sum --quiet --strict -c SHA256SUMS); then
				echo "(cached: $name's inputs unchanged, $key)"
				mkdir -p "$dir"
				for f in "${files[@]}"; do cp -a "$entry/$f" "$dir/"; done
				cat "$entry/SHA256SUMS"
				exit 0
			fi
			echo "(the cached $name's files don't match their hashes: put aside, built again)"
			mv -T "$entry" "$entry.mismatch-$(date +%Y%m%d%H%M%S)"
		fi
		"$@"
		mkdir -p "$entry.partial"
		for f in "${files[@]}"; do cp -a "$dir/$f" "$entry.partial/"; done
		(cd "$entry.partial" && sha256sum "${files[@]}" > SHA256SUMS)
		mv -T "$entry.partial" "$entry"
		cat "$entry/SHA256SUMS"
	) 9> "$CACHE/.lock"
}

# (both keys before either build: the engine's build writes inside engine/, which the host's key reads)
ENGINE_KEY=$(inputs_key build_engine engine)
HOST_KEY=$(inputs_key build_local_host engine server scripts/build_host.sh)

echo "== the engine's WebAssembly (the client bundles it)"
cached engine "$ENGINE_KEY" "$SRC/engine/build-wasm" carball_engine.mjs carball_engine.wasm carball_engine.d.mts \
	carball_engine_web.mjs carball_engine_web.wasm carball_engine_web.d.mts -- build_engine

echo "== the local host's WebAssembly (the client bundles it: the offline match against bots, scripts/build_host.sh)"
cached host "$HOST_KEY" "$SRC/engine/build-wasm-host" carball_host.mjs carball_host.wasm -- build_local_host

echo "== the client's production build, the shipped-data check on it"
# (the installed packages, each linked: not node_modules itself, whose .cache holds the build's chunk record, the
# guard's: the working tree's must stay its own build's)
mkdir "$SRC/client/node_modules"
for entry in "$R/client/node_modules"/* "$R/client/node_modules/.bin"; do ln -s "$entry" "$SRC/client/node_modules/"; done
(cd "$SRC/client" && npm run build && node_modules/.bin/vitest run src/render/shippedData.test.ts src/render/shippedNames.test.ts)
cp -a "$SRC/client/dist" "$STAGE/web/dist"
cp "$SRC/client/docker/Dockerfile" "$SRC/client/docker/nginx.conf" "$SRC/client/docker/security-headers.conf" "$SRC/client/docker/40-carball-config.sh" "$STAGE/web/"

echo "== the server's release binary"
# (its own target directory, whatever CARGO_TARGET_DIR says: a development server's binary stays; no debug info, and the
# staged sources', the registry's and the home directory's paths remapped, Rust's and the engine's C++ alike)
TARGET="$R/out/images/target"
CARGO_HOME_DIR=${CARGO_HOME:-$HOME/.cargo}
CARGO_TARGET_DIR="$TARGET" CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=symbols \
	RUSTFLAGS="--remap-path-prefix=$HOME=/home --remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$SRC=/src" \
	CFLAGS="-ffile-prefix-map=$SRC=/src" CXXFLAGS="-ffile-prefix-map=$SRC=/src" \
	cargo build --release --offline --manifest-path "$SRC/server/Cargo.toml"
cp "$TARGET/release/carball-server" "$STAGE/game/"
cp -a "$SRC/out/arena/collision_meshes" "$STAGE/game/collision_meshes" # (the committed meshes only)
cp "$SRC/server/docker/Dockerfile" "$STAGE/game/"
# (grep -a on the binary itself: without binutils' strings this still counts, RV-414)
paths=$(grep -a -c -E "$HOME|$R|/mnt/" "$STAGE/game/carball-server" || true)
echo "build machine paths in the binary: $paths"
[ "$paths" = 0 ] || { echo "the binary names the build machine's paths: not built"; exit 1; }
# (the game image's files through the names guard too: its binary, meshes and Dockerfile, RV-423)
(cd "$SRC/client" && SHIPPED_GAME_DIR="$STAGE/game" node_modules/.bin/vitest run src/render/shippedNames.test.ts)

echo "== the accounts service's release binary"
# (static, no cgo: the image has no C library to match; the build machine's paths trimmed, no build id; offline, the
# modules from the cache as go.sum pins them; the installed Go, never a downloaded toolchain)
(cd "$SRC/api" && CGO_ENABLED=0 GOFLAGS=-mod=readonly GOPROXY=off GOWORK=off GOTOOLCHAIN=local \
	go build -trimpath -ldflags="-s -w -buildid=" -o "$STAGE/api/carball-api" ./cmd/carball-api)
cp "$SRC/api/docker/Dockerfile" "$STAGE/api/"
paths=$(grep -a -c -E "$HOME|$R|/mnt/" "$STAGE/api/carball-api" || true)
echo "build machine paths in the accounts binary: $paths"
[ "$paths" = 0 ] || { echo "the accounts binary names the build machine's paths: not built"; exit 1; }
(cd "$SRC/client" && SHIPPED_API_DIR="$STAGE/api" node_modules/.bin/vitest run src/render/shippedNames.test.ts)

echo "== the images"
# (what each image was built from: the commit, or the working tree on it, RV-398)
KIND=$([ $WORKTREE = 1 ] && echo worktree || echo commit)
LABELS=(--label "org.opencontainers.image.revision=$COMMIT" --label "carball.source=$KIND" --label "org.opencontainers.image.version=$TAG")
docker build "${LABELS[@]}" -t "carball-web:$TAG" "$STAGE/web"
docker build "${LABELS[@]}" -t "carball-game:$TAG" "$STAGE/game"
docker build "${LABELS[@]}" -t "carball-api:$TAG" "$STAGE/api"
echo "built carball-web:$TAG, carball-game:$TAG and carball-api:$TAG from $SOURCE (staged in $STAGE)"
