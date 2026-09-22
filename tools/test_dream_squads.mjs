/* The squad library, against rows whose right answer is written beside them.
 *
 *     node tools/test_dream_squads.mjs
 *
 * The one that matters is the TOT row. rsStats gives a traded player a TOT row
 * AND a row per team, so a naive sum counts his season twice and hands the card
 * a scoring average he never had. Every squad total in this feed rests on
 * seasonTotals getting that right, and nothing about a wrong answer would look
 * wrong: 62 points a game is absurd, 31 doubled to 62 is not obviously doubled.
 */

import {
  seasonTotals, ppg, seasonLabel, decadeOf, eligibleSeasons, teamScoringByYear,
  environmentOf, squadFrom, squadPairs, squadTotal,
  MIN_GP, MIN_PPG, SQUAD, MIN_GAP, MAX_GAP, MIN_YEAR, MIN_DECADE_SEASONS,
  MAX_CARDS_PER_PLAYER
} from "./lib/dream_squads.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 0.05 : eps);

const row = (p, t, y, gp, pts) => ({ PLAYER: p, TEAM: t, YEAR: String(y), GP: String(gp), PTS: String(pts) });

console.log("\nthe TOT trap");

{
  /* A traded man, in the shape the file actually uses: one TOT row plus one
   * row per team. 70 games, 1400 points, 20.0 a game. Summing all three rows
   * would say 140 games and 2800 points - still 20.0 a game, which is why a
   * naive sum survives a PPG check and fails a games check. Both are asserted. */
  const rows = [
    row("Traded Man", "TOT", 2015, 70, 1400),
    row("Traded Man", "BOS", 2015, 30, 600),
    row("Traded Man", "LAL", 2015, 40, 800)
  ];
  const t = seasonTotals(rows);
  const s = t.get("Traded Man|2015");
  ck("a split season is counted once", !!s && s.gp === 70, s && s.gp + " games");
  ck("and its points are not doubled", !!s && near(s.pts, 1400, 0.01), s && s.pts + " points");
  ck("and it knows it was a split", !!s && s.teams === 2, s && s.teams + " teams");
  ck("so the average is right", !!s && near(ppg(s), 20.0), s && ppg(s) + " ppg");
}

{
  /* The TOT row before its parts, because a single pass in file order would
   * get one of these two orders wrong and the file is not sorted. */
  const a = seasonTotals([
    row("Order A", "TOT", 2015, 70, 1400),
    row("Order A", "BOS", 2015, 30, 600), row("Order A", "LAL", 2015, 40, 800)]);
  const b = seasonTotals([
    row("Order B", "BOS", 2015, 30, 600), row("Order B", "LAL", 2015, 40, 800),
    row("Order B", "TOT", 2015, 70, 1400)]);
  ck("row order does not change the answer",
     a.get("Order A|2015").gp === b.get("Order B|2015").gp &&
     near(a.get("Order A|2015").pts, b.get("Order B|2015").pts, 0.01),
     a.get("Order A|2015").gp + " vs " + b.get("Order B|2015").gp);
}

{
  /* No TOT row at all, which is every player who stayed put. The parts ARE the
   * season and must be summed, not discarded for want of a TOT. */
  const t = seasonTotals([row("Stayed Put", "BOS", 2015, 80, 1600)]);
  const s = t.get("Stayed Put|2015");
  ck("an unsplit season still works", !!s && s.gp === 80 && near(ppg(s), 20.0),
     s && s.gp + " games, " + ppg(s) + " ppg");
  ck("and is not marked as a split", !!s && s.fromTot === false);
}

{
  /* Two teams and no TOT row, which the source does produce. Summing is the
   * only available answer and it is the right one. */
  const t = seasonTotals([
    row("No Tot Row", "BOS", 2015, 30, 600), row("No Tot Row", "LAL", 2015, 40, 800)]);
  const s = t.get("No Tot Row|2015");
  ck("two team rows with no TOT are summed", !!s && s.gp === 70 && near(s.pts, 1400, 0.01),
     s && s.gp + " games");
}

console.log("\nseasons and decades");

ck("YEAR is the ending year, so 2016 is 2015-16", seasonLabel(2016) === "2015-16", seasonLabel(2016));
ck("and 2000 is 1999-00", seasonLabel(2000) === "1999-00", seasonLabel(2000));
/* THE DECADE COMES OFF THE SEASON'S START, and these are the cases that
 * shipped wrong when it came off the ending year instead. A card headed
 * "2020s" carried two 2019-20 seasons next to a 2024-25 one, and a "1960s"
 * five opened with Bob Pettit's 1959-60. */
ck("1963 is the 1962-63 season, so the 1960s", decadeOf(1963) === "1960s", decadeOf(1963));
ck("1970 is the 1969-70 season, so still the 1960s",
   decadeOf(1970) === "1960s", decadeOf(1970) + " for " + seasonLabel(1970));
ck("1971 is the 1970-71 season, so the 1970s",
   decadeOf(1971) === "1970s", decadeOf(1971) + " for " + seasonLabel(1971));
ck("2020 is the 2019-20 season, so the 2010s",
   decadeOf(2020) === "2010s", decadeOf(2020) + " for " + seasonLabel(2020));
ck("2021 is the 2020-21 season, so the 2020s",
   decadeOf(2021) === "2020s", decadeOf(2021) + " for " + seasonLabel(2021));
/* Every man on a card must belong to the decade the panel is headed with, or
 * the reader is reading a contradiction. Asserted as a property rather than
 * as five examples. */
{
  const wrong = [];
  for (let y = 1951; y <= 2026; y++) {
    const start = parseInt(seasonLabel(y).slice(0, 4), 10);
    const want = (start - (start % 10)) + "s";
    if (decadeOf(y) !== want) wrong.push(`${seasonLabel(y)} -> ${decadeOf(y)}, not ${want}`);
  }
  ck("and every season from 1950-51 on lands in the decade it started in",
     wrong.length === 0, wrong.slice(0, 3).join("  |  "));
}

console.log("\nwho is eligible");

{
  const rows = [
    row("Full Season", "BOS", 2015, 80, 1600),     // 20.0, in
    row("Six Games", "BOS", 2015, 6, 186),         // 31.0 but 6 games, out
    row("Role Player", "BOS", 2015, 80, 800),      // 10.0, under the ppg floor
    row("Just Over", "BOS", 2015, MIN_GP, 14 * MIN_GP)  // exactly at both floors, in
  ];
  const el = eligibleSeasons(seasonTotals(rows));
  const names = el.map(s => s.player);
  ck("a full season qualifies", names.includes("Full Season"));
  ck("a six-game cameo does not, whatever he averaged",
     !names.includes("Six Games"), names.join(", "));
  ck("nor does a ten-point scorer", !names.includes("Role Player"));
  ck("the floors are inclusive", names.includes("Just Over"), `MIN_GP=${MIN_GP} MIN_PPG=${MIN_PPG}`);
}

console.log("\nthe scoring era, measured before any filter");

{
  /* THE BUG THIS REPLACES. The old version averaged the scoring of players who
   * had already cleared MIN_PPG, so the figure could not go below that floor
   * and came out near 19 in every decade. Real scoring went from ~118 points a
   * team per game in 1961-62 to ~92 in 1998-99, and the card was quoting a
   * number that erased the whole effect.
   *
   * These rows are built so the right answer is arithmetic. One season, one
   * team of 10 men, 80 games each, 8 points a man: 80 team-games (the max GP
   * on the roster), 6400 points, 80 points a team per game. Crucially most of
   * these men are FAR below the card's 14-point floor, so a figure computed
   * from eligible seasons could never see them. */
  const rows = [];
  for (let k = 0; k < 10; k++) {
    rows.push(row("Low " + k, "BOS", 1975, 80, 80 * 8));
  }
  const by = teamScoringByYear(rows);
  const y = by.get(1975);
  ck("it counts every row, floors or no floors", !!y && near(y.perTeamGame, 80.0),
     y ? String(y.perTeamGame) : "(absent)");
  /* THE ASSERTION THAT PINS THE OLD BUG. Not one of these ten men would clear
   * the card's own floor, so the replaced version - which measured only
   * eligible seasons - had nothing at all to average here and would have
   * reported this league as unmeasurable. This one reports 80.0. */
  ck("and it measures a league where NOBODY clears the card's floor",
     eligibleSeasons(seasonTotals(rows)).length === 0 && !!y && y.perTeamGame > 0,
     `${eligibleSeasons(seasonTotals(rows)).length} eligible seasons, ` +
     `era still reads ${y && y.perTeamGame}`);
  ck("it reports how many teams it saw", !!y && y.teams === 1, y && String(y.teams));

  /* Two teams, different roster sizes, so team-games is the SUM over teams and
   * not the league's schedule length. 80 + 80 = 160 team-games, 12800 points,
   * 80 a game again. */
  const two = [];
  for (let k = 0; k < 10; k++) two.push(row("A" + k, "BOS", 1976, 80, 80 * 8));
  for (let k = 0; k < 16; k++) two.push(row("B" + k, "LAL", 1976, 50, 50 * 8));
  const y2 = teamScoringByYear(two).get(1976);
  /* BOS: 80 team-games, 6400 points. LAL: 50 team-games, 6400 points.
   * 12800 / 130 = 98.46 */
  ck("team-games is the sum over teams, by each team's longest server",
     !!y2 && near(y2.perTeamGame, 98.5, 0.1), y2 && String(y2.perTeamGame));
  ck("and both teams are counted", !!y2 && y2.teams === 2, y2 && String(y2.teams));

  /* A TOT row must not inflate the numerator, and belongs to no team, so it is
   * excluded from both halves of the fraction. */
  const withTot = [
    row("Split Man", "TOT", 1977, 80, 80 * 20),
    row("Split Man", "BOS", 1977, 40, 40 * 20),
    row("Split Man", "LAL", 1977, 40, 40 * 20)
  ];
  const y3 = teamScoringByYear(withTot).get(1977);
  /* 1600 points across 40 + 40 = 80 team-games = 20.0. With the TOT row
   * counted it would be 3200/80 = 40.0, exactly double. */
  ck("a TOT row does not double the league's points",
     !!y3 && near(y3.perTeamGame, 20.0), y3 && String(y3.perTeamGame));

  /* MINUTES BEAT THE ROSTER MAX, and this is the case that proves it.
   *
   * One team, 82 games, and LOAD MANAGEMENT: nobody plays more than 70, which
   * is the modern league. Ten men share 82 x 240 = 19,680 player-minutes and
   * score 82 x 110 = 9,020 points, so the answer is exactly 110.0.
   *
   * The roster-max method sees a top GP of 70 and calls it 70 team-games,
   * giving 9020 / 70 = 128.9 - nearly twenty points high. That is the error
   * that put the 2020s at 117 against a real 113, and because it only appears
   * when nobody plays a full season it tracks the era, which is the one axis
   * this card compares. */
  {
    const games = 82, teamPts = 110;
    const load = [];
    for (let k = 0; k < 10; k++) {
      load.push({ PLAYER: "Rested " + k, TEAM: "BOS", YEAR: "2024",
                  GP: String(60 + (k % 11)),            // 60..70, never 82
                  MIN: String((games * 240) / 10),      // the minutes are all there
                  PTS: String((games * teamPts) / 10) });
    }
    const y = teamScoringByYear(load).get(2024);
    ck("minutes give the exact answer when nobody plays every game",
       !!y && near(y.perTeamGame, 110.0, 0.1), y && String(y.perTeamGame));
    ck("and it says which denominator it used", !!y && y.method === "minutes",
       y && y.method);
    /* The same rows with minutes stripped fall back, and are wrong - stated
     * here so the fallback's weakness is recorded rather than discovered. */
    const noMin = load.map(r => Object.assign({}, r, { MIN: "0" }));
    const y2 = teamScoringByYear(noMin).get(2024);
    ck("without minutes it falls back and overstates, as documented",
       !!y2 && y2.method === "roster-max" && y2.perTeamGame > 120,
       y2 && `${y2.perTeamGame} from ${y2.method}, true answer 110.0`);
  }

  const squad = [{ year: 1975 }, { year: 1976 }];
  ck("a squad's era is the mean of its seasons",
     near(environmentOf(squad, by.size ? new Map([[1975, { perTeamGame: 80 }],
       [1976, { perTeamGame: 100 }]]) : by), 90.0));
}

console.log("\nbuilding a five");

{
  const rows = [];
  for (let k = 0; k < 9; k++) rows.push(row("Sixties " + k, "BOS", 1962 + (k % 3), 80, 80 * (26 - k)));
  const el = eligibleSeasons(seasonTotals(rows));
  const five = squadFrom(el, "seed", null);
  ck("it has five men", !!five && five.length === SQUAD, five && String(five.length));
  ck("all five are different men", !!five && new Set(five.map(s => s.player)).size === SQUAD);
  ck("the same seed gives the same five",
     JSON.stringify(squadFrom(el, "seed", null)) === JSON.stringify(five));
  ck("a different seed can give a different one",
     JSON.stringify(squadFrom(el, "other", null)) !== JSON.stringify(five) ||
     el.length === SQUAD, "(or the pool is exactly five deep)");
  ck("a man already used is skipped",
     (() => {
       const used = new Set([five[0].player]);
       const other = squadFrom(el, "seed", used);
       return !other || !other.some(s => s.player === five[0].player);
     })());
}

{
  /* Two men cannot fill a five, and the library must say no rather than return
   * a short squad that a card would render with three empty rows. */
  const rows = [row("One", "BOS", 1962, 80, 1600), row("Two", "BOS", 1962, 80, 1600)];
  const el = eligibleSeasons(seasonTotals(rows));
  ck("a decade that cannot fill a five returns nothing", squadFrom(el, "s", null) === null);
}

console.log("\npairing two decades");

{
  /* Built so exactly one pairing lands in the band. The 1960s five totals
   * 5 x 25 = 125.0; the 1990s five totals 5 x 24 = 120.0, a gap of 5.0, which
   * is inside MIN_GAP..MAX_GAP. The 2010s five totals 5 x 15 = 75.0, far
   * outside it against either. */
  const rows = [];
  for (let k = 0; k < 5; k++) rows.push(row("Six " + k, "BOS", 1962, 80, 80 * 25));
  for (let k = 0; k < 5; k++) rows.push(row("Nine " + k, "BOS", 1995, 80, 80 * 24));
  for (let k = 0; k < 5; k++) rows.push(row("Ten " + k, "BOS", 2015, 80, 80 * 15));
  const el = eligibleSeasons(seasonTotals(rows));
  /* Five seasons a decade is under MIN_DECADE_SEASONS by design: these
   * fixtures exist to check the arithmetic, so the depth gate is lowered
   * here and tested on its own below. */
  const pairs = squadPairs(el, { minDecadeSeasons: 5 });

  ck("only the pairing inside the band survives", pairs.length === 1,
     pairs.map(p => p.decades.join(" v ") + " gap " + p.gap).join(", ") || "(none)");
  const p = pairs[0];
  ck("and it is the 1960s against the 1990s",
     !!p && p.decades.join(" ") === "1960s 1990s", p && p.decades.join(" "));
  ck("the totals are the sums of the fives",
     !!p && near(p.aTotal, 125.0) && near(p.bTotal, 120.0),
     p && p.aTotal + " v " + p.bTotal);
  ck("the gap is the difference", !!p && near(p.gap, 5.0), p && String(p.gap));
  ck("the higher squad is named correctly", !!p && p.higher === "a", p && p.higher);
  ck("no man appears on both fives", !!p &&
     p.a.every(s => !p.b.some(t => t.player === s.player)));
  ck("squadTotal agrees with the pair", !!p && near(squadTotal(p.a), p.aTotal));
}

{
  /* A pairing whose totals are identical has no answer. The band's floor
   * excludes it; this holds that in place against a future caller passing
   * minGap: 0 and quietly shipping a card with two right answers. */
  const rows = [];
  for (let k = 0; k < 5; k++) rows.push(row("A" + k, "BOS", 1962, 80, 80 * 20));
  for (let k = 0; k < 5; k++) rows.push(row("B" + k, "BOS", 1995, 80, 80 * 20));
  const el = eligibleSeasons(seasonTotals(rows));
  ck("two equal fives are never a card",
     squadPairs(el, { minGap: 0, maxGap: 99, minDecadeSeasons: 5 }).length === 0);
}

{
  /* The band's ceiling. A blowout is not a question. */
  const rows = [];
  for (let k = 0; k < 5; k++) rows.push(row("Big" + k, "BOS", 1962, 80, 80 * 30));
  for (let k = 0; k < 5; k++) rows.push(row("Small" + k, "BOS", 1995, 80, 80 * 15));
  const el = eligibleSeasons(seasonTotals(rows));
  const wide = squadPairs(el, { minDecadeSeasons: 5 });
  ck("a 75-point gap is not offered", wide.length === 0,
     wide.map(p => String(p.gap)).join(",") || "(none, correct)");
  ck("and the band is the reason", MIN_GAP > 0 && MAX_GAP < 75,
     `MIN_GAP=${MIN_GAP} MAX_GAP=${MAX_GAP}`);
}

console.log("\nthe seed walk, which is what makes this a pool and not three cards");

{
  /* A deep pool in two decades, spread across scoring levels so that SOME
   * fives land in the band and others do not. One seed per pairing would take
   * whatever the first draw gave and discard the pairing on a miss; walking
   * seeds should find several. */
  const rows = [];
  for (let k = 0; k < 55; k++) rows.push(row("Six " + k, "BOS", 1962 + (k % 8), 80, 80 * (30 - k * 0.25)));
  for (let k = 0; k < 55; k++) rows.push(row("Nine " + k, "LAL", 1992 + (k % 8), 80, 80 * (29 - k * 0.25)));
  const el = eligibleSeasons(seasonTotals(rows));

  const many = squadPairs(el);
  ck("a deep pairing yields more than one card", many.length > 1,
     many.length + " card(s), gaps " + many.map(p => p.gap).join(", "));
  ck("but no more than the per-pairing cap", many.length <= 3,
     many.length + " from one pairing, cap 3");

  /* One seed would have produced at most one, and only if it got lucky. This
   * is the regression that matters: a future tidy-up that drops the seed loop
   * silently shrinks the pool rather than breaking anything. */
  const single = squadPairs(el, { attempts: 1 });
  ck("and one attempt is measurably worse", single.length < many.length,
     single.length + " with one attempt vs " + many.length);

  ck("every card from the walk is still inside the band",
     many.every(p => p.gap >= MIN_GAP && p.gap <= MAX_GAP),
     many.map(p => p.gap).join(", "));
  ck("and no card repeats another's two fives",
     new Set(many.map(p => p.a.map(s => s.player).sort().join() + "::" +
                           p.b.map(s => s.player).sort().join())).size === many.length);

  /* The feed remembers what a reader has seen by story_key. A pool that
   * reshuffles between builds is a different question wearing the same key. */
  ck("a rebuild produces exactly the same pool",
     JSON.stringify(squadPairs(el)) === JSON.stringify(many));
}

console.log("\nthe five has the shape of a team, not a slice of a tie block");

{
  /* THE BUG THIS IS FOR, AND IT SHIPPED. squadFrom used to take five
   * CONSECUTIVE entries from a list sorted by scoring average, so every five
   * was men who averaged the same thing, ordered by the sort's name tiebreak:
   *
   *     Andre Iguodala 14.1  Bogdan Bogdanovic 14.1  DeMarcus Cousins 14.1
   *     Deron Williams 14.1  Domantas Sabonis 14.1
   *
   * A hundred men all at exactly 15.0, which is the worst case: under the old
   * code every possible five was five 15.0s and no test of totals could see
   * anything wrong, because the totals were all correct. Only the SPREAD gives
   * it away. Here one tier of a hundred identical men is unavoidable, so the
   * fixture puts a real range underneath instead and asserts the range comes
   * through. */
  const rows = [];
  for (let k = 0; k < 100; k++) {
    /* 28.0 down to 14.0 in even steps, so a five drawn one-per-tier must span
     * most of that range and five consecutive entries cannot. */
    rows.push(row("Man " + String(k).padStart(3, "0"), "BOS", 1985 + (k % 8), 80,
                  Math.round(80 * (28 - k * 0.14))));
  }
  const el = eligibleSeasons(seasonTotals(rows));
  ck("the fixture is deep enough to have tiers", el.length >= 90, el.length + " seasons");

  const five = squadFrom(el, "spread", new Set());
  const vals = five ? five.map(s => s.ppg) : [];
  const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  ck("the five is not five men on the same average", spread > 5,
     vals.join(", ") + "  spread " + spread.toFixed(1));
  ck("and it runs high to low, like a rotation",
     vals.length === SQUAD && vals.every((v, i) => i === 0 || v <= vals[i - 1] + 0.001),
     vals.join(" > "));

  /* Ten different seeds, every one of them spread. One lucky seed is not the
   * property being claimed. */
  const spreads = [];
  for (let k = 0; k < 10; k++) {
    const f = squadFrom(el, "seed" + k, new Set());
    if (!f) { spreads.push(-1); continue; }
    const v = f.map(s => s.ppg);
    spreads.push(Math.max(...v) - Math.min(...v));
  }
  ck("every seed gives a spread five, not just this one",
     spreads.every(v => v > 5), spreads.map(v => v.toFixed(1)).join(", "));
}

console.log("\nthe era floor and the depth floor");

{
  /* Pre-1950 is the BAA. The NBA counts those seasons as its own, so this is
   * not a correctness gate - it is a depth gate. Eleven qualifying seasons
   * cannot supply eight pairings without the same men recurring, which is what
   * the first real build did. */
  const rows = [
    row("Baa Man", "BOS", 1948, 60, 60 * 20),
    row("Nba Man", "BOS", 1955, 60, 60 * 20)
  ];
  const el = eligibleSeasons(seasonTotals(rows));
  const names = el.map(s => s.player);
  ck(`a pre-${MIN_YEAR} season is out`, !names.includes("Baa Man"), names.join(", "));
  ck("a later one is in", names.includes("Nba Man"));
  ck("and the floor is the merger season", MIN_YEAR === 1950, String(MIN_YEAR));
}

{
  /* A decade with enough men to fill ONE five but not enough to be sampled
   * from repeatedly is dropped rather than allowed to repeat itself. */
  const rows = [];
  for (let k = 0; k < 6; k++) rows.push(row("Thin " + k, "BOS", 1965, 80, 80 * (25 - k)));
  for (let k = 0; k < 60; k++) rows.push(row("Deep " + k, "LAL", 1995 + (k % 8), 80,
                                             Math.round(80 * (28 - k * 0.2))));
  const el = eligibleSeasons(seasonTotals(rows));
  const thin = el.filter(s => s.decade === "1960s").length;
  ck("the thin decade could fill a five on its own", thin >= SQUAD, thin + " seasons");
  ck("but it is dropped from the pairings anyway",
     squadPairs(el).every(p => !p.decades.includes("1960s")),
     `MIN_DECADE_SEASONS=${MIN_DECADE_SEASONS}, thin decade had ${thin}`);
  ck("and lowering the gate lets it back in",
     squadPairs(el, { minDecadeSeasons: SQUAD }).some(p => p.decades.includes("1960s")));
}

console.log("\nnobody becomes the face of the card type");

{
  /* Three decades deep enough to pair, so the pool has several cards and the
   * per-player cap has something to bite on. */
  const rows = [];
  /* Anchored so that d + (k % 8) stays INSIDE each decade. 1965 + 7 is 1972,
   * which would scatter one decade's men across two and leave every bucket
   * under the depth floor - which is exactly what it did. */
  const decades = [1962, 1982, 2002];
  decades.forEach((d, di) => {
    for (let k = 0; k < 60; k++) {
      rows.push(row(`D${di} Man ${String(k).padStart(2, "0")}`, "BOS", d + (k % 8), 80,
                    Math.round(80 * (28 - di * 0.6 - k * 0.2))));
    }
  });
  const el = eligibleSeasons(seasonTotals(rows));
  const pairs = squadPairs(el);
  ck("the pool has several cards", pairs.length >= 3, pairs.length + " cards");

  const seen = new Map();
  for (const p of pairs) {
    for (const s of p.a.concat(p.b)) seen.set(s.player, (seen.get(s.player) || 0) + 1);
  }
  const worst = [...seen.entries()].sort((a, b) => b[1] - a[1])[0] || ["(nobody)", 0];
  ck(`no man appears on more than ${MAX_CARDS_PER_PLAYER} cards`,
     worst[1] <= MAX_CARDS_PER_PLAYER, `${worst[0]} appears ${worst[1]} time(s)`);
  /* THE CAP AS A MECHANISM, not as a hope about the fixture.
   *
   * The default cap of three is not reached on this data - the worst offender
   * appears twice - so asserting "somebody would exceed three without it"
   * would be a claim about the fixture rather than about the code, and it
   * would pass or fail for reasons that have nothing to do with the cap.
   *
   * Driving the cap to one instead gives a difference that can only come from
   * the cap: uncapped, some man appears more than once; capped at one, nobody
   * can. */
  const countBy = list => {
    const m = new Map();
    for (const p of list) for (const s of p.a.concat(p.b)) m.set(s.player, (m.get(s.player) || 0) + 1);
    return Math.max(0, ...m.values());
  };
  const worstUncapped = countBy(squadPairs(el, { maxCardsPerPlayer: 99 }));
  const worstAtOne = countBy(squadPairs(el, { maxCardsPerPlayer: 1 }));
  ck("uncapped, at least one man recurs", worstUncapped > 1,
     `worst appears ${worstUncapped} times`);
  ck("and a cap of one holds every man to one card", worstAtOne === 1,
     `worst appears ${worstAtOne} time(s) with the cap at 1`);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a squad total would be wrong, and wrong in a way nobody would see"
                 : "every five is five real seasons, counted once each");
process.exit(fail ? 1 : 0);
