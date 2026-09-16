/* Reading a CSV the way these builders need it read.
 *
 * WHY A FILE FOR TWENTY LINES
 *
 * build_salary.mjs has had a private copy of this since it was written, and
 * build_records.mjs needs exactly the same thing: a game log with quoted team
 * names in it. Two copies of a parser drift, and the way they drift is that one
 * of them learns about escaped quotes and the other does not - so the second
 * one reads a row as three cells where the first read four, and nothing says
 * anything because both produced rows.
 *
 * NOTE FOR WHOEVER IS NEXT: build_salary.mjs still has its own copy. Pointing
 * it here is a two-line change and was deliberately not made in the same patch
 * as a new builder, because that file produces eighty-seven live cards and its
 * parser cannot be exercised without the source data.
 *
 * WHAT IT HANDLES
 *
 *   quoted cells containing commas     "Portland Trail Blazers, Inc"
 *   escaped quotes inside those        "he said ""no"""
 *   CRLF and LF, mixed                 a file edited on both platforms
 *   ragged rows                        a short row yields empty strings, not
 *                                      undefined, because a builder comparing
 *                                      row.pts_home to a number should get ""
 *                                      and not a crash
 *
 * What it does NOT handle is a newline inside a quoted cell. No file in this
 * pipeline has one, and pretending to support it with a line-based reader is
 * how a parser silently truncates a row.
 */

/** One CSV line into cells, respecting quotes. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  const s = String(line == null ? "" : line);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (q && s[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * A CSV's text into row objects keyed by its header.
 *
 * @param {string} text
 * @returns {Array<object>} one object per data row; [] for an empty file
 */
export function parseCsv(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const head = splitCsvLine(lines[0]);
  return lines.slice(1).map(l => {
    const cells = splitCsvLine(l), row = {};
    head.forEach((h, i) => { row[h] = cells[i] === undefined ? "" : cells[i]; });
    return row;
  });
}
