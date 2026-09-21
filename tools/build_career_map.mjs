#!/usr/bin/env node
/* NBA Doomscroll — the Career Map, playable in the feed
 *
 *     node tools/build_career_map.mjs
 *     node tools/build_career_map.mjs --local "C:\\...\\nba-player-data"
 *     node tools/build_career_map.mjs --sample 10
 *
 * WHY
 *
 * The Career Map has been three promo cards: a hook, a link, and a reader who
 * has to leave the feed to do anything. This asks the game's own question where
 * the reader already is - four badges, one of which he never wore - and the
 * link becomes what you tap when you want the whole career rather than what you
 * tap to find out if you were right.
 *
 * WHAT IT NEEDS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * rsStats.json from nba-player-data, for who played where. That is all. No
 * headshot: the player is NAMED in the question, so a face would be decoration
 * and would drag in a second source path for it.
 *
 * The badges come out of data/vault-pool.json, which is committed here and
 * carries a logo URL beside every team name on its on-this-day cards. All
 * thirty franchises resolve through it. See lib/career_teams.mjs for why that
 * beats both a new path in paths.cmd and thirty team ids typed from memory.
 *
 * THE GATES ARE THE WHOLE JOB. They live in lib/career_teams.mjs, and the one
 * worth repeating is that the wrong answer asserts a negative: a distractor has
 * to have existed for the player's whole career, or "he never played for the
 * Grizzlies" is a fact about 1995 rather than about him.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";
import { franchiseOf, existedIn, identity } from "./lib/franchises.mjs";
import { careerStints, careerMapQuestions, layOut, badgesFromPool,
         MIN_GAMES, MIN_FRANCHISES, OPTIONS } from "./lib/career_teams.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const oi = argv.indexOf("--out");
const si = argv.indexOf("--sample");
const SAMPLE = si >= 0 ? (parseInt(argv[si + 1], 10) || 10) : 0;
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/careermap-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

/** Career games before a man is somebody a reader might place.
 *
 * A question about a journeyman nobody can picture is not hard, it is
 * unanswerable, and the reader learns only that he does not follow basketball
 * closely enough. Four hundred games is roughly five full seasons: long enough
 * to have been somewhere in the reader's memory, short enough to keep the pool
 * from being thirty superstars. */
const MIN_CAREER_GAMES = 400;

/** Cards written. One per player, so this is also a player count. */
const MAX_CARDS = 60;

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["rsStats.json"]
});
if (!PD) process.exit(1);

const statRows = JSON.parse(fs.readFileSync(path.join(PD, "rsStats.json"), "utf8"));

/* ---------------- badges ---------------- */

let vault = { cards: [] };
try {
  vault = JSON.parse(fs.readFileSync(path.join(REPO, "data", "vault-pool.json"), "utf8"));
} catch (e) {
  console.error(`  Could not read data/vault-pool.json, which is where the team badges come from.`);
  console.error(`  Run tools/build_vault.mjs first, or check the file is not truncated: ${e.message}`);
  process.exit(1);
}
const BADGES = badgesFromPool(vault.cards, { franchiseOf });
const ELIGIBLE = [...BADGES.keys()].sort();
console.log(`${statRows.length} stat rows, ${ELIGIBLE.length} franchises with a badge`);
if (ELIGIBLE.length < 30) {
  console.log(`  NOTE: fewer than thirty. A franchise with no badge can be neither a right`);
  console.log(`  answer nor a wrong one, so those careers get thinner boards or no card.`);
}

/* ---------------- stints ---------------- */

/* WHICH SEASONS THE CURRENT BADGE HONESTLY COVERS.
 *
 * The card can only draw a franchise's present-day crest. For a stint played in
 * another city that crest is a lie the reader cannot see past: Robert Parish's
 * 1994-96 Charlotte Hornets are today's New Orleans Pelicans, and a Pelicans
 * badge offered as a team he played for is a question with no right answer.
 *
 * The city decides, not the nickname. New Orleans Hornets to New Orleans
 * Pelicans is the same badge and the same city. Charlotte to New Orleans,
 * New Jersey to Brooklyn and Seattle to Oklahoma City are not. */
const NOW = 2026;
const sameCityNow = (key, year) => {
  const then = identity(key, year), now = identity(key, NOW);
  return !!(then && now && then.city === now.city);
};

const stints = careerStints(statRows, { franchiseOf, sameCityNow });
console.log(`${stints.size} players with at least one resolvable team`);

const all = careerMapQuestions(stints, { eligible: ELIGIBLE, existedIn });
console.log(`${all.length} careers clear the gates ` +
  `(${MIN_FRANCHISES}+ franchises at ${MIN_GAMES}+ games each, and a team that ` +
  `existed throughout for the wrong answer)`);

const known = all.filter(q => q.games >= MIN_CAREER_GAMES);
console.log(`${known.length} of those reach ${MIN_CAREER_GAMES} career games`);
const thin = all.reduce((n, q) => n + q.thinStints, 0);
const moved = all.reduce((n, q) => n + q.movedStints, 0);
console.log(`${thin} stint(s) across the pool were too short to show as a right answer`);
console.log(`${moved} real stint(s) are hidden because the badge would be another city's`);

/* Longest careers first: more teams and more games means a man more readers
 * can place, and the cap has to cut somewhere. Ties on the name so a rebuild
 * does not reshuffle the pool. */
known.sort((a, b) => (b.games - a.games) || a.player.localeCompare(b.player));

/* ---------------- cards ---------------- */

const seasonLabel = y => (y - 1) + "-" + String(y % 100).padStart(2, "0");
const badgeName = key => {
  const b = BADGES.get(key);
  if (b) return b.name;
  const id = identity(key, 2020);
  return id ? id.city + " " + id.nick : key;
};

const cards = [];
for (const q of known.slice(0, MAX_CARDS)) {
  const board = layOut(q);
  const options = board.keys.map(k => ({
    key: k, name: badgeName(k), logo: (BADGES.get(k) || {}).logo || ""
  }));
  const mid = Math.round((q.from + q.to) / 2);

  cards.push({
    /* "careermap-" routes it to the quiz tab through the id-prefix table in
     * js/app.js, the same way capcall- does. */
    id: "careermap-" + String(q.player).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    type: "careermap",
    tab: ["quiz"],
    tags: {
      content_type: "careermap", players: [q.player],
      teams: q.played.map(s => badgeName(s.key)),
      era: (mid - (mid % 10)) + "s", category: "game"
    },
    quality_score: 0.82,
    story_family: "careermap",
    /* Shares a namespace with nothing else: this is the only card about a
     * player's teams, and one per player is enforced upstream. */
    story_key: ["careermap", q.player].join("|"),
    payload: {
      /* "NBA teams", not "teams". The Career Map itself covers clubs anywhere
       * in the world and this is built from an NBA-only stats file, so the
       * question has to say which league it is asking about. A reader who
       * knows a man had a season in Spain should not be able to be right and
       * marked wrong. */
      question: `Which of these NBA teams did ${q.player} never play for?`,
      options,
      answer_idx: board.answerIdx,
      detail: `${q.player} played for ${q.franchises} franchise${q.franchises === 1 ? "" : "s"} ` +
        `between ${seasonLabel(q.from)} and ${seasonLabel(q.to)}, ${q.games} games in all.`,
      /* The Career Map is served on both hosts. This is the HoopsMatic one,
       * because that is the site this feed belongs to and the one whose
       * traffic counts. js/cards.js rewrites the Pages URL at render time for
       * cards built before this line changed; new cards carry it correctly. */
      url: "https://hoopsmatic.com/nba-career-map/",
      cta: "See every team he played for"
    }
  });
}

/* ---------------- verify, then write ---------------- */

let bad = 0;
const seenId = new Set();
for (const c of cards) {
  const p = c.payload;
  const say = why => { console.error(`  BAD (${why}): ${p.question}`); bad++; };
  if (p.options.length !== OPTIONS) say(`${p.options.length} options`);
  if (!(p.answer_idx >= 0 && p.answer_idx < p.options.length)) say("answer off the board");
  if (new Set(p.options.map(o => o.key)).size !== p.options.length) say("a team twice");
  if (p.options.some(o => !o.logo)) say("an option with no badge");
  if (p.options.some(o => !o.name)) say("an option with no name");
  if (/\b(NaN|undefined|null)\b/.test(p.question + " " + p.detail)) say("a value that is not one");
  if (/—|–/.test(p.question + " " + p.detail)) say("an em dash");
  if (seenId.has(c.id)) say("an id already used");
  seenId.add(c.id);
  /* THE CHECK THAT MATTERS. The answer must be a team this player has no stint
   * with at all - not a thin one, none. Re-derived here from the stints rather
   * than trusted from the question, because this is the claim the card makes. */
  const mine = stints.get(p.question.replace(/^Which of these NBA teams did /, "")
    .replace(/ never play for\?$/, ""));
  const answerKey = p.options[p.answer_idx] && p.options[p.answer_idx].key;
  if (mine && answerKey && mine.has(answerKey)) say("the answer is a team he played for");
}
if (bad) {
  console.error(`\n${bad} card(s) failed the check. Nothing written.`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "nba-player-data rsStats, badges from data/vault-pool.json",
  cards
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB), ` +
  `${cards.length} cards`);
const eras = {};
for (const c of cards) eras[c.tags.era] = (eras[c.tags.era] || 0) + 1;
console.log(`  eras: ${Object.entries(eras).sort().map(([k, n]) => k + " " + n).join("  ")}`);

if (SAMPLE) {
  console.log("");
  for (const c of cards.slice(0, SAMPLE)) {
    const p = c.payload;
    console.log("  " + p.question);
    console.log("      " + p.options.map((o, i) =>
      (i === p.answer_idx ? "[" + o.name + "]" : o.name)).join("   "));
    console.log("      " + p.detail + "\n");
  }
  console.log("  (the answer is in brackets)");
} else {
  console.log("\nRun with --sample 10 to read a few without opening the file.");
}
