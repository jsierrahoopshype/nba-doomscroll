@echo off
REM Build, commit, push. One line instead of five.
REM
REM   tools\win\ship.cmd "what changed"
REM
REM Stops before committing if either builder fails, so a broken build never
REM reaches the site.
setlocal
cd /d "%~dp0..\.."
if "%~1"=="" (
  echo   usage: tools\win\ship.cmd "commit message"
  exit /b 1
)
call "tools\win\build.cmd"
if errorlevel 1 (
  echo   Build failed - nothing committed.
  exit /b 1
)
git add -A
git commit -m %1
if errorlevel 1 (
  echo   Nothing to commit.
  exit /b 1
)

REM A weekly job refreshes the VS / Quiz / Trivia / Ballot pools straight onto
REM main, so a ship that lands near it is rejected as non-fast-forward. Rebasing
REM first replays this one local commit on top; it rewrites nothing that has
REM been pushed. If it conflicts the rebase stops and nothing is pushed, which
REM is the behaviour worth having.
echo.
echo === rebasing onto origin/main ===
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo   Rebase stopped, probably a conflict. Nothing has been pushed.
  echo   Run "git rebase --abort" to undo it and ask before continuing.
  exit /b 1
)

git push
