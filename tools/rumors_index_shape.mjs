/* The shape of the rumors index, and nothing else in it.
 *
 *     node tools/rumors_index_shape.mjs
 *
 * Makes ONE request, to the URL and with the headers already registered in
 * data/links.json as `rumors-api`. That entry is the single source of truth for
 * both: the Worker allowlists Origin and Referer, which is why the same address
 * typed into a browser answers {"error":"Unauthorized"} - an address bar sends
 * neither.
 *
 * WHY THIS EXISTS RATHER THAN A CURL COMMAND
 *
 * The response carries archive records. The rule on those is absolute: never
 * read, parse, summarise or paste the actual rumor text, reporter quotes or
 * source attributions. Architecture, schema and field names are fine; content
 * is not.
 *
 * A raw fetch would put the content on screen and leave the rule to whoever is
 * reading. This prints STRUCTURE ONLY, enforced in code:
 *
 *   numbers and booleans   printed - part counts, sizes, totals
 *   short bare tokens      printed only if they look like a key, date or id
 *   everything else        replaced by its type and length
 *   arrays                 length, plus the KEYS of the first element
 *
 * So the output answers "how many parts, how big, what fields" and cannot
 * answer "what does it say".
 *
 * WHAT IT IS FOR
 *
 * The Rumors tab reads one endpoint and shows the same kind of card every time.
 * The plan is a daily cron building an on-this-day set into RUMORS_KV for the
 * endpoint to read, and sizing that job needs the part count and the per-part
 * size. That is all this is here to find out.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const argv = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const links = JSON.parse(fs.readFileSync(path.join(HERE, "..", "data", "links.json"), "utf8"));

/* links.json is a nested document; find the entry rather than assuming a path,
 * so a reshuffle of the file does not silently break this. */
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

const link = findLink("rumors-api", links);
if (!link) {
  console.error("\n  No `rumors-api` entry in data/links.json. Nothing to call.\n");
  process.exit(1);
}

/* A value is printable only if it cannot be prose. Numbers and booleans always;
 * strings only when short AND free of spaces, which a sentence never is. */
const SAFE_TOKEN = /^[A-Za-z0-9_:.\-+/]{1,40}$/;
function safe(v) {
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") {
    return SAFE_TOKEN.test(v) ? v : "<string, " + v.length + " chars, withheld>";
  }
  if (Array.isArray(v)) {
    const first = v[0];
    const keys = first && typeof first === "object" && !Array.isArray(first)
      ? "  first element keys: " + Object.keys(first).join(", ")
      : "";
    return "<array, " + v.length + " items>" + keys;
  }
  if (typeof v === "object") return "<object, keys: " + Object.keys(v).join(", ") + ">";
  return "<" + typeof v + ">";
}

const line = s => console.log(s);

line("");
line("  GET " + link.url);
line("  with the Origin and Referer registered in data/links.json");
line("  " + "-".repeat(66));

const res = await fetch(link.url, { headers: link.headers || {} });
const text = await res.text();

line("  status      " + res.status + " " + res.statusText);
line("  bytes       " + text.length.toLocaleString("en-US"));

if (!res.ok) {
  /* A refusal is the server explaining itself, not archive content. That text
   * is the whole diagnostic and is safe to show. */
  line("  body        " + text.slice(0, 300));
  line("");
  line("  Not authorised means the Origin/Referer pair in links.json no longer");
  line("  matches the Worker's allowlist. Check the Worker, not this script.");
  line("");
  process.exit(1);
}

let json;
try { json = JSON.parse(text); }
catch (e) { line("  body is not JSON. Nothing further shown."); process.exit(1); }

line("");
line("  TOP LEVEL");
for (const [k, v] of Object.entries(json)) line("    " + k.padEnd(20) + safe(v));

/* The parts list is the point of the exercise, so it gets counted properly -
 * still without printing anything a part contains. */
/* Declared here, not inside the block below, because the --parts section
 * further down reads it too. */
const partsKey =
  Object.keys(json).find(k => /(parts?|files)$/i.test(k) && Array.isArray(json[k]));
if (partsKey) {
  const parts = json[partsKey];
  line("");
  line("  " + partsKey.toUpperCase() + ": " + parts.length);
  const numericFields = new Map();
  for (const p of parts) {
    if (!p || typeof p !== "object") continue;
    for (const [k, v] of Object.entries(p)) {
      if (typeof v !== "number") continue;
      const acc = numericFields.get(k) || { n: 0, sum: 0, min: Infinity, max: -Infinity };
      acc.n++; acc.sum += v; acc.min = Math.min(acc.min, v); acc.max = Math.max(acc.max, v);
      numericFields.set(k, acc);
    }
  }
  for (const [k, a] of numericFields) {
    line("    " + k.padEnd(20) +
      "total " + a.sum.toLocaleString("en-US") +
      "   min " + a.min.toLocaleString("en-US") +
      "   max " + a.max.toLocaleString("en-US") +
      "   avg " + Math.round(a.sum / a.n).toLocaleString("en-US"));
  }
}

/* ---- how big is each part? ----
 *
 *     node tools/rumors_index_shape.mjs --parts
 *
 * The index names seven files and does not say how large they are, and size is
 * the number that decides the design: whether a cron can build an on-this-day
 * set in one invocation or has to walk the parts across several.
 *
 * HEAD first, because it costs nothing. If the Worker will not answer a HEAD,
 * or answers without a length, the body is streamed and its BYTES COUNTED AND
 * DISCARDED - never decoded, never parsed, never held. Nothing that arrives
 * here reaches the screen or memory as text.
 */
if (argv.includes("--parts")) {
  const names = Array.isArray(json[partsKey]) ? json[partsKey] : (json.files || []);
  if (!names.length) {
    line("");
    line("  --parts: the index names no files, so there is nothing to measure.");
  } else {
    const base = link.url.replace(/\/index\/?$/, "");
    line("");
    line("  PART SIZES  (" + names.length + " parts, HEAD where possible)");
    let total = 0, unknown = 0;
    for (let i = 0; i < names.length; i++) {
      const url = base + "/part/" + i;
      let bytes = null, how = "";
      try {
        const h = await fetch(url, { method: "HEAD", headers: link.headers || {} });
        const len = h.headers.get("content-length");
        if (h.ok && len) { bytes = parseInt(len, 10); how = "HEAD"; }
      } catch (e) { /* fall through to the stream */ }

      if (bytes === null) {
        try {
          const r = await fetch(url, { headers: link.headers || {} });
          if (!r.ok) { line("    part/" + i + "   HTTP " + r.status); unknown++; continue; }
          const len = r.headers.get("content-length");
          if (len) { bytes = parseInt(len, 10); how = "GET header"; }
          else {
            /* Counted and thrown away, one chunk at a time. The bytes are
             * never turned into text. */
            let n = 0;
            const reader = r.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              n += value.length;
            }
            bytes = n; how = "streamed and discarded";
          }
        } catch (e) {
          line("    part/" + i + "   unreachable: " + e.message);
          unknown++;
          continue;
        }
      }
      total += bytes;
      line("    part/" + i + "   " + (bytes / 1048576).toFixed(1).padStart(7) + " MB   (" + how + ")");
    }
    line("    " + "-".repeat(46));
    line("    total     " + (total / 1048576).toFixed(1).padStart(7) + " MB" +
      (unknown ? "   (" + unknown + " could not be measured)" : ""));
    line("    A Cloudflare Worker gets 128 MB of memory, so a part it cannot");
    line("    hold has to be streamed rather than JSON.parse'd whole.");
  }
} else {
  line("");
  line("  Add --parts to measure each file's size. It sends HEAD requests, and");
  line("  where that is refused it counts the bytes of the body and throws them");
  line("  away without decoding them.");
}

line("");
line("  Structure only. No rumor text, quote or attribution is read or printed.");
line("  Safe to paste back in full.");
line("");
