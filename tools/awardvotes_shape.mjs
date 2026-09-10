/* What is actually in awardVotes.json?
 *
 *     node tools/awardvotes_shape.mjs
 *     node tools/awardvotes_shape.mjs --local "C:\path\to\nba-player-data"
 *
 * WHY A PROBE AND NOT A GUESS
 *
 * The franchise-drought cards were built against the Media Vote Tracker, which
 * is individual voters' ballots over a recent window - so every claim had to
 * be hedged as "in the N seasons this tracker covers". Jorge pointed out that
 * nba-player-data carries the official voting results instead, which go back
 * decades and make "the first Clipper to get an MVP vote since 1993" a
 * sentence the data can support.
 *
 * Rebuilding on it needs three facts I do not have: what the year field is
 * called, whether a team travels with the row, and how far back it goes. Every
 * time this project has guessed at a field name it has cost a round trip, so
 * this asks the file.
 *
 * WHAT IT PRINTS, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Field names, row counts, the distinct AWARD labels, the year range per
 * award, and the shape of a value ("4 digits", "2023-24"). No player names, no
 * rows, nothing that is anybody's data - the same discipline as
 * tools/rumor_field_shape.mjs. Paste the whole output; there is nothing in it
 * that should not travel.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["awardVotes.json", "rsStats.json"]
});
if (!PD) process.exit(1);

const file = path.join(PD, "awardVotes.json");
let rows;
try { rows = JSON.parse(fs.readFileSync(file, "utf8")); }
catch (e) {
  console.error("\n  could not read " + file + "\n  " + e.message + "\n");
  process.exit(1);
}
if (!Array.isArray(rows) || !rows.length) {
  console.error("\n  awardVotes.json is not a non-empty array.\n");
  process.exit(1);
}

const line = s => console.log(s);

/* A value's SHAPE, never the value. "Nikola Jokic" is somebody's name; "text,
 * 12 chars" is a fact about the column. */
function shapeOf(v) {
  if (v == null) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  const s = String(v);
  if (/^\d{4}$/.test(s)) return "4 digits";
  if (/^\d{4}-\d{2}$/.test(s)) return "YYYY-NN";
  if (/^\d{4}-\d{4}$/.test(s)) return "YYYY-YYYY";
  if (/^\d+$/.test(s)) return s.length + "-digit number";
  if (/^\d+\.\d+$/.test(s)) return "decimal";
  if (/^[A-Z]{2,4}$/.test(s)) return "2-4 upper-case letters";
  return "text, " + s.length + " chars";
}

line("");
line("  " + file);
line("  " + rows.length.toLocaleString() + " rows");
line("  " + "-".repeat(66));

/* ---- the columns ---- */

const cols = new Map();          // name -> { present, shapes:Map, distinct:Set }
for (const r of rows) {
  for (const k of Object.keys(r)) {
    if (!cols.has(k)) cols.set(k, { present: 0, shapes: new Map(), distinct: new Set() });
    const c = cols.get(k);
    c.present++;
    const sh = shapeOf(r[k]);
    c.shapes.set(sh, (c.shapes.get(sh) || 0) + 1);
    /* Capped: a column with thousands of distinct values is a name column and
     * its cardinality is the only interesting thing about it. */
    if (c.distinct.size < 60) c.distinct.add(String(r[k]));
  }
}

line("");
line("  COLUMNS");
for (const [name, c] of [...cols.entries()].sort()) {
  const shapes = [...c.shapes.entries()].sort((a, b) => b[1] - a[1])
    .slice(0, 3).map(([s, n]) => `${s} x${n}`).join(", ");
  const card = c.distinct.size >= 60 ? "60+ distinct" : c.distinct.size + " distinct";
  line(`    ${name.padEnd(14)} in ${c.present}/${rows.length} rows   ${card}   ${shapes}`);
}

/* ---- the three questions the drought cards need answering ---- */

line("");
line("  IS THERE A TEAM ON THE ROW?");
const teamish = [...cols.keys()].filter(k => /team|tm|franchise/i.test(k));
if (!teamish.length) {
  line("    No column looks like a team. The cards will keep joining to rsStats");
  line("    for the franchise, which is what the current code already does.");
} else {
  for (const k of teamish) {
    const c = cols.get(k);
    line(`    ${k}: ${c.present}/${rows.length} rows, ` +
      (c.distinct.size >= 60 ? "60+ distinct" : [...c.distinct].sort().join(" ")));
  }
  line("    If that list looks like team codes, the join to rsStats can go -");
  line("    one source instead of two, and no traded-player ambiguity at all.");
}

line("");
line("  WHICH COLUMN IS THE SEASON, AND HOW FAR BACK?");
const yearish = [...cols.keys()].filter(k => /year|season|yr/i.test(k));
if (!yearish.length) {
  line("    Nothing looks like a year. Every column with a 4-digit shape:");
  for (const [name, c] of cols) {
    if (c.shapes.has("4 digits")) line("      " + name);
  }
} else {
  for (const k of yearish) {
    const nums = rows.map(r => parseInt(String(r[k]).slice(0, 4), 10)).filter(n => n > 1900 && n < 2100);
    if (!nums.length) { line(`    ${k}: no parseable years`); continue; }
    nums.sort((a, b) => a - b);
    const distinct = new Set(nums).size;
    line(`    ${k}: ${nums[0]} to ${nums[nums.length - 1]}, ${distinct} distinct seasons`);
  }
}

line("");
line("  WHICH AWARDS, AND OVER WHAT SPAN EACH?");
const awardCol = [...cols.keys()].find(k => /^award$/i.test(k)) ||
                 [...cols.keys()].find(k => /award/i.test(k));
const yearCol = yearish[0] || null;
if (!awardCol) {
  line("    No award column found, which would be surprising - check COLUMNS above.");
} else {
  const per = new Map();
  for (const r of rows) {
    const a = String(r[awardCol]);
    if (!per.has(a)) per.set(a, { n: 0, years: [] });
    const p = per.get(a);
    p.n++;
    if (yearCol) {
      const y = parseInt(String(r[yearCol]).slice(0, 4), 10);
      if (y > 1900 && y < 2100) p.years.push(y);
    }
  }
  for (const [a, p] of [...per.entries()].sort((x, y) => y[1].n - x[1].n)) {
    p.years.sort((x, y) => x - y);
    const span = p.years.length
      ? `${p.years[0]}-${p.years[p.years.length - 1]}, ${new Set(p.years).size} seasons`
      : "no years";
    line(`    ${a.padEnd(22)} ${String(p.n).padStart(6)} rows   ${span}`);
  }
}

/* ---- what a rank looks like, since the cards may want "top five" ---- */

const rankCol = [...cols.keys()].find(k => /^(rnk|rank)$/i.test(k));
line("");
line("  RANKS");
if (!rankCol) {
  line("    No rank column. Cards can only say a vote was received, not where");
  line("    the player finished.");
} else {
  const nums = rows.map(r => parseInt(r[rankCol], 10)).filter(n => isFinite(n));
  nums.sort((a, b) => a - b);
  const bad = rows.length - nums.length;
  line(`    ${rankCol}: ${nums[0]} to ${nums[nums.length - 1]}` +
    (bad ? `, ${bad} rows unparseable` : ", all rows parse"));
  const top = nums.filter(n => n <= 5).length;
  line(`    ${top} of ${nums.length} rows are a top-five finish`);
}

line("");
line("  Paste all of the above. It is field names and counts - no rows, no names.");
line("");
