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
git push
