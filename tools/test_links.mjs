/* Are the feed's outbound destinations still what they claim to be?
 *
 *     node tools/test_links.mjs              coverage only, no network
 *     node tools/test_links.mjs --probe      fetch each and report what it is
 *     node tools/test_links.mjs --record     write those observations in
 *     node tools/test_links.mjs --check      verify against what was recorded
 *
 * WHY A STATUS CODE IS NOT A LINK CHECK
 *
 * A 200 proves a server answered. It does not prove it answered with the right
 * thing. A parked domain returns 200. A tool that has been renamed returns 200
 * from its homepage after a redirect, so /compare?p1=..&p2=.. quietly becomes
 * the front page and every VS card lands somewhere useless while a status
 * checker reports perfect health. An API that changed shape returns 200 with
 * different JSON. A login wall returns 200.
 *
 * So each destination records what it IS - where the request finally landed,
 * what type came back, the page title, the top-level keys of a JSON body - and
 * a later run fails when any of that changes.
 *
 * THE EXPECTATIONS COME FROM REALITY, NOT FROM ME
 *
 * Guessing that hoopsmatic.com/compare contains the word "compare" is how a
 * test ends up asserting something that was never true. --probe reports what
 * each destination actually returns; --record writes that in. Only then does
 * --check mean anything.
 *
 * THE COVERAGE CHECK NEEDS NO NETWORK and runs every time: it scans the app's
 * own source for outbound URLs and fails if one is missing from the registry.
 * That is what stops the registry drifting out of date the first time somebody
 * adds a link, which is the usual fate of a file like this.
 *
 * The archive API is probed for SHAPE only. Its responses carry rumor records,
 * and this file is in a public repo.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REG = path.join(REPO, "data/links.json");
/* Observations live in their own file, NOT in the registry.
 *
 * They shared one file to begin with, and the first --record run rewrote it -
 * so the next patch to the registry would not apply, because the thing being
 * patched had been machine-edited underneath. A file that is both hand-written
 * and tool-written can be neither reliably. data/links.json is now only ever
 * edited by a person; this is only ever written by --record. */
const BASE = path.join(REPO, "data/link-baseline.json");

const argv = process.argv.slice(2);
const PROBE = argv.includes("--probe");
const RECORD = argv.includes("--record");
const CHECK = argv.includes("--check");
const NETWORK = PROBE || RECORD || CHECK;

const registry = JSON.parse(fs.readFileSync(REG, "utf8"));
const links = registry.links || [];
let baseline = {};
try { baseline = JSON.parse(fs.readFileSync(BASE, "utf8")).observed || {}; } catch (e) { /* not recorded yet */ }

/* ---------------- coverage: no network, always runs ---------------- */

/* Only the app's own source. js/vendor is third-party and its URLs are
 * licence headers and issue links, not destinations this feed sends anyone
 * to. */
function sourceFiles() {
  const out = [path.join(REPO, "index.html")];
  for (const f of fs.readdirSync(path.join(REPO, "js"))) {
    if (f.endsWith(".js")) out.push(path.join(REPO, "js", f));
  }
  out.push(path.join(REPO, "data/buzz-sources.json"));
  return out;
}

/* Compared at origin + first path segment. Finer than that and every deep
 * link in the code would need its own registry row; coarser and a whole tool
 * could move without anyone noticing. */
function key(u) {
  try {
    const url = new URL(u);
    const seg = url.pathname.split("/").filter(Boolean)[0] || "";
    return url.origin + (seg ? "/" + seg : "");
  } catch (e) { return null; }
}

const registered = new Set(links.map(l => key(l.url)).filter(Boolean));
const registeredOrigins = new Set(links.map(l => { try { return new URL(l.url).origin; } catch (e) { return null; } }).filter(Boolean));

/* A bare origin in the source - a preconnect, a base string a path is
 * appended to - is covered by any registry entry on that origin. Requiring an
 * exact origin+segment match there reported five gaps that were not gaps, and
 * a check that cries wolf gets switched off. A source URL that DOES carry a
 * path still needs its own row, so two different tools on one host cannot
 * hide behind each other. */
function covered(k) {
  if (registered.has(k)) return true;
  return !k.includes("/", 8) && registeredOrigins.has(k);
}
const found = new Map();                       // key -> files that mention it
for (const file of sourceFiles()) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { continue; }
  for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&*+,;=%-]+/g)) {
    const k = key(m[0].replace(/[",'`)\]]+$/, ""));
    if (!k) continue;
    if (!found.has(k)) found.set(k, new Set());
    found.get(k).add(path.relative(REPO, file));
  }
}

const missing = [...found.keys()].filter(k => !covered(k));
const foundOrigins = new Set([...found.keys()].map(k => k.split("/").slice(0, 3).join("/")));
const unused = [...registered].filter(k => !found.has(k) &&
  !foundOrigins.has(k.split("/").slice(0, 3).join("/")));

console.log(`  registry: ${links.length} destinations`);
console.log(`  source:   ${found.size} distinct origins across ${sourceFiles().length} files`);
if (missing.length) {
  console.log(`\n  ${missing.length} IN THE CODE BUT NOT IN THE REGISTRY:`);
  for (const k of missing) console.log(`    ${k}   (${[...found.get(k)].join(", ")})`);
} else {
  console.log("  every outbound destination in the source is registered");
}
if (unused.length) {
  console.log(`\n  ${unused.length} registered but not found in the source (fine if only used by a builder):`);
  for (const k of unused) console.log(`    ${k}`);
}

if (!NETWORK) {
  console.log("\n  no network used. --probe to see what each destination returns.");
  process.exit(missing.length ? 1 : 0);
}

/* ---------------- what a response actually is ---------------- */

const TIMEOUT = 12000;

async function observe(link) {
  const started = Date.now();
  let res;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT);
    res = await fetch(link.url, { redirect: "follow", signal: ctl.signal });
    clearTimeout(t);
  } catch (e) {
    return { error: e.name === "AbortError" ? `no answer in ${TIMEOUT}ms` : e.message };
  }
  const o = {
    status: res.status,
    /* Where it LANDED. A redirect from a deep link to a homepage is the
     * failure a status check cannot see. */
    final: res.url && res.url !== link.url ? res.url : null,
    type: (res.headers.get("content-type") || "").split(";")[0].trim(),
    ms: Date.now() - started
  };
  let body = "";
  try { body = await res.text(); } catch (e) { o.error = "body unreadable"; return o; }
  o.bytes = body.length;

  if (/json/.test(o.type) || link.kind === "json") {
    try {
      const j = JSON.parse(body);
      /* Keys, never values. The archive API answers with rumor records and
       * this file is public. */
      o.shape = Array.isArray(j)
        ? `array[${j.length}] of ${j[0] && typeof j[0] === "object" ? Object.keys(j[0]).slice(0, 8).join(",") : typeof (j[0])}`
        : Object.keys(j).slice(0, 10).join(",");
    } catch (e) { o.shape = "NOT JSON"; }
  } else if (/html/.test(o.type)) {
    const m = /<title[^>]*>([\s\S]{0,120}?)<\/title>/i.exec(body);
    o.title = m ? m[1].replace(/\s+/g, " ").trim() : "(no title)";
  } else if (/^image\//.test(o.type)) {
    o.title = o.type;
  } else if (/css/.test(o.type)) {
    o.title = /@font-face/.test(body) ? "stylesheet with @font-face" : "stylesheet";
  } else if (/xml/.test(o.type)) {
    const m = /<title[^>]*>([\s\S]{0,80}?)<\/title>/i.exec(body);
    o.title = m ? m[1].replace(/\s+/g, " ").trim() : "(xml, no title)";
  }
  return o;
}

/* What counts as "the same destination" on a later run. Bytes and timing are
 * deliberately excluded: a page that gains a paragraph has not moved. */
function identity(o) {
  return {
    status: o.status,
    type: o.type,
    redirected_to: o.final || null,
    title: o.title || null,
    shape: o.shape || null
  };
}

/* Only an ABSENT field is skipped, never a null one.
 *
 * Skipping nulls looked reasonable and quietly disabled the most important
 * check in the tool: a healthy deep link records redirected_to: null, so when
 * it later starts redirecting to a homepage the comparison skipped the very
 * field that says so. The whole reason this is not a status checker is that a
 * deep link can 200 from the wrong page - and that was the case it could not
 * see. null here means "it did not redirect", which is a fact worth holding
 * to, not a gap in what was recorded. */
function differences(want, got) {
  const out = [];
  for (const k of Object.keys(want)) {
    if (want[k] === undefined) continue;
    const a = want[k] === null ? null : String(want[k]);
    const b = got[k] === null || got[k] === undefined ? null : String(got[k]);
    if (a !== b) out.push(`${k}: expected ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k] ?? null)}`);
  }
  return out;
}

/* Some assets are named in a manifest rather than in this repo, so the
 * registry cannot hold a URL for them: a guessed headshot filename 404'd and
 * the failure was the registry's, not the site's. An entry with `sample_from`
 * builds its URL here instead - fetch the named entry, walk to the path, take
 * the first key, append it. That checks a file the app would genuinely ask
 * for. */
async function resolveSamples() {
  const byId = new Map(links.map(l => [l.id, l]));
  for (const link of links) {
    const sf = link.sample_from;
    if (!sf) continue;
    const source = byId.get(sf.link);
    if (!source) { link._sampleError = `no entry called ${sf.link}`; continue; }
    try {
      const res = await fetch(source.url);
      const j = await res.json();
      const node = sf.path ? sf.path.split(".").reduce((o, k) => (o || {})[k], j) : j;
      let first = Array.isArray(node) ? node[0] : (node && Object.values(node)[0]);
      /* A manifest is rarely a bare list of filenames. players[] holds objects
       * with the name at headshot.filename, so taking the first entry gave an
       * object and the sampler reported a failure that was its own. */
      if (first && typeof first === "object" && sf.item_path) {
        first = sf.item_path.split(".").reduce((o, k) => (o || {})[k], first);
      }
      if (typeof first !== "string") {
        link._sampleError = `no filename at ${sf.path}${sf.item_path ? "[0]." + sf.item_path : ""}` +
          ` (got ${first === undefined ? "nothing" : typeof first})`;
        continue;
      }
      link.url = link.url.replace(/\/?$/, "/") + first;
      link._sampled = first;
    } catch (e) { link._sampleError = e.message; }
  }
}
await resolveSamples();

console.log(`\n  ${PROBE ? "probing" : RECORD ? "recording" : "checking"} ${links.length} destinations...\n`);

let bad = 0, changed = 0;
for (const link of links) {
  /* Registered for coverage, deliberately not fetched - see probe_false_note.
   * A preconnect host serving hashed font paths has nothing a test could
   * assert that would not be invented. */
  if (link.probe === false) {
    console.log(`  --   ${link.id.padEnd(22)} registered, not probed (${link.kind})`);
    continue;
  }
  if (link._sampleError) {
    console.log(`  FAIL ${link.id.padEnd(22)} could not take a sample filename: ${link._sampleError}`);
    bad++;
    continue;
  }
  const o = await observe(link);
  const label = link.id.padEnd(22);
  if (o.error) {
    console.log(`  FAIL ${label} ${o.error}`);
    bad++;
    continue;
  }
  const desc = [
    o.status,
    o.type || "?",
    o.title ? `"${o.title.slice(0, 46)}"` : "",
    o.shape ? `{${o.shape.slice(0, 60)}}` : "",
    o.final ? `-> ${o.final.slice(0, 60)}` : "",
    `${o.ms}ms`
  ].filter(Boolean).join("  ");

  if (o.status >= 400) { console.log(`  FAIL ${label} ${desc}`); bad++; continue; }

  if (CHECK && baseline[link.id]) {
    const diff = differences(baseline[link.id], identity(o));
    if (diff.length) {
      console.log(`  CHANGED ${label}`);
      diff.forEach(d => console.log(`         ${d}`));
      changed++;
    } else {
      console.log(`  ok   ${label} ${desc}`);
    }
  } else {
    console.log(`  ${CHECK && !baseline[link.id] ? "NEW " : "ok  "} ${label} ${desc}`);
    if (CHECK && !baseline[link.id]) changed++;
  }
  if (RECORD) baseline[link.id] = identity(o);
}

if (RECORD) {
  fs.writeFileSync(BASE, JSON.stringify({
    note: "What each destination returned when it was last recorded. Written by tools/test_links.mjs --record, never by hand — data/links.json is the hand-written half. `--check` fails when a destination stops matching what is here.",
    recorded_at: new Date().toISOString(),
    observed: baseline
  }, null, 2) + "\n");
  console.log(`\n  wrote observations into ${path.relative(REPO, BASE)}. --check now means something.`);
}

console.log("");
if (bad) console.log(`  ${bad} unreachable or erroring`);
if (changed) console.log(`  ${changed} changed since they were recorded${CHECK ? " — read them before re-recording" : ""}`);
if (!bad && !changed) console.log("  every destination is reachable and unchanged");
process.exit(bad || changed || missing.length ? 1 : 0);
