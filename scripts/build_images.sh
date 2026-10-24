#!/usr/bin/env bash
# Builds the three images of APP-CONTRACT.md from the commit (HEAD), never the working tree (RV-370): `git archive`'s
# files are the build's context, so nothing uncommitted or git-ignored (local-only data, a stray file next to the
# meshes) gets in. Everything compiles in the Dockerfile's stages, from toolchain images pinned by digest, with BuildKit's
# own caching (a stage runs again only when its inputs change: a server-only release builds no C++). First the checks
# (`--target checks`: the shipped-data and names guards on what was built, no build paths in either binary), then each
# image. Needs docker with buildx (BuildKit) and git; the first build downloads the toolchain images' crates, npm
# packages and Go modules, later ones what changed.
#   scripts/build_images.sh [TAG]              (default: scripts/image_tag.sh's, the commit's UTC date and its hash's
#                                               first 7 characters, YYYYMMDD-HHMM-hash: the same commit, the same tag)
#   scripts/build_images.sh --worktree TAG     (testing a change before its commit: the working tree's files that are
#                                               committed or would be, never git-ignored ones)
#   scripts/build_images.sh [--worktree] --e2e TAG   (the browser tests' two images as well, carball-game-e2e:TAG and
#                                               carball-api-e2e:TAG: the e2e builds, never pushed or deployed;
#                                               client/e2e/services)
# Then export or push, e.g.:
#   docker save carball-web:TAG | gzip > carball-web-TAG.tar.gz      (docker load < carball-web-TAG.tar.gz on the host)
#   docker tag carball-web:TAG REGISTRY/carball-web:TAG && docker push REGISTRY/carball-web:TAG    (the same for carball-game
#                                                                                                    and carball-api)
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd -P)
COMMIT=$(git -C "$R" rev-parse --short HEAD)
WORKTREE=0
E2E=0
while [ "${1:-}" = "--worktree" ] || [ "${1:-}" = "--e2e" ]; do
	[ "$1" = "--worktree" ] && WORKTREE=1
	[ "$1" = "--e2e" ] && E2E=1
	shift
done
if [ $WORKTREE = 1 ]; then
	[ -n "${1:-}" ] || { echo "--worktree needs a TAG (not the commit's: it isn't what's built)"; exit 1; }
	# (nor a commit's dated tag, scripts/image_tag.sh's: RV-861)
	if [[ "$1" =~ ^[0-9a-f]{7,40}$ || "$1" =~ ^[0-9]{8}-[0-9]{4}-[0-9a-f]{7,40}$ ]]; then
		echo "--worktree: $1 looks like a commit's tag, which this build isn't: another TAG"
		exit 1
	fi
fi
TAG=${1:-$("$R/scripts/image_tag.sh")}
PATHS=(Dockerfile client engine server protocol api scripts/build_host.sh out/arena/collision_meshes)
# (the context made once, every build below from the same files; group and others never given write: what the images
# copy keeps its mode, RV-926)
CONTEXT=$(mktemp "${TMPDIR:-/tmp}/carball-context-XXXXXX.tar")
trap '[ -n "$CONTEXT" ] && rm -f -- "$CONTEXT"' EXIT
if [ $WORKTREE = 1 ]; then
	echo "note: built from the working tree (on $COMMIT), not a commit"
	(cd "$R" && git ls-files -z --cached --others --exclude-standard --deduplicate -- "${PATHS[@]}" | tar --null --ignore-failed-read --mode=go-w -T - -cf "$CONTEXT")
	SOURCE="the working tree on $COMMIT"
else
	# (what isn't committed isn't built: said, so the tag isn't taken for it)
	if [ -n "$(git -C "$R" status --porcelain -- "${PATHS[@]}")" ]; then
		echo "note: uncommitted changes under ${PATHS[*]} are not in these images (built from $COMMIT)"
	fi
	git -C "$R" -c tar.umask=0022 archive --format=tar -o "$CONTEXT" "$COMMIT" "${PATHS[@]}"
	SOURCE=$COMMIT
fi

echo "== the checks: the client's shipped data and names, each image's names, no build paths in the binaries"
docker buildx build --target checks --output type=cacheonly - < "$CONTEXT"

echo "== the images"
# (what each image was built from: the commit, or the working tree on it, RV-398)
KIND=$([ $WORKTREE = 1 ] && echo worktree || echo commit)
LABELS=(--label "org.opencontainers.image.revision=$COMMIT" --label "carball.source=$KIND" --label "org.opencontainers.image.version=$TAG")
for image in web game api; do
	docker buildx build --target "$image" --load "${LABELS[@]}" -t "carball-$image:$TAG" - < "$CONTEXT"
done
if [ $E2E = 1 ]; then
	for image in game-e2e api-e2e; do
		docker buildx build --target "$image" --load "${LABELS[@]}" -t "carball-$image:$TAG" - < "$CONTEXT"
	done
fi
# (the WebAssembly's hashes, so an image's engine and local host can be matched)
docker run --rm --network none --entrypoint sh "carball-web:$TAG" -c 'cd /usr/share/nginx/html/assets && sha256sum carball_*.wasm'
echo "built carball-web:$TAG, carball-game:$TAG and carball-api:$TAG from $SOURCE"
[ $E2E = 0 ] || echo "and the browser tests' carball-game-e2e:$TAG and carball-api-e2e:$TAG (never pushed or deployed)"
echo "tag: $TAG"
