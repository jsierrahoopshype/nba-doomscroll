/* Which award labels in awardVotes.json look truncated.
 *
 * WHY THIS IS NOT A LIST OF THE RIGHT ANSWERS
 *
 * awardVotes.json spells one award "Sixth" for twelve rows in 2026. It is
 * "Sixth Man" with the second word lost, it splits that award's newest season
 * into a history of its own, and build_award_history.mjs normalises it and says
 * on every run that it "will recur" - which it will, because the fix belongs
 * upstream and nobody has been told WHICH twelve rows to look at.
 *
 * The obvious way to find them is a list of the seven correct labels. This file
 * deliberately does not hold one. build_award_history.mjs already has that
 * table, and a second copy of it would drift from the first the day an award is
 * added - the Clutch and Hustle awards both arrived inside the last four
 * seasons, so that is not hypothetical. A hard-coded list would also only ever
 * catch the truncation somebody already knew about.
 *
 * So the test is structural, and it is the shape the bug actually has: a label
 * whose words are the opening words of a longer label, covering far fewer
 * seasons than that longer one. "Sixth" against "Sixth Man" is caught because
 * it is a word-prefix on one season where the full form has forty-three, and
 * "Most" would be caught against "Most Improved" the same way. Two unrelated
 * awards never trip it, because neither is a prefix of the other.
 *
 * WHAT IT REFUSES TO GUESS
 *
 * It reports; it does not rewrite. The candidate correction is named as a
 * suggestion, and a label that is a prefix of TWO longer labels is reported
 * with both rather than resolved to either.
 */

/** Words of a label, lowercased. "Sixth Man" -> ["sixth","man"] */
function words(label) {
  return String(label || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

const isWordPrefix = (shortW, longW) =>
  shortW.length < longW.length && shortW.every((w, i) => w === longW[i]);

/**
 * @param {Array<{AWARD?:string, YEAR?:string|number}>} rows  awardVotes.json
 * @param {object} [opts]  { maxSeasons: a label covering more seasons than this
 *                           is never called truncated (default 3) }
 * @returns {{ labels: Array, suspects: Array }}
 *   labels:   [{ label, rows, seasons, from, to }] every label, most rows first
 *   suspects: [{ label, rows, seasons, from, to, likely:string[] }]
 */
export function auditAwardLabels(rows, opts) {
  const o = Object.assign({ maxSeasons: 3 }, opts || {});
  const byLabel = new Map();

  for (const r of (rows || [])) {
    const label = String((r && r.AWARD) || "").trim();
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, { label, rows: 0, years: new Set() });
    const e = byLabel.get(label);
    e.rows++;
    const y = parseInt(r && r.YEAR, 10);
    if (isFinite(y)) e.years.add(y);
  }

  const labels = [...byLabel.values()].map(e => {
    const ys = [...e.years].sort((a, b) => a - b);
    return { label: e.label, rows: e.rows, seasons: ys.length,
             from: ys[0] ?? null, to: ys[ys.length - 1] ?? null };
  }).sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label));

  const suspects = [];
  for (const cand of labels) {
    if (cand.seasons > o.maxSeasons) continue;      // an established award
    const candW = words(cand.label);
    const likely = labels
      .filter(other => other.label !== cand.label &&
                       other.seasons > cand.seasons &&
                       isWordPrefix(candW, words(other.label)))
      .map(other => other.label);
    if (likely.length) suspects.push(Object.assign({}, cand, { likely }));
  }

  return { labels, suspects };
}

/** The report, as lines. Empty array when there is nothing to report. */
export function awardLabelReport(audit) {
  if (!audit || !audit.suspects.length) return [];
  const out = [];
  for (const s of audit.suspects) {
    const span = s.seasons === 1 ? `${s.from}` : `${s.from}-${s.to}`;
    out.push(`"${s.label}": ${s.rows} rows, ${s.seasons} season${s.seasons === 1 ? "" : "s"} (${span})` +
      ` - looks like "${s.likely.join('" or "')}" with a word lost`);
  }
  return out;
}
