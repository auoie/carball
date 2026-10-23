#!/usr/bin/env bash
# The images' tag for a commit (HEAD by default): its own date in UTC and its short hash, YYYYMMDD-HHMM-shorthash (e.g.
# 20261023-1412-619e7e8). The same commit always gets the same tag (its committer date: what the commit itself carries,
# not the time of the build), a later commit's sorts after an earlier one's, and it's a valid Docker tag.
#   scripts/image_tag.sh [COMMIT]
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd -P)
commit=$(git -C "$R" rev-parse --verify --quiet "${1:-HEAD}^{commit}") || {
	echo "image_tag.sh: no such commit: ${1:-HEAD}" >&2
	exit 1
}
when=$(TZ=UTC0 git -C "$R" show -s --format=%cd --date=format-local:%Y%m%d-%H%M "$commit")
echo "$when-$(git -C "$R" rev-parse --short "$commit")"
