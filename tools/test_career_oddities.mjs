/* Careers the voting remembers differently, and the claims it must not make.
 *
 *     node tools/test_career_oddities.mjs
 *
 * The interesting failure is not a miscounted season. It is the cliff: "drew
 * MVP votes and was out of the league within two years" is a great card and a
 * lie when the player's last season is the last season in the file. He is not
 * gone, the data stops. Most of these check that kind of restraint.
 */

import { careerOddities, awardSpans, GONE_AFTER, PERENNIAL_MIN_SEASONS }
  from "./lib/career_oddities.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const v = (player, award, year, rnk) => ({ PLAYER: player, AWARD: award, YEAR: String(year), RNK: rnk });
const kinds = (facts, player) => facts.filter(f => f.player === player).map(f => f.kind).sort();
const one = (facts, player, kind) => facts.find(f => f.player === player && f.kind === kind);

/* A file covering four awards across a long span, so "never won anything" is a
 * claim the data can support. */
const SPANS = new Map([
  ["MVP", { from: 1956, to: 2026 }],
  ["DPOY", { from: 1983, to: 2026 }],
  ["MIP", { from: 1986, to: 2026 }],
  ["Sixth Man", { from: 1984, to: 2026 }]
]);

console.log("\nthe career that was always nearly enough");

{
  const votes = [];
  for (let y = 2000; y < 2010; y++) votes.push(v("Nearly Man", "MVP", y, 6));
  const facts = careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: SPANS });
  const f = one(facts, "Nearly Man", "perennial");
  ck("ten vote-drawing seasons and no win is a card", !!f);
  ck("it counts the seasons", f && f.seasons === 10, f && String(f.seasons));
  ck("and the span", f && f.from === 2000 && f.to === 2009);
}

{
  /* Three seasons is a run, not a career. */
  const votes = [v("Brief", "MVP", 2001, 8), v("Brief", "MVP", 2002, 9), v("Brief", "MVP", 2003, 7)];
  const facts = careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: SPANS });
  ck("three seasons is not a perennial", !kinds(facts, "Brief").includes("perennial"),
     kinds(facts, "Brief").join(","));
  ck("the bar is a named constant", PERENNIAL_MIN_SEASONS >= 5, String(PERENNIAL_MIN_SEASONS));
}

{
  /* A winner is never "always nearly". */
  const votes = [];
  for (let y = 2000; y < 2010; y++) votes.push(v("Winner", "MVP", y, y === 2005 ? 1 : 4));
  const facts = careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: SPANS });
  ck("a career with a win is not a perennial",
     !kinds(facts, "Winner").includes("perennial"));
}

{
  /* A file that only covers one award cannot support "never won ANYTHING". */
  const thin = new Map([["Clutch", { from: 2023, to: 2026 }]]);
  const votes = [];
  for (let y = 2023; y < 2026; y++) {
    votes.push(v("Modern", "Clutch", y, 5), v("Modern", "Clutch", y - 10, 6));
  }
  const facts = careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: thin });
  ck("one covered award is not enough to say never won anything",
     !kinds(facts, "Modern").includes("perennial"));
}

console.log("\nwhich finish counts as the best one");

{
  /* THE SENTENCE THIS FIXES. Sorting the top fives by placing alone said "his
   * best finish was second for Most Improved Player" about a man with a
   * top-five MVP season, because 2 is less than 5. */
  const PRESTIGE = new Map([["MVP", 0], ["DPOY", 1], ["MIP", 3], ["Sixth Man", 4]]);
  const votes = [];
  for (let y = 2000; y < 2010; y++) votes.push(v("Both", "MVP", y, y === 2004 ? 5 : 9));
  votes.push(v("Both", "MIP", 2001, 2));
  const withOrder = careerOddities(votes, new Map(),
    { dataTo: 2026, awardSpan: SPANS, prestige: PRESTIGE });
  const f = one(withOrder, "Both", "perennial");
  ck("the more prestigious award wins over the better placing",
     f && f.best.award === "MVP" && f.best.rnk === 5,
     f && f.best.award + " " + f.best.rnk);

  /* Without an order the library does not invent one: it falls back to the
   * placing, which is the old behaviour and still what a caller with no view
   * on prestige should get. */
  const without = one(careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: SPANS }),
    "Both", "perennial");
  ck("with no order given, the placing decides",
     without && without.best.award === "MIP" && without.best.rnk === 2,
     without && without.best.award + " " + without.best.rnk);

  /* An award the order does not mention sorts last rather than first. */
  const partial = new Map([["MVP", 0]]);
  const f2 = one(careerOddities(votes, new Map(),
    { dataTo: 2026, awardSpan: SPANS, prestige: partial }), "Both", "perennial");
  ck("an unranked award does not outrank a ranked one",
     f2 && f2.best.award === "MVP", f2 && f2.best.award);
}

console.log("\none season that stands up out of a career");

{
  const votes = [
    v("One Year", "MVP", 2004, 4),      // the top five
    v("One Year", "MVP", 2005, 11),     // votes, but not top five
    v("One Year", "MIP", 2006, 9)
  ];
  const facts = careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: SPANS });
  const f = one(facts, "One Year", "one-top-five");
  ck("a single top-five finish is a card", !!f);
  ck("it names the season and the placing",
     f && f.year === 2004 && f.rnk === 4 && f.award === "MVP");
  ck("and it knows the career was longer than that",
     f && f.seasons === 3, f && String(f.seasons));
}

{
  const votes = [v("Twice", "MVP", 2004, 4), v("Twice", "MVP", 2006, 5), v("Twice", "MVP", 2008, 9)];
  const facts = careerOddities(votes, new Map(), { dataTo: 2026, awardSpan: SPANS });
  ck("two top-five finishes is not the same story",
     !kinds(facts, "Twice").includes("one-top-five"));
}

console.log("\nthe cliff, and the reason it is usually not one");

{
  /* Votes in 2010, last played 2011, and the data runs to 2026: fifteen
   * seasons of clear air, so he really did go. */
  const facts = careerOddities([v("Fell Off", "MVP", 2010, 5)],
    new Map([["Fell Off", 2011]]), { dataTo: 2026, awardSpan: SPANS });
  const f = one(facts, "Fell Off", "cliff");
  ck("votes then gone is a card", !!f);
  ck("it knows both years", f && f.voteYear === 2010 && f.lastPlayed === 2011);
}

{
  /* THE LIE THIS PREVENTS. Votes in 2025, last played 2026, data ends 2026.
   * He is not out of the league; the file stops. */
  const facts = careerOddities([v("Still Here", "MVP", 2025, 5)],
    new Map([["Still Here", 2026]]), { dataTo: 2026, awardSpan: SPANS });
  ck("a career ending at the edge of the data is not a cliff",
     !kinds(facts, "Still Here").includes("cliff"), kinds(facts, "Still Here").join(","));
}

{
  /* Two seasons of clear air is not enough either. */
  const facts = careerOddities([v("Maybe", "MVP", 2022, 5)],
    new Map([["Maybe", 2024]]), { dataTo: 2026, awardSpan: SPANS });
  ck("clear air shorter than the constant is not a cliff",
     !kinds(facts, "Maybe").includes("cliff"));
  ck("and the constant is stated", GONE_AFTER >= 2, String(GONE_AFTER));
}

{
  /* Votes long before the end of a career is not a cliff, it is a career. */
  const facts = careerOddities([v("Long Career", "MVP", 2000, 5)],
    new Map([["Long Career", 2012]]), { dataTo: 2026, awardSpan: SPANS });
  ck("votes a decade before retirement is not a cliff",
     !kinds(facts, "Long Career").includes("cliff"));
}

{
  /* No stats row at all: nothing is known about when he stopped, so nothing is
   * claimed about it. */
  const facts = careerOddities([v("Unknown", "MVP", 2010, 5)], new Map(),
    { dataTo: 2026, awardSpan: SPANS });
  ck("a player with no last season is not a cliff",
     !kinds(facts, "Unknown").includes("cliff"));
  ck("and no dataTo means no cliff at all",
     !careerOddities([v("Unknown", "MVP", 2010, 5)], new Map([["Unknown", 2011]]),
       { awardSpan: SPANS }).some(f => f.kind === "cliff"));
}

console.log("\nthe one-shot");

{
  const facts = careerOddities([v("One Shot", "Sixth Man", 2014, 1)], new Map(),
    { dataTo: 2026, awardSpan: SPANS });
  const f = one(facts, "One Shot", "one-shot");
  ck("a single win and no other vote, ever, is a card", !!f);
  ck("it names the award and season", f && f.award === "Sixth Man" && f.year === 2014);
}

{
  const facts = careerOddities([v("More", "Sixth Man", 2014, 1), v("More", "MVP", 2016, 9)],
    new Map(), { dataTo: 2026, awardSpan: SPANS });
  ck("a winner who drew other votes is not a one-shot",
     !kinds(facts, "More").includes("one-shot"));
}

console.log("\nspans, read from the votes themselves");

{
  const spans = awardSpans([
    v("A", "MVP", 1956, 1), v("B", "MVP", 2026, 1),
    v("C", "Hustle", 2017, 1), v("D", "Hustle", 2026, 1)
  ]);
  ck("MVP spans the file", spans.get("MVP").from === 1956 && spans.get("MVP").to === 2026);
  ck("a young award does not", spans.get("Hustle").from === 2017);
  ck("and each knows its own seasons", spans.get("Hustle").seasons.size === 2);
}

console.log("\nrubbish in");

ck("no votes, no facts", careerOddities([], new Map(), { dataTo: 2026 }).length === 0);
ck("undefined does not throw", careerOddities(undefined, undefined, undefined).length === 0);
ck("a row with no player is skipped",
   careerOddities([{ AWARD: "MVP", YEAR: "2010" }], new Map(), { dataTo: 2026 }).length === 0);
ck("a row with no year is skipped",
   careerOddities([{ PLAYER: "X", AWARD: "MVP" }], new Map(), { dataTo: 2026 }).length === 0);
ck("a blank award is skipped",
   careerOddities([{ PLAYER: "X", AWARD: "  ", YEAR: "2010" }], new Map(), { dataTo: 2026 }).length === 0);
ck("no spans, no perennial claim", (() => {
  const votes = [];
  for (let y = 2000; y < 2012; y++) votes.push(v("Nobody", "MVP", y, 6));
  return !careerOddities(votes, new Map(), { dataTo: 2026 }).some(f => f.kind === "perennial");
})());
ck("empty spans map does not throw", awardSpans([]).size === 0);

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "it would say somebody left a league he is still in"
                 : "it only claims careers the votes can prove");
process.exit(fail ? 1 : 0);
