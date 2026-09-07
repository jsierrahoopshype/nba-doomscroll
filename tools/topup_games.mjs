/* Bring the games schedule up to date, without touching the file it came from.
 *
 *     node tools/topup_games.mjs            find the schedule, fetch, write
 *     node tools/topup_games.mjs --dry      say what is missing, fetch nothing
 *     node tools/topup_games.mjs --games "C:\path\to\game.csv"
 *     node tools/topup_games.mjs --out "C:\path\to\game_topped_up.csv"
 *
 * THE PROBLEM
 *
 * The full schedule the race builder finds runs to 2023-06-12. The playoff
 * export tops it up to 2025-05-02, but only for playoffs, so every race built
 * on regular-season history is three seasons short and says nothing about it:
 * franchise-wins, the thirty team races, playoff-games, on-this-day. They all
 * look healthy. They are just missing 2023-24, 2024-25 and 2025-26.
 *
 * WHAT THIS DOES
 *
 * Reads the existing CSV to learn two things - its exact column list, and the
 * last season in it - then pulls the missing seasons from stats.nba.com and
 * writes ONE NEW FILE: the original rows followed by the new ones.
 *
 * THE ORIGINAL IS NEVER MODIFIED. It is a downloaded dataset that other tools
 * on this machine may read, and a top-up that edited it in place would be
 * unrecoverable if a season came back wrong. The builder finds the new file on
 * its own: it picks a full schedule by coverage, and the merged file has more
 * rows and reaches further, so it wins that tie-break without anything being
 * renamed or configured.
 *
 * It also refuses to overwrite an existing output file, for the same reason.
 *
 * WHY IT RUNS ON YOUR MACHINE
 *
 * stats.nba.com blocks cloud provider IPs and wants browser headers. From a
 * home connection with the headers below it answers normally. It is also rate
 * limited in ways nobody documents, so there is a pause between calls and the
 * whole run is nine requests, not nine hundred.
 *
 * The rules with anything to get wrong - pairing the two team rows of a game,
 * matching columns, working out which seasons are missing - live in
 * lib/gamelog.mjs and are tested in tools/test_gamelog.mjs, because this file
 * fetches on start-up and cannot be imported by a test.
 */

import fs from "fs";
import path from "path";
import { findCsvWithColumns } from "./lib/find.mjs";
import { GAME_TABLE_COLUMNS, scheduleSpan } from "./lib/games.mjs";
import { GAME_TYPES, pairGames, rowWriter, missingSeasons, seasonLabel } from "./lib/gamelog.mjs";

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes("--dry");

const line = s => console.log(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- find the schedule ---------------- */

let SRC = flag("--games");
if (!SRC) {
  const found = findCsvWithColumns(GAME_TABLE_COLUMNS)
    .map(f => { const file = f.file || f; return { file, span: scheduleSpan(file) }; })
    .sort((a, b) => b.span.rows - a.span.rows);
  if (!found.length) {
    line("");
    line("  No CSV with the NBA game-table columns found under your home folder.");
    line("  Wanted: " + GAME_TABLE_COLUMNS.join(", "));
    line("  Point at it directly:");
    line("    node tools/topup_games.mjs --games \"C:\\path\\to\\game.csv\"");
    line("");
    process.exit(1);
  }
  SRC = found[0].file;
  if (found.length > 1) {
    line("");
    line("  " + found.length + " candidates; using the one with the most rows:");
    for (const f of found) {
      line("    " + (f.file === SRC ? "->" : "  ") + " " + f.file +
        "   " + f.span.rows.toLocaleString("en-US") + " rows, to " + (f.span.to || "?"));
    }
  }
}

const text = fs.readFileSync(SRC, "utf8");
const rawLines = text.split(/\r?\n/);
const header = rawLines[0];
const cols = header.split(",").map(s => s.trim().replace(/^"+|"+$/g, ""));
const body = rawLines.slice(1).filter(l => l.trim());

const iSeason = cols.findIndex(c => c.toLowerCase() === "season_id");
if (iSeason < 0) {
  line("\n  That file has no season_id column, so there is no way to tell which\n" +
       "  seasons it already holds. Nothing done.\n");
  process.exit(1);
}

/* season_id is a five-digit code: first digit the game type, the rest the
 * season's starting year. */
const haveSeasons = new Set();
for (const l of body) {
  const s = String(l.split(",")[iSeason] || "").trim().replace(/^"+|"+$/g, "");
  if (/^\d{5}$/.test(s)) haveSeasons.add(parseInt(s.slice(1), 10));
}
if (!haveSeasons.size) {
  line("\n  No readable season_id in any row. Nothing done.\n");
  process.exit(1);
}
const span = scheduleSpan(SRC);
const lastHave = Math.max(...haveSeasons);

line("");
line("  " + SRC);
line("  " + body.length.toLocaleString("en-US") + " rows, " + cols.length + " columns, " +
     (span.from || "?") + " to " + (span.to || "?"));
line("  latest season in the file: " + seasonLabel(lastHave));
line("  " + "-".repeat(66));

const missing = missingSeasons(haveSeasons, new Date());
if (!missing.length) {
  line("  Nothing missing. The file already reaches the last finished season.");
  line("");
  process.exit(0);
}
line("  MISSING: " + missing.map(seasonLabel).join(", "));

if (DRY) {
  line("");
  line("  --dry, so nothing was fetched and nothing was written.");
  line("  Run it again without --dry to pull those seasons.");
  line("");
  process.exit(0);
}

/* ---------------- fetch ---------------- */

/* stats.nba.com answers a bare request with silence rather than an error, so
 * these are the headers a browser sends. Without them the call hangs until it
 * times out, which is its own kind of confusing. */
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true"
};

async function fetchLog(season, type) {
  const url = "https://stats.nba.com/stats/leaguegamelog?Counter=1000&DateFrom=&DateTo=" +
    "&Direction=DESC&LeagueID=00&PlayerOrTeam=T&Season=" + encodeURIComponent(season) +
    "&SeasonType=" + encodeURIComponent(type) + "&Sorter=DATE";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctl.signal });
    if (!res.ok) return { error: "HTTP " + res.status };
    const j = await res.json();
    const rs = (j.resultSets || [])[0];
    if (!rs || !rs.rowSet) return { error: "no resultSets in the answer" };
    const idx = rs.headers.map((h, i) => [h, i]);
    return {
      rows: rs.rowSet.map(r => {
        const o = {};
        for (const [h, i] of idx) o[h] = r[i];
        return o;
      })
    };
  } catch (e) {
    return { error: e.name === "AbortError" ? "no answer in 30s" : e.message };
  } finally { clearTimeout(timer); }
}

const writer = rowWriter(cols);
const newRows = [];
let anyError = false;

for (const y of missing) {
  for (const t of GAME_TYPES) {
    const got = await fetchLog(seasonLabel(y), t.api);
    if (got.error) {
      line("    " + seasonLabel(y).padEnd(9) + t.api.padEnd(16) + "FAILED: " + got.error);
      anyError = true;
      await sleep(1500);
      continue;
    }
    const { games, unpaired } = pairGames(got.rows);
    for (const g of games) newRows.push(writer.row(g, t.digit, y));
    line("    " + seasonLabel(y).padEnd(9) + t.api.padEnd(16) +
      String(games.length).padStart(4) + " games" +
      (unpaired ? "   (" + unpaired + " with only one team's row, skipped)" : ""));
    await sleep(1500);
  }
}

line("  " + "-".repeat(66));

if (!newRows.length) {
  line("  Nothing came back. The original file is untouched.");
  if (anyError) {
    line("");
    line("  stats.nba.com blocks cloud IPs and throttles hard. If this ran behind");
    line("  a VPN, try it without one, and if it kept timing out, wait and rerun.");
  }
  line("");
  process.exit(1);
}

/* ---------------- write ---------------- */

const OUT = flag("--out") ||
  path.join(path.dirname(SRC),
    path.basename(SRC, path.extname(SRC)) + "_through_" +
    seasonLabel(missing[missing.length - 1]).replace("-", "_") + ".csv");

if (fs.existsSync(OUT)) {
  line("  " + OUT);
  line("  already exists, so nothing was written. Pass --out with another name,");
  line("  or delete that file yourself if it is a stale attempt.");
  line("");
  process.exit(1);
}

fs.writeFileSync(OUT, [header].concat(body, newRows).join("\n") + "\n", "utf8");

line("  wrote  " + OUT);
line("         " + (body.length + newRows.length).toLocaleString("en-US") + " rows  (" +
     body.length.toLocaleString("en-US") + " kept + " +
     newRows.length.toLocaleString("en-US") + " new)");
line("  kept   " + SRC);
line("         unmodified");

if (writer.unfilled.size) {
  line("");
  line("  COLUMNS LEFT EMPTY in the new rows (" + writer.unfilled.size + "):");
  line("    " + [...writer.unfilled].join(", "));
  line("  No API field matched these, so they are blank rather than guessed.");
  line("  build_races.mjs reads team ids, the W/L and season_id, none of which");
  line("  are in that list - check it against anything else that reads this file.");
}

line("");
line("  Next:  node tools\\build_races.mjs");
line("  It picks a full schedule by coverage, so it finds the new file on its");
line("  own. Watch the 'using' line to confirm, and franchise-wins should gain");
line("  steps.");
line("");
if (anyError) process.exit(1);
