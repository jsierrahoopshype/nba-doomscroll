@echo off
REM Machine-specific source locations for the two builders.
REM
REM Copy this file to tools\win\paths.cmd and set the two paths. paths.cmd is
REM gitignored on purpose: it names folders on one person's disk, and this is a
REM public repo.

REM The media-vote-tracker checkout whose docs\data the media lean card is built
REM from. There is more than one checkout of that repo in the wild and they hold
REM different datasets - the right one yields 99 players and 13 countries.
set "MVT_DATA=<full path>\media-vote-tracker\docs\data"

REM The nba-player-data checkout. This is the folder that directly contains
REM awards.json, not its parent.
set "NPD=<full path>\nba-player-data"

REM The salary cap table, a CSV that ships in the salary-season-finder repo.
REM Optional: unset, the builder searches for it and takes the newest it finds.
set "CAP_CSV=<full path>\salary-season-finder\salary_cap_info.csv"

REM The game log the cost-per-win cards divide payroll by: one row per game,
REM with a result. Optional in the same way, and worth pinning for the same
REM reason - a partial schedule silently costs those cards their seasons rather
REM than failing. Use the merged file tools\topup_games.mjs writes, not the
REM original it was built from.
set "GAMES_CSV=<full path>\archive\csv\game_through_2025_26.csv"
