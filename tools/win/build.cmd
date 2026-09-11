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
echo === ballot oddities ===
node tools\build_oddities.mjs --local "%MVT_DATA%"
if errorlevel 1 exit /b 1

REM ALWAYS RUN, because "skipped" is a lie the day the cards are wrong.
REM
REM This used to be gated on CAP_CSV being set in paths.cmd, from when the
REM builder needed both paths typed at it. It finds them itself now. The gate
REM outlived the reason for it and became a trap: a rebuild that silently left
REM the salary cards alone, printing a line nobody reads, on the same day those
REM cards were the ones being fixed.
REM
REM Still not allowed to fail the build. If the sources are not on this machine
REM it says so and the existing cards stay as they are, which is what the gate
REM was protecting - just without pretending nothing was meant to happen.
REM THIS WAS MISSING, AND THE SYMPTOM WAS SILENCE.
REM
REM data\award-history-pool.json was never in this file, so it was never built
REM here, never picked up by ship.cmd's `git add -A`, and never committed. It
REM sat untracked in the working copy while js\app.js asked the live site for a
REM file that was not there. It is in OPTIONAL_POOLS, so the feed skipped it
REM without a word and the cards simply did not exist for anyone but whoever
REM had run the builder by hand.
REM
REM Fatal, like the three above it and unlike salary: it reads NPD, which this
REM script has already checked, so a failure here is a real failure.
echo.
echo === award history ===
node tools\build_award_history.mjs --local "%NPD%"
if errorlevel 1 exit /b 1

echo.
echo === salary stories ===
if defined CAP_CSV (
  node tools\build_salary.mjs --local "%NPD%" "%CAP_CSV%"
) else (
  node tools\build_salary.mjs
)
if errorlevel 1 (
  echo.
  echo   Salary cards were NOT rebuilt - the builder could not find its sources.
  echo   The existing ones are untouched and the rest of the build is fine.
  echo   Set NPD and CAP_CSV in tools\win\paths.cmd to point it at them.
  echo.
)

echo.
echo Both builds finished. The lean line should read 99 players and
echo "13 committed locally, 0 falling back to flagcdn". 92 means the wrong
echo media-vote-tracker checkout is set in paths.cmd.
