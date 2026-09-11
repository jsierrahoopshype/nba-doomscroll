/* Do the sentences make sense?
 *
 *     node tools/test_award_sentences.mjs
 *
 * WHY THE FIXTURE IS WHAT IT IS
 *
 * Every case below is a card the real builder actually produced and that
 * actually went out. No invented players, no invented teams: a previous round
 * of this work pasted synthetic fixture output as though it were sample
 * content and produced "Kings 2026" and "Clipper 1993" as though those were
 * people. So the ten facts here are the ten real cards from the live pool, and
 * what is being tested is the sentence built from each.
 *
 * WHAT WENT WRONG WITH THOSE TEN, AS ASSERTIONS
 *
 *   Eight of ten were the same sentence          -> shape variety, below
 *   "The last was Battier and World Peace"       -> plural verb agreement
 *   "Metta World Peace in 2009"                  -> he was Ron Artest then
 *   "Raptors ... in 43 seasons" (Toronto: 30)    -> the count comes in as data
 *   "He finished 5th." opening every detail      -> no detail may open with it
 *   A 7-season Rookie of the Year "drought"      -> the gates, at the bottom
 */

import {
  sentenceShapes, awardSentence, checkText, nameList, ordWord, withArticle,
  displaySurname, pastName, hashOf, minGapFor, MIN_AWARD_SEASONS, MIN_NEVER_WINDOW
} from "./lib/award_sentences.mjs";
import { identity } from "./lib/franchises.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---------------- pieces ---------------- */

console.log("\nnames, numbers, articles");

ck("fifth, not 5th", ordWord(5) === "fifth");
ck("first", ordWord(1) === "first");
ck("past ten it goes numeric", ordWord(14) === "14th", ordWord(14));
ck("nonsense yields nothing", ordWord("x") === "" && ordWord(0) === "");

ck("an MVP vote", withArticle("MVP vote") === "an MVP vote");
ck("a top-five MVP finish", withArticle("top-five MVP finish") === "a top-five MVP finish");
ck("a Rookie of the Year win", withArticle("Rookie of the Year win") === "a Rookie of the Year win");

ck("one name is singular", nameList(["A"]).plural === false);
ck("two names take a plural verb", nameList(["A", "B"]).plural === true);
ck("and read as A and B", nameList(["A", "B"]).text === "A and B");
ck("three read as a list", nameList(["A", "B", "C"]).text === "A, B and C");
ck("four collapse", nameList(["A", "B", "C", "D"]).text === "A and 3 others");
ck("none yields nothing", nameList([]) === null && nameList(undefined) === null);

ck("a plain surname", displaySurname("Cade Cunningham") === "Cunningham");
ck("a hyphenated one stays whole", displaySurname("Shai Gilgeous-Alexander") === "Gilgeous-Alexander");
ck("a suffix is not a surname", displaySurname("Larry Nance Jr.") === "Nance");
ck("a particle belongs to it", displaySurname("Norm Van Lier") === "Van Lier");
ck("and so does World Peace", displaySurname("Metta World Peace") === "World Peace");
ck("one word is its own surname", displaySurname("Nene") === "Nene");
ck("nothing does not throw", displaySurname("") === "" && displaySurname(undefined) === "");

/* The name he had that season. "Metta World Peace in 2009" dates a sentence to
 * a season under a name that did not exist for two more years. */
ck("2009 was Ron Artest", pastName("Metta World Peace", 2009) === "Ron Artest");
ck("2015 was Metta World Peace", pastName("Metta World Peace", 2015) === "Metta World Peace");
ck("the later renaming too",
   pastName("Metta Sandiford-Artest", 2015) === "Metta World Peace",
   pastName("Metta Sandiford-Artest", 2015));
ck("and 2009 still resolves to Artest", pastName("Metta Sandiford-Artest", 2009) === "Ron Artest");
ck("1970 was Lew Alcindor", pastName("Kareem Abdul-Jabbar", 1970) === "Lew Alcindor");
ck("1990 was not", pastName("Kareem Abdul-Jabbar", 1990) === "Kareem Abdul-Jabbar");
ck("everybody else is unchanged", pastName("Rudy Gobert", 2024) === "Rudy Gobert");

console.log("\nthe hash has to spread, or every card picks the same shape");

/* This is not a theoretical check. Shape selection is `hash % shapes.length`,
 * and with plain FNV-1a nine of the ten real cards below picked shape zero:
 * FNV's low bits barely move, and `% 4` reads only the lowest two. The hash
 * was fine and the use of it was not. A distribution bug presents as "the
 * cards all look the same", so it belongs in this file rather than filed as a
 * curiosity about hash functions. */
{
  const keys = [];
  for (const p of ["Scottie Barnes", "Cade Cunningham", "Dyson Daniels", "Keldon Johnson",
                   "Deni Avdija", "VJ Edgecombe", "Amen Thompson", "Alex Sarr",
                   "Rudy Gobert", "Naz Reid", "Nikola Jokic", "Jalen Brunson",
                   "Anthony Edwards", "Tyrese Haliburton", "Evan Mobley", "Jaren Jackson Jr."]) {
    for (const a of ["MVP", "DPOY", "ROY", "Sixth Man"]) keys.push(p + "|" + a + "|2026|top");
  }
  for (const n of [2, 3, 4, 5]) {
    const buckets = new Array(n).fill(0);
    for (const k of keys) buckets[hashOf(k) % n]++;
    /* With 64 keys over n buckets, every bucket should be busy. A bucket
     * holding more than two thirds of everything is the bug. */
    const worst = Math.max(...buckets);
    ck(`% ${n} spreads across all ${n} shapes`,
       buckets.every(b => b > 0) && worst < keys.length * 0.66, buckets.join("/"));
  }
  ck("and it is stable", hashOf("Naz Reid|Sixth Man|2024|top") === hashOf("Naz Reid|Sixth Man|2024|top"));
  ck("a different fact hashes differently",
     hashOf("Naz Reid|Sixth Man|2024|top") !== hashOf("Naz Reid|Sixth Man|2025|top"));
}

/* ---------------- the ten real cards ---------------- */

/* Each fact is a real card from the live pool. `year` is checked against
 * sinceYear + gap + 1 below, which is how the gap's off-by-one was caught the
 * first time: a gap counts the seasons BETWEEN two appearances, both ends
 * excluded, so a 2006 predecessor with a gap of 19 puts the new one in 2026. */
const F = (o) => ({
  surname: displaySurname(o.player),
  id: identity(o.team, o.year),
  sinceId: o.sinceYear ? identity(o.team, o.sinceYear) : null,
  sinceSeasons: o.gap == null ? null : o.gap + 1,
  sinceSurname: (o.sinceNames || []).length === 1
    ? displaySurname(pastName(o.sinceNames[0], o.sinceYear)) : null,
  ...o,
  sinceNames: (o.sinceNames || []).map(n => pastName(n, o.sinceYear))
});

const REAL = [
  F({ player: "Scottie Barnes", team: "raptors", awardKey: "DPOY",
      label: "Defensive Player of the Year", year: 2026, rank: 5,
      scope: "top", kind: "first-in-window",
      seasonsCovered: 30, windowFrom: 1996, wholeHistory: true, sameIdentityThroughout: true }),
  F({ player: "Cade Cunningham", team: "pistons", awardKey: "MVP", label: "MVP",
      year: 2026, rank: 5, scope: "top", kind: "first-since",
      sinceYear: 2006, gap: 19, sinceNames: ["Chauncey Billups"], sinceRank: 5 }),
  F({ player: "Dyson Daniels", team: "hawks", awardKey: "MIP",
      label: "Most Improved Player", year: 2025, rank: 1,
      scope: "win", kind: "first-since",
      sinceYear: 1998, gap: 26, sinceNames: ["Alan Henderson"], sinceRank: 1 }),
  F({ player: "Keldon Johnson", team: "spurs", awardKey: "Sixth Man",
      label: "Sixth Man of the Year", year: 2026, rank: 1,
      scope: "top", kind: "first-since",
      sinceYear: 2014, gap: 11, sinceNames: ["Manu Ginobili"], sinceRank: null }),
  F({ player: "Deni Avdija", team: "blazers", awardKey: "MIP",
      label: "Most Improved Player", year: 2026, rank: 3,
      scope: "top", kind: "first-since",
      sinceYear: 2016, gap: 9, sinceNames: ["CJ McCollum"], sinceRank: 1 }),
  F({ player: "VJ Edgecombe", team: "sixers", awardKey: "ROY",
      label: "Rookie of the Year", year: 2026, rank: 3,
      scope: "top", kind: "first-since",
      sinceYear: 2018, gap: 7, sinceNames: ["Ben Simmons"], sinceRank: 1 }),
  /* The plural one, and the renamed one, in a single card. */
  F({ player: "Amen Thompson", team: "rockets", awardKey: "DPOY",
      label: "Defensive Player of the Year", year: 2025, rank: 5,
      scope: "top", kind: "first-since",
      sinceYear: 2009, gap: 15, sinceNames: ["Shane Battier", "Metta World Peace"] }),
  F({ player: "Alex Sarr", team: "wizards", awardKey: "ROY",
      label: "Rookie of the Year", year: 2025, rank: 4,
      scope: "top", kind: "first-since",
      sinceYear: 2013, gap: 11, sinceNames: ["Bradley Beal"], sinceRank: null }),
  F({ player: "Rudy Gobert", team: "timberwolves", awardKey: "DPOY",
      label: "Defensive Player of the Year", year: 2024, rank: 1,
      scope: "top", kind: "first-since",
      sinceYear: 2003, gap: 20, sinceNames: ["Kevin Garnett"], sinceRank: null }),
  F({ player: "Naz Reid", team: "timberwolves", awardKey: "Sixth Man",
      label: "Sixth Man of the Year", year: 2024, rank: 1,
      scope: "top", kind: "first-since",
      sinceYear: 2001, gap: 22, sinceNames: ["LaPhonso Ellis"], sinceRank: null })
];

console.log("\nthe fixture is internally consistent");

{
  let bad = 0;
  for (const f of REAL) {
    if (f.kind !== "first-since") continue;
    if (f.sinceYear + f.gap + 1 !== f.year) {
      bad++;
      console.log(`        ${f.player}: ${f.sinceYear} + ${f.gap} + 1 is not ${f.year}`);
    }
  }
  ck("every gap lines its two seasons up", bad === 0);
  ck("every fixture resolved a franchise identity", REAL.every(f => !!f.id));
}

console.log("\nevery shape of every card is fit to ship");

{
  let bad = 0, shapes = 0;
  for (const f of REAL) {
    const all = sentenceShapes(f);
    if (!all.length) { bad++; console.log(`        ${f.player}: no sentence at all`); continue; }
    shapes += all.length;
    for (const s of all) {
      for (const why of checkText(s.head, s.detail)) {
        bad++;
        console.log(`        ${f.player} [${s.shape}] ${why}`);
        console.log(`            ${s.head}`);
        console.log(`            ${s.detail}`);
      }
    }
  }
  ck(`${shapes} sentence pairs across ${REAL.length} cards, all clean`, bad === 0);
  ck("every card has at least two structures to choose from",
     REAL.every(f => sentenceShapes(f).length >= 2));
}

console.log("\nthe specific defects that shipped");

{
  const thompson = REAL.find(f => f.player === "Amen Thompson");
  const all = sentenceShapes(thompson);
  const text = all.map(s => s.head + " " + s.detail).join(" ");
  ck("two predecessors take a plural verb", / were /.test(text) && !/\band Ron Artest was\b/.test(text));
  ck("and he is called Ron Artest, which is who he was in 2009",
     text.includes("Ron Artest") && !text.includes("World Peace"));
  ck("no shape puts two names either side of 'and him'",
     all.every(s => !/ and him\b/.test(s.detail)));
}

{
  /* A franchise-first WIN, which the gates used to refuse. Rudy Gobert won
   * Defensive Player of the Year for a Minnesota team that had never won it;
   * the card fell back to a top-five drought instead. */
  const first = F({
    player: "Rudy Gobert", team: "timberwolves", awardKey: "DPOY",
    label: "Defensive Player of the Year", year: 2024, rank: 1,
    scope: "win", kind: "first-in-window",
    seasonsCovered: 34, windowFrom: 1990, wholeHistory: true, sameIdentityThroughout: true
  });
  const all = sentenceShapes(first);
  ck("a franchise-first win produces sentences", all.length >= 2, String(all.length));
  ck("one of them says franchise history", all.some(s => s.shape === "never-franchise"));
  ck("every one is clean", all.every(s => checkText(s.head, s.detail).length === 0));
  /* "the first Timberwolf to win DPOY in 34 seasons" reads as "the last was 34
   * seasons ago". The headline is what gets shared, so it must not be the
   * sentence a reader gets backwards. */
  const count = all.find(s => s.shape === "never-count");
  ck("the count shape is phrased as an absence, not a first-since",
     count && /^No Timberwolf had won/.test(count.head), count && count.head);
  ck("a win needs no rank line", all.every(s => !/finished/.test(s.detail)));
  ck("and a never-window exists for a win", MIN_NEVER_WINDOW.win >= 20);
}

{
  const barnes = REAL.find(f => f.player === "Scottie Barnes");
  const text = sentenceShapes(barnes).map(s => s.head + " " + s.detail).join(" ");
  ck("the Raptors card counts 30 seasons", text.includes("30 seasons"));
  ck("and never 43, which is the award's span and not the team's", !text.includes("43"));
  ck("it can say franchise history, because Toronto is younger than the award",
     sentenceShapes(barnes).some(s => s.shape === "never-franchise"));
}

{
  let bad = 0;
  for (const f of REAL) {
    for (const s of sentenceShapes(f)) {
      /* "He finished 5th." opened every detail on the live site. It is a fine
       * closing clause and a terrible first impression. */
      if (/^He finished/.test(s.detail)) {
        bad++; console.log(`        ${f.player} [${s.shape}] opens with the rank`);
      }
      /* The award's full name twice in one card is the redundancy Jorge
       * flagged. Once in the headline, never again. */
      const n = (s.head + " " + s.detail).split(f.label).length - 1;
      if (n > 1) {
        bad++; console.log(`        ${f.player} [${s.shape}] says "${f.label}" ${n} times`);
      }
    }
  }
  ck("no detail opens with the rank, and no award is named twice", bad === 0);
}

{
  /* A rank-1 finisher used to be told "He finished 1st." */
  const reid = awardSentence(REAL.find(f => f.player === "Naz Reid"));
  ck("winning is described as winning, not as finishing 1st",
     !/1st/.test(reid.head + reid.detail), reid.detail.trim());
}

console.log("\nvariety, which was the whole complaint");

{
  const firsts = REAL.map(f => awardSentence(f).shape);
  const distinct = new Set(firsts);
  ck(`${REAL.length} cards produce ${distinct.size} different structures`, distinct.size >= 4,
     [...distinct].join(" "));
  const heads = REAL.map(f => awardSentence(f).head);
  ck("no two headlines are identical", new Set(heads).size === heads.length);

  /* The old output's tell: every headline began with the player's name. */
  const leadsWithPlayer = REAL.filter((f, i) => heads[i].startsWith(f.player)).length;
  ck(`only ${leadsWithPlayer} of ${REAL.length} lead with the player's name`,
     leadsWithPlayer < REAL.length - 1, String(leadsWithPlayer));

  /* Stable between builds, or the feed reshuffles its own sentences every
   * time the pool is rebuilt. */
  ck("the same fact always picks the same shape",
     REAL.every(f => awardSentence(f).shape === awardSentence(f).shape));
}

console.log("\nhouse style is enforced, not hoped for");

ck("an em-dash fails", checkText("A headline", "A detail — with a dash.").length > 0);
ck("'ever' fails", checkText("The first ever Piston", "A detail.").length > 0);
ck("a headline ending in a period fails", checkText("A headline.", "A detail.").length > 0);
ck("a detail without one fails", checkText("A headline", "A detail").length > 0);
ck("a plural subject with was fails",
   checkText("A headline", "Battier and Artest was the last.").length > 0);
ck("a failed calculation fails", checkText("First in NaN seasons", "A detail.").length > 0);
ck("a doubled space fails", checkText("A  headline", "A detail.").length > 0);
ck("a clean pair passes", checkText("Detroit waited 20 seasons", "Billups was the last, in 2006.").length === 0);
ck("nothing does not throw", checkText(undefined, undefined).length > 0);

console.log("\nthe gates, which is why four of those ten no longer ship");

/* Five players finish top five each season. Across thirty teams that is one
 * appearance per team per six years, so a seven-season Rookie of the Year gap
 * is close to chance and a card about it teaches the reader that the label
 * means nothing. */
const GATED = [
  ["Keldon Johnson", "Sixth Man", "top", 11, false],
  ["Deni Avdija", "MIP", "top", 9, false],
  ["VJ Edgecombe", "ROY", "top", 7, false],
  ["Alex Sarr", "ROY", "top", 11, false],
  ["Cade Cunningham", "MVP", "top", 19, true],
  ["Dyson Daniels", "MIP", "win", 26, true],
  ["Amen Thompson", "DPOY", "top", 15, true],
  ["Rudy Gobert", "DPOY", "top", 20, true],
  ["Naz Reid", "Sixth Man", "top", 22, true]
];
{
  let bad = 0;
  for (const [who, award, scope, gap, want] of GATED) {
    const got = gap >= minGapFor(award, scope);
    if (got !== want) {
      bad++;
      console.log(`        ${who}: gap ${gap} vs ${award}/${scope} gate ` +
        `${minGapFor(award, scope)} - expected ${want ? "a card" : "no card"}`);
    }
  }
  ck("the four thin ones are out and the six real ones are in", bad === 0);
}

ck("an unknown award gets the strictest gate", minGapFor("Nope", "top") === minGapFor("ROY", "top"));
ck("a win needs a longer gap than a vote", minGapFor("MVP", "win") > minGapFor("MVP", "any"));
ck("Rookie of the Year is the hardest, because the field turns over yearly",
   minGapFor("ROY", "top") > minGapFor("MVP", "top"));
ck("a never-claim needs 20 seasons", MIN_NEVER_WINDOW.top >= 20 && MIN_NEVER_WINDOW.any >= 20);
ck("and an award needs 20 seasons of its own before any of this",
   MIN_AWARD_SEASONS >= 20);

/* ---------------- read them ---------------- */

console.log("\n  the six that survive, as they would appear:\n");
for (const f of REAL) {
  const gate = f.kind === "first-in-window"
    ? f.seasonsCovered >= (MIN_NEVER_WINDOW[f.scope] || 20)
    : f.gap >= minGapFor(f.awardKey, f.scope);
  if (!gate) continue;
  const s = awardSentence(f);
  console.log("  " + s.head);
  console.log("     " + s.detail);
  console.log("     [" + s.shape + "]\n");
}

console.log(fail ? `${fail} failed` : "0 failed");
console.log(fail
  ? "a sentence that does not make sense is worse than no card"
  : "ten real cards, six that earn a place, and no two built the same way");
process.exit(fail ? 1 : 0);
