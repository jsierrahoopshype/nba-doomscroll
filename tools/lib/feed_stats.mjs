/* The three measurements the feed audit turns on, kept pure and testable.
 *
 * WHY THESE LEFT THE AUDIT SCRIPT
 *
 * A misreporting audit is worse than no audit, because it produces confident
 * numbers that send tuning in the wrong direction. `gaps`, `windowMax` and
 * `adjacent` are where that would happen quietly: an off-by-one in the window
 * loop, or a gap mean that counts the leading run-up, and the report still
 * looks plausible. So they live here with tools/test_feed_stats.mjs against
 * hand-checked fixtures, and the audit script is left with only orchestration.
 */

/**
 * Where a predicate holds, and how far apart those positions are.
 *
 * @returns {{ n: number, mean: number|null, first: number|null, at: number[] }}
 *   `mean` is the mean distance BETWEEN hits, which is what "1 per N cards"
 *   means, so it needs two hits to exist and is null below that. It is not
 *   length/count: that would fold the run-up before the first hit into the
 *   spacing and read low on a feed that opens with a cluster.
 */
export function gaps(feed, pred) {
  const at = [];
  for (let i = 0; i < feed.length; i++) if (pred(feed[i], i)) at.push(i);
  if (at.length < 2) {
    return { n: at.length, mean: null, first: at.length ? at[0] : null, at };
  }
  let sum = 0;
  for (let i = 1; i < at.length; i++) sum += at[i] - at[i - 1];
  return { n: at.length, mean: sum / (at.length - 1), first: at[0], at };
}

/**
 * The most hits any window of `size` consecutive cards contains.
 *
 * Windows that would run off the end are not counted, so a 9-card feed reports
 * no 10-card window rather than a short one - a partial window can only ever
 * understate a cap violation, and reporting it as a pass is the failure mode
 * that matters here.
 */
export function windowMax(feed, pred, size) {
  if (size <= 0 || feed.length < size) return 0;
  let worst = 0;
  for (let i = 0; i + size <= feed.length; i++) {
    let n = 0;
    for (let j = i; j < i + size; j++) if (pred(feed[j], j)) n++;
    if (n > worst) worst = n;
  }
  return worst;
}

/**
 * How many neighbouring pairs share a key.
 *
 * A null or empty key means "not in this class", and two of those in a row are
 * NOT an adjacency - otherwise a feed of cards that are all irrelevant to the
 * question would report maximum clustering.
 */
export function adjacent(feed, keyOf) {
  let n = 0;
  for (let i = 1; i < feed.length; i++) {
    const a = keyOf(feed[i - 1]), b = keyOf(feed[i]);
    if (a && b && a === b) n++;
  }
  return n;
}

/** Share as a percentage, with the empty-feed case answered rather than NaN. */
export function pct(n, total) { return total ? (100 * n / total) : 0; }

/** Mean of a list, null when empty, so "never happened" stays distinct from 0. */
export function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}
