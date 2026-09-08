/* What leaves this site and lands in someone's timeline.
 *
 *     node tools/test_share_text.mjs
 *
 * The share path is the one place where content walks off the page and into a
 * post that carries no card, no styling and no link back except the one we put
 * there. Two things have to hold, and neither is visible by looking at the UI:
 *
 *   1. RUMOR AND BUZZ CARDS NEVER QUOTE THEMSELVES. A rumor excerpt is
 *      HoopsHype archive content shown under a link to whoever reported it, and
 *      Buzz carries other people's posts. Pasting either into a post
 *      republishes words somewhere the attribution does not follow. This is the
 *      check that matters most here, and the failure would be silent - a
 *      perfectly good-looking post with someone else's sentence in it.
 *
 *   2. THE URL APPEARS EXACTLY ONCE. X takes the link as its own parameter and
 *      appends it; Bluesky takes one text field and needs it inside. Getting
 *      that backwards prints the link twice or not at all.
 *
 * EVERY FIXTURE IS INVENTED, including the rumor text the test proves does not
 * get shared.
 *
 * Runs js/share-text.js the way tools/test_yt_video.mjs runs js/yt-video.js:
 * the real file against a bare window.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js/share-text.js"), "utf8"))(win);
const { text, composeUrl, MAX } = win.ShareText;

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const URL_ = "https://jsierrahoopshype.github.io/nba-doomscroll/?tab=rumors&card=x1";
const card = (type, payload) => ({ id: "t1", type, payload: payload || {} });

console.log("\nwhat never leaves the page");

{
  const secret = "AN INVENTED RUMOR SENTENCE THAT MUST NOT BE POSTED";
  const r = card("rumor", { text: secret, quote: secret, outlet: "Invented Wire" });

  ck("a rumor card does not put its excerpt in the post", text(r).indexOf(secret) < 0);
  ck("nor in the X compose URL", decodeURIComponent(composeUrl("x", r, URL_)).indexOf(secret) < 0);
  ck("nor in the Bluesky one", decodeURIComponent(composeUrl("bsky", r, URL_)).indexOf(secret) < 0);
  ck("it still says something", text(r).length > 10, JSON.stringify(text(r)));

  const b = card("buzz", { post: { text: secret }, headline: secret });
  ck("a buzz card does not repost the post it is showing", text(b).indexOf(secret) < 0);
  ck("buzz still says something", text(b).length > 10, JSON.stringify(text(b)));
}

console.log("\nwhat the other card types say");

{
  ck("a VS card names both players",
     text(card("vs", { a: { name: "A Player" }, b: { name: "B Player" } }))
       .indexOf("A Player vs B Player") === 0);
  ck("and reads p1/p2 when that is the shape",
     text(card("vs", { p1: { name: "C Player" }, p2: { name: "D Player" } }))
       .indexOf("C Player vs D Player") === 0);
  ck("a trade says whose trade it is",
     text(card("trade", {})).indexOf("Trade Machine") >= 0);
  ck("every card ends with the product name",
     /— NBA Doomscroll$/.test(text(card("mates", {}))), text(card("mates", {})));
  ck("an unknown type with nothing usable still returns a post",
     text(card("something-new", {})) === "NBA Doomscroll", text(card("something-new", {})));
  ck("a null payload does not throw", typeof text({ type: "vs" }) === "string");
  ck("a null card does not throw", typeof text(null) === "string");
}

console.log("\nlength");

{
  const long = card("race", { note: "word ".repeat(120) });
  const t = text(long);
  ck("a long line is cut", t.length < MAX + 20, t.length + " chars");
  ck("cut on a word boundary, with an ellipsis", /…\s—\sNBA Doomscroll$/.test(t));
  ck("and not mid-word", !/\bwor…/.test(t));
}

console.log("\nthe compose URLs");

{
  const c = card("vs", { a: { name: "A Player" }, b: { name: "B Player" } });
  const x = composeUrl("x", c, URL_);
  const bs = composeUrl("bsky", c, URL_);

  ck("X uses the intent endpoint", x.indexOf("https://x.com/intent/post?") === 0);
  ck("Bluesky uses its compose intent", bs.indexOf("https://bsky.app/intent/compose?") === 0);

  /* THE ONE THAT IS EASY TO GET BACKWARDS. */
  const xDecoded = decodeURIComponent(x);
  const xInText = xDecoded.split("&url=")[0].indexOf(URL_) >= 0;
  ck("X carries the link in its own parameter, NOT in the text", !xInText);
  ck("X carries the link exactly once", (xDecoded.split(URL_).length - 1) === 1);
  ck("Bluesky carries the link inside the text", decodeURIComponent(bs).indexOf(URL_) >= 0);
  ck("Bluesky carries it exactly once",
     (decodeURIComponent(bs).split(URL_).length - 1) === 1);

  ck("both encode the query, so a & in a name cannot break the URL",
     composeUrl("x", card("race", { note: "Ampersand & friends" }), URL_).indexOf("%26") >= 0);
  ck("an unknown kind falls back to X rather than building nothing",
     composeUrl("mastodon", c, URL_).indexOf("x.com") >= 0);
  ck("no url still produces a usable composer",
     composeUrl("bsky", c, "").indexOf("https://bsky.app/intent/compose?") === 0);
  ck("and does not paste the word undefined into the post",
     decodeURIComponent(composeUrl("bsky", c)).indexOf("undefined") < 0);
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\nthe post says what the card is; the words stay on the page");
process.exit(fail ? 1 : 0);
