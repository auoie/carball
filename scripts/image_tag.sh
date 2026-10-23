#!/usr/bin/env bash
# The images' tag for a commit (HEAD by default): its own date in UTC and the first 7 characters of its hash,
# YYYYMMDD-HHMM-hash (e.g. 20261023-1412-619e7e8). The same commit always gets the same tag: its committer date (what
# the commit itself carries, not the time of the build) and a hash prefix of a fixed length (git's --short grows as the
# repo does: RV-859; with the date and minute in front, 7 is plenty). Tags sort by that date, so a later commit's
# usually sorts after: two in the same minute sort by hash, and a rebase, an amend or another machine's clock moves a
# commit's date (RV-860). A valid Docker tag.
#   scripts/image_tag.sh [COMMIT]
set -euo pipefail
R=$(cd "$(dirname "$0")/.." && pwd -P)
commit=$(git -C "$R" rev-parse --verify --quiet "${1:-HEAD}^{commit}") || {
	echo "image_tag.sh: no such commit: ${1:-HEAD}" >&2
	exit 1
}
when=$(TZ=UTC0 git -C "$R" show -s --format=%cd --date=format-local:%Y%m%d-%H%M "$commit")
echo "$when-$(printf '%s' "$commit" | cut -c1-7)"
