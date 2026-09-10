@echo off
REM ===========================================================================
REM  NBA Doomscroll — re-bake the face tiles, look at one, then offer to push.
REM
REM  WHY THIS EXISTS
REM
REM  Re-baking faces has taken six pasted commands each time: explain, dry run,
REM  write, open a PNG, add/commit, push. That is how a poisoned source folder
REM  got as far as 859 rewritten tiles — the checking steps were the ones that
REM  were easiest to skip, because they were the ones that needed another paste.
REM
REM  So: double-click this. It names ONE source folder, verifies the face that
REM  went wrong last time, shows the coverage, and stops twice for a human -
REM  once before writing, once before pushing.
REM
REM  THE SOURCE FOLDER IS HARD-CODED ON PURPOSE
REM
REM  There are thirteen folders called "headshots" on this machine and they do
REM  not agree. Two of them hold an "Allen Iverson.png" that is a photograph of
REM  Jamal Crawford. The tool used to merge all thirteen and prefer the largest
REM  file, which is exactly how Crawford ended up on Iverson's tile.
REM
REM  SRC below is the folder that produced the data/faces tiles already
REM  accepted, and it holds the correct 67,339-byte Iverson. If you ever change
REM  it, change it here, in one place, deliberately - never by letting a tool
REM  search and choose.
REM
REM  WHAT IT WILL NOT DO
REM
REM  It will not write without you saying yes, it will not push without you
REM  saying yes, and it will not skip the face check. Everything it does before
REM  the first prompt is read-only, and `git checkout -- data/races/faces
REM  data/teammates/faces` undoes everything after it.
REM ===========================================================================
setlocal EnableDelayedExpansion

set "REPO=C:\Users\Jorge Sierra\Documents\GitHub\nba-doomscroll"
set "SRC=C:\Users\Jorge Sierra\Documents\GitHub\bar-chart-race\assets\headshots"
set "CHECK=allen-iverson"

cd /d "%REPO%" || (echo Could not find the repo at %REPO% & pause & exit /b 1)

echo.
echo  repo:   %REPO%
echo  source: %SRC%
echo.

if not exist "%SRC%" (
  echo  That source folder is not there. Nothing has been changed.
  echo  Fix SRC at the top of this file, or clone the repo again.
  echo.
  pause
  exit /b 1
)

REM --- a dirty tree means someone else's work is in the way -----------------
for /f %%i in ('git status --porcelain data/races/faces data/teammates/faces ^| find /c /v ""') do set "DIRTY=%%i"
if not "%DIRTY%"=="0" (
  echo  The tile folders already have uncommitted changes:
  echo.
  git status --short data/races/faces data/teammates/faces
  echo.
  echo  Commit them, or discard them with:
  echo     git checkout -- data/races/faces data/teammates/faces
  echo.
  pause
  exit /b 1
)

REM --- 1. the face that went wrong last time --------------------------------
echo  ---------------------------------------------------------------------
echo   1. which file will "%CHECK%" come from?
echo  ---------------------------------------------------------------------
node tools\retile_faces.mjs --local "%SRC%" --explain %CHECK%
if errorlevel 1 (echo  That failed. Nothing has been changed. & pause & exit /b 1)

REM --- 2. coverage, still read-only -----------------------------------------
echo  ---------------------------------------------------------------------
echo   2. dry run - what would change
echo  ---------------------------------------------------------------------
node tools\retile_faces.mjs --local "%SRC%"
if errorlevel 1 (echo  That failed. Nothing has been changed. & pause & exit /b 1)

echo.
echo  Read the two blocks above before answering.
echo    - the size next to %CHECK% should be 67339, not 82748
echo    - every source path printed should be under the folder named above
echo    - the match rate is ONE folder's honest coverage, not thirteen pooled
echo.
set "GO="
set /p "GO=Write the tiles? [y/N] "
if /i not "%GO%"=="y" (echo  Nothing was changed. & echo. & pause & exit /b 0)

REM --- 3. write -------------------------------------------------------------
echo.
node tools\retile_faces.mjs --local "%SRC%" --write
if errorlevel 1 (echo  That failed partway. Run: git checkout -- data/races/faces data/teammates/faces & pause & exit /b 1)

REM --- 4. LOOK AT A FACE. This is the step that was missing. ----------------
echo  ---------------------------------------------------------------------
echo   4. look at it
echo  ---------------------------------------------------------------------
echo  Opening the %CHECK% tile from both folders. Both should be the player
echo  you expect, at normal proportions. A match rate cannot tell you this
echo  and neither can I - only your eyes can.
echo.
if exist "data\teammates\faces\%CHECK%.png" start "" "%REPO%\data\teammates\faces\%CHECK%.png"
if exist "data\races\faces\%CHECK%.png" start "" "%REPO%\data\races\faces\%CHECK%.png"
timeout /t 2 >nul

echo.
set "OK="
set /p "OK=Is that the right player, at the right proportions? [y/N] "
if /i not "%OK%"=="y" (
  echo.
  echo  Reverting all of it.
  git checkout -- data/races/faces data/teammates/faces
  echo  Done - the tiles are back to what was committed. Tell Claude what you saw.
  echo.
  pause
  exit /b 0
)

REM --- 5. tests, then offer to push -----------------------------------------
echo.
echo  ---------------------------------------------------------------------
echo   5. tests
echo  ---------------------------------------------------------------------
set "FAILED="
for %%f in (tools\test_*.mjs) do (
  node "%%f" >nul 2>&1
  if errorlevel 1 (echo    FAIL  %%~nf & set "FAILED=1") else (echo    ok    %%~nf)
)
if defined FAILED (
  echo.
  echo  Tests failed. The tiles are written but NOT committed.
  echo  Undo with: git checkout -- data/races/faces data/teammates/faces
  echo.
  pause
  exit /b 1
)

git add data/races/faces data/teammates/faces
git commit -q -m "Faces: re-baked the race and scoreboard tiles from one named source"
echo.
git log --oneline -1
echo.
echo  Committed locally. Not pushed.
echo.
set "PUSH="
set /p "PUSH=Push to GitHub now? [y/N] "
if /i not "%PUSH%"=="y" (
  echo  Left as a local commit. Push later with: git push
  echo.
  pause
  exit /b 0
)

echo.
git pull --rebase --quiet || (echo  Rebase onto origin/main failed - resolve it, then git push & pause & exit /b 1)
git push || (echo  Push failed. & pause & exit /b 1)
echo.
echo  Pushed. GitHub Pages takes a minute:
echo     https://jsierrahoopshype.github.io/nba-doomscroll/
echo.
echo  The browser caches these tiles under the same filenames, so use
echo  Ctrl+Shift+R when you go and look.
echo.
pause
