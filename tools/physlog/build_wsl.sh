#!/bin/bash
# From WSL: builds PhysLog.dll with Windows' MSVC (Visual Studio 2022 or its Build Tools) and installs it and the
# scenarios into BakkesMod (build.bat does the installing). cmd.exe can't use a WSL path as its working directory, so
# the sources are copied to %TEMP%\physlog first. Every Windows program runs from a Windows path (/mnt/c): started
# from the shared Linux drive, it fails with "Invalid argument". Runs from any directory.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
win() { (cd /mnt/c && "$@"); }

wintemp_win="$(win cmd.exe /d /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
[ -n "$wintemp_win" ] || { echo "cannot read %TEMP% from cmd.exe (Windows interop)"; exit 1; }
wintemp="$(wslpath "$wintemp_win")"
[ -d "$wintemp" ] || { echo "%TEMP% ($wintemp_win -> $wintemp) is not a directory"; exit 1; }
work="$wintemp/physlog"
mkdir -p "$work/scenarios"
cp "$here/PhysLog.cpp" "$here/build.bat" "$work/"
cp "$here"/scenarios/*.txt "$work/scenarios/"

vswhere="/mnt/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
[ -x "$vswhere" ] || { echo "vswhere.exe not found: install Visual Studio 2022 Build Tools (C++)"; exit 1; }
vs="$(win "$vswhere" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 \
	-property installationPath | tr -d '\r')"
[ -n "$vs" ] || { echo "no Visual Studio with the C++ tools found"; exit 1; }

# A small batch file avoids nested quoting through cmd.exe
cat > "$work/wsl_build.bat" <<EOF
@echo off
call "$vs\\VC\\Auxiliary\\Build\\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
call build.bat
EOF
win cmd.exe /d /c "$(wslpath -w "$work/wsl_build.bat")"
