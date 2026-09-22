/* The audit's measurements, against fixtures counted by hand.
 *
 *     node tools/test_feed_stats.mjs
 *
 * Every number the audit prints passes through gaps, windowMax or adjacent. If
 * one of them is off by one, the audit still prints a confident report and the
 * scheduler gets tuned against it. So each is checked against a feed small
 * enough to count on paper, including the cases where the obvious
 * implementation is wrong: a feed that opens with a cluster, a window longer
 * than the feed, and a key that is absent rather than shared.
 */

import { gaps, windowMax, adjacent, pct, mean } from "./lib/feed_stats.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const eq = (name, got, want) =>
  ck(name, got === want, got === want ? "" : `got ${got}, want ${want}`);

/* A feed is just a list; the predicate does the work. Letters keep the
 * fixtures readable and countable. */
const feed = s => s.split("").map(ch => ({ k: ch }));
const is = ch => c => c.k === ch;

console.log("\ngaps: the mean distance BETWEEN hits");

{
  /*  index: 0123456789
   *          A...A...A     hits at 0, 4, 8 - two gaps of 4 */
  const g = gaps(feed("A...A...A."), is("A"));
  eq("counts the hits", g.n, 3);
  eq("mean gap is the mean of the gaps", g.mean, 4);
  eq("first is where the first hit is", g.first, 0);

  /* THE CASE THAT CATCHES length/count. Five hits in ten cards is "1 per 2" by
   * that arithmetic, but they are adjacent at the front: the real spacing is 1
   * and the feed opens with a wall. */
  const cluster = gaps(feed("AAAAA....."), is("A"));
  eq("a leading cluster reports its real spacing, not length/count", cluster.mean, 1);
  ck("and length/count would have said 2 instead", 10 / cluster.n === 2);

  const one = gaps(feed(".....A...."), is("A"));
  eq("one hit has no spacing to report", one.mean, null);
  eq("but it still says where it was", one.first, 5);

  const none = gaps(feed(".........."), is("A"));
  eq("no hits at all is null, not zero", none.mean, null);
  eq("and no first", none.first, null);
  eq("empty feed is handled", gaps([], is("A")).n, 0);

  /* The predicate gets the index too, which the audit does not use yet and a
   * caller measuring "in the first N" would. */
  const idx = gaps(feed("AAAAAAAAAA"), (c, i) => i % 3 === 0);
  eq("the predicate receives the index", idx.n, 4);
}

console.log("\nwindowMax: the worst window, not the average one");

{
  /*  ...AA.AA...   a 5-card window covering both pairs holds 4 */
  const f = feed("...AA.AA...");
  eq("finds the worst 5-card window", windowMax(f, is("A"), 5), 4);
  eq("a 2-card window can only hold 2", windowMax(f, is("A"), 2), 2);
  eq("a 1-card window holds 1", windowMax(f, is("A"), 1), 1);
  eq("the whole feed holds all four", windowMax(f, is("A"), f.length), 4);

  /* A partial window would understate a violation, so it is not counted. A
   * 9-card feed genuinely has no 10-card window to judge. */
  eq("a window longer than the feed is not judged", windowMax(feed("AAAAAAAAA"), is("A"), 10), 0);
  eq("a zero-size window is refused", windowMax(f, is("A"), 0), 0);
  eq("no hits is zero", windowMax(f, is("Z"), 5), 0);

  /* Spread out, the same count in the same feed length is not a violation -
   * which is the whole reason the audit measures windows and not shares. */
  /* Hits at 0, 3, 6, 9: any three consecutive cards hold exactly one. Same
   * count and same feed length as the clustered fixture above, and the window
   * measure is what tells them apart. (My first version of this assertion
   * said 2, by mistaking a spacing of 3 for two-in-three; the fixture is the
   * arithmetic, so it is spelled out.) */
  eq("four hits spaced 3 apart never put 2 in a 3-card window",
     windowMax(feed("A..A..A..A"), is("A"), 3), 1);
  eq("but spaced 2 apart they do", windowMax(feed("A.A.A.A..."), is("A"), 3), 2);
}

console.log("\nadjacent: neighbours that share a key");

{
  const key = c => (c.k === "." ? null : c.k);
  eq("three in a row is two adjacencies", adjacent(feed("AAA......."), key), 2);
  eq("two separate pairs is two", adjacent(feed("AA...BB..."), key), 2);
  eq("different neighbours are not adjacent", adjacent(feed("AB.AB.AB.."), key), 0);

  /* THE CASE THAT MATTERS. Eight cards that are all "not awards" must not
   * count as seven awards adjacencies. */
  eq("a null key is not a shared key", adjacent(feed(".........."), key), 0);
  eq("and an empty-string key is not either",
     adjacent(feed("AA"), c => ""), 0);
  eq("a one-card feed has no neighbours", adjacent(feed("A"), key), 0);
  eq("an empty feed has none", adjacent([], key), 0);
}

console.log("\npct and mean: the edges");

{
  eq("pct of an empty total is 0, not NaN", pct(0, 0), 0);
  eq("pct is a percentage", pct(1, 4), 25);
  eq("mean of nothing is null, so `never` stays distinct from 0", mean([]), null);
  eq("mean of zeros is 0", mean([0, 0]), 0);
  eq("mean averages", mean([1, 2, 3]), 2);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the audit would misreport the feed"
                 : "the audit's measurements are the measurements they claim to be");
process.exit(fail ? 1 : 0);
