# Working from Windows (WSL) with the game running

Claude Code runs inside WSL on Windows while Rocket League runs on Windows with BakkesMod. Claude then builds and loads
the PhysLog plugin, runs scenarios through BakkesMod's rcon and reads the recordings, with no one in between. Offline
modes only, the game started without EAC; nothing touches EAC.

**One working copy for both systems:** the repository lives on the 18 TB data drive, at
`/mnt/primary/home/arch/rocket-league-reverse-engineering`, which Arch mounts and WSL attaches. Both systems work in the
same folder (never at the same time: dual boot), so nothing needs syncing, and the git-ignored local material
(replays, decrypted packages, decompiled code) is there too. The old copy in `~/Documents` on the Arch NVMe is a
backup; don't work in it. (The Arch NVMe itself can't be attached to WSL: Windows boots through its EFI partition.)

Claude Code keeps its memory per folder path, under
`~/.claude/projects/-mnt-primary-home-arch-rocket-league-reverse-engineering/memory`. Arch has it; WSL copies it once
from the data drive (`/mnt/primary/home/arch/claude-wsl-handoff/memory`).

## Once
1. **In Arch:** shut down fully (`systemctl poweroff`; not suspend or hibernate: the data drives get mounted
   read-write from WSL).
2. **WSL with Arch** (admin PowerShell): `wsl --install --no-distribution`, reboot if asked, then
   `wsl --install archlinux`.
3. **Visual Studio Build Tools (C++)** (admin PowerShell):
   `winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`
4. **WSL networking:** create `%UserProfile%\.wslconfig` with
   ```
   [wsl2]
   networkingMode=mirrored
   ```
   so WSL reaches BakkesMod on localhost, then `wsl --shutdown`.
5. **BakkesMod:** install it, start Rocket League without EAC as BakkesMod describes, check it works in freeplay.
   In its console (F6): `rcon_enabled 1` and `rcon_password <a password of your choice>`. BakkesMod saves these.
6. **This folder on Windows:** download `tools/wsl/` from the GitHub repository, e.g. to `C:\rl-wsl\`.
7. **First session:** do "Every session" steps 1-2, then in the Arch WSL shell as root:
   ```sh
   pacman -Syu --needed sudo base-devel git cmake clang python nodejs npm lvm2 rust emscripten
   passwd arch                       # (the user was created by mount-arch.sh, uid 1000)
   EDITOR=nano visudo                # uncomment: %wheel ALL=(ALL:ALL) ALL
   npm install -g @anthropic-ai/claude-code
   ```
   then as `arch` (`su - arch`):
   ```sh
   mkdir -p ~/.claude/projects/-mnt-primary-home-arch-rocket-league-reverse-engineering
   cp -r /mnt/primary/home/arch/claude-wsl-handoff/memory ~/.claude/projects/-mnt-primary-home-arch-rocket-league-reverse-engineering/
   cp /mnt/primary/home/arch/claude-wsl-handoff/session/*.jsonl ~/.claude/projects/-mnt-primary-home-arch-rocket-league-reverse-engineering/
   cd /mnt/primary/home/arch/rocket-league-reverse-engineering && claude --resume   # log in; pick the last session
   ```
   (`--resume` continues the last Arch conversation if Claude Code accepts the copied transcript; if not, plain
   `claude` starts fresh with the memory and `notes/HANDOFF.md`, which hold what's needed.)

## Every session
1. Boot Windows, start Rocket League (without EAC) with BakkesMod, go to freeplay.
2. Admin PowerShell: `powershell -ExecutionPolicy Bypass -File C:\rl-wsl\attach.ps1` (attaches the 18 TB drives to
   WSL and mounts them at `/mnt/primary`, `/mnt/other`).
3. Open the Arch WSL shell: `su - arch`, `export BAKKES_RCON_PASSWORD=<the password>`,
   `cd /mnt/primary/home/arch/rocket-league-reverse-engineering`, `claude`.

## What Claude does from there
- Rebuilds the engine for WSL's tools if needed (`engine/build`, `engine/build-wasm`).
- `tools/physlog/build_wsl.sh`: builds `PhysLog.dll` with MSVC and installs it and the scenarios into BakkesMod.
- `python3 tools/physlog/rcon.py "plugin load physlog" "physlog_run steer"`: drives the game.
- Reads the recordings from `/mnt/c/Users/<you>/AppData/Roaming/bakkesmod/bakkesmod/data/physlog/` into `out/live/`
  and runs `engine/build/live_validate`.
- Commits wait for you as usual; you can commit in WSL and push later from Arch (same repository folder).

Before going back to Arch: close Rocket League, exit WSL, `wsl --shutdown` (unmounts the drives cleanly), then reboot.
