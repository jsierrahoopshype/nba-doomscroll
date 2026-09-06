/* Why is a team's payroll book short?
 *
 *     node tools/diagnose_payroll.mjs
 *     node tools/diagnose_payroll.mjs --team LAL --year 2026
 *     node tools/diagnose_payroll.mjs --team BOS --year 2026 --who "Jayson Tatum"
 *
 * WHY THIS EXISTS
 *
 * "Luka Doncic was 47% of the LAL payroll in 2025-26" shipped off an $96.8M
 * book when the Lakers paid $197.1M. Asked why, I said LeBron James was not in
 * salaries.json. I had no way to know that - salaries.json is not in this repo
 * and I never read it - and there are at least two filters in build_salary.mjs
 * that drop a player from a payroll book while his salary sits in the file
 * perfectly intact:
 *
 *   1. teamAmbiguous. The 2026 rows repeat the same full salary under two
 *      teams, 117 times. Those seasons are counted once and then excluded from
 *      payroll families, because nobody can say whose book the man was on.
 *
 *   2. the stats join. `seasons` is built from salaries INNER JOIN rsStats. A
 *      player with a salary and no stat row for that year is dropped silently.
 *      For the current season that is anyone yet to appear in the stats file.
 *
 * So this prints what the builder actually saw, filter by filter, instead of
 * anyone guessing again. It reads; it writes nothing and builds nothing.
 *
 * WHAT IT FOUND, Sept 6 2026
 *
 * Filter 1, and for a reason nobody had guessed. salaries.json ends at 2026
 * with no 2027 season, and for 145 players who move for 2026-27 it appends a
 * SECOND 2026 row naming the new team with the current salary copied in:
 * LeBron is LA Lakers $52,627,153 and Philadelphia $52,627,153, when he is
 * paid $3,876,529 in Philadelphia next season. Right team, wrong year, wrong
 * money. The builder read those as one salary listed twice, could not say
 * whose book he was on, and discarded the season - fifteen of twenty-eight
 * Lakers, gone. It now strips those rows using the stats as the check.
 *
 * Everything it prints is your own data on your own terminal. It prints counts
 * and one named player's row, not the roster's salaries.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";
import { stripPhantomTeamRows } from "./lib/salary.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const TEAM = String(arg("team", "LAL")).toUpperCase();
/* The builder keys seasons on the END year: 2025-26 is 2026. */
const YEAR = parseInt(arg("year", "2026"), 10);
const WHO = arg("who", "LeBron James");

const li = argv.indexOf("--local");
const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["salaries.json", "rsStats.json", "bio.json"]
});
if (!PD) process.exit(1);

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const money = s => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;

const salaryRows = readJson(path.join(PD, "salaries.json"));
const statRows = readJson(path.join(PD, "rsStats.json"));

/* Same normalisation the builder uses, or the answer is about a different
 * team than the one that is wrong. */
const TEAM_CODE = {
  "atlanta": "ATL", "boston": "BOS", "brooklyn": "BKN", "charlotte": "CHA",
  "chicago": "CHI", "cleveland": "CLE", "dallas": "DAL", "denver": "DEN",
  "detroit": "DET", "golden state": "GSW", "houston": "HOU", "indiana": "IND",
  "la clippers": "LAC", "la lakers": "LAL", "los angeles clippers": "LAC",
  "los angeles lakers": "LAL", "memphis": "MEM", "miami": "MIA",
  "milwaukee": "MIL", "minnesota": "MIN", "new orleans": "NOP",
  "new york": "NYK", "oklahoma city": "OKC", "orlando": "ORL",
  "philadelphia": "PHI", "phoenix": "PHX", "portland": "POR",
  "sacramento": "SAC", "san antonio": "SAS", "toronto": "TOR",
  "utah": "UTA", "washington": "WAS"
};
const teamCode = t => {
  const raw = String(t || "").trim();
  return TEAM_CODE[raw.toLowerCase()] || raw.toUpperCase();
};

const fmt = n => "$" + (n / 1e6).toFixed(1) + "M";
const line = s => console.log(s);

line("");
line("  " + TEAM + " " + (YEAR - 1) + "-" + String(YEAR).slice(2) +
     "   (nba-player-data at " + PD + ")");
line("  " + "-".repeat(64));

/* ---- stage 1: rows in salaries.json for this team-season ---- */

const rowsFor = salaryRows.filter(r =>
  parseInt(r.YEAR, 10) === YEAR && teamCode(r.TEAM) === TEAM && r.PLAYER && money(r.SALARY));
const playersInFile = new Set(rowsFor.map(r => r.PLAYER));
line("  1. rows in salaries.json for this team-season   " + rowsFor.length +
     "  (" + playersInFile.size + " distinct players)");
line("     their sum, as listed                         " +
     fmt(rowsFor.reduce((n, r) => n + money(r.SALARY), 0)));

/* ---- stage 2: the ambiguity filter ---- */

const byPlayer = new Map();
for (const r of salaryRows) {
  const y = parseInt(r.YEAR, 10);
  if (y !== YEAR || !r.PLAYER || !money(r.SALARY)) continue;
  if (!byPlayer.has(r.PLAYER)) byPlayer.set(r.PLAYER, []);
  byPlayer.get(r.PLAYER).push({ team: teamCode(r.TEAM), amount: money(r.SALARY) });
}
const ambiguous = [], traded = [];
for (const p of playersInFile) {
  const rows = byPlayer.get(p) || [];
  if (rows.length > 1 && new Set(rows.map(r => r.amount)).size === 1) ambiguous.push(p);
  else if (rows.length > 1) traded.push(p);
}
line("  2. dropped by the ambiguity filter              " + ambiguous.length +
     "   (same salary listed under 2+ teams)");
if (traded.length) {
  line("     real mid-season splits, kept                 " + traded.length);
}

/* ---- stage 3: the stats join ---- */

const hasStats = new Set();
const playedFor = new Map();    // player -> Set of teams rsStats has him playing for
for (const r of statRows) {
  if (parseInt(r.YEAR, 10) !== YEAR || !r.PLAYER) continue;
  hasStats.add(r.PLAYER);
  if (!playedFor.has(r.PLAYER)) playedFor.set(r.PLAYER, new Set());
  playedFor.get(r.PLAYER).add(teamCode(r.TEAM));
}

/* The rule build_salary.mjs now applies, from the same module, so this cannot
 * drift into describing a builder that behaves differently. */
const cleanRows = p => stripPhantomTeamRows(byPlayer.get(p) || [], playedFor.get(p));
const phantomFor = p => (byPlayer.get(p) || []).length - cleanRows(p).length;
const withPhantom = [...playersInFile].filter(p => phantomFor(p) > 0);

line("     of those, rows the stats expose as phantom   " + withPhantom.length +
     "   (team not played for, salary copied from another row)");

const survivors = [...playersInFile].filter(p => !ambiguous.includes(p));
const noStats = survivors.filter(p => !hasStats.has(p));
line("  3. dropped for having no rsStats row            " + noStats.length +
     "   (salary present, stat line absent)");

const bookOf = (list, rowsFn) => list.reduce((n, p) => {
  const rs = rowsFn(p).filter(r => r.team === TEAM);
  return n + (rs[0] ? rs[0].amount : 0);
}, 0);
const before = survivors.filter(p => hasStats.has(p));
/* After the strip, a player is counted when he has stats and at least one
 * surviving row on this team - which is exactly the builder's test. */
const after = [...playersInFile].filter(p =>
  hasStats.has(p) && cleanRows(p).some(r => r.team === TEAM) &&
  !(cleanRows(p).length > 1 && new Set(cleanRows(p).map(r => r.amount)).size === 1));

line("  " + "-".repeat(64));
line("  BEFORE:  " + before.length + " players, book " +
     fmt(bookOf(before, p => byPlayer.get(p) || [])));
line("  AFTER :  " + after.length + " players, book " + fmt(bookOf(after, cleanRows)));

/* ---- the named player ---- */

line("");
line("  " + WHO + ":");
const his = byPlayer.get(WHO);
if (!his) {
  line("     NOT in salaries.json for " + YEAR + " under any team.");
} else {
  line("     in salaries.json: " + his.length + " row(s) — " +
       his.map(r => r.team + " " + fmt(r.amount)).join(", "));
  line("     rsStats row for " + YEAR + ": " + (hasStats.has(WHO) ? "yes" : "NO"));
  const amb = his.length > 1 && new Set(his.map(r => r.amount)).size === 1;
  line("     was flagged ambiguous: " + (amb ? "YES — used to be dropped entirely" : "no"));
  const played = playedFor.get(WHO);
  line("     rsStats says he played for: " +
       (played && played.size ? [...played].join(", ") : "nothing on file"));
  const clean = cleanRows(WHO);
  line("     rows kept after the strip: " +
       (clean.length ? clean.map(r => r.team + " " + fmt(r.amount)).join(", ") : "none"));
  line("     ends up in the " + TEAM + " book: " +
       (hasStats.has(WHO) && clean.some(r => r.team === TEAM) ? "yes" : "NO"));
}
line("");
line("  BEFORE is what shipped. AFTER is what the fixed builder produces.");
line("  The phantom rows are a bug in nba-player-data and will recur next");
line("  season; this only stops them reaching the cards.");
line("");
