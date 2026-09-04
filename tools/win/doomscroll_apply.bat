@echo off
REM ===========================================================================
REM  NBA Doomscroll — apply the newest patch, test, then offer to push.
REM
REM  WHY THIS EXISTS
REM
REM  Every change in this project has arrived as four pasted commands: apply,
REM  add, commit, push. Over one session that was more than twenty pastes, two
REM  of which went wrong in ways that cost a round trip each — a placeholder
REM  pasted verbatim, and `git am` reading an older file with the same name.
REM  Both were failures of the process, not of the person running it.
REM
REM  So: double-click this. It takes the NEWEST .patch in Downloads, which is
REM  the one that just arrived, applies it, runs every test in the repo, and
REM  stops to ask before it pushes anything.
REM
REM  IT ASKS BEFORE PUSHING, ALWAYS. Applying and committing are local and
REM  reversible; pushing is neither. A tool that pushes on its own is a tool
REM  that eventually pushes something nobody looked at.
REM
REM  HOW THIS RELATES TO apply.cmd AND ship.cmd, WHICH ALREADY EXIST
REM
REM  apply.cmd takes a filename. ship.cmd takes a commit message and rebuilds
REM  the pools. Both work and neither is going anywhere. Between them they
REM  still leave you typing a filename, a message, and four commands, which is
REM  why the pasting never actually stopped.
REM
REM  This one takes nothing, because everything it needs is already knowable:
REM  the patch is the newest one in Downloads, and the message is inside the
REM  patch. It does NOT rebuild the pools - that is ship.cmd's job and it takes
REM  minutes. Use this for a code change; use ship.cmd when the data changes.
REM ===========================================================================
setlocal EnableDelayedExpansion

set "REPO=C:\Users\Jorge Sierra\Documents\GitHub\nba-doomscroll"
set "DL=%USERPROFILE%\Downloads"

cd /d "%REPO%" || (echo Could not find the repo at %REPO% & pause & exit /b 1)

echo.
echo  repo: %REPO%
echo.

REM --- Refuse to start on a dirty tree -------------------------------------
REM  Applying a patch over uncommitted edits is how a patch fails to apply and
REM  leaves a half-changed working copy. Better to stop and say so.
for /f "delims=" %%s in ('git status --porcelain') do (
  echo  There are uncommitted changes here already:
  echo.
  git status --short
  echo.
  echo  Commit or discard them first, then run this again.
  echo.
  pause
  exit /b 1
)

REM --- Newest patch in Downloads -------------------------------------------
set "PATCHFILE="
for /f "delims=" %%f in ('dir /b /o-d "%DL%\*.patch" 2^>nul') do (
  set "PATCHFILE=%DL%\%%f"
  goto :gotpatch
)
:gotpatch
if not defined PATCHFILE (
  echo  No .patch file in %DL%
  echo.
  pause
  exit /b 1
)

echo  patch: !PATCHFILE!
for %%d in ("!PATCHFILE!") do echo  saved: %%~td
echo.

REM --- Apply ----------------------------------------------------------------
REM  A patch made with `git format-patch` carries its own commit message and
REM  goes in with `git am`. A plain `git diff` does not, and needs a message.
REM  Checking the first line tells them apart, rather than trying one and
REM  cleaning up after it fails - a failed `git am` leaves the repo mid-apply.
set "ISMAIL="
for /f "usebackq delims=" %%l in ("!PATCHFILE!") do (
  echo %%l | findstr /b /c:"From " >nul && set "ISMAIL=1"
  goto :checked
)
:checked

if defined ISMAIL (
  echo  applying with git am ^(message comes from the patch^)...
  git am "!PATCHFILE!"
  if errorlevel 1 (
    REM  STRICT FIRST, THEN THREE-WAY.
    REM
    REM  A plain `git am` matches the context lines around each change exactly,
    REM  and this working copy is CRLF while the patches are written LF, which
    REM  is enough to make it refuse a patch that is otherwise perfectly good.
    REM  --3way matches on the blob the patch was made against instead, so line
    REM  endings and harmless drift stop mattering. It is the second attempt
    REM  rather than the first because when strict works it is unambiguous, and
    REM  a three-way merge can leave conflict markers that need a person.
    echo.
    echo  Strict apply refused it. Retrying as a three-way merge...
    git am --abort
    git am --3way "!PATCHFILE!"
    if errorlevel 1 (
      echo.
      echo  That failed too. Backing out; the repo is untouched.
      git am --abort
      echo.
      echo  This usually means the repo has moved on from what the patch was
      echo  written against. Say so and a fresh patch can be cut.
      echo.
      pause
      exit /b 1
    )
  )
) else (
  echo  applying with git apply...
  git apply "!PATCHFILE!"
  if errorlevel 1 (
    echo  Strict apply refused it. Retrying as a three-way merge...
    git apply --3way "!PATCHFILE!"
    if errorlevel 1 (
      echo.
      echo  The patch did not apply. Nothing was changed.
      echo.
      pause
      exit /b 1
    )
  )
  git add -A
  REM  A plain diff has no message, so the filename becomes one. Not elegant,
  REM  but it is accurate and it beats stopping to ask for a sentence.
  for %%d in ("!PATCHFILE!") do git commit -q -m "Apply %%~nd"
)

echo.
git --no-pager log --oneline -1
echo.
git --no-pager diff --stat HEAD~1 HEAD
echo.

REM --- Test -----------------------------------------------------------------
REM  Every test in the repo, every time. They take seconds and they are the
REM  only thing standing between a patch that applies and a patch that works.
echo  running tests...
set "FAILED="
for %%t in (tools\test_*.mjs) do (
  node "%%t" >nul 2>&1
  if errorlevel 1 (
    echo    FAIL  %%~nt
    set "FAILED=1"
  ) else (
    echo    ok    %%~nt
  )
)
echo.

if defined FAILED (
  echo  ============================================================
  echo   A TEST FAILED. The commit is here locally but do not push.
  echo   Run the failing one on its own to see why:
  echo       node tools\test_^<name^>.mjs
  echo   To undo the commit entirely:  git reset --hard HEAD~1
  echo  ============================================================
  echo.
  pause
  exit /b 1
)

REM --- Push, only if asked --------------------------------------------------
echo  All tests pass. The commit is local and not yet pushed.
echo.
set "GO="
set /p "GO=Push to GitHub now? [y/N] "
if /i not "!GO!"=="y" (
  echo.
  echo  Left unpushed. Push later with:  git push
  echo  Or undo it with:                 git reset --hard HEAD~1
  echo.
  pause
  exit /b 0
)

REM  Rebase first. A weekly job pushes refreshed pools straight onto main, so a
REM  push that lands near it is rejected as non-fast-forward. Replaying this one
REM  local commit on top rewrites nothing that has been pushed. ship.cmd has
REM  done this for a while; leaving it out here would make this script fail on
REM  exactly the days the other one does not.
echo.
echo  rebasing onto origin/main first...
git pull --rebase origin main
if errorlevel 1 (
  echo.
  echo  The rebase stopped, most likely a conflict. NOTHING has been pushed.
  echo  Undo it with:  git rebase --abort
  echo  Then ask before going further.
  echo.
  pause
  exit /b 1
)

echo.
git push
if errorlevel 1 (
  echo.
  echo  Push failed. The commit is still here; nothing is lost.
) else (
  echo.
  echo  Pushed. GitHub Pages takes a minute to rebuild:
  echo    https://jsierrahoopshype.github.io/nba-doomscroll/
)
echo.
pause
