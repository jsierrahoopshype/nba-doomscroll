/* Franchise droughts from the official award voting, 1956 onwards.
 *
 *     node tools/build_award_history.mjs
 *     node tools/build_award_history.mjs --local "C:\path\to\nba-player-data"
 *
 * WHY THIS EXISTS SEPARATELY FROM build_oddities.mjs
 *
 * That builder reads the Media Vote Tracker - individual voters' ballots over
 * a recent window - so every historical claim it makes has to be hedged as "in
 * the N seasons this tracker covers". Jorge's point was blunt and correct:
 * nba-player-data already carries the official results.
 *
 * A probe (tools/awardvotes_shape.mjs) says what is actually in there:
 *
 *   3,437 rows, columns PLAYER / AWARD / RNK / YEAR, no team
 *   MVP        1,071 rows   1956-2026   71 seasons
 *   MIP          850 rows   1986-2026   41 seasons
 *   DPOY         614 rows   1983-2026   44 seasons
 *   Sixth Man    487 rows   1984-2025   42 seasons
 *   ROY          328 rows   1964-2026   62 seasons
 *   Clutch        51 rows   2023-2026    4 seasons
 *   Hustle        24 rows   2017-2026    8 seasons
 *   RNK 1 to 32, every row parses
 *
 * Seventy-one seasons of MVP voting is what turns "no Kings player in the 12
 * seasons this tracker covers" into "the first Kings player to receive an MVP
 * vote since 1993". That is the whole point of this file.
 *
 * THE LABEL BUG THE PROBE FOUND
 *
 * There is an eighth award: "Sixth", 12 rows, 2026 only. It is not an award -
 * it is "Sixth Man" with the second word lost, and it splits that award's most
 * recent season off into a one-season history of its own. Left alone it would
 * make Sixth Man look as though it ended in 2025 and make "Sixth" fail the
 * window gate, so 2026 would simply vanish from that award. Normalised here
 * and worth reporting upstream, because it will be wrong again next season.
 *
 * NO TEAM ON THE ROW, SO THE JOIN STAYS
 *
 * The probe settled that too. Franchise comes from rsStats, by the plurality of
 * games played, refusing an exact tie - see lib/vote_context.mjs for why a
 * guess there is the one error that makes the card a lie rather than dull.
 *
 * RECENCY, BECAUSE 71 SEASONS IS A LOT OF 1970s
 *
 * "You keep giving me stuff from very old eras." Same lever as the salary
 * pool: quality is scaled by how long ago the season was, so a 1974 drought
 * has to be a better story than a 2024 one to beat it, rather than winning on
 * the strength of there being more old seasons than new ones.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";
import { teamByPlayerSeason, voteHistory, teamVoteDrought } from "./lib/vote_context.mjs";
import { recencyFactor } from "./lib/salary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const oi = argv.indexOf("--out");

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["awardVotes.json", "rsStats.json"]
});
if (!PD) process.exit(1);
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/award-history-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

const readJson = p => JSON.parse(fs.readFileSync(path.join(PD, p), "utf8"));

/* ---------------- labels ---------------- */

/* The award as the data spells it, mapped to how a card should say it. "Sixth"
 * is the truncation the probe found; the rest are the file's own short codes,
 * which read fine in a sentence. */
const AWARD_FIX = { "Sixth": "Sixth Man" };
const SAY = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  MIP: "Most Improved Player", "Sixth Man": "Sixth Man of the Year",
  Clutch: "Clutch Player of the Year", Hustle: "the Hustle Award"
};
const say = a => SAY[a] || a;

const NICK = {
  ATL: "Hawks", BOS: "Celtics", BKN: "Nets", CHA: "Hornets", CHI: "Bulls",
  CLE: "Cavaliers", DAL: "Mavericks", DEN: "Nuggets", DET: "Pistons",
  GSW: "Warriors", HOU: "Rockets", IND: "Pacers", LAC: "Clippers",
  LAL: "Lakers", MEM: "Grizzlies", MIA: "Heat", MIL: "Bucks",
  MIN: "Timberwolves", NOP: "Pelicans", NYK: "Knicks", OKC: "Thunder",
  ORL: "Magic", PHI: "76ers", PHX: "Suns", POR: "Trail Blazers",
  SAC: "Kings", SAS: "Spurs", TOR: "Raptors", UTA: "Jazz", WAS: "Wizards",
  /* Seventy-one seasons reaches well past the current thirty. These are the
   * codes rsStats uses for franchises that have moved or been renamed, and a
   * headline reading "the first NJN player" would be worse than the table. */
  SEA: "SuperSonics", NJN: "Nets", VAN: "Grizzlies", CHH: "Hornets",
  NOH: "Hornets", NOK: "Hornets", WSB: "Bullets", CAP: "Bullets",
  BAL: "Bullets", KCK: "Kings", KCO: "Kings", CIN: "Royals",
  SDC: "Clippers", BUF: "Braves", SFW: "Warriors", PHW: "Warriors",
  STL: "Hawks", MLH: "Hawks", SYR: "Nationals", FTW: "Pistons",
  ROC: "Royals", MNL: "Lakers", CHP: "Packers", CHZ: "Zephyrs",
  NYN: "Nets", SDR: "Rockets", NOJ: "Jazz", UTH: "Jazz", PHO: "Suns",
  BRK: "Nets", CHO: "Hornets"
};
const nick = code => NICK[code] || code;

/* ---------------- load ---------------- */

const votes = readJson("awardVotes.json");
const statRows = readJson("rsStats.json");

const teamOf = teamByPlayerSeason(statRows, t => String(t).trim().toUpperCase());
console.log(`${votes.length} vote rows, ${teamOf.size} player-seasons resolved to one franchise`);

/* award -> year -> [{ player, rnk }] */
const byAwardYear = new Map();
let fixed = 0, unusable = 0;
for (const r of votes) {
  const rawAward = String(r.AWARD || "").trim();
  if (!rawAward) { unusable++; continue; }
  const award = AWARD_FIX[rawAward] || rawAward;
  if (award !== rawAward) fixed++;
  const year = parseInt(r.YEAR, 10);
  const rnk = parseInt(r.RNK, 10);
  if (!r.PLAYER || !year) { unusable++; continue; }
  const key = award + "|" + year;
  if (!byAwardYear.has(key)) byAwardYear.set(key, { award, year, rows: [] });
  byAwardYear.get(key).rows.push({ player: r.PLAYER, rnk: isFinite(rnk) ? rnk : null });
}
if (fixed) {
  console.log(`labels: ${fixed} rows said "Sixth" rather than "Sixth Man" - merged. ` +
    `That is a bug in awardVotes.json and will recur.`);
}
if (unusable) console.log(`${unusable} rows had no award, player or year`);

/* ---------------- two histories ---------------- */

/* TOP FIVE IS A DIFFERENT AND BETTER CLAIM THAN A VOTE.
 *
 * "The first Kings player to receive an MVP vote since 1993" is good. "The
 * first Kings player to finish top five since 1993" is better, because a
 * single stray vote is one voter and a top-five finish is the electorate. Both
 * are computed and the stronger one is preferred where it exists - but they
 * are separate histories, because a team can have appeared every year and
 * finished top five never. */
const TOP = 5;
const asAll = [], asTop = [];
for (const g of byAwardYear.values()) {
  asAll.push({ award: g.award, season: String(g.year), players: g.rows.map(r => r.player) });
  const top = g.rows.filter(r => r.rnk != null && r.rnk <= TOP).map(r => r.player);
  if (top.length) asTop.push({ award: g.award, season: String(g.year), players: top });
}
const histAll = voteHistory(asAll, teamOf);
const histTop = voteHistory(asTop, teamOf);

for (const [award, h] of [...histAll.entries()].sort()) {
  console.log(`  ${award.padEnd(10)} ${h.years.length} seasons ` +
    `${h.years[0]}-${h.years[h.years.length - 1]}, ${h.teamYears.size} franchises`);
}

/* ---------------- cards ---------------- */

const LATEST = Math.max(...[...byAwardYear.values()].map(g => g.year));
const cards = [];
let noTeam = 0;

for (const g of [...byAwardYear.values()].sort((a, b) => b.year - a.year)) {
  /* Best finisher first, so the representative of each franchise is the man a
   * reader has heard of rather than whoever the loop met first. */
  const rows = g.rows.slice().sort((a, b) =>
    (a.rnk == null ? 999 : a.rnk) - (b.rnk == null ? 999 : b.rnk));

  const options = [];
  const seenTeam = new Set();
  for (const r of rows) {
    const team = teamOf.get(r.player + "|" + g.year);
    if (!team) { noTeam++; continue; }
    if (seenTeam.has(team)) continue;
    seenTeam.add(team);

    /* The stronger claim first. A top-five finish that also breaks an
     * any-vote drought is described as the top-five one, because it is the
     * more surprising of two true things. */
    const top = (r.rnk != null && r.rnk <= TOP)
      ? teamVoteDrought(histTop, g.award, team, g.year) : null;
    const any = teamVoteDrought(histAll, g.award, team, g.year);
    const d = top || any;
    if (!d) continue;
    options.push({ r, team, d, scope: top ? "top" : "any" });
  }

  /* One card per award-season, and it goes to the longest story - never in the
   * data ahead of a gap, then the bigger number. */
  options.sort((x, y) =>
    ((y.d.kind === "first-in-window") - (x.d.kind === "first-in-window")) ||
    ((y.d.gap || y.d.seasonsCovered) - (x.d.gap || x.d.seasonsCovered)));
  const best = options[0];
  if (!best) continue;

  const { r, team, d, scope } = best;
  const label = say(g.award);
  const who = nick(team);
  const did = scope === "top" ? `finish in the top five for ${label}` : `receive a ${label} vote`;
  const didPast = scope === "top" ? `finished in the top five` : `received one`;
  const place = r.rnk != null ? `He finished ${ordinal(r.rnk)}.` : "";

  /* NOT "EVER". The word crept back in and it is the exact overclaim the
   * window machinery exists to prevent: ROY voting began in 1953 and this file
   * starts at 1964, so "the first Kings player ever" would be a sentence about
   * eleven seasons nobody here has seen. "In 70 seasons of MVP voting" is
   * factual, needs no table of award start years, and is not weaker - it is
   * the number a reader wanted anyway.
   *
   * And the gap is the seasons BETWEEN, so a last appearance in 2016 with a
   * gap of 9 is ten seasons ago, not nine. "Since 2016" in the headline is
   * unambiguous; the detail says how many seasons went without rather than
   * how long ago it was, which is the same fact stated so it cannot be off
   * by one. */
  const headline = d.kind === "first-in-window"
    ? `${r.player} is the first ${who} player to ${did} in ${d.seasonsCovered} seasons of voting`
    : `${r.player} is the first ${who} player to ${did} since ${d.sinceYear}`;

  const detail = d.kind === "first-in-window"
    ? `${place} No ${who} player had done it in the ${d.seasonsCovered} seasons of ` +
      `${label} voting this data covers before ${g.year}, going back to ${d.windowFrom}.`
    : `${place} The last was ` +
      `${d.sincePlayers.slice(0, 2).join(" and ") || "a predecessor"} in ${d.sinceYear}. ` +
      `${d.gap} season${d.gap === 1 ? "" : "s"} of ${label} voting went by without another.`;

  /* A never-in-the-data claim beats a gap, a top-five claim beats a vote, and
   * a longer gap beats a shorter one - then aged, so seventy-one seasons of
   * history does not bury the last five. */
  const base = 0.72 +
    (d.kind === "first-in-window" ? 0.10 : 0) +
    (scope === "top" ? 0.06 : 0) +
    Math.min(0.08, (d.gap || d.seasonsCovered) / 400);
  const q = base * recencyFactor(g.year, LATEST);

  cards.push({
    /* "oddity-" so js/app.js routes it to the vault tab with no change to its
     * id-prefix table - only the pool list needs the new file. */
    id: "oddity-hist-" + g.award.toLowerCase().replace(/[^a-z]/g, "") + "-" + g.year + "-" + team.toLowerCase(),
    type: "oddity",
    tab: ["vault"],
    tags: {
      content_type: "oddity", players: [r.player], teams: [team],
      era: (g.year - (g.year % 10)) + "s", category: "award-history"
    },
    quality_score: Math.round(Math.min(1, q) * 100) / 100,
    quality_raw: Math.round(Math.min(1, base) * 100) / 100,
    recency: Math.round(recencyFactor(g.year, LATEST) * 1000) / 1000,
    story_family: "awardhist:" + (d.kind === "first-in-window" ? "first-ever" : "drought"),
    /* Shares the ballot namespace so the engine will not show this and a
     * tracker oddity about the same award-season in one scroll. */
    story_key: ["ballot", g.award, String(g.year), r.player].join("|"),
    payload: {
      season: String(g.year), award: label, award_key: g.award,
      subjects: [r.player], headline, detail,
      scope: `${g.rows.length} players drew votes in ${g.year}`,
      url: "https://hoopsmatic.com/compare?player=" + encodeURIComponent(r.player),
      cta: `${r.player} on HoopsMatic`
    }
  });
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ---------------- thin, verify, write ---------------- */

const MAX_PER_TEAM = 3, MAX_PER_AWARD = 12;
const perTeam = new Map(), perAward = new Map();
const kept = [];
for (const c of cards.slice().sort((a, b) => b.quality_score - a.quality_score)) {
  const t = c.tags.teams[0], a = c.payload.award_key;
  if ((perTeam.get(t) || 0) >= MAX_PER_TEAM) continue;
  if ((perAward.get(a) || 0) >= MAX_PER_AWARD) continue;
  perTeam.set(t, (perTeam.get(t) || 0) + 1);
  perAward.set(a, (perAward.get(a) || 0) + 1);
  kept.push(c);
}

let bad = 0;
for (const c of kept) {
  const p = c.payload;
  if (!p.headline || !p.detail) { console.error(`  ${c.id}: empty text`); bad++; }
  if (/NaN|undefined|Infinity|since null|in 0 seasons|\bever\b/.test(p.headline + " " + p.detail)) {
    console.error(`  ${c.id}: bad text -> ${p.headline}`); bad++;
  }
}
if (bad) { console.error(`FAILED: ${bad} problems`); process.exit(1); }

console.log(`\n${cards.length} candidates -> ${kept.length} cards` +
  (noTeam ? `; ${noTeam} vote rows had no single franchise` : ""));
[...perAward.entries()].sort((a, b) => b[1] - a[1])
  .forEach(([a, n]) => console.log(`  ${a.padEnd(12)} ${n}`));
console.log(`  eras: ` + [...new Set(kept.map(c => c.tags.era))].sort().join(" "));

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "nba-player-data awardVotes + rsStats",
  cards: kept
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
console.log(`\nAdd it to js/app.js TAB_POOLS.vault to put these in the feed.`);
