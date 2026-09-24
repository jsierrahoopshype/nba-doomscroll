#!/usr/bin/env node
/* hoopsmatic.com is where this page lives, and the page says so.
 *
 *     node tools/test_canonical.mjs
 *
 * Jorge's standing rule for every HoopsMatic section: once it is served on
 * hoopsmatic.com, canonical, og:url and the sitemap point there and never at
 * jsierrahoopshype.github.io. A github.io canonical tells Google to index the
 * GitHub copy instead; the matchups section lost almost all of its search
 * presence that way across 2,547 pages before anyone noticed.
 *
 * Doomscroll is served at https://hoopsmatic.com/nba-doomscroll/ by the
 * hoopsmatic-worker router (PR #22). The Worker also sets og:url, and was
 * changed to drop an upstream og:url rather than emit a second one, so these
 * tags existing here does not produce duplicates on hoopsmatic.com - and here
 * is what makes the GitHub Pages copy defer too.
 *
 * Also pins the copy: rumors are switched off (RUMORS_ON = false in js/app.js),
 * so nothing the page says about itself may promise them, and Jorge's editorial
 * rules forbid em dashes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const HOME = "https://hoopsmatic.com/nba-doomscroll/";

let fail = 0;
function ck(label, ok, note) {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${note ? "   " + note : ""}`);
}

const all = (re) => [...HTML.matchAll(re)].map(m => m[1]);

console.log("\none canonical and one og:url, both on hoopsmatic.com");

const canon = all(/<link rel="canonical" href="([^"]*)">/g);
const ogUrl = all(/<meta property="og:url" content="([^"]*)">/g);
ck("exactly one canonical", canon.length === 1, canon.length + " found");
ck("exactly one og:url", ogUrl.length === 1, ogUrl.length + " found");
ck("the canonical is the hoopsmatic.com address", canon[0] === HOME, canon[0]);
ck("and so is og:url", ogUrl[0] === HOME, ogUrl[0]);
/* Anywhere in the head, not just those two tags: an og:image or a hreflang
 * pointing at the GitHub copy would do the same damage more quietly. */
const head = (HTML.split("</head>")[0] || "");
ck("nothing in <head> points at github.io",
   !/jsierrahoopshype\.github\.io/.test(head.replace(/<!--[\s\S]*?-->/g, "")));
/* The trailing slash is load-bearing: the page loads js/, css/ and data/ by
 * relative path, and the Worker 301s the bare path to this one. */
ck("with its trailing slash", /\/$/.test(canon[0] || ""));

console.log("\nthe page does not describe features it does not have");

const title = (HTML.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
const desc = (HTML.match(/<meta name="description" content="([^"]*)">/) || [])[1] || "";
const ogDesc = (HTML.match(/<meta property="og:description" content="([^"]*)">/) || [])[1] || "";
const sub = ((HTML.match(/<p class="subtitle">([\s\S]*?)<\/p>/) || [])[1] || "").replace(/\s+/g, " ");

for (const [name, text] of [["title", title], ["description", desc],
                            ["og:description", ogDesc], ["subtitle", sub]]) {
  ck(`the ${name} does not mention rumors`, !/rumou?r/i.test(text), text.slice(0, 70) + "...");
  ck(`the ${name} has no em dash`, !/—|&mdash;/.test(text));
}
ck("description and og:description say the same thing", desc === ogDesc);

/* The switch these assertions depend on. If rumors come back, this file is
 * the reminder that the copy has to come back with them. */
const APP = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
ck("and rumors really are off", /var RUMORS_ON = false;/.test(APP));

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the page could send search traffic to the GitHub copy, or promise rumors"
                 : "hoopsmatic.com is the page's own address, and the copy matches the feed");
process.exit(fail ? 1 : 0);
