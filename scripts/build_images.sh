#!/usr/bin/env bash
# Builds the two images of APP-CONTRACT.md from the commit (HEAD), never the working tree (RV-370): `git archive` stages
# the sources under out/images/<TAG>-<time>/src, so nothing uncommitted or git-ignored (local-only data, a stray file
# next to the meshes) gets in. There the engine's WebAssembly is built, then the client's production build and its
# shipped-data check on what it built, then the server's release binary (no debug info, no build machine's paths:
# RV-380); each image is built from a staging directory holding only what it ships. Needs docker (or podman as
# `docker`), Emscripten (/usr/lib/emscripten, or EMSCRIPTEN_ROOT), cargo (offline: its registry cached) and the client's
# installed packages (client/node_modules).
#   scripts/build_images.sh [TAG]              (default: the commit's short hash)
#   scripts/build_images.sh --worktree TAG     (testing a change before its commit: the working tree's files that are
#                                               committed or would be, never git-ignored ones)
# Then export or push, e.g.:
#   docker save carball-web:TAG | gzip > carball-web-TAG.tar.gz      (docker load < carball-web-TAG.tar.gz on the host)
#   docker tag carball-web:TAG REGISTRY/carball-web:TAG && docker push REGISTRY/carball-web:TAG    (the same for carball-game)
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd)
COMMIT=$(git -C "$R" rev-parse --short HEAD)
WORKTREE=0
if [ "${1:-}" = "--worktree" ]; then
	WORKTREE=1
	shift
	[ -n "${1:-}" ] || { echo "--worktree needs a TAG (not the commit's: it isn't what's built)"; exit 1; }
fi
TAG=${1:-$COMMIT}
PATHS=(client engine server protocol scripts out/arena/collision_meshes) # (the client imports scripts/cage_topology.json)
STAGE="$R/out/images/$TAG-$(date +%Y%m%d%H%M%S)"
SRC="$STAGE/src"
mkdir -p "$SRC" "$STAGE/web" "$STAGE/game"

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

echo "== the engine's WebAssembly (the client bundles it)"
EM=${EMSCRIPTEN_ROOT:-/usr/lib/emscripten}
PATH="$EM:$PATH" emcmake cmake -S "$SRC/engine" -B "$SRC/engine/build-wasm" -DCMAKE_BUILD_TYPE=Release > /dev/null
PATH="$EM:$PATH" emmake make -C "$SRC/engine/build-wasm" -j8 rlengine rlengine_web

echo "== the client's production build, the shipped-data check on it"
ln -s "$R/client/node_modules" "$SRC/client/node_modules" # (the installed packages, not sources)
(cd "$SRC/client" && npm run build && npx vitest run src/render/shippedData.test.ts)
cp -a "$SRC/client/dist" "$STAGE/web/dist"
cp "$SRC/client/docker/Dockerfile" "$SRC/client/docker/nginx.conf" "$SRC/client/docker/security-headers.conf" "$SRC/client/docker/40-carball-config.sh" "$STAGE/web/"

echo "== the server's release binary"
# (its own target directory, whatever CARGO_TARGET_DIR says: a development server's binary stays; no debug info, and the
# staged sources', the registry's and the home directory's paths remapped, Rust's and the engine's C++ alike)
TARGET="$R/out/images/target"
CARGO_HOME_DIR=${CARGO_HOME:-$HOME/.cargo}
CARGO_TARGET_DIR="$TARGET" CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=symbols \
	RUSTFLAGS="--remap-path-prefix=$SRC=/src --remap-path-prefix=$CARGO_HOME_DIR=/cargo --remap-path-prefix=$HOME=/home" \
	CFLAGS="-ffile-prefix-map=$SRC=/src" CXXFLAGS="-ffile-prefix-map=$SRC=/src" \
	cargo build --release --offline --manifest-path "$SRC/server/Cargo.toml"
cp "$TARGET/release/rl-server" "$STAGE/game/"
cp -a "$SRC/out/arena/collision_meshes" "$STAGE/game/collision_meshes" # (the committed meshes only)
cp "$SRC/server/docker/Dockerfile" "$STAGE/game/"
paths=$(strings "$STAGE/game/rl-server" | grep -cE "$HOME|$R|/mnt/" || true)
echo "build machine paths in the binary: $paths"

echo "== the images"
docker build -t "carball-web:$TAG" "$STAGE/web"
docker build -t "carball-game:$TAG" "$STAGE/game"
echo "built carball-web:$TAG and carball-game:$TAG from $SOURCE (staged in $STAGE)"
