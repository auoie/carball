#!/bin/bash
# Builds stock Bullet (out/bsim/bullet-<ver>/src) with Windows' MSVC from WSL into one DLL + PDB per flag variant,
# keeping every function (/OPT:NOREF /OPT:NOICF) so Ghidra/BSim sees all of them with names.
#   scripts/build_bullet_msvc.sh VER VARIANT "CL FLAGS..."   -> out/bsim/build/<VER>-<VARIANT>/bullet.{dll,pdb}
# cmd.exe can't use a WSL path as its working directory, so the sources are copied to %TEMP%\bsim_bullet first.
set -euo pipefail
# Run Windows programs through /init when the WSLInterop binfmt entry is missing ("exec format error")
win() { if [ -e /proc/sys/fs/binfmt_misc/WSLInterop ]; then "$@"; else /init "$(command -v "$1" || echo "$1")" "${@:2}"; fi; }
here="$(cd "$(dirname "$0")/.." && pwd)"
ver="$1"; variant="$2"; flags="$3"
wintemp="$(cd /mnt/c && wslpath "$(win /mnt/c/Windows/System32/cmd.exe /d /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")"
work="$wintemp/bsim_bullet/$ver"
mkdir -p "$work"
[ -d "$work/src" ] || cp -r "$here/bullet-$ver/src" "$work/src"
mkdir -p "$work/obj-$variant"
# Sources: LinearMath, BulletCollision, BulletDynamics, BulletSoftBody (relative Windows paths)
(cd "$work" && find src/LinearMath src/BulletCollision src/BulletDynamics src/BulletSoftBody -name '*.cpp' | sort | tr / '\\') > "$work/sources.rsp"
vswhere="/mnt/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
vs="$(cd /mnt/c && win "$vswhere" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
	-property installationPath | tr -d '\r')"
cat > "$work/build-$variant.bat" <<BAT
@echo off
call "$vs\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
cl /nologo /c /MP16 /Zi /DNDEBUG /DWIN32 /D_WINDOWS /D_CRT_SECURE_NO_WARNINGS $flags /I src /Foobj-$variant\\ /Fdobj-$variant\\vc.pdb @sources.rsp > obj-$variant\\cl.log 2>&1 || (type obj-$variant\\cl.log & exit /b 1)
link /nologo /DLL /DEBUG:FULL /OPT:NOREF /OPT:NOICF /INCREMENTAL:NO /OUT:obj-$variant\\bullet.dll /PDB:obj-$variant\\bullet.pdb obj-$variant\\*.obj > obj-$variant\\link.log 2>&1 || (type obj-$variant\\link.log & exit /b 1)
cl 2>&1 | findstr Version
BAT
(cd /mnt/c && win /mnt/c/Windows/System32/cmd.exe /d /c "$(wslpath -w "$work/build-$variant.bat")") | tr -d '\r'
out="$here/build/$ver-$variant"
mkdir -p "$out"
cp "$work/obj-$variant/bullet.dll" "$work/obj-$variant/bullet.pdb" "$out/"
echo "$flags" > "$out/flags.txt"
ls -la "$out"
