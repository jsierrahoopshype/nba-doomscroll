/* Rebuild the race face tiles in place, without rebuilding the races.
 *
 *     node tools/retile_faces.mjs --find
 *     node tools/retile_faces.mjs --find --write
 *
 * --find locates the headshot folders itself, under your home directory, and
 * uses ALL of them together. Explicit paths still work if you want them:
 *
 *     node tools/retile_faces.mjs --local <folder> [<folder> ...] [--write]
 *
 * WHY IT SEARCHES RATHER THAN ASKING
 *
 * There are typically several checkouts of the headshots on one machine -
 * bar-chart-race, bcr-main, an hf_space copy inside each - and they are NOT
 * interchangeable: each resolves a different, overlapping set of players.
 * Choosing one by hand means silently settling for its coverage, which is the
 * same mistake that once had a build reading a media-vote-tracker checkout
 * with 92 players instead of the one with 99.
 *
 * So every candidate is merged. For each tile the LARGEST source file across
 * all folders wins, since size tracks resolution and the small ones are CDN
 * placeholders. The report shows what each folder contributed.
 *
 * WHY THIS EXISTS
 *
 * The tiles in data/races/faces were baked by a resize that forced every source
 * into 1.4:1, which made heads 17% too narrow for their height. The fix is in
 * tools/lib/png.mjs, but picking it up through build_races.mjs means a full
 * race rebuild and four local paths. Nothing about the races themselves needs
 * to change - only the 737 PNGs - so this does that one thing from the one
 * path it actually needs.
 *
 * A tile is only rewritten when a source PNG matching its slug is found, so a
 * partial headshots folder degrades to "fixed what it could" and says which
 * ones it could not. Nothing else in the repo is touched: no JSON, no index,
 * no race data.
 *
 * Dry run by default. --write is required to change anything.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { raceFaceTile } from "./lib/png.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACE_DIR = path.join(REPO, "data/races/faces");
const TILE_W = 112, TILE_H = 80;
// Same rule build_races.mjs applies: below this a file is an NBA CDN
// silhouette placeholder, which is a grey outline of nobody.
const MIN_SRC_BYTES = 15000;

const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const WRITE = argv.includes("--write");
const FIND = argv.includes("--find") || li < 0;   // searching is the default

/* Windows hands paths in with debris on the end. A cmd FOR loop's %~dp
 * expansion ends in a backslash, so "...\headshots\" reaches the process as
 * ...headshots" - cmd read the backslash as escaping the closing quote. A
 * pasted path can also arrive with its own trailing separator. Both are the
 * folder the person meant, so strip them rather than reporting "no such
 * folder" at someone who typed the right thing. */
function cleanPath(p) {
  if (!p) return p;
  let s = String(p).trim().replace(/["']+$/, "").replace(/^["']+/, "");
  // Not on a bare root ("C:\", "/"), where the separator is the path.
  if (s.length > 3) s = s.replace(/[\\/]+$/, "");
  return s;
}

/* Every non-flag argument after --local is a folder, so several can be given
 * at once and are merged exactly as --find merges what it discovers. */
const explicit = [];
if (li >= 0) {
  for (let i = li + 1; i < argv.length && !argv[i].startsWith("--"); i++) {
    const p = cleanPath(argv[i]);
    if (p) explicit.push(p);
  }
}

/* Walks the home directory for folders literally named "headshots". Bounded
 * at six levels and skipping the usual heavy directories, which keeps it to a
 * second or two rather than a scan of everything a machine has ever held. */
const SKIP = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache", "AppData",
  "Library", "Windows", "Program Files", "Program Files (x86)", ".next", "dist", "build"
]);
function findHeadshotFolders(root, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return out; }                       // unreadable, not our business
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    if (e.name.toLowerCase() === "headshots") { out.push(full); continue; }
    findHeadshotFolders(full, depth + 1, out);
  }
  return out;
}

let SOURCES = explicit;
if (!SOURCES.length && FIND) {
  const home = os.homedir();
  process.stdout.write(`  searching ${home} for headshot folders...`);
  SOURCES = findHeadshotFolders(home);
  console.log(` found ${SOURCES.length}`);
}

if (!SOURCES.length) {
  console.error(FIND
    ? "no folder named 'headshots' found under your home directory."
    : "usage: node tools/retile_faces.mjs --find [--write]\n" +
      "   or: node tools/retile_faces.mjs --local <folder> [<folder> ...] [--write]");
  process.exit(1);
}
for (const s of SOURCES) {
  if (!fs.existsSync(s)) { console.error(`no such folder: ${s}`); process.exit(1); }
}
if (!fs.existsSync(FACE_DIR)) {
  console.error(`no tiles to rebuild: ${FACE_DIR} is missing`);
  process.exit(1);
}

const slugOf = name => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

/* build_races.mjs slugs the name as it appears in the RACE DATA, which is
 * plain ASCII. The headshot FILES keep their diacritics, and slugOf drops an
 * accented letter rather than folding it - so "Jusuf Nurkić.png" slugged to
 * "jusuf-nurki" and never met the tile called "jusuf-nurkic". That is the
 * whole reason six players kept a distorted tile after a 99% run.
 *
 * Both forms are indexed rather than replacing one with the other: a folder
 * whose filenames are already ASCII must keep matching exactly as before. */
const fold = s => s.normalize ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s;
const slugsFor = name => {
  const raw = slugOf(name), folded = slugOf(fold(name));
  return folded === raw ? [raw] : [raw, folded];
};

/* slug -> best source across every folder. Largest file wins: size tracks
 * resolution, and the sub-15KB entries are CDN silhouettes. A folder that
 * holds only placeholders therefore cannot displace a real portrait found
 * somewhere else, which is the whole point of merging rather than choosing. */
const bySlug = new Map();
const contributed = new Map(SOURCES.map(s => [s, 0]));
for (const dir of SOURCES) {
  let files;
  try { files = fs.readdirSync(dir); } catch (e) { continue; }
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".png")) continue;
    const full = path.join(dir, f);
    let size;
    try { size = fs.statSync(full).size; } catch (e) { continue; }
    for (const slug of slugsFor(f.slice(0, -4))) {
      const prev = bySlug.get(slug);
      if (!prev || size > prev.size) bySlug.set(slug, { file: full, size, dir });
    }
  }
}

const tiles = fs.readdirSync(FACE_DIR).filter(f => f.endsWith(".png"));
let rebuilt = 0, unchanged = 0, tooSmall = 0, failed = 0;
const missing = [];

for (const tile of tiles) {
  const slug = tile.slice(0, -4);
  const hit = bySlug.get(slug);
  if (!hit) { missing.push(slug); continue; }
  if (hit.size < MIN_SRC_BYTES) { tooSmall++; continue; }

  const buf = raceFaceTile(hit.file, TILE_W, TILE_H);
  if (!buf) { failed++; console.log(`  could not decode ${path.basename(hit.file)}`); continue; }
  contributed.set(hit.dir, (contributed.get(hit.dir) || 0) + 1);

  const dest = path.join(FACE_DIR, tile);
  const before = fs.readFileSync(dest);
  if (before.equals(buf)) { unchanged++; continue; }
  if (WRITE) fs.writeFileSync(dest, buf);
  rebuilt++;
}

/* The headline number when comparing checkouts. Five folders called
 * "headshots" can sit on one machine and resolve wildly different numbers of
 * players; picking the wrong one silently leaves most tiles distorted. */
const matched = tiles.length - missing.length;
const pct = tiles.length ? Math.round(100 * matched / tiles.length) : 0;

console.log(`
  folders used       ${SOURCES.length}`);
for (const [dir, n] of contributed) {
  console.log(`    ${String(n).padStart(4)} tiles   ${dir}`);
}
console.log(`
  MATCH RATE         ${matched} of ${tiles.length} tiles (${pct}%)
  source images      ${bySlug.size} distinct players across all folders
  tiles on disk      ${tiles.length}
  rebuilt            ${rebuilt}${WRITE ? "" : "   (dry run - nothing written)"}
  already correct    ${unchanged}
  source too small   ${tooSmall}   (CDN placeholder, tile left alone)
  no source found    ${missing.length}
  decode failed      ${failed}`);

if (missing.length) {
  console.log(`\n  These keep their old tile - the headshots folder has no file for them:`);
  console.log("  " + missing.slice(0, 12).join(", ") + (missing.length > 12 ? `, and ${missing.length - 12} more` : ""));
}
if (!WRITE && rebuilt) {
  console.log(`\n  Re-run with --write to apply.`);
}
