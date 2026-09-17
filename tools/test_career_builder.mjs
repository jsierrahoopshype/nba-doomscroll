/* The career builder's arithmetic, against seasons whose answer is known.
 *
 *     node tools/test_career_builder.mjs
 *
 * WHY THIS EXISTS, when lib/career_oddities.mjs already has a suite.
 *
 * The library takes seasons as numbers and is tested that way. The bug this
 * file was written for lived in the half-inch of code between the JSON and the
 * library: rsStats YEAR is a season's ENDING year, the builder's comment said
 * it was the starting year, and so it added one. dataTo moved with it, which
 * meant the cliff gate kept letting through exactly the right players, and
 * every library test kept passing. What broke was the prose. Fourteen cards
 * went out naming a man's departure one season late and crediting him with one
 * more season than he played.
 *
 * A unit test could not see that, because the units never reach the library.
 * So this one drives the real builder over a fixture whose truth is stated in
 * the fixture itself, and reads the sentence that comes out.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dirname, "build_career_oddities.mjs");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---------------- the fixture ----------------
 *
 * Every YEAR here is a season's ENDING year, which is what rsStats uses:
 * "2015" is the 2014-15 season. The truth each card must tell is spelled out
 * next to the rows that encode it, so a future reader can check the assertion
 * against the data rather than against another assertion.
 */

const votes = [];
/* Cliff Test: a DOWN-BALLOT MVP vote in 2014-15 (ninth, so not a top five),
 * one more season after it (2015-16), then never plays again. So: out of the
 * league by 2016-17, having played ONE more season after the ballots. Ninth
 * rather than fifth on purpose - fifth is a different card now, and this one
 * exists to check the season arithmetic in the plainest wording. */
votes.push({ PLAYER: "Cliff Test", AWARD: "MVP", YEAR: "2015", RNK: "9" });

/* Same Season: a down-ballot vote in his final season. Nothing after it. */
votes.push({ PLAYER: "Same Season", AWARD: "DPOY", YEAR: "2010", RNK: "11" });

/* Fifth Then One More: a top-five finish with a season still to play after it,
 * which is the fourth corner of the won/topFive by after/no-after grid. */
votes.push({ PLAYER: "Fifth Then One More", AWARD: "MVP", YEAR: "2004", RNK: "5" });

/* Still Here: a vote in the last season the data covers, and he is still in
 * it. Not a cliff at any threshold - the file stops, he did not. */
votes.push({ PLAYER: "Still Here", AWARD: "MVP", YEAR: "2026", RNK: "5" });

/* Won And Left: the Bill Walton shape. Won Sixth Man in 1985-86, played one
 * more season, gone. The card must say he WON it. */
votes.push({ PLAYER: "Won And Left", AWARD: "Sixth Man", YEAR: "1986", RNK: "1" });

/* Fourth And Done: the Bill Russell shape. Fourth for MVP in 1968-69 and never
 * played again. The card must not read as a man who fell apart. */
votes.push({ PLAYER: "Fourth And Done", AWARD: "MVP", YEAR: "1969", RNK: "4" });

/* Wound Down: drew a down-ballot vote and then played TWO more seasons. Not a
 * cliff any more - that is a career ending on schedule. */
votes.push({ PLAYER: "Wound Down", AWARD: "MVP", YEAR: "2000", RNK: "11" });

/* Late Ballot: drew ROY votes as a rookie and a Sixth Man vote on the way out.
 * The card must name Sixth Man, the award from his final season, not ROY,
 * which is merely the first award in his rows. */
votes.push({ PLAYER: "Late Ballot", AWARD: "ROY", YEAR: "1996", RNK: "8" });
votes.push({ PLAYER: "Late Ballot", AWARD: "Sixth Man", YEAR: "2006", RNK: "9" });

/* Filler, so the award spans look like a real file and "won none of them" has
 * enough covered awards to be sayable. */
for (let y = 1956; y <= 2026; y++) votes.push({ PLAYER: "Filler A", AWARD: "MVP", YEAR: String(y), RNK: "9" });
for (let y = 1983; y <= 2026; y++) votes.push({ PLAYER: "Filler B", AWARD: "DPOY", YEAR: String(y), RNK: "9" });
for (let y = 1986; y <= 2026; y++) votes.push({ PLAYER: "Filler C", AWARD: "MIP", YEAR: String(y), RNK: "9" });

const rsStats = [
  { PLAYER: "Cliff Test", YEAR: "2015", GP: "70" },
  { PLAYER: "Cliff Test", YEAR: "2016", GP: "41" },   // the one more season
  { PLAYER: "Same Season", YEAR: "2010", GP: "66" },  // and no further row
  { PLAYER: "Still Here", YEAR: "2026", GP: "36" },   // sets the end of the data
  { PLAYER: "Filler A", YEAR: "2026", GP: "80" },
  { PLAYER: "Won And Left", YEAR: "1986", GP: "80" },
  { PLAYER: "Won And Left", YEAR: "1987", GP: "10" },  // one more, then gone
  { PLAYER: "Fourth And Done", YEAR: "1969", GP: "77" },
  { PLAYER: "Wound Down", YEAR: "2000", GP: "70" },
  { PLAYER: "Wound Down", YEAR: "2001", GP: "60" },
  { PLAYER: "Wound Down", YEAR: "2002", GP: "44" },    // two more: not a cliff
  { PLAYER: "Late Ballot", YEAR: "1996", GP: "75" },
  { PLAYER: "Late Ballot", YEAR: "2006", GP: "62" },
  { PLAYER: "Fifth Then One More", YEAR: "2004", GP: "78" },
  { PLAYER: "Fifth Then One More", YEAR: "2005", GP: "31" }
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-builder-"));
fs.writeFileSync(path.join(dir, "awardVotes.json"), JSON.stringify(votes));
fs.writeFileSync(path.join(dir, "rsStats.json"), JSON.stringify(rsStats));
const out = path.join(dir, "pool.json");

let log = "";
try {
  log = execFileSync(process.execPath, [BUILDER, "--local", dir, "--out", out],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.log("  FAIL the builder did not finish");
  console.log(String((e.stdout || "") + (e.stderr || "")).split("\n").map(l => "    " + l).join("\n"));
  process.exit(1);
}

const cards = JSON.parse(fs.readFileSync(out, "utf8")).cards;
const card = who => cards.find(c => (c.payload.subjects || [])[0] === who);
const fam = who => { const c = card(who); return c ? c.story_family : "(no card)"; };

console.log("\nthe season the data ends in");

/* THE OFF-BY-ONE, STATED AS A NUMBER. The newest row is YEAR 2026, which is
 * the 2025-26 season, so the data runs to 2026. It said 2027 for a day. */
ck("dataTo is the newest season in the file, not one past it",
   /data runs to 2026\b/.test(log), (log.match(/data runs to \d+/) || ["(not printed)"])[0]);
ck("and it is reported next to the newest ballot, so a drift is visible",
   /newest award season 2026/.test(log));

console.log("\nthe cliff, whose truth is in the fixture above");

{
  const c = card("Cliff Test");
  ck("a career that ends well inside the data is a cliff", !!c && c.story_family === "career:cliff",
     fam("Cliff Test"));
  /* Voted 2014-15. Played 2015-16. First season missed: 2016-17. */
  ck("it names the first season he was gone, not the second",
     !!c && /out of the league by 2016-17\b/.test(c.payload.headline),
     c && c.payload.headline);
  /* The count, not the sentence around it. An earlier version of this check
   * pinned the whole clause and broke the moment the prose was tightened,
   * which tests a wording rather than an arithmetic. */
  ck("and counts the seasons after the ballots correctly",
     !!c && /\bone more season\b/.test(c.payload.detail) &&
     !/\b[2-9] more seasons\b/.test(c.payload.detail),
     c && c.payload.detail);
  ck("the vote's own season is right too",
     !!c && /vote in 2014-15\./.test(c.payload.headline), c && c.payload.headline);
}

{
  const c = card("Same Season");
  ck("a vote in a man's last season is a cliff", !!c && c.story_family === "career:cliff",
     fam("Same Season"));
  /* Voted 2009-10, played nothing after. The zero branch has to fire here; it
   * was unreachable while every count was inflated by one. It does not claim a
   * departure season, because there is nothing between the ballots and the end
   * to put one in. */
  ck("it says that season was the last one he played",
     !!c && /2009-10, the last season he ever played/.test(c.payload.headline),
     c && c.payload.headline);
  ck("and does not count a season that is not there",
     !!c && !/more season/.test(c.payload.detail), c && c.payload.detail);
}

{
  const c = card("Fifth Then One More");
  ck("a top five with a season left to play names both",
     !!c && /finished fifth for MVP in 2003-04/.test(c.payload.headline) &&
     /out of the league by 2005-06\b/.test(c.payload.headline),
     c && c.payload.headline);
  ck("and counts the one season after the finish",
     !!c && /\bone more season\b/.test(c.payload.detail), c && c.payload.detail);
}

console.log("\nthe career the data cannot see the end of");

ck("a player still in the newest season is not out of the league",
   fam("Still Here") !== "career:cliff", fam("Still Here"));

ck("and a career that wound down over two more seasons is not a fall",
   fam("Wound Down") !== "career:cliff", fam("Wound Down"));

console.log("\nthe three endings, which are not the same story");

{
  /* THE BILL WALTON CARD. He won Sixth Man of the Year in 1985-86 and the first
   * build said he "drew a Sixth Man of the Year vote", which buries the only
   * fact on the card. */
  const c = card("Won And Left");
  ck("a man who won the award is not described as drawing a vote for it",
     !!c && !/drew a/.test(c.payload.headline), c && c.payload.headline);
  ck("it says he won it", !!c && /won Sixth Man of the Year in 1985-86/.test(c.payload.headline));
  ck("and when he left", !!c && /out of the league by 1987-88\b/.test(c.payload.headline));
}

{
  /* THE BILL RUSSELL CARD. Fourth for MVP in his final season. "Out of the
   * league by" reads as collapse about a man who chose to stop. */
  const c = card("Fourth And Done");
  ck("a top-five finish in a final season is not called being out of the league",
     !!c && !/out of the league/.test(c.payload.headline), c && c.payload.headline);
  ck("it names the finish", !!c && /finished fourth for MVP in 1968-69/.test(c.payload.headline));
  ck("and says he stopped rather than that he was dropped",
     !!c && /never played another NBA season/.test(c.payload.headline));
}

{
  /* The award has to be the one from the final season. */
  const c = card("Late Ballot");
  ck("the award named is the one his last ballots were for",
     !!c && /Sixth Man of the Year/.test(c.payload.headline), c && c.payload.headline);
  ck("not the first award in his career",
     !!c && !/Rookie of the Year/.test(c.payload.headline));
}

console.log("\nthe fourteen published are the best fourteen, not the first fourteen");

{
  /* THE ALPHABET BUG. Cliff facts carried no `seasons`, the one comparator fell
   * through to the name, and out of 128 candidates the published fourteen ran
   * Al Harrington to Bob Love. Here the strongest cliff is a first-place finish
   * belonging to a player whose name sorts last of the four. */
  const order = cards.filter(c => c.story_family === "career:cliff")
    .map(c => (c.payload.subjects || [])[0]);
  ck("a win sorts above a fourth, a fifth, two ninths and an eleventh",
     order[0] === "Won And Left", order.join(" | "));
  ck("and the fourth above the fifth",
     order[1] === "Fourth And Done" && order[2] === "Fifth Then One More",
     order.join(" | "));
  ck("and the order is not the players' names",
     order.join("|") !== order.slice().sort().join("|"), order.join(" | "));
}

console.log("\nnothing a card says is a season of nonsense");

for (const c of cards) {
  const both = c.payload.headline + " " + c.payload.detail;
  if (/\b(NaN|undefined|Infinity)\b/.test(both)) ck("a number that is not one", false, c.payload.headline);
  /* A season label built from a shifted year shows up here: 2026-27 has not
   * been played, so no card can mention it. */
  if (/\b20(2[6-9]|[3-9]\d)-\d\d\b/.test(both)) ck("a season that has not happened", false, c.payload.headline);
}
ck("no card names an unplayed season", true);

fs.rmSync(dir, { recursive: true, force: true });

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "it would put a man out of a league a season before he left it"
                 : "the sentences agree with the seasons in the file");
process.exit(fail ? 1 : 0);
