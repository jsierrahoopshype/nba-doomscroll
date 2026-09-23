#!/usr/bin/env node
/* Two-player trivia has to be a question, not a name-recognition test.
 *
 * WHAT WENT WRONG. The pool builder accepted any pair whose values were within
 * 4x of each other, and 4x is not a question. The card Jorge found on the live
 * feed asked whether Michael Jordan (32,292 career points) or Steve Francis
 * (10,446) scored more - a 3.1x gap that a reader answers without looking at
 * either number. His words: "We can't have dumb questions like that. They are
 * supposed to be difficult with similar numbers."
 *
 * THE FIX HAS TWO HALVES and this suite pins both, because either one alone
 * leaves the feed wrong:
 *
 *   tools/build_data.mjs stops writing them. That is the permanent fix, and it
 *   takes effect on the next weekly data refresh.
 *
 *   js/app.js refuses to draw them. That is what fixes the pool sitting in
 *   readers' caches right now - 133 of its 300 cards are blowouts - and stays
 *   afterwards as the net under a future pool built by an older script.
 *
 * The two ceilings MUST be the same number. A browser stricter than the builder
 * silently shrinks the pool; a builder stricter than the browser is a gate that
 * never fires. This suite reads both out of the shipped files and compares them
 * rather than hard-coding either, so moving one and not the other fails here
 * instead of on the feed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
const BUILD = fs.readFileSync(path.join(REPO, "tools", "build_data.mjs"), "utf8");

let fail = 0;
function ck(label, ok, note) {
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${note ? "   " + note : ""}`);
}

/** max/min for a trivia card's two values, or null if it has none. */
function ratio(card) {
  const p = card && card.payload;
  if (!p || !p.a || !p.b) return null;
  const va = p.a.value, vb = p.b.value;
  if (typeof va !== "number" || typeof vb !== "number") return null;
  const lo = Math.min(va, vb);
  return lo ? Math.max(va, vb) / lo : Infinity;
}

console.log("\nthe two ceilings are one number");

const appCeil = (APP.match(/var TRIVIA_MAX_RATIO = ([\d.]+)/) || [])[1];
const buildCeil = (BUILD.match(/ratio < 1\.08 \|\| ratio > ([\d.]+)/) || [])[1];

ck("js/app.js declares a ceiling", !!appCeil, appCeil ? appCeil + "x" : "not found");
ck("tools/build_data.mjs declares one", !!buildCeil, buildCeil ? buildCeil + "x" : "not found");
ck("and they are the same", !!appCeil && appCeil === buildCeil,
   "a browser stricter than the builder shrinks the pool for nothing");

const CEIL = Number(appCeil || 0);
/* Sanity on the number itself, so this suite still means something if someone
 * sets both to 50. 2.0x is where "who has more" stops being a question: at 2x
 * one player has double the other and the reader does not need the figures. */
ck("and the ceiling is tight enough to be a question", CEIL > 1 && CEIL <= 2,
   CEIL + "x");
/* And loose enough to leave a pool. The floor at 1.08 is the builder's, and a
 * ceiling underneath it would accept nothing at all. */
ck("and loose enough to leave a pool", CEIL > 1.08);

console.log("\nthe Jordan/Francis card cannot come back");

/* The exact card Jorge saw, by its real career figures. Not read from the pool
 * - the pool gets rebuilt - but written out here, because this pair is the
 * whole reason the ceiling moved and a regression should name it. */
const JORDAN_FRANCIS = { payload: { a: { value: 32292 }, b: { value: 10446 } } };
ck("32,292 against 10,446 is refused", ratio(JORDAN_FRANCIS) > CEIL,
   ratio(JORDAN_FRANCIS).toFixed(2) + "x");

console.log("\njs/app.js refuses them before they are drawn");

ck("usableCard gates trivia on the ratio",
   /if \(c && c\.type === "trivia" && triviaTooEasy\(c\)\) return false;/.test(APP));
ck("and a zero value counts as no contest",
   /function triviaTooEasy[\s\S]{0,600}if \(!lo\) return true;/.test(APP));
/* usableCard is applied inside poolForTab, which every tab and the Daily Five
 * all draw through. A gate written but never called is the failure mode here. */
ck("and poolForTab applies usableCard", /\.filter\(usableCard\)/.test(APP));
ck("including the Daily Five",
   /F\.pick\(allCards\.filter\(usableCard\)/.test(APP));

console.log("\nthe shipped pool, measured");

const raw = JSON.parse(fs.readFileSync(path.join(REPO, "data", "trivia-pool.json"), "utf8"));
const cards = Array.isArray(raw) ? raw : (raw.cards || []);
ck("the pool loads", cards.length > 0, cards.length + " cards");

const rated = cards.map(ratio).filter(r => r !== null);
ck("every card carries two numbers", rated.length === cards.length,
   rated.length + "/" + cards.length);

const kept = rated.filter(r => r <= CEIL);
/* The browser gate is what makes this pool usable today, so what matters is
 * that enough survives it. Trivia is one card type in a feed of ~8,200; a
 * hundred questions is months of reading at the rate the scheduler serves them.
 * This is a floor, not a target - the next rebuild returns it to ~300. */
ck("enough survives the gate to keep serving trivia", kept.length >= 100,
   kept.length + "/" + cards.length + " within " + CEIL + "x");

/* AND THE MEASUREMENT THAT SAYS THE FIX WAS NEEDED. If this ever reports zero
 * refused, the pool has been rebuilt under the new ceiling and the browser gate
 * has become the no-op it is meant to end up as. That is the good outcome, so
 * it is reported rather than asserted either way. */
console.log(`  --   ${rated.length - kept.length} of ${rated.length} shipped cards are ` +
            `above ${CEIL}x and will not be drawn`);

const worst = Math.max(...rated);
console.log(`  --   widest gap still in the pool: ${worst.toFixed(2)}x`);

console.log("\nthe builder will not write another one");

ck("the trivia gate is a band, not a ceiling alone",
   /ratio < 1\.08 \|\| ratio > [\d.]+/.test(BUILD),
   "two numbers within 8% of each other is a coin flip");
/* The 4x ceiling is the bug. Naming the old number keeps a revert visible:
 * changing it back would pass every other assertion in this file. */
ck("and the old 4x ceiling is gone", !/ratio > 4\b/.test(BUILD));

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "trivia is still asking questions that answer themselves"
                 : "every trivia card is two numbers close enough to have to think about");
process.exit(fail ? 1 : 0);
