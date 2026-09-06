/* How far do the phantom salary rows reach?
 *
 *     node tools/diagnose_salary_impact.mjs
 *
 * Reads; writes nothing, builds nothing, touches no repo.
 *
 * WHAT THIS IS ABOUT
 *
 * salaries.json carries a second 2026 row for 145 players who move for
 * 2026-27, naming the new team with the CURRENT salary copied in. LeBron is
 * LA Lakers $52,627,153 and Philadelphia $52,627,153, when Philadelphia pays
 * him $3,876,529 next season.
 *
 * build_salary.mjs strips those on the way into the Doomscroll cards. That is
 * a filter at one exit. Every other consumer of salaries.json still sees all
 * of them, and anything that SUMS a player's salary rows will double-count the
 * duplicated year - which for a career-earnings figure means the largest
 * salary in the player's career, counted twice.
 *
 * This measures that, and then says which files in nba-player-data read the
 * file, so the guessing about "the comparison tool might be affected" can
 * stop.
 *
 * WHAT IT DOES NOT DO
 *
 * It cannot tell whether a given tool sums or picks. It reports the size of
 * the error IF something sums, and the list of files to look at. Reading those
 * files is the next step, not this script's job.
 */

import fs from "fs";
import path from "path";
import { resolveSource } from "./lib/find.mjs";
import { stripPhantomTeamRows, summariseSeason } from "./lib/salary.mjs";

const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["salaries.json", "rsStats.json", "bio.json"]
});
if (!PD) process.exit(1);

const readJson = p => JSON.parse(fs.readFileSync(path.join(PD, p), "utf8"));
const money = s => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
const usd = n => "$" + Math.round(n).toLocaleString("en-US");
const line = s => console.log(s);

/* The same normalisation build_salary.mjs uses, or teams will not match. */
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

const salaryRows = readJson("salaries.json");
const statRows = readJson("rsStats.json");

const statTeams = new Map();
for (const r of statRows) {
  const y = parseInt(r.YEAR, 10);
  if (!r.PLAYER || !y) continue;
  const k = r.PLAYER + "|" + y;
  if (!statTeams.has(k)) statTeams.set(k, new Set());
  statTeams.get(k).add(teamCode(r.TEAM));
}

const raw = new Map();
for (const r of salaryRows) {
  const y = parseInt(r.YEAR, 10);
  const amt = money(r.SALARY);
  if (!r.PLAYER || !y || !amt) continue;
  const k = r.PLAYER + "|" + y;
  if (!raw.has(k)) raw.set(k, []);
  raw.get(k).push({ team: teamCode(r.TEAM), amount: amt });
}

line("");
line("  " + path.join(PD, "salaries.json"));
line("  " + salaryRows.length.toLocaleString("en-US") + " rows, " +
     raw.size.toLocaleString("en-US") + " player-seasons");
line("  " + "-".repeat(66));

/* ---- 1. what a naive sum gets wrong ----
 *
 * "Naive" means adding up every row, which is what a career-earnings figure
 * built straight off this file would do. */

const naiveCareer = new Map(), cleanCareer = new Map();
let affectedSeasons = 0;
for (const [k, rows] of raw) {
  const player = k.slice(0, k.lastIndexOf("|"));
  const naive = rows.reduce((n, r) => n + r.amount, 0);
  const clean = summariseSeason(stripPhantomTeamRows(rows, statTeams.get(k), parseInt(k.slice(k.lastIndexOf("|") + 1), 10))).total;
  if (naive !== clean) affectedSeasons++;
  naiveCareer.set(player, (naiveCareer.get(player) || 0) + naive);
  cleanCareer.set(player, (cleanCareer.get(player) || 0) + clean);
}

const off = [];
for (const [player, naive] of naiveCareer) {
  const clean = cleanCareer.get(player) || 0;
  if (naive !== clean) off.push({ player, naive, clean, gap: naive - clean });
}
off.sort((a, b) => b.gap - a.gap);

line("  IF ANYTHING SUMS SALARY ROWS PER PLAYER");
line("  player-seasons that would be counted wrong    " + affectedSeasons);
line("  players whose career total would be wrong     " + off.length);
line("  total overstatement across all of them        " +
     usd(off.reduce((n, r) => n + r.gap, 0)));
if (off.length) {
  line("");
  line("  the ten largest, naive vs correct:");
  for (const r of off.slice(0, 10)) {
    line("     " + r.player.padEnd(26) + usd(r.naive).padStart(16) + "   ->" +
         usd(r.clean).padStart(16) + "   (+" + usd(r.gap) + ")");
  }
}

/* ---- 2. who reads the file ----
 *
 * A filename match is a lead, not a verdict: a file listed here might read
 * salaries.json and only ever pick a single season, which is unaffected. The
 * point is to replace "the comparison tool might be affected" with a list
 * short enough to actually read. */

line("");
line("  " + "-".repeat(66));
line("  FILES IN nba-player-data THAT MENTION salaries.json OR SALARY");

const hits = [];
function scan(dir, depth) {
  if (depth > 2) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scan(full, depth + 1); continue; }
    if (!/\.(html|js|mjs|py|json)$/i.test(e.name)) continue;
    if (/^(salaries|rsStats|poStats|bio|awards|awardVotes|nba2k)\.json$/i.test(e.name)) continue;
    let txt = "";
    try {
      if (fs.statSync(full).size > 8 * 1024 * 1024) continue;
      txt = fs.readFileSync(full, "utf8");
    } catch (e2) { continue; }
    const readsFile = /salaries\.json/i.test(txt);
    const sums = /SALARY/.test(txt) && /(reduce|\+=|sum)/i.test(txt);
    if (readsFile || sums) {
      hits.push({ file: path.relative(PD, full), readsFile, sums });
    }
  }
}
scan(PD, 0);

if (!hits.length) {
  line("     none found.");
} else {
  for (const h of hits) {
    line("     " + (h.readsFile ? "reads salaries.json" : "                   ") +
         (h.sums ? "  sums a SALARY field" : "                      ") + "  " + h.file);
  }
  line("");
  line("  A file flagged as summing may be summing something else entirely.");
  line("  Read the ones that do both before concluding anything.");
}

line("");
line("  Paste this block back.");
line("");
