#!/bin/bash
# Is the game answering? Sends physlog_ping over rcon and waits for the reply in BakkesMod's log. On no reply (a
# modal dialog, a loading screen, a minimized window...), saves a screenshot of the game window (read-only) to
# out/live/screens/ and exits 1; with --freeplay, also exits 2 (and screenshots) unless the game is in offline
# freeplay. Prints the game's state either way.   tools/physlog/check_game.sh [--freeplay] [TIMEOUT_S]
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
need_freeplay=0
[ "${1:-}" = "--freeplay" ] && { need_freeplay=1; shift; }
timeout="${1:-5}"
appdata="$(cd /mnt/c && cmd.exe /d /c 'echo %APPDATA%' 2>/dev/null | tr -d '\r')"
log="$(wslpath "$appdata")/bakkesmod/bakkesmod/bakkesmod.log"
screenshot() {
	local wintemp shot state
	wintemp="$(wslpath "$(cd /mnt/c && cmd.exe /d /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")"
	mkdir -p "$wintemp/physlog" "$repo/out/live/screens"
	cp "$here/game_window.ps1" "$wintemp/physlog/"
	shot="$repo/out/live/screens/$(date +%Y%m%d_%H%M%S).png"
	state="$(cd /mnt/c && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$wintemp/physlog/game_window.ps1")" \
		"$(wslpath -w "$wintemp/physlog/shot.png")" 2>&1 | tr -d '\r')"
	[ -f "$wintemp/physlog/shot.png" ] && mv "$wintemp/physlog/shot.png" "$shot"
	echo "$state"
	[ -f "$shot" ] && echo "screenshot: $shot"
}
token="$(date +%s%N)"
python3 "$here/rcon.py" "physlog_ping $token" > /dev/null 2>&1
for _ in $(seq 1 $((timeout * 4))); do
	reply="$(grep -a "physlog: pong $token" "$log" | tail -1)"
	if [ -n "$reply" ]; then
		state="${reply#*pong $token }"
		echo "game answering: $state"
		if [ $need_freeplay = 1 ] && ! grep -q 'freeplay 1 online 0' <<<"$state"; then
			echo "the game is not in offline freeplay"
			screenshot
			exit 2
		fi
		exit 0
	fi
	sleep 0.25
done
echo "game NOT answering within ${timeout}s (a dialog, loading screen or minimized window?)"
screenshot
exit 1
