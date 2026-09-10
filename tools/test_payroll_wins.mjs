/* What the payroll-to-wins join does with data nobody has checked yet.
 *
 *     node tools/test_payroll_wins.mjs
 *
 * The builder that uses this cannot run here - salaries.json, the cap table
 * and the games CSV are all on Jorge's machine - so the arithmetic is checked
 * against fixtures instead. Every case below is one that would put a wrong
 * number on a card: a half-covered season, a season the file has no playoffs
 * for, a lockout year measured against 82 games, a zero denominator.
 */

import {
  seasonEndYear, tallyTeamSeasons, medianGpByYear, joinPayrollWins,
  playoffYears, capCostPerWin, GP_SLACK
} from "./lib/payroll_wins.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* Rows shaped as normalizeGames leaves them. */
const game = (date, homeId, awayId, winnerId, type) => ({
  gameDate: date, hometeamId: homeId, awayteamId: awayId,
  hometeamCity: homeId === "A" ? "Boston" : "Seattle", hometeamName: "x",
  awayteamCity: "", awayteamName: "x",
  winner: winnerId, gameType: type || "Regular Season"
});
/* The caller's normaliser. Deliberately id-based in the fixtures so the test
 * is about the tally, not about city spelling. */
const codeOf = (g, side) => g[side + "teamId"] || null;

console.log("\nwhich season a date belongs to");

ck("October starts the next season", seasonEndYear("2023-10-25") === 2024);
ck("April ends the season it is in", seasonEndYear("2024-04-14") === 2024);
ck("June Finals belong to that year", seasonEndYear("2024-06-17") === 2024);
ck("the 2020 bubble stays in 2020", seasonEndYear("2020-10-11") === 2020,
   String(seasonEndYear("2020-10-11")));
ck("but October 2021 is season 2022", seasonEndYear("2021-10-19") === 2022);
ck("a July 2020 restart game is 2020", seasonEndYear("2020-07-30") === 2020);
ck("an empty date is null, not 1970", seasonEndYear("") === null);
ck("undefined does not throw", seasonEndYear() === null);

console.log("\ntallying wins");

{
  const rows = [
    game("2023-10-25", "A", "B", "A"),
    game("2023-11-01", "B", "A", "B"),
    game("2023-12-01", "A", "B", "A")
  ];
  const t = tallyTeamSeasons(rows, codeOf);
  ck("both sides of a game are counted", t.size === 2);
  ck("the home winner gets the win", t.get("A|2024").w === 2, JSON.stringify(t.get("A|2024")));
  ck("and the loser gets the loss", t.get("A|2024").l === 1);
  ck("games played counts every row", t.get("A|2024").gp === 3);
  ck("the other side mirrors it", t.get("B|2024").w === 1 && t.get("B|2024").l === 2);
}

{
  /* A postponed game has no winner. Handing it to either side invents a
   * result; counting it as a game played but neither a win nor a loss is what
   * the file actually says. */
  const t = tallyTeamSeasons([game("2023-10-25", "A", "B", "")], codeOf);
  ck("a game with no winner is neither a win nor a loss",
     t.get("A|2024").w === 0 && t.get("A|2024").l === 0);
  ck("but it still counts as played", t.get("A|2024").gp === 1);
}

{
  const rows = [
    game("2024-01-01", "A", "B", "A", "Regular Season"),
    game("2024-05-01", "A", "B", "A", "Playoffs"),
    game("2023-10-05", "A", "B", "A", "Pre Season"),
    game("2024-02-18", "A", "B", "A", "All-Star"),
    game("2024-04-16", "A", "B", "A", "Play-In")
  ];
  const t = tallyTeamSeasons(rows, codeOf).get("A|2024");
  ck("regular season only in the win column", t.w === 1 && t.gp === 1, JSON.stringify(t));
  ck("playoff games counted separately", t.poGp === 1);
  ck("pre-season, All-Star and Play-In are in neither", t.gp === 1 && t.poGp === 1);
}

ck("no games does not throw", tallyTeamSeasons([], codeOf).size === 0);
ck("undefined games does not throw", tallyTeamSeasons(undefined, codeOf).size === 0);

console.log("\nthe expected schedule, measured rather than remembered");

{
  /* A 50-game lockout season. A hand-written 82 would call every team here
   * half-covered and ship nothing; the median calls them all complete. */
  const t = new Map([
    ["A|1999", { code: "A", year: 1999, w: 30, l: 20, gp: 50, poGp: 4 }],
    ["B|1999", { code: "B", year: 1999, w: 25, l: 25, gp: 50, poGp: 0 }],
    ["C|1999", { code: "C", year: 1999, w: 20, l: 30, gp: 50, poGp: 0 }]
  ]);
  ck("the median is the season's own length", medianGpByYear(t).get(1999) === 50,
     String(medianGpByYear(t).get(1999)));
}

{
  const t = new Map([
    ["A|2024", { code: "A", year: 2024, w: 50, l: 32, gp: 82, poGp: 0 }],
    ["B|2024", { code: "B", year: 2024, w: 41, l: 41, gp: 82, poGp: 0 }],
    ["C|2024", { code: "C", year: 2024, w: 20, l: 20, gp: 40, poGp: 0 }],
    ["D|2024", { code: "D", year: 2024, w: 30, l: 52, gp: 82, poGp: 0 }]
  ]);
  ck("an even count averages the middle two", medianGpByYear(t).get(2024) === 82,
     String(medianGpByYear(t).get(2024)));

  const pay = y => [
    { team: "A", year: y, total: 100e6, cap: 136e6, ofCap: 0.74, men: [] },
    { team: "C", year: y, total: 90e6, cap: 136e6, ofCap: 0.66, men: [] }
  ];
  const { joined, shortSchedule } = joinPayrollWins(pay(2024), t);
  ck("a full-schedule team joins", joined.length === 1 && joined[0].team === "A");
  ck("a half-covered team is held back, not divided",
     shortSchedule.length === 1 && shortSchedule[0].team === "C");
  ck("and it says what it expected", shortSchedule[0].expected === 82 && shortSchedule[0].gp === 40);
}

{
  /* Exactly at the edge of the slack: still usable. One game further out: not. */
  const mk = gp => new Map([
    ["A|2024", { code: "A", year: 2024, w: 40, l: 40, gp: gp, poGp: 0 }],
    ["B|2024", { code: "B", year: 2024, w: 41, l: 41, gp: 82, poGp: 0 }],
    ["C|2024", { code: "C", year: 2024, w: 41, l: 41, gp: 82, poGp: 0 }]
  ]);
  const pay = [{ team: "A", year: 2024, total: 100e6, cap: 136e6, ofCap: 0.74, men: [] }];
  ck(`${GP_SLACK} games short is kept`, joinPayrollWins(pay, mk(82 - GP_SLACK)).joined.length === 1);
  ck(`${GP_SLACK + 1} short is not`, joinPayrollWins(pay, mk(82 - GP_SLACK - 1)).joined.length === 0);
}

console.log("\ncost per win");

{
  const t = new Map([
    ["A|2024", { code: "A", year: 2024, w: 50, l: 32, gp: 82, poGp: 16 }],
    ["B|2024", { code: "B", year: 2024, w: 25, l: 57, gp: 82, poGp: 0 }]
  ]);
  const pay = [
    { team: "A", year: 2024, total: 100e6, cap: 136e6, ofCap: 0.735, men: [] },
    { team: "B", year: 2024, total: 150e6, cap: 136e6, ofCap: 1.103, men: [] }
  ];
  const { joined } = joinPayrollWins(pay, t);
  const a = joined.find(j => j.team === "A"), b = joined.find(j => j.team === "B");
  ck("cost per win is payroll over wins", a.costPerWin === 100e6 / 50, String(a.costPerWin));
  ck("the expensive loser costs more per win", b.costPerWin > a.costPerWin);
  ck("playoff games mean a berth", a.madePlayoffs === true);
  ck("none means a miss", b.madePlayoffs === false);
  ck("cap cost per win is a fraction, not dollars",
     Math.abs(capCostPerWin(a) - (100 / 136) / 50) < 1e-9, String(capCostPerWin(a)));
  /* The whole point of the cap version: B spends more per win in dollars AND
   * in cap terms, and the two rankings only agree because it is one season. */
  ck("cap cost per win ranks the same within one season", capCostPerWin(b) > capCostPerWin(a));
}

{
  /* $3m per win in 1993 and $3m per win in 2024 are not the same fact, and a
   * table that ranked them together would be a table about the cap rising.
   *
   * So the two fixtures are given the SAME cap share and the SAME wins - the
   * modern total is derived from the old one rather than typed, which is what
   * makes this a test of the invariant instead of a test of two numbers I
   * chose. Equal share and equal wins must give equal cap cost per win, in a
   * cap nearly nine times larger. */
  const old = { total: 15e6, cap: 15.964e6, w: 50 };
  const now = { total: (15e6 / 15.964e6) * 140.588e6, cap: 140.588e6, w: 50 };
  ck("dollars per win puts the modern team far higher",
     now.total / now.w > (old.total / old.w) * 5,
     Math.round(now.total / now.w / 1e5) / 10 + "m vs " + Math.round(old.total / old.w / 1e5) / 10 + "m");
  ck("cap per win is the same fact in both eras",
     Math.abs(capCostPerWin(old) - capCostPerWin(now)) < 1e-9,
     capCostPerWin(old).toFixed(6) + " vs " + capCostPerWin(now).toFixed(6));
}

{
  const t = new Map([["A|2024", { code: "A", year: 2024, w: 0, l: 82, gp: 82, poGp: 0 }]]);
  const pay = [{ team: "A", year: 2024, total: 100e6, cap: 136e6, ofCap: 0.74, men: [] }];
  const r = joinPayrollWins(pay, t);
  ck("a winless team is not divided by zero",
     r.joined.length === 0 && r.winless.length === 1);
  /* Reported as winless, NOT as absent. One bucket for both made the build log
   * claim five team-seasons were missing from a game log that had them. */
  ck("and it is not reported as missing from the file", r.missing.length === 0);
  ck("its record is carried so the log can say 0-82", r.winless[0].l === 82);
}

{
  const pay = [{ team: "Z", year: 2024, total: 100e6, cap: 136e6, ofCap: 0.74, men: [] }];
  const r = joinPayrollWins(pay, new Map());
  ck("a payroll with no season in the file is reported, not guessed",
     r.joined.length === 0 && r.missing.length === 1);
  ck("and not confused with a winless one", r.winless.length === 0);
  ck("empty input does not throw", joinPayrollWins([], new Map()).joined.length === 0);
  ck("undefined input does not throw", joinPayrollWins(undefined, new Map()).joined.length === 0);
}

{
  const noCap = [{ team: "A", year: 2024, total: 100e6, cap: null, ofCap: null, men: [] }];
  const t = new Map([["A|2024", { code: "A", year: 2024, w: 50, l: 32, gp: 82, poGp: 0 }]]);
  const j = joinPayrollWins(noCap, t).joined[0];
  ck("no cap on file gives null, not a number", j.capPerWin === null);
  ck("and capCostPerWin agrees", capCostPerWin(j) === null);
}

console.log("\nwhether the file even has playoffs for a season");

{
  /* The trap this exists for: a regular-season-only file would otherwise
   * report all thirty teams as having missed the playoffs. */
  const regOnly = new Map([
    ["A|2024", { code: "A", year: 2024, w: 60, l: 22, gp: 82, poGp: 0 }],
    ["B|2024", { code: "B", year: 2024, w: 20, l: 62, gp: 82, poGp: 0 }]
  ]);
  ck("no playoff games anywhere means the year is not usable for a miss card",
     !playoffYears(regOnly).has(2024));

  const withPo = new Map(regOnly);
  withPo.set("A|2024", { code: "A", year: 2024, w: 60, l: 22, gp: 82, poGp: 20 });
  ck("one playoff game makes the year usable", playoffYears(withPo).has(2024));
  ck("a 60-win team with playoff games did not miss",
     joinPayrollWins([{ team: "A", year: 2024, total: 1, cap: 1, ofCap: 1, men: [] }], withPo)
       .joined[0].madePlayoffs === true);
  ck("empty tally has no playoff years", playoffYears(new Map()).size === 0);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the join is not safe to ship" : "payroll and wins join without inventing a number");
process.exit(fail ? 1 : 0);
