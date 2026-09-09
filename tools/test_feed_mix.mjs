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

{
  const m = /cap:\s*\{([^}]*)\}/.exec(APP);
  const caps = m ? m[1] : "";
  ck("the media-heavy types are still capped at one per batch",
     ["race", "mates", "compare", "lean"].every(t => new RegExp(t + "\\s*:\\s*1").test(caps)),
     caps.replace(/\s+/g, " ").trim());
  /* Jorge: too many VS score cards in the VS tab, and the video comparisons
   * are the better content there. */
  ck("and vs joins them", /\bvs\s*:\s*1/.test(caps));
  ck("one in eight is roughly a fifth of an uncapped run",
     1 / BATCH < 0.2, (100 / BATCH).toFixed(0) + "% ceiling");
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
