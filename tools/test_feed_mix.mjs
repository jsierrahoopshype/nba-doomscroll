/* How much of a batch is Buzz, and how much of it is a VS score card.
 *
 *     node tools/test_feed_mix.mjs
 *
 * Both of these are numbers a reader can feel but nobody can see. A share that
 * quietly drifts, or a quota backfilled with week-old posts, looks exactly like
 * a feed that is working - and the only way to notice is to count.
 *
 * TWO THINGS THIS PINS DOWN:
 *
 *   1. THE RESERVED BUZZ BLOCK IS CAPPED BY FRESH SUPPLY. A quiet news day must
 *      shrink the block, not fill it with stale posts. The old code took
 *      whatever the bucket held, and the bucket holds a week.
 *
 *   2. THE BAND HAS ENDS. A reader who loves Buzz cannot turn the feed into a
 *      news feed, and one who skips it cannot make it disappear.
 *
 * js/app.js cannot be loaded outside a browser, so the two functions under test
 * are re-derived here from the same constants the file declares - and the test
 * reads those constants OUT of js/app.js rather than restating them, so a
 * change to the numbers there fails here rather than passing silently against
 * a stale copy.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = fs.readFileSync(path.join(REPO, "js/app.js"), "utf8");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const num = (name) => {
  const m = new RegExp("var\\s+" + name + "\\s*=\\s*([0-9.]+)").exec(APP);
  return m ? parseFloat(m[1]) : NaN;
};

const BATCH = num("BATCH");
const BUZZ_SHARE = num("BUZZ_SHARE");
const BUZZ_MIN = num("BUZZ_MIN");
const BUZZ_MAX = num("BUZZ_MAX");

console.log("\nthe constants js/app.js actually declares");

{
  ck("BATCH is a real number", BATCH > 0, String(BATCH));
  ck("the base share is still 40%", BUZZ_SHARE === 0.4, String(BUZZ_SHARE));
  ck("the band is 15% to 55%", BUZZ_MIN === 0.15 && BUZZ_MAX === 0.55,
     BUZZ_MIN + " - " + BUZZ_MAX);
  ck("the base sits inside its own band", BUZZ_SHARE > BUZZ_MIN && BUZZ_SHARE < BUZZ_MAX);
}

/* The same curve js/app.js runs, against the constants read out of it. */
function want(w) {
  if (w > 0) return BUZZ_SHARE + (BUZZ_MAX - BUZZ_SHARE) * Math.min(1, w / 18);
  if (w < 0) return BUZZ_SHARE - (BUZZ_SHARE - BUZZ_MIN) * Math.min(1, -w / 9);
  return BUZZ_SHARE;
}
const share = (w, fresh) => Math.max(0, Math.min(want(w), fresh / BATCH));

console.log("\nthe band moves with the reader");

{
  ck("an untouched profile gets exactly the old 40%", want(0) === 0.4, String(want(0)));
  ck("liking Buzz raises it", want(6) > 0.4, want(6).toFixed(3));
  ck("skimming past it lowers it", want(-6) < 0.4, want(-6).toFixed(3));

  /* THE ENDS. The engine clamps its weights to -12..24, so those are the
   * extremes a real profile can reach. */
  ck("no profile can push it past the ceiling", want(24) <= BUZZ_MAX + 1e-9,
     want(24).toFixed(3));
  ck("nor below the floor", want(-12) >= BUZZ_MIN - 1e-9, want(-12).toFixed(3));
  /* Floating point: 0.4 - 0.25 is 0.15000000000000002, so these compare with a
     tolerance rather than pretending decimal arithmetic is exact. */
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  ck("the ceiling is actually reachable", near(want(18), BUZZ_MAX), want(18).toFixed(6));
  ck("and the floor is", near(want(-9), BUZZ_MIN), want(-9).toFixed(6));

  ck("it never turns the feed into a news feed",
     want(24) < 0.6, "max " + (want(24) * 100).toFixed(0) + "%");
  ck("and never removes Buzz entirely",
     want(-12) > 0.1, "min " + (want(-12) * 100).toFixed(0) + "%");

  /* Monotonic: a reader who engages more must never get less. */
  let mono = true;
  for (let w = -12; w < 24; w++) if (want(w + 1) < want(w) - 1e-12) mono = false;
  ck("more engagement never means fewer Buzz cards", mono);
}

console.log("\nsupply caps the promise");

{
  /* THE ONE THAT MATTERS. */
  ck("a quiet day shrinks the block instead of backfilling it",
     share(0, 1) === 1 / BATCH, share(0, 1).toFixed(3));
  ck("no fresh items at all reserves nothing", share(0, 0) === 0);
  ck("plenty of fresh items gives the full share",
     share(0, 100) === 0.4, share(0, 100).toFixed(3));
  ck("the cap binds even for a reader who loves Buzz",
     share(24, 2) === 2 / BATCH, share(24, 2).toFixed(3));
  ck("and the band binds even when supply is huge",
     share(24, 999) === BUZZ_MAX, share(24, 999).toFixed(3));

  /* At the old behaviour, a day with two fresh posts still reserved three
   * slots and filled the third from the week-old tail. */
  const oldWay = Math.round(BATCH * 0.4);
  ck("the old code would have reserved more than existed",
     oldWay > 2 && share(0, 2) * BATCH === 2,
     "old " + oldWay + " slots vs " + (share(0, 2) * BATCH) + " now");
}

console.log("\nthe caps js/app.js passes to the sampler");

const capTable = () => {
  /* The shared table is a named constant now, because the VS tab needs a
     different one and a literal at the call site could not be overridden. */
  const m = /MIXED_CAPS\s*=\s*\{([^}]*)\}/.exec(APP);
  return m ? m[1] : "";
};

{
  const caps = capTable();
  ck("the sampler is handed the shared table unless a tab overrides it",
     /cap:\s*caps\s*\|\|\s*MIXED_CAPS/.test(APP));
  ck("the media-heavy types are still capped at one per batch",
     ["race", "mates", "compare", "lean"].every(t => new RegExp(t + "\\s*:\\s*1").test(caps)),
     caps.replace(/\s+/g, " ").trim());
  /* Jorge: too many VS score cards, and the video comparisons are the better
   * content. In the shared table vs is one type among a dozen, so one per
   * batch is the right ceiling there. */
  ck("and vs joins them", /\bvs\s*:\s*1/.test(caps));
  ck("one in eight is roughly a fifth of an uncapped run",
     1 / BATCH < 0.2, (100 / BATCH).toFixed(0) + "% ceiling");
}

console.log("\nno tab may have all of its types capped");

{
  /* THE BUG THIS EXISTS TO CATCH.
   *
   * sampleMixed stops when every type has hit its cap: `if (!choices.length)
   * break`. So a tab whose ENTIRE contents are capped types cannot fill a
   * batch. Adding `vs: 1` to the shared table did exactly that to the VS tab -
   * vs, compare and mates are all it holds and all three were capped, so a
   * request for eight returned three, from a pool of 4,120 cards. Nothing
   * errored; the scroll just got shorter and a third of it was the type the cap
   * was meant to thin out.
   *
   * The types a tab holds are read from the pool files on disk, so a new pool
   * with a capped type fails here rather than in somebody's thumb.
   */
  /* Which table each tab actually draws with. The call site reads
       state.tab === "vs" ? VS_TAB_CAPS : null
     so the override is discoverable from the source rather than restated
     here - if somebody adds a second override this picks it up. */
  const overrides = {};
  const callSite = /drawFrom\(pool,[\s\S]{0,400}?\);/.exec(APP);
  for (const m of ((callSite ? callSite[0] : "")
        .matchAll(/state\.tab\s*===\s*"(\w+)"\s*\?\s*(\w+)/g))) {
    const table = new RegExp(m[2] + "\\s*=\\s*\\{([^}]*)\\}").exec(APP);
    if (table) overrides[m[1]] = table[1];
  }
  const cappedIn = table => new Set((table.match(/(\w+)\s*:\s*\d+/g) || [])
    .map(x => x.split(":")[0].trim()));

  /* TAB_POOLS is DERIVED now, from the POOLS registry that replaced the
   * hand-written lists (§12-13 of the feed-mix brief). It used to be an object
   * literal this read line by line; that parse returned nothing against an
   * IIFE, and the "some tabs were actually checked" guard below is what caught
   * it rather than this suite quietly passing on zero tabs.
   *
   * Reading the registry instead keeps the property being tested identical: a
   * tab's types come from the pools that tab draws on. tools/test_app_pools.mjs
   * owns the registry's own shape. */
  const tabs = (() => {
    const lit = /var POOLS = (\[[\s\S]*?\n  \]);/.exec(APP);
    if (!lit) return {};
    const POOLS = Function('"use strict";return (' + lit[1] + ")")();
    const out = { foryou: [] };
    for (const p of POOLS) {
      for (const t of (p.tabs || [])) (out[t] = out[t] || []).push(p.url);
      if (p.foryou !== false && (p.tabs || []).length) out.foryou.push(p.url);
    }
    return out;
  })();

  const typesOf = files => {
    const out = new Set();
    for (const f of files) {
      const full = path.join(REPO, f);
      if (!fs.existsSync(full)) continue;
      const raw = JSON.parse(fs.readFileSync(full, "utf8"));
      for (const c of (Array.isArray(raw) ? raw : (raw.cards || []))) {
        out.add((c.tags && c.tags.content_type) || c.type || "other");
      }
    }
    return out;
  };

  let checked = 0;
  for (const [tab, files] of Object.entries(tabs)) {
    const types = typesOf(files);
    if (types.size === 0) continue;
    checked++;
    /* One type means the pool is not mixed at all, so hasMixedTypes() sends it
     * to the plain sampler and caps never apply. */
    if (types.size < 2) continue;
    const capped = cappedIn(overrides[tab] || capTable());
    const free = [...types].filter(t => !capped.has(t));
    ck(`the ${tab} tab has an uncapped type to fill a batch with`,
       free.length > 0, [...types].join(", ") +
       (overrides[tab] ? " | own table" : " | shared table") +
       " | free: " + (free.join(", ") || "NONE"));
  }
  ck("and some tabs were actually checked", checked > 0, checked + " tabs");

  /* The VS tab is the one that needs its own table, and the point of that table
   * is that the video comparisons are NOT capped. */
  const vsCaps = /VS_TAB_CAPS\s*=\s*\{([^}]*)\}/.exec(APP);
  const vsBody = vsCaps ? vsCaps[1] : "";
  ck("the VS tab has its own cap table", !!vsCaps, vsBody.replace(/\s+/g, " ").trim());
  ck("it caps the score cards", /\bvs\s*:\s*[1-9]/.test(vsBody));
  ck("and leaves the video comparisons to carry the tab",
     !/\bcompare\s*:/.test(vsBody) && !/\bmates\s*:/.test(vsBody));
  const vsCap = parseInt((/\bvs\s*:\s*(\d+)/.exec(vsBody) || [])[1], 10);
  ck("its ceiling is about a fifth of a batch, not a third",
     vsCap / BATCH <= 0.26, vsCap + " of " + BATCH + " = " + Math.round(100 * vsCap / BATCH) + "%");
  /* Three types capped at one each is what produced three-card batches. */
  ck("and it does not cap every type the tab holds",
     (vsBody.match(/\w+\s*:/g) || []).length < 3,
     (vsBody.match(/\w+\s*:/g) || []).length + " capped");
}

console.log("\nfrivolities are off, without anything being deleted");

{
  const tabPools = /TAB_POOLS\s*=\s*\{([\s\S]*?)\n  \};/.exec(APP);
  /* Comments stripped first: the block carries a note explaining how to switch
     the pool back on, and that note names the file. Counting it would make this
     check fail on its own documentation. */
  const body = (tabPools ? tabPools[1] : "").replace(/\/\*[\s\S]*?\*\//g, "");
  const listed = (body.match(/frivolities-pool\.json/g) || []).length;
  ck("no tab draws from the frivolities pool", listed === 0, listed + " references");
  ck("the pool file is still on disk",
     fs.existsSync(path.join(REPO, "data", "frivolities-pool.json")));
  ck("and its builder is too, so it can be switched back on",
     fs.existsSync(path.join(REPO, "tools", "build_frivolities.mjs")));
  /* The quiz tab still has cards: quiz, trivia and ballot are eager pools,
   * loaded for every tab, not part of TAB_POOLS. */
  ck("the eager pools still carry the quiz types",
     /EAGER_POOLS[\s\S]{0,200}quiz-pool\.json/.test(APP) &&
     /EAGER_POOLS[\s\S]{0,200}ballot-pool\.json/.test(APP));
}

console.log("\nballot cards offer four answers");

{
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, "data", "ballot-pool.json"), "utf8"));
  const cards = raw.cards || [];
  const two = cards.filter(c => (c.payload.options || []).length < 4).length;
  ck("the pool is loaded", cards.length > 0, cards.length + " cards");
  /* The pool on disk may predate the builder change; what matters is that the
   * feed cannot show a two-option ballot, and that the builder no longer makes
   * one. Both are checked rather than assuming a rebuild has happened. */
  ck("js/app.js filters out any ballot with fewer than four options",
     /type === "ballot"[\s\S]{0,120}options[\s\S]{0,40}length < 4/.test(APP));
  ck("the builder's two-way question is gone",
     !/Who finished higher in the/.test(
       fs.readFileSync(path.join(REPO, "tools/build_data.mjs"), "utf8")));
  ck("and its replacement asks four",
     /Who finished highest in the/.test(
       fs.readFileSync(path.join(REPO, "tools/build_data.mjs"), "utf8")));
  console.log("         (" + two + " of " + cards.length +
              " cards in the shipped pool still have two — rebuild to recover them)");
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\nthe mix is a band with ends, and it is never propped up with stale posts");
process.exit(fail ? 1 : 0);
