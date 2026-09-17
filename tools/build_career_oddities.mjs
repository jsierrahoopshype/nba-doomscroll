#!/usr/bin/env node
/* NBA Doomscroll — careers the award voting remembers differently
 *
 *     node tools/build_career_oddities.mjs
 *     node tools/build_career_oddities.mjs --local "C:\\...\\nba-player-data"
 *     node tools/build_career_oddities.mjs --sample 10
 *
 * WHY
 *
 * Second of the three families the History vault was missing. The first
 * (build_records.mjs) is about teams; this one is about careers, read out of
 * seventy seasons of award ballots - which are a record of what the electorate
 * thought at the time, and what it thought is frequently not what the player is
 * remembered for.
 *
 *   perennial      votes across many seasons, won none of these awards
 *   one-top-five   one top-five finish in a whole career
 *   cliff          votes, then out of the league within a couple of seasons
 *   one-shot       won an award, never drew another vote for anything
 *
 * The gates live in lib/career_oddities.mjs, and the one worth repeating here
 * is the cliff: "out of the league within two seasons" is false for a player
 * whose last season is the last season in the file, because he is not gone, the
 * data stops. That needs clear air after the career, and the amount is a named
 * constant.
 *
 * One card per player. A career is one story however many shapes it fits, and
 * two cards about the same man in one vault reads as the app having one idea.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";
import { careerOddities, awardSpans, suspectSpans, contestedWins }
  from "./lib/career_oddities.mjs";
import { ordWord, displaySurname } from "./lib/award_sentences.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const oi = argv.indexOf("--out");
const si = argv.indexOf("--sample");
const SAMPLE = si >= 0 ? (parseInt(argv[si + 1], 10) || 10) : 0;
const outArg = oi >= 0 && argv[oi + 1] ? argv[oi + 1] : "data/career-pool.json";
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["awardVotes.json", "rsStats.json"]
});
if (!PD) process.exit(1);
const readJson = p => JSON.parse(fs.readFileSync(path.join(PD, p), "utf8"));

/* The same label fix build_award_history.mjs applies, for the same reason: the
 * file spells one award "Sixth" for a season's worth of rows. Reported by
 * tools/report_award_labels.mjs, which names the rows. */
const AWARD_FIX = { "Sixth": "Sixth Man" };
const SAY = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  MIP: "Most Improved Player", "Sixth Man": "Sixth Man of the Year",
  Clutch: "Clutch Player of the Year", Hustle: "Hustle Award"
};
const say = a => SAY[a] || a;

/* WHICH FINISH IS THE BEST ONE, when a career has several.
 *
 * Sorting by placing alone said "his best finish was second for Most Improved
 * Player" about men with top-five MVP seasons, because 2 is less than 5. The
 * order below is league knowledge and lives here rather than in the library:
 * MVP first, then the two that decide a season's best defender and best rookie,
 * then the rest. */
const PRESTIGE = new Map([
  ["MVP", 0], ["DPOY", 1], ["ROY", 2], ["MIP", 3], ["Sixth Man", 4],
  ["Clutch", 5], ["Hustle", 6]
]);
const withArticle = n => (/^(MVP|MIP)\b/.test(n) ? "an " : "a ") + n;

/* "won Hustle Award" and "finished fourth for Hustle Award". Every other award
 * in SAY is a title that reads correctly bare - MVP, Rookie of the Year, Sixth
 * Man of the Year - and the Hustle Award is a noun that needs its article. */
const NEEDS_THE = new Set(["Hustle"]);
const named = a => (NEEDS_THE.has(a) ? "the " : "") + say(a);

const votes = readJson("awardVotes.json").map(r => Object.assign({}, r, {
  AWARD: AWARD_FIX[String(r.AWARD || "").trim()] || String(r.AWARD || "").trim()
}));
const statRows = readJson("rsStats.json");

/* The last season each player appears in at all, and the last season the data
 * covers. Both are needed before anything can be said about a career ending. */
const lastSeason = new Map();
let dataTo = 0;
for (const r of statRows) {
  const name = r.PLAYER;
  const year = parseInt(String(r.YEAR || "").slice(0, 4), 10);
  if (!name || !isFinite(year)) continue;
  /* rsStats YEAR IS ALREADY THE SEASON'S ENDING YEAR, and this line used to add
   * one on a comment that said otherwise. The comment was wrong. Aaron Gordon's
   * YEAR "2026" row carries 36 games played, and the 2026-27 season had not
   * started when that was read, so "2026" is 2025-26; his YEAR "2025" row
   * carries the 51 games he played in 2024-25. The game log agrees from the
   * other side: it ends 2026-06-13, the 2025-26 Finals.
   *
   * The shift cancelled out of the cliff GATE, because dataTo moved with it, so
   * the wrong cards were not the symptom. The SENTENCES were: every cliff card
   * named a departure one season late and credited the player with one more
   * season after his last vote than he played. Fourteen cards, all published.
   *
   * Everything else in this repo already treats rsStats YEAR as the ending year
   * (build_salary, build_vault, build_compare, lib/payroll_wins), so this file
   * was the only one out of step. */
  const end = year;
  if (end > (lastSeason.get(name) || 0)) lastSeason.set(name, end);
  if (end > dataTo) dataTo = end;
}
const spans = awardSpans(votes);

/* THE INVARIANT THAT WOULD HAVE CAUGHT THE OFF-BY-ONE. Stats and ballots are
 * now in the same units, so the newest season in each should agree. A stats
 * file running past the last award season means either mid-season data (fine,
 * the awards are not voted yet) or a units bug (not fine). It cannot tell which,
 * so it says so rather than failing a build over a legitimate October. */
const newestVote = Math.max(...[...spans.values()].map(s => s.to));
console.log(`${votes.length} vote rows, ${lastSeason.size} players in the stats, ` +
  `data runs to ${dataTo}, newest award season ${newestVote}`);
if (dataTo > newestVote) {
  console.log(`  NOTE: the stats run ${dataTo - newestVote} season(s) past the newest ballot.`);
  console.log(`  That is normal in-season. If it is the off-season, rsStats YEAR has`);
  console.log(`  changed units and every "out of the league by" year is wrong.`);
}
for (const [award, s] of [...spans.entries()].sort()) {
  console.log(`  ${award.padEnd(10)} ${String(s.seasons.size).padStart(2)} seasons ${s.from}-${s.to}`);
}

/* WHAT THE FILE GOT WRONG, said out loud. Both of these are upstream data
 * problems that no gate in here can repair, and both produced a published card
 * before anybody read the output. Silence is how they got published. */
const suspects = suspectSpans(votes);
if (suspects.length) {
  console.log(`\n${suspects.length} name(s) span more seasons than a career, so the rows are ` +
    `more than one player. Dropped:`);
  for (const s of suspects) {
    console.log(`  ${s.player} - ${s.span} seasons, YEAR ${s.from} to ${s.to}`);
  }
  console.log(`  Years are the raw YEAR values, to grep awardVotes.json with. Fix by`);
  console.log(`  suffixing the younger one, e.g. "Jr.".`);
}

const contested = contestedWins(votes);
if (contested.length) {
  console.log(`\n${contested.length} award-season(s) with more than one first place. No card ` +
    `calls any of these men the winner, because one of two is wrong either way:`);
  for (const c of contested) {
    console.log(`  ${c.award} YEAR ${c.year}: ${c.players.join(", ")}`);
  }
  console.log(`  They keep their ballot appearance. Fix the bad row and they get their cards.`);
}

const facts = careerOddities(votes, lastSeason,
  { dataTo, awardSpan: spans, prestige: PRESTIGE });
const byKind = {};
for (const f of facts) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
console.log(`\n${facts.length} candidate facts: ` +
  Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", "));

/* ---------------- sentences ---------------- */

const seasonLabel = y => (y - 1) + "-" + String(y % 100).padStart(2, "0");
const surname = n => displaySurname(n) || n;

function sentence(f) {
  if (f.kind === "perennial") {
    /* "NEVER WON ANYTHING" WAS THE WRONG SENTENCE, and it survived into a real
     * build before anybody read it: the first eight cards said it about John
     * Stockton, Scottie Pippen, Isiah Thomas and Dwyane Wade. Every one of them
     * is a Hall of Famer, most have rings, and one has a Finals MVP. What the
     * file can prove is that they never won one of ITS seven awards, so that is
     * what the card says. The scope is the whole point of the fact, not a
     * caveat to be trimmed for rhythm. */
    const best = f.best
      ? ` His best was ${ordWord(f.best.rnk)} for ${say(f.best.award)}, in ${seasonLabel(f.best.year)}.`
      : "";
    const many = f.awards.length > 1;
    return {
      head: many
        ? `${f.player} drew votes for ${f.awards.length} different awards across ` +
          `${f.seasons} seasons, and won none of them`
        : `${f.player} drew ${say(f.awards[0])} votes in ${f.seasons} different seasons ` +
          `and never finished first`,
      detail: `${f.votes} ballot appearances between ${seasonLabel(f.from)} and ` +
        `${seasonLabel(f.to)}.` + best
    };
  }
  if (f.kind === "one-top-five") {
    return {
      head: `${f.player} finished ${ordWord(f.rnk)} for ${say(f.award)} once, and never made ` +
        `another top five`,
      detail: `That was ${seasonLabel(f.year)}. ${surname(f.player)} drew votes in ` +
        `${f.seasons} seasons in all, ${f.votes} ballot appearances, and the rest of them ` +
        `were outside the top five.`
    };
  }
  if (f.kind === "cliff") {
    /* THREE ENDINGS, BECAUSE THEY ARE NOT THE SAME STORY.
     *
     * One sentence covered all of them and it produced, from real data:
     *
     *   "Bill Walton drew a Sixth Man of the Year vote in 1985-86"
     *      about the man who WON Sixth Man of the Year in 1985-86.
     *   "Bill Russell drew an MVP vote in 1968-69. He was out of the league
     *    by 1969-70"
     *      about a player-coach who retired holding the championship.
     *
     * Both true. A first-place finish is a vote, and leaving the league does
     * put you out of it. Both were the wrong sentence: the first buries the
     * only fact that matters, the second reads as a washout. So the three
     * cases the data can already tell apart get three sentences.
     *
     * The zero-seasons-after branch had also never run until the season
     * arithmetic above it was fixed, so its prose reached real output for the
     * first time reading "After the ballots of 2009-10, 2009-10 was his last
     * season in the league" - the season twice, and nothing the headline had
     * not said. */
    const gone = seasonLabel(f.lastPlayed + 1);
    const more = f.after === 1 ? "one more season" : f.after + " more seasons";

    /* OUT OF THE NBA, not out of basketball. The dataset is NBA-only, and this
     * used to say "the last season he ever played" about Juan Carlos Navarro,
     * who played one season in Memphis in 2007-08 and then went back to
     * Barcelona until 2018. Every card here is scoped to the league the file
     * covers.
     *
     * There is no branch for a man with nothing after his last ballot any more.
     * AFTER_MIN is 1, so `after` is always at least one, and the sentences that
     * used to cover zero are gone rather than left unreachable - an unreachable
     * branch in this same function is how "After the ballots of 2009-10,
     * 2009-10 was his last season in the league" sat unread. */
    if (f.won) {
      return {
        head: `${f.player} won ${named(f.award)} in ${seasonLabel(f.voteYear)} and was out of ` +
          `the NBA by ${gone}`,
        detail: `He played ${more} after winning it, and never drew another vote for anything.`
      };
    }
    if (f.topFive) {
      return {
        head: `${f.player} finished ${ordWord(f.rnk)} for ${named(f.award)} in ` +
          `${seasonLabel(f.voteYear)}. He was out of the NBA by ${gone}`,
        detail: `He played ${more} after that finish, and never drew another vote.`
      };
    }
    return {
      head: `${f.player} drew ${withArticle(say(f.award))} vote in ${seasonLabel(f.voteYear)}. ` +
        `He was out of the NBA by ${gone}`,
      detail: `He played ${more} after those ballots, and never drew another vote.`
    };
  }
  /* one-shot */
  return {
    head: `${f.player} won ${named(f.award)} in ${seasonLabel(f.year)} and never drew another ` +
      `vote for anything`,
    detail: `One award, one appearance on any ballot, in a career the voters looked at ` +
      `exactly once.`
  };
}

/* ---------------- one card per player ---------------- */

/* Strongest shape first, so a career that fits two is told the better way. A
 * cliff beats a one-top-five because the ending is the surprise; a perennial
 * beats both because it is the whole career rather than one season of it. */
const RANK = { perennial: 0, cliff: 1, "one-shot": 2, "one-top-five": 3 };

/* WHICH FOURTEEN OF EACH SHAPE GET PUBLISHED.
 *
 * One comparator used to serve all four: kind, then `seasons` descending, then
 * the player's name. Cliff and one-shot facts carried no `seasons`, so for half
 * the families that middle term was 0 minus 0 every time and the NAME decided.
 * Out of 128 cliff candidates the fourteen that shipped were Al Harrington,
 * Alaa Abdelnaby, Alonzo Mourning, Amir Johnson, Andray Blatche, Andrew Bynum,
 * Anthony Mason, Anthony Morrow, Antoine Walker, Ben Wallace, Bernard King,
 * Bill Russell, Bill Walton, Bob Love. An alphabetical prefix, presented as the
 * fourteen most interesting careers in seventy years of voting. The one-shots
 * were Aaron McKie and Alan Henderson, for the same reason.
 *
 * Each shape now states what best means for it, because they do not agree.
 * Lower sorts first. */
const QUALITY = {
  /* The whole career is the story, so the longer the near miss ran the better,
   * and more ballots inside the same span means a closer near miss. */
  perennial: f => [-f.seasons, -f.votes],
  /* A high finish and then nothing is the surprise. A down-ballot vote and then
   * nothing is a man aging out, which happens to a dozen players every June.
   * Then the shorter gap, then the longer voting history behind it. */
  cliff: f => [f.rnk || 99, f.after, -f.votes],
  /* Winning the thing and never being mentioned again is stranger the bigger
   * the thing was, and more legible to a reader the nearer it is. */
  "one-shot": f => [PRESTIGE.has(f.award) ? PRESTIGE.get(f.award) : 99, -f.year],
  /* One season standing out of a long career, and the higher it stood. */
  "one-top-five": f => [-f.seasons, f.rnk]
};
const byVector = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
};
facts.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) ||
  byVector(QUALITY[a.kind](a), QUALITY[b.kind](b)) ||
  String(a.player).localeCompare(b.player));

const MAX_PER_KIND = 14;
const perKind = {}, seenPlayer = new Set(), cards = [];
let dupes = 0, capped = 0;

for (const f of facts) {
  if (seenPlayer.has(f.player)) { dupes++; continue; }
  if ((perKind[f.kind] || 0) >= MAX_PER_KIND) { capped++; continue; }
  const s = sentence(f);
  const year = f.year || f.voteYear || f.to || f.from;
  seenPlayer.add(f.player);
  perKind[f.kind] = (perKind[f.kind] || 0) + 1;
  cards.push({
    /* "oddity-" routes it to the vault through the existing id-prefix table. */
    id: "oddity-career-" + f.kind + "-" + String(f.player).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    type: "oddity",
    tab: ["vault"],
    tags: {
      content_type: "oddity", players: [f.player], teams: [],
      era: (year - (year % 10)) + "s", category: "career"
    },
    quality_score: f.kind === "perennial" ? 0.88 : f.kind === "cliff" ? 0.84 : 0.8,
    story_family: "career:" + f.kind,
    /* Shares the ballot namespace, so the engine will not put this and an award
     * oddity about the same player in one scroll. */
    story_key: ["ballot", "career", f.player].join("|"),
    payload: {
      season: seasonLabel(year),
      headline: s.head,
      detail: s.detail.replace(/\s+/g, " ").trim(),
      subjects: [f.player],
      url: "https://hoopsmatic.com/compare?player=" + encodeURIComponent(f.player),
      cta: `${f.player} on HoopsMatic`
    }
  });
}

/* ---------------- verify, then write ---------------- */

let bad = 0;
const seenHead = new Set();
for (const c of cards) {
  const both = c.payload.headline + " " + c.payload.detail;
  const say2 = why => { console.error(`  BAD (${why}): ${c.payload.headline}`); bad++; };
  if (/\b(NaN|undefined|Infinity|null)\b/.test(both)) say2("a number that is not one");
  if (/—|–/.test(both)) say2("an em dash");
  if (/\b0 (seasons|different seasons)\b/.test(both)) say2("a span of nothing");
  if (/\bin 1 different seasons\b/.test(both)) say2("a plural that is not one");
  if (c.payload.headline.length > 170) say2("headline too long");
  if (/\.$/.test(c.payload.headline)) say2("headline ends in a full stop");
  if (seenHead.has(c.payload.headline)) say2("a headline already used");
  seenHead.add(c.payload.headline);
}
if (bad) {
  console.error(`\n${bad} card(s) failed the check. Nothing written.`);
  process.exit(1);
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "nba-player-data awardVotes + rsStats",
  cards
}));
console.log(`\n${facts.length} candidates -> ${cards.length} cards ` +
  `(${dupes} second cards about a player already in, ${capped} over a shape's cap)`);
for (const [k, n] of Object.entries(perKind)) console.log(`  ${("career:" + k).padEnd(22)} ${n}`);
console.log(`wrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);

if (SAMPLE) {
  console.log("");
  for (const c of cards.slice(0, SAMPLE)) {
    console.log("  " + c.payload.headline);
    console.log("      " + c.payload.detail + "\n");
  }
} else {
  console.log("\nRun with --sample 10 to read a few without opening the file.");
}
