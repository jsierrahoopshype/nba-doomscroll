/* How `text` and `quote` relate to each other, and nothing else about them.
 *
 *     node tools/rumor_field_shape.mjs
 *
 * WHY THIS EXISTS
 *
 * The Rumors tab now prints a rumor the way hoopshype.com/rumors prints one:
 * one SPAN of the entry carries the link - often starting partway in, with
 * plain text on both sides - and the passage runs on around it. Finding that
 * span means locating the shorter of the two fields inside the longer one.
 *
 * js/cards.js does not assume which field is which, or that the span starts at
 * the beginning. rumorSpan() returns null when the shorter field is not in the
 * longer one at all, in which case the card falls back to linking only the
 * outlet. That fallback is correct but INVISIBLE: a card with no span looks
 * exactly like a card whose span was not found. So this counts how often the
 * shipped function actually finds one, and where in the passage it lands.
 *
 * WHAT IT PRINTS, AND WHAT IT REFUSES TO
 *
 * COUNTS AND LENGTHS ONLY. No rumor text, no quote, no reporter, no outlet, no
 * URL, at any verbosity, including on the error paths. Every number below is
 * either a tally of entries or a character count - the archive content rule
 * holds inside this file as strictly as it does outside it, and the whole point
 * of asking the question this way is that the answer can be pasted back into a
 * chat without any of it coming along.
 *
 * It calls /api/rumors/latest - the most recent hundred entries, a few hundred
 * KB - and nothing else. The part files are never touched.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const line = s => console.log(s);

/* The shipped function, not a copy. js/cards.js is a browser IIFE, so it is run
 * against a bare window the same way tools/test_yt_video.mjs runs yt-video.js. */
const win = {};
new Function("window", fs.readFileSync(path.join(ROOT, "js/cards.js"), "utf8"))(win);
const rumorSpan = win.DoomCards.rumorSpan;

/* ---------------- the endpoint, from the one place that knows it ---------- */

function findLink(id, node) {
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findLink(id, n); if (hit) return hit; }
    return null;
  }
  if (node && typeof node === "object") {
    if (node.id === id && node.url) return node;
    for (const v of Object.values(node)) { const hit = findLink(id, v); if (hit) return hit; }
  }
  return null;
}
const links = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "links.json"), "utf8"));
const link = findLink("rumors-api", links);
if (!link) {
  console.error("\n  No `rumors-api` entry in data/links.json. Nothing to call.\n");
  process.exit(1);
}

const base = link.url.replace(/\/index\/?$/, "");
const url = base + "/latest";

line("");
line("  GET " + url);
line("  with the Origin and Referer registered in data/links.json");
line("  " + "-".repeat(66));

const res = await fetch(url, { headers: link.headers || {} });
if (!res.ok) {
  const why = await res.text();
  line("  status      " + res.status + " " + res.statusText);
  /* A refusal is the server explaining itself, not archive content. */
  line("  body        " + why.slice(0, 200));
  line("");
  line("  Unauthorized means the Origin/Referer pair in data/links.json no");
  line("  longer matches the Worker's allowlist.");
  line("");
  process.exit(1);
}

let rows;
try { rows = await res.json(); }
catch (e) { line("  body is not JSON. Nothing further shown."); process.exit(1); }
if (!Array.isArray(rows)) {
  line("  expected an array, got " + (rows && typeof rows === "object"
    ? "an object with keys: " + Object.keys(rows).join(", ") : typeof rows));
  process.exit(1);
}

/* ---------------- measure ---------------- */

const stat = (ns) => {
  if (!ns.length) return "none";
  const s = ns.slice().sort((a, b) => a - b);
  return "min " + s[0] + "   median " + s[Math.floor(s.length / 2)] + "   max " + s[s.length - 1];
};

const norm = s => String(s == null ? "" : s).trim();
const tLen = [], qLen = [];
let n = 0, noText = 0, noQuote = 0, identical = 0;
let contains = 0, disjoint = 0;
let endsEllipsis = 0, spans = 0, spanLen = [], beforeLen = [], afterLen = [];
let atStart = 0, inMiddle = 0, atEnd = 0;

for (const e of rows) {
  if (!e) continue;
  n++;
  const t = norm(e.text), q = norm(e.quote);
  if (!t) { noText++; continue; }
  tLen.push(t.length);
  if (/(\.\.\.|…)$/.test(t)) endsEllipsis++;
  if (!q) { noQuote++; continue; }
  qLen.push(q.length);

  if (t === q) identical++;
  else if (q.indexOf(t) >= 0 || t.indexOf(q) >= 0) contains++;
  else disjoint++;

  /* The shipped function, which also tolerates the typography the two fields
   * disagree on - so it can find spans a plain indexOf above misses. */
  const got = rumorSpan(e.text, e.quote);
  if (got) {
    spans++;
    spanLen.push(got.link.length);
    beforeLen.push(got.before.length);
    afterLen.push(got.after.length);
    if (!got.before.trim()) atStart++;
    else if (!got.after.trim()) atEnd++;
    else inMiddle++;
  }
}

line("  entries     " + n);
line("  no text     " + noText);
line("  no quote    " + noQuote + "  (these can never have a span - one field only)");
line("");
line("  TEXT LENGTH   " + stat(tLen));
line("  QUOTE LENGTH  " + stat(qLen));
line("  text ending in an ellipsis: " + endsEllipsis);
line("");
line("  HOW THE TWO FIELDS RELATE   (of the " + qLen.length + " entries carrying both)");
line("    identical                     " + identical);
line("    one holds the other verbatim  " + contains);
line("    neither holds the other       " + disjoint + "   (some of these the");
line("                                  normalising match below still recovers)");
line("");
line("  WHAT THE SHIPPED FUNCTION FINDS");
line("    entries that get a linked span   " + spans + " of " + n +
     "   (" + Math.round((spans / Math.max(1, n)) * 100) + "%)");
line("    span length                      " + stat(spanLen));
line("    text before the span             " + stat(beforeLen));
line("    text after the span              " + stat(afterLen));
line("");
line("  WHERE THE SPAN SITS");
line("    at the start                     " + atStart);
line("    partway in, text on both sides   " + inMiddle);
line("    running to the end               " + atEnd);
line("");
if (!spans) {
  line("  NO SPAN WAS FOUND ANYWHERE. Every card falls back to linking only the");
  line("  outlet, which is correct but is not what the rumors page does. The two");
  line("  fields are not one passage and an excerpt of it, so the split has to");
  line("  come from somewhere else - most likely a field the Worker is not");
  line("  sending at all.");
  line("");
}
line("  Counts and character lengths only. No rumor text, quote, outlet or URL");
line("  was printed. Safe to paste back in full.");
line("");
