/* How `text` and `quote` relate to each other, and nothing else about them.
 *
 *     node tools/rumor_field_shape.mjs
 *
 * WHY THIS EXISTS
 *
 * The Rumors tab now prints a rumor the way hoopshype.com/rumors prints one:
 * the lead of the entry is the link, and the rest of the quotation runs on
 * after it in plain type. Finding that lead means knowing which of the two
 * fields is the shorter one - whether `quote` starts with `text`, or `text`
 * starts with `quote`, or neither.
 *
 * js/cards.js does not assume. rumorLead() tests both directions and returns
 * null when neither holds, in which case the card falls back to linking only
 * the outlet. That fallback is correct but invisible: a card with no lead looks
 * exactly like a card whose lead was not found. So this counts how often the
 * shipped function actually finds one.
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
const rumorLead = win.DoomCards.rumorLead;

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
let qStartsWithT = 0, tStartsWithQ = 0, qHoldsTLater = 0, tHoldsQLater = 0, disjoint = 0;
let endsEllipsis = 0, leads = 0, leadLen = [], restLen = [];

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
  else if (q.indexOf(t) === 0) qStartsWithT++;
  else if (t.indexOf(q) === 0) tStartsWithQ++;
  else if (q.indexOf(t) > 0) qHoldsTLater++;
  else if (t.indexOf(q) > 0) tHoldsQLater++;
  else disjoint++;

  const got = rumorLead(e.text, e.quote);
  if (got) { leads++; leadLen.push(got.lead.length); restLen.push(got.rest.trim().length); }
}

line("  entries     " + n);
line("  no text     " + noText);
line("  no quote    " + noQuote + "  (these can never have a lead - one field only)");
line("");
line("  TEXT LENGTH   " + stat(tLen));
line("  QUOTE LENGTH  " + stat(qLen));
line("  text ending in an ellipsis: " + endsEllipsis);
line("");
line("  HOW THE TWO FIELDS RELATE   (of the " + qLen.length + " entries carrying both)");
line("    identical                     " + identical);
line("    quote starts with text        " + qStartsWithT + "   <- text is the lead");
line("    text starts with quote        " + tStartsWithQ + "   <- quote is the lead");
line("    quote holds text, not at 0    " + qHoldsTLater);
line("    text holds quote, not at 0    " + tHoldsQLater);
line("    neither contains the other    " + disjoint);
line("");
line("  WHAT THE SHIPPED FUNCTION FINDS");
line("    entries that get a linked lead   " + leads + " of " + n +
     "   (" + Math.round((leads / Math.max(1, n)) * 100) + "%)");
line("    lead length                      " + stat(leadLen));
line("    remainder length                 " + stat(restLen));
line("");
if (!leads) {
  line("  NO LEAD WAS FOUND ANYWHERE. Every card will fall back to linking only");
  line("  the outlet, which is correct but is not what the rumors page does. The");
  line("  two fields are not two lengths of one passage, so the split has to come");
  line("  from somewhere else - most likely a field the Worker is not sending.");
  line("");
}
line("  Counts and character lengths only. No rumor text, quote, outlet or URL");
line("  was printed. Safe to paste back in full.");
line("");
