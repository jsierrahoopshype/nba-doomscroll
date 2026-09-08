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

/* HOW MUCH OF AN ENTRY A BUCKET KEEPS.
 *
 * The first build cut both fields to 280 characters, which was a guess made
 * before anyone had measured the fields. Measured (tools/rumor_field_shape.mjs,
 * Sept 2026, structure only): `text` is the passage, median 442 characters and
 * up to 1,579; `quote` is the shorter excerpt inside it that the card renders
 * as the link, median 149 and up to 456.
 *
 * So 280 cut more than half of every entry in the archive, and worse, it cut
 * the linked span off the ones where it sits late in the passage. The card then
 * cannot find the excerpt inside the passage and falls back to linking only the
 * outlet - correct, but not what the rumors page does.
 *
 * 1,600 is above the longest passage seen, so in practice nothing is truncated
 * at all and this is a safety valve rather than an editorial decision. It costs
 * about 5 MB across all 366 buckets.
 */
export const TEXT_CAP = 1600;
export const QUOTE_CAP = 1000;

/** Cut an entry down for storage WITHOUT cutting the linked span off it.
 *
 * When the passage is longer than the cap, the cut is pushed out to wherever
 * the excerpt ends rather than landing at a fixed offset. A card that loses its
 * last sentence is a smaller loss than a card that loses its link.
 *
 * The excerpt is located with a plain indexOf, not the normalising search the
 * renderer uses. That search lives in js/cards.js and copying it here would put
 * two versions of one rule in the repo, which is worse than the failure it
 * would prevent: if typography stops the two fields matching, this falls back
 * to the plain cap, and at 1,600 against a 442-character median that means the
 * passage is kept whole anyway.
 */
export function trim(text, quote, caps) {
  const c = caps || {};
  const textCap = c.text > 0 ? c.text : TEXT_CAP;
  const quoteCap = c.quote > 0 ? c.quote : QUOTE_CAP;
  const full = String(text == null ? "" : text);
  const q = quote ? String(quote).slice(0, quoteCap) : null;
  if (full.length <= textCap) return { text: full, quote: q };

  let end = textCap;
  if (q) {
    const at = full.indexOf(q);
    if (at >= 0) end = Math.max(end, at + q.length);
  }
  return { text: full.slice(0, end), quote: q };
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
