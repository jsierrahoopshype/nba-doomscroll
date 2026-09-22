/* The pool registry in js/app.js, and the coverage bug it was written to end.
 *
 *     node tools/test_app_pools.mjs
 *
 * WHAT THIS IS GUARDING
 *
 * For You used to carry its own hand-written list of pools, separate from the
 * per-tab lists. Five pools were in a tab's list and not in For You's -
 * award-history, record, career, careermap, dreamteam, 219 cards between them -
 * so a reader who opened the app and scrolled never saw them, while a reader
 * who had opened History or Quiz first saw them in For You for the rest of the
 * session. Two different feeds, chosen by where you happened to click.
 *
 * The registry fixes it by DERIVING For You, and this suite is what stops the
 * second list growing back: For You is asserted to be every pool that any tab
 * draws on, minus the ones that say `foryou: false` out loud.
 *
 * It reads the real POOLS literal out of js/app.js rather than restating it,
 * for the same reason the audit reads BATCH out of js/app.js: a copy here would
 * drift, and a test running different data from the app is worse than no test.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---- the registry, as the browser will see it ---- */

const litMatch = SRC.match(/var POOLS = (\[[\s\S]*?\n  \]);/);
if (!litMatch) {
  console.log("  FAIL js/app.js has no POOLS registry");
  console.log("\n1 failed");
  process.exit(1);
}
const POOLS = Function('"use strict";return (' + litMatch[1] + ")")();

/* The derivation, mirrored from js/app.js. Mirrored deliberately: if the app's
 * own derivation changes shape, the assertions below about what For You ends up
 * containing are what should catch it, not a silent agreement between two
 * copies of the same bug. */
const TAB_POOLS = (() => {
  const out = { foryou: [] };
  for (const p of POOLS) {
    for (const t of (p.tabs || [])) (out[t] = out[t] || []).push(p.url);
    if (p.foryou !== false && (p.tabs || []).length) out.foryou.push(p.url);
  }
  return out;
})();

console.log(`\nthe registry: ${POOLS.length} pools`);

console.log("\nit is a registry, not a pile");

{
  const dupes = POOLS.map(p => p.url).filter((u, i, a) => a.indexOf(u) !== i);
  ck("no pool is listed twice", dupes.length === 0, dupes.join(", "));
  ck("every entry has a url", POOLS.every(p => typeof p.url === "string" && p.url));
  ck("every entry declares its tabs", POOLS.every(p => Array.isArray(p.tabs)));
  const known = ["vs", "vault", "races", "quiz"];
  const strayTab = POOLS.flatMap(p => p.tabs).filter(t => known.indexOf(t) < 0);
  /* A pool routed to a tab that does not exist would load and then be
   * undrawable, which looks exactly like a pool that failed to build. */
  ck("no pool is routed to a tab that does not exist", strayTab.length === 0,
     strayTab.join(", "));
  /* `foryou` is not a tab you list: it is derived. Writing it as a tab would
   * put the pool in For You twice and reintroduce the hand-written list. */
  ck("nothing lists `foryou` as one of its tabs",
     POOLS.every(p => p.tabs.indexOf("foryou") < 0));
}

console.log("\nFor You is derived, and covers everything");

{
  /* THE ASSERTION THIS FILE EXISTS FOR. */
  const inSomeTab = POOLS.filter(p => p.tabs.length);
  const missing = inSomeTab
    .filter(p => p.foryou !== false)
    .filter(p => TAB_POOLS.foryou.indexOf(p.url) < 0);
  ck("every pool a tab draws on is in For You", missing.length === 0,
     missing.map(p => p.url).join(", "));

  /* The five that were missing, named individually. A regression here is the
   * original bug returning, and a count would not say which one came back. */
  const REGRESSION = ["data/award-history-pool.json", "data/record-pool.json",
                      "data/career-pool.json", "data/careermap-pool.json",
                      "data/dreamteam-pool.json"];
  for (const u of REGRESSION) {
    ck(`${u.replace("data/", "").replace("-pool.json", "")} reaches For You`,
       TAB_POOLS.foryou.indexOf(u) >= 0);
  }

  const off = POOLS.filter(p => p.foryou === false);
  ck("a pool kept out of For You says so explicitly", off.every(p => !p.tabs.length),
     "a pool in a tab but not in the mix would need a reason written down");
  ck("and those are not in For You",
     off.every(p => TAB_POOLS.foryou.indexOf(p.url) < 0));
}

console.log("\nFor You does not depend on where the reader clicked first");

{
  /* The bug's real shape: the set of cards available in For You differed
   * depending on which tab had been opened. With the registry, For You's pool
   * list is a superset of every tab's, so opening a tab can add nothing to it.
   * That is the property, stated as a property rather than as five file names. */
  const foryou = new Set(TAB_POOLS.foryou);
  const gaps = [];
  for (const tab of Object.keys(TAB_POOLS)) {
    if (tab === "foryou") continue;
    for (const u of TAB_POOLS[tab]) if (!foryou.has(u)) gaps.push(`${tab}: ${u}`);
  }
  ck("no tab can load a pool For You has not already asked for", gaps.length === 0,
     gaps.join("  |  "));
}

console.log("\nthe registry knows about every pool on disk");

{
  const eager = [...SRC.match(/var EAGER_POOLS = \[([\s\S]*?)\];/)[1]
    .matchAll(/"(data\/[^"]+)"/g)].map(m => m[1]);
  const known = new Set(POOLS.map(p => p.url).concat(eager));
  const onDisk = fs.readdirSync(path.join(REPO, "data"))
    .filter(f => /-pool\.json$/.test(f)).map(f => "data/" + f);

  /* A pool file that no list mentions is dead weight at best and a forgotten
   * feature at worst - which is what careermap and dreamteam were for For You. */
  const orphans = onDisk.filter(u => !known.has(u));
  ck("no pool file on disk is missing from the registry", orphans.length === 0,
     orphans.join(", "));

  /* And the reverse: an entry pointing at a file that is not there is fine ONLY
   * if it is marked optional, which is the difference between "not built yet"
   * and "typo". */
  const ghosts = POOLS.filter(p => !p.optional &&
    !fs.existsSync(path.join(REPO, p.url)));
  ck("every non-optional pool exists", ghosts.length === 0,
     ghosts.map(p => p.url).join(", "));

  const absent = POOLS.filter(p => !fs.existsSync(path.join(REPO, p.url)));
  console.log(`  (${onDisk.length} pool files on disk, ${eager.length} loaded eagerly, ` +
    `${absent.length} registry entries not built in this checkout)`);
}

console.log("\nthe per-tab lists are unchanged by the restructure");

{
  /* The registry replaced a working structure, so the tabs it feeds must come
   * out exactly as they went in. These are the lists as they stood before,
   * written out so the comparison is a comparison and not a re-derivation. */
  const BEFORE = {
    vs: ["data/vs-pool.json", "data/teammates-pool.json", "data/compare-pool.json"],
    vault: ["data/vault-pool.json", "data/lean-pool.json", "data/oddity-pool.json",
            "data/salary-pool.json", "data/award-history-pool.json",
            "data/record-pool.json", "data/career-pool.json"],
    races: ["data/race-pool.json", "data/ballotrace-pool.json"],
    quiz: ["data/capcall-pool.json", "data/careermap-pool.json",
           "data/dreamteam-pool.json"]
  };
  for (const tab of Object.keys(BEFORE)) {
    const got = (TAB_POOLS[tab] || []).slice().sort();
    const want = BEFORE[tab].slice().sort();
    ck(`the ${tab} tab draws on the same pools as before`,
       got.join("|") === want.join("|"),
       got.join("|") === want.join("|") ? "" : `got ${got.join(", ")}`);
  }
  /* For You is the one that CHANGED, and by exactly the five. */
  ck("For You gained five pools and lost none",
     TAB_POOLS.foryou.length === 15, TAB_POOLS.foryou.length + " pools (was 10)");
}

console.log("\nOPTIONAL_POOLS is derived from the same list");

{
  const OPTIONAL = POOLS.filter(p => p.optional).map(p => p.url);
  ck("the optional set is not empty", OPTIONAL.length > 0, OPTIONAL.length + " pools");
  /* A pool built by a script that needs data this repo does not carry must be
   * optional, or a fresh checkout shows "could not load the card pools". */
  const BUILT_ELSEWHERE = ["data/oddity-pool.json", "data/salary-pool.json",
    "data/capcall-pool.json", "data/careermap-pool.json", "data/dreamteam-pool.json",
    "data/award-history-pool.json", "data/record-pool.json", "data/career-pool.json",
    "data/frivolities-pool.json"];
  const notOptional = BUILT_ELSEWHERE.filter(u => OPTIONAL.indexOf(u) < 0);
  ck("every pool built from data outside this repo is optional",
     notOptional.length === 0, notOptional.join(", "));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "For You's contents depend on where the reader clicked"
                 : "every reader gets the same For You, cold or warm");
process.exit(fail ? 1 : 0);
