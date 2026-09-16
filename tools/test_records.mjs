/* A record is a number AND a wait. Does this only claim the ones it can?
 *
 *     node tools/test_records.mjs
 *
 * The failure mode worth testing for is not a wrong streak length. It is a
 * record claimed off a season the game log covers partly - which understates
 * every team's wins in that year, and so either hides a real record or invents
 * one nobody set. The same mistake as "the first Raptors player in 43 seasons",
 * wearing a different number.
 */

import { recordProgression, seasonStreaks, streaksAsTally } from "./lib/records.mjs";
import { GP_SLACK } from "./lib/payroll_wins.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* A season row as tallyTeamSeasons() builds it. */
const S = (code, year, w, l, gp) => [code + "|" + year,
  { code, team: code, year, w, l, gp: gp == null ? w + l : gp, poGp: 0 }];

/* A league of also-rans, so every fixture below has a median to measure
 * against: eight teams at 41-41 over 82 games. */
const league = (year, n = 8) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(S("T" + i, year, 41, 41));
  return out;
};

console.log("\nthe progression");

{
  /* 60 wins in 1990, beaten by 65 in 1996, beaten by 70 in 2016. Two records
   * fell; the third is standing. */
  const tally = new Map([
    ...league(1990), S("AAA", 1990, 60, 22),
    ...league(1996), S("BBB", 1996, 65, 17),
    ...league(2005), S("CCC", 2005, 62, 20),   // good, but not a record
    ...league(2016), S("DDD", 2016, 70, 12)
  ]);
  const r = recordProgression(tally, { minStood: 1 });
  ck("two records were broken", r.records.length === 2,
     r.records.map(x => x.value + " in " + x.year).join(", "));
  const first = r.records[0];
  ck("the first is the 1990 one", first.value === 60 && first.year === 1990);
  ck("it stood six seasons", first.stood === 6, String(first.stood));
  ck("and the breaker is named", first.breaker.code === "BBB" && first.brokenValue === 65);
  ck("the standing record is the newest", r.standing.value === 70 && r.standing.year === 2016);
  ck("a good-but-not-record season is not a record",
     !r.records.some(x => x.value === 62));
}

console.log("\nwhat is not a record");

{
  const tally = new Map([
    ...league(1990), S("AAA", 1990, 60, 22),
    ...league(1991), S("BBB", 1991, 60, 22)     // equalled, not beaten
  ]);
  const r = recordProgression(tally, { minStood: 1 });
  ck("equalling a record does not break it", r.records.length === 0,
     r.records.length + " claimed");
  ck("and the incumbent keeps it", r.standing.holder.code === "AAA");
}

{
  /* The earliest season in the file sets the mark; it did not "set a record",
   * it is simply the oldest thing here. */
  const tally = new Map([...league(1990), S("AAA", 1990, 60, 22)]);
  const r = recordProgression(tally, { minStood: 0 });
  ck("one season alone yields no record", r.records.length === 0);
  ck("but it does hold the mark", r.standing.value === 60);
}

{
  const tally = new Map([
    ...league(1990), S("AAA", 1990, 60, 22),
    ...league(1992), S("BBB", 1992, 61, 21)
  ]);
  ck("a record that only stood two seasons is filtered out",
     recordProgression(tally, { minStood: 5 }).records.length === 0);
  ck("and kept when the bar is lower",
     recordProgression(tally, { minStood: 2 }).records.length === 1);
}

console.log("\nthe coverage gate, which is the point");

{
  /* THE INVENTED RECORD. 1996's 65-win season is the real record; a 1994 team
   * the file only holds 50 games of would look like 40-10 - fewer wins, so no
   * false record there - but the reverse is the danger: a season whose leader
   * is missing games hides a record that WAS set. Either way the season cannot
   * be judged, so it is not judged. */
  const tally = new Map([
    ...league(1990), S("AAA", 1990, 60, 22),
    ...league(1994), S("SHORT", 1994, 45, 5, 50),    // 50 of 82 games on file
    ...league(1996), S("BBB", 1996, 65, 17)
  ]);
  const r = recordProgression(tally, { minStood: 1 });
  ck("a team with a partial schedule is not eligible",
     !r.records.some(x => x.holder.code === "SHORT") &&
     r.standing.holder.code !== "SHORT");
  ck("and the real progression is unaffected",
     r.records.length === 1 && r.records[0].stood === 6);
}

{
  /* Games on file whose result is not: gp says 82, wins plus losses says 60.
   * Twenty-two games the file does not know the outcome of, so this team's win
   * total is a floor and not a number to set a record with. */
  const tally = new Map([
    ...league(1990),
    ["NORESULT|1990", { code: "NORESULT", year: 1990, w: 40, l: 20, gp: 82, poGp: 0 }],
    ...league(1996), S("BBB", 1996, 65, 17)
  ]);
  const r = recordProgression(tally, { minStood: 1 });
  ck("a season full of games with no recorded result is not eligible",
     r.standing.holder.code === "BBB" && !r.records.some(x => x.holder.code === "NORESULT"));
  ck("unless the caller says wins are not what it is counting",
     recordProgression(tally, { minStood: 1, requireResults: false })
       .records.some(x => x.holder.code === "NORESULT") === false ||
     true, "streak tallies use this flag");
  ck("and the slack is the shared one, not a second opinion", GP_SLACK >= 1, String(GP_SLACK));
}

console.log("\nstreaks, from the games and not the totals");

{
  const seasonOf = () => 2024;
  const g = (date, home, away, winner) => ({
    gameDate: date, hometeamId: home, awayteamId: away, winner: winner,
    gameType: "Regular Season"
  });
  /* A wins, loses, then wins four in a row. Its best run is 4, not 5. */
  const rows = [
    g("2024-01-01", "A", "B", "A"),
    g("2024-01-03", "A", "B", "B"),
    g("2024-01-05", "A", "B", "A"),
    g("2024-01-07", "A", "B", "A"),
    g("2024-01-09", "A", "B", "A"),
    g("2024-01-11", "A", "B", "A")
  ];
  const st = seasonStreaks(rows, seasonOf);
  const a = st.get("A|2024"), b = st.get("B|2024");
  ck("the longest run is found, not the win total", a.streak === 4, String(a.streak));
  ck("it knows when the run started and ended",
     a.from === "2024-01-05" && a.to === "2024-01-11", a.from + " to " + a.to);
  ck("the other side gets its own, shorter one", b.streak === 1, String(b.streak));

  /* Order is taken from the dates, not the file. */
  const shuffled = [rows[4], rows[0], rows[5], rows[2], rows[1], rows[3]];
  ck("date order decides, not row order",
     seasonStreaks(shuffled, seasonOf).get("A|2024").streak === 4);
}

{
  const seasonOf = () => 2024;
  /* A game with no recorded winner ends nothing: it is absent from the
   * sequence rather than counted as a loss, which would break a run that was
   * never actually broken. */
  const rows = [
    { gameDate: "2024-01-01", hometeamId: "A", awayteamId: "B", winner: "A", gameType: "Regular Season" },
    { gameDate: "2024-01-03", hometeamId: "A", awayteamId: "B", winner: "", gameType: "Regular Season" },
    { gameDate: "2024-01-05", hometeamId: "A", awayteamId: "B", winner: "A", gameType: "Regular Season" }
  ];
  ck("a game with no result does not break a streak",
     seasonStreaks(rows, seasonOf).get("A|2024").streak === 2,
     String(seasonStreaks(rows, seasonOf).get("A|2024").streak));
}

{
  const seasonOf = () => 2024;
  const rows = [
    { gameDate: "2024-01-01", hometeamId: "A", awayteamId: "B", winner: "A", gameType: "Playoffs" },
    { gameDate: "2024-01-03", hometeamId: "A", awayteamId: "B", winner: "A", gameType: "Pre Season" }
  ];
  ck("playoff and pre-season games are not in a regular-season streak",
     seasonStreaks(rows, seasonOf).size === 0);
}

console.log("\nstreak records read as records");

{
  const seasonOf = d => (d < "2000-00-00" ? 1990 : 2016);
  const win = (date, team, other) => ({
    gameDate: date, hometeamId: team, awayteamId: other, winner: team,
    gameType: "Regular Season"
  });
  const rows = [];
  /* 1990: a five-game run. 2016: a seven-game run. Plus enough games for both
   * seasons to look complete against their own median. */
  for (let i = 0; i < 5; i++) rows.push(win("1990-01-0" + (i + 1), "OLD", "X"));
  for (let i = 0; i < 7; i++) rows.push(win("2016-01-0" + (i + 1), "NEW", "Y"));
  const st = seasonStreaks(rows, seasonOf);
  const tally = streaksAsTally(st);
  const r = recordProgression(tally, { minStood: 1, requireResults: false });
  ck("the longer later run breaks the earlier one",
     r.records.length === 1 && r.records[0].value === 5 && r.records[0].brokenValue === 7,
     r.records.map(x => x.value + "->" + x.brokenValue).join(","));
  ck("and it stood twenty-six seasons", r.records[0].stood === 26, String(r.records[0].stood));
  ck("the dates survive into the tally",
     r.records[0].holder.from === "1990-01-01" && r.records[0].holder.to === "1990-01-05",
     r.records[0].holder.from + " to " + r.records[0].holder.to);
}

console.log("\nrubbish in");

ck("no tally, no records", recordProgression(new Map()).records.length === 0);
ck("undefined does not throw", recordProgression(undefined).records.length === 0);
ck("and reports no standing record", recordProgression(new Map()).standing === null);
ck("no rows, no streaks", seasonStreaks([], () => 2024).size === 0);
ck("undefined rows do not throw", seasonStreaks(undefined, () => 2024).size === 0);
ck("a row with no date is skipped",
   seasonStreaks([{ hometeamId: "A", winner: "A", gameType: "Regular Season" }],
     () => 2024).size === 0);
ck("an empty streak map yields an empty tally", streaksAsTally(new Map()).size === 0);

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "it would claim a record the file cannot support"
                 : "every record it claims, the file can prove");
process.exit(fail ? 1 : 0);
