#!/usr/bin/env node
/* NBA Doomscroll — Beat the Dream Team, at the size of a card
 *
 *     node tools/build_dream_team.mjs
 *     node tools/build_dream_team.mjs --local "C:\\...\\nba-player-data"
 *     node tools/build_dream_team.mjs --sample 6
 *
 * WHY
 *
 * The game at hoopsmatic.com/dream-team-game asks you to assemble a five that
 * beats an all-time one. Assembling is the game and does not fit on a card.
 * The judgement underneath it does: two fives, side by side, which one scored
 * more. The link becomes what you tap to go and build one yourself rather than
 * what you tap to find out if you were right.
 *
 * WHAT IT NEEDS
 *
 * rsStats.json from nba-player-data, for PLAYER, TEAM, YEAR, GP and PTS. That
 * is all. No headshots: ten men on one card would be ten faces, and they are
 * all named anyway.
 *
 * THE GATES ARE IN lib/dream_squads.mjs and the two worth repeating here are
 * that a traded player's TOT row must not be double-counted, and that the two
 * totals have to land inside a gap band or the card is either a coin flip or a
 * blowout. Both are tested in tools/test_dream_squads.mjs against rows whose
 * right answer is written beside them.
 *
 * WHAT THE CARD DOES NOT CLAIM. That these fives would score this much
 * TOGETHER. Five 25-point scorers sharing one ball do not score 125. The card
 * asks for a sum of five season averages and the reveal says in plain words
 * that is what it is.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadBio, lineupOrder, withBio } from "./lib/player_bio.mjs";
import { resolveSource } from "./lib/find.mjs";
import {
  seasonTotals, eligibleSeasons, teamScoringByYear, environmentOf, squadPairs,
  MIN_GP, MIN_PPG, MIN_GAP, MAX_GAP, SQUAD, SEED_ATTEMPTS, PER_PAIRING,
  MIN_YEAR, MIN_DECADE_SEASONS, MAX_CARDS_PER_PLAYER
} from "./lib/dream_squads.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const oi = argv.indexOf("--out");
const si = argv.indexOf("--sample");
const SAMPLE = si >= 0 ? (parseInt(argv[si + 1], 10) || 6) : 0;
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/dreamteam-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

/** Cards written. */
const MAX_CARDS = 40;

/** Where the reader goes to assemble one themselves. */
const GAME_URL = "https://hoopsmatic.com/dream-team-game";

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["rsStats.json"]
});
if (!PD) process.exit(1);

const statRows = JSON.parse(fs.readFileSync(path.join(PD, "rsStats.json"), "utf8"));
console.log(`${statRows.length} stat rows`);

/* HEIGHTS AND POSITIONS, for listing each five in lineup order rather than in
 * scoring order. rsStats has PLAYER, TEAM, YEAR, GP and PTS and nothing else,
 * so this is a second file from the same repo - see tools/lib/player_bio.mjs
 * for what it can and cannot support (it has no PG/SG split, so the order is
 * shortest to tallest with position breaking ties).
 *
 * Optional on purpose: a checkout without bio.json still builds a valid pool,
 * it just lists each five the way it always did. */
let bio = null;
try {
  bio = loadBio(PD);
  console.log(`${bio.size} bio rows` +
    (bio.duplicates ? ` (${bio.duplicates} duplicate name(s) - last wins)` : ""));
} catch (e) {
  console.log(`no bio.json in ${PD}: listing each five in scoring order (${e.code || e.message})`);
}

/* ---------------- seasons ---------------- */

const totals = seasonTotals(statRows);
const splits = [...totals.values()].filter(s => s.fromTot).length;
console.log(`${totals.size} player-seasons, ${splits} of them assembled from a TOT row`);
if (splits === 0) {
  console.log(`  NOTE: no TOT rows found. Either this file does not use them, or the`);
  console.log(`  field changed. Traded players' seasons would then be summed from team`);
  console.log(`  rows, which is also correct - but check it, because the alternative`);
  console.log(`  failure is silently doubling every traded man's scoring average.`);
}

const seasons = eligibleSeasons(totals);
console.log(`${seasons.length} clear the floors (${MIN_GP}+ games at ${MIN_PPG}+ points a game, ` +
  `${MIN_YEAR - 1}-${String(MIN_YEAR % 100).padStart(2, "0")} onwards)`);

/* MEASURED BEFORE ANY FILTER, from every row. See lib/dream_squads.mjs for
 * why: computing this from the eligible seasons gave a number bounded below by
 * the scoring floor, so it read ~19 in every decade and hid the effect the
 * card exists to show. */
const byYear = teamScoringByYear(statRows);

/* THE CHECK THAT MAKES THE NUMBER QUOTABLE. Two seasons whose scoring is
 * common knowledge, printed so the derivation is verified rather than
 * trusted. If these are far off, the card must not be quoting this figure. */
{
  const known = [
    [1962, "1961-62", "118.8, the highest-scoring season on record"],
    [1999, "1998-99", "91.6, the lockout-season low"],
    /* THE MODERN LANDMARK, added because the first two were not enough. Both
     * are seasons where somebody played every game, so the old roster-max
     * denominator happened to be right and the check passed while the 2020s
     * came out four points high. A high and a low from the same era cannot
     * catch an error that only appears in another one. */
    [2024, "2023-24", "114.2, a recent full season"]
  ];
  console.log(`  points per team per game, against what these seasons are known for:`);
  for (const [y, label, expect] of known) {
    const v = byYear.get(y);
    console.log(`    ${label}  ${v ? v.perTeamGame : "(absent)"}` +
      `${v ? "  (" + v.teams + " teams, from " + v.method + ")" : ""}   actual ${expect}`);
  }
  const methods = {};
  for (const v of byYear.values()) methods[v.method] = (methods[v.method] || 0) + 1;
  console.log(`    denominators: ${Object.entries(methods).sort()
    .map(([k, n]) => k + " " + n + " season(s)").join(", ")}`);
}

const byDecade = new Map();
for (const s of seasons) byDecade.set(s.decade, (byDecade.get(s.decade) || 0) + 1);
console.log(`  by decade: ${[...byDecade].sort()
  .map(([d, n]) => d + " " + n).join("  ")}`);
const thin = [...byDecade].filter(([, n]) => n < SQUAD).map(([d]) => d);
if (thin.length) {
  console.log(`  ${thin.join(", ")} cannot fill a five and are skipped`);
}

/* ---------------- pairings ---------------- */

const pairs = squadPairs(seasons);
console.log(`  decades under ${MIN_DECADE_SEASONS} qualifying seasons are dropped; ` +
  `no player appears on more than ${MAX_CARDS_PER_PLAYER} cards`);
console.log(`${pairs.length} pairings landed inside the ${MIN_GAP}-${MAX_GAP} point gap band ` +
  `(${SEED_ATTEMPTS} seeds tried per decade pair, at most ${PER_PAIRING} taken)`);
if (!pairs.length) {
  console.error(`\n  Nothing to write. Every pairing missed the band, which means the band`);
  console.error(`  is wrong for this data rather than that the data is wrong: widen`);
  console.error(`  MAX_GAP in tools/lib/dream_squads.mjs and look at what comes out.`);
  process.exit(1);
}

const gaps = pairs.map(p => p.gap).sort((a, b) => a - b);
console.log(`  gaps: tightest ${gaps[0]}, median ${gaps[Math.floor(gaps.length / 2)]}, ` +
  `widest ${gaps[gaps.length - 1]}`);

/* Widest gap first: those are the cards a reader can actually reason about,
 * and the cap has to cut somewhere. Ties on the seed so a rebuild does not
 * reorder the pool. */
pairs.sort((a, b) => (b.gap - a.gap) || a.seed.localeCompare(b.seed));

/* ---------------- cards ---------------- */

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/* One decimal, always, including the trailing zero. "99 a game" beside "92.1 a
 * game" reads like two different kinds of number and invites a reader to
 * wonder which one is rounded. */
const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1);
const squadOf = (five, decade) => ({
  label: decade,
  total: Math.round(five.reduce((n, s) => n + s.ppg, 0) * 10) / 10,
  /* LINEUP ORDER, NOT SCORING ORDER. The five are picked from five scoring
   * tiers, so the natural array order is best scorer first - which reads as a
   * ranking and invites the reader to compare the two lists top to top instead
   * of as squads. Sorted shortest to tallest here, at build time, so the
   * renderer stays a plain map over the array.
   *
   * `total` is computed BEFORE the sort and is a sum, so the order cannot
   * change the answer - which matters, because the answer_idx that goes with it
   * is decided from these totals. */
  players: lineupOrder(
    five.map(s => withBio({ name: s.player, season: s.label, ppg: s.ppg }, bio)),
    bio
  )
});

const cards = [];
for (const p of pairs.slice(0, MAX_CARDS)) {
  const a = squadOf(p.a, p.decades[0]);
  const b = squadOf(p.b, p.decades[1]);
  const answerIdx = p.higher === "a" ? 0 : 1;
  const envA = environmentOf(p.a, byYear);
  const envB = environmentOf(p.b, byYear);

  /* THE SENTENCE THAT KEEPS THE CARD HONEST. It says the quantity out loud -
   * five separate seasons added together - because a reader who thinks the
   * card is predicting a lineup's output is right to think the card is wrong.
   * Then the scoring era, which is the thing worth learning and the reason the
   * pairing is cross-era at all: points per team per game, measured over every
   * row rather than over the men who cleared the card's own floor. */
  const hi = answerIdx === 0 ? a : b;
  const lo = answerIdx === 0 ? b : a;
  const hiEnv = answerIdx === 0 ? envA : envB;
  const loEnv = answerIdx === 0 ? envB : envA;
  const detail =
    `The ${hi.label} five add up to ${fmt1(hi.total)} a game, the ${lo.label} five to ` +
    `${fmt1(lo.total)}. That is five separate seasons added together, not what the lineup ` +
    `would score as a team. Teams averaged ${fmt1(hiEnv)} points a game in those ` +
    `${hi.label} seasons and ${fmt1(loEnv)} in the ${lo.label} ones.`;

  cards.push({
    /* "dreamteam-" routes it to the quiz tab through the id-prefix table in
     * js/app.js, the same way careermap- does. */
    id: "dreamteam-" + slug(p.decades[0]) + "-v-" + slug(p.decades[1]) + "-" + slug(p.seed),
    type: "dreamteam",
    tab: ["quiz"],
    tags: {
      content_type: "dreamteam",
      players: a.players.concat(b.players).map(x => x.name),
      teams: [],
      era: p.decades[0],
      category: "game"
    },
    quality_score: 0.84,
    story_family: "dreamteam",
    story_key: ["dreamteam", p.decades[0], p.decades[1], p.seed].join("|"),
    payload: {
      question: `Which five averaged more points a game between them?`,
      squads: [a, b],
      answer_idx: answerIdx,
      detail,
      url: GAME_URL,
      cta: "Build a five of your own"
    }
  });
}

/* ---------------- verify, then write ---------------- */

let bad = 0;
const seenId = new Set();
const seenKey = new Set();
for (const c of cards) {
  const p = c.payload;
  const say = why => { console.error(`  BAD (${why}): ${c.id}`); bad++; };
  if (!Array.isArray(p.squads) || p.squads.length !== 2) say("not two squads");
  else {
    for (const s of p.squads) {
      if (s.players.length !== SQUAD) say(`${s.players.length} men in the ${s.label} five`);
      if (s.players.some(x => !x.name || !x.season)) say("a man with no name or no season");
      if (s.players.some(x => !(x.ppg > 0))) say("a man with no scoring average");
      const sum = Math.round(s.players.reduce((n, x) => n + x.ppg, 0) * 10) / 10;
      /* The total the card PRINTS must be the sum of the numbers the card
       * SHOWS. A reader who adds them up has to get the stated answer, or the
       * reveal is arguing with itself. */
      if (Math.abs(sum - s.total) > 0.05) say(`${s.label} total ${s.total} is not the sum ${sum}`);
    }
    const names = p.squads[0].players.concat(p.squads[1].players).map(x => x.name);
    if (new Set(names).size !== names.length) say("the same man on both fives");
    if (p.squads[0].label === p.squads[1].label) say("both fives from the same decade");
    /* THE CHECK THAT MATTERS. The answer must be the higher total, re-derived
     * from the printed numbers rather than trusted from the pairing. */
    const hiIdx = p.squads[0].total > p.squads[1].total ? 0 : 1;
    if (p.answer_idx !== hiIdx) say("the answer is not the higher five");
    if (p.squads[0].total === p.squads[1].total) say("a tie, which has no answer");
  }
  if (!(p.answer_idx === 0 || p.answer_idx === 1)) say("answer off the board");
  if (/\b(NaN|undefined|null)\b/.test(p.question + " " + p.detail)) say("a value that is not one");
  if (/—|–/.test(p.question + " " + p.detail)) say("an em dash");
  if (seenId.has(c.id)) say("an id already used");
  if (seenKey.has(c.story_key)) say("a story_key already used");
  seenId.add(c.id); seenKey.add(c.story_key);
}
if (bad) {
  console.error(`\n${bad} card(s) failed the check. Nothing written.`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "nba-player-data rsStats",
  cards
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB), ` +
  `${cards.length} cards`);

const pairCount = {};
for (const c of cards) {
  const k = c.payload.squads[0].label + " v " + c.payload.squads[1].label;
  pairCount[k] = (pairCount[k] || 0) + 1;
}
console.log(`  pairings: ${Object.entries(pairCount).sort()
  .map(([k, n]) => k + (n > 1 ? " x" + n : "")).join("  ")}`);

if (SAMPLE) {
  console.log("");
  for (const c of cards.slice(0, SAMPLE)) {
    const p = c.payload;
    console.log("  " + p.question);
    for (let i = 0; i < 2; i++) {
      const s = p.squads[i];
      console.log("      " + (i === p.answer_idx ? "[" : " ") + s.label +
        (i === p.answer_idx ? "]" : " ") + "  " + fmt1(s.total) + " a game");
      for (const m of s.players) {
        console.log("          " + m.name.padEnd(24) + " " + m.season + "   " +
          String(m.ppg.toFixed(1)).padStart(5));
      }
    }
    console.log("      " + p.detail + "\n");
  }
  console.log("  (the higher five is in brackets)");
} else {
  console.log("\nRun with --sample 6 to read a few without opening the file.");
}
