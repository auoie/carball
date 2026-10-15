#!/usr/bin/env bash
# Builds the two images of APP-CONTRACT.md: the artifacts here (the client's production build with its shipped-data
# check, the server's release binary), then each image from a fresh staging directory under out/images/ that holds only
# what it ships (the repo's out/ has local-only data: never a build context). Needs docker (or podman as `docker`).
#   scripts/build_images.sh [TAG]          (default: the commit's short hash)
# Then export or push, e.g.:
#   docker save carball-web:TAG | gzip > carball-web-TAG.tar.gz      (docker load < carball-web-TAG.tar.gz on the host)
#   docker tag carball-web:TAG REGISTRY/carball-web:TAG && docker push REGISTRY/carball-web:TAG    (the same for carball-game)
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd)
TAG=${1:-$(git -C "$R" rev-parse --short HEAD)}
STAGE="$R/out/images/$TAG-$(date +%Y%m%d%H%M%S)"
mkdir -p "$STAGE/web" "$STAGE/game"

echo "== the client's production build"
(cd "$R/client" && npm run build && npx vitest run src/render/shippedData.test.ts)
cp -a "$R/client/dist" "$STAGE/web/dist"
cp "$R/client/docker/Dockerfile" "$R/client/docker/nginx.conf" "$R/client/docker/40-carball-config.sh" "$STAGE/web/"

echo "== the server's release binary"
cargo build --release --manifest-path "$R/server/Cargo.toml"
cp "$R/server/target/release/rl-server" "$STAGE/game/"
cp -a "$R/out/arena/collision_meshes" "$STAGE/game/collision_meshes"
cp "$R/server/docker/Dockerfile" "$STAGE/game/"

echo "== the images"
docker build -t "carball-web:$TAG" "$STAGE/web"
docker build -t "carball-game:$TAG" "$STAGE/game"
echo "built carball-web:$TAG and carball-game:$TAG (staged in $STAGE)"
