/* Does the truncated-label detector find the real one and leave the rest alone?
 *
 *     node tools/test_award_labels.mjs
 *
 * The fixture is the real shape of awardVotes.json: seven awards, two of them
 * only a few seasons old because the league added them recently, and "Sixth"
 * sitting in 2026 with twelve rows. Calling a genuinely new award truncated
 * would be worse than missing the bug, so most of these check what it does NOT
 * report.
 */

import { auditAwardLabels, awardLabelReport } from "./lib/award_labels.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* n rows of one award across the given seasons. */
const rows = (award, years, per = 10) => {
  const out = [];
  for (const y of years) for (let i = 0; i < per; i++) out.push({ AWARD: award, YEAR: String(y) });
  return out;
};
const span = (a, b) => { const y = []; for (let i = a; i <= b; i++) y.push(i); return y; };

const REAL = [
  ...rows("MVP", span(1956, 2026)),
  ...rows("ROY", span(1964, 2026)),
  ...rows("DPOY", span(1983, 2026)),
  ...rows("Sixth Man", span(1984, 2025)),
  ...rows("MIP", span(1986, 2026)),
  ...rows("Clutch", span(2023, 2026)),      // a real award, four seasons old
  ...rows("Hustle", span(2017, 2026)),
  ...rows("Sixth", [2026], 12)              // the bug
];

console.log("\nthe real one");

{
  const a = auditAwardLabels(REAL);
  ck("every label is counted", a.labels.length === 8, String(a.labels.length));
  ck("exactly one suspect", a.suspects.length === 1,
     a.suspects.map(s => s.label).join(", "));
  const s = a.suspects[0];
  ck("and it is Sixth", s && s.label === "Sixth");
  ck("with its row count", s && s.rows === 12, s && String(s.rows));
  ck("its season", s && s.from === 2026 && s.seasons === 1);
  ck("and what it should have been", s && s.likely.join(",") === "Sixth Man", s && s.likely.join(","));
  ck("the report says so in one line",
     awardLabelReport(a)[0] === '"Sixth": 12 rows, 1 season (2026) - looks like "Sixth Man" with a word lost',
     awardLabelReport(a)[0]);
}

console.log("\nwhat it must not report");

{
  const a = auditAwardLabels(REAL);
  const names = a.suspects.map(s => s.label);
  /* Clutch is four seasons old and Hustle has a short history too. Neither is
   * the opening words of another award, so neither is a candidate however new
   * it is - which is the whole reason the test is a word-prefix and not a
   * threshold on seasons. */
  ck("a genuinely new award is not truncated", !names.includes("Clutch"));
  ck("nor is a short-history one", !names.includes("Hustle"));
  ck("nor is any established award", !names.includes("MVP") && !names.includes("Sixth Man"));
}

{
  /* Two awards that merely start with the same letter, and one that CONTAINS
   * another's words without starting with them. */
  const a = auditAwardLabels([
    ...rows("Defensive", span(2000, 2026)),
    ...rows("Defense", [2026], 9),
    ...rows("Man of the Year", [2026], 9),
    ...rows("Sixth Man of the Year", span(1984, 2026))
  ]);
  const names = a.suspects.map(s => s.label);
  ck("a similar spelling is not a word prefix", !names.includes("Defense"));
  ck("words in the middle do not count as a prefix", !names.includes("Man of the Year"),
     names.join(","));
}

console.log("\nthe awkward cases");

{
  /* A prefix of two longer labels is reported with both rather than resolved. */
  const a = auditAwardLabels([
    ...rows("Most", [2026], 5),
    ...rows("Most Improved Player", span(1986, 2026)),
    ...rows("Most Valuable Player", span(1956, 2026))
  ]);
  ck("an ambiguous prefix names both candidates",
     a.suspects.length === 1 && a.suspects[0].likely.length === 2,
     a.suspects[0] && a.suspects[0].likely.join(" / "));
  /* Candidates come out in the order the labels themselves do, which is most
   * rows first - so the award with the longer history is offered first. MVP
   * has seventy seasons to Most Improved's forty, so it leads. */
  ck("and the line reads as a choice, likeliest first",
     /looks like "Most Valuable Player" or "Most Improved Player" with a word lost$/
       .test(awardLabelReport(a)[0]),
     awardLabelReport(a)[0]);
}

{
  /* The longer label must have MORE seasons, or there is nothing to say which
   * of the two is the mistake. */
  const a = auditAwardLabels([
    ...rows("Sixth", [2026], 12),
    ...rows("Sixth Man", [2026], 12)
  ]);
  ck("two one-season labels are not a diagnosis", a.suspects.length === 0,
     a.suspects.map(s => s.label).join(","));
}

console.log("\nrubbish in");

ck("no rows, no report", auditAwardLabels([]).suspects.length === 0);
ck("undefined does not throw", auditAwardLabels(undefined).labels.length === 0);
ck("a row with no award is ignored",
   auditAwardLabels([{ YEAR: "2026" }, { AWARD: "", YEAR: "2026" }]).labels.length === 0);
ck("a row with no year still counts as a row",
   auditAwardLabels([{ AWARD: "MVP" }]).labels[0].rows === 1);
ck("a label with no seasons reports no span",
   auditAwardLabels([{ AWARD: "MVP" }]).labels[0].from === null);
ck("nothing to report means no lines", awardLabelReport({ suspects: [] }).length === 0);
ck("no audit at all means no lines", awardLabelReport(null).length === 0);

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "it would report the wrong award" : "it finds the lost word and nothing else");
process.exit(fail ? 1 : 0);
