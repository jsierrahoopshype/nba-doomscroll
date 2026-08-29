@echo off
REM Rebuild the two pools that come from repos outside this one.
REM
REM   tools\win\build.cmd
REM
REM Reads its paths from tools\win\paths.cmd so nobody has to remember or retype
REM them, and refuses to run rather than build from the wrong checkout.
setlocal
cd /d "%~dp0..\.."

if not exist "tools\win\paths.cmd" (
  echo.
  echo   Missing tools\win\paths.cmd
  echo   Copy tools\win\paths.example.cmd to tools\win\paths.cmd and set the two paths.
  echo.
  exit /b 1
)
call "tools\win\paths.cmd"

if not exist "%NPD%\awards.json" (
  echo   NPD looks wrong: no awards.json under "%NPD%"
  exit /b 1
)
if not exist "%MVT_DATA%\player" (
  echo   MVT_DATA looks wrong: no player folder under "%MVT_DATA%"
  exit /b 1
)

echo.
echo === comparison cards ===
node tools\build_compare.mjs --local "%NPD%"
if errorlevel 1 exit /b 1

echo.
echo === media lean cards ===
node tools\build_lean.mjs --local "%MVT_DATA%"
if errorlevel 1 exit /b 1

echo.
echo Both builds finished. The lean line should read 99 players and
echo "13 committed locally, 0 falling back to flagcdn". 92 means the wrong
echo media-vote-tracker checkout is set in paths.cmd.
