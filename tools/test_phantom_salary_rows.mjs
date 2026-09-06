/* Next season's team, this season's money.
 *
 *     node tools/test_phantom_salary_rows.mjs
 *
 * salaries.json ends at 2026 and has no 2027 season. For 145 players who have
 * signed or moved for 2026-27 it carries a SECOND 2026 row naming the new team
 * with the current salary copied into it:
 *
 *     2026   LA Lakers      $52,627,153
 *     2026   Philadelphia   $52,627,153
 *
 * LeBron is a 76er next season and is paid $3,876,529 there. Right team, wrong
 * year, wrong money.
 *
 * The builder read that as one salary written twice, decided nobody could say
 * whose book he was on, and discarded the season. Fifteen of twenty-eight
 * Lakers went out that way, and "Luka Doncic was 47% of the LAL payroll" was
 * computed on the $96.8M that survived.
 *
 * WHAT THESE CASES ARE FOR
 *
 * The first fix I wrote for this passed a test very like the top half of this
 * file and was still wrong: it handled two rows and quietly mangled three,
 * because a man who was ALSO traded mid-season has two real amounts plus a
 * copy, which no duplicate check flags. The bottom half is the half that
 * matters - what the rule refuses, and what it leaves alone.
 */

import { stripPhantomTeamRows, summariseSeason, MIN_PAYROLL_OF_CAP, IMPORTER_YEARS }
  from "./lib/salary.mjs";

/* Every existing case is about the season the importer writes. */
const Y = 2026;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   " + detail : ""));
  if (!ok) failures++;
}
const row = (team, amount) => ({ team, amount });
const teams = rs => rs.map(r => r.team).join(",");

console.log("\nstripping the phantom row");

{
  // The real case, to the dollar.
  const rows = [row("LAL", 52627153), row("PHI", 52627153)];
  const out = stripPhantomTeamRows(rows, new Set(["LAL"]), Y);
  check("LeBron: the team he did not play for goes",
    out.length === 1 && out[0].team === "LAL", teams(out));

  const s = summariseSeason(out, Y);
  check("and what is left is one clean, unambiguous season",
    s.total === 52627153 && !s.teamAmbiguous && !s.traded,
    JSON.stringify([s.total, s.teamAmbiguous, s.traded]));
}

{
  // The case the first version of this fix got wrong: traded AND moving.
  const rows = [row("BOS", 20000000), row("MIA", 15000000), row("PHX", 20000000)];
  const out = stripPhantomTeamRows(rows, new Set(["BOS", "MIA"]), Y);
  check("traded mid-season AND signed elsewhere: only the copy goes",
    out.length === 2 && teams(out) === "BOS,MIA", teams(out));

  const s = summariseSeason(out, Y);
  check("and the two real halves still sum to the season",
    s.total === 35000000 && s.traded, JSON.stringify([s.total, s.traded]));

  const naive = summariseSeason(rows, Y);
  check("without the strip it would have summed all three",
    naive.total === 55000000, String(naive.total));
}

{
  const rows = [row("ATL", 5000000), row("", 5000000)];
  const out = stripPhantomTeamRows(rows, new Set(["ATL"]), Y);
  check("the blank-team row in the data is stripped like any other",
    out.length === 1 && out[0].team === "ATL", teams(out));
}

console.log("\nleaving alone what it should");

{
  const rows = [row("BOS", 20000000), row("MIA", 15000000)];
  const out = stripPhantomTeamRows(rows, new Set(["BOS", "MIA"]), Y);
  check("a plain mid-season trade is untouched", out.length === 2, teams(out));
}

{
  // The protection that matters: a real second contract pays a different
  // number. Only an exact match is treated as a copy.
  const rows = [row("LAL", 52627153), row("PHI", 3876529)];
  const out = stripPhantomTeamRows(rows, new Set(["LAL"]), Y);
  check("a DIFFERENT amount is never stripped, even for a team he never played for",
    out.length === 2, teams(out) + "  (this is the real LeBron pair, correctly stamped)");
}

{
  const rows = [row("LAL", 52627153), row("PHI", 52627153)];
  check("no stats on file: nothing is known, nothing is stripped",
    stripPhantomTeamRows(rows, null, Y).length === 2);
  check("an empty stats set is the same as none",
    stripPhantomTeamRows(rows, new Set(), Y).length === 2);
}

{
  // Both teams unplayed and equal would strip everything. Refuse instead.
  const rows = [row("PHI", 5000000), row("BKN", 5000000)];
  const out = stripPhantomTeamRows(rows, new Set(["MIA"]), Y);
  check("it never strips a season down to nothing", out.length === 2, teams(out));
}

{
  check("a single row is returned as-is whatever the stats say",
    stripPhantomTeamRows([row("MEM", 5000000)], new Set(["LAL"])).length === 1);
  check("an empty list does not throw",
    stripPhantomTeamRows([], new Set(["LAL"])).length === 0);
  check("undefined rows do not throw",
    stripPhantomTeamRows(undefined, undefined, Y).length === 0);
}

{
  // History has no phantom rows, and must not acquire any.
  const rows = [row("CHI", 33140000)];
  check("a 1997-98 single-team season is unchanged",
    stripPhantomTeamRows(rows, new Set(["CHI"]), 1998).length === 1);
  const split = [row("ORL", 10000000), row("PHX", 6000000)];
  check("a 1990s mid-season trade is unchanged",
    stripPhantomTeamRows(split, new Set(["ORL", "PHX"]), 1998).length === 2);
}

console.log("\nseasons the importer never wrote");

{
  /* THE CASE THAT WAS SHIPPED WRONG. Matching on "same salary, different
   * teams" across all of history removed these, and each one is real money.
   * The 10-day minimum is a fixed formula, so two clubs pay the same figure to
   * the dollar - the exact signature this rule used to read as a copy. */
  const camby = [row("TOR", 4177208), row("HOU", 4177208)];
  check("Marcus Camby 2015: two 10-days at one figure, both kept",
    stripPhantomTeamRows(camby, new Set(["TOR"]), 2015).length === 2,
    teams(stripPhantomTeamRows(camby, new Set(["TOR"]), 2015)));

  const cheatham = [row("UTA", 85578), row("MIA", 85578), row("NOP", 85578)];
  check("Zylan Cheatham 2022: three clubs at one figure, all kept",
    stripPhantomTeamRows(cheatham, new Set(["UTA"]), 2022).length === 3,
    teams(stripPhantomTeamRows(cheatham, new Set(["UTA"]), 2022)));

  check("the identical shape IS stripped inside the importer's season",
    stripPhantomTeamRows([row("LAL", 52627153), row("PHI", 52627153)],
      new Set(["LAL"]), 2026).length === 1,
    "which is the whole point: the year is what distinguishes them");

  check("a missing year strips nothing",
    stripPhantomTeamRows([row("LAL", 5), row("PHI", 5)], new Set(["LAL"])).length === 2);
  check("a non-numeric year strips nothing",
    stripPhantomTeamRows([row("LAL", 5), row("PHI", 5)], new Set(["LAL"]), "soon").length === 2);
  check("IMPORTER_YEARS is what update-salaries.py writes",
    IMPORTER_YEARS.has(2026) && !IMPORTER_YEARS.has(2025), [...IMPORTER_YEARS].join(","));
}

console.log("\nthe season summary");

{
  /* Same team, same amount: one salary written twice, whatever the year. */
  for (const y of [Y, 2015]) {
    const s = summariseSeason([row("LAL", 5000000), row("LAL", 5000000)], y);
    check("the same salary twice under ONE team counts once (" + y + ")",
      s.total === 5000000 && !s.teamAmbiguous, String(s.total));
  }

  /* THE TWENTY JOURNEYMEN. Two clubs at one formula wage, outside the
   * importer's seasons: two real payments, and he was paid both. */
  const camby = summariseSeason([row("TOR", 4177208), row("HOU", 4177208)], 2015);
  check("two 10-days at one figure are SUMMED, not counted once",
    camby.total === 8354416 && !camby.teamAmbiguous && camby.traded,
    String(camby.total));

  /* Inside the importer's seasons the same shape may be an unresolved
   * phantom, and summing it would double a man's pay. Counted once. */
  const unresolved = summariseSeason([row("LAL", 52627153), row("PHI", 52627153)], Y);
  check("but inside 2026 that shape is still counted once",
    unresolved.total === 52627153 && unresolved.teamAmbiguous,
    String(unresolved.total));

  const e = summariseSeason([], Y);
  check("an empty season totals zero rather than throwing", e.total === 0);
  check("a missing year behaves like a non-importer season",
    summariseSeason([row("TOR", 100), row("HOU", 100)]).total === 200);
}

console.log("\nthe floor it shares with the guard");

check("MIN_PAYROLL_OF_CAP sits under the 90% salary floor",
  MIN_PAYROLL_OF_CAP > 0 && MIN_PAYROLL_OF_CAP < 0.9, String(MIN_PAYROLL_OF_CAP));
check("and above the 73% of the worse card it had to catch",
  MIN_PAYROLL_OF_CAP > 0.73, String(MIN_PAYROLL_OF_CAP));

console.log(failures
  ? "\n" + failures + " failure(s)"
  : "\na row is phantom only when the stats deny it and the money is a copy");
process.exit(failures ? 1 : 0);
