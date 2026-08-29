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
