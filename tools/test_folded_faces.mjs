#!/usr/bin/env node
/* Does the accent fold actually find the file?
 *
 * The bug it guards: race data spells "Jusuf Nurkic", the PNG on disk is
 * "Jusuf Nurkić.png", and asking the filesystem for the ASCII spelling misses
 * it in silence. The player kept a remote URL instead of a baked tile and
 * nothing errored, which is how it survived a build that reported 99% success.
 *
 * Tests the function build_races.mjs actually calls, not a copy of it. A test
 * against a reimplementation proves the reimplementation works.
 *
 *   node tools/test_folded_faces.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import { foldedPngIndex, foldAccents } from "./lib/faces.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foldedfaces-"));
let pass = 0, fail = 0;

function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${detail ? "\n         " + detail : ""}`); fail++; }
}

/* Real files, not mocks: the whole failure was about how a filesystem stores
 * and returns a name, and a mocked readdir would have agreed with the bug. */
const files = [
  "Jusuf Nurkić.png",        // accented, asked for as ASCII
  "Luka Dončić.png",         // two marks in one name
  "Nikola Jokić.png",
  "LeBron James.png",        // plain ASCII, must keep resolving exactly
  "Michael Jordan.PNG",      // uppercase extension
  "notes.txt"                // not a PNG, must be ignored
];
for (const f of files) fs.writeFileSync(path.join(dir, f), "x");

const idx = foldedPngIndex(dir);

ok("an accented file is found by its ASCII spelling",
  idx.get(foldAccents("Jusuf Nurkic")) === path.join(dir, "Jusuf Nurkić.png"),
  `got ${idx.get(foldAccents("Jusuf Nurkic"))}`);

ok("two marks in one name fold too",
  idx.get(foldAccents("Luka Doncic")) === path.join(dir, "Luka Dončić.png"));

ok("and another",
  idx.get(foldAccents("Nikola Jokic")) === path.join(dir, "Nikola Jokić.png"));

ok("a plain ASCII name still resolves",
  idx.get(foldAccents("LeBron James")) === path.join(dir, "LeBron James.png"));

ok("the accented spelling finds it as well",
  idx.get(foldAccents("Jusuf Nurkić")) === path.join(dir, "Jusuf Nurkić.png"));

ok("case in the extension does not matter",
  idx.get(foldAccents("Michael Jordan")) === path.join(dir, "Michael Jordan.PNG"));

ok("a non-PNG is not indexed",
  !idx.has(foldAccents("notes")));

ok("a name with no file is a miss, not a wrong hit",
  idx.get(foldAccents("Nobody Here")) === undefined);

/* NFD on disk. macOS stores filenames decomposed, so the same name can arrive
 * as one code point or as two. Folding normalises both to the same key - if it
 * did not, the index would work on Windows and quietly fail on a Mac. */
const nfdDir = fs.mkdtempSync(path.join(os.tmpdir(), "foldednfd-"));
fs.writeFileSync(path.join(nfdDir, "Jusuf Nurkić.png"), "x");   // c + combining acute
const nfdIdx = foldedPngIndex(nfdDir);
ok("a decomposed filename folds to the same key as a composed one",
  nfdIdx.get(foldAccents("Jusuf Nurkic")) !== undefined,
  `keys: ${[...nfdIdx.keys()].join(", ")}`);

/* A folder holding BOTH spellings must not depend on readdir order. Running
 * the same directory twice would agree whatever the rule is, so this asserts
 * the RESOLUTION - the exact ASCII spelling - which only a deterministic tie
 * break can deliver. Created in the other order too, since a filesystem may
 * well hand them back in creation order. */
function dupFolder(first, second) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "foldeddup-"));
  fs.writeFileSync(path.join(d, first), "x");
  fs.writeFileSync(path.join(d, second), "x");
  return d;
}
const dupA = dupFolder("Jusuf Nurkic.png", "Jusuf Nurkić.png");
const dupB = dupFolder("Jusuf Nurkić.png", "Jusuf Nurkic.png");
ok("both spellings present: the exact one wins, whichever was written first",
  foldedPngIndex(dupA).get(foldAccents("Jusuf Nurkic")) === path.join(dupA, "Jusuf Nurkic.png") &&
  foldedPngIndex(dupB).get(foldAccents("Jusuf Nurkic")) === path.join(dupB, "Jusuf Nurkic.png"),
  `${foldedPngIndex(dupA).get(foldAccents("Jusuf Nurkic"))} / ${foldedPngIndex(dupB).get(foldAccents("Jusuf Nurkic"))}`);
const dupDir = dupA, dupDir2 = dupB;

ok("a missing folder is empty, not a crash",
  foldedPngIndex(path.join(dir, "nope")).size === 0);

for (const d of [dir, nfdDir, dupDir, dupDir2]) fs.rmSync(d, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
