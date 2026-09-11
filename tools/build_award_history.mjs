/* Franchise droughts from the official award voting, 1956 onwards.
 *
 *     node tools/build_award_history.mjs
 *     node tools/build_award_history.mjs --local "C:\path\to\nba-player-data"
 *     node tools/build_award_history.mjs --sample 12
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
 * WHAT THE FIRST VERSION GOT WRONG, BECAUSE IT IS WHY THIS FILE LOOKS LIKE
 * THIS
 *
 * The facts were right and the output was still bad. Ten cards went out and
 * eight of them were the same sentence:
 *
 *   "<Player> is the first <Team> player to finish in the top five for
 *    <Award> since <Year>"
 *   "He finished 5th. The last was <Name> in <Year>. <N> seasons of <Award>
 *    voting went by without another."
 *
 * Five separate defects, and only one of them was arithmetic:
 *
 *   1. ONE TEMPLATE, so the third card taught the reader it was generated.
 *      Fixed in lib/award_sentences.mjs: several sentence STRUCTURES per case,
 *      chosen by a hash of the card's own facts, with a per-shape budget in
 *      the thinning pass below so no shape can dominate the pool.
 *
 *   2. "The last was Shane Battier and Metta World Peace in 2009" - plural
 *      subject, singular verb. Fixed, and checked by the verifier.
 *
 *   3. "Metta World Peace in 2009" - he was Ron Artest until 2011. Fixed with
 *      a small table of renamings, applied by season.
 *
 *   4. "the first Raptors player ... in 43 seasons of voting, going back to
 *      1983" - Toronto joined the NBA in 1996. THE WINDOW IS THE OVERLAP OF
 *      THE AWARD'S SPAN AND THE FRANCHISE'S, and the franchise's comes from
 *      rsStats here, never from a hand-typed year.
 *
 *   5. Thresholds set by feel. Five players finish top five each season, which
 *      across thirty teams is one appearance per team per six years, so the
 *      old seven-season Rookie of the Year "drought" was close to chance. The
 *      gates now differ by award and by how strong the claim is; see
 *      lib/award_sentences.mjs for the arithmetic behind each number.
 *
 * THE LABEL BUG THE PROBE FOUND
 *
 * There is an eighth award: "Sixth", 12 rows, 2026 only. It is "Sixth Man"
 * with the second word lost, and it splits that award's most recent season off
 * into a one-season history of its own. Left alone it would make Sixth Man
 * look as though it ended in 2025 and 2026 would vanish. Normalised here and
 * worth reporting upstream, because it will be wrong again next season.
 *
 * ONE FRANCHISE, SEVERAL CODES
 *
 * SAC, KCK, KCO, CIN and ROC are one continuous franchise and a drought that
 * stops at a relocation is not a drought. lib/franchises.mjs groups the codes
 * and, just as importantly, says what the team was CALLED in the season being
 * described, so a 1974 Bullets player is never called a Wizard.
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
import { franchiseKey, identity } from "./lib/franchises.mjs";
import {
  sentenceShapes, checkText, displaySurname, pastName,
  minGapFor, MIN_NEVER_WINDOW, MIN_AWARD_SEASONS
} from "./lib/award_sentences.mjs";
import { recencyFactor } from "./lib/salary.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const oi = argv.indexOf("--out");
const si = argv.indexOf("--sample");
const SAMPLE = si >= 0 ? (parseInt(argv[si + 1], 10) || 10) : 0;

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["awardVotes.json", "rsStats.json"]
});
if (!PD) process.exit(1);
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/award-history-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

const readJson = p => JSON.parse(fs.readFileSync(path.join(PD, p), "utf8"));

/* The award as the data spells it, mapped to how a card should say it. */
const AWARD_FIX = { "Sixth": "Sixth Man" };
const SAY = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  MIP: "Most Improved Player", "Sixth Man": "Sixth Man of the Year",
  Clutch: "Clutch Player of the Year", Hustle: "Hustle Award"
};
const say = a => SAY[a] || a;

const upper = t => String(t).trim().toUpperCase();

/* ---------------- load ---------------- */

const votes = readJson("awardVotes.json");
const statRows = readJson("rsStats.json");

/* Which franchise did each player-season belong to. The code comes from the
 * plurality of games played, refusing an exact tie - see lib/vote_context.mjs
 * for why a guess there is the one error that makes a card a lie rather than
 * dull - and the code is then resolved to a franchise. */
const codeOf = teamByPlayerSeason(statRows, upper);
const keyOf = new Map();
const unknownCodes = new Map();
for (const [ps, code] of codeOf) {
  const year = parseInt(ps.slice(ps.lastIndexOf("|") + 1), 10);
  const key = franchiseKey(code, year);
  if (!key) { unknownCodes.set(code, (unknownCodes.get(code) || 0) + 1); continue; }
  keyOf.set(ps, key);
}

/* HOW LONG HAS THIS FRANCHISE EXISTED. Read, not typed: the moment this
 * becomes a table of founding years is the moment a card claims a team was
 * around for a season it was not. */
const span = new Map();          // franchise key -> { from, to }
let dataFloor = Infinity;
for (const r of statRows) {
  const year = parseInt(r.YEAR, 10);
  if (!year || !r.TEAM) continue;
  const code = upper(r.TEAM);
  if (/^(TOT|TOTAL|2TM|3TM|4TM)$/.test(code)) continue;
  if (year < dataFloor) dataFloor = year;
  const key = franchiseKey(code, year);
  if (!key) continue;
  const s = span.get(key);
  if (!s) span.set(key, { from: year, to: year });
  else { if (year < s.from) s.from = year; if (year > s.to) s.to = year; }
}

console.log(`${votes.length} vote rows, ${codeOf.size} player-seasons on one franchise, ` +
  `${span.size} franchises spanning ${dataFloor} onwards`);
if (unknownCodes.size) {
  console.log(`  team codes lib/franchises.mjs does not know, so no card can name them: ` +
    [...unknownCodes.entries()].sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c} x${n}`).join(", "));
}

/* award -> year -> rows */
const byAwardYear = new Map();
const rankOf = new Map();        // "award|year|player" -> rnk
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
  if (isFinite(rnk)) rankOf.set(award + "|" + year + "|" + r.PLAYER, rnk);
}
if (fixed) {
  console.log(`labels: ${fixed} rows said "Sixth" rather than "Sixth Man" - merged. ` +
    `That is a bug in awardVotes.json and it will recur.`);
}
if (unusable) console.log(`${unusable} rows had no award, player or year`);

/* ---------------- three histories, because they are three claims ----------- */

/* A vote, a top-five finish and a win are not degrees of the same thing. A
 * stray vote is one voter; a top-five finish is the electorate; a win is the
 * award. Each gets its own history, because a franchise can have appeared
 * every season and won never, and the sentence has to be about the one that is
 * actually true. */
const TOP = 5;
const asAll = [], asTop = [], asWin = [];
for (const g of byAwardYear.values()) {
  const season = String(g.year);
  asAll.push({ award: g.award, season, players: g.rows.map(r => r.player) });
  const top = g.rows.filter(r => r.rnk != null && r.rnk <= TOP).map(r => r.player);
  if (top.length) asTop.push({ award: g.award, season, players: top });
  const won = g.rows.filter(r => r.rnk === 1).map(r => r.player);
  if (won.length) asWin.push({ award: g.award, season, players: won });
}
const HIST = {
  any: voteHistory(asAll, keyOf),
  top: voteHistory(asTop, keyOf),
  win: voteHistory(asWin, keyOf)
};

const awardSeasons = new Map();  // award -> seasons in the data
for (const [award, h] of [...HIST.any.entries()].sort()) {
  awardSeasons.set(award, h.years.length);
  console.log(`  ${award.padEnd(10)} ${String(h.years.length).padStart(2)} seasons ` +
    `${h.years[0]}-${h.years[h.years.length - 1]}, ${h.teamYears.size} franchises` +
    (h.years.length < MIN_AWARD_SEASONS ? "   (too short for a drought claim, skipped)" : ""));
}

/* ---------------- candidate cards ---------------- */

const LATEST = Math.max(...[...byAwardYear.values()].map(g => g.year));
const SCOPES = ["win", "top", "any"];       // strongest claim first
const cards = [];
let noTeam = 0, noSentence = 0;

for (const g of [...byAwardYear.values()].sort((a, b) => b.year - a.year)) {
  if ((awardSeasons.get(g.award) || 0) < MIN_AWARD_SEASONS) continue;
  const label = say(g.award);

  /* Best finisher first, so each franchise is represented by the man a reader
   * has heard of rather than whoever the loop met first. */
  const rows = g.rows.slice().sort((a, b) =>
    (a.rnk == null ? 999 : a.rnk) - (b.rnk == null ? 999 : b.rnk));

  const options = [];
  const seen = new Set();
  for (const r of rows) {
    const key = keyOf.get(r.player + "|" + g.year);
    if (!key) { noTeam++; continue; }
    if (seen.has(key)) continue;
    seen.add(key);

    const sp = span.get(key);
    if (!sp) continue;
    const bounds = { franchiseFrom: sp.from, franchiseTo: sp.to };

    for (const scope of SCOPES) {
      if (scope === "win" && r.rnk !== 1) continue;
      if (scope === "top" && !(r.rnk != null && r.rnk <= TOP)) continue;

      const d = teamVoteDrought(HIST[scope], g.award, key, g.year, {
        ...bounds, minGap: minGapFor(g.award, scope)
      });
      if (!d) continue;

      /* A "nobody here has done this" card needs a long window. It used to be
       * refused outright for a win, on the grounds that most franchises have
       * never won most awards - but a card is only built for the player who
       * just did it, so a franchise-first win can happen at most once per
       * franchise per award. See lib/award_sentences.mjs for the Gobert card
       * that exclusion cost. */
      if (d.kind === "first-in-window" &&
          d.seasonsCovered < (MIN_NEVER_WINDOW[scope] || 20)) continue;

      options.push({ r, key, d, scope });
      break;                     // strongest true claim for this franchise
    }
  }

  /* One card per award-season, to the longest story: never-in-this-franchise
   * ahead of a gap, then the bigger span. */
  options.sort((x, y) =>
    ((y.d.kind === "first-in-window") - (x.d.kind === "first-in-window")) ||
    ((y.d.gap || y.d.seasonsCovered) - (x.d.gap || x.d.seasonsCovered)));
  const best = options[0];
  if (!best) continue;

  const { r, key, d, scope } = best;
  const id = identity(key, g.year);
  if (!id) continue;

  const fact = {
    player: r.player,
    surname: displaySurname(r.player),
    label, year: g.year, rank: r.rnk, scope, kind: d.kind, id
  };

  if (d.kind === "first-since") {
    /* Names as they were at the time, and the predecessor's own finish, which
     * is the difference between "the last was Chauncey Billups in 2006" and
     * "Chauncey Billups finished fifth that year". */
    const raw = (d.sincePlayers || []).slice(0, 3);
    fact.sinceNames = raw.map(n => pastName(n, d.sinceYear));
    fact.sinceYear = d.sinceYear;
    fact.gap = d.gap;
    fact.sinceSeasons = d.gap + 1;      // gap counts seasons BETWEEN, both ends out
    fact.sinceId = identity(key, d.sinceYear);
    if (raw.length === 1) {
      fact.sinceSurname = displaySurname(fact.sinceNames[0]);
      const rk = rankOf.get(g.award + "|" + d.sinceYear + "|" + raw[0]);
      fact.sinceRank = rk == null ? null : rk;
    }
  } else {
    const awardFrom = HIST[scope].get(g.award).years[0];
    fact.seasonsCovered = d.seasonsCovered;
    fact.windowFrom = d.windowFrom;
    /* "In franchise history" is only sayable when the award was already being
     * voted on before this team existed - and only when the data actually
     * covers the franchise's first season, or its "from" is just where the
     * file starts. */
    const sp2 = span.get(key);
    fact.wholeHistory = sp2.from > awardFrom && sp2.from > dataFloor;
    const then = identity(key, d.windowFrom);
    fact.sameIdentityThroughout = !!then && then.city === id.city && then.nick === id.nick;
  }

  const shapes = sentenceShapes(fact);
  if (!shapes.length) { noSentence++; continue; }

  /* A never-claim beats a gap, a win beats a top five beats a vote, a longer
   * span beats a shorter one - then aged, so seventy-one seasons of history
   * does not bury the last five. */
  const size = d.gap || d.seasonsCovered;
  const base = 0.70 +
    (scope === "win" ? 0.12 : scope === "top" ? 0.06 : 0) +
    (d.kind === "first-in-window" ? (fact.wholeHistory ? 0.10 : 0.06) : 0) +
    Math.min(0.08, size / 500);
  const rec = recencyFactor(g.year, LATEST);

  cards.push({
    fact, shapes, award_key: g.award, key, scope,
    quality_score: Math.round(Math.min(1, base * rec) * 100) / 100,
    quality_raw: Math.round(Math.min(1, base) * 100) / 100,
    recency: Math.round(rec * 1000) / 1000,
    drawn: g.rows.length
  });
}

/* ---------------- thin, with a budget per sentence shape ------------------- */

/* MAX_PER_SHAPE is the part of this that answers the actual complaint. Caps on
 * teams and awards stop the pool being all Lakers or all MVP; nothing stopped
 * it being the same sentence forty times, which is what shipped. */
/* ONE CARD PER PLAYER, which the first real run needed and did not have.
 *
 * Scottie Barnes came out twice in the best twelve: Rookie of the Year in 2022
 * and a top-five Defensive Player of the Year finish in 2026. Both true, both
 * good, and seeing the same face twice in a scroll makes the pool look thinner
 * than it is. The team cap does not catch it - they are two different claims
 * about one franchise - and neither does the shape cap, because they came out
 * as two different sentences. */
/* MAX_PER_SHAPE_TEAM is the one the first full build asked for. Two of the
 * best twelve were:
 *
 *   "Utah waited 37 seasons for a Most Improved Player win. Markkanen delivered it"
 *   "Utah waited 37 seasons for a Sixth Man of the Year win. Clarkson delivered it"
 *
 * Both true, both good on their own, and side by side they are the complaint
 * this whole file exists to answer - same city, same structure, same number,
 * twice. The per-award shape cap did not catch it (two different awards) and
 * neither did the per-team cap (three are allowed). A structure gets used once
 * per franchise. */
const MAX_PER_TEAM = 3, MAX_PER_AWARD = 12, MAX_PER_SHAPE = 8, MAX_PER_SHAPE_AWARD = 3;
const MAX_PER_SHAPE_TEAM = 1;
const MAX_PER_PLAYER = 1;
const perTeam = new Map(), perAward = new Map(), perShape = new Map(), perShapeAward = new Map();
const perShapeTeam = new Map();
const perPlayer = new Map();
const kept = [];
let shapeStarved = 0, playerDupes = 0;

for (const c of cards.slice().sort((a, b) => b.quality_score - a.quality_score)) {
  if ((perPlayer.get(c.fact.player) || 0) >= MAX_PER_PLAYER) { playerDupes++; continue; }
  if ((perTeam.get(c.key) || 0) >= MAX_PER_TEAM) continue;
  if ((perAward.get(c.award_key) || 0) >= MAX_PER_AWARD) continue;

  /* Take the first sentence shape this card can have that the pool is not
   * already full of. Dropping the card is the right answer when every shape it
   * supports is spent - there is no shortage of candidates, and a card is not
   * worth repeating a structure for. */
  let picked = null;
  for (const s of c.shapes) {
    const sa = s.shape + "|" + c.award_key;
    const st = s.shape + "|" + c.key;
    if ((perShape.get(s.shape) || 0) >= MAX_PER_SHAPE) continue;
    if ((perShapeAward.get(sa) || 0) >= MAX_PER_SHAPE_AWARD) continue;
    if ((perShapeTeam.get(st) || 0) >= MAX_PER_SHAPE_TEAM) continue;
    picked = s;
    break;
  }
  if (!picked) { shapeStarved++; continue; }

  perPlayer.set(c.fact.player, (perPlayer.get(c.fact.player) || 0) + 1);
  perTeam.set(c.key, (perTeam.get(c.key) || 0) + 1);
  perAward.set(c.award_key, (perAward.get(c.award_key) || 0) + 1);
  perShape.set(picked.shape, (perShape.get(picked.shape) || 0) + 1);
  const sa = picked.shape + "|" + c.award_key;
  perShapeAward.set(sa, (perShapeAward.get(sa) || 0) + 1);
  const st = picked.shape + "|" + c.key;
  perShapeTeam.set(st, (perShapeTeam.get(st) || 0) + 1);

  const f = c.fact;
  kept.push({
    /* "oddity-" so js/app.js routes it to the vault tab with no change to its
     * id-prefix table - only the pool list needs the new file. */
    id: "oddity-hist-" + c.award_key.toLowerCase().replace(/[^a-z]/g, "") +
        "-" + f.year + "-" + c.key,
    type: "oddity",
    tab: ["vault"],
    tags: {
      content_type: "oddity", players: [f.player], teams: [codeOf.get(f.player + "|" + f.year)],
      era: (f.year - (f.year % 10)) + "s", category: "award-history"
    },
    quality_score: c.quality_score,
    quality_raw: c.quality_raw,
    recency: c.recency,
    /* The shape is in the family, so the feed engine spaces two cards with the
     * same structure apart even when they are about different awards. */
    story_family: "awardhist:" + picked.shape,
    /* Shares the ballot namespace so the engine will not show this and a
     * tracker oddity about the same award-season in one scroll. */
    story_key: ["ballot", c.award_key, String(f.year), f.player].join("|"),
    payload: {
      season: String(f.year), award: f.label, award_key: c.award_key,
      subjects: [f.player],
      headline: picked.head,
      detail: picked.detail,
      shape: picked.shape,
      scope: `${c.drawn} players drew votes in ${f.year}`,
      url: "https://hoopsmatic.com/compare?player=" + encodeURIComponent(f.player),
      cta: `${f.player} on HoopsMatic`
    }
  });
}

/* ---------------- verify ---------------- */

/* checkText is lib/award_sentences.mjs's own, so the rules a sentence is
 * written to are the rules it is checked against - one list, not two that
 * drift. On top of it: no two cards may carry the same headline, which is the
 * crudest possible test for the defect that started all this. */
let bad = 0;
const seenHead = new Map();
for (const c of kept) {
  for (const why of checkText(c.payload.headline, c.payload.detail)) {
    console.error(`  ${c.id}: ${why}`);
    console.error(`      ${c.payload.headline}`);
    bad++;
  }
  const h = c.payload.headline.toLowerCase();
  if (seenHead.has(h)) { console.error(`  ${c.id}: same headline as ${seenHead.get(h)}`); bad++; }
  seenHead.set(h, c.id);
}
if (bad) { console.error(`\nFAILED: ${bad} problems. Nothing written.`); process.exit(1); }

/* ---------------- report ---------------- */

console.log(`\n${cards.length} candidates -> ${kept.length} cards` +
  (noTeam ? `; ${noTeam} vote rows had no single franchise` : "") +
  (noSentence ? `; ${noSentence} had no sentence the data supports` : "") +
  (playerDupes ? `; ${playerDupes} were a second card about a player already in` : "") +
  (shapeStarved ? `; ${shapeStarved} dropped rather than repeat a sentence shape` : ""));

console.log("  by award:");
[...perAward.entries()].sort((a, b) => b[1] - a[1])
  .forEach(([a, n]) => console.log(`    ${a.padEnd(12)} ${n}`));
console.log("  by sentence shape:");
[...perShape.entries()].sort((a, b) => b[1] - a[1])
  .forEach(([s, n]) => console.log(`    ${s.padEnd(20)} ${n}`));
const byScope = new Map();
for (const c of kept) {
  const s = c.payload.shape.startsWith("never") ? "never" : "drought";
  byScope.set(s, (byScope.get(s) || 0) + 1);
}
console.log("  " + [...byScope.entries()].map(([k, n]) => `${k}: ${n}`).join(", "));
console.log("  eras: " + [...new Set(kept.map(c => c.tags.era))].sort().join(" "));

if (SAMPLE) {
  console.log(`\n  ${Math.min(SAMPLE, kept.length)} of them, best first:\n`);
  for (const c of kept.slice(0, SAMPLE)) {
    console.log("  " + c.payload.headline);
    console.log("     " + c.payload.detail + "\n");
  }
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "nba-player-data awardVotes + rsStats",
  cards: kept
}));
console.log(`wrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
console.log(`\nRun with --sample 12 to read a dozen of them without opening the file.`);
