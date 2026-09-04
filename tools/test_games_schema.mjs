#!/usr/bin/env node
/* Can the builder tell a full schedule from a playoffs-only subset, and read
 * both games schemas?
 *
 * This exists because neither question errored when it was answered wrongly.
 * Games_Playoffs_Since1946.csv has every column the builder wanted and 4,398
 * rows, all playoffs, so it was accepted in silence and "All-time franchise
 * wins" shipped showing playoff wins. The failure had no exception, no warning
 * and no wrong type - only two races that came out byte-identical.
 *
 *   node tools/test_games_schema.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  GAMES_COLUMNS, GAME_TABLE_COLUMNS, hasRegularSeason, normalizeGames, scheduleSpan, mergePlayoffs
} from "./lib/games.mjs";

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${detail ? "\n         " + detail : ""}`); fail++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gamesschema-"));
const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };

/* ---------------- telling a full schedule from a subset ---------------- */

const playoffsOnly = write("Games_Playoffs_Since1946.csv",
  "gameId,gameDate,hometeamCity,hometeamName,hometeamId,awayteamCity,awayteamName,awayteamId,winner,gameType\n" +
  "1,1990-05-01,Los Angeles,Lakers,1610612747,Boston,Celtics,1610612738,1610612747,Playoffs\n" +
  "2,1990-05-03,Boston,Celtics,1610612738,Los Angeles,Lakers,1610612747,1610612738,Playoffs\n");

const fullOldSchema = write("Games_full.csv",
  "gameId,gameDate,hometeamCity,hometeamName,hometeamId,awayteamCity,awayteamName,awayteamId,winner,gameType\n" +
  "1,1990-05-01,Los Angeles,Lakers,1610612747,Boston,Celtics,1610612738,1610612747,Playoffs\n" +
  "2,1990-11-03,Boston,Celtics,1610612738,Los Angeles,Lakers,1610612747,1610612738,Regular Season\n");

const gameTable = write("game.csv",
  "season_id,team_id_home,team_name_home,game_id,game_date,wl_home,team_id_away,team_name_away,wl_away\n" +
  "22022,1610612747,Los Angeles Lakers,001,2022-10-18,W,1610612744,Golden State Warriors,L\n" +
  "42022,1610612744,Golden State Warriors,002,2023-05-01,L,1610612747,Los Angeles Lakers,W\n" +
  "22022,1610612738,Boston Celtics,003,2022-11-02,,1610612747,Los Angeles Lakers,\n");

const playoffsOnlyGameTable = write("game_po.csv",
  "season_id,team_id_home,team_name_home,game_id,game_date,wl_home,team_id_away,team_name_away,wl_away\n" +
  "42022,1610612744,Golden State Warriors,002,2023-05-01,L,1610612747,Los Angeles Lakers,W\n");

ok("a playoffs-only file is recognised as such", hasRegularSeason(playoffsOnly) === false);
ok("a full schedule in the same schema is recognised", hasRegularSeason(fullOldSchema) === true);
ok("season_id 2xxxx counts as regular season", hasRegularSeason(gameTable) === true);
ok("season_id 4xxxx only is playoffs only", hasRegularSeason(playoffsOnlyGameTable) === false);

/* Unknown must not be confused with no: a file this cannot judge has to sort
 * apart from one it has judged and rejected. */
const noTypeColumn = write("mystery.csv", "a,b,c\n1,2,3\n");
ok("a file with no type column is unknown, not 'no'", hasRegularSeason(noTypeColumn) === null);
ok("a missing file is unknown, not a crash",
  hasRegularSeason(path.join(dir, "nope.csv")) === null);
ok("a header with no rows is unknown",
  hasRegularSeason(write("headeronly.csv", "gameId,gameType\n")) === null);

/* ---------------- mapping the two schemas ---------------- */

const parse = f => {
  const [head, ...rest] = fs.readFileSync(f, "utf8").split(/\r?\n/).filter(l => l.trim());
  const cols = head.split(",");
  return rest.map(l => {
    const cells = l.split(",");
    const row = {};
    cols.forEach((c, i) => { row[c] = cells[i] === undefined ? "" : cells[i]; });
    return row;
  });
};

const canon = normalizeGames(parse(fullOldSchema));
ok("the original schema passes through untouched", canon.schema === "games");

const mapped = normalizeGames(parse(gameTable));
ok("the game table is recognised", mapped.schema === "game-table", `got ${mapped.schema}`);

const [reg, po, noWl] = mapped.rows;
ok("a home win names the home team as winner",
  reg.winner === "1610612747", `got ${reg.winner}`);
ok("a home loss names the away team as winner",
  po.winner === "1610612747", `got ${po.winner}`);
ok("season_id 2 maps to Regular Season",
  reg.gameType === "Regular Season", `got ${reg.gameType}`);
ok("season_id 4 maps to Playoffs",
  po.gameType === "Playoffs", `got ${po.gameType}`);

/* The one that would corrupt the standings quietly: a postponed game with no
 * W/L must produce NO winner. Defaulting it either way hands one team a win it
 * never played for, and there is no error to notice. */
ok("a row with no W/L produces no winner", noWl.winner === "");
ok("and is counted and reported", mapped.noResult === 1, `got ${mapped.noResult}`);

ok("team ids survive the mapping",
  reg.hometeamId === "1610612747" && reg.awayteamId === "1610612744");
ok("city and name join without doubling the city",
  (reg.hometeamCity + " " + reg.hometeamName).trim() === "Los Angeles Lakers",
  `got "${(reg.hometeamCity + " " + reg.hometeamName).trim()}"`);

/* A file that is neither schema must stop the build. Reading a wrong file to
 * the end and emitting empty races is worse than refusing. */
let threw = null;
try { normalizeGames(parse(write("wrong.csv", "player,points\nLeBron,30\n"))); }
catch (e) { threw = e; }
ok("an unrecognised schema throws rather than building nothing",
  threw && threw.code === "UNKNOWN_GAMES_SCHEMA");
ok("and the error names both schemas it wanted",
  threw && GAMES_COLUMNS.every(c => threw.message.includes(c)) &&
  GAME_TABLE_COLUMNS.every(c => threw.message.includes(c)));

ok("an empty file is not an error", normalizeGames([]).schema === "empty");

/* ---------------- measuring coverage ---------------- */

/* The tie-break that cost ten seasons of champions. Two valid full schedules,
 * and the newer one won on a filesystem date. What separates them is history,
 * so history is what has to be measured. */
const deep = write("deep.csv",
  "season_id,team_id_home,team_id_away,wl_home,game_date\n" +
  "21946,1,2,W,1946-11-01\n" +
  "22000,1,2,W,2000-11-01\n" +
  "22024,1,2,L,2025-01-05\n");
const shallow = write("shallow.csv",
  "season_id,team_id_home,team_id_away,wl_home,game_date\n" +
  "22000,1,2,W,2000-11-01\n");

const deepSpan = scheduleSpan(deep);
ok("row count is the data rows, not the header", deepSpan.rows === 3, `got ${deepSpan.rows}`);
ok("the span runs from the earliest date to the latest",
  deepSpan.from === "1946-11-01" && deepSpan.to === "2025-01-05",
  `got ${deepSpan.from} to ${deepSpan.to}`);
ok("the deeper file outranks the shallower one",
  deepSpan.rows > scheduleSpan(shallow).rows);

/* season_id carries the year when no date column exists, so a file without
 * dates still reports a span rather than nothing. */
const noDates = write("nodates.csv",
  "season_id,team_id_home,team_id_away,wl_home\n21946,1,2,W\n22024,1,2,L\n");
const nd = scheduleSpan(noDates);
ok("season_id supplies the span when there is no date column",
  nd.from === "1946" && nd.to === "2024", `got ${nd.from} to ${nd.to}`);

ok("a missing file measures as empty rather than crashing",
  scheduleSpan(path.join(dir, "gone.csv")).rows === 0);

/* ---------------- topping up playoff history ---------------- */

/* The schedule runs to 2023 and the playoff export to 2025. Neither is a
 * superset of the other, so the merge has to add what is genuinely new without
 * double-counting a game both files describe. */
const primary = [
  { gameDate: "2023-06-12", hometeamId: "1", awayteamId: "2", gameType: "Playoffs", winner: "1" },
  { gameDate: "2022-11-02", hometeamId: "1", awayteamId: "2", gameType: "Regular Season", winner: "1" }
];
const secondary = [
  { gameDate: "2023-06-12", hometeamId: "1", awayteamId: "2", gameType: "Playoffs", winner: "1" },
  { gameDate: "2025-05-02", hometeamId: "3", awayteamId: "4", gameType: "Playoffs", winner: "3" }
];

const merged = mergePlayoffs(primary, secondary);
ok("regular-season games never reach the playoff set",
  merged.rows.every(g => g.gameType === "Playoffs"), `got ${merged.rows.length} rows`);
ok("a game both files describe is counted once",
  merged.rows.filter(g => g.gameDate === "2023-06-12").length === 1);
ok("a game only the second file has is added",
  merged.rows.some(g => g.gameDate === "2025-05-02"));
ok("the counts are reported honestly",
  merged.fromPrimary === 1 && merged.added === 1,
  `fromPrimary=${merged.fromPrimary} added=${merged.added}`);

/* The dedupe key is date plus both team ids, NOT game id: the two files number
 * games differently, so ids would either collide across unrelated games or
 * miss every shared one. */
const differentIds = mergePlayoffs(
  [{ gameId: "A1", gameDate: "2023-06-12", hometeamId: "1", awayteamId: "2", gameType: "Playoffs", winner: "1" }],
  [{ gameId: "0042200401", gameDate: "2023-06-12", hometeamId: "1", awayteamId: "2", gameType: "Playoffs", winner: "1" }]
);
ok("the same game under two different ids is still one game",
  differentIds.rows.length === 1 && differentIds.added === 0);

/* Same date, different teams: two real games, not a duplicate. */
const sameDay = mergePlayoffs(
  [{ gameDate: "2023-05-01", hometeamId: "1", awayteamId: "2", gameType: "Playoffs", winner: "1" }],
  [{ gameDate: "2023-05-01", hometeamId: "5", awayteamId: "6", gameType: "Playoffs", winner: "5" }]
);
ok("two different games on one date both survive", sameDay.rows.length === 2);

ok("no second file means the primary's playoffs, unchanged",
  mergePlayoffs(primary, null).rows.length === 1);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
