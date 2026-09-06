/* Salary storytelling.
 *
 *     node tools/build_salary.mjs --local <nba-player-data> <capCsv>
 *
 * WHAT THIS REPLACES
 *
 * One template: "X made $Y, which was Z% of the cap." True, repeatable, and
 * after three of them the reader knows exactly what the next one says. The same
 * three files support a lot more than that.
 *
 * Ten families in four groups: what a player's production cost, how a payroll
 * was distributed, how two eras compare once the cap is accounted for, and who
 * has earned the most by country and draft class.
 *
 * THE GUARDS MATTER MORE THAN THE FAMILIES
 *
 * A cost-per-stat metric is a division, and division invites nonsense. Four
 * points in twenty minutes makes anyone the most expensive scorer in history;
 * a ten-day contract makes anyone the best value. Every rate family here
 * carries a minimum games and minutes floor, refuses a zero denominator, and
 * prints its denominator on the card so the reader can see what it is a rate
 * of. Where a season is split by a trade the card says so, because the salary
 * is the season's and the stats may not be.
 *
 * Cross-era comparisons use cap share, never raw dollars: $3m in 1993 and $3m
 * in 2024 are different facts, and the second one is not a story.
 *
 * All stats here are REGULAR SEASON. rsStats.json is the only per-season stat
 * source in nba-player-data, and a card that mixed playoff production into a
 * per-dollar rate without saying so would be quietly wrong.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";
import { stripPhantomTeamRows, summariseSeason, MIN_PAYROLL_OF_CAP } from "./lib/salary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const argv = process.argv.slice(2);
/* Both sources are found rather than typed. Run it with no arguments at all:
 *
 *     node tools/build_salary.mjs
 *
 * --local still takes them explicitly when the search picks the wrong one:
 *
 *     node tools/build_salary.mjs --local <nba-player-data> <capCsv>
 *
 * This pool went unbuilt for weeks because nobody had the path to the cap CSV
 * to hand, which is a poor reason for 68 cards not to exist. */
const li = argv.indexOf("--local");
const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["salaries.json", "rsStats.json", "bio.json"]
});
const CAP_CSV = PD && resolveSource("the salary cap table", {
  explicit: li >= 0 ? argv[li + 2] : null,
  files: ["salary_cap_info.csv"]
});
if (!PD || !CAP_CSV) process.exit(1);
const oi = argv.indexOf("--out");
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/salary-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));

/* ---------------- thresholds ---------------- */

const MIN_GP = 58;             // a rate over fewer games is a sample, not a season
const MIN_MIN = 1200;          // and not a bench role either
const MIN_SEASON = 1991;       // salaries.json starts here
const MIN_PAYROLL_PLAYERS = 8; // a roster row count below this is incomplete data
/* A roster COUNT cannot tell you a payroll is complete, and believing it could
 * is how "Luka Doncic was 47% of the LAL payroll in 2025-26" shipped. Eleven
 * men cleared the count above; the book they summed to was $96.8M when the
 * Lakers actually paid $197.1M, so the true share was 23%.
 *
 * What emptied that book is handled at source now - see stripPhantomTeamRows
 * in ./lib/salary.mjs - but the guard stays, because it is about the
 * arithmetic and not about any one cause. Every NBA team must spend at least
 * 90% of the cap or write a cheque for the shortfall, so a team-season summing
 * to less than that is missing people, whatever dropped them. The card was
 * already printing the cap two lines above the claim it contradicted.
 *
 * MIN_PAYROLL_OF_CAP lives in ./lib/salary.mjs, shared with the diagnostic. */
const TOP_N = 5;
const MAX_PER_PLAYER = 3;
const MAX_PER_FAMILY_SHARE = 0.18;

/* ---------------- load ---------------- */

const money = s => Number(String(s || "").replace(/[^0-9.]/g, "")) || 0;
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };

const salaryRows = readJson(path.join(PD, "salaries.json"));
const statRows = readJson(path.join(PD, "rsStats.json"));
const bioRows = readJson(path.join(PD, "bio.json"));

/* Cap by season-ending year. Both datasets use the season's ending year
 * ("2022" is 2021-22, checked against LeBron's $41,180,544 and his 30.3 a
 * game), so the CSV's "2021-2022" maps to 2022. */
const caps = new Map();
for (const line of fs.readFileSync(CAP_CSV, "utf8").split(/\r?\n/).slice(1)) {
  const cells = line.match(/"([^"]*)"/g);
  if (!cells || cells.length < 2) continue;
  const season = cells[0].replace(/"/g, "");
  const cap = money(cells[1]);
  const end = parseInt(String(season).split("-")[1], 10);
  if (end && cap) caps.set(end, cap);
}

const bio = new Map();
for (const b of bioRows) if (b.PLAYER) bio.set(b.PLAYER, b);

/* Team codes are not consistent across the file: seasons up to 2025 use "LAL",
 * 2026 uses "LA Lakers". Normalised so one franchise is one payroll bucket. */
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

/* A player-season's salary.
 *
 * THREE THINGS PRODUCE MULTIPLE ROWS and they need different treatment.
 *
 *   1. A genuine mid-season trade. Two rows, two DIFFERENT amounts summing to
 *      the season. Summed, and the season marked traded.
 *
 *   2. The same salary written twice under one team. Counted once.
 *
 *   3. NEXT season's team carrying THIS season's money. salaries.json ends at
 *      2026 with no 2027 season, and for 145 players who move for 2026-27 it
 *      appends a second 2026 row naming the new team with the current salary
 *      copied in. LeBron James is LA Lakers $52,627,153 and Philadelphia
 *      $52,627,153; he is a 76er next season and is paid $3,876,529 there.
 *
 * Case 3 used to be mistaken for case 2 and the season was discarded as
 * ambiguous, which cost the 2025-26 payroll cards more than half a roster.
 * stripPhantomTeamRows removes those rows before any of this runs, using
 * rsStats as the check on who actually played where. What reaches the code
 * below is cases 1 and 2 only.
 *
 * Worth reporting upstream: this is a bug in nba-player-data, not a modelling
 * choice, and the same rows will be wrong again next season. */
const rawRows = new Map();
for (const r of salaryRows) {
  const year = parseInt(r.YEAR, 10);
  if (!r.PLAYER || !year || year < MIN_SEASON) continue;
  const amt = money(r.SALARY);
  if (!amt) continue;
  const key = r.PLAYER + "|" + year;
  if (!rawRows.has(key)) rawRows.set(key, []);
  rawRows.get(key).push({ team: teamCode(r.TEAM), amount: amt });
}

/* The stats are read BEFORE the salaries are interpreted, because who a man
 * played for is what tells a real second team from a phantom one. They used to
 * be read after, which is why the phantom rows had nothing to be checked
 * against and got discarded as unknowable instead. */
const stats = new Map();        // "PLAYER|YEAR" -> merged season line
const statTeams = new Map();    // "PLAYER|YEAR" -> Set of teams he played for
for (const r of statRows) {
  const year = parseInt(r.YEAR, 10);
  if (!r.PLAYER || !year) continue;
  const key = r.PLAYER + "|" + year;
  const gp = num(r.GP);
  if (!statTeams.has(key)) statTeams.set(key, new Set());
  statTeams.get(key).add(teamCode(r.TEAM));
  if (!stats.has(key)) {
    stats.set(key, { player: r.PLAYER, year, team: r.TEAM, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tpm: 0, rows: 0 });
  }
  const e = stats.get(key);
  /* A traded player has a row per team here as well; summing gives the season
   * totals, which is what a season salary should be divided by. */
  e.gp += gp; e.min += num(r.MIN); e.pts += num(r.PTS);
  e.reb += num(r.REB); e.ast += num(r.AST); e.stl += num(r.STL);
  e.blk += num(r.BLK); e.tpm += num(r["3P"]); e.rows++;
}

/* Now the salaries can be interpreted, with the phantom rows taken out first. */
const pay = new Map();
let dupSeasons = 0, phantomRows = 0, phantomSeasons = 0;
for (const [key, rows] of rawRows) {
  const [player, y] = key.split("|");
  const year = parseInt(y, 10);
  const cleaned = stripPhantomTeamRows(rows, statTeams.get(key), year);
  if (cleaned.length !== rows.length) {
    phantomRows += rows.length - cleaned.length;
    phantomSeasons++;
  }
  const s = summariseSeason(cleaned, year);
  if (s.teamAmbiguous) dupSeasons++;
  pay.set(key, { player, year, ...s });
}
if (phantomSeasons) {
  console.log(`  salaries: dropped ${phantomRows} row(s) across ${phantomSeasons} player-seasons ` +
    `naming a team the stats do not have, at a salary copied from another row ` +
    `— next season's move written into this season. Report upstream: it is a ` +
    `bug in nba-player-data and the same rows recur every year.`);
}

const seasons = [];             // joined, one per player-season
for (const [key, p] of pay) {
  const s = stats.get(key);
  if (!s) continue;
  const cap = caps.get(p.year);
  seasons.push({
    player: p.player, year: p.year,
    team: s.team || (p.teams[0] || {}).team || "",
    traded: p.traded,
    teamAmbiguous: p.teamAmbiguous,
    teams: p.teams,
    salary: p.total,
    capPct: cap ? p.total / cap * 100 : null,
    cap,
    gp: s.gp, min: s.min, pts: s.pts, reb: s.reb, ast: s.ast,
    stl: s.stl, blk: s.blk, tpm: s.tpm,
    ppg: s.gp ? s.pts / s.gp : 0
  });
}
console.log(`${pay.size} paid player-seasons, ${seasons.length} joined to a stat line, ` +
  `${caps.size} seasons of cap data`);
console.log(`  ${dupSeasons} player-seasons list one salary under more than one team ` +
  `(counted once; excluded from payroll cards)`);

/* Rate-eligible: enough of a season that a per-dollar figure means something,
 * and a denominator that is not zero. */
const rateOk = s => s.gp >= MIN_GP && s.min >= MIN_MIN && s.capPct !== null;

/* ---------------- helpers ---------------- */

const fmtMoney = n => n >= 1e9
  ? "$" + (n / 1e9).toFixed(1) + "B"
  : n >= 1e6
    ? "$" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M"
    : "$" + Math.round(n).toLocaleString("en-US");
const plural = (n, one) => n + " " + one + (n === 1 ? "" : "s");
const fmtRate = n => n >= 1000 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(0);
const seasonLabel = y => (y - 1) + "-" + String(y).slice(2);
const era = y => (y - (y % 10)) + "s";
const faceFor = name => "data/faces/" + String(name).toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".png";

/* Every card links somewhere useful. The salary tool's own route is the one
 * thing in this file that is not verifiable from here, so it is defined once
 * and flagged in the backlog rather than guessed at in ten places. */
const SALARY_TOOL = "https://hoopsmatic.com/salaries";
const playerUrl = name => SALARY_TOOL + "?player=" + encodeURIComponent(name);

const cards = [];
function add(family, quality, tags, payload, storyKey) {
  cards.push({
    id: "salary-" + family + "-" + cards.length,
    type: payload.rows ? "salaryrank" : "salary",
    tab: ["vault"],
    tags: Object.assign({ content_type: "salary", teams: [], era: "2020s", category: "salary" }, tags),
    quality_score: Math.round(Math.max(0, Math.min(1, quality)) * 100) / 100,
    story_family: "salary:" + family,
    story_key: "salary|" + family + "|" + storyKey,
    payload
  });
}

/* ---------------- family: what production cost ---------------- */

const rateSeasons = seasons.filter(rateOk);

function costFamily(key, label, statKey, unit, minStat, best) {
  const pool = rateSeasons.filter(s => s[statKey] >= minStat);
  if (!pool.length) return;
  const scored = pool.map(s => ({ s, rate: s.salary / s[statKey] }))
    .sort((a, b) => best === "low" ? a.rate - b.rate : b.rate - a.rate);
  for (const { s, rate } of scored.slice(0, 6)) {
    add(key, best === "low" ? 0.72 : 0.66,
      { players: [s.player], teams: [s.team], era: era(s.year) },
      {
        headline: best === "low"
          ? `${s.player} cost ${fmtRate(rate)} per ${unit} in ${seasonLabel(s.year)}`
          : `${s.player}'s ${unit}s cost ${fmtRate(rate)} each in ${seasonLabel(s.year)}`,
        player: s.player, img: faceFor(s.player), team: s.team,
        season: seasonLabel(s.year),
        salary: fmtMoney(s.salary),
        cap_pct: s.capPct.toFixed(1),
        cap: fmtMoney(s.cap),
        detail: `${fmtMoney(s.salary)} across ${s.gp} regular-season games, ` +
                `and ${s[statKey].toLocaleString("en-US")} ${unit}${s[statKey] === 1 ? "" : "s"}. ` +
                `That is ${fmtRate(rate)} each.` +
                (s.traded ? ` His season was split between ${s.teams.length} teams; the salary is the season's total.` : ""),
        note: `Regular season only. ${s.gp} games, ${Math.round(s.min).toLocaleString("en-US")} minutes.`,
        url: playerUrl(s.player), cta: "Salary history"
      }, `${label}|${s.player}|${s.year}`);
  }
}

costFamily("cheap-points", "cheap-pts", "pts", "point", 800, "low");
costFamily("dear-points", "dear-pts", "pts", "point", 200, "high");
costFamily("cheap-assists", "cheap-ast", "ast", "assist", 300, "low");
costFamily("cheap-boards", "cheap-reb", "reb", "rebound", 400, "low");
costFamily("cheap-threes", "cheap-3pm", "tpm", "three", 150, "low");

/* Bargain scoring seasons, by cap share rather than dollars so 1994 and 2024
 * can sit on the same list. */
for (const tier of [30, 25, 20]) {
  const pool = rateSeasons.filter(s => s.ppg >= tier).sort((a, b) => a.capPct - b.capPct);
  for (const s of pool.slice(0, 4)) {
    add("bargain-scoring", 0.8,
      { players: [s.player], teams: [s.team], era: era(s.year) },
      {
        headline: `${s.player} scored ${s.ppg.toFixed(1)} a game on ${s.capPct.toFixed(1)}% of the cap`,
        player: s.player, img: faceFor(s.player), team: s.team,
        season: seasonLabel(s.year), salary: fmtMoney(s.salary),
        cap_pct: s.capPct.toFixed(1), cap: fmtMoney(s.cap), bargain: true,
        detail: `A ${tier}-point season for ${fmtMoney(s.salary)} against a ${fmtMoney(s.cap)} cap. ` +
                `${s.gp} games, ${s.pts.toLocaleString("en-US")} points.` +
                (s.traded ? ` Traded mid-season; the salary is the season's total.` : ""),
        note: `Cap share rather than dollars, so seasons decades apart can be compared.`,
        url: playerUrl(s.player), cta: "Salary history"
      }, `bargain-${tier}|${s.player}|${s.year}`);
  }
}

/* ---------------- family: payroll shape ---------------- */

const rosters = new Map();      // "TEAM|YEAR" -> rows
for (const s of seasons) {
  // Whose book was he on? If the data says two teams at full salary, nobody knows.
  if (s.teamAmbiguous) continue;
  for (const t of s.teams) {
    const key = t.team + "|" + s.year;
    if (!rosters.has(key)) rosters.set(key, { team: t.team, year: s.year, men: [] });
    rosters.get(key).men.push({ player: s.player, amount: t.amount, pts: s.pts, gp: s.gp });
  }
}

/* Two gates, and the second is the one that matters. Count first because it is
 * cheap, then the book against that season's cap. A season with no cap on file
 * cannot be checked, so it is dropped rather than trusted: an unverifiable
 * share is the exact thing this guard exists to stop publishing. */
const payrollAll = [...rosters.values()].filter(r => r.men.length >= MIN_PAYROLL_PLAYERS);
for (const r of payrollAll) {
  r.men.sort((a, b) => b.amount - a.amount);
  r.total = r.men.reduce((n, m) => n + m.amount, 0);
  r.topShare = r.total ? r.men[0].amount / r.total : 0;
  r.top3Share = r.total ? (r.men.slice(0, 3).reduce((n, m) => n + m.amount, 0)) / r.total : 0;
  r.cap = caps.get(r.year) || null;
  r.ofCap = r.cap ? r.total / r.cap : null;
}

const payrolls = payrollAll.filter(r => r.ofCap !== null && r.ofCap >= MIN_PAYROLL_OF_CAP);
{
  const dropped = payrollAll.filter(r => payrolls.indexOf(r) < 0);
  const marginal = payrolls.filter(r => r.ofCap < 0.9)
    .sort((a, b) => a.ofCap - b.ofCap);
  if (dropped.length) {
    const worst = dropped.slice()
      .sort((a, b) => (a.ofCap === null ? -1 : b.ofCap === null ? 1 : a.ofCap - b.ofCap))
      .slice(0, 6)
      .map(r => `${r.team} ${r.year} ${r.ofCap === null ? "no cap on file" :
        (r.ofCap * 100).toFixed(0) + "% of cap, " + r.men.length + " men"}`);
    console.log(`  payroll cards: dropped ${dropped.length} team-seasons whose book ` +
      `is under ${(MIN_PAYROLL_OF_CAP * 100).toFixed(0)}% of the cap — the dataset is ` +
      `missing players and the share would be wrong:\n    ${worst.join("\n    ")}`);
  }
  if (marginal.length) {
    console.log(`  payroll cards: ${marginal.length} kept between ${(MIN_PAYROLL_OF_CAP * 100).toFixed(0)}% ` +
      `and the 90% floor, worth an eye:\n    ` +
      marginal.slice(0, 6).map(r => `${r.team} ${r.year} ${(r.ofCap * 100).toFixed(0)}%`).join(", "));
  }
}

/* Most top-heavy payrolls: one man taking the largest share of his team's book. */
for (const r of payrolls.slice().sort((a, b) => b.topShare - a.topShare).slice(0, 6)) {
  const m = r.men[0];
  add("payroll-concentration", 0.76,
    { players: [m.player], teams: [r.team], era: era(r.year) },
    {
      headline: `${m.player} was ${(r.topShare * 100).toFixed(0)}% of the ${r.team} payroll in ${seasonLabel(r.year)}`,
      player: m.player, img: faceFor(m.player), team: r.team,
      season: seasonLabel(r.year), salary: fmtMoney(m.amount),
      cap_pct: caps.get(r.year) ? (m.amount / caps.get(r.year) * 100).toFixed(1) : "",
      cap: caps.get(r.year) ? fmtMoney(caps.get(r.year)) : "",
      /* Not rendered. Recorded so the shipped pool can be checked without a
       * second copy of the cap table living in a test file: the number that
       * decided this card is a fact is carried by the card itself. */
      of_cap: Math.round(r.ofCap * 1000) / 1000,
      paid_players: r.men.length,
      detail: `${fmtMoney(m.amount)} of a ${fmtMoney(r.total)} book across ${r.men.length} paid players. ` +
              `The next-highest was ${r.men[1].player} at ${fmtMoney(r.men[1].amount)}.`,
      note: `Payroll here is the sum of the salaries in this dataset for that team and season, ` +
            `not a cap sheet: it excludes dead money and players not listed.`,
      url: playerUrl(m.player), cta: "Salary history"
    }, `concentration|${r.team}|${r.year}`);
}

/* The top five earners on one roster, as a ranked card. */
for (const r of payrolls.slice().sort((a, b) => b.total - a.total).slice(0, 8)) {
  add("payroll-top5", 0.7,
    { players: r.men.slice(0, TOP_N).map(m => m.player), teams: [r.team], era: era(r.year) },
    {
      headline: `${r.team}'s five biggest salaries in ${seasonLabel(r.year)}`,
      subtitle: `${fmtMoney(r.total)} across ${r.men.length} paid players`,
      // Not rendered; see the note on the concentration card above.
      of_cap: Math.round(r.ofCap * 1000) / 1000,
      paid_players: r.men.length,
      rows: r.men.slice(0, TOP_N).map((m, i) => ({
        rank: i + 1, name: m.player, img: faceFor(m.player),
        value: fmtMoney(m.amount),
        sub: (m.amount / r.total * 100).toFixed(0) + "% of the payroll"
      })),
      note: `Sum of listed salaries for that team and season, not a cap sheet.`,
      url: SALARY_TOOL, cta: "Salary tool"
    }, `top5|${r.team}|${r.year}`);
}

/* The best-paid man was not the best scorer. Only where both are on the same
 * roster row, and only where the gap is not trivial. */
for (const r of payrolls) {
  if (r.men.length < 10) continue;
  const paid = r.men[0];
  const scorer = r.men.slice().sort((a, b) => b.pts - a.pts)[0];
  if (!scorer.pts || scorer.player === paid.player) continue;
  /* Gordon Hayward earned $29.7m and scored two points in 2017-18, because he
   * broke his leg five minutes into the season. That is a real fact and a
   * terrible payroll card: "the highest-paid player was not the leading scorer"
   * is trivially true of anyone who did not play. An injury story deserves to
   * be written as one, not smuggled in under a payroll headline. */
  if (paid.gp < 40) continue;
  if (paid.pts / Math.max(1, scorer.pts) > 0.72) continue;   // close enough is not a story
  r._gap = 1 - paid.pts / Math.max(1, scorer.pts);
  r._paid = paid; r._scorer = scorer;
}
for (const r of payrolls.filter(x => x._gap).sort((a, b) => b._gap - a._gap).slice(0, 6)) {
  add("paid-not-scoring", 0.68,
    { players: [r._paid.player, r._scorer.player], teams: [r.team], era: era(r.year) },
    {
      headline: `${r.team}'s highest-paid player in ${seasonLabel(r.year)} was not their leading scorer`,
      player: r._paid.player, img: faceFor(r._paid.player), team: r.team,
      season: seasonLabel(r.year), salary: fmtMoney(r._paid.amount),
      cap_pct: caps.get(r.year) ? (r._paid.amount / caps.get(r.year) * 100).toFixed(1) : "",
      cap: caps.get(r.year) ? fmtMoney(caps.get(r.year)) : "",
      detail: `${r._paid.player} earned ${fmtMoney(r._paid.amount)} and scored ` +
              `${r._paid.pts.toLocaleString("en-US")} points in ${plural(r._paid.gp, "game")}. ` +
              `${r._scorer.player} scored ${r._scorer.pts.toLocaleString("en-US")} on ` +
              `${fmtMoney(r._scorer.amount)}.`,
      note: `Total regular-season points, not per game. Salary is what the dataset lists for ` +
            `that team and season.`,
      url: playerUrl(r._paid.player), cta: "Salary history"
    }, `paidnotscoring|${r.team}|${r.year}`);
}

/* ---------------- family: cross-era ---------------- */

for (const s of seasons.filter(x => x.capPct !== null).sort((a, b) => b.capPct - a.capPct).slice(0, 6)) {
  add("cap-share-record", 0.84,
    { players: [s.player], teams: [s.team], era: era(s.year) },
    {
      headline: s.capPct > 100
        ? `${s.player} was paid more than the entire salary cap in ${seasonLabel(s.year)}`
        : `${s.player} took ${s.capPct.toFixed(1)}% of the entire salary cap in ${seasonLabel(s.year)}`,
      player: s.player, img: faceFor(s.player), team: s.team,
      season: seasonLabel(s.year), salary: fmtMoney(s.salary),
      cap_pct: s.capPct.toFixed(1), cap: fmtMoney(s.cap),
      detail: `${fmtMoney(s.salary)} against a cap of ${fmtMoney(s.cap)}` +
              (s.capPct > 100
                ? ` - ${s.capPct.toFixed(0)}% of it. A team could exceed the cap to re-sign its own players, which is how that was legal.`
                : `.`) +
              ` Cap share is the only fair way to compare pay across eras: the same dollars ` +
              `mean different things thirty years apart.`,
      note: `Regular-season salary as listed, against that season's cap.`,
      url: playerUrl(s.player), cta: "Salary history"
    }, `capshare|${s.player}|${s.year}`);
}

/* ---------------- family: groups ---------------- */

function groupEarnings(key, label, pick, minPlayers) {
  const totals = new Map();
  for (const [k, p] of pay) {
    const g = pick(p.player);
    if (!g) continue;
    if (!totals.has(g)) totals.set(g, { group: g, total: 0, players: new Map() });
    const e = totals.get(g);
    e.total += p.total;
    e.players.set(p.player, (e.players.get(p.player) || 0) + p.total);
  }
  const rows = [...totals.values()].filter(g => g.players.size >= minPlayers)
    .sort((a, b) => b.total - a.total).slice(0, TOP_N);
  if (rows.length < TOP_N) return;
  add(key, 0.74, { players: [], teams: [], era: "all-time" },
    {
      headline: label,
      subtitle: `Career earnings since 1991, as listed in the salary dataset`,
      rows: rows.map((g, i) => {
        const top = [...g.players.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          rank: i + 1, name: g.group, img: "",
          value: fmtMoney(g.total),
          sub: `${g.players.size} players · most: ${top[0]} ${fmtMoney(top[1])}`
        };
      }),
      note: `Raw dollars, not cap-adjusted, so recent players weigh more heavily. ` +
            `Only seasons from 1991 onward are in the data.`,
      url: SALARY_TOOL, cta: "Salary tool"
    }, key);
}

groupEarnings("earnings-by-country", "Which countries' players have earned the most",
  name => { const b = bio.get(name); return b && b.NATIONALITY ? b.NATIONALITY : null; }, 5);
groupEarnings("earnings-by-draft", "Which draft classes have earned the most",
  name => { const b = bio.get(name); return b && b.DRAFT ? b.DRAFT + " draft class" : null; }, 10);

/* ---------------- thin and verify ---------------- */

const perPlayer = new Map(), perFamily = new Map();
const kept = [];
const rej = { player: 0, family: 0 };
/* Round-robin, as in build_oddities: taking best-first let one family fill the
 * pool before its share cap engaged. */
const byFamily = new Map();
for (const c of cards) {
  if (!byFamily.has(c.story_family)) byFamily.set(c.story_family, []);
  byFamily.get(c.story_family).push(c);
}
for (const l of byFamily.values()) l.sort((a, b) => b.quality_score - a.quality_score);
const ordered = [];
for (let i = 0; ; i++) {
  let took = false;
  for (const l of byFamily.values()) if (i < l.length) { ordered.push(l[i]); took = true; }
  if (!took) break;
}

for (const c of ordered) {
  const lead = (c.tags.players || [])[0] || c.story_family;
  if ((perPlayer.get(lead) || 0) >= MAX_PER_PLAYER) { rej.player++; continue; }
  if (kept.length >= 20 && (perFamily.get(c.story_family) || 0) / kept.length >= MAX_PER_FAMILY_SHARE) { rej.family++; continue; }
  perPlayer.set(lead, (perPlayer.get(lead) || 0) + 1);
  perFamily.set(c.story_family, (perFamily.get(c.story_family) || 0) + 1);
  kept.push(c);
}

let bad = 0;
for (const c of kept) {
  const p = c.payload;
  if (!p.headline) { console.error(`  ${c.id}: no headline`); bad++; }
  if (/NaN|undefined|Infinity|\$0 per|\bper 0\b/.test(p.headline + " " + (p.detail || ""))) {
    console.error(`  ${c.id}: bad arithmetic -> ${p.headline}`); bad++;
  }
  if (p.rows && p.rows.some(r => !r.value || /NaN|undefined/.test(r.value))) {
    console.error(`  ${c.id}: bad row value`); bad++;
  }
  if (!p.note) { console.error(`  ${c.id}: no denominator note`); bad++; }
}
if (bad) { console.error(`FAILED: ${bad} problems`); process.exit(1); }

console.log(`\n${cards.length} candidates -> ${kept.length} cards`);
[...perFamily.entries()].sort((a, b) => b[1] - a[1])
  .forEach(([f, n]) => console.log(`  ${f.replace("salary:", "").padEnd(22)} ${String(n).padStart(3)}  (${Math.round(n / kept.length * 100)}%)`));
console.log(`  thinned: ${rej.player} player at cap, ${rej.family} family at cap`);

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "nba-player-data salaries + rsStats + bio, with the salary cap table",
  cards: kept
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
