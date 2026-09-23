/* Two things a reader sees and no other suite covers.
 *
 *     node tools/test_share_and_media.mjs
 *
 * SHARING: every card shared out of the feed tags HoopsHype, and the handle is
 * per-network. "@hoopshype" on Bluesky is not the HoopsHype account, it is
 * nobody, so a single shared string would silently tag the wrong thing on one
 * of the two networks. The truncation is the other half: the suffix has to be
 * measured against the character cap rather than appended after it, or a long
 * headline pushes the handle off the end - and the handle is the one part of
 * the line with a job to do.
 *
 * IMAGES: a Bluesky post with two images was rendering both as 8.5rem crops.
 * HoopsHype posts a photograph beside a stat table, and cropping took the
 * table's header row and its totals - the two rows the table exists for. The
 * first image is now shown whole, and with exactly two so is the second. These
 * are CSS assertions, which cannot prove a layout; what they can prove is that
 * the rules exist, are in an order where the whole-image rule survives, and
 * still crop the third and fourth image of a four-image post.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const eq = (name, got, want) =>
  ck(name, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js", "share-text.js"), "utf8"))(win);
const T = win.ShareText;
const css = fs.readFileSync(path.join(REPO, "css", "styles.css"), "utf8");

const card = (payload, type) => ({ type: type || "otd", payload: payload });
const bodyOf = (url) => decodeURIComponent((url.split("text=")[1] || "").split("&")[0]);

console.log("\nthe handles are per network and not interchangeable");

{
  eq("Bluesky gets the full domain handle", T.HANDLE.bsky, "@hoopshypeofficial.bsky.social");
  eq("X gets the short one", T.HANDLE.x, "@hoopshype");
  ck("and they are different strings", T.HANDLE.bsky !== T.HANDLE.x);
}

console.log("\nevery share tags the account");

{
  const c = card({ headline: "Jordan hit the last shot of his Bulls career" });
  const bsky = bodyOf(T.composeUrl("bsky", c, "https://example.com/x"));
  const x = bodyOf(T.composeUrl("x", c, "https://example.com/x"));

  ck("a Bluesky post carries the Bluesky handle",
     bsky.indexOf("@hoopshypeofficial.bsky.social") >= 0, bsky);
  ck("an X post carries the X handle", x.indexOf("@hoopshype") >= 0, x);
  /* THE MISTAKE A SINGLE HANDLE WOULD MAKE. */
  ck("and the X post does NOT carry the Bluesky one",
     x.indexOf("bsky.social") < 0, "that handle means nothing on X");
  ck("the headline survives", bsky.indexOf("Bulls career") >= 0);
  ck("and so does the feed's name", bsky.indexOf("NBA Doomscroll") >= 0);
}

console.log("\nthe link still rides where each network wants it");

{
  const c = card({ headline: "A short one" });
  const bsky = T.composeUrl("bsky", c, "https://example.com/abc");
  const x = T.composeUrl("x", c, "https://example.com/abc");
  /* Bluesky's composer takes one field, so the link is inside the text. X takes
   * it separately and appends it itself, which is why it must not also be in
   * the text - it would show up twice. */
  ck("Bluesky has the link inside the text", bodyOf(bsky).indexOf("example.com/abc") >= 0);
  ck("X passes it as its own parameter", x.indexOf("&url=") >= 0);
  ck("and X does not repeat it in the text", bodyOf(x).indexOf("example.com/abc") < 0);
}

console.log("\na long headline loses its own words, never the handle");

{
  const c = card({ headline: "word ".repeat(200) });
  const bsky = bodyOf(T.composeUrl("bsky", c, "https://example.com/x")).split("\n")[0];
  const x = bodyOf(T.composeUrl("x", c, "https://example.com/x"));

  /* THE ASSERTION THIS SECTION EXISTS FOR. Appending the suffix after
   * truncating to MAX puts the line over the cap and the handle is what falls
   * off the end. */
  ck("the Bluesky line stays inside the cap", bsky.length <= T.MAX,
     bsky.length + " of " + T.MAX);
  ck("and still ends with the handle",
     /@hoopshypeofficial\.bsky\.social$/.test(bsky), bsky.slice(-50));
  ck("the X line stays inside the cap", x.length <= T.MAX, x.length + " of " + T.MAX);
  ck("and still ends with its handle", /@hoopshype$/.test(x), x.slice(-30));
  ck("the headline was the thing trimmed", bsky.indexOf("…") >= 0);
}

console.log("\na card with nothing to say still reads as a person");

{
  const empty = card({});
  const bsky = bodyOf(T.composeUrl("bsky", empty, ""));
  ck("it is not an empty post", bsky.length > 0, JSON.stringify(bsky));
  ck("it names the feed", bsky.indexOf("NBA Doomscroll") >= 0);
  ck("and still tags the account", bsky.indexOf("@hoopshypeofficial") >= 0, bsky);
  /* text() is public and predates the handle. An existing caller asking for
   * plain text must still get what it always did. */
  ck("text() without a network adds no handle",
     T.text(card({ headline: "Hello" })).indexOf("@") < 0,
     T.text(card({ headline: "Hello" })));
}

console.log("\nthe first image of a Bluesky post is shown whole");

{
  ck("a single image was already whole",
     /\.bsky-images img\{[^}]*height:auto/.test(css));

  const firstRule = css.indexOf(".bsky-images.grid a:first-child img{");
  const restRule = css.indexOf(".bsky-images.grid a:not(:first-child) img{");
  ck("the first image of a multi-image post has its own rule", firstRule >= 0);
  ck("and it is not cropped",
     /\.bsky-images\.grid a:first-child img\{[^}]*height:auto/.test(css) &&
     /\.bsky-images\.grid a:first-child img\{[^}]*object-fit:contain/.test(css));

  /* Order matters: a:not(:first-child) has higher specificity than a:first-child
   * for the images it matches, but it must not match the first one at all. If
   * these two ever collapse into one selector the first image goes back to
   * being an 8.5rem crop with nothing erroring. */
  ck("the crop rule excludes the first image", restRule >= 0 &&
     /a:not\(:first-child\) img\{[^}]*height:8\.5rem/.test(css));

  /* Exactly two, both whole. */
  ck("a two-image post shows the second whole too",
     /a:first-child:nth-last-child\(2\) ~ a img\{[^}]*height:auto/.test(css));
  ck("and gives it the full width",
     /a:first-child:nth-last-child\(2\) ~ a\{[^}]*flex:0 0 100%/.test(css));

  /* Three and four keep the crop row, which the original comment was right
   * about: four full-height images in a feed card is a page each. */
  ck("three or four still crop the rest",
     css.indexOf("a:not(:first-child) img{") > 0 &&
     /a:not\(:first-child\) img\{[^}]*object-fit:cover/.test(css));
  ck("the grid still wraps rather than overflowing",
     /\.bsky-images\.grid\{[^}]*flex-wrap:wrap/.test(css));
}

console.log("\nthe renderer still caps how many it shows");

{
  const cardsSrc = fs.readFileSync(path.join(REPO, "js", "cards.js"), "utf8");
  /* Four is the cap Bluesky itself imposes on a post, and the renderer slices
   * to it. Without that, a malformed embed could render fifty images. */
  ck("bskyMedia shows at most four images",
     /function bskyMedia[\s\S]{0,400}images\.slice\(0, 4\)/.test(cardsSrc));
  ck("and marks the multi-image case so the CSS can tell",
     /function bskyMedia[\s\S]{0,500}shown\.length > 1 \? " grid" : ""/.test(cardsSrc));
  ck("a broken image removes its own link rather than leaving a gap",
     /function bskyMedia[\s\S]{0,700}onerror[^>]*closest\(\\?'a\\?'\)\.remove/.test(cardsSrc));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a shared card tags the wrong account, or crops the wrong image"
                 : "the right handle per network, and the first picture shown whole");
process.exit(fail ? 1 : 0);
