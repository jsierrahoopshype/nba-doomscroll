#!/usr/bin/env node
/* NBA Doomscroll — records that stood, and the seasons that ended them
 *
 *     node tools/build_records.mjs
 *     node tools/build_records.mjs --games "C:\\path\\to\\game_through_2025_26.csv"
 *     node tools/build_records.mjs --sample 8        (read them without opening the file)
 *
 * WHY
 *
 * The History vault is 82% on-this-day cards - 1,069 of them against 99 media
 * lean and 56 award history - and Jorge's verdict was that only the Media Lean
 * videos in there are worth reading. "A game happened on this date" is a fact
 * and not a surprise.
 *
 * A record with a DURATION is a different thing. "Sixty-nine wins, and it stood
 * for twenty-four seasons" carries the number and the wait, and the wait is the
 * part that lands: it says how hard the thing was, using nothing but the years
 * that went by without anybody doing it.
 *
 * WHAT IT WILL AND WILL NOT CLAIM
 *
 * Two progressions, both computable from a schedule with results: the most wins
 * in a season, and the longest winning streak inside one. No scoring or margin
 * records, because the normalised game row carries the winner and the date and
 * not the points - and a points record computed from a file without points is
 * the Raptors-in-43-seasons mistake with a different number in it.
 *
 * A season the file covers partly cannot be judged, so it is not judged; see
 * lib/records.mjs for that gate. A record from the earliest season in the file
 * is not a record either, it is a starting value.
 *
 * ONE CARD PER RECORD THAT FELL, plus the one still standing. The standing card
 * is the interesting one on a slow news day: the number nobody has touched in
 * however many seasons.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource, cleanPath, findFiles, findCsvWithColumns } from "./lib/find.mjs";
import { parseCsv } from "./lib/csv.mjs";
import { GAMES_COLUMNS, GAME_TABLE_COLUMNS, hasRegularSeason, scheduleSpan, normalizeGames }
  from "./lib/games.mjs";
import { tallyTeamSeasons, seasonEndYear } from "./lib/payroll_wins.mjs";
import { recordProgression, seasonStreaks, streaksAsTally } from "./lib/records.mjs";
import { franchiseOf, identity, displayCity } from "./lib/franchises.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const gi = argv.indexOf("--games");
const oi = argv.indexOf("--out");
const si = argv.indexOf("--sample");
const SAMPLE = si >= 0 ? (parseInt(argv[si + 1], 10) || 8) : 0;
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/record-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

/* ---------------- the schedule ---------------- */

let GAMES_CSV = cleanPath(gi >= 0 ? argv[gi + 1] : null);
if (!GAMES_CSV) {
  /* By columns, not by name, and full schedules ahead of playoff-only files -
   * the same search build_salary.mjs settled on after a filesystem date picked
   * the playoffs-only file and shipped a race titled "All-time franchise wins"
   * showing playoff wins. */
  const named = findFiles(["Games.csv"]);
  const byCols = named.length ? named : [...new Set([
    ...findCsvWithColumns(GAMES_COLUMNS),
    ...findCsvWithColumns(GAME_TABLE_COLUMNS)
  ])];
  const ranked = byCols.map(f => ({ f, full: hasRegularSeason(f), span: scheduleSpan(f) }))
    .sort((a, b) => ((b.full === true) - (a.full === true)) || (b.span.rows - a.span.rows));
  if (ranked.length) GAMES_CSV = ranked[0].f;
}
if (!GAMES_CSV || !fs.existsSync(GAMES_CSV)) {
  console.error("No league game log found. Pass one:");
  console.error('  node tools/build_records.mjs --games "C:\\path\\to\\game.csv"');
  process.exit(1);
}
const full = hasRegularSeason(GAMES_CSV);
const span = scheduleSpan(GAMES_CSV);
console.log(`using ${GAMES_CSV}`);
console.log(`  ${full ? "full schedule" : "PLAYOFFS ONLY"}, ${span.rows.toLocaleString()} rows, ` +
  `${span.from || "?"} to ${span.to || "?"}`);
if (!full) {
  console.error("  That file has no regular-season rows, so every record in it would be a");
  console.error("  playoff record wearing a regular-season sentence. Nothing written.");
  process.exit(1);
}

const raw = normalizeGames(parseCsv(fs.readFileSync(GAMES_CSV, "utf8")));
if (raw.noResult) console.log(`  ${raw.noResult} rows have no result and count in neither column`);

/* ---------------- franchises, as they were called then ---------------- */

const unresolved = new Map();
const codeOf = (g, side) => {
  const year = seasonEndYear(g.gameDate || g.gameDateTimeEst);
  const city = String(g[side + "teamCity"] || "").trim();
  const name = String(g[side + "teamName"] || "").trim();
  const key = franchiseOf(city ? city : name, year);
  if (!key) {
    const label = (city ? city + " / " : "") + name;
    unresolved.set(label, (unresolved.get(label) || 0) + 1);
  }
  return key;
};

const tally = tallyTeamSeasons(raw.rows, codeOf);
if (unresolved.size) {
  const worst = [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log(`  ${unresolved.size} team names lib/franchises.mjs does not know, so no card ` +
    `can name them: ` + worst.map(([n, c]) => `${n} x${c}`).join(", "));
}

/* A franchise's name in a given season, so a 1971 card says Los Angeles and a
 * 2008 one never says Oklahoma City about a Seattle season. */
const teamName = (key, year) => {
  const id = identity(key, year);
  if (!id) return key;
  return displayCity(key, year) || ((id.city ? id.city + " " : "") + id.nick);
};
const seasonLabel = y => (y - 1) + "-" + String(y % 100).padStart(2, "0");

/* ---------------- the two progressions ---------------- */

const wins = recordProgression(tally, { minStood: 5 });
console.log(`\nmost wins in a season: ${wins.seasons} seasons judged, ` +
  `${wins.records.length} records broken`);
if (wins.standing) {
  console.log(`  standing: ${teamName(wins.standing.holder.code, wins.standing.year)} ` +
    `${wins.standing.value} in ${seasonLabel(wins.standing.year)}`);
}

const streaks = seasonStreaks(raw.rows, d => seasonEndYear(d),
  /* The streak map is keyed by whatever codeOf returned, so the name lookup is
   * the same one the tally uses. */
  null);
/* seasonStreaks keys by the RAW team id, which is not a franchise. Re-key it
 * through the same resolver so a relocation does not end a streak record. */
const byFranchise = new Map();
for (const r of raw.rows) {
  for (const side of ["home", "away"]) {
    const id = String(r[side + "teamId"] || "");
    if (!id || byFranchise.has(id)) continue;
    const key = codeOf(r, side);
    if (key) byFranchise.set(id, key);
  }
}
const franchiseStreaks = new Map();
for (const [, s] of streaks) {
  const key = byFranchise.get(String(s.team));
  if (!key) continue;
  const k = key + "|" + s.year;
  const prev = franchiseStreaks.get(k);
  if (!prev || s.streak > prev.streak) {
    franchiseStreaks.set(k, Object.assign({}, s, { team: key }));
  }
}
const streakRecords = recordProgression(streaksAsTally(franchiseStreaks),
  { minStood: 5, requireResults: false });
console.log(`longest winning streak: ${streakRecords.seasons} seasons judged, ` +
  `${streakRecords.records.length} records broken`);
if (streakRecords.standing) {
  console.log(`  standing: ${teamName(streakRecords.standing.holder.code, streakRecords.standing.year)} ` +
    `${streakRecords.standing.value} straight in ${seasonLabel(streakRecords.standing.year)}`);
}

/* ---------------- the cards ---------------- */

const SEASON_TOOL = "https://hoopsmatic.com/salary-season-finder";
const cards = [];

/* The sentence is the record AND the wait, in that order, because the wait is
 * the part a reader does not already know. */
function winsCard(r) {
  const holder = teamName(r.holder.code, r.year);
  const breaker = teamName(r.breaker.code, r.brokenYear);
  return {
    kind: "wins",
    head: `${holder} won ${r.value} games in ${seasonLabel(r.year)}. ` +
      `It took ${r.stood} seasons for anyone to beat it`,
    detail: `${holder} went ${r.holder.w}-${r.holder.l}. The mark stood until ` +
      `${seasonLabel(r.brokenYear)}, when ${breaker} won ${r.brokenValue}.`,
    year: r.year, team: r.holder.code, other: r.breaker.code, otherYear: r.brokenYear
  };
}

function winsStanding(s, brokenCount) {
  const holder = teamName(s.holder.code, s.year);
  const since = Math.max(0, (span.to ? parseInt(String(span.to).slice(0, 4), 10) : s.year) - s.year);
  return {
    kind: "wins-standing",
    head: since >= 2
      ? `Nobody has won more games than ${holder} did in ${seasonLabel(s.year)}, ${since} seasons ago`
      : `${holder} hold the record: ${s.value} wins in ${seasonLabel(s.year)}`,
    /* "1 times" was in the first real output. A count that can be one needs a
     * plural rule, and a count that can be zero needs the clause dropped
     * entirely - a file whose earliest season sets the mark has no earlier
     * holders to have taken it from. */
    detail: `${s.value}-${s.holder.l}` + (
      brokenCount === 0 ? ", the oldest mark this schedule can prove."
      : brokenCount === 1 ? ", and the record had changed hands once before that."
      : `, and the record had changed hands ${brokenCount} times before that.`),
    year: s.year, team: s.holder.code, other: null, otherYear: null
  };
}

function streakCard(r) {
  const holder = teamName(r.holder.code, r.year);
  const breaker = teamName(r.breaker.code, r.brokenYear);
  const dates = r.holder.from && r.holder.to ? ` (${r.holder.from} to ${r.holder.to})` : "";
  return {
    kind: "streak",
    head: `${holder} won ${r.value} in a row in ${seasonLabel(r.year)}, and that stood ` +
      `${r.stood} seasons`,
    detail: `The run${dates} was the longest inside a season until ${seasonLabel(r.brokenYear)}, ` +
      `when ${breaker} won ${r.brokenValue} straight.`,
    year: r.year, team: r.holder.code, other: r.breaker.code, otherYear: r.brokenYear
  };
}

function streakStanding(s) {
  const holder = teamName(s.holder.code, s.year);
  const dates = s.holder.from && s.holder.to ? ` (${s.holder.from} to ${s.holder.to})` : "";
  return {
    kind: "streak-standing",
    head: `The longest winning streak inside a season is still ${holder}'s ${s.value}, ` +
      `from ${seasonLabel(s.year)}`,
    detail: `The run${dates} has survived every season since.`,
    year: s.year, team: s.holder.code, other: null, otherYear: null
  };
}

const facts = [
  ...wins.records.map(winsCard),
  ...streakRecords.records.map(streakCard)
];
if (wins.standing) facts.push(winsStanding(wins.standing, wins.records.length));
if (streakRecords.standing) facts.push(streakStanding(streakRecords.standing));

/* Newest first: a record broken in 2016 is worth more than one broken in 1953,
 * and the feed's own recency weighting cannot see a card's subject year. */
facts.sort((a, b) => b.year - a.year);

for (const f of facts) {
  const era = (f.year - (f.year % 10)) + "s";
  cards.push({
    /* "oddity-" so js/app.js routes it to the vault with no change to its
     * id-prefix table, exactly as the award-history pool does. */
    id: "oddity-rec-" + f.kind + "-" + f.year + "-" + f.team,
    type: "oddity",
    tab: ["vault"],
    tags: {
      content_type: "oddity",
      players: [],
      teams: [identity(f.team, f.year) ? identity(f.team, f.year).code : f.team,
              f.other && identity(f.other, f.otherYear)
                ? identity(f.other, f.otherYear).code : null].filter(Boolean),
      era, category: "record"
    },
    /* A record that fell recently is the better card, and the standing ones sit
     * above everything because "nobody has done it since" does not age. */
    quality_score: f.kind.endsWith("standing") ? 0.9 : 0.8,
    story_family: "record:" + f.kind,
    story_key: ["record", f.kind, String(f.year), f.team].join("|"),
    payload: {
      season: seasonLabel(f.year),
      headline: f.head,
      detail: f.detail,
      subjects: [],
      scope: `from ${span.from || "?"} to ${span.to || "?"}`,
      url: SEASON_TOOL,
      cta: "Season finder on HoopsMatic"
    }
  });
}

/* ---------------- verify, then write ---------------- */

let bad = 0;
const seenHead = new Set();
for (const c of cards) {
  const h = c.payload.headline, d = c.payload.detail;
  const say = (why) => { console.error(`  BAD (${why}): ${h}`); bad++; };
  if (/\b(NaN|undefined|Infinity|null)\b/.test(h + " " + d)) say("a number that is not one");
  if (/\b0 seasons\b/.test(h + " " + d)) say("a span of nothing");
  if (/—|–/.test(h + " " + d)) say("an em dash");
  if (h.length > 160) say("headline too long");
  if (/\.$/.test(h)) say("headline ends in a full stop");
  if (seenHead.has(h)) say("a headline already used");
  seenHead.add(h);
}
if (bad) {
  console.error(`\n${bad} card(s) failed the check. Nothing written.`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "league game log",
  span: { from: span.from, to: span.to, rows: span.rows },
  cards
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB), ` +
  `${cards.length} cards`);
const byKind = {};
for (const c of cards) byKind[c.story_family] = (byKind[c.story_family] || 0) + 1;
for (const [k, n] of Object.entries(byKind)) console.log(`  ${k.padEnd(24)} ${n}`);

if (SAMPLE) {
  console.log("");
  for (const c of cards.slice(0, SAMPLE)) {
    console.log("  " + c.payload.headline);
    console.log("      " + c.payload.detail + "\n");
  }
} else {
  console.log("\nRun with --sample 8 to read a few without opening the file.");
}
