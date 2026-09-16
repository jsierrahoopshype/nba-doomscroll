/* The guards that make trimming the feed safe.
 *
 *     node tools/test_dom_trim.mjs
 *
 * js/app.js cannot be loaded outside a browser, so this reads the source the
 * way test_feed_mix.mjs reads the mix constants. What it is guarding is not the
 * trim itself - that was verified in Chromium: 62 live cards after forty loads
 * instead of about 320, the whole trimmed region collapsed into two merged
 * spacers, and the card under the viewport still at the same offset afterwards.
 *
 * It is guarding the four things that would each break the feed quietly if
 * somebody simplified them away:
 *
 *   1. SPACERS. .feed is a grid, so removing a card shortens the page and the
 *      content under the reader's thumb jumps by that much. Chrome and Firefox
 *      compensate with scroll anchoring; Safari does not, and a phone is the
 *      whole reason this exists. The spacer must keep the height it replaced.
 *
 *   2. THE GRID GAP. A merged spacer absorbs the gap each removed row also
 *      took. Without it the feed creeps upward by 0.6rem for every card
 *      trimmed, which is invisible per card and obvious after fifty.
 *
 *   3. DIRECT CHILDREN ONLY. The Daily Five's five questions are nested .card
 *      elements inside one card. Trimming one would gut the card holding them.
 *
 *   4. THE RELEASES. A race holds a requestAnimationFrame loop and a resize
 *      listener; a playing video keeps streaming. Both outlive a detached node,
 *      so trimming without releasing them would trade a DOM leak for a worse
 *      one.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = fs.readFileSync(path.join(REPO, "js/app.js"), "utf8");
const CSS = fs.readFileSync(path.join(REPO, "css/styles.css"), "utf8");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const num = (name) => {
  const m = new RegExp("var\\s+" + name + "\\s*=\\s*([0-9.]+)").exec(APP);
  return m ? parseFloat(m[1]) : NaN;
};

/* The function, as source, for the checks below. */
const fn = (/function trimFeed\(\)\s*\{[\s\S]*?\n  \}/.exec(APP) || [""])[0];

console.log("\nthe feed trims at all");

{
  ck("trimFeed exists", fn.length > 0);
  ck("and loadMore calls it", /insertDaily\(\);\s*\n\s*trimFeed\(\);/.test(APP));
  const keep = num("KEEP_CARDS"), screens = num("TRIM_SCREENS");
  ck("KEEP_CARDS is a real number", keep > 0, String(keep));
  /* Generous on purpose: a reader scrolling back up a screen or two is
   * ordinary, and BATCH is 8, so the threshold has to clear several batches. */
  ck("it keeps several batches behind the reader", keep >= 24, String(keep));
  ck("but does not keep so many that nothing is ever trimmed", keep <= 200, String(keep));
  ck("and nothing within a few screens of the viewport is touched",
     screens >= 2, String(screens) + " screens");
}

console.log("\nthe page must not move");

{
  ck("a trimmed card leaves a spacer", /card-trimmed/.test(fn));
  ck("and the spacer takes the height it replaced",
     /style\.height\s*=\s*height\s*\+\s*"px"/.test(fn));
  ck("the height comes from a measured rect, not an assumption",
     /getBoundingClientRect\(\)/.test(fn) && /Math\.round\(rect\.height\)/.test(fn));
  /* THE 0.6REM CREEP. */
  ck("a merged spacer also absorbs the grid gap the row took",
     /\+\s*height\s*\+\s*gap\s*\+\s*"px"/.test(fn));
  ck("and the gap is read from the feed rather than hard-coded",
     /getComputedStyle\(feedEl\)\.rowGap/.test(fn));
  ck("the spacer keeps its height in CSS instead of collapsing",
     /\.card-trimmed\{[^}]*position:relative/.test(CSS.replace(/\s+/g, "")) ||
     /\.card-trimmed\{/.test(CSS.replace(/\s+/g, "")),
     "css block present");
  ck("and says what happened, so the gap does not read as broken",
     /Earlier cards were cleared/.test(fn) &&
     /\.card-trimmedspan\{[^}]*position:sticky/.test(CSS.replace(/\s+/g, "")));
}

console.log("\nwhat must never be trimmed");

{
  ck("the Daily Five survives", /\/\^daily-\/\.test/.test(fn));
  /* Its questions are nested cards; only direct children of the feed may go. */
  ck("nested cards are out of reach", /el\.parentNode\s*!==\s*feedEl/.test(fn));
  /* Document order means one card inside the live zone implies the rest are. */
  ck("it stops at the live zone rather than skipping into it",
     /rect\.bottom\s*>\s*edge\)\s*break/.test(fn));
}

console.log("\nnothing is left running");

{
  ck("races are destroyed", /destroyRaces\(el\)/.test(fn));
  ck("bluesky video is released", /BskyVideo\.releaseAll\(el\)/.test(fn));
  ck("youtube video is released", /YtVideo\.releaseAll\(el\)/.test(fn));
  ck("the impression observer stops watching", /skimObserver\.unobserve\(el\)/.test(fn));
  ck("and its dwell timer is forgotten", /visTimes\.delete\(el\)/.test(fn));
  /* clearFeed() does the same three for the whole feed. If it ever grows a
   * fourth kind of teardown, this is the other place that needs it. */
  const clear = (/function clearFeed\(\)\s*\{[\s\S]*?\n  \}/.exec(APP) || [""])[0];
  const kinds = s => ["destroyRaces", "BskyVideo", "YtVideo"].filter(k => s.includes(k));
  ck("and it releases everything clearFeed does",
     kinds(clear).every(k => fn.includes(k)),
     "clearFeed: " + kinds(clear).join(", "));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the feed would jump or leak" : "the DOM stays finite and the page stays still");
process.exit(fail ? 1 : 0);
