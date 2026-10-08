#!/bin/bash
# Regenerates engine/rocketsim-rl-patches.diff without a pristine RocketSim checkout: rebuilds upstream from HEAD's
# tree minus HEAD's diff (checked: it must reproduce HEAD's diff exactly), then diffs it against the working tree.
#   bash scripts/regen_rocketsim_diff.sh "$PWD" /tmp/somewhere new.diff && cp new.diff engine/rocketsim-rl-patches.diff
# Rebuild pristine upstream RocketSim from HEAD's tree minus HEAD's patch diff, then diff it against today's tree.
#   regen_diff.sh REPO WORKDIR OUT.diff
set -euo pipefail
R=$1; S=$2; OUT=$3
mkdir -p "$S"
cd "$R"
git show HEAD:engine/rocketsim-rl-patches.diff > "$S/old.diff"
# Files the patches added are absent upstream: leave them out of the extraction
mapfile -t NEW < <(awk '/^diff --git/{f=$4} /^new file/{sub("^engine/rocketsim/","",f); print f}' "$S/old.diff")
EXC=()
for f in "${NEW[@]}"; do EXC+=("--exclude=engine/rocketsim/$f"); done
git archive HEAD engine/rocketsim | tar -x -C "$S" "${EXC[@]}"
mv "$S/engine/rocketsim" "$S/upstream"
python3 - "$S/old.diff" "$S/old_ab.diff" <<'EOF'
import re, sys
out = []
for block in re.split(r'(?m)^(?=diff --git )', open(sys.argv[1]).read()):
    if not block or '\nnew file mode' in block.split('@@')[0]:
        continue
    block = re.sub(r'(?m)^diff --git upstream/(\S+) engine/rocketsim/\S+', r'diff --git a/\1 b/\1', block)
    block = re.sub(r'(?m)^--- upstream/', '--- a/', block)
    block = re.sub(r'(?m)^\+\+\+ engine/rocketsim/', '+++ b/', block)
    out.append(block)
open(sys.argv[2], 'w').write(''.join(out))
EOF
(cd "$S/upstream" && git apply -R -p1 --whitespace=nowarn ../old_ab.diff)
echo "upstream rebuilt (${#NEW[@]} added files left out)"
# Sanity check: HEAD's tree against the rebuilt upstream must reproduce HEAD's diff
mkdir -p "$S/head/engine"
git archive HEAD engine/rocketsim | tar -x -C "$S/head"
(cd "$S" && git diff --no-index --no-prefix upstream head/engine/rocketsim | sed 's#head/engine/rocketsim#engine/rocketsim#g' > check.diff) || true
if cmp -s "$S/check.diff" "$S/old.diff"; then echo "check: HEAD's diff reproduced exactly"; else echo "check: DIFFERS from HEAD's diff"; diff "$S/old.diff" "$S/check.diff" | head -5; fi
# Today's tree: the files git sees (tracked and untracked, ignored ones left out)
mkdir -p "$S/now"
git ls-files -co --exclude-standard -z engine/rocketsim | tar -C "$R" --null -T - -cf - | tar -x -C "$S/now"
(cd "$S" && git diff --no-index --no-prefix upstream now/engine/rocketsim | sed 's#now/engine/rocketsim#engine/rocketsim#g' > "$OUT") || true
echo "wrote $OUT: $(grep -c '^diff --git' "$OUT") files, $(grep -c 'RL PATCH' "$OUT") RL PATCH lines"
