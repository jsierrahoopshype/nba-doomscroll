/* Why does a payroll fail to join a season of games?
 *
 *     node tools/diagnose_payroll_wins.mjs
 *     node tools/diagnose_payroll_wins.mjs --games "C:\path\to\game_log.csv"
 *     node tools/diagnose_payroll_wins.mjs --year 2013
 *
 * WHAT PROMPTED IT
 *
 * The salary build reports this, and the middle line is the problem:
 *
 *   933 of 1015 vetted payrolls joined to a full schedule; 2 game rows had no result
 *     59 had no season in the game log, e.g. CHA 2013, POR 2013, MIN 2013, WAS 2013
 *     3 of 35 seasons have a payroll for every team that played
 *     15 went winless, so there is no rate to state: MIA 2013 0-0, OKC 2013 0-0, ...
 *
 * Three separate things are wrong there and only one of them is obvious.
 *
 *   "0-0" IS NOT WINLESS. A team with a full schedule in the file and neither a
 *   win nor a loss has games whose result did not land. The league-wide count
 *   of result-less rows is TWO, so several hundred rows cannot also be
 *   result-less; the two numbers contradict each other and at least one is
 *   measuring something other than what it says.
 *
 *   2013 IS SPLIT. Some 2013 teams are absent from the log entirely and others
 *   are present with no results. One season failing two different ways points
 *   at the join, not at the data being thin.
 *
 *   3 OF 35 SEASONS makes the league-wide cost-per-win claims almost never
 *   available, which is the whole point of having built them.
 *
 * WHAT THIS PRINTS, AND WHAT IT DOES NOT
 *
 * Team codes, season years, games played, win and loss counts, and the team
 * NAME STRINGS the log uses - because a name string that no longer matches its
 * city is the likeliest cause and it cannot be diagnosed without seeing it.
 * No player names, no salary figures: the payroll side contributes only which
 * team-seasons exist and how many men are on the book. Safe to paste whole.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource, cleanPath, findCsvWithColumns } from "./lib/find.mjs";
import { GAME_TABLE_COLUMNS, GAMES_COLUMNS, normalizeGames } from "./lib/games.mjs";
import { seasonEndYear, tallyTeamSeasons, medianGpByYear, GP_SLACK } from "./lib/payroll_wins.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const ONLY_YEAR = parseInt(arg("--year"), 10) || null;

/* ---------------- sources ---------------- */

const PD = resolveSource("nba-player-data", {
  explicit: arg("--local"),
  markers: ["salaries.json", "rsStats.json"]
});
if (!PD) process.exit(1);

let GAMES_CSV = cleanPath(arg("--games"));
if (!GAMES_CSV) {
  const found = findCsvWithColumns(GAME_TABLE_COLUMNS, null) ||
                findCsvWithColumns(GAMES_COLUMNS, null);
  if (found && found.length) {
    GAMES_CSV = found[0].f || found[0];
    console.log(`  game log: ${GAMES_CSV}`);
  }
}
if (!GAMES_CSV || !fs.existsSync(GAMES_CSV)) {
  console.error("\n  No game log CSV found. Pass one with --games \"C:\\path\\to\\file.csv\".\n");
  process.exit(1);
}

/* A minimal CSV reader. build_salary.mjs has its own; this is a diagnostic and
 * must not make the builder's parser a shared dependency it can break. */
function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return [];
  const split = line => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map(l => {
    const cells = split(l), row = {};
    head.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

const raw = normalizeGames(parseCsv(fs.readFileSync(GAMES_CSV, "utf8")));
console.log(`  schema "${raw.schema}", ${raw.rows.length.toLocaleString()} rows, ` +
  `${raw.noResult} with no result`);

/* ---------------- the join, exactly as the builder does it ---------------- */

/* Teams are keyed here by the LOG'S OWN NAME STRING, not by a three-letter
 * code. That is the point: the builder's problem is turning a name into a
 * code, so a diagnostic that also reduces names to codes can only reproduce
 * the bug, never show it.
 *
 * It matters for the arithmetic too. An early version keyed on the first three
 * characters, which files "Los Angeles Lakers" and "Los Angeles Clippers"
 * under LOS - two teams merged into one, 164 games in a season, and a median
 * games-played that says nothing about either of them. */
const codeOf = (g, side) => {
  const city = String(g[side + "teamCity"] || "").trim();
  const name = String(g[side + "teamName"] || "").trim();
  const label = (city ? city + " / " : "") + (name || "(blank)");
  return { city, name, code: label };
};

/* What the log actually calls each team, per season. This is the table that
 * answers the question: a name string is how the builder finds a code. */
const namesByYear = new Map();      // year -> Map(nameString -> {gp, w, l, id})
let noDate = 0, noWinner = 0;
for (const g of raw.rows) {
  const year = seasonEndYear(g.gameDate || g.gameDateTimeEst);
  if (!year) { noDate++; continue; }
  if (ONLY_YEAR && year !== ONLY_YEAR) continue;
  const type = String(g.gameType || "Regular Season");
  if (type !== "Regular Season") continue;
  if (!namesByYear.has(year)) namesByYear.set(year, new Map());
  const m = namesByYear.get(year);
  const win = String(g.winner || "");
  if (!win) noWinner++;
  for (const side of ["home", "away"]) {
    const label = codeOf(g, side).code;
    if (!m.has(label)) m.set(label, { gp: 0, w: 0, l: 0, ids: new Set() });
    const rec = m.get(label);
    rec.gp++;
    const id = String(g[side + "teamId"] || "");
    if (id) rec.ids.add(id);
    if (!win) continue;
    if (win === id) rec.w++; else rec.l++;
  }
}

console.log(`  ${noDate} rows had no parseable date; ${noWinner} regular-season rows had no winner`);

/* ---------------- what the payroll side expects ---------------- */

const salaries = JSON.parse(fs.readFileSync(path.join(PD, "salaries.json"), "utf8"));
const payrollYears = new Map();     // year -> Set(team string as salaries.json spells it)
for (const r of (Array.isArray(salaries) ? salaries : [])) {
  const year = parseInt(r.YEAR || r.year, 10);
  const team = String(r.TEAM || r.team || "").trim();
  if (!year || !team) continue;
  if (ONLY_YEAR && year !== ONLY_YEAR) continue;
  if (!payrollYears.has(year)) payrollYears.set(year, new Set());
  payrollYears.get(year).add(team);
}

/* ---------------- the report ---------------- */

const tally = tallyTeamSeasons(raw.rows, (g, side) => codeOf(g, side).code);
const median = medianGpByYear(tally);

console.log("");
console.log("  SEASON BY SEASON");
console.log("  " + "-".repeat(74));
console.log("  year   log teams  median gp   payroll teams   0-0 teams   short teams");

const years = [...new Set([...namesByYear.keys(), ...payrollYears.keys()])].sort();
for (const year of years) {
  const names = namesByYear.get(year) || new Map();
  const pay = payrollYears.get(year) || new Set();
  const want = median.get(year) || 0;
  let zero = 0, short = 0;
  for (const rec of names.values()) {
    if (rec.gp && !rec.w && !rec.l) zero++;
    if (want && rec.gp < want - GP_SLACK) short++;
  }
  const flag = (zero || short || (pay.size && names.size && pay.size !== names.size)) ? "  <--" : "";
  console.log(`  ${year}   ${String(names.size).padStart(9)}  ${String(want).padStart(9)}   ` +
    `${String(pay.size).padStart(13)}   ${String(zero).padStart(9)}   ${String(short).padStart(11)}${flag}`);
}

/* The seasons that are actually broken, in full. A name string is the whole
 * diagnosis, so the flagged years print every label the log uses. */
console.log("");
console.log("  THE FLAGGED SEASONS, NAME BY NAME");
console.log("  " + "-".repeat(74));
let shown = 0;
for (const year of years) {
  const names = namesByYear.get(year) || new Map();
  const want = median.get(year) || 0;
  const bad = [...names.entries()].filter(([, r]) =>
    (r.gp && !r.w && !r.l) || (want && r.gp < want - GP_SLACK));
  if (!bad.length) continue;
  if (!ONLY_YEAR && shown >= 6) {
    console.log(`  ... and more. Pass --year <yyyy> for one season in full.`);
    break;
  }
  shown++;
  console.log(`  ${year}  (median ${want} games, ${names.size} teams in the log, ` +
    `${(payrollYears.get(year) || new Set()).size} payrolls)`);
  for (const [label, r] of bad.sort((a, b) => b[1].gp - a[1].gp)) {
    console.log(`      ${label.padEnd(34)} gp ${String(r.gp).padStart(3)}  ` +
      `${r.w}-${r.l}  ids ${[...r.ids].length}`);
  }
}
if (!shown) console.log("  None. Every team in every season has results and a full schedule.");

console.log("");
console.log("  Paste all of the above. It is team names, codes and counts - no players,");
console.log("  no salaries.");
console.log("");
