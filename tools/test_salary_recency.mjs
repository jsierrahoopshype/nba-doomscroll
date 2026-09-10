/* Leaning the salary pool toward recent seasons.
 *
 *     node tools/test_salary_recency.mjs
 *
 * "There's too much old salary content." The fix scales a card's quality by
 * how long ago its season was, which is a lever that can go wrong in three
 * ways: it can flatten history out of the pool, it can fail to move the mix at
 * all, or it can mis-read the season label and age a card by a century. All
 * three are checked here.
 */

import {
  recencyFactor, yearFromSeasonLabel, RECENCY_HALF_LIFE, RECENCY_FLOOR
} from "./lib/salary.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* build_salary.mjs's own label, so the two cannot drift apart. */
const seasonLabel = y => (y - 1) + "-" + String(y).slice(2);

console.log("\nreading a season label back");

ck("a normal season round-trips", yearFromSeasonLabel(seasonLabel(2024)) === 2024,
   seasonLabel(2024));
ck("the century rollover round-trips", yearFromSeasonLabel(seasonLabel(2000)) === 2000,
   seasonLabel(2000) + " -> " + yearFromSeasonLabel(seasonLabel(2000)));
ck("the first season in the file round-trips", yearFromSeasonLabel(seasonLabel(1992)) === 1992);

{
  /* Every season the builder can produce, not a handful I picked. A label that
   * read back wrong by a century would age a card by a hundred years and bury
   * it at the floor, which is exactly the sort of thing that looks like a
   * ranking preference rather than a bug. */
  let bad = null;
  for (let y = 1992; y <= 2030; y++) {
    if (yearFromSeasonLabel(seasonLabel(y)) !== y) { bad = y; break; }
  }
  ck("all 39 seasons 1992-2030 round-trip", bad === null, bad ? "broke at " + bad : "");
}

ck("a missing label is null, not a year", yearFromSeasonLabel(undefined) === null);
ck("junk is null", yearFromSeasonLabel("last season") === null);
ck("a bare year is null", yearFromSeasonLabel("2024") === null);

console.log("\nthe decay curve");

const L = 2026;
ck("the newest season is not scaled at all", recencyFactor(L, L) === 1);
ck("a half-life back has lost half the range",
   Math.abs(recencyFactor(L - RECENCY_HALF_LIFE, L) - (RECENCY_FLOOR + (1 - RECENCY_FLOOR) / 2)) < 1e-9,
   recencyFactor(L - RECENCY_HALF_LIFE, L).toFixed(4));

{
  let monotonic = true;
  for (let y = 1992; y < L; y++) {
    if (recencyFactor(y, L) > recencyFactor(y + 1, L)) { monotonic = false; break; }
  }
  ck("older is never worth more than newer", monotonic);
}

ck("the oldest season keeps more than half its score",
   recencyFactor(1992, L) > 0.5, recencyFactor(1992, L).toFixed(3));
ck("and never drops below the floor", recencyFactor(1900, L) >= RECENCY_FLOOR);
ck("a future season is not rewarded for it", recencyFactor(L + 5, L) === 1);

/* An all-time card - earnings by country, by draft class - has no season and
 * nothing to be recent about. Scaling it would push every group card down the
 * feed for no reason anyone could name. */
ck("no year means no scaling", recencyFactor(null, L) === 1);
ck("no latest season means no scaling", recencyFactor(2001, null) === 1);
ck("neither does not throw", recencyFactor() === 1);

console.log("\nwhat it does to a ranking");

{
  const score = (quality, year) => quality * recencyFactor(year, L);

  /* The point of scaling rather than filtering: a genuinely great old card
   * still wins. Shaq at 47% of the Lakers' book beats the fourteenth-best
   * payroll card of last season. */
  ck("a great old card still beats a weak recent one",
     score(0.82, 1998) > score(0.5, 2026),
     score(0.82, 1998).toFixed(3) + " vs " + score(0.5, 2026).toFixed(3));

  /* And the actual complaint: at equal merit, recent wins. */
  ck("at equal merit the recent card wins", score(0.76, 2025) > score(0.76, 1996));

  /* The mix has to MOVE, or the lever does nothing. Thirty-five seasons of
   * equally good cards, take the best ten: how many are from the last decade? */
  const pool = [];
  for (let y = 1992; y <= L; y++) pool.push({ y, s: score(0.75, y) });
  pool.sort((a, b) => b.s - a.s);
  const recent = pool.slice(0, 10).filter(c => c.y > L - 10).length;
  ck("the top ten of an evenly-good pool is all recent", recent === 10, recent + "/10");

  /* But not so hard that a merely decent old card can never appear. A 1996
   * card has to be better than a 2026 one by about a third to win, which is a
   * bar a card can clear. */
  const needed = recencyFactor(2026, L) / recencyFactor(1996, L);
  ck("an old card needs to be better by a beatable margin",
     needed > 1.3 && needed < 1.8, needed.toFixed(2) + "x");
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the recency lever is not safe to ship"
                 : "recent salary content wins without history being deleted");
process.exit(fail ? 1 : 0);
