@echo off
REM Apply a patch that arrived through the browser's Downloads folder.
REM
REM   tools\win\apply.cmd doomscroll.patch
REM
REM Downloads strips hyphens from filenames, so pass the name exactly as it
REM appears in the folder, not as it was sent.
setlocal
cd /d "%~dp0..\.."
if "%~1"=="" (
  echo   usage: tools\win\apply.cmd ^<patchfile^>
  echo   the file is looked for in %%USERPROFILE%%\Downloads
  exit /b 1
)
if not exist "%USERPROFILE%\Downloads\%~1" (
  echo   No such file: %USERPROFILE%\Downloads\%~1
  dir /b "%USERPROFILE%\Downloads\*.patch"
  exit /b 1
)
git apply "%USERPROFILE%\Downloads\%~1"
if errorlevel 1 (
  echo   Straight apply failed; retrying as a three-way merge.
  git apply --3way "%USERPROFILE%\Downloads\%~1"
)
