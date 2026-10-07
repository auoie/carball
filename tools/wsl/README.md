# Working from Windows (WSL) with the game running

Claude Code runs inside WSL on Windows, on the same files as under Arch (the Arch disk mounted with identical
paths), while Rocket League runs on Windows with BakkesMod. Claude then builds and loads the PhysLog plugin, runs
scenarios through BakkesMod's rcon and reads the recordings, with no one in between. Offline modes only, the game
started without EAC; nothing touches EAC.

## Once
1. **In Arch:** commit and push, then shut down fully (`systemctl poweroff`; not suspend or hibernate: the disk gets
   mounted read-write from WSL).
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
6. **This folder on Windows:** download `tools/wsl/` from the GitHub repository (the Arch disk can't be read before
   step 7 mounts it), e.g. to `C:\rl-wsl\`.
7. **First session:** do "Every session" below, then in the WSL shell as root install what Claude Code needs:
   `pacman -Syu --needed sudo base-devel git cmake clang python nodejs npm lvm2 rust emscripten`, give the user a
   password (`passwd arch`), allow `wheel` in sudoers (`EDITOR=nano visudo`, uncomment `%wheel ALL=(ALL:ALL) ALL`),
   and install Claude Code: `npm install -g @anthropic-ai/claude-code`. Your Claude Code login, settings and this
   project's memory are in `~/.claude` and come along with the mounted home.

## Every session
1. Boot Windows, start Rocket League (without EAC) with BakkesMod, go to freeplay.
2. Admin PowerShell: `powershell -ExecutionPolicy Bypass -File C:\rl-wsl\attach.ps1` (attaches the Arch NVMe and
   the data drives to WSL and mounts them at `/home/arch`, `/mnt/primary`, `/mnt/other`).
3. Open the Arch WSL shell: `su - arch`, `export BAKKES_RCON_PASSWORD=<the password>`,
   `cd ~/Documents/rocket-league-reverse-engineering`, `claude`.

## What Claude does from there
- `tools/physlog/build_wsl.sh`: builds `PhysLog.dll` with MSVC and installs it and the scenarios into BakkesMod.
- `python3 tools/physlog/rcon.py "plugin load physlog" "physlog_run steer"`: drives the game.
- Reads the recordings from `/mnt/c/Users/<you>/AppData/Roaming/bakkesmod/bakkesmod/data/physlog/` into `out/live/`
  and runs `engine/build/live_validate`.

Before going back to Arch: close Rocket League, exit WSL, `wsl --shutdown` (unmounts the disks cleanly), then reboot.
