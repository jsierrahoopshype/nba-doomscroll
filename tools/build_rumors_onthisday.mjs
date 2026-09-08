/* Build the 366 on-this-day buckets for the Rumors tab.
 *
 *     node --max-old-space-size=4096 tools/build_rumors_onthisday.mjs
 *
 * Downloads about 435 MB ONCE, writes a wrangler bulk-put file, and uploads
 * nothing. A second command you run yourself puts it into KV.
 *
 * WHY NOT DO THIS IN THE WORKER
 *
 * "On this day" means finding every rumor stamped with today's month and day
 * across sixteen years - a scan of all 652,531 entries. They live in seven
 * files of 60 to 72 MB. A Cloudflare Worker has 128 MB of memory and JSON.parse
 * on a 65 MB file needs several times that, so the Worker cannot read one
 * whole, and streaming 435 MB on a daily cron would be slow, fragile, and
 * repeated forever for data that barely changes.
 *
 * So the expensive pass happens once, here, on a machine with real memory. The
 * daily job that keeps it current reads /api/rumors/latest - a hundred entries,
 * a few hundred KB - and files each into its own day. The big files are never
 * touched again.
 *
 * WHAT IT WRITES, AND WHAT IT REFUSES TO PRINT
 *
 * Output is one file: a wrangler bulk-put array of 366 {key, value} pairs,
 * key "otd:MM-DD". Everything printed to the screen is a COUNT. No rumor text,
 * quote, reporter or outlet is ever printed, at any verbosity, including in
 * error paths - the archive content rule holds inside this file as strictly as
 * it does outside it. The entries go from the network into the output file
 * without passing through the terminal.
 *
 * THE EDITORIAL FILTER RUNS HERE TOO
 *
 * js/rumors.js applies data/rumor-blocklist.json in the reader's browser. This
 * applies the same list on the way in, so a blocked topic has to get past two
 * independent passes to reach anyone. If the blocklist cannot be read this
 * REFUSES TO RUN rather than publishing an unfiltered year - failing closed is
 * the same choice the client makes.
 *
 * HOW MUCH OF AN ENTRY IS KEPT
 *
 * The card renders the passage with the excerpt inside it underlined and
 * linked, the way hoopshype.com/rumors does. That only works if the bucket
 * still holds both, so the caps live in lib/onthisday.mjs and a cut is never
 * allowed to land before the end of the excerpt. The first build used a flat
 * 280 characters on both fields and cost roughly a third of the cards their
 * link; see the comment on TEXT_CAP for the measurements that replaced it.
 *
 * HOW 30 GET CHOSEN FROM ~1,800
 *
 * Spread first, quality second. At most three from any one year, so a day is
 * sixteen years of the league rather than one busy afternoon in 2021, and
 * within that a score favouring entries that carry a real quote and name a
 * player. Ties break by recency.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isBlocked, score, pickForDay, forStorage, trim, TEXT_CAP, QUOTE_CAP } from "./lib/onthisday.mjs";

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const line = s => console.log(s);

const PER_DAY = parseInt(flag("--per-day") || "30", 10);
const PER_YEAR = parseInt(flag("--per-year") || "3", 10);
const OUT = flag("--out") || path.join(ROOT, "rumors-onthisday-kv.json");

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

/* ---------------- the blocklist, or nothing ---------------- */

let blocklist;
try {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "rumor-blocklist.json"), "utf8"));
  blocklist = {
    terms: (d.blocked_keywords || []).map(t => String(t).toLowerCase()),
    whole: new Set((d.whole_word_only || []).map(t => String(t).toLowerCase()))
  };
  if (!blocklist.terms.length && !blocklist.whole.size) throw new Error("empty");
} catch (e) {
  console.error("\n  data/rumor-blocklist.json is missing or empty, so the editorial");
  console.error("  filter would pass everything. Refusing to build an unfiltered year.\n");
  process.exit(1);
}

/* ---------------- fetch a part ---------------- */

async function getJson(url) {
  const res = await fetch(url, { headers: link.headers || {} });
  if (!res.ok) return { error: "HTTP " + res.status };
  try { return { json: await res.json() }; }
  catch (e) { return { error: "unparseable body" }; }
}

const base = link.url.replace(/\/index\/?$/, "");

line("");
line("  " + base);
line("  " + "-".repeat(66));

const idx = await getJson(base + "/index");
if (idx.error) {
  line("  index: " + idx.error);
  line("  If this says Unauthorized, the Origin/Referer pair in data/links.json");
  line("  no longer matches the Worker's allowlist.");
  line("");
  process.exit(1);
}
const numFiles = idx.json.num_files || (idx.json.files || []).length;
line("  " + numFiles + " parts, " + (idx.json.total_rumors || 0).toLocaleString("en-US") + " rumors");
line("  keeping " + PER_DAY + " per day, at most " + PER_YEAR + " from any one year");
line("  passages up to " + TEXT_CAP + " chars, excerpts up to " + QUOTE_CAP +
     " - a cut never lands before the end of the linked excerpt");
line("");

/* ---------------- scan ---------------- */

/* "MM-DD" -> array of kept entries. Bounded as it goes: the whole archive is
 * never held in memory, only one part at a time plus what survives. */
const byDay = new Map();
let seen = 0, blocked = 0, malformed = 0, partsRead = 0;

/* Parts are numbered from 1. part/0 answers 404, which is how we found out. */
for (let i = 1; i <= numFiles; i++) {
  const got = await getJson(base + "/part/" + i);
  if (got.error) {
    line("    part/" + i + "   " + got.error + "  - SKIPPED, this build is incomplete");
    continue;
  }
  const rows = Array.isArray(got.json) ? got.json : (got.json.rumors || got.json.entries || []);
  partsRead++;
  let kept = 0;
  for (const e of rows) {
    seen++;
    if (!e || !e.source_url || !e.text || !e.archive_date) { malformed++; continue; }
    const d = String(e.archive_date);
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) { malformed++; continue; }
    if (isBlocked(e, blocklist)) { blocked++; continue; }

    const day = m[2] + "-" + m[3];
    if (!byDay.has(day)) byDay.set(day, []);
    /* Cut by lib/onthisday.mjs, which knows not to cut the linked span off the
     * end of a passage. The first build cut both fields at a flat 280 and cost
     * a third of the cards their link. */
    const cut = trim(e.text, e.quote);
    byDay.get(day).push({
      year: parseInt(m[1], 10),
      date: d.slice(0, 10),
      text: cut.text,
      quote: cut.quote,
      outlet: e.outlet || "HoopsHype",
      url: e.source_url,
      tags: Array.isArray(e.tags) ? e.tags.slice(0, 4) : []
      /* Scored at selection time by lib/onthisday.mjs, not here - one
       * definition, and one that a test can reach. */
    });
    kept++;
  }
  line("    part/" + i + "   " + rows.length.toLocaleString("en-US") + " rows, " +
       kept.toLocaleString("en-US") + " kept");
}

if (!partsRead) {
  line("");
  line("  No part could be read. Nothing written.");
  line("");
  process.exit(1);
}

/* ---------------- select ---------------- */

const writes = [];
let thinnest = { day: null, n: Infinity }, fattest = { day: null, n: -1 };
let totalKept = 0, emptyDays = 0;

for (let mo = 1; mo <= 12; mo++) {
  for (let da = 1; da <= 31; da++) {
    const day = String(mo).padStart(2, "0") + "-" + String(da).padStart(2, "0");
    const list = byDay.get(day) || [];
    if (!list.length) { emptyDays++; continue; }
    const chosen = pickForDay(list, PER_DAY, PER_YEAR).map(forStorage);
    totalKept += chosen.length;
    if (chosen.length < thinnest.n) thinnest = { day, n: chosen.length };
    if (chosen.length > fattest.n) fattest = { day, n: chosen.length };
    writes.push({ key: "otd:" + day, value: JSON.stringify(chosen) });
  }
}

fs.writeFileSync(OUT, JSON.stringify(writes), "utf8");
const bytes = fs.statSync(OUT).size;

line("");
line("  " + "-".repeat(66));
line("  read        " + seen.toLocaleString("en-US") + " entries from " + partsRead + " of " + numFiles + " parts");
line("  blocked     " + blocked.toLocaleString("en-US") + "  (editorial list)");
line("  malformed   " + malformed.toLocaleString("en-US") + "  (no date, text or link)");
line("  days        " + writes.length + " written, " + emptyDays + " with nothing to show");
line("  kept        " + totalKept.toLocaleString("en-US") + " entries, " +
     (totalKept / Math.max(1, writes.length)).toFixed(1) + " per day on average");
line("  thinnest    " + thinnest.day + " with " + thinnest.n);
line("  fattest     " + fattest.day + " with " + fattest.n);
line("");
line("  wrote  " + OUT);
line("         " + (bytes / 1048576).toFixed(2) + " MB, " + writes.length + " keys");
line("         Nothing has been uploaded. Counts only above - no rumor text was");
line("         printed at any point.");
line("");
line("  To publish, from the rumors Worker's own folder:");
line("     wrangler kv bulk put \"" + OUT + "\" --binding RUMORS_KV --remote");
line("  or, if that Worker has no local wrangler.toml, with its namespace id");
line("  from the Cloudflare dashboard under Storage & Databases > KV:");
line("     wrangler kv bulk put \"" + OUT + "\" --namespace-id <id> --remote");
line("");
line("  One bulk call, not 366 - fewer API calls, and it either all lands or");
line("  none of it does.");
line("");
if (partsRead < numFiles) {
  line("  WARNING: " + (numFiles - partsRead) + " part(s) could not be read, so some");
  line("  days are thinner than they should be. Worth rerunning before publishing.");
  line("");
  process.exit(1);
}
