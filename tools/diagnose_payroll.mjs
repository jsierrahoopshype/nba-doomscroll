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
 * Everything it prints is your own data on your own terminal. It prints counts
 * and one named player's row, not the roster's salaries.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";

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
for (const r of statRows) {
  if (parseInt(r.YEAR, 10) === YEAR && r.PLAYER) hasStats.add(r.PLAYER);
}
const survivors = [...playersInFile].filter(p => !ambiguous.includes(p));
const noStats = survivors.filter(p => !hasStats.has(p));
line("  3. dropped for having no rsStats row            " + noStats.length +
     "   (salary present, stat line absent)");

const counted = survivors.filter(p => hasStats.has(p));
const book = counted.reduce((n, p) => {
  const rows = (byPlayer.get(p) || []).filter(r => r.team === TEAM);
  return n + (rows[0] ? rows[0].amount : 0);
}, 0);
line("  " + "-".repeat(64));
line("  players the payroll card would count            " + counted.length);
line("  the book it would divide by                     " + fmt(book));

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
  line("     flagged ambiguous: " + (amb ? "YES — excluded from every payroll book" : "no"));
  line("     ends up in the " + TEAM + " book: " +
       (his.some(r => r.team === TEAM) && !amb && hasStats.has(WHO) ? "yes" : "NO"));
}
line("");
line("  Paste the block above. The three drop counts say which filter did it,");
line("  and whether the fix is in nba-player-data or in build_salary.mjs.");
line("");
