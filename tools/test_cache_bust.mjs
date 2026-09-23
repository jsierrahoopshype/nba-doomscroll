#!/usr/bin/env node
/* Every local script and stylesheet carries the same ?v= as the build meta.
 *
 *     node tools/test_cache_bust.mjs
 *
 * WHY THIS SUITE EXISTS, and it is not a style preference.
 *
 * Three fixes in a row were written, verified green against 57 suites and the
 * feed audit, merged, deployed, and then reported from the live site as "not
 * fixed" - twice for the same symptom. GitHub Pages serves js/*.js with a cache
 * header and a hard reload does not reliably beat it, so there was no way, from
 * either end, to tell a stale cached bundle from a fix that did not work. Every
 * round of that costs a deploy, a browser check and a reply.
 *
 * A changed URL is a different file as far as any cache is concerned, so the
 * version query string ends the ambiguity - but only if it is on EVERY local
 * asset and only if it actually changes. A half-versioned page is worse than an
 * unversioned one: app.js arrives new, share-text.js arrives from 1998, and the
 * result is a feed running two builds at once. That is the failure this file
 * exists to catch, because nothing about it is visible in a diff.
 *
 * It does NOT assert what the version is. Bumping it is a judgement call - a
 * data-only change does not need one - and a test that demanded a new string on
 * every commit would be noise. What it asserts is internal consistency: one
 * token, on everything local, matching the meta tag js/app.js reports.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = fs.readFileSync(path.join(REPO, "index.html"), "utf8");

let fail = 0;
function ck(label, ok, note) {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${note ? "   " + note : ""}`);
}

console.log("\nthe build is declared once");

const meta = (/<meta name="doomscroll-build" content="([^"]+)">/.exec(HTML) || [])[1];
ck("index.html declares a build", !!meta, meta || "no doomscroll-build meta");
ck("and it is not a placeholder", !!meta && !/^(x|todo|dev|unknown)$/i.test(meta), meta);

console.log("\nand every local asset carries it");

/* Local only. The Google Fonts stylesheet and the favicon are deliberately
 * excluded: fonts are versioned by Google's own URL and a favicon arriving from
 * cache costs nobody anything. */
const scripts = [...HTML.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]);
const styles = [...HTML.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)"/g)].map(m => m[1]);
const assets = scripts.concat(styles);

ck("the page loads local scripts", scripts.length > 10, scripts.length + " scripts");
ck("and a local stylesheet", styles.length >= 1, styles.length + " stylesheets");

const bare = assets.filter(u => u.indexOf("?v=") < 0);
ck("none of them is unversioned", bare.length === 0,
   bare.length ? bare.join(", ") : assets.length + " assets");

const wrong = assets.filter(u => u.indexOf("?v=") >= 0 &&
                                 u.split("?v=")[1] !== meta);
ck("and none carries a different version from the meta", wrong.length === 0,
   wrong.length ? wrong.join(", ") : "all at " + meta);

/* One token, not several. Two versions across the page is the two-builds-at-
 * once failure, and it would pass the per-asset check above if the meta
 * happened to match one of them. */
const tokens = new Set(assets.map(u => u.split("?v=")[1]).filter(Boolean));
ck("exactly one version string on the page", tokens.size === 1,
   [...tokens].join(", "));

console.log("\nand the file on disk exists for each one");

const missing = assets.filter(u => !fs.existsSync(path.join(REPO, u.split("?")[0])));
ck("no asset points at a file that is not there", missing.length === 0,
   missing.join(", "));

console.log("\njs/app.js reports it at boot");

const APP = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
ck("app.js reads the build meta",
   /meta\[name="doomscroll-build"\]/.test(APP));
ck("and prints it once, at boot",
   /console\.info\("\[doomscroll\] build "/.test(APP));
/* A console call that throws must not cost a reader the feed. */
ck("inside a try, like every other optional thing here",
   /try \{[\s\S]{0,400}doomscroll-build[\s\S]{0,400}\} catch/.test(APP));

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a deploy could serve two builds at once, and nobody would see it"
                 : "one build string, on every local asset, reported at boot");
process.exit(fail ? 1 : 0);
