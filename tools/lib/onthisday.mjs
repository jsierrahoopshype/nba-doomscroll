/* Choosing which rumors a calendar day gets to show.
 *
 * Lifted out of tools/build_rumors_onthisday.mjs so it can be tested without
 * the archive: that script downloads 435 MB on start-up, which makes every rule
 * inside it untestable in place. These are the rules.
 *
 * NOTHING HERE EVER SEES REAL DATA IN A TEST. The fixtures in
 * tools/test_onthisday.mjs are invented, and they have to be - the archive
 * content rule applies to test files exactly as it does to everything else.
 */

/** Does the editorial blocklist reject this entry?
 *
 * The same test js/rumors.js runs in the reader's browser, deliberately
 * identical rather than merely equivalent: a blocked topic should have to get
 * past two passes of ONE rule, not one pass each of two rules that drifted.
 *
 * `terms` match anywhere, including inside a longer word. `whole` match only as
 * a complete word, which is what that list is for - a three-letter term that
 * appears inside a dozen innocent words is useless as a substring.
 *
 * @param {object} e  an archive entry
 * @param {{terms: string[], whole: Set<string>}} blocklist
 */
export function isBlocked(e, blocklist) {
  if (!blocklist) return true;          // fail closed: no list, nothing passes
  let hay = [e && e.text, e && e.quote, e && e.outlet].filter(Boolean).join(" ");
  if (e && Array.isArray(e.tags)) hay += " " + e.tags.join(" ");
  hay = hay.toLowerCase();
  for (const t of blocklist.terms || []) if (t && hay.indexOf(t) >= 0) return true;
  const whole = blocklist.whole instanceof Set ? blocklist.whole : new Set(blocklist.whole || []);
  if (whole.size) for (const w of hay.split(/[^a-z0-9']+/)) if (whole.has(w)) return true;
  return false;
}

/** How much a card is worth reading, before anything about which day it is.
 *
 * A real quote is the difference between a rumor card and a headline, so it
 * carries the most. A named player makes it findable and taggable. Length only
 * breaks near-ties - a longer excerpt is a weak signal, not a good one.
 */
export function score(e) {
  const text = String((e && e.text) || "");
  return (e && e.quote ? 2 : 0) +
         (e && Array.isArray(e.tags) && e.tags.length ? 1 : 0) +
         Math.min(1, text.length / 280);
}

/** Pick the day's entries: spread across years first, quality second.
 *
 * WHY SPREAD BEATS SCORE
 *
 * Sixteen years of archive means a single calendar day holds around 1,800
 * entries, and they are not evenly spread - a day inside a trade deadline or a
 * Finals week carries hundreds from one year. Taking the top thirty by score
 * would hand a reader thirty cards from one afternoon in 2021 and call it "on
 * this day". Capping each year first is what makes the feature mean what its
 * name says.
 *
 * Round-robin, newest year first: every year contributes its best before any
 * year contributes its second. A day where only three years have anything
 * still fills up to perYear from each rather than returning three.
 *
 * @param {object[]} list  every entry stamped with this month and day
 * @param {number} perDay  hard cap on what comes back
 * @param {number} perYear hard cap on any single year's contribution
 */
export function pickForDay(list, perDay, perYear) {
  const rows = Array.isArray(list) ? list.filter(Boolean) : [];
  const cap = perDay > 0 ? perDay : 30;
  const perY = perYear > 0 ? perYear : 3;
  if (!rows.length) return [];

  const byYear = new Map();
  for (const e of rows) {
    const y = e.year != null ? e.year : parseInt(String(e.date || "").slice(0, 4), 10);
    if (!Number.isFinite(y)) continue;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(e);
  }
  for (const arr of byYear.values()) {
    arr.sort((a, b) => (score(b) - score(a)) ||
                       String(b.date || "").localeCompare(String(a.date || "")));
  }

  const years = [...byYear.keys()].sort((a, b) => b - a);
  const out = [];
  for (let round = 0; round < perY && out.length < cap; round++) {
    for (const y of years) {
      if (out.length >= cap) break;
      const arr = byYear.get(y);
      if (arr.length > round) out.push(arr[round]);
    }
  }
  return out;
}

/** What actually gets stored. The scoring field is working state, not content,
 * and shipping it would put a number nobody can interpret into every card. */
export function forStorage(e) {
  return {
    date: e.date,
    text: e.text,
    quote: e.quote || null,
    outlet: e.outlet || "HoopsHype",
    url: e.url,
    tags: Array.isArray(e.tags) ? e.tags : []
  };
}
