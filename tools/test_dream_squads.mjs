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
  seasonTotals, ppg, seasonLabel, decadeOf, eligibleSeasons, scoringByYear,
  environmentOf, squadFrom, squadPairs, squadTotal,
  MIN_GP, MIN_PPG, SQUAD, MIN_GAP, MAX_GAP
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
ck("1963 is the 1960s", decadeOf(1963) === "1960s", decadeOf(1963));
ck("1970 is the 1970s, not the 1960s", decadeOf(1970) === "1970s", decadeOf(1970));

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

console.log("\nthe scoring environment");

{
  /* Two seasons, deliberately different environments: 1962 scores heavily,
   * 1999 does not. This is the number the reveal quotes. */
  const rows = [];
  for (let k = 0; k < 4; k++) rows.push(row("Sixties " + k, "BOS", 1962, 80, 80 * 25));
  for (let k = 0; k < 4; k++) rows.push(row("Nineties " + k, "BOS", 1999, 80, 80 * 17));
  const el = eligibleSeasons(seasonTotals(rows));
  const by = scoringByYear(el);
  ck("1962 reads 25.0 points per player-game", near((by.get(1962) || {}).ppg, 25.0),
     String((by.get(1962) || {}).ppg));
  ck("1999 reads 17.0", near((by.get(1999) || {}).ppg, 17.0), String((by.get(1999) || {}).ppg));
  const sixties = el.filter(s => s.year === 1962);
  ck("a squad's environment is the mean of its seasons",
     near(environmentOf(sixties, by), 25.0), String(environmentOf(sixties, by)));
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
  const pairs = squadPairs(el);

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
     squadPairs(el, { minGap: 0, maxGap: 99 }).length === 0);
}

{
  /* The band's ceiling. A blowout is not a question. */
  const rows = [];
  for (let k = 0; k < 5; k++) rows.push(row("Big" + k, "BOS", 1962, 80, 80 * 30));
  for (let k = 0; k < 5; k++) rows.push(row("Small" + k, "BOS", 1995, 80, 80 * 15));
  const el = eligibleSeasons(seasonTotals(rows));
  const wide = squadPairs(el);
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
  for (let k = 0; k < 40; k++) rows.push(row("Six " + k, "BOS", 1962 + (k % 8), 80, 80 * (30 - k * 0.4)));
  for (let k = 0; k < 40; k++) rows.push(row("Nine " + k, "LAL", 1992 + (k % 8), 80, 80 * (29 - k * 0.4)));
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

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a squad total would be wrong, and wrong in a way nobody would see"
                 : "every five is five real seasons, counted once each");
process.exit(fail ? 1 : 0);
