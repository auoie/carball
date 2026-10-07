@echo off
rem Builds PhysLog.dll. Run in "x64 Native Tools Command Prompt for VS 2022" from this folder.
rem Uses the SDK that BakkesMod installs; set BMSDK to use another copy.
if "%BMSDK%"=="" set BMSDK=%APPDATA%\bakkesmod\bakkesmod\bakkesmodsdk
if not exist "%BMSDK%\include\bakkesmod\plugin\bakkesmodplugin.h" (
  echo BakkesMod SDK not found at %BMSDK% - install BakkesMod first, or set BMSDK
  exit /b 1
)
cl /nologo /LD /EHsc /std:c++20 /O2 /MD /W3 /I "%BMSDK%\include" PhysLog.cpp /link "%BMSDK%\lib\pluginsdk.lib" /OUT:PhysLog.dll || exit /b 1
copy /Y PhysLog.dll "%APPDATA%\bakkesmod\bakkesmod\plugins\" >nul
if not exist "%APPDATA%\bakkesmod\bakkesmod\data\physlog\scenarios" mkdir "%APPDATA%\bakkesmod\bakkesmod\data\physlog\scenarios"
copy /Y scenarios\*.txt "%APPDATA%\bakkesmod\bakkesmod\data\physlog\scenarios\" >nul
echo Built and installed PhysLog.dll and the scenarios. In freeplay, open the BakkesMod console (F6): plugin load physlog
