#!/usr/bin/env bash
# scripts/image_tag.sh's tag: YYYYMMDD-HHMM-shorthash from the commit's committer date in UTC, the same every time, a valid
# Docker tag; another commit by its name; an unknown one refused.
#   scripts/image_tag_test.sh
set -euo pipefail
T="$(cd "$(dirname "$0")" && pwd -P)/image_tag.sh"
R=$(cd "$(dirname "$0")/.." && pwd -P)
pass=0 fail=0
check() { if [ "$1" = "$2" ]; then pass=$((pass + 1)); echo "PASS $3"; else fail=$((fail + 1)); echo "FAIL $3 (got $1, want $2)"; fi; }
for commit in HEAD HEAD~1; do
	tag=$("$T" "$commit")
	# (the date from the commit's Unix time, converted apart from git's own formatting)
	want="$(date -u -d "@$(git -C "$R" show -s --format=%ct "$commit")" +%Y%m%d-%H%M)-$(git -C "$R" rev-parse --short "$commit")"
	check "$tag" "$want" "$commit: its UTC date and short hash"
	check "$("$T" "$commit")" "$tag" "$commit: the same tag again"
	check "$([[ $tag =~ ^[0-9]{8}-[0-9]{4}-[0-9a-f]{7,}$ && $tag =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] && echo ok)" ok "$commit: the format, a valid Docker tag"
done
check "$("$T")" "$("$T" HEAD)" "HEAD by default"
check "$("$T" no-such-commit 2> /dev/null && echo taken || echo refused)" refused "an unknown commit refused"
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
