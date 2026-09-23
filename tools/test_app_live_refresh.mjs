/* Two invariants in js/app.js that no unit test could reach.
 *
 *     node tools/test_app_live_refresh.mjs
 *
 * §17: LIVE DATA ARRIVING MUST NOT CLEAR AN ACTIVE FEED.
 * §4:  RUMORS ARE OFF, IN EVERY PLACE THEY COULD GET BACK IN.
 *
 * WHY THIS SUITE IS STRUCTURAL, AND WHAT THAT COSTS
 *
 * js/app.js is the shell: it wants a document with #feed, #tabs and #sentinel,
 * a fetch that resolves pools, IntersectionObserver, localStorage and five
 * sibling modules on `window`. The card renderers load headless because they
 * are pure functions of a card; this is not, and a stub complete enough to
 * drive it would be a second implementation of the browser to maintain and get
 * wrong.
 *
 * So these are assertions about the SOURCE, and they are honest about being
 * that. They cannot prove the feed keeps its scroll position. What they CAN do
 * is prove that no live-arrival path calls clearFeed() unguarded, which is the
 * exact line that caused the reset and the exact line somebody would add back
 * while fixing something else. That is worth locking even though it is not a
 * behavioural test, and it is why each check below names the line it is looking
 * at rather than matching a vague pattern.
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

/* Comments describe the old behaviour on purpose - the file explains what it
 * replaced - so every check runs against code with comments stripped. Matching
 * a sentence in a comment and calling it a passing test is the failure mode
 * this whole suite would otherwise have. */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** The body of a named function declaration, brace-matched. */
function bodyOf(name) {
  const at = CODE.indexOf("function " + name + "(");
  if (at < 0) return null;
  const open = CODE.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CODE.length; i++) {
    if (CODE[i] === "{") depth++;
    else if (CODE[i] === "}" && --depth === 0) return CODE.slice(open, i + 1);
  }
  return null;
}

console.log("\n§17: the live paths exist and are the ones being checked");

const absorb = bodyOf("absorbLive");
const swap = bodyOf("swapInLive");
const dropSamples = bodyOf("dropRenderedSamples");
const dropRumors = bodyOf("dropInventedRumors");

ck("absorbLive() exists", !!absorb);
ck("swapInLive() exists", !!swap);
ck("dropRenderedSamples() exists", !!dropSamples);
if (!absorb || !swap || !dropSamples) {
  console.log("\n" + (fail || 1) + " failed\nthe live paths are not where this suite expects them");
  process.exit(1);
}

console.log("\n§17: nothing clears a feed that has cards in it");

{
  /* THE ASSERTION THIS FILE EXISTS FOR. The only clearFeed() reachable from a
   * live arrival must sit behind a check that the feed holds no .card. */
  ck("absorbLive guards clearFeed on the feed being empty",
     /if\s*\(\s*!\s*feedEl\.querySelector\(\s*["']\.card["']\s*\)\s*\)\s*clearFeed\(\)/.test(absorb),
     absorb.replace(/\s+/g, " ").trim().slice(0, 160));

  ck("and it clears state.exhausted, or the new cards are never drawn",
     /state\.exhausted\s*=\s*false/.test(absorb));
  ck("and it asks for the next batch", /loadMore\(\)/.test(absorb));

  /* swapInLive is where all three of the old resets lived. */
  ck("swapInLive no longer calls clearFeed at all",
     swap.indexOf("clearFeed(") < 0,
     swap.indexOf("clearFeed(") < 0 ? "" : "a live arrival still wipes the feed");
  ck("dropInventedRumors no longer calls clearFeed either",
     !dropRumors || dropRumors.indexOf("clearFeed(") < 0);

  /* Every remaining clearFeed() call site, listed. These are the deliberate
   * ones - switching tab, setting or clearing an entity filter - where a reset
   * is what the reader asked for by clicking. A new name appearing here is a
   * new place the feed can be wiped, and wants reading. */
  const ALLOWED = ["absorbLive", "goTab", "setEntity", "clearEntity"];
  const callers = [];
  for (const m of CODE.matchAll(/clearFeed\(\)/g)) {
    const before = CODE.slice(0, m.index);
    /* `function clearFeed()` matches this pattern too. Its own declaration is
     * not a call site, and counting it reported the function declared just
     * above it as a caller. */
    if (/function\s+$/.test(before)) continue;
    const fns = [...before.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)];
    callers.push(fns.length ? fns[fns.length - 1][1] : "(top level)");
  }
  const unexpected = [...new Set(callers)].filter(n => ALLOWED.indexOf(n) < 0);
  ck("the feed is cleared only where the reader asked for it",
     unexpected.length === 0,
     unexpected.length ? "also cleared in: " + unexpected.join(", ")
                       : "cleared in: " + [...new Set(callers)].join(", "));
}

console.log("\n§17: a sample card is removed without taking the feed with it");

{
  ck("dropRenderedSamples removes single nodes", /removeChild\(/.test(dropSamples));
  ck("and only cards marked dummy", /\.dummy/.test(dropSamples));
  ck("and only of the type that just arrived", /c\.type\s*!==\s*type/.test(dropSamples));
  /* A race player holds a rAF loop and a resize listener and a <video> keeps
   * streaming, so removing the node without the teardown clearFeed() does leaks
   * both - once per sample card, for the life of the session. */
  ck("it tears the node down the way clearFeed does",
     /destroyRaces\(/.test(dropSamples) &&
     /BskyVideo/.test(dropSamples) && /YtVideo/.test(dropSamples));
  ck("and forgets the id, so the card can be drawn again",
     /delete rendered\[/.test(dropSamples));
}

console.log("\n§4: rumors are off, in all four places");

{
  ck("the flag exists and is off",
     /var RUMORS_ON\s*=\s*false\s*;/.test(CODE),
     (CODE.match(/var RUMORS_ON\s*=\s*[^;]+;/) || [""])[0]);

  /* 1. The tab is not offered. */
  ck("the Rumors tab is filtered out of TABS",
     /\.filter\(function \(t\) \{ return RUMORS_ON \|\| t\.key !== "rumors"; \}\)/.test(CODE));

  /* 2. Nothing is fetched. A bare swapInLive(root.LiveRumors, ...) would put
   *    live rumors back in the feed without touching any other line. */
  ck("LiveRumors is only loaded behind the flag",
     /if \(RUMORS_ON\) swapInLive\(root\.LiveRumors, "rumor"\)/.test(CODE));
  ck("and is loaded nowhere else",
     (CODE.match(/swapInLive\(root\.LiveRumors/g) || []).length === 1);

  /* 3. THE ONE THAT MATTERED FOR FOR YOU. poolForTab("foryou") returns
   *    allCards without consulting c.tab, so a rumor card that reaches allCards
   *    reaches For You no matter what it is tagged with. Refusing it at
   *    addCards is the only gate that covers every pool and the entity filter
   *    at once. */
  const add = bodyOf("addCards");
  ck("addCards refuses rumor cards outright",
     !!add && /if \(!RUMORS_ON && c\.type === "rumor"\)/.test(add),
     "this is the gate that keeps them out of For You");
  ck("and says so rather than dropping them silently",
     !!add && /rumorsDropped/.test(add));

  /* 4. The sample rumors are still on disk and still refused, which is the
   *    point: nothing was deleted. */
  const dummy = JSON.parse(fs.readFileSync(path.join(REPO, "data", "dummy-cards.json"), "utf8"));
  const rumors = (dummy.cards || []).filter(c => c.type === "rumor");
  ck("the sample rumor cards are untouched on disk", rumors.length > 0,
     rumors.length + " cards, all marked dummy: " + rumors.every(c => c.dummy));
  ck("js/rumors.js is untouched too",
     fs.existsSync(path.join(REPO, "js", "rumors.js")));

  /* Turning them back on has to be one edit, or the flag is decoration. */
  const flagged = (SRC.match(/RUMORS_ON/g) || []).length;
  ck("every rumor site is marked RUMORS_ON", flagged >= 8, flagged + " mentions");
}

console.log("\nthe scheduler is wired to For You and to nothing else");

{
  /* §14: every other tab is a reader asking for one kind of thing, and a
   * scheduler that thinned those out would be the app arguing with the reader.
   * An entity filter is exempt for the same reason. */
  ck("js/schedule.js is loaded by index.html",
     /<script src="js\/schedule\.js"><\/script>/.test(
       fs.readFileSync(path.join(REPO, "index.html"), "utf8")));
  ck("and js/editorial.js is loaded before it", (() => {
    const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
    return html.indexOf("js/editorial.js") < html.indexOf("js/schedule.js");
  })());

  const load = bodyOf("loadMore");
  ck("For You draws through the scheduler",
     !!load && /DoomSchedule && state\.tab === "foryou" && !state\.entity/.test(load),
     "the guard is what keeps every other tab on its own draw");
  ck("and every other tab still uses drawFrom",
     !!load && /: drawFrom\(pool, recentlyShown\(\)/.test(load));

  const sb = bodyOf("scheduleBatch");
  /* THE ENGINE MUST STILL PICK. The scheduler says how many cards of each kind;
   * E.sample decides which. Replacing that with a plain shuffle would throw
   * away the learned weights, the freshness rule and the story spacing - the
   * personalisation this app is built on - and nothing else would notice. */
  ck("the scheduler still draws through the engine's sampler",
     !!sb && /sample: function \(list, n, opts\) \{ return E\.sample/.test(sb));
  ck("and it is given the feed's real tail, not just the batch",
     !!sb && /tail: feedTail\(/.test(sb));
  ck("and the counters survive across batches",
     /var foryouSince/.test(CODE) && /foryouSince = res\.since/.test(CODE));
  ck("and reset when the feed genuinely restarts",
     /function resetSchedule/.test(CODE) && /state\.phase = "own"; resetSchedule\(\)/.test(CODE));
  ck("cards are counted as SERVED, in the render loop",
     /DoomSchedule\.countCard\(foryouSince, byId\[node\.dataset\.id\]\)/.test(CODE));
}

console.log("\nthe feed still ends where it always did");

{
  /* A guard against over-reach: absorbLive must not have become the general
   * refresh. The tab switch and the entity filter still reset the feed, because
   * there the reset IS the answer - a reader who tapped History is not asking
   * to keep their For You position. */
  const goTab = bodyOf("goTab");
  ck("switching tab still clears the feed", !!goTab && /clearFeed\(\)/.test(goTab));
  const setEntity = bodyOf("setEntity");
  ck("setting an entity filter still clears it", !!setEntity && /clearFeed\(\)/.test(setEntity));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a live arrival can still throw a reader back to the top"
                 : "live cards arrive below the reader, and rumors stay out");
process.exit(fail ? 1 : 0);
