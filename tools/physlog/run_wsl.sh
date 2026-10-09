#!/bin/bash
# From WSL: plays PhysLog scenarios in the running game (offline freeplay, plugin loaded, the physlog_* commands
# allowed for rcon; README "Driving it from WSL"), copies each recording (and its _bullet.csv and _wheels.csv) into
# out/live/ and validates it.
#   tools/physlog/run_wsl.sh SCENARIO... [-- LIVE_VALIDATE_OPTIONS...]
#   RUN_ARGS=bot tools/physlog/run_wsl.sh ...   runs them on the spawned bot (physlog_spawn <body> bot)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
scenarios=()
while [ $# -gt 0 ] && [ "$1" != "--" ]; do scenarios+=("$1"); shift; done
[ $# -gt 0 ] && shift
[ ${#scenarios[@]} -gt 0 ] || { echo "usage: $0 SCENARIO... [-- LIVE_VALIDATE_OPTIONS...]"; exit 1; }

appdata="$(cd /mnt/c && cmd.exe /d /c 'echo %APPDATA%' 2>/dev/null | tr -d '\r')"
bm="$(wslpath "$appdata")/bakkesmod/bakkesmod"
log="$bm/bakkesmod.log"
mkdir -p "$bm/data/physlog/scenarios" "$repo/out/live"
cp "$here"/scenarios/*.txt "$bm/data/physlog/scenarios/"

for sc in "${scenarios[@]}"; do python3 "$here/check_scenarios.py" "$here/scenarios/$sc.txt" > /dev/null || { python3 "$here/check_scenarios.py" "$here/scenarios/$sc.txt"; exit 1; }; done
for sc in "${scenarios[@]}"; do
	# The game must be answering and in offline freeplay (a dialog or menu blocks everything: see the screenshot)
	"$here/check_game.sh" --freeplay || exit 1
	start=$(wc -l < "$log")
	python3 "$here/rcon.py" "physlog_run $sc ${RUN_ARGS:-}" > /dev/null
	new=""
	for _ in $(seq 1 240); do # the plugin logs "scenario done" when the script ends (2 minutes at most)
		new="$(tail -n +$((start + 1)) "$log")"
		grep -q 'physlog: scenario done' <<<"$new" && break
		if grep -q -E 'not allowed|physlog: (no scenario|offline|cannot)|left offline|too few|unknown command' <<<"$new"; then
			echo "$new" | grep -E 'physlog|RCON'
			exit 1
		fi
		sleep 0.5
	done
	grep -q 'physlog: scenario done' <<<"$new" || { echo "$sc: no 'scenario done' in the log"; "$here/check_game.sh" --freeplay; exit 1; }
	win="$(grep -o 'recording to .*\.csv' <<<"$new" | tail -1 | sed 's/^recording to //')"
	csv="$repo/out/live/$(basename "$(wslpath "$win")")"
	cp "$(wslpath "$win")" "$csv"
	side="$(wslpath "$win" | sed 's/\.csv$/_bullet.csv/')"
	[ -f "$side" ] && cp "$side" "${csv%.csv}_bullet.csv"
	wheels="$(wslpath "$win" | sed 's/\.csv$/_wheels.csv/')"
	[ -f "$wheels" ] && cp "$wheels" "${csv%.csv}_wheels.csv"
	echo "== $sc: $(grep -o 'scenario done, [0-9]* ticks' <<<"$new"), $csv"
	"$repo/engine/build/live_validate" "$csv" "$@"
done
