/* Is the money a tell?
 *
 *     node tools/test_capcall.mjs
 *
 * The card shows two salaries and hides two scoring averages. If the cheaper
 * player wins more often than he loses - or less - a reader learns to answer
 * from the money and the card stops being a question. So the first thing
 * tested is balance, and everything else is the rules that make a pair worth
 * asking about.
 */

import { pickCapCalls, CAPCALL } from "./lib/capcall.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* A season line as build_salary.mjs joins it. */
const S = (player, year, team, salaryM, ppg) => ({
  player, year, team, salary: salaryM * 1e6, ppg, pts: Math.round(ppg * 70), gp: 70
});

console.log("\nthe rules of a pair");

{
  const seasons = [
    /* The strongest story in the fixture, so it is the one pick the balance
     * rule allows before a hold has to come next. */
    S("Cheap Scorer", 2020, "BOS", 2, 22),
    S("Dear Scorer", 2020, "LAL", 30, 10),
    S("Teammate", 2020, "BOS", 25, 12),      // same team as Cheap Scorer
    S("Near Price", 2020, "MIA", 5, 25),     // ratio to Cheap Scorer only 2.5
    S("Same Output", 2020, "DEN", 20, 21),   // gap to Cheap Scorer only 1
    S("Bench Man", 2020, "CHI", 1, 5)        // under the ppg floor
  ];
  const pairs = pickCapCalls(seasons);
  const has = (a, b) => pairs.some(p => (p.cheap.player === a && p.dear.player === b) ||
                                        (p.cheap.player === b && p.dear.player === a));
  ck("a cheap scorer against a dear one is a pair", has("Cheap Scorer", "Dear Scorer"));
  ck("teammates are never paired", !has("Cheap Scorer", "Teammate"));
  ck("a salary ratio under the floor is not a pair", !has("Cheap Scorer", "Near Price"));
  ck("a scoring gap under the floor is not a pair", !has("Cheap Scorer", "Same Output"));
  ck("a player under the ppg floor is never used", !pairs.some(p =>
    p.cheap.player === "Bench Man" || p.dear.player === "Bench Man"));
  ck("cheap is the lower salary", pairs.every(p => p.cheap.salary < p.dear.salary));
  ck("upset means the cheaper man scored more",
     pairs.every(p => p.upset === (p.cheap.ppg > p.dear.ppg)));
}

console.log("\na hold is only a question when it is close");

{
  /* Curry against a minimum-contract role player is not a question. The
   * cheaper man in a hold has to be a real scorer, and among holds the one the
   * star only just wins should rank first. */
  const seasons = [
    S("Role Player", 2020, "A", 0.6, 8.8),     // real scorer? no
    S("Star One", 2020, "B", 55, 24.5),
    S("Cheap Scorer", 2020, "C", 4, 17.3),     // yes
    S("Star Two", 2020, "D", 37, 22.9),         // gap 5.6 - a question
    S("Cheap Scorer 2", 2020, "E", 4, 14.1),
    S("Star Three", 2020, "F", 40, 30.0)        // gap 15.9 - not much of one
  ];
  const pairs = pickCapCalls(seasons, { TARGET: 10 });
  const holds = pairs.filter(p => !p.upset);
  ck("a hold against a sub-14 scorer is never offered",
     !holds.some(p => p.cheap.player === "Role Player"));
  ck("the closest hold ranks first",
     holds.length > 0 && holds[0].cheap.player === "Cheap Scorer" && holds[0].dear.player === "Star Two",
     holds.length ? holds[0].cheap.player + " v " + holds[0].dear.player : "none");
}

console.log("\nbalance, which is the whole point");

{
  /* Forty seasons of candidates where upsets are far more plentiful than
   * holds. A naive top-N by interest would be nearly all upsets. */
  const seasons = [];
  for (let y = 1991; y <= 2026; y++) {
    for (let i = 0; i < 6; i++) {
      seasons.push(S(`Cheap ${y} ${i}`, y, "T" + i, 1 + i * 0.1, 20 + i));    // cheap and good
      seasons.push(S(`Dear ${y} ${i}`, y, "U" + i, 30 + i, 12 + i));        // dear and worse
    }
    seasons.push(S(`Star ${y}`, y, "V", 35, 30));                            // the one hold
  }
  const pairs = pickCapCalls(seasons);
  const upsets = pairs.filter(p => p.upset).length;
  const holds = pairs.length - upsets;
  ck(`${pairs.length} pairs, ${upsets} upsets and ${holds} holds`, Math.abs(upsets - holds) <= 1);
  ck("the cheaper player is not always on the same side",
     pairs.some(p => p.cheapSide === "a") && pairs.some(p => p.cheapSide === "b"));
  ck("no player appears twice", (() => {
    const seen = new Set();
    for (const p of pairs) {
      if (seen.has(p.cheap.player) || seen.has(p.dear.player)) return false;
      seen.add(p.cheap.player); seen.add(p.dear.player);
    }
    return true;
  })());
  ck(`no season has more than ${CAPCALL.PER_SEASON}`, (() => {
    const n = new Map();
    for (const p of pairs) n.set(p.year, (n.get(p.year) || 0) + 1);
    return [...n.values()].every(v => v <= CAPCALL.PER_SEASON);
  })());
  ck("the pool stops at its target", pairs.length <= CAPCALL.TARGET);
}

console.log("\nrecency and determinism");

{
  const seasons = [];
  for (const y of [1995, 2025]) {
    seasons.push(S(`Cheap ${y}`, y, "A", 1, 20), S(`Dear ${y}`, y, "B", 30, 12));
    seasons.push(S(`Star ${y}`, y, "C", 35, 30), S(`Value ${y}`, y, "D", 2, 15));
  }
  const flat = pickCapCalls(seasons, { TARGET: 2 });
  const recent = pickCapCalls(seasons, { TARGET: 2, recency: y => (y >= 2020 ? 1 : 0.1) });
  ck("with recency weighting the recent season comes first",
     recent[0].year === 2025, String(recent[0].year));
  ck("without it, interest alone decides", flat.length === 2);
  const again = pickCapCalls(seasons, { TARGET: 2, recency: y => (y >= 2020 ? 1 : 0.1) });
  ck("the same data yields the same pool",
     JSON.stringify(again.map(p => [p.cheap.player, p.dear.player, p.cheapSide])) ===
     JSON.stringify(recent.map(p => [p.cheap.player, p.dear.player, p.cheapSide])));
}

console.log("\nrubbish in");

ck("no seasons, no pairs", pickCapCalls([]).length === 0);
ck("undefined does not throw", pickCapCalls(undefined).length === 0);
ck("a season with no salary is ignored",
   pickCapCalls([{ player: "X", year: 2020, team: "A", ppg: 20 }, S("Y", 2020, "B", 30, 10)]).length === 0);
ck("one player cannot be paired with himself", pickCapCalls([
  S("Same Man", 2020, "A", 1, 20), S("Same Man", 2020, "B", 30, 10)
]).length === 0);

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the salary would be a tell" : "the money misleads exactly half the time");
process.exit(fail ? 1 : 0);
